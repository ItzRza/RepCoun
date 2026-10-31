/**
 * Health Connect + native bridge (JS side).
 * Inside the APK this talks to the Kotlin plugin `RepCoun`.
 * In a normal browser everything degrades gracefully (features just hide).
 */

import { registerPlugin } from "@capacitor/core";
import { Session } from "../types";
import { installLog, log, errText } from "./logger";

installLog(); // record everything from the very first moment

export interface HcAvailability {
  native: boolean;
  available: boolean; // Health Connect usable on this device
  granted: boolean; // workout permissions granted
  updateRequired: boolean; // Health Connect installed but needs an update
}

type Plugin = {
  requestCamera(): Promise<{ granted: boolean }>;
  appVersion(): Promise<{
    version?: string;
    build?: number;
    android?: string;
    sdk?: number;
    device?: string;
    hcStatus?: number;
  }>;
  hcAvailability(): Promise<{ available: boolean; updateRequired?: boolean; status?: number }>;
  hcRequestPermissions(): Promise<{ granted: boolean; reason?: "update" | "unavailable"; manual?: boolean }>;
  hcOpenStore(): Promise<void>;
  hcStatus(): Promise<{ granted: boolean; full?: boolean; count?: number; total?: number; error?: string; missing?: string[] }>;
  hcDiag(): Promise<HcDiag>;
  camDiag(): Promise<{ permGranted: boolean; hasCamera: boolean; sdk: number }>;
  googleSignIn(o: { webClientId: string }): Promise<{ idToken?: string; email?: string; error?: string }>;
  shareImage(o: { platform: string; dataUrl: string }): Promise<{ ok?: boolean; error?: string }>;
  hcReadHeartRate(): Promise<{ bpm: number | null; at: number | null }>;
  hcReadSessions(o: { days: number }): Promise<{ sessions: HcSession[]; ok: boolean; error?: string }>;
  hcWriteSession(o: {
    startMs: number;
    endMs: number;
    exerciseId: string;
    kcal: number;
    reps: number;
    durationSec: number;
  }): Promise<{ ok: boolean }>;
  setPipEnabled(o: { enabled: boolean }): Promise<void>;
  enterPip(): Promise<{ ok: boolean }>;
  openAppSettings(): Promise<void>;
};

export interface HcSession {
  title: string;
  startMs: number;
  endMs: number;
  durationSec: number;
  app: string;
  pkg: string;
}

/** Full Health Connect self-diagnosis (one screenshot = full picture). */
export interface HcDiag {
  sdk: number;
  sdkStr: string;
  providerInstalled: boolean;
  grantError: string;
  count: number;
  total: number;
  grantedList: string[];
  canRequest: boolean;
  canManage: boolean;
}

/**
 * The native plugin handle.
 *
 * Capacitor 8 requires registering the plugin from the JS side — the legacy
 * `window.Capacitor.Plugins.RepCoun` lookup silently returns undefined, which
 * made every native feature (Health Connect, heart rate, PiP, version info)
 * fail invisibly. This is the official pattern: native registerPlugin() in
 * MainActivity + registerPlugin() here.
 */
const RepCoun = registerPlugin<Plugin>("RepCoun");

function plugin(): Plugin | null {
  const cap = (window as any).Capacitor;
  try {
    if (typeof cap?.getPlatform === "function" && cap.getPlatform() === "android") {
      return RepCoun as unknown as Plugin;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export const health = {
  /**
   * True inside the APK (and only there).
   * The Capacitor platform is the ground truth: relying on the plugin object
   * alone used to wrongly report "Available in the Android app" on a phone
   * whenever the plugin proxy was momentarily missing.
   */
  isNative(): boolean {
    const cap = (window as any).Capacitor;
    try {
      if (typeof cap?.getPlatform === "function" && cap.getPlatform() === "android") return true;
    } catch {
      /* fall through */
    }
    return plugin() !== null;
  },

  /** Whether the native RepCoun plugin object is reachable (diagnostic). */
  bridgeOk(): boolean {
    return plugin() !== null;
  },

  /** Version + build + device info from the APK (e.g. "1.0.0+b13"). Null in a browser. */
  async appVersion(): Promise<{
    version: string;
    build: number;
    android?: string;
    sdk?: number;
    device?: string;
    hcStatus?: number;
  } | null> {
    const p = plugin();
    if (!p) return null;
    try {
      const r = await p.appVersion();
      log.i("app", `version ${r?.version ?? "null"}`);
      if (r?.version)
        return {
          version: r.version,
          build: r.build ?? 0,
          android: r.android,
          sdk: r.sdk,
          device: r.device,
          hcStatus: r.hcStatus,
        };
      return null;
    } catch (e) {
      log.e("app", `version FAIL ${errText(e)}`);
      return null;
    }
  },

  async cameraPermission(): Promise<boolean> {
    const p = plugin();
    if (!p) return true; // browser asks by itself
    try {
      const r = await p.requestCamera();
      return !!r.granted;
    } catch {
      return false;
    }
  },

  async availability(): Promise<HcAvailability> {
    // In the APK we are always "native": a missing plugin means a broken
    // bridge, not the web app — so the phone never sees "hc_web".
    if (!this.isNative()) return { native: false, available: false, granted: false, updateRequired: false };
    const p = plugin();
    if (!p) return { native: true, available: false, granted: false, updateRequired: false };
    try {
      const [{ available, updateRequired }, { granted }] = await Promise.all([
        p.hcAvailability(),
        p.hcStatus(),
      ]);
      log.i("hc", `availability available=${available} granted=${granted} update=${!!updateRequired}`);
      return { native: true, available, granted, updateRequired: !!updateRequired };
    } catch (e) {
      log.e("hc", `availability FAIL ${errText(e)}`);
      return { native: true, available: false, granted: false, updateRequired: false };
    }
  },

  /**
   * Asks for Health Connect permissions.
   * reason: "update" = Health Connect needs an update (use openHcStore),
   *         "unavailable" = this device has no Health Connect at all.
   * manual: the permission dialog was blocked by the system — Health Connect's
   *         own permissions screen was opened instead; grant there, then retry.
   */
  async requestPermissions(): Promise<{ granted: boolean; reason?: "update" | "unavailable"; manual?: boolean }> {
    if (!this.isNative()) return { granted: false, reason: "unavailable" };
    const p = plugin();
    if (!p) return { granted: false };
    try {
      const r = await p.hcRequestPermissions();
      log.i("hc", `request granted=${!!r.granted} reason=${r.reason ?? "-"} manual=${!!r.manual}`);
      return { granted: !!r.granted, reason: r.reason, manual: !!r.manual };
    } catch (e) {
      log.e("hc", `request FAIL ${errText(e)}`);
      return { granted: false };
    }
  },

  /** Opens Health Connect's install/update page (Play Store). */
  async openHcStore(): Promise<void> {
    const p = plugin();
    if (!p) return;
    try {
      await p.hcOpenStore();
    } catch {
      /* ignore */
    }
  },

  async readHeartRate(): Promise<{ bpm: number; at: number } | null> {
    const p = plugin();
    if (!p) return null;
    try {
      const r = await p.hcReadHeartRate();
      if (r?.bpm && r.bpm > 25 && r.bpm < 240) return { bpm: Math.round(r.bpm), at: r.at ?? Date.now() };
      return null;
    } catch {
      return null;
    }
  },

  async writeSession(s: Session): Promise<boolean> {
    const p = plugin();
    if (!p) return false;
    try {
      const r = await p.hcWriteSession({
        startMs: s.startedAt,
        endMs: s.endedAt,
        exerciseId: s.exercise,
        kcal: Math.round(s.kcal),
        reps: s.reps,
        durationSec: s.durationSec,
      });
      return !!r.ok;
    } catch {
      return false;
    }
  },

  /** Sessions written by OTHER apps (Home Workout, Samsung Health, …) into Health Connect. */
  async readSessions(days = 7): Promise<HcSession[]> {
    const p = plugin();
    if (!p) return [];
    try {
      const r = await p.hcReadSessions({ days });
      if (!r?.ok || !Array.isArray(r.sessions)) return [];
      return r.sessions.sort((a, b) => b.startMs - a.startMs).slice(0, 20);
    } catch {
      return [];
    }
  },

  /** Mini mode: allow RepCoun to shrink to a floating window over other apps. */
  async setPipEnabled(enabled: boolean): Promise<void> {
    const p = plugin();
    if (!p) return;
    try {
      await p.setPipEnabled({ enabled });
    } catch {
      /* ignore */
    }
  },

  async enterMiniMode(): Promise<boolean> {
    const p = plugin();
    if (!p) return false;
    try {
      const r = await p.enterPip();
      return !!r.ok;
    } catch {
      return false;
    }
  },

  /** Opens this app's system settings page (for permissions the phone blocked). */
  async openAppSettings(): Promise<void> {
    const p = plugin();
    if (!p) return;
    try {
      await p.openAppSettings();
    } catch {
      /* ignore */
    }
  },

  /** Health Connect self-diagnosis (null outside the APK). */
  async hcDiag(): Promise<HcDiag | null> {
    const p = plugin();
    if (!p) return null;
    try {
      return await p.hcDiag();
    } catch {
      return null;
    }
  },

  /** Camera self-diagnosis (null outside the APK). */
  async camDiag(): Promise<{ permGranted: boolean; hasCamera: boolean; sdk: number } | null> {
    const p = plugin();
    if (!p) return null;
    try {
      return await p.camDiag();
    } catch {
      return null;
    }
  },

  /** Native Google Sign-In — returns an ID token for Firebase login. */
  async googleSignIn(webClientId: string): Promise<{ idToken?: string; email?: string; error?: string }> {
    const p = plugin();
    if (!p) return { error: "not native" };
    try {
      return await p.googleSignIn({ webClientId });
    } catch (e) {
      return { error: errText(e) };
    }
  },

  /**
   * Hand the workout card straight to an app:
   * facebook / x / instagram_post / instagram_story / chooser (all apps).
   * Returns null on success, or an error string (app not installed etc.).
   */
  async shareImage(platform: string, dataUrl: string): Promise<string | null> {
    const p = plugin();
    if (!p) return "not native";
    log.i("share", `shareTo ${platform}`);
    try {
      const r = await p.shareImage({ platform, dataUrl });
      if (r?.error) {
        log.e("share", r.error);
        return r.error;
      }
      return null;
    } catch (e) {
      log.e("share", `shareImage FAIL ${errText(e)}`);
      return errText(e);
    }
  },
};

/** Polls heart rate during a workout (from any watch synced to Health Connect). */
export class HrMonitor {
  private timer: number | null = null;
  private bpm: number | null = null;

  constructor(private onHr: (bpm: number | null) => void, private intervalMs = 6000) {}

  start() {
    if (this.timer !== null) return;
    const poll = async () => {
      const r = await health.readHeartRate();
      // ignore data older than 5 minutes (watch not worn / not synced)
      if (r && Date.now() - r.at < 5 * 60000) this.bpm = r.bpm;
      else this.bpm = null;
      this.onHr(this.bpm);
    };
    poll();
    this.timer = window.setInterval(poll, this.intervalMs);
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  get current(): number | null {
    return this.bpm;
  }
}
