/**
 * Client-side IndexedDB persistence for non-sensitive UI preferences
 * (saved route bookmarks, bike type, and recent custom routes).
 * Stores zero credentials or authentication tokens.
 */
import type { BikeTypeId } from '@/lib/cycling-utils';
import type { CyclingRoute } from '@/lib/routes-data';

const DB_NAME = 'spinmap_ui_prefs_v1';
const STORE_NAME = 'prefs';

export interface PersistedSpinMapState {
  savedIds: string[];
  bikeType: BikeTypeId;
  recentCustomByCity: Record<string, { route: CyclingRoute; rationale: string }>;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

export async function loadSpinMapPrefs(): Promise<Partial<PersistedSpinMapState>> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get('state');
      req.onsuccess = () => {
        const val = req.result;
        if (val && typeof val === 'object') {
          resolve(val as Partial<PersistedSpinMapState>);
        } else {
          resolve({});
        }
      };
      req.onerror = () => resolve({});
    });
  } catch {
    return {};
  }
}

export async function saveSpinMapPrefs(state: PersistedSpinMapState): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(state, 'state');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Graceful silent no-op in restricted/private browser contexts
  }
}
