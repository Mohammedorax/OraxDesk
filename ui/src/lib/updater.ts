import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { inTauri } from "./tauri";

export async function installAvailableUpdate(): Promise<boolean> {
  if (!inTauri() || window.location.hostname === "localhost") return false;
  const update = await check();
  if (!update) return false;
  await update.downloadAndInstall();
  await relaunch();
  return true;
}
