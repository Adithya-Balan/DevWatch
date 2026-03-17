/**
 * Test wrapper script
 */
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class TestExt extends Extension {
    enable() {
        console.log("TEST enabled");
    }
    disable() {
        console.log("TEST disabled");
    }
}
