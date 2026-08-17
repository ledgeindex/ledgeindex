import type { User } from "firebase/auth";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type UserPlan = "free" | "pro";
export type UserRole = "user" | "admin";

export type UserProfile = {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  plan: UserPlan;
  role: UserRole;
  createdAt: unknown;
  updatedAt: unknown;
  lastLoginAt: unknown;
};

export async function ensureUserProfile(user: User): Promise<{
  created: boolean;
  profile: UserProfile | null;
}> {
  if (!db) {
    return { created: false, profile: null };
  }

  const ref = doc(db, "users", user.uid);
  const existing = await getDoc(ref);
  const now = serverTimestamp();

  if (!existing.exists()) {
    const profile = {
      uid: user.uid,
      email: user.email ?? "",
      displayName: user.displayName,
      photoURL: user.photoURL,
      plan: "free" as const,
      role: "user" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };

    await setDoc(ref, profile);
    return { created: true, profile: profile as unknown as UserProfile };
  }

  await updateDoc(ref, {
    lastLoginAt: now,
    updatedAt: now,
    ...(user.email ? { email: user.email } : {}),
    ...(user.displayName ? { displayName: user.displayName } : {}),
    ...(user.photoURL ? { photoURL: user.photoURL } : {}),
  });

  const updated = await getDoc(ref);
  return {
    created: false,
    profile: updated.exists() ? (updated.data() as UserProfile) : null,
  };
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  if (!db) return null;
  const ref = doc(db, "users", uid);
  const snapshot = await getDoc(ref);
  return snapshot.exists() ? (snapshot.data() as UserProfile) : null;
}
