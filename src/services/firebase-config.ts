/**
 * Firebase configuration — values come from environment variables so NO keys
 * are ever committed to this public repository.
 *
 * Free setup (Spark plan — no credit card, $0):
 *   1. https://console.firebase.google.com → "Add project" → any name
 *   2. Build → Authentication → Sign-in method → Email/Password → Enable
 *   3. Build → Firestore Database → Create database → production mode
 *   4. Project settings (⚙) → Your apps → Web app (</>) → Register app
 *   5. Put the firebaseConfig values into GitHub:
 *      repo → Settings → Secrets and variables → Actions → "New repository
 *      secret" — one per name:
 *        VITE_FIREBASE_API_KEY              (apiKey)
 *        VITE_FIREBASE_AUTH_DOMAIN          (authDomain)
 *        VITE_FIREBASE_PROJECT_ID           (projectId)
 *        VITE_FIREBASE_STORAGE_BUCKET        (storageBucket)
 *        VITE_FIREBASE_MESSAGING_SENDER_ID  (messagingSenderId)
 *        VITE_FIREBASE_APP_ID               (appId)
 *      The build injects them; the repository itself stays clean.
 *      For a local build, put the same names into a local .env file (gitignored).
 *
 * Firestore → Rules (paste this):
 *   rules_version = '2';
 *   service cloud.firestore {
 *     match /databases/{database}/documents {
 *       match /users/{uid} {
 *         allow read, write: if request.auth != null && request.auth.uid == uid;
 *         match /sessions/{id} {
 *           allow read, write: if request.auth != null && request.auth.uid == uid;
 *         }
 *       }
 *     }
 *   }
 */

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? "",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? "",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: env.VITE_FIREBASE_APP_ID ?? "",
};

/** True once the GitHub secrets (or a local .env) provide the config. */
export const cloudConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

/** Web client ID for Google Sign-In (Firebase → Authentication → Google). */
export const googleWebClientId = env.VITE_GOOGLE_WEB_CLIENT_ID ?? "";
