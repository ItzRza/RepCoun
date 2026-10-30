/**
 * Example "Cloud assist" server for RepCoun — zero dependencies.
 *
 * Start it:   node server/cloud-assist-example.mjs 8788
 * In the app : Profile → Cloud assist API → http://YOUR-IP:8788
 *
 * What RepCoun sends (POST, JSON):
 *   { "image": "data:image/jpeg;base64,...." }   (one camera frame every ~6s)
 *
 * What it must answer (JSON):
 *   { "exercise": "squat" }   → the app trusts your answer and switches to it
 *   { }                       → "no idea", the app keeps its own detection
 *
 * Valid exercise ids:
 *   pushup squat situp pullup jumpingjack lunge plank bicepcurl
 *   shoulderpress burpee mountainclimber glutebridge
 *
 * This example just answers "squat" for every frame so you can verify the
 * connection. Replace guessExercise() with your own AI (e.g. a small
 * image-classification model) to make it real.
 */

import http from "node:http";

const PORT = Number(process.argv[2] || process.env.PORT || 8788);

function guessExercise(_imageDataUrl) {
  // ← put your AI here. For now, pretend everything is a squat.
  return "squat";
}

http
  .createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    if (req.method === "OPTIONS") return res.end();

    if (req.method === "POST") {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        try {
          const { image } = JSON.parse(body || "{}");
          const id = guessExercise(image);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(id ? { exercise: id } : {}));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "bad payload" }));
        }
      });
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "repcoun-cloud-assist" }));
  })
  .listen(PORT, () => console.log(`Cloud assist example on port ${PORT}`));
