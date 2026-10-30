/**
 * RepCoun local exercise database.
 * Each exercise defines the joint it tracks, hysteresis thresholds,
 * MET value for calories and a scoring function for auto-detection.
 *
 * This file is the offline "movement data". When online, thresholds and
 * MET values can be refined by a downloadable exercise pack (services/online.ts).
 */

import { Landmarks, LM, Pt, angleDeg, dist2d, mid, tiltVsVertical, vis, clamp, avg2 } from "./geometry";

/** Per-frame body features used by counters + the auto-detector. */
export interface BodyFeatures {
  ok: boolean;
  /** torso tilt vs vertical: 0 = standing straight, 90 = horizontal on floor */
  torsoTilt: number;
  elbowL: number;
  elbowR: number;
  elbowAvg: number;
  kneeL: number;
  kneeR: number;
  kneeAvg: number;
  /** shoulder-hip-knee angle (trunk vs thigh) */
  hipL: number;
  hipR: number;
  hipAvg: number;
  /** angle of upper arm vs torso: ~20° arms down, ~170° arms overhead */
  armL: number;
  armR: number;
  armAvg: number;
  /** both wrists clearly above the head (hanging) */
  hanging: boolean;
  wristAboveHead: boolean;
  /** feet/ankles far apart relative to body size (jumping jack open) */
  legsOpen: number;
  /** legs asymmetric — one knee much more bent (lunge) */
  legAsym: number;
  /** wrists roughly under shoulders and body horizontal (push-up position) */
  pronePushup: number;
  /** supine with bent knees (sit-up / bridge position) */
  supineBent: number;
  /** plank posture quality: horizontal + elbows near shoulders */
  plankPose: number;
  /** vertical position of mid-hip in frame (for bridge rise / burpee jumps) */
  hipY: number;
  bodyLen: number;
  conf: number;
}

export type TrackJoint = "elbow" | "knee" | "hip" | "arm" | "custom";
export type ExerciseMode = "reps" | "timed";

export interface ExerciseDef {
  id: string;
  i18n: string; // translation key suffix: exercise.<i18n>
  emoji: string;
  met: number; // MET value for calorie math
  kcalPerRep70: number; // kcal per rep at 70 kg (fallback / tuning)
  mode: ExerciseMode;
  joint: TrackJoint;
  /** position where a rep starts/ends (rest position) */
  start: "high" | "low";
  /** angle threshold for the rest position (e.g. 160°) */
  top: number;
  /** angle threshold for the bottom of the movement (e.g. 90°) */
  bottom: number;
  /** minimum time spent at the bottom — else "half rep" */
  minBottomMs: number;
  /** minimum total rep time — else "too fast" */
  minRepMs: number;
  /** auto-detection score for this frame (0..1) */
  score: (f: BodyFeatures) => number;
  /** for timed exercises (plank, wall sit…): is this frame a valid hold? */
  holdScore?: (f: BodyFeatures) => number;
  /** human-readable form tip key suffix */
  tip: string;
}

/* ------------------------------- features ------------------------------- */

export function computeFeatures(lms: Landmarks | null): BodyFeatures {
  const empty: BodyFeatures = {
    ok: false, torsoTilt: 0, elbowL: 180, elbowR: 180, elbowAvg: 180,
    kneeL: 180, kneeR: 180, kneeAvg: 180, hipL: 180, hipR: 180, hipAvg: 180,
    armL: 20, armR: 20, armAvg: 20, hanging: false, wristAboveHead: false,
    legsOpen: 0, legAsym: 0, pronePushup: 0, supineBent: 0, plankPose: 0,
    hipY: 1, bodyLen: 0.5, conf: 0,
  };
  if (!lms) return empty;

  const ls = lms[LM.LEFT_SHOULDER], rs = lms[LM.RIGHT_SHOULDER];
  const lh = lms[LM.LEFT_HIP], rh = lms[LM.RIGHT_HIP];
  const la = lms[LM.LEFT_ANKLE], ra = lms[LM.RIGHT_ANKLE];
  const nose = lms[LM.NOSE];
  if (!ls || !rs || !lh || !rh) return empty;

  const ms = mid(ls, rs);
  const mh = mid(lh, rh);
  const ma = la && ra ? mid(la, ra) : null;

  const coreConf = (vis(ls) + vis(rs) + vis(lh) + vis(rh)) / 4;
  if (coreConf < 0.5) return empty;

  const le = lms[LM.LEFT_ELBOW], re = lms[LM.RIGHT_ELBOW];
  const lw = lms[LM.LEFT_WRIST], rw = lms[LM.RIGHT_WRIST];
  const lk = lms[LM.LEFT_KNEE], rk = lms[LM.RIGHT_KNEE];

  const torsoTilt = tiltVsVertical(ms, mh);

  const elbowL = le && lw && vis(le) > 0.4 ? angleDeg(ls, le, lw) : 180;
  const elbowR = re && rw && vis(re) > 0.4 ? angleDeg(rs, re, rw) : 180;
  const kneeL = lk && la && vis(lk) > 0.4 ? angleDeg(lh, lk, la) : 180;
  const kneeR = rk && ra && vis(rk) > 0.4 ? angleDeg(rh, rk, ra) : 180;
  const hipL = lk && vis(lk) > 0.4 ? angleDeg(ls, lh, lk) : 180;
  const hipR = rk && vis(rk) > 0.4 ? angleDeg(rs, rh, rk) : 180;
  const armL = le ? angleDeg(le, ls, mh) : 20;
  const armR = re ? angleDeg(re, rs, mh) : 20;

  const bodyLen = Math.max(0.25, dist2d(ms, mh) + dist2d(mh, ma ?? mh));
  const headY = nose ? nose.y : ms.y - 0.08;
  const wristsUp = (lw && rw && vis(lw) > 0.4 && vis(rw) > 0.4)
    ? Math.max(lw.y, rw.y) < headY - 0.03
    : false;
  const hanging =
    wristsUp &&
    torsoTilt < 32 &&
    !!lw && !!rw && !!ma &&
    Math.min(lw.y, rw.y) < mh.y - 0.06; // hands above hips

  const legOpenRaw = la && ra ? dist2d(la, ra) / bodyLen : 0;

  // push-up position quality: horizontal torso + wrists vertically near shoulders
  let prone = 0;
  if (torsoTilt > 55 && lw && rw) {
    const wristNear = 1 - clamp(Math.min(Math.abs(lw.x - ls.x), Math.abs(rw.x - rs.x)) / (bodyLen * 0.7), 0, 1);
    const straightBody = 1 - clamp(Math.abs(torsoTilt - 80) / 30, 0, 1);
    prone = clamp(wristNear * 0.5 + straightBody * 0.5, 0, 1);
  }

  // supine with bent knees (sit-up / bridge): horizontal + knees bent + feet under knees
  let supine = 0;
  if (torsoTilt > 45) {
    const bentKnees = 1 - clamp((Math.min(kneeL, kneeR) - 90) / 70, 0, 1);
    supine = clamp(bentKnees, 0, 1) * clamp((torsoTilt - 45) / 25, 0, 1);
  }

  // plank quality: horizontal, elbows under shoulders, stable straight line
  let plank = 0;
  if (torsoTilt > 60) {
    const straight = 1 - clamp(Math.abs(torsoTilt - 82) / 22, 0, 1);
    const elbowDown = le && lw && Math.abs(le.x - ls.x) < bodyLen * 0.35 ? 1 : 0.4;
    plank = clamp(straight * 0.6 + elbowDown * 0.4, 0, 1) * (1 - clamp(Math.abs(Math.min(kneeL, kneeR) - 165) / 60, 0, 1) * 0.6);
  }

  return {
    ok: true,
    torsoTilt,
    elbowL, elbowR, elbowAvg: avg2(elbowL, elbowR)!,
    kneeL, kneeR, kneeAvg: avg2(kneeL, kneeR)!,
    hipL, hipR, hipAvg: avg2(hipL, hipR)!,
    armL, armR, armAvg: avg2(armL, armR)!,
    hanging,
    wristAboveHead: wristsUp,
    legsOpen: legOpenRaw,
    legAsym: Math.abs(kneeL - kneeR),
    pronePushup: prone,
    supineBent: supine,
    plankPose: plank,
    hipY: mh.y,
    bodyLen,
    conf: coreConf,
  };
}

/** Extract the tracked joint value for a given exercise. */
export function jointValue(f: BodyFeatures, joint: TrackJoint): number {
  switch (joint) {
    case "elbow": return f.elbowAvg;
    case "knee": return f.kneeAvg;
    case "hip": return f.hipAvg;
    case "arm": return f.armAvg;
    default: return f.torsoTilt;
  }
}

/* ------------------------------ definitions ------------------------------ */

const standing = (f: BodyFeatures) => f.torsoTilt < 40 && f.conf > 0.5;

export const EXERCISES: ExerciseDef[] = [
  {
    id: "pushup", i18n: "pushup", emoji: "💪", met: 8.0, kcalPerRep70: 0.36,
    mode: "reps", joint: "elbow", start: "high", top: 158, bottom: 92,
    minBottomMs: 220, minRepMs: 650,
    score: (f) => clamp(f.pronePushup * 1.15 - f.supineBent * 0.5, 0, 1),
    tip: "pushup_tip",
  },
  {
    id: "squat", i18n: "squat", emoji: "🦵", met: 5.5, kcalPerRep70: 0.33,
    mode: "reps", joint: "knee", start: "high", top: 160, bottom: 103,
    minBottomMs: 180, minRepMs: 620,
    score: (f) => (standing(f) ? clamp(1 - Math.abs(f.kneeAvg - 168) / 30, 0, 1) * 0.8 : 0),
    tip: "squat_tip",
  },
  {
    id: "situp", i18n: "situp", emoji: "🧘", met: 4.0, kcalPerRep70: 0.26,
    mode: "reps", joint: "hip", start: "high", top: 138, bottom: 86,
    minBottomMs: 200, minRepMs: 750,
    score: (f) => clamp(f.supineBent * 0.95 - f.pronePushup * 0.6, 0, 1),
    tip: "situp_tip",
  },
  {
    id: "pullup", i18n: "pullup", emoji: "🚪", met: 8.5, kcalPerRep70: 0.52,
    mode: "reps", joint: "elbow", start: "high", top: 155, bottom: 92,
    minBottomMs: 200, minRepMs: 800,
    score: (f) => (f.hanging ? 1 : 0),
    tip: "pullup_tip",
  },
  {
    id: "jumpingjack", i18n: "jumpingjack", emoji: "⭐", met: 8.5, kcalPerRep70: 0.28,
    mode: "reps", joint: "arm", start: "low", top: 60, bottom: 150,
    minBottomMs: 140, minRepMs: 480,
    score: (f) => (standing(f) ? clamp((f.armAvg / 170) * 0.7 + clamp((f.legsOpen - 0.25) / 0.4, 0, 1) * 0.3, 0, 1) * 0.5 : 0),
    tip: "jack_tip",
  },
  {
    id: "lunge", i18n: "lunge", emoji: "🚶", met: 4.5, kcalPerRep70: 0.32,
    mode: "reps", joint: "knee", start: "high", top: 158, bottom: 105,
    minBottomMs: 200, minRepMs: 750,
    score: (f) => (standing(f) && f.legAsym > 26 ? clamp(f.legAsym / 55, 0, 1) * 0.85 : 0),
    tip: "lunge_tip",
  },
  {
    id: "plank", i18n: "plank", emoji: "🛡️", met: 3.5, kcalPerRep70: 0.1,
    mode: "timed", joint: "custom", start: "high", top: 999, bottom: 0,
    minBottomMs: 0, minRepMs: 0,
    score: (f) => clamp(f.plankPose * 0.9 - f.pronePushup * 0.35, 0, 1),
    holdScore: (f) => (f.plankPose >= 0.42 && f.torsoTilt > 55 ? 1 : 0),
    tip: "plank_tip",
  },
  {
    id: "bicepcurl", i18n: "bicepcurl", emoji: "🏋️", met: 3.5, kcalPerRep70: 0.15,
    mode: "reps", joint: "elbow", start: "high", top: 155, bottom: 55,
    minBottomMs: 160, minRepMs: 600,
    score: (f) => (standing(f) && Math.abs(f.elbowAvg - 120) < 80 ? clamp((f.armAvg < 80 ? 1 : 0.4), 0, 1) * 0.55 : 0),
    tip: "curl_tip",
  },
  {
    id: "shoulderpress", i18n: "shoulderpress", emoji: "🙆", met: 5.0, kcalPerRep70: 0.2,
    mode: "reps", joint: "elbow", start: "low", top: 96, bottom: 160,
    minBottomMs: 160, minRepMs: 650,
    score: (f) => (standing(f) && f.armAvg > 95 ? 0.62 : 0),
    tip: "press_tip",
  },
  {
    id: "burpee", i18n: "burpee", emoji: "🔥", met: 9.5, kcalPerRep70: 0.95,
    mode: "reps", joint: "custom", start: "high", top: 48, bottom: 62,
    minBottomMs: 300, minRepMs: 1600,
    score: (f) => (f.pronePushup > 0.3 ? 0.35 : standing(f) ? 0.2 : 0),
    tip: "burpee_tip",
  },
  {
    id: "mountainclimber", i18n: "mountainclimber", emoji: "⛰️", met: 8.0, kcalPerRep70: 0.22,
    mode: "reps", joint: "knee", start: "high", top: 152, bottom: 96,
    minBottomMs: 120, minRepMs: 400,
    score: (f) => (f.pronePushup > 0.3 && f.legAsym > 18 ? clamp(f.legAsym / 50, 0, 1) * 0.8 : 0),
    tip: "mc_tip",
  },
  {
    id: "glutebridge", i18n: "glutebridge", emoji: "🍑", met: 3.0, kcalPerRep70: 0.22,
    mode: "reps", joint: "hip", start: "low", top: 104, bottom: 152,
    minBottomMs: 180, minRepMs: 700,
    score: (f) => clamp(f.supineBent * 0.9 - f.pronePushup * 0.5, 0, 1),
    tip: "bridge_tip",
  },
  {
    id: "legraise", i18n: "legraise", emoji: "🦿", met: 3.8, kcalPerRep70: 0.28,
    mode: "reps", joint: "hip", start: "high", top: 158, bottom: 92,
    minBottomMs: 180, minRepMs: 700,
    score: (f) => clamp(
      (f.torsoTilt > 60 && f.torsoTilt < 118 ? 0.55 : 0) +
        (f.kneeAvg > 145 ? 0.3 : 0) - f.pronePushup * 0.6 - f.supineBent * 0.35,
      0, 1),
    tip: "legraise_tip",
  },
  {
    id: "lateralraise", i18n: "lateralraise", emoji: "🙌", met: 4.0, kcalPerRep70: 0.2,
    mode: "reps", joint: "arm", start: "low", top: 32, bottom: 82,
    minBottomMs: 150, minRepMs: 620,
    score: (f) => (standing(f) && f.elbowAvg > 135 && f.armAvg > 42 && f.armAvg < 130 ? 0.62 : 0),
    tip: "lateralraise_tip",
  },
  {
    id: "wallsit", i18n: "wallsit", emoji: "🧱", met: 4.0, kcalPerRep70: 0.12,
    mode: "timed", joint: "custom", start: "high", top: 999, bottom: 0,
    minBottomMs: 0, minRepMs: 0,
    score: (f) => (f.kneeAvg > 70 && f.kneeAvg < 125 && f.torsoTilt < 45 ? 0.6 : 0),
    holdScore: (f) => (f.kneeAvg > 70 && f.kneeAvg < 125 && f.torsoTilt < 45 ? 1 : 0),
    tip: "wallsit_tip",
  },
  {
    id: "highknees", i18n: "highknees", emoji: "🏃", met: 8.0, kcalPerRep70: 0.2,
    mode: "reps", joint: "knee", start: "high", top: 150, bottom: 100,
    minBottomMs: 100, minRepMs: 380,
    score: () => 0, // looks too much like lunges — counted when selected manually
    tip: "highknees_tip",
  },
  {
    id: "donkeykick", i18n: "donkeykick", emoji: "🦶", met: 3.2, kcalPerRep70: 0.16,
    mode: "reps", joint: "hip", start: "low", top: 96, bottom: 148,
    minBottomMs: 160, minRepMs: 620,
    score: () => 0, // on hands & knees — counted when selected manually
    tip: "donkeykick_tip",
  },
  {
    id: "hipthrust", i18n: "hipthrust", emoji: "🍑", met: 3.6, kcalPerRep70: 0.24,
    mode: "reps", joint: "hip", start: "low", top: 104, bottom: 152,
    minBottomMs: 180, minRepMs: 700,
    score: () => 0, // same shape as glute bridge — counted when selected manually
    tip: "hipthrust_tip",
  },
];

export const EXERCISE_MAP: Record<string, ExerciseDef> = Object.fromEntries(
  EXERCISES.map((e) => [e.id, e])
);

export const AUTO = "auto";

/**
 * Temporally smoothed auto-detection.
 * Needs `consistencyFrames` consecutive frames of the same exercise
 * (score >= 0.55) before switching — avoids flicker.
 */
export class AutoDetector {
  private candidate: string | null = null;
  private streak = 0;
  private current: string | null = null;

  constructor(private consistencyFrames = 16) {}

  update(f: BodyFeatures): string | null {
    if (!f.ok) {
      this.streak = Math.max(0, this.streak - 1);
      return this.current;
    }
    let best: string | null = null;
    let bestScore = 0.42; // minimum confidence to accept
    for (const ex of EXERCISES) {
      const s = ex.score(f);
      if (s > bestScore) {
        bestScore = s;
        best = ex.id;
      }
    }
    if (best && best === this.current) {
      this.streak = 0;
      return this.current;
    }
    if (best === this.candidate) {
      this.streak++;
    } else {
      this.candidate = best;
      this.streak = 1;
    }
    if (this.streak >= this.consistencyFrames) {
      this.current = best;
      this.streak = 0;
    }
    return this.current;
  }

  reset() {
    this.candidate = null;
    this.streak = 0;
    this.current = null;
  }
}
