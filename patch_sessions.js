const fs = require('fs');

const path = 'ui/snapshotSection.js';
let content = fs.readFileSync(path, 'utf8');

const oldList = `    // ── Session list ────────────────────────────────────────────────────────
    if (lastWorkspace) {
        sub.menu.addMenuItem(_buildRow(lastWorkspace, true, onRestore, onDelete));
    }

    if (!snapshots || snapshots.length === 0) {
        const empty = new PopupMenu.PopupMenuItem(_('  No saved sessions yet'), { reactive: false });
        empty.label.style_class = 'dw-session-subtitle';
        sub.menu.addMenuItem(empty);
        _addSep(menu);
        return;
    }

    for (const snap of snapshots.slice(0, MAX_ROWS)) {
        sub.menu.addMenuItem(_buildRow(snap, false, onRestore, onDelete));
    }
    if (snapshots.length > MAX_ROWS) {
        const more = new PopupMenu.PopupMenuItem(\`  … and \${snapshots.length - MAX_ROWS} older sessions\`, { reactive: false });
        more.label.style_class = 'dw-session-subtitle';
        sub.menu.addMenuItem(more);
    }
    _addSep(menu);
}`;

const newList = `    // ── Session list ────────────────────────────────────────────────────────
    const totalItems = (lastWorkspace ? 1 : 0) + (snapshots?.length || 0);

    if (totalItems === 0) {
        const empty = new PopupMenu.PopupMenuItem(_('  No saved sessions yet'), { reactive: false });
        empty.label.style_class = 'dw-session-subtitle';
        sub.menu.addMenuItem(empty);
        _addSep(menu);
        return;
    }

    let targetMenu = sub.menu;
    
    if (totalItems > 4) {
        const scrollerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            activate: false,
        });
        scrollerItem.add_style_class_name('dw-section-scroll-item');
        scrollerItem._devwatchSection = SECTION_TAG;

        const scrollView = new St.ScrollView({
            style_class: 'dw-section-scroll dw-section-scroll-snapshots',
            overlay_scrollbars: false,
            reactive: true,
            enable_mouse_scrolling: true,
            x_expand: true,
            y_expand: false,
        });
        scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        scrollView.set_height(250);

        const scrollSection = new PopupMenu.PopupMenuSection();
        scrollView.set_child(scrollSection.actor);
        scrollerItem.add_child(scrollView);
        
        sub.menu.addMenuItem(scrollerItem);
        targetMenu = scrollSection;
    }

    if (lastWorkspace) {
        const item = _buildRow(lastWorkspace, true, onRestore, onDelete);
        item._devwatchSection = SECTION_TAG;
        targetMenu.addMenuItem(item);
    }

    if (snapshots && snapshots.length > 0) {
        for (const snap of snapshots) {
            const item = _buildRow(snap, false, onRestore, onDelete);
            item._devwatchSection = SECTION_TAG;
            targetMenu.addMenuItem(item);
        }
    }
    
    _addSep(menu);
}`;

content = content.replace(oldList, newList);
fs.writeFileSync(path, content);
