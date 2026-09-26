import { afterEach, describe, expect, it, vi } from "vitest";
import type { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { installAndRelaunch } from "./updater";
import {
  availableUpdateMessage,
  commandIsRunning,
  endUpdateCheck,
  formatDownloadProgress,
  installLossMessage,
  installWouldLoseWork,
  resetUpdateCheckLock,
  tryBeginUpdateCheck
} from "./updaterLogic";

vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
  resetUpdateCheckLock();
});

// This order prevents losing edits made while a slow update download is running.
describe("installation consent", () => {
  it("keeps the app open when work created during download prevents installation", async () => {
    let dirty = false;
    const install = vi.fn();
    const update = {
      download: vi.fn(async () => { dirty = true; }),
      install
    } as unknown as Update;

    const result = await installAndRelaunch(update, () => {}, () => !dirty);

    expect(result.status).toBe("cancelled");
    expect(install).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
    expect(tryBeginUpdateCheck()).toBe(true);
  });

  it("installs and relaunches only after consent for the completed download", async () => {
    const steps: string[] = [];
    const update = {
      download: vi.fn(async () => { steps.push("downloaded"); }),
      install: vi.fn(async () => { steps.push("installed"); })
    } as unknown as Update;

    const result = await installAndRelaunch(update, () => {}, () => {
      steps.push("confirmed");
      return true;
    });

    expect(result.status).toBe("ok");
    expect(steps).toEqual(["downloaded", "confirmed", "installed"]);
    expect(relaunch).toHaveBeenCalledOnce();
  });
});

describe("commandIsRunning", () => {
  it("is true when any repository command is running", () => {
    expect(
      commandIsRunning([
        { terminal: { running: false } },
        { terminal: { running: true } }
      ])
    ).toBe(true);
  });

  it("is false when no command is running", () => {
    expect(commandIsRunning([{ terminal: { running: false } }, {}])).toBe(false);
  });
});

describe("installWouldLoseWork", () => {
  it("requires confirmation for dirty editors or running commands", () => {
    expect(installWouldLoseWork(true, false)).toBe(true);
    expect(installWouldLoseWork(false, true)).toBe(true);
    expect(installWouldLoseWork(true, true)).toBe(true);
    expect(installWouldLoseWork(false, false)).toBe(false);
  });
});

describe("installLossMessage", () => {
  it("names unsaved drafts and running commands", () => {
    expect(installLossMessage(true, false)).toContain("unsaved editor changes");
    expect(installLossMessage(false, true)).toContain("running repository commands");
    expect(installLossMessage(true, true)).toContain("unsaved editor changes and running repository commands");
  });
});

describe("availableUpdateMessage", () => {
  it("includes release notes when present", () => {
    expect(availableUpdateMessage("0.2.0", " Faster diffs ")).toBe(
      "Sunlight 0.2.0 is available. Faster diffs"
    );
    expect(availableUpdateMessage("0.2.0")).toBe("Sunlight 0.2.0 is available.");
  });
});

describe("formatDownloadProgress", () => {
  it("shows a total when the download size is known", () => {
    expect(formatDownloadProgress(1024, 2048)).toBe("Downloading update… 1.0 KiB of 2.0 KiB");
    expect(formatDownloadProgress(512)).toBe("Downloading update… 512 bytes");
  });
});

describe("update check lock", () => {
  it("rejects a second check while one is in flight", () => {
    expect(tryBeginUpdateCheck()).toBe(true);
    expect(tryBeginUpdateCheck()).toBe(false);
    endUpdateCheck();
    expect(tryBeginUpdateCheck()).toBe(true);
  });
});
