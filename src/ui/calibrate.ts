/**
 * Movement calibration — the "train it with your own video" flow.
 * Records a few seconds of the chosen joint's angle while the user
 * demonstrates the movement, then derives the counting rule from the
 * recording: rest angle, deepest angle and where the movement starts.
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
}

export async function runCalibration(
  joint: TrackJoint,
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

  // Fullscreen recording view with a countdown.
  const video = h(
    `<video playsinline autoplay muted style="position:fixed;inset:0;width:100%;height:100%;object-fit:cover;background:#000;z-index:80"></video>`
  ) as HTMLVideoElement;
  const ui = h(
    `<div style="position:fixed;left:0;right:0;top:28px;z-index:81;text-align:center;color:#fff;font-size:16px;font-weight:700;text-shadow:0 1px 6px rgba(0,0,0,.6)"></div>`
  ) as HTMLElement;
  document.body.appendChild(video);
  document.body.appendChild(ui);
  video.srcObject = stream;
  await video.play().catch(() => {});

  const raw: number[] = [];
  const t0 = Date.now();
  const ms = seconds * 1000;
  await new Promise<void>((resolve) => {
    const tick = () => {
      const dt = Date.now() - t0;
      if (dt >= ms) return resolve();
      const f = computeFeatures(engine.detect(video));
      if (f.ok) raw.push(jointAngle(f, joint));
      ui.textContent = `${Math.ceil((ms - dt) / 1000)}s · ${raw.length} samples — do full, steady reps`;
      window.setTimeout(tick, 80);
    };
    tick();
  });

  video.remove();
  ui.remove();
  stream.getTracks().forEach((tr) => tr.stop());
  engine.close();

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
