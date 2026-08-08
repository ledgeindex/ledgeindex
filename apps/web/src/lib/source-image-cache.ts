const DB_NAME = "ledgeindex-source-images";
const STORE_NAME = "blobs";
const DB_VERSION = 1;
const MAX_ENTRY_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 250;

type CacheRecord = {
  key: string;
  blob: Blob;
  contentType: string;
  cachedAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("indexedDB unavailable"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error ?? new Error("idb open failed"));
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
    });
  }
  return dbPromise;
}

async function readRecord(key: string): Promise<CacheRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onerror = () => reject(req.error ?? new Error("idb get failed"));
    req.onsuccess = () => {
      const row = req.result as CacheRecord | undefined;
      if (!row?.blob) {
        resolve(null);
        return;
      }
      if (Date.now() - row.cachedAt > MAX_ENTRY_AGE_MS) {
        resolve(null);
        return;
      }
      resolve(row);
    };
  });
}

async function writeRecord(record: CacheRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.onerror = () => reject(tx.error ?? new Error("idb write failed"));
    tx.oncomplete = () => resolve();
    tx.objectStore(STORE_NAME).put(record);
  });
  void pruneOldEntries().catch(() => {});
}

async function pruneOldEntries(): Promise<void> {
  const db = await openDb();
  const rows = await new Promise<CacheRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onerror = () => reject(req.error ?? new Error("idb getAll failed"));
    req.onsuccess = () => resolve((req.result as CacheRecord[]) ?? []);
  });

  const now = Date.now();
  const fresh = rows.filter((r) => now - r.cachedAt <= MAX_ENTRY_AGE_MS);
  fresh.sort((a, b) => b.cachedAt - a.cachedAt);
  const keep = new Set(fresh.slice(0, MAX_ENTRIES).map((r) => r.key));
  const drop = rows.filter((r) => !keep.has(r.key));

  if (drop.length === 0) return;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.onerror = () => reject(tx.error ?? new Error("idb prune failed"));
    tx.oncomplete = () => resolve();
    const store = tx.objectStore(STORE_NAME);
    for (const row of drop) {
      store.delete(row.key);
    }
  });
}

const inflight = new Map<string, Promise<Blob>>();

async function fetchImageBlob(url: string): Promise<Blob> {
  const existing = inflight.get(url);
  if (existing) return existing;

  const promise = (async () => {
    const res = await fetch(url, {
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!res.ok) {
      throw new Error(`image fetch ${res.status}`);
    }
    return res.blob();
  })().finally(() => {
    inflight.delete(url);
  });

  inflight.set(url, promise);
  return promise;
}

export function sourceImageCacheKey(sourceId: string, url: string): string {
  return `${sourceId}::${url}`;
}

/** Returns a blob URL (caller must revoke) or null on failure. */
export async function loadCachedSourceImage(
  cacheKey: string,
  url: string,
): Promise<string | null> {
  try {
    const hit = await readRecord(cacheKey);
    if (hit) {
      return URL.createObjectURL(hit.blob);
    }

    const blob = await fetchImageBlob(url);
    const contentType = blob.type || "image/png";
    await writeRecord({
      key: cacheKey,
      blob,
      contentType,
      cachedAt: Date.now(),
    });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}
