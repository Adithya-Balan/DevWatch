import St from 'gi://St';
let theme = new St.Theme();
try {
    theme.load_stylesheet('stylesheet.css');
    console.log("CSS loaded successfully!");
} catch (e) {
    console.error(e);
}
