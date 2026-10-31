/**
 * Movement calibration — the "train it with your own video" flow.
 * Shows a Start button → 3-2-1 countdown → records a few seconds of the
 * chosen joint's angle (or ALL joints when joint === "auto", which then
 * picks the joint that moved the most), then derives the counting rule
 * from the recording: rest angle, deepest angle and where it starts.
 *
 * The overlay sits ABOVE sheets (z 300 > sheet 200) so the wizard window
 * stays open underneath and can never swallow the taps.
 */

import { computeFeatures, TrackJoint } from "../engine/exercises";
import { PoseEngine } from "../engine/pose";
import { jointAngle } from "../data/custom";
import { h } from "./dom";

export interface MovementRule {
  top: number;
  bottom: number;
  start: "high" | "low";
  minBottomMs: number;
  minRepMs: number;
  /** joint used — the auto-detected one when joint === "auto" */
  joint: TrackJoint;
}

export type CalibJoint = TrackJoint | "auto";

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export async function runCalibration(
  joint: CalibJoint,
  seconds = 8
): Promise<MovementRule | { error: string }> {
  // AI model (lite is plenty for measuring angles).
  let engine: PoseEngine;
  try {
    engine = await PoseEngine.create({ model: "lite" });
  } catch (e) {
    return { error: `model: ${(e as Error)?.message ?? "failed"}` };
  }

  // Camera.
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
    });
  } catch {
    engine.close();
    return { error: "camera" };
  }

  // Fullscreen recording view — z-index ABOVE the sheet (200).
  const video = h(
    `<video playsinline autoplay muted style="position:fixed;inset:0;width:100%;height:100%;object-fit:cover;background:#000;z-index:300"></video>`
  ) as HTMLVideoElement;
  const ui = h(
    `<div style="position:fixed;inset:0;z-index:301;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;color:#fff"></div>`
  ) as HTMLElement;
  document.body.appendChild(video);
  document.body.appendChild(ui);
  video.srcObject = stream;
  await video.play().catch(() => {});

  const finish = () => {
    video.remove();
    ui.remove();
    stream.getTracks().forEach((tr) => tr.stop());
    engine.close();
  };

  // ---- phase 1: Start button ----
  ui.innerHTML = `
    <div style="font-size:18px;font-weight:700;text-shadow:0 1px 8px rgba(0,0,0,.75);text-align:center;padding:0 26px">
      Step into frame — do 2-3 full, steady reps when it starts
    </div>
    <button id="calib-start" style="font-size:24px;font-weight:800;padding:18px 54px;border-radius:999px;border:0;background:#7c5cff;color:#fff;box-shadow:0 12px 34px rgba(124,92,255,.55);cursor:pointer">▶ Start</button>`;
  await new Promise<void>((resolve) => {
    ui.querySelector("#calib-start")!.addEventListener("click", () => resolve());
  });

  // ---- phase 2: 3-2-1 countdown ----
  for (const n of ["3", "2", "1"]) {
    ui.innerHTML = `
      <div style="font-size:132px;font-weight:900;line-height:1;text-shadow:0 6px 30px rgba(0,0,0,.65)">${n}</div>
      <div style="font-size:16px;font-weight:700;opacity:.9">get ready…</div>`;
    await sleep(1000);
  }

  // ---- phase 3: recording ----
  const cands: TrackJoint[] = joint === "auto" ? ["elbow", "knee", "hip", "arm", "custom"] : [joint];
  const raws: Record<TrackJoint, number[]> = { elbow: [], knee: [], hip: [], arm: [], custom: [] };
  ui.style.cssText =
    "position:fixed;left:0;right:0;top:28px;z-index:301;display:block;text-align:center;color:#fff;font-size:16px;font-weight:700;text-shadow:0 1px 6px rgba(0,0,0,.6)";
  const t0 = Date.now();
  const ms = seconds * 1000;
  await new Promise<void>((resolve) => {
    const tick = () => {
      const dt = Date.now() - t0;
      if (dt >= ms) return resolve();
      const f = computeFeatures(engine.detect(video));
      if (f.ok) for (const c of cands) raws[c].push(jointAngle(f, c));
      ui.textContent = `${Math.ceil((ms - dt) / 1000)}s · ${raws[cands[0]].length} samples — do full, steady reps`;
      window.setTimeout(tick, 80);
    };
    tick();
  });

  finish();

  // ---- auto: pick the joint that actually moved the most ----
  if (joint === "auto") {
    let best: MovementRule | null = null;
    let bestRange = 0;
    for (const c of cands) {
      const r = deriveRule(raws[c]);
      if ("error" in r) continue;
      const range = pRange(raws[c]);
      if (range > bestRange) {
        bestRange = range;
        best = { ...r, joint: c };
      }
    }
    if (best) return best;
    const anySamples = cands.some((c) => raws[c].length >= 20);
    return { error: anySamples ? "small-range" : "no-pose" };
  }

  // ---- manual: use the chosen joint ----
  const rule = deriveRule(raws[joint]);
  if ("error" in rule) return rule;
  return { ...rule, joint };
}

/** 10th..90th percentile movement range (robust against noise). */
function pRange(raw: number[]): number {
  const sorted = [...raw].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.1)];
  const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  return hi - lo;
}

/** Derive the counting rule from the recorded angle samples. */
function deriveRule(raw: number[]): Omit<MovementRule, "joint"> | { error: string } {
  if (raw.length < 20) return { error: "no-pose" };

  // Where the movement starts (= rest position in the first moments).
  const firstCount = Math.min(12, raw.length);
  const startVal = raw.slice(0, firstCount).reduce((a, b) => a + b, 0) / firstCount;

  // Movement range: 10th..90th percentile (robust against noise).
  const sorted = [...raw].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.1)];
  const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  const range = hi - lo;
  if (range < 18) return { error: "small-range" };

  const start: "high" | "low" = startVal > (lo + hi) / 2 ? "high" : "low";

  // Rep speed: average full-rep time from midpoint crossings of the raw signal.
  const mid = (lo + hi) / 2;
  const flips: number[] = [];
  let above = raw[0] > mid;
  for (let i = 1; i < raw.length; i++) {
    const nowAbove = raw[i] > mid;
    if (nowAbove !== above) {
      flips.push(i);
      above = nowAbove;
    }
  }
  let minRepMs = 650;
  if (flips.length >= 4) {
    // a full rep ≈ two crossings; the 80ms sampling gives the duration
    const reps = (flips.length - 1) / 2;
    const totalMs = (flips[flips.length - 1] - flips[0]) * 80;
    minRepMs = Math.round(Math.max(380, Math.min(1600, (totalMs / reps) * 0.55)));
  }

  return {
    top: Math.round(start === "high" ? lo + range * 0.72 : lo + range * 0.28),
    bottom: Math.round(start === "high" ? lo + range * 0.28 : lo + range * 0.72),
    start,
    minBottomMs: 180,
    minRepMs,
  };
}
