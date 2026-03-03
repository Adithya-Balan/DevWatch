/**
 * DevWatch — ui/portSection.js
 *
 * Renders the "Active Ports" section inside the panel dropdown.
 *
 * Layout:
 *   ACTIVE PORTS                             (section title)
 *   ──────────────────────────────────────── (separator)
 *   ● 3000  TCP  node (4821)    backend-api  2h 14m   [Kill]
 *   ● 5432  TCP  postgres       backend-api  5d 3h
 *     8080  TCP  python3        —            12m      [Kill]
 *
 * Dev ports (well-known) are highlighted with a coloured dot.
 * Non-dev system ports are shown dimmed.
 * Kill button appears only when a PID is known for the port.
 *
 * Exports
 * ───────
 *   buildPortSection(menu, scanResult, onKill)
 *   clearPortSection(menu)
 */

import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { _ } from '../utils/i18n.js';

const SECTION_TAG = 'devwatch-ports';

// Max ports to show before truncating (keeps menu manageable)
const MAX_PORTS_SHOWN = 20;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Rebuild the Active Ports section in the given menu.
 *
 * @param {PopupMenu.PopupMenu} menu
 * @param {import('../core/portMonitor.js').PortScanResult} scanResult
 * @param {(pid: number, port: number) => void} onKill
 *   Callback invoked when the user clicks Kill on a port row.
 * @param {boolean} [showSystemPorts=false]
 *   When false (default), only dev ports are rendered; system ports are hidden.
 */
export function buildPortSection(menu, scanResult, onKill, showSystemPorts = false) {
    clearPortSection(menu);

    // ── Section title ──────────────────────────────────────────────────────
    const title = new PopupMenu.PopupMenuItem(_('ACTIVE PORTS'), { reactive: false });
    title.label.style_class = 'devwatch-section-title';
    title._devwatchSection = SECTION_TAG;
    menu.addMenuItem(title);

    const ports = scanResult?.ports ?? [];

    if (ports.length === 0) {
        const empty = new PopupMenu.PopupMenuItem(_('  No listening ports detected'), { reactive: false });
        empty.label.style_class = 'devwatch-dim';
        empty._devwatchSection = SECTION_TAG;
        menu.addMenuItem(empty);

        const sep = new PopupMenu.PopupSeparatorMenuItem();
        sep._devwatchSection = SECTION_TAG;
        menu.addMenuItem(sep);
        return;
    }

    // Separate dev ports from system ports, sort each group by port number
    const devPorts = ports.filter(p => p.isDevPort).sort((a, b) => a.port - b.port);
    // System ports are hidden by default (showSystemPorts pref controls visibility)
    const sysPorts = showSystemPorts
        ? ports.filter(p => !p.isDevPort).sort((a, b) => a.port - b.port)
        : [];

    // Show dev ports first, then system ports (up to MAX_PORTS_SHOWN total)
    const ordered = [...devPorts, ...sysPorts].slice(0, MAX_PORTS_SHOWN);

    for (const record of ordered) {
        const item = _buildPortRow(record, onKill);
        item._devwatchSection = SECTION_TAG;
        menu.addMenuItem(item);
    }

    // Overflow notice
    if (ports.length > MAX_PORTS_SHOWN) {
        const more = new PopupMenu.PopupMenuItem(
            `  … and ${ports.length - MAX_PORTS_SHOWN} more ports`,
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
 * Remove all items tagged as belonging to the ports section.
 * @param {PopupMenu.PopupMenu} menu
 */
export function clearPortSection(menu) {
    const toRemove = menu._getMenuItems().filter(
        item => item._devwatchSection === SECTION_TAG
    );
    for (const item of toRemove) item.destroy();
}

// ── Row builders ───────────────────────────────────────────────────────────────

/**
 * Build one port row as a PopupMenuItem with a custom BoxLayout actor.
 *
 * @param {import('../core/portMonitor.js').PortRecord} record
 * @param {(pid: number, port: number) => void} onKill
 * @returns {PopupMenu.PopupMenuItem}
 */
function _buildPortRow(record, onKill) {
    const item = new PopupMenu.PopupMenuItem('', { reactive: false });

    const row = new St.BoxLayout({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'devwatch-port-row',
    });

    // ── Dev-port dot indicator ─────────────────────────────────────────────
    const dot = new St.Label({
        text: record.isDevPort ? '●' : '○',
        style_class: record.isDevPort ? 'devwatch-dot devwatch-dot-blue' : 'devwatch-dot devwatch-dot-dim',
        y_align: Clutter.ActorAlign.CENTER,
    });

    // ── Port number ────────────────────────────────────────────────────────
    const portLabel = new St.Label({
        text: String(record.port),
        style_class: record.isDevPort ? 'devwatch-port-number' : 'devwatch-port-number devwatch-port-dim',
        width: 52,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // ── Protocol badge ─────────────────────────────────────────────────────
    const protoLabel = new St.Label({
        text: record.protocol.toUpperCase(),
        style_class: 'devwatch-port-proto',
        width: 36,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // ── Process name + PID ─────────────────────────────────────────────────
    const procText = record.processName
        ? `${_truncate(record.processName, 18)}${record.pid ? ` (${record.pid})` : ''}`
        : (record.pid ? `PID ${record.pid}` : '—');

    const procLabel = new St.Label({
        text: procText,
        style_class: 'devwatch-meta',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // ── Project name ───────────────────────────────────────────────────────
    const projText = record.projectRoot
        ? _truncate(GLib.path_get_basename(record.projectRoot), 16)
        : '—';

    const projLabel = new St.Label({
        text: projText,
        style_class: record.projectRoot ? 'devwatch-meta devwatch-project-link' : 'devwatch-dim',
        width: 110,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // ── Runtime ────────────────────────────────────────────────────────────
    const runtimeLabel = new St.Label({
        text: _formatRuntime(record.runtimeMs),
        style_class: 'devwatch-dim',
        width: 52,
        y_align: Clutter.ActorAlign.CENTER,
    });

    row.add_child(dot);
    row.add_child(portLabel);
    row.add_child(protoLabel);
    row.add_child(procLabel);
    row.add_child(projLabel);
    row.add_child(runtimeLabel);

    // ── Copy PID button ────────────────────────────────────────────────────
    if (record.pid) {
        const copyBtn = new St.Button({
            label: '⧉',
            style_class: 'devwatch-copy-button',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        copyBtn.connect('clicked', () => {
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, String(record.pid));
        });
        row.add_child(copyBtn);
    }

    // ── Kill button (only when PID is known) ───────────────────────────────
    if (record.pid && typeof onKill === 'function') {
        const killBtn = new St.Button({
            label: 'Kill',
            style_class: 'devwatch-kill-button',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        killBtn.connect('clicked', () => onKill(record.pid, record.port));
        row.add_child(killBtn);
    }

    item.add_child(row);
    item.label.hide();

    return item;
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

/**
 * Format a runtime in milliseconds to a compact human string.
 * @param {number} ms
 * @returns {string}
 */
function _formatRuntime(ms) {
    if (ms < 60_000)       return `${Math.floor(ms / 1000)}s`;
    if (ms < 3_600_000)    return `${Math.floor(ms / 60_000)}m`;
    if (ms < 86_400_000)   return `${Math.floor(ms / 3_600_000)}h`;
    return `${Math.floor(ms / 86_400_000)}d`;
}

/**
 * Truncate a string with an ellipsis if it exceeds maxLen.
 * @param {string} s
 * @param {number} maxLen
 * @returns {string}
 */
function _truncate(s, maxLen) {
    return s.length <= maxLen ? s : s.slice(0, maxLen - 1) + '…';
}
