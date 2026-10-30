/** Profile & settings screen. */

import type { Ctx } from "../../app";
import { t, LOCALES } from "../../i18n/i18n";
import { h, esc } from "../dom";
import { icons } from "../icons";
import { store, totals } from "../../data/store";
import { rankOf, setRankNameResolver } from "../../data/leaderboard";
import { health } from "../../services/health";
import { logText } from "../../services/logger";
import { getCloudEndpoint, setCloudEndpoint } from "../../services/online";

export function renderProfile(root: HTMLElement, ctx: Ctx) {
  const s = store.getSettings();
  const p = ctx.profile;
  const tot = totals();
  const rank = rankOf(tot.reps);
  setRankNameResolver((k) => t(k));
  const langLabel = LOCALES.find((l) => l.code === s.lang)?.native ?? "English";

  const wDisplay = s.unit === "metric" ? `${s.weightKg} kg` : `${Math.round(s.weightKg * 2.2046)} lb`;
  const hDisplay =
    s.unit === "metric"
      ? `${s.heightCm} cm`
      : `${Math.floor(s.heightCm / 30.48)}' ${Math.round((s.heightCm / 30.48) % 12)}"`;

  root.innerHTML = `
    <div class="page-head"><div class="h1">${t("profile.title")}</div></div>

    <div class="card">
      <div class="row" style="gap:14px">
        <div class="rank-gem" style="width:64px;height:64px;font-size:30px;border-radius:20px;margin:0">${rank.tier.gem}</div>
        <div style="flex:1;min-width:0">
          <div class="h2">${esc(p.name || t("onboard.name_ph"))}</div>
          <div class="tiny">${rank.label} · ${tot.reps} ${t("home.reps")}</div>
        </div>
        <button class="icon-btn" data-a="edit-name">${icons.edit}</button>
      </div>
    </div>

    <div class="section-title"><div class="h2">${t("profile.body")}</div></div>
    <div class="list">
      ${row("weight", icons.dumbbell, t("profile.weight"), wDisplay)}
      ${row("height", icons.chart, t("profile.height"), hDisplay)}
      ${row("age", icons.user, t("profile.age"), String(s.age))}
      ${row("sex", icons.star, t("profile.sex"), s.sex === "male" ? t("onboard.male") : t("onboard.female"))}
      ${row("unit", icons.sync, t("profile.unit"), s.unit === "metric" ? t("profile.metric") : t("profile.imperial"))}
    </div>

    <div class="section-title"><div class="h2">${t("profile.app")}</div></div>
    <div class="list">
      ${row("language", icons.language, t("profile.language"), langLabel)}
      ${row("theme", s.theme === "dark" ? icons.moon : icons.sun, t("profile.theme"), themeLabel(s.theme))}
      ${row("model", icons.bolt, t("profile.model"), s.model === "full" ? t("profile.model_full") : t("profile.model_lite"))}
      ${toggleRow("autodetect", icons.camera, t("profile.autodetect"), t("profile.autodetect_desc"), s.autoDetect)}
      ${toggleRow("sound", icons.star, t("profile.sound"), "", s.sound && s.haptics)}
      ${toggleRow("trackToHc", icons.heart, t("profile.track_sync"), t("profile.track_sync_desc"), s.trackToHc)}
      ${row("goal", icons.target, t("profile.goal"), String(s.repGoal))}
      ${row("depth", icons.target, "Rep depth %", `${s.repDepthPct}%`)}
      ${row("camera", icons.camera_flip, t("profile.camera"), s.cameraFacing === "user" ? t("profile.front") : t("profile.back"))}
    </div>

    <div class="section-title"><div class="h2">${t("profile.health")}</div></div>
    <div class="card">
      <div class="row" style="align-items:flex-start;gap:14px">
        <div style="width:42px;height:42px;flex:none;border-radius:13px;background:var(--red-soft);display:grid;place-items:center;color:var(--red)">${icons.heart}</div>
        <div style="flex:1;min-width:0">
          <div class="h3" id="hc-title">${t("common.loading")}</div>
          <div class="tiny" style="margin-top:3px">${t("profile.hc_desc")}</div>
        </div>
      </div>
      <button class="btn soft block" id="hc-btn" style="margin-top:12px" data-a="hc">${t("profile.hc_grant")}</button>
    </div>

    <div class="section-title"><div class="h2">${t("profile.advanced")}</div></div>
    <div class="sub" style="margin:0 2px 10px">${t("profile.advanced_desc")}</div>
    <div class="list">
      ${rowDesc("cloud", icons.globe, "Cloud assist API", t("profile.cloud_assist_desc"), getCloudEndpoint() ? "ON" : "OFF")}
      ${rowDesc("lbapi", icons.trophy, t("lb.connect_api"), t("profile.lbapi_desc"), "")}
    </div>

    <div class="section-title"><div class="h2">${t("profile.data")}</div></div>
    <div class="list">
      ${row("clear", icons.trash, t("profile.clear_data"), "")}
      <div class="list-row" data-a="about" style="cursor:pointer">
        <div class="emoji">${icons.info}</div>
        <div style="flex:1">
          <div class="h3">${t("profile.about")}</div>
          <div class="tiny" id="about-line">RepCoun · ${t("profile.version")} 1.0.0</div>
          <div class="tiny" style="opacity:.7">tap for logs</div>
        </div>
      </div>
    </div>
  `;

  // Real build + device info (e.g. "1.0.0+b15 · Android 16 · HC granted · bridge ok")
  // — one screenshot of this line is enough to diagnose a report.
  void Promise.all([health.appVersion(), health.availability()]).then(([v, a]) => {
    const el = root.querySelector("#about-line") as HTMLElement | null;
    if (!el) return;
    const ver = v?.version ?? "1.0.0";
    const hc = v
      ? v.hcStatus === 0
        ? a.granted
          ? "HC granted"
          : "HC not granted"
        : v.hcStatus === 2
          ? "HC update"
          : "HC n/a"
      : "";
    const and = v?.android ? `Android ${v.android}` : "";
    el.textContent = `RepCoun · ${t("profile.version")} ${ver} · ${[and, hc, `bridge ${health.bridgeOk() ? "ok" : "missing"}`].filter(Boolean).join(" · ")}`;
  });

  root.addEventListener("click", onClick);
  function onClick(e: Event) {
    const el = (e.target as HTMLElement).closest("[data-a]") as HTMLElement | null;
    if (!el) return;
    const a = el.dataset.a!;
    switch (a) {
      case "edit-name": return nameSheet();
      case "weight": return numSheet(t("profile.weight"), s.weightKg, s.unit === "metric" ? "kg" : "lb", (v) => {
        const kg = s.unit === "metric" ? v : v / 2.2046;
        ctx.saveSettings({ weightKg: Math.max(25, Math.min(300, Math.round(kg))) });
      });
      case "height": return numSheet(t("profile.height"), s.heightCm, s.unit === "metric" ? "cm" : "in", (v) => {
        const cm = s.unit === "metric" ? v : v * 2.54;
        ctx.saveSettings({ heightCm: Math.max(100, Math.min(250, Math.round(cm))) });
      });
      case "age": return numSheet(t("profile.age"), s.age, "", (v) => ctx.saveSettings({ age: Math.max(10, Math.min(100, Math.round(v))) }));
      case "sex": return pickSheet(t("profile.sex"), [
          [t("onboard.male"), "male"], [t("onboard.female"), "female"],
        ], s.sex, (v) => ctx.saveSettings({ sex: v as "male" | "female" }));
      case "unit": return pickSheet(t("profile.unit"), [
          [t("profile.metric"), "metric"], [t("profile.imperial"), "imperial"],
        ], s.unit, (v) => ctx.saveSettings({ unit: v as "metric" | "imperial" }));
      case "language": return pickSheet(t("profile.language"), LOCALES.map((l) => [l.native, l.code] as [string, string]), s.lang, (v) => ctx.saveSettings({ lang: v }));
      case "theme": return pickSheet(t("profile.theme"), [
          [t("profile.light"), "light"], [t("profile.dark"), "dark"], [t("profile.system"), "system"],
        ], s.theme, (v) => ctx.saveSettings({ theme: v as "light" | "dark" | "system" }));
      case "model": return pickSheet(t("profile.model"), [
          [t("profile.model_full"), "full"], [t("profile.model_lite"), "lite"],
        ], s.model, (v) => {
          ctx.saveSettings({ model: v as "full" | "lite" });
          ctx.toast(t("common.save"), "good");
        }, t("profile.model_desc"));
      case "goal": return numSheet(t("profile.goal"), s.repGoal, t("home.reps"), (v) => ctx.saveSettings({ repGoal: Math.max(10, Math.min(5000, Math.round(v))) }));
      case "depth": return numSheet(
        "Rep depth %",
        s.repDepthPct,
        "%",
        (v) => {
          ctx.saveSettings({ repDepthPct: Math.max(20, Math.min(150, Math.round(v))) });
          ctx.toast(t("common.save"), "good");
        }
      );
      case "camera": return pickSheet(t("profile.camera"), [
          [t("profile.front"), "user"], [t("profile.back"), "environment"],
        ], s.cameraFacing, (v) => ctx.saveSettings({ cameraFacing: v as "user" | "environment" }));
      case "autodetect": return ctx.saveSettings({ autoDetect: !s.autoDetect });
      case "sound": return ctx.saveSettings({ sound: !s.sound, haptics: !s.haptics });
      case "trackToHc": return ctx.saveSettings({ trackToHc: !s.trackToHc });
      case "hc": return void connectHc();
      case "cloud": return cloudSheet();
      case "lbapi": return ctx.toast(t("lb.global_empty"), "info");
      case "clear": return clearSheet();
      case "about": return logsSheet();
    }
  }

  function nameSheet() {
    const close = ctx.openSheet(
      `<div class="h2" style="margin-bottom:12px">${t("profile.name")}</div>
       <input class="input" id="f-name" value="${esc(p.name)}" placeholder="${t("onboard.name_ph")}">
       <input class="input" id="f-lbn" style="margin-top:10px" value="${esc(p.leaderboardName)}" placeholder="${t("profile.lb_name")}">
       <button class="btn primary block" style="margin-top:14px" data-a="save">${t("common.save")}</button>`,
      (sheet, closeFn) => {
        sheet.querySelector('[data-a="save"]')!.addEventListener("click", () => {
          ctx.saveProfile({
            name: (sheet.querySelector("#f-name") as HTMLInputElement).value.trim(),
            leaderboardName: (sheet.querySelector("#f-lbn") as HTMLInputElement).value.trim(),
          });
          closeFn();
        });
      }
    );
    void close;
  }

  function numSheet(label: string, value: number, unit: string, onSave: (v: number) => void) {
    ctx.openSheet(
      `<div class="h2" style="margin-bottom:12px">${label}</div>
       <input class="input" id="f-num" type="number" inputmode="decimal" value="${value}">
       <div class="tiny" style="margin-top:6px">${unit}</div>
       <button class="btn primary block" style="margin-top:14px" data-a="save">${t("common.save")}</button>`,
      (sheet, closeFn) => {
        sheet.querySelector('[data-a="save"]')!.addEventListener("click", () => {
          const v = parseFloat((sheet.querySelector("#f-num") as HTMLInputElement).value);
          if (!isNaN(v)) onSave(v);
          closeFn();
        });
      }
    );
  }

  function pickSheet(label: string, options: [string, string][], current: string, onSave: (v: string) => void, desc?: string) {
    ctx.openSheet(
      `<div class="h2" style="margin-bottom:6px">${label}</div>
       ${desc ? `<div class="sub" style="margin-bottom:10px">${desc}</div>` : ""}
       <div class="list">${options
         .map(
           ([lab, val]) => `
         <div class="list-row" data-v="${val}">
           <div style="flex:1" class="h3">${lab}</div>
           ${val === current ? `<span style="color:var(--accent)">${icons.check}</span>` : ""}
         </div>`
         )
         .join("")}</div>`,
      (sheet, closeFn) => {
        sheet.addEventListener("click", (ev) => {
          const row = (ev.target as HTMLElement).closest("[data-v]") as HTMLElement | null;
          if (row) {
            onSave(row.dataset.v!);
            closeFn();
          }
        });
      }
    );
  }

  function cloudSheet() {
    ctx.openSheet(
      `<div class="h2" style="margin-bottom:6px">Cloud assist API</div>
       <div class="sub" style="margin-bottom:12px">Optional: an endpoint that receives a camera frame and returns {"exercise":"squat"}. Tracking keeps working locally without it.</div>
       <input class="input" id="f-url" value="${esc(getCloudEndpoint())}" placeholder="https://api.example.com/recognize">
       <button class="btn primary block" style="margin-top:14px" data-a="save">${t("common.save")}</button>`,
      (sheet, closeFn) => {
        sheet.querySelector('[data-a="save"]')!.addEventListener("click", () => {
          setCloudEndpoint((sheet.querySelector("#f-url") as HTMLInputElement).value.trim());
          closeFn();
          ctx.rerender();
        });
      }
    );
  }

  async function connectHc() {
    const title = root.querySelector("#hc-title");
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
      if (title) title.textContent = t("profile.hc_update");
      ctx.toast(t("profile.hc_update"), "bad");
      void health.openHcStore(); // one tap → Play Store to update Health Connect
      return;
    }
    if (r.reason === "unavailable") {
      if (title) title.textContent = t("profile.hc_unavailable");
      ctx.toast(t("profile.hc_unavailable"), "bad");
      return;
    }
    if (title) title.textContent = r.granted ? t("profile.hc_connected") : t("profile.hc_missing");
    ctx.toast(r.granted ? t("profile.hc_connected") : t("profile.hc_missing"), r.granted ? "good" : "bad");
    if (!r.granted) {
      void health.hcDiag().then((d) => {
        if (!d) return;
        ctx.toast(
          `HC ${d.sdkStr} · ${d.count}/${d.total} · err: ${d.grantError || "none"} · dialog: ${d.canRequest ? "ok" : "missing"}`,
          "info"
        );
      });
    }
  }

  /** Support tool: everything the app did, ready to copy and send. */
  function logsSheet() {
    ctx.openSheet(
      `<div class="h2" style="margin-bottom:6px">Logs</div>
       <div class="sub" style="margin-bottom:10px">Tap Copy, then paste it to support.</div>
       <textarea class="input" id="logbox" readonly style="height:280px;font-family:monospace;font-size:11px">${esc(logText())}</textarea>
       <button class="btn primary block" style="margin-top:12px" data-a="copy">Copy logs</button>
       <button class="btn ghost block" style="margin-top:10px" data-a="close">Close</button>`,
      (sheet, closeFn) => {
        sheet.querySelector('[data-a="close"]')!.addEventListener("click", () => closeFn());
        sheet.querySelector('[data-a="copy"]')!.addEventListener("click", () => {
          const box = sheet.querySelector("#logbox") as HTMLTextAreaElement;
          box.select();
          box.setSelectionRange(0, 999999);
          try {
            void navigator.clipboard?.writeText(box.value);
          } catch {
            /* selection copy still works manually */
          }
          ctx.toast("Copied", "good");
        });
      }
    );
  }

  function clearSheet() {
    ctx.openSheet(
      `<div class="h2">${t("profile.clear_data")}</div>
       <div class="sub" style="margin:8px 0 18px">${t("profile.clear_q")}</div>
       <div class="row" style="gap:10px">
         <button class="btn ghost" data-a="no" style="flex:1">${t("common.cancel")}</button>
         <button class="btn danger" data-a="yes" style="flex:1">${t("common.yes")}</button>
       </div>`,
      (sheet, closeFn) => {
        sheet.querySelector('[data-a="yes"]')!.addEventListener("click", () => {
          ["repcoun:settings", "repcoun:profile", "repcoun:sessions", "repcoun:lbcache"].forEach((k) => localStorage.removeItem(k));
          location.reload();
        });
        sheet.querySelector('[data-a="no"]')!.addEventListener("click", closeFn);
      }
    );
  }

  function refreshHc() {
    const title = root.querySelector("#hc-title");
    const btn = root.querySelector("#hc-btn");
    void health.availability().then((a) => {
      if (btn instanceof HTMLElement) {
        if (a.granted) {
          // Already connected — show the state instead of a dead button.
          btn.textContent = `✓ ${t("home.hc_connected")}`;
          btn.setAttribute("disabled", "true");
          btn.style.opacity = "0.85";
        } else if (a.updateRequired) {
          btn.textContent = t("profile.hc_update_btn");
        }
      }
      if (!title) return;
      title.textContent = !a.native
        ? t("profile.hc_web")
        : a.updateRequired
          ? t("profile.hc_update")
          : !a.available
            ? t("profile.hc_unavailable")
            : a.granted
              ? t("profile.hc_connected")
              : t("home.hc_missing");
    });
  }
  refreshHc();
  // Refresh when the user comes back from Health Connect after a manual grant.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshHc();
  });
}

function row(a: string, icon: string, label: string, value: string): string {
  return `
    <div class="list-row" data-a="${a}">
      <div class="emoji">${icon}</div>
      <div style="flex:1" class="h3">${label}</div>
      <div class="sub" style="font-weight:700">${esc(value)}</div>
      <span style="color:var(--muted)">${icons.next}</span>
    </div>`;
}

function rowDesc(a: string, icon: string, label: string, desc: string, value: string): string {
  return `
    <div class="list-row" data-a="${a}">
      <div class="emoji">${icon}</div>
      <div style="flex:1;min-width:0">
        <div class="h3">${label}</div>
        <div class="tiny">${desc}</div>
      </div>
      <div class="sub" style="font-weight:700">${esc(value)}</div>
      <span style="color:var(--muted)">${icons.next}</span>
    </div>`;
}

function toggleRow(a: string, icon: string, label: string, desc: string, on: boolean): string {
  return `
    <div class="list-row" data-a="${a}">
      <div class="emoji">${icon}</div>
      <div style="flex:1">
        <div class="h3">${label}</div>
        ${desc ? `<div class="tiny">${desc}</div>` : ""}
      </div>
      <div class="switch ${on ? "on" : ""}"></div>
    </div>`;
}

function themeLabel(theme: string): string {
  return theme === "dark" ? t("profile.dark") : theme === "light" ? t("profile.light") : t("profile.system");
}
