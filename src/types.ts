export type ThemeMode = "light" | "dark" | "system";

export interface Settings {
  lang: string;
  theme: ThemeMode;
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
  onboardingDone: boolean;
}

export interface Session {
  id: string;
  startedAt: number; // epoch ms
  endedAt: number;
  /** exercise id or "auto" mixed */
  exercise: string;
  reps: number;
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
