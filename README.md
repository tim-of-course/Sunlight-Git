# Sunlight

Local multi-repository Git GUI. Tauri 2 + Rust + SolidJS 1.9.

## Run

```powershell
bun install
bun run tauri dev
```

Open repositories with Browse or by pasting a path. A command (for example `bun run dev`) can stay running while you stage, commit, and push in the same column.

## Test

```powershell
bun run test
bun run typecheck
cd src-tauri
cargo test
```
