import type { App } from "firebase-admin/app";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

let firebaseApp: App | null = null;

export function isApiAuthRequired(): boolean {
  return process.env.LEDGEINDEX_AUTH_REQUIRED === "1";
}

function parsePrivateKey(raw: string): string {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value.replace(/\\n/g, "\n");
}

function loadServiceAccountFromEnv():
  | {
      project_id?: string;
      client_email: string;
      private_key: string;
    }
  | null {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (json) {
    const serviceAccount = JSON.parse(json) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    if (serviceAccount.client_email && serviceAccount.private_key) {
      return {
        project_id: serviceAccount.project_id,
        client_email: serviceAccount.client_email,
        private_key: serviceAccount.private_key,
      };
    }
  }

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim();
  if (clientEmail && privateKey) {
    return {
      project_id: process.env.FIREBASE_PROJECT_ID,
      client_email: clientEmail,
      private_key: parsePrivateKey(privateKey),
    };
  }

  return null;
}

export function isFirebaseAdminConfigured(): boolean {
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      process.env.FIREBASE_CLIENT_EMAIL ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS,
  );
}

export function getFirebaseAdminApp(): App | null {
  if (firebaseApp) return firebaseApp;
  if (getApps().length > 0) {
    firebaseApp = getApps()[0]!;
    return firebaseApp;
  }

  const serviceAccount = loadServiceAccountFromEnv();
  if (serviceAccount) {
    firebaseApp = initializeApp({
      credential: cert(serviceAccount as Parameters<typeof cert>[0]),
      projectId:
        process.env.FIREBASE_PROJECT_ID ??
        serviceAccount.project_id ??
        "ledgeindex",
    });
    return firebaseApp;
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    firebaseApp = initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID ?? "ledgeindex",
    });
    return firebaseApp;
  }

  return null;
}

export async function verifyFirebaseIdToken(token: string) {
  const app = getFirebaseAdminApp();
  if (!app) {
    throw new Error("Firebase Admin is not configured");
  }
  return getAuth(app).verifyIdToken(token);
}
