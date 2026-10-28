/**
 * Tiny i18n — English is the master language, others fall back to English
 * for any missing key. Supports RTL (Arabic).
 */

import en from "../locales/en.json";
import tr from "../locales/tr.json";
import es from "../locales/es.json";
import de from "../locales/de.json";
import fr from "../locales/fr.json";
import pt from "../locales/pt.json";
import ar from "../locales/ar.json";

export const LOCALES = [
  { code: "en", label: "English", native: "English", dir: "ltr" },
  { code: "tr", label: "Turkish", native: "Türkçe", dir: "ltr" },
  { code: "es", label: "Spanish", native: "Español", dir: "ltr" },
  { code: "de", label: "German", native: "Deutsch", dir: "ltr" },
  { code: "fr", label: "French", native: "Français", dir: "ltr" },
  { code: "pt", label: "Portuguese", native: "Português", dir: "ltr" },
  { code: "ar", label: "Arabic", native: "العربية", dir: "rtl" },
] as const;

export type LangCode = (typeof LOCALES)[number]["code"];

const BUNDLES: Record<string, Record<string, string>> = { en, tr, es, de, fr, pt, ar };

let current: string = "en";
const listeners = new Set<() => void>();

export function setLang(code: string) {
  current = BUNDLES[code] ? code : "en";
  const loc = LOCALES.find((l) => l.code === current);
  document.documentElement.setAttribute("lang", current);
  document.documentElement.setAttribute("dir", loc?.dir ?? "ltr");
  listeners.forEach((l) => l());
}

export function getLang(): string {
  return current;
}

export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function detectLang(): string {
  const nav = (navigator.language || "en").slice(0, 2);
  return BUNDLES[nav] ? nav : "en";
}

/** Translate: t("home.greeting", {name: "Ali"}) */
export function t(key: string, vars?: Record<string, string | number>): string {
  const bundle = BUNDLES[current] ?? en;
  const enDict = en as Record<string, string>;
  let s = bundle[key] ?? enDict[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return s;
}
