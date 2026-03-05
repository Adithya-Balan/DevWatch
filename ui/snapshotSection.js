/**
 * DevWatch — ui/snapshotSection.js  (v2)
 *
 * Section: "Saved Dev Sessions"
 *
 * Save, load, and delete workspace snapshots.
 *   before-refactor   03 Mar 14:30   3 apps   [Load] [✕]
 */

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { _ } from '../utils/i18n.js';

const SECTION_TAG = 'devwatch-snapshots';
const MAX_ROWS = 5;

export function buildSnapshotSection(menu, snapshots, callbacks) {
    clearSnapshotSection(menu);
    const { onSave, onRestore, onDelete } = callbacks ?? {};

    // Section header with Save button
    const titleItem = new PopupMenu.PopupMenuItem('', { reactive: false });
    titleItem._devwatchSection = SECTION_TAG;
    const titleRow = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    titleRow.add_child(new St.Label({ text: _('Saved Dev Sessions'), style_class: 'dw-section-label' }));

    const saveBtn = new St.Button({
        label: _('Save Current'),
        style_class: 'dw-section-action',
        reactive: true, can_focus: true, track_hover: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    saveBtn.connect('clicked', () => onSave?.());
    titleRow.add_child(saveBtn);

    titleItem.add_child(titleRow);
    titleItem.label.hide();
    menu.addMenuItem(titleItem);

    if (!snapshots || snapshots.length === 0) {
        const empty = new PopupMenu.PopupMenuItem(_('  No saved sessions yet — click Save Current'), { reactive: false });
        empty.label.style_class = 'dw-dim';
        empty._devwatchSection = SECTION_TAG;
        menu.addMenuItem(empty);
        _addSep(menu);
        return;
    }

    for (const snap of snapshots.slice(0, MAX_ROWS)) {
        const item = _buildRow(snap, onRestore, onDelete);
        item._devwatchSection = SECTION_TAG;
        menu.addMenuItem(item);
    }
    if (snapshots.length > MAX_ROWS) {
        const more = new PopupMenu.PopupMenuItem(`  … and ${snapshots.length - MAX_ROWS} older sessions`, { reactive: false });
        more.label.style_class = 'dw-dim';
        more._devwatchSection = SECTION_TAG;
        menu.addMenuItem(more);
    }
    _addSep(menu);
}

export function clearSnapshotSection(menu) {
    for (const item of menu._getMenuItems().filter(i => i._devwatchSection === SECTION_TAG))
        item.destroy();
}

function _buildRow(snap, onRestore, onDelete) {
    const item = new PopupMenu.PopupMenuItem('', { reactive: false });
    const row  = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER})
    row.spacing = 8;

    row.add_child(new St.Label({ text: _truncate(snap.label ?? 'auto', 22), style_class: 'dw-snap-name' }));
    row.add_child(new St.Label({ text: _formatDate(snap.savedAt), style_class: 'dw-snap-meta' }));

    if (snap.projectCount != null) {
        row.add_child(new St.Label({
            text: `${snap.projectCount} app${snap.projectCount !== 1 ? 's' : ''}`,
            style_class: 'dw-muted',
            width: 46,
            y_align: Clutter.ActorAlign.CENTER,
        }));
    }

    const loadBtn = new St.Button({ label: 'Load', style_class: 'dw-btn-load', reactive: true, can_focus: true, track_hover: true });
    loadBtn.connect('clicked', () => onRestore?.(snap.filename));
    row.add_child(loadBtn);

    const delBtn = new St.Button({ label: '✕', style_class: 'dw-btn-delete', reactive: true, can_focus: true, track_hover: true });
    delBtn.connect('clicked', () => onDelete?.(snap.filename));
    row.add_child(delBtn);

    item.add_child(row);
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
        return `${day} ${month}  ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    } catch (_) { return iso.slice(0, 16); }
}
function _truncate(s, n) { return s && s.length > n ? s.slice(0, n - 1) + '…' : (s ?? ''); }
function _addSep(menu) {
    const sep = new PopupMenu.PopupSeparatorMenuItem();
    sep._devwatchSection = SECTION_TAG;
    menu.addMenuItem(sep);
}
