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

          const placementGroup = new Adw.PreferencesGroup({
              title: _('Panel Placement'),
              description: _('Choose where DevWatch appears in the GNOME top bar and its order index.'),
          });
          generalPage.add(placementGroup);

        const schema = settings.settings_schema;
        const hasPanelPosition = !!schema?.has_key?.('panel-position');
        const hasPanelIndex = !!schema?.has_key?.('panel-index');

        if (hasPanelPosition) {
            const positionModel = Gtk.StringList.new([
                _('Left'),
                _('Center'),
                _('Right'),
            ]);

            const positionRow = new Adw.ComboRow({
                title: _('Panel position'),
                subtitle: _('Select the top bar area where DevWatch is placed'),
                model: positionModel,
            });

            const positionValues = ['left', 'center', 'right'];
            const currentPosition = settings.get_string('panel-position');
            const currentPosIndex = Math.max(0, positionValues.indexOf(currentPosition));
            positionRow.set_selected(currentPosIndex);

            positionRow.connect('notify::selected', () => {
                const idx = positionRow.get_selected();
                const value = positionValues[idx] ?? 'right';
                settings.set_string('panel-position', value);
            });

            settings.connect('changed::panel-position', () => {
                const value = settings.get_string('panel-position');
                const idx = Math.max(0, positionValues.indexOf(value));
                if (positionRow.get_selected() !== idx)
                    positionRow.set_selected(idx);
            });

            placementGroup.add(positionRow);
        }

        if (hasPanelIndex) {
            const panelIndexRow = new Adw.SpinRow({
                title: _('Panel index'),
                subtitle: _('Order inside selected panel area (0 – 30)'),
                adjustment: new Gtk.Adjustment({
                    lower: 0,
                    upper: 30,
                    step_increment: 1,
                    page_increment: 5,
                }),
            });
            settings.bind('panel-index', panelIndexRow, 'value', 0);
            placementGroup.add(panelIndexRow);
        }

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
