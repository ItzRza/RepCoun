/** Calorie estimation — MET equation with optional heart-rate refinement. */

import { ExerciseDef } from "./exercises";

export interface BodyProfile {
  weightKg: number;
  age: number;
  sex: "male" | "female";
}

/** kcal per minute using the MET equation (ACSM). */
export function kcalPerMinuteMet(met: number, weightKg: number): number {
  return (met * 3.5 * weightKg) / 200;
}

/** Heart-rate based kcal/min (Keytel et al., 2005). */
export function kcalPerMinuteHr(hr: number, body: BodyProfile): number {
  const { weightKg: w, age, sex } = body;
  const raw =
    sex === "male"
      ? (-55.0969 + 0.6309 * hr + 0.1988 * w + 0.2017 * age) / 4.184
      : (-20.4022 + 0.4472 * hr - 0.1263 * w + 0.074 * age) / 4.184;
  return Math.max(0.5, raw);
}

export interface CalorieUpdate {
  kcal: number;
  perRep: number;
}

/**
 * Live calorie tracker for one workout.
 * Uses MET while no heart rate is available; switches to the HR-based
 * (more accurate) formula when a watch/Health Connect supplies heart rate.
 */
export class CalorieTracker {
  private kcal = 0;
  private met = 4.0;
  private lastT = 0;

  constructor(private body: BodyProfile) {}

  setExercise(def: ExerciseDef | null) {
    this.met = def?.met ?? 5.0;
  }

  start(tMs: number) {
    this.lastT = tMs;
  }

  tick(tMs: number, hr: number | null): CalorieUpdate {
    if (!this.lastT) this.lastT = tMs;
    const dtMin = Math.min(1.5, Math.max(0, (tMs - this.lastT) / 1000)) / 60;
    this.lastT = tMs;
    const rate = hr && hr > 45 ? kcalPerMinuteHr(hr, this.body) : kcalPerMinuteMet(this.met, this.body.weightKg);
    const add = rate * dtMin;
    this.kcal += add;
    return { kcal: this.kcal, perRep: 0 };
  }

  /** extra kcal credit for a counted rep (small boost so short sessions feel rewarding) */
  addRep(def: ExerciseDef | null): number {
    if (!def) return 0;
    const add = (def.kcalPerRep70 * this.body.weightKg) / 70 * 0.5;
    this.kcal += add;
    return add;
  }

  get total(): number {
    return this.kcal;
  }

  reset() {
    this.kcal = 0;
    this.lastT = 0;
  }
}
