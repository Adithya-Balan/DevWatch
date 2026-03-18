const fs = require('fs');

const path = 'ui/snapshotSection.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/const item = new PopupMenu\.PopupMenuItem\('', \{ reactive: false \}\);/g, "const item = new PopupMenu.PopupBaseMenuItem({ reactive: false, activate: false });");

content = content.replace(/item\.label\.hide\(\);\n/g, "");

content = content.replace(/const outer = new St\.BoxLayout\(\{ x_expand: true, y_align: Clutter\.ActorAlign\.CENTER \}\);/g, "const outer = new St.BoxLayout({ x_expand: true });");

content = content.replace(/const textStack = new St\.BoxLayout\(\{ vertical: true, x_expand: true, y_align: Clutter\.ActorAlign\.CENTER \}\);/g, "const textStack = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.START });");

fs.writeFileSync(path, content);
