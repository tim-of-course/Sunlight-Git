"""Install and launch release bundles on disposable GitHub Actions runners."""

import os
from pathlib import Path
import platform
import signal
import subprocess


root = Path(__file__).resolve().parents[1]
scratch = Path(os.environ["RUNNER_TEMP"]) / "sunlight-install-smoke"
scratch.mkdir(exist_ok=True)
system = platform.system()


def artifact(pattern):
    matches = list((root / "src-tauri" / "target").glob(pattern))
    if len(matches) != 1:
        raise RuntimeError(f"Expected one {pattern} artifact, found {matches}")
    return matches[0]


if system == "Windows":
    installer = artifact("**/bundle/nsis/*-setup.exe")
    installed = scratch / "app"
    subprocess.run([str(installer), "/S", f"/D={installed}"], check=True)
    command = [str(installed / "sunlight-tauri.exe")]
elif system == "Darwin":
    disk_image = artifact("**/bundle/dmg/*.dmg")
    mount = scratch / "mounted"
    subprocess.run(["hdiutil", "attach", str(disk_image), "-nobrowse", "-mountpoint", str(mount)], check=True)
    try:
        app = next(mount.glob("*.app"))
        installed = scratch / app.name
        subprocess.run(["ditto", str(app), str(installed)], check=True)
    finally:
        subprocess.run(["hdiutil", "detach", str(mount)], check=True)
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(installed)], check=True)
    command = [str(installed / "Contents" / "MacOS" / "sunlight-tauri")]
else:
    package = artifact("**/bundle/deb/*.deb")
    subprocess.run(["sudo", "dpkg", "-i", str(package)], check=True)
    command = ["dbus-run-session", "--", "xvfb-run", "-a", "/usr/bin/sunlight-tauri"]

environment = dict(os.environ, SUNLIGHT_WORKSPACE_FILE=str(scratch / "workspace.json"))
options = {"creationflags": subprocess.CREATE_NO_WINDOW} if system == "Windows" else {"start_new_session": True}
process = subprocess.Popen(command, env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **options)
try:
    output, _ = process.communicate(timeout=12)
    raise RuntimeError(f"Installed app exited during startup ({process.returncode}):\n{output.decode(errors='replace')}")
except subprocess.TimeoutExpired:
    print(f"PASS: {system} installer completed and the installed app stayed running for 12 seconds.")
finally:
    if process.poll() is None:
        if system == "Windows":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)], check=False, creationflags=subprocess.CREATE_NO_WINDOW)
        else:
            os.killpg(process.pid, signal.SIGTERM)
        output, _ = process.communicate(timeout=15)
        print(output.decode(errors="replace"))
