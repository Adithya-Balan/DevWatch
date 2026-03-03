/**
 * DevWatch — core/projectDetector.js
 *
 * Detects the currently active development project by:
 *   1. Watching which window has focus (global.display.notify::focus-window)
 *   2. Reading /proc/<pid>/cwd of that window's owning process
 *   3. Running `git rev-parse --show-toplevel` from that directory
 *   4. Falling back to walking up the directory tree for known project markers
 *
 * The detector fires an onProjectChanged callback whenever the active project
 * root changes. Consumers (processTracker, UI sections) subscribe to that.
 *
 * Usage
 * ─────
 *   const detector = new ProjectDetector();
 *   detector.onProjectChanged(info => console.log(info.root));
 *   detector.start(cancellable);
 *   // ... later ...
 *   detector.stop();
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { execCommunicate } from '../utils/subprocess.js';
import { readProcCwd } from '../utils/procReader.js';

// ── Project marker files — presence of any of these indicates a project root ──
const PROJECT_MARKERS = [
    '.git',
    'package.json',
    'Cargo.toml',
    'go.mod',
    'pyproject.toml',
    'setup.py',
    'pom.xml',
    'build.gradle',
    'Makefile',
    'CMakeLists.txt',
    'composer.json',
    'Gemfile',
    '.project',
];

// Directories that should never be treated as project roots
const ROOT_STOP_DIRS = new Set(['/', '/home', '/usr', '/opt', '/tmp']);

// ─────────────────────────────────────────────────────────────────────────────

export class ProjectDetector {
    constructor() {
        /** @type {{ root: string, name: string, method: string } | null} */
        this._currentProject = null;

        /** @type {Array<(info: object|null) => void>} */
        this._listeners = [];

        /** @type {number|null} Signal ID on global.display */
        this._focusSignalId = null;

        /** @type {Gio.Cancellable|null} */
        this._cancellable = null;

        /** @type {number|null} GLib debounce timeout */
        this._debounceId = null;
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /**
     * Start tracking focused window changes.
     * @param {Gio.Cancellable} cancellable  The extension's cancellable.
     */
    start(cancellable) {
        this._cancellable = cancellable;

        // Watch focus changes
        this._focusSignalId = global.display.connect(
            'notify::focus-window',
            () => this._onFocusChanged()
        );

        // Run an immediate detection for the current focus
        this._onFocusChanged();
    }

    /**
     * Stop tracking and disconnect all signals.
     */
    stop() {
        if (this._focusSignalId !== null) {
            global.display.disconnect(this._focusSignalId);
            this._focusSignalId = null;
        }
        if (this._debounceId !== null) {
            GLib.Source.remove(this._debounceId);
            this._debounceId = null;
        }
        this._cancellable = null;
        this._currentProject = null;
        this._listeners = [];
    }

    /**
     * Register a callback to be called whenever the active project changes.
     * Called with `{ root, name, method }` when a project is found,
     * or `null` when no project can be determined.
     *
     * @param {(info: object|null) => void} callback
     */
    onProjectChanged(callback) {
        this._listeners.push(callback);
    }

    /**
     * Returns the most recently detected project info, or null.
     * @returns {{ root: string, name: string, method: string } | null}
     */
    getCurrentProject() {
        return this._currentProject;
    }

    // ── Private ─────────────────────────────────────────────────────────────

    /**
     * Called when the focused window changes.
     * Debounced by 300ms to avoid thrashing during rapid window switches.
     */
    _onFocusChanged() {
        if (this._debounceId !== null) {
            GLib.Source.remove(this._debounceId);
        }
        this._debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._debounceId = null;
            this._detectProject().catch(e => {
                if (!this._isCancelled(e))
                    console.error('[DevWatch] ProjectDetector._detectProject:', e.message);
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Core detection flow:
     *   focused window → PID → CWD → git root || marker walk
     */
    async _detectProject() {
        const focusedWindow = global.display.focus_window;
        if (!focusedWindow) {
            this._emitChange(null);
            return;
        }

        const pid = focusedWindow.get_pid();
        if (!pid || pid <= 0) {
            this._emitChange(null);
            return;
        }

        // Get CWD of the focused window's process
        const cwd = readProcCwd(pid);
        if (!cwd) {
            this._emitChange(null);
            return;
        }

        // Attempt 1: git rev-parse (most reliable)
        const gitRoot = await this._detectViaGit(cwd);
        if (gitRoot) {
            const info = {
                root:   gitRoot,
                name:   GLib.path_get_basename(gitRoot),
                method: 'git',
                pid,
                cwd,
            };
            this._emitChange(info);
            return;
        }

        // Attempt 2: walk up looking for project markers
        const markerRoot = this._detectViaMarkers(cwd);
        if (markerRoot) {
            const info = {
                root:   markerRoot,
                name:   GLib.path_get_basename(markerRoot),
                method: 'marker',
                pid,
                cwd,
            };
            this._emitChange(info);
            return;
        }

        // No project found — still report the CWD as a fallback
        this._emitChange(null);
    }

    /**
     * Run `git rev-parse --show-toplevel` in the given directory.
     * Returns the git root path, or null if not inside a git repo.
     *
     * @param {string} dir
     * @returns {Promise<string|null>}
     */
    async _detectViaGit(dir) {
        try {
            const result = await execCommunicate(
                ['git', '-C', dir, 'rev-parse', '--show-toplevel'],
                this._cancellable
            );
            return result || null;
        } catch (_e) {
            return null;
        }
    }

    /**
     * Walk up from `startDir` toward the filesystem root, looking for any
     * of the known project marker files/dirs. Returns the deepest directory
     * that contains a marker, or null if none found before reaching a root stop.
     *
     * @param {string} startDir
     * @returns {string|null}
     */
    _detectViaMarkers(startDir) {
        let dir = startDir;

        while (dir && !ROOT_STOP_DIRS.has(dir)) {
            for (const marker of PROJECT_MARKERS) {
                const candidate = GLib.build_filenamev([dir, marker]);
                if (GLib.file_test(candidate, GLib.FileTest.EXISTS)) {
                    return dir;
                }
            }
            const parent = GLib.path_get_dirname(dir);
            if (parent === dir) break; // reached filesystem root
            dir = parent;
        }

        return null;
    }

    /**
     * Fire all registered listeners if the project has actually changed.
     * Avoids redundant callbacks for the same project root.
     *
     * @param {{ root: string, name: string, method: string, pid: number, cwd: string } | null} info
     */
    _emitChange(info) {
        const prevRoot = this._currentProject?.root ?? null;
        const nextRoot = info?.root ?? null;

        if (prevRoot === nextRoot) return; // no change

        this._currentProject = info;
        for (const cb of this._listeners) {
            try {
                cb(info);
            } catch (e) {
                console.error('[DevWatch] ProjectDetector listener error:', e.message);
            }
        }
    }

    /**
     * Returns true for errors caused by Gio.Cancellable.cancel().
     * @param {unknown} err
     * @returns {boolean}
     */
    _isCancelled(err) {
        return (
            err instanceof Error &&
            (err.message?.includes('Operation was cancelled') ||
             err.message?.includes('CANCELLED'))
        );
    }
}
