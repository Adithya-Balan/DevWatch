/**
 * DevWatch — Project-Aware Developer Intelligence Layer
 * Main extension entry point (GNOME 45+, ESM)
 *
 * Pillar 1 — fully wired:
 *   • PanelMenu.Button with status dot (green/yellow/red)
 *   • ProjectDetector  — tracks focused window → project root
 *   • ProcessTracker   — scans /proc, groups processes by project
 *   • buildProjectSection — renders live data into the dropdown
 *   • GLib.timeout polling (every 10s) + on-open refresh
 *   • All resources strictly cleaned up in disable()
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { ProjectDetector } from './core/projectDetector.js';
import { ProcessTracker }  from './core/processTracker.js';
import { buildProjectSection } from './ui/projectSection.js';

/** Background poll interval in seconds */
const POLL_INTERVAL_S = 10;

export default class DevWatchExtension extends Extension {
    constructor(metadata) {
        super(metadata);
    }

    enable() {
        // ── Cancellable — shared across all async operations ───────────
        this._cancellable = new Gio.Cancellable();

        // ── Core modules ───────────────────────────────────────────────
        this._projectDetector = new ProjectDetector();
        this._processTracker  = new ProcessTracker();

        this._projectDetector.onProjectChanged(_info => {
            // React immediately when the focused project changes
            this._refresh().catch(e => this._logError(e));
        });

        this._projectDetector.start(this._cancellable);
        this._processTracker.start(this._cancellable);

        // ── Panel Indicator ────────────────────────────────────────────
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);

        const box = new St.BoxLayout({
            style_class: 'devwatch-panel-box',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._statusDot = new St.Label({
            text: '●',
            style_class: 'devwatch-dot devwatch-dot-green',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._panelLabel = new St.Label({
            text: ' DevWatch',
            style_class: 'devwatch-panel-label',
            y_align: Clutter.ActorAlign.CENTER,
        });

        box.add_child(this._statusDot);
        box.add_child(this._panelLabel);
        this._indicator.add_child(box);

        // ── Dropdown skeleton ──────────────────────────────────────────
        this._buildMenuSkeleton();

        // ── Refresh on menu open ───────────────────────────────────────
        this._menuOpenSignalId = this._indicator.menu.connect(
            'open-state-changed',
            (_menu, open) => {
                if (open) this._refresh().catch(e => this._logError(e));
            }
        );

        // ── Background poll ────────────────────────────────────────────
        this._pollId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            POLL_INTERVAL_S,
            () => {
                this._refresh().catch(e => this._logError(e));
                return GLib.SOURCE_CONTINUE;
            }
        );

        // ── Add to panel ───────────────────────────────────────────────
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');

        // Initial data load
        this._refresh().catch(e => this._logError(e));

        console.log('[DevWatch] Enabled — polling every', POLL_INTERVAL_S, 's');
    }

    disable() {
        // Stop polling
        if (this._pollId !== null) {
            GLib.Source.remove(this._pollId);
            this._pollId = null;
        }

        // Disconnect menu signal
        if (this._menuOpenSignalId !== null) {
            this._indicator?.menu?.disconnect(this._menuOpenSignalId);
            this._menuOpenSignalId = null;
        }

        // Stop core modules
        this._projectDetector?.stop();
        this._projectDetector = null;

        this._processTracker?.stop();
        this._processTracker = null;

        // Cancel all in-flight async operations
        this._cancellable?.cancel();
        this._cancellable = null;

        // Destroy the indicator (removes it from the panel + tears down the menu)
        this._indicator?.destroy();
        this._indicator = null;
        this._statusDot = null;
        this._panelLabel = null;

        console.log('[DevWatch] Disabled');
    }

    // ── Private ────────────────────────────────────────────────────────────

    /**
     * Run a full /proc scan and rebuild the Active Projects section.
     * Safe to call from timers and signal handlers.
     */
    async _refresh() {
        if (!this._processTracker) return; // already disabled

        let projectMap;
        try {
            projectMap = await this._processTracker.scan();
        } catch (e) {
            if (this._isCancelled(e)) return;
            this._logError(e);
            return;
        }

        if (!this._indicator) return; // disabled while awaiting

        // Rebuild the projects section
        buildProjectSection(this._indicator.menu, projectMap);

        // Update status dot colour
        this._updateStatusDot(projectMap);
    }

    /**
     * Build the static skeleton of the dropdown (header, separators, footer).
     * The dynamic projects section is injected by buildProjectSection().
     */
    _buildMenuSkeleton() {
        const menu = this._indicator.menu;

        // Header
        const header = new PopupMenu.PopupMenuItem('DevWatch', { reactive: false });
        header.label.style_class = 'devwatch-menu-header';
        menu.addMenuItem(header);

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // The Active Projects section will be inserted here by buildProjectSection()

        // Active Ports placeholder (Pillar 2 — to be implemented)
        const portsTitle = new PopupMenu.PopupMenuItem('ACTIVE PORTS', { reactive: false });
        portsTitle.label.style_class = 'devwatch-section-title';
        portsTitle._devwatchStatic = true;
        menu.addMenuItem(portsTitle);

        const noPorts = new PopupMenu.PopupMenuItem('  Port monitoring coming in Pillar 2', { reactive: false });
        noPorts.label.style_class = 'devwatch-dim';
        menu.addMenuItem(noPorts);

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Footer
        menu.addAction('Refresh Now', () => {
            this._refresh().catch(e => this._logError(e));
        });
    }

    /**
     * Update the panel status dot colour based on current project health.
     *
     * Green  — all clear
     * Yellow — any project exceeds 80% aggregate CPU
     * Red    — any zombie process detected
     *
     * @param {Map<string, object>} projectMap
     */
    _updateStatusDot(projectMap) {
        if (!this._statusDot) return;

        let dotClass = 'devwatch-dot-green';

        if (projectMap && projectMap.size > 0) {
            const hasZombie = [...projectMap.values()].some(p =>
                p.processes.some(proc => proc.state === 'Z')
            );
            const highCpu = [...projectMap.values()].some(p =>
                p.totalCpuPercent > 80
            );

            if (hasZombie)       dotClass = 'devwatch-dot-red';
            else if (highCpu)    dotClass = 'devwatch-dot-yellow';
        }

        this._statusDot.style_class = `devwatch-dot ${dotClass}`;
    }

    /**
     * Log an extension error to GNOME Shell's journal.
     * @param {Error|unknown} e
     */
    _logError(e) {
        if (!this._isCancelled(e))
            console.error('[DevWatch]', e instanceof Error ? e.message : String(e));
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
