const fs = require('fs');
let css = fs.readFileSync('stylesheet.css', 'utf8');

css = css.replace(
`.devwatch-menu .popup-sub-menu .dw-session-card,
.devwatch-menu .popup-sub-menu .dw-session-card-primary {
    padding: 9px 12px;
    margin-bottom: 5px;
    margin-right: 12px;
    margin-left: 12px;
    border-radius: 10px;
}`,
`.devwatch-menu .dw-session-card,
.devwatch-menu .dw-session-card-primary {
    padding: 10px 14px;
    margin-bottom: 8px;
    margin-right: 12px;
    margin-left: 12px;
    border-radius: 8px;
}`);

css = css.replace(
`.devwatch-menu .popup-sub-menu .dw-session-card {
    background-color: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
}`,
`.devwatch-menu .dw-session-card {
    background-color: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
}`);

css = css.replace(
`.devwatch-menu .popup-sub-menu .dw-session-card-primary {
    background-color: rgba(232, 160, 64, 0.09);
    border: 1px solid rgba(232, 160, 64, 0.25);
}`,
`.devwatch-menu .dw-session-card-primary {
    background-color: rgba(232, 160, 64, 0.09);
    border: 1px solid rgba(232, 160, 64, 0.25);
}`);

fs.writeFileSync('stylesheet.css', css);
