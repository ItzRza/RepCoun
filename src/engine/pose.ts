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

export class PoseEngine {
  private landmarker: PoseLandmarker | null = null;
  private lastTs = 0;
  private delegate: "GPU" | "CPU" = "GPU";

  private constructor() {}

  static async create(opts: PoseEngineOptions): Promise<PoseEngine> {
    const engine = new PoseEngine();
    const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
    try {
      engine.landmarker = await engine.make(fileset, opts.model, "GPU");
    } catch {
      // Some WebViews don't expose WebGL compute — fall back to CPU.
      engine.delegate = "CPU";
      engine.landmarker = await engine.make(fileset, opts.model, "CPU");
    }
    return engine;
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
