/** App shell — routing, navigation, sheets, toasts. */

import { Settings, Profile } from "./types";
import { store } from "./data/store";
import { t, setLang, onLangChange, detectLang } from "./i18n/i18n";
import { icons } from "./ui/icons";
import { h, frag, $, haptic } from "./ui/dom";
import { initExerciseData, onConnectionChange } from "./services/online";
import { setRankNameResolver } from "./data/leaderboard";
import { renderHome } from "./ui/screens/home";
import { renderProgress } from "./ui/screens/progress";
import { renderLeaderboard } from "./ui/screens/leaderboard";
import { renderProfile } from "./ui/screens/profile";
import { renderOnboarding } from "./ui/screens/onboarding";
import { renderLogin } from "./ui/screens/login";
import { cloudReady, currentUser, isGuest } from "./services/cloud";
import { openWorkout } from "./ui/screens/workout";
import "./ui/screens/workout.css";

export type Route = "home" | "progress" | "leaderboard" | "profile";

export interface Ctx {
  settings: Settings;
  profile: Profile;
  saveSettings: (p: Partial<Settings>) => void;
  saveProfile: (p: Partial<Profile>) => void;
  navigate: (r: Route) => void;
  startWorkout: (exerciseId?: string) => void;
  openSheet: (html: string, onMount?: (sheet: HTMLElement, close: () => void) => void) => () => void;
  toast: (msg: string, kind?: "good" | "bad" | "info") => void;
  rerender: () => void;
}

const SCREENS: Record<Route, (root: HTMLElement, ctx: Ctx) => void> = {
  home: renderHome,
  progress: renderProgress,
  leaderboard: renderLeaderboard,
  profile: renderProfile,
};

export class App {
  private route: Route = "home";
  private settings: Settings = store.getSettings();
  private profile: Profile = store.getProfile();
  private root: HTMLElement;
  private cleanup: (() => void)[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async start() {
    setLang(this.settings.lang || detectLang());
    setRankNameResolver((key) => t(key));
    void initExerciseData();

    onLangChange(() => this.render());
    onConnectionChange(() => {
      if (this.route === "home") this.render();
    });

    window.addEventListener("hashchange", () => this.readHash());

    // Login at app start — guest mode keeps everything offline and skips it.
    if (cloudReady() && !isGuest() && !currentUser()) {
      renderLogin(this.root, this.ctx(), () => this.start());
      return;
    }

    if (!this.settings.onboardingDone) {
      renderOnboarding(this.root, this.ctx());
      return;
    }
    this.readHash(true);
    this.render();
  }

  private readHash(first = false) {
    const hash = location.hash.replace("#/", "") as Route;
    this.route = ["home", "progress", "leaderboard", "profile"].includes(hash) ? hash : "home";
    if (!first) this.render();
  }

  ctx(): Ctx {
    return {
      get settings() {
        return store.getSettings();
      },
      get profile() {
        return store.getProfile();
      },
      saveSettings: (p) => {
        store.saveSettings(p);
        this.settings = store.getSettings();
        if (p.theme || p.themeStyle) this.applyTheme();
        if (p.lang) setLang(p.lang);
        this.render();
      },
      saveProfile: (p) => {
        store.saveProfile(p);
        this.profile = store.getProfile();
        this.render();
      },
      navigate: (r) => {
        location.hash = `#/${r}`;
        this.route = r;
        this.render();
        window.scrollTo(0, 0);
      },
      startWorkout: (ex) => openWorkout(this.ctx(), ex),
      openSheet: (html, onMount) => this.openSheet(html, onMount),
      toast: (msg, kind) => this.toast(msg, kind),
      rerender: () => this.render(),
    };
  }

  private applyTheme() {
    const s = store.getSettings();
    const dark =
      s.theme === "dark" ||
      (s.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    document.documentElement.setAttribute("data-style", s.themeStyle === "stylr" ? "stylr" : "violet");

    // Stylr uses the Geist font — load it only when the style is active.
    if (s.themeStyle === "stylr" && !document.getElementById("geist-font")) {
      const link = document.createElement("link");
      link.id = "geist-font";
      link.rel = "stylesheet";
      link.href =
        "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap";
      document.head.appendChild(link);
    }

    // Android status bar follows the style.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      if (s.themeStyle === "stylr") meta.setAttribute("content", dark ? "#000000" : "#f7f7f7");
      else meta.setAttribute("content", "#6d4aff");
    }
  }

  private openSheet(html: string, onMount?: (sheet: HTMLElement, close: () => void) => void): () => void {
    const backdrop = h(`<div class="sheet-backdrop"><div class="sheet"><div class="grabber"></div>${html}</div></div>`);
    document.body.appendChild(backdrop);
    const close = () => {
      backdrop.style.animation = "fade-in 0.18s ease reverse";
      setTimeout(() => backdrop.remove(), 160);
      window.removeEventListener("keydown", onKey);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });
    onMount?.(backdrop.querySelector(".sheet")!, close);
    return close;
  }

  toast(msg: string, kind: "good" | "bad" | "info" = "info") {
    let zone = $("#toast-zone");
    if (!zone) {
      zone = h(`<div id="toast-zone" class="toast-zone" style="top:18%"></div>`);
      this.root.appendChild(zone);
    }
    const el = h(`<div class="toast ${kind}">${msg}</div>`);
    zone.appendChild(el);
    setTimeout(() => {
      el.style.transition = "opacity 0.3s, transform 0.3s";
      el.style.opacity = "0";
      el.style.transform = "translateY(-8px)";
      setTimeout(() => el.remove(), 300);
    }, 1600);
  }

  render() {
    this.cleanup.forEach((fn) => fn());
    this.cleanup = [];
    this.applyTheme();

    if (!store.getSettings().onboardingDone) {
      renderOnboarding(this.root, this.ctx());
      return;
    }

    this.settings = store.getSettings();
    this.profile = store.getProfile();
    const ctx = this.ctx();

    this.root.innerHTML = "";

    // ---- bottom navigation ----
    const items: Array<[Route, string, string]> = [
      ["home", icons.home, "nav.home"],
      ["progress", icons.chart, "nav.progress"],
      ["leaderboard", icons.trophy, "nav.leaderboard"],
      ["profile", icons.user, "nav.profile"],
    ];
    const nav = h(`<nav class="bottom-nav">${items
      .map(
        ([r, ic, key]) =>
          `<button data-route="${r}" class="${this.route === r ? "active" : ""}">${ic}<span>${t(key)}</span></button>`
      )
      .join("")}</nav>`);
    nav.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("button[data-route]") as HTMLButtonElement | null;
      if (btn) {
        haptic(8);
        ctx.navigate(btn.dataset.route as Route);
      }
    });
    this.root.appendChild(nav);

    // ---- screen ----
    const screen = document.createElement("div");
    screen.className = "screen";
    this.root.appendChild(screen);
    SCREENS[this.route](screen, ctx);
  }
}

export { frag };
