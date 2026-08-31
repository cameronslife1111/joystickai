/**
 * Persistent cache of generated speech clips.
 *
 * Audio for a sentence is fully determined by (text, voice), so a clip only
 * ever needs to be generated once. Keeping decoded PCM in IndexedDB means
 * re-reading a document costs no network and no AI credits at all.
 *
 * Stored as Int16 PCM (half the size of Float32) at the engine's playback
 * sample rate. All failures are swallowed: this is a cache, never a
 * dependency.
 */

const DB_NAME = "orby-speech-clips";
const DB_VERSION = 1;
const STORE = "clips";
const MAX_ENTRIES = 400;

type StoredClip = {
  key: string;
  pcm: ArrayBuffer;
  usedAt: number;
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "key" });
          store.createIndex("usedAt", "usedAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function toFloat32(pcm: ArrayBuffer): Float32Array<ArrayBuffer> {
  const view = new Int16Array(pcm);
  const samples = new Float32Array(view.length) as Float32Array<ArrayBuffer>;
  for (let index = 0; index < view.length; index += 1) samples[index] = view[index] / 32_768;
  return samples;
}

function toInt16Buffer(samples: Float32Array): ArrayBuffer {
  const view = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    view[index] = Math.round(value * 32_767);
  }
  return view.buffer;
}

export async function loadStoredClip(key: string): Promise<Float32Array<ArrayBuffer> | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const request = store.get(key);
      request.onsuccess = () => {
        const record = request.result as StoredClip | undefined;
        if (!record?.pcm) {
          resolve(null);
          return;
        }
        try {
          store.put({ ...record, usedAt: Date.now() });
        } catch {}
        resolve(toFloat32(record.pcm));
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveStoredClip(key: string, samples: Float32Array): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put({ key, pcm: toInt16Buffer(samples), usedAt: Date.now() } satisfies StoredClip);
    // Opportunistic trim: drop the least recently used entries when the cache
    // grows past its ceiling.
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      const excess = countRequest.result - MAX_ENTRIES;
      if (excess <= 0) return;
      try {
        let removed = 0;
        const cursorRequest = store.index("usedAt").openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor || removed >= excess) return;
          try {
            cursor.delete();
          } catch {}
          removed += 1;
          cursor.continue();
        };
      } catch {}
    };
  } catch {}
}

/** Test hook: forget the open database handle. */
export function resetClipStore() {
  dbPromise = null;
}
