/** Geometry + filtering helpers for pose landmarks (MediaPipe 33-point). */

export interface Pt {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export type Landmarks = Pt[];

/** MediaPipe Pose landmark indices */
export const LM = {
  NOSE: 0,
  LEFT_EYE: 2,
  RIGHT_EYE: 5,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 31,
  RIGHT_HEEL: 32,
} as const;

/** Angle at point b formed by a-b-c, in degrees. */
export function angleDeg(a: Pt, b: Pt, c: Pt): number {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magA = Math.hypot(abx, aby);
  const magC = Math.hypot(cbx, cby);
  if (magA < 1e-6 || magC < 1e-6) return 180;
  let cos = dot / (magA * magC);
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function dist2d(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1) };
}

/** Angle (deg) between vector b->a and the downward image axis, 0 = pointing down. */
export function downAngle(a: Pt, b: Pt): number {
  const vx = a.x - b.x;
  const vy = a.y - b.y; // y grows downwards in image space
  const mag = Math.hypot(vx, vy);
  if (mag < 1e-6) return 0;
  const cos = vy / mag; // dot with (0,1)
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** Tilt of a segment vs. vertical axis in degrees (0 = vertical, 90 = horizontal). */
export function tiltVsVertical(a: Pt, b: Pt): number {
  return Math.abs(90 - downAngle(a, b));
}

export function vis(p: Pt | undefined): number {
  return p?.visibility ?? 0;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** One Euro filter — smooth but responsive joint angles. */
export class OneEuro {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(
    private minCutoff = 1.2,
    private beta = 0.02,
    private dCutoff = 1.0
  ) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, tMs: number): number {
    if (this.tPrev === null || this.xPrev === null) {
      this.tPrev = tMs;
      this.xPrev = x;
      return x;
    }
    const dt = Math.max(1, tMs - this.tPrev) / 1000;
    this.tPrev = tMs;
    const dx = (x - this.xPrev) / dt;
    const ad = this.alpha(this.dCutoff, dt);
    const dxHat = lerp(this.dxPrev, dx, ad);
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);
    const xHat = lerp(this.xPrev, x, a);
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    return xHat;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}

/** Average of two numbers or null. */
export function avg2(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return ((a ?? 0) + (b ?? 0)) / 2;
}
