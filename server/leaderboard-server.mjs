/**
 * RepCoun leaderboard server — ready to run, zero dependencies.
 *
 * Start it:   node server/leaderboard-server.mjs 8787
 * It listens on http://0.0.0.0:8787 and saves scores to scores.json.
 *
 * In the RepCoun app: Profile → Connect API →
 *   server URL : http://YOUR-IP:8787   (or your hosted https:// address)
 *   group name : friends               (same name = same friend board)
 *
 * Protocol (the app speaks exactly this):
 *   GET  /standings?group=NAME        -> {"entries":[{"name","reps","country"}]}
 *   POST /score?group=NAME  {"name","reps"} -> {"ok":true}
 *
 * Free hosting: this single file runs on Render / Railway / Fly.io / any
 * Node host — point the app at the https address it gives you.
 */

import http from "node:http";
import fs from "node:fs";

const PORT = Number(process.argv[2] || process.env.PORT || 8787);
const FILE = new URL("./scores.json", import.meta.url);

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

function save(db) {
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

function json(res, obj, code = 200) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(obj));
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const group = (url.searchParams.get("group") || "friends").slice(0, 32);

    if (req.method === "OPTIONS") return json(res, {});

    const db = load();
    const board = Array.isArray(db[group]) ? db[group] : [];

    // Standings: everyone in the group, best first.
    if (req.method === "GET" && url.pathname === "/standings") {
      const entries = [...board]
        .sort((a, b) => b.reps - a.reps)
        .map((e) => ({ name: e.name, reps: e.reps, country: e.country || "🌍" }));
      return json(res, { entries });
    }

    // Submit a result. Keeps the person's best total reps.
    if (req.method === "POST" && url.pathname === "/score") {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        try {
          const { name, reps } = JSON.parse(body || "{}");
          const n = Number(reps);
          if (!name || !isFinite(n) || n < 0) return json(res, { ok: false, error: "bad payload" }, 400);
          const row = board.find((e) => e.name === name);
          if (row) row.reps = Math.max(row.reps, n);
          else board.push({ name: String(name).slice(0, 24), reps: n });
          db[group] = board;
          save(db);
          json(res, { ok: true });
        } catch {
          json(res, { ok: false }, 400);
        }
      });
      return;
    }

    // Health check.
    if (req.method === "GET" && url.pathname === "/") {
      return json(res, { status: "repcoun-leaderboard", groups: Object.keys(db) });
    }

    json(res, { error: "not found" }, 404);
  })
  .listen(PORT, () => {
    console.log(`RepCoun leaderboard server running on port ${PORT}`);
  });
