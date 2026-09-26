import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  endUpdateCheck,
  formatDownloadProgress,
  tryBeginUpdateCheck
} from "./updaterLogic";

export type UpdateLookup =
  | { status: "skipped" }
  | { status: "up-to-date" }
  | { status: "available"; update: Update }
  | { status: "error"; message: string };

export async function lookupUpdate(): Promise<UpdateLookup> {
  if (!tryBeginUpdateCheck()) return { status: "skipped" };
  try {
    const update = await check();
    if (!update) return { status: "up-to-date" };
    return { status: "available", update };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error)
    };
  } finally {
    endUpdateCheck();
  }
}

export async function installAndRelaunch(
  update: Update,
  onProgress: (message: string) => void,
  confirmInstall: () => boolean
): Promise<{ status: "ok" | "cancelled" } | { status: "error"; message: string }> {
  if (!tryBeginUpdateCheck()) {
    return { status: "error", message: "An update is already in progress." };
  }
  try {
    let downloaded = 0;
    let total: number | undefined;
    onProgress("Downloading update…");
    await update.download((event: DownloadEvent) => {
      if (event.event === "Started") {
        downloaded = 0;
        total = event.data.contentLength;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
      }
      if (event.event !== "Finished") {
        onProgress(formatDownloadProgress(downloaded, total));
      }
    });
    // Work can change during the download. Windows exits inside install().
    if (!confirmInstall()) return { status: "cancelled" };
    onProgress("Installing update…");
    await update.install();
    onProgress("Restarting Sunlight…");
    await relaunch();
    return { status: "ok" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error)
    };
  } finally {
    endUpdateCheck();
  }
}

export {
  availableUpdateMessage,
  commandIsRunning,
  installLossMessage,
  installWouldLoseWork
} from "./updaterLogic";
