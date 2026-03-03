/**
 * DevWatch — ui/snapshotSection.js
 *
 * Renders the "Session Snapshots" section inside the panel dropdown.
 *
 * Layout (snapshots exist):
 *   SESSION SNAPSHOTS              [Save Now]   ← title + quick-save button
 *   ──────────────────────────────────────────
 *   📷 before-refactor   03 Mar 14:30   3 proj  [Restore] [✕]
 *   📷 auto              03 Mar 09:15   2 proj  [Restore] [✕]
 *
 * Layout (no snapshots yet):
 *   SESSION SNAPSHOTS              [Save Now]
 *   ──────────────────────────────────────────
 *     No saved snapshots
 *
 * Exports
 * ───────
 *   buildSnapshotSection(menu, snapshots, callbacks)
 *   clearSnapshotSection(menu)
 *
 * The caller (extension.js) is responsible for fetching snapshots via
 * snapshotManager.list() and passing the array here — same stateless
 * pattern as the other sections.
 *
 * callbacks: { onSave, onRestore(filename), onDelete(filename) }
 */

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { _ } from '../utils/i18n.js';

const SECTION_TAG = 'devwatch-snapshots';

// Max snapshot rows to show before truncating
const MAX_ROWS = 5;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * @param {PopupMenu.PopupMenu} menu
 * @param {Array<{filename:string, label:string, savedAt:string, projectCount?:number}>} snapshots
 * @param {{ onSave: ()=>void, onRestore: (f:string)=>void, onDelete: (f:string)=>void }} callbacks
 */
export function buildSnapshotSection(menu, snapshots, callbacks) {
    clearSnapshotSection(menu);

    const { onSave, onRestore, onDelete } = callbacks ?? {};

    // ── Title row with Save Now button ─────────────────────────────────────
    const titleItem = new PopupMenu.PopupMenuItem('', { reactive: false });
    titleItem._devwatchSection = SECTION_TAG;

    const titleRow = new St.BoxLayout({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const titleLabel = new St.Label({
        text: _('SESSION SNAPSHOTS'),
        style_class: 'devwatch-section-title',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    titleRow.add_child(titleLabel);

    const saveBtn = new St.Button({
        label: _('Save Now'),
        style_class: 'devwatch-snapshot-save-button',
        y_align: Clutter.ActorAlign.CENTER,
        reactive: true,
        can_focus: true,
        track_hover: true,
    });
    saveBtn.connect('clicked', () => onSave?.());
    titleRow.add_child(saveBtn);

    titleItem.add_child(titleRow);
    titleItem.label.hide();
    menu.addMenuItem(titleItem);

    // ── Empty state ────────────────────────────────────────────────────────
    if (!snapshots || snapshots.length === 0) {
        const empty = new PopupMenu.PopupMenuItem('  No saved snapshots', { reactive: false });
        empty.label.style_class = 'devwatch-dim';
        empty._devwatchSection = SECTION_TAG;
        menu.addMenuItem(empty);

        const sep = new PopupMenu.PopupSeparatorMenuItem();
        sep._devwatchSection = SECTION_TAG;
        menu.addMenuItem(sep);
        return;
    }

    // ── Snapshot rows ──────────────────────────────────────────────────────
    const shown = snapshots.slice(0, MAX_ROWS);
    for (const snap of shown) {
        const item = _buildSnapshotRow(snap, onRestore, onDelete);
        item._devwatchSection = SECTION_TAG;
        menu.addMenuItem(item);
    }

    if (snapshots.length > MAX_ROWS) {
        const more = new PopupMenu.PopupMenuItem(
            `  … and ${snapshots.length - MAX_ROWS} older snapshots`,
            { reactive: false }
        );
        more.label.style_class = 'devwatch-dim';
        more._devwatchSection = SECTION_TAG;
        menu.addMenuItem(more);
    }

    const sep = new PopupMenu.PopupSeparatorMenuItem();
    sep._devwatchSection = SECTION_TAG;
    menu.addMenuItem(sep);
}

/**
 * Remove all items tagged as belonging to the snapshots section.
 * @param {PopupMenu.PopupMenu} menu
 */
export function clearSnapshotSection(menu) {
    const toRemove = menu._getMenuItems().filter(
        item => item._devwatchSection === SECTION_TAG
    );
    for (const item of toRemove) item.destroy();
}

// ── Row builder ────────────────────────────────────────────────────────────────

/**
 * @param {{ filename:string, label:string, savedAt:string, projectCount?:number }} snap
 * @param {(f:string)=>void} onRestore
 * @param {(f:string)=>void} onDelete
 * @returns {PopupMenu.PopupMenuItem}
 */
function _buildSnapshotRow(snap, onRestore, onDelete) {
    const item = new PopupMenu.PopupMenuItem('', { reactive: false });

    const row = new St.BoxLayout({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'devwatch-snapshot-row',
    });

    // Camera icon
    const icon = new St.Label({
        text: '📷',
        style_class: 'devwatch-snapshot-icon',
        y_align: Clutter.ActorAlign.CENTER,
    });

    // Label (user-supplied or 'auto')
    const labelText = _truncate(snap.label ?? 'auto', 20);
    const labelLbl = new St.Label({
        text: labelText,
        style_class: 'devwatch-snapshot-label',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // Human-readable timestamp
    const timeLbl = new St.Label({
        text: _formatSavedAt(snap.savedAt),
        style_class: 'devwatch-dim',
        width: 90,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // Project count badge
    const countText = snap.projectCount != null
        ? `${snap.projectCount} proj`
        : '';
    const countLbl = new St.Label({
        text: countText,
        style_class: 'devwatch-meta',
        width: 50,
        y_align: Clutter.ActorAlign.CENTER,
    });

    row.add_child(icon);
    row.add_child(labelLbl);
    row.add_child(timeLbl);
    row.add_child(countLbl);

    // Restore button
    const restoreBtn = new St.Button({
        label: 'Restore',
        style_class: 'devwatch-snapshot-restore-button',
        y_align: Clutter.ActorAlign.CENTER,
        reactive: true,
        can_focus: true,
        track_hover: true,
    });
    restoreBtn.connect('clicked', () => onRestore?.(snap.filename));
    row.add_child(restoreBtn);

    // Delete button
    const deleteBtn = new St.Button({
        label: '✕',
        style_class: 'devwatch-snapshot-delete-button',
        y_align: Clutter.ActorAlign.CENTER,
        reactive: true,
        can_focus: true,
        track_hover: true,
    });
    deleteBtn.connect('clicked', () => onDelete?.(snap.filename));
    row.add_child(deleteBtn);

    item.add_child(row);
    item.label.hide();

    return item;
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

/**
 * Format an ISO-8601 savedAt string to a compact display string.
 * "2026-03-03T14:30:00" → "03 Mar 14:30"
 * @param {string} iso
 * @returns {string}
 */
function _formatSavedAt(iso) {
    if (!iso) return '';
    try {
        // iso may be "YYYY-MM-DDTHH:MM:SS" (no timezone — treat as local)
        const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
        if (isNaN(d.getTime())) return iso.slice(0, 16);
        const day   = String(d.getDate()).padStart(2, '0');
        const month = ['Jan','Feb','Mar','Apr','May','Jun',
                       'Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
        const hh    = String(d.getHours()).padStart(2, '0');
        const mm    = String(d.getMinutes()).padStart(2, '0');
        return `${day} ${month} ${hh}:${mm}`;
    } catch (_) {
        return iso.slice(0, 16);
    }
}

function _truncate(s, maxLen) {
    return s.length <= maxLen ? s : s.slice(0, maxLen - 1) + '…';
}
