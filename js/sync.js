/* ═══════════════════════════════════════════════════════════════════════════
   Vinage — Cloud Sync Layer (Firebase Auth + Firestore + Storage)

   Write-through pattern:  every mutation goes to localStorage immediately,
   then async to Firestore.  onSnapshot listeners push remote changes back.

   Images strategy:
     • thumbnail (80×120, ~8 KB)  → stored in Firestore wine doc directly
     • full label image (≥100 KB) → uploaded to Firebase Storage; Firestore
                                     wine doc holds the download URL (imageUrl)
   ═══════════════════════════════════════════════════════════════════════════ */

const Sync = {
  // ── State ─────────────────────────────────────────────────────────────────
  user:        null,   // firebase.User
  householdId: null,   // Firestore household document ID
  inviteCode:  null,   // 6-char sharing code
  _members:    {},     // { uid: { name, email, lastSeen? } }
  _unsubs:     [],     // Firestore unsubscribe callbacks
  _ready:      false,  // Firebase initialised?
  _db:         null,   // Firestore instance
  _auth:       null,   // Auth instance
  _storage:    null,   // Storage instance

  // ── Init ─────────────────────────────────────────────────────────────────
  init() {
    if (typeof firebase === 'undefined' || !window.FIREBASE_CONFIG ||
        !Object.keys(window.FIREBASE_CONFIG).some(k => window.FIREBASE_CONFIG[k])) {
      // Firebase not configured — run in offline-only mode silently
      return;
    }
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(window.FIREBASE_CONFIG);
      }
      this._auth    = firebase.auth();
      this._db      = firebase.firestore();
      this._storage = firebase.storage();
      this._ready   = true;

      this._auth.onAuthStateChanged(user => {
        this.user = user;
        if (user) {
          this._onSignedIn(user);
        } else {
          this._stopSync();
          this.householdId = null;
          this.inviteCode  = null;
          this._updateSyncUI();
        }
      });
    } catch (e) {
      console.warn('Vinage: Firebase init failed', e);
    }
  },

  // ── Auth ──────────────────────────────────────────────────────────────────
  async signIn() {
    if (!this._ready) return;
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await this._auth.signInWithPopup(provider);
      // onAuthStateChanged will fire and call _onSignedIn
    } catch (e) {
      console.warn('Vinage: sign-in failed', e);
      const detail = (e.code ? '[' + e.code + '] ' : '') + (e.message || e);
      App.toast('Sign-in failed: ' + detail, 'error');
    }
  },

  async signOut() {
    if (!this._ready) return;
    this._stopSync();
    await this._auth.signOut();
    // onAuthStateChanged fires → clears state
  },

  // ── After sign-in ─────────────────────────────────────────────────────────
  async _onSignedIn(user) {
    // Upsert user doc
    await this._db.doc(`users/${user.uid}`).set(
      { name: user.displayName, email: user.email, lastSeen: Date.now() },
      { merge: true }
    );
    // Check if already in a household
    const userDoc = await this._db.doc(`users/${user.uid}`).get();
    const data = userDoc.data() || {};
    if (data.householdId) {
      this.householdId = data.householdId;
      await this._loadHousehold();
      // Eagerly download so the collection is populated immediately on sign-in,
      // before the onSnapshot listener fires (important on fresh devices).
      try {
        await this._downloadToLocal();
      } catch (e) {
        console.warn('[Sync] Initial download failed, will rely on snapshot', e);
      }
      this._startSync();
      if (App.view === 'collection' || App.view === 'cellar') App.renderView();
    }
    this._updateSyncUI();
  },

  async _loadHousehold() {
    if (!this.householdId) return;
    const doc = await this._db.doc(`households/${this.householdId}`).get();
    if (doc.exists) {
      const data = doc.data();
      this.inviteCode = data.inviteCode || null;
      this._members   = data.members   || {};
    }
  },

  // Live listener on the household doc — keeps members up-to-date in real time
  _startHouseholdListener() {
    if (!this.householdId) return;
    const unsub = this._db.doc(`households/${this.householdId}`)
      .onSnapshot(snap => {
        if (!snap.exists) return;
        const data = snap.data();
        this._members  = data.members   || {};
        this.inviteCode = data.inviteCode || this.inviteCode;
        // Enrich with lastSeen from each user's doc (best-effort, no await)
        Object.keys(this._members).forEach(uid => {
          this._db.doc(`users/${uid}`).get().then(ud => {
            if (ud.exists && this._members[uid]) {
              this._members[uid].lastSeen = ud.data().lastSeen || null;
            }
          }).catch(() => {});
        });
        if (App.view === 'settings') App.renderView();
      }, () => {});
    this._unsubs.push(unsub);
  },

  // ── Household management ─────────────────────────────────────────────────
  async createHousehold() {
    if (!this._ready || !this.user) return;
    const code = this._genCode();
    const ref  = this._db.collection('households').doc();
    const hid  = ref.id;

    await ref.set({
      inviteCode: code,
      createdAt:  Date.now(),
      createdBy:  this.user.uid,
      members:    { [this.user.uid]: { name: this.user.displayName, email: this.user.email } }
    });
    await this._db.doc(`users/${this.user.uid}`).set({ householdId: hid }, { merge: true });

    this.householdId = hid;
    this.inviteCode  = code;
    this._members    = { [this.user.uid]: { name: this.user.displayName, email: this.user.email } };

    // Upload existing local data to the new household
    await this._uploadLocal();
    this._startSync();
    this._updateSyncUI();
    App.toast('Household created! Code: ' + code, 'success');
  },

  async joinHousehold(code) {
    if (!this._ready || !this.user) return;
    code = code.trim().toUpperCase();

    try {
      const snap = await this._db.collection('households')
        .where('inviteCode', '==', code).limit(1).get();
      if (snap.empty) {
        App.toast('Code not found. Check and try again.', 'error');
        return;
      }

      const hdoc = snap.docs[0];
      this.householdId = hdoc.id;
      this.inviteCode  = code;

      // Add this user as a member, then persist householdId on user doc
      await hdoc.ref.set(
        { members: { [this.user.uid]: { name: this.user.displayName, email: this.user.email } } },
        { merge: true }
      );
      await this._db.doc(`users/${this.user.uid}`).set({ householdId: this.householdId }, { merge: true });

      // Small delay so Firestore can propagate the membership write before we read
      await new Promise(r => setTimeout(r, 600));

      // Pull household data into localStorage
      await this._downloadToLocal();
      this._startSync();
      this._updateSyncUI();
      App.toast('Joined household! ✓', 'success');
      // Navigate to the collection so wines are immediately visible
      App.navigate('collection');
    } catch (e) {
      console.error('Vinage: joinHousehold failed', e);
      App.toast('Could not join household: ' + (e.message || e), 'error');
      // Reset state so the user can retry
      this.householdId = null;
      this.inviteCode  = null;
    }
  },

  // ── Account deletion (GDPR right to erasure) ─────────────────────────────
  async deleteAccount() {
    if (!this._ready || !this.user) return;
    this._stopSync();
    const uid = this.user.uid;

    try {
      // 1. Remove from household members list (if in a household)
      if (this.householdId) {
        const patch = {};
        patch[`members.${uid}`] = firebase.firestore.FieldValue.delete();
        try { await this._db.doc(`households/${this.householdId}`).update(patch); } catch (e) { /* ignore */ }
      }

      // 2. Delete user document from Firestore
      try { await this._db.doc(`users/${uid}`).delete(); } catch (e) { /* ignore */ }

      // 3. Delete Firebase Auth account
      await this._auth.currentUser.delete();
      // onAuthStateChanged will fire and clear state

    } catch (e) {
      // Firebase Auth requires recent sign-in for account deletion.
      // If we get requires-recent-login, inform the user they need to re-sign-in.
      if (e.code === 'auth/requires-recent-login') {
        throw new Error('requires_recent_login');
      }
      throw e;
    }
  },

  async leaveHousehold() {
    if (!this._ready || !this.user || !this.householdId) return;
    this._stopSync();

    // Remove this member from the household
    const patch = {};
    patch[`members.${this.user.uid}`] = firebase.firestore.FieldValue.delete();
    await this._db.doc(`households/${this.householdId}`).update(patch);
    await this._db.doc(`users/${this.user.uid}`).set({ householdId: null }, { merge: true });

    this.householdId = null;
    this.inviteCode  = null;
    this._updateSyncUI();
    App.toast('Left household.', 'success');
  },

  // ── Realtime sync ─────────────────────────────────────────────────────────
  _startSync() {
    this._stopSync();
    if (!this.householdId) return;

    const wineRef    = this._db.collection(`households/${this.householdId}/wines`);
    const cellarRef  = this._db.collection(`households/${this.householdId}/cellars`);
    const consRef    = this._db.collection(`households/${this.householdId}/consumption`);

    // Wines listener — thumbnail comes from Firestore; full image stays local
    const u1 = wineRef.onSnapshot(snap => {
      if (snap.metadata.hasPendingWrites) return; // our own write; skip
      const remote = [];
      snap.forEach(d => remote.push({ id: d.id, ...d.data() }));
      // Preserve locally-scanned full image, merge everything else from remote
      const local = DB.getWines();
      const merged = remote.map(rw => {
        const lw = local.find(l => l.id === rw.id);
        return { ...rw, image: lw?.image || null }; // thumbnail already in rw
      });
      DB._saveWines(merged);
      if (App.view === 'collection' || App.view === 'cellar') App.renderView();
    }, err => console.warn('Vinage: wines sync error', err));

    // Cellars listener
    const u2 = cellarRef.onSnapshot(snap => {
      if (snap.metadata.hasPendingWrites) return;
      const remote = [];
      snap.forEach(d => remote.push({ id: d.id, ...d.data() }));
      // Sort by explicit order index so user-defined order survives app restarts
      remote.sort((a, b) => {
        if (a.order != null && b.order != null) return a.order - b.order;
        if (a.order != null) return -1;
        if (b.order != null) return 1;
        return 0;
      });
      DB._saveCellars(remote);
      if (App.view === 'cellar') App.renderView();
    }, err => console.warn('Vinage: cellars sync error', err));

    // Consumption listener — syncs open-bottle history across all devices
    const u3 = consRef.onSnapshot(snap => {
      if (snap.metadata.hasPendingWrites) return;
      const remote = [];
      snap.forEach(d => remote.push({ id: d.id, ...d.data() }));
      remote.sort((a, b) => (b.date || 0) - (a.date || 0));
      DB._saveConsumptionLog(remote);
      if (App.view === 'stats') App.renderView();
    }, err => console.warn('Vinage: consumption sync error', err));

    this._unsubs = [u1, u2, u3];
    this._startHouseholdListener();
    this._setSyncIndicator('live');
  },

  _stopSync() {
    this._unsubs.forEach(u => u());
    this._unsubs = [];
    this._setSyncIndicator('off');
  },

  // ── Image Storage helpers ─────────────────────────────────────────────────
  async _uploadImage(wineId, base64jpg) {
    if (!this._storage || !this.householdId || !base64jpg) return null;
    try {
      const path = `households/${this.householdId}/wines/${wineId}.jpg`;
      const ref  = this._storage.ref(path);
      await ref.putString(base64jpg, 'base64', { contentType: 'image/jpeg' });
      const url = await ref.getDownloadURL();
      // Store the URL back into localStorage and Firestore
      DB.updateWine(wineId, { imageUrl: url });
      this._db.doc(`households/${this.householdId}/wines/${wineId}`)
        .update({ imageUrl: url })
        .catch(() => {});
      return url;
    } catch (e) {
      console.warn('Vinage: image upload failed', e);
      return null;
    }
  },

  _deleteImage(wineId) {
    if (!this._storage || !this.householdId) return;
    const path = `households/${this.householdId}/wines/${wineId}.jpg`;
    this._storage.ref(path).delete().catch(() => {});
  },

  // ── Upload / download full dataset ────────────────────────────────────────
  async _uploadLocal() {
    if (!this.householdId) return;
    const batch = this._db.batch();
    const base  = `households/${this.householdId}`;

    // Track which wines have local images to upload after the batch
    const toUpload = [];

    DB.getWines().forEach(w => {
      const { image, ...safe } = w; // keep thumbnail (small), strip full image
      batch.set(this._db.doc(`${base}/wines/${w.id}`), safe);
      if (image && !w.imageUrl) toUpload.push({ id: w.id, image });
    });
    DB.getCellars().forEach(c => {
      batch.set(this._db.doc(`${base}/cellars/${c.id}`), c);
    });

    DB.getConsumptionLog().forEach(e => {
      batch.set(this._db.doc(`${base}/consumption/${e.id}`), e);
    });

    await batch.commit();

    // Upload full images to Storage in background
    toUpload.forEach(({ id, image }) => this._uploadImage(id, image));
  },

  async _downloadToLocal() {
    if (!this.householdId) return;
    const base = `households/${this.householdId}`;

    const [wSnap, cSnap, consSnap] = await Promise.all([
      this._db.collection(`${base}/wines`).get(),
      this._db.collection(`${base}/cellars`).get(),
      this._db.collection(`${base}/consumption`).get()
    ]);

    const wines = [];
    // thumbnail and imageUrl come from Firestore; full image starts null (not stored remotely)
    wSnap.forEach(d => wines.push({ image: null, ...d.data(), id: d.id }));
    const cellars = [];
    cSnap.forEach(d => cellars.push({ id: d.id, ...d.data() }));
    cellars.sort((a, b) => {
      if (a.order != null && b.order != null) return a.order - b.order;
      if (a.order != null) return -1;
      if (b.order != null) return 1;
      return 0;
    });
    const consumption = [];
    consSnap.forEach(d => consumption.push({ id: d.id, ...d.data() }));
    consumption.sort((a, b) => (b.date || 0) - (a.date || 0));

    DB._saveWines(wines);
    DB._saveCellars(cellars);
    DB._saveConsumptionLog(consumption);
    console.log(`[Sync] Downloaded ${wines.length} wines, ${cellars.length} cellars, ${consumption.length} consumption entries`);
  },

  // ── Write-through helpers ─────────────────────────────────────────────────
  _pushWine(wine) {
    if (!this._ready || !this.householdId || !wine) return;
    const { image, ...safe } = wine; // keep thumbnail, strip full base64 image
    this._db.doc(`households/${this.householdId}/wines/${wine.id}`)
      .set(safe)
      .catch(e => console.warn('Vinage: push wine failed', e));
    // Upload full image to Storage if it exists and hasn't been uploaded yet
    if (image && !wine.imageUrl) {
      this._uploadImage(wine.id, image);
    }
  },

  _delWine(id) {
    if (!this._ready || !this.householdId) return;
    this._db.doc(`households/${this.householdId}/wines/${id}`)
      .delete()
      .catch(e => console.warn('Vinage: del wine failed', e));
  },

  _pushCellar(cellar) {
    if (!this._ready || !this.householdId || !cellar) return;
    this._db.doc(`households/${this.householdId}/cellars/${cellar.id}`)
      .set(cellar)
      .catch(e => console.warn('Vinage: push cellar failed', e));
  },

  _delCellar(id) {
    if (!this._ready || !this.householdId) return;
    this._db.doc(`households/${this.householdId}/cellars/${id}`)
      .delete()
      .catch(e => console.warn('Vinage: del cellar failed', e));
  },

  _pushConsumption(entry) {
    if (!this._ready || !this.householdId || !entry) return;
    this._db.doc(`households/${this.householdId}/consumption/${entry.id}`)
      .set(entry)
      .catch(e => console.warn('Vinage: push consumption failed', e));
  },

  _delConsumption(id) {
    if (!this._ready || !this.householdId) return;
    this._db.doc(`households/${this.householdId}/consumption/${id}`)
      .delete()
      .catch(e => console.warn('Vinage: del consumption failed', e));
  },

  // ── Public write-through API (mirrors DB.*) ───────────────────────────────
  addWine(data) {
    const wine = DB.addWine(data);
    this._pushWine(wine);
    return wine;
  },

  updateWine(id, patch) {
    const wine = DB.updateWine(id, patch);
    this._pushWine(wine);
    return wine;
  },

  deleteWine(id) {
    DB.deleteWine(id);
    this._delWine(id);
    this._deleteImage(id);
    // Cellars that held this wine were updated by DB.deleteWine; push them too
    DB.getCellars().forEach(c => this._pushCellar(c));
  },

  addCellar(data) {
    const cellar = DB.addCellar(data);
    this._pushCellar(cellar);
    return cellar;
  },

  updateCellar(id, patch) {
    const cellar = DB.updateCellar(id, patch);
    this._pushCellar(cellar);
    return cellar;
  },

  deleteCellar(id) {
    DB.deleteCellar(id);
    this._delCellar(id);
  },

  assignWineToSlot(cellarId, slotKey, wineId) {
    DB.assignWineToSlot(cellarId, slotKey, wineId);
    const cellar = DB.getCellars().find(c => c.id === cellarId);
    this._pushCellar(cellar);
  },

  removeWineFromShelf(cellarId, wineId) {
    DB.removeWineFromShelf(cellarId, wineId);
    const cellar = DB.getCellars().find(c => c.id === cellarId);
    this._pushCellar(cellar);
  },

  logConsumption(entry) {
    const saved = DB.logConsumption(entry); // returns the created record with its id
    this._pushConsumption(saved);
    return saved; // allow callers to chain tasting note etc.
  },

  updateConsumptionEntry(id, patch) {
    const updated = DB.updateConsumptionEntry(id, patch);
    if (updated) this._pushConsumption(updated);
    return updated;
  },

  deleteConsumptionEntry(id) {
    DB.deleteConsumptionEntry(id);
    this._delConsumption(id);
  },

  // ── UI helpers ────────────────────────────────────────────────────────────
  _updateSyncUI() {
    // Re-render settings if it's currently open, so the cloud sync card updates
    if (App.view === 'settings') App.renderView();
  },

  _setSyncIndicator(state) {
    const el = document.getElementById('sync-indicator');
    if (!el) return;
    el.className = 'sync-indicator sync-' + state;
    el.title = { live: 'Cloud sync active', off: 'Offline / not signed in' }[state] || '';
  },

  // ── Utilities ─────────────────────────────────────────────────────────────
  _genCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  },

  // ── Status summary for settings UI ───────────────────────────────────────
  statusSummary() {
    if (!this._ready)      return { mode: 'disabled' };
    if (!this.user)        return { mode: 'signed-out' };
    if (!this.householdId) return { mode: 'no-household', user: this.user };
    return {
      mode:        'syncing',
      user:        this.user,
      householdId: this.householdId,
      inviteCode:  this.inviteCode,
      members:     this._members
    };
  }
};
