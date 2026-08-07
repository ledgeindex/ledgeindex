import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getFirebaseAdminApp } from "./firebase-admin.js";

let firestore: Firestore | null = null;

export function getAdminFirestore(): Firestore | null {
  if (firestore) return firestore;
  const app = getFirebaseAdminApp();
  if (!app) return null;
  firestore = getFirestore(app);
  return firestore;
}
