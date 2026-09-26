"""Exercise a signed Windows update on a disposable GitHub Actions runner.

Only the temporary baseline accepts loopback HTTP and auto-installs updates.
The downloaded release installer and its signature are used unchanged.
"""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import platform
import subprocess
import threading
import time


if os.environ.get("GITHUB_ACTIONS") != "true" or platform.system() != "Windows":
    raise RuntimeError("This installer test requires a disposable Windows Actions runner")

root = Path(__file__).resolve().parents[1]
scratch = Path(os.environ["RUNNER_TEMP"]) / "sunlight-update-smoke"
scratch.mkdir()
assets = scratch / "assets"
assets.mkdir()
config = json.loads((root / "src-tauri/tauri.conf.json").read_text())
version = config["version"]
subprocess.run([
    "gh", "release", "download", f"v{version}", "--repo", os.environ["GITHUB_REPOSITORY"],
    "--pattern", "*x64-setup.exe*", "--dir", str(assets),
], check=True)
installer = next(assets.glob("*-setup.exe"))
signature = Path(str(installer) + ".sig").read_text().strip()
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(assets)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base_url = f"http://127.0.0.1:{server.server_port}"
(assets / "latest.json").write_text(json.dumps({
    "version": version,
    "platforms": {"windows-x86_64": {"url": f"{base_url}/{installer.name}", "signature": signature}},
}))

baseline = scratch / "baseline"
subprocess.run(["git", "worktree", "add", "--detach", str(baseline), "HEAD"], cwd=root, check=True)
config["version"] = "0.0.0"
config["bundle"]["createUpdaterArtifacts"] = False
config["plugins"]["updater"]["endpoints"] = [f"{base_url}/latest.json"]
config["plugins"]["updater"]["dangerousInsecureTransportProtocol"] = True
(baseline / "src-tauri/tauri.conf.json").write_text(json.dumps(config))
manifest = baseline / "src-tauri/Cargo.toml"
manifest.write_text(manifest.read_text().replace(f'version = "{version}"', 'version = "0.0.0"', 1))
package = baseline / "package.json"
package_data = json.loads(package.read_text())
package_data["version"] = "0.0.0"
package.write_text(json.dumps(package_data))
lib = baseline / "src-tauri/src/lib.rs"
source = lib.read_text(encoding="utf-8")
setup = "            let handle = app.handle().clone();"
assert source.count(setup) == 1
source = source.replace(setup, setup + '''
            let updater_app = handle.clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_updater::UpdaterExt;
                let update = updater_app.updater().unwrap().check().await.unwrap().unwrap();
                update.download_and_install(|_, _| {}, || {}).await.unwrap();
                updater_app.restart();
            });
''')
lib.write_text(source, encoding="utf-8")
environment = dict(os.environ, CARGO_TARGET_DIR=str(root / "src-tauri/target"))
subprocess.run(["bun", "install", "--frozen-lockfile"], cwd=baseline, env=environment, check=True)
subprocess.run(["bun", "run", "tauri", "build", "--ci", "--bundles", "nsis"], cwd=baseline, env=environment, check=True)
baseline_installer = root / "src-tauri/target/release/bundle/nsis/Sunlight_0.0.0_x64-setup.exe"
installed = scratch / "installed"
subprocess.run([str(baseline_installer), "/S", f"/D={installed}"], check=True)
executable = installed / "sunlight-tauri.exe"
environment["SUNLIGHT_WORKSPACE_FILE"] = str(scratch / "workspace.json")
log_path = scratch / "update.log"
try:
    with log_path.open("wb") as log:
        process = subprocess.Popen([str(executable)], env=environment, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            installed_version = subprocess.check_output([
                "powershell", "-NoProfile", "-Command",
                "(Get-Item -LiteralPath '" + str(executable).replace("'", "''") + "').VersionInfo.ProductVersion",
            ], text=True).strip()
            if process.poll() is not None and installed_version == version:
                running = subprocess.check_output(["tasklist", "/FI", "IMAGENAME eq sunlight-tauri.exe", "/FO", "CSV", "/NH"], text=True)
                if "sunlight-tauri.exe" in running:
                    print(f"PASS: installed 0.0.0, downloaded and verified the signed {version} installer, updated, and relaunched.")
                    break
            time.sleep(1)
        else:
            raise RuntimeError("Update did not finish and relaunch within 120 seconds")
finally:
    subprocess.run(["taskkill", "/F", "/T", "/IM", "sunlight-tauri.exe"], check=False, creationflags=subprocess.CREATE_NO_WINDOW)
    server.shutdown()
    if log_path.exists():
        print(log_path.read_text(errors="replace"))
