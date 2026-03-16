# DevWatch

> **Project-aware developer intelligence layer for GNOME Shell.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-45%2B-blue.svg)](https://extensions.gnome.org)
[![Platform](https://img.shields.io/badge/Platform-Linux-orange.svg)](https://www.linux.org)
[![Status](https://img.shields.io/badge/Status-Active%20Development-yellow.svg)]()

DevWatch transforms GNOME from a generic desktop into a **developer-aware operating layer** that understands your projects, tracks their runtime behavior, and eliminates common workflow friction — directly from the panel.

---

## Why DevWatch?

Linux developers think in terms of **projects, services, ports, and builds** — not raw PIDs and CPU graphs.

Yet every existing tool (`htop`, `lsof`, GNOME System Monitor) is **process-oriented**, not **project-oriented**.

DevWatch fills that gap by mapping running system processes back to your development projects, surfacing exactly the runtime intelligence you actually need without ever leaving the desktop.

| Without DevWatch | With DevWatch |
|---|---|
| `lsof -i :3000` in terminal | See `Port 3000 → backend-api` in panel |
| `ps aux \| grep node` | Project cluster with all associated processes |
| Kill processes one by one | One-click "Clean orphans" |
| Rebuild whole dev env after reboot | Restore snapshot in seconds |
| No insight into build resource cost | Last 5 builds: avg time, peak RAM, trend |

---

## Features

### Pillar 1 — Project-Aware Process Intelligence
- Detects active project via focused window, terminal CWD, and `git` root
- Groups running processes by project directory
- Shows per-project aggregate CPU, memory, and runtime

### Pillar 2 — Intelligent Port & Service Control ✅
- Live monitoring of all listening ports via `ss -tulnp`
- Dev ports (3000, 5173, 8080, …) highlighted and separated from system ports
- Conflict detection with GNOME notifications when a dev port is newly occupied
- One-click kill, copy PID, open terminal at project root

### Pillar 3 — Dev Environment Cleanup Engine ✅
- Detects **zombie** processes (un-reaped, state `Z`)
- Detects **orphan** dev tools (parent gone, no project root)
- Detects **idle dev tools** (<0.5% CPU for >10 min, no open port)
- Per-candidate Kill button; bulk **Clean All** action
- Status dot turns **red** on zombie/orphan, **yellow** on idle tools

### Pillar 4 — Dev Session Snapshot & Restore ✅
- **Save Now** captures active projects (git branch), ports, and process names to `~/.local/share/devwatch/snapshots/`
- **Restore** reopens `gnome-terminal` at each saved project root with the branch in the window title
- Snapshot list in the panel dropdown — up to 5 shown, max 20 kept on disk
- Per-snapshot **Delete** button; auto-prunes oldest when limit is reached

### Pillar 5 — Dev Performance Intelligence ✅
- Detects active builds (`npm`, `cargo`, `make`, `gradle`, `go build`, …)
- Records peak CPU/RAM per build, trends over the last 5 runs
- Persists build history across reloads in `~/.local/share/devwatch/build_history.json`
- Panel shows active build row with live CPU%, completed builds with duration + peak resources
- Status dot turns **yellow** when an active build is pushing CPU above 90%

### Preferences ✅
- Full GTK4 / libadwaita preferences window (accessible via GNOME Settings → Extensions → DevWatch → ⚙)
- **General** — background poll interval (5–60 s, live-applied without reload)
- **Ports** — toggle system-port visibility; enable/disable conflict notifications
- **Cleanup** — configure idle-dev detection threshold (1–60 min)
- **Performance** — set max build history rows shown in the panel (1–20)
- All settings persist in GSettings (`org.gnome.shell.extensions.devwatch`)

---

## Design Principles

- **Project-centric, not process-centric**
- **Minimal UI, maximum clarity** — text-first, no graphs unless necessary
- **Local-only, privacy-first** — no cloud, no telemetry, no analytics
- **Non-intrusive** — async polling, low memory footprint
- **Developer workflow acceleration** — reduce terminal round-trips

---

## Requirements

| Requirement | Version |
|---|---|
| GNOME Shell | 45 or newer |
| GJS | Bundled with GNOME Shell |
| `ss` (socket statistics) | Part of `iproute2` |
| `git` | Any recent version |

---

## Installation

### Local Setup Guide (For Contributors)

This is the recommended setup flow for open-source contributors on Linux.

### 1. Install system dependencies

DevWatch runs as a GNOME Shell extension and relies on a few standard Linux tools.

Ubuntu / Debian:

```bash
sudo apt update
sudo apt install -y git make gettext-base gettext gnome-shell-extension-prefs
```

Fedora:

```bash
sudo dnf install -y git make gettext gnome-extensions-app
```

Arch Linux:

```bash
sudo pacman -S --needed git make gettext gnome-extensions
```

Also ensure these are available:
- GNOME Shell 45+
- `ss` (usually from `iproute2`)
- `glib-compile-schemas` (from GLib tools, usually preinstalled with GNOME)

### 2. Clone the project

```bash
git clone https://github.com/Adithya-Balan/DevWatch.git
cd DevWatch
```

### 3. Link the extension into GNOME

```bash
make link
```

What this does:
- Symlinks project files into `~/.local/share/gnome-shell/extensions/devwatch@github.io/`
- Compiles GSettings schemas from `schemas/`

Run `make link` again whenever you add new files.

### 4. Enable the extension

```bash
gnome-extensions enable devwatch@github.io
```

### 5. Verify it loaded

```bash
gnome-extensions info devwatch@github.io
```

Expected result:
- `Enabled: Yes`
- `State: ENABLED` (or equivalent healthy state)

You should now see **DevWatch** in the GNOME top panel.

### 6. Test your changes locally

After editing code:

```bash
make link
gnome-extensions disable devwatch@github.io
gnome-extensions enable devwatch@github.io
```

Watch logs while testing:

```bash
make log
# or
journalctl -f -o cat /usr/bin/gnome-shell
```

### 7. Wayland note (important)

On GNOME Wayland, Shell module reload can be sticky after syntax/runtime failures.
If an old error appears to persist:
- Disable/enable extension again.
- If still broken, log out and log back in.

### 8. Safe testing in an isolated nested shell

```bash
make nested
```

Inside the nested session terminal:

```bash
gnome-extensions enable devwatch@github.io
```

This is the safest way to test major UI or extension lifecycle changes.

### 9. Build distributable package (optional)

```bash
make pack
unzip -l devwatch@github.io.shell-extension.zip
```

---

## Development

### Project Structure

```
DevWatch/
├── extension.js          ← Entry point (ESM, GNOME 45+)
├── prefs.js              ← GTK4/Adw preferences window
├── metadata.json         ← Extension identity & GNOME version compatibility
├── stylesheet.css        ← St widget CSS
├── Makefile              ← Dev helpers (link, pack, i18n, log, …)
├── schemas/
│   └── org.gnome.shell.extensions.devwatch.gschema.xml  ← GSettings schema
├── po/
│   ├── POTFILES              ← Sources scanned by xgettext
│   ├── LINGUAS               ← List of supported locales
│   └── <lang>.po             ← Per-language translation files (added by translators)
├── locale/               ← Compiled .mo files (generated by make compile-mo, git-ignored)
├── ui/
│   ├── projectSection.js ← Active Projects section (process rows + Open Terminal)
│   ├── portSection.js    ← Active Ports section (Kill + Copy PID buttons)
│   ├── alertsSection.js  ← Conflict alerts & immediate actions
│   ├── healthSummary.js  ← System and project health summary widget
│   ├── snapshotSection.js← Session Snapshot: Save Now, Restore, Delete rows
│   └── perfSection.js    ← Build Performance: active builds + run history (Pillar 5)
├── core/
│   ├── projectDetector.js← Git root + window focus tracking
│   ├── processTracker.js ← /proc traversal, process→project mapping
│   ├── portMonitor.js    ← ss -tulnp parsing + runtime tracking + conflict detection
│   ├── conflictNotifier.js ← GNOME notifications for newly occupied dev ports
│   ├── snapshotManager.js← Save/list/load/restore/delete session JSON snapshots
│   └── buildDetector.js  ← Build detection + peak CPU/RAM tracking + persisted history
└── utils/
    ├── subprocess.js     ← Async execCommunicate() helper
    ├── procReader.js     ← /proc file read helpers
    └── i18n.js           ← gettext / ngettext re-export for UI modules
```

### Makefile Targets

```bash
make link              # Symlink project files into GNOME extension dir (run after adding files)
make compile-schemas   # Compile GSettings schema (auto-run by make link)
make enable            # Enable the extension
make disable           # Disable the extension
make pack              # Build distributable .zip
make log               # Tail GNOME Shell logs (your console.log() appears here)
make nested            # Launch a nested Wayland GNOME session for safe testing
make status            # Show gnome-extensions info
```

### Viewing Logs

```bash
make log
# or
journalctl -f -o cat /usr/bin/gnome-shell
```

### Testing in a Nested Session (Safe — won't crash your desktop)

```bash
make nested
# Inside the nested window, open a terminal and:
gnome-extensions enable devwatch@github.io
```

---

## Architecture Notes

- **Runtime:** GJS (GNOME JavaScript) with native ES Modules (GNOME 45+ ESM syntax)
- **UI toolkit:** St (Shell Toolkit) + Clutter actors
- **Async model:** `Gio.Subprocess` with `_promisify` — never blocking the main loop
- **Data sources:** `/proc` filesystem + `ss`, `git` CLI tools
- **Storage:** `~/.local/share/devwatch/` — snapshots and build history
- **No elevated privileges required**

---

## Publishing to extensions.gnome.org

### Pre-submission checklist

- [x] `metadata.json` has `uuid`, `name`, `description`, `shell-version`, `url`, `version-name`, `settings-schema`
- [x] Extension loads cleanly — `gnome-extensions info devwatch@github.io` shows **ENABLED**
- [x] No errors in `make log` / `journalctl -o cat /usr/bin/gnome-shell`
- [x] `prefs.js` preferences window opens without errors
- [x] `make pack` produces `devwatch@github.io.shell-extension.zip`
- [ ] Tested on a clean GNOME session (nested with `make nested`)
- [ ] Screenshot(s) prepared (panel button, dropdown, preferences window)

### Build and submit

```bash
# 1. Build the zip
make pack

# 2. Verify the zip contents
unzip -l devwatch@github.io.shell-extension.zip

# 3. Go to https://extensions.gnome.org/upload/
#    and upload devwatch@github.io.shell-extension.zip
```

---

## Contributing

Contributions are welcome! This project is being built iteratively, one pillar at a time.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'feat: add my feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

Please follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.

### Adding a translation

```bash
# 1. Add your locale code to po/LINGUAS (e.g. 'de' for German)
echo "de" >> po/LINGUAS

# 2. Create / update the .po file
make update-po          # creates po/de.po if it doesn’t exist

# 3. Translate the strings in po/de.po using Poedit or any .po editor

# 4. Compile and test
make compile-mo
make link
```

### Reporting Issues

Use [GitHub Issues](https://github.com/Adithya-Balan/DevWatch/issues). Include:
- GNOME Shell version (`gnome-shell --version`)
- Distribution and version
- Steps to reproduce
- Relevant log output (`journalctl -o cat /usr/bin/gnome-shell`)

---

## Roadmap

- [x] Scaffold: Panel button + dropdown (Step 1)
- [x] `utils/subprocess.js` — async CLI helper (Step 2)
- [x] `utils/procReader.js` — `/proc` filesystem helpers (Step 3)
- [x] `core/projectDetector.js` — focus-window → git root detection (Step 4)
- [x] `core/processTracker.js` — `/proc` scan with project-grouped CPU/RAM (Step 5)
- [x] `ui/projectSection.js` — Active Projects dropdown renderer (Step 6)
- [x] **Pillar 1 complete** — Live project-aware process intelligence (Step 7)
- [x] `core/portMonitor.js` — `ss -tulnp` parser + dev-port detection + conflict tracking (Step 8)
- [x] `ui/portSection.js` — Active Ports renderer with Kill button (Step 9)
- [x] `core/conflictNotifier.js` — GNOME notifications on newly occupied dev ports (Step 10)
- [x] One-click Copy PID + Open Terminal at project root (Step 11)
- [x] **Pillar 2 complete** — Intelligent port & service control (Step 12)
- [x] `ui/healthSummary.js` — zombie / orphan / idle-dev candidate detection (Step 13)
- [x] `ui/alertsSection.js` — Cleanup Candidates renderer with Clean All + Kill (Step 14)
- [x] Pillar 3 wired into extension.js + status dot updated (Step 15)
- [x] **Pillar 3 complete** — Dev environment cleanup engine (Step 16)
- [x] `core/snapshotManager.js` — save/list/load/restore/delete session JSON (Step 17)
- [x] `ui/snapshotSection.js` — Save Now, Restore & Delete per snapshot row (Step 18)
- [x] Pillar 4 wired into extension.js (Step 19)
- [x] **Pillar 4 complete** — Dev session snapshot & restore (Step 20)
- [x] `core/buildDetector.js` — active build tracking + persisted run history (Step 21)
- [x] `ui/perfSection.js` — Build Performance renderer: active builds + history rows (Step 22)
- [x] Pillar 5 wired into extension.js + status dot updated (Step 23)
- [x] **Pillar 5 complete** — Dev build performance intelligence (Step 24)
- [x] `schemas/org.gnome.shell.extensions.devwatch.gschema.xml` — GSettings schema (Step 25)
- [x] `prefs.js` — GTK4/Adw preferences window with 4 pages (Step 26)
- [x] GSettings wired into all modules — live poll-interval, idle threshold, notify toggle, system-ports toggle, history cap (Step 27)
- [x] **Preferences complete** — user-configurable settings (Step 28)
- [x] `utils/i18n.js` + `po/` scaffold + Makefile i18n targets + all UI strings wrapped in `_()` (Step 29)
- [x] **i18n infrastructure complete** — ready for community translations (Step 29)
- [x] `make pack` improved — compiles schemas + MO files; EGO submission section added to README (Step 30)
- [x] **Submission-ready** — `devwatch@github.io.shell-extension.zip` buildable with `make pack` (Step 30)

---

## License

[MIT](LICENSE) © 2026 [Adithya Balan](https://github.com/Adithya-Balan)
