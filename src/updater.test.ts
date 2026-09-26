import { afterEach, describe, expect, it } from "vitest";
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

afterEach(() => {
  resetUpdateCheckLock();
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
