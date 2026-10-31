/** Profile & settings screen. */

import type { Ctx } from "../../app";
import { t, LOCALES } from "../../i18n/i18n";
import { h, esc } from "../dom";
import { icons } from "../icons";
import { store, totals } from "../../data/store";
import { rankOf, setRankNameResolver } from "../../data/leaderboard";
import { health } from "../../services/health";
import { logText } from "../../services/logger";
import { getCustoms, addCustom, deleteCustom, JOINT_LABELS, TrackJoint } from "../../data/custom";
import { runCalibration } from "../calibrate";
import { getCloudEndpoint, setCloudEndpoint } from "../../services/online";
import { getLbApi, setLbApi, testLbApi, downloadProgress } from "../../services/lbapi";
import { cloudReady, currentUser, isGuest, hasGoogle, hasPassword, linkGoogle, addPassword, signIn, signUp, signInWithGoogle, logOut, restoreSessions, saveUserData, configureCloud } from "../../services/cloud";
import { parseFirebaseSnippet } from "../../services/firebase-config";
import type { Session } from "../../types";

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
      ${row("myex", icons.trophy, "My exercises", String(getCustoms().length))}
      ${row("account", icons.info, "Cloud account", currentUser() ? "ON" : isGuest() ? "Guest" : "OFF")}
      ${row("camera", icons.camera_flip, t("profile.camera"), s.cameraFacing === "user" ? t("profile.front") : t("profile.back"))}
      ${canInstall() ? row("install", icons.download, "Install on iPhone", "Share ▸ Add to Home") : ""}
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
      ${rowDesc("lbapi", icons.trophy, t("lb.connect_api"), t("profile.lbapi_desc"), getLbApi().url ? "ON" : "OFF")}
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
      case "theme": return themeSheet();
      case "install": return a2hsSheet();
      case "model": return pickSheet(t("profile.model"), [
          [t("profile.model_full"), "full"], [t("profile.model_lite"), "lite"],
        ], s.model, (v) => {
          ctx.saveSettings({ model: v as "full" | "lite" });
          ctx.toast(t("common.save"), "good");
        }, t("profile.model_desc"));
      case "goal": return numSheet(t("profile.goal"), s.repGoal, t("home.reps"), (v) => ctx.saveSettings({ repGoal: Math.max(10, Math.min(5000, Math.round(v))) }));
      case "myex": return myExSheet();
      case "account": return accountSheet();
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
      case "lbapi": return lbSheet();
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

  /**
   * Theme sheet: design style (Classic violet / Stylr black+orange) plus
   * light-dark-system mode. Stays open so the new look previews live.
   */
  function themeSheet() {
    const render = () => {
      const cur = store.getSettings();
      const row = (lab: string, val: string, kind: string, active: boolean) => `
        <div class="list-row" data-v="${val}" data-k="${kind}">
          <div style="flex:1" class="h3">${lab}</div>
          ${active ? `<span style="color:var(--accent)">${icons.check}</span>` : ""}
        </div>`;
      return `<div class="h2" style="margin-bottom:6px">${t("profile.theme")}</div>
        <div class="tiny" style="margin:12px 2px 6px">${t("profile.style")}</div>
        <div class="list">
          ${row(t("profile.style_classic"), "violet", "style", cur.themeStyle !== "stylr")}
          ${row("Stylr", "stylr", "style", cur.themeStyle === "stylr")}
        </div>
        <div class="tiny" style="margin:14px 2px 6px">${t("profile.mode")}</div>
        <div class="list">
          ${row(t("profile.light"), "light", "mode", cur.theme === "light")}
          ${row(t("profile.dark"), "dark", "mode", cur.theme === "dark")}
          ${row(t("profile.system"), "system", "mode", cur.theme === "system")}
        </div>
        <button class="btn ghost block" style="margin-top:14px" data-a="close">${t("common.close")}</button>`;
    };
    ctx.openSheet(render(), (sheet, closeFn) => {
      const wire = () => {
        sheet.querySelector('[data-a="close"]')!.addEventListener("click", () => closeFn());
        sheet.querySelectorAll("[data-v]").forEach((el) =>
          el.addEventListener("click", () => {
            const row = el as HTMLElement;
            if (row.dataset.k === "style") {
              ctx.saveSettings({ themeStyle: row.dataset.v as "violet" | "stylr" });
            } else {
              ctx.saveSettings({ theme: row.dataset.v as "light" | "dark" | "system" });
            }
            sheet.innerHTML = render(); // refresh the checks, keep the sheet open
            wire();
          })
        );
      };
      wire();
    });
  }

  /** iPhone Safari (not yet on the Home Screen) — how to install RepCoun. */
  function a2hsSheet() {
    ctx.openSheet(
      `<div class="h2" style="margin-bottom:6px">Install RepCoun on iPhone</div>
       <div class="sub" style="margin-bottom:10px">It gets its own icon and opens full-screen like a normal app — no App Store needed:</div>
       <div class="list">
         <div class="list-row">
           <div class="emoji">1️⃣</div>
           <div style="flex:1" class="h3">Tap the Share button in Safari<br><span class="tiny">the square with the arrow going up</span></div>
         </div>
         <div class="list-row">
           <div class="emoji">2️⃣</div>
           <div style="flex:1" class="h3">Scroll down and choose <b>Add to Home Screen</b></div>
         </div>
         <div class="list-row">
           <div class="emoji">3️⃣</div>
           <div style="flex:1" class="h3">Tap <b>Add</b> — the RepCoun icon is now on your Home Screen</div>
         </div>
       </div>
       <button class="btn primary block" style="margin-top:14px" data-a="close">${t("common.close")}</button>`,
      (sheet, closeFn) => {
        sheet.querySelector('[data-a="close"]')!.addEventListener("click", () => closeFn());
      }
    );
  }

  /** Connect API — leaderboard server + friend group setup. */
  function lbSheet() {
    const cur = getLbApi();
    ctx.openSheet(
      `<div class="h2" style="margin-bottom:6px">${t("lb.connect_api")}</div>
       <div class="sub" style="margin-bottom:12px">Connect a leaderboard server. Everyone using the same server and the same group name appears on one board — that is a friend group. A ready-to-run server you can host anywhere: <b>server/leaderboard-server.mjs</b> in the RepCoun GitHub repo.</div>
       <input class="input" id="f-url" value="${esc(cur.url)}" placeholder="https://my-server.com">
       <input class="input" id="f-grp" style="margin-top:10px" value="${esc(cur.group)}" placeholder="group name (e.g. friends)">
       <div class="row" style="margin-top:14px;gap:10px">
         <button class="btn ghost" data-a="test" style="flex:1">Test</button>
         <button class="btn primary" data-a="save" style="flex:1">${t("common.save")}</button>
       </div>
       <button class="btn ghost block" style="margin-top:10px" data-a="restore">Restore my workouts from server</button>
       <div class="tiny" id="lb-test" style="margin-top:10px;text-align:center"></div>`,
      (sheet, closeFn) => {
        const read = () => ({
          url: (sheet.querySelector("#f-url") as HTMLInputElement).value.trim(),
          group: (sheet.querySelector("#f-grp") as HTMLInputElement).value.trim(),
        });
        sheet.querySelector('[data-a="restore"]')!.addEventListener("click", async () => {
          const out = sheet.querySelector("#lb-test") as HTMLElement;
          const { url, group } = read();
          setLbApi(url, group);
          out.textContent = "…";
          const name = store.getProfile().leaderboardName || store.getProfile().name || "You";
          const sessions = await downloadProgress(name);
          if (!sessions) {
            out.textContent = "✗ could not reach the server";
            return;
          }
          const have = new Set(store.getSessions().map((s) => s.id));
          let added = 0;
          for (const raw of sessions) {
            const s = raw as unknown as Session;
            if (s?.id && !have.has(s.id)) {
              store.addSession(s);
              added++;
            }
          }
          out.textContent = `✓ restored ${added} workouts`;
        });
        sheet.querySelector('[data-a="save"]')!.addEventListener("click", () => {
          const { url, group } = read();
          setLbApi(url, group);
          closeFn();
          ctx.rerender();
        });
        sheet.querySelector('[data-a="test"]')!.addEventListener("click", async () => {
          const out = sheet.querySelector("#lb-test") as HTMLElement;
          const { url, group } = read();
          setLbApi(url, group); // test exactly what is typed
          out.textContent = "…";
          const r = await testLbApi();
          out.textContent =
            r === "ok"
              ? `✓ connected · group: ${group || "friends"}`
              : r === "no-url"
                ? "type a server URL first"
                : "✗ could not reach the server";
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

  /** Optional cloud login — backup & restore on any phone (Firebase). */
  function accountSheet() {
    const email = currentUser();
    if (!cloudReady()) {
      ctx.openSheet(
        `<div class="h2" style="margin-bottom:8px">Cloud account</div>
         <div class="sub" style="margin-bottom:10px">In the Firebase console: <b>Project settings (⚙) → Your apps → the Web app (</> icon)</b> → "SDK setup and configuration" → copy the whole <b>const firebaseConfig = {…}</b> snippet and paste it below. It is saved on this phone only — nothing goes into the public repo.</div>
         <textarea class="input" id="cfg-text" style="height:150px;font-family:monospace;font-size:11px" placeholder="const firebaseConfig = { apiKey: ... };"></textarea>
         <input class="input" id="cfg-google" style="margin-top:10px" placeholder="Google Web client ID (apps.googleusercontent.com) — optional">
         <button class="btn primary block" style="margin-top:12px" data-a="cfgsave">Save &amp; connect</button>
         <button class="btn ghost block" style="margin-top:10px" data-a="close">${t("common.close")}</button>
         <div class="tiny" id="acc-msg" style="margin-top:10px;text-align:center"></div>`,
        (sheet, closeFn) => {
          sheet.querySelector('[data-a="close"]')!.addEventListener("click", () => closeFn());
          sheet.querySelector('[data-a="cfgsave"]')!.addEventListener("click", () => {
            const msg = sheet.querySelector("#acc-msg") as HTMLElement;
            const parsed = parseFirebaseSnippet((sheet.querySelector("#cfg-text") as HTMLTextAreaElement).value);
            if (!parsed) {
              msg.textContent = "couldn't read the config — paste the whole snippet";
              return;
            }
            const google = (sheet.querySelector("#cfg-google") as HTMLInputElement).value.trim();
            const err = configureCloud({
              apiKey: parsed.apiKey ?? "",
              authDomain: parsed.authDomain ?? "",
              projectId: parsed.projectId ?? "",
              storageBucket: parsed.storageBucket ?? "",
              messagingSenderId: parsed.messagingSenderId ?? "",
              appId: parsed.appId ?? "",
              googleWebClientId: google,
            });
            if (err) {
              msg.textContent = err;
              return;
            }
            ctx.toast("cloud connected", "good");
            ctx.rerender();
          });
        }
      );
      return;
    }
    if (email) {
      ctx.openSheet(
        `<div class="h2" style="margin-bottom:6px">Cloud account</div>
         <div class="sub" style="margin-bottom:14px">Signed in as <b>${esc(email)}</b></div>
         <button class="btn primary block" data-a="sync">Sync now (backup + restore)</button>
         ${!hasGoogle() ? `<button class="btn soft block" style="margin-top:10px" data-a="linkg">Link Google</button>` : ""}
         ${!hasPassword() ? `<button class="btn soft block" style="margin-top:10px" data-a="addpass">Add a password</button>` : ""}
         <button class="btn ghost block" style="margin-top:10px" data-a="out">Sign out</button>
         <button class="btn ghost block" style="margin-top:10px" data-a="close">${t("common.close")}</button>
         <div class="tiny" id="acc-msg" style="margin-top:10px;text-align:center"></div>`,
        (sheet, closeFn) => {
          sheet.querySelector('[data-a="close"]')!.addEventListener("click", () => closeFn());
          sheet.querySelector('[data-a="linkg"]')?.addEventListener("click", async () => {
            const out = sheet.querySelector("#acc-msg") as HTMLElement;
            out.textContent = "…";
            const err = await linkGoogle();
            out.textContent = err ?? "✓ Google linked";
            if (!err) ctx.rerender();
          });
          sheet.querySelector('[data-a="addpass"]')?.addEventListener("click", async () => {
            const pass = window.prompt("Choose a password (min 6 characters):") ?? "";
            if (pass.length < 6) return;
            const out = sheet.querySelector("#acc-msg") as HTMLElement;
            out.textContent = "…";
            const err = await addPassword(pass);
            out.textContent = err ?? "✓ password added — you can sign in with email too";
            if (!err) ctx.rerender();
          });
          sheet.querySelector('[data-a="sync"]')!.addEventListener("click", async () => {
            const msg = sheet.querySelector("#acc-msg") as HTMLElement;
            msg.textContent = "…";
            void saveUserData(store.getProfile() as unknown as Record<string, unknown>, store.getSettings());
            const added = await restoreSessions(
              (s) => store.addSession(s),
              (id) => store.getSessions().some((x) => x.id === id)
            );
            msg.textContent = added < 0 ? "✗ could not reach the cloud" : `✓ synced — ${added} workouts restored`;
          });
          sheet.querySelector('[data-a="out"]')!.addEventListener("click", () => {
            void logOut();
            ctx.rerender();
          });
        }
      );
      return;
    }
    ctx.openSheet(
      `<div class="h2" style="margin-bottom:8px">Cloud account</div>
       <div class="sub" style="margin-bottom:12px">Sign in to save your workouts to your account and get them back on any phone.</div>
       <input class="input" id="acc-mail" placeholder="email">
       <input class="input" id="acc-pass" type="password" style="margin-top:10px" placeholder="password (min 6 characters)">
       <div class="row" style="margin-top:14px;gap:10px">
         <button class="btn ghost" data-a="in" style="flex:1">Sign in</button>
         <button class="btn primary" data-a="reg" style="flex:1">Create account</button>
       </div>
       <button class="btn ghost block" style="margin-top:10px" data-a="google">Sign in with Google</button>
       <button class="btn ghost block" style="margin-top:10px" data-a="close">${t("common.close")}</button>
       <div class="tiny" id="acc-msg" style="margin-top:10px;text-align:center"></div>`,
      (sheet, closeFn) => {
        sheet.querySelector('[data-a="close"]')!.addEventListener("click", () => closeFn());
        const go = async (register: boolean) => {
          const msg = sheet.querySelector("#acc-msg") as HTMLElement;
          const mail = (sheet.querySelector("#acc-mail") as HTMLInputElement).value.trim();
          const pass = (sheet.querySelector("#acc-pass") as HTMLInputElement).value;
          if (!mail || pass.length < 6) {
            msg.textContent = "enter email and a password of 6+ characters";
            return;
          }
          msg.textContent = "…";
          const err = register ? await signUp(mail, pass) : await signIn(mail, pass);
          if (err) {
            msg.textContent = err;
            return;
          }
          // first sync: push what we have, then pull anything new
          void saveUserData(store.getProfile() as unknown as Record<string, unknown>, store.getSettings());
          const added = await restoreSessions(
            (s) => store.addSession(s),
            (id) => store.getSessions().some((x) => x.id === id)
          );
          ctx.toast(`signed in${added > 0 ? ` — ${added} workouts restored` : ""}`, "good");
          ctx.rerender();
        };
        sheet.querySelector('[data-a="in"]')!.addEventListener("click", () => void go(false));
        sheet.querySelector('[data-a="reg"]')!.addEventListener("click", () => void go(true));
        sheet.querySelector('[data-a="google"]')!.addEventListener("click", async () => {
          const msg = sheet.querySelector("#acc-msg") as HTMLElement;
          msg.textContent = "…";
          const err = await signInWithGoogle();
          if (err) {
            msg.textContent = err;
            return;
          }
          void saveUserData(store.getProfile() as unknown as Record<string, unknown>, store.getSettings());
          const added = await restoreSessions(
            (s) => store.addSession(s),
            (id) => store.getSessions().some((x) => x.id === id)
          );
          ctx.toast(`signed in${added > 0 ? ` — ${added} workouts restored` : ""}`, "good");
          ctx.rerender();
        });
      }
    );
  }

  /** User-created exercises — learned from an 8-second movement recording. */
  function myExSheet() {
    const list = getCustoms();
    ctx.openSheet(
      `<div class="h2" style="margin-bottom:6px">My exercises</div>
       <div class="sub" style="margin-bottom:12px">Create your own exercises: show the movement to the camera for 8 seconds and RepCoun learns to count it. They appear in the exercise list of every workout.</div>
       <div class="list">
         ${list
           .map(
             (c) => `
         <div class="list-row" style="cursor:default">
           <div style="flex:1"><div class="h3">${esc(c.name)}</div><div class="tiny">${JOINT_LABELS.find(([j]) => j === c.joint)?.[1] ?? c.joint}</div></div>
           <button class="btn ghost" data-del="${c.id}" style="padding:8px 12px;min-height:34px">${icons.trash}</button>
         </div>`
           )
           .join("")}
       </div>
       <button class="btn primary block" style="margin-top:14px" data-a="new">+ Create exercise</button>
       <button class="btn ghost block" style="margin-top:10px" data-a="close">${t("common.close")}</button>`,
      (sheet, closeFn) => {
        sheet.querySelector('[data-a="close"]')!.addEventListener("click", () => closeFn());
        sheet.querySelectorAll("[data-del]").forEach((b) =>
          b.addEventListener("click", () => {
            deleteCustom((b as HTMLElement).dataset.del!);
            closeFn();
            myExSheet();
          })
        );
        sheet.querySelector('[data-a="new"]')!.addEventListener("click", () => {
          closeFn();
          createExSheet();
        });
      }
    );
  }

  function createExSheet() {
    let joint: TrackJoint | "auto" = "auto";
    ctx.openSheet(
      `<div class="h2" style="margin-bottom:10px">New exercise</div>
       <input class="input" id="ex-name" placeholder="Exercise name (e.g. Kettlebell Swing)">
       <div class="tiny" style="margin:12px 2px 6px">Which body movement should be counted?</div>
       <div class="seg" style="flex-wrap:wrap">
         <button class="active" data-j="auto" style="flex:1;min-width:96px">Auto detect</button>
         ${JOINT_LABELS.map(
           ([j, label]) =>
             `<button data-j="${j}" style="flex:1;min-width:96px">${label.split(" (")[0]}</button>`
         ).join("")}
       </div>
       <button class="btn primary block" style="margin-top:16px" data-a="rec">● Record movement (8s)</button>
       <button class="btn ghost block" style="margin-top:10px" data-a="close">${t("common.close")}</button>
       <div class="tiny" id="ex-msg" style="margin-top:10px;text-align:center"></div>`,
      (sheet, closeFn) => {
        sheet.querySelector('[data-a="close"]')!.addEventListener("click", () => closeFn());
        sheet.querySelectorAll("[data-j]").forEach((b) =>
          b.addEventListener("click", () => {
            joint = (b as HTMLElement).dataset.j as TrackJoint | "auto";
            sheet.querySelectorAll("[data-j]").forEach((x) => x.classList.remove("active"));
            b.classList.add("active");
          })
        );
        sheet.querySelector('[data-a="rec"]')!.addEventListener("click", async () => {
          const name = (sheet.querySelector("#ex-name") as HTMLInputElement).value.trim();
          const msg = sheet.querySelector("#ex-msg") as HTMLElement;
          if (!name) {
            msg.textContent = "type a name first";
            return;
          }
          msg.textContent = "camera opening — tap Start, then 3 · 2 · 1…";
          const rule = await runCalibration(joint);
          if ("error" in rule) {
            msg.textContent =
              rule.error === "camera"
                ? "camera failed — check camera permission"
                : rule.error === "small-range"
                  ? "movement too small — do bigger, full reps"
                  : rule.error === "no-pose"
                    ? "body not visible — put the phone further away"
                    : `failed: ${rule.error}`;
            return;
          }
          addCustom({
            id: `c${Date.now()}`,
            name,
            joint: rule.joint,
            start: rule.start,
            top: rule.top,
            bottom: rule.bottom,
            minBottomMs: rule.minBottomMs,
            minRepMs: rule.minRepMs,
            createdAt: Date.now(),
          });
          ctx.toast(`"${name}" learned ✓`, "good");
          // Keep this window open — show the result and the next steps inside it.
          sheet.innerHTML = `
            <div class="center-col" style="margin-bottom:14px">
              <div class="logo-mark" style="margin-bottom:10px">✓</div>
              <div class="h2" style="text-align:center">"${esc(name)}" learned!</div>
              <div class="sub" style="text-align:center">Counts the <b>${JOINT_LABELS.find(([j]) => j === rule.joint)?.[1] ?? rule.joint}</b> movement${joint === "auto" ? " (auto-detected)" : ""} — it's now in the exercise list of every workout.</div>
            </div>
            <button class="btn primary block" data-a="done">Done</button>
            <button class="btn ghost block" style="margin-top:10px" data-a="more">Create another</button>`;
          sheet.querySelector('[data-a="done"]')!.addEventListener("click", () => {
            ctx.rerender();
            closeFn();
          });
          sheet.querySelector('[data-a="more"]')!.addEventListener("click", () => {
            closeFn();
            createExSheet();
          });
        });
      }
    );
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

/** Offer "Install on iPhone" only in iPhone Safari (not installed, not the APK). */
function canInstall(): boolean {
  if ((window as unknown as { Capacitor?: unknown }).Capacitor) return false; // running as the Android app
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone || !location.protocol.startsWith("http")) return false;
  const iOS =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Mac/.test(navigator.userAgent) && "ontouchend" in document); // iPad pretends to be a Mac
  return iOS;
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
