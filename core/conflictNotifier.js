/**
 * ConflictNotifier — fires GNOME shell notifications when a dev port is
 * newly occupied, avoiding duplicate alerts for the same (protocol, port, pid)
 * triple across polling cycles.
 *
 * Uses Main.notify(title, body) — the reliable, action-less notification API
 * that every installed GNOME Shell 45+ extension uses.  Richer action-button
 * notifications (via MessageTray.Source) are intentionally deferred to a later
 * step once the exact GNOME 49 constructor signatures can be confirmed.
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class ConflictNotifier {
    constructor() {
        /**
         * Already-notified keys: "proto:port:pid"
         * Cleared when the owning process disappears so the notification fires
         * again if a *different* process later grabs the same port.
         * @type {Set<string>}
         */
        this._notified = new Set();
    }

    /**
     * Fire notifications for each newly seen dev port.
     * Safe to call with an empty array — it becomes a no-op.
     *
     * @param {import('./portMonitor.js').PortRecord[]} newPorts
     *   Ports that were absent in the previous scan cycle and are now present.
     */
    notify(newPorts) {
        for (const rec of newPorts) {
            if (!rec.isDevPort) continue; // only notify for recognised dev ports

            const key = `${rec.protocol}:${rec.port}:${rec.pid}`;
            if (this._notified.has(key)) continue; // already shown
            this._notified.add(key);

            const title = `DevWatch: Port ${rec.port} occupied`;
            const projPart = rec.projectRoot
                ? ` · ${rec.projectRoot.split('/').pop()}`
                : '';
            const body = `${rec.processName} (PID ${rec.pid})${projPart}`;

            try {
                Main.notify(title, body);
                console.log(`[DevWatch:ConflictNotifier] Notified: ${title} — ${body}`);
            } catch (e) {
                console.warn('[DevWatch:ConflictNotifier] Main.notify failed:', e?.message ?? e);
            }
        }
    }

    /**
     * Remove keys for PIDs that no longer exist so the notification can fire
     * again when a new process reclaims the same port.
     *
     * @param {Set<number>} activePids  Set of all currently live PIDs.
     */
    pruneNotified(activePids) {
        for (const key of this._notified) {
            const pid = Number(key.split(':')[2]);
            if (!activePids.has(pid)) this._notified.delete(key);
        }
    }

    /** Release all state. */
    destroy() {
        this._notified.clear();
    }
}
