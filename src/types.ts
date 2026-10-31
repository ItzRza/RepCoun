export type ThemeMode = "light" | "dark" | "system";
/** design style: classic RepCoun (white/blue light, black/blue-gray dark) or Stylr black+orange */
export type ThemeStyle = "violet" | "stylr";

export interface Settings {
  lang: string;
  theme: ThemeMode;
  themeStyle: ThemeStyle;
  weightKg: number;
  heightCm: number;
  age: number;
  sex: "male" | "female";
  unit: "metric" | "imperial";
  cameraFacing: "user" | "environment";
  model: "full" | "lite";
  autoDetect: boolean;
  sound: boolean;
  haptics: boolean;
  trackToHc: boolean;
  repGoal: number; // daily reps goal
  /** how much of the movement must be done to count a rep (percent of the standard depth) */
  repDepthPct: number;
  /** where reps come from while working out: the phone camera, the watch, or both */
  watchMode: "phone" | "watch" | "both";
  /** auto-open a workout on the phone when the watch detects a sport */
  watchAutoOpen: boolean;
  onboardingDone: boolean;
}

export interface Session {
  id: string;
  startedAt: number; // epoch ms
  endedAt: number;
  /** exercise id or "auto" mixed */
  exercise: string;
  reps: number;
  /** reps per exercise for mixed/auto workouts */
  breakdown?: Record<string, number>;
  rejected: number;
  kcal: number;
  durationSec: number;
  avgHr: number | null;
}

export interface Profile {
  name: string;
  leaderboardName: string;
}

export type RepPhase = "up" | "down";

export interface RepResult {
  accepted: boolean;
  reason?: "half" | "too_fast" | "jitter";
}

export interface FrameStats {
  reps: number;
  rejected: number;
  kcal: number;
  hr: number | null;
}
