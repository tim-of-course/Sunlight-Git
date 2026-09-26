# GLib 0.18 security backport

This is the crates.io `glib` 0.18.5 source archive, with the two-line upstream
fix for RUSTSEC-2024-0429 applied to `src/variant_iter.rs`. The FFI out-pointer
must be mutable; otherwise optimized string iteration can dereference null.

- Archive SHA-256: `233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`
- Fix: https://github.com/gtk-rs/gtk-rs-core/pull/1343
- Advisory: https://rustsec.org/advisories/RUSTSEC-2024-0429.html

Tauri 2's GTK3 dependencies require GLib 0.18. There is no patched 0.18 release;
the upstream fix ships in the incompatible 0.20 line. Cargo uses this source
through `[patch.crates-io]` in `src-tauri/Cargo.toml`. Its original MIT license
and copyright are retained. No advisory is suppressed globally.

Remove this copy and the Cargo override when Tauri supports a patched GLib
release. `src-tauri/tests/glib_variant.rs` exercises the affected iterator in
Linux tests with GLib optimized through Cargo's test profile; this test
protects the otherwise subtle FFI fix.
