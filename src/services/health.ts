/**
 * Health Connect + native bridge (JS side).
 * Inside the APK this talks to the Kotlin plugin `RepCoun`.
 * In a normal browser everything degrades gracefully (features just hide).
 */

import { Session } from "../types";

export interface HcAvailability {
  native: boolean;
  available: boolean; // Health Connect usable on this device
  granted: boolean; // workout permissions granted
}

type Plugin = {
  requestCamera(): Promise<{ granted: boolean }>;
  hcAvailability(): Promise<{ available: boolean }>;
  hcRequestPermissions(): Promise<{ granted: boolean }>;
  hcStatus(): Promise<{ granted: boolean }>;
  hcReadHeartRate(): Promise<{ bpm: number | null; at: number | null }>;
  hcWriteSession(o: {
    startMs: number;
    endMs: number;
    exerciseId: string;
    kcal: number;
    reps: number;
    durationSec: number;
  }): Promise<{ ok: boolean }>;
};

function plugin(): Plugin | null {
  const cap = (window as any).Capacitor;
  try {
    const p = cap?.Plugins?.RepCoun;
    return p ?? null;
  } catch {
    return null;
  }
}

export const health = {
  isNative(): boolean {
    return plugin() !== null;
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
    const p = plugin();
    if (!p) return { native: false, available: false, granted: false };
    try {
      const [{ available }, { granted }] = await Promise.all([p.hcAvailability(), p.hcStatus()]);
      return { native: true, available, granted };
    } catch {
      return { native: true, available: false, granted: false };
    }
  },

  async requestPermissions(): Promise<boolean> {
    const p = plugin();
    if (!p) return false;
    try {
      const r = await p.hcRequestPermissions();
      return !!r.granted;
    } catch {
      return false;
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
