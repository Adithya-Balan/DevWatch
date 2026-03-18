# Contributing to DevWatch

Thank you for your interest in contributing to DevWatch! This document provides guidelines to help you get started.

---

## Getting Started

### Prerequisites

| Tool | Purpose |
|---|---|
| GNOME Shell 45+ | Runtime for the extension |
| `ss` | Port scanning (from `iproute2`) |
| `git` | Project root detection |
| `glib-compile-schemas` | Compiles GSettings schemas (from `libglib2.0-dev-bin`) |
| `make` | Build automation |
| `gettext` | i18n tooling |

### System Dependencies

**Ubuntu / Debian:**
```bash
sudo apt update
sudo apt install -y git make gettext-base gettext gnome-shell-extension-prefs
```

**Fedora:**
```bash
sudo dnf install -y git make gettext gnome-extensions-app
```

**Arch Linux:**
```bash
sudo pacman -S --needed git make gettext gnome-extensions
```

### Setup

```bash
# 1. Fork and clone the repository
git clone https://github.com/<your-username>/DevWatch.git
cd DevWatch

# 2. Compile schemas and symlink files into GNOME
make link

# 3. Enable the extension
gnome-extensions enable devwatch@github.io

# 4. Reload GNOME Shell
#    Wayland: log out and back in
#    X11:     killall -SIGUSR1 gnome-shell
```

---

## Development Workflow

### Iterating on Code

1. Edit any `.js` or `.css` file
2. Disable and re-enable the extension:
   ```bash
   gnome-extensions disable devwatch@github.io && sleep 1 && gnome-extensions enable devwatch@github.io
   ```
3. Watch logs for errors:
   ```bash
   make log
   ```

### Testing in a Nested Session (Recommended)

A nested GNOME Shell runs inside a window — safe for testing:

```bash
make nested
# Inside the nested window, open a terminal and run:
gnome-extensions enable devwatch@github.io
```

> **Note:** Run `make nested` from a native GNOME Terminal (not VS Code terminal), as it requires `$WAYLAND_DISPLAY`.

### Adding New Files

After creating any new `.js` or `.css` file, re-run:

```bash
make link
```

---

## Code Style

- **Language:** GJS (GNOME JavaScript) with ES Modules (GNOME 45+ syntax)
- **Indentation:** 4 spaces (no tabs)
- **Strings:** Single quotes preferred
- **Naming:** `camelCase` for variables/functions, `PascalCase` for classes
- **UI strings:** Wrap all user-facing text in `_('...')` for i18n
- **Async:** Use `Gio.Subprocess` with `_promisify` — never block the main loop
- **No external dependencies** — everything runs on GJS + system tools

---

## Pull Request Guidelines

1. **Fork** the repository
2. Create a **feature branch**: `git checkout -b feature/my-feature`
3. Make your changes
4. **Test** in a nested session (`make nested`)
5. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat: add new feature`
   - `fix: resolve port scanning bug`
   - `style: adjust padding in project rows`
   - `docs: update installation guide`
   - `chore: clean up unused variables`
6. **Push** and open a Pull Request against the `main` branch

---

## Adding a Translation

```bash
# 1. Add your locale code to po/LINGUAS
echo "de" >> po/LINGUAS   # German example

# 2. Extract strings and create .po file
make update-po

# 3. Translate strings in po/<lang>.po

# 4. Compile and test
make compile-mo
make link
```

---

## Reporting Issues

Use [GitHub Issues](https://github.com/Adithya-Balan/DevWatch/issues). Include:

- GNOME Shell version (`gnome-shell --version`)
- Distribution and version
- Steps to reproduce
- Relevant log output (`make log` or `journalctl -o cat /usr/bin/gnome-shell`)

---

## Project Structure

```
DevWatch/
├── extension.js          ← Entry point (ESM, GNOME 45+)
├── prefs.js              ← GTK4/Adw preferences window
├── metadata.json         ← Extension identity & GNOME version compatibility
├── stylesheet.css        ← St widget CSS
├── Makefile              ← Dev helpers (link, pack, i18n, log, …)
├── core/                 ← Data layer — no UI, pure logic
├── ui/                   ← Stateless UI renderers
├── utils/                ← Async subprocess, /proc reader, i18n helpers
├── schemas/              ← GSettings schema definition
└── po/                   ← Translation source files
```

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
