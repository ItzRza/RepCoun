/**
 * Workout screen — live camera with pose skeleton, auto exercise detection,
 * rep counting with bad-rep rejection, calories, heart rate and Health Connect.
 */

import type { Ctx } from "../../app";
import { PoseEngine } from "../../engine/pose";
import { computeFeatures, EXERCISES, EXERCISE_MAP, AUTO, AutoDetector, ExerciseDef } from "../../engine/exercises";
import { RepCounter, RejectReason } from "../../engine/repCounter";
import { CalorieTracker } from "../../engine/calories";
import { Landmarks, LM } from "../../engine/geometry";
import { health, HrMonitor } from "../../services/health";
import { log } from "../../services/logger";
import { cloudAssist, getCloudEndpoint, isOnline } from "../../services/online";
import { store } from "../../data/store";
import { getLbApi, submitScore } from "../../services/lbapi";
import { personalRecords } from "../../data/store";
import { t } from "../../i18n/i18n";
import { h, $, fmtDuration, haptic, beep, esc } from "../dom";
import { icons } from "../icons";

const CONN: Array<[number, number]> = [
  [0, 2], [0, 5], [1, 3], [2, 4], [5, 6], [6, 7], [7, 8], [5, 11], [6, 12],
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [15, 17], [16, 18],
  [17, 19], [18, 20], [19, 20], [11, 23], [12, 24], [23, 24], [23, 25],
  [25, 27], [27, 29], [29, 31], [24, 26], [26, 28], [28, 30], [30, 32],
];

const TIP_MAP: Record<string, string> = {
  pushup: "tip.pushup", squat: "tip.squat", situp: "tip.situp", pullup: "tip.pullup",
  jumpingjack: "tip.jack", lunge: "tip.lunge", plank: "tip.plank", bicepcurl: "tip.curl",
  shoulderpress: "tip.press", burpee: "tip.burpee", mountainclimber: "tip.mc",
  glutebridge: "tip.bridge",
};

export function openWorkout(ctx: Ctx, initialExercise?: string) {
  const settings = store.getSettings();
  let facing: "user" | "environment" = settings.cameraFacing;
  const mirror = () => facing === "user";

  /* ----------------------------- DOM skeleton ----------------------------- */
  const overlay = h(`
    <div class="workout">
      <div class="cam-stage ${mirror() ? "mirror" : ""}">
        <video autoplay playsinline muted></video>
        <canvas class="overlay"></canvas>
      </div>
      <div class="frame-brackets"><span></span><span></span><span></span><span></span></div>

      <div class="workout-top">
        <button class="icon-btn" data-act="close">${icons.close}</button>
        <div style="font-weight:800;letter-spacing:-0.01em">RepCoun</div>
        <div class="row tight">
          <button class="icon-btn ${health.isNative() ? "" : "hidden"}" data-act="pip" title="Mini mode">${icons.pip}</button>
          <button class="icon-btn" data-act="flip">${icons.camera_flip}</button>
          <button class="icon-btn" data-act="help">${icons.info}</button>
        </div>
      </div>

      <div class="rep-hud">
        <div class="count">0</div>
        <div class="ex-name"></div>
      </div>
      <div class="hud-stats">
        <div class="hud-pill kcal">${icons.flame}<span>0</span></div>
        <div class="hud-pill hr hidden">${icons.heart}<span></span></div>
        <div class="hud-pill time">${icons.clock}<span>0:00</span></div>
      </div>

      <div class="tracking-pill"><span class="live-dot"></span><span class="txt">${t("workout.tracking")}</span></div>
      <div class="toast-zone"></div>

      <div class="workout-bottom">
        <div class="chips"></div>
        <div class="workout-actions">
          <button class="btn ghost" data-act="reset">${icons.sync}${t("workout.reset")}</button>
          <button class="btn success" data-act="finish">${icons.check}${t("workout.finish")}</button>
        </div>
      </div>

      <div class="cam-loading">
        <div class="spinner"></div>
        <div class="h2">${t("workout.loading_model")}</div>
        <div class="sub" style="color:rgba(255,255,255,.7);max-width:260px">${t("workout.loading_model_sub")}</div>
        <div class="bar"><i></i></div>
      </div>
    </div>`);
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";

  const video = overlay.querySelector("video") as HTMLVideoElement;
  const canvas = overlay.querySelector("canvas.overlay") as HTMLCanvasElement;
  const ctx2d = canvas.getContext("2d")!;
  const countEl = overlay.querySelector(".count") as HTMLElement;
  const exNameEl = overlay.querySelector(".ex-name") as HTMLElement;
  const kcalEl = overlay.querySelector(".kcal span") as HTMLElement;
  const hrPill = overlay.querySelector(".hr") as HTMLElement;
  const hrEl = overlay.querySelector(".hr span") as HTMLElement;
  const timeEl = overlay.querySelector(".time span") as HTMLElement;
  const trackPill = overlay.querySelector(".tracking-pill") as HTMLElement;
  const chipsEl = overlay.querySelector(".chips") as HTMLElement;
  const toastZone = overlay.querySelector(".toast-zone") as HTMLElement;
  const loadingEl = overlay.querySelector(".cam-loading") as HTMLElement;

  /* --------------------------------- state -------------------------------- */
  let engine: PoseEngine | null = null;
  let stream: MediaStream | null = null;
  let camDenied = false; // camera permission blocked by the phone (needs Settings)
  let bootError: "camera" | "model" = "camera"; // which boot step failed
  let bootDiag = ""; // underlying error, shown for support/diagnostics
  let detector: RepCounter | null = null;
  let auto = new AutoDetector();
  let calories = new CalorieTracker({ weightKg: settings.weightKg, age: settings.age, sex: settings.sex });
  let hrMonitor: HrMonitor | null = null;

  let selected: string = initialExercise && initialExercise !== AUTO ? initialExercise : AUTO;
  let current: ExerciseDef | null = selected !== AUTO ? EXERCISE_MAP[selected] : null;
  let reps = 0;
  /** reps per exercise — kept across auto-detected exercise switches */
  const breakdown: Record<string, number> = {};
  let rejected = 0;
  let holdSecs = 0;
  let hr: number | null = null;
  let startTs = Date.now();
  let paused = false;
  let running = false;
  let loopTimer: number | null = null;
  let tickTimer: number | null = null;
  let lastCloud = 0;
  let noPersonSince = 0;
  let closed = false;

  const toast = (msg: string, kind: "good" | "bad" | "info" = "info") => {
    const el = h(`<div class="toast ${kind}">${msg}</div>`);
    toastZone.appendChild(el);
    setTimeout(() => {
      el.style.transition = "opacity .3s, transform .3s";
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 300);
    }, 1300);
  };

  const banner = (msg: string) => {
    overlay.querySelector(".detect-banner")?.remove();
    const el = h(`<div class="detect-banner"><span class="pulse-dot"></span>${msg}</div>`);
    overlay.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  };

  /* ------------------------------ chips / UI ------------------------------ */
  function renderChips() {
    const items = [{ id: AUTO, label: t("workout.auto") }, ...EXERCISES.map((e) => ({ id: e.id, label: t(`exercise.${e.i18n}`) }))];
    chipsEl.innerHTML = items
      .map(
        (it) =>
          `<button class="chip ${it.id === AUTO ? "auto" : ""} ${(selected === it.id || (selected === AUTO && current?.id === it.id)) ? "active" : ""}" data-ex="${it.id}">${it.label}</button>`
      )
      .join("");
    const active = chipsEl.querySelector(".chip.active");
    active?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }

  function setExercise(def: ExerciseDef | null, announce = false) {
    current = def;
    calories.setExercise(def);
    detector = def ? new RepCounter(def, hooks, store.getSettings().repDepthPct) : null;
    auto.reset();
    exNameEl.textContent = def ? t(`exercise.${def.i18n}`) : "";
    if (def) {
      countEl.classList.toggle("timed", def.mode === "timed");
      if (announce) banner(t("workout.detected", { exercise: t(`exercise.${def.i18n}`) }));
    }
    renderChips();
  }

  chipsEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".chip") as HTMLButtonElement | null;
    if (!btn) return;
    haptic(8);
    selected = btn.dataset.ex!;
    setExercise(selected === AUTO ? null : EXERCISE_MAP[selected], selected !== AUTO);
  });

  /* --------------------------------- hooks -------------------------------- */
  const hooks = {
    onRep: (depth: number) => {
      reps++;
      breakdown[current?.id ?? "mixed"] = (breakdown[current?.id ?? "mixed"] ?? 0) + 1;
      countEl.textContent = String(reps);
      countEl.classList.remove("pop");
      void countEl.offsetWidth;
      countEl.classList.add("pop");
      calories.addRep(current);
      kcalEl.textContent = String(Math.round(calories.total));
      if (settings.haptics) haptic(14);
      if (settings.sound) beep(880 + Math.min(reps, 30) * 12);
      if (depth >= 72) toast(t("workout.deep"), "good");
      else toast(t("workout.great"), "good");
    },
    onReject: (reason: RejectReason) => {
      rejected++;
      toast(t(`rep.${reason}`), "bad");
      if (settings.haptics) haptic(30);
      if (settings.sound) beep(220, 0.09);
    },
    onHoldSec: (sec: number) => {
      holdSecs += sec;
      countEl.textContent = String(holdSecs);
      if (settings.haptics) haptic(10);
      if (settings.sound) beep(760);
    },
  };

  /* -------------------------------- camera -------------------------------- */
  function describeErr(e: unknown): string {
    if (e == null) return "unknown error";
    if (typeof e === "string") return e;
    const err = e as { name?: string; message?: string; stack?: string } | null;
    const head = `${err?.name ?? "Error"}${err?.message ? `: ${err.message}` : ""}`;
    const at = (err?.stack ?? "").split("\n")[1]?.trim();
    return at ? `${head} @ ${at}` : head;
  }

  async function startCamera() {
    stopCamera(); // release a camera left running by a previous attempt
    camDenied = false;
    // Rewritten from zero: try the SIMPLEST request first ({video:true}), then
    // the preferred facing. Each attempt gets a 12s timeout so a silently
    // swallowed permission dialog can never hang the workout forever.
    const attempts: MediaStreamConstraints[] = [
      { video: { width: { ideal: 640 }, height: { ideal: 480 } } },
      { video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } } },
    ];
    let lastErr: unknown = null;
    for (const constraints of attempts) {
      let ask: Promise<MediaStream> | null = null;
      try {
        ask = navigator.mediaDevices.getUserMedia(constraints);
        const timeout = new Promise<never>((_, reject) => {
          const id = window.setTimeout(
            () => reject({ name: "TimeoutError", message: "camera permission dialog never answered" }),
            12000
          );
          ask!.then(() => window.clearTimeout(id), () => window.clearTimeout(id));
        });
        stream = await Promise.race([ask, timeout]);
        break;
      } catch (e) {
        lastErr = e;
        log.e("cam", `getUserMedia FAIL ${describeErr(e)}`);
        const name = (e as { name?: string })?.name;
        if (ask) ask.then((s) => s.getTracks().forEach((tr) => tr.stop()), () => {});
        // No permission / dialog swallowed → retrying cannot help.
        if (name === "NotAllowedError" || name === "TimeoutError") break;
      }
    }
    if (!stream) {
      const name = (lastErr as { name?: string })?.name;
      camDenied = name === "NotAllowedError" || name === "TimeoutError";
      const nav = navigator as unknown as { mediaDevices?: unknown };
      bootDiag = `media=${nav.mediaDevices ? "ok" : "MISSING"} secure=${window.isSecureContext ? "yes" : "no"} ${describeErr(lastErr)}`;
      if (camDenied && health.isNative()) void health.openAppSettings();
      throw lastErr ?? new Error("camera");
    }
    log.i("cam", "stream ok");
    video.srcObject = stream;
    await video.play().catch(() => {});
  }

  function stopCamera() {
    stream?.getTracks().forEach((tr) => tr.stop());
    stream = null;
  }

  /* ------------------------------ detection ------------------------------- */
  function resizeCanvas() {
    const rect = canvas.parentElement!.getBoundingClientRect();
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
  }

  function draw(lms: Landmarks | null) {
    const cw = canvas.width, ch = canvas.height;
    ctx2d.clearRect(0, 0, cw, ch);
    if (!lms) return;
    const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
    // emulate object-fit: cover mapping
    const sA = cw / ch, vA = vw / vh;
    let scale: number, ox: number, oy: number;
    if (vA > sA) { scale = ch / vh; ox = (cw - vw * scale) / 2; oy = 0; }
    else { scale = cw / vw; ox = 0; oy = (ch - vh * scale) / 2; }
    const P = (i: number) => {
      const p = lms[i];
      return { x: p.x * vw * scale + ox, y: p.y * vh * scale + oy, v: p.visibility ?? 1 };
    };

    ctx2d.lineWidth = Math.max(2.5, cw / 150);
    ctx2d.strokeStyle = "rgba(74, 222, 128, 0.95)";
    ctx2d.shadowColor = "rgba(74,222,128,0.5)";
    ctx2d.shadowBlur = 0; // glow costs a lot of FPS on phones
    for (const [a, b] of CONN) {
      const pa = P(a), pb = P(b);
      if (pa.v < 0.5 || pb.v < 0.5) continue;
      ctx2d.beginPath();
      ctx2d.moveTo(pa.x, pa.y);
      ctx2d.lineTo(pb.x, pb.y);
      ctx2d.stroke();
    }
    ctx2d.shadowBlur = 0;
    const r = Math.max(3.5, cw / 90);
    for (let i = 0; i < lms.length; i++) {
      const p = P(i);
      if (p.v < 0.5) continue;
      ctx2d.beginPath();
      ctx2d.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx2d.fillStyle = i % 3 === 0 ? "#ffffff" : "#4ade80";
      ctx2d.fill();
      ctx2d.lineWidth = 1.5;
      ctx2d.strokeStyle = "rgba(10,10,15,0.7)";
      ctx2d.stroke();
    }
  }

  async function loopTick() {
    if (!running || closed) return;
    if (!paused && document.visibilityState === "visible" && video.readyState >= 2) {
      const lms = engine?.detect(video) ?? null;
      const f = computeFeatures(lms);
      draw(lms);

      if (f.ok) {
        noPersonSince = 0;
        trackPill.classList.remove("paused");
        (trackPill.querySelector(".txt") as HTMLElement).textContent = t("workout.tracking");
        overlay.querySelector(".frame-brackets")?.classList.remove("hidden");

        if (selected === AUTO) {
          const id = auto.update(f);
          if (id && current?.id !== id) setExercise(EXERCISE_MAP[id], true);
          // optional cloud assist when online & configured
          if (isOnline() && getCloudEndpoint() && Date.now() - lastCloud > 6000) {
            lastCloud = Date.now();
            try {
              const frame = document.createElement("canvas");
              frame.width = 320; frame.height = 240;
              frame.getContext("2d")!.drawImage(video, 0, 0, 320, 240);
              const cid = await cloudAssist(frame.toDataURL("image/jpeg", 0.6));
              if (cid && current?.id !== cid) setExercise(EXERCISE_MAP[cid], true);
            } catch { /* ignore */ }
          }
        }
        detector?.update(f, performance.now());
        calories.tick(Date.now(), hr);
        kcalEl.textContent = String(Math.round(calories.total));
      } else {
        noPersonSince = noPersonSince || Date.now();
        if (Date.now() - noPersonSince > 2200) {
          trackPill.classList.add("paused");
          (trackPill.querySelector(".txt") as HTMLElement).textContent = t("workout.looking");
        }
      }
    }
    loopTimer = window.setTimeout(loopTick, 50); // ~20 fps — battery friendly
  }

  /* --------------------------------- time --------------------------------- */
  function startTick() {
    tickTimer = window.setInterval(() => {
      if (paused) return;
      const sec = Math.floor((Date.now() - startTs) / 1000);
      timeEl.textContent = fmtDuration(sec);
    }, 500);
  }

  const onVisibility = () => {
    paused = document.visibilityState === "hidden";
  };
  document.addEventListener("visibilitychange", onVisibility);

  /* -------------------------------- actions ------------------------------- */
  function resetWorkout() {
    reps = 0; rejected = 0; holdSecs = 0;
    startTs = Date.now();
    calories = new CalorieTracker({ weightKg: settings.weightKg, age: settings.age, sex: settings.sex });
    calories.setExercise(current);
    calories.start(Date.now());
    detector?.reset();
    auto.reset();
    countEl.textContent = "0";
    kcalEl.textContent = "0";
    toast(t("workout.reset"), "info");
  }

  function finishWorkout() {
    paused = true;
    const durationSec = Math.max(1, Math.round((Date.now() - startTs) / 1000));
    const exId = current?.id ?? "mixed";
    const isTimed = current?.mode === "timed";
    const count = isTimed ? holdSecs : reps;
    const kcal = Math.round(calories.total);
    const prs = personalRecords();
    const prevPr = prs[exId]?.reps ?? 0;
    const isPr = exId !== "mixed" && count > prevPr && count > 0;

    const sheet = ctx.openSheet(
      `
      <div class="center-col" style="margin-bottom:4px">
        <div class="logo-mark" style="margin-bottom:10px">${icons.trophy}</div>
        <div class="h1">${t("workout.save_title")}</div>
        <div class="sub">${current ? t(`exercise.${current.i18n}`) : t("workout.auto")}</div>
      </div>
      ${isPr ? `<div class="badge violet" style="display:flex;justify-content:center;margin:10px auto;width:fit-content">${icons.star}${t("workout.new_pr")}</div>` : ""}
      <div class="summary-grid">
        <div class="summary-stat"><div class="v">${count}</div><div class="l">${isTimed ? t("home.min").replace("min","sec") : t("home.reps")}</div></div>
        <div class="summary-stat"><div class="v">${kcal}</div><div class="l">${t("home.kcal")}</div></div>
        <div class="summary-stat"><div class="v">${fmtDuration(durationSec)}</div><div class="l">${t("workout.duration")}</div></div>
      </div>
      ${hr ? `<div class="row" style="justify-content:center;gap:6px;color:var(--red)">${icons.heart}<b>${hr}</b><span class="tiny">${t("workout.hr")}</span></div>` : ""}
      ${Object.keys(breakdown).length > 1 ? `<div class="list" style="margin-top:10px">${Object.entries(breakdown)
        .map(([id, n]) => `
        <div class="list-row" style="cursor:default">
          <div style="flex:1" class="h3">${EXERCISE_MAP[id] ? t(`exercise.${EXERCISE_MAP[id].i18n}`) : id}</div>
          <div class="sub" style="font-weight:700">${n} ${t("home.reps")}</div>
        </div>`)
        .join("")}</div>` : ""}
      <div class="row" style="margin-top:14px;gap:10px">
        <button class="btn ghost" data-a="discard">${t("workout.discard")}</button>
        <button class="btn primary" data-a="save">${t("workout.save")}</button>
      </div>`,
      (sheetEl, closeSheet) => {
        sheetEl.querySelector('[data-a="discard"]')!.addEventListener("click", () => {
          closeSheet();
          close();
        });
        sheetEl.querySelector('[data-a="save"]')!.addEventListener("click", () => {
          const session = {
            id: `s${Date.now()}`,
            startedAt: startTs,
            endedAt: Date.now(),
            exercise: exId,
            reps: count,
            breakdown,
            rejected,
            kcal,
            durationSec,
            avgHr: hr,
          };
          store.addSession(session);
          if (store.getSettings().trackToHc) void health.writeSession(session);
          // Push the result to the leaderboard server (friend group), if connected.
          if (getLbApi().url) {
            const meName = store.getProfile().leaderboardName || store.getProfile().name || "You";
            void submitScore(meName, count);
          }
          closeSheet();
          ctx.toast(t("workout.saved", { kcal }), "good");
          close();
          ctx.navigate("home");
        });
      }
    );
    void sheet;
  }

  function helpSheet() {
    const def = current;
    ctx.openSheet(
      `
      <div class="h2" style="margin-bottom:6px">${def ? t(`exercise.${def.i18n}`) : t("workout.auto")}</div>
      <div class="sub">${def ? t(TIP_MAP[def.id] ?? "") : t("workout.place")}</div>
      <div class="divider"></div>
      <div class="row" style="gap:8px;margin-bottom:8px"><span class="badge green">${icons.check}${t("workout.all_reps")}</span></div>
      <div class="row" style="gap:8px"><span class="badge red">${icons.close}${t("workout.rejects")}</span></div>
      `
    );
  }

  async function flipCamera() {
    facing = facing === "user" ? "environment" : "user";
    overlay.querySelector(".cam-stage")!.classList.toggle("mirror", mirror());
    stopCamera();
    try {
      await startCamera();
    } catch {
      showError();
    }
  }

  function showError() {
    loadingEl.classList.add("hidden");
    if (overlay.querySelector(".cam-error")) return;
    const kind = camDenied ? "permission" : bootError;
    const title =
      kind === "permission" ? t("workout.cam_permission")
      : kind === "model" ? t("workout.model_error")
      : t("workout.cam_error");
    const sub =
      kind === "permission" ? t("workout.cam_permission_sub")
      : kind === "model" ? t("workout.model_error_sub")
      : t("workout.cam_error_sub");
    const err = h(`
      <div class="cam-error">
        <div class="logo-mark" style="background:#2a2a36">${icons.camera}</div>
        <div class="h2">${title}</div>
        <div class="sub" style="color:rgba(255,255,255,.65)">${sub}</div>
        ${bootDiag ? `<div class="tiny" style="color:rgba(255,255,255,.42);margin-top:8px">${esc(bootDiag)}</div>` : ""}
        ${kind === "permission" ? `<button class="btn primary" data-a="settings" style="background:#fff;color:#4c2fd6">${t("common.settings")}</button>` : ""}
        <button class="btn primary" data-a="retry">${t("common.retry")}</button>
        <button class="btn ghost" data-a="exit" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.2)">${t("common.close")}</button>
      </div>`);
    overlay.appendChild(err);
    err.querySelector('[data-a="settings"]')?.addEventListener("click", () => {
      void health.openAppSettings();
    });
    err.querySelector('[data-a="retry"]')!.addEventListener("click", () => {
      err.remove();
      loadingEl.classList.remove("hidden");
      void boot();
    });
    err.querySelector('[data-a="exit"]')!.addEventListener("click", () => close());
  }

  /* --------------------------------- boot --------------------------------- */
  async function boot() {
    bootDiag = "";
    bootError = "camera";
    try {
      await startCamera();
    } catch (e) {
      if (!bootDiag) bootDiag = describeErr(e);
      showError();
      return;
    }
    bootError = "model";
    log.i("model", `loading ${store.getSettings().model}`);
    try {
      engine = await PoseEngine.create({ model: store.getSettings().model });
      log.i("model", "loaded ok");
    } catch (e) {
      bootDiag = describeErr(e);
      log.e("model", `load FAIL ${bootDiag}`);
      showError();
      return;
    }
    resizeCanvas();
    loadingEl.classList.add("hidden");
    calories.setExercise(current);
    calories.start(Date.now());
    setExercise(current, false);
    renderChips();
    running = true;
    void loopTick();
    startTick();
    void health.setPipEnabled(true);

    if (health.isNative()) {
      hrMonitor = new HrMonitor((bpm) => {
        hr = bpm;
        hrPill.classList.toggle("hidden", bpm === null);
        if (bpm) hrEl.textContent = String(bpm);
      });
      hrMonitor.start();
    }
  }

  async function enterMiniMode() {
    const ok = await health.enterMiniMode();
    if (ok) toast(t("workout.mini_hint"), "info");
    else toast(t("profile.hc_web"), "info");
  }

  function close() {
    closed = true;
    running = false;
    void health.setPipEnabled(false);
    if (loopTimer) window.clearTimeout(loopTimer);
    if (tickTimer) window.clearInterval(tickTimer);
    document.removeEventListener("visibilitychange", onVisibility);
    hrMonitor?.stop();
    engine?.close();
    stopCamera();
    overlay.remove();
    document.body.style.overflow = "";
  }

  overlay.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "close") close();
    else if (act === "reset") resetWorkout();
    else if (act === "finish") finishWorkout();
    else if (act === "help") helpSheet();
    else if (act === "flip") void flipCamera();
    else if (act === "pip") void enterMiniMode();
  });

  window.addEventListener("resize", resizeCanvas);

  if (!isOnline()) {
    setTimeout(() => toast(t("home.offline"), "info"), 900);
  }

  void boot();
}
