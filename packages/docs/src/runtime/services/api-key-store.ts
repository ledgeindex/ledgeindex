import {
  API_KEY_LIMIT,
  generateApiKey,
  getApiKeySalt,
  hashApiKey,
  isRawApiKeyValue,
  toKeyPrefix,
} from "../lib/api-keys.js";
import {
  decryptApiKeyForUser,
  encryptApiKeyForUser,
} from "../lib/api-key-crypto.js";
import { getAdminFirestore } from "../lib/firestore-admin.js";
import { getUserRole, isAdminRole } from "./user-role.js";

export const ADMIN_API_KEY_LIMIT = 10;
export const DEFAULT_API_KEY_NAME = "Playground";
export const LIVE_API_KEY_NAME = "Live";
export const PLAYGROUND_KEY_ID = "playground";
const LEGACY_DEFAULT_API_KEY_NAMES = new Set(["Default key", "Playground"]);

function isDefaultKeyName(name: string): boolean {
  return LEGACY_DEFAULT_API_KEY_NAMES.has(name) || isRawApiKeyValue(name);
}

function displayNameForKey(data: StoredApiKey): string {
  if (data.is_default || isDefaultKeyName(data.name)) {
    return DEFAULT_API_KEY_NAME;
  }
  return data.name;
}

export type StoredApiKey = {
  name: string;
  key_hash: string;
  key_prefix: string;
  key_ciphertext?: string;
  scopes: string[];
  is_active: boolean;
  is_default?: boolean;
  created_at: string;
  last_used_at: string | null;
};

export type ApiKeyListItem = {
  id: string;
  name: string;
  key_prefix: string;
  key_value: string | null;
  created_at: string;
  last_used_at: string | null;
  scopes: string[];
  is_default: boolean;
};

function keysCollection(userId: string) {
  const db = getAdminFirestore();
  if (!db) throw new Error("Firestore is not configured");
  return db.collection("api_keys").doc(userId).collection("keys");
}

function lookupDoc(hash: string) {
  const db = getAdminFirestore();
  if (!db) throw new Error("Firestore is not configured");
  return db.collection("api_key_lookup").doc(hash);
}

export async function listUserApiKeys(userId: string): Promise<ApiKeyListItem[]> {
  const snap = await keysCollection(userId).get();
  return snap.docs
    .map((doc) => {
      const data = doc.data() as StoredApiKey;
      if (!data.is_active) return null;
      const keyValue = data.key_ciphertext
        ? decryptApiKeyForUser(data.key_ciphertext, userId)
        : null;
      return {
        id: doc.id,
        name: displayNameForKey(data),
        key_prefix: data.key_prefix,
        key_value: keyValue,
        created_at: data.created_at,
        last_used_at: data.last_used_at,
        scopes: data.scopes ?? ["*"],
        is_default: data.is_default ?? isDefaultKeyName(data.name),
      };
    })
    .filter((item): item is ApiKeyListItem => item !== null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function rotateStoredApiKeySecret(
  userId: string,
  keyId: string,
  data: StoredApiKey,
): Promise<string> {
  const apiKey = generateApiKey();
  const salt = getApiKeySalt();
  const keyHash = hashApiKey(apiKey, salt);
  const db = getAdminFirestore();
  if (!db) throw new Error("Firestore is not configured");

  const batch = db.batch();
  batch.update(keysCollection(userId).doc(keyId), {
    key_hash: keyHash,
    key_prefix: toKeyPrefix(apiKey),
    key_ciphertext: encryptApiKeyForUser(apiKey, userId),
  });
  batch.delete(lookupDoc(data.key_hash));
  batch.set(lookupDoc(keyHash), {
    userId,
    keyId,
    created_at: data.created_at,
  });
  await batch.commit();
  return apiKey;
}

export async function backfillRetrievableApiKeys(userId: string): Promise<void> {
  const snap = await keysCollection(userId).get();
  for (const doc of snap.docs) {
    const data = doc.data() as StoredApiKey;
    if (!data.is_active || data.key_ciphertext) continue;
    await rotateStoredApiKeySecret(userId, doc.id, data);
  }
}

export async function getApiKeyLimitForUser(userId: string): Promise<number> {
  const role = await getUserRole(userId);
  return isAdminRole(role) ? ADMIN_API_KEY_LIMIT : API_KEY_LIMIT;
}

export async function ensurePlaygroundApiKey(
  userId: string,
): Promise<{ created: boolean; apiKey?: string }> {
  const db = getAdminFirestore();
  if (!db) throw new Error("Firestore is not configured");

  const coll = keysCollection(userId);
  const playgroundRef = coll.doc(PLAYGROUND_KEY_ID);

  return db.runTransaction(async (transaction) => {
    const [playgroundSnap, allSnap] = await Promise.all([
      transaction.get(playgroundRef),
      transaction.get(coll),
    ]);

    const playgroundData = playgroundSnap.exists
      ? (playgroundSnap.data() as StoredApiKey)
      : null;
    if (playgroundSnap.exists && playgroundData?.is_active !== false) {
      return { created: false };
    }

    const hasOtherActiveKey = allSnap.docs.some((doc) => {
      if (doc.id === PLAYGROUND_KEY_ID) return false;
      const data = doc.data() as StoredApiKey;
      return data.is_active !== false;
    });
    if (hasOtherActiveKey) {
      return { created: false };
    }

    const apiKey = generateApiKey();
    const salt = getApiKeySalt();
    const keyHash = hashApiKey(apiKey, salt);
    const createdAt = new Date().toISOString();

    const record: StoredApiKey = {
      name: DEFAULT_API_KEY_NAME,
      key_hash: keyHash,
      key_prefix: toKeyPrefix(apiKey),
      key_ciphertext: encryptApiKeyForUser(apiKey, userId),
      scopes: ["*"],
      is_active: true,
      is_default: true,
      created_at: createdAt,
      last_used_at: null,
    };

    transaction.set(playgroundRef, record);
    transaction.set(lookupDoc(keyHash), {
      userId,
      keyId: PLAYGROUND_KEY_ID,
      created_at: createdAt,
    });

    return { created: true, apiKey };
  });
}

export async function normalizeUserApiKeys(userId: string): Promise<void> {
  const role = await getUserRole(userId);
  const snap = await keysCollection(userId).get();
  const activeDocs = snap.docs.filter((doc) => {
    const data = doc.data() as StoredApiKey;
    return data.is_active !== false;
  });

  for (const doc of activeDocs) {
    const data = doc.data() as StoredApiKey;
    const updates: Partial<StoredApiKey> = {};

    if (
      data.name === "Default key" ||
      isRawApiKeyValue(data.name) ||
      (data.is_default && data.name !== DEFAULT_API_KEY_NAME)
    ) {
      updates.name = DEFAULT_API_KEY_NAME;
      updates.is_default = true;
    }

    if (!data.key_ciphertext) {
      await rotateStoredApiKeySecret(userId, doc.id, data);
    }

    if (Object.keys(updates).length > 0) {
      await doc.ref.update(updates);
    }
  }

  const refreshed = await keysCollection(userId).get();
  const active = refreshed.docs
    .map((doc) => ({ id: doc.id, data: doc.data() as StoredApiKey }))
    .filter((entry) => entry.data.is_active !== false);

  const defaultKeys = active.filter(
    (entry) =>
      entry.data.is_default ||
      isDefaultKeyName(entry.data.name) ||
      isRawApiKeyValue(entry.data.name),
  );

  if (defaultKeys.length > 1) {
    const keeper = [...defaultKeys].sort((a, b) =>
      a.data.created_at.localeCompare(b.data.created_at),
    )[0];
    for (const entry of defaultKeys) {
      if (entry.id === keeper.id) continue;
      await revokeUserApiKey(userId, entry.id);
    }
  }

  if (isAdminRole(role)) return;

  const afterDefaultCleanup = await keysCollection(userId).get();
  const remaining = afterDefaultCleanup.docs
    .map((doc) => ({ id: doc.id, data: doc.data() as StoredApiKey }))
    .filter((entry) => entry.data.is_active !== false);

  if (remaining.length <= 1) return;

  const keeper = [...remaining].sort((a, b) => {
    const score = (entry: (typeof remaining)[number]) => {
      if (entry.data.is_default) return 0;
      if (isDefaultKeyName(entry.data.name)) return 1;
      return 2;
    };
    const byPriority = score(a) - score(b);
    if (byPriority !== 0) return byPriority;
    return a.data.created_at.localeCompare(b.data.created_at);
  })[0];

  for (const entry of remaining) {
    if (entry.id === keeper.id) continue;
    await revokeUserApiKey(userId, entry.id);
  }
}

export async function createUserApiKey(
  userId: string,
  name: string,
  options?: { isDefault?: boolean },
): Promise<{ apiKey: string; keyId: string; record: ApiKeyListItem }> {
  const trimmedName = name.trim();
  if (isRawApiKeyValue(trimmedName)) {
    throw new Error("API key name must be a label like Live, not the key value.");
  }

  const limit = await getApiKeyLimitForUser(userId);
  const existing = await listUserApiKeys(userId);
  if (existing.length >= limit) {
    throw new ApiKeyLimitError(limit, existing.length);
  }

  const apiKey = generateApiKey();
  const salt = getApiKeySalt();
  const keyHash = hashApiKey(apiKey, salt);
  const keyId = `key_${Date.now()}`;
  const createdAt = new Date().toISOString();
  const isDefault = options?.isDefault ?? false;

  const record: StoredApiKey = {
    name: trimmedName,
    key_hash: keyHash,
    key_prefix: toKeyPrefix(apiKey),
    key_ciphertext: encryptApiKeyForUser(apiKey, userId),
    scopes: ["*"],
    is_active: true,
    is_default: isDefault,
    created_at: createdAt,
    last_used_at: null,
  };

  const db = getAdminFirestore();
  if (!db) throw new Error("Firestore is not configured");

  const batch = db.batch();
  batch.set(keysCollection(userId).doc(keyId), record);
  batch.set(lookupDoc(keyHash), {
    userId,
    keyId,
    created_at: createdAt,
  });
  await batch.commit();

  return {
    apiKey,
    keyId,
    record: {
      id: keyId,
      name: displayNameForKey(record),
      key_prefix: record.key_prefix,
      key_value: apiKey,
      created_at: record.created_at,
      last_used_at: record.last_used_at,
      scopes: record.scopes,
      is_default: record.is_default ?? false,
    },
  };
}

export async function revokeUserApiKey(
  userId: string,
  keyId: string,
): Promise<boolean> {
  const ref = keysCollection(userId).doc(keyId);
  const snap = await ref.get();
  if (!snap.exists) return false;

  const data = snap.data() as StoredApiKey;
  const db = getAdminFirestore();
  if (!db) throw new Error("Firestore is not configured");

  const batch = db.batch();
  batch.update(ref, { is_active: false });
  batch.delete(lookupDoc(data.key_hash));
  await batch.commit();
  return true;
}

export async function validateApiKey(
  apiKey: string,
): Promise<{ userId: string; scopes: string[] } | null> {
  if (!getAdminFirestore()) return null;

  let keyHash: string;
  try {
    keyHash = hashApiKey(apiKey, getApiKeySalt());
  } catch {
    return null;
  }

  const lookupSnap = await lookupDoc(keyHash).get();
  if (!lookupSnap.exists) return null;

  const lookup = lookupSnap.data() as { userId: string; keyId: string };
  const keySnap = await keysCollection(lookup.userId).doc(lookup.keyId).get();
  if (!keySnap.exists) return null;

  const keyData = keySnap.data() as StoredApiKey;
  if (!keyData.is_active) return null;

  return {
    userId: lookup.userId,
    scopes: keyData.scopes ?? ["*"],
  };
}

export class ApiKeyLimitError extends Error {
  limit: number;
  current: number;

  constructor(limit: number, current: number) {
    super(`API key limit reached (${current}/${limit})`);
    this.name = "ApiKeyLimitError";
    this.limit = limit;
    this.current = current;
  }
}
