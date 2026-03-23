/**
 * DevWatch — ui/alertsSection.js
 *
 * Section: "Problems" — appears only when issues are detected.
 * Shown above "Running Projects" so developers see problems first.
 *
 *   Problems
 *   ⚠  tracktite  using 3.2 GB RAM
 *   ⚠  1 zombie process detected
 *   ⚠  node server idle for 2h 14m
 */

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { _ } from '../utils/i18n.js';

const SECTION_TAG = 'devwatch-alerts';

/**
 * @param {PopupMenu.PopupMenu}      menu
 * @param {Map<string, object>}      projectMap
 * @param {{ ports: object[] }}      portResult
 */
export function buildAlertsSection(menu, projectMap, portResult) {
    clearAlertsSection(menu);

    const alerts = _collectAlerts(projectMap, portResult);
    if (alerts.length === 0) return; // Hidden entirely when healthy

    // Section header
    const titleItem = new PopupMenu.PopupMenuItem('', { reactive: false });
    titleItem._devwatchSection = SECTION_TAG;
    const titleRow = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    titleRow.add_child(new St.Label({ text: _('Problems'), style_class: 'dw-alert-section-label' }));
    titleItem.add_child(titleRow);
    titleItem.label.hide();
    menu.addMenuItem(titleItem);

    for (const { text, severity } of alerts) {
        const row = new PopupMenu.PopupMenuItem('', { reactive: false });
        row._devwatchSection = SECTION_TAG;
        row.add_style_class_name('dw-alert-row-item');

        const icon = new St.Label({
            text: severity === 'high' ? '⚠' : '•',
            style_class: severity === 'high' ? 'dw-alert-icon-high' : 'dw-alert-icon-warn',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const label = new St.Label({
            text,
            style_class: severity === 'high' ? 'dw-alert-row-high' : 'dw-alert-row-warn',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        row.add_child(icon);
        row.add_child(label);
        row.label.hide();
        menu.addMenuItem(row);
    }

    _addSep(menu);
}

export function clearAlertsSection(menu) {
    for (const item of menu._getMenuItems().filter(i => i._devwatchSection === SECTION_TAG))
        item.destroy();
}

// ── Alert collection ───────────────────────────────────────────────────────────

function _collectAlerts(projectMap, portResult) {
    const alerts = [];
    const seen = new Set();

    const pushUnique = (projectName, type, text, severity = 'warn') => {
        const key = `${projectName}|${type}`;
        if (seen.has(key))
            return;

        seen.add(key);
        alerts.push({ text, severity });
    };

    // High RAM / CPU per project
    if (projectMap) {
        for (const p of projectMap.values()) {
            const projectName = p.name || _('Unknown project');
            const ramGb = (p.totalMemKb ?? 0) / 1024 / 1024;
            if (ramGb > 2) {
                pushUnique(
                    projectName,
                    'ram',
                    _('%s memory usage is high (%s GB).').format(projectName, ramGb.toFixed(1)),
                    'warn'
                );
            } else if (p.totalCpuPercent > 80) {
                pushUnique(
                    projectName,
                    'cpu',
                    _('%s CPU usage is high (%s%%).').format(projectName, p.totalCpuPercent.toFixed(0)),
                    'warn'
                );
            }
        }
    }

    return alerts.slice(0, 5);
}

function _addSep(menu) {
    const sep = new PopupMenu.PopupSeparatorMenuItem();
    sep._devwatchSection = SECTION_TAG;
    menu.addMenuItem(sep);
}
