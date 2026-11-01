/**
 * Auto-learn new movements ("Smart scan").
 *
 * While you train, the learner watches every body angle. When you keep doing
 * a repeated movement that NO built-in exercise matches, it measures the
 * movement (which joint, how deep, how fast) and turns it into a custom
 * exercise — the same counting rule the "train it with your own video"
 * calibration produces — so it can be saved to My exercises and counted.
 */

import { BodyFeatures, TrackJoint, jointValue } from "./exercises";
import { CustomExercise } from "../data/custom";

const JOINTS: TrackJoint[] = ["elbow", "knee", "hip", "arm", "custom"];
const WINDOW = 130; // ~5s of samples at the detection rate
const MIN_RANGE = 20; // degrees of movement to be "a movement" at all
const LEARN_COOLDOWN_MS = 25000; // never spam: one learn per 25s…
const MAX_LEARNS = 3; // …and max 3 per workout

export class MoveLearner {
  private buf: Record<TrackJoint, number[]> = { elbow: [], knee: [], hip: [], arm: [], custom: [] };
  private t: number[] = [];
  private lastLearnAt = 0;
  private learned = 0;

  constructor(private existing: () => CustomExercise[]) {}

  reset() {
    for (const j of JOINTS) this.buf[j] = [];
    this.t = [];
    this.learned = 0;
    this.lastLearnAt = 0;
  }

  /** Forget the history (e.g. the exercise just changed). */
  clear() {
    for (const j of JOINTS) this.buf[j] = [];
    this.t = [];
  }

  /**
   * Feed one detected frame. Returns a NEW custom exercise rule when a
   * repeated unknown movement is ready to be saved, else null.
   * `canLearn` = nothing matched recently (caller decides).
   */
  update(f: BodyFeatures, now: number, canLearn: boolean): CustomExercise | null {
    if (!f.ok) return null;
    for (const j of JOINTS) this.buf[j].push(jointValue(f, j));
    this.t.push(now);
    while (this.t.length > WINDOW) {
      this.t.shift();
      for (const j of JOINTS) this.buf[j].shift();
    }

    if (!canLearn) return null;
    if (this.learned >= MAX_LEARNS || now - this.lastLearnAt < LEARN_COOLDOWN_MS) return null;
    if (this.t.length < 60 || now - this.t[0] < 3500) return null;

    // Which body angle actually moves?
    let best: TrackJoint | null = null;
    let bestRange = 0;
    for (const j of JOINTS) {
      const r = pRange(this.buf[j]);
      if (r > bestRange) {
        bestRange = r;
        best = j;
      }
    }
    if (!best || bestRange < MIN_RANGE) return null;

    const rule = derive(this.buf[best], this.t, bestRange);
    if (!rule) return null;

    // A twin of an existing custom exercise? Then it's not new — skip.
    for (const c of this.existing()) {
      if (
        c.joint === best &&
        Math.abs(c.top - rule.top) < 14 &&
        Math.abs(c.bottom - rule.bottom) < 14
      ) {
        return null;
      }
    }

    this.lastLearnAt = now;
    this.learned++;
    return {
      id: `c${now}`,
      name: "", // caller picks the display name
      joint: best,
      ...rule,
      createdAt: now,
    };
  }
}

/** 10th..90th percentile movement range (robust against noise). */
function pRange(raw: number[]): number {
  const sorted = [...raw].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.1)];
  const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  return hi - lo;
}

/** Derive a counting rule from the recorded angle samples (same math as the
 *  calibration flow), including a periodicity check — 2+ clean cycles. */
function derive(
  raw: number[],
  t: number[],
  range: number
): Omit<CustomExercise, "id" | "name" | "joint" | "createdAt"> | null {
  const sorted = [...raw].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.1)];
  const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  const mid = (lo + hi) / 2;

  // Rest position = where the signal spends most of its time.
  const above = raw.filter((v) => v > mid).length / raw.length;
  const start: "high" | "low" = above > 0.42 ? "high" : "low";

  // Rep speed + periodicity from hysteresis crossings (noise-proof).
  const upThr = lo + range * 0.75;
  const downThr = lo + range * 0.25;
  let state: "up" | "down" = raw[0] > mid ? "up" : "down";
  const flips: number[] = [];
  for (let i = 1; i < raw.length; i++) {
    if (state === "up" && raw[i] < downThr) {
      state = "down";
      flips.push(i);
    } else if (state === "down" && raw[i] > upThr) {
      state = "up";
      flips.push(i);
    }
  }
  // 3 flips (up-down-up) = 1.5 cycles → genuinely periodic, and enough to
  // estimate the rep speed. Slow movements stay learnable.
  if (flips.length < 3) return null;

  const reps = (flips.length - 1) / 2;
  const totalMs = t[flips[flips.length - 1]] - t[flips[0]];
  const minRepMs = Math.round(Math.max(380, Math.min(1600, (totalMs / reps) * 0.55)));

  return {
    top: Math.round(start === "high" ? lo + range * 0.72 : lo + range * 0.28),
    bottom: Math.round(start === "high" ? lo + range * 0.28 : lo + range * 0.72),
    start,
    minBottomMs: 180,
    minRepMs,
  };
}
