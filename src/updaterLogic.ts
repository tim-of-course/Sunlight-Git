import { formatBytes } from "./ui";

let inFlight = false;

export function tryBeginUpdateCheck(): boolean {
  if (inFlight) return false;
  inFlight = true;
  return true;
}

export function endUpdateCheck(): void {
  inFlight = false;
}

export function resetUpdateCheckLock(): void {
  inFlight = false;
}

export function commandIsRunning(
  repositories: Array<{ terminal?: { running?: boolean } | null }>
): boolean {
  return repositories.some((repository) => Boolean(repository.terminal?.running));
}

export function installWouldLoseWork(dirty: boolean, commandRunning: boolean): boolean {
  return dirty || commandRunning;
}

export function installLossMessage(dirty: boolean, commandRunning: boolean): string {
  const losses: string[] = [];
  if (dirty) losses.push("unsaved editor changes");
  if (commandRunning) losses.push("running repository commands");
  if (losses.length === 0) {
    return "Installing this update will quit Sunlight. Continue?";
  }
  return `Installing this update will quit Sunlight and discard ${losses.join(" and ")}. Continue?`;
}

export function formatDownloadProgress(downloaded: number, total?: number): string {
  if (!total) return `Downloading update… ${formatBytes(downloaded)}`;
  return `Downloading update… ${formatBytes(downloaded)} of ${formatBytes(total)}`;
}

export function availableUpdateMessage(version: string, notes?: string | null): string {
  const trimmed = notes?.trim();
  if (trimmed) return `Sunlight ${version} is available. ${trimmed}`;
  return `Sunlight ${version} is available.`;
}
