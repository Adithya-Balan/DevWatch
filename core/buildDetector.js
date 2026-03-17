/**
 * DevWatch — core/buildDetector.js
 *
 * Pillar 5 — Build Performance Intelligence
 *
 * Detects active build processes inside the process map and tracks their
 * resource usage.  When a build process exits, its run is recorded in a
 * persist history (up to 5 runs per project root).
 *
 * Detection strategy
 * ──────────────────
 * A process is classified as a "build" if its name matches BUILD_TOOL_NAMES
 * AND it currently has at least some CPU usage (>= ACTIVE_CPU_THRESHOLD).
 * This avoids flagging idle `npm` REPL sessions as active builds.
 *
 * Types
 * ─────
 *   BuildRun {
 *     pid        : number
 *     tool       : string          // short tool name ('cargo', 'npm', …)
 *     cmdline    : string          // first 60 chars of full cmdline
 *     projectRoot: string | null
 *     startedAt  : number          // GLib monotonic µs
 *     durationMs : number | null   // null while still running
 *     peakCpuPct : number          // highest CPU% seen during the run
 *     peakRamKb  : number          // highest VmRSS seen during the run
 *     finished   : boolean
 *   }
 *
 *   BuildResult {
 *     active  : BuildRun[]
 *     history : Map<string, BuildRun[]>   // projectRoot → last 5 runs
 *   }
 *
 * Usage
 * ─────
 *   const detector = new BuildDetector();
 *   detector.start(cancellable);
 *   const result = detector.analyse(projectMap);
 *   detector.stop();
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { BuildLogger } from './buildLogger.js';

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Process names (lowercase) to watch as build tools.
 */
const BUILD_TOOL_NAMES = new Set([
    // JavaScript / Node ecosystem
    'npm', 'npx', 'yarn', 'pnpm', 'bun',
    'webpack', 'webpack-cli', 'vite', 'esbuild', 'rollup', 'parcel',
    'tsc', 'swc', 'turbopack',
    // Test runners (often long-running, spike during build)
    'jest', 'vitest', 'mocha',
    // Rust
    'cargo', 'rustc',
    // Go
    'go',
    // C / C++
    'make', 'cmake', 'ninja', 'gcc', 'g++', 'clang', 'cc', 'ld',
    // JVM
    'mvn', 'gradle', 'gradlew', 'javac', 'kotlinc',
    // Python
    'pip', 'pip3', 'python', 'python3', 'pytest', 'setuptools',
    // Docker / containers
    'docker', 'podman',
    // Ruby
    'bundle', 'rake',
    // PHP
    'composer',
    // Misc
    'bazel', 'buck', 'pants',
]);

/**
 * CPU% below which a build-tool process is NOT considered to be actively
 * building (avoids triggering on idle interpreters).
 */
const ACTIVE_CPU_THRESHOLD = 1.0;

/** Max completed runs to keep per project root. */
const MAX_HISTORY_PER_PROJECT = 5;

/** File to persist build history across sessions. */
const HISTORY_FILENAME = 'build_history.json';

// ─────────────────────────────────────────────────────────────────────────────

export class BuildDetector {
    constructor() {
        /** @type {Gio.Cancellable|null} */
        this._cancellable = null;

        /**
         * Active build runs keyed by PID.
         * Populated when a build process first appears with active CPU.
         * @type {Map<number, BuildRun>}
         */
        this._active = new Map();

        /**
         * Completed build history keyed by project root.
         * @type {Map<string, BuildRun[]>}
         */
        this._history = new Map();

        /** Path to the persistent history JSON file. */
        this._historyPath = GLib.build_filenamev([
            GLib.get_home_dir(),
            '.local', 'share', 'devwatch', HISTORY_FILENAME,
        ]);

        /** Whether history has been loaded from disk. */
        this._historyLoaded = false;
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /** @param {Gio.Cancellable} cancellable */
    start(cancellable) {
        this._cancellable = cancellable;
        this._loadHistory();
    }

    stop() {
        this._cancellable = null;
        this._active.clear();
    }

    /**
     * Analyse the current process map and update active/finished build state.
     * Synchronous — no I/O.  History persistence is fire-and-forget async.
     *
     * @param {Map<string, import('./processTracker.js').ProjectData>} projectMap
     * @returns {BuildResult}
     */
    analyse(projectMap) {
        const nowUs = GLib.get_monotonic_time();

        // Build a flat set of all live processes
        const allProcs = [...(projectMap?.values() ?? [])].flatMap(p => p.processes);
        const livePids = new Set(allProcs.map(p => p.pid));

        // ── 1. Detect newly started / ongoing builds ───────────────────────
        for (const proc of allProcs) {
            const lowerName = proc.name?.toLowerCase() ?? '';
            if (!BUILD_TOOL_NAMES.has(lowerName)) continue;
            if (proc.cpuPercent < ACTIVE_CPU_THRESHOLD) continue;

            if (this._active.has(proc.pid)) {
                // Update peak stats for an already-tracked build
                const run = this._active.get(proc.pid);
                run.peakCpuPct = Math.max(run.peakCpuPct, proc.cpuPercent);
                run.peakRamKb  = Math.max(run.peakRamKb,  proc.memKb ?? 0);
            } else {
                // New build started
                const cmdline = (proc.cmdline ?? [proc.name]).join(' ').slice(0, 60);
                /** @type {BuildRun} */
                const run = {
                    pid:         proc.pid,
                    tool:        lowerName,
                    cmdline,
                    projectRoot: proc.projectRoot ?? null,
                    startedAt:   nowUs,
                    durationMs:  null,
                    peakCpuPct:  proc.cpuPercent,
                    peakRamKb:   proc.memKb ?? 0,
                    finished:    false,
                };
                this._active.set(proc.pid, run);
                console.log(`[DevWatch:BuildDetector] Build started: ${lowerName} (PID ${proc.pid})`);

                // Start capturing output for this build
                this._logger.startCapture(proc.pid, lowerName, proc.projectRoot);
            }
        }

        // ── 2. Detect completed builds (PID gone from live set) ────────────
        let historyDirty = false;
        for (const [pid, run] of this._active) {
            if (livePids.has(pid)) continue; // still running

            run.finished   = true;
            run.durationMs = Math.round((nowUs - run.startedAt) / 1000);
            this._active.delete(pid);

            const key = run.projectRoot ?? '__ungrouped__';
            const bucket = this._history.get(key) ?? [];
            bucket.unshift(run); // newest first
            if (bucket.length > MAX_HISTORY_PER_PROJECT)
                bucket.length = MAX_HISTORY_PER_PROJECT;
            this._history.set(key, bucket);
            historyDirty = true;

            console.log(`[DevWatch:BuildDetector] Build finished: ${run.tool} (PID ${pid}) — ${run.durationMs} ms, peak CPU ${run.peakCpuPct.toFixed(1)}%, peak RAM ${Math.round(run.peakRamKb / 1024)} MB`);
        }

        if (historyDirty) this._persistHistory();

        return {
            active:  [...this._active.values()],
            history: this._history,
        };
    }

    /** Release all in-memory state. */
    destroy() {
        this._logger.stop();
        this._active.clear();
        this._history.clear();
        this._cancellable = null;
    }

    // ── Private ─────────────────────────────────────────────────────────────

    /**
     * Load persisted history from disk (sync, best-effort).
     * Called once in start().
     */
    _loadHistory() {
        if (this._historyLoaded) return;
        this._historyLoaded = true;

        try {
            const file = Gio.File.new_for_path(this._historyPath);
            if (!file.query_exists(null)) return;
            const [, contents] = file.load_contents(null);
            const text = new TextDecoder().decode(contents);
            const obj  = JSON.parse(text);
            for (const [key, runs] of Object.entries(obj)) {
                this._history.set(key, runs);
            }
            console.log('[DevWatch:BuildDetector] Loaded build history from disk');
        } catch (e) {
            console.warn('[DevWatch:BuildDetector] _loadHistory():', e?.message ?? e);
        }
    }

    /**
     * Persist the current history map to disk asynchronously.
     */
    _persistHistory() {
        // Ensure storage dir exists
        try {
            const storageDir = GLib.build_filenamev([
                GLib.get_home_dir(), '.local', 'share', 'devwatch',
            ]);
            Gio.File.new_for_path(storageDir).make_directory_with_parents(null);
        } catch (_) { /* exists — ignore */ }

        const obj = {};
        for (const [key, runs] of this._history) obj[key] = runs;
        const bytes = new TextEncoder().encode(JSON.stringify(obj, null, 2));

        const file = Gio.File.new_for_path(this._historyPath);
        file.replace_contents_bytes_async(
            GLib.Bytes.new(bytes),
            null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            this._cancellable,
            (_src, res) => {
                try { file.replace_contents_finish(res); }
                catch (e) {
                    if (!e.message?.includes('CANCELLED'))
                        console.warn('[DevWatch:BuildDetector] _persistHistory():', e.message);
                }
            }
        );
    }
}
