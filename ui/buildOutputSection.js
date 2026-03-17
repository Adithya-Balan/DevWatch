/**
 * DevWatch — ui/buildOutputSection.js
 *
 * Build Output Display Section
 *
 * Shows recent build output and provides access to build logs.
 * Integrates with BuildLogger to display captured output in the panel dropdown.
 */

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { gettext as _ } from 'gettext';

import { BuildLogger } from '../core/buildLogger.js';

/**
 * Build a section showing build output and logs.
 * @param {PopupMenu} menu - The dropdown menu to add to
 * @param {BuildRun[]} activeBuilds - Currently running builds
 * @param {Map<string, BuildRun[]>} buildHistory - Historical build data
 * @param {BuildLogger} logger - The build logger instance
 */
export function buildBuildOutputSection(menu, activeBuilds, buildHistory, logger) {
    // Only show section if there are active builds or recent history
    const hasActiveBuilds = activeBuilds.length > 0;
    const hasHistory = Array.from(buildHistory.values()).some(runs => runs.length > 0);

    if (!hasActiveBuilds && !hasHistory) {
        return; // Nothing to show
    }

    // Section header
    const header = new PopupMenu.PopupMenuItem(_('BUILD OUTPUT'), {
        reactive: false,
        style_class: 'devwatch-section-header'
    });
    menu.addMenuItem(header);

    // Show active builds with output
    for (const build of activeBuilds) {
        const output = logger.getActiveOutput(build.pid, 5); // Last 5 lines

        if (output.length > 0) {
            const item = new PopupMenu.PopupSubMenuMenuItem(
                `${build.tool}: ${build.cmdline}`,
                true
            );

            // Add output lines
            for (const line of output) {
                const lineItem = new PopupMenu.PopupMenuItem(line, {
                    reactive: false,
                    style_class: 'devwatch-build-output-line'
                });
                item.menu.addMenuItem(lineItem);
            }

            // Add "View Full Log" button
            const viewLogItem = new PopupMenu.PopupMenuItem(_('View Full Log...'));
            viewLogItem.connect('activate', () => {
                // For now, just show a notification - in a real implementation,
                // this would open the log file in an editor or terminal
                const message = _('Build log for %s (PID %d)').format(build.tool, build.pid);
                // TODO: Implement log viewing
                console.log('[DevWatch] View full log requested for:', build.tool, build.pid);
            });
            item.menu.addMenuItem(viewLogItem);

            menu.addMenuItem(item);
        }
    }

    // Show recent logs for completed builds
    if (hasHistory) {
        const recentLogsItem = new PopupMenu.PopupSubMenuMenuItem(_('Recent Logs'), true);

        // Collect recent logs from all projects
        const allRecentLogs = [];
        for (const [projectRoot, runs] of buildHistory) {
            for (const run of runs.slice(0, 2)) { // Last 2 runs per project
                const logs = logger.getRecentLogs(projectRoot, run.tool);
                if (logs.length > 0) {
                    allRecentLogs.push({
                        project: projectRoot,
                        tool: run.tool,
                        log: logs[0] // Most recent log
                    });
                }
            }
        }

        // Sort by most recent first
        allRecentLogs.sort((a, b) => b.log.startedAt - a.log.startedAt);

        // Show up to 5 most recent logs
        for (const entry of allRecentLogs.slice(0, 5)) {
            const logItem = new PopupMenu.PopupMenuItem(
                `${entry.tool}: ${entry.project || _('Unknown Project')}`,
                {
                    reactive: true,
                    style_class: 'devwatch-recent-log-item'
                }
            );

            logItem.connect('activate', () => {
                // TODO: Open the log file
                console.log('[DevWatch] Open log file for:', entry.tool, entry.project);
            });

            recentLogsItem.menu.addMenuItem(logItem);
        }

        if (allRecentLogs.length > 0) {
            menu.addMenuItem(recentLogsItem);
        }
    }
}