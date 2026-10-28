/**
 * Online services.
 *
 * Tracking always runs on-device (MediaPipe WASM + local exercise data).
 * When the internet is available the app additionally:
 *   • syncs the exercise pack (threshold/MET updates) from GitHub raw
 *   • can submit scores / fetch a real leaderboard (optional API URL)
 *   • can send a frame to a custom cloud vision endpoint (optional)
 * Everything has an offline fallback — the app never depends on the network.
 */

import { EXERCISE_MAP, EXERCISES } from "../engine/exercises";
import { store } from "../data/store";

/** Remote pack URL — same file that ships inside the app, served from the GitHub repo. */
export const REMOTE_PACK_URL =
  "https://raw.githubusercontent.com/repcoun/repcoun/main/exercise-pack.json";

export interface PackOverride {
  top?: number;
  bottom?: number;
  met?: number;
  kcalPerRep70?: number;
  minBottomMs?: number;
  minRepMs?: number;
}

export interface Pack {
  version: string;
  updated: string;
  exercises: Record<string, PackOverride>;
}

let currentPack: Pack | null = null;
let packSource: "local" | "cloud" = "local";

export function packStatus(): { source: "local" | "cloud"; version: string } {
  return { source: packSource, version: currentPack?.version ?? "1.0.0" };
}

function applyPack(pack: Pack, source: "local" | "cloud") {
  for (const [id, o] of Object.entries(pack.exercises ?? {})) {
    const ex = EXERCISE_MAP[id];
    if (!ex) continue;
    if (typeof o.top === "number") ex.top = o.top;
    if (typeof o.bottom === "number") ex.bottom = o.bottom;
    if (typeof o.met === "number") ex.met = o.met;
    if (typeof o.kcalPerRep70 === "number") ex.kcalPerRep70 = o.kcalPerRep70;
    if (typeof o.minBottomMs === "number") ex.minBottomMs = o.minBottomMs;
    if (typeof o.minRepMs === "number") ex.minRepMs = o.minRepMs;
  }
  currentPack = pack;
  packSource = source;
}

async function fetchJson(url: string, timeoutMs: number): Promise<any | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Loads the bundled pack (always works, offline), then tries a cloud refresh. */
export async function initExerciseData(): Promise<void> {
  const local = await fetchJson(new URL("exercise-pack.json", document.baseURI).href, 3000);
  if (local?.exercises) applyPack(local, "local");
  if (navigator.onLine) void refreshPack();
}

export async function refreshPack(): Promise<"cloud" | "local"> {
  const remote = await fetchJson(REMOTE_PACK_URL, 5000);
  if (remote?.exercises && remote.version !== currentPack?.version) {
    applyPack(remote, "cloud");
  }
  return packStatus().source;
}

/* ------------------------------ cloud assist ----------------------------- */

export function getCloudEndpoint(): string {
  return localStorage.getItem("repcoun:cloudEndpoint") ?? "";
}

export function setCloudEndpoint(url: string) {
  if (url) localStorage.setItem("repcoun:cloudEndpoint", url);
  else localStorage.removeItem("repcoun:cloudEndpoint");
}

/**
 * Optional cloud recognition assist: sends one camera frame when online.
 * Returns the exercise id or null. Disabled unless the user configures an endpoint.
 */
export async function cloudAssist(frameDataUrl: string): Promise<string | null> {
  const url = getCloudEndpoint();
  if (!url || !navigator.onLine) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: frameDataUrl }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const id = String(data?.exercise ?? "");
    return EXERCISE_MAP[id] ? id : null;
  } catch {
    return null;
  }
}

/* --------------------------- online state helper -------------------------- */

type Listener = (online: boolean) => void;
const listeners: Set<Listener> = new Set();

if (typeof window !== "undefined") {
  window.addEventListener("online", () => listeners.forEach((l) => l(true)));
  window.addEventListener("offline", () => listeners.forEach((l) => l(false)));
}

export function onConnectionChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isOnline(): boolean {
  return navigator.onLine;
}

export const exerciseCount = EXERCISES.length;
