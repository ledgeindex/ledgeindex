import { readFileSync, writeFileSync } from "node:fs";
import { dataPath, getDataDir } from "../../../lib/data-dir.js";
import {
  authCodeTtlMs,
  generateAuthCode,
  generateOAuthSessionId,
  generateRefreshToken,
  hashToken,
  oauthSessionTtlMs,
  refreshTokenTtlMs,
} from "./pkce.js";

type OAuthPendingSession = {
  sessionId: string;
  clientId: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope?: string;
  createdAt: number;
  expiresAt: number;
};

type OAuthAuthCode = {
  code: string;
  sessionId: string;
  userId: string;
  idToken: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope?: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
};

type OAuthRefreshRecord = {
  tokenHash: string;
  userId: string;
  idToken: string;
  clientId: string;
  scope?: string;
  createdAt: number;
  expiresAt: number;
  revoked: boolean;
};

type OAuthClient = {
  clientId: string;
  clientName?: string;
  redirectUris: string[];
};

type OAuthSnapshot = {
  sessions: Record<string, OAuthPendingSession>;
  codes: Record<string, OAuthAuthCode>;
  refreshTokens: Record<string, OAuthRefreshRecord>;
  clients: Record<string, OAuthClient>;
};

const DEFAULT_FILE = dataPath("mcp-oauth.json");

let snapshot: OAuthSnapshot = {
  sessions: {},
  codes: {},
  refreshTokens: {},
  clients: {},
};

function loadSnapshot(filePath = DEFAULT_FILE) {
  try {
    snapshot = JSON.parse(readFileSync(filePath, "utf8")) as OAuthSnapshot;
  } catch {
    snapshot = { sessions: {}, codes: {}, refreshTokens: {}, clients: {} };
  }
}

function persistSnapshot(filePath = DEFAULT_FILE) {
  getDataDir();
  writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf8");
}

loadSnapshot();

function pruneExpired() {
  const now = Date.now();
  for (const [id, session] of Object.entries(snapshot.sessions)) {
    if (session.expiresAt < now) delete snapshot.sessions[id];
  }
  for (const [code, record] of Object.entries(snapshot.codes)) {
    if (record.expiresAt < now || record.used) delete snapshot.codes[code];
  }
  for (const [hash, record] of Object.entries(snapshot.refreshTokens)) {
    if (record.expiresAt < now || record.revoked) {
      delete snapshot.refreshTokens[hash];
    }
  }
}

export async function saveOAuthSession(session: OAuthPendingSession): Promise<void> {
  pruneExpired();
  snapshot.sessions[session.sessionId] = session;
  persistSnapshot();
}

export async function getOAuthSession(
  sessionId: string,
): Promise<OAuthPendingSession | null> {
  pruneExpired();
  const session = snapshot.sessions[sessionId];
  if (!session || session.expiresAt < Date.now()) {
    delete snapshot.sessions[sessionId];
    persistSnapshot();
    return null;
  }
  return session;
}

export async function createAuthCode(params: {
  session: OAuthPendingSession;
  userId: string;
  idToken: string;
}): Promise<string> {
  const code = generateAuthCode();
  const now = Date.now();
  snapshot.codes[code] = {
    code,
    sessionId: params.session.sessionId,
    userId: params.userId,
    idToken: params.idToken,
    clientId: params.session.clientId,
    redirectUri: params.session.redirectUri,
    codeChallenge: params.session.codeChallenge,
    scope: params.session.scope,
    createdAt: now,
    expiresAt: now + authCodeTtlMs(),
    used: false,
  };
  persistSnapshot();
  return code;
}

export async function consumeAuthCode(
  code: string,
): Promise<OAuthAuthCode | null> {
  pruneExpired();
  const record = snapshot.codes[code];
  if (!record || record.used || record.expiresAt < Date.now()) {
    delete snapshot.codes[code];
    persistSnapshot();
    return null;
  }
  record.used = true;
  persistSnapshot();
  return record;
}

export async function saveRefreshToken(params: {
  refreshToken: string;
  userId: string;
  idToken: string;
  clientId: string;
  scope?: string;
}): Promise<void> {
  const now = Date.now();
  snapshot.refreshTokens[hashToken(params.refreshToken)] = {
    tokenHash: hashToken(params.refreshToken),
    userId: params.userId,
    idToken: params.idToken,
    clientId: params.clientId,
    scope: params.scope,
    createdAt: now,
    expiresAt: now + refreshTokenTtlMs(),
    revoked: false,
  };
  persistSnapshot();
}

export async function getRefreshRecord(
  refreshToken: string,
): Promise<OAuthRefreshRecord | null> {
  pruneExpired();
  const record = snapshot.refreshTokens[hashToken(refreshToken)];
  if (!record || record.revoked || record.expiresAt < Date.now()) return null;
  return record;
}

export function buildOAuthSession(params: {
  clientId: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  codeChallengeMethod?: string;
  scope?: string;
}): OAuthPendingSession {
  const now = Date.now();
  return {
    sessionId: generateOAuthSessionId(),
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    state: params.state,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod ?? "S256",
    scope: params.scope,
    createdAt: now,
    expiresAt: now + oauthSessionTtlMs(),
  };
}

export async function registerDynamicClient(
  clientName: string,
  redirectUris: string[],
) {
  const clientId = `ledgeindex_${Math.random().toString(36).slice(2, 12)}`;
  snapshot.clients[clientId] = {
    clientId,
    clientName,
    redirectUris,
  };
  persistSnapshot();
  return clientId;
}

export async function getOAuthClient(clientId: string): Promise<OAuthClient | null> {
  return snapshot.clients[clientId] ?? null;
}

export async function isRegisteredRedirectUri(
  clientId: string,
  redirectUri: string,
): Promise<boolean> {
  const client = await getOAuthClient(clientId);
  if (!client) return false;
  return client.redirectUris.includes(redirectUri);
}
