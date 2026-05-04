// Vinage — Data Layer (localStorage)
const DB = {
  KEYS: { wines: 'vinage_wines', cellars: 'vinage_cellars', settings: 'vinage_settings', wishlist: 'vinage_wishlist', consumption: 'vinage_consumption' },

  // ── Utility ──────────────────────────────────────────────────────────────
  uuid() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
  },
  _get(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } },
  _set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },

  // ── Settings ─────────────────────────────────────────────────────────────
  getSettings() { return this._get(this.KEYS.settings) || {}; },
  saveSettings(s) { this._set(this.KEYS.settings, s); },

  // ── Wines ─────────────────────────────────────────────────────────────────
  getWines() { return this._get(this.KEYS.wines) || []; },
  _saveWines(wines) { this._set(this.KEYS.wines, wines); },

  addWine(data) {
    const wines = this.getWines();
    const wine = {
      id: this.uuid(),
      addedAt: Date.now(),
      name: '', producer: '', vintage: null, region: '', country: '',
      type: 'red', grapes: [], rating: 0, notes: '', price: null,
      quantity: 1, pairings: [], image: null, tags: [],
      ...data
    };
    wines.push(wine);
    this._saveWines(wines);
    return wine;
  },

  updateWine(id, patch) {
    const wines = this.getWines();
    const i = wines.findIndex(w => w.id === id);
    if (i < 0) return null;
    wines[i] = { ...wines[i], ...patch };
    this._saveWines(wines);
    return wines[i];
  },

  deleteWine(id) {
    this._saveWines(this.getWines().filter(w => w.id !== id));
    // Remove from all cellar slots
    const cellars = this.getCellars();
    cellars.forEach(c => {
      if (c.slots) Object.keys(c.slots).forEach(k => { if (c.slots[k] === id) c.slots[k] = null; });
      if (c.wines) c.wines = c.wines.filter(wid => wid !== id);
    });
    this._set(this.KEYS.cellars, cellars);
  },

  getWineById(id) { return this.getWines().find(w => w.id === id) || null; },

  // Returns a map of wineId → [{ cellarId, cellarName, slot }]
  getWinePlacementMap() {
    const map = {};
    this.getCellars().forEach(c => {
      if (c.slots) {
        Object.entries(c.slots).forEach(([slot, wineId]) => {
          if (wineId) {
            if (!map[wineId]) map[wineId] = [];
            map[wineId].push({ cellarId: c.id, cellarName: c.name, slot });
          }
        });
      }
      if (c.wines) {
        c.wines.forEach(wineId => {
          if (!map[wineId]) map[wineId] = [];
          map[wineId].push({ cellarId: c.id, cellarName: c.name, slot: null });
        });
      }
    });
    return map;
  },

  // ── Cellars ───────────────────────────────────────────────────────────────
  getCellars() { return this._get(this.KEYS.cellars) || []; },
  _saveCellars(cellars) { this._set(this.KEYS.cellars, cellars); },

  addCellar(data) {
    const cellars = this.getCellars();
    const cellar = { id: this.uuid(), createdAt: Date.now(), name: 'My Cellar', type: 'grid', rows: 5, cols: 8, ...data };

    // Initialise slots
    if (cellar.type === 'grid' || cellar.type === 'diamond') {
      cellar.slots = {};
      for (let r = 0; r < cellar.rows; r++)
        for (let c = 0; c < cellar.cols; c++)
          cellar.slots[`${r}-${c}`] = null;
    } else if (cellar.type === 'case') {
      cellar.slots = {};
      for (let i = 0; i < 12; i++) cellar.slots[String(i)] = null;
    } else if (cellar.type === 'case6') {
      cellar.slots = {};
      // Half-case: 6 slots keyed h0–h5 (prefix distinguishes them from case-12 slots in label lookups)
      for (let i = 0; i < 6; i++) cellar.slots[`h${i}`] = null;
    } else {
      cellar.wines = [];
    }

    cellars.push(cellar);
    this._saveCellars(cellars);
    return cellar;
  },

  updateCellar(id, patch) {
    const cellars = this.getCellars();
    const i = cellars.findIndex(c => c.id === id);
    if (i < 0) return null;
    cellars[i] = { ...cellars[i], ...patch };
    this._saveCellars(cellars);
    return cellars[i];
  },

  deleteCellar(id) { this._saveCellars(this.getCellars().filter(c => c.id !== id)); },

  assignWineToSlot(cellarId, slotKey, wineId) {
    const cellars = this.getCellars();
    const c = cellars.find(c => c.id === cellarId);
    if (!c) return;
    if (c.slots !== undefined) {
      c.slots[slotKey] = wineId || null;
    } else if (c.wines) {
      if (wineId) c.wines.push(wineId);  // duplicates allowed — each entry = 1 bottle
    }
    this._saveCellars(cellars);
  },

  removeWineFromShelf(cellarId, wineId) {
    const cellars = this.getCellars();
    const c = cellars.find(c => c.id === cellarId);
    if (c && c.wines) {
      const idx = c.wines.indexOf(wineId);   // remove only ONE bottle, not all
      if (idx !== -1) c.wines.splice(idx, 1);
      this._saveCellars(cellars);
    }
  },

  getCellarStats(cellar) {
    let capacity = 0, occupied = 0;
    if (cellar.slots) {
      const slots = Object.values(cellar.slots);
      capacity = slots.length;
      occupied = slots.filter(Boolean).length;
    } else if (cellar.wines) {
      occupied = cellar.wines.length;
      capacity = null; // unlimited shelf
    }
    return { capacity, occupied, empty: capacity !== null ? capacity - occupied : null };
  },

  // ── Consumption log ───────────────────────────────────────────────────────
  getConsumptionLog() { return this._get(this.KEYS.consumption) || []; },
  _saveConsumptionLog(log) { this._set(this.KEYS.consumption, log); },

  logConsumption(entry) {
    const log = this.getConsumptionLog();
    const record = { id: this.uuid(), date: Date.now(), ...entry };
    log.unshift(record);
    this._saveConsumptionLog(log);
    return record; // returned so Sync can push without a re-lookup
  },

  updateConsumptionEntry(id, patch) {
    const log = this.getConsumptionLog();
    const idx = log.findIndex(e => e.id === id);
    if (idx === -1) return null;
    log[idx] = { ...log[idx], ...patch };
    this._saveConsumptionLog(log);
    return log[idx];
  },

  deleteConsumptionEntry(id) {
    this._saveConsumptionLog(this.getConsumptionLog().filter(e => e.id !== id));
  },

  // ── Export / Import ───────────────────────────────────────────────────────
  exportAll() {
    return JSON.stringify({ wines: this.getWines(), cellars: this.getCellars(), exportedAt: new Date().toISOString() }, null, 2);
  },

  importAll(jsonStr) {
    const data = JSON.parse(jsonStr);
    if (Array.isArray(data.wines)) this._saveWines(data.wines);
    if (Array.isArray(data.cellars)) this._saveCellars(data.cellars);
  },

  clearAll() {
    Object.values(this.KEYS).forEach(k => localStorage.removeItem(k));
  },

  // ── Wishlist ──────────────────────────────────────────────────────────────
  getWishlist() { return this._get(this.KEYS.wishlist) || []; },
  _saveWishlist(items) { this._set(this.KEYS.wishlist, items); },

  addWishlistItem(data) {
    const items = this.getWishlist();
    const item = {
      id: this.uuid(),
      addedAt: Date.now(),
      name: '', producer: '', vintage: null, type: 'red',
      region: '', notes: '', price: null,
      ...data
    };
    items.push(item);
    this._saveWishlist(items);
    return item;
  },

  updateWishlistItem(id, patch) {
    const items = this.getWishlist();
    const i = items.findIndex(x => x.id === id);
    if (i < 0) return null;
    items[i] = { ...items[i], ...patch };
    this._saveWishlist(items);
    return items[i];
  },

  deleteWishlistItem(id) {
    this._saveWishlist(this.getWishlist().filter(x => x.id !== id));
  },

  // Returns the wishlist item linked to a cellar wine, or null
  getWishlistItemByWineId(wineId) {
    return this.getWishlist().find(x => x.wineId === wineId) || null;
  },

  // Toggle a cellar wine in/out of the wishlist; returns true if added
  toggleWineOnWishlist(wine) {
    const existing = this.getWishlistItemByWineId(wine.id);
    if (existing) {
      this.deleteWishlistItem(existing.id);
      return false;
    }
    this.addWishlistItem({
      wineId:   wine.id,
      name:     wine.name     || '',
      producer: wine.producer || '',
      vintage:  wine.vintage  || null,
      type:     wine.type     || 'red',
      region:   wine.region   || '',
      notes:    wine.notes    || '',
      price:    wine.price    || null,
    });
    return true;
  }
};
