/**
 * DevWatch — ui/perfSection.js
 *
 * Renders the "Build Performance" section inside the panel dropdown.
 *
 * Layout (active build + history):
 *   BUILD PERFORMANCE
 *   ──────────────────────────────────────────────────
 *   ⚙ cargo    backend-api   building…  CPU 82%  ← active build row
 *
 *   RECENT BUILDS
 *   ✓ cargo    backend-api   1m 42s   peak CPU 78%   peak RAM 312 MB
 *   ✓ npm      frontend      48s      peak CPU 45%   peak RAM 180 MB
 *   ✗ tsc      frontend      12s      peak CPU 20%   peak RAM 64 MB  (short)
 *
 * Layout (idle — no active builds, no history):
 *   BUILD PERFORMANCE
 *   ──────────────────────────────────────────────────
 *     No active builds detected
 *
 * Active builds have a spinner-like icon (⚙) and show live CPU%.
 * History rows are sorted newest-first per project; up to MAX_HISTORY_ROWS total.
 *
 * Exports
 * ───────
 *   buildPerfSection(menu, buildResult)
 *   clearPerfSection(menu)
 */

import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { _ } from '../utils/i18n.js';

const SECTION_TAG = 'devwatch-perf';

/** Default max history rows — overridden by the maxRows parameter. */
const DEFAULT_MAX_HISTORY_ROWS = 8;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Rebuild the Build Performance section.
 *
 * @param {PopupMenu.PopupMenu} menu
 * @param {import('../core/buildDetector.js').BuildResult} buildResult
 * @param {number} [maxRows=8]  From user preferences (max-build-history).
 */
export function buildPerfSection(menu, buildResult, maxRows = DEFAULT_MAX_HISTORY_ROWS) {
    clearPerfSection(menu);

    const active  = buildResult?.active  ?? [];
    const history = buildResult?.history ?? new Map();

    // ── Section title ──────────────────────────────────────────────────────
    const title = new PopupMenu.PopupMenuItem(_('BUILD PERFORMANCE'), { reactive: false });
    title.label.style_class = 'devwatch-section-title';
    title._devwatchSection = SECTION_TAG;
    menu.addMenuItem(title);

    // ── Active builds ──────────────────────────────────────────────────────
    if (active.length > 0) {
        for (const run of active) {
            const item = _buildActiveRow(run);
            item._devwatchSection = SECTION_TAG;
            menu.addMenuItem(item);
        }
    }

    // ── History ────────────────────────────────────────────────────────────
    // Flatten all history runs into one list, newest first, capped at MAX_HISTORY_ROWS
    const historyRuns = [];
    for (const runs of history.values()) {
        historyRuns.push(...runs);
    }
    // Sort by startedAt descending (largest = most recent)
    historyRuns.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    const shown = historyRuns.slice(0, maxRows);

    if (shown.length > 0) {
        if (active.length > 0) {
            // Thin separator between active and history
            const miniSep = new PopupMenu.PopupMenuItem(_('RECENT BUILDS'), { reactive: false });
            miniSep.label.style_class = 'devwatch-perf-history-header';
            miniSep._devwatchSection = SECTION_TAG;
            menu.addMenuItem(miniSep);
        }

        for (const run of shown) {
            const item = _buildHistoryRow(run);
            item._devwatchSection = SECTION_TAG;
            menu.addMenuItem(item);
        }

        if (historyRuns.length > maxRows) {
            const more = new PopupMenu.PopupMenuItem(
                `  … and ${historyRuns.length - maxRows} older runs`,
                { reactive: false }
            );
            more.label.style_class = 'devwatch-dim';
            more._devwatchSection = SECTION_TAG;
            menu.addMenuItem(more);
        }
    } else if (active.length === 0) {
        // Completely idle
        const empty = new PopupMenu.PopupMenuItem(_('  No active builds detected'), { reactive: false });
        empty.label.style_class = 'devwatch-dim';
        empty._devwatchSection = SECTION_TAG;
        menu.addMenuItem(empty);
    }

    const sep = new PopupMenu.PopupSeparatorMenuItem();
    sep._devwatchSection = SECTION_TAG;
    menu.addMenuItem(sep);
}

/**
 * Remove all items tagged as belonging to the perf section.
 * @param {PopupMenu.PopupMenu} menu
 */
export function clearPerfSection(menu) {
    const toRemove = menu._getMenuItems().filter(
        item => item._devwatchSection === SECTION_TAG
    );
    for (const item of toRemove) item.destroy();
}

// ── Row builders ───────────────────────────────────────────────────────────────

/**
 * Build a row for an in-progress build.
 * @param {import('../core/buildDetector.js').BuildRun} run
 */
function _buildActiveRow(run) {
    const item = new PopupMenu.PopupMenuItem('', { reactive: false });

    const row = new St.BoxLayout({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'devwatch-perf-row',
    });

    // Spinning gear icon
    const icon = new St.Label({
        text: '⚙',
        style_class: 'devwatch-perf-active-icon',
        y_align: Clutter.ActorAlign.CENTER,
    });

    // Tool name
    const toolLabel = new St.Label({
        text: _truncate(run.tool, 12),
        style_class: 'devwatch-perf-tool',
        width: 80,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // Project name
    const projText = run.projectRoot
        ? _truncate(GLib.path_get_basename(run.projectRoot), 18)
        : '—';
    const projLabel = new St.Label({
        text: projText,
        style_class: run.projectRoot ? 'devwatch-meta devwatch-project-link' : 'devwatch-dim',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // Elapsed time
    const elapsedMs = Math.round((GLib.get_monotonic_time() - run.startedAt) / 1000);
    const elapsedLabel = new St.Label({
        text: _formatDuration(elapsedMs),
        style_class: 'devwatch-dim',
        width: 52,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // Live CPU badge
    const cpuLabel = new St.Label({
        text: `CPU ${run.peakCpuPct.toFixed(0)}%`,
        style_class: 'devwatch-perf-cpu-active',
        width: 60,
        y_align: Clutter.ActorAlign.CENTER,
    });

    row.add_child(icon);
    row.add_child(toolLabel);
    row.add_child(projLabel);
    row.add_child(elapsedLabel);
    row.add_child(cpuLabel);

    item.add_child(row);
    item.label.hide();
    return item;
}

/**
 * Build a row for a completed build from history.
 * @param {import('../core/buildDetector.js').BuildRun} run
 */
function _buildHistoryRow(run) {
    const item = new PopupMenu.PopupMenuItem('', { reactive: false });

    const row = new St.BoxLayout({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'devwatch-perf-row',
    });

    // Checkmark icon — distinguish short (<5s) runs with a dim colour
    const isShort = (run.durationMs ?? 0) < 5000;
    const icon = new St.Label({
        text: isShort ? '✗' : '✓',
        style_class: isShort ? 'devwatch-perf-icon-short' : 'devwatch-perf-icon-ok',
        y_align: Clutter.ActorAlign.CENTER,
    });

    // Tool name
    const toolLabel = new St.Label({
        text: _truncate(run.tool, 12),
        style_class: 'devwatch-meta',
        width: 80,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // Project name
    const projText = run.projectRoot
        ? _truncate(GLib.path_get_basename(run.projectRoot), 18)
        : '—';
    const projLabel = new St.Label({
        text: projText,
        style_class: run.projectRoot ? 'devwatch-meta devwatch-project-link' : 'devwatch-dim',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // Duration
    const durationLabel = new St.Label({
        text: _formatDuration(run.durationMs ?? 0),
        style_class: 'devwatch-meta',
        width: 52,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // Peak CPU
    const cpuLabel = new St.Label({
        text: `CPU ${run.peakCpuPct.toFixed(0)}%`,
        style_class: 'devwatch-dim',
        width: 60,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // Peak RAM
    const ramLabel = new St.Label({
        text: _formatKb(run.peakRamKb),
        style_class: 'devwatch-dim',
        width: 60,
        y_align: Clutter.ActorAlign.CENTER,
    });

    row.add_child(icon);
    row.add_child(toolLabel);
    row.add_child(projLabel);
    row.add_child(durationLabel);
    row.add_child(cpuLabel);
    row.add_child(ramLabel);

    item.add_child(row);
    item.label.hide();
    return item;
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

function _formatDuration(ms) {
    if (ms < 1000)          return `${ms}ms`;
    if (ms < 60_000)        return `${(ms / 1000).toFixed(0)}s`;
    if (ms < 3_600_000)     return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60000)}m`;
}

function _formatKb(kb) {
    if (kb < 1024)          return `${kb} KB`;
    if (kb < 1024 * 1024)   return `${(kb / 1024).toFixed(0)} MB`;
    return `${(kb / 1024 / 1024).toFixed(1)} GB`;
}

function _truncate(s, maxLen) {
    if (!s) return '';
    return s.length <= maxLen ? s : s.slice(0, maxLen - 1) + '…';
}
