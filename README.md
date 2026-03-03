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

### Pillar 3 — Dev Environment Cleanup Engine
- Identifies zombie and orphaned dev processes (detached, idle, parentless)
- Single-click "Clean Dev State" with optional confirmation list

### Pillar 4 — Dev Session Snapshot & Restore
- Captures running processes, ports, active git branches
- Restores full dev environment after reboot

### Pillar 5 — Dev Performance Intelligence
- Detects active builds (`npm`, `cargo`, `make`, `gradle`, `go build`, …)
- Records peak CPU/RAM per build, trends over the last 5 runs

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

### From Source (Development)

```bash
# 1. Clone the repository
git clone https://github.com/Adithya-Balan/DevWatch.git
cd DevWatch

# 2. Symlink into GNOME's extension directory
make link

# 3. Log out and log back in (required once on GNOME Wayland)
#    Then enable the extension:
gnome-extensions enable devwatch@github.io
```

### Verify it loaded

```bash
gnome-extensions info devwatch@github.io
```

You should see `● DevWatch` appear in the top-right panel area.

---

## Development

### Project Structure

```
DevWatch/
├── extension.js          ← Entry point (ESM, GNOME 45+)
├── metadata.json         ← Extension identity & GNOME version compatibility
├── stylesheet.css        ← St widget CSS
├── Makefile              ← Dev helpers (link, enable, log, nested)
├── ui/
│   ├── projectSection.js ← Active Projects section (process rows + Open Terminal)
│   ├── portSection.js    ← Active Ports section (Kill + Copy PID buttons)
│   ├── cleanupSection.js ← Cleanup Engine UI           (Pillar 3 — planned)
│   ├── snapshotSection.js← Session Snapshot controls   (Pillar 4 — planned)
│   └── perfSection.js    ← Performance Summary         (Pillar 5 — planned)
├── core/
│   ├── projectDetector.js← Git root + window focus tracking
│   ├── processTracker.js ← /proc traversal, process→project mapping
│   ├── portMonitor.js    ← ss -tulnp parsing + runtime tracking + conflict detection
│   ├── conflictNotifier.js ← GNOME notifications for newly occupied dev ports
│   ├── cleanupEngine.js  ← Orphan/zombie detection     (Pillar 3 — planned)
│   ├── snapshotManager.js← Save/restore session JSON   (Pillar 4 — planned)
│   └── buildDetector.js  ← Build detection + resource spike recording (Pillar 5 — planned)
└── utils/
    ├── subprocess.js     ← Async execCommunicate() helper
    └── procReader.js     ← /proc file read helpers
```

### Makefile Targets

```bash
make link     # Symlink project files into GNOME extension dir (run after adding files)
make enable   # Enable the extension
make disable  # Disable the extension
make pack     # Build distributable .zip
make log      # Tail GNOME Shell logs (your console.log() appears here)
make nested   # Launch a nested Wayland GNOME session for safe testing
make status   # Show gnome-extensions info
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

## Contributing

Contributions are welcome! This project is being built iteratively, one pillar at a time.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'feat: add my feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

Please follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.

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
- [ ] Pillar 3: Dev environment cleanup engine
- [ ] Pillar 4: Session snapshot & restore
- [ ] Pillar 5: Build performance intelligence
- [ ] Preferences UI (`prefs.js`)
- [ ] i18n / translations
- [ ] extensions.gnome.org submission

---

## License

[MIT](LICENSE) © 2026 [Adithya Balan](https://github.com/Adithya-Balan)
