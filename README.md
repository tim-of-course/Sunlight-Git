# Sunlight

<img width="2160" height="1086" alt="Screenshot 2026-08-20 141720" src="https://github.com/user-attachments/assets/680d5280-c5b9-453d-a555-76a62a8183c7" />

A **local multi-repository Git desktop app**. Open several repos side by side, stage and commit, browse history and files, and keep a long-running command (for example `bun run dev`) alive in the same column.

This repository is the desktop app (Tauri 2 + Rust + SolidJS). It is not a hosted Git service.

> Status: **0.1.0**, early public preview. Expect sharp edges. Git operations run against your real working trees.

## Why it exists

Most Git GUIs are one-repo-at-a-time. Sunlight is built for people who keep several local checkouts open: an app, a library, a docs repo, a sibling service. Each repository is a column. Git work and a process in that repo can happen together instead of forcing you into a separate terminal.

## Features

- **Multi-repo workspace** — add folders by path or Browse; reorder columns; recents persist across launches
- **Status and history** — staged / unstaged / untracked / conflicted files, branches, remotes, stashes, commit graph
- **Day-to-day Git** — stage, discard, commit, commit-and-push, fetch / pull / push, branch create / switch / track / rename / delete, stash, merge/rebase continue or abort
- **Diffs and a small editor** — inspect diffs, search and open files, save, or open in an external editor / Cursor
- **Per-repo commands** — run a shell command in that repository; stop it; handle common port conflicts
- **Local only** — uses the `git` on your machine; workspace list is stored on disk, not in the cloud

Adding a folder that is not yet a Git repository **initializes** one there.

## Prerequisites

Install these before the first run:

| Tool | Notes |
| --- | --- |
| [Git](https://git-scm.com/) | Must be on `PATH` (Windows: `C:\Program Files\Git\cmd` is also searched) |
| [Rust](https://rustup.rs/) | Stable toolchain; needed to compile the Tauri backend |
| [Bun](https://bun.sh/) | Frontend install and scripts |
| Platform toolchain | [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) (MSVC Build Tools on Windows, Xcode CLT on macOS, webkit/gtk packages on Linux) |

## Run

```powershell
git clone https://github.com/tim-of-course/Sunlight-Git.git
cd Sunlight-Git
bun install
bun run tauri dev
```

On macOS or Linux the same commands work in any POSIX shell.

Then add repositories with **Browse** or by pasting a path. A command such as `bun run dev` can keep running while you stage, commit, and push in that column.

### Production build

```powershell
bun run tauri build
```

Installers land under `src-tauri/target/release/bundle/`.

## Test

```powershell
bun run test
bun run typecheck
cd src-tauri
cargo test
```

## How it is put together

| Path | Role |
| --- | --- |
| `src/` | SolidJS UI (workspace, columns, diffs, editor, file browser) |
| `src-tauri/src/` | Rust backend: Git via subprocess, file I/O, per-repo command runner, workspace persistence |
| `src-tauri/tauri.conf.json` | Window, bundle, and app identifier (`com.sunlight.app`) |

The UI talks to Rust through Tauri commands (`git_op`, `run_command`, file APIs, workspace APIs). Git is never rewritten in-process; Sunlight shells out to `git` with timeouts and output limits.

Workspace membership is saved to:

- Windows: `%LOCALAPPDATA%\Sunlight\workspace.json`
- macOS: `~/Library/Application Support/Sunlight/workspace.json`
- Linux: `$XDG_CONFIG_HOME/Sunlight/workspace.json` (or `~/.config/...`)

Override the file with `SUNLIGHT_WORKSPACE_FILE` if you need a custom location.

## License

[Apache License 2.0](LICENSE)
