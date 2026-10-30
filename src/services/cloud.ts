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
  GoogleAuthProvider,
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
 * Sign in with Google. The native dialog (web popups are blocked in WebViews)
 * returns an ID token which Firebase trades for a session.
 */
export async function signInWithGoogle(): Promise<string | null> {
  init();
  if (!auth) return "cloud not configured";
  const cfg = loadCloudConfig();
  if (!cfg?.googleWebClientId) return "Google Sign-In is not configured yet";
  const r = await health.googleSignIn(cfg.googleWebClientId);
  if (r.error) return r.error;
  if (!r.idToken) return "Google gave no ID token";
  try {
    await signInWithCredential(auth, GoogleAuthProvider.credential(r.idToken));
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
