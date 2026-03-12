/**
 * DevWatch — ui/snapshotSection.js  (v4)
 *
 * Section: "Dev Sessions"
 * Completely redesigned following GNOME guidelines:
 * - Two-line row layout: Title + Subtitle stack on left, actions on right.
 * - Iconography for standard actions.
 * - Clear, airy, card-like spacing.
 */

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { _ } from '../utils/i18n.js';

const SECTION_TAG = 'devwatch-snapshots';
const MAX_ROWS = 5;

export function buildSnapshotSection(menu, snapshots, callbacks, lastWorkspace = null) {
    clearSnapshotSection(menu);
    const { onSave, onRestore, onDelete } = callbacks ?? {};

    const sub = new PopupMenu.PopupSubMenuMenuItem('', false);
    sub._devwatchSection = SECTION_TAG;

    // ── Header row ────────────────────────────────────────────────────────
    // x_align: Clutter.ActorAlign.FILL ensures the row stretches to the parent's full width.
    const headerRow = new St.BoxLayout({ x_expand: true, x_align: Clutter.ActorAlign.FILL, y_align: Clutter.ActorAlign.CENTER });
    headerRow.set_style('margin-top: 6px; margin-bottom: 6px; margin-right: 4px; ');
    
    headerRow.add_child(new St.Label({ text: _('Sessions'), style_class: 'dw-section-label' }));

    const spacer = new St.BoxLayout({ x_expand: true });
    headerRow.add_child(spacer);

    const saveBtn = new St.Button({
        label: _('Save'),
        style_class: 'dw-session-btn-save',
        reactive: true, can_focus: true, track_hover: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerRow.add_child(saveBtn);

    sub.label.get_parent().insert_child_above(headerRow, sub.label);
    sub.label.hide();

    // ── Inline naming row ──────────────────────────────────────────────────
    const namingItem = new PopupMenu.PopupMenuItem('', { reactive: false });
    namingItem.add_style_class_name('dw-session-naming-row');
    const namingBox = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    namingBox.set_style('margin-top: 4px; margin-bottom: 8px; margin-right: 6px; margin-left: 6px;');
    namingBox.spacing = 8;

    const entry = new St.Entry({
        hint_text: _('Session name…'),
        style_class: 'dw-session-entry',
        x_expand: true,
        can_focus: true,
    });
    entry.clutter_text.set_max_length(40);

    const confirmBtn = new St.Button({
        label: _('Confirm'),
        style_class: 'dw-session-btn-resume',
        reactive: true, can_focus: true, track_hover: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const cancelBtn = new St.Button({
        label: _('Close'),
        style_class: 'dw-session-btn-cancel',
        reactive: true, can_focus: true, track_hover: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    cancelBtn.set_style('margin-left: 6px;');

    namingBox.add_child(entry);
    namingBox.add_child(confirmBtn);
    namingBox.add_child(cancelBtn);
    namingItem.add_child(namingBox);
    namingItem.label.hide();
    namingItem._devwatchSection = SECTION_TAG;

    const _showNaming = () => {
        saveBtn.reactive = false;
        saveBtn.opacity  = 80;
        entry.set_text('');
        namingItem.visible = true;
        entry.grab_key_focus();
    };
    const _hideNaming = () => {
        namingItem.visible = false;
        saveBtn.reactive = true;
        saveBtn.opacity  = 255;
    };

    saveBtn.connect('clicked', _showNaming);
    cancelBtn.connect('clicked', _hideNaming);
    confirmBtn.connect('clicked', () => {
        const label = entry.get_text().trim() || 'auto';
        _hideNaming();
        onSave?.(label);
    });
    entry.clutter_text.connect('activate', () => {
        const label = entry.get_text().trim() || 'auto';
        _hideNaming();
        onSave?.(label);
    });

    menu.addMenuItem(sub);
    // Give the session sub-menu a consistent top gap so the first card is
    // flush with subsequent ones (sub-menu CSS has padding-top: 0 by default).
    sub.menu.actor.set_style('padding-top: 5px;');
    sub.menu.addMenuItem(namingItem, 0);
    namingItem.visible = false;

    // ── Session list ────────────────────────────────────────────────────────
    if (lastWorkspace) {
        sub.menu.addMenuItem(_buildRow(lastWorkspace, true, onRestore, onDelete));
    }

    if (!snapshots || snapshots.length === 0) {
        const empty = new PopupMenu.PopupMenuItem(_('  No saved sessions yet'), { reactive: false });
        empty.label.style_class = 'dw-session-subtitle';
        sub.menu.addMenuItem(empty);
        _addSep(menu);
        return;
    }

    for (const snap of snapshots.slice(0, MAX_ROWS)) {
        sub.menu.addMenuItem(_buildRow(snap, false, onRestore, onDelete));
    }
    if (snapshots.length > MAX_ROWS) {
        const more = new PopupMenu.PopupMenuItem(`  … and ${snapshots.length - MAX_ROWS} older sessions`, { reactive: false });
        more.label.style_class = 'dw-session-subtitle';
        sub.menu.addMenuItem(more);
    }
    _addSep(menu);
}

export function clearSnapshotSection(menu) {
    for (const item of menu._getMenuItems().filter(i => i._devwatchSection === SECTION_TAG))
        item.destroy();
}

function _buildRow(snap, isLastWorkspace, onRestore, onDelete) {
    const item = new PopupMenu.PopupMenuItem('', { reactive: false });
    item.add_style_class_name(isLastWorkspace ? 'dw-session-card-primary' : 'dw-session-card');
    
    // Overall horizontal layout
    const outer = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    outer.spacing = 8;

    // Left container for Title + Subtitle
    const textStack = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    
    const titleBox = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
    titleBox.spacing = 6;
    
    if (isLastWorkspace) {
        titleBox.add_child(new St.Icon({
            icon_name: 'document-open-recent-symbolic',
            icon_size: 13,
            style_class: 'dw-session-icon-primary'
        }));
        titleBox.add_child(new St.Label({
            text: _('Last Workspace'),
            style_class: 'dw-session-title-primary'
        }));
    } else {
        const displayLabel = (snap.label === 'auto' || !snap.label) ? 'Autosave' : snap.label;
        titleBox.add_child(new St.Label({
            text: _truncate(displayLabel, 26),
            style_class: 'dw-session-title'
        }));
    }
    textStack.add_child(titleBox);

    // Stats line (Projects · Services)
    const projCount = snap.projectCount ?? (snap.projects?.length || 0);
    const svcCount = snap.serviceCount ?? ((snap.projects || []).reduce((n, p) => n + (p.services?.length || 0), 0));
    
    const statsParts = [];
    if (projCount) statsParts.push(`${projCount} project${projCount !== 1 ? 's' : ''}`);
    if (svcCount) statsParts.push(`${svcCount} service${svcCount !== 1 ? 's' : ''}`);

    if (statsParts.length > 0) {
        textStack.add_child(new St.Label({
            text: statsParts.join(' • '),
            style_class: 'dw-session-stats'
        }));
    }

    // Date line (Less prominent, below stats)
    if (snap.savedAt) {
        const dateText = _formatDate(snap.savedAt);
        if (dateText) {
            textStack.add_child(new St.Label({
                text: dateText,
                style_class: 'dw-session-date'
            }));
        }
    }

    outer.add_child(textStack);

    // Right container for Actions
    const actionBox = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
    actionBox.spacing = 6;

    const resumeBtn = new St.Button({
        label: _('Resume'),
        style_class: 'dw-session-btn-resume',
        reactive: true, can_focus: true, track_hover: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    resumeBtn.connect('clicked', () => {
        resumeBtn.label = _('Resuming…');
        resumeBtn.reactive = false;
        onRestore?.(isLastWorkspace ? '_last_workspace_.json' : snap.filename);
    });
    actionBox.add_child(resumeBtn);

    if (!isLastWorkspace) {
        const delBtn = new St.Button({
            child: new St.Icon({ icon_name: 'user-trash-symbolic', icon_size: 14 }),
            style_class: 'dw-session-btn-icon-danger',
            reactive: true, can_focus: true, track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        delBtn.set_style('margin-left: 8px;');
        delBtn.connect('clicked', () => onDelete?.(snap.filename));
        actionBox.add_child(delBtn);
    } else {
        // Spacer for consistent alignment with normal cards having a trash button
        const spacer = new St.Widget({
            width: 34 + 8, // matches trash icon button width + margin
            height: 1
        });
        actionBox.add_child(spacer);
    }

    outer.add_child(actionBox);
    item.add_child(outer);
    item.label.hide();
    
    return item;
}

function _formatDate(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
        if (isNaN(d.getTime())) return iso.slice(0, 16);
        const day   = String(d.getDate()).padStart(2, '0');
        const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
        return `${day} ${month} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    } catch (_) { return iso.slice(0, 16); }
}
function _truncate(s, n) { return s && s.length > n ? s.slice(0, n - 1) + '…' : (s ?? ''); }
function _addSep(menu) {
    const sep = new PopupMenu.PopupSeparatorMenuItem();
    sep._devwatchSection = SECTION_TAG;
    menu.addMenuItem(sep);
}
