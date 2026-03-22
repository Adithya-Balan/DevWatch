/**
 * DevWatch — utils/focusAggregator.js
 *
 * Synchronous aggregation utilities for focus logs.
 * These functions are intended to run when the dropdown is opened.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const DEFAULT_TICK_MS = 10_000;

/**
 * Returns today's cumulative duration per project root.
 * Durations are summed from unique poll ticks and naturally continue when a
 * project is reopened later in the same day.
 */
export function getProjectDurationsByRootToday() {
    const { entries } = _loadRangeEntries('today');
    const tickMs = _inferTickMs(entries, DEFAULT_TICK_MS);

    const byRoot = new Map();
    const seenRootTick = new Set();

    for (const e of entries || []) {
        const root = e?.r || '';
        const ts = Number(e?.t) || 0;
        if (!root || !ts)
            continue;

        const key = `${root}|${ts}`;
        if (seenRootTick.has(key))
            continue;
        seenRootTick.add(key);

        byRoot.set(root, (byRoot.get(root) || 0) + tickMs);
    }

    return byRoot;
}

export function getTodaySummary() {
    const { entries } = _loadRangeEntries('today');
    return _summaryFromEntries(entries, DEFAULT_TICK_MS);
}

export function getTimelineBlocks(granularityMinutes = 15) {
    const { entries, startMs, endMs } = _loadRangeEntries('today');
    return _buildTimeline(entries, startMs, endMs, granularityMinutes);
}

export function getFocusData(rangeKey = 'today', granularityMinutes = 15, activeRoots = new Set()) {
    const { entries, startMs, endMs } = _loadRangeEntries(rangeKey);
    const timeline = _buildTimeline(entries, startMs, endMs, granularityMinutes);
    const summary = _summaryFromEntries(entries, DEFAULT_TICK_MS)
        .map(row => ({
            ...row,
            lastRoot: _lastRootForProject(entries, row.project),
            isActiveNow: row.project !== 'idle' && !!_hasActiveRoot(entries, row.project, activeRoots),
        }));

    let totalActiveMs = 0;
    let dominantMs = 0;
    for (const row of summary) {
        if (row.project === 'idle')
            continue;
        totalActiveMs += row.totalMs;
        dominantMs = Math.max(dominantMs, row.totalMs);
    }

    const focusScore = totalActiveMs > 0
        ? Math.round((dominantMs / totalActiveMs) * 100)
        : 0;

    return {
        rangeKey,
        summary,
        timeline,
        focusScore,
        totalActiveMs,
        dominantMs,
        nowMs: Date.now(),
        startMs,
        endMs,
    };
}

// ── Core aggregation ──────────────────────────────────────────────────────

function _summaryFromEntries(entries, defaultTickMs) {
    const tickMs = _inferTickMs(entries, defaultTickMs);
    const seenProjectTick = new Set();
    const byProject = new Map();

    for (const e of entries) {
        const project = e?.p || 'idle';
        const ts = Number(e?.t) || 0;
        if (!ts)
            continue;

        const key = `${project}|${ts}`;
        if (seenProjectTick.has(key))
            continue;
        seenProjectTick.add(key);

        if (!byProject.has(project)) {
            byProject.set(project, {
                project,
                totalMs: 0,
                lastActiveAt: 0,
            });
        }

        const row = byProject.get(project);
        row.totalMs += tickMs;
        row.lastActiveAt = Math.max(row.lastActiveAt, ts);
    }

    return [...byProject.values()].sort((a, b) => b.totalMs - a.totalMs);
}

function _buildTimeline(entries, startMs, endMs, granularityMinutes) {
    const blockMs = Math.max(1, granularityMinutes) * 60 * 1000;
    const spanMs = Math.max(1, endMs - startMs);
    const blockCount = Math.max(1, Math.ceil(spanMs / blockMs));

    const blocks = Array.from({ length: blockCount }, (_, i) => ({
        startMs: startMs + (i * blockMs),
        endMs: Math.min(endMs, startMs + ((i + 1) * blockMs)),
        counts: new Map(),
        state: 'idle',
        dominantProject: 'idle',
        projects: [],
    }));

    const seenProjectTick = new Set();
    for (const e of entries) {
        const ts = Number(e?.t) || 0;
        if (!ts || ts < startMs || ts > endMs)
            continue;

        const project = e?.p || 'idle';
        const dedupe = `${project}|${ts}`;
        if (seenProjectTick.has(dedupe))
            continue;
        seenProjectTick.add(dedupe);

        const idx = Math.floor((ts - startMs) / blockMs);
        if (idx < 0 || idx >= blocks.length)
            continue;

        const c = blocks[idx].counts;
        c.set(project, (c.get(project) || 0) + 1);
    }

    for (const block of blocks) {
        const nonIdle = [...block.counts.entries()].filter(([p]) => p !== 'idle');
        if (nonIdle.length === 0) {
            block.state = 'idle';
            block.dominantProject = 'idle';
            block.projects = [];
            continue;
        }

        let maxCount = 0;
        for (const [, c] of nonIdle)
            maxCount = Math.max(maxCount, c);

        const top = nonIdle.filter(([, c]) => c === maxCount).map(([p]) => p);
        block.projects = nonIdle.map(([p]) => p);

        if (top.length > 1) {
            block.state = 'multi';
            block.dominantProject = 'multi';
        } else {
            block.state = 'single';
            block.dominantProject = top[0];
        }
    }

    return blocks;
}

// ── Range loading ─────────────────────────────────────────────────────────

function _loadRangeEntries(rangeKey) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    if (rangeKey === 'yesterday') {
        const startMs = todayStart - (24 * 60 * 60 * 1000);
        const endMs = todayStart - 1;
        const dayKey = _dateKeyFromMs(startMs);
        return {
            entries: _readEntriesForDay(dayKey).filter(e => e.t >= startMs && e.t <= endMs),
            startMs,
            endMs,
        };
    }

    if (rangeKey === '7-day') {
        const startMs = todayStart - (6 * 24 * 60 * 60 * 1000);
        const endMs = Date.now();
        const entries = [];
        for (let i = 0; i < 7; i++) {
            const ms = startMs + (i * 24 * 60 * 60 * 1000);
            const dayKey = _dateKeyFromMs(ms);
            entries.push(..._readEntriesForDay(dayKey));
        }
        return {
            entries: entries.filter(e => e.t >= startMs && e.t <= endMs),
            startMs,
            endMs,
        };
    }

    const startMs = todayStart;
    const endMs = Date.now();
    const dayKey = _dateKeyFromMs(startMs);
    return {
        entries: _readEntriesForDay(dayKey).filter(e => e.t >= startMs && e.t <= endMs),
        startMs,
        endMs,
    };
}

function _readEntriesForDay(dayKey) {
    const path = GLib.build_filenamev([
        GLib.get_home_dir(),
        '.local', 'share', 'devwatch',
        `focus_log_${dayKey}.json`,
    ]);

    const file = Gio.File.new_for_path(path);
    if (!file.query_exists(null))
        return [];

    try {
        const [, bytes] = file.load_contents(null);
        const parsed = JSON.parse(new TextDecoder().decode(bytes));
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function _dateKeyFromMs(ms) {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function _inferTickMs(entries, fallbackMs) {
    const uniq = [...new Set((entries || []).map(e => Number(e?.t) || 0).filter(Boolean))].sort((a, b) => a - b);
    if (uniq.length < 2)
        return fallbackMs;

    const freq = new Map();
    for (let i = 1; i < uniq.length; i++) {
        const d = uniq[i] - uniq[i - 1];
        if (d < 1000 || d > 120000) continue;
        freq.set(d, (freq.get(d) || 0) + 1);
    }

    let best = fallbackMs;
    let count = -1;
    for (const [d, c] of freq.entries()) {
        if (c > count) {
            count = c;
            best = d;
        }
    }

    return best;
}

function _lastRootForProject(entries, project) {
    let ts = 0;
    let root = '';
    for (const e of entries) {
        if ((e?.p || 'idle') !== project)
            continue;
        const t = Number(e?.t) || 0;
        if (t >= ts) {
            ts = t;
            root = e?.r || root;
        }
    }
    return root;
}

function _hasActiveRoot(entries, project, activeRoots) {
    if (!activeRoots || activeRoots.size === 0)
        return false;
    const root = _lastRootForProject(entries, project);
    return !!root && activeRoots.has(root);
}
