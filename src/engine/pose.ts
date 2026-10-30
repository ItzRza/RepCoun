/**
 * Pose engine — MediaPipe Tasks Vision (WASM).
 * The model files ship inside the app, so tracking works 100% offline.
 */

import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Landmarks } from "./geometry";

const WASM_DIR = new URL("mediapipe/wasm/", document.baseURI).href;

export interface PoseEngineOptions {
  model: "full" | "lite";
}

export function modelUrl(model: "full" | "lite"): string {
  return new URL(`models/pose_landmarker_${model}.task`, document.baseURI).href;
}

function errText(e: unknown): string {
  if (e == null) return "unknown error";
  if (typeof e === "string") return e;
  const o = e as { name?: string; message?: string };
  return `${o?.name ?? "Error"}${o?.message ? `: ${o.message}` : ""}`;
}

/**
 * Runs HEAD checks on every bundled file after a failure, so the thrown error
 * says exactly what is missing (e.g. "404 vision_wasm_internal.wasm") instead
 * of a generic, messageless error.
 */
async function describeFailure(model: "full" | "lite", lastErr: unknown): Promise<Error> {
  const names = [
    `${WASM_DIR}vision_wasm_internal.js`,
    `${WASM_DIR}vision_wasm_nosimd_internal.js`,
    `${WASM_DIR}vision_wasm_internal.wasm`,
    `${WASM_DIR}vision_wasm_nosimd_internal.wasm`,
    modelUrl(model),
  ];
  const problems: string[] = [];
  for (const url of names) {
    const short = url.split("/").pop();
    try {
      const r = await fetch(url, { method: "HEAD" });
      if (!r.ok) problems.push(`${short} → HTTP ${r.status}`);
    } catch {
      problems.push(`${short} → fetch failed`);
    }
  }
  const base = errText(lastErr);
  return new Error(problems.length ? `${base} [${problems.join("; ")}]` : base);
}

export class PoseEngine {
  private landmarker: PoseLandmarker | null = null;
  private lastTs = 0;
  private delegate: "GPU" | "CPU" = "GPU";

  private constructor() {}

  static async create(opts: PoseEngineOptions): Promise<PoseEngine> {
    const engine = new PoseEngine();
    // Try the requested model first, then fall back to the smaller "lite" one —
    // and on each model try GPU first, then CPU. Only give up when all fail.
    const models: Array<"full" | "lite"> = opts.model === "full" ? ["full", "lite"] : ["lite"];
    let lastErr: unknown = null;

    for (const model of models) {
      let fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
      try {
        fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
      } catch (e) {
        lastErr = e; // WASM loader itself failed — no point trying more models
        break;
      }
      for (const delegate of ["GPU", "CPU"] as const) {
        try {
          engine.landmarker = await engine.make(fileset, model, delegate);
          engine.delegate = delegate;
          return engine;
        } catch (e) {
          lastErr = e;
        }
      }
    }

    // Everything failed — build a PRECISE error (which file is missing/broken)
    // so one screenshot of the error screen is enough to diagnose.
    throw await describeFailure(opts.model, lastErr);
  }

  private make(fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, model: "full" | "lite", delegate: "GPU" | "CPU") {
    return PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelUrl(model), delegate },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  get usingGpu(): boolean {
    return this.delegate === "GPU";
  }

  /** Returns 33 normalized landmarks or null when no person is tracked. */
  detect(video: HTMLVideoElement): Landmarks | null {
    if (!this.landmarker || video.readyState < 2) return null;
    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    try {
      const res = this.landmarker.detectForVideo(video, ts);
      const lms = res?.landmarks?.[0];
      if (!lms || lms.length < 33) return null;
      return lms as Landmarks;
    } catch {
      return null;
    }
  }

  async switchModel(model: "full" | "lite") {
    const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
    const next = await this.make(fileset, model, this.delegate);
    this.landmarker?.close();
    this.landmarker = next;
  }

  close() {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
