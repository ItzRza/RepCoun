# RepCoun server helpers

Two optional servers make the extra features work. Both are **single files with
zero dependencies** — all they need is Node.js (`node server/...`).

---

## 1. Leaderboard server (global ranking + friend groups)

File: `leaderboard-server.mjs`

**One person (you or a friend) hosts it once:**

```
node server/leaderboard-server.mjs 8787
```

**Everyone connects in the app** (Profile → Connect API → paste):

- Server URL: `http://HOST-IP:8787` — or the `https://` address if hosted
- Group name: `friends` (same group name = same board)

That's it — every workout you save is sent to the board and the **Global tab
in Leaderboard shows the group standings**.

**Hosting it always-on (free):** this file runs on Render, Railway, Fly.io or
any Node host. Start command: `node server/leaderboard-server.mjs`, and use the
https address they give you as the Server URL.

**API protocol** (in case you want to write your own):

```
GET  /standings?group=NAME
     → 200 {"entries":[{"name":"A","reps":123,"country":"🌍"}]}
POST /score?group=NAME      body: {"name":"A","reps":123}
     → 200 {"ok":true}
```

---

## 2. Cloud assist (optional extra AI for exercise recognition)

File: `cloud-assist-example.mjs`

RepCoun detects exercises offline by itself. Cloud assist is for people who
want a **server-side AI to help** — every ~6 seconds the app sends one camera
frame and trusts the answer.

```
node server/cloud-assist-example.mjs 8788
```

In the app: Profile → Cloud assist API → `http://HOST-IP:8788`

**API contract:**

```
POST /                      body: {"image":"data:image/jpeg;base64,...."}
     → 200 {"exercise":"squat"}    (answer you believe in)
     → 200 {}                      (no idea — app keeps its own detection)
```

Valid ids: `pushup squat situp pullup jumpingjack lunge plank bicepcurl
shoulderpress burpee mountainclimber glutebridge`

The example answers "squat" for every frame so you can test the connection —
replace `guessExercise()` with your own model to make it useful.
