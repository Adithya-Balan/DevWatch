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
 *
 * Pillar 2 — fully wired:
 *   • PortMonitor     — ss -tulnp, dev-port set, runtime tracking
 *   • ConflictNotifier — Main.notify on newly occupied dev ports
 *   • buildPortSection — Kill / Copy PID per port row
 *
 * Pillar 3 — fully wired:
 *   • Status dot: red on zombie OR port conflict, yellow on orphan/idle/highCPU
 *
 * Pillar 4 — fully wired:
 *   • SnapshotManager  — save/list/load/restore/delete session JSON
 *   • buildSnapshotSection — Save Now, Restore, Delete per snapshot row
 *
 * Pillar 5 — fully wired:
 *   • BuildDetector    — active build tracking + persisted run history
 *   • buildPerfSection — active builds + recent-build history rows
 *   • Status dot: red if active build pushing CPU >90%
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { ProjectDetector }    from './core/projectDetector.js';
import { ProcessTracker }     from './core/processTracker.js';
import { PortMonitor }        from './core/portMonitor.js';
import { ConflictNotifier }   from './core/conflictNotifier.js';
import { SnapshotManager }      from './core/snapshotManager.js';
import { buildProjectSection }  from './ui/projectSection.js';
import { buildPortSection }     from './ui/portSection.js';
import { buildSnapshotSection } from './ui/snapshotSection.js';
import { BuildDetector }         from './core/buildDetector.js';
import { buildPerfSection }      from './ui/perfSection.js';
import { buildHealthSummary, clearHealthSummary } from './ui/healthSummary.js';
import { buildAlertsSection } from './ui/alertsSection.js';

/** Fallback poll interval — used before settings load (should never be needed). */
const DEFAULT_POLL_INTERVAL_S = 10;

export default class DevWatchExtension extends Extension {
    constructor(metadata) {
        super(metadata);
    }

    enable() {        // Initialise translations before any string is rendered
        this.initTranslations();
        // ── Cancellable — shared across all async operations ───────────
        this._cancellable = new Gio.Cancellable();

        // ── Core modules ───────────────────────────────────────────────
        this._projectDetector   = new ProjectDetector();
        this._processTracker    = new ProcessTracker();
        this._portMonitor       = new PortMonitor();
        this._conflictNotifier  = new ConflictNotifier();
        this._snapshotManager   = new SnapshotManager();
        this._buildDetector     = new BuildDetector();

        // ── GSettings ─────────────────────────────────────────────────
        this._settings = this.getSettings();
        // Restart the poll timer live when the user changes the interval
        this._settingsChangedId = this._settings.connect(
            'changed::poll-interval',
            () => this._restartPollTimer()
        );

        /** Cached from last _refresh() — used by Save Now button. */
        this._lastProjectMap  = null;
        this._lastPortResult  = null;
        /** Most recent snapshot list for the UI. */
        this._snapshots       = [];
        /** Last auto-saved workspace (null until first poll completes). */
        this._lastWorkspace   = null;

        this._projectDetector.onProjectChanged(_info => {
            // React immediately when the focused project changes
            this._refresh().catch(e => this._logError(e));
        });

        this._projectDetector.start(this._cancellable);
        this._processTracker.start(this._cancellable);
        this._portMonitor.start(this._cancellable);
        this._snapshotManager.start(this._cancellable);
        this._buildDetector.start(this._cancellable);

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

        // ── Refresh on menu open + one-time scroll setup ───────────────
        // We wire the scroll fix here (not in enable()) so the widget tree
        // is guaranteed to be fully realized before we walk it.
        this._scrollSetupDone = false;
        this._menuOpenSignalId = this._indicator.menu.connect(
            'open-state-changed',
            (_menu, open) => {
                if (open) {
                    // Set up scrolling once: change the internal St.ScrollView
                    // policy from NEVER (default) to AUTOMATIC so the menu
                    // scrolls instead of shrinking when content exceeds the
                    // monitor height. We walk up from menu.box because
                    // menu.box.get_parent() can be a St.Bin wrapper in
                    // GNOME Shell 49, not the ScrollView directly.
                    if (!this._scrollSetupDone) {
                        let sv = this._indicator.menu._scrollView ?? null;
                        if (!sv) {
                            let a = this._indicator.menu.box;
                            for (let i = 0; i < 8 && a; i++) {
                                a = a.get_parent();
                                if (a instanceof St.ScrollView) { sv = a; break; }
                            }
                        }
                        if (sv) {
                            sv.vscrollbar_policy = St.PolicyType.AUTOMATIC;
                            sv.overlay_scrollbars = true;
                        }
                        this._scrollSetupDone = true;
                    }
                    this._refresh().catch(e => this._logError(e));
                }
            }
        );

        // ── Background poll ────────────────────────────────────────────
        this._pollId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            this._settings.get_int('poll-interval'),
            () => {
                this._refresh().catch(e => this._logError(e));
                return GLib.SOURCE_CONTINUE;
            }
        );

        // ── Add to panel ───────────────────────────────────────────────
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');

        // ── Apply panel menu min-width ─────────────────────────────────
        this._indicator.menu.box.add_style_class_name('devwatch-menu');

        // (Scroll policy is set in open-state-changed above, once the
        //  widget tree is fully realized.)

        // ── Keyboard shortcut (Super+D) ────────────────────────────────
        try {
            Main.wm.addKeybinding(
                'open-devwatch',
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () => {
                    if (this._indicator?.menu)
                        this._indicator.menu.toggle();
                }
            );
        } catch (e) {
            console.warn('[DevWatch] Could not register Super+D keybinding:', e.message);
        }

        // Initial data load
        this._refresh().catch(e => this._logError(e));

        console.log('[DevWatch] Enabled — polling every',
            this._settings.get_int('poll-interval'), 's');
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

        // Auto-save the last workspace state before tearing down so it
        // survives a reboot / session restart and can be resumed next time.
        if (this._snapshotManager && this._lastProjectMap?.size) {
            this._snapshotManager
                .saveLastWorkspace(this._lastProjectMap, this._lastPortResult ?? { ports: [] })
                .catch(() => {});
        }

        // Stop core modules
        this._projectDetector?.stop();
        this._projectDetector = null;

        this._processTracker?.stop();
        this._processTracker = null;

        this._portMonitor?.stop();
        this._portMonitor = null;

        this._conflictNotifier?.destroy();
        this._conflictNotifier = null;


        this._snapshotManager?.stop();
        this._snapshotManager = null;
        this._lastProjectMap  = null;
        this._lastPortResult  = null;
        this._snapshots       = null;
        this._lastWorkspace   = null;

        this._buildDetector?.destroy();
        this._buildDetector = null;

        // Disconnect GSettings watcher
        if (this._settingsChangedId !== null && this._settingsChangedId !== undefined) {
            this._settings?.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        this._settings = null;

        // Cancel all in-flight async operations
        this._cancellable?.cancel();
        this._cancellable = null;

        // Remove keyboard shortcut
        try { Main.wm.removeKeybinding('open-devwatch'); } catch (_) {}

        // Destroy the indicator (removes it from the panel + tears down the menu)
        this._indicator?.destroy();
        this._indicator = null;
        this._statusDot = null;
        this._panelLabel = null;

        console.log('[DevWatch] Disabled');
    }

    // ── Private ────────────────────────────────────────────────────────────

    /**
     * Run a full /proc + port scan and rebuild both dropdown sections.
     * Safe to call from timers and signal handlers.
     */
    async _refresh() {
        if (!this._processTracker) return; // already disabled

        // Run process scan first — portMonitor uses its PID cache
        let projectMap;
        try {
            projectMap = await this._processTracker.scan();
        } catch (e) {
            if (this._isCancelled(e)) return;
            this._logError(e);
            return;
        }

        if (!this._indicator) return; // disabled while awaiting

        // Run port scan (uses processTracker's freshly updated PID index)
        let portResult = { ports: [], newPorts: [] };
        try {
            portResult = await this._portMonitor.scan(this._processTracker);
        } catch (e) {
            if (!this._isCancelled(e)) this._logError(e);
        }

        if (!this._indicator) return;

        // Cache for Save Now button (used outside _refresh)
        this._lastProjectMap = projectMap;
        this._lastPortResult = portResult;

        // Fetch snapshot list + last workspace (synchronous read, best-effort)
        try {
            this._snapshots      = await this._snapshotManager.list();
            this._lastWorkspace  = this._snapshotManager.loadLastWorkspace();
        } catch (e) {
            if (!this._isCancelled(e)) this._logError(e);
        }

        if (!this._indicator) return;

        // Fire conflict notifications for newly occupied dev ports
        const notifyEnabled = this._settings?.get_boolean('notify-port-conflicts') ?? true;
        const activePids = new Set(
            [...projectMap.values()].flatMap(p => p.processes.map(pr => pr.pid))
        );
        this._conflictNotifier?.pruneNotified(activePids);
        this._conflictNotifier?.notify(portResult.newPorts, notifyEnabled);

        // Run build detection
        const buildResult = this._buildDetector
            ? this._buildDetector.analyse(projectMap)
            : { active: [], history: new Map() };

        // Read remaining display preferences
        const showSystemPorts  = this._settings?.get_boolean('show-system-ports') ?? false;
        const maxBuildHistory  = this._settings?.get_int('max-build-history') ?? 8;

        // Rebuild all sections — health summary first, then content
        buildHealthSummary(
            this._indicator.menu,
            projectMap,
            portResult,
            () => this._refresh().catch(e => this._logError(e)),
            () => this._stopAllProjects()
        );
        // Problems / Alerts section — shown only when issues exist
        buildAlertsSection(this._indicator.menu, projectMap, portResult);
        buildProjectSection(this._indicator.menu, projectMap, portResult);
        buildPortSection(
            this._indicator.menu,
            portResult,
            (pid, port) => this._killProcess(pid, port),
            showSystemPorts
        );

        buildSnapshotSection(
            this._indicator.menu,
            this._snapshots ?? [],
            {
                onSave:    (label) => this._saveSnapshot(label),
                onRestore: fn  => this._restoreSnapshot(fn),
                onDelete:  fn  => this._deleteSnapshot(fn),
            },
            this._lastWorkspace ?? null
        );
        buildPerfSection(this._indicator.menu, buildResult, maxBuildHistory);

        // Update status dot colour
        this._updateStatusDot(projectMap, portResult, buildResult);

        // Auto-save last workspace (fire-and-forget — never blocks the UI)
        this._snapshotManager?.saveLastWorkspace(projectMap, portResult)
            .catch(e => this._logError(e));
    }

    /**
     * Restart the background poll timer with the current poll-interval setting.
     * Called live when the user changes the setting in Preferences.
     */
    _restartPollTimer() {
        if (this._pollId !== null) {
            GLib.Source.remove(this._pollId);
            this._pollId = null;
        }
        const interval = this._settings?.get_int('poll-interval') ?? DEFAULT_POLL_INTERVAL_S;
        this._pollId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            interval,
            () => {
                this._refresh().catch(e => this._logError(e));
                return GLib.SOURCE_CONTINUE;
            }
        );
        console.log('[DevWatch] Poll interval changed to', interval, 's');
    }

    /**
     * Save current session as a snapshot and refresh the snapshot list.
     * @param {string} [label='auto']
     */
    _saveSnapshot(label = 'auto') {
        if (!this._snapshotManager) return;
        this._snapshotManager
            .save(this._lastProjectMap ?? new Map(), this._lastPortResult ?? { ports: [], newPorts: [] }, label)
            .then(() => this._refresh())
            .catch(e => this._logError(e));
    }

    /**
     * Restore a named snapshot (opens terminals at saved project roots).
     * @param {string} filename
     */
    _restoreSnapshot(filename) {
        if (!this._snapshotManager) return;
        this._snapshotManager
            .load(filename)
            .then(data => {
                if (!data) return;
                return this._snapshotManager.restore(data);
            })
            .then(result => {
                if (!result) return;
                const { launched, skipped, editors } = result;
                const parts = [];
                if (launched > 0) parts.push(`${launched} service${launched !== 1 ? 's' : ''} launched`);
                if (editors  > 0) parts.push(`${editors} editor${editors  !== 1 ? 's' : ''} opened`);
                if (skipped  > 0) parts.push(`${skipped} already running`);
                Main.notify('DevWatch — Session Restored', parts.join(', ') || 'No services to start');
            })
            .catch(e => this._logError(e));
    }

    /**
     * Delete a named snapshot file and refresh the snapshot list.
     * @param {string} filename
     */
    _deleteSnapshot(filename) {
        if (!this._snapshotManager) return;
        this._snapshotManager
            .delete(filename)
            .then(() => this._refresh())
            .catch(e => this._logError(e));
    }

    /**
     * Send SIGTERM to a process by PID.
     * @param {number} pid
     * @param {number} port
     */
    _killProcess(pid, port) {
        try {
            const proc = new Gio.Subprocess({
                argv: ['kill', String(pid)],
                flags: Gio.SubprocessFlags.NONE,
            });
            proc.init(null);
            console.log(`[DevWatch] Sent SIGTERM to PID ${pid} (port ${port})`);
            // Schedule a refresh in 1.5s so the port row disappears promptly
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                this._refresh().catch(e => this._logError(e));
                return GLib.SOURCE_REMOVE;
            });
        } catch (e) {
            this._logError(e);
        }
    }

    /**
     * Stop all processes belonging to every detected project.
     * Triggered by the "Stop All" quick-action button.
     */
    _stopAllProjects() {
        if (!this._lastProjectMap) return;
        for (const project of this._lastProjectMap.values()) {
            for (const proc of project.processes) {
                this._killProcess(proc.pid, null);
            }
        }
    }

    /**
     * Kill all cleanup candidates (orphans + idle-dev; never zombies).
     * Triggered by the "Clean Dev Environment" quick-action button.
     */
    _cleanEnvironment(cleanupResult) {
        const killable = (cleanupResult?.candidates ?? []).filter(c => c.reason !== 'zombie');
        for (const c of killable) {
            this._killProcess(c.pid, null);
        }
    }

    /**
     * Build the static skeleton of the dropdown (header, separators, footer).
     * The dynamic projects section is injected by buildProjectSection().
     */
    _buildMenuSkeleton() {
        // Health summary (title + stats + refresh icon) is built dynamically
        // by buildHealthSummary() on every _refresh() — nothing static here.
    }

    /**
     * Update the panel status dot colour based on overall dev health.
     *
     * Red    — newly conflicting port
     * Yellow — high CPU (>80%)
     * Green  — all clear
     *
     * @param {Map<string, object>} projectMap
     * @param {{ ports: object[], newPorts: object[] }} portResult
     */
    _updateStatusDot(
        projectMap,
        portResult     = { ports: [], newPorts: [] },
        buildResult    = { active: [], history: new Map() }
    ) {
        if (!this._statusDot) return;

        const hasConflict  = portResult.newPorts?.length > 0;
        const highCpu      = projectMap && [...projectMap.values()].some(p =>
            p.totalCpuPercent > 80
        );
        // A build hammering the CPU signals active work (yellow — not an error)
        const buildingHot  = buildResult.active?.some(r => r.peakCpuPct > 90);

        let dotClass = 'devwatch-dot-green';
        if (hasConflict) dotClass = 'devwatch-dot-red';
        else if (highCpu || buildingHot) dotClass = 'devwatch-dot-yellow';

        this._statusDot.style_class = `devwatch-dot ${dotClass}`;
    }
