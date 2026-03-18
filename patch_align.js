const fs = require('fs');

const path = 'ui/snapshotSection.js';
let content = fs.readFileSync(path, 'utf8');

const oldOuter = `    // Overall horizontal layout
    const outer = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    outer.spacing = 8;`;

const newOuter = `    // Overall horizontal layout
    const outer = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    outer.spacing = 14;`;

content = content.replace(oldOuter, newOuter);

const oldTitleBox = `    const titleBox = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
    titleBox.spacing = 6;`;

const newTitleBox = `    const titleBox = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
    titleBox.spacing = 8;`;

content = content.replace(oldTitleBox, newTitleBox);

const oldActionBox = `    // Right container for Actions
    const actionBox = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
    actionBox.spacing = 6;`;

const newActionBox = `    // Right container for Actions
    const actionBox = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
    actionBox.spacing = 10;`;

content = content.replace(oldActionBox, newActionBox);

const oldTextStack = `    // Left container for Title + Subtitle
    const textStack = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });`;

const newTextStack = `    // Left container for Title + Subtitle
    const textStack = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    textStack.spacing = 2; // Fixed vertical spacing between text lines`;

content = content.replace(oldTextStack, newTextStack);

fs.writeFileSync(path, content);
