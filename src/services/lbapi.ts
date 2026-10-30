/**
 * "Connect API" — the optional leaderboard server that powers the Global tab
 * and friend groups. Any tiny server that speaks this protocol works:
 *
 *   GET  {base}/standings?group=NAME
 *     -> 200 {"entries":[{"name":"A","reps":123,"country":"🌍"}]}
 *   POST {base}/score?group=NAME   body: {"name":"A","reps":123}
 *     -> 200 {"ok":true}
 *
 * Everyone who points the app at the same server AND the same group name
 * appears on one board — that is a friend group.
 * A ready-to-run server: server/leaderboard-server.mjs
 */

export interface LbApiEntry {
  name: string;
  reps: number;
  country?: string;
}

const K = { url: "repcoun:lbapi", group: "repcoun:lbgroup" };

export function getLbApi(): { url: string; group: string } {
  return {
    url: localStorage.getItem(K.url) ?? "",
    group: localStorage.getItem(K.group) || "friends",
  };
}

export function setLbApi(url: string, group: string) {
  const clean = url.trim().replace(/\/+$/, "");
  if (clean) localStorage.setItem(K.url, clean);
  else localStorage.removeItem(K.url);
  if (group.trim()) localStorage.setItem(K.group, group.trim());
  else localStorage.removeItem(K.group);
}

function timeoutSignal(): AbortSignal | undefined {
  try {
    return AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined;
  } catch {
    return undefined;
  }
}

/** Group standings, best-first. Null when not configured or on any error. */
export async function fetchStandings(): Promise<LbApiEntry[] | null> {
  const { url, group } = getLbApi();
  if (!url) return null;
  try {
    const res = await fetch(`${url}/standings?group=${encodeURIComponent(group)}`, {
      signal: timeoutSignal(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { entries?: LbApiEntry[] };
    return Array.isArray(data.entries) ? data.entries : null;
  } catch {
    return null;
  }
}

/** Send your result to the server (called after saving a workout). */
export async function submitScore(name: string, reps: number): Promise<boolean> {
  const { url, group } = getLbApi();
  if (!url || reps <= 0) return false;
  try {
    const res = await fetch(`${url}/score?group=${encodeURIComponent(group)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, reps }),
      signal: timeoutSignal(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Connectivity test for the settings sheet. */
export async function testLbApi(): Promise<"ok" | "fail" | "no-url"> {
  const { url } = getLbApi();
  if (!url) return "no-url";
  return (await fetchStandings()) ? "ok" : "fail";
}
