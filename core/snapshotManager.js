/**
 * DevWatch — core/snapshotManager.js
 *
 * Pillar 4 — Dev Session Snapshot & Restore
 *
 * Captures the current developer session state (active projects, git branches,
 * open ports, and the exact commands used to run each service) as a JSON file
 * and can restore it later by relaunching those commands in the correct dirs.
 *
 * Storage layout
 * ──────────────
 *   ~/.local/share/devwatch/snapshots/
 *     2026-03-03_14-30-00_my-label.json
 *     2026-03-03_09-15-00_auto.json
 *     …
 *
 * Snapshot schema (version 2)
 * ───────────────────────────
 *   {
 *     version    : 2,
 *     label      : string,          // user-supplied or "auto"
 *     savedAt    : ISO-8601 string,
 *     savedAtMs  : number,          // Date.now()
 *     projects   : ProjectSnap[],
 *     ports      : PortSnap[],
 *   }
 *
 *   ProjectSnap {
 *     root         : string,        // absolute project root path
 *     name         : string,        // basename of root
 *     branch       : string | null, // current git branch (null if not a git repo)
 *     processNames : string[],      // unique process names at snapshot time (legacy)
 *     totalMemKb   : number,
 *     services     : ServiceSnap[], // NEW in v2 — launchable service records
 *   }
 *
 *   ServiceSnap {
 *     cmdline  : string,        // full command as string (e.g. "python manage.py runserver")
 *     argv     : string[],      // tokenised argv for direct exec (no shell quoting issues)
 *     cwd      : string,        // working directory the process was started from
 *     port     : number | null, // port the service is bound to (null if unbound / unknown)
 *   }
 *
 *   EditorSnap {
 *     app  : string,  // canonical short name: "code", "codium", "idea", "zed", "vim", etc.
 *     exec : string,  // full executable path found in $PATH (for reliable re-launch)
 *   }
 *
 *   PortSnap {
 *     port        : number,
 *     protocol    : string,
 *     processName : string | null,
 *     projectRoot : string | null,
 *     isDevPort   : boolean,
 *   }
 *
 * Usage
 * ─────
 *   const mgr = new SnapshotManager();
 *   const snap = await mgr.save(projectMap, portResult, 'before-refactor');
 *   const list = await mgr.list();      // newest first
 *   const data = await mgr.load(list[0].filename);
 *   await mgr.restore(data);            // relaunches saved services
 *   await mgr.delete(list[0].filename);
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { execCommunicate, isCancelledError } from '../utils/subprocess.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const SNAPSHOT_VERSION = 2;

/** Maximum number of saved snapshots to keep on disk (oldest pruned). */
const MAX_SNAPSHOTS = 20;

/** Fixed filename for the auto-saved "last workspace" — never timestamped, always overwritten. */
const LAST_WORKSPACE_FILENAME = '_last_workspace_.json';
const LAST_WORKSPACE_LABEL    = '__last_workspace__';

// ─────────────────────────────────────────────────────────────────────────────

export class SnapshotManager {
    constructor() {
        /** @type {Gio.Cancellable|null} */
        this._cancellable = null;

        /** Absolute path to the snapshots directory. */
        this._snapshotDir = GLib.build_filenamev([
            GLib.get_home_dir(),
            '.local', 'share', 'devwatch', 'snapshots',
        ]);
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /** @param {Gio.Cancellable} cancellable */
    start(cancellable) {
        this._cancellable = cancellable;
        this._ensureDir();
    }

    stop() {
        this._cancellable = null;
    }

    /**
     * Save the current session state to a timestamped JSON file.
     *
     * @param {Map<string, import('./processTracker.js').ProjectData>} projectMap
     * @param {import('./portMonitor.js').PortScanResult} portResult
     * @param {string} [label='auto']
     * @returns {Promise<SnapshotMeta>}  Metadata about the saved snapshot.
     */
    async save(projectMap, portResult, label = 'auto') {
        const now       = new Date();
        const isoNow    = now.toISOString();
        const stamp     = _dateToStamp(now);
        const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
        const filename  = `${stamp}_${safeLabel}.json`;

        const snapshot = await this._buildSnapshot(projectMap, portResult, label);
        await this._writeJson(filename, snapshot);
        await this._pruneOldSnapshots();

        console.log(`[DevWatch:SnapshotManager] Saved snapshot: ${filename}`);
        const totalServices = snapshot.projects.reduce((n, p) => n + (p.services?.length ?? 0), 0);
        return { filename, label, savedAt: isoNow, projectCount: snapshot.projects.length, serviceCount: totalServices };
    }

    /**
     * Auto-save the current workspace to the fixed "last workspace" file.
     * Overwrites on every call — no accumulation, no prune needed.
     * Safe to fire-and-forget: errors are logged but never thrown.
     *
     * @param {Map} projectMap
     * @param {object} portResult
     * @returns {Promise<void>}
     */
    async saveLastWorkspace(projectMap, portResult) {
        // Skip if there is nothing meaningful to capture
        if (!projectMap || projectMap.size === 0) return;
        try {
            const snapshot = await this._buildSnapshot(projectMap, portResult, LAST_WORKSPACE_LABEL);
            await this._writeJson(LAST_WORKSPACE_FILENAME, snapshot);
            console.log('[DevWatch:SnapshotManager] Auto-saved last workspace');
        } catch (e) {
            console.warn('[DevWatch:SnapshotManager] saveLastWorkspace() failed:', e.message);
        }
    }

    /**
     * Load the last workspace snapshot, or null if none exists.
     * @returns {object|null}
     */
    loadLastWorkspace() {
        const path = GLib.build_filenamev([this._snapshotDir, LAST_WORKSPACE_FILENAME]);
        try {
            const [, raw] = Gio.File.new_for_path(path).load_contents(null);
            return JSON.parse(new TextDecoder().decode(raw));
        } catch (_) {
            return null;
        }
    }

    /**
     * List all saved snapshots, newest first.
     * @returns {Promise<SnapshotMeta[]>}
     */
    async list() {
        const dir = Gio.File.new_for_path(this._snapshotDir);

        let enumerator;
        try {
            enumerator = await new Promise((resolve, reject) => {
                dir.enumerate_children_async(
                    'standard::name,standard::type',
                    Gio.FileQueryInfoFlags.NONE,
                    GLib.PRIORITY_DEFAULT,
                    this._cancellable,
                    (_src, res) => {
                        try { resolve(dir.enumerate_children_finish(res)); }
                        catch (e) { reject(e); }
                    }
                );
            });
        } catch (e) {
            if (!isCancelledError(e))
                console.warn('[DevWatch:SnapshotManager] list() failed:', e.message);
            return [];
        }

        const metas = [];
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const name = info.get_name();
            if (!name.endsWith('.json')) continue;
            // The last-workspace file is surfaced separately — skip it here
            if (name === LAST_WORKSPACE_FILENAME) continue;
            const meta = _filenameToMeta(name);
            if (meta) metas.push(meta);
        }
        enumerator.close(null);

        // Enrich metas with service/project counts from the file contents
        for (const meta of metas) {
            try {
                const path = GLib.build_filenamev([this._snapshotDir, meta.filename]);
                const [, raw] = Gio.File.new_for_path(path).load_contents(null);
                const data = JSON.parse(new TextDecoder().decode(raw));
                meta.projectCount = data.projects?.length ?? 0;
                meta.serviceCount = (data.projects ?? [])
                    .reduce((n, p) => n + (p.services?.length ?? 0), 0);
                meta.editorCount  = (data.projects ?? [])
                    .reduce((n, p) => n + (p.editors?.length  ?? 0), 0);
            } catch (_) {
                meta.projectCount = meta.projectCount ?? 0;
                meta.serviceCount = 0;
                meta.editorCount  = 0;
            }
        }

        // Newest first
        metas.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
        return metas;
    }

    /**
     * Load the full snapshot data from a file.
     * @param {string} filename  Bare filename (not full path).
     * @returns {Promise<object|null>}
     */
    async load(filename) {
        const path = GLib.build_filenamev([this._snapshotDir, filename]);
        const file = Gio.File.new_for_path(path);
        try {
            const [, contents] = file.load_contents(null);
            const text = new TextDecoder().decode(contents);
            return JSON.parse(text);
        } catch (e) {
            console.error('[DevWatch:SnapshotManager] load() failed:', e.message);
            return null;
        }
    }

    /**
     * Restore a snapshot by relaunching each saved service command in its own
     * terminal window.  For v1 snapshots (no services array), falls back to
     * opening a terminal at the project root.
     *
     * Port-conflict detection: if a service's port is already listening,
     * that service is skipped to avoid duplicate processes.
     *
     * @param {object} snapshot  Full snapshot data from load().
     * @returns {{ launched: number, skipped: number }}
     */
    async restore(snapshot) {
        const projects = snapshot?.projects ?? [];
        if (projects.length === 0) {
            console.log('[DevWatch:SnapshotManager] restore(): snapshot has no projects');
            return { launched: 0, skipped: 0 };
        }

        // Snapshot of currently listening ports — lets us skip services that
        // are already running so we never create duplicate processes.
        const occupiedPorts = this._readOccupiedPorts();

        let launched = 0;
        let skipped  = 0;
        let editors  = 0;

        for (const proj of projects) {
            if (!proj.root) continue;

            // Skip virtual-envs, IDE extension dirs, package dirs, etc.
            if (_isNonProjectRoot(proj.root)) {
                console.log(`[DevWatch:SnapshotManager] restore(): skipping non-project root: ${proj.root}`);
                continue;
            }

            // Verify the directory still exists
            const dir = Gio.File.new_for_path(proj.root);
            if (!dir.query_exists(null)) {
                console.warn(`[DevWatch:SnapshotManager] restore(): root gone: ${proj.root}`);
                continue;
            }

            const services = proj.services ?? [];

            // Separate services already bound to a port from ones we can start
            const runnableServices = [];
            for (const svc of services) {
                if (svc.port && occupiedPorts.has(svc.port)) {
                    console.log(
                        `[DevWatch:SnapshotManager] restore(): port ${svc.port} already in use,` +
                        ` skipping: ${svc.cmdline}`
                    );
                    skipped++;
                } else {
                    runnableServices.push(svc);
                }
            }

            // ── Prefer VS Code integrated terminal ─────────────────────────
            // Only use VS Code if the project was actually using it at snapshot
            // time (editors[]) OR the project already has a .vscode/ directory
            // (reliable indicator the developer works in VS Code for this repo).
            // This prevents opening VS Code for Vim / PyCharm / no-editor projects
            // merely because `code` happens to be installed on the machine.
            const wasVscodeEditor = (proj.editors ?? []).some(
                e => e.app === 'code' || e.app === 'codium'
            );
            const projectHasVscode = Gio.File.new_for_path(
                GLib.build_filenamev([proj.root, '.vscode'])
            ).query_exists(null);

            // Resolve the executable at restore time — the snapshot path may be
            // stale after a VS Code upgrade.  Always prefer PATH; only fall back
            // to the absolute path recorded in the snapshot if PATH lookup fails.
            const vscodeExec = (wasVscodeEditor || projectHasVscode)
                ? (GLib.find_program_in_path('code') ??
                   GLib.find_program_in_path('code-oss') ??
                   GLib.find_program_in_path('codium') ??
                   (proj.editors ?? []).find(e => e.app === 'code' || e.app === 'codium')?.exec ??
                   null)
                : null;

            if (vscodeExec) {
                if (runnableServices.length > 0)
                    this._writeVscodeTasks(proj, runnableServices);
                try {
                    const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
                    launcher.set_environ(GLib.get_environ()); // required: passes WAYLAND_DISPLAY / DISPLAY
                    launcher.spawnv([vscodeExec, proj.root]);
                    console.log(`[DevWatch:SnapshotManager] Opened VS Code: ${proj.root}`);
                    launched += runnableServices.length;
                    editors++;
                    for (const svc of runnableServices)
                        if (svc.port && svc.port >= 1024) this._openBrowserTab(svc.port);
                    continue; // fully handled — skip fallback below
                } catch (e) {
                    console.warn('[DevWatch:SnapshotManager] VS Code launch failed:', e.message);
                    // fall through to system-terminal fallback
                }
            }

            // ── Fallback: open non-VS Code editors + system terminals ───────
            for (const ed of (proj.editors ?? [])) {
                if (ed.app === 'code' || ed.app === 'codium') continue; // already attempted above
                this._launchEditor(ed, proj.root);
                editors++;
            }

            if (services.length === 0) {
                // v1 snapshot or project with no captured commands — just open a shell
                this._openTerminal(proj.root, proj.name, proj.branch);
                launched++;
                continue;
            }

            for (const svc of runnableServices) {
                const cwd = svc.cwd ?? proj.root;
                this._launchService(svc, cwd, proj.name);
                launched++;
                if (svc.port && svc.port >= 1024) this._openBrowserTab(svc.port);
            }
        }

        console.log(
            `[DevWatch:SnapshotManager] restore(): launched=${launched} skipped=${skipped} editors=${editors}`
        );
        return { launched, skipped, editors };
    }

    // ── Terminal helpers ─────────────────────────────────────────────────────

    /**
     * Open a new terminal running a saved service command.
     * The window title shows the project name and command for easy identification.
     * A "press Enter to close" prompt is appended so the terminal stays open
     * if the command exits immediately (e.g. misconfigured command).
     *
     * @param {{ cmdline: string, argv: string[] }} svc
     * @param {string} cwd   Working directory for the command
     * @param {string} projectName
     */
    _launchService(svc, cwd, projectName) {
        const title   = `${projectName} — ${svc.cmdline}`;
        // Wrap in bash -c so multi-word commands (npm run dev, python manage.py …)
        // are tokenised by the shell rather than exec'd literally.
        const shellCmd =
            `${svc.cmdline}; ` +
            `printf '\\n[DevWatch] Process exited (code $?). Press Enter to close.'; read`;

        for (const argv of [
            ['gnome-terminal', `--title=${title}`, `--working-directory=${cwd}`,
             '--', 'bash', '-c', shellCmd],
            ['xterm', '-title', title, '-e',
             `bash -c "cd '${cwd.replace(/'/g, "'\\''")}' && ${shellCmd}"`],
        ]) {
            try {
                const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
                launcher.set_environ(GLib.get_environ());
                launcher.set_cwd(cwd);
                launcher.spawnv(argv);
                console.log(`[DevWatch:SnapshotManager] Launched service: ${svc.cmdline} (${cwd})`);
                return;
            } catch (e) {
                console.warn(
                    `[DevWatch:SnapshotManager] _launchService via ${argv[0]} failed:`, e.message
                );
            }
        }
    }

    /**
     * Open the saved editor with the project root as its workspace argument.
     * @param {{ app: string, exec: string }} ed
     * @param {string} projectRoot
     */
    _launchEditor(ed, projectRoot) {
        try {
            const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
            launcher.set_environ(GLib.get_environ());
            launcher.spawnv([ed.exec, projectRoot]);
            console.log(`[DevWatch:SnapshotManager] Opened editor: ${ed.exec} ${projectRoot}`);
        } catch (e) {
            console.warn(`[DevWatch:SnapshotManager] _launchEditor(${ed.exec}) failed:`, e.message);
        }
    }

    /**
     * Write DevWatch service commands into the project's own .vscode/tasks.json
     * so VS Code runs them in its integrated terminal on folder open.
     *
     * Writing to the project folder (not to ~/.local/share/devwatch/) means
     * VS Code uses the same folder-level trust that was already granted when
     * the developer first opened the project — no extra trust dialog.
     *
     * Existing user-defined tasks are preserved; only tasks whose label starts
     * with "DevWatch[" are replaced.
     *
     * @param {{ root: string }} proj
     * @param {Array<{ cmdline: string, cwd: string }>} services
     */
    _writeVscodeTasks(proj, services) {
        const vscodeDir = GLib.build_filenamev([proj.root, '.vscode']);
        try {
            Gio.File.new_for_path(vscodeDir).make_directory_with_parents(null);
        } catch (_) { /* already exists */ }

        const tasksPath = GLib.build_filenamev([vscodeDir, 'tasks.json']);

        // Read existing tasks.json to merge with (preserves user-defined tasks).
        let existing = { version: '2.0.0', tasks: [] };
        try {
            const [, raw] = Gio.File.new_for_path(tasksPath).load_contents(null);
            const parsed  = JSON.parse(new TextDecoder().decode(raw));
            existing = parsed;
            if (!Array.isArray(existing.tasks)) existing.tasks = [];
            // Remove stale DevWatch entries so we don't accumulate duplicates.
            existing.tasks = existing.tasks.filter(t => !String(t.label ?? '').startsWith('DevWatch['));
        } catch (_) { /* fresh file — use defaults above */ }

        const newTasks = services.map((svc, i) => ({
            label:      `DevWatch[${i}]: ${svc.cmdline.slice(0, 50)}`,
            type:       'shell',
            command:    svc.cmdline,
            options:    { cwd: svc.cwd ?? proj.root },
            runOptions: { runOn: 'folderOpen' },
            presentation: {
                reveal: 'always',
                panel:  'new',
                title:  svc.cmdline.split(' ').slice(0, 3).join(' '),
            },
            problemMatcher: [],
        }));
        existing.tasks.push(...newTasks);

        try {
            const file  = Gio.File.new_for_path(tasksPath);
            const bytes = new TextEncoder().encode(JSON.stringify(existing, null, 2));
            // replace_contents() is atomic (write-then-rename) and always writes
            // all bytes — safer than managing a raw output stream.
            file.replace_contents(
                bytes, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null
            );
            console.log(`[DevWatch:SnapshotManager] Wrote VS Code tasks: ${tasksPath}`);
        } catch (e) {
            console.warn('[DevWatch:SnapshotManager] _writeVscodeTasks failed:', e.message);
        }
    }

    /**
     * Open a browser tab for a localhost dev port using xdg-open.
     * Only called for ports >= 1024 (dev range).
     * A short delay is added so the service has time to bind before the browser hits it.
     * @param {number} port
     */
    _openBrowserTab(port) {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
            try {
                const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
                launcher.set_environ(GLib.get_environ());
                launcher.spawnv(['xdg-open', `http://localhost:${port}`]);
                console.log(`[DevWatch:SnapshotManager] Opened browser tab: http://localhost:${port}`);
            } catch (e) {
                console.warn('[DevWatch:SnapshotManager] _openBrowserTab failed:', e.message);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Open a bare terminal at a project root (used for v1 snapshots).
     * @param {string} root
     * @param {string} name
     * @param {string|null} branch
     */
    _openTerminal(root, name, branch) {
        const title = branch ? `${name} (${branch})` : name;
        for (const argv of [
            ['gnome-terminal', `--title=${title}`, `--working-directory=${root}`],
            ['xterm', '-title', title, '-e',
             `bash -c "cd '${root.replace(/'/g, "'\\''")}' && exec $SHELL"`],
        ]) {
            try {
                const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
                launcher.set_environ(GLib.get_environ());
                launcher.spawnv(argv);
                console.log(`[DevWatch:SnapshotManager] Opened terminal: ${title}`);
                return;
            } catch (_) { /* try next */ }
        }
    }

    /**
     * Read /proc/net/tcp and /proc/net/tcp6 to find all currently LISTEN ports.
     * This is a synchronous, zero-subprocess check — safe to call before spawning.
     * @returns {Set<number>}
     */
    _readOccupiedPorts() {
        const occupied = new Set();
        for (const procFile of ['/proc/net/tcp', '/proc/net/tcp6']) {
            try {
                const [, raw] = Gio.File.new_for_path(procFile).load_contents(null);
                const text = new TextDecoder().decode(raw);
                for (const line of text.split('\n').slice(1)) {
                    const cols = line.trim().split(/\s+/);
                    if (cols.length < 4) continue;
                    // col[3] is state: 0A = TCP_LISTEN
                    if (cols[3] !== '0A') continue;
                    const portHex = cols[1].split(':')[1];
                    if (portHex) occupied.add(parseInt(portHex, 16));
                }
            } catch (_) { /* file may not exist on all kernels */ }
        }
        return occupied;
    }

    /**
     * Delete a snapshot file.
     * @param {string} filename  Bare filename.
     * @returns {Promise<boolean>}
     */
    async delete(filename) {
        const path = GLib.build_filenamev([this._snapshotDir, filename]);
        const file = Gio.File.new_for_path(path);
        try {
            file.delete(null);
            console.log(`[DevWatch:SnapshotManager] Deleted: ${filename}`);
            return true;
        } catch (e) {
            console.error('[DevWatch:SnapshotManager] delete() failed:', e.message);
            return false;
        }
    }

    // ── Private ─────────────────────────────────────────────────────────────

    /** Create snapshot directory if it doesn't exist. */
    _ensureDir() {
        try {
            const dir = Gio.File.new_for_path(this._snapshotDir);
            dir.make_directory_with_parents(null);
        } catch (e) {
            // G_IO_ERROR_EXISTS is expected on subsequent calls — ignore it
            if (!e.message?.includes('exists') && !e.message?.includes('File exists'))
                console.warn('[DevWatch:SnapshotManager] _ensureDir():', e.message);
        }
    }

    /**
     * Get current git branch for a project root.
     * Returns null if not a git repo or git is unavailable.
     * @param {string} root
     * @returns {Promise<string|null>}
     */
    async _gitBranch(root) {
        try {
            const out = await execCommunicate(
                ['git', '-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'],
                this._cancellable
            );
            return out.trim() || null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Build the core snapshot data object (shared by save() and saveLastWorkspace()).
     * @private
     */
    async _buildSnapshot(projectMap, portResult, label) {
        const now    = new Date();
        const isoNow = now.toISOString();

        // Exclude virtual-env and IDE-extension dirs — not real project workspaces.
        const roots = [...(projectMap?.keys() ?? [])].filter(r => !_isNonProjectRoot(r));
        const branches = await Promise.all(roots.map(root => this._gitBranch(root)));
        const branchMap = new Map(roots.map((r, i) => [r, branches[i]]));

        const pidToPort = new Map();
        for (const r of (portResult?.ports ?? []))
            if (r.pid && !pidToPort.has(r.pid)) pidToPort.set(r.pid, r.port);

        const projects = roots.map(root => {
            const pd    = projectMap.get(root);
            const names = [...new Set((pd?.processes ?? []).map(p => p.name))];

            const seenArgv = new Set();
            const services = [];
            for (const proc of (pd?.processes ?? [])) {
                const argv = _normaliseArgv(proc.cmdline);
                if (!argv) continue;
                // ── Resolve bare interpreter to its actual binary path ──────
                // When a developer runs `python3 manage.py runserver` inside a
                // virtual environment, /proc/<pid>/cmdline records the bare
                // argv[0] (`python3`) but /proc/<pid>/exe resolves to the full
                // venv path (`/home/.../myvenv/bin/python3`).  We substitute
                // the exe path so the saved command can be restored correctly
                // without needing the venv to be pre-activated.
                // The same logic handles nvm (node), pyenv (python), rbenv (ruby),
                // and any other version-manager that shims via PATH.
                if (proc.exe &&
                    !argv[0].startsWith('/') &&           // bare name, not an absolute path
                    proc.exe.startsWith('/') &&           // exe resolved successfully
                    GLib.path_get_basename(proc.exe) !== proc.exe  // exe has a directory component
                ) {
                    argv[0] = proc.exe;
                }
                const key = argv.join('\0');
                if (seenArgv.has(key)) continue;
                seenArgv.add(key);
                services.push({
                    cmdline: argv.join(' '),
                    argv,
                    cwd:  proc.cwd ?? root,
                    port: pidToPort.get(proc.pid) ?? null,
                });
            }

            const editors = _detectEditors(pd?.processes ?? []);
            return {
                root,
                name:         pd?.name ?? GLib.path_get_basename(root),
                branch:       branchMap.get(root) ?? null,
                processNames: names,
                totalMemKb:   pd?.totalMemKb ?? 0,
                services,
                editors,
            };
        });

        const ports = (portResult?.ports ?? []).map(r => ({
            port:        r.port,
            protocol:    r.protocol,
            processName: r.processName ?? null,
            projectRoot: r.projectRoot ?? null,
            isDevPort:   r.isDevPort,
        }));

        return {
            version:   SNAPSHOT_VERSION,
            label,
            savedAt:   isoNow,
            savedAtMs: now.valueOf(),
            projects,
            ports,
        };
    }

    /**
     * Write JSON data to a file in the snapshot directory.
     * @param {string} filename
     * @param {object} data
     */
    async _writeJson(filename, data) {
        const path = GLib.build_filenamev([this._snapshotDir, filename]);
        const file = Gio.File.new_for_path(path);
        const text = JSON.stringify(data, null, 2);
        const bytes = new TextEncoder().encode(text);

        await new Promise((resolve, reject) => {
            file.replace_contents_bytes_async(
                GLib.Bytes.new(bytes),
                null,   // etag
                false,  // make_backup
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                this._cancellable,
                (_src, res) => {
                    try { file.replace_contents_finish(res); resolve(); }
                    catch (e) { reject(e); }
                }
            );
        });
    }

    /**
     * Remove the oldest snapshot files if we exceed MAX_SNAPSHOTS.
     */
    async _pruneOldSnapshots() {
        const metas = await this.list(); // already sorted newest-first
        const toDelete = metas.slice(MAX_SNAPSHOTS);
        for (const m of toDelete) await this.delete(m.filename);
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Known IDE / editor executables.
 * Maps the process binary name (as seen in /proc/<pid>/cmdline[0] basename)
 * to a canonical short app name and the preferred launch command.
 *
 * The launch command is the binary we re-exec on restore — usually the same
 * as the process name but sometimes a wrapper script has a different name.
 */
const EDITOR_MAP = new Map([
    // VS Code family
    ['code',            { app: 'code',    exec: 'code'    }],
    ['code-oss',        { app: 'code',    exec: 'code-oss'}],
    ['codium',          { app: 'codium',  exec: 'codium'  }],
    // JetBrains family
    ['idea',            { app: 'idea',    exec: 'idea'    }],
    ['idea.sh',         { app: 'idea',    exec: 'idea'    }],
    ['pycharm',         { app: 'pycharm', exec: 'pycharm' }],
    ['pycharm.sh',      { app: 'pycharm', exec: 'pycharm' }],
    ['webstorm',        { app: 'webstorm',exec: 'webstorm'}],
    ['clion',           { app: 'clion',   exec: 'clion'   }],
    ['goland',          { app: 'goland',  exec: 'goland'  }],
    ['rider',           { app: 'rider',   exec: 'rider'   }],
    // Other editors
    ['zed',             { app: 'zed',     exec: 'zed'     }],
    ['zeditor',         { app: 'zed',     exec: 'zed'     }],
    ['sublime_text',    { app: 'sublime', exec: 'subl'    }],
    ['subl',            { app: 'sublime', exec: 'subl'    }],
    ['atom',            { app: 'atom',    exec: 'atom'    }],
    ['gedit',           { app: 'gedit',   exec: 'gedit'   }],
    ['kate',            { app: 'kate',    exec: 'kate'    }],
    ['nvim',            { app: 'nvim',    exec: 'nvim'    }],
    ['vim',             { app: 'vim',     exec: 'vim'     }],
    ['emacs',           { app: 'emacs',   exec: 'emacs'   }],
]);

/**
 * Returns true if `root` looks like a virtual-environment, package-dependency,
 * or IDE-extension data directory — not a real developer project workspace.
 * Used to prevent DevWatch from snapshotting or restoring these directories.
 *
 * @param {string} root  Absolute directory path.
 * @returns {boolean}
 */
function _isNonProjectRoot(root) {
    const p    = root.replace(/\/+$/, '');   // strip trailing slash
    const base = p.split('/').pop() ?? '';   // basename

    // Python virtual environments (venv / .venv / virtualenv)
    if (/^\.?venv$/.test(base) || base === 'virtualenv') return true;

    // Node.js / Python package directories
    if (base === 'node_modules' || base === 'site-packages' || base === '__pycache__') return true;

    // VS Code / Pylance / IDE extension cache directories
    // e.g. ~/.vscode/extensions/ms-python.vscode-pylance-2024.x.x
    if (p.includes('/.vscode/extensions/'))  return true;
    if (p.includes('/.vscode-server/'))      return true;
    if (/\/ms-python\.|\/ms-[a-z]/.test(p)) return true;  // ms-python.*, ms-toolsai.*, etc.
    if (/\/\.MS-Python/.test(p))             return true;

    return false;
}

/**
 * Detect which editors had the project open at snapshot time by inspecting
 * the live process list for that project.
 *
 * Returns an array of unique EditorSnap objects.
 * Only includes editors whose executable can be resolved in $PATH so that
 * restore won't try to launch something that doesn't exist.
 *
 * @param {Array<{ name: string, cmdline: string[] }>} processes
 * @returns {Array<{ app: string, exec: string }>}
 */
function _detectEditors(processes) {
    const seen   = new Set();
    const result = [];

    for (const proc of processes) {
        if (!proc.cmdline || proc.cmdline.length === 0) continue;

        const bin = proc.cmdline[0].replace(/.*\//, ''); // basename
        const ed  = EDITOR_MAP.get(bin);
        if (!ed || seen.has(ed.app)) continue;

        // Verify the executable is actually available before recording it
        const resolvedExec = GLib.find_program_in_path(ed.exec);
        if (!resolvedExec) continue;

        seen.add(ed.app);
        result.push({ app: ed.app, exec: resolvedExec });
    }

    return result;
}

/**
 * Format a Date as "YYYY-MM-DD_HH-MM-SS" for use in filenames.
 * @param {Date} d
 * @returns {string}
 */
function _dateToStamp(d) {
    const pad = n => String(n).padStart(2, '0');
    return [
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`,
    ].join('_');
}

/**
 * Parse a snapshot filename back into a SnapshotMeta object.
 * Expected format: "YYYY-MM-DD_HH-MM-SS_label.json"
 * @param {string} filename
 * @returns {{ filename: string, label: string, savedAt: string } | null}
 */
function _filenameToMeta(filename) {
    // Match: 2026-03-03_14-30-00_some-label.json
    const m = filename.match(
        /^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})_(.+)\.json$/
    );
    if (!m) return null;

    const [, datePart, timePart, label] = m;
    const timeIso = timePart.replace(/-/g, ':');
    const savedAt = `${datePart}T${timeIso}`;

    return { filename, label, savedAt };
}

/**
 * Normalise a process cmdline array into a clean, launchable argv.
 *
 * Returns null for entries that should not be persisted as services:
 *  - kernel threads / empty cmdlines
 *  - bare interactive shells (bash, zsh, sh, fish …)
 *  - gnome-shell itself
 *
 * @param {string[] | null | undefined} cmdline  Raw /proc/<pid>/cmdline tokens
 * @returns {string[] | null}
 */
function _normaliseArgv(cmdline) {
    if (!cmdline || cmdline.length === 0) return null;

    // Strip interpreter paths — keep only the basename for the first token
    const argv = cmdline.map(t => t.trim()).filter(Boolean);
    if (argv.length === 0) return null;

    const bin = argv[0].replace(/.*\//, ''); // basename

    // Skip plain shells with no arguments (interactive terminals)
    const SHELL_BINS  = new Set(['bash', 'sh', 'zsh', 'fish', 'dash', 'tcsh', 'ksh']);
    // Skip system noise that shouldn't be relaunched
    const SYSTEM_BINS = new Set([
        'gnome-shell', 'systemd', 'dbus-daemon', 'Xwayland',
        'gjs', 'gvfsd', 'at-spi-bus-launcher',
    ]);

    if (SYSTEM_BINS.has(bin)) return null;
    if (SHELL_BINS.has(bin) && argv.length === 1) return null;
    // Shell launched with -c "..." or similar — keep it, it runs a real command
    if (SHELL_BINS.has(bin) && argv.length > 1) return argv;

    // Filter VS Code / Electron internal worker sub-processes.
    // These processes are spawned internally by the IDE (renderer, extensionHost,
    // GPU, utility, watchman…) and must never be saved or restored as dev services.
    // They are identified by the --type= flag that Electron attaches to all workers.
    const VSCODE_BINS = new Set(['code', 'code-oss', 'codium', 'electron']);
    if (VSCODE_BINS.has(bin) &&
        argv.some(a => /^--type=/.test(a) || a === '--ms-enable-electron-run-as-node')) {
        return null;
    }

    return argv;
}
