/** Local persistence — settings, profile, workout history. Storage: localStorage (small JSON). */

import { Session, Settings, Profile } from "../types";

const K = {
  settings: "repcoun:settings",
  profile: "repcoun:profile",
  sessions: "repcoun:sessions",
  lbCache: "repcoun:lbcache",
};

export const DEFAULT_SETTINGS: Settings = {
  lang: "en",
  theme: "system",
  themeStyle: "violet",
  weightKg: 70,
  heightCm: 170,
  age: 25,
  sex: "male",
  unit: "metric",
  cameraFacing: "user",
  model: "lite", // lite = fast and smooth; "full" = more accurate, slower
  autoDetect: true,
  sound: true,
  haptics: true,
  trackToHc: true,
  repGoal: 100,
  repDepthPct: 100,
  onboardingDone: false,
};

export const DEFAULT_PROFILE: Profile = {
  name: "",
  leaderboardName: "",
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) } as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full — ignore */
  }
}

export const store = {
  getSettings(): Settings {
    return read<Settings>(K.settings, { ...DEFAULT_SETTINGS });
  },
  saveSettings(s: Partial<Settings>): Settings {
    const next = { ...store.getSettings(), ...s };
    write(K.settings, next);
    return next;
  },
  getProfile(): Profile {
    return read<Profile>(K.profile, { ...DEFAULT_PROFILE });
  },
  saveProfile(p: Partial<Profile>): Profile {
    const next = { ...store.getProfile(), ...p };
    write(K.profile, next);
    return next;
  },
  getSessions(): Session[] {
    try {
      const raw = localStorage.getItem(K.sessions);
      return raw ? (JSON.parse(raw) as Session[]) : [];
    } catch {
      return [];
    }
  },
  addSession(s: Session) {
    const all = store.getSessions();
    all.unshift(s);
    write(K.sessions, all.slice(0, 400));
  },
  clearSessions() {
    write(K.sessions, []);
  },
  getLbCache<T>(fallback: T): T {
    try {
      const raw = localStorage.getItem(K.lbCache);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  setLbCache(v: unknown) {
    write(K.lbCache, v);
  },
};

/* ------------------------------ statistics ------------------------------ */

export interface DayStat {
  date: Date;
  dayKey: string;
  label: string;
  reps: number;
  kcal: number;
  minutes: number;
}

export interface Totals {
  reps: number;
  kcal: number;
  workouts: number;
  minutes: number;
  streakDays: number;
}

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function lastNDays(n: number): DayStat[] {
  const sessions = store.getSessions();
  const out: DayStat[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = dayKey(d);
    const day = sessions.filter((s) => dayKey(new Date(s.startedAt)) === key);
    out.push({
      date: d,
      dayKey: key,
      label: d.toLocaleDateString(undefined, { weekday: "short" }),
      reps: day.reduce((a, s) => a + s.reps, 0),
      kcal: Math.round(day.reduce((a, s) => a + s.kcal, 0)),
      minutes: Math.round(day.reduce((a, s) => a + s.durationSec, 0) / 60),
    });
  }
  return out;
}

export function totals(): Totals {
  const sessions = store.getSessions();
  const days = lastNDays(365);
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].reps > 0 || days[i].minutes > 0) streak++;
    else if (i !== days.length - 1) break;
    else if (i === days.length - 1 && days[i].reps === 0) continue; // today can be empty
  }
  return {
    reps: sessions.reduce((a, s) => a + s.reps, 0),
    kcal: Math.round(sessions.reduce((a, s) => a + s.kcal, 0)),
    workouts: sessions.length,
    minutes: Math.round(sessions.reduce((a, s) => a + s.durationSec, 0) / 60),
    streakDays: streak,
  };
}

export function personalRecords(): Record<string, { reps: number; date: number }> {
  const prs: Record<string, { reps: number; date: number }> = {};
  for (const s of store.getSessions()) {
    const cur = prs[s.exercise];
    if (!cur || s.reps > cur.reps) prs[s.exercise] = { reps: s.reps, date: s.startedAt };
  }
  return prs;
}

export function todayReps(): number {
  const key = dayKey(new Date());
  return store
    .getSessions()
    .filter((s) => dayKey(new Date(s.startedAt)) === key)
    .reduce((a, s) => a + s.reps, 0);
}
