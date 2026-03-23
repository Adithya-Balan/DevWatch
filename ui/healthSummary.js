/**
 * DevWatch — ui/healthSummary.js
 *
 * Renders the top "Dev Environment" summary bar inside the panel dropdown.
 *
 *   DevWatch                               [↻]
 *   4 projects running · 3 ports open · 4.1 GB RAM
 *   [Clean Dev Environment]   [Stop All]
 *   ⚠ tracktite RAM high (3.1 GB)
 */

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { _ } from '../utils/i18n.js';

const SECTION_TAG = 'devwatch-summary';

/**
 * @param {PopupMenu.PopupMenu}      menu
 * @param {Map<string, object>}      projectMap
 * @param {{ ports: object[] }}      portResult
 * @param {() => void}               onSettings
 * @param {() => void}               onStopAll
 * @param {{ totalActiveMs?: number, focusScore?: number }=} focusInfo
 */
export function buildHealthSummary(menu, projectMap, portResult, onSettings, onStopAll, focusInfo = {}) {
    clearHealthSummary(menu);

    const item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
    item._devwatchSection = SECTION_TAG;

    const outerBox = new St.BoxLayout({
        vertical: false,
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
    });

    // ── Left column: title + stats + actions ──────────────────────────────
    const infoBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    infoBox.spacing = 0;

    infoBox.add_child(new St.Label({ text: _('DevWatch'), style_class: 'dw-summary-title' }));

    // stats line: "4 projects running · 3 ports open · 4.1 GB RAM"
    const statsLine = _buildStatsLine(projectMap, portResult, focusInfo);
    infoBox.add_child(new St.Label({ text: statsLine, style_class: 'dw-summary-stats' }));

    // quick action buttons: [Stop All]
    const actionsRow = new St.BoxLayout({ x_expand: false });
    actionsRow.spacing = 8;

    const stopAllBtn = new St.Button({
        label: _('Stop All Projects'),
        style_class: 'dw-summary-action-btn dw-summary-action-danger',
        reactive: true, can_focus: true, track_hover: true,
    });
    stopAllBtn.connect('clicked', () => onStopAll?.());
    actionsRow.add_child(stopAllBtn);

    infoBox.add_child(actionsRow);

    // proactive alert lines: port conflicts, memory spikes, zombies
    const alertLines = _buildAlertLines(projectMap);
    for (const line of alertLines) {
        infoBox.add_child(new St.Label({ text: line, style_class: 'dw-summary-alert' }));
    }

    outerBox.add_child(infoBox);

    // ── Settings icon button ────────────────────────────────────────────────
    const settingsBtn = new St.Button({
        style_class: 'dw-settings-btn',
        reactive: true, can_focus: true, track_hover: true,
        y_align: Clutter.ActorAlign.START,
    });
    const settingsIcon = new St.Icon({ icon_name: 'preferences-system-symbolic', style_class: 'dw-settings-icon' });
    settingsBtn.set_child(settingsIcon);
    settingsBtn.connect('clicked', () => onSettings?.());
    outerBox.add_child(settingsBtn);

    item.add_child(outerBox);
    menu.addMenuItem(item);

    // separator after header
    const sep = new PopupMenu.PopupSeparatorMenuItem();
    sep._devwatchSection = SECTION_TAG;
    menu.addMenuItem(sep);
}

export function clearHealthSummary(menu) {
    for (const item of menu._getMenuItems().filter(i => i._devwatchSection === SECTION_TAG))
        item.destroy();
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _buildStatsLine(projectMap, portResult, focusInfo = {}) {
    const projectCount = projectMap?.size ?? 0;
    const portCount    = (portResult?.ports ?? []).filter(p => p.isDevPort).length;
    const totalRamKb   = projectMap
        ? [...projectMap.values()].reduce((s, p) => s + (p.totalMemKb ?? 0), 0)
        : 0;

    const parts = [];
    if (projectCount === 0) {
        parts.push(_('No projects detected'));
    } else {
        parts.push(_('%d project(s) running').format(projectCount));
    }
    if (portCount > 0) parts.push(_('%d port(s) open').format(portCount));
    if (totalRamKb > 0) parts.push(_('%s RAM').format(_formatKb(totalRamKb)));

    return parts.join('  ·  ');
}

function _formatDuration(ms) {
    const mins = Math.max(0, Math.round(ms / 60000));
    if (mins < 60)
        return _('%dm').format(mins);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (m === 0)
        return _('%dh').format(h);
    return _('%dh %dm').format(h, m);
}

function _buildAlertLines(projectMap) {
    const alerts = [];

    // High CPU / RAM per project
    if (projectMap) {
        for (const p of projectMap.values()) {
            const ramGb = (p.totalMemKb ?? 0) / 1024 / 1024;
            if (p.totalCpuPercent > 80)
                alerts.push(`⚠  ${p.name}  CPU high (${p.totalCpuPercent.toFixed(0)}%)`);
            else if (ramGb > 2)
                alerts.push(`⚠  ${p.name}  RAM high (${ramGb.toFixed(1)} GB)`);
        }
    }

    return alerts.slice(0, 3);
}

function _formatKb(kb) {
    if (kb < 1024)        return `${kb} KB`;
    if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(0)} MB`;
    return `${(kb / 1024 / 1024).toFixed(1)} GB`;
}
