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

    const active = Array.isArray(buildResult?.active)
        ? buildResult.active.filter(Boolean)
        : [];
    const historyBuckets = _historyBuckets(buildResult?.history);

    const histRuns = [];
    for (const runs of historyBuckets) {
        if (Array.isArray(runs))
            histRuns.push(...runs.filter(Boolean));
    }
    histRuns.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    const shown = histRuns.slice(0, maxRows);

    // If completely empty, render nothing at all to save space
    if (active.length === 0 && shown.length === 0) {
        return;
    }

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
    if (active.length === 0) {
        const emptyActive = new PopupMenu.PopupMenuItem(_('  No active builds'), { reactive: false });
        emptyActive.label.style_class = 'dw-dim dw-build-empty';
        emptyActive._devwatchSection = SECTION_TAG;
        menu.addMenuItem(emptyActive);
    } else {
        for (const run of active) {
            const item = _buildActiveRow(run);
            item._devwatchSection = SECTION_TAG;
            menu.addMenuItem(item);
        }
    }

    // ── Build History ──────────────────────────────────────────────────────
    if (shown.length > 0) {
        // Collapse history inside a sub-menu to reduce panel height
        const histSub = new PopupMenu.PopupSubMenuMenuItem('', false);
        histSub._devwatchSection = SECTION_TAG;
        const histLabel = new St.Label({ text: _('Recent Builds'), style_class: 'dw-build-hist-hdr' });

        for (const run of shown) {
            histSub.menu.addMenuItem(_buildHistoryRow(run));
        }
        if (histRuns.length > maxRows) {
            const more = new PopupMenu.PopupMenuItem(`  … and ${histRuns.length - maxRows} older`, { reactive: false });
            more.label.style_class = 'dw-dim';
            histSub.menu.addMenuItem(more);
        }
        menu.addMenuItem(histSub);
        // Insert label after the submenu has been mounted so it attaches
        // to the correct parent and does not get reparented on refresh.
        histSub.label.get_parent().insert_child_above(histLabel, histSub.label);
        histSub.label.hide();
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
    row.add_style_class_name('dw-build-active-row');
    row.spacing = 14;

    row.add_child(new St.Icon({
        icon_name: 'system-run-symbolic',
        style_class: 'dw-build-active-icon',
        y_align: Clutter.ActorAlign.CENTER
    }));
    
    const textStack = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    textStack.add_style_class_name('dw-build-active-text');
    textStack.spacing = 4; // Improved vertical spacing

    // "Building tracktite" — project name is the primary label
    const proj = run.projectRoot
        ? GLib.path_get_basename(run.projectRoot)
        : (run.tool ?? 'build');
    textStack.add_child(new St.Label({
        text: `Building ${_truncate(proj, 24)}`,
        style_class: 'dw-build-status',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    }));

    // Metadata row with explicit chunks for better scanability
    const startedAtUs = Number(run.startedAt ?? GLib.get_monotonic_time());
    const elapsedMs = Math.max(0, Math.round((GLib.get_monotonic_time() - startedAtUs) / 1000));
    const cpuPct = run.peakCpuPct ?? 0;
    const metaRow = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    metaRow.add_style_class_name('dw-build-meta-row');
    metaRow.spacing = 0;

    metaRow.add_child(new St.Label({
        text: _fmtDur(elapsedMs),
        style_class: 'dw-build-meta dw-build-meta-time',
        y_align: Clutter.ActorAlign.CENTER,
    }));
    metaRow.add_child(new St.Label({
        text: _('elapsed'),
        style_class: 'dw-build-meta dw-build-meta-label',
        y_align: Clutter.ActorAlign.CENTER,
    }));
    metaRow.add_child(new St.Label({
        text: '·',
        style_class: 'dw-build-meta-sep',
        y_align: Clutter.ActorAlign.CENTER,
    }));
    metaRow.add_child(new St.Label({
        text: `CPU ${cpuPct.toFixed(0)}%`,
        style_class: 'dw-build-meta dw-build-meta-cpu',
        y_align: Clutter.ActorAlign.CENTER,
    }));

    textStack.add_child(metaRow);

    row.add_child(textStack);
    
    item.add_child(row);
    item.label.hide();
    
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
                                
    const proj = run.projectRoot
        ? GLib.path_get_basename(run.projectRoot)
        : (run.tool ?? 'build');
    row.add_child(new St.Label({
        text: _truncate(proj, 24),
        style_class: 'dw-build-proj-name',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    }));
    
    // Right-aligned stats
    const statsBox = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
    statsBox.add_style_class_name('dw-build-stats-row');
    statsBox.spacing = 6;

    statsBox.add_child(new St.Label({
        text: _fmtDur(run.durationMs ?? 0),
        style_class: 'dw-build-stat-pill',
        y_align: Clutter.ActorAlign.CENTER
    }));

    const cpuPct = run.peakCpuPct ?? 0;
    statsBox.add_child(new St.Label({
        text: `${cpuPct.toFixed(0)}%`,
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

function _historyBuckets(history) {
    if (history instanceof Map)
        return history.values();
    if (history && typeof history === 'object')
        return Object.values(history);
    return [];
}

function _truncate(s, n) { if (!s) return ''; return s.length > n ? s.slice(0, n - 1) + '…' : s; }
