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
    titleRow.set_style('margin-top: 8px; margin-bottom: 4px;');
    titleRow.add_child(new St.Label({ text: _('Build Activity'), style_class: 'dw-section-label' }));
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
        // Collapse history inside a sub-menu to reduce panel height
        const histSub = new PopupMenu.PopupSubMenuMenuItem('', false);
        histSub._devwatchSection = SECTION_TAG;
        const histLabel = new St.Label({ text: _('Recent Builds'), style_class: 'dw-build-hist-hdr' });
        histSub.label.get_parent().insert_child_above(histLabel, histSub.label);
        histSub.label.hide();

        for (const run of shown) {
            histSub.menu.addMenuItem(_buildHistoryRow(run));
        }
        if (histRuns.length > maxRows) {
            const more = new PopupMenu.PopupMenuItem(`  … and ${histRuns.length - maxRows} older`, { reactive: false });
            more.label.style_class = 'dw-dim';
            histSub.menu.addMenuItem(more);
        }
        menu.addMenuItem(histSub);
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
    item.add_style_class_name('dw-build-active-card');

    const row  = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER});
    row.spacing = 10;

    row.add_child(new St.Icon({
        icon_name: 'system-run-symbolic',
        style_class: 'dw-build-active-icon',
        y_align: Clutter.ActorAlign.CENTER
    }));
    
    const textStack = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });

    // "Building tracktite" — project name is the primary label
    const proj = run.projectRoot ? GLib.path_get_basename(run.projectRoot) : run.tool;
    textStack.add_child(new St.Label({
        text: `Building ${_truncate(proj, 24)}`,
        style_class: 'dw-build-status',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    }));

    // Compact metadata: "27s elapsed · CPU 1%"
    const elapsedMs = Math.round((GLib.get_monotonic_time() - run.startedAt) / 1000);
    textStack.add_child(new St.Label({
        text: `${_fmtDur(elapsedMs)} elapsed · CPU ${run.peakCpuPct.toFixed(0)}%`,
        style_class: 'dw-build-meta',
        y_align: Clutter.ActorAlign.CENTER,
    }));

    row.add_child(textStack);
    return item;
}

function _buildHistoryRow(run) {
    const item = new PopupMenu.PopupMenuItem('', { reactive: false });
    item.add_style_class_name('dw-build-hist-row');
    
    const row  = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER})
    row.spacing = 8;

    const isShort = (run.durationMs ?? 0) < 5000;
    
    // Status Icon
    row.add_child(new St.Icon({
        icon_name: isShort ? 'process-stop-symbolic' : 'emblem-ok-symbolic',
        style_class: isShort ? 'dw-build-fail-icon' : 'dw-build-ok-icon',
        y_align: Clutter.ActorAlign.CENTER
    }));
                                
    const proj = run.projectRoot ? GLib.path_get_basename(run.projectRoot) : run.tool;
    row.add_child(new St.Label({
        text: _truncate(proj, 24),
        style_class: 'dw-build-proj-name',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    }));
    
    // Right-aligned stats
    const statsBox = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
    statsBox.spacing = 6;

    statsBox.add_child(new St.Label({
        text: _fmtDur(run.durationMs ?? 0),
        style_class: 'dw-build-stat-pill',
        y_align: Clutter.ActorAlign.CENTER
    }));

    statsBox.add_child(new St.Label({
        text: `${run.peakCpuPct.toFixed(0)}%`,
        style_class: 'dw-build-stat-pill',
        y_align: Clutter.ActorAlign.CENTER
    }));
    
    row.add_child(statsBox);
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
