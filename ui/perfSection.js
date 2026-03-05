/**
 * DevWatch — ui/perfSection.js  (v2)
 *
 * Section: "Current Build"
 *
 * Active builds shown prominently.
 * Build History is a collapsible sub-section below.
 */

import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { _ } from '../utils/i18n.js';

const SECTION_TAG = 'devwatch-perf';
const DEFAULT_MAX_HISTORY_ROWS = 8;

export function buildPerfSection(menu, buildResult, maxRows = DEFAULT_MAX_HISTORY_ROWS) {
    clearPerfSection(menu);

    const active  = buildResult?.active  ?? [];
    const history = buildResult?.history ?? new Map();

    // Section header
    const titleItem = new PopupMenu.PopupMenuItem('', { reactive: false });
    titleItem._devwatchSection = SECTION_TAG;
    const titleRow = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    titleRow.add_child(new St.Label({ text: _('Current Build'), style_class: 'dw-section-label' }));
    titleItem.add_child(titleRow);
    titleItem.label.hide();
    menu.addMenuItem(titleItem);

    // ── Active builds ──────────────────────────────────────────────────────
    for (const run of active) {
        const item = _buildActiveRow(run);
        item._devwatchSection = SECTION_TAG;
        menu.addMenuItem(item);
    }

    // ── Build History ──────────────────────────────────────────────────────
    const histRuns = [];
    for (const runs of history.values()) histRuns.push(...runs);
    histRuns.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    const shown = histRuns.slice(0, maxRows);

    if (shown.length > 0) {
        const histHeader = new PopupMenu.PopupMenuItem(_('Build History'), { reactive: false });
        histHeader.label.style_class = 'dw-build-hist-hdr';
        histHeader._devwatchSection = SECTION_TAG;
        menu.addMenuItem(histHeader);

        for (const run of shown) {
            const item = _buildHistoryRow(run);
            item._devwatchSection = SECTION_TAG;
            menu.addMenuItem(item);
        }
        if (histRuns.length > maxRows) {
            const more = new PopupMenu.PopupMenuItem(`  … and ${histRuns.length - maxRows} older`, { reactive: false });
            more.label.style_class = 'dw-dim';
            more._devwatchSection = SECTION_TAG;
            menu.addMenuItem(more);
        }
    } else if (active.length === 0) {
        const empty = new PopupMenu.PopupMenuItem(_('  No build activity yet'), { reactive: false });
        empty.label.style_class = 'dw-dim';
        empty._devwatchSection = SECTION_TAG;
        menu.addMenuItem(empty);
    }

    const sep = new PopupMenu.PopupSeparatorMenuItem();
    sep._devwatchSection = SECTION_TAG;
    menu.addMenuItem(sep);
}

export function clearPerfSection(menu) {
    for (const item of menu._getMenuItems().filter(i => i._devwatchSection === SECTION_TAG))
        item.destroy();
}

function _buildActiveRow(run) {
    const item = new PopupMenu.PopupMenuItem('', { reactive: false });
    const row  = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER})
    row.spacing = 8;

    row.add_child(new St.Label({ text: '⚙', style_class: 'dw-build-active-icon' }));

    const proj = run.projectRoot ? GLib.path_get_basename(run.projectRoot) : null;
    row.add_child(new St.Label({
        text: proj ? `Building ${_truncate(proj, 20)}` : `Building (${run.tool})`,
        style_class: 'dw-project-name',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    }));

    const elapsedMs = Math.round((GLib.get_monotonic_time() - run.startedAt) / 1000);
    row.add_child(new St.Label({ text: `Elapsed: ${_fmtDur(elapsedMs)}`, style_class: 'dw-muted', y_align: Clutter.ActorAlign.CENTER }));
    row.add_child(new St.Label({ text: `CPU ${run.peakCpuPct.toFixed(0)}%`, style_class: 'dw-build-active-cpu' }));

    item.add_child(row);
    item.label.hide();
    return item;
}

function _buildHistoryRow(run) {
    const item = new PopupMenu.PopupMenuItem('', { reactive: false });
    const row  = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER})
    row.spacing = 8;

    const isShort = (run.durationMs ?? 0) < 5000;
    row.add_child(new St.Label({ text: isShort ? '✗' : '✓', style_class: isShort ? 'dw-build-fail-icon' : 'dw-build-ok-icon' }));

    const proj = run.projectRoot ? GLib.path_get_basename(run.projectRoot) : run.tool;
    row.add_child(new St.Label({
        text: _truncate(proj, 22),
        style_class: 'dw-proc-name',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    }));
    row.add_child(new St.Label({ text: _fmtDur(run.durationMs ?? 0), style_class: 'dw-muted', width: 52, y_align: Clutter.ActorAlign.CENTER }));
    row.add_child(new St.Label({ text: `${run.peakCpuPct.toFixed(0)}%`, style_class: 'dw-muted', width: 34, y_align: Clutter.ActorAlign.CENTER }));

    item.add_child(row);
    item.label.hide();
    return item;
}

function _fmtDur(ms) {
    if (ms < 1000)       return `${ms}ms`;
    if (ms < 60_000)     return `${(ms / 1000).toFixed(0)}s`;
    if (ms < 3_600_000)  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60000)}m`;
}
function _truncate(s, n) { if (!s) return ''; return s.length > n ? s.slice(0, n - 1) + '…' : s; }
