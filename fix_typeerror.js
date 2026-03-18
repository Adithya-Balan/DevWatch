const fs = require('fs');

const path = 'ui/snapshotSection.js';
let content = fs.readFileSync(path, 'utf8');

// Replace item.set_style with setting inline styles or adding an explicit class
content = content.replace("item.set_style('background-color: transparent; margin: 0; padding: 0; border: none;');", "item.add_style_class_name('dw-session-row-wrapper');");

fs.writeFileSync(path, content);
