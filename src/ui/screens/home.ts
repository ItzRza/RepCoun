/** Home screen — start workout, daily goal, weekly activity, rank. */

import type { Ctx } from "../../app";
import { t } from "../../i18n/i18n";
import { h, $, fmt, esc } from "../dom";
import { icons } from "../icons";
import { EXERCISES } from "../../engine/exercises";
import { AUTO } from "../../engine/exercises";
import { store, lastNDays, totals, todayReps } from "../../data/store";
import { rankOf, setRankNameResolver } from "../../data/leaderboard";
import { isOnline, onConnectionChange, packStatus } from "../../services/online";
import { health } from "../../services/health";

export function renderHome(root: HTMLElement, ctx: Ctx) {
  const profile = ctx.profile;
  const s = store.getSettings();
  const days = lastNDays(7);
  const tot = totals();
  const today = todayReps();
  const goal = Math.max(10, s.repGoal);
  const goalPct = Math.min(100, Math.round((today / goal) * 100));
  const rank = rankOf(tot.reps);
  setRankNameResolver((k) => t(k));
  const maxDay = Math.max(1, ...days.map((d) => d.reps));

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="h1">${profile.name ? t("home.greeting", { name: esc(profile.name) }) : t("home.greeting_anon")}</div>
        <div class="row tight" style="margin-top:6px">
          <span class="badge ${isOnline() ? "green" : "amber"}">
            <span class="dot"></span>${isOnline() ? t("home.online") : t("home.offline")}
          </span>
          <span class="tiny">${isOnline() ? t("home.online_sub") : t("home.offline_sub")}</span>
        </div>
      </div>
      <button class="icon-btn" data-a="settings">${icons.settings}</button>
    </div>

    <div class="card hero">
      <div class="h-display" style="font-size:26px;margin-bottom:2px">${t("app.tagline")}</div>
      <div class="sub" style="margin-bottom:16px">${t("home.start_sub")}</div>
      <button class="btn lg" data-a="start" style="background:#fff;color:#4c2fd6;width:100%">
        ${icons.camera}${t("home.start")}
      </button>
    </div>

    <div class="section-title"><div class="h2">${t("home.today")}</div><div class="tiny">${goalPct}% · ${t("home.goal")} ${goal}</div></div>
    <div class="card">
      <div class="row" style="gap:16px">
        ${ringSvg(goalPct)}
        <div style="flex:1">
          <div class="row between"><span class="sub">${t("home.reps")}</span><b>${today}</b></div>
          <div class="divider" style="margin:8px 0"></div>
          <div class="row between"><span class="sub">${t("home.streak")}</span><b>${tot.streakDays} 🔥</b></div>
          <div class="divider" style="margin:8px 0"></div>
          <div class="row between"><span class="sub">${t("home.kcal")}</span><b>${Math.round(days[6]?.kcal ?? 0)}</b></div>
        </div>
      </div>
    </div>

    <div class="section-title"><div class="h2">${t("home.weekly")}</div></div>
    <div class="card">
      <div class="bars">
        ${days
          .map(
            (d, i) => `
          <div class="bar ${d.reps === maxDay && d.reps > 0 ? "max" : ""}">
            <div class="fill" style="height:${Math.max(4, (d.reps / maxDay) * 100)}%"></div>
            <div class="day">${d.label.slice(0, 2)}</div>
          </div>`
          )
          .join("")}
      </div>
    </div>

    <div class="section-title"><div class="h2">${t("home.rank")}</div><span class="tiny" data-a="lb" style="cursor:pointer">${t("lb.title")} ›</span></div>
    <div class="card" data-a="lb" style="cursor:pointer">
      <div class="row" style="gap:14px">
        <div class="rank-gem" style="width:60px;height:60px;font-size:28px;border-radius:18px;margin:0">${rank.tier.gem}</div>
        <div style="flex:1">
          <div class="h2" style="color:${rank.tier.color}">${rank.label.toUpperCase()}</div>
          <div class="sub">${fmt(tot.reps)} ${t("home.reps")}</div>
          <div style="height:7px;background:var(--card-2);border-radius:99px;margin-top:8px;overflow:hidden">
            <div style="height:100%;width:${Math.round(rank.progress * 100)}%;background:var(--grad);border-radius:99px"></div>
          </div>
          ${rank.nextLabel ? `<div class="tiny" style="margin-top:5px">${t("home.next_rank", { rank: rank.nextLabel })}</div>` : ""}
        </div>
      </div>
    </div>

    <div class="section-title">
      <div class="h2">${t("home.quick")}</div>
      <span class="tiny" data-a="all" style="cursor:pointer">${t("home.all_exercises")}</span>
    </div>
    <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
      ${EXERCISES.slice(0, 6)
        .map(
          (e) => `
        <button class="stat" data-ex="${e.id}" style="cursor:pointer;padding:14px 6px">
          <div style="font-size:24px;margin-bottom:4px">${e.emoji}</div>
          <div style="font-size:12px;font-weight:700">${t(`exercise.${e.i18n}`)}</div>
        </button>`
        )
        .join("")}
    </div>

    <div class="card" style="margin-top:18px" id="hc-card">
      <div class="row">
        <div class="emoji" style="width:42px;height:42px;border-radius:13px;background:var(--red-soft);display:grid;place-items:center;color:var(--red)">${icons.heart}</div>
        <div style="flex:1">
          <div class="h3">${t("home.hc")}</div>
          <div class="tiny" id="hc-status">${t("common.loading")}</div>
        </div>
        <span class="badge violet" data-a="hc" style="cursor:pointer">${t("home.grant")}</span>
      </div>
    </div>
  `;

  root.addEventListener("click", onClick);
  function onClick(e: Event) {
    const el = (e.target as HTMLElement).closest("[data-a],[data-ex]") as HTMLElement | null;
    if (!el) return;
    if (el.dataset.ex) {
      ctx.startWorkout(el.dataset.ex);
    } else if (el.dataset.a === "start") {
      if (!store.getSettings().autoDetect) ctx.startWorkout(AUTO);
      else ctx.startWorkout(AUTO);
    } else if (el.dataset.a === "settings") {
      ctx.navigate("profile");
    } else if (el.dataset.a === "lb") {
      ctx.navigate("leaderboard");
    } else if (el.dataset.a === "all") {
      allExercisesSheet();
    } else if (el.dataset.a === "hc") {
      void connectHc();
    }
  }

  function allExercisesSheet() {
    ctx.openSheet(
      `<div class="h2" style="margin-bottom:12px">${t("home.all_exercises")}</div>
       <div class="list">${EXERCISES.map(
         (e) => `
         <div class="list-row" data-ex="${e.id}">
           <div class="emoji">${e.emoji}</div>
           <div style="flex:1"><div class="h3">${t(`exercise.${e.i18n}`)}</div><div class="tiny">${e.met} MET</div></div>
           ${icons.next}
         </div>`
       ).join("")}</div>`,
      (sheet, close) => {
        sheet.addEventListener("click", (ev) => {
          const row = (ev.target as HTMLElement).closest("[data-ex]") as HTMLElement | null;
          if (row) {
            close();
            ctx.startWorkout(row.dataset.ex);
          }
        });
      }
    );
  }

  async function connectHc() {
    const status = $("#hc-status", root)!;
    if (!health.isNative()) {
      ctx.toast(t("profile.hc_web"), "info");
      return;
    }
    const r = await health.requestPermissions();
    if (r.reason === "update") {
      status.textContent = t("profile.hc_update");
      ctx.toast(t("profile.hc_update"), "bad");
      void health.openHcStore(); // one tap → Play Store to update Health Connect
      return;
    }
    if (r.reason === "unavailable") {
      status.textContent = t("profile.hc_unavailable");
      ctx.toast(t("profile.hc_unavailable"), "bad");
      return;
    }
    status.textContent = r.granted ? t("home.hc_connected") : t("profile.hc_missing");
    ctx.toast(r.granted ? t("home.hc_connected") : t("profile.hc_missing"), r.granted ? "good" : "bad");
  }

  void health.availability().then((a) => {
    const status = $("#hc-status", root);
    if (!status) return;
    status.textContent = !a.native
      ? t("profile.hc_web")
      : a.updateRequired
        ? t("profile.hc_update")
        : !a.available
          ? t("profile.hc_unavailable")
          : a.granted
            ? t("profile.hc_connected")
            : t("profile.hc_missing");
  });

  onConnectionChange(() => ctx.rerender());
}

function ringSvg(pct: number): string {
  const R = 44, C = 2 * Math.PI * R;
  const off = C - (pct / 100) * C;
  return `
    <div class="ring-wrap">
      <svg viewBox="0 0 108 108" style="width:100%;height:100%;transform:rotate(-90deg)">
        <circle cx="54" cy="54" r="${R}" fill="none" stroke="var(--card-2)" stroke-width="10"/>
        <circle cx="54" cy="54" r="${R}" fill="none" stroke="url(#g1)" stroke-width="10" stroke-linecap="round"
          stroke-dasharray="${C}" stroke-dashoffset="${off}" style="transition:stroke-dashoffset .6s"/>
        <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#b794f6"/>
        </linearGradient></defs>
      </svg>
      <div class="center"><div><div class="h2">${pct}%</div><div class="tiny">${t("home.goal")}</div></div></div>
    </div>`;
}
