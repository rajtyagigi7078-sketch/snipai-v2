import { convertFileSrc as tauriFileSrc } from "@tauri-apps/api/core";

export type OpenDialogOptions = {
  title?: string;
  multiple?: boolean;
  directory?: boolean;
  filters?: { name: string; extensions: string[] }[];
};

type DesktopEvent<T> = { event: string; id: number; payload: T };

function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

function unavailable(): Error {
  return new Error("This feature requires the Snip AI desktop app. Open the Electron app to import and process local videos.");
}

/** A single native boundary shared by the Electron app and the older Tauri build. */
export async function invoke<T = unknown>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (window.snipaiDesktop?.invoke) return window.snipaiDesktop.invoke<T>(command, args);
  if (isTauri()) return (await import("@tauri-apps/api/core")).invoke<T>(command, args);
  throw unavailable();
}

export async function listen<T>(event: string, callback: (event: DesktopEvent<T>) => void): Promise<() => void> {
  if (window.snipaiDesktop?.on) {
    return window.snipaiDesktop.on(event, (payload) => callback({ event, id: 0, payload: payload as T }));
  }
  if (isTauri()) return (await import("@tauri-apps/api/event")).listen<T>(event, callback);
  return () => undefined;
}

export function convertFileSrc(path: string): string {
  if (window.snipaiDesktop?.mediaUrl) return window.snipaiDesktop.mediaUrl(path);
  if (isTauri()) return tauriFileSrc(path);
  if (/^(blob:|https?:|data:)/i.test(path)) return path;
  throw unavailable();
}

export async function open(options: OpenDialogOptions = {}): Promise<string | string[] | null> {
  if (window.snipaiDesktop?.openDialog) return window.snipaiDesktop.openDialog(options);
  if (isTauri()) return (await import("@tauri-apps/plugin-dialog")).open(options);
  throw unavailable();
}

export async function openPath(path: string): Promise<void> {
  if (window.snipaiDesktop?.openPath) {
    const error = await window.snipaiDesktop.openPath(path);
    if (error) throw new Error(error);
    return;
  }
  if (isTauri()) return (await import("@tauri-apps/plugin-opener")).openPath(path);
  throw unavailable();
}

export async function openUrl(url: string): Promise<void> {
  if (window.snipaiDesktop?.openUrl) return window.snipaiDesktop.openUrl(url);
  if (isTauri()) return (await import("@tauri-apps/plugin-opener")).openUrl(url);
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Unsupported website address.");
  window.open(parsed.href, "_blank", "noopener,noreferrer");
}
