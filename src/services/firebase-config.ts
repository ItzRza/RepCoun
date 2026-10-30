/**
 * Firebase configuration — the ONLY file that needs your own values.
 *
 * Free setup (Spark plan — no credit card, $0):
 *   1. https://console.firebase.google.com → "Add project" → any name
 *   2. Build → Authentication → Sign-in method → Email/Password → Enable
 *   3. Build → Firestore Database → Create database → production mode
 *   4. Project settings (⚙) → Your apps → Web app (</>) → Register app
 *   5. Copy the firebaseConfig values into this file.
 *
 * Then set Firestore → Rules to:
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
export const firebaseConfig = {
  apiKey: "PASTE-ME",
  authDomain: "PASTE-ME",
  projectId: "PASTE-ME",
  storageBucket: "PASTE-ME",
  messagingSenderId: "PASTE-ME",
  appId: "PASTE-ME",
};

/** True once the config above is filled in. */
export const cloudConfigured = firebaseConfig.projectId !== "PASTE-ME";
