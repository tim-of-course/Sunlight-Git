# Release readiness

The first release is version 0.1.0, with identifier
`io.github.tim-of-course.sunlight`. No migration from the previous development
identifier is needed: no release using it was published. Workspace files use
Sunlight's own directory and are independent of this identifier.

## September 26, 2026 audit fixes

- GitHub's `TAURI_SIGNING_PRIVATE_KEY` secret contains the existing updater key.
  Its public key matches `tauri.conf.json`. The private key remains gitignored.
- Updates download first, then check the current unsaved edits and running
  commands before installation. Cancelling keeps the app open and releases the
  downloaded update. The app becomes inert only while installation runs.
- The install instructions and website explain that Git is required.
- Rustls is locked to 0.23.45 and Vitest to 4.1.11, resolving the reported TLS
  and development-server advisories.
- Tauri 2.12 removes the five unmaintained `unic-*` dependencies. Notify 8.2
  removes the unmaintained `instant` dependency.
- GLib 0.18.5 has the upstream RUSTSEC-2024-0429 fix backported locally. See
  [the backport record](../../src-tauri/vendor/glib-0.18.5/SUNLIGHT-PATCH.md).

The remaining RustSec maintenance notice is RUSTSEC-2024-0370 for
`proc-macro-error` 1.0.4, a build-time dependency of GTK3's `gtk3-macros` and
`glib-macros`. It reports unmaintained software, not a known vulnerability.
Tauri retains it upstream; replacing GTK3 or forking its macro crates solely
to remove this notice would expand our maintenance burden. Keep it visible
and recheck when updating Tauri; there is no blanket advisory suppression.

Sources:

- https://rustsec.org/advisories/RUSTSEC-2026-0285.html
- https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9
- https://rustsec.org/advisories/RUSTSEC-2024-0370.html
- https://github.com/tauri-apps/tauri/blob/dev/.cargo/audit.toml

## Verification

Frontend tests cover declining installation after work changes during a
download, and consenting before installation/relaunch. The Linux integration
test exercises GLib's affected string iterator with GLib optimized, because
the old FFI bug can disappear in unoptimized tests.

The publish workflow builds signed updater artifacts for Windows x64,
Linux x64, and Apple Silicon macOS. Each job installs its bundle and checks
that the installed app survives startup on a fresh runner. The macOS job also
verifies the app signature. These are installation/startup checks, not a
substitute for interactive GUI or Gatekeeper testing.

The workflow creates a draft release. Before publishing, verify all jobs
passed and `latest.json` contains valid URLs and signatures for all three
platforms. Windows Authenticode and Apple notarization are not configured;
the website documents the preview-build installation warnings.
