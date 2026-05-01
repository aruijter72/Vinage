/* ═══════════════════════════════════════════════════════════════════════════
   Vinage — IndexedDB image store
   Keeps full-resolution wine images out of localStorage (which has a ~5 MB
   limit per origin) so they never compete with wine data for storage space.

   Public API (all methods return Promises):
     ImageDB.save(wineId, base64)  — store or overwrite a full image
     ImageDB.get(wineId)           — resolve with base64 string or null
     ImageDB.delete(wineId)        — remove image for a wine
     ImageDB.migrate()             — one-time: move wine.image fields from
                                     localStorage into IndexedDB and free the
                                     localStorage space
   ═══════════════════════════════════════════════════════════════════════════ */
const ImageDB = (() => {
  const DB_NAME  = 'vinage-images';
  const DB_VER   = 1;
  const STORE    = 'wine-images';

  let _dbPromise = null;

  function _open() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore(STORE);
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => { _dbPromise = null; reject(e.target.error); };
    });
    return _dbPromise;
  }

  return {
    // ── Save (or overwrite) a full-resolution base64 image ───────────────────
    async save(wineId, base64) {
      if (!wineId || !base64) return;
      try {
        const db = await _open();
        await new Promise((resolve, reject) => {
          const tx  = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(base64, wineId);
          tx.oncomplete = () => resolve();
          tx.onerror    = e  => reject(e.target.error);
        });
      } catch (err) {
        console.warn('[ImageDB] save failed:', err);
      }
    },

    // ── Retrieve a full-resolution image (resolves null if not found) ─────────
    async get(wineId) {
      if (!wineId) return null;
      try {
        const db = await _open();
        return await new Promise((resolve, reject) => {
          const tx  = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).get(wineId);
          req.onsuccess = e => resolve(e.target.result || null);
          req.onerror   = e => reject(e.target.error);
        });
      } catch (err) {
        console.warn('[ImageDB] get failed:', err);
        return null;
      }
    },

    // ── Delete a wine's image (call when deleting the wine) ───────────────────
    async delete(wineId) {
      if (!wineId) return;
      try {
        const db = await _open();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(wineId);
          tx.oncomplete = () => resolve();
          tx.onerror    = e  => reject(e.target.error);
        });
      } catch (err) {
        console.warn('[ImageDB] delete failed:', err);
      }
    },

    // ── One-time migration: move wine.image from localStorage → IndexedDB ─────
    // Safe to call multiple times — wines without a stored image are skipped.
    async migrate() {
      const wines = DB.getWines();
      let count = 0;
      for (const w of wines) {
        if (!w.image) continue;
        await this.save(w.id, w.image);
        // Strip the full image from localStorage to free space; keep thumbnail
        DB.updateWine(w.id, { image: null });
        count++;
      }
      if (count > 0) {
        console.log(`[ImageDB] Migrated ${count} wine image(s) from localStorage → IndexedDB`);
      }
      return count;
    },
  };
})();
