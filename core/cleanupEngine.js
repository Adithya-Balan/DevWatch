/**
 * DevWatch — core/cleanupEngine.js
 *
 * Pillar 3 — Dev Environment Cleanup Engine
 *
 * Analyses the process map produced by ProcessTracker and identifies
 * processes that are safe (or recommended) candidates for termination:
 *
 *   ZOMBIE   — state 'Z'; the process is already dead, only the PID table
 *              entry remains.  Parent should reap it; we surface it visibly.
 *
 *   ORPHAN   — a well-known dev tool (node, python, cargo, …) that has lost
 *              its parent (PPID points to PID 1 or a non-existent process)
 *              AND whose CWD cannot be mapped to any active project.
 *
 *   IDLE_DEV — a long-running dev process that has been at ~0 % CPU for
 *              more than IDLE_THRESHOLD_MS without any network port binding.
 *              Typical case: a `nodemon` watch server for an old project that
 *              was never stopped after development ended.
 *
 * Types
 * ─────
 *   CleanupCandidate {
 *     pid        : number
 *     name       : string
 *     reason     : 'zombie' | 'orphan' | 'idle_dev'
 *     detail     : string        ← human-readable one-liner
 *     projectRoot: string | null ← null when no project is detectable
 *     memKb      : number
 *     cpuPercent : number
 *   }
 *
 *   CleanupResult {
 *     candidates : CleanupCandidate[]
 *     scannedAt  : number          ← GLib.get_monotonic_time() snapshot
 *   }
 *
 * Usage
 * ─────
 *   const engine = new CleanupEngine();
 *   const result = engine.analyse(projectMap, allPids);
 *   // result.candidates — array ready for ui/cleanupSection to render
 */

import GLib from 'gi://GLib';

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Dev-tool process names we care about when checking for orphans / idle devs.
 * Lowercase, matched against proc.name.toLowerCase().
 */
const DEV_TOOL_NAMES = new Set([
    'node', 'nodemon', 'ts-node', 'bun',
    'python', 'python3', 'uvicorn', 'gunicorn', 'flask', 'fastapi',
    'ruby', 'rails', 'puma', 'unicorn',
    'cargo', 'rustc',
    'go', 'air',               // Go + air hot-reload
    'java', 'mvn', 'gradle',
    'php', 'artisan',
    'webpack', 'vite', 'esbuild', 'rollup', 'parcel',
    'tsc', 'eslint', 'jest', 'mocha', 'vitest', 'pytest',
    'redis-server', 'mongod', 'mysqld', 'postgres', 'pg_ctl',
    'nginx', 'caddy',
    'docker-compose', 'docker', 'podman',
    'make', 'cmake',
]);

/**
 * Milliseconds of near-zero CPU before a dev process is considered idle.
 * Default: 10 minutes.
 */
const IDLE_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * CPU % below which a process is considered idle (accounts for measurement
 * noise at low poll intervals).
 */
const IDLE_CPU_THRESHOLD = 0.5;

// ─────────────────────────────────────────────────────────────────────────────

export class CleanupEngine {
    constructor() {
        /**
         * Per-PID first-seen-idle timestamp (GLib monotonic µs).
         * Set when a process first falls below IDLE_CPU_THRESHOLD.
         * Cleared if the process becomes active again.
         * @type {Map<number, number>}
         */
        this._idleSince = new Map();

        /**
         * Set of PIDs that currently own at least one listening port.
         * Updated each time analyse() is called with a portPids argument.
         * @type {Set<number>}
         */
        this._portOwners = new Set();
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /**
     * Analyse the current process landscape and return cleanup candidates.
     *
     * @param {Map<string, import('./processTracker.js').ProjectData>} projectMap
     *   Fresh output from ProcessTracker.scan().
     *
     * @param {Set<number>} [portPids]
     *   Optional set of PIDs that own a currently-bound listening port.
     *   Processes in this set are exempt from IDLE_DEV classification.
     *
     * @returns {import('./cleanupEngine.js').CleanupResult}
     */
    analyse(projectMap, portPids = new Set()) {
        this._portOwners = portPids;

        /** @type {CleanupCandidate[]} */
        const candidates = [];

        // Build a quick set of all known project roots so we can test
        // whether an unrooted process is truly "orphaned" from projects.
        const knownRoots = new Set(projectMap.keys());

        // Flatten all processes out of the project map
        const now = GLib.get_monotonic_time(); // µs
        const allProcs = [...projectMap.values()].flatMap(p => p.processes);

        // Also collect PIDs of all live processes for orphan PPID checks
        const livePids = new Set(allProcs.map(p => p.pid));

        for (const proc of allProcs) {
            // ── Zombie ───────────────────────────────────────────────────────
            if (proc.state === 'Z') {
                candidates.push({
                    pid:         proc.pid,
                    name:        proc.name,
                    reason:      'zombie',
                    detail:      'Zombie — process exited but was not reaped by its parent',
                    projectRoot: proc.projectRoot ?? null,
                    memKb:       proc.memKb,
                    cpuPercent:  proc.cpuPercent,
                });
                continue; // no need for further checks on a zombie
            }

            const isDevTool = DEV_TOOL_NAMES.has(proc.name.toLowerCase());

            // ── Orphan ───────────────────────────────────────────────────────
            // A dev tool whose parent is PID 1 (init/systemd) or a dead PID
            // AND that has no resolved project root.
            if (isDevTool && !proc.projectRoot) {
                const parentDead = proc.ppid <= 1 || !livePids.has(proc.ppid);
                if (parentDead) {
                    candidates.push({
                        pid:         proc.pid,
                        name:        proc.name,
                        reason:      'orphan',
                        detail:      `Orphan — no project root; parent PID ${proc.ppid} is ${proc.ppid <= 1 ? 'init/systemd' : 'gone'}`,
                        projectRoot: null,
                        memKb:       proc.memKb,
                        cpuPercent:  proc.cpuPercent,
                    });
                    continue;
                }
            }

            // ── Idle dev process ─────────────────────────────────────────────
            // A dev tool that has been at near-zero CPU for IDLE_THRESHOLD_MS
            // and does NOT own an active listening port.
            if (isDevTool && !portPids.has(proc.pid)) {
                if (proc.cpuPercent < IDLE_CPU_THRESHOLD) {
                    // Record first idle moment
                    if (!this._idleSince.has(proc.pid)) {
                        this._idleSince.set(proc.pid, now);
                    }

                    const idleMs = (now - this._idleSince.get(proc.pid)) / 1000;
                    if (idleMs >= IDLE_THRESHOLD_MS) {
                        const idleMin = Math.round(idleMs / 60_000);
                        candidates.push({
                            pid:         proc.pid,
                            name:        proc.name,
                            reason:      'idle_dev',
                            detail:      `Idle dev tool — ${idleMin} min at <${IDLE_CPU_THRESHOLD}% CPU, no open ports`,
                            projectRoot: proc.projectRoot ?? null,
                            memKb:       proc.memKb,
                            cpuPercent:  proc.cpuPercent,
                        });
                    }
                } else {
                    // Process became active again — reset idle timer
                    this._idleSince.delete(proc.pid);
                }
            }
        }

        // Prune idle-since entries for PIDs that no longer exist
        for (const pid of this._idleSince.keys()) {
            if (!livePids.has(pid)) this._idleSince.delete(pid);
        }

        // Sort: zombies first, then orphans, then idle_dev; within group by memKb desc
        const ORDER = { zombie: 0, orphan: 1, idle_dev: 2 };
        candidates.sort((a, b) =>
            ORDER[a.reason] - ORDER[b.reason] || b.memKb - a.memKb
        );

        return {
            candidates,
            scannedAt: now,
        };
    }

    /** Release all state. */
    destroy() {
        this._idleSince.clear();
        this._portOwners.clear();
    }
}
