/**
 * Custom exercises — created by the user and learned from a short camera
 * recording ("train it with your own video"): the app measures the joint
 * angle range and speed of the demonstrated movement, then builds a counting
 * rule from it. Stored locally and available everywhere in the app.
 */

import {
  BodyFeatures,
  EXERCISES,
  EXERCISE_MAP,
  ExerciseDef,
  TrackJoint,
} from "../engine/exercises";
import { registerLabel } from "../i18n/i18n";

export type { TrackJoint };

export interface CustomExercise {
  id: string;
  name: string;
  /** which body angle to follow */
  joint: TrackJoint;
  /** where a rep starts and ends */
  start: "high" | "low";
  /** angle at the rest position */
  top: number;
  /** angle at the deepest point of the movement */
  bottom: number;
  minBottomMs: number;
  minRepMs: number;
  createdAt: number;
}

const KEY = "repcoun:custom";

export function getCustoms(): CustomExercise[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as CustomExercise[];
  } catch {
    return [];
  }
}

function saveAll(list: CustomExercise[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function addCustom(c: CustomExercise) {
  saveAll([c, ...getCustoms()]);
  installOne(c);
}

export function deleteCustom(id: string) {
  saveAll(getCustoms().filter((c) => c.id !== id));
  const i = EXERCISES.findIndex((e) => e.id === id);
  if (i >= 0) EXERCISES.splice(i, 1);
  delete EXERCISE_MAP[id];
}

function installOne(c: CustomExercise) {
  const def: ExerciseDef = {
    id: c.id,
    i18n: `__custom_${c.id}`,
    emoji: "✨",
    met: 4.5,
    kcalPerRep70: 0.25,
    mode: "reps",
    joint: c.joint,
    start: c.start,
    top: c.top,
    bottom: c.bottom,
    minBottomMs: c.minBottomMs,
    minRepMs: c.minRepMs,
    score: () => 0, // custom exercises are counted when selected manually
    tip: "tip.custom",
  };
  registerLabel(`exercise.${def.i18n}`, c.name);
  if (!EXERCISE_MAP[def.id]) {
    EXERCISES.push(def);
    EXERCISE_MAP[def.id] = def;
  }
}

/** Register every saved custom exercise — call once at app start. */
export function installCustoms() {
  for (const c of getCustoms()) installOne(c);
}

/** The angle channel used for counting (mirrors the rep counter's mapping). */
export function jointAngle(f: BodyFeatures, joint: TrackJoint): number {
  switch (joint) {
    case "elbow": return f.elbowL;
    case "knee": return f.kneeL;
    case "hip": return f.hipL;
    case "arm": return f.armL;
    default: return f.torsoTilt;
  }
}

/** Which joint a custom exercise follows — short label for the list. */
export const JOINT_LABELS: Array<[TrackJoint, string]> = [
  ["knee", "Knee (squat-style)"],
  ["elbow", "Elbow (curl / push style)"],
  ["hip", "Hip (bridge / raise style)"],
  ["arm", "Arm (raise / swing style)"],
  ["custom", "Body angle (tilt / bend)"],
];
