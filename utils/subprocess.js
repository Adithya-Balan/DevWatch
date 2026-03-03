/**
 * DevWatch — utils/subprocess.js
 *
 * Async subprocess helpers built on Gio.Subprocess + _promisify.
 * These are the ONLY safe way to call CLI tools from GNOME Shell —
 * blocking variants (communicate_utf8_sync, spawn_command_line_sync)
 * stall the main loop and will cause noticeable shell freezes.
 *
 * Exports
 * ───────
 *   execCommunicate(argv, cancellable?)  → Promise<string>   (stdout)
 *   execCheck(argv, cancellable?)        → Promise<void>     (throws on non-zero)
 *   execLines(argv, cancellable?)        → Promise<string[]> (stdout split by line)
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

// Promisify the async communicate method once at module load time.
// This converts communicate_utf8_async / communicate_utf8_finish into
// a native Promise — safe to call with `await` inside GJS.
Gio._promisify(
    Gio.Subprocess.prototype,
    'communicate_utf8_async',
    'communicate_utf8_finish'
);

// ── Core helper ────────────────────────────────────────────────────────────────

/**
 * Run an external command and return its stdout as a trimmed string.
 *
 * @param {string[]} argv         - Command + arguments array, e.g. ['ss', '-tulnp']
 * @param {Gio.Cancellable|null}  cancellable - Pass the extension's _cancellable so
 *                                              in-flight calls are cancelled on disable().
 * @returns {Promise<string>}     Trimmed stdout of the command.
 * @throws  {Error}               If the process exits with a non-zero status,
 *                                or if the operation is cancelled.
 *
 * @example
 * const out = await execCommunicate(['git', 'rev-parse', '--show-toplevel'], cancellable);
 */
export async function execCommunicate(argv, cancellable = null) {
    let cancelId = 0;

    const proc = new Gio.Subprocess({
        argv,
        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    });
    proc.init(cancellable);

    // Wire the cancellable to force-exit the child process if cancelled.
    if (cancellable instanceof Gio.Cancellable)
        cancelId = cancellable.connect(() => proc.force_exit());

    try {
        const [stdout, stderr] = await proc.communicate_utf8_async(null, null);

        if (!proc.get_successful()) {
            const msg = stderr?.trim() || `Process exited with status ${proc.get_exit_status()}`;
            throw new Error(`[DevWatch] execCommunicate failed: ${argv[0]}: ${msg}`);
        }

        return (stdout ?? '').trim();
    } finally {
        // Always disconnect the cancellable handler to avoid leaking the signal.
        if (cancelId > 0 && cancellable instanceof Gio.Cancellable)
            cancellable.disconnect(cancelId);
    }
}

// ── Convenience wrappers ───────────────────────────────────────────────────────

/**
 * Run an external command, discarding output — only checks for success.
 * Useful when you only care whether a command succeeds, not its output.
 *
 * @param {string[]} argv
 * @param {Gio.Cancellable|null} cancellable
 * @returns {Promise<void>}
 * @throws  {Error} on non-zero exit or cancellation.
 */
export async function execCheck(argv, cancellable = null) {
    await execCommunicate(argv, cancellable);
}

/**
 * Run an external command and return its stdout split into non-empty lines.
 *
 * @param {string[]} argv
 * @param {Gio.Cancellable|null} cancellable
 * @returns {Promise<string[]>} Array of non-empty trimmed lines.
 *
 * @example
 * const lines = await execLines(['ss', '-tulnp']);
 * // ['Netid State  Recv-Q ...', 'tcp   LISTEN 0 ...', ...]
 */
export async function execLines(argv, cancellable = null) {
    const raw = await execCommunicate(argv, cancellable);
    return raw
        .split('\n')
        .map(l => l.trimEnd())
        .filter(l => l.length > 0);
}

// ── Error type guard ───────────────────────────────────────────────────────────

/**
 * Returns true if the error originated from a Gio.Cancellable cancel().
 * Use this in catch blocks to silently ignore cancellation (expected on disable()).
 *
 * @param {unknown} err
 * @returns {boolean}
 *
 * @example
 * try {
 *   await execCommunicate(['ss', '-tulnp'], this._cancellable);
 * } catch (e) {
 *   if (!isCancelledError(e)) console.error(e);
 * }
 */
export function isCancelledError(err) {
    return (
        err instanceof GLib.Error &&
        err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)
    );
}
