/**
 * DevWatch — prefs.js
 *
 * Preferences UI using GTK4 + libadwaita (GNOME 45+ ESM).
 *
 * Pages
 * ─────
 *   General     — poll interval
 *   Ports       — show system ports, conflict notifications
 *   Cleanup     — idle threshold
 *   Performance — max build history rows
 *
 * Accessed via:
 *   gnome-extensions prefs devwatch@github.io
 *   … or Settings → Extensions → DevWatch → ⚙
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class DevWatchPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.set_default_size(600, 520);
        window.set_title(_('DevWatch Preferences'));

        // ── Page: General ──────────────────────────────────────────────────
        const generalPage = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(generalPage);

        const generalGroup = new Adw.PreferencesGroup({
            title: _('Polling'),
            description: _('Controls how often DevWatch rescans running processes and ports.'),
        });
        generalPage.add(generalGroup);

        const pollRow = new Adw.SpinRow({
            title: _('Poll interval'),
            subtitle: _('Seconds between background scans (5 – 60)'),
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 60,
                step_increment: 1,
                page_increment: 5,
            }),
        });
        settings.bind('poll-interval', pollRow, 'value', 0);
        generalGroup.add(pollRow);

        // ── Page: Ports ────────────────────────────────────────────────────
        const portsPage = new Adw.PreferencesPage({
            title: _('Ports'),
            icon_name: 'network-wired-symbolic',
        });
        window.add(portsPage);

        const portsGroup = new Adw.PreferencesGroup({
            title: _('Port monitoring'),
            description: _('Configure which ports appear in the panel and when notifications are fired.'),
        });
        portsPage.add(portsGroup);

        const systemPortsRow = new Adw.SwitchRow({
            title: _('Show system ports'),
            subtitle: _('Display all listening ports, not just dev ports (3000, 5173, 8080 …)'),
        });
        settings.bind('show-system-ports', systemPortsRow, 'active', 0);
        portsGroup.add(systemPortsRow);

        const notifyRow = new Adw.SwitchRow({
            title: _('Port conflict notifications'),
            subtitle: _('Fire a GNOME notification when a new process occupies a dev port'),
        });
        settings.bind('notify-port-conflicts', notifyRow, 'active', 0);
        portsGroup.add(notifyRow);


        // ── Page: Performance ──────────────────────────────────────────────
        const perfPage = new Adw.PreferencesPage({
            title: _('Performance'),
            icon_name: 'utilities-system-monitor-symbolic',
        });
        window.add(perfPage);

        const perfGroup = new Adw.PreferencesGroup({
            title: _('Build history'),
            description: _('Control how much build history is shown in the panel dropdown.'),
        });
        perfPage.add(perfGroup);

        const historyRow = new Adw.SpinRow({
            title: _('Max history rows'),
            subtitle: _('Number of completed build runs shown in the Build Performance section (1 – 20)'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 20,
                step_increment: 1,
                page_increment: 5,
            }),
        });
        settings.bind('max-build-history', historyRow, 'value', 0);
        perfGroup.add(historyRow);
    }
}
