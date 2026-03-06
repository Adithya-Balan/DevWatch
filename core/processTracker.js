/**
 * DevWatch — core/processTracker.js
 *
 * Scans /proc to build a project-grouped view of all running user processes.
 *
 * For each detected process:
 *   - Reads cmdline, status (Name, VmRSS, PPid, State), stat (CPU jiffies)
 *   - Resolves the process CWD to a project root (via cached git lookup)
 *   - Computes CPU % usage between consecutive scans
 *
 * Grouping strategy:
 *   A process belongs to a project if its CWD (or any ancestor) is the root
 *   of a git repository or contains a known project marker file.
 *   A fast cwd→projectRoot cache avoids redundant `git` invocations.
 *
 * Usage
 * ─────
 *   const tracker = new ProcessTracker();
 *   tracker.start(cancellable);
 *   const projects = await tracker.scan();
 *   // projects: Map<root, ProjectData>
 *   tracker.stop();
 *
 * Types
 * ─────
 *   ProcessInfo  { pid, name, cmdline, cwd, state, memKb, cpuPercent }
 *   ProjectData  { root, name, processes, totalCpuPercent, totalMemKb }
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { execCommunicate } from '../utils/subprocess.js';
import {
    listPids,
    readProcCmdline,
    readProcStatus,
    parseProcStatusField,
    readProcStat,
    readProcCwd,
    readProcExe,
} from '../utils/procReader.js';

// ── Constants ──────────────────────────────────────────────────────────────────

/** Kernel jiffies per second (standard Linux HZ=100) */
const JIFFIES_PER_SEC = 100;

/** Skip PIDs below this — kernel threads live here. */
const MIN_USER_PID = 2;

/** Known project marker files (same list as projectDetector for consistency). */
const PROJECT_MARKERS = [
    '.git', 'package.json', 'Cargo.toml', 'go.mod',
    'pyproject.toml', 'setup.py', 'pom.xml', 'build.gradle',
    'Makefile', 'CMakeLists.txt', 'composer.json', 'Gemfile',
];

/** Directories that can never be a project root. */
const ROOT_STOP_DIRS = new Set(['/', '/home', '/usr', '/opt', '/tmp', '/var']);

/** Max cached CWD entries (bounded to avoid unbounded memory growth). */
const CWD_CACHE_MAX = 512;

// ─────────────────────────────────────────────────────────────────────────────

export class ProcessTracker {
    constructor() {
        /** @type {Gio.Cancellable|null} */
        this._cancellable = null;

        /**
         * CWD → project root cache.
         * Maps an absolute directory path to its detected project root, or
         * null if the directory doesn't belong to any project.
         * @type {Map<string, string|null>}
         */
        this._cwdCache = new Map();

        /**
         * Per-PID previous CPU jiffies for delta calculation.
         * @type {Map<number, number>}
         */
        this._prevPidJiffies = new Map();

        /**
         * Fast pid → projectRoot index, rebuilt on each scan().
         * Used by PortMonitor.getProjectRootForPid() without extra git calls.
         * @type {Map<number, string>}
         */
        this._pidProjectIndex = new Map();

        /**
         * Previous total system CPU jiffies (from /proc/stat).
         * @type {number}
         */
        this._prevTotalJiffies = 0;

        /** Number of logical CPU cores (for CPU % normalisation). */
        this._numCpus = this._readNumCpus();
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /** @param {Gio.Cancellable} cancellable */
    start(cancellable) {
        this._cancellable = cancellable;
    }

    stop() {
        this._cancellable = null;
        this._cwdCache.clear();
        this._prevPidJiffies.clear();
        this._prevTotalJiffies = 0;
        this._pidProjectIndex.clear();
    }

    /**
     * Look up a project root for a given PID using the CWD cache populated
     * during the last scan(). Used by PortMonitor for port→project mapping
     * without triggering additional git calls.
     *
     * @param {number} pid
     * @returns {string|null}
     */
    getProjectRootForPid(pid) {
        // We need the cwd for this pid from the last scan.
        // Store a pid→projectRoot index alongside the cwd cache.
        return this._pidProjectIndex?.get(pid) ?? null;
    }

    /**
     * Perform a full /proc scan and return a project-grouped process map.
     *
     * @returns {Promise<Map<string, ProjectData>>}
     *   Key = project root path.  Value = ProjectData object.
     */
    async scan() {
        const pids = await listPids();

        // Read total system CPU jiffies first (for delta denominator)
        const totalJiffies = this._readTotalCpuJiffies();

        // Process all PIDs concurrently — I/O-free (sync /proc reads are fast)
        const rawProcesses = [];
        for (const pid of pids) {
            if (pid < MIN_USER_PID) continue;
            const info = this._readProcessInfo(pid);
            if (info) rawProcesses.push(info);
        }

        // Compute CPU % using jiffies delta
        const jiffiesDelta = Math.max(totalJiffies - this._prevTotalJiffies, 1);
        this._prevTotalJiffies = totalJiffies;

        for (const proc of rawProcesses) {
            const prev = this._prevPidJiffies.get(proc.pid) ?? proc._rawJiffies;
            const delta = Math.max(proc._rawJiffies - prev, 0);
            proc.cpuPercent = Math.min(
                (delta / jiffiesDelta) * this._numCpus * 100,
                100 * this._numCpus
            );
            proc.cpuPercent = Math.round(proc.cpuPercent * 10) / 10;
            this._prevPidJiffies.set(proc.pid, proc._rawJiffies);
        }

        // Prune jiffies cache for PIDs that no longer exist
        const livePidSet = new Set(rawProcesses.map(p => p.pid));
        for (const pid of this._prevPidJiffies.keys()) {
            if (!livePidSet.has(pid)) this._prevPidJiffies.delete(pid);
        }

        // Resolve each process's CWD to a project root (async, cached)
        await this._resolveProjectRoots(rawProcesses);

        // Rebuild the pid→projectRoot index for PortMonitor
        this._pidProjectIndex.clear();
        for (const proc of rawProcesses) {
            if (proc.projectRoot)
                this._pidProjectIndex.set(proc.pid, proc.projectRoot);
        }

        // Group by project root
        /** @type {Map<string, ProjectData>} */
        const projectMap = new Map();

        for (const proc of rawProcesses) {
            if (!proc.projectRoot) continue; // not associated with a project

            if (!projectMap.has(proc.projectRoot)) {
                projectMap.set(proc.projectRoot, {
                    root:            proc.projectRoot,
                    name:            GLib.path_get_basename(proc.projectRoot),
                    processes:       [],
                    totalCpuPercent: 0,
                    totalMemKb:      0,
                });
            }

            const project = projectMap.get(proc.projectRoot);
            project.processes.push(proc);
            project.totalCpuPercent += proc.cpuPercent;
            project.totalMemKb      += proc.memKb;
        }

        // Round aggregate CPU
        for (const proj of projectMap.values()) {
            proj.totalCpuPercent = Math.round(proj.totalCpuPercent * 10) / 10;
        }

        return projectMap;
    }

    // ── Process reading ─────────────────────────────────────────────────────

    /**
     * Read all relevant fields for a single PID from /proc.
     * Returns null if the process has already exited.
     *
     * @param {number} pid
     * @returns {ProcessInfo|null}
     */
    _readProcessInfo(pid) {
        const statusMap = readProcStatus(pid);
        if (!statusMap) return null;

        const name    = parseProcStatusField(statusMap, 'Name') ?? `[${pid}]`;
        const ppid    = parseInt(parseProcStatusField(statusMap, 'PPid') ?? '0', 10);
        const state   = parseProcStatusField(statusMap, 'State')?.charAt(0) ?? '?';
        const vmRssStr = parseProcStatusField(statusMap, 'VmRSS') ?? '0 kB';
        const memKb   = parseInt(vmRssStr, 10) || 0;

        // Skip pure kernel threads (no cmdline)
        const cmdline = readProcCmdline(pid);
        if (!cmdline || cmdline.length === 0) return null;

        const statFields = readProcStat(pid);
        const utime = statFields ? parseInt(statFields[13], 10) || 0 : 0;
        const stime = statFields ? parseInt(statFields[14], 10) || 0 : 0;

        const cwd = readProcCwd(pid); // may be null for short-lived processes
        const exe = readProcExe(pid); // resolved binary path (follows venv/nvm symlinks)

        return {
            pid,
            name,
            ppid,
            cmdline,
            cwd:          cwd ?? '',
            exe:          exe ?? null,
            state,
            memKb,
            cpuPercent:   0,           // filled in after delta calculation
            projectRoot:  null,        // filled in by _resolveProjectRoots
            _rawJiffies:  utime + stime,
        };
    }

    // ── Project root resolution (cached) ────────────────────────────────────

    /**
     * Fill `proc.projectRoot` for all processes in `rawProcesses`.
     * Uses a persistent cache to avoid re-running git for known CWDs.
     *
     * @param {ProcessInfo[]} rawProcesses
     */
    async _resolveProjectRoots(rawProcesses) {
        // Collect unique CWDs not yet in cache
        const unknownCwds = new Set();
        for (const proc of rawProcesses) {
            if (proc.cwd && !this._cwdCache.has(proc.cwd)) {
                unknownCwds.add(proc.cwd);
            }
        }

        // Resolve unknown CWDs — batch git calls (one per unique cwd)
        const resolvePromises = [];
        for (const cwd of unknownCwds) {
            resolvePromises.push(
                this._resolveOneCwd(cwd).then(root => {
                    // Evict oldest if cache is full
                    if (this._cwdCache.size >= CWD_CACHE_MAX) {
                        const firstKey = this._cwdCache.keys().next().value;
                        this._cwdCache.delete(firstKey);
                    }
                    this._cwdCache.set(cwd, root);
                })
            );
        }

        if (resolvePromises.length > 0) {
            await Promise.allSettled(resolvePromises);
        }

        // Assign cached roots to each process
        for (const proc of rawProcesses) {
            if (proc.cwd) {
                proc.projectRoot = this._cwdCache.get(proc.cwd) ?? null;
            }
        }
    }

    /**
     * Determine the project root for a given working directory.
     * Tries git first, then marker walk.
     *
     * @param {string} cwd
     * @returns {Promise<string|null>}
     */
    async _resolveOneCwd(cwd) {
        if (!cwd || cwd === '') return null;

        // Strategy 1: git
        try {
            const root = await execCommunicate(
                ['git', '-C', cwd, 'rev-parse', '--show-toplevel'],
                this._cancellable
            );
            if (root) return root;
        } catch (_e) {
            // Not a git repo — try markers
        }

        // Strategy 2: marker walk
        return this._markerWalk(cwd);
    }

    /**
     * Walk up directory tree looking for project marker files.
     * @param {string} startDir
     * @returns {string|null}
     */
    _markerWalk(startDir) {
        let dir = startDir;
        while (dir && !ROOT_STOP_DIRS.has(dir)) {
            for (const marker of PROJECT_MARKERS) {
                const path = GLib.build_filenamev([dir, marker]);
                if (GLib.file_test(path, GLib.FileTest.EXISTS)) return dir;
            }
            const parent = GLib.path_get_dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
        return null;
    }

    // ── System CPU helper ───────────────────────────────────────────────────

    /**
     * Read /proc/stat and sum all CPU jiffies (user + nice + system + idle + ...).
     * Used as the denominator for per-process CPU % calculation.
     *
     * @returns {number}
     */
    _readTotalCpuJiffies() {
        try {
            const file = Gio.File.new_for_path('/proc/stat');
            const [ok, contents] = file.load_contents(null);
            if (!ok) return this._prevTotalJiffies;

            const text = new TextDecoder('utf-8').decode(contents);
            const cpuLine = text.split('\n').find(l => l.startsWith('cpu '));
            if (!cpuLine) return this._prevTotalJiffies;

            const values = cpuLine.trim().split(/\s+/).slice(1).map(Number);
            return values.reduce((sum, v) => sum + v, 0);
        } catch (_e) {
            return this._prevTotalJiffies;
        }
    }

    /**
     * Count logical CPUs from /proc/cpuinfo.
     * @returns {number}
     */
    _readNumCpus() {
        try {
            const file = Gio.File.new_for_path('/proc/cpuinfo');
            const [ok, contents] = file.load_contents(null);
            if (!ok) return 1;
            const text = new TextDecoder('utf-8').decode(contents);
            return (text.match(/^processor\s*:/gm) ?? []).length || 1;
        } catch (_e) {
            return 1;
        }
    }
}

/**
 * @typedef {Object} ProcessInfo
 * @property {number}   pid
 * @property {string}   name          Short process name (from /proc/pid/status)
 * @property {number}   ppid
 * @property {string[]} cmdline       Full argv array
 * @property {string}   cwd           Process working directory
 * @property {string}   state         Single char: R S D Z T etc.
 * @property {number}   memKb         Resident set size in kilobytes
 * @property {number}   cpuPercent    CPU usage 0–100 (or >100 on multi-core)
 * @property {string|null} projectRoot Detected project root, or null
 */

/**
 * @typedef {Object} ProjectData
 * @property {string}        root             Absolute project root path
 * @property {string}        name             Basename of root (display name)
 * @property {ProcessInfo[]} processes        All processes attributed to this project
 * @property {number}        totalCpuPercent  Sum of per-process CPU %
 * @property {number}        totalMemKb       Sum of per-process RSS
 */
