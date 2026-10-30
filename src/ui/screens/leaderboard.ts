/** Leaderboard — Rep Rank league with global/local tabs (only real data + API-ready). */

import type { Ctx } from "../../app";
import { t } from "../../i18n/i18n";
import { fmt, esc } from "../dom";
import { icons } from "../icons";
import { store, totals } from "../../data/store";
import { rankOf, localSeason, LbEntry, setRankNameResolver } from "../../data/leaderboard";
import { getLbApi, fetchStandings } from "../../services/lbapi";

export function renderLeaderboard(root: HTMLElement, ctx: Ctx) {
  let tab: "global" | "local" = "global";
  const myName = store.getProfile().leaderboardName || store.getProfile().name || "You";
  const tot = totals();
  const rank = rankOf(tot.reps);
  setRankNameResolver((k) => t(k));
  /** standings from the connected "Connect API" server (friend group), if any */
  let serverList: LbEntry[] | null = null;

  function loadServer() {
    if (!getLbApi().url) return;
    void fetchStandings().then((l) => {
      if (l) {
        serverList = l.map((e) => ({ name: e.name, reps: e.reps, country: e.country ?? "🌍" }));
        draw();
      }
    });
  }

  function draw() {
    const api = getLbApi();
    let entries: LbEntry[];
    if (tab === "global" && api.url && serverList) {
      // Real standings from the connected server (friend group).
      entries = serverList.map((e) => ({ ...e, me: e.name === myName }));
      if (!entries.some((e) => e.me)) entries.push({ name: myName, reps: tot.reps, country: "⭐", me: true });
      entries.sort((a, b) => b.reps - a.reps);
    } else {
      entries = localSeason(myName, tot.reps, tab);
    }
    const myPos = entries.findIndex((e) => e.me) + 1;

    root.innerHTML = `
      <div class="page-head">
        <div class="h1">${t("lb.title")}</div>
        <span class="badge violet">${t("lb.season")}</span>
      </div>

      <div class="card rank-hero">
        <div class="rank-gem">${rank.tier.gem}</div>
        <div class="h1" style="color:${rank.tier.color}">${rank.label.toUpperCase()}</div>
        <div class="sub" style="margin-top:2px"><b style="color:var(--text)">${fmt(tot.reps)}</b> ${t("home.reps")}</div>
        <div style="height:8px;background:var(--card-2);border-radius:99px;margin:14px 0 6px;overflow:hidden">
          <div style="height:100%;width:${Math.round(rank.progress * 100)}%;background:var(--grad);border-radius:99px;transition:width .5s"></div>
        </div>
        <div class="tiny">${rank.nextLabel ? t("home.next_rank", { rank: rank.nextLabel }) : "MAX RANK 🏆"}</div>
        ${tab === "global" && entries.length > 1 && myPos ? `<div class="badge violet" style="margin-top:12px">${icons.crown}#${myPos} ${t("lb.global")}</div>` : ""}
      </div>

      <div class="seg" style="margin-top:16px">
        <button class="${tab === "global" ? "active" : ""}" data-tab="global">${icons.globe} ${t("lb.global")}</button>
        <button class="${tab === "local" ? "active" : ""}" data-tab="local">${icons.chart} ${t("lb.local")}</button>
      </div>

      ${tab === "global"
        ? `<div class="tiny" style="margin:12px 2px 10px">${
            api.url
              ? serverList
                ? `server: ${esc(api.url)} · group: ${esc(api.group)}`
                : t("common.loading")
              : t("lb.global_empty")
          }</div>`
        : ""}

      <div class="list" id="lb-list">
        ${entries
          .map((e, i) => entryHtml(e, i))
          .join("")}
      </div>
    `;
  }

  function entryHtml(e: LbEntry, i: number): string {
    const color = colorFor(e.name);
    const initials = e.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    return `
      <div class="lb-row ${e.me ? "me" : ""}">
        <div class="pos">${i + 1}</div>
        <div class="avatar" style="background:${color}">${e.me ? "⭐" : initials}</div>
        <div style="flex:1;min-width:0">
          <div class="h3" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(e.name)}${e.me ? ` <span class="badge violet" style="font-size:9px;padding:2px 7px">YOU</span>` : ""}</div>
          <div class="tiny">${e.country}</div>
        </div>
        <div style="text-align:right">
          <div class="h3">${fmt(e.reps)}</div>
          <div class="tiny">${t("home.reps")}</div>
        </div>
      </div>`;
  }

  root.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[data-tab]") as HTMLElement | null;
    if (btn) {
      tab = btn.dataset.tab as "global" | "local";
      draw();
      if (tab === "global") loadServer();
    }
  });

  draw();
  loadServer();
}

function colorFor(name: string): string {
  const palette = ["#7c5cff", "#f59e0b", "#22c55e", "#3b82f6", "#ef4444", "#06b6d4", "#ec4899"];
  let sum = 0;
  for (const c of name) sum += c.charCodeAt(0);
  return palette[sum % palette.length];
}
