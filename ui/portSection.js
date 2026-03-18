/**
 * DevWatch — ui/portSection.js  (v3)
 *
 * Section: "Open Ports"
 *
 * Each row shows project-first:
 *   ● tracktite  ·  Port 8000  ·  Python  ·  31s   [Stop]
 *
 * If no project is linked, shows process type + port.
 * Stop button is neutral (not aggressive red).
 */

import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { _ } from '../utils/i18n.js';

const SECTION_TAG = 'devwatch-ports';
const MAX_PORTS_SHOWN = 15;
const INTERNAL_SCROLL_THRESHOLD = 4;

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

    // Deduplicate by port number (IPv4+IPv6 can produce duplicate entries)
    const seenPorts = new Set();
    const ordered = [...devPorts, ...sysPorts]
        .filter(r => { if (seenPorts.has(r.port)) return false; seenPorts.add(r.port); return true; })
        .slice(0, MAX_PORTS_SHOWN);
    if (ordered.length > INTERNAL_SCROLL_THRESHOLD) {
        const scrollerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            activate: false,
        });
        scrollerItem.add_style_class_name('dw-section-scroll-item');
        scrollerItem._devwatchSection = SECTION_TAG;

        const scrollView = new St.ScrollView({
            style_class: 'dw-section-scroll dw-section-scroll-ports',
            overlay_scrollbars: false,
            reactive: true,
            x_expand: true,
        });
        scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);

        const section = new PopupMenu.PopupMenuSection();
        for (const record of ordered) {
            section.addMenuItem(_buildRow(record, onKill));
        }

        scrollView.set_child(section.actor);
        scrollerItem.add_child(scrollView);
        menu.addMenuItem(scrollerItem);
    } else {
        for (const record of ordered) {
            const item = _buildRow(record, onKill);
            item._devwatchSection = SECTION_TAG;
            menu.addMenuItem(item);
        }
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

    // Vertical outer: line 1 = project/name + Stop; line 2 = detail + runtime
    const outer = new St.BoxLayout({ vertical: true, x_expand: true });
    outer.spacing = 0;

    // ── Line 1: ● project-name  [Stop right-aligned] ─────────────────────
    const line1 = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    line1.spacing = 4;
    line1.add_child(new St.Label({
        text: '●',
        style_class: record.isDevPort ? 'dw-port-dot dw-port-dot-active' : 'dw-port-dot dw-port-dot-dim',
    }));
    const projectLabel = record.projectRoot
        ? _truncate(GLib.path_get_basename(record.projectRoot), 37)
        : (record.processName ? _toServiceLabel(record.processName) : `Port ${record.port}`);
    line1.add_child(new St.Label({
        text: projectLabel,
        style_class: record.isDevPort ? 'dw-port-project' : 'dw-port-number-dim',
        x_expand: true,
    }));
    const hasStop = Boolean(record.pid && typeof onKill === 'function');
    if (hasStop) {
        const stopBtn = new St.Button({
            label: 'Stop',
            style_class: 'dw-btn-stop',
            reactive: true, can_focus: true, track_hover: true,
        });
        stopBtn.connect('clicked', () => onKill(record.pid, record.port));
        line1.add_child(stopBtn);
    }
    outer.add_child(line1);

    // ── Line 2: Port X · Process · runtime  (only when meaningful) ────────
    const detail = _buildDetail(record);
    const runtime = _formatRuntime(record.runtimeMs);
    const detailParts = [detail, runtime].filter(Boolean);
    if (detailParts.length > 0) {
        const line2 = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        line2.add_child(new St.Label({
            text: detailParts.join('  ·  '),
            style_class: 'dw-port-detail',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        outer.add_child(line2);
    }

    item.add_child(outer);
    item.label.hide();
    item.add_style_class_name('dw-port-row');
    return item;
}

/** Build the "Port 8000 · Python" detail line (always shown on line 2). */
function _buildDetail(record) {
    const portPart = `Port ${record.port}`;
    const procPart = record.processName ? _toServiceLabel(record.processName) : null;
    // When line 1 already shows "Port X" (no project, no process), avoid repeating it
    if (!record.projectRoot && !record.processName) return null;
    if (procPart) return `${portPart}  ·  ${procPart}`;
    return portPart;
}

/** Map raw process name to a short human-readable label (no "Server" suffix here). */
function _toServiceLabel(name) {
    if (!name) return '';
    const n = name.replace(/.*\//, '');
    if (/^python\d*(\.\d+)?$/.test(n))  return 'Python';
    if (/^node$/.test(n))               return 'Node.js';
    if (/^ruby\d*$/.test(n))            return 'Ruby';
    if (/^java$/.test(n))               return 'Java';
    if (/^go$/.test(n))                 return 'Go';
    if (/^php/.test(n))                 return 'PHP';
    if (/^uvicorn$/.test(n))            return 'Uvicorn';
    if (/^gunicorn$/.test(n))           return 'Gunicorn';
    if (/^nginx$/.test(n))              return 'Nginx';
    if (/^redis-server$/.test(n))       return 'Redis';
    if (/^mongod$/.test(n))             return 'MongoDB';
    if (/^mysqld?$/.test(n))            return 'MySQL';
    if (/^deno$/.test(n))               return 'Deno';
    if (/^bun$/.test(n))                return 'Bun';
    return _truncate(n, 20);
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
