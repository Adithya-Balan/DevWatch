/**
 * DevWatch — core/portMonitor.js
 *
 * Monitors listening TCP/UDP ports using `ss -Htulnp` and maintains
 * a snapshot for conflict detection between polls.
 *
 * Port → Project mapping
 * ──────────────────────
 * Each PortRecord has a `pid` field. ProcessTracker is passed in at
 * scan() time so that mapping pid → projectRoot happens inline, without
 * a separate pass. This keeps the two modules independent.
 *
 * Conflict detection
 * ──────────────────
 * The monitor remembers the port set from the previous scan. Any port
 * that is newly occupied fires a 'conflict' entry in the result so the
 * extension can show a GNOME notification.
 *
 * Exports
 * ───────
 *   PortMonitor class
 *     start(cancellable)
 *     stop()
 *     scan(processTracker?)  → Promise<PortScanResult>
 *
 * Types
 * ─────
 *   PortRecord   { port, protocol, address, pid, processName, projectRoot, runtimeMs }
 *   PortScanResult { ports: PortRecord[], newPorts: PortRecord[] }
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { execLines } from '../utils/subprocess.js';

// ── Well-known developer ports — used to highlight relevant entries ──────────
export const DEV_PORTS = new Set([
    80, 443,
    3000, 3001, 3002, 3003,
    4000, 4200,
    5000, 5001,
    5173,          // Vite
    8000, 8080, 8081, 8888,
    9000, 9090,
    4173,          // Vite preview
    6006,          // Storybook
    5432,          // PostgreSQL
    3306,          // MySQL / MariaDB
    6379,          // Redis
    27017,         // MongoDB
    9200, 9300,    // Elasticsearch
    6443, 8001,    // Kubernetes API
    2375, 2376,    // Docker daemon
]);

// Regex to parse one line of `ss -Htulnp` output
// Format: <netid> <state> <recv-q> <send-q> <local addr:port> <peer addr:port> [users:(...)]
//
// Local address variants:
//   0.0.0.0:3000        (IPv4)
//   127.0.0.1:5432      (IPv4 loopback)
//   *:3000              (wildcard)
//   [::]:3000           (IPv6 wildcard)
//   [::1]:631           (IPv6 loopback)
//   127.0.0.53%lo:53    (IPv4 with interface suffix)
const SS_LINE_RE =
    /^(tcp|udp)\s+\S+\s+\d+\s+\d+\s+(\S+):(\d+)\s+\S+(?:\s+users:\(\(("([^"]+)",pid=(\d+),fd=\d+)[^)]*\)\))?/;

// ─────────────────────────────────────────────────────────────────────────────

export class PortMonitor {
    constructor() {
        /** @type {Gio.Cancellable|null} */
        this._cancellable = null;

        /**
         * Port numbers seen in the previous scan.
         * Used to detect newly occupied ports.
         * Key = `${protocol}:${port}`, Value = PortRecord
         * @type {Map<string, PortRecord>}
         */
        this._prevPorts = new Map();

        /**
         * Per-port first-seen timestamp (GLib.get_monotonic_time, microseconds).
         * Preserved across scans to calculate runtime.
         * Key = `${protocol}:${port}:${pid}`
         * @type {Map<string, number>}
         */
        this._firstSeen = new Map();
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /** @param {Gio.Cancellable} cancellable */
    start(cancellable) {
        this._cancellable = cancellable;
    }

    stop() {
        this._cancellable = null;
        this._prevPorts.clear();
        this._firstSeen.clear();
    }

    /**
     * Run `ss -Htulnp`, parse all listening ports, resolve project roots,
     * and compute newly-appeared ports since last scan.
     *
     * @param {import('./processTracker.js').ProcessTracker|null} processTracker
     *   When provided, each port's pid is mapped to its project root via
     *   processTracker's CWD cache (fast, no additional git calls).
     *
     * @returns {Promise<PortScanResult>}
     */
    async scan(processTracker = null) {
        let lines;
        try {
            lines = await execLines(['ss', '-Htulnp'], this._cancellable);
        } catch (e) {
            if (this._isCancelled(e)) return { ports: [], newPorts: [] };
            console.error('[DevWatch] PortMonitor: ss command failed:', e.message);
            return { ports: [], newPorts: [] };
        }

        const now = GLib.get_monotonic_time(); // microseconds
        const currentPorts = new Map();

        for (const line of lines) {
            const record = this._parseLine(line, now, processTracker);
            if (!record) continue;

            const key = `${record.protocol}:${record.port}`;
            // If multiple processes share a port-key, keep the one with a pid
            if (!currentPorts.has(key) || record.pid) {
                currentPorts.set(key, record);
            }
        }

        // Detect newly occupied ports (present now, absent before)
        const newPorts = [];
        for (const [key, record] of currentPorts) {
            if (!this._prevPorts.has(key)) {
                newPorts.push(record);
            }
        }

        // Prune firstSeen entries for ports that have gone away
        for (const key of this._firstSeen.keys()) {
            const portKey = key.split(':').slice(0, 2).join(':');
            if (!currentPorts.has(portKey)) {
                this._firstSeen.delete(key);
            }
        }

        this._prevPorts = currentPorts;

        return {
            ports:    [...currentPorts.values()].sort((a, b) => a.port - b.port),
            newPorts,
        };
    }

    // ── Parsing ─────────────────────────────────────────────────────────────

    /**
     * Parse one line from `ss -Htulnp` into a PortRecord.
     *
     * @param {string} line
     * @param {number} now   GLib monotonic time in microseconds
     * @param {import('./processTracker.js').ProcessTracker|null} tracker
     * @returns {PortRecord|null}
     */
    _parseLine(line, now, tracker) {
        const m = SS_LINE_RE.exec(line);
        if (!m) return null;

        const protocol    = m[1];
        const address     = m[2];
        const port        = parseInt(m[3], 10);
        const processName = m[5] ?? null;
        const pid         = m[6] ? parseInt(m[6], 10) : null;

        if (isNaN(port) || port <= 0) return null;

        // Track first-seen time for runtime calculation
        const seenKey = `${protocol}:${port}:${pid ?? 0}`;
        if (!this._firstSeen.has(seenKey)) {
            this._firstSeen.set(seenKey, now);
        }
        const firstSeen = this._firstSeen.get(seenKey);
        const runtimeMs = Math.floor((now - firstSeen) / 1000); // µs → ms

        // Resolve project root from process tracker's cache if available
        let projectRoot = null;
        if (pid && tracker) {
            projectRoot = tracker.getProjectRootForPid(pid) ?? null;
        }

        return {
            protocol,
            port,
            address,
            pid,
            processName,
            projectRoot,
            runtimeMs,
            isDevPort: DEV_PORTS.has(port),
        };
    }

    /**
     * @param {unknown} e
     * @returns {boolean}
     */
    _isCancelled(e) {
        return (
            e instanceof Error &&
            (e.message?.includes('Operation was cancelled') ||
             e.message?.includes('CANCELLED'))
        );
    }
}

/**
 * @typedef {Object} PortRecord
 * @property {string}      protocol      'tcp' or 'udp'
 * @property {number}      port          Port number
 * @property {string}      address       Listening address (e.g. '0.0.0.0', '127.0.0.1', '*')
 * @property {number|null} pid           Owning PID, or null if no process info
 * @property {string|null} processName   Short process name from ss output
 * @property {string|null} projectRoot   Resolved project root, or null
 * @property {number}      runtimeMs     Milliseconds since this port was first observed
 * @property {boolean}     isDevPort     True if port is in the well-known dev ports set
 */

/**
 * @typedef {Object} PortScanResult
 * @property {PortRecord[]} ports     All currently listening ports, sorted by number
 * @property {PortRecord[]} newPorts  Ports that appeared since the previous scan
 */
