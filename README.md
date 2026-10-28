# RepCoun 🏋️ — Effortlessly Track Reps

**RepCoun** is an AI rep counter for Android. Point your phone camera at your workout and it
**automatically detects the exercise**, counts every rep, rejects bad (half / too-fast) reps,
estimates calories — and syncs everything to **Health Connect** so your watch data counts too.

> Works **fully offline**: the AI pose model and the movement database are bundled inside the app.
> With internet it can additionally sync exercise-data updates and (optionally) use a cloud endpoint.

---

## ✨ Features

| Feature | Details |
| --- | --- |
| 📷 **Auto exercise detection** | Recognizes 12 exercises from the camera: Push-up, Squat, Sit-up, Pull-up, Jumping Jack, Lunge, Plank, Bicep Curl, Shoulder Press, Burpee, Mountain Climber, Glute Bridge |
| 🦴 **Live skeleton tracking** | On-device MediaPipe pose tracking (WASM) with a green skeleton overlay |
| ✅ **Rejects bad reps** | Half reps and lightning-fast reps are counted separately and rejected |
| 🔥 **Calorie counting** | MET-based burn + heart-rate refinement (Keytel formula) when your watch provides HR |
| 📴 **Offline first** | AI model + movement data live inside the APK. No internet needed, ever |
| ☁️ **Online mode** | Syncs an "exercise pack" (thresholds/MET updates) from GitHub; optional cloud-recognition API |
| 🏆 **Rep Ranks** | Rookie → Bronze → Silver → Gold → Platinum → Diamond → Legendary with divisions (I/II/III) |
| ❤️ **Health Connect** | Writes workouts + calories to Health Connect; reads heart rate from any synced watch |
| 🌍 **7 languages** | English, Türkçe, Español, Deutsch, Français, Português, العربية (RTL) |
| 🌗 **Light & dark** | Modern, clean design with violet gradient accents |

## 📱 Getting the APK (no Android Studio needed)

The APK is built **in the cloud** by GitHub Actions — your PC only needs Node.js.

1. Create a free GitHub account (if you don't have one) at <https://github.com>.
2. Create a **new public repository** named `RepCoun` (public = unlimited free builds).
3. On your PC, open a terminal in this folder and run:

   ```powershell
   git init
   git add .
   git commit -m "RepCoun v1"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/RepCoun.git
   git push -u origin main
   ```

4. Open your repository on GitHub → **Actions** tab → wait ~8–12 minutes for **Build APK**.
5. When it turns green: click the run → **Artifacts** → download **RepCoun-APK** → unzip →
   copy `app-debug.apk` to your phone → install (allow "Install unknown apps").

> Every push to `main` rebuilds the APK automatically. Same steps, same artifact.

## ⌚ Watch & app integration

- **Galaxy Watch 8** — Samsung Health syncs heart rate & steps into Health Connect. RepCoun reads
  your live heart rate during workouts → more accurate calories.
- **Redmi Watch 4** — enable Health Connect inside Mi Fitness (Profile → Settings → Health Connect).
  If Mi Fitness on your region doesn't sync, RepCoun simply falls back to MET-based calories.
- **Home-workout apps** — Android allows only **one app to use the camera at a time**, so run
  RepCoun as your tracker (it does the counting) instead of side-by-side with another camera app.

## 🧠 How "offline vs online" works

| Mode | What happens |
| --- | --- |
| **Offline** | Bundled pose model (`pose_landmarker_*.task`) + bundled movement data (`exercise-pack.json`) →100% tracking, calories, history, local leaderboard |
| **Online** | Same local tracking + syncs the latest `exercise-pack.json` from GitHub, and optionally sends a frame to *your* cloud endpoint (Profile → Cloud assist API) for recognition assist |

The camera feed is **never uploaded** unless you configure your own cloud endpoint.

## 🛠️ Local development (optional, light)

```powershell
npm install
npm run dev        # open http://localhost:5173 on your PC
npm run build      # production build into dist/
npx cap sync android   # copy web build into the Android project
```

## 📂 Project structure

```
src/
  engine/      pose.ts (MediaPipe), exercises.ts (movement database + auto-detect),
               repCounter.ts (hysteresis + bad-rep rejection), calories.ts, geometry.ts
  services/    health.ts (Health Connect bridge), online.ts (pack sync, cloud assist)
  data/        store.ts (settings/history), leaderboard.ts (Rep Ranks + demo season)
  ui/screens/  home, workout (camera), progress, leaderboard, profile, onboarding
  locales/     en, tr, es, de, fr, pt, ar
android/       Capacitor project + RepCounPlugin.kt (Health Connect & camera)
.github/       build-apk.yml (cloud APK build)
```

## 🔮 Roadmap

- Real global leaderboard backend (Supabase/Firebase endpoint)
- More exercises (dips, calf raises, burpee variants) and form-score coaching
- Widgets + notification quick-start
- Release-signed APK via GitHub Secrets for Play Store

---

MIT © RepCoun
