# DevWatch — Complete User & Developer Guide

> **Version:** 2 | **Platform:** GNOME Shell 45–50 | **Date:** March 2026

---

## Table of Contents

1. [What is DevWatch?](#1-what-is-devwatch)
2. [The Core Idea](#2-the-core-idea)
3. [Installation](#3-installation)
4. [Local Testing](#4-local-testing)
5. [Feature Walkthrough](#5-feature-walkthrough)
   - [Panel Button & Status Dot](#51-panel-button--status-dot)
   - [Pillar 1 — Active Projects](#52-pillar-1--active-projects)
   - [Pillar 2 — Active Ports & Services](#53-pillar-2--active-ports--services)
   - [Pillar 3 — Cleanup Engine](#54-pillar-3--cleanup-engine)
   - [Pillar 4 — Session Snapshots](#55-pillar-4--session-snapshots)
   - [Pillar 5 — Build Performance](#56-pillar-5--build-performance)
6. [Preferences](#6-preferences)
7. [Understanding the Status Dot](#7-understanding-the-status-dot)
8. [Data Storage](#8-data-storage)
9. [Adding a Translation](#9-adding-a-translation)
10. [Development Workflow](#10-development-workflow)
11. [Troubleshooting](#11-troubleshooting)
12. [Architecture Overview](#12-architecture-overview)

---

## 1. What is DevWatch?

DevWatch is a **GNOME Shell panel extension** that adds a developer-aware intelligence layer to your desktop.

It lives as a small `● DevWatch` button in your top panel. Click it to open a dropdown that
shows — in one place — everything happening in your development environment:

- Which projects are running and how much CPU/RAM they use
- Which ports are bound and which processes own them
- Zombie and orphaned dev processes wasting memory
- A one-click way to save and restore your entire dev session
- A history of your recent builds with timing and resource peaks

It replaces four common terminal round-trips:

| Without DevWatch | With DevWatch |
|---|---|
| `lsof -i :3000` | See "Port 3000 → backend-api (node)" in the panel |
| `ps aux \| grep node` | Project cluster with all child processes listed |
| `kill $(lsof -t -i:5173)` | One-click **Kill** button on the port row |
| Reopen 5 terminals after a reboot | **Restore** a saved session snapshot |

---

## 2. The Core Idea

### Project-centric, not process-centric

Every other tool (`htop`, `lsof`, GNOME System Monitor) shows you a flat list of processes.
DevWatch works the other way: it starts from **your projects** and shows you the processes
that belong to each one.

### How processes are mapped to projects

1. **Window focus** — when you focus a terminal or editor window, DevWatch reads its CWD via
   `/proc/<pid>/cwd` and walks up the directory tree looking for a `.git` folder.
2. **Process scanner** — every 10 seconds DevWatch reads `/proc` to find all running processes,
   maps each one to a project root via `/proc/<pid>/cwd → git root`, and groups them.
3. **Port mapper** — runs `ss -Htulnp` to list listening sockets, then matches each PID back
   to its project using the process map built in step 2.

Everything runs **locally, offline, with no elevated privileges**. No cloud, no telemetry.

---

## 3. Installation

### Prerequisites

| Tool | Purpose | Install |
|---|---|---|
| GNOME Shell 45–50 | Runtime | Includes Ubuntu 26.04.1 LTS |
| `ss` | Port scanning | `sudo apt install iproute2` |
| `git` | Project root detection | `sudo apt install git` |
| `glib-compile-schemas` | Build step | `sudo apt install libglib2.0-dev-bin` |

### From source

```bash
# 1. Clone
git clone https://github.com/Adithya-Balan/DevWatch.git
cd DevWatch

# 2. Compile schema and symlink files into GNOME's extension directory
make link

# 3. Enable the extension
gnome-extensions enable devwatch@github.io

# 4. Reload GNOME Shell  (Wayland — must log out and back in)
gnome-session-quit --logout
#   OR on X11 only:
#   killall -SIGUSR1 gnome-shell
```

After logging back in, the `● DevWatch` button appears in the top-right corner of your panel.

### Verify it loaded

```bash
gnome-extensions info devwatch@github.io
# Should show:  State: ENABLED
```

---

## 4. Local Testing

### Option A — Test in your live session (simplest)

```bash
make link
gnome-extensions enable devwatch@github.io
# Log out and back in
```

The extension is now active. Open the panel dropdown to see it.

### Option B — Safe nested session (recommended for development)

A nested GNOME Shell runs as a **window inside your current session** — if you break
something it won't crash your desktop.

```bash
# From a terminal INSIDE your graphical session (not SSH):
make nested
```

This opens a new window with a complete GNOME desktop inside it.
Inside the nested window, open a terminal and run:

```bash
gnome-extensions enable devwatch@github.io
```

> **Note:** `make nested` must be run from a terminal that has `$WAYLAND_DISPLAY` set.
> If you're using the VS Code integrated terminal, open a regular GNOME Terminal instead,
> `cd` to the project, and run `make nested` from there.

### Option C — Enable/disable without logging out (Wayland workaround)

```bash
# Disable, wait 1 s, re-enable — GNOME hot-reloads the extension
gnome-extensions disable devwatch@github.io && sleep 1 && gnome-extensions enable devwatch@github.io
```

This works for most JS changes. If you edit `metadata.json` or `schemas/`, a full log-out/in is required.

### Watching logs in real time

```bash
make log
# Equivalent: journalctl -f -o cat /usr/bin/gnome-shell
```

Every `console.log('[DevWatch] ...')` call appears here immediately.
Errors appear as `[DevWatch] <message>`.

---

## 5. Feature Walkthrough

### 5.1 Panel Button & Status Dot

The `● DevWatch` button sits in the top-right area of your panel.

The coloured dot to the left of "DevWatch" is a **health indicator**:

| Colour | Meaning |
|---|---|
| 🟢 Green | Everything looks healthy |
| 🟡 Yellow | High CPU (>80%), idle dev tools, or hot build (CPU >90%) |
| 🔴 Red | Zombie process, orphan process, or newly occupied dev port detected |

Click the button to open the dropdown. The dropdown auto-refreshes whenever you open it
and also polls every 10 seconds in the background (configurable in Preferences).

---

### 5.2 Pillar 1 — Active Projects

**Section header:** `ACTIVE PROJECTS`

#### What it shows

One expandable row per detected project, sorted highest CPU first:

```
▸ backend-api   [3 proc · CPU 4.2% · RAM 312 MB]
```

Expand a project row to see every process inside it:

```
  node server.js   (4821)   S   CPU 1.2%   RAM 128 MB   [⧉ Copy PID]
  postgres         (4900)   S   CPU 0.8%   RAM  96 MB   [⧉ Copy PID]
  redis-server     (4981)   S   CPU 0.1%   RAM  12 MB   [⧉ Copy PID]
  ⎋ Open terminal here
```

#### Actions

- **⧉ Copy PID** — copies the process ID to your clipboard (useful for `strace`, `gdb`, etc.)
- **⎋ Open terminal here** — opens `gnome-terminal` with CWD set to the project's git root

#### How to trigger it

Open a terminal, navigate to any git repository, and run a process there:

```bash
cd ~/Projects/my-app
node server.js &
```

Within 10 seconds (or immediately when you open the dropdown) the project appears.

#### Empty state

If no projects are detected: *"No dev projects detected — Focus a terminal or editor window to detect a project"*

This means: click on a terminal window that is `cd`'d inside a git repo — DevWatch will pick it up immediately via the focus-change signal.

---

### 5.3 Pillar 2 — Active Ports & Services

**Section header:** `ACTIVE PORTS`

#### What it shows

All listening sockets from `ss -Htulnp`, grouped and color-coded:

```
● 3000   TCP   node (4821)     backend-api   2h 14m   [⧉ Copy PID]  [Kill]
● 5173   TCP   vite (9002)     frontend      45m      [⧉ Copy PID]  [Kill]
  8080   TCP   python3 (4200)  —             12m      [⧉ Copy PID]  [Kill]
```

- **Blue dot (●)** = recognised dev port (3000, 4200, 5000, 5173, 8080, 8888, …)
- **No dot / dimmed** = system port (shown only if "Show system ports" is enabled in Preferences)
- **Runtime** = how long this port has been occupied since DevWatch first saw it
- **Project** = the git root the owning process belongs to; `—` if unknown

#### Actions

- **⧉ Copy PID** — copies the PID of the process owning this port
- **Kill** — sends SIGTERM to the process; the row disappears after ~1.5 s

#### Conflict notifications

When a dev port (e.g. 3000) is **newly occupied** by a process, DevWatch fires a GNOME desktop notification:

> **DevWatch: Port 3000 occupied**
> node (PID 4821) · backend-api

This fires once per (protocol, port, PID) triple — it won't spam you during polling.
Disable in Preferences → Ports → "Port conflict notifications".

#### Built-in dev port set

3000, 3001, 3002, 3003, 4000, 4200, 5000, 5001, 5173, 6006, 8000, 8080, 8081, 8888, 9000, 9090,
4173, 5432, 3306, 6379, 27017, 9200, 9300, 6443, 8001, 2375, 2376

---

### 5.4 Pillar 3 — Cleanup Engine

**Section header:** `CLEANUP CANDIDATES   [Clean All (N)]`

#### What it shows

Processes that are wasting resources and are safe to terminate:

```
☠ node      (4821)  ZOMBIE   128 MB   backend-api   awaiting reap
⚱ nodemon   (5100)  ORPHAN    28 MB   —             [Kill]
⏸ vite      (6200)  IDLE       8 MB   frontend      [Kill]
```

#### Three candidate types

| Icon | Type | Meaning | Can Kill? |
|---|---|---|---|
| ☠ | **Zombie** | Process exited but not reaped by its parent. Already dead — only the PID table entry remains. | No — killing is meaningless; parent must `wait()` |
| ⚱ | **Orphan** | A known dev tool (node, cargo, go, …) whose parent is dead/PID 1 AND has no detectable project root | Yes |
| ⏸ | **Idle dev** | A known dev tool at <0.5% CPU for >10 min (configurable) with no open port | Yes |

#### Actions

- **Kill (per row)** — SIGTERM the individual process
- **Clean All (N)** — SIGTERM all killable candidates (zombies excluded) at once

#### When to use it

- After closing a project: dev watchers (vite, nodemon, pytest-watch) that were left running show up here
- After a crash: orphaned server processes that lost their parent shell
- End of the day: idle background services burning RAM

---

### 5.5 Pillar 4 — Session Snapshots

**Section header:** `SESSION SNAPSHOTS   [Save Now]`

#### What it shows

Your saved session snapshots, newest first:

```
📷 before-refactor   03 Mar 14:30   3 proj   [Restore]  [✕]
📷 auto              03 Mar 09:15   2 proj   [Restore]  [✕]
```

Each snapshot records:
- All active project roots + their git branch names at the time of saving
- All currently bound dev ports + which process/project owns them
- Process names in each project cluster
- Timestamp + optional label

#### Actions

- **Save Now** — captures the current state and saves to `~/.local/share/devwatch/snapshots/`. Up to 20 snapshots are kept; oldest are auto-pruned.
- **Restore** — opens a new `gnome-terminal` window for each saved project root, pre-titled with the project name and branch. Does **not** restart processes — it just gets your terminals in the right places.
- **✕ Delete** — permanently removes the snapshot file

#### Snapshot filename format

`YYYY-MM-DD_HH-MM-SS_<label>.json`

Example: `2026-03-03_14-30-00_before-refactor.json`

#### Typical workflow

```
Morning: Restore last snapshot → all terminals open in the right projects
Evening: Save Now → close laptop
```

---

### 5.6 Pillar 5 — Build Performance

**Section header:** `BUILD PERFORMANCE`

#### What it shows

**Active builds** (processes currently running a build tool with >1% CPU):

```
⚙  cargo    backend-api   1m 12s    CPU 82%
⚙  npm      frontend      8s        CPU 45%
```

**Recent builds** (completed runs, newest first):

```
RECENT BUILDS
✓  cargo    backend-api   1m 42s   CPU 78%   RAM 312 MB
✓  npm      frontend        48s   CPU 45%   RAM 180 MB
✗  tsc      frontend        4s    CPU 20%   RAM  64 MB
```

- **⚙ Active** (amber) — build currently running; shows live elapsed time and current CPU%
- **✓ Completed** (green) — build finished; shows total duration, peak CPU%, peak RAM
- **✗ Short** (grey) — build finished in <5 s (considered incomplete or failed)

#### Build tools tracked

`npm`, `yarn`, `pnpm`, `bun`, `webpack`, `vite`, `esbuild`, `swc`, `tsc`, `cargo`, `rustc`,
`go`, `make`, `cmake`, `ninja`, `gcc`, `g++`, `clang`, `mvn`, `gradle`, `javac`, `pip`,
`pytest`, `docker build`, `podman build`, and more (35+ tools total).

#### Persistence

Build history is saved to `~/.local/share/devwatch/build_history.json` and restored every time
the extension is reloaded — so your build history survives lock screen, log-out, and reboots.

Up to 5 runs per project are kept in history. The number shown in the panel is configurable in Preferences.

---

## 6. Preferences

Open with:

```bash
gnome-extensions prefs devwatch@github.io
# or: Settings → Extensions → DevWatch → ⚙
```

### General tab

| Setting | Default | Description |
|---|---|---|
| Poll interval | 10 s | How often DevWatch rescans processes and ports. Lower = fresher data, slightly more CPU. Range: 5–60 s. Changes take effect **live** without reloading the extension. |

### Ports tab

| Setting | Default | Description |
|---|---|---|
| Show system ports | Off | When on, all listening ports appear — not just the built-in dev-port set. |
| Port conflict notifications | On | GNOME notifications when a dev port is newly occupied. Turn off if noisy. |

### Cleanup tab

| Setting | Default | Description |
|---|---|---|
| Idle threshold | 10 min | Minutes of <0.5% CPU (with no open port) before a dev tool is flagged as idle. Range: 1–60 min. |

### Performance tab

| Setting | Default | Description |
|---|---|---|
| Max history rows | 8 | Number of completed build runs shown in the BUILD PERFORMANCE section. Range: 1–20. |

---

## 7. Understanding the Status Dot

The dot changes colour based on the most severe condition detected:

```
Normal day:        ● (green)   — everything running, nothing unusual
Running webpack:   ● (yellow)  — build pushing CPU >90%
Left vite running: ● (yellow)  — idle dev tool detected after threshold
Port 3000 grabbed: ● (red)     — new process on a dev port (notification also fires)
Zombie detected:   ● (red)     — un-reaped zombie process in process table
```

The dot returns to green as soon as the condition is resolved — e.g. after you kill the
idle process or the zombie is reaped.

---

## 8. Data Storage

All data is stored locally in `~/.local/share/devwatch/`:

```
~/.local/share/devwatch/
├── snapshots/
│   ├── 2026-03-03_14-30-00_before-refactor.json
│   └── 2026-03-03_09-15-00_auto.json
└── build_history.json
```

**Nothing is ever sent off your machine.**

To wipe all DevWatch data:

```bash
rm -rf ~/.local/share/devwatch/
```

---

## 9. Adding a Translation

DevWatch uses standard GNU gettext. Adding a translation for a new language:

```bash
# 1. Add your locale code to po/LINGUAS
echo "de" >> po/LINGUAS   # German example

# 2. Extract strings (creates/updates the .pot template)
make pot

# 3. Create the .po translation file
make update-po   # creates po/de.po

# 4. Edit po/de.po in Poedit, GNOME Translation Editor, or any text editor
#    Translate each msgstr "" string.

# 5. Compile to binary and link
make compile-mo
make link
```

The extension will use your translation automatically when GNOME is set to that language.

---

## 10. Development Workflow

### One-time setup

```bash
git clone https://github.com/Adithya-Balan/DevWatch.git
cd DevWatch
make link
gnome-extensions enable devwatch@github.io
# Log out and back in
```

### Iterating on code

1. Edit any `.js` or `.css` file in the project
2. Run:
   ```bash
   gnome-extensions disable devwatch@github.io
   gnome-extensions enable devwatch@github.io
   ```
   On Wayland this requires a log-out/in — use the nested session instead.
3. Watch `make log` for errors

### Adding a new file

After creating any new `.js` or `.css` file, re-run:

```bash
make link
```

This symlinks the new file into the GNOME extension directory.

### After changing the schema

After editing `schemas/org.gnome.shell.extensions.devwatch.gschema.xml`:

```bash
make link   # auto-runs compile-schemas
# Then reload the extension (log out/in on Wayland)
```

### Build the distribution zip

```bash
make pack
# Produces: devwatch@github.io.shell-extension.zip
```

### All Makefile targets

| Target | Description |
|---|---|
| `make link` | Compile schema + symlink all files into GNOME extension dir |
| `make compile-schemas` | Compile GSettings schema only |
| `make enable` | `gnome-extensions enable` |
| `make disable` | `gnome-extensions disable` |
| `make pack` | Build distributable .zip (compiles schema + .mo files first) |
| `make pot` | Extract translatable strings → `po/devwatch@github.io.pot` |
| `make update-po` | Merge .pot changes into existing .po translation files |
| `make compile-mo` | Compile .po files → binary .mo files in `locale/` |
| `make log` | Tail GNOME Shell journal (your `console.log` appears here) |
| `make nested` | Launch a nested Wayland GNOME Shell for safe testing |
| `make status` | Show `gnome-extensions info` |

---

## 11. Troubleshooting

### Extension doesn't appear after enabling

- On Wayland you **must** log out and back in after the first `gnome-extensions enable`
- Check `make status` — if State is `ERROR`, the extension crashed on load
- Check `make log` for the specific JavaScript error

### `make nested` fails (exit code 2)

`make nested` must be run from a terminal **inside your graphical GNOME session** with
`$WAYLAND_DISPLAY` set. The VS Code integrated terminal may not have this variable.

Fix: open a regular GNOME Terminal (`Ctrl+Alt+T`), `cd` to the project, and run `make nested` from there.

### "No dev projects detected" even though I have terminals open

- The focused window must be a terminal or editor whose process has a CWD **inside a git repo**
- Verify: `cd ~/Projects/my-repo && git rev-parse --show-toplevel` — must return a path
- Click on the terminal window to focus it — DevWatch re-detects on window focus

### Port not appearing in the panel

- Confirm the process is actually listening: `ss -tulnp | grep 3000`
- If it's not in the built-in dev port set and "Show system ports" is off, it won't appear
- Enable **Show system ports** in Preferences → Ports

### Crash / extension stops responding

```bash
make log
# Look for lines starting with JS ERROR or [DevWatch]
```

Disable and re-enable to recover:

```bash
gnome-extensions disable devwatch@github.io
gnome-extensions enable devwatch@github.io
```

### Preferences window doesn't open

```bash
gnome-extensions prefs devwatch@github.io 2>&1
```

Most common cause: GSettings schema not compiled. Fix:

```bash
make link   # re-compiles the schema
```

---

## 12. Architecture Overview

```
extension.js  (entry point)
│
├── core/                       ← Data layer — no UI, no GLib.idle, pure logic
│   ├── projectDetector.js      Window focus → git root (async, event-driven)
│   ├── processTracker.js       /proc scan every 10s → ProjectData map
│   ├── portMonitor.js          ss -tulnp → PortRecord list
│   ├── conflictNotifier.js     Deduplicated GNOME notifications for new ports
│   ├── cleanupEngine.js        Zombie/orphan/idle-dev detection (sync, per-scan)
│   ├── snapshotManager.js      JSON save/list/load/restore to ~/.local/share/devwatch/
│   └── buildDetector.js        Build tool detection, peakCPU/RAM tracking, history
│
├── ui/                         ← Stateless renderers — caller passes data, they build rows
│   ├── projectSection.js       PopupSubMenuMenuItem per project
│   ├── portSection.js          One row per port, Kill + Copy PID buttons
│   ├── cleanupSection.js       Clean All button + per-candidate Kill
│   ├── snapshotSection.js      Save Now, Restore, Delete rows
│   └── perfSection.js          Active build rows + history rows
│
├── utils/
│   ├── subprocess.js           Promisified Gio.Subprocess wrapper
│   ├── procReader.js           Sync /proc/<pid>/{stat,statm,cmdline,cwd} reader
│   └── i18n.js                 Re-exports gettext/ngettext for UI modules
│
├── schemas/                    GSettings schema definition
├── po/                         Translation source files
├── prefs.js                    GTK4/Adw preferences window
└── stylesheet.css              St widget CSS (panel dot, section titles, buttons)
```

### Data flow per refresh cycle (every 10 s or on menu open)

```
processTracker.scan()        — reads /proc, builds ProjectData map
        │
        ▼
portMonitor.scan()           — runs ss, maps port→PID→project
        │
        ▼
cleanupEngine.analyse()      — zombie/orphan/idle detection (in-memory, no I/O)
buildDetector.analyse()      — build tool CPU tracking (in-memory, async persist)
snapshotManager.list()       — async dir scan of ~/.local/share/devwatch/snapshots/
        │
        ▼
buildProjectSection()        — clears + rebuilds ACTIVE PROJECTS rows
buildPortSection()           — clears + rebuilds ACTIVE PORTS rows
buildCleanupSection()        — clears + rebuilds CLEANUP CANDIDATES rows
buildSnapshotSection()       — clears + rebuilds SESSION SNAPSHOTS rows
buildPerfSection()           — clears + rebuilds BUILD PERFORMANCE rows
        │
        ▼
_updateStatusDot()           — green / yellow / red based on combined results
```

All async I/O uses `Gio.Subprocess` with `_promisify` — the GNOME main loop is never blocked.
All operations are guarded by a shared `Gio.Cancellable` that is cancelled inside `disable()`
to ensure no callbacks fire after the extension is unloaded.
