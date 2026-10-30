/**
 * In-app log — records everything the app does (native calls, camera, model,
 * errors) so one "Copy logs" tap captures the whole story for debugging.
 * Survives app restarts via localStorage.
 */

const MAX = 500;
let lines: string[] = [];

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

function push(level: string, tag: string, msg: string) {
  lines.push(`${stamp()} ${level}/${tag}: ${msg}`);
  if (lines.length > MAX) lines = lines.slice(-MAX);
  try {
    localStorage.setItem("repcoun:log", lines.join("\n"));
  } catch {
    /* storage full — keep in memory only */
  }
}

export const log = {
  i(tag: string, msg: string) {
    push("I", tag, msg);
  },
  w(tag: string, msg: string) {
    push("W", tag, msg);
  },
  e(tag: string, msg: string) {
    push("E", tag, msg);
  },
};

export function errText(e: unknown): string {
  if (e == null) return "unknown";
  if (typeof e === "string") return e;
  const o = e as { name?: string; message?: string; stack?: string };
  const head = `${o.name ?? "Error"}${o.message ? `: ${o.message}` : ""}`;
  const stack = (o.stack ?? "").split("\n")[1]?.trim();
  return stack ? `${head} @ ${stack}` : head;
}

/** Full log text for the copy button / support. */
export function logText(): string {
  return lines.join("\n");
}

/** Boot-time logging: restores the previous session's log and hooks global errors. */
export function installLog(): void {
  try {
    const saved = localStorage.getItem("repcoun:log");
    if (saved) lines = saved.split("\n").slice(-MAX);
  } catch {
    /* ignore */
  }
  window.addEventListener("error", (e) =>
    push("E", "window", `${e.message} @ ${(e.filename ?? "").split(/[\\/]/).pop()}:${e.lineno}`)
  );
  window.addEventListener("unhandledrejection", (e) => push("E", "promise", errText(e.reason)));
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  log.i("app", `start platform=${cap?.getPlatform?.() ?? "?"} href=${location.href}`);
}
