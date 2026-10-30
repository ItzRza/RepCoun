/**
 * Firebase configuration — stored ON THE PHONE, never in the repository.
 *
 * Setup happens inside the app: Profile → Cloud account → paste the
 * firebaseConfig snippet from the Firebase console. The app saves it locally
 * and connects. (Build-time env secrets also work as a fallback for CI.)
 *
 * Where to find the snippet in the Firebase console:
 *   Project settings (⚙) → "Your apps" → the WEB app (</> icon) →
 *   "SDK setup and configuration" → const firebaseConfig = { ... };
 */

export interface CloudConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  /** optional — enables "Sign in with Google" */
  googleWebClientId: string;
}

const KEY = "repcoun:cloudcfg";
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export function loadCloudConfig(): CloudConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const cfg = JSON.parse(raw) as CloudConfig;
      if (cfg.apiKey && cfg.projectId) return cfg;
    }
  } catch {
    /* ignore */
  }
  // Fallback: values baked in at build time (CI secrets).
  if (env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID) {
    return {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
      appId: env.VITE_FIREBASE_APP_ID ?? "",
      googleWebClientId: env.VITE_GOOGLE_WEB_CLIENT_ID ?? "",
    };
  }
  return null;
}

export function saveCloudConfig(cfg: CloudConfig) {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}

/** Parse the JS snippet the Firebase console gives you. */
export function parseFirebaseSnippet(text: string): Partial<CloudConfig> | null {
  const pick = (k: string) => (text.match(new RegExp(`${k}\\s*:\\s*["']([^"']+)["']`)) ?? [])[1];
  const out: Partial<CloudConfig> = {
    apiKey: pick("apiKey"),
    authDomain: pick("authDomain"),
    projectId: pick("projectId"),
    storageBucket: pick("storageBucket"),
    messagingSenderId: pick("messagingSenderId"),
    appId: pick("appId"),
  };
  return out.apiKey && out.projectId ? out : null;
}
