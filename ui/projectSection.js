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
import { getProjectDurationsByRootToday } from '../utils/focusAggregator.js';

const SECTION_TAG = 'devwatch-projects';
const INTERNAL_SCROLL_THRESHOLD = 5;
const INTERNAL_SCROLL_HEIGHT_PX = 236;

function _withPreservedSearchFocus(state, fn) {
    const clutterText = state._searchEntry.clutter_text ?? state._searchEntry.get_clutter_text();
    const stageFocus = global.stage?.get_key_focus?.();
    const hadFocus = stageFocus === clutterText || stageFocus === state._searchEntry;

    fn();

    if (hadFocus && global.stage) {
        global.stage.set_key_focus(clutterText);
    }
}

function _ensureProjectSectionState(menu) {
    if (menu._devwatchProjectSectionState)
        return menu._devwatchProjectSectionState;

    const titleItem = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
        activate: false,
    });
    titleItem._devwatchSection = SECTION_TAG;
    const titleRow = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    const titleLabel = new St.Label({
        text: _('Running Projects'),
        style_class: 'dw-section-label',
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
    });
    titleRow.add_child(titleLabel);

    const searchBtn = new St.Button({
        style_class: 'dw-settings-btn',
        reactive: true,
        can_focus: true,
        track_hover: true,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });
    searchBtn.set_child(new St.Icon({
        icon_name: 'system-search-symbolic',
        style_class: 'dw-settings-icon',
    }));
    titleRow.add_child(searchBtn);

    titleItem.add_child(titleRow);

    const containerItem = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
        activate: false,
    });
    containerItem._devwatchSection = SECTION_TAG;
    // Hide the container item by default so there is no gap under the header
    containerItem.actor.visible = false;

    const container = new St.BoxLayout({ vertical: true, x_expand: true });
    const searchEntry = new St.Entry({
        hint_text: _('Search projects...'),
        x_expand: true,
        can_focus: true,
        track_hover: false,
        visible: false,
    });
    searchEntry.add_style_class_name('dw-search-entry');
    // Keep the entry compact so it visually matches section row typography.
    searchEntry.set_style('font-size: 12px; min-height: 24px; padding: 1px 8px; margin: 2px 0 6px 0; color: #e9ecf1; hint-text-color: rgba(233,236,241,0.78); background-color: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);');

    // Collapsed by default; expands only when search is shown.
    const searchSlot = new St.Bin({
        x_expand: true,
        y_expand: false,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.START,
    });
    searchSlot.set_height(0);
    searchSlot.set_child(searchEntry);

    const resultsBox = new PopupMenu.PopupMenuSection();
    resultsBox._devwatchSection = SECTION_TAG;
    resultsBox.actor.x_expand = true;
    containerItem.add_child(container);
    container.add_child(searchSlot);

    const separatorItem = new PopupMenu.PopupSeparatorMenuItem();
    separatorItem._devwatchSection = SECTION_TAG;

    const state = {
        _searchQuery: '',
        _projectMap: null,
        _portResult: null,
        _pidToPort: new Map(),
        _titleItem: titleItem,
        _titleLabel: titleLabel,
        _containerItem: containerItem,
        _container: container,
        _searchSlot: searchSlot,
        _searchEntry: searchEntry,
        _searchButton: searchBtn,
        _resultsBox: resultsBox,
        _separatorItem: separatorItem,
    };

    searchBtn.connect('clicked', () => {
        state._searchEntry.visible = !state._searchEntry.visible;
        if (state._searchEntry.visible) {
            state._containerItem.actor.visible = true;
            state._searchSlot.set_height(32);
            const clutterText = state._searchEntry.clutter_text ?? state._searchEntry.get_clutter_text();
            global.stage?.set_key_focus?.(clutterText);
            return;
        }
        state._containerItem.actor.visible = false;
        state._searchSlot.set_height(0);
        state._searchQuery = '';
        state._searchEntry.set_text('');
        _renderProjectResults(state);
    });

    const clutterText = searchEntry.clutter_text ?? searchEntry.get_clutter_text();
    clutterText.connect('text-changed', () => {
        state._searchQuery = (searchEntry.get_text() ?? '').toLowerCase();
        _withPreservedSearchFocus(state, () => _renderProjectResults(state));
    });

    menu._devwatchProjectSectionState = state;
    return state;
}

function _mountProjectSection(menu, state) {
    // Reinsert in order on every refresh so this section always appears
    // beneath summary/alerts, while preserving the same actors and focus state.
    for (const item of [state._titleItem, state._containerItem, state._resultsBox, state._separatorItem]) {
        const parent = item.actor.get_parent();
        if (parent)
            parent.remove_child(item.actor);
        menu.addMenuItem(item);
    }
}

function _renderProjectResults(state) {
    for (const item of state._resultsBox._getMenuItems())
        item.destroy();

    const projectMap = state._projectMap;
    if (!projectMap || projectMap.size === 0) {
        const empty = new PopupMenu.PopupMenuItem(
            _('  Open an editor or terminal to start a project'), { reactive: false }
        );
        empty.label.style_class = 'dw-dim';
        state._resultsBox.addMenuItem(empty);
        return;
    }

    const projects = [...projectMap.values()].sort((a, b) => b.totalCpuPercent - a.totalCpuPercent);
    const filtered = projects.filter(p => (p.name || '').toLowerCase().includes(state._searchQuery));

    if (filtered.length === 0) {
        const emptySearch = new PopupMenu.PopupMenuItem(_('  No matching projects'), { reactive: false });
        emptySearch.label.style_class = 'dw-dim';
        emptySearch.set_style('min-height: 24px;');
        state._resultsBox.addMenuItem(emptySearch);
        return;
    }

    if (filtered.length > INTERNAL_SCROLL_THRESHOLD) {
        const scrollerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            activate: false,
        });
        scrollerItem.add_style_class_name('dw-section-scroll-item');

        const scrollView = new St.ScrollView({
            style_class: 'dw-section-scroll dw-section-scroll-projects',
            overlay_scrollbars: false,
            reactive: true,
            enable_mouse_scrolling: true,
            x_expand: true,
            y_expand: false,
        });
        scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        scrollView.set_height(INTERNAL_SCROLL_HEIGHT_PX);

        const section = new PopupMenu.PopupMenuSection();
        for (const project of filtered) {
            const item = _buildProjectRow(project, state._pidToPort, scrollView, state._durationByRoot);
            section.addMenuItem(item);
            if (item._devwatchHeader) {
                item.label.get_parent().insert_child_above(item._devwatchHeader, item.label);
                item.label.hide();
            }
        }

        scrollView.set_child(section.actor);
        scrollerItem.add_child(scrollView);
        state._resultsBox.addMenuItem(scrollerItem);
        return;
    }

    for (const project of filtered) {
        const item = _buildProjectRow(project, state._pidToPort, null, state._durationByRoot);
        state._resultsBox.addMenuItem(item);
        if (item._devwatchHeader) {
            item.label.get_parent().insert_child_above(item._devwatchHeader, item.label);
            item.label.hide();
        }
    }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function buildProjectSection(menu, projectMap, portResult, durationByRoot = null) {
    const state = _ensureProjectSectionState(menu);
    state._menu = menu;
    _mountProjectSection(menu, state);
    state._durationByRoot = durationByRoot ?? (menu.isOpen ? getProjectDurationsByRootToday() : new Map());

    state._projectMap = projectMap;
    state._portResult = portResult;

    // Build a pid→port lookup so we can label processes by port
    const pidToPort = new Map();
    for (const p of (portResult?.ports ?? [])) {
        if (p.pid) pidToPort.set(p.pid, p.port);
    }
    state._pidToPort = pidToPort;

    _withPreservedSearchFocus(state, () => _renderProjectResults(state));
}

export function clearProjectSection(menu) {
    const state = menu._devwatchProjectSectionState;
    // If the search UI is currently visible, preserve the section's actors
    // so the search entry and results don't blink during background rebuilds.
    if (state && state._searchEntry && state._searchEntry.visible) {
        for (const item of menu._getMenuItems().filter(i => i._devwatchSection === SECTION_TAG)) {
            if (item === state._titleItem || item === state._containerItem || item === state._resultsBox || item === state._separatorItem)
                continue;

            item.destroy();
        }
        // Keep the persisted state so the section is reused on next build
        return;
    }

    for (const item of menu._getMenuItems().filter(i => i._devwatchSection === SECTION_TAG))
        item.destroy();
    delete menu._devwatchProjectSectionState;
}

// ── Row builders ───────────────────────────────────────────────────────────────

function _buildProjectRow(project, pidToPort, sectionScrollView, durationByRoot = new Map()) {
    const sub = new PopupMenu.PopupSubMenuMenuItem('', true);
    sub.add_style_class_name('dw-project-row-item');
    sub.label.text = '';
    if (sectionScrollView)
        _wireSubmenuToParentScroll(sub, sectionScrollView);
    // Card-style container: soft background + left indent for the service list
    sub.menu.actor.set_style(
        'background-color: rgba(255,255,255,0.05); border-radius: 8px;' +
        'padding: 4px 0 4px 14px; margin-top: 6px;' +
        'border: 1px solid rgba(255,255,255,0.07);'
    );

    // ── Level 1 header (vertical: name on L1, stats on L2) ──────────────
    const header = new St.BoxLayout({ vertical: true, x_expand: true });
    const projectMs = project.root ? (durationByRoot.get(project.root) || 0) : 0;
    header.spacing = 4;

    // Line 1: ● Project Name
    const nameLine = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    nameLine.spacing = 4;
    nameLine.add_child(new St.Label({
        text: '●',
        style_class: `dw-project-dot ${_projectDotClass(project)}`,
    }));
    nameLine.add_child(new St.Label({
        text: _cleanProjectName(project.name),
        style_class: 'dw-project-name',
    }));
    header.add_child(nameLine);

    // Line 2: 4 processes · 151 MB · 1h 23m  (indented under the dot)
    const ram = _formatKb(project.totalMemKb);
    const count = project.processes.length;
    const timeLabel = projectMs > 0 ? ` · ${_formatDurationMs(projectMs)}` : '';

    header.add_child(new St.Label({
        text: `${count} ${count === 1 ? 'process' : 'processes'} · ${ram}${timeLabel}`,
        style_class: 'dw-project-stats',
    }));

    // Defer attaching the header until the submenu has been mounted by
    // the caller. Storing it here lets the caller insert it after the
    // item is added to the parent, avoiding reparenting issues on refresh.
    sub._devwatchHeader = header;
    const timeInfoItem = new PopupMenu.PopupMenuItem('', { reactive: false });
    timeInfoItem.add_style_class_name('dw-project-time-row');
    const timeInfoText = projectMs > 0
        ? _('Time spent today: %s').format(_formatDurationMs(projectMs))
        : _('Time spent today: 0m');
    timeInfoItem.label.text = `  ${timeInfoText}`;
    timeInfoItem.label.style_class = 'dw-dim';
    sub.menu.addMenuItem(timeInfoItem);

    const services = _toServices(project, pidToPort);
    if (services.length === 0) {
        const empty = new PopupMenu.PopupMenuItem('  No visible services', { reactive: false });
        empty.label.style_class = 'dw-dim';
        empty.add_style_class_name('dw-empty-services');
        sub.menu.addMenuItem(empty);
    } else {
        for (const svc of services)
            sub.menu.addMenuItem(_buildServiceRow(svc));
    }

    // ── Actions: no divider — top padding in CSS provides separation ──────
    const actionsItem = new PopupMenu.PopupMenuItem('', { reactive: false });
    actionsItem.add_style_class_name('dw-project-actions');
    const actionsRow = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER});
    actionsRow.spacing = 8;

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
    const row  = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    row.spacing = 8;

    // Only show state dot for actively running or error states
    // State strings from /proc may be multi-char (e.g. 'Ss', 'S+'), so use startsWith
    const isNoisy = !svc.state || svc.state.startsWith('S') || svc.state.startsWith('I');
    if (!isNoisy) {
        row.add_child(new St.Label({
            text: svc.stateSymbol,
            style_class: `dw-proc-state ${svc.stateClass}`,
            y_align: Clutter.ActorAlign.CENTER,
        }));
    }

    // Combined "Python Server · Port 8000" — single label avoids layout gaps
    const text = svc.port ? `${svc.displayName}  ·  Port ${svc.port}` : svc.displayName;
    row.add_child(new St.Label({
        text,
        style_class: 'dw-service-row',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    }));

    item.add_child(row);
    item.label.hide();
    return item;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Convert raw processes into service-level items.
 * Prioritises processes that own ports, then includes remaining processes.
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
            displayName: _toServiceLabel(p.name),
            port: pidToPort.get(p.pid),
            stateSymbol: _stateSymbol(p.state),
            stateClass:  _stateClass(p.state),
            state: p.state,
        });
        seen.add(p.pid);
    }

    // Remaining processes
    const rest = project.processes
        .filter(p => !seen.has(p.pid))
        .sort((a, b) => b.cpuPercent - a.cpuPercent);

    for (const p of rest) {
        result.push({
            displayName: _toServiceLabel(p.name),
            port: null,
            stateSymbol: _stateSymbol(p.state),
            stateClass:  _stateClass(p.state),
            state: p.state,
        });
    }

    return result;
}

/**
 * Clean a raw project/directory name into a human-readable label.
 * Strips version numbers, package prefixes, and converts separators to spaces.
 */
function _cleanProjectName(raw) {
    if (!raw) return '';
    // Known tool/package identifier prefixes
    const KNOWN = new Map([
        ['ms-python.vscode-pylance', 'Pylance Language Server'],
        ['ms-python.python',         'Python Extension'],
        ['ms-toolsai.jupyter',       'Jupyter Extension'],
        ['ms-vscode.cpptools',       'C++ Extension'],
        ['ms-vscode.eslint',         'ESLint Extension'],
        ['dbaeumer.vscode-eslint',   'ESLint Extension'],
        ['esbenp.prettier',          'Prettier Extension'],
    ]);
    const lower = raw.toLowerCase();
    for (const [prefix, label] of KNOWN) {
        if (lower.startsWith(prefix)) return label;
    }
    // Strip trailing version: foo-bar-1.2.3 → foo-bar, vscode-pylance-2026.1.1 → vscode-pylance
    let name = raw.replace(/[-_.]?\d+\.\d+[\w.-]*$/g, '');
    // Remove remaining leading/trailing separators
    name = name.replace(/^[-_.]+|[-_.]+$/g, '');
    // Replace separator runs with a single space and capitalise words
    name = name.replace(/[-_.]+/g, ' ').trim();
    // Capitalise first letter of each word
    return name.replace(/\b\w/g, c => c.toUpperCase()) || raw;
}

/** Return a CSS class for the project health dot. */
function _projectDotClass(project) {
    const hasZombie = project.processes.some(p => p.state === 'Z');
    if (hasZombie) return 'dw-project-dot-red';
    if (project.totalCpuPercent > 80) return 'dw-project-dot-yellow';
    return 'dw-project-dot-green';
}

/**
 * Convert raw process name into a human-readable service label.
 * Never shows raw interpreter names — always returns developer-facing terms.
 */
function _toServiceLabel(name) {
    if (!name) return 'Unknown';
    const n = name.replace(/.*\//, '');  // strip path prefix
    if (/^python\d*(\.\d+)?$/.test(n))   return 'Python Server';
    if (/^node$/.test(n))                return 'Node.js Server';
    if (/^ruby\d*$/.test(n))             return 'Ruby Server';
    if (/^java$/.test(n))                return 'Java Service';
    if (/^go$/.test(n))                  return 'Go Server';
    if (/^php(-fpm\d*)?$/.test(n))       return 'PHP Server';
    if (/^uvicorn$/.test(n))             return 'Uvicorn Server';
    if (/^gunicorn$/.test(n))            return 'Gunicorn Server';
    if (/^cargo$/.test(n))               return 'Rust Build';
    if (/^gradle(w)?$/.test(n))          return 'Gradle Build';
    if (/^mvn$/.test(n))                 return 'Maven Build';
    if (/^make$/.test(n))                return 'Make Build';
    if (/^rustc$/.test(n))               return 'Rust Compiler';
    if (/^deno$/.test(n))                return 'Deno Server';
    if (/^bun$/.test(n))                 return 'Bun Server';
    if (/^nginx$/.test(n))               return 'Nginx';
    if (/^postgres(ql)?$/.test(n))       return 'PostgreSQL';
    if (/^redis-server$/.test(n))        return 'Redis';
    if (/^mongod$/.test(n))              return 'MongoDB';
    if (/^mysqld?$/.test(n))             return 'MySQL';
    if (/^(bash|sh|zsh|fish)$/.test(n))  return 'Terminal';
    return _truncate(n, 24);
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

function _formatDurationMs(ms) {
    if (!ms || ms <= 0) return '';
    const totalMinutes = Math.round(ms / 60000);
    if (totalMinutes < 60) return `${totalMinutes}m`;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}
function _addSep(menu, tag) {
    const sep = new PopupMenu.PopupSeparatorMenuItem();
    sep._devwatchSection = tag;
    menu.addMenuItem(sep);
}

function _wireSubmenuToParentScroll(subMenuItem, sectionScrollView) {
    const forwardScroll = (_actor, event) => _forwardScrollTo(sectionScrollView, event);

    subMenuItem.actor.connect('scroll-event', forwardScroll);
    subMenuItem.menu.actor.connect('scroll-event', forwardScroll);

    subMenuItem.menu.actor.connect('captured-event', (_actor, event) => {
        if (event.type() !== Clutter.EventType.SCROLL)
            return Clutter.EVENT_PROPAGATE;
        return _forwardScrollTo(sectionScrollView, event);
    });
}

function _forwardScrollTo(scrollView, event) {
    const [hasDelta, delta] = _scrollDelta(event);
    if (!hasDelta)
        return Clutter.EVENT_PROPAGATE;

    const adj = scrollView?.vadjustment;
    if (!adj)
        return Clutter.EVENT_PROPAGATE;

    const lower = adj.lower ?? 0;
    const upper = adj.upper ?? 0;
    const page = adj.page_size ?? 0;
    const value = adj.value ?? 0;
    const max = Math.max(lower, upper - page);
    const step = Math.max(16, adj.step_increment ?? 24);

    let next = value + (delta * step);
    if (next < lower)
        next = lower;
    if (next > max)
        next = max;

    if (Math.abs(next - value) < 0.0001)
        return Clutter.EVENT_PROPAGATE;

    adj.value = next;
    return Clutter.EVENT_STOP;
}

function _scrollDelta(event) {
    const direction = event.get_scroll_direction();
    if (direction === Clutter.ScrollDirection.UP)
        return [true, -1];
    if (direction === Clutter.ScrollDirection.DOWN)
        return [true, 1];
    if (direction === Clutter.ScrollDirection.SMOOTH) {
        const [, dy] = event.get_scroll_delta();
        if (Math.abs(dy) < 0.0001)
            return [false, 0];
        return [true, dy];
    }
    return [false, 0];
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
            const timeInfoItem = new PopupMenu.PopupMenuItem('', { reactive: false });
    const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
    if (root) launcher.set_cwd(root);
    for (const argv of [['gnome-terminal'], ['xterm']]) {
        try { launcher.spawnv(argv); return; } catch (_) {}
    }
}
