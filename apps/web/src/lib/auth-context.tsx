"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import type { User } from "firebase/auth";
import {
  auth,
  completeGoogleRedirectSignIn,
  isFirebaseConfigured,
  isLedgeIndexDesktopShell,
  onAuthStateChange,
  signInWithGoogle,
  signOut as firebaseSignOut,
} from "@/lib/firebase";
import {
  setApiAuthTokenGetter,
  ensurePlaygroundApiKey,
  getAuthMe,
  KnowledgeIndexApiError,
  listApiKeys,
} from "@/lib/ledgeindex-api";
import {
  isPlaygroundKeyProvisioned,
  markPlaygroundKeyProvisioned,
} from "@/lib/playground-key-provision";
import {
  ensureUserProfile,
  getUserProfile,
  type AccessStatus,
  type UserProfile,
  type UserRole,
} from "@/lib/user-profile";

const playgroundEnsuredForUid = new Set<string>();
const playgroundEnsureInFlight = new Map<string, Promise<void>>();
const playgroundEnsureFailedForUid = new Set<string>();

async function ensurePlaygroundKeyOnce(
  uid: string,
  getToken: (forceRefresh?: boolean) => Promise<string | null>,
) {
  if (playgroundEnsuredForUid.has(uid) || isPlaygroundKeyProvisioned(uid)) {
    playgroundEnsuredForUid.add(uid);
    return;
  }

  const inFlight = playgroundEnsureInFlight.get(uid);
  if (inFlight) {
    await inFlight;
    return;
  }

  const promise = (async () => {
    const token = await getToken();
    if (!token) return;

    try {
      const existing = await listApiKeys();
      if ((existing?.data?.length ?? 0) > 0) {
        markPlaygroundKeyProvisioned(uid);
        playgroundEnsuredForUid.add(uid);
        return;
      }

      await ensurePlaygroundApiKey();
      markPlaygroundKeyProvisioned(uid);
      playgroundEnsuredForUid.add(uid);
    } catch (error) {
      if (error instanceof KnowledgeIndexApiError && error.status === 401) {
        const refreshed = await getToken(true);
        if (refreshed) {
          try {
            const existing = await listApiKeys();
            if ((existing?.data?.length ?? 0) > 0) {
              markPlaygroundKeyProvisioned(uid);
              playgroundEnsuredForUid.add(uid);
              return;
            }

            await ensurePlaygroundApiKey();
            markPlaygroundKeyProvisioned(uid);
            playgroundEnsuredForUid.add(uid);
            return;
          } catch {
            // fall through — user may need to sign in again
          }
        }
      }

      // 403 = account still waiting on early-access approval; nothing to provision yet.
      if (
        error instanceof KnowledgeIndexApiError &&
        (error.status === 0 || error.status === 401 || error.status === 403)
      ) {
        return;
      }

      if (!playgroundEnsureFailedForUid.has(uid)) {
        playgroundEnsureFailedForUid.add(uid);
        console.error("[auth] Failed to provision Playground API key", error);
      }
    }
  })().finally(() => {
    playgroundEnsureInFlight.delete(uid);
  });

  playgroundEnsureInFlight.set(uid, promise);
  await promise;
}

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  accessStatus: AccessStatus;
  /** False while an account waits for (or was refused) early-access approval. */
  hasAppAccess: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  getAuthToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [serverRole, setServerRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);

  const getAuthToken = useCallback(async (forceRefresh = false) => {
    const activeUser = user ?? auth?.currentUser ?? null;
    if (!activeUser) return null;
    try {
      return await activeUser.getIdToken(forceRefresh);
    } catch {
      return null;
    }
  }, [user]);

  useLayoutEffect(() => {
    setApiAuthTokenGetter((forceRefresh) => getAuthToken(forceRefresh));
    return () => setApiAuthTokenGetter(null);
  }, [getAuthToken]);

  const userUid = user?.uid ?? null;

  useEffect(() => {
    if (!userUid) {
      setServerRole(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await getAuthMe();
        if (!cancelled) setServerRole(response.role);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof KnowledgeIndexApiError && error.status === 401) {
          const refreshed = await getAuthToken(true);
          if (refreshed) {
            try {
              const response = await getAuthMe();
              if (!cancelled) setServerRole(response.role);
              return;
            } catch {
              // fall through
            }
          }
        }
        if (!cancelled) setServerRole(null);
      }
    })();

    void ensurePlaygroundKeyOnce(userUid, (forceRefresh) =>
      getAuthToken(forceRefresh),
    );

    return () => {
      cancelled = true;
    };
  }, [userUid, getAuthToken]);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    // Electron can hang Firebase auth init — never leave the UI on Loading forever.
    const failsafe = window.setTimeout(() => {
      if (!cancelled) {
        console.warn("[auth] auth state timeout — clearing loading");
        setLoading(false);
      }
    }, 4000);

    void (async () => {
      try {
        const redirect = await completeGoogleRedirectSignIn();
        if (cancelled) return;
        if (redirect?.user) {
          setUser(redirect.user);
          setLoading(false);
          window.clearTimeout(failsafe);
          if (isLedgeIndexDesktopShell()) {
            const hashQuery = window.location.hash.includes("?")
              ? window.location.hash.slice(window.location.hash.indexOf("?") + 1)
              : "";
            const returnUrl =
              new URLSearchParams(window.location.search).get("returnUrl") ||
              new URLSearchParams(hashQuery).get("returnUrl");
            const path =
              returnUrl && returnUrl.startsWith("/") && !returnUrl.startsWith("//")
                ? returnUrl
                : "/chat";
            // HashRouter: stay on the Vite origin, only change the hash.
            window.location.hash = `#${path}`;
          }
        }
      } catch (error) {
        console.error("[auth] Google redirect sign-in failed", error);
      }
    })();

    const unsubscribe = onAuthStateChange((nextUser) => {
      if (cancelled) return;
      window.clearTimeout(failsafe);
      if (nextUser) {
        void ensureUserProfile(nextUser)
          .then(({ profile: nextProfile }) => {
            setProfile(nextProfile);
          })
          .catch((error) => {
            console.error("[auth] Failed to sync user profile", error);
            void getUserProfile(nextUser.uid)
              .then(setProfile)
              .catch(() => setProfile(null));
          });
      } else {
        setProfile(null);
        setServerRole(null);
        playgroundEnsuredForUid.clear();
        playgroundEnsureFailedForUid.clear();
      }
      setUser(nextUser);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(failsafe);
      unsubscribe();
    };
  }, []);

  async function handleSignInWithGoogle() {
    if (!isFirebaseConfigured) {
      throw new Error(
        "Firebase is not configured. Add NEXT_PUBLIC_FIREBASE_* env vars.",
      );
    }
    const credential = await signInWithGoogle();
    if (!credential) return;
    try {
      const { profile: nextProfile } = await ensureUserProfile(credential.user);
      setProfile(nextProfile);
      setUser(credential.user);
      setLoading(false);
    } catch (error) {
      await firebaseSignOut();
      throw error instanceof Error
        ? error
        : new Error("Could not save user profile to Firestore");
    }
  }

  async function handleSignOut() {
    if (!isFirebaseConfigured) return;
    await firebaseSignOut();
  }

  const isAdmin = profile?.role === "admin" || serverRole === "admin";
  // Mirrors the server: admins always pass; everyone else needs explicit approval.
  const accessStatus: AccessStatus = isAdmin
    ? "approved"
    : (profile?.accessStatus ?? "pending");

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        isAuthenticated: Boolean(user),
        isAdmin,
        accessStatus,
        hasAppAccess: accessStatus === "approved",
        signInWithGoogle: handleSignInWithGoogle,
        signOut: handleSignOut,
        getAuthToken: () => getAuthToken(),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
