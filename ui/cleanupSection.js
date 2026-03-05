/**
 * DevWatch — ui/cleanupSection.js  (v2)
 *
 * Section: "Suggested Cleanup"
 *
 * Shows actionable cleanup suggestions in plain English:
 *   Old node server — idle for 2h 14m   [Clean]
 *   Stray python process — no project   [Clean]
 *   Frozen process (system will reap)
 *
 * "Stop All" is the headline action when there are multiple issues.
 */

import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { _ } from '../utils/i18n.js';

const SECTION_TAG = 'devwatch-cleanup';

export function buildCleanupSection(menu, cleanupResult, onKill) {
    clearCleanupSection(menu);

    const candidates = cleanupResult?.candidates ?? [];
    const killable   = candidates.filter(c => c.reason !== 'zombie');

    // Section header
    const titleItem = new PopupMenu.PopupMenuItem('', { reactive: false });
    titleItem._devwatchSection = SECTION_TAG;
    const titleRow = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    titleRow.add_child(new St.Label({ text: _('Suggested Cleanup'), style_class: 'dw-section-label' }));

    if (killable.length > 1) {
        const btn = new St.Button({
            label: _('Stop All (%d)').format(killable.length),
            style_class: 'dw-section-action-danger',
            reactive: true, can_focus: true, track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        btn.connect('clicked', () => { for (const c of killable) onKill(c.pid); });
        titleRow.add_child(btn);
    }
    titleItem.add_child(titleRow);
    titleItem.label.hide();
    menu.addMenuItem(titleItem);

    if (candidates.length === 0) {
        const ok = new PopupMenu.PopupMenuItem(_('  ✓ No issues detected'), { reactive: false });
        ok.label.style_class = 'dw-issue-ok';
        ok._devwatchSection = SECTION_TAG;
        menu.addMenuItem(ok);
        _addSep(menu);
        return;
    }

    for (const c of candidates) {
        const item = _buildRow(c, onKill, cleanupResult?.now);
        item._devwatchSection = SECTION_TAG;
        menu.addMenuItem(item);
    }
    _addSep(menu);
}

export function clearCleanupSection(menu) {
    for (const item of menu._getMenuItems().filter(i => i._devwatchSection === SECTION_TAG))
        item.destroy();
}

function _buildRow(c, onKill, now) {
    const item = new PopupMenu.PopupMenuItem('', { reactive: false });
    const row  = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER})
    row.spacing = 8;

    // Human-readable description
    const desc = _describe(c, now);
    row.add_child(new St.Label({ text: desc, style_class: 'dw-issue-name' }));

    // Reason chip
    const { chipLabel, chipClass } = _reasonMeta(c.reason, c.idleMs, now);
    row.add_child(new St.Label({ text: chipLabel, style_class: `dw-issue-reason ${chipClass}` }));

    // Action
    if (c.reason === 'zombie') {
        row.add_child(new St.Label({ text: 'system will reap', style_class: 'dw-dim', y_align: Clutter.ActorAlign.CENTER }));
    } else {
        const btn = new St.Button({
            label: 'Clean',
            style_class: 'dw-btn-stop',
            reactive: true, can_focus: true, track_hover: true,
        });
        btn.connect('clicked', () => onKill(c.pid));
        row.add_child(btn);
    }

    item.add_child(row);
    item.label.hide();
    return item;
}

function _describe(c, now) {
    const name = _cleanName(c.name);
    if (c.reason === 'zombie')   return `${name} — frozen process`;
    if (c.reason === 'orphan')   return `${name} — no project`;
    if (c.reason === 'idle_dev') {
        const idle = c.idleMs != null ? ` — idle ${_formatDuration(c.idleMs)}` : ' — idle';
        return `${name}${idle}`;
    }
    return name;
}

function _reasonMeta(reason, idleMs) {
    if (reason === 'zombie')   return { chipLabel: 'Frozen',    chipClass: 'dw-issue-reason-frozen' };
    if (reason === 'orphan')   return { chipLabel: 'Stray',     chipClass: 'dw-issue-reason-stray'  };
    if (reason === 'idle_dev') return { chipLabel: 'Idle',      chipClass: 'dw-issue-reason-idle'   };
    return { chipLabel: reason, chipClass: 'dw-issue-reason-idle' };
}

function _cleanName(name) {
    return name.replace(/^python\d+(\.\d+)?$/, 'python');
}
function _formatDuration(ms) {
    if (!ms) return '';
    if (ms < 60_000)      return `${Math.floor(ms / 1000)}s`;
    if (ms < 3_600_000)   return `${Math.floor(ms / 60_000)}m`;
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
function _addSep(menu) {
    const sep = new PopupMenu.PopupSeparatorMenuItem();
    sep._devwatchSection = SECTION_TAG;
    menu.addMenuItem(sep);
}
