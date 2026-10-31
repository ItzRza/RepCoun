/**
 * Smartwatch bridge (JS side) — talks to the native Wear OS Data Layer.
 * The watch app has the same package id + signing key, so Play Services pairs
 * it with the phone automatically after sideloading.
 *
 * Sign-in gate: app.ts only calls watchInit() for a signed-in cloud account
 * (guest mode excluded, per the product rule for watch features).
 */
import { health, repcoun } from "./health";
import { store } from "../data/store";

export interface WatchInitResult {
  connected: boolean;
  node: string;
  /** a watch command that arrived while the app was closed */
  pending: { path: string; data: Record<string, unknown> } | null;
}

type WatchCb = (path: string, data: Record<string, unknown>) => void;

const subs = new Set<WatchCb>();
let started = false;
let status = { connected: false, node: "" };

function plugin() {
  const p = repcoun();
  if (!p || !("wearInit" in p)) return null;
  return p as unknown as {
    wearInit(o: { autoOpen: boolean; mode: string }): Promise<{
      connected?: boolean;
      node?: string;
      pendingStart?: string;
      pendingData?: Record<string, unknown>;
    }>;
    wearStatus(): Promise<{ connected?: boolean; node?: string }>;
    wearSend(o: { path: string; data: Record<string, unknown> }): Promise<void>;
    wearDeinit(): Promise<void>;
    addListener(name: string, cb: (data: any) => void): Promise<{ remove: () => Promise<void> }>;
  };
}

/** Fan-out of watch events to every subscriber (app + workout screen). */
export function subscribeWatch(cb: WatchCb): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function watchConnected(): boolean {
  return status.connected;
}

export function watchNode(): string {
  return status.node;
}

function fan(path: string, data: Record<string, unknown>) {
  for (const cb of [...subs]) {
    try {
      cb(path, data);
    } catch {
      /* one broken subscriber must not kill the stream */
    }
  }
}

/**
 * Starts the bridge + native listeners. Safe to call again (idempotent);
 * returns the connection state and any pending watch command.
 */
export async function watchInit(): Promise<WatchInitResult | null> {
  const p = plugin();
  if (!p) return null;
  const s = store.getSettings();
  if (!started) {
    started = true;
    try {
      await p.addListener("wearEvent", (ev: { path?: string; data?: Record<string, unknown> }) => {
        if (ev?.path) fan(ev.path, ev.data ?? {});
      });
      await p.addListener("wearStatus", (ev: { connected?: boolean; node?: string }) => {
        status = { connected: !!ev?.connected, node: ev?.node ?? "" };
        fan("conn", { connected: status.connected, name: status.node });
      });
    } catch {
      started = false;
      return null;
    }
  }
  try {
    const r = (await p.wearInit({ autoOpen: !!s.watchAutoOpen, mode: s.watchMode })) ?? {};
    status = { connected: !!r.connected, node: r.node ?? "" };
    return {
      connected: status.connected,
      node: status.node,
      pending: r.pendingStart
        ? { path: r.pendingStart, data: r.pendingData ?? {} }
        : null,
    };
  } catch {
    return null;
  }
}

/** Phone → watch message (workout state / config / ack). Fire and forget. */
export async function watchSend(path: string, data: Record<string, unknown>): Promise<void> {
  const p = plugin();
  if (!p || !started) return;
  try {
    await p.wearSend({ path, data });
  } catch {
    /* watch offline — fine */
  }
}

/** Refresh the connection status (Profile row). */
export async function watchStatusNow(): Promise<void> {
  const p = plugin();
  if (!p || !started) return;
  try {
    const r = await p.wearStatus();
    status = { connected: !!r?.connected, node: r?.node ?? "" };
  } catch {
    /* ignore */
  }
}

/** Stops the bridge (sign-out). */
export async function watchDeinit(): Promise<void> {
  const p = plugin();
  started = false;
  status = { connected: false, node: "" };
  if (p) {
    try {
      await p.wearDeinit();
    } catch {
      /* ignore */
    }
  }
}
