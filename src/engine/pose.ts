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
 * After a failure, fetch every bundled file for real (status, size, magic
 * bytes) and report wasm support + WebView version — so the thrown error says
 * exactly what is broken instead of a generic, messageless error.
 */
async function describeFailure(model: "full" | "lite", lastErr: unknown): Promise<Error> {
  const files = [
    `${WASM_DIR}vision_wasm_internal.wasm`,
    `${WASM_DIR}vision_wasm_nosimd_internal.wasm`,
    modelUrl(model),
  ];
  const probes: string[] = [];
  for (const url of files) {
    const short = url.split("/").pop();
    try {
      const r = await fetch(url);
      const buf = new Uint8Array(await r.arrayBuffer());
      const head = Array.from(buf.slice(0, 4))
        .map((b) => b.toString(16))
        .join("");
      // 0061736d = "\0asm" — a valid WebAssembly binary starts with it.
      probes.push(`${short}→${r.status}/${buf.length}b/${head === "0061736d" ? "wasm-ok" : head}`);
    } catch (e) {
      probes.push(`${short}→${errText(e).slice(0, 60)}`);
    }
  }
  let wa = "?";
  try {
    wa = typeof WebAssembly === "object" ? "yes" : "NO";
  } catch {
    wa = "NO";
  }
  const ua = navigator.userAgent.replace(/[();]/g, "").slice(-70);
  return new Error(`${errText(lastErr)} | wasm=${wa} | ${probes.join(" ")} | ${ua}`);
}

export class PoseEngine {
  private landmarker: PoseLandmarker | null = null;
  private lastTs = 0;
  private delegate: "GPU" | "CPU" = "GPU";

  private constructor() {}

  static async create(opts: PoseEngineOptions): Promise<PoseEngine> {
    const engine = new PoseEngine();
    // Try the requested model first, then fall back to "lite". For each model:
    // the library's own wasm variant, then BOTH variants explicitly (SIMD and
    // no-SIMD) — its SIMD detection can claim support while the SIMD build
    // still fails to instantiate on some WebViews, and then it never tries the
    // no-SIMD build. GPU first, then CPU. Fetch the model ourselves as a
    // buffer so a broken asset fetch cannot fail silently.
    const models: Array<"full" | "lite"> = opts.model === "full" ? ["full", "lite"] : ["lite"];
    type Fileset = { wasmLoaderPath: string; wasmBinaryPath: string };
    const filesets: Fileset[] = [];
    try {
      filesets.push((await FilesetResolver.forVisionTasks(WASM_DIR)) as Fileset);
    } catch {
      /* keep the explicit ones */
    }
    for (const v of ["vision_wasm_internal", "vision_wasm_nosimd_internal"]) {
      filesets.push({
        wasmLoaderPath: `${WASM_DIR}${v}.js`,
        wasmBinaryPath: `${WASM_DIR}${v}.wasm`,
      });
    }

    let lastErr: unknown = null;
    for (const model of models) {
      let buffer: ArrayBuffer | undefined;
      try {
        buffer = await (await fetch(modelUrl(model))).arrayBuffer();
      } catch (e) {
        lastErr = e;
      }
      for (const fileset of filesets) {
        for (const delegate of ["GPU", "CPU"] as const) {
          try {
            engine.landmarker = await engine.make(fileset, buffer, model, delegate);
            engine.delegate = delegate;
            return engine;
          } catch (e) {
            lastErr = e;
          }
        }
      }
    }

    // Everything failed — throw a PRECISE error: what broke + probe of every
    // bundled file (status/size/magic bytes) + wasm support + WebView version.
    throw await describeFailure(opts.model, lastErr);
  }

  private make(
    fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
    buffer: ArrayBuffer | undefined,
    model: "full" | "lite",
    delegate: "GPU" | "CPU"
  ) {
    return PoseLandmarker.createFromOptions(fileset, {
      baseOptions: buffer
        ? { modelAssetBuffer: new Uint8Array(buffer), delegate }
        : { modelAssetPath: modelUrl(model), delegate },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.35,
      minPosePresenceConfidence: 0.35,
      minTrackingConfidence: 0.3,
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
    const buffer = await (await fetch(modelUrl(model))).arrayBuffer();
    const next = await this.make(fileset, buffer, model, this.delegate);
    this.landmarker?.close();
    this.landmarker = next;
  }

  close() {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
