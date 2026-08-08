import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import {
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithCredential,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
  type UserCredential,
} from "firebase/auth";
import { getLedgeIndexDesktop } from "@/lib/ledgeindex-desktop";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const required = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.projectId,
  firebaseConfig.appId,
];

export const isFirebaseConfigured = required.every(
  (value) => typeof value === "string" && value.length > 0,
);

const app =
  isFirebaseConfigured && getApps().length === 0
    ? initializeApp(firebaseConfig)
    : getApps()[0];

export const auth = isFirebaseConfigured && app ? getAuth(app) : null;

/** Firestore database id — default is "(default)" for the primary DB. */
export const firestoreDatabaseId =
  process.env.NEXT_PUBLIC_FIREBASE_FIRESTORE_DATABASE_ID ?? "(default)";

export const db =
  isFirebaseConfigured && app
    ? getFirestore(app, firestoreDatabaseId)
    : null;

if (auth) {
  void setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.warn("[firebase] setPersistence failed", error);
  });
}

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

/** True when the web UI is loaded inside @ledgeindex/desktop. */
export function isLedgeIndexDesktopShell(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as Window & {
    ledgeindexDesktop?: { isDesktop?: boolean };
    __LEDGEINDEX_DESKTOP__?: boolean;
  };
  return Boolean(w.ledgeindexDesktop?.isDesktop || w.__LEDGEINDEX_DESKTOP__);
}

/**
 * Google sign-in.
 * Desktop: system-browser OAuth + 127.0.0.1 loopback → signInWithCredential
 * (Electron BrowserWindow is blocked by Google as an insecure embedded browser).
 * Web: signInWithPopup.
 */
export async function signInWithGoogle(): Promise<UserCredential | null> {
  if (!auth) throw new Error("Firebase Auth is not configured");

  const desktop = getLedgeIndexDesktop();
  if (desktop?.oauthGoogleSignIn) {
    const idToken = await desktop.oauthGoogleSignIn();
    const credential = GoogleAuthProvider.credential(idToken);
    return signInWithCredential(auth, credential);
  }

  return signInWithPopup(auth, googleProvider);
}

/** Completes desktop redirect sign-in after Google sends the user back. */
export async function completeGoogleRedirectSignIn(): Promise<UserCredential | null> {
  if (!auth) return null;
  try {
    return await getRedirectResult(auth);
  } catch (error) {
    console.warn("[firebase] getRedirectResult failed", error);
    return null;
  }
}

export function signOut() {
  if (!auth) throw new Error("Firebase Auth is not configured");
  return firebaseSignOut(auth);
}

export function onAuthStateChange(callback: (user: User | null) => void) {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}
