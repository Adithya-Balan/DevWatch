/**
 * DevWatch — ui/portSection.js  (v2)
 *
 * Section: "Open Ports"
 *
 * Each row shows:
 *   ● 8000   python · backend-api   2m   [Kill Process]
 *
 * "Kill Process" is visually prominent (not a tiny icon).
 * Project is shown where known; if not linked, process name is shown.
 */

import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { _ } from '../utils/i18n.js';

const SECTION_TAG = 'devwatch-ports';
const MAX_PORTS_SHOWN = 15;

export function buildPortSection(menu, scanResult, onKill, showSystemPorts = false) {
    clearPortSection(menu);

    // Section header
    const titleItem = new PopupMenu.PopupMenuItem('', { reactive: false });
    titleItem._devwatchSection = SECTION_TAG;
    const titleRow = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    titleRow.add_child(new St.Label({ text: _('Open Ports'), style_class: 'dw-section-label' }));
    titleItem.add_child(titleRow);
    titleItem.label.hide();
    menu.addMenuItem(titleItem);

    const ports = scanResult?.ports ?? [];
    if (ports.length === 0) {
        const empty = new PopupMenu.PopupMenuItem(_('  No open ports detected'), { reactive: false });
        empty.label.style_class = 'dw-dim';
        empty._devwatchSection = SECTION_TAG;
        menu.addMenuItem(empty);
        _addSep(menu);
        return;
    }

    const devPorts = ports.filter(p => p.isDevPort).sort((a, b) => a.port - b.port);
    const sysPorts = showSystemPorts
        ? ports.filter(p => !p.isDevPort).sort((a, b) => a.port - b.port)
        : [];

    const ordered = [...devPorts, ...sysPorts].slice(0, MAX_PORTS_SHOWN);
    for (const record of ordered) {
        const item = _buildRow(record, onKill);
        item._devwatchSection = SECTION_TAG;
        menu.addMenuItem(item);
    }

    if (devPorts.length + sysPorts.length > MAX_PORTS_SHOWN) {
        const more = new PopupMenu.PopupMenuItem(
            `  … and ${ports.length - MAX_PORTS_SHOWN} more`, { reactive: false }
        );
        more.label.style_class = 'dw-dim';
        more._devwatchSection = SECTION_TAG;
        menu.addMenuItem(more);
    }

    _addSep(menu);
}

export function clearPortSection(menu) {
    for (const item of menu._getMenuItems().filter(i => i._devwatchSection === SECTION_TAG))
        item.destroy();
}

function _buildRow(record, onKill) {
    const item = new PopupMenu.PopupMenuItem('', { reactive: false });
    const row  = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER})
    row.spacing = 8;

    // Active dot
    row.add_child(new St.Label({
        text: '●',
        style_class: record.isDevPort ? 'dw-port-dot dw-port-dot-active' : 'dw-port-dot dw-port-dot-dim',
    }));

    // Port number
    row.add_child(new St.Label({
        text: String(record.port),
        style_class: record.isDevPort ? 'dw-port-number' : 'dw-port-number-dim',
    }));

    // Human description: "python · backend-api" or "python3" or "PID 1234"
    row.add_child(new St.Label({
        text: _describePort(record),
        style_class: 'dw-port-process',
    }));

    // Uptime
    const runtime = _formatRuntime(record.runtimeMs);
    if (runtime) {
        row.add_child(new St.Label({ text: runtime, style_class: 'dw-service-uptime' }));
    }

    // Prominent Kill button — only when we have a PID
    if (record.pid && typeof onKill === 'function') {
        const killBtn = new St.Button({
            label: 'Kill Process',
            style_class: 'dw-btn-kill',
            reactive: true, can_focus: true, track_hover: true,
        });
        killBtn.connect('clicked', () => onKill(record.pid, record.port));
        row.add_child(killBtn);
    }

    item.add_child(row);
    item.label.hide();
    return item;
}

function _describePort(record) {
    const parts = [];
    if (record.processName) parts.push(_cleanName(record.processName));
    if (record.projectRoot) parts.push(_truncate(GLib.path_get_basename(record.projectRoot), 20));
    if (parts.length) return parts.join(' · ');
    return record.pid ? `PID ${record.pid}` : '—';
}

function _cleanName(name) {
    return name.replace(/^python\d+(\.\d+)?$/, 'python');
}

function _formatRuntime(ms) {
    if (!ms || ms < 2000)  return '';
    if (ms < 60_000)       return `${Math.floor(ms / 1000)}s`;
    if (ms < 3_600_000)    return `${Math.floor(ms / 60_000)}m`;
    if (ms < 86_400_000)   return `${Math.floor(ms / 3_600_000)}h`;
    return `${Math.floor(ms / 86_400_000)}d`;
}
function _truncate(s, n) { return s && s.length > n ? s.slice(0, n - 1) + '…' : (s ?? ''); }
function _addSep(menu) {
    const sep = new PopupMenu.PopupSeparatorMenuItem();
    sep._devwatchSection = SECTION_TAG;
    menu.addMenuItem(sep);
}
