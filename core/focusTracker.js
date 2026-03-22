/**
 * DevWatch — core/focusTracker.js
 *
 * Passive focus/activity tracker. Records compact per-poll activity ticks into
 * day-scoped JSON logs under ~/.local/share/devwatch/.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const KEEP_DAYS = 7;
const DEFAULT_POLL_MS = 10_000;

export class FocusTracker {
    constructor() {
        this._cancellable = null;
        this._logDir = GLib.build_filenamev([
            GLib.get_home_dir(),
            '.local', 'share', 'devwatch',
        ]);

        this._currentDayKey = null;
        this._entries = [];
        this._pending = [];
        this._loaded = false;
        this._loadPromise = null;
        this._flushInFlight = false;
        this._flushDebounceId = null;
        this._pollIntervalMs = DEFAULT_POLL_MS;
        this._lastTickMs = 0;
    }

    start(cancellable, pollIntervalSeconds = 10) {
        this._cancellable = cancellable;
        this._pollIntervalMs = Math.max(1000, (pollIntervalSeconds || 10) * 1000);
        this._ensureDir();
        this._pruneOldFilesAsync().catch(() => {});
        this._rollToDayIfNeeded(Date.now());
    }

    setPollIntervalSeconds(seconds) {
        this._pollIntervalMs = Math.max(1000, (seconds || 10) * 1000);
    }

    stop() {
        if (this._flushDebounceId !== null) {
            GLib.Source.remove(this._flushDebounceId);
            this._flushDebounceId = null;
        }
        this._flushNowAsync().catch(() => {});
        this._cancellable = null;
    }

    /**
     * Record one poll tick. Returns true when a tick was accepted.
     */
    recordTick(projectMap, portResult, focusedProjectInfo, pollIntervalSeconds = null) {
        const now = Date.now();
        if (pollIntervalSeconds !== null && pollIntervalSeconds !== undefined)
            this._pollIntervalMs = Math.max(1000, pollIntervalSeconds * 1000);

        // Keep ticks close to the configured poll cadence even if refresh is
        // triggered by menu-open or focus-change events.
        const minDelta = Math.max(1000, Math.floor(this._pollIntervalMs * 0.7));
        if (this._lastTickMs && (now - this._lastTickMs) < minDelta)
            return false;

        this._lastTickMs = now;
        this._rollToDayIfNeeded(now);

        const activeByRoot = new Map(); // root -> { p, r, sources:Set }

        for (const p of (projectMap?.values?.() ?? [])) {
            if (!p?.root) continue;
            const name = p.name || GLib.path_get_basename(p.root);
            if (!activeByRoot.has(p.root))
                activeByRoot.set(p.root, { p: name, r: p.root, sources: new Set() });
            activeByRoot.get(p.root).sources.add('process');
        }

        for (const rec of (portResult?.ports ?? [])) {
            if (!rec?.projectRoot) continue;
            const root = rec.projectRoot;
            const fallbackName = GLib.path_get_basename(root);
            if (!activeByRoot.has(root))
                activeByRoot.set(root, { p: fallbackName, r: root, sources: new Set() });
            activeByRoot.get(root).sources.add('port');
        }

        if (focusedProjectInfo?.root) {
            const root = focusedProjectInfo.root;
            const name = focusedProjectInfo.name || GLib.path_get_basename(root);
            if (!activeByRoot.has(root))
                activeByRoot.set(root, { p: name, r: root, sources: new Set() });
            activeByRoot.get(root).sources.add('focus');
        }

        const newEntries = [];
        for (const value of activeByRoot.values()) {
            for (const s of value.sources) {
                newEntries.push({ p: value.p, r: value.r, t: now, s });
            }
        }

        if (newEntries.length === 0) {
            // Explicit idle marker so idle can be measured deterministically.
            newEntries.push({ p: 'idle', r: '', t: now, s: 'idle' });
        }

        this._pending.push(...newEntries);
        this._entries.push(...newEntries);
        this._scheduleFlush();
        return true;
    }

    /**
     * Lightweight score summary used by status dot and summary line.
     */
    getTodayStats() {
        const entries = this._entriesForToday();
        const tickMs = _inferTickMs(entries, this._pollIntervalMs);
        const perProject = _aggregatePerProject(entries, tickMs);

        let totalActiveMs = 0;
        let topMs = 0;
        for (const row of perProject) {
            if (row.project === 'idle') continue;
            totalActiveMs += row.totalMs;
            if (row.totalMs > topMs) topMs = row.totalMs;
        }

        const focusScore = totalActiveMs > 0
            ? Math.round((topMs / totalActiveMs) * 100)
            : 0;

        return {
            focusScore,
            totalActiveMs,
            byProject: perProject,
        };
    }

    // ── Internal ─────────────────────────────────────────────────────────

    _entriesForToday() {
        const today = _dateKey(Date.now());
        return (this._currentDayKey === today) ? this._entries : [];
    }

    _rollToDayIfNeeded(nowMs) {
        const nextKey = _dateKey(nowMs);
        if (this._currentDayKey === nextKey && this._loaded)
            return;

        this._currentDayKey = nextKey;
        this._entries = [];
        this._pending = [];
        this._loaded = false;
        this._loadPromise = this._loadCurrentDayAsync()
            .catch(() => { this._entries = []; })
            .finally(() => { this._loaded = true; if (this._pending.length > 0) this._scheduleFlush(); });
    }

    _ensureDir() {
        try { GLib.mkdir_with_parents(this._logDir, 0o755); } catch (_) {}
    }

    _scheduleFlush() {
        if (this._flushDebounceId !== null)
            return;

        this._flushDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
            this._flushDebounceId = null;
            this._flushNowAsync().catch(() => {});
            return GLib.SOURCE_REMOVE;
        });
    }

    async _loadCurrentDayAsync() {
        const file = Gio.File.new_for_path(_filePathForDay(this._logDir, this._currentDayKey));
        const exists = file.query_exists(null);
        if (!exists) {
            this._entries = [];
            return;
        }

        const contents = await _loadContentsAsync(file, this._cancellable);
        try {
            const parsed = JSON.parse(contents);
            this._entries = Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            this._entries = [];
        }
    }

    async _flushNowAsync() {
        if (this._flushInFlight)
            return;
        if (this._pending.length === 0)
            return;

        if (!this._loaded && this._loadPromise)
            await this._loadPromise;

        this._flushInFlight = true;
        try {
            this._pending = [];
            const file = Gio.File.new_for_path(_filePathForDay(this._logDir, this._currentDayKey));
            const payload = JSON.stringify(this._entries);
            await _replaceContentsAsync(file, payload, this._cancellable);
        } finally {
            this._flushInFlight = false;
        }
    }

    async _pruneOldFilesAsync() {
        const dir = Gio.File.new_for_path(this._logDir);
        const infos = await _enumerateChildrenAsync(dir, this._cancellable);

        const files = [];
        for (const info of infos) {
            const name = info.get_name();
            const m = /^focus_log_(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
            if (!m) continue;
            files.push({ name, day: m[1] });
        }

        files.sort((a, b) => a.day.localeCompare(b.day));
        const toDelete = Math.max(0, files.length - KEEP_DAYS);
        for (let i = 0; i < toDelete; i++) {
            const child = dir.get_child(files[i].name);
            try { await _deleteFileAsync(child, this._cancellable); } catch (_) {}
        }
    }
}

function _dateKey(ms) {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function _filePathForDay(dir, dayKey) {
    return GLib.build_filenamev([dir, `focus_log_${dayKey}.json`]);
}

function _inferTickMs(entries, fallbackMs) {
    if (!Array.isArray(entries) || entries.length < 2)
        return fallbackMs;

    const uniq = [...new Set(entries.map(e => Number(e.t) || 0).filter(Boolean))].sort((a, b) => a - b);
    if (uniq.length < 2)
        return fallbackMs;

    const freq = new Map();
    for (let i = 1; i < uniq.length; i++) {
        const d = uniq[i] - uniq[i - 1];
        if (d < 1000 || d > 120000) continue;
        freq.set(d, (freq.get(d) || 0) + 1);
    }

    let best = fallbackMs;
    let bestCount = -1;
    for (const [delta, c] of freq.entries()) {
        if (c > bestCount) {
            bestCount = c;
            best = delta;
        }
    }

    return best;
}

function _aggregatePerProject(entries, tickMs) {
    const byProject = new Map();
    const seenProjectTick = new Set();

    for (const e of (entries || [])) {
        const p = e?.p || 'idle';
        const t = Number(e?.t) || 0;
        if (!t) continue;

        const key = `${p}|${t}`;
        if (seenProjectTick.has(key))
            continue;
        seenProjectTick.add(key);

        if (!byProject.has(p)) {
            byProject.set(p, {
                project: p,
                totalMs: 0,
                lastActiveAt: 0,
            });
        }

        const row = byProject.get(p);
        row.totalMs += tickMs;
        row.lastActiveAt = Math.max(row.lastActiveAt, t);
    }

    return [...byProject.values()].sort((a, b) => b.totalMs - a.totalMs);
}

function _loadContentsAsync(file, cancellable) {
    return new Promise((resolve, reject) => {
        file.load_contents_async(cancellable, (_src, res) => {
            try {
                const [, bytes] = file.load_contents_finish(res);
                resolve(new TextDecoder().decode(bytes));
            } catch (e) {
                reject(e);
            }
        });
    });
}

function _replaceContentsAsync(file, text, cancellable) {
    return new Promise((resolve, reject) => {
        const bytes = new TextEncoder().encode(text);
        file.replace_contents_async(
            bytes,
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            cancellable,
            (_src, res) => {
                try {
                    file.replace_contents_finish(res);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            }
        );
    });
}

function _enumerateChildrenAsync(dir, cancellable) {
    return new Promise((resolve, reject) => {
        dir.enumerate_children_async(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            cancellable,
            (_src, res) => {
                try {
                    const en = dir.enumerate_children_finish(res);
                    const out = [];
                    let info;
                    while ((info = en.next_file(null)) !== null)
                        out.push(info);
                    en.close(null);
                    resolve(out);
                } catch (e) {
                    reject(e);
                }
            }
        );
    });
}

function _deleteFileAsync(file, cancellable) {
    return new Promise((resolve, reject) => {
        file.delete_async(GLib.PRIORITY_DEFAULT, cancellable, (_src, res) => {
            try {
                file.delete_finish(res);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
}
