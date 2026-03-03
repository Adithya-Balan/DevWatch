/**
 * DevWatch — ui/cleanupSection.js
 *
 * Renders the "Cleanup Candidates" section inside the panel dropdown.
 *
 * Layout (candidates present):
 *   CLEANUP CANDIDATES              [Clean All]   ← section title + bulk action
 *   ──────────────────────────────────────────────
 *   ☠ node      (4821)  ZOMBIE  128 MB  backend-api  [Kill]
 *   ⚱ nodemon   (5100)  ORPHAN   28 MB  —            [Kill]
 *   ⏸ vite      (6200)  IDLE     8 MB   frontend     [Kill]
 *
 * Layout (nothing to clean):
 *   CLEANUP CANDIDATES
 *   ──────────────────────────────────────────────
 *     ✓ No cleanup candidates
 *
 * Reason icons:
 *   ☠  zombie   — already dead, un-reaped
 *   ⚱  orphan   — dev tool with no parent / project
 *   ⏸  idle_dev — long-running tool doing nothing
 *
 * Exports
 * ───────
 *   buildCleanupSection(menu, cleanupResult, onKill)
 *   clearCleanupSection(menu)
 */

import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { _ } from '../utils/i18n.js';

const SECTION_TAG = 'devwatch-cleanup';

// Reason metadata — icon, CSS class suffix, badge label
const REASON_META = {
    zombie:   { icon: '☠', badge: 'ZOMBIE', cssClass: 'zombie'   },
    orphan:   { icon: '⚱', badge: 'ORPHAN', cssClass: 'orphan'   },
    idle_dev: { icon: '⏸', badge: 'IDLE',   cssClass: 'idle-dev' },
};

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Rebuild the Cleanup Candidates section.
 *
 * @param {PopupMenu.PopupMenu} menu
 * @param {import('../core/cleanupEngine.js').CleanupResult} cleanupResult
 * @param {(pid: number) => void} onKill
 *   Callback invoked when the user clicks Kill on a candidate row.
 */
export function buildCleanupSection(menu, cleanupResult, onKill) {
    clearCleanupSection(menu);

    const candidates = cleanupResult?.candidates ?? [];

    // ── Section title row ──────────────────────────────────────────────────
    const titleItem = new PopupMenu.PopupMenuItem('', { reactive: false });
    titleItem._devwatchSection = SECTION_TAG;

    const titleRow = new St.BoxLayout({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const titleLabel = new St.Label({
        text: _('CLEANUP CANDIDATES'),
        style_class: 'devwatch-section-title',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    titleRow.add_child(titleLabel);

    // "Clean All" button — only when there are killable candidates
    const killable = candidates.filter(c => c.reason !== 'zombie'); // zombies can't be kill'd by us
    if (killable.length > 0) {
        const cleanAllBtn = new St.Button({
            label: _('Clean All (%d)').format(killable.length),
            style_class: 'devwatch-clean-all-button',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        cleanAllBtn.connect('clicked', () => {
            for (const c of killable) onKill(c.pid);
        });
        titleRow.add_child(cleanAllBtn);
    }

    titleItem.add_child(titleRow);
    titleItem.label.hide();
    menu.addMenuItem(titleItem);

    // ── Empty state ────────────────────────────────────────────────────────
    if (candidates.length === 0) {
        const ok = new PopupMenu.PopupMenuItem(_('  ✓ No cleanup candidates'), { reactive: false });
        ok.label.style_class = 'devwatch-cleanup-ok';
        ok._devwatchSection = SECTION_TAG;
        menu.addMenuItem(ok);

        const sep = new PopupMenu.PopupSeparatorMenuItem();
        sep._devwatchSection = SECTION_TAG;
        menu.addMenuItem(sep);
        return;
    }

    // ── One row per candidate ──────────────────────────────────────────────
    for (const candidate of candidates) {
        const item = _buildCandidateRow(candidate, onKill);
        item._devwatchSection = SECTION_TAG;
        menu.addMenuItem(item);
    }

    const sep = new PopupMenu.PopupSeparatorMenuItem();
    sep._devwatchSection = SECTION_TAG;
    menu.addMenuItem(sep);
}

/**
 * Remove all items tagged as belonging to the cleanup section.
 * @param {PopupMenu.PopupMenu} menu
 */
export function clearCleanupSection(menu) {
    const toRemove = menu._getMenuItems().filter(
        item => item._devwatchSection === SECTION_TAG
    );
    for (const item of toRemove) item.destroy();
}

// ── Row builder ────────────────────────────────────────────────────────────────

/**
 * @param {import('../core/cleanupEngine.js').CleanupCandidate} candidate
 * @param {(pid: number) => void} onKill
 * @returns {PopupMenu.PopupMenuItem}
 */
function _buildCandidateRow(candidate, onKill) {
    const item = new PopupMenu.PopupMenuItem('', { reactive: false });

    const row = new St.BoxLayout({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'devwatch-cleanup-row',
    });

    const meta = REASON_META[candidate.reason] ?? REASON_META.orphan;

    // ── Reason icon ────────────────────────────────────────────────────────
    const icon = new St.Label({
        text: meta.icon,
        style_class: `devwatch-cleanup-icon devwatch-cleanup-icon-${meta.cssClass}`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // ── Process name + PID ─────────────────────────────────────────────────
    const nameLabel = new St.Label({
        text: `${_truncate(candidate.name, 16)} (${candidate.pid})`,
        style_class: 'devwatch-meta',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // ── Reason badge ───────────────────────────────────────────────────────
    const badgeLabel = new St.Label({
        text: meta.badge,
        style_class: `devwatch-cleanup-badge devwatch-cleanup-badge-${meta.cssClass}`,
        width: 52,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // ── Memory ────────────────────────────────────────────────────────────
    const memLabel = new St.Label({
        text: _formatKb(candidate.memKb),
        style_class: 'devwatch-dim',
        width: 52,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // ── Project name or dash ───────────────────────────────────────────────
    const projText = candidate.projectRoot
        ? _truncate(GLib.path_get_basename(candidate.projectRoot), 16)
        : '—';
    const projLabel = new St.Label({
        text: projText,
        style_class: candidate.projectRoot ? 'devwatch-meta devwatch-project-link' : 'devwatch-dim',
        width: 110,
        y_align: Clutter.ActorAlign.CENTER,
    });

    row.add_child(icon);
    row.add_child(nameLabel);
    row.add_child(badgeLabel);
    row.add_child(memLabel);
    row.add_child(projLabel);

    // ── Kill button ────────────────────────────────────────────────────────
    // Zombie processes cannot be killed by us (their parent must reap them),
    // but we show a greyed-out label so the user understands the situation.
    if (candidate.reason === 'zombie') {
        const waitingLabel = new St.Label({
            text: 'awaiting reap',
            style_class: 'devwatch-dim',
            y_align: Clutter.ActorAlign.CENTER,
        });
        row.add_child(waitingLabel);
    } else {
        const killBtn = new St.Button({
            label: 'Kill',
            style_class: 'devwatch-kill-button',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        killBtn.connect('clicked', () => onKill(candidate.pid));
        row.add_child(killBtn);
    }

    item.add_child(row);
    item.label.hide();

    return item;
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

function _formatKb(kb) {
    if (kb < 1024)         return `${kb} KB`;
    if (kb < 1024 * 1024)  return `${(kb / 1024).toFixed(0)} MB`;
    return `${(kb / 1024 / 1024).toFixed(1)} GB`;
}

function _truncate(s, maxLen) {
    return s.length <= maxLen ? s : s.slice(0, maxLen - 1) + '…';
}
