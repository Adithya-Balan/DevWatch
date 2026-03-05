/**
 * DevWatch — ui/projectSection.js  (v2)
 *
 * Section: "Running Projects"
 *
 * Level 1 (always visible):
 *   🟢 my-project          4 processes · 151 MB
 *
 * Level 2 (expand → sub-menu):
 *   python server     port 8000     2m
 *   bash (terminal)
 *
 *   [Stop Project]  [Open Terminal]
 *
 * Design goals:
 *  - Service-oriented, not process-dump
 *  - No raw PID / state codes exposed at top level
 *  - Stop Project is a first-class action
 */

import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { _ } from '../utils/i18n.js';

const SECTION_TAG = 'devwatch-projects';

// ── Public API ─────────────────────────────────────────────────────────────────

export function buildProjectSection(menu, projectMap, portResult) {
    clearProjectSection(menu);

    // Build a pid→port lookup so we can label processes by port
    const pidToPort = new Map();
    for (const p of (portResult?.ports ?? [])) {
        if (p.pid) pidToPort.set(p.pid, p.port);
    }

    // Section title
    const titleItem = new PopupMenu.PopupMenuItem('', { reactive: false });
    titleItem._devwatchSection = SECTION_TAG;
    const titleRow = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    titleRow.add_child(new St.Label({ text: _('Running Projects'), style_class: 'dw-section-label' }));
    titleItem.add_child(titleRow);
    titleItem.label.hide();
    menu.addMenuItem(titleItem);

    if (!projectMap || projectMap.size === 0) {
        const empty = new PopupMenu.PopupMenuItem(
            _('  Open an editor or terminal to start a project'), { reactive: false }
        );
        empty.label.style_class = 'dw-dim';
        empty._devwatchSection = SECTION_TAG;
        menu.addMenuItem(empty);
        _addSep(menu, SECTION_TAG);
        return;
    }

    const sorted = [...projectMap.values()].sort((a, b) => b.totalCpuPercent - a.totalCpuPercent);
    for (const project of sorted) {
        const item = _buildProjectRow(project, pidToPort);
        item._devwatchSection = SECTION_TAG;
        menu.addMenuItem(item);
    }
    _addSep(menu, SECTION_TAG);
}

export function clearProjectSection(menu) {
    for (const item of menu._getMenuItems().filter(i => i._devwatchSection === SECTION_TAG))
        item.destroy();
}

// ── Row builders ───────────────────────────────────────────────────────────────

function _buildProjectRow(project, pidToPort) {
    const sub = new PopupMenu.PopupSubMenuMenuItem('', true);
    sub.label.text = '';

    // ── Level 1 header ─────────────────────────────────────────────────────
    const header = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER})
    header.spacing = 4;

    // Health dot
    const dot = new St.Label({
        text: '●',
        style_class: `dw-project-dot ${_projectDotClass(project)}`,
    });
    header.add_child(dot);

    // Project name
    header.add_child(new St.Label({
        text: project.name,
        style_class: 'dw-project-name',
    }));

    // Summary: "4 processes · 151 MB"
    const ram = _formatKb(project.totalMemKb);
    const count = project.processes.length;
    header.add_child(new St.Label({
        text: `${count} ${count === 1 ? 'process' : 'processes'} · ${ram}`,
        style_class: 'dw-project-stats',
    }));

    sub.label.get_parent().insert_child_above(header, sub.label);

    // ── Level 2: service list ──────────────────────────────────────────────
    const services = _toServices(project, pidToPort);
    for (const svc of services) {
        sub.menu.addMenuItem(_buildServiceRow(svc));
    }
    if (services.length === 0) {
        const empty = new PopupMenu.PopupMenuItem('  No visible services', { reactive: false });
        empty.label.style_class = 'dw-dim';
        sub.menu.addMenuItem(empty);
    }

    sub.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // ── Actions ────────────────────────────────────────────────────────────
    const actionsItem = new PopupMenu.PopupMenuItem('', { reactive: false });
    const actionsRow = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER})
    actionsRow.spacing = 6;

    const stopBtn = new St.Button({
        label: '⏹  Stop Project',
        style_class: 'dw-btn-stop',
        reactive: true, can_focus: true, track_hover: true,
    });
    stopBtn.connect('clicked', () => _stopProject(project));
    actionsRow.add_child(stopBtn);

    const termBtn = new St.Button({
        label: '⌨  Open Terminal',
        style_class: 'dw-open-term',
        reactive: true, can_focus: true, track_hover: true,
    });
    termBtn.connect('clicked', () => _openTerminalAt(project.root));
    actionsRow.add_child(termBtn);

    actionsItem.add_child(actionsRow);
    actionsItem.label.hide();
    sub.menu.addMenuItem(actionsItem);

    return sub;
}

function _buildServiceRow(svc) {
    const item = new PopupMenu.PopupMenuItem('', { reactive: false });
    const row  = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER})
    row.spacing = 8;

    row.add_child(new St.Label({ text: svc.displayName, style_class: 'dw-service-name' }));

    if (svc.port) {
        row.add_child(new St.Label({ text: `port ${svc.port}`, style_class: 'dw-service-port' }));
    }
    if (svc.state) {
        row.add_child(new St.Label({
            text: svc.stateSymbol,
            style_class: `dw-proc-state ${svc.stateClass}`,
        }));
    }

    item.add_child(row);
    item.label.hide();
    return item;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Convert raw processes into service-level items.
 * Prioritises processes that own ports, then filters out noise.
 */
function _toServices(project, pidToPort) {
    const seen = new Set();
    const result = [];

    // Processes with a port first → they are "servers"
    const withPort = project.processes
        .filter(p => pidToPort.has(p.pid))
        .sort((a, b) => b.cpuPercent - a.cpuPercent);

    for (const p of withPort) {
        result.push({
            displayName: _cleanProcessName(p.name),
            port: pidToPort.get(p.pid),
            stateSymbol: _stateSymbol(p.state),
            stateClass:  _stateClass(p.state),
            state: p.state,
        });
        seen.add(p.pid);
    }

    // Remaining meaningful processes (skip noise)
    const rest = project.processes
        .filter(p => !seen.has(p.pid) && !_isNoise(p.name))
        .sort((a, b) => b.cpuPercent - a.cpuPercent)
        .slice(0, Math.max(0, 6 - result.length));

    for (const p of rest) {
        result.push({
            displayName: _cleanProcessName(p.name),
            port: null,
            stateSymbol: _stateSymbol(p.state),
            stateClass:  _stateClass(p.state),
            state: p.state,
        });
    }

    return result;
}

/** Return a CSS class for the project health dot. */
function _projectDotClass(project) {
    const hasZombie = project.processes.some(p => p.state === 'Z');
    if (hasZombie) return 'dw-project-dot-red';
    if (project.totalCpuPercent > 80) return 'dw-project-dot-yellow';
    return 'dw-project-dot-green';
}

/** Remove path prefixes, pythonX → python, keep it short. */
function _cleanProcessName(name) {
    let n = name.replace(/\/.*\//, '');         // strip path
    n = n.replace(/^python\d+(\.\d+)?$/, 'python');
    n = n.replace(/^node$/, 'Node.js');
    n = n.replace(/^ruby\d*$/, 'ruby');
    return _truncate(n, 24);
}

function _isNoise(name) {
    return /^(sh|bash|dash|cat|grep|awk|sed|tail)$/.test(name);
}

function _stateSymbol(s) {
    return { R: '●', S: '○', D: '◔', Z: '✕', T: '‖', I: '○' }[s] ?? '○';
}
function _stateClass(s) {
    if (s === 'R') return 'dw-proc-green';
    if (s === 'Z') return 'dw-proc-red';
    if (s === 'D') return 'dw-proc-warn';
    return 'dw-proc-dim';
}

function _formatKb(kb) {
    if (!kb || kb < 1024)        return `${kb ?? 0} KB`;
    if (kb < 1024 * 1024)        return `${(kb / 1024).toFixed(0)} MB`;
    return `${(kb / 1024 / 1024).toFixed(1)} GB`;
}
function _truncate(s, n) { return s && s.length > n ? s.slice(0, n - 1) + '…' : (s ?? ''); }
function _addSep(menu, tag) {
    const sep = new PopupMenu.PopupSeparatorMenuItem();
    sep._devwatchSection = tag;
    menu.addMenuItem(sep);
}

function _stopProject(project) {
    for (const proc of project.processes) {
        try {
            const sub = new Gio.Subprocess({ argv: ['kill', String(proc.pid)], flags: Gio.SubprocessFlags.NONE });
            sub.init(null);
        } catch (_) {}
    }
}
function _openTerminalAt(root) {
    const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
    if (root) launcher.set_cwd(root);
    for (const argv of [['gnome-terminal'], ['xterm']]) {
        try { launcher.spawnv(argv); return; } catch (_) {}
    }
}
