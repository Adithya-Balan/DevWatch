/**
 * DevWatch — ui/projectSection.js
 *
 * Renders the "Active Projects" section inside the panel dropdown.
 *
 * Layout (per project):
 *   ▸ my-project  [3 proc · CPU 4.2% · RAM 312 MB]
 *     node server.js (4821)        S  CPU 1.2%  RAM 128 MB
 *     postgres       (4900)        S  CPU 0.8%  RAM  96 MB
 *     redis-server   (4981)        S  CPU 0.1%  RAM  12 MB
 *
 * Uses PopupSubMenuMenuItem for expandable project rows,
 * with a custom BoxLayout header showing the aggregate stats.
 *
 * Exports
 * ───────
 *   buildProjectSection(menu, projectMap)
 *     Clears any previous project items and rebuilds from fresh data.
 *   clearProjectSection(menu)
 *     Removes all project section items from the menu.
 */

import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { _ } from '../utils/i18n.js';

// Tags used to identify items belonging to this section (for targeted removal)
const SECTION_TAG = 'devwatch-projects';

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Rebuild the Active Projects section in the given menu.
 *
 * @param {PopupMenu.PopupMenu} menu
 * @param {Map<string, import('../core/processTracker.js').ProjectData>} projectMap
 */
export function buildProjectSection(menu, projectMap) {
    // Remove previous project section items
    clearProjectSection(menu);

    // ── Section title ──────────────────────────────────────────────────────
    const title = new PopupMenu.PopupMenuItem(_('ACTIVE PROJECTS'), { reactive: false });
    title.label.style_class = 'devwatch-section-title';
    title._devwatchSection = SECTION_TAG;
    menu.addMenuItem(title);

    if (!projectMap || projectMap.size === 0) {
        // Empty state
        const empty = new PopupMenu.PopupMenuItem(_('  No dev projects detected'), { reactive: false });
        empty.label.style_class = 'devwatch-dim';
        empty._devwatchSection = SECTION_TAG;
        menu.addMenuItem(empty);

        const hint = new PopupMenu.PopupMenuItem(
            _('  Focus a terminal or editor window to detect a project'),
            { reactive: false }
        );
        hint.label.style_class = 'devwatch-dim';
        hint._devwatchSection = SECTION_TAG;
        menu.addMenuItem(hint);

        const sep = new PopupMenu.PopupSeparatorMenuItem();
        sep._devwatchSection = SECTION_TAG;
        menu.addMenuItem(sep);
        return;
    }

    // ── One row per project ────────────────────────────────────────────────
    const sortedProjects = [...projectMap.values()].sort(
        (a, b) => b.totalCpuPercent - a.totalCpuPercent // highest CPU first
    );

    for (const project of sortedProjects) {
        const item = _buildProjectRow(project);
        item._devwatchSection = SECTION_TAG;
        menu.addMenuItem(item);
    }

    const sep = new PopupMenu.PopupSeparatorMenuItem();
    sep._devwatchSection = SECTION_TAG;
    menu.addMenuItem(sep);
}

/**
 * Remove all items tagged as belonging to the projects section.
 * @param {PopupMenu.PopupMenu} menu
 */
export function clearProjectSection(menu) {
    const toRemove = menu._getMenuItems().filter(
        item => item._devwatchSection === SECTION_TAG
    );
    for (const item of toRemove) item.destroy();
}

// ── Private builders ──────────────────────────────────────────────────────────

/**
 * Build a PopupSubMenuMenuItem for a single project.
 *
 * @param {import('../core/processTracker.js').ProjectData} project
 * @returns {PopupMenu.PopupSubMenuMenuItem}
 */
function _buildProjectRow(project) {
    const subMenu = new PopupMenu.PopupSubMenuMenuItem('', true);

    // Replace the default label content with a BoxLayout for richer layout
    subMenu.label.text = '';

    const headerBox = new St.BoxLayout({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'devwatch-project-header',
    });

    // Project name
    const nameLabel = new St.Label({
        text: project.name,
        style_class: 'devwatch-project-name',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // Stats pill: "3 proc · CPU 4.2% · RAM 312 MB"
    const statsLabel = new St.Label({
        text: _formatProjectStats(project),
        style_class: 'devwatch-meta',
        y_align: Clutter.ActorAlign.CENTER,
    });

    headerBox.add_child(nameLabel);
    headerBox.add_child(statsLabel);

    // Insert the header box into the sub-menu's actor
    subMenu.label.get_parent().insert_child_above(headerBox, subMenu.label);

    // ── Per-process sub-items ──────────────────────────────────────────────
    // Sort by CPU descending, show at most 10 processes
    const topProcesses = [...project.processes]
        .sort((a, b) => b.cpuPercent - a.cpuPercent)
        .slice(0, 10);

    for (const proc of topProcesses) {
        const procItem = _buildProcessRow(proc);
        subMenu.menu.addMenuItem(procItem);
    }

    if (project.processes.length > 10) {
        const moreItem = new PopupMenu.PopupMenuItem(
            `  … and ${project.processes.length - 10} more processes`,
            { reactive: false }
        );
        moreItem.label.style_class = 'devwatch-dim';
        subMenu.menu.addMenuItem(moreItem);
    }

    // ── Project actions ────────────────────────────────────────────────────
    subMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    const termItem = new PopupMenu.PopupMenuItem('⎋  Open terminal here');
    termItem.label.style_class = 'devwatch-open-terminal-item';
    termItem.connect('activate', () => _openTerminalAt(project.root));
    subMenu.menu.addMenuItem(termItem);

    return subMenu;
}

/**
 * Build a single process row inside a project's sub-menu.
 *
 * @param {import('../core/processTracker.js').ProcessInfo} proc
 * @returns {PopupMenu.PopupMenuItem}
 */
function _buildProcessRow(proc) {
    const item = new PopupMenu.PopupMenuItem('', { reactive: false });

    const box = new St.BoxLayout({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'devwatch-process-row',
    });

    // Process name + PID
    const nameLabel = new St.Label({
        text: `${_truncate(proc.name, 20)} (${proc.pid})`,
        style_class: 'devwatch-meta',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // State indicator
    const stateLabel = new St.Label({
        text: _stateDisplay(proc.state),
        style_class: `devwatch-state devwatch-state-${_stateClass(proc.state)}`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // CPU%
    const cpuLabel = new St.Label({
        text: `CPU ${proc.cpuPercent.toFixed(1)}%`,
        style_class: 'devwatch-meta',
        y_align: Clutter.ActorAlign.CENTER,
    });

    // RAM
    const ramLabel = new St.Label({
        text: `RAM ${_formatKb(proc.memKb)}`,
        style_class: 'devwatch-meta',
        y_align: Clutter.ActorAlign.CENTER,
    });

    box.add_child(nameLabel);
    box.add_child(stateLabel);
    box.add_child(cpuLabel);
    box.add_child(ramLabel);

    // Copy PID button
    const copyBtn = new St.Button({
        label: '⧉',
        style_class: 'devwatch-copy-button',
        y_align: Clutter.ActorAlign.CENTER,
        reactive: true,
        can_focus: true,
        track_hover: true,
    });
    copyBtn.connect('clicked', () => {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, String(proc.pid));
    });
    box.add_child(copyBtn);

    item.add_child(box);
    item.label.hide(); // hide the default empty label

    return item;
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

/**
 * Format aggregate project stats into a short summary string.
 * @param {import('../core/processTracker.js').ProjectData} p
 * @returns {string}
 */
function _formatProjectStats(p) {
    const count = p.processes.length;
    const cpu   = p.totalCpuPercent.toFixed(1);
    const ram   = _formatKb(p.totalMemKb);
    return `${count} proc · CPU ${cpu}% · RAM ${ram}`;
}

/**
 * Format a kilobyte value as a human-readable string.
 * @param {number} kb
 * @returns {string}
 */
function _formatKb(kb) {
    if (kb < 1024)       return `${kb} KB`;
    if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(0)} MB`;
    return `${(kb / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * Truncate a string to maxLen characters, appending '…' if needed.
 * @param {string} s
 * @param {number} maxLen
 * @returns {string}
 */
function _truncate(s, maxLen) {
    return s.length <= maxLen ? s : s.slice(0, maxLen - 1) + '…';
}

/**
 * Map a /proc state character to a human-readable label.
 * @param {string} state
 * @returns {string}
 */
function _stateDisplay(state) {
    const map = { R: 'RUN', S: 'SLP', D: 'WAIT', Z: 'ZOMB', T: 'STOP', I: 'IDLE' };
    return map[state] ?? state;
}

/**
 * Map a /proc state character to a CSS class suffix.
 * @param {string} state
 * @returns {string}
 */
function _stateClass(state) {
    const map = { R: 'running', S: 'sleeping', D: 'waiting', Z: 'zombie', T: 'stopped' };
    return map[state] ?? 'unknown';
}

/**
 * Launch a terminal emulator at the given directory path.
 * Tries gnome-terminal first (Ubuntu default), then xterm as a fallback.
 *
 * @param {string} root  Absolute path to open the terminal in.
 */
function _openTerminalAt(root) {
    const launcher = new Gio.SubprocessLauncher({
        flags: Gio.SubprocessFlags.NONE,
    });
    launcher.set_cwd(root);

    for (const argv of [
        ['gnome-terminal'],
        ['xterm'],
    ]) {
        try {
            launcher.spawnv(argv);
            return;
        } catch (_) { /* try next candidate */ }
    }
    console.warn('[DevWatch] _openTerminalAt: no suitable terminal found for', root);
}
