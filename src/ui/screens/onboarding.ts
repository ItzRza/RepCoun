/** First-run onboarding — language, profile, permissions. */

import type { Ctx } from "../../app";
import { t, LOCALES } from "../../i18n/i18n";
import { esc } from "../dom";
import { icons } from "../icons";
import { health } from "../../services/health";

export function renderOnboarding(root: HTMLElement, ctx: Ctx) {
  let step = 1;
  const draft = {
    name: "",
    weightKg: ctx.settings.weightKg,
    heightCm: ctx.settings.heightCm,
    age: ctx.settings.age,
    sex: ctx.settings.sex as "male" | "female",
    lang: ctx.settings.lang,
  };
  let camGranted = false;
  let hcGranted = false;

  void health.availability().then((a) => {
    if (a.granted && !hcGranted) {
      hcGranted = true;
      draw();
    }
  });

  // Re-check when the user returns from Health Connect / Settings (manual grant).
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    void health.availability().then((a) => {
      if (a.granted && !hcGranted) {
        hcGranted = true;
        draw();
      }
    });
  });

  function draw() {
    root.innerHTML = `
      <div class="screen no-nav" style="display:flex;flex-direction:column">
        <div class="row tight" style="margin:6px 0 20px">
          ${[1, 2, 3].map((i) => `<div style="flex:1;height:5px;border-radius:99px;background:${i <= step ? "var(--accent)" : "var(--line)"}"></div>`).join("")}
        </div>

        ${step === 1 ? step1() : step === 2 ? step2() : step3()}

        <div class="spacer"></div>
        <button class="btn primary lg block" data-a="next">
          ${step === 3 ? t("onboard.start") : t("common.next")}
        </button>
        ${step === 3 ? `<button class="btn ghost block" style="margin-top:10px;background:transparent;border:none" data-a="skip">${t("common.skip") ?? "Skip"}</button>` : ""}
        <div class="tiny" id="ob-build" style="text-align:center;margin-top:14px;opacity:.65">RepCoun 1.0.0</div>
      </div>`;

    // Show the exact build — if this doesn't say "+bN", the newest APK isn't installed.
    void health.appVersion().then((v) => {
      const el = root.querySelector("#ob-build");
      if (el && v?.version) el.textContent = `RepCoun ${v.version}`;
    });

    root.querySelector("[data-a='next']")!.addEventListener("click", onNext);
    root.querySelector("[data-a='skip']")?.addEventListener("click", () => finish());
    root.querySelectorAll("[data-lang]").forEach((el) =>
      el.addEventListener("click", () => {
        draft.lang = (el as HTMLElement).dataset.lang!;
        ctx.saveSettings({ lang: draft.lang });
        draw();
      })
    );
    root.querySelectorAll("[data-sex]").forEach((el) =>
      el.addEventListener("click", () => {
        draft.sex = (el as HTMLElement).dataset.sex as "male" | "female";
        draw();
      })
    );
    root.querySelector("[data-a='cam']")?.addEventListener("click", async () => {
      // Probe through getUserMedia — Android's WebView shows the system camera
      // dialog itself (reliable on every device; our own dialog was blocked).
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true });
        probe.getTracks().forEach((tr) => tr.stop());
        camGranted = true;
      } catch {
        camGranted = false;
        void health.openAppSettings();
        ctx.toast(t("workout.cam_permission"), "info");
      }
      draw();
    });
    root.querySelector("[data-a='hc']")?.addEventListener("click", async () => {
      if (!health.isNative()) {
        ctx.toast(t("profile.hc_web"), "info");
        return;
      }
      const r = await health.requestPermissions();
      if (r.manual) {
        // Permission dialog blocked — Health Connect's own screen is open now.
        ctx.toast(t("profile.hc_manual"), "info");
        return;
      }
      if (r.reason === "update") {
        ctx.toast(t("profile.hc_update"), "bad");
        void health.openHcStore(); // one tap → Play Store to update Health Connect
        return;
      }
      if (r.reason === "unavailable") {
        ctx.toast(t("profile.hc_unavailable"), "bad");
        return;
      }
      hcGranted = r.granted;
      ctx.toast(hcGranted ? t("profile.hc_connected") : t("profile.hc_missing"), hcGranted ? "good" : "bad");
      if (!hcGranted) {
        void health.hcDiag().then((d) => {
          if (!d) return;
          ctx.toast(
            `HC ${d.sdkStr} · ${d.count}/${d.total} · err: ${d.grantError || "none"} · dialog: ${d.canRequest ? "ok" : "missing"}`,
            "info"
          );
        });
      }
      draw();
    });
  }

  function step1() {
    return `
      <div class="center-col" style="margin-bottom:26px">
        <div class="logo-mark" style="margin-bottom:16px">${icons.dumbbell}</div>
        <div class="h-display"><span class="underline-grad">${t("app.tagline")}</span></div>
        <div class="sub" style="margin-top:12px;max-width:300px">${t("onboard.sub")}</div>
      </div>
      <label class="field">
        <span class="label">${t("onboard.lang")}</span>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${LOCALES.map(
            (l) => `<button class="chip ${draft.lang === l.code ? "active" : ""}" data-lang="${l.code}">${l.native}</button>`
          ).join("")}
        </div>
      </label>
      <label class="field">
        <span class="label">${t("onboard.name")}</span>
        <input class="input" id="ob-name" placeholder="${t("onboard.name_ph")}" value="${esc(draft.name)}">
      </label>`;
  }

  function step2() {
    return `
      <div class="h-display" style="margin-bottom:6px">${t("onboard.body")}</div>
      <div class="sub" style="margin-bottom:20px">${t("profile.hc_desc")}</div>
      <label class="field"><span class="label">${t("onboard.weight")}</span>
        <input class="input" id="ob-w" type="number" inputmode="decimal" value="${draft.weightKg}"></label>
      <label class="field"><span class="label">${t("onboard.height")}</span>
        <input class="input" id="ob-h" type="number" inputmode="decimal" value="${draft.heightCm}"></label>
      <label class="field"><span class="label">${t("onboard.age")}</span>
        <input class="input" id="ob-a" type="number" inputmode="numeric" value="${draft.age}"></label>
      <label class="field"><span class="label">${t("onboard.sex")}</span>
        <div class="seg">
          <button data-sex="male" class="${draft.sex === "male" ? "active" : ""}">${t("onboard.male")}</button>
          <button data-sex="female" class="${draft.sex === "female" ? "active" : ""}">${t("onboard.female")}</button>
        </div></label>`;
  }

  function step3() {
    return `
      <div class="h-display" style="margin-bottom:6px">${t("onboard.camera_title")}</div>
      <div class="sub" style="margin-bottom:20px">${t("onboard.camera_sub")}</div>

      <div class="card" style="margin-bottom:12px">
        <div class="row">
          <div class="emoji" style="width:44px;height:44px;border-radius:14px;background:var(--accent-soft);display:grid;place-items:center">${icons.camera}</div>
          <div style="flex:1"><div class="h3">${t("onboard.camera_title")}</div><div class="tiny">${t("home.need_cam_sub")}</div></div>
          ${camGranted ? `<span class="badge green">${icons.check}✓</span>` : `<button class="btn soft" style="min-height:40px;padding:8px 14px" data-a="cam">${t("onboard.allow")}</button>`}
        </div>
      </div>

      <div class="card">
        <div class="row">
          <div class="emoji" style="width:44px;height:44px;border-radius:14px;background:var(--red-soft);display:grid;place-items:center;color:var(--red)">${icons.heart}</div>
          <div style="flex:1"><div class="h3">${t("profile.health")}</div><div class="tiny">${t("profile.hc_desc")}</div></div>
          ${hcGranted ? `<span class="badge green">${icons.check}✓</span>` : `<button class="btn soft" style="min-height:40px;padding:8px 14px" data-a="hc">${t("common.ok")}</button>`}
        </div>
      </div>`;
  }

  async function onNext() {
    if (step === 1) {
      draft.name = (root.querySelector("#ob-name") as HTMLInputElement)?.value.trim() ?? draft.name;
      step = 2;
      draw();
      return;
    }
    if (step === 2) {
      const w = parseFloat((root.querySelector("#ob-w") as HTMLInputElement)?.value ?? "");
      const ht = parseFloat((root.querySelector("#ob-h") as HTMLInputElement)?.value ?? "");
      const a = parseFloat((root.querySelector("#ob-a") as HTMLInputElement)?.value ?? "");
      if (!isNaN(w)) draft.weightKg = Math.max(25, Math.min(300, w));
      if (!isNaN(ht)) draft.heightCm = Math.max(100, Math.min(250, ht));
      if (!isNaN(a)) draft.age = Math.max(10, Math.min(100, a));
      step = 3;
      draw();
      return;
    }
    finish();
  }

  function finish() {
    ctx.saveProfile({ name: draft.name, leaderboardName: draft.name });
    ctx.saveSettings({
      weightKg: draft.weightKg,
      heightCm: draft.heightCm,
      age: draft.age,
      sex: draft.sex,
      lang: draft.lang,
      onboardingDone: true,
    });
    ctx.navigate("home");
  }

  draw();
}
