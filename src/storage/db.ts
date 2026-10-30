import { Annotation } from '../pdf/types';

const DB_NAME = 'pdf_viewer_annotator_db';
const DB_VERSION = 1;
const STORE_NAME = 'annotations_store';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported in this environment'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'docId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveAnnotationsToDB(docId: string, annotationsMap: Map<number, Annotation[]>): Promise<void> {
  try {
    const db = await openDB();
    const data: Record<number, Annotation[]> = {};
    for (const [page, list] of annotationsMap.entries()) {
      data[page] = list;
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({
        docId,
        annotations: data,
        updatedAt: Date.now(),
      });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Fail gracefully if storage is restricted
  }
}

export async function loadAnnotationsFromDB(docId: string): Promise<Map<number, Annotation[]> | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(docId);

      req.onsuccess = () => {
        const res = req.result;
        if (!res || !res.annotations) {
          resolve(null);
          return;
        }

        const map = new Map<number, Annotation[]>();
        for (const [pageStr, list] of Object.entries(res.annotations)) {
          map.set(parseInt(pageStr, 10), list as Annotation[]);
        }
        resolve(map);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearAnnotationsFromDB(docId: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(docId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Fail gracefully
  }
}
