import "@fontsource-variable/inter";
import "./styles/main.css";
import { App } from "./app";
import { installCustoms } from "./data/custom";

installCustoms(); // register user-created exercises before the UI starts

const root = document.getElementById("app")!;
new App(root).start();

// PWA offline mode — browsers only. The Android app ships every file itself,
// and a service worker there could serve stale assets after an update.
const env = (import.meta as unknown as { env?: Record<string, unknown> }).env ?? {};
if (
  env.PROD === true &&
  "serviceWorker" in navigator &&
  location.protocol.startsWith("http") &&
  !(window as unknown as { Capacitor?: unknown }).Capacitor
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
  });
}
