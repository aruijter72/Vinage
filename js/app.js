/* ═══════════════════════════════════════════════════════════════════════════
   Vinage — Main App
   ═══════════════════════════════════════════════════════════════════════════ */
const App = {
  // ── State ────────────────────────────────────────────────────────────────
  view: 'scan',
  lang: 'en',
  stream: null,
  capturedImage: null,      // base64 jpeg (full res, AI analysis only — never stored)
  capturedMedium: null,     // base64 jpeg (360px wide, stored in IndexedDB for display)
  capturedThumbnail: null,  // base64 jpeg (80×120, stored in localStorage for rack tooltip)
  scanResult: null,
  editWineId: null,
  cellarDetailId: null,
  collectionSort: 'addedAt',
  collectionFilters: new Set(), // empty = show all; multi-select
  collectionSearch: '',
  collectionView: 'list',    // 'list' | 'gallery'
  batchSelectMode: false,
  batchSelected: new Set(),
  _cellarMapOpen: true,      // cellar map collapse state
  _scanRotation: 0,          // 0 | 90 | 180 | 270
  _rackZoom: 1.0,            // current rack zoom level (0.35 – 3.0)
  _decantTimer: null,        // { wineId, wineName, endTime, timerId }

  // ── Bootstrap ────────────────────────────────────────────────────────────
  init() {
    this._showSplash();
    this.lang = detectLang();
    this.render();
    this.navigate('scan');
    document.addEventListener('click',  e => this._delegateClick(e));
    document.addEventListener('change', e => this._delegateChange(e));
    Sync.init();
    this._restoreDecantTimer();
    this._checkDrinkWindowNotifications();
    setTimeout(() => this._maybePromptNotifications(), 3000);
    // Migrate any full images still in localStorage → IndexedDB (frees storage space)
    ImageDB.migrate();
  },

  _showSplash() {
    const el = document.createElement('div');
    el.id = 'splash-screen';
    el.innerHTML = `<img src="Vinage Hero-image.PNG" alt="Vinage" class="splash-img">`;
    document.body.appendChild(el);
    setTimeout(() => {
      el.classList.add('splash-fade');
      setTimeout(() => el.remove(), 700);
    }, 2000);
  },

  // ── Translate ─────────────────────────────────────────────────────────────
  t(path, vars) {
    const parts = path.split('.');
    let obj = TRANSLATIONS[this.lang];
    for (const p of parts) { obj = obj?.[p]; }
    if (obj === undefined) {
      obj = path.split('.').reduce((o,k) => o?.[k], TRANSLATIONS.en);
    }
    let s = obj ?? path;
    if (vars) Object.entries(vars).forEach(([k,v]) => s = s.replace(`{${k}}`, v));
    return s;
  },

  // ── Navigation ────────────────────────────────────────────────────────────
  navigate(view) {
    if (this.stream && view !== 'scan') this.stopCamera();
    this.view = view;
    this.cellarDetailId = null;
    this.renderView();
    this.renderNav();
  },

  // ── Full render ───────────────────────────────────────────────────────────
  render() {
    document.getElementById('app').innerHTML = `
      <div id="main-content"></div>
      <nav id="bottom-nav"></nav>
      <div id="modal-overlay">
        <div id="modal-box">
          <div id="modal-header">
            <span id="modal-title"></span>
            <button class="btn btn-icon" id="modal-close-btn" aria-label="Close">
              ${this._iconX()}
            </button>
          </div>
          <div id="modal-body"></div>
          <div id="modal-footer"></div>
        </div>
      </div>
      <div id="toast-container"></div>
      <div id="rack-tooltip"></div>
      <div id="sync-indicator" class="sync-indicator sync-off" title="Offline / not signed in"></div>`;

    document.getElementById('modal-close-btn').onclick = () => this.closeModal();
    document.getElementById('modal-overlay').onclick = e => {
      if (e.target === document.getElementById('modal-overlay')) this.closeModal();
    };
  },

  renderNav() {
    const items = [
      { id: 'scan',       icon: this._iconCamera(),    label: this.t('nav.scan') },
      { id: 'cellar',     icon: this._iconCellar(),    label: this.t('nav.cellar') },
      { id: 'collection', icon: this._iconWine(),      label: this.t('nav.collection') },
      { id: 'wishlist',   icon: this._iconHeart(),     label: this.t('nav.wishlist') },
      { id: 'stats',      icon: this._iconStats(),     label: this.t('nav.stats') },
      { id: 'settings',   icon: this._iconGear(),      label: this.t('nav.settings') },
    ];
    document.getElementById('bottom-nav').innerHTML = items.map(item => `
      <button class="nav-item${this.view === item.id ? ' active' : ''}" data-nav="${item.id}" aria-label="${item.label}">
        ${item.icon}<span>${item.label}</span>
      </button>`).join('');
  },

  renderView() {
    const el = document.getElementById('main-content');
    switch (this.view) {
      case 'scan':       el.innerHTML = this.buildScanView(); this.initCamera(); break;
      case 'cellar':
        el.innerHTML = this.cellarDetailId ? this.buildCellarDetail() : this.buildCellarList();
        if (this.cellarDetailId) setTimeout(() => { this._initRackHover(); this._initRackZoom(); }, 0);
        break;
      case 'collection': el.innerHTML = this.buildCollectionView(); break;
      case 'wishlist':   el.innerHTML = this.buildWishlistView(); break;
      case 'pairing':    el.innerHTML = this.buildPairingView(); break;
      case 'stats':      el.innerHTML = this.buildStatsView(); break;
      case 'settings':   el.innerHTML = this.buildSettingsView(); break;
    }
  },

  // ── Click delegation ──────────────────────────────────────────────────────
  _delegateClick(e) {
    const t = e.target.closest('[data-action]');
    if (!t) {
      const nav = e.target.closest('[data-nav]');
      if (nav) this.navigate(nav.dataset.nav);
      return;
    }
    const action = t.dataset.action;
    const args = t.dataset;
    switch (action) {
      case 'start-camera':        this.startCamera(); break;
      case 'rotate-camera':       this.rotateScan(); break;
      case 'capture':             this.captureAndAnalyze(); break;
      case 'retake':              this.retakeScan(); break;
      case 'add-wine-from-scan': {
        const dup = this._findDuplicate(this.scanResult);
        if (dup) this._showDuplicateWarning(dup, this.scanResult);
        else     this.showWineForm(this.scanResult);
        break;
      }
      case 'manual-add-wine':     this.showWineForm(null); break;
      case 'save-wine':           this.saveWineForm(); break;
      case 'edit-wine':           this.editWine(args.id); break;
      case 'delete-wine':         this.confirmDeleteWine(args.id); break;
      case 'open-cellar':         this.openCellarDetail(args.id); break;
      case 'back-cellar':         this.cellarDetailId = null; this.renderView(); break;
      case 'add-cellar':          this.showAddCellarModal(); break;
      case 'save-cellar':         this.saveCellarForm(); break;
      case 'delete-cellar':       this.confirmDeleteCellar(args.id); break;
      case 'click-slot':          this.handleSlotClick(args.cellarid, args.slot, args.wineid); break;
      case 'assign-wine-to-slot': this.assignWineToSlot(args.cellarid, args.slot, args.wineid); break;
      case 'remove-from-slot':    this.removeFromSlot(args.cellarid, args.slot, args.wineid); break;
      case 'add-to-shelf':        this.showWinePickerForShelf(args.cellarid); break;
      case 'remove-from-shelf':   this.removeFromShelf(args.cellarid, args.wineid); break;
      case 'find-pairings':       this.findPairings(); break;
      case 'save-settings':       this.saveSettings(); break;
      case 'toggle-lang':         this.toggleLang(args.lang); break;
      case 'toggle-provider':     this.toggleProvider(args.provider); break;
      case 'toggle-key-vis':      this.toggleKeyVisibility(args.field); break;
      case 'export-data':         this.exportData(); break;
      case 'import-data':         document.getElementById('import-file-input')?.click(); break;
      case 'clear-data':          this.clearData(); break;
      case 'star-pick':           this.pickStar(parseInt(args.val, 10)); break;
      case 'type-pick':           this.pickType(args.type); break;
      // Collection extras
      case 'toggle-gallery':      this.collectionView = this.collectionView === 'gallery' ? 'list' : 'gallery'; this.renderView(); break;
      case 'toggle-select-mode':  this._toggleBatchSelect(); break;
      case 'batch-set-qty':       this._batchSetQty(); break;
      case 'batch-add-tag':       this._batchAddTag(); break;
      case 'batch-delete':        this._batchDelete(); break;
      case 'toggle-wine-select':  this._toggleWineSelect(args.id); break;
      case 'filter-ready-cellar': this.collectionFilters = new Set(['drink-now']); this.renderView(); break;
      // Cellar map
      case 'toggle-cellar-map':   this._cellarMapOpen = !this._cellarMapOpen; this.renderView(); break;
      // Decanting timer
      case 'start-decant':        this._showDecantModal(args.id); break;
      case 'cancel-decant':       this._cancelDecantTimer(); break;
      // Share wine card
      case 'share-wine':          this._showShareModal(args.id); break;
      case 'download-share-card': this._downloadShareCard(); break;
      case 'native-share-card':   this._nativeShare(); break;
      // Consumption
      case 'consume-bottle':      this._consumeBottle(args.id); break;
      case 'delete-consumption':  DB.deleteConsumptionEntry(args.id); this.renderView(); break;
      // Wishlist
      case 'add-wishlist-item':   this.showWishlistForm(null); break;
      case 'edit-wishlist-item':  this.showWishlistForm(args.id); break;
      case 'delete-wishlist-item':this._deleteWishlistItem(args.id); break;
      case 'move-wishlist-to-collection': this._moveWishlistToCollection(args.id); break;
      case 'toggle-wine-wishlist': this._toggleWineWishlist(args.id, t); break;
      // Notifications
      case 'allow-notif':         this._requestNotifications(); break;
      case 'dismiss-notif':       document.getElementById('notif-prompt-toast')?.remove(); break;
      case 'notif-request':       this._requestNotificationsFromSettings(); break;
      case 'notif-test':          this._sendTestNotif(); break;
      case 'show-about':          this._showAbout(); break;
      // PDF
      case 'export-pdf':          this.exportPdf(); break;
      // Cloud sync actions
      case 'sync-sign-in':        Sync.signIn(); break;
      case 'sync-sign-out':       Sync.signOut(); break;
      case 'sync-create':         Sync.createHousehold(); break;
      case 'sync-join':           this._syncJoin(); break;
      case 'sync-leave':          this._syncLeave(); break;
      // Wine location — jump directly to a cellar from the detail card
      case 'goto-cellar': {
        this.closeModal();
        this.view = 'cellar';
        this.cellarDetailId = args.cellarid;
        this.renderView();
        this.renderNav();
        setTimeout(() => { this._initRackHover(); this._initRackZoom(); }, 0);
        break;
      }
    }
  },

  _delegateChange(e) {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    if (t.dataset.action === 'notif-toggle') {
      this._handleNotifToggle(t.dataset.key, t.checked);
    }
  },

  _requestNotificationsFromSettings() {
    if (!('Notification' in window)) return;
    Notification.requestPermission().then(() => {
      // Re-render settings so status badge + toggles update
      this.navigate('settings');
    });
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SCAN VIEW
  // ══════════════════════════════════════════════════════════════════════════
  buildScanView() {
    return `
    <div id="scan-view">
      <div class="camera-area">
        <video id="camera-video" autoplay playsinline muted></video>
        <canvas id="camera-canvas"></canvas>
        <div class="camera-overlay"><div class="camera-frame"></div></div>
        <div class="camera-placeholder" id="camera-placeholder">
          <p class="scan-instruction-text">${this.t('scan.instruction')}</p>
        </div>
      </div>
      <div class="scan-controls">
        <div id="scan-status" class="scan-status">&nbsp;</div>
        <!-- Branded header: mark · camera button · wordmark -->
        <div class="scan-brand-row">
          <img src="Vinage Logo Pic.png" class="scan-brand-mark" alt="" draggable="false">
          <button class="capture-btn" id="capture-btn" data-action="start-camera" title="${this.t('scan.startCamera')}">
            ${this._iconCamera()}
          </button>
          <img src="Vinage Logo Name.png" class="scan-brand-name" alt="Vinage" draggable="false">
        </div>
        <div id="scan-action-row" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;align-items:center;">
          <button class="btn btn-secondary btn-icon" id="rotate-btn" data-action="rotate-camera"
                  title="Rotate image" style="display:none">${this._iconRotate()}</button>
        </div>
        <button class="btn btn-ghost btn-full" data-action="manual-add-wine" style="margin-top:4px">${this.t('scan.manualAdd')}</button>
      </div>
    </div>`;
  },

  initCamera() {
    // Restore capture btn icon to camera (start state)
    this.capturedImage     = null;
    this.capturedMedium    = null;
    this.capturedThumbnail = null;
    this.scanResult = null;
    // Restore the last rotation the user set — so they never have to rotate again
    const saved = DB.getSettings().preferredScanRotation;
    if (saved !== undefined) this._scanRotation = saved;
    const btn = document.getElementById('capture-btn');
    if (btn) { btn.dataset.action = 'start-camera'; }
  },

  async startCamera() {
    const placeholder = document.getElementById('camera-placeholder');
    const video = document.getElementById('camera-video');
    const btn = document.getElementById('capture-btn');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } }
      });
      video.srcObject = this.stream;
      if (placeholder) placeholder.style.display = 'none';
      btn.dataset.action = 'capture';
      btn.innerHTML = this._iconCircle();
      this._setScanStatus('', '');
      // Show rotate button
      const rotateBtn = document.getElementById('rotate-btn');
      if (rotateBtn) rotateBtn.style.display = '';
      this._applyVideoRotation();
    } catch (err) {
      this._setScanStatus(this.t('scan.cameraError'), 'error');
    }
  },

  rotateScan() {
    this._scanRotation = (this._scanRotation + 90) % 360;
    this._applyVideoRotation();
    // Persist preferred rotation so next session starts correctly
    const s = DB.getSettings();
    s.preferredScanRotation = this._scanRotation;
    DB.saveSettings(s);
  },

  _applyVideoRotation() {
    const video = document.getElementById('camera-video');
    const area  = document.querySelector('.camera-area');
    if (!video) return;
    const r = this._scanRotation;
    video.style.transform = r ? `rotate(${r}deg)` : '';
    // For 90/270 we also need to swap dimensions so it fills the container
    if (r === 90 || r === 270) {
      const w = area ? area.clientWidth  : window.innerWidth;
      const h = area ? area.clientHeight : 300;
      const scale = Math.min(w / h, h / w);
      video.style.transform = `rotate(${r}deg) scale(${1 / scale})`;
    }
  },

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  },

  async captureAndAnalyze() {
    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('camera-canvas');
    if (!video || !this.stream) return;

    // Freeze frame — apply rotation so the AI receives an upright image
    const vw = video.videoWidth  || 640;
    const vh = video.videoHeight || 480;
    const rot = this._scanRotation;
    const swap = rot === 90 || rot === 270;
    canvas.width  = swap ? vh : vw;
    canvas.height = swap ? vw : vh;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.drawImage(video, -vw / 2, -vh / 2, vw, vh);
    ctx.restore();
    canvas.classList.add('show');
    this.stopCamera();

    // Tiny thumbnail — rack hover tooltip only (80×120 px, stays in localStorage)
    try {
      const tC = document.createElement('canvas');
      tC.width = 80; tC.height = 120;
      tC.getContext('2d').drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 80, 120);
      this.capturedThumbnail = tC.toDataURL('image/jpeg', 0.65).split(',')[1];
    } catch (_) { this.capturedThumbnail = null; }

    // Medium image — readable label, stored in IndexedDB (≈30–60 KB base64)
    try {
      const mC = document.createElement('canvas');
      const mW = 360, mH = Math.round(360 * canvas.height / canvas.width);
      mC.width = mW; mC.height = mH;
      mC.getContext('2d').drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, mW, mH);
      this.capturedMedium = mC.toDataURL('image/jpeg', 0.72).split(',')[1];
    } catch (_) { this.capturedMedium = null; }

    // Show retake button
    const actionRow = document.getElementById('scan-action-row');
    actionRow.innerHTML = `<button class="btn btn-secondary btn-sm" data-action="retake">${this.t('scan.retake')}</button>`;

    const btn = document.getElementById('capture-btn');
    btn.style.display = 'none';

    // Full-res capture — used for AI analysis only, never stored
    this.capturedImage = canvas.toDataURL('image/jpeg', .85).split(',')[1];

    const settings = DB.getSettings();
    const hasKey = (settings.anthropicKey || settings.openaiKey);
    if (!hasKey) {
      this._setScanStatus(this.t('scan.apiKeyMissing'), 'error');
      actionRow.innerHTML += ` <button class="btn btn-primary btn-sm" data-action="add-wine-from-scan">${this.t('scan.manualAdd')}</button>`;
      return;
    }

    this._setScanStatus(`<span class="spinner"></span>${this.t('scan.analyzing')}`, '');

    try {
      const result = await API.identifyWine(this.capturedImage, settings);
      if (result.error) {
        this._setScanStatus(this.t('scan.notFound'), 'error');
        this.scanResult = null;
      } else {
        this.scanResult = result;
        this._setScanStatus(this.t('scan.found'), 'found');
        actionRow.innerHTML = `
          <button class="btn btn-primary" data-action="add-wine-from-scan">${this.t('scan.addToCollection')}</button>
          <button class="btn btn-secondary btn-sm" data-action="retake">${this.t('scan.retake')}</button>`;
      }
    } catch (err) {
      this._setScanStatus(this.t('common.error') + ' ' + err.message, 'error');
      actionRow.innerHTML = `
        <button class="btn btn-ghost btn-sm" data-action="add-wine-from-scan">${this.t('scan.manualAdd')}</button>
        <button class="btn btn-secondary btn-sm" data-action="retake">${this.t('scan.retake')}</button>`;
    }
  },

  retakeScan() {
    const canvas = document.getElementById('camera-canvas');
    if (canvas) canvas.classList.remove('show');
    const placeholder = document.getElementById('camera-placeholder');
    if (placeholder) placeholder.style.display = '';
    const btn = document.getElementById('capture-btn');
    if (btn) { btn.style.display = ''; btn.dataset.action = 'start-camera'; btn.innerHTML = this._iconCamera(); }
    const actionRow = document.getElementById('scan-action-row');
    if (actionRow) actionRow.innerHTML = `
      <button class="btn btn-secondary btn-icon" id="rotate-btn" data-action="rotate-camera"
              title="Rotate image" style="display:none">${this._iconRotate()}</button>`;
    this._setScanStatus('', '');
    this.capturedImage     = null;
    this.capturedMedium    = null;
    this.capturedThumbnail = null;
    this.scanResult        = null;
    // Keep _scanRotation at its current (remembered) value — don't reset to 0
    this.startCamera();
  },

  _setScanStatus(html, cls) {
    const el = document.getElementById('scan-status');
    if (!el) return;
    el.innerHTML = html;
    el.className = 'scan-status' + (cls ? ' ' + cls : '');
  },

  // ══════════════════════════════════════════════════════════════════════════
  // WINE FORM MODAL
  // ══════════════════════════════════════════════════════════════════════════
  showWineForm(prefill) {
    const wine = prefill || {};
    this.editWineId = wine.id || null;
    this._formRating = wine.rating || 0;
    this._formType   = wine.type   || 'red';
    // Clear pending wishlist delete unless explicitly set before this call
    if (!prefill || prefill.id) this._pendingWishlistDeleteId = null;

    const types = ['red','white','rosé','sparkling','dessert','fortified'];
    const title = this.editWineId ? this.t('common.edit') : this.t('scan.addToCollection');

    // Image for form preview: freshly captured medium → imageUrl → tiny thumb placeholder
    const thumbB64 = wine.thumbnail ? `data:image/jpeg;base64,${wine.thumbnail}` : null;
    const onerrorAttr = (wine.imageUrl && thumbB64)
      ? `onerror="this.src='${thumbB64}';this.className='wine-form-image wine-form-image--thumb';this.onerror=null"`
      : `onerror="this.style.display='none'"`;
    // Freshly scanned: show medium immediately. Editing existing: start with thumb,
    // editWine() will async-upgrade to the IndexedDB medium image after render.
    const imageHtml = this.capturedMedium
      ? `<img class="wine-form-image" id="wf-preview-img" src="data:image/jpeg;base64,${this.capturedMedium}" alt="label">`
      : wine.imageUrl
      ? `<img class="wine-form-image" id="wf-preview-img" src="${wine.imageUrl}" alt="label" ${onerrorAttr}>`
      : thumbB64
      ? `<img class="wine-form-image wine-form-image--thumb" id="wf-preview-img" src="${thumbB64}" alt="label">`
      : '';

    const body = `
      ${imageHtml}
      <div class="form-group">
        <label>${this.t('wine.name')} *</label>
        <input id="wf-name" class="form-control" value="${this._esc(wine.name||'')}" placeholder="e.g. Château Margaux">
      </div>
      <div class="form-group">
        <label>${this.t('wine.producer')}</label>
        <input id="wf-producer" class="form-control" value="${this._esc(wine.producer||'')}">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group">
          <label>${this.t('wine.vintage')}</label>
          <input id="wf-vintage" class="form-control" type="number" min="1800" max="2100"
                 value="${wine.vintage||''}" placeholder="${new Date().getFullYear()}"
                 data-prev-vintage="${wine.vintage||''}"
                 onchange="App._onVintageChange(this)">
        </div>
        <div class="form-group">
          <label>${this.t('wine.quantity')}</label>
          <input id="wf-qty" class="form-control" type="number" min="0" value="${wine.quantity != null ? wine.quantity : 1}">
        </div>
      </div>
      <div class="form-group">
        <label>${this.t('wine.type')}</label>
        <div class="type-selector" id="wf-type-sel">
          ${types.map(tp => `
            <button class="type-option${this._formType===tp?' selected':''}" data-action="type-pick" data-type="${tp}">
              ${this.t('types.'+tp)}
            </button>`).join('')}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group">
          <label>${this.t('wine.region')}</label>
          <input id="wf-region" class="form-control" value="${this._esc(wine.region||'')}">
        </div>
        <div class="form-group">
          <label>${this.t('wine.country')}</label>
          <input id="wf-country" class="form-control" value="${this._esc(wine.country||'')}">
        </div>
      </div>
      <div class="form-group">
        <label>${this.t('wine.grapes')}</label>
        <input id="wf-grapes" class="form-control" value="${this._esc((wine.grapes||[]).join(', '))}" placeholder="Cabernet Sauvignon, Merlot">
      </div>
      <div class="form-group">
        <label>${this.t('wine.pairings')}</label>
        <input id="wf-pairings" class="form-control" value="${this._esc((wine.pairings||[]).join(', '))}" placeholder="Beef, Cheese">
      </div>
      <div class="form-group">
        <label>${this.t('wine.tags')}</label>
        <input id="wf-tags" class="form-control" value="${this._esc((wine.tags||[]).join(', '))}" placeholder="Organic, Gift, Special Occasion">
      </div>
      <div class="form-group">
        <label>${this.t('wine.notes')}</label>
        <textarea id="wf-notes" class="form-control">${this._esc(wine.notes||'')}</textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group">
          <label>${this.t('wine.price')}</label>
          <input id="wf-price" class="form-control" type="number" min="0" step="0.01" value="${wine.price||''}">
        </div>
        <div class="form-group">
          <label>${this.t('wine.rating')}</label>
          <div class="star-picker" id="star-picker">
            ${[1,2,3,4,5].map(n => `
              <button class="star-btn${this._formRating>=n?' on':''}" data-action="star-pick" data-val="${n}">★</button>`).join('')}
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group">
          <label>${this.t('wine.drinkFrom')}</label>
          <input id="wf-drink-from" class="form-control" type="number" min="1980" max="2060"
                 value="${wine.drinkFrom||''}" placeholder="${new Date().getFullYear()}">
        </div>
        <div class="form-group">
          <label>${this.t('wine.drinkUntil')}</label>
          <input id="wf-drink-until" class="form-control" type="number" min="1980" max="2060"
                 value="${wine.drinkUntil||''}" placeholder="${new Date().getFullYear() + 5}">
        </div>
      </div>
      ${(() => {
        // ── Read-only location block (edit mode only) ──────────────────────
        if (!this.editWineId) return '';
        const places = DB.getWinePlacementMap()[this.editWineId];
        if (!places || places.length === 0) return '';
        const byCellar = {};
        places.forEach(p => {
          if (!byCellar[p.cellarId]) byCellar[p.cellarId] = { name: p.cellarName, id: p.cellarId, slots: [] };
          if (p.slot !== null) byCellar[p.cellarId].slots.push(this._slotPositionLabel(p.slot));
        });
        const rows = Object.values(byCellar).map(c => {
          const coords = c.slots.length
            ? c.slots.map(s => `<span class="location-coord-pill">${s}</span>`).join('')
            : `<span style="font-size:.78rem;opacity:.6">${this.lang==='nl'?'(Plank)':'(Shelf)'}</span>`;
          return `<div class="location-cellar-row">
            <button class="location-cellar-name" data-action="goto-cellar" data-cellarid="${c.id}">
              📍 ${this._esc(c.name)}
            </button>
            <div class="location-coords">${coords}</div>
          </div>`;
        }).join('');
        const label = this.lang === 'nl' ? 'Locatie in kelder' : 'Cellar location';
        return `<div class="form-group">
          <label>${label}</label>
          <div class="wine-location-block" style="margin-top:0;border-top:none;padding-top:0">${rows}</div>
        </div>`;
      })()}`;

    const footerBtns = [
      { label: this.t('common.cancel'), cls: 'btn-secondary', action: () => this.closeModal() },
      { label: this.t('common.save'),   cls: 'btn-primary',   action: () => this.saveWineForm(), id: 'wf-save-btn' }
    ];
    // Show "Open a bottle" only when editing an existing wine with stock
    if (this.editWineId) {
      const w = DB.getWineById(this.editWineId);
      if (w && (w.quantity || 1) > 0) {
        footerBtns.unshift({ label: '🍷 ' + this.t('consume.openBottle'), cls: 'btn-ghost', action: () => {
          this.closeModal(); this._consumeBottle(this.editWineId || w.id);
        }});
      }
    }
    this.showModal(title, body, footerBtns);
  },

  pickStar(val) {
    this._formRating = val;
    document.querySelectorAll('.star-btn').forEach((b, i) => b.classList.toggle('on', i < val));
  },

  pickType(type) {
    this._formType = type;
    document.querySelectorAll('.type-option').forEach(b => b.classList.toggle('selected', b.dataset.type === type));
  },

  // When the user finishes editing the vintage, shift drinkFrom/drinkUntil by the same delta.
  // Uses onchange (fires on blur) so the full new year is known before we calculate.
  _onVintageChange(input) {
    const newVin = parseInt(input.value, 10);
    const oldVin = parseInt(input.dataset.prevVintage, 10);
    if (!newVin || isNaN(newVin) || !oldVin || isNaN(oldVin) || newVin === oldVin) return;
    const delta = newVin - oldVin;

    const fromEl  = document.getElementById('wf-drink-from');
    const untilEl = document.getElementById('wf-drink-until');
    const fromVal  = parseInt(fromEl?.value,  10);
    const untilVal = parseInt(untilEl?.value, 10);
    if (fromEl  && !isNaN(fromVal))  fromEl.value  = fromVal  + delta;
    if (untilEl && !isNaN(untilVal)) untilEl.value = untilVal + delta;

    // Move the baseline forward so a second edit works correctly too
    input.dataset.prevVintage = newVin;
  },

  saveWineForm() {
    const name = document.getElementById('wf-name')?.value.trim();
    if (!name) { this.toast(this.t('wine.name') + ' is required', 'error'); return; }

    const parse = id => document.getElementById(id)?.value.trim() || '';
    const parseNum = id => { const v = document.getElementById(id)?.value; return v ? parseFloat(v) : null; };
    const parseList = id => parse(id).split(',').map(s => s.trim()).filter(Boolean);

    // Medium image (360px wide, ~30-60 KB) goes to IndexedDB — never localStorage
    const mediumForSave = this.capturedMedium || null;
    const data = {
      name,
      image:     null, // always null in localStorage; medium image lives in IndexedDB
      thumbnail: this.capturedThumbnail || null,
      producer: parse('wf-producer'),
      vintage:  parseNum('wf-vintage') ? parseInt(parse('wf-vintage'),10) : null,
      quantity: Math.max(0, parseInt(parse('wf-qty'), 10) || 0),
      type:     this._formType,
      region:   parse('wf-region'),
      country:  parse('wf-country'),
      grapes:   parseList('wf-grapes'),
      pairings: parseList('wf-pairings'),
      tags:     parseList('wf-tags'),
      notes:      parse('wf-notes'),
      price:      parseNum('wf-price'),
      rating:     this._formRating,
      drinkFrom:  parseNum('wf-drink-from')  ? parseInt(parse('wf-drink-from'),  10) : null,
      drinkUntil: parseNum('wf-drink-until') ? parseInt(parse('wf-drink-until'), 10) : null,
    };

    // Capture old quantity before saving (for quantity-increase detection)
    const oldWine    = this.editWineId ? DB.getWineById(this.editWineId) : null;
    const oldQty     = oldWine ? (oldWine.quantity ?? 1) : 0;
    const editWineId = this.editWineId; // stash before closeModal clears it

    let newWine = null;
    try {
      if (this.editWineId) {
        Sync.updateWine(this.editWineId, data);
      } else {
        newWine = Sync.addWine(data);
      }
    } catch (err) {
      this.toast('Opslaan mislukt: ' + err.message, 'error');
      return;
    }

    // Persist medium image to IndexedDB (no size limit, never blocks the save)
    const savedId = editWineId || newWine?.id;
    if (savedId && mediumForSave) {
      ImageDB.save(savedId, mediumForSave);
    }

    this.capturedImage     = null;
    this.capturedMedium    = null;
    this.capturedThumbnail = null;
    this.scanResult        = null;

    // If moved from wishlist, remove it
    if (this._pendingWishlistDeleteId) {
      DB.deleteWishlistItem(this._pendingWishlistDeleteId);
      this._pendingWishlistDeleteId = null;
    }

    this.closeModal();
    this.toast(this.t('common.save') + ' ✓', 'success');

    const fromScan = this.view === 'scan';
    if (this.view === 'collection') this.renderView();
    else if (fromScan) { this.navigate('collection'); }

    // After adding from scan, offer cellar placement
    if (newWine && fromScan) {
      setTimeout(() => this._promptCellarPlacement(newWine.id, newWine.quantity || 1, 1), 400);
    }

    // After editing, if quantity increased offer placement for the extra bottles
    if (editWineId && data.quantity > oldQty) {
      const extra = data.quantity - oldQty;
      setTimeout(() => this._promptCellarPlacement(editWineId, extra, 1), 400);
    }

    // After editing, if quantity decreased free the excess cellar placements
    if (editWineId && data.quantity < oldQty) {
      setTimeout(() => this._freeCellarPlacementsAfterDecrease(editWineId, oldQty - data.quantity), 400);
    }
  },

  // Free `count` cellar placements for a wine after a quantity decrease.
  // If there is only one placement, it is removed automatically.
  // If there are multiple, a picker is shown so the user chooses which slot to free.
  _freeCellarPlacementsAfterDecrease(wineId, count) {
    const wine = DB.getWineById(wineId);
    if (!wine) return;
    const map = DB.getWinePlacementMap();
    const placements = map[wineId] || [];

    // Nothing placed — nothing to free
    if (!placements.length) return;

    const doFree = (place) => {
      if (place.slot !== null) {
        DB.assignWineToSlot(place.cellarId, place.slot, null);
      } else {
        DB.removeWineFromShelf(place.cellarId, wineId);
      }
      this.renderView();
    };

    // Auto-free if only one placement exists or we need to free all of them
    if (placements.length <= count) {
      placements.forEach(p => doFree(p));
      this.toast('📦 ' + this.t('cellar.slotFreed'), 'info');
      return;
    }

    // Show a picker so the user selects which slots to free (one at a time)
    this._pickPlacementToFree(wineId, wine, placements, count, 1);
  },

  // Picker modal that asks the user to choose which cellar slot to free.
  _pickPlacementToFree(wineId, wine, placements, totalToFree, freeNum) {
    const lang = this.lang;
    const rows = placements.map(p => {
      const coord = p.slot ? this._slotPositionLabel(p.slot) : '—';
      const label = `${p.cellarName}${p.slot ? ' · ' + coord : ''}`;
      return `<button class="btn btn-secondary pick-free-slot" data-cellar-id="${p.cellarId}" data-slot="${p.slot ?? ''}">${label}</button>`;
    }).join('');
    const title = lang === 'nl'
      ? `Welk vak vrijmaken? (${freeNum}/${totalToFree})`
      : `Which slot to free? (${freeNum}/${totalToFree})`;

    this.showModal(`
      <div class="modal-header"><h2>${title}</h2></div>
      <div class="modal-body">
        <p style="color:var(--text-secondary);margin-bottom:12px">
          ${lang === 'nl'
            ? `Je hebt de hoeveelheid verlaagd. Kies welk vak je wil vrijmaken voor <strong>${wine.name || wine.producer}</strong>.`
            : `You reduced the quantity. Choose which slot to free for <strong>${wine.name || wine.producer}</strong>.`}
        </p>
        <div class="pick-slot-list" style="display:flex;flex-direction:column;gap:8px">${rows}</div>
      </div>
    `);

    // One-shot delegate for picking
    const handler = (e) => {
      const btn = e.target.closest('.pick-free-slot');
      if (!btn) return;
      document.removeEventListener('click', handler);
      const cellarId = btn.dataset.cellarId;
      const slot     = btn.dataset.slot || null;
      if (slot) {
        DB.assignWineToSlot(cellarId, slot, null);
      } else {
        DB.removeWineFromShelf(cellarId, wineId);
      }
      this.closeModal();
      this.renderView();

      // If more slots still need to be freed, reopen the picker
      if (freeNum < totalToFree) {
        const updatedMap   = DB.getWinePlacementMap();
        const updatedPlaces = updatedMap[wineId] || [];
        if (updatedPlaces.length) {
          setTimeout(() => this._pickPlacementToFree(wineId, wine, updatedPlaces, totalToFree, freeNum + 1), 300);
        }
      } else {
        this.toast('📦 ' + this.t('cellar.slotFreed'), 'info');
      }
    };
    setTimeout(() => document.addEventListener('click', handler), 50);
  },

  editWine(id) {
    const wine = DB.getWineById(id);
    if (!wine) return;
    this.capturedImage     = null;
    this.capturedMedium    = null; // medium image lives in IndexedDB
    this.capturedThumbnail = wine.thumbnail || null;
    this.showWineForm(wine);
    // After form renders, async-load medium image from IndexedDB and upgrade the preview
    ImageDB.get(id).then(img => {
      if (!img) return;
      this.capturedMedium = img; // so saveWineForm preserves it if user doesn't retake
      const el = document.getElementById('wf-preview-img');
      if (el) {
        el.src       = 'data:image/jpeg;base64,' + img;
        el.className = 'wine-form-image'; // upgrade from thumb to full-width
      }
    });
  },

  // ── Duplicate detection ───────────────────────────────────────────────────
  _findDuplicate(scan) {
    if (!scan || !scan.name) return null;
    const n = scan.name.toLowerCase().trim();
    const v = scan.vintage;
    return DB.getWines().find(w => {
      if ((w.name||'').toLowerCase().trim() !== n) return false;
      if (v && w.vintage && v !== w.vintage) return false;
      return true;
    }) || null;
  },

  _showDuplicateWarning(existing, scan) {
    const hasVin = existing.vintage;
    const key = hasVin ? 'dupBody' : 'dupBodyNoVintage';
    const body = this.t('scan.' + key, { name: this._esc(existing.name), vintage: existing.vintage || '' });
    this.showModal(this.t('scan.dupTitle'), `<p>${body}</p>`, [
      { label: this.t('scan.dupViewExisting'), cls: 'btn-secondary', action: () => {
          this.closeModal(); this.editWine(existing.id);
        }
      },
      { label: this.t('scan.dupAddAnyway'), cls: 'btn-primary', action: () => {
          this.closeModal(); this.showWineForm(scan);
        }
      }
    ]);
  },

  // ── Post-scan cellar placement ────────────────────────────────────────────
  _promptCellarPlacement(wineId, totalQty, bottleNum) {
    const wine = DB.getWineById(wineId);
    if (!wine) return;
    const cellars = DB.getCellars();
    if (!cellars.length) {
      // No cellars yet — silent skip (user can place manually later)
      return;
    }
    const isMulti = totalQty > 1;
    const bodyKey = isMulti ? 'cellarPlaceBodyMulti' : 'cellarPlaceBody';
    const body = this.t('scan.' + bodyKey, {
      name: this._esc(wine.name), qty: totalQty, n: bottleNum
    });
    // Build cellar selector
    const cellarOpts = cellars.map(c => {
      const cap = c.type === 'shelf' ? '∞' : (c.rows||0) * (c.cols||0);
      return `<button class="btn btn-secondary" style="width:100%;margin-bottom:6px;text-align:left"
                data-cellar-pick="${c.id}">${this._esc(c.name)} <small style="opacity:.6">${cap} slots</small></button>`;
    }).join('');
    this.showModal(
      this.t('scan.cellarPlaceTitle'),
      `<p style="margin-bottom:12px">${body}</p>${cellarOpts}`,
      [{ label: this.t('scan.cellarPlaceSkip'), cls: 'btn-ghost', action: () => this.closeModal() }]
    );
    // Wire cellar pick buttons
    setTimeout(() => {
      document.querySelectorAll('[data-cellar-pick]').forEach(btn => {
        btn.onclick = () => {
          const cellarId = btn.dataset.cellarPick;
          this.closeModal();
          // Navigate directly to the chosen cellar detail — bypass navigate()
          // because navigate() resets cellarDetailId to null before rendering.
          this.view = 'cellar';
          this.cellarDetailId = cellarId;
          this.renderView();
          this.renderNav();
          // After render, arm the auto-place mode for this wine
          setTimeout(() => {
            this._pendingPlaceWineId    = wineId;
            this._pendingPlaceTotalQty  = totalQty;
            this._pendingPlaceBottleNum = bottleNum;
            this._openPickerForPending();
          }, 350);
        };
      });
    }, 50);
  },

  _openPickerForPending() {
    const wineId    = this._pendingPlaceWineId;
    const totalQty  = this._pendingPlaceTotalQty;
    const bottleNum = this._pendingPlaceBottleNum;
    if (!wineId) return;
    this._pendingPlaceWineId = null;
    // Open the wine picker modal — reuse existing assignWineToSlot picker, but
    // instead pre-select the wine and open the slot picker directly.
    // We show an instruction toast, then open the slot picker for an empty slot.
    const wine = DB.getWineById(wineId);
    if (!wine) return;
    this.toast(`📍 ${this.t('cellar.assignWine')}: ${this._esc(wine.name)}`, 'success');
    // Store the pre-selected wine so handleSlotClick skips the wine-picker step
    this._autoPlaceWineId    = wineId;
    this._autoPlaceTotalQty  = totalQty;
    this._autoPlaceBottleNum = bottleNum;
  },

  // ── Consumption tracking ──────────────────────────────────────────────────
  _consumeBottle(wineId) {
    const wine = DB.getWineById(wineId);
    if (!wine) return;

    const places = (DB.getWinePlacementMap()[wineId] || []);

    if (places.length <= 1) {
      // 0 or 1 location — no picker needed
      this._doConsumeBottle(wine, places[0] || null);
    } else {
      // Multiple locations — let user pick which bottle
      const opts = places.map(p => {
        const coord = p.slot ? this._slotPositionLabel(p.slot) : null;
        const label = coord
          ? `📍 ${this._esc(p.cellarName)} · ${coord}`
          : `📍 ${this._esc(p.cellarName)} (${this.lang === 'nl' ? 'Plank' : 'Shelf'})`;
        return `<button class="btn btn-secondary" style="width:100%;margin-bottom:8px;text-align:left"
                  data-pick-cellar="${p.cellarId}" data-pick-slot="${p.slot || ''}">${label}</button>`;
      }).join('');
      this.showModal(
        this.t('consume.openBottle'),
        `<p style="margin-bottom:12px">${this.t('consume.pickLocation')}</p>${opts}`,
        [{ label: this.t('common.cancel'), cls: 'btn-ghost', action: () => this.closeModal() }]
      );
      setTimeout(() => {
        document.querySelectorAll('[data-pick-cellar]').forEach(btn => {
          btn.onclick = () => {
            const cellarId = btn.dataset.pickCellar;
            const slot     = btn.dataset.pickSlot || null;
            const place    = { cellarId, cellarName: places.find(p => p.cellarId === cellarId)?.cellarName || '', slot: slot || null };
            this.closeModal();
            this._doConsumeBottle(wine, place);
          };
        });
      }, 50);
    }
  },

  _doConsumeBottle(wine, place) {
    // Remove from cellar slot/shelf
    if (place) {
      if (place.slot) {
        Sync.assignWineToSlot(place.cellarId, place.slot, null);
      } else {
        DB.removeWineFromShelf(place.cellarId, wine.id);
      }
    }

    // Log to consumption history
    DB.logConsumption({
      wineId:        wine.id,
      wineName:      wine.name,
      wineType:      wine.type,
      wineVintage:   wine.vintage || null,
      fromCellarId:  place?.cellarId   || null,
      fromCellarName:place?.cellarName || null,
      fromSlot:      place?.slot       || null,
      price:         wine.price        || null,
    });

    const newQty = (wine.quantity || 1) - 1;

    if (newQty <= 0) {
      // Last bottle — ask keep or delete
      this.showModal(
        this.t('consume.lastBottleTitle'),
        `<p>${this.t('consume.lastBottleBody', { name: this._esc(wine.name) })}</p>`,
        [
          { label: this.t('consume.keep'), cls: 'btn-secondary', action: () => {
            Sync.updateWine(wine.id, { quantity: 0 });
            this.closeModal(); this.renderView();
            this.toast(this.t('consume.toasted'), 'success');
          }},
          { label: this.t('consume.remove'), cls: 'btn-danger', action: () => {
            Sync.deleteWine(wine.id);
            ImageDB.delete(wine.id);
            this.closeModal(); this.renderView();
            this.toast(this.t('consume.toasted'), 'success');
          }},
        ]
      );
    } else {
      Sync.updateWine(wine.id, { quantity: newQty });
      this.renderView();
      this.toast(this.t('consume.toasted'), 'success');
    }
  },

  confirmDeleteWine(id) {
    const wine = DB.getWineById(id);
    if (!wine) return;
    this.showModal(
      this.t('common.delete'),
      `<p>Delete <strong>${this._esc(wine.name)}</strong>?</p>`,
      [
        { label: this.t('common.cancel'), cls: 'btn-secondary', action: () => this.closeModal() },
        { label: this.t('common.delete'), cls: 'btn-danger', action: () => {
          Sync.deleteWine(id);
          ImageDB.delete(id); // free IndexedDB image too
          this.closeModal(); this.renderView(); this.toast('Deleted', 'success');
        }}
      ]
    );
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CELLAR VIEW — List
  // ══════════════════════════════════════════════════════════════════════════
  buildCellarList() {
    const cellars = DB.getCellars();
    const mapSection = cellars.length > 0 ? this._buildCellarMapSection(cellars) : '';
    return `
    <div class="page-header">
      <h1>${this.t('cellar.title')}</h1>
      <div class="header-actions">
        <button class="btn btn-primary btn-sm" data-action="add-cellar">${this.t('cellar.addLocation')}</button>
      </div>
    </div>
    ${mapSection}
    <div class="cellar-list">
      ${cellars.length === 0
        ? `<div class="empty-state">${this._iconCellarLg()}<p>${this.t('cellar.noLocations')}</p></div>`
        : cellars.map(c => this._buildCellarCard(c)).join('')}
    </div>`;
  },

  _buildCellarMapSection(cellars) {
    const isOpen = this._cellarMapOpen;
    const miniMaps = cellars.map(c => {
      const stats = DB.getCellarStats(c);
      const pct = stats.capacity ? Math.round(stats.occupied / stats.capacity * 100) : null;
      let dots = '';
      if (c.slots) {
        const entries = Object.entries(c.slots).slice(0, 40);
        dots = entries.map(([, wid]) => wid
          ? `<div class="map-dot map-dot-filled" style="background:${this._typeColor((DB.getWineById(wid)||{}).type||'red')}"></div>`
          : `<div class="map-dot map-dot-empty"></div>`
        ).join('');
      } else if (c.wines) {
        dots = c.wines.slice(0,20).map(id => {
          const w = DB.getWineById(id);
          return `<div class="map-dot map-dot-filled" style="background:${this._typeColor((w||{}).type||'red')}"></div>`;
        }).join('');
      }
      return `
      <div class="cellar-mini-map" data-action="open-cellar" data-id="${c.id}">
        <div class="mini-map-name">${this._esc(c.name)}</div>
        <div class="mini-map-dots">${dots}</div>
        ${pct !== null ? `<div class="mini-map-pct">${pct}%</div>` : `<div class="mini-map-pct">${stats.occupied}</div>`}
      </div>`;
    }).join('');

    return `
    <div class="cellar-map-section">
      <div class="cellar-map-header" data-action="toggle-cellar-map">
        <span class="cellar-map-title">${this.t('common.cellarMapTitle')}</span>
        <span class="cellar-map-toggle">${isOpen ? this.t('common.cellarMapCollapse') : this.t('common.cellarMapExpand')}</span>
      </div>
      ${isOpen ? `<div class="cellar-mini-maps-row">${miniMaps}</div>` : ''}
    </div>`;
  },

  _buildCellarCard(c) {
    const stats = DB.getCellarStats(c);
    const typeLabel = this.t('cellar.types.' + c.type);
    return `
    <div class="card cellar-card" data-action="open-cellar" data-id="${c.id}">
      <div class="cellar-card-header">
        <h3>${this._esc(c.name)}</h3>
        <span class="cellar-type-tag">${typeLabel}</span>
      </div>
      <div class="cellar-card-stats">
        <span class="cellar-stat"><strong>${stats.occupied}</strong> ${this.t('cellar.occupied')}</span>
        ${stats.capacity !== null
          ? `<span class="cellar-stat"><strong>${stats.empty}</strong> ${this.t('cellar.empty')}</span>
             <span class="cellar-stat">${this.t('cellar.capacity')}: <strong>${stats.capacity}</strong></span>`
          : ''}
      </div>
    </div>`;
  },

  openCellarDetail(id) {
    // Zoom is persisted per-cellar in localStorage — no manual reset needed
    this.cellarDetailId = id;
    this.renderView();
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CELLAR VIEW — Detail (rack visual)
  // ══════════════════════════════════════════════════════════════════════════
  buildCellarDetail() {
    const c = DB.getCellars().find(c => c.id === this.cellarDetailId);
    if (!c) return this.buildCellarList();

    const stats = DB.getCellarStats(c);
    let rackHtml = '';
    if      (c.type === 'grid')    rackHtml = this._buildGridRack(c, false);
    else if (c.type === 'diamond') rackHtml = this._buildGridRack(c, true);
    else if (c.type === 'case')    rackHtml = this._buildCaseRack(c);
    else                           rackHtml = this._buildShelfRack(c);

    return `
    <div class="page-header">
      <button class="btn btn-icon" data-action="back-cellar" aria-label="${this.t('common.back')}">${this._iconBack()}</button>
      <h1>${this._esc(c.name)}</h1>
      <div class="header-actions">
        <button class="btn btn-danger btn-sm" data-action="delete-cellar" data-id="${c.id}">${this._iconTrash()}</button>
      </div>
    </div>
    <div class="rack-container">
      <div class="rack-title">
        ${this.t('cellar.types.' + c.type)}
        ${stats.capacity !== null
          ? `<span style="font-size:.8rem;font-weight:400;color:var(--text-lt)">${stats.occupied}/${stats.capacity}</span>`
          : `<span style="font-size:.8rem;font-weight:400;color:var(--text-lt)">${stats.occupied} ${this.t('cellar.bottles')}</span>`}
        <div class="rack-zoom-bar">
          <button class="rack-zoom-btn" id="zoom-out-btn" title="Zoom out">−</button>
          <span class="rack-zoom-level" id="rack-zoom-level">100%</span>
          <button class="rack-zoom-btn" id="zoom-in-btn" title="Zoom in">+</button>
          <button class="rack-zoom-btn" id="zoom-reset-btn" title="Reset zoom" style="font-size:.7rem;font-weight:800">⊡</button>
        </div>
      </div>
      <div class="rack-subtitle">${this.t('cellar.typeDescriptions.' + c.type)}</div>
      <div class="rack-zoom-container" id="rack-zoom-container">
        <div id="rack-zoom-inner">${rackHtml}</div>
      </div>
    </div>`;
  },

  _buildGridRack(c, diamond) {
    if (diamond) {
      // Diamond rack — wrap in wood frame but keep offset-row layout
      let rows = '';
      for (let r = 0; r < c.rows; r++) {
        let cells = '';
        for (let col = 0; col < c.cols; col++) {
          const key = `${r}-${col}`;
          const wineId = c.slots[key];
          const wine = wineId ? DB.getWineById(wineId) : null;
          cells += this._buildSlot(c.id, key, wine);
        }
        rows += `<div class="rack-row">${cells}</div>`;
      }
      return `<div class="rack-wood-frame"><div class="rack-diamond">${rows}</div></div>`;
    }

    // Grid rack — Excel style: column letters (A,B,C…) across top, row numbers (1,2,3…) down left
    let colLabels = `<div class="rack-corner"></div>`;
    for (let col = 0; col < c.cols; col++) {
      colLabels += `<div class="rack-col-label">${String.fromCharCode(65 + col % 26)}</div>`;
    }

    // Rows with numeric labels
    let rows = '';
    for (let r = 0; r < c.rows; r++) {
      let cells = `<div class="rack-row-lbl">${r + 1}</div>`;
      for (let col = 0; col < c.cols; col++) {
        const key = `${r}-${col}`;
        const wineId = c.slots[key];
        const wine = wineId ? DB.getWineById(wineId) : null;
        cells += this._buildSlot(c.id, key, wine);
      }
      rows += `<div class="rack-body-row">${cells}</div>`;
    }

    return `
      <div class="rack-wood-frame">
        <div class="rack-col-labels">${colLabels}</div>
        <div class="rack-body">${rows}</div>
      </div>`;
  },

  _buildCaseRack(c) {
    let cells = '';
    for (let i = 0; i < 12; i++) {
      const wineId = c.slots[String(i)];
      const wine = wineId ? DB.getWineById(wineId) : null;
      cells += this._buildSlot(c.id, String(i), wine);
    }
    return `<div class="rack-wood-frame" style="display:inline-block;min-width:auto"><div class="rack-case">${cells}</div></div>`;
  },

  _buildShelfRack(c) {
    const wines = (c.wines || []).map(id => DB.getWineById(id)).filter(Boolean);
    const items = wines.map(w => `
      <div class="shelf-item">
        <div class="shelf-bottle-dot" style="background:${this._typeColor(w.type)}"></div>
        <div style="flex:1;min-width:0">
          <div class="shelf-wine-name">${this._esc(w.name)}</div>
          <div class="shelf-wine-meta">${[w.vintage, this.t('types.'+w.type), w.region].filter(Boolean).join(' · ')}</div>
        </div>
        <button class="btn btn-icon btn-sm" data-action="remove-from-shelf" data-cellarid="${c.id}" data-wineid="${w.id}" title="Remove">
          ${this._iconX()}
        </button>
      </div>`).join('');

    return `
    <div class="shelf-list">
      ${items}
      <div class="shelf-add-btn" data-action="add-to-shelf" data-cellarid="${c.id}">
        + ${this.t('cellar.assignWine')}
      </div>
    </div>`;
  },

  _slotPositionLabel(slotKey) {
    const s = String(slotKey);
    if (s.includes('-')) {
      const [r, c] = s.split('-').map(Number);
      // Excel: column = letter (A,B,C…) across top; row = number down left  e.g. D3
      return String.fromCharCode(65 + c % 26) + (r + 1);
    }
    // Case rack 0-11: cols A-D repeat across, rows 1-3 downward
    const i = parseInt(s, 10);
    return String.fromCharCode(65 + (i % 4)) + (Math.floor(i / 4) + 1);
  },

  _buildSlot(cellarId, slotKey, wine) {
    const pos = this._slotPositionLabel(slotKey);
    if (wine) {
      const cls = this._typeClass(wine.type);
      // Data attributes for the hover tooltip
      // For tooltip: prefer thumbnail (local b64), else use remote imageUrl
      const twImg = wine.thumbnail
        ? ` data-tw-img="${wine.thumbnail}" data-tw-img-type="b64"`
        : wine.imageUrl
        ? ` data-tw-img="${this._esc(wine.imageUrl)}" data-tw-img-type="url"`
        : '';
      return `
      <div class="slot occupied ${cls}"
           data-action="click-slot" data-cellarid="${cellarId}" data-slot="${slotKey}" data-wineid="${wine.id}"
           data-tw-name="${this._esc(wine.name)}"
           data-tw-producer="${this._esc(wine.producer||'')}"
           data-tw-vintage="${wine.vintage||''}"
           data-tw-type="${wine.type}"
           data-tw-pos="${pos}"${twImg}>
        <div class="bottle-top"></div>
        <div class="slot-label">${pos}</div>
      </div>`;
    }
    return `
    <div class="slot"
         data-action="click-slot" data-cellarid="${cellarId}" data-slot="${slotKey}" data-wineid="">
      <div class="slot-pos">${pos}</div>
    </div>`;
  },

  _initRackZoom() {
    const container = document.getElementById('rack-zoom-container');
    const inner     = document.getElementById('rack-zoom-inner');
    if (!container || !inner) return;

    // Read natural dimensions before any transform so we can resize container correctly
    const origW = inner.scrollWidth;
    const origH = inner.scrollHeight;

    // Restore saved zoom for this cellar (falls back to in-memory value)
    const zoomKey = `vinage_rack_zoom_${this.cellarDetailId}`;
    const saved = parseFloat(localStorage.getItem(zoomKey));
    if (!isNaN(saved)) this._rackZoom = saved;

    const applyZoom = (z) => {
      this._rackZoom = Math.max(0.35, Math.min(3.0, z));
      const sz = this._rackZoom;
      inner.style.transform = `scale(${sz})`;
      inner.style.transformOrigin = 'top left';
      // Expand/shrink container so scroll area matches scaled content
      container.style.minWidth  = (origW * sz) + 'px';
      container.style.minHeight = (origH * sz) + 'px';
      const lvl = document.getElementById('rack-zoom-level');
      if (lvl) lvl.textContent = Math.round(sz * 100) + '%';
      // Persist per-cellar zoom so it survives navigation
      localStorage.setItem(zoomKey, this._rackZoom);
    };

    document.getElementById('zoom-in-btn')?.addEventListener('click',    () => applyZoom(this._rackZoom + 0.2));
    document.getElementById('zoom-out-btn')?.addEventListener('click',   () => applyZoom(this._rackZoom - 0.2));
    document.getElementById('zoom-reset-btn')?.addEventListener('click', () => applyZoom(1.0));

    // Pinch-to-zoom (touch devices)
    let pinchDist0 = 0, zoom0 = 1;
    container.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        pinchDist0 = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        zoom0 = this._rackZoom;
      }
    }, { passive: true });
    container.addEventListener('touchmove', e => {
      if (e.touches.length !== 2) return;
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      applyZoom(zoom0 * dist / pinchDist0);
      e.preventDefault();
    }, { passive: false });

    // Ctrl+scroll-wheel zoom on desktop
    container.addEventListener('wheel', e => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        applyZoom(this._rackZoom - e.deltaY * 0.004);
      }
    }, { passive: false });

    // Restore current zoom level (persists between re-renders of same cellar)
    applyZoom(this._rackZoom);
  },

  _buildWineMap(c) {
    const map = {};
    if (c.slots) Object.entries(c.slots).forEach(([k,v]) => { if(v) map[v] = k; });
    return map;
  },

  _initRackHover() {
    // Only activate on hover-capable devices (desktops)
    if (!window.matchMedia('(hover: hover)').matches) return;
    const tooltip = document.getElementById('rack-tooltip');
    if (!tooltip) return;

    const hide = () => tooltip.classList.remove('visible');

    document.querySelectorAll('.slot.occupied[data-tw-name]').forEach(slot => {
      slot.addEventListener('mouseenter', () => {
        const name     = slot.dataset.twName     || '';
        const producer = slot.dataset.twProducer || '';
        const vintage  = slot.dataset.twVintage  || '';
        const type     = slot.dataset.twType     || 'red';
        const pos      = slot.dataset.twPos      || '';
        const img      = slot.dataset.twImg      || '';
        const imgType  = slot.dataset.twImgType  || 'b64';

        const metaParts = [producer, vintage, this.t('types.' + type)].filter(Boolean);
        const imgSrc = img
          ? (imgType === 'url' ? img : `data:image/jpeg;base64,${img}`)
          : '';

        tooltip.innerHTML = `
          <div class="rack-tooltip-card">
            ${imgSrc ? `<img class="rack-tooltip-img" src="${imgSrc}" alt="">` : ''}
            <div class="rack-tooltip-body">
              <div class="rack-tooltip-pos">${this._esc(pos)}</div>
              <div class="rack-tooltip-name">${this._esc(name)}</div>
              <div class="rack-tooltip-meta">
                <span class="rack-tooltip-dot" style="background:${this._typeColor(type)}"></span>
                ${this._esc(metaParts.join(' · '))}
              </div>
            </div>
          </div>`;

        // Position near the slot, flipping below when near the top of the viewport
        const rect     = slot.getBoundingClientRect();
        const tipW     = 190;
        // Estimate tooltip height: image (110px) + text body (~80px) + padding
        const tipEstH  = imgSrc ? 210 : 100;
        const spaceAbove = rect.top;
        const showBelow  = spaceAbove < tipEstH + 16;

        let left = rect.left + rect.width / 2 - tipW / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));

        const anchorTop = rect.top + window.scrollY;
        tooltip.style.left  = left + 'px';
        tooltip.style.width = tipW + 'px';

        if (showBelow) {
          tooltip.style.top       = (anchorTop + rect.height + 10) + 'px';
          tooltip.style.transform = 'none';
        } else {
          tooltip.style.top       = anchorTop + 'px';
          tooltip.style.transform = 'translateY(calc(-100% - 10px))';
        }
        tooltip.classList.add('visible');
      });

      slot.addEventListener('mouseleave', hide);
    });

    // Hide when scrolling (so tooltip doesn't drift)
    document.getElementById('main-content')?.addEventListener('scroll', hide, { passive: true });
  },

  handleSlotClick(cellarId, slot, wineId) {
    // Auto-place mode: a wine is pre-selected from the post-scan flow
    if (!wineId && this._autoPlaceWineId) {
      const autoId    = this._autoPlaceWineId;
      const totalQty  = this._autoPlaceTotalQty  || 1;
      const bottleNum = this._autoPlaceBottleNum || 1;
      this._autoPlaceWineId = null;
      Sync.assignWineToSlot(cellarId, slot, autoId);
      this.renderView();
      setTimeout(() => { this._initRackHover(); this._initRackZoom(); }, 0);
      if (bottleNum < totalQty) {
        setTimeout(() => this._promptCellarPlacement(autoId, totalQty, bottleNum + 1), 400);
      } else {
        this.toast('📍 ' + this.t('cellar.assignWine') + ' ✓', 'success');
      }
      return;
    }
    if (wineId) {
      const wine = DB.getWineById(wineId);
      if (!wine) return;
      this.showModal(
        this._esc(wine.name),
        `<div class="card-body" style="text-align:center">
          ${this._buildWineCardInner(wine)}
        </div>`,
        [
          { label: '🍷 ' + this.t('consume.openBottle'), cls: 'btn-primary', action: () => {
            this.closeModal(); this._consumeBottle(wineId);
          }},
          { label: this.t('common.edit'), cls: 'btn-secondary', action: () => {
            this.closeModal(); this.editWine(wineId);
          }},
          { label: this.t('cellar.removeWine'), cls: 'btn-danger', action: () => {
            Sync.assignWineToSlot(cellarId, slot, null);
            this.closeModal(); this.renderView();
          }},
        ]
      );
    } else {
      this.showWinePickerForSlot(cellarId, slot);
    }
  },

  showWinePickerForSlot(cellarId, slotKey) {
    const wines = DB.getWines();
    this._renderWinePicker(wines, cellarId, slotKey, false);
  },

  showWinePickerForShelf(cellarId) {
    const wines = DB.getWines();
    this._renderWinePicker(wines, cellarId, null, true);
  },

  _renderWinePicker(allWines, cellarId, slotKey, isShelf) {
    const listId = 'wine-picker-list';
    const searchId = 'wine-picker-search';
    const render = (filter) => {
      const filtered = allWines.filter(w =>
        w.name.toLowerCase().includes(filter.toLowerCase()) ||
        (w.producer||'').toLowerCase().includes(filter.toLowerCase())
      );
      const list = document.getElementById(listId);
      if (!list) return;
      list.innerHTML = (filtered.length === 0
        ? `<div style="text-align:center;color:var(--text-lt);padding:24px">${this.t('common.none')}</div>`
        : filtered.map(w => `
          <div class="wine-picker-item" data-action="${isShelf ? 'assign-wine-to-slot' : 'assign-wine-to-slot'}"
               data-cellarid="${cellarId}" data-slot="${slotKey||''}" data-wineid="${w.id}">
            <div class="picker-dot" style="background:${this._typeColor(w.type)}"></div>
            <div class="picker-name">${this._esc(w.name)}</div>
            <div class="picker-meta">${[w.vintage, this.t('types.'+w.type)].filter(Boolean).join(' · ')}</div>
          </div>`).join(''));
    };

    const body = `
      <div style="margin-bottom:12px">
        <input id="${searchId}" class="form-control" placeholder="${this.t('common.search')}" type="search">
      </div>
      <div id="${listId}" class="wine-picker-list"></div>`;

    this.showModal(this.t('common.selectWine'), body, [
      { label: this.t('common.cancel'), cls: 'btn-secondary', action: () => this.closeModal() }
    ]);

    render('');
    setTimeout(() => {
      const inp = document.getElementById(searchId);
      if (inp) inp.addEventListener('input', e => render(e.target.value));
    }, 50);
  },

  assignWineToSlot(cellarId, slotKey, wineId) {
    if (!wineId) return;
    const cellar = DB.getCellars().find(c => c.id === cellarId);
    if (!cellar) return;
    if (cellar.wines) {
      Sync.assignWineToSlot(cellarId, null, wineId); // shelf
    } else {
      Sync.assignWineToSlot(cellarId, slotKey, wineId);
    }
    this.closeModal();
    this.renderView();
  },

  removeFromSlot(cellarId, slot, wineId) {
    Sync.assignWineToSlot(cellarId, slot, null);
    this.closeModal(); this.renderView();
  },

  removeFromShelf(cellarId, wineId) {
    Sync.removeWineFromShelf(cellarId, wineId);
    this.renderView();
  },

  showAddCellarModal() {
    const types = ['grid', 'diamond', 'case', 'shelf'];
    const body = `
      <div class="form-group">
        <label>${this.t('cellar.locationName')}</label>
        <input id="cf-name" class="form-control" placeholder="e.g. Main Rack, Basement" value="">
      </div>
      <div class="form-group">
        <label>${this.t('cellar.locationType')}</label>
        <select id="cf-type" class="form-control" onchange="App._updateCellarFormFields()">
          ${types.map(tp => `<option value="${tp}">${this.t('cellar.types.'+tp)}</option>`).join('')}
        </select>
      </div>
      <div id="cf-size-fields">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label>${this.t('cellar.rows')}</label>
            <input id="cf-rows" class="form-control" type="number" min="1" max="30" value="5">
          </div>
          <div class="form-group">
            <label>${this.t('cellar.cols')}</label>
            <input id="cf-cols" class="form-control" type="number" min="1" max="30" value="8">
          </div>
        </div>
      </div>`;

    this.showModal(this.t('cellar.addLocation'), body, [
      { label: this.t('common.cancel'), cls: 'btn-secondary', action: () => this.closeModal() },
      { label: this.t('common.add'),    cls: 'btn-primary',   action: () => this.saveCellarForm() }
    ]);
  },

  _updateCellarFormFields() {
    const type = document.getElementById('cf-type')?.value;
    const sizeFields = document.getElementById('cf-size-fields');
    if (!sizeFields) return;
    sizeFields.style.display = (type === 'grid' || type === 'diamond') ? '' : 'none';
  },

  saveCellarForm() {
    const name = document.getElementById('cf-name')?.value.trim();
    const type = document.getElementById('cf-type')?.value || 'grid';
    if (!name) { this.toast(this.t('cellar.locationName') + ' required', 'error'); return; }

    const rows = parseInt(document.getElementById('cf-rows')?.value || '5', 10);
    const cols = parseInt(document.getElementById('cf-cols')?.value || '8', 10);

    Sync.addCellar({ name, type, rows: Math.max(1,rows), cols: Math.max(1,cols) });
    this.closeModal();
    this.renderView();
    this.toast(this.t('common.save') + ' ✓', 'success');
  },

  confirmDeleteCellar(id) {
    const c = DB.getCellars().find(c => c.id === id);
    if (!c) return;
    this.showModal(
      this.t('cellar.deleteLocation'),
      `<p>${this.t('cellar.deleteLocationConfirm')}</p>`,
      [
        { label: this.t('common.cancel'), cls: 'btn-secondary', action: () => this.closeModal() },
        { label: this.t('common.delete'), cls: 'btn-danger', action: () => {
          Sync.deleteCellar(id); this.cellarDetailId = null; this.closeModal(); this.renderView();
        }}
      ]
    );
  },

  // ══════════════════════════════════════════════════════════════════════════
  // COLLECTION VIEW
  // ══════════════════════════════════════════════════════════════════════════

  // Returns 'ready' | 'past' | 'cellar' | null
  _drinkStatus(wine) {
    if (!wine.drinkFrom && !wine.drinkUntil) return null;
    const y = new Date().getFullYear();
    if (wine.drinkUntil && y > wine.drinkUntil) return 'past';
    if (wine.drinkFrom  && y < wine.drinkFrom)  return 'cellar';
    return 'ready';
  },

  _buildCollectionStatsBar(allWines) {
    const wineCount   = allWines.length;
    const bottleCount = allWines.reduce((s, w) => s + (w.quantity || 1), 0);

    // Type breakdown — only show types that appear
    const typeCounts = {};
    allWines.forEach(w => { typeCounts[w.type] = (typeCounts[w.type] || 0) + (w.quantity || 1); });
    const typeItems = Object.entries(typeCounts)
      .sort((a,b) => b[1]-a[1])
      .map(([tp, cnt]) => `
        <div class="stats-type-item">
          <span class="stats-type-dot" style="background:${this._typeColor(tp)}"></span>
          <span>${cnt}</span>
        </div>`).join('');

    // Cellar value — sum(price × quantity) for wines with a price
    const winesWithPrice = allWines.filter(w => w.price != null && w.price > 0);
    const cellarValue = winesWithPrice.reduce((s, w) => s + (w.price * (w.quantity || 1)), 0);
    const cellarValuePill = winesWithPrice.length > 0 ? `
      <div class="stat-divider"></div>
      <div class="stat-pill">
        <div class="stat-number" style="font-size:1.1rem">€${cellarValue.toLocaleString('nl-NL', {minimumFractionDigits:0,maximumFractionDigits:0})}</div>
        <div class="stat-label">${this.t('collection.cellarValue')}</div>
      </div>` : '';

    // Drink window alerts
    const ready = allWines.filter(w => this._drinkStatus(w) === 'ready');
    const past  = allWines.filter(w => this._drinkStatus(w) === 'past');
    const alerts = [
      ready.length ? `<div class="drink-alert drink-alert-ready">🍷 ${this.t('collection.drinkDueAlert', {count: ready.length})}</div>` : '',
      past.length  ? `<div class="drink-alert drink-alert-past">⚠️ ${this.t('collection.drinkPastAlert',  {count: past.length})}</div>` : ''
    ].join('');

    return `
    <div class="collection-stats-bar">
      <div class="stat-pill">
        <div class="stat-number">${wineCount}</div>
        <div class="stat-label">${this.lang === 'nl' ? 'wijnen' : 'wines'}</div>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-pill">
        <div class="stat-number">${bottleCount}</div>
        <div class="stat-label">${this.lang === 'nl' ? 'flessen' : 'bottles'}</div>
      </div>
      <div class="stat-divider"></div>
      <div class="stats-type-row">${typeItems}</div>
      ${cellarValuePill}
    </div>
    ${alerts}`;
  },

  _buildReadyTonightBanner(allWines) {
    const placementMap = DB.getWinePlacementMap();
    const readyInCellar = allWines.filter(w =>
      this._drinkStatus(w) === 'ready' && placementMap[w.id]
    );
    if (readyInCellar.length === 0) return '';
    return `
    <div class="ready-tonight-banner" data-action="filter-ready-cellar">
      <div class="ready-tonight-icon">🍷</div>
      <div class="ready-tonight-text">
        <div class="ready-tonight-count">${this.t('collection.readyTonight', {count: readyInCellar.length})}</div>
        <div class="ready-tonight-sub">${this.t('collection.readyTonightBtn')}</div>
      </div>
      <div class="ready-tonight-arrow">→</div>
    </div>`;
  },

  buildCollectionView() {
    const allWines = DB.getWines();
    let wines = allWines.slice();
    const placementMap = DB.getWinePlacementMap();

    // Collect unique tags across all wines
    const allTags = [...new Set(allWines.flatMap(w => w.tags || []))].filter(Boolean).sort();

    // Filter (multi-select)
    wines = this._applyCollectionFilters(wines, placementMap);

    // Search
    const q = this.collectionSearch.toLowerCase();
    if (q) wines = wines.filter(w =>
      w.name.toLowerCase().includes(q) ||
      (w.producer||'').toLowerCase().includes(q) ||
      (w.region||'').toLowerCase().includes(q) ||
      (w.tags||[]).some(t => t.toLowerCase().includes(q))
    );

    // Sort
    wines = [...wines].sort((a,b) => {
      if (this.collectionSort === 'name') return a.name.localeCompare(b.name);
      if (this.collectionSort === 'vintage') return (b.vintage||0) - (a.vintage||0);
      if (this.collectionSort === 'type') return a.type.localeCompare(b.type);
      return b.addedAt - a.addedAt;
    });

    const filters = [
      { id: 'all',        label: this.t('collection.filterAll') },
      { id: 'red',        label: this.t('types.red') },
      { id: 'white',      label: this.t('types.white') },
      { id: 'rosé',       label: this.t('types.rosé') },
      { id: 'sparkling',  label: this.t('types.sparkling') },
      { id: 'in-cellar',  label: this.t('collection.inCellar') },
      { id: 'drink-now',  label: '🍷 ' + this.t('collection.drinkDue') },
      ...allTags.map(tag => ({ id: tag, label: '#' + tag })),
    ];

    // Batch select mode header
    const batchHeader = this.batchSelectMode ? `
      <div class="batch-select-bar">
        <span class="batch-count">${this.t('collection.selectedCount', {count: this.batchSelected.size})}</span>
        <button class="btn btn-secondary btn-sm" data-action="batch-set-qty">${this.t('collection.batchSetQty')}</button>
        <button class="btn btn-secondary btn-sm" data-action="batch-add-tag">${this.t('collection.batchAddTag')}</button>
        <button class="btn btn-danger btn-sm" data-action="batch-delete">${this.t('collection.batchDelete')}</button>
        <button class="btn btn-primary btn-sm" data-action="toggle-select-mode">${this.t('collection.selectDone')}</button>
      </div>` : '';

    const isGallery = this.collectionView === 'gallery';

    // Render wine list content
    let wineContent;
    if (wines.length === 0) {
      wineContent = `<div class="empty-state">${this._iconWineLg()}<p>${this.t('collection.noWines')}</p></div>`;
    } else if (isGallery) {
      wineContent = `<div class="wine-gallery">${wines.map(w => this._buildWineGalleryCard(w)).join('')}</div>`;
    } else {
      wineContent = wines.map(w => this._buildWineListCard(w, placementMap)).join('');
    }

    return `
    <div class="page-header">
      <h1>${this.t('collection.title')}</h1>
      <div class="header-actions">
        <select class="form-control collection-sort-select"
                onchange="App.collectionSort=this.value;App.renderView()">
          <option value="addedAt"${this.collectionSort==='addedAt'?' selected':''}>${this.t('collection.sortAdded')}</option>
          <option value="name"${this.collectionSort==='name'?' selected':''}>${this.t('collection.sortName')}</option>
          <option value="vintage"${this.collectionSort==='vintage'?' selected':''}>${this.t('collection.sortVintage')}</option>
          <option value="type"${this.collectionSort==='type'?' selected':''}>${this.t('collection.sortType')}</option>
        </select>
        <button class="btn btn-secondary btn-sm" data-action="toggle-gallery" title="${isGallery ? this.t('collection.listToggle') : this.t('collection.galleryToggle')}">
          ${isGallery ? this._iconList() : this._iconGrid()}
        </button>
        <button class="btn btn-secondary btn-sm" data-action="toggle-select-mode">${this.t('collection.selectMode')}</button>
        <button class="btn btn-primary btn-sm" data-action="manual-add-wine">${this.t('collection.addWine')}</button>
      </div>
    </div>
    ${allWines.length > 0 ? this._buildReadyTonightBanner(allWines) : ''}
    ${allWines.length > 0 ? this._buildCollectionStatsBar(allWines) : ''}
    ${batchHeader}
    <div class="collection-toolbar">
      <div class="search-input-wrap">
        ${this._iconSearch()}
        <input class="search-input" id="coll-search" placeholder="${this.t('collection.search')}"
               value="${this._esc(this.collectionSearch)}"
               oninput="App.collectionSearch=this.value;App._filterCollection()">
      </div>
    </div>
    <div class="filter-strip">
      <button class="filter-chip${this.collectionFilters.size===0?' active':''}"
              onclick="App.collectionFilters=new Set();App.renderView()">${this.t('collection.filterAll')}</button>
      ${filters.slice(1).map(f => `
        <button class="filter-chip${this.collectionFilters.has(f.id)?' active':''}"
                data-filter-id="${f.id}"
                onclick="App._toggleFilter('${f.id}')">${f.label}</button>`).join('')}
    </div>
    <div class="${isGallery ? '' : 'wine-grid'}" id="collection-wine-grid">
      ${wineContent}
    </div>`;
  },

  _toggleFilter(id) {
    if (this.collectionFilters.has(id)) {
      this.collectionFilters.delete(id);
    } else {
      this.collectionFilters.add(id);
    }
    // Update chip active states without full re-render
    document.querySelectorAll('.filter-chip').forEach(btn => {
      const fid = btn.dataset.filterId;
      if (!fid) {
        // "All" button — active only when nothing selected
        btn.classList.toggle('active', this.collectionFilters.size === 0);
      } else {
        btn.classList.toggle('active', this.collectionFilters.has(fid));
      }
    });
    this._filterCollection();
  },

  // Apply active multi-filters to a wine list.
  // Types are OR'd with each other; status filters (in-cellar, drink-now) AND with types.
  _applyCollectionFilters(wines, placementMap) {
    const fs = this.collectionFilters;
    if (fs.size === 0) return wines;

    const TYPE_FILTERS   = new Set(['red','white','rosé','sparkling','dessert','fortified']);
    const STATUS_FILTERS = new Set(['in-cellar','drink-now','not-placed']);

    const activeTypes   = [...fs].filter(f => TYPE_FILTERS.has(f));
    const activeStatus  = [...fs].filter(f => STATUS_FILTERS.has(f));
    const activeTags    = [...fs].filter(f => !TYPE_FILTERS.has(f) && !STATUS_FILTERS.has(f));

    return wines.filter(w => {
      // Type: must match one of the selected types (OR), or skip if no type filters
      if (activeTypes.length && !activeTypes.includes(w.type)) return false;
      // Tags: must have all selected tags (AND)
      if (activeTags.length && !activeTags.every(t => (w.tags||[]).includes(t))) return false;
      // Status: must match all selected statuses (AND)
      for (const s of activeStatus) {
        if (s === 'in-cellar'  && !placementMap[w.id]) return false;
        if (s === 'not-placed' && placementMap[w.id])  return false;
        if (s === 'drink-now') {
          const st = this._drinkStatus(w);
          if (st !== 'ready' && st !== 'past') return false;
        }
      }
      return true;
    });
  },

  // Re-render only the wine list (called on search input to preserve focus)
  _filterCollection() {
    const grid = document.getElementById('collection-wine-grid');
    if (!grid) { this.renderView(); return; }
    let wines = DB.getWines();
    const placementMap = DB.getWinePlacementMap();
    wines = this._applyCollectionFilters(wines, placementMap);
    const q = this.collectionSearch.toLowerCase();
    if (q) wines = wines.filter(w =>
      w.name.toLowerCase().includes(q) ||
      (w.producer||'').toLowerCase().includes(q) ||
      (w.region||'').toLowerCase().includes(q) ||
      (w.tags||[]).some(t => t.toLowerCase().includes(q))
    );
    wines = [...wines].sort((a,b) => {
      if (this.collectionSort === 'name') return a.name.localeCompare(b.name);
      if (this.collectionSort === 'vintage') return (b.vintage||0) - (a.vintage||0);
      if (this.collectionSort === 'type') return a.type.localeCompare(b.type);
      return b.addedAt - a.addedAt;
    });
    grid.innerHTML = wines.length === 0
      ? `<div class="empty-state">${this._iconWineLg()}<p>${this.t('collection.noWines')}</p></div>`
      : wines.map(w => this._buildWineListCard(w, placementMap)).join('');
  },

  _buildWineListCard(w, placementMap) {
    const places    = placementMap[w.id];
    const cellarTag = places ? places.map(p => p.cellarName).join(', ') : '';
    const status    = this._drinkStatus(w);
    const drinkBadge = status === 'ready'
      ? `<span class="drink-badge drink-badge-ready">🍷 ${this.t('collection.drinkReady')}</span>`
      : status === 'past'
      ? `<span class="drink-badge drink-badge-past">⚠️ ${this.t('collection.drinkPast')}</span>`
      : status === 'cellar'
      ? `<span class="drink-badge drink-badge-cellar">${this.t('collection.drinkCellar',{year:w.drinkFrom})}</span>`
      : '';
    // Thumbnail: prefer small b64 thumb, fall back to Firestore URL, else show colour dot
    const thumbSrc = w.thumbnail ? `data:image/jpeg;base64,${w.thumbnail}`
                   : w.imageUrl  ? w.imageUrl
                   : null;
    const leftCol = thumbSrc
      ? `<img src="${thumbSrc}" class="wine-card-thumb" alt="" loading="lazy">`
      : `<div class="wine-card-dot" style="background:${this._typeColor(w.type)}"></div>`;
    const tags = (w.tags||[]).filter(Boolean);
    const tagPills = tags.length ? `<div class="wine-tag-row">${tags.map(t => `<span class="wine-tag-pill">#${this._esc(t)}</span>`).join('')}</div>` : '';

    // Batch select checkbox
    const checkbox = this.batchSelectMode
      ? `<div class="batch-checkbox${this.batchSelected.has(w.id)?' checked':''}" data-action="toggle-wine-select" data-id="${w.id}"></div>` : '';

    return `
    <div class="wine-card${this.batchSelectMode?' batch-selectable':''}${this.batchSelected.has(w.id)?' batch-selected':''}"
         data-action="${this.batchSelectMode ? 'toggle-wine-select' : 'edit-wine'}" data-id="${w.id}">
      ${checkbox}
      ${leftCol}
      <div class="wine-card-body">
        <div class="wine-card-name">${this._esc(w.name)}</div>
        <div class="wine-card-sub">${[w.producer, w.region, w.country].filter(Boolean).join(' · ')}</div>
        <div class="wine-card-meta">
          <span class="type-badge type-${w.type.replace('é','e')}">${this.t('types.'+w.type)}</span>
          ${w.vintage ? `<span style="font-size:.8rem;color:var(--text-lt)">${w.vintage}</span>` : ''}
          <span class="wine-qty${w.quantity === 0 ? ' wine-qty--empty' : ''}">${w.quantity ?? 1}×</span>
          ${w.rating ? `<span class="stars" style="font-size:.8rem">${'★'.repeat(w.rating)}</span>` : ''}
          ${drinkBadge}
          ${cellarTag ? `<span class="wine-cellar-tag">📍 ${this._esc(cellarTag)}</span>` : ''}
        </div>
        ${tagPills}
      </div>
      ${!this.batchSelectMode ? (() => {
        const onWishlist = !!DB.getWishlistItemByWineId(w.id);
        return `<div style="display:flex;flex-direction:column;gap:4px;align-items:center">
          <button class="btn btn-icon btn-sm" data-action="consume-bottle" data-id="${w.id}"
                  title="${this.t('consume.openBottle')}"
                  style="color:var(--burgundy)">${this._iconBottle()}</button>
          <button class="btn btn-icon btn-sm${onWishlist?' wishlist-active':''}"
                  data-action="toggle-wine-wishlist" data-id="${w.id}"
                  title="${onWishlist ? this.t('common.removeFromWishlist') : this.t('common.addToWishlist')}"
                  style="${onWishlist?'color:var(--burgundy)':'color:var(--text-lt)'}">${this._iconCart(onWishlist)}</button>
          <button class="btn btn-icon btn-sm" data-action="delete-wine" data-id="${w.id}"
                  style="color:var(--text-lt)">${this._iconTrash()}</button>
        </div>`;
      })() : ''}
    </div>`;
  },

  _buildWineGalleryCard(w) {
    const thumbSrc = w.thumbnail ? `data:image/jpeg;base64,${w.thumbnail}`
                   : w.imageUrl  ? w.imageUrl
                   : null;
    if (thumbSrc) {
      return `
      <div class="gallery-card" data-action="edit-wine" data-id="${w.id}">
        <img src="${thumbSrc}" class="gallery-card-img" alt="${this._esc(w.name)}" loading="lazy">
        <div class="gallery-card-overlay">
          <div class="gallery-card-name">${this._esc(w.name)}</div>
          ${w.vintage ? `<div class="gallery-card-vintage">${w.vintage}</div>` : ''}
        </div>
      </div>`;
    }
    return `
    <div class="gallery-card gallery-card-placeholder" data-action="edit-wine" data-id="${w.id}"
         style="background:${this._typeColor(w.type)}22;border:2px solid ${this._typeColor(w.type)}44">
      <div class="gallery-card-dot" style="background:${this._typeColor(w.type)}"></div>
      <div class="gallery-card-overlay">
        <div class="gallery-card-name">${this._esc(w.name)}</div>
        ${w.vintage ? `<div class="gallery-card-vintage">${w.vintage}</div>` : ''}
      </div>
    </div>`;
  },

  // Batch select helpers
  _toggleBatchSelect() {
    this.batchSelectMode = !this.batchSelectMode;
    this.batchSelected = new Set();
    this.renderView();
  },

  _toggleWineSelect(id) {
    if (this.batchSelected.has(id)) this.batchSelected.delete(id);
    else this.batchSelected.add(id);
    // Update UI without full re-render
    const card = document.querySelector(`.wine-card[data-id="${id}"]`);
    if (card) {
      card.classList.toggle('batch-selected', this.batchSelected.has(id));
      const cb = card.querySelector('.batch-checkbox');
      if (cb) cb.classList.toggle('checked', this.batchSelected.has(id));
    }
    const countEl = document.querySelector('.batch-count');
    if (countEl) countEl.textContent = this.t('collection.selectedCount', {count: this.batchSelected.size});
  },

  _batchSetQty() {
    if (this.batchSelected.size === 0) { this.toast('No wines selected', 'error'); return; }
    const qty = parseInt(prompt(this.t('collection.batchQtyPrompt'), '1'), 10);
    if (!qty || qty < 0) return;
    this.batchSelected.forEach(id => Sync.updateWine(id, { quantity: qty }));
    this.batchSelected = new Set();
    this.batchSelectMode = false;
    this.renderView();
    this.toast(this.t('common.save') + ' ✓', 'success');
  },

  _batchAddTag() {
    if (this.batchSelected.size === 0) { this.toast('No wines selected', 'error'); return; }
    const tag = (prompt(this.t('collection.batchTagPrompt'), '') || '').trim();
    if (!tag) return;
    this.batchSelected.forEach(id => {
      const wine = DB.getWineById(id);
      if (!wine) return;
      const tags = [...new Set([...(wine.tags||[]), tag])];
      Sync.updateWine(id, { tags });
    });
    this.batchSelected = new Set();
    this.batchSelectMode = false;
    this.renderView();
    this.toast(this.t('common.save') + ' ✓', 'success');
  },

  _batchDelete() {
    if (this.batchSelected.size === 0) { this.toast('No wines selected', 'error'); return; }
    if (!confirm(`${this.t('common.delete')} ${this.batchSelected.size} wines?`)) return;
    this.batchSelected.forEach(id => Sync.deleteWine(id));
    this.batchSelected = new Set();
    this.batchSelectMode = false;
    this.renderView();
    this.toast('Deleted', 'success');
  },

  _buildWineCardInner(w) {
    // Start with thumbnail (instant); upgrade to full image from IndexedDB after render
    const thumbSrc = w.thumbnail ? `data:image/jpeg;base64,${w.thumbnail}`
                   : w.imageUrl  ? w.imageUrl
                   : null;
    const imgId  = `wine-card-img-${w.id}`;
    const thumbStyle = 'max-width:120px;max-height:160px;height:auto;object-fit:contain;border-radius:10px;margin:0 auto 14px;display:block;';
    const fullStyle  = 'width:100%;max-height:60vh;object-fit:contain;border-radius:10px;margin-bottom:14px;display:block;background:#111;';
    // Async upgrade: once IndexedDB resolves, swap to full image
    ImageDB.get(w.id).then(img => {
      const el = document.getElementById(imgId);
      if (!el || !img) return;
      el.src   = 'data:image/jpeg;base64,' + img;
      el.style.cssText = fullStyle;
    });
    const isRed = w.type === 'red';
    return `
    <div style="text-align:left">
      ${thumbSrc ? `<img id="${imgId}" src="${thumbSrc}" alt="${this._esc(w.name)}" style="${thumbStyle}">` : ''}
      <div style="font-size:1.1rem;font-weight:700;margin-bottom:4px">${this._esc(w.name)}</div>
      ${w.producer ? `<div style="color:var(--text-md);margin-bottom:8px">${this._esc(w.producer)}</div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <span class="type-badge type-${w.type.replace('é','e')}">${this.t('types.'+w.type)}</span>
        ${w.vintage ? `<span style="font-size:.85rem;color:var(--text-lt)">${w.vintage}</span>` : ''}
        ${w.region  ? `<span style="font-size:.85rem;color:var(--text-lt)">${this._esc(w.region)}</span>` : ''}
      </div>
      ${w.rating ? `<div class="stars" style="margin-bottom:8px">${'★'.repeat(w.rating)}</div>` : ''}
      ${w.notes ? `<div style="font-size:.88rem;color:var(--text-md);line-height:1.5;margin-bottom:10px">${this._esc(w.notes)}</div>` : ''}
      ${(w.drinkFrom || w.drinkUntil) ? (() => {
        const s = this._drinkStatus(w);
        const cls = s === 'ready' ? 'drink-badge-ready' : s === 'past' ? 'drink-badge-past' : 'drink-badge-cellar';
        const window = [w.drinkFrom, w.drinkUntil].filter(Boolean).join(' – ');
        return `<div class="drink-badge ${cls}" style="display:inline-flex;margin-top:2px">
          ${s==='ready'?'🍷':s==='past'?'⚠️':'🔒'} ${window}
          ${s==='ready' ? ' · '+this.t('collection.drinkReady') : s==='past' ? ' · '+this.t('collection.drinkPast') : ''}
        </div>`;
      })() : ''}
      ${(() => {
        // ── Cellar location block ───────────────────────────────────────────
        const places = DB.getWinePlacementMap()[w.id];
        if (!places || places.length === 0) return '';
        // Group by cellar
        const byCellar = {};
        places.forEach(p => {
          if (!byCellar[p.cellarId]) byCellar[p.cellarId] = { name: p.cellarName, id: p.cellarId, slots: [] };
          if (p.slot !== null) byCellar[p.cellarId].slots.push(this._slotPositionLabel(p.slot));
        });
        const rows = Object.values(byCellar).map(c => {
          const coords = c.slots.length
            ? c.slots.map(s => `<span class="location-coord-pill">${s}</span>`).join('')
            : `<span style="font-size:.78rem;opacity:.6">${this.lang==='nl'?'(Plank)':'(Shelf)'}</span>`;
          return `<div class="location-cellar-row">
            <button class="location-cellar-name" data-action="goto-cellar" data-cellarid="${c.id}">
              📍 ${this._esc(c.name)}
            </button>
            <div class="location-coords">${coords}</div>
          </div>`;
        }).join('');
        return `<div class="wine-location-block" style="margin-top:12px">${rows}</div>`;
      })()}
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        ${isRed ? `<button class="btn btn-secondary btn-sm" data-action="start-decant" data-id="${w.id}">🫗 ${this.t('scan.decantBtn')}</button>` : ''}
        <button class="btn btn-secondary btn-sm" data-action="share-wine" data-id="${w.id}">${this._iconShare()} ${this.t('common.shareWine')}</button>
        ${(() => {
          const onWL = !!DB.getWishlistItemByWineId(w.id);
          return `<button class="btn btn-secondary btn-sm${onWL?' wishlist-active':''}"
            data-action="toggle-wine-wishlist" data-id="${w.id}"
            title="${onWL ? this.t('common.removeFromWishlist') : this.t('common.addToWishlist')}"
            style="${onWL?'color:var(--burgundy);border-color:var(--burgundy)':''}">
            ${this._iconCart(onWL)} ${onWL ? this.t('common.removeFromWishlist') : this.t('common.addToWishlist')}
          </button>`;
        })()}
      </div>
    </div>`;
  },

  // ══════════════════════════════════════════════════════════════════════════
  // WISHLIST VIEW
  // ══════════════════════════════════════════════════════════════════════════
  buildWishlistView() {
    const items = DB.getWishlist();
    const cards = items.length === 0
      ? `<div class="empty-state">${this._iconHeart()}<p style="margin-top:12px">${this.t('wishlist.noItems')}</p></div>`
      : items.map(item => this._buildWishlistCard(item)).join('');

    return `
    <div class="page-header">
      <h1>${this.t('wishlist.title')}</h1>
      <div class="header-actions">
        <button class="btn btn-primary btn-sm" data-action="add-wishlist-item">${this.t('wishlist.addItem')}</button>
      </div>
    </div>
    <div class="wine-grid" style="padding-top:12px">${cards}</div>`;
  },

  _buildWishlistCard(item) {
    return `
    <div class="wine-card">
      <div class="wine-card-dot" style="background:${this._typeColor(item.type||'red')}"></div>
      <div class="wine-card-body">
        <div class="wine-card-name">${this._esc(item.name)}</div>
        <div class="wine-card-sub">${[item.producer, item.region].filter(Boolean).join(' · ')}</div>
        <div class="wine-card-meta">
          <span class="type-badge type-${(item.type||'red').replace('é','e')}">${this.t('types.'+(item.type||'red'))}</span>
          ${item.vintage ? `<span style="font-size:.8rem;color:var(--text-lt)">${item.vintage}</span>` : ''}
          ${item.price != null ? `<span style="font-size:.8rem;color:var(--text-lt)">€${Number(item.price).toFixed(2)}</span>` : ''}
        </div>
        ${item.notes ? `<div style="font-size:.8rem;color:var(--text-lt);margin-top:4px">${this._esc(item.notes)}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
        <button class="btn btn-primary btn-sm" data-action="move-wishlist-to-collection" data-id="${item.id}">${this.t('wishlist.moveBtn')}</button>
        <button class="btn btn-icon btn-sm" data-action="delete-wishlist-item" data-id="${item.id}"
                style="color:var(--text-lt)">${this._iconTrash()}</button>
      </div>
    </div>`;
  },

  showWishlistForm(idOrItem) {
    const item = typeof idOrItem === 'string'
      ? (DB.getWishlist().find(x => x.id === idOrItem) || {})
      : (idOrItem || {});
    const isEdit = !!item.id;
    const types = ['red','white','rosé','sparkling','dessert','fortified'];
    this._wishlistFormType = item.type || 'red';

    const body = `
      <div class="form-group">
        <label>${this.t('wine.name')} *</label>
        <input id="wl-name" class="form-control" value="${this._esc(item.name||'')}" placeholder="e.g. Pétrus">
      </div>
      <div class="form-group">
        <label>${this.t('wine.producer')}</label>
        <input id="wl-producer" class="form-control" value="${this._esc(item.producer||'')}">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group">
          <label>${this.t('wine.vintage')}</label>
          <input id="wl-vintage" class="form-control" type="number" min="1800" max="${new Date().getFullYear()}" value="${item.vintage||''}">
        </div>
        <div class="form-group">
          <label>${this.t('wine.price')}</label>
          <input id="wl-price" class="form-control" type="number" min="0" step="0.01" value="${item.price||''}">
        </div>
      </div>
      <div class="form-group">
        <label>${this.t('wine.type')}</label>
        <div class="type-selector" id="wl-type-sel">
          ${types.map(tp => `<button class="type-option${this._wishlistFormType===tp?' selected':''}"
            onclick="App._wishlistFormType='${tp}';document.querySelectorAll('#wl-type-sel .type-option').forEach(b=>b.classList.toggle('selected',b.textContent.trim()==='${this.t('types.'+tp)}'))">${this.t('types.'+tp)}</button>`).join('')}
        </div>
      </div>
      <div class="form-group">
        <label>${this.t('wine.region')}</label>
        <input id="wl-region" class="form-control" value="${this._esc(item.region||'')}">
      </div>
      <div class="form-group">
        <label>${this.t('wine.notes')}</label>
        <textarea id="wl-notes" class="form-control">${this._esc(item.notes||'')}</textarea>
      </div>`;

    this.showModal(isEdit ? this.t('common.edit') : this.t('wishlist.form'), body, [
      { label: this.t('common.cancel'), cls: 'btn-secondary', action: () => this.closeModal() },
      { label: this.t('common.save'), cls: 'btn-primary', action: () => this._saveWishlistForm(item.id) }
    ]);
  },

  _saveWishlistForm(editId) {
    const name = document.getElementById('wl-name')?.value.trim();
    if (!name) { this.toast(this.t('wine.name') + ' required', 'error'); return; }
    const parse = id => document.getElementById(id)?.value.trim() || '';
    const parseNum = id => { const v = document.getElementById(id)?.value; return v ? parseFloat(v) : null; };
    const data = {
      name,
      producer: parse('wl-producer'),
      vintage: parseNum('wl-vintage') ? parseInt(parse('wl-vintage'),10) : null,
      price: parseNum('wl-price'),
      type: this._wishlistFormType || 'red',
      region: parse('wl-region'),
      notes: parse('wl-notes')
    };
    if (editId) DB.updateWishlistItem(editId, data);
    else DB.addWishlistItem(data);
    this.closeModal();
    this.renderView();
    this.toast(this.t('common.save') + ' ✓', 'success');
  },

  _deleteWishlistItem(id) {
    DB.deleteWishlistItem(id);
    this.renderView();
    this.toast('Deleted', 'success');
  },

  _moveWishlistToCollection(id) {
    const item = DB.getWishlist().find(x => x.id === id);
    if (!item) return;
    // Store the wishlist id so saveWineForm can clean it up
    this._pendingWishlistDeleteId = id;
    this.showWineForm({ ...item, id: null });
  },

  _toggleWineWishlist(wineId, btnEl) {
    const wine = DB.getWines().find(w => w.id === wineId);
    if (!wine) return;
    const added = DB.toggleWineOnWishlist(wine);
    // Update button state in-place (no full re-render needed)
    if (btnEl) {
      btnEl.classList.toggle('wishlist-active', added);
      btnEl.title = added ? this.t('common.removeFromWishlist') : this.t('common.addToWishlist');
      btnEl.innerHTML = this._iconCart(added);
    }
    this.toast(added ? this.t('common.addToWishlist') + ' ✓' : this.t('common.removeFromWishlist') + ' ✓', 'success');
  },

  _iconCart(active = false) {
    const fill = active ? 'var(--burgundy)' : 'none';
    const stroke = active ? 'var(--burgundy)' : 'currentColor';
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
    </svg>`;
  },

  // ══════════════════════════════════════════════════════════════════════════
  // PAIRING VIEW
  // ══════════════════════════════════════════════════════════════════════════
  buildPairingView() {
    return `
    <div>
      <div class="pairing-hero">
        <div class="page-header" style="background:transparent;border:none;padding:0 0 14px;color:var(--white)">
          <h1 style="color:var(--white)">${this.t('pairing.title')}</h1>
        </div>
        <h2>${this.t('pairing.dish')}</h2>
        <div class="pairing-input-row">
          <input class="pairing-input" id="dish-input" type="text"
                 placeholder="${this.t('pairing.dishPlaceholder')}"
                 onkeydown="if(event.key==='Enter')App.findPairings()">
          <button class="btn btn-gold" data-action="find-pairings">${this._iconFork()} ${this.t('pairing.find')}</button>
        </div>
      </div>
      <div class="pairing-results" id="pairing-results">
        <div style="text-align:center;color:var(--text-lt);padding:32px;font-size:.9rem">
          ${this.t('pairing.dish')}…
        </div>
      </div>
    </div>`;
  },

  async findPairings() {
    const dish = document.getElementById('dish-input')?.value.trim();
    if (!dish) return;

    const resultsEl = document.getElementById('pairing-results');
    if (!resultsEl) return;
    resultsEl.innerHTML = `<div class="scan-status"><span class="spinner"></span>${this.t('pairing.finding')}</div>`;

    const wines = DB.getWines();
    if (wines.length === 0) {
      resultsEl.innerHTML = `<div class="empty-state">${this.t('pairing.noWines')}</div>`;
      return;
    }

    const settings = DB.getSettings();
    const hasKey = settings.anthropicKey || settings.openaiKey;
    let result;

    try {
      if (hasKey) {
        result = await API.suggestPairings(dish, wines, settings, this.lang);
      } else {
        result = API.ruleBasedPairing(dish, wines);
      }
    } catch (err) {
      resultsEl.innerHTML = `<div class="scan-status error">${this.t('common.error')} ${err.message}</div>`;
      return;
    }

    const { matches, generalSuggestion, rulesBased } = result;
    const matchedWines = (matches || []).map(m => ({ wine: wines[m.index], reason: m.reason })).filter(x => x.wine);

    let html = '';
    if (rulesBased) {
      html += `<div style="font-size:.8rem;color:var(--text-lt);margin-bottom:8px">${this.t('pairing.rulesBased')}</div>`;
    }

    if (matchedWines.length > 0) {
      html += `<div class="pairing-section-title">${this.t('pairing.fromCellar')}</div>`;
      html += matchedWines.map(({ wine: w, reason }) => `
        <div class="pairing-wine-card" style="border-left-color:${this._typeColor(w.type)}">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
              <span style="font-weight:700">${this._esc(w.name)}</span>
              ${w.vintage ? `<span style="font-size:.8rem;color:var(--text-lt)">${w.vintage}</span>` : ''}
              <span class="pairing-match-badge">${this.t('pairing.match')}</span>
            </div>
            <div style="font-size:.82rem;color:var(--text-lt)">${[w.producer, this.t('types.'+w.type), w.region].filter(Boolean).join(' · ')}</div>
            ${reason ? `<div class="pairing-reason">${this._esc(reason)}</div>` : ''}
          </div>
        </div>`).join('');
    } else {
      html += `<div class="empty-state" style="padding:24px"><p>${this.t('pairing.noMatch')}</p></div>`;
    }

    if (generalSuggestion) {
      html += `<div class="general-suggestion">
        <strong>${this.t('pairing.generalSuggestion')}</strong>
        ${this._esc(generalSuggestion)}
      </div>`;
    }

    resultsEl.innerHTML = html;
  },

  // ══════════════════════════════════════════════════════════════════════════
  // STATS VIEW
  // ══════════════════════════════════════════════════════════════════════════
  buildStatsView() {
    const wines  = DB.getWines();
    const log    = DB.getConsumptionLog();

    // ── Summary numbers ──────────────────────────────────────────────────────
    const totalBottles = wines.reduce((s, w) => s + (w.quantity || 1), 0);
    const winesWithPrice = wines.filter(w => w.price);
    const totalValue  = wines.reduce((s, w) => s + (w.price || 0) * (w.quantity || 1), 0);
    const avgPrice    = winesWithPrice.length
      ? winesWithPrice.reduce((s, w) => s + w.price, 0) / winesWithPrice.length : 0;
    const readyCount  = wines.filter(w => this._drinkStatus(w) === 'ready')
                             .reduce((s, w) => s + (w.quantity || 1), 0);

    const fmt = n => n > 0 ? '€' + n.toFixed(0) : '—';
    const fmtAvg = n => n > 0 ? '€' + n.toFixed(0) : '—';

    // ── By type ──────────────────────────────────────────────────────────────
    const types = ['red','white','rosé','sparkling','dessert','fortified'];
    const byType = types.map(tp => {
      const tw = wines.filter(w => w.type === tp);
      const bottles = tw.reduce((s, w) => s + (w.quantity || 1), 0);
      if (!bottles) return '';
      const val = tw.reduce((s, w) => s + (w.price || 0) * (w.quantity || 1), 0);
      const pct = totalBottles ? Math.round(bottles / totalBottles * 100) : 0;
      return `
      <div class="stats-type-row">
        <span class="type-badge type-${tp.replace('é','e')}" style="min-width:72px">${this.t('types.'+tp)}</span>
        <div class="stats-bar-wrap">
          <div class="stats-bar" style="width:${pct}%;background:var(--${tp.replace('é','e')}-wine,var(--burgundy-lt))"></div>
        </div>
        <span class="stats-type-count">${bottles} ${this.t('stats.bottles')}</span>
        ${val > 0 ? `<span class="stats-type-val">${fmt(val)}</span>` : ''}
      </div>`;
    }).join('');

    // ── Consumption history ──────────────────────────────────────────────────
    const historyRows = log.length === 0
      ? `<div class="empty-state" style="padding:24px 0">${this.t('stats.noHistory')}</div>`
      : log.slice(0, 50).map(e => {
          const d    = new Date(e.date);
          const date = d.toLocaleDateString(this.lang === 'nl' ? 'nl-NL' : 'en-GB', { day:'numeric', month:'short', year:'numeric' });
          const loc  = e.fromCellarName
            ? `📍 ${this._esc(e.fromCellarName)}${e.fromSlot ? ' · ' + this._slotPositionLabel(e.fromSlot) : ''}`
            : this.t('stats.unknownCellar');
          return `
          <div class="stats-history-row">
            <div class="stats-history-main">
              <span class="type-badge type-${(e.wineType||'red').replace('é','e')}" style="font-size:.65rem;padding:2px 6px"></span>
              <div>
                <div class="stats-history-name">${this._esc(e.wineName)}${e.wineVintage ? ' <span style="opacity:.6;font-weight:400">'+e.wineVintage+'</span>' : ''}</div>
                <div class="stats-history-meta">${date} · ${loc}</div>
              </div>
            </div>
            <button class="btn btn-icon btn-sm" data-action="delete-consumption" data-id="${e.id}"
                    style="color:var(--text-lt);flex-shrink:0">${this._iconTrash()}</button>
          </div>`;
        }).join('');

    return `
    <div class="page-header"><h1>${this.t('stats.title')}</h1></div>

    <div class="stats-summary-grid">
      <div class="stats-card">
        <div class="stats-card-value">${totalBottles}</div>
        <div class="stats-card-label">${this.t('stats.totalBottles')}</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-value">${fmt(totalValue)}</div>
        <div class="stats-card-label">${this.t('stats.totalValue')}</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-value">${fmtAvg(avgPrice)}</div>
        <div class="stats-card-label">${this.t('stats.avgPrice')}</div>
      </div>
      <div class="stats-card stats-card--highlight">
        <div class="stats-card-value">${readyCount}</div>
        <div class="stats-card-label">${this.t('stats.readyToDrink')}</div>
      </div>
    </div>

    <div class="stats-section">
      <h2 class="stats-section-title">${this.t('stats.byType')}</h2>
      <div class="stats-type-list">${byType || '<p style="opacity:.5;font-size:.88rem">—</p>'}</div>
    </div>

    <div class="stats-section">
      <h2 class="stats-section-title">${this.t('stats.history')} ${log.length > 0 ? `<span style="font-size:.8rem;font-weight:400;color:var(--text-lt)">(${log.length})</span>` : ''}</h2>
      <div class="stats-history-list">${historyRows}</div>
    </div>`;
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SETTINGS VIEW
  // ══════════════════════════════════════════════════════════════════════════
  buildSettingsView() {
    const s = DB.getSettings();
    const provider = s.apiProvider || 'anthropic';

    return `
    <div class="page-header"><h1>${this.t('settings.title')}</h1></div>

    <div class="settings-section">
      <h2>${this.t('settings.language')}</h2>
      <div class="settings-row">
        <label>Language / Taal</label>
        <div class="lang-toggle">
          <button class="${this.lang==='en'?'active':''}" data-action="toggle-lang" data-lang="en">EN</button>
          <button class="${this.lang==='nl'?'active':''}" data-action="toggle-lang" data-lang="nl">NL</button>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <h2>${this.t('settings.ai')}</h2>
      <div class="settings-row">
        <label>${this.t('settings.apiProvider')}</label>
        <div class="provider-toggle">
          <button class="provider-btn${provider==='anthropic'?' active':''}" data-action="toggle-provider" data-provider="anthropic">Claude</button>
          <button class="provider-btn${provider==='openai'?' active':''}" data-action="toggle-provider" data-provider="openai">OpenAI</button>
        </div>
      </div>
      <div class="form-group" style="margin-top:12px">
        <label>${this.t('settings.anthropicKey')}</label>
        <div class="key-input-wrap">
          <input id="s-anthropic-key" class="form-control" type="password"
                 placeholder="${this.t('settings.keyPlaceholder')}"
                 value="${this._esc(s.anthropicKey||'')}">
          <span class="key-toggle-vis" data-action="toggle-key-vis" data-field="s-anthropic-key">show</span>
        </div>
      </div>
      <div class="form-group">
        <label>${this.t('settings.openaiKey')}</label>
        <div class="key-input-wrap">
          <input id="s-openai-key" class="form-control" type="password"
                 placeholder="${this.t('settings.keyPlaceholder')}"
                 value="${this._esc(s.openaiKey||'')}">
          <span class="key-toggle-vis" data-action="toggle-key-vis" data-field="s-openai-key">show</span>
        </div>
        <div class="key-hint">${this.t('settings.keyHint')}</div>
      </div>
    </div>

    <div class="settings-btn-row">
      <button class="btn btn-primary btn-full" data-action="save-settings">${this.t('settings.save')}</button>
    </div>

    <div class="settings-section">
      <h2>${this.t('settings.data')}</h2>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="btn btn-ghost btn-full" data-action="export-data">${this.t('settings.exportData')}</button>
        <button class="btn btn-ghost btn-full" data-action="export-pdf">${this.t('settings.exportPdf')}</button>
        <label class="btn btn-ghost btn-full" style="cursor:pointer;justify-content:center;display:flex;align-items:center">
          ${this.t('settings.importData')}
          <input type="file" accept=".json" id="import-file-input" style="display:none"
                 onchange="App._handleImport(this)">
        </label>
        <button class="btn btn-danger btn-full" data-action="clear-data">${this.t('settings.clearData')}</button>
      </div>
    </div>

    ${this._buildSyncSection()}

    ${this._buildNotifSection()}

    <div class="about-info">
      <button class="btn btn-ghost btn-full" data-action="show-about" style="gap:10px;font-weight:600">
        <img src="Vinage Logo Pic.png" style="height:24px;width:auto"> ${this.t('settings.about')}
      </button>
      <div style="font-size:.8rem;color:var(--text-lt);margin-top:8px">${this.t('settings.version')} · ${this.t('settings.madeWith')}</div>
    </div>`;
  },

  saveSettings() {
    const s = DB.getSettings();
    s.anthropicKey = document.getElementById('s-anthropic-key')?.value.trim() || '';
    s.openaiKey    = document.getElementById('s-openai-key')?.value.trim()    || '';
    s.lang         = this.lang;
    s.apiProvider  = s.apiProvider || 'anthropic';
    DB.saveSettings(s);
    this.toast(this.t('settings.saved'), 'success');
  },

  toggleLang(lang) {
    this.lang = lang;
    const s = DB.getSettings(); s.lang = lang; DB.saveSettings(s);
    this.render();
    this.navigate('settings');
  },

  toggleProvider(provider) {
    const s = DB.getSettings(); s.apiProvider = provider; DB.saveSettings(s);
    document.querySelectorAll('.provider-btn').forEach(b => b.classList.toggle('active', b.dataset.provider === provider));
  },

  toggleKeyVisibility(fieldId) {
    const inp = document.getElementById(fieldId);
    if (!inp) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
  },

  exportData() {
    const json = DB.exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vinage-export-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  },

  exportPdf() {
    const wines = DB.getWines();
    const types = TRANSLATIONS[this.lang].types || TRANSLATIONS.en.types;
    const rows = wines.map(w => `
      <tr>
        <td>${this._esc(w.name)}</td>
        <td>${this._esc(w.producer||'')}</td>
        <td>${w.vintage||''}</td>
        <td>${types[w.type]||w.type}</td>
        <td>${this._esc(w.region||'')}</td>
        <td style="text-align:center">${w.quantity||1}</td>
        <td style="text-align:right">${w.price!=null?'€'+Number(w.price).toFixed(2):''}</td>
        <td style="text-align:center">${w.rating?'★'.repeat(w.rating):''}</td>
      </tr>`).join('');
    const totalValue = wines.filter(w=>w.price>0).reduce((s,w)=>s+(w.price*(w.quantity||1)),0);
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Vinage — Cellar Report</title>
      <style>
        body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;color:#1E0E3A;padding:24px}
        h1{font-size:22px;color:#5C2896;margin-bottom:4px}
        .sub{font-size:11px;color:#8B72A8;margin-bottom:20px}
        table{width:100%;border-collapse:collapse}
        th{background:#5C2896;color:#fff;padding:8px 10px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
        td{padding:7px 10px;border-bottom:1px solid #EEE6F7;vertical-align:top}
        tr:nth-child(even) td{background:#FAF7FD}
        .footer{margin-top:20px;font-size:11px;color:#8B72A8;display:flex;justify-content:space-between}
        @media print{body{padding:0}}
      </style>
    </head><body>
      <h1>Vinage — Cellar Report</h1>
      <div class="sub">Generated ${new Date().toLocaleDateString()} &nbsp;·&nbsp; ${wines.length} wines &nbsp;·&nbsp; ${wines.reduce((s,w)=>s+(w.quantity||1),0)} bottles</div>
      <table>
        <thead><tr>
          <th>Name</th><th>Producer</th><th>Vintage</th><th>Type</th>
          <th>Region</th><th style="text-align:center">Qty</th>
          <th style="text-align:right">Price</th><th style="text-align:center">Rating</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="footer">
        <span>Vinage — Your Personal Wine Cellar</span>
        ${totalValue > 0 ? `<span>Total cellar value: €${totalValue.toLocaleString('nl-NL',{minimumFractionDigits:2})}</span>` : ''}
      </div>
      <script>window.onload=function(){window.print();}<\/script>
    </body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  },

  _handleImport(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        DB.importAll(e.target.result);
        this.toast(this.t('settings.saved') + ' — data imported', 'success');
        this.renderView();
      } catch { this.toast(this.t('common.error'), 'error'); }
    };
    reader.readAsText(file);
  },

  clearData() {
    if (!confirm(this.t('settings.clearConfirm'))) return;
    DB.clearAll();
    this.toast('Cleared', 'success');
    this.renderView();
  },

  // ── About screen ──────────────────────────────────────────────────────────
  _showAbout() {
    // Build full-screen overlay (outside the modal system so it can be truly full-screen)
    const existing = document.getElementById('about-overlay');
    if (existing) { existing.remove(); return; }

    const el = document.createElement('div');
    el.id = 'about-overlay';
    el.innerHTML = `
      <div class="about-overlay-inner">
        <button class="about-close-btn" data-action="close-about" aria-label="Close">✕</button>
        <div class="about-hero-wrap">
          <picture>
            <source media="(min-width: 520px)" srcset="Vinage About Laptop-Desktop-iPad.png">
            <img src="Vinage About Mobile.png" class="about-hero-img" alt="Vinage">
          </picture>
        </div>
        <div class="about-content">
          <img src="Vinage Logo Name.png" class="about-wordmark" alt="Vinage">
          <p class="about-tagline">${this.t('settings.madeWith')}</p>
          <div class="about-features">
            <div class="about-feature-item">📷 ${this.lang === 'nl' ? 'Scannen & herkennen van wijnflessen' : 'Scan & identify wine bottles'}</div>
            <div class="about-feature-item">🗄️ ${this.lang === 'nl' ? 'Beheer jouw persoonlijke wijnkelder' : 'Manage your personal wine cellar'}</div>
            <div class="about-feature-item">🍽️ ${this.lang === 'nl' ? 'AI-gedreven spijscombinaties' : 'AI-powered food pairings'}</div>
            <div class="about-feature-item">☁️ ${this.lang === 'nl' ? 'Cloud synchronisatie & delen' : 'Cloud sync & household sharing'}</div>
            <div class="about-feature-item">🌐 ${this.lang === 'nl' ? 'Nederlands & Engels' : 'English & Dutch'}</div>
          </div>
          <div class="about-version">${this.t('settings.version')}</div>
        </div>
      </div>`;

    document.body.appendChild(el);

    // Tap outside content closes it
    el.addEventListener('click', e => {
      if (e.target === el || e.target.dataset.action === 'close-about') el.remove();
    });

    // Animate in
    requestAnimationFrame(() => el.classList.add('about-overlay-visible'));
  },

  // ── Notifications Settings Section ────────────────────────────────────────
  _buildNotifSection() {
    if (!('Notification' in window)) return '';
    const perm = Notification.permission;          // 'granted' | 'denied' | 'default'
    const s    = DB.getSettings();
    const drinkOn   = s.notifDrinkWindow !== false; // default on
    const decantOn  = s.notifDecant      !== false; // default on

    const statusLabel = perm === 'granted'
      ? `<span class="notif-status granted">${this.t('settings.notifGranted')}</span>`
      : perm === 'denied'
        ? `<span class="notif-status denied">${this.t('settings.notifDenied')}</span>`
        : `<span class="notif-status default">${this.t('settings.notifDefault')}</span>`;

    const enableBtn = perm === 'default'
      ? `<button class="btn btn-primary btn-sm" data-action="notif-request">${this.t('settings.notifEnable')}</button>`
      : '';

    const toggles = perm === 'granted' ? `
      <div class="settings-row notif-toggle-row">
        <div class="notif-toggle-label">
          <span>${this.t('settings.notifDrinkWindow')}</span>
          <small>${this.t('settings.notifDrinkWindowHint')}</small>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" data-action="notif-toggle" data-key="notifDrinkWindow" ${drinkOn ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="settings-row notif-toggle-row">
        <div class="notif-toggle-label">
          <span>${this.t('settings.notifDecant')}</span>
          <small>${this.t('settings.notifDecantHint')}</small>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" data-action="notif-toggle" data-key="notifDecant" ${decantOn ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <button class="btn btn-ghost btn-sm" style="margin-top:4px" data-action="notif-test">${this.t('settings.notifTestBtn')}</button>
    ` : '';

    return `
    <div class="settings-section">
      <h2>${this.t('settings.notifications')}</h2>
      <div class="settings-row">
        <label>${this.t('settings.notifStatus')}</label>
        ${statusLabel}
      </div>
      ${enableBtn}
      ${toggles}
    </div>`;
  },

  _handleNotifToggle(key, checked) {
    const s = DB.getSettings();
    s[key] = checked;
    DB.saveSettings(s);
  },

  _sendTestNotif() {
    if (Notification.permission !== 'granted') return;
    try {
      new Notification('Vinage 🍷', {
        body: 'Notifications are working!',
        icon: 'icons/apple-touch-icon.png'
      });
    } catch(_) {}
  },

  // ── Cloud Sync Section ─────────────────────────────────────────────────────
  _buildSyncSection() {
    const status = Sync.statusSummary();

    if (status.mode === 'disabled') {
      return `
      <div class="settings-section">
        <h2>${this.t('settings.sync')}</h2>
        <p class="sync-info-text">${this.t('settings.syncDisabled')}</p>
      </div>`;
    }

    if (status.mode === 'signed-out') {
      return `
      <div class="settings-section">
        <h2>${this.t('settings.sync')}</h2>
        <p class="sync-info-text">${this.t('settings.syncNoHousehold')}</p>
        <button class="btn btn-google btn-full" data-action="sync-sign-in">
          ${this._iconGoogle()} ${this.t('settings.syncSignIn')}
        </button>
      </div>`;
    }

    const userName = this._esc(status.user.displayName || status.user.email || '');

    if (status.mode === 'no-household') {
      return `
      <div class="settings-section">
        <h2>${this.t('settings.sync')}</h2>
        <div class="sync-user-row">
          <span class="sync-avatar">${this._esc((status.user.displayName||'?')[0].toUpperCase())}</span>
          <span>${this.t('settings.syncSignedInAs')} <strong>${userName}</strong></span>
          <button class="btn btn-ghost btn-sm" data-action="sync-sign-out" style="margin-left:auto">${this.t('settings.syncSignOut')}</button>
        </div>
        <p class="sync-info-text" style="margin-top:12px">${this.t('settings.syncNoHousehold')}</p>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
          <button class="btn btn-primary btn-full" data-action="sync-create">${this.t('settings.syncCreateHousehold')}</button>
          <div class="sync-join-row">
            <input id="sync-code-input" class="form-control" placeholder="${this.t('settings.syncJoinPlaceholder')}"
                   maxlength="6" style="text-transform:uppercase;letter-spacing:.12em">
            <button class="btn btn-secondary" data-action="sync-join">${this.t('settings.syncJoin')}</button>
          </div>
        </div>
      </div>`;
    }

    // mode === 'syncing'
    return `
    <div class="settings-section">
      <h2>${this.t('settings.sync')}</h2>
      <div class="sync-user-row">
        <span class="sync-avatar">${this._esc((status.user.displayName||'?')[0].toUpperCase())}</span>
        <span>${this.t('settings.syncSignedInAs')} <strong>${userName}</strong></span>
        <button class="btn btn-ghost btn-sm" data-action="sync-sign-out" style="margin-left:auto">${this.t('settings.syncSignOut')}</button>
      </div>
      <div class="sync-active-badge">
        <span class="sync-dot"></span>${this.t('settings.syncActive')}
      </div>
      <div class="sync-code-box">
        <div class="sync-code-label">${this.t('settings.syncCode')}</div>
        <div class="sync-code-value">${this._esc(status.inviteCode || '—')}</div>
        <div class="sync-code-hint">${this.t('settings.syncCodeHint')}</div>
      </div>
      <button class="btn btn-ghost btn-full" data-action="sync-leave" style="margin-top:8px;color:var(--text-lt)">${this.t('settings.syncLeave')}</button>
    </div>`;
  },

  _syncJoin() {
    const code = document.getElementById('sync-code-input')?.value?.trim().toUpperCase();
    if (!code || code.length < 4) { this.toast('Enter the 6-character code', 'error'); return; }
    Sync.joinHousehold(code);
  },

  _syncLeave() {
    if (!confirm(this.t('settings.syncLeaveConfirm'))) return;
    Sync.leaveHousehold();
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DECANTING TIMER (Feature 7)
  // ══════════════════════════════════════════════════════════════════════════
  _showDecantModal(wineId) {
    const wine = DB.getWineById(wineId);
    if (!wine) return;
    const presets = [30, 45, 60, 90, 120];
    const body = `
      <p style="margin-bottom:12px;color:var(--text-md)">${this.t('scan.decantMins')}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
        ${presets.map(m => `<button class="btn btn-secondary btn-sm decant-preset" data-mins="${m}" onclick="document.getElementById('decant-mins').value=${m}">${m} min</button>`).join('')}
      </div>
      <input id="decant-mins" class="form-control" type="number" min="1" max="480" value="60">`;
    this.showModal(this.t('scan.decantTitle'), body, [
      { label: this.t('common.cancel'), cls: 'btn-secondary', action: () => this.closeModal() },
      { label: this.t('scan.decantStart'), cls: 'btn-primary', action: () => {
        const mins = parseInt(document.getElementById('decant-mins')?.value || '60', 10);
        this.closeModal();
        this._startDecantTimer(wine, mins);
      }}
    ]);
  },

  _startDecantTimer(wine, mins) {
    // Clear existing timer
    if (this._decantTimer?.timerId) clearInterval(this._decantTimer.timerId);
    const endTime = Date.now() + mins * 60000;
    this._decantTimer = { wineId: wine.id, wineName: wine.name, endTime, timerId: null };
    localStorage.setItem('vinage_decant_timer', JSON.stringify({ wineId: wine.id, wineName: wine.name, endTime }));
    this._renderDecantBubble();
  },

  _renderDecantBubble() {
    let bubble = document.getElementById('decant-bubble');
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.id = 'decant-bubble';
      bubble.dataset.action = 'cancel-decant';
      document.getElementById('app').appendChild(bubble);
    }

    const update = () => {
      if (!this._decantTimer) { bubble.remove(); return; }
      const remaining = this._decantTimer.endTime - Date.now();
      if (remaining <= 0) {
        bubble.remove();
        this._decantTimer = null;
        localStorage.removeItem('vinage_decant_timer');
        const msg = this.t('scan.decantDone', { name: this._decantTimer?.wineName || '' });
        this.toast(msg, 'success');
        if (Notification.permission === 'granted' && DB.getSettings().notifDecant !== false) {
          new Notification('Vinage', { body: this.t('scan.decantDone', { name: this._decantTimer?.wineName || '' }), icon: 'icons/apple-touch-icon.png' });
        }
        return;
      }
      const totalSec = Math.ceil(remaining / 1000);
      const mm = String(Math.floor(totalSec / 60)).padStart(2,'0');
      const ss = String(totalSec % 60).padStart(2,'0');
      bubble.textContent = `🫗 ${mm}:${ss}`;
    };

    update();
    if (this._decantTimer) {
      // Fix: capture timer name before clearing
      const wineName = this._decantTimer.wineName;
      if (this._decantTimer.timerId) clearInterval(this._decantTimer.timerId);
      this._decantTimer.timerId = setInterval(() => {
        if (!this._decantTimer) { clearInterval(this._decantTimer?.timerId); return; }
        const remaining = this._decantTimer.endTime - Date.now();
        if (remaining <= 0) {
          clearInterval(this._decantTimer.timerId);
          bubble.remove();
          this._decantTimer = null;
          localStorage.removeItem('vinage_decant_timer');
          const msg = this.t('scan.decantDone', { name: wineName });
          this.toast(msg, 'success');
          if (Notification.permission === 'granted') {
            try { new Notification('Vinage', { body: msg, icon: 'icons/apple-touch-icon.png' }); } catch(_){}
          }
          return;
        }
        const totalSec = Math.ceil(remaining / 1000);
        const mm = String(Math.floor(totalSec / 60)).padStart(2,'0');
        const ss = String(totalSec % 60).padStart(2,'0');
        bubble.textContent = `🫗 ${mm}:${ss}`;
      }, 1000);
    }
  },

  _cancelDecantTimer() {
    if (!this._decantTimer) return;
    if (!confirm(this.t('scan.decantCancel') + '?')) return;
    if (this._decantTimer.timerId) clearInterval(this._decantTimer.timerId);
    this._decantTimer = null;
    localStorage.removeItem('vinage_decant_timer');
    document.getElementById('decant-bubble')?.remove();
  },

  _restoreDecantTimer() {
    try {
      const saved = JSON.parse(localStorage.getItem('vinage_decant_timer') || 'null');
      if (saved && saved.endTime > Date.now()) {
        this._decantTimer = { wineId: saved.wineId, wineName: saved.wineName, endTime: saved.endTime, timerId: null };
        this._renderDecantBubble();
      } else if (saved) {
        localStorage.removeItem('vinage_decant_timer');
      }
    } catch(_) {}
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SHARE WINE CARD (Feature 10)
  // ══════════════════════════════════════════════════════════════════════════
  _showShareModal(wineId) {
    const wine = DB.getWineById(wineId);
    if (!wine) return;
    const body = `
      <div style="text-align:center">
        <canvas id="share-canvas" width="400" height="560" style="width:100%;max-width:300px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.2)"></canvas>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:14px;flex-wrap:wrap">
          <button class="btn btn-secondary" data-action="download-share-card">${this.t('common.shareDownload')}</button>
          <button class="btn btn-primary" data-action="native-share-card">${this.t('common.shareWine')}</button>
        </div>
      </div>`;
    this.showModal(this.t('common.shareWine'), body, [
      { label: this.t('common.close'), cls: 'btn-secondary', action: () => this.closeModal() }
    ]);
    // Render canvas after modal is in DOM
    setTimeout(() => this._drawShareCard(wine), 50);
  },

  _drawShareCard(wine) {
    const canvas = document.getElementById('share-canvas');
    if (!canvas) return;
    this._shareWine = wine;
    const ctx = canvas.getContext('2d');
    const W = 400, H = 560;

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#36165E');
    grad.addColorStop(1, '#5C2896');
    ctx.fillStyle = grad;
    ctx.roundRect ? ctx.roundRect(0,0,W,H,20) : ctx.fillRect(0,0,W,H);
    ctx.fill();

    // Subtle pattern overlay
    ctx.fillStyle = 'rgba(255,255,255,.04)';
    for (let y=0; y<H; y+=30) for (let x=0; x<W; x+=30) { ctx.beginPath(); ctx.arc(x,y,1,0,Math.PI*2); ctx.fill(); }

    // Wine type badge
    const typeColors = { red:'#7B1A2E', white:'#C8A830', 'rosé':'#D47080', sparkling:'#6A9050', dessert:'#D4A030', fortified:'#8B4513' };
    const tc = typeColors[wine.type] || '#7B1A2E';
    ctx.fillStyle = tc + '44';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(20,20,120,30,15) : ctx.rect(20,20,120,30);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px -apple-system,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText((TRANSLATIONS[this.lang]?.types?.[wine.type]||wine.type).toUpperCase(), 32, 40);

    // Vinage logo text
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.font = '11px -apple-system,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('VINAGE', W-20, 38);

    // Image area (or coloured rect)
    const imgY = 70, imgH = 220;
    const thumbSrc = wine.thumbnail ? `data:image/jpeg;base64,${wine.thumbnail}` : wine.imageUrl || null;
    const drawText = () => {
      // Wine name
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.font = 'bold 26px -apple-system,sans-serif';
      const maxW = W - 40;
      const name = wine.name;
      ctx.fillText(name.length > 28 ? name.slice(0,26)+'…' : name, 20, imgY + imgH + 40);

      // Producer
      if (wine.producer) {
        ctx.fillStyle = 'rgba(255,255,255,.65)';
        ctx.font = '15px -apple-system,sans-serif';
        ctx.fillText(wine.producer.length > 36 ? wine.producer.slice(0,34)+'…' : wine.producer, 20, imgY + imgH + 66);
      }

      // Vintage + Region
      const meta = [wine.vintage, wine.region].filter(Boolean).join('  ·  ');
      if (meta) {
        ctx.fillStyle = 'rgba(255,255,255,.5)';
        ctx.font = '13px -apple-system,sans-serif';
        ctx.fillText(meta, 20, imgY + imgH + 90);
      }

      // Stars
      if (wine.rating) {
        ctx.fillStyle = '#C8913A';
        ctx.font = '18px -apple-system,sans-serif';
        ctx.fillText('★'.repeat(wine.rating), 20, imgY + imgH + 118);
      }

      // Notes excerpt
      if (wine.notes) {
        ctx.fillStyle = 'rgba(255,255,255,.45)';
        ctx.font = '12px -apple-system,sans-serif';
        const excerpt = wine.notes.slice(0,80) + (wine.notes.length > 80 ? '…' : '');
        ctx.fillText(excerpt, 20, imgY + imgH + 145);
      }

      // Bottom line
      ctx.strokeStyle = 'rgba(255,255,255,.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(20, H-36);
      ctx.lineTo(W-20, H-36);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      ctx.font = '11px -apple-system,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Tracked with Vinage', W/2, H-16);
    };

    if (thumbSrc) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        ctx.save();
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(20, imgY, W-40, imgH, 10);
        else ctx.rect(20, imgY, W-40, imgH);
        ctx.clip();
        // Draw image centered/cropped
        const aspect = img.width / img.height;
        const targetAspect = (W-40) / imgH;
        let sx=0, sy=0, sw=img.width, sh=img.height;
        if (aspect > targetAspect) { sw = img.height * targetAspect; sx = (img.width-sw)/2; }
        else { sh = img.width / targetAspect; sy = (img.height-sh)/2; }
        ctx.drawImage(img, sx, sy, sw, sh, 20, imgY, W-40, imgH);
        ctx.restore();
        drawText();
      };
      img.onerror = () => {
        ctx.fillStyle = tc + '33';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(20, imgY, W-40, imgH, 10);
        else ctx.rect(20, imgY, W-40, imgH);
        ctx.fill();
        drawText();
      };
      img.src = thumbSrc;
    } else {
      ctx.fillStyle = tc + '33';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(20, imgY, W-40, imgH, 10);
      else ctx.rect(20, imgY, W-40, imgH);
      ctx.fill();
      drawText();
    }
  },

  _downloadShareCard() {
    const canvas = document.getElementById('share-canvas');
    if (!canvas) return;
    const wine = this._shareWine;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${wine ? wine.name.replace(/[^a-z0-9]/gi,'_') : 'vinage'}-card.png`;
    a.click();
  },

  async _nativeShare() {
    const canvas = document.getElementById('share-canvas');
    if (!canvas) return;
    const wine = this._shareWine;
    if (navigator.share && navigator.canShare) {
      try {
        canvas.toBlob(async blob => {
          const file = new File([blob], `${wine?.name||'wine'}-card.png`, { type: 'image/png' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: wine?.name || 'Wine', text: `${wine?.name||''} ${wine?.vintage||''} — Tracked with Vinage` });
          } else {
            this._downloadShareCard();
          }
        }, 'image/png');
      } catch(_) { this._downloadShareCard(); }
    } else {
      this._downloadShareCard();
    }
  },

  // ══════════════════════════════════════════════════════════════════════════
  // PUSH NOTIFICATIONS (Feature 11)
  // ══════════════════════════════════════════════════════════════════════════
  _maybePromptNotifications() {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'default') return;
    // Show a non-intrusive toast with Allow button
    const el = document.createElement('div');
    el.id = 'notif-prompt-toast';
    el.className = 'notif-prompt-toast';
    el.innerHTML = `
      <span>${this.t('common.notifPrompt')}</span>
      <button class="btn btn-primary btn-sm" data-action="allow-notif">${this.t('common.notifAllow')}</button>
      <button class="btn btn-ghost btn-sm" data-action="dismiss-notif">${this.t('common.notifDismiss')}</button>`;
    document.getElementById('toast-container').appendChild(el);
    // Auto-dismiss after 12 seconds
    setTimeout(() => el.remove(), 12000);
  },

  _requestNotifications() {
    document.getElementById('notif-prompt-toast')?.remove();
    if (!('Notification' in window)) return;
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') {
        this.toast(this.t('common.notifAllow') + ' ✓', 'success');
        this._checkDrinkWindowNotifications();
      }
    });
  },

  _checkDrinkWindowNotifications() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (DB.getSettings().notifDrinkWindow === false) return;
    const currentYear = new Date().getFullYear();
    DB.getWines().forEach(wine => {
      if (this._drinkStatus(wine) === 'ready') {
        const key = `vinage_notif_${wine.id}_${currentYear}`;
        if (!localStorage.getItem(key)) {
          localStorage.setItem(key, '1');
          // Schedule a same-session notification with a small delay per wine
          setTimeout(() => {
            try {
              new Notification('Vinage — Ready to drink!', {
                body: `${wine.name}${wine.vintage ? ' ('+wine.vintage+')' : ''} is in its drink window.`,
                icon: 'icons/apple-touch-icon.png'
              });
            } catch(_) {}
          }, 2000);
        }
      }
    });
  },

  // ══════════════════════════════════════════════════════════════════════════
  // MODAL SYSTEM
  // ══════════════════════════════════════════════════════════════════════════
  showModal(title, body, buttons) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = body;
    const footer = document.getElementById('modal-footer');
    footer.innerHTML = '';
    (buttons || []).forEach(btn => {
      const el = document.createElement('button');
      el.className = 'btn ' + (btn.cls || '');
      el.textContent = btn.label;
      if (btn.id) el.id = btn.id;
      el.onclick = btn.action;
      footer.appendChild(el);
    });
    footer.style.display = buttons?.length ? '' : 'none';
    document.getElementById('modal-overlay').classList.add('open');
  },

  closeModal() {
    document.getElementById('modal-overlay').classList.remove('open');
    this.capturedImage = this.capturedImage; // preserve if scan
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TOAST
  // ══════════════════════════════════════════════════════════════════════════
  toast(msg, type) {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 3000);
  },

  // ══════════════════════════════════════════════════════════════════════════
  // UTILS
  // ══════════════════════════════════════════════════════════════════════════
  _esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },

  _typeColor(type) {
    return { red:'#7B1A2E', white:'#C8A830', 'rosé':'#D47080',
             sparkling:'#6A9050', dessert:'#D4A030', fortified:'#8B4513' }[type] || '#7B1A2E';
  },

  _typeClass(type) {
    return { red:'red-wine', white:'white-wine', 'rosé':'rosé',
             sparkling:'sparkling', dessert:'dessert', fortified:'fortified' }[type] || 'red-wine';
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SVG ICONS
  // ══════════════════════════════════════════════════════════════════════════
  _iconCamera() {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
      <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
      <path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
    </svg>`;
  },
  _iconCameraLg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" width="64" height="64">
      <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
      <path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
    </svg>`;
  },
  _iconCircle() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="var(--burgundy)" width="36" height="36">
      <circle cx="12" cy="12" r="10"/>
    </svg>`;
  },
  _iconCellar() {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
      <path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
    </svg>`;
  },
  _iconCellarLg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" width="56" height="56">
      <path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
    </svg>`;
  },
  _iconWine() {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 3h6l1 7a4 4 0 01-8 0L9 3zM12 14v7M8 21h8"/>
    </svg>`;
  },
  _iconWineLg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" width="56" height="56">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 3h6l1 7a4 4 0 01-8 0L9 3zM12 14v7M8 21h8"/>
    </svg>`;
  },
  _iconFork() {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 8c0-2.21.895-4 2-4s2 1.79 2 4v3l-2 1v8M8 4v5.5a2.5 2.5 0 005 0V4"/>
    </svg>`;
  },
  _iconGear() {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
      <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
      <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
    </svg>`;
  },
  _iconX() {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="20" height="20">
      <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
    </svg>`;
  },
  _iconBack() {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="22" height="22">
      <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
    </svg>`;
  },
  _iconTrash() {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" width="20" height="20">
      <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
    </svg>`;
  },
  _iconSearch() {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
    </svg>`;
  },
  _iconRotate() {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="22" height="22">
      <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
    </svg>`;
  },

  _iconHeart() {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
      <path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
    </svg>`;
  },
  _iconBottle() {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 3h6M9 3v2.5A2.5 2.5 0 007.5 8v9A3 3 0 0010.5 20h3a3 3 0 003-3V8A2.5 2.5 0 0015 5.5V3"/>
      <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 13h9"/>
    </svg>`;
  },
  _iconStats() {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
      <path stroke-linecap="round" stroke-linejoin="round" d="M3 18v-6a9 9 0 0118 0v6"/>
      <path stroke-linecap="round" stroke-linejoin="round" d="M3 18a1 1 0 001 1h1a1 1 0 001-1v-2a1 1 0 00-1-1H4a1 1 0 00-1 1v2zM18 18a1 1 0 001 1h1a1 1 0 001-1v-2a1 1 0 00-1-1h-1a1 1 0 00-1 1v2z"/>
    </svg>`;
  },
  _iconGrid() {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" width="18" height="18">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>`;
  },
  _iconList() {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" width="18" height="18">
      <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
    </svg>`;
  },
  _iconShare() {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" width="16" height="16">
      <path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
    </svg>`;
  },
  _iconGoogle() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="18" height="18">
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2v6h7.8c4.5-4.2 7.1-10.3 7.1-17.2z"/>
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.8-5.8l-7.8-6c-2.1 1.4-4.8 2.3-8 2.3-6.1 0-11.3-4.1-13.2-9.7H2.8v6.2C6.7 42.9 14.8 48 24 48z"/>
      <path fill="#FBBC05" d="M10.8 28.8c-.5-1.4-.7-2.9-.7-4.4s.2-3 .7-4.4v-6.2H2.8C1 17.2 0 20.5 0 24s1 6.8 2.8 10.2l8-6.2-.0001.0001z"/>
      <path fill="#EA4335" d="M24 9.5c3.4 0 6.5 1.2 8.9 3.5l6.6-6.6C35.9 2.7 30.4.5 24 .5 14.8.5 6.7 5.6 2.8 13.8l8 6.2C12.7 13.6 17.9 9.5 24 9.5z"/>
    </svg>`;
  }
};

// ── Start ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
