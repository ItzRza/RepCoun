/**
 * Cloud account — optional login that saves your data to your own Firebase
 * account and restores it on any phone. Everything works offline without it.
 */

import { initializeApp, FirebaseApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  linkWithPopup,
  linkWithRedirect,
  GoogleAuthProvider,
  EmailAuthProvider,
  linkWithCredential,
  updatePassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  Auth,
  User,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  Firestore,
} from "firebase/firestore";
import { loadCloudConfig, saveCloudConfig, CloudConfig } from "./firebase-config";
import { log } from "./logger";
import { health } from "./health";
import { Session, Settings } from "../types";

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let user: User | null = null;
const authListeners = new Set<(email: string | null) => void>();

function init() {
  if (app) return;
  const cfg = loadCloudConfig();
  if (!cfg) return;
  try {
    app = initializeApp({ ...cfg }, `repcoun-${Date.now()}`);
    auth = getAuth(app);
    db = getFirestore(app);
    onAuthStateChanged(auth, (u) => {
      user = u;
      authListeners.forEach((fn) => fn(u ? u.email ?? "" : null));
    });
  } catch {
    app = null; // bad config — degrade to offline
    auth = null;
    db = null;
  }
}

/** Save the pasted Firebase config on this phone and connect to it. */
export function configureCloud(cfg: CloudConfig): string | null {
  try {
    saveCloudConfig(cfg);
    app = null;
    auth = null;
    db = null;
    user = null;
    init();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Is a Firebase config available (saved on the phone or baked into the build)? */
export function cloudReady(): boolean {
  return loadCloudConfig() !== null;
}

/** Currently signed-in email, or null. */
export function currentUser(): string | null {
  init();
  return user?.email ?? null;
}

const GUEST_KEY = "repcoun:guest";

/** Guest mode: everything works offline, internet features stay off. */
export function isGuest(): boolean {
  return localStorage.getItem(GUEST_KEY) === "1";
}

export function setGuest(v: boolean) {
  if (v) localStorage.setItem(GUEST_KEY, "1");
  else localStorage.removeItem(GUEST_KEY);
}

/** Watch login state changes. */
export function onAuthChange(fn: (email: string | null) => void): () => void {
  init();
  authListeners.add(fn);
  fn(currentUser());
  return () => authListeners.delete(fn);
}

export async function signUp(email: string, password: string): Promise<string | null> {
  init();
  if (!auth) return "cloud not configured";
  try {
    await createUserWithEmailAndPassword(auth, email, password);
    return null;
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    // Same email already registered with Google → pair the password to it.
    if (code === "auth/email-already-in-use" && user && user.email?.toLowerCase() === email.toLowerCase()) {
      try {
        await linkWithCredential(user, EmailAuthProvider.credential(email, password));
        log.i("auth", "linked password to google account");
        return null;
      } catch (e2) {
        return (e2 as Error).message;
      }
    }
    if (code === "auth/email-already-in-use") {
      return "This email is already used here — sign in with Google first, then you can add a password";
    }
    return (e as Error).message;
  }
}

export async function signIn(email: string, password: string): Promise<string | null> {
  init();
  if (!auth) return "cloud not configured";
  try {
    await signInWithEmailAndPassword(auth, email, password);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/**
 * Sign in with Google.
 * - Android app: the native dialog (web popups are blocked inside WebViews).
 * - Browser / iPhone PWA: a Google popup, falling back to a full-page redirect
 *   (iOS home-screen mode blocks popups — Firebase resumes us after sign-in).
 */
export async function signInWithGoogle(): Promise<string | null> {
  init();
  if (!auth) return "cloud not configured";

  if (health.isNative()) {
    const cfg = loadCloudConfig();
    if (!cfg?.googleWebClientId) return "Google Sign-In is not configured yet";
    const r = await health.googleSignIn(cfg.googleWebClientId);
    if (r.error) return r.error;
    if (!r.idToken) return "Google gave no ID token";
    try {
      await signInWithCredential(auth, GoogleAuthProvider.credential(r.idToken));
      return null;
    } catch (e) {
      return googleAuthError(e);
    }
  }

  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
    return null;
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code.includes("popup")) {
      try {
        await signInWithRedirect(auth, new GoogleAuthProvider());
        return null; // the page is navigating to Google right now
      } catch (e2) {
        return (e2 as Error).message;
      }
    }
    return googleAuthError(e);
  }
}

/** Friendly message for the shared Google sign-in cases. */
function googleAuthError(e: unknown): string {
  const code = (e as { code?: string }).code ?? "";
  if (code === "auth/account-exists-with-different-credential") {
    return "This email already has a password account — sign in with your password, then tap 'Link Google'";
  }
  if (code === "auth/unauthorized-domain") {
    return "Google sign-in isn't allowed on this website yet — add the domain in Firebase → Authentication → Authorized domains";
  }
  return (e as Error).message;
}

/** Is this account able to sign in with email+password? */
export function hasPassword(): boolean {
  init();
  return !!user?.providerData.some((p) => p?.providerId === "password");
}

/** Is this account linked to Google? */
export function hasGoogle(): boolean {
  init();
  return !!user?.providerData.some((p) => p?.providerId === "google.com");
}

/** Add a password to the current account (e.g. created with Google). */
export async function addPassword(pass: string): Promise<string | null> {
  init();
  if (!auth?.currentUser) return "not signed in";
  try {
    await updatePassword(auth.currentUser, pass);
    return null;
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code === "auth/requires-recent-login") return "please sign out and sign in again first";
    return (e as Error).message;
  }
}

/** Link Google to the current (email) account — one account, two ways in. */
export async function linkGoogle(): Promise<string | null> {
  init();
  if (!auth?.currentUser) return "not signed in";

  // Browser / PWA → link straight from a Google popup (redirect fallback on iOS).
  if (!health.isNative()) {
    try {
      await linkWithPopup(auth.currentUser, new GoogleAuthProvider());
      return null;
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      if (code.includes("popup")) {
        try {
          await linkWithRedirect(auth.currentUser, new GoogleAuthProvider());
          return null;
        } catch (e2) {
          return (e2 as Error).message;
        }
      }
      if (code === "auth/credential-already-in-use") {
        return "That Google account has its own login — sign out, then 'Continue with Google'";
      }
      return (e as Error).message;
    }
  }

  const cfg = loadCloudConfig();
  if (!cfg?.googleWebClientId) return "Google Sign-In is not configured yet";
  const r = await health.googleSignIn(cfg.googleWebClientId);
  if (r.error) return r.error;
  if (!r.idToken) return "Google gave no ID token";
  try {
    await linkWithCredential(auth.currentUser, GoogleAuthProvider.credential(r.idToken));
    return null;
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code === "auth/credential-already-in-use") {
      return "That Google account has its own login — sign out, then 'Continue with Google'";
    }
    return (e as Error).message;
  }
}

/** Password reset — Firebase emails a reset link. */
export async function resetPassword(email: string): Promise<string | null> {
  init();
  if (!auth) return "cloud not configured";
  try {
    await sendPasswordResetEmail(auth, email);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export async function logOut(): Promise<void> {
  init();
  if (auth) await signOut(auth);
}

/** Backup one workout to the account. */
export async function saveSession(s: Session): Promise<boolean> {
  init();
  if (!user || !db) return false;
  try {
    await setDoc(doc(db, "users", user.uid, "sessions", s.id), s as unknown as Record<string, unknown>);
    return true;
  } catch {
    return false;
  }
}

/** Backup profile + settings. */
export async function saveUserData(profile: Record<string, unknown>, settings: Settings): Promise<boolean> {
  init();
  if (!user || !db) return false;
  try {
    await setDoc(
      doc(db, "users", user.uid),
      { profile, settings, updatedAt: Date.now() },
      { merge: true }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Pull all workouts from the cloud and merge the missing ones locally.
 * Returns how many were restored.
 */
export async function restoreSessions(
  addSession: (s: Session) => void,
  haveId: (id: string) => boolean
): Promise<number> {
  init();
  if (!user || !db) return -1;
  let added = 0;
  try {
    const snap = await getDocs(collection(db, "users", user.uid, "sessions"));
    snap.forEach((d) => {
      const s = d.data() as unknown as Session;
      if (s?.id && !haveId(s.id)) {
        addSession(s);
        added++;
      }
    });
  } catch {
    return -1;
  }
  return added;
}
