/**
 * DevWatch — utils/i18n.js
 *
 * Re-exports the GNOME Shell extension translation helpers so that every UI
 * module can import `_` from a single well-known path instead of duplicating
 * the resource:// import everywhere.
 *
 * Prerequisites
 * ─────────────
 * `this.initTranslations()` must have been called inside `enable()` in
 * extension.js before any translated string is rendered.  DevWatch does this
 * at the very start of `enable()`, so all subsequent refreshes are safe.
 *
 * Usage (in any ui/ or core/ module)
 * ───────────────────────────────────
 *   import { _ } from '../utils/i18n.js';
 *
 *   const label = _('Active Ports');
 *
 * Plurals
 * ───────
 *   import { ngettext } from '../utils/i18n.js';
 *
 *   const label = ngettext('%d port', '%d ports', count).format(count);
 */

export {
    gettext   as _,
    ngettext,
    pgettext,
} from 'resource:///org/gnome/shell/extensions/extension.js';
