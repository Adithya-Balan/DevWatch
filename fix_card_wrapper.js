const fs = require('fs');

const path = 'ui/snapshotSection.js';
let content = fs.readFileSync(path, 'utf8');

// Replace the _buildRow function entirely with a correct wrapper implementation.
const newBuildRow = `function _buildRow(snap, isLastWorkspace, onRestore, onDelete) {
    const item = new PopupMenu.PopupBaseMenuItem({ reactive: false, activate: false });
    
    // The menu item itself should have transparent background and no padding so it just holds the card.
    item.set_style('background-color: transparent; margin: 0; padding: 0; border: none;');

    // Overall horizontal layout is now the CARD itself
    const outer = new St.BoxLayout({ x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.FILL });
    outer.add_style_class_name(isLastWorkspace ? 'dw-session-card-primary' : 'dw-session-card');
    outer.spacing = 14;

    // Left container for Title + Subtitle
    const textStack = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    textStack.spacing = 2; // Fixed vertical spacing between text lines
    
    const titleBox = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
    titleBox.spacing = 8;
    
    if (isLastWorkspace) {
        titleBox.add_child(new St.Icon({
            icon_name: 'document-open-recent-symbolic',
            icon_size: 13,
            style_class: 'dw-session-icon-primary'
        }));
        titleBox.add_child(new St.Label({
            text: _(' Last Workspace'),
            style_class: 'dw-session-title-primary'
        }));
    } else {
        const displayLabel = (snap.label === 'auto' || !snap.label) ? 'Autosave' : snap.label;
        titleBox.add_child(new St.Label({
            text: _truncate(displayLabel, 26),
            style_class: 'dw-session-title'
        }));
    }
    textStack.add_child(titleBox);

    // Stats line (Projects · Services)
    const projCount = snap.projectCount ?? (snap.projects?.length || 0);
    const svcCount = snap.serviceCount ?? ((snap.projects || []).reduce((n, p) => n + (p.services?.length || 0), 0));
    
    const statsParts = [];
    if (projCount) statsParts.push(\`\${projCount} project\${projCount !== 1 ? 's' : ''}\`);
    if (svcCount) statsParts.push(\`\${svcCount} service\${svcCount !== 1 ? 's' : ''}\`);

    if (statsParts.length > 0) {
        textStack.add_child(new St.Label({
            text: statsParts.join(' • '),
            style_class: 'dw-session-stats'
        }));
    }

    // Date line (Less prominent, below stats)
    if (snap.savedAt) {
        const dateText = _formatDate(snap.savedAt);
        if (dateText) {
            textStack.add_child(new St.Label({
                text: dateText,
                style_class: 'dw-session-date'
            }));
        }
    }

    outer.add_child(textStack);

    // Right container for Actions
    const actionBox = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
    actionBox.spacing = 10;

    const resumeBtn = new St.Button({
        label: _('Resume'),
        style_class: 'dw-session-btn-resume',
        reactive: true, can_focus: true, track_hover: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    resumeBtn.connect('clicked', () => {
        resumeBtn.label = _('Resuming…');
        resumeBtn.reactive = false;
        onRestore?.(isLastWorkspace ? '_last_workspace_.json' : snap.filename);
    });
    actionBox.add_child(resumeBtn);

    if (!isLastWorkspace) {
        const delBtn = new St.Button({
            child: new St.Icon({ icon_name: 'user-trash-symbolic', icon_size: 14 }),
            style_class: 'dw-session-btn-icon-danger',
            reactive: true, can_focus: true, track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        // We handle margin via CSS now, but keep native margin right
        delBtn.connect('clicked', () => onDelete?.(snap.filename));
        actionBox.add_child(delBtn);
    } else {
        // Spacer for consistent alignment with normal cards having a trash button
        const spacer = new St.Widget({
            width: 34, // roughly matches trash icon button width
            height: 1
        });
        actionBox.add_child(spacer);
    }

    outer.add_child(actionBox);
    item.add_child(outer);
    
    return item;
}`;

const re = /function _buildRow\(snap, isLastWorkspace, onRestore, onDelete\) \{[\s\S]*?return item;\n\}/;
content = content.replace(re, newBuildRow);

fs.writeFileSync(path, content);
