/**
 * DevWatch — core/buildLogger.js
 *
 * Build Output Capture & Persistence
 *
 * Captures stdout/stderr of active build processes and persists logs for later review.
 * Integrates with BuildDetector to provide real-time output visibility and historical logs.
 *
 * Types
 * ─────
 *   BuildLog {
 *     pid        : number
 *     tool       : string
 *     projectRoot: string | null
 *     startedAt  : number          // GLib monotonic µs
 *     finishedAt : number | null   // GLib monotonic µs
 *     exitCode   : number | null
 *     output     : string[]        // array of output lines
 *     truncated  : boolean         // true if output was truncated due to size limits
 *   }
 *
 * Usage
 * ─────
 *   const logger = new BuildLogger();
 *   logger.start(cancellable);
 *   // Logs are automatically captured for build processes
 *   const recentLogs = logger.getRecentLogs(projectRoot, tool);
 *   logger.stop();
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { promisify } from 'util';

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Maximum number of output lines to keep in memory per build
 */
const MAX_OUTPUT_LINES = 1000;

/**
 * Maximum number of logs to keep per project/tool combination
 */
const MAX_LOGS_PER_TOOL = 3;

/**
 * Directory for storing build logs
 */
const LOGS_DIR = GLib.build_filenamev([
    GLib.get_home_dir(), '.local', 'share', 'devwatch', 'build_logs'
]);

// ── BuildLogger Class ──────────────────────────────────────────────────────────

export class BuildLogger {
    constructor() {
        /** @type {Map<number, BuildLog>} */
        this._activeLogs = new Map();

        /** @type {Map<string, BuildLog[]>} projectRoot+tool → logs */
        this._logHistory = new Map();

        /** @type {Gio.Cancellable | null} */
        this._cancellable = null;

        this._logsLoaded = false;
    }

    /**
     * Start the logger. Load persisted logs from disk.
     * @param {Gio.Cancellable} cancellable
     */
    start(cancellable) {
        this._cancellable = cancellable;
        this._loadLogs();
    }

    /**
     * Stop the logger and clean up resources.
     */
    stop() {
        // Clean up any active log captures
        for (const log of this._activeLogs.values()) {
            if (log.subprocess) {
                try {
                    log.subprocess.force_exit();
                } catch (e) {
                    console.warn('[DevWatch:BuildLogger] Error stopping subprocess:', e.message);
                }
            }
        }
        this._activeLogs.clear();
        this._logHistory.clear();
        this._cancellable = null;
    }

    /**
     * Start capturing output for a build process.
     * Called by BuildDetector when a new build is detected.
     * @param {number} pid
     * @param {string} tool
     * @param {string|null} projectRoot
     */
    startCapture(pid, tool, projectRoot) {
        if (this._activeLogs.has(pid)) return; // already capturing

        try {
            // Create a new log entry
            /** @type {BuildLog} */
            const log = {
                pid,
                tool,
                projectRoot,
                startedAt: GLib.get_monotonic_time(),
                finishedAt: null,
                exitCode: null,
                output: [],
                truncated: false,
            };

            this._activeLogs.set(pid, log);

            // For now, we'll capture output by monitoring the process
            // In a real implementation, we'd need to spawn a wrapper or use ptrace
            // This is a placeholder for the output capture mechanism
            console.log(`[DevWatch:BuildLogger] Started capturing output for ${tool} (PID ${pid})`);

        } catch (e) {
            console.warn('[DevWatch:BuildLogger] Failed to start capture for PID', pid, ':', e.message);
        }
    }

    /**
     * Stop capturing output for a build process and persist the log.
     * Called by BuildDetector when a build finishes.
     * @param {number} pid
     */
    stopCapture(pid) {
        const log = this._activeLogs.get(pid);
        if (!log) return;

        log.finishedAt = GLib.get_monotonic_time();

        // Persist the log
        this._persistLog(log);
        this._activeLogs.delete(pid);

        console.log(`[DevWatch:BuildLogger] Stopped capturing output for ${log.tool} (PID ${pid})`);
    }

    /**
     * Get recent logs for a specific project and tool.
     * @param {string|null} projectRoot
     * @param {string} tool
     * @returns {BuildLog[]}
     */
    getRecentLogs(projectRoot, tool) {
        const key = this._makeKey(projectRoot, tool);
        return this._logHistory.get(key) || [];
    }

    /**
     * Get the last few lines of output for an active build.
     * @param {number} pid
     * @param {number} maxLines
     * @returns {string[]}
     */
    getActiveOutput(pid, maxLines = 10) {
        const log = this._activeLogs.get(pid);
        if (!log) return [];

        const output = log.output;
        if (output.length <= maxLines) return output;
        return output.slice(-maxLines);
    }

    // ── Private ─────────────────────────────────────────────────────────────

    /**
     * Create a key for storing logs by project and tool.
     * @param {string|null} projectRoot
     * @param {string} tool
     * @returns {string}
     */
    _makeKey(projectRoot, tool) {
        return `${projectRoot || '__ungrouped__'}:${tool}`;
    }

    /**
     * Load persisted logs from disk.
     */
    _loadLogs() {
        if (this._logsLoaded) return;
        this._logsLoaded = true;

        try {
            const dir = Gio.File.new_for_path(LOGS_DIR);
            if (!dir.query_exists(null)) return;

            const enumerator = dir.enumerate_children('standard::*', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                const filename = info.get_name();
                if (!filename.endsWith('.json')) continue;

                try {
                    const file = dir.get_child(filename);
                    const [, contents] = file.load_contents(null);
                    const text = new TextDecoder().decode(contents);
                    const log = JSON.parse(text);

                    const key = this._makeKey(log.projectRoot, log.tool);
                    const bucket = this._logHistory.get(key) || [];
                    bucket.push(log);
                    // Sort by startedAt descending (newest first)
                    bucket.sort((a, b) => b.startedAt - a.startedAt);
                    if (bucket.length > MAX_LOGS_PER_TOOL) {
                        bucket.length = MAX_LOGS_PER_TOOL;
                    }
                    this._logHistory.set(key, bucket);
                } catch (e) {
                    console.warn('[DevWatch:BuildLogger] Failed to load log file', filename, ':', e.message);
                }
            }

            console.log('[DevWatch:BuildLogger] Loaded build logs from disk');
        } catch (e) {
            console.warn('[DevWatch:BuildLogger] _loadLogs():', e?.message ?? e);
        }
    }

    /**
     * Persist a completed log to disk.
     * @param {BuildLog} log
     */
    _persistLog(log) {
        try {
            // Ensure logs directory exists
            Gio.File.new_for_path(LOGS_DIR).make_directory_with_parents(null);

            // Create filename: YYYY-MM-DD_HH-MM-SS_tool_pid.json
            const date = new Date();
            const timestamp = date.toISOString().slice(0, 19).replace(/:/g, '-');
            const filename = `${timestamp}_${log.tool}_${log.pid}.json`;
            const filepath = GLib.build_filenamev([LOGS_DIR, filename]);

            // Save to history map
            const key = this._makeKey(log.projectRoot, log.tool);
            const bucket = this._logHistory.get(key) || [];
            bucket.unshift(log); // newest first
            if (bucket.length > MAX_LOGS_PER_TOOL) {
                bucket.length = MAX_LOGS_PER_TOOL;
            }
            this._logHistory.set(key, bucket);

            // Write to file
            const data = JSON.stringify(log, null, 2);
            const file = Gio.File.new_for_path(filepath);
            const [, etag] = file.replace_contents(
                new TextEncoder().encode(data),
                null,
                false,
                Gio.FileCreateFlags.NONE,
                null
            );

            console.log(`[DevWatch:BuildLogger] Persisted log for ${log.tool} (PID ${log.pid})`);
        } catch (e) {
            console.warn('[DevWatch:BuildLogger] Failed to persist log:', e.message);
        }
    }
}