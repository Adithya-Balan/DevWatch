/**
 * DevWatch — utils/procReader.js
 *
 * Low-level helpers for reading the Linux /proc virtual filesystem.
 *
 * /proc files are kernel-generated pseudo-files that must be read in a
 * single shot — they are tiny (a few KB at most) and reading them
 * synchronously is safe and appropriate. The async Gio API has known
 * quirks with /proc because the kernel reports a length of 0 until the
 * read actually happens.
 *
 * Exports
 * ───────
 *   readProcFile(path)           → string | null      (sync, fast)
 *   listPids()                   → Promise<number[]>  (async /proc enum)
 *   readProcStat(pid)            → number[]  | null   (raw /proc/<pid>/stat fields)
 *   readProcStatus(pid)          → Map<string,string> | null
 *   readProcCmdline(pid)         → string[]  | null   (argv array)
 *   readProcCwd(pid)             → string    | null   (resolved symlink)
 *   readProcExe(pid)             → string    | null   (resolved symlink)
 *   parseProcStatusField(status, field) → string | null
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

// ── Sync read ──────────────────────────────────────────────────────────────────

/**
 * Synchronously read a /proc file and return its content as a UTF-8 string.
 * Returns null if the file cannot be read (process may have exited by now).
 *
 * @param {string} path  Absolute path, e.g. '/proc/1234/status'
 * @returns {string|null}
 */
export function readProcFile(path) {
    try {
        const file = Gio.File.new_for_path(path);
        const [ok, contents] = file.load_contents(null);
        if (!ok) return null;
        return new TextDecoder('utf-8').decode(contents);
    } catch (_e) {
        // Process likely exited between enumeration and read — silently ignore.
        return null;
    }
}

// ── PID enumeration ────────────────────────────────────────────────────────────

/**
 * Asynchronously enumerate all running PIDs by listing /proc for
 * purely-numeric directory entries.
 *
 * @returns {Promise<number[]>} Sorted array of PIDs currently visible in /proc.
 */
export async function listPids() {
    const procDir = Gio.File.new_for_path('/proc');

    let enumerator;
    try {
        enumerator = await new Promise((resolve, reject) => {
            procDir.enumerate_children_async(
                'standard::name,standard::type',
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT,
                null,
                (src, res) => {
                    try {
                        resolve(src.enumerate_children_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    } catch (e) {
        console.error('[DevWatch] listPids: could not enumerate /proc:', e.message);
        return [];
    }

    const pids = [];
    let info;
    while ((info = enumerator.next_file(null)) !== null) {
        const name = info.get_name();
        if (/^\d+$/.test(name)) {
            pids.push(parseInt(name, 10));
        }
    }
    enumerator.close(null);

    return pids.sort((a, b) => a - b);
}

// ── Per-PID accessors ──────────────────────────────────────────────────────────

/**
 * Read /proc/<pid>/cmdline and return argv as a string array.
 * Kernel stores this NUL-separated; trailing NULs are cleaned up.
 *
 * @param {number} pid
 * @returns {string[]|null}  e.g. ['node', '/srv/app/server.js', '--port', '3000']
 */
export function readProcCmdline(pid) {
    const raw = readProcFile(`/proc/${pid}/cmdline`);
    if (raw === null) return null;
    // NUL-separated; split and drop empty tail entries
    const parts = raw.split('\0').filter((p, i, a) => p.length > 0 || i < a.length - 1);
    return parts.filter(p => p.length > 0);
}

/**
 * Read /proc/<pid>/status and return a Map of field → value.
 *
 * @param {number} pid
 * @returns {Map<string,string>|null}
 *
 * @example
 * const status = readProcStatus(1234);
 * status?.get('Name')  // 'node'
 * status?.get('VmRSS') // '123456 kB'
 * status?.get('PPid')  // '1'
 */
export function readProcStatus(pid) {
    const raw = readProcFile(`/proc/${pid}/status`);
    if (raw === null) return null;

    const map = new Map();
    for (const line of raw.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 1).trim();
        map.set(key, val);
    }
    return map;
}

/**
 * Convenience: extract a single field from /proc/<pid>/status.
 *
 * @param {Map<string,string>} statusMap  Result of readProcStatus()
 * @param {string} field                  e.g. 'VmRSS', 'PPid', 'Name'
 * @returns {string|null}
 */
export function parseProcStatusField(statusMap, field) {
    if (!statusMap) return null;
    return statusMap.get(field) ?? null;
}

/**
 * Read /proc/<pid>/stat — the space-separated kernel state file.
 * Returns raw fields as a string array (field indices match the kernel docs).
 *
 * Key fields (0-based):
 *   [0]  pid
 *   [1]  comm  (process name in parens)
 *   [2]  state ('R','S','D','Z','T', ...)
 *   [3]  ppid
 *   [13] utime  (user-mode CPU jiffies)
 *   [14] stime  (kernel-mode CPU jiffies)
 *   [23] vsize  (virtual memory bytes)
 *   [24] rss    (resident set pages)
 *
 * @param {number} pid
 * @returns {string[]|null}
 */
export function readProcStat(pid) {
    const raw = readProcFile(`/proc/${pid}/stat`);
    if (raw === null) return null;

    // The comm field (index 1) can contain spaces — it is enclosed in parens.
    // Parse around it to avoid naive split errors.
    const openParen  = raw.indexOf('(');
    const closeParen = raw.lastIndexOf(')');
    if (openParen === -1 || closeParen === -1) return raw.trim().split(' ');

    const pid_str  = raw.slice(0, openParen).trim();
    const comm     = raw.slice(openParen + 1, closeParen);
    const rest     = raw.slice(closeParen + 2).trim().split(' '); // skip ') '

    return [pid_str, comm, ...rest];
}

/**
 * Resolve /proc/<pid>/cwd symlink — the process's current working directory.
 *
 * @param {number} pid
 * @returns {string|null}  Absolute CWD path, or null if unreadable.
 */
export function readProcCwd(pid) {
    return _resolveSymlink(`/proc/${pid}/cwd`);
}

/**
 * Resolve /proc/<pid>/exe symlink — the absolute path of the executable.
 *
 * @param {number} pid
 * @returns {string|null}
 */
export function readProcExe(pid) {
    return _resolveSymlink(`/proc/${pid}/exe`);
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Synchronously resolve a symlink using GLib.
 * Returns null if the symlink cannot be read (process exited, no perms).
 *
 * @param {string} symlinkPath
 * @returns {string|null}
 */
function _resolveSymlink(symlinkPath) {
    try {
        const file = Gio.File.new_for_path(symlinkPath);
        const info = file.query_info('standard::symlink-target', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        return info.get_symlink_target() ?? null;
    } catch (_e) {
        return null;
    }
}
