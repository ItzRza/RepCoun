/** Progress screen — totals, weekly chart, personal records, history. */

import type { Ctx } from "../../app";
import { t } from "../../i18n/i18n";
import { fmt, fmtDuration, esc } from "../dom";
import { icons } from "../icons";
import { store, lastNDays, totals, personalRecords } from "../../data/store";
import { EXERCISE_MAP, AUTO } from "../../engine/exercises";
import { health } from "../../services/health";

export function renderProgress(root: HTMLElement, ctx: Ctx) {
  const tot = totals();
  const days = lastNDays(7);
  const maxDay = Math.max(1, ...days.map((d) => d.reps));
  const prs = personalRecords();
  const sessions = store.getSessions().slice(0, 30);

  root.innerHTML = `
    <div class="page-head">
      <div class="h1">${t("progress.title")}</div>
      <button class="icon-btn" data-a="clear">${icons.trash}</button>
    </div>

    <div class="stat-grid">
      <div class="stat"><div class="value accent-text">${fmt(tot.reps)}</div><div class="label">${t("progress.total_reps")}</div></div>
      <div class="stat"><div class="value">${fmt(tot.kcal)}</div><div class="label">${t("progress.total_kcal")}</div></div>
      <div class="stat"><div class="value">${tot.workouts}</div><div class="label">${t("progress.workouts")}</div></div>
    </div>
    <div class="stat-grid" style="margin-top:10px">
      <div class="stat"><div class="value">${tot.minutes}</div><div class="label">${t("progress.minutes")}</div></div>
      <div class="stat"><div class="value">${tot.streakDays} 🔥</div><div class="label">${t("progress.streak")}</div></div>
      <div class="stat"><div class="value">${Math.round(tot.workouts ? tot.reps / tot.workouts : 0)}</div><div class="label">avg ${t("home.reps")}</div></div>
    </div>

    <div class="section-title"><div class="h2">${t("progress.weekly")}</div><span class="tiny">${days.reduce((a, d) => a + d.reps, 0)} ${t("home.reps")}</span></div>
    <div class="card">
      <div class="bars">
        ${days
          .map(
            (d) => `
          <div class="bar ${d.reps === maxDay && d.reps > 0 ? "max" : ""}" title="${d.reps}">
            <div class="fill" style="height:${Math.max(4, (d.reps / maxDay) * 100)}%"></div>
            <div class="day">${d.label.slice(0, 2)}</div>
          </div>`
          )
          .join("")}
      </div>
    </div>

    ${
      Object.keys(prs).length
        ? `<div class="section-title"><div class="h2">${t("progress.pr")}</div>${icons.trophy}</div>
      <div class="list">
        ${Object.entries(prs)
          .map(([id, pr]) => {
            const ex = EXERCISE_MAP[id];
            const name = ex ? t(`exercise.${ex.i18n}`) : t("workout.auto");
            return `
            <div class="list-row" style="cursor:default">
              <div class="emoji">${ex?.emoji ?? "⭐"}</div>
              <div style="flex:1">
                <div class="h3">${name}</div>
                <div class="tiny">${new Date(pr.date).toLocaleDateString()}</div>
              </div>
              <div style="text-align:right"><div class="h2 accent-text">${pr.reps}</div><div class="tiny">${t("home.reps")}</div></div>
            </div>`;
          })
          .join("")}
      </div>`
        : ""
    }

    <div id="apps-sync"></div>

    <div class="section-title"><div class="h2">${t("progress.history")}</div></div>
    ${
      sessions.length
        ? `<div class="list">${sessions.map(rowHtml).join("")}</div>`
        : `<div class="card center-col" style="padding:30px 16px">
            <div style="font-size:38px;margin-bottom:8px">🎯</div>
            <div class="sub">${t("progress.no_history")}</div>
            <button class="btn primary" style="margin-top:14px" data-a="start">${icons.camera}${t("home.start")}</button>
          </div>`
    }

    <button class="btn ghost block" style="margin-top:16px" data-a="export">${icons.download}${t("progress.export")}</button>
  `;

  root.addEventListener("click", onClick);
  function onClick(e: Event) {
    const el = (e.target as HTMLElement).closest("[data-a]") as HTMLElement | null;
    if (!el) return;
    if (el.dataset.a === "clear") {
      confirmSheet();
    } else if (el.dataset.a === "export") {
      exportData();
    } else if (el.dataset.a === "start") {
      ctx.startWorkout();
    }
  }

  // ---- workouts synced from OTHER apps via Health Connect ----
  void (async () => {
    const box = root.querySelector("#apps-sync");
    if (!box || !health.isNative()) return;
    const sessions = await health.readSessions(7);
    if (!sessions.length) return;
    box.innerHTML = `
      <div class="section-title">
        <div class="h2">${t("progress.from_apps")}</div>
        <span class="badge blue">${icons.heart}Health Connect</span>
      </div>
      <div class="tiny" style="margin:0 2px 10px">${t("progress.from_apps_sub")}</div>
      <div class="list">
        ${sessions
          .slice(0, 8)
          .map(
            (s) => `
          <div class="list-row" style="cursor:default">
            <div class="emoji">📱</div>
            <div style="flex:1;min-width:0">
              <div class="h3" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.title || s.app)}</div>
              <div class="tiny">${esc(s.app)} · ${new Date(s.startMs).toLocaleDateString()}</div>
            </div>
            <div class="tiny" style="font-weight:700">${fmtDuration(s.durationSec)}</div>
          </div>`
          )
          .join("")}
      </div>`;
  })();

  function confirmSheet() {
    ctx.openSheet(
      `<div class="h2">${t("progress.clear")}</div>
       <div class="sub" style="margin:8px 0 18px">${t("progress.clear_q")}</div>
       <div class="row" style="gap:10px">
         <button class="btn ghost" data-a="no">${t("common.cancel")}</button>
         <button class="btn danger" data-a="yes" style="flex:1">${t("common.yes")}</button>
       </div>`,
      (sheet, close) => {
        sheet.querySelector('[data-a="yes"]')!.addEventListener("click", () => {
          store.clearSessions();
          close();
          ctx.rerender();
        });
        sheet.querySelector('[data-a="no"]')!.addEventListener("click", close);
      }
    );
  }

  function exportData() {
    const data = {
      exportedAt: new Date().toISOString(),
      profile: store.getProfile(),
      settings: store.getSettings(),
      sessions: store.getSessions(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `repcoun-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
}

function rowHtml(s: {
  exercise: string;
  reps: number;
  kcal: number;
  durationSec: number;
  startedAt: number;
  avgHr: number | null;
}): string {
  const ex = EXERCISE_MAP[s.exercise];
  const name = ex ? t(`exercise.${ex.i18n}`) : s.exercise === AUTO ? t("workout.auto") : t("workout.auto");
  return `
    <div class="list-row" style="cursor:default">
      <div class="emoji">${ex?.emoji ?? "⚡"}</div>
      <div style="flex:1">
        <div class="h3">${esc(name)}</div>
        <div class="tiny">${new Date(s.startedAt).toLocaleDateString()} · ${fmtDuration(s.durationSec)}${s.avgHr ? ` · ${s.avgHr} bpm` : ""}</div>
      </div>
      <div style="text-align:right">
        <div class="h3">${s.reps}</div>
        <div class="tiny">${Math.round(s.kcal)} ${t("home.kcal")}</div>
      </div>
    </div>`;
}
