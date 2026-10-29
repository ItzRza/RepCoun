/** Rep Ranks (RepCoun league system) + leaderboard (you + your own stats — no fake players). */

import { store } from "./store";

export interface Tier {
  id: string;
  name: string; // i18n key suffix
  gem: string;
  min: number; // reps to enter division I
  color: string;
}

export const TIERS: Tier[] = [
  { id: "rookie", name: "rank_rookie", gem: "🌱", min: 0, color: "#94a3b8" },
  { id: "bronze", name: "rank_bronze", gem: "🥉", min: 1000, color: "#d97706" },
  { id: "silver", name: "rank_silver", gem: "🥈", min: 5000, color: "#94a3b8" },
  { id: "gold", name: "rank_gold", gem: "🥇", min: 15000, color: "#eab308" },
  { id: "platinum", name: "rank_platinum", gem: "🏅", min: 30000, color: "#06b6d4" },
  { id: "diamond", name: "rank_diamond", gem: "💠", min: 60000, color: "#3b82f6" },
  { id: "legendary", name: "rank_legendary", gem: "💎", min: 100000, color: "#8b5cf6" },
];

/** Division size multiplier: division I = 1×, II = 1.8×, III = 3× of tier step. */
const DIV_MULT = [1, 1.8, 3];

export interface Rank {
  tier: Tier;
  division: 1 | 2 | 3;
  label: string; // e.g. "Legendary II"
  progress: number; // 0..1 inside current division
  nextLabel: string | null;
  nextAt: number | null;
}

export function rankOf(totalReps: number): Rank {
  let tierIdx = 0;
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (totalReps >= TIERS[i].min) {
      tierIdx = i;
      break;
    }
  }
  const tier = TIERS[tierIdx];
  const nextTier = TIERS[tierIdx + 1] ?? null;
  const step = tierIdx === 0 ? 1000 : tier.min * 0.5; // reps per division base

  let division: 1 | 2 | 3 = 1;
  let divStart = tier.min;
  let divEnd = tier.min + step * DIV_MULT[0];
  for (let d = 0; d < 3; d++) {
    const start = tier.min + step * DIV_MULT.slice(0, d).reduce((a, b) => a + b, 0);
    const end = tier.min + step * DIV_MULT.slice(0, d + 1).reduce((a, b) => a + b, 0);
    if (totalReps < end || !nextTier) {
      division = (d + 1) as 1 | 2 | 3;
      divStart = start;
      divEnd = end;
      break;
    }
    if (d === 2 && nextTier && totalReps < nextTier.min) {
      division = 3;
      divStart = start;
      divEnd = nextTier.min;
      break;
    }
  }

  const progress = Math.max(0, Math.min(1, (totalReps - divStart) / Math.max(1, divEnd - divStart)));
  const roman = ["I", "II", "III"][division - 1];
  const nextRoman = division < 3 ? ["I", "II", "III"][division] : nextTier ? "I" : null;
  const nextLabel = nextTier
    ? division < 3
      ? `${tier.name.startsWith("rank_") ? tierT(tier.name) : tierT(tier.name)} ${nextRoman}`
      : tierT(nextTier.name)
    : null;

  return {
    tier,
    division,
    label: `${tierT(tier.name)} ${roman}`,
    progress,
    nextLabel,
    nextAt: division < 3 ? divEnd : nextTier?.min ?? null,
  };
}

/** Tier names are i18n keys — resolved lazily via the i18n module to avoid a cycle. */
let resolver: (key: string) => string = (k) => k;
export function setRankNameResolver(fn: (key: string) => string) {
  resolver = fn;
}
function tierT(key: string): string {
  return resolver(key);
}

/* ------------------------------ leaderboard ----------------------------- */

export interface LbEntry {
  name: string;
  reps: number;
  country: string;
  me?: boolean;
}

export function localSeason(myName: string, myReps: number, mode: "global" | "local"): LbEntry[] {
  const me: LbEntry = { name: myName || "You", reps: myReps, country: "⭐", me: true };
  if (mode === "local") {
    // "Local" = your own device history split into your recent weeks vs all-time
    const sessions = store.getSessions();
    const now = Date.now();
    const week = sessions
      .filter((s) => now - s.startedAt < 7 * 864e5)
      .reduce((a, s) => a + s.reps, 0);
    const month = sessions
      .filter((s) => now - s.startedAt < 30 * 864e5)
      .reduce((a, s) => a + s.reps, 0);
    return [
      { name: "This Week", reps: week, country: "📅" },
      { name: "This Month", reps: month, country: "🗓️" },
      { name: "All Time", reps: myReps, country: "⭐", me: true },
    ].sort((a, b) => b.reps - a.reps);
  }
  // Global: ONLY you. Real opponents appear once a leaderboard server is
  // connected (Profile → Advanced) — never show made-up players.
  return [me];
}
