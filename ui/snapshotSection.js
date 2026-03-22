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
import GLib from 'gi://GLib';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { _ } from '../utils/i18n.js';

const SECTION_TAG = 'devwatch-snapshots';
const SNAPSHOT_SCROLL_THRESHOLD = 3;
const SNAPSHOT_SCROLL_HEIGHT_PX = 252;

export function buildSnapshotSection(menu, snapshots, callbacks, lastWorkspace = null) {
    const { onSave, onRestore, onDelete } = callbacks ?? {};

    // Anchor Sessions directly after the Open Ports section to keep a strict,
    // stable layout regardless of partial/optimistic re-renders.
    const previousItems = menu._getMenuItems ? menu._getMenuItems() : [];
    let mountIndex = -1;
    for (let i = previousItems.length - 1; i >= 0; i--) {
        if (previousItems[i]?._devwatchSection === 'devwatch-ports') {
            mountIndex = i + 1;
            break;
        }
    }
    if (mountIndex < 0) {
        // Fallback: keep previous snapshot position if Open Ports isn't present.
        mountIndex = previousItems.findIndex(i => i === menu._devwatchSnapshotSub || i?._devwatchSection === SECTION_TAG);
    }

    // Preserve any in-progress naming state across a full rebuild, then
    // rebuild the entire snapshot submenu freshly. Rebuilding guarantees the
    // submenu and header are inserted in the correct order (prevents the
    // 'Save' header drifting to the top of the menu).
    const preservedNamingText = menu._devwatchSnapshotNamingText ?? null;
    const preservedNamingOpen = !!menu._devwatchSnapshotNamingOpen;
    // Clear previous snapshot section so we can rebuild deterministically
    clearSnapshotSection(menu);

    const sub = new PopupMenu.PopupSubMenuMenuItem('', false);
    menu._devwatchSnapshotSub = sub;
    sub._devwatchSection = SECTION_TAG;

    // ── Header row (create once; reuse on subsequent refreshes) ───────────
    // Controls declared in outer scope so handlers can reference them.
    let saveBtn, entry, confirmBtn, cancelBtn;
    let headerRow = menu._devwatchSnapshotHeaderRow;
    let namingItem = menu._devwatchNamingItem;
    const headerWasNew = !headerRow;
    if (headerWasNew) {
        headerRow = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        headerRow.set_style('margin-top: 8px; margin-bottom: 6px; margin-right: 4px;');
        headerRow._devwatchSection = SECTION_TAG;
        menu._devwatchSnapshotHeaderRow = headerRow;

        // Give x_expand directly to the label as a GObject property (not CSS).
        const sectionLabel = new St.Label({
            text: _('Sessions'),
            style_class: 'dw-section-label',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        headerRow.add_child(sectionLabel);

        saveBtn = new St.Button({
            label: _('Save'),
            style_class: 'dw-session-btn-save',
            reactive: true, can_focus: true, track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        headerRow.add_child(saveBtn);

        // ── Inline naming row ─────────────────────────────────────────
        namingItem = new PopupMenu.PopupMenuItem('', { reactive: false });
        namingItem.add_style_class_name('dw-session-naming-row');
        const namingBox = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        namingBox.set_style('margin-top: 4px; margin-bottom: 8px; margin-right: 6px; margin-left: 6px;');
        namingBox.spacing = 16;

        entry = new St.Entry({
            hint_text: _('Session name…'),
            style_class: 'dw-snap-entry',
            x_expand: true,
            can_focus: true,
        });
        entry.clutter_text.set_max_length(40);
        // Restore any in-progress text typed before a rebuild
        if (menu._devwatchSnapshotNamingText)
            entry.set_text(menu._devwatchSnapshotNamingText);

        // Persist typed text across background refreshes so user input isn't lost
        entry.clutter_text.connect('text-changed', () => {
            menu._devwatchSnapshotNamingText = entry.get_text();
        });

        confirmBtn = new St.Button({
            label: _('Confirm'),
            style_class: 'dw-session-btn-resume',
            reactive: true, can_focus: true, track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        cancelBtn = new St.Button({
            label: _('Close'),
            style_class: 'dw-session-btn-cancel',
            reactive: true, can_focus: true, track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Add a little extra breathing room between entry and buttons
        confirmBtn.set_style('margin-left: 12px;');
        cancelBtn.set_style('margin-left: 8px;');

        namingBox.add_child(entry);
        namingBox.add_child(confirmBtn);
        namingBox.add_child(cancelBtn);
        namingItem.add_child(namingBox);
        namingItem.label.hide();
        namingItem._devwatchSection = SECTION_TAG;
        // Keep a persistent reference so we can avoid destroying it during background
        // refreshes (prevents visual blinking while the user is typing).
        menu._devwatchNamingItem = namingItem;
    } else {
        // Reuse existing namingItem/headerRow; do not recreate controls.
        namingItem = menu._devwatchNamingItem;
        // Try to locate existing controls to wire handlers and preserve state
        try {
            const hdrChildren = headerRow.get_children();
            for (const c of hdrChildren) {
                if (c instanceof St.Button && c.get_label && c.get_label() === _('Save')) { saveBtn = c; break; }
            }
        } catch (_) { saveBtn = null; }
        try {
            const nb = namingItem.get_children()[0];
            const parts = nb.get_children();
            entry = parts[0];
            confirmBtn = parts[1];
            cancelBtn = parts[2];
        } catch (_) { entry = confirmBtn = cancelBtn = null; }
    }

    const _showNaming = () => {
        sub.setSubmenuShown(true);
        // Persist the naming-open state so periodic refreshes re-open it
        menu._devwatchSnapshotNamingOpen = true;
        saveBtn.reactive = false;
        saveBtn.opacity  = 80;
        // keep any typed text (do not clear) to avoid losing input
        namingItem.visible = true;
        entry.grab_key_focus();
    };
    const _hideNaming = () => {
        // Clear persisted flag so rebuild will keep it closed
        menu._devwatchSnapshotNamingOpen = false;
        namingItem.visible = false;
        // Clear persisted in-progress text when user explicitly hides
        menu._devwatchSnapshotNamingText = null;
        saveBtn.reactive = true;
        saveBtn.opacity  = 255;
    };

    if (saveBtn) try { saveBtn.connect('clicked', _showNaming); } catch (_) {}
    if (cancelBtn) try { cancelBtn.connect('clicked', _hideNaming); } catch (_) {}
    if (confirmBtn) {
        try {
            confirmBtn.connect('clicked', () => {
                const label = entry.get_text().trim() || 'auto';
                // Keep the naming UI open so the user can continue working.
                // Immediate UI feedback: show saving state on the Save button
                if (saveBtn) saveBtn.label = _('Saving…');
                if (saveBtn) saveBtn.reactive = false;
                // Fire-and-forget the save operation via callback
                try { onSave?.(label); } catch (_) {}
            });
        } catch (_) {}
    }
    if (entry) {
        try {
            entry.clutter_text.connect('activate', () => {
                const label = entry.get_text().trim() || 'auto';
                if (saveBtn) saveBtn.label = _('Saving…');
                if (saveBtn) saveBtn.reactive = false;
                try { onSave?.(label); } catch (_) {}
            });
        } catch (_) {}
    }

    if (headerWasNew) {
        // Newly created header — add submenu then insert header above its label.
        if (mountIndex >= 0) menu.addMenuItem(sub, mountIndex);
        else menu.addMenuItem(sub);
        sub.label.get_parent().insert_child_above(headerRow, sub.label);
        sub.label.hide();
    } else {
        // Header already exists; ensure the submenu is present in the menu
        // and do not re-insert the header to avoid shifting layout.
        if (!sub.actor.get_parent()) menu.addMenuItem(sub);
    }
    // Give the session sub-menu a consistent top gap so the first card is
    // flush with subsequent ones (sub-menu CSS has padding-top: 0 by default).
    sub.menu.actor.set_style('padding-top: 5px;');
    sub.menu.addMenuItem(namingItem, 0);
    namingItem.visible = false;
    // Restore preserved naming state (do not clear typed text unless user closed)
    if (preservedNamingText) menu._devwatchSnapshotNamingText = preservedNamingText;
    if (preservedNamingOpen) {
        menu._devwatchSnapshotNamingOpen = true;
        menu._devwatchNamingItem.visible = true;
        sub.setSubmenuShown(true);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => { try { entry.grab_key_focus(); } catch (_) {}; return GLib.SOURCE_REMOVE; });
    }

    // ── Session list ────────────────────────────────────────────────────────
    const totalItems = (lastWorkspace ? 1 : 0) + (snapshots?.length || 0);

    if (totalItems === 0) {
        const empty = new PopupMenu.PopupMenuItem(_('  No saved sessions yet'), { reactive: false });
        empty.label.style_class = 'dw-session-subtitle';
        sub.menu.addMenuItem(empty);
        _addSep(menu, mountIndex >= 0 ? mountIndex + 1 : undefined);
        return;
    }

    let targetMenu = sub.menu;

    if (totalItems > SNAPSHOT_SCROLL_THRESHOLD) {
        const scrollerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            activate: false,
        });
        scrollerItem.add_style_class_name('dw-section-scroll-item');
        scrollerItem._devwatchSection = SECTION_TAG;

        const scrollView = new St.ScrollView({
            style_class: 'dw-section-scroll dw-section-scroll-snapshots',
            overlay_scrollbars: false,
            reactive: true,
            enable_mouse_scrolling: true,
            x_expand: true,
            y_expand: false,
        });
        scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        scrollView.set_height(SNAPSHOT_SCROLL_HEIGHT_PX);

        const scrollSection = new PopupMenu.PopupMenuSection();
        scrollView.set_child(scrollSection.actor);
        scrollerItem.add_child(scrollView);
        
        sub.menu.addMenuItem(scrollerItem);
        targetMenu = scrollSection;
    }

    if (lastWorkspace) {
        const item = _buildRow(lastWorkspace, true, onRestore, onDelete);
        item._devwatchSection = SECTION_TAG;
        targetMenu.addMenuItem(item);
    }

    if (snapshots && snapshots.length > 0) {
        for (const snap of snapshots) {
            const item = _buildRow(snap, false, onRestore, onDelete);
            item._devwatchSection = SECTION_TAG;
            targetMenu.addMenuItem(item);
        }
    }
    
    _addSep(menu, mountIndex >= 0 ? mountIndex + 1 : undefined);
}

export function clearSnapshotSection(menu) {
    // The custom Sessions header row is inserted directly into the sub-menu
    // title actor hierarchy, so clean it up explicitly during rebuild.
    if (menu._devwatchSnapshotHeaderRow) {
        menu._devwatchSnapshotHeaderRow.destroy();
        menu._devwatchSnapshotHeaderRow = null;
    }

    for (const item of menu._getMenuItems().filter(i => i._devwatchSection === SECTION_TAG)) {
        item.destroy();
    }
    menu._devwatchSnapshotSub = null;
    menu._devwatchNamingItem = null;
}

function _buildRow(snap, isLastWorkspace, onRestore, onDelete) {
    const item = new PopupMenu.PopupMenuItem('', { reactive: false });
    item.add_style_class_name(isLastWorkspace ? 'dw-session-card-primary' : 'dw-session-card');

    // Overall horizontal layout
    const outer = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    outer.spacing = 14;

    // Left container for Title + Subtitle
    const textStack = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    textStack.spacing = 2; // Fixed vertical spacing between text lines
    
    const titleBox = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
    titleBox.spacing = 8;
    
    if (isLastWorkspace) {
        titleBox.add_child(new St.Icon({
            icon_name: 'document-open-recent-symbolic',
            icon_size: 13,
            style_class: 'dw-session-icon-primary'
        }));
        titleBox.add_child(new St.Label({
            text: _(' Last Workspace'),
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
    actionBox.spacing = 10;

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
        delBtn.connect('clicked', () => {
            // Optimistic UI: remove the row immediately to avoid blocking
            try {
                delBtn.reactive = false;
                // Destroy item so UI updates instantly
                item.destroy();
            } catch (_) {}
            try { onDelete?.(snap.filename); } catch (_) {}
        });
        actionBox.add_child(delBtn);
    } else {
        // Spacer for consistent alignment with normal cards having a trash button
        const spacer = new St.Widget({
            width: 34, // roughly matches trash icon button width
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
function _addSep(menu, position = undefined) {
    // Remove existing separators for this section to avoid duplicates
    try {
        for (const it of menu._getMenuItems().filter(i => i._devwatchSection === SECTION_TAG)) {
            if (it instanceof PopupMenu.PopupSeparatorMenuItem) {
                try { it.destroy(); } catch (_) {}
            }
        }
    } catch (_) {}
    const sep = new PopupMenu.PopupSeparatorMenuItem();
    sep._devwatchSection = SECTION_TAG;
    if (Number.isInteger(position) && position >= 0) menu.addMenuItem(sep, position);
    else menu.addMenuItem(sep);
}
