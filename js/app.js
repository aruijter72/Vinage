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
    this.lang = detectLang();
    this._applyTheme();  // apply dark/light before first render
    this.render();
    this.navigate('cellar');
    document.addEventListener('click',  e => this._delegateClick(e));
    document.addEventListener('change', e => this._delegateChange(e));
    Sync.init();
    this._restoreDecantTimer();
    this._checkDrinkWindowNotifications();
    // Notification prompt removed — users can enable from Settings instead
    // Migrate any full images still in localStorage → IndexedDB (frees storage space)
    ImageDB.migrate();
    // After auth settles, upload any IndexedDB images that aren't yet on Firebase Storage
    setTimeout(() => this._migrateImagesToFirebase(), 5000);
    // Show consent overlay on first launch (GDPR)
    if (!localStorage.getItem('vinageConsent')) {
      setTimeout(() => this._showConsent(), 400);
    }
  },

  // ── Dark mode ─────────────────────────────────────────────────────────────
  _applyTheme() {
    const dark = DB.getSettings().darkMode === true;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  },

  toggleDarkMode() {
    const s = DB.getSettings();
    s.darkMode = !s.darkMode;
    DB.saveSettings(s);
    this._applyTheme();
    // Re-render settings so the toggle reflects the new state
    if (this.view === 'settings') this.renderView();
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
    if (vars) Object.entries(vars).forEach(([k,v]) => s = s.replaceAll(`{${k}}`, v));
    return s;
  },

  // ── Navigation ────────────────────────────────────────────────────────────
  navigate(view) {
    if (view !== 'scan') { this.stopCamera(); this.stopBarcodeScanner(); }
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

    document.getElementById('modal-close-btn').onclick = () => this._tryCloseModal();
    document.getElementById('modal-overlay').onclick = e => {
      if (e.target === document.getElementById('modal-overlay')) this._tryCloseModal();
    };
  },

  renderNav() {
    // Scan sits at position 4 (centre of 7) — rendered as a raised pill button
    const items = [
      { id: 'cellar',     icon: this._iconCellar(),    label: this.t('nav.cellar') },
      { id: 'collection', icon: this._iconWine(),      label: this.t('nav.collection') },
      { id: 'pairing',    icon: this._iconFork(),      label: this.t('nav.pairing') },
      { id: 'scan',       icon: this._iconCamera(),    label: this.t('nav.scan'),   center: true },
      { id: 'wishlist',   icon: this._iconHeart(),     label: this.t('nav.wishlist') },
      { id: 'stats',      icon: this._iconStats(),     label: this.t('nav.stats') },
      { id: 'settings',   icon: this._iconGear(),      label: this.t('nav.settings') },
    ];
    document.getElementById('bottom-nav').innerHTML = items.map(item => {
      const isActive = this.view === item.id;
      if (item.center) {
        return `
          <button class="nav-item nav-item-scan${isActive ? ' active' : ''}" data-nav="${item.id}" aria-label="${item.label}">
            <div class="nav-scan-pill">${item.icon}</div>
            <span>${item.label}</span>
          </button>`;
      }
      return `
        <button class="nav-item${isActive ? ' active' : ''}" data-nav="${item.id}" aria-label="${item.label}">
          ${item.icon}<span>${item.label}</span>
        </button>`;
    }).join('');
  },

  renderView() {
    window.scrollTo(0, 0);
    const el = document.getElementById('main-content');
    switch (this.view) {
      case 'scan':
        el.innerHTML = this.buildScanView();
        if (this._scanMode === 'barcode') { this.startBarcodeScanner(); }
        else if (this._scanMode === 'search') { this._initSearchInput(); }
        else { this.initCamera(); }
        break;
      case 'cellar':
        el.innerHTML = this.cellarDetailId ? this.buildCellarDetail() : this.buildCellarList();
        if (this.cellarDetailId) setTimeout(() => { this._initRackHover(); this._initRackZoom(); }, 0);
        break;
      case 'collection': el.innerHTML = this.buildCollectionView(); break;
      case 'wishlist':   el.innerHTML = this.buildWishlistView(); break;
      case 'pairing':    el.innerHTML = this.buildPairingView(); break;
      case 'stats':      el.innerHTML = this.buildStatsView(); break;
      case 'settings':   el.innerHTML = this.buildSettingsView(); break;
      case 'privacy':    el.innerHTML = this.buildPrivacyView(); break;
      case 'terms':      el.innerHTML = this.buildTermsView(); break;
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
      case 'regen-notes':         this._regenNotes(); break;
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
      case 'filter-ready-cellar': this._setExclusiveFilter('drink-now'); break;
      // Cellar map
      case 'toggle-cellar-map':   this._cellarMapOpen = !this._cellarMapOpen; this.renderView(); break;
      // Decanting timer
      case 'start-decant':        this._showDecantModal(args.id); break;
      case 'cancel-decant':       this._cancelDecantTimer(); break;
      case 'toggle-dark-mode':    this.toggleDarkMode(); break;
      case 'scan-mode-switch':    this.switchScanMode(args.mode); break;
      case 'retake-barcode':      this._restartBarcodeScanner(); break;
      case 'do-wine-search':      this._doWineSearch(); break;
      case 'search-add-collection': this._searchResultToWine(Number(args.idx), false); break;
      case 'search-add-wishlist':   this._searchResultToWine(Number(args.idx), true);  break;
      // Share wine card
      case 'share-wine':          this._shareWineAsHTML(args.id); break;
      case 'show-help':           this._showHelp(); break;
      // Consumption
      case 'consume-bottle':      this._consumeBottle(args.id); break;
      case 'delete-consumption':  Sync.deleteConsumptionEntry(args.id); this.renderView(); break;
      case 'restore-consumption': this._restoreConsumption(args.id); break;
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
      case 'show-privacy':        this.navigate('privacy'); break;
      case 'show-terms':          this.navigate('terms'); break;
      case 'back-to-settings':    this.navigate('settings'); break;
      case 'preview-consent':     this._showConsent(true); break;
      // PDF
      case 'export-pdf':          this.exportPdf(); break;
      // Cloud sync actions
      case 'sync-sign-in':        Sync.signIn(); break;
      case 'sync-sign-out':       Sync.signOut(); break;
      case 'sync-create':         Sync.createHousehold(); break;
      case 'sync-join':           this._syncJoin(); break;
      case 'sync-leave':          this._syncLeave(); break;
      case 'delete-account':      this._deleteAccount(); break;
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
    const mode = this._scanMode || 'label';
    const isSearch = mode === 'search';

    const toggleBar = `
      <div class="scan-mode-toggle-bar">
        <div class="scan-mode-toggle">
          <button class="scan-mode-btn${mode === 'label' ? ' active' : ''}" data-action="scan-mode-switch" data-mode="label">
            📷 ${this.t('scan.labelMode')}
          </button>
          <button class="scan-mode-btn${mode === 'barcode' ? ' active' : ''}" data-action="scan-mode-switch" data-mode="barcode">
            🔲 ${this.t('scan.barcodeMode')}
          </button>
          <button class="scan-mode-btn${mode === 'search' ? ' active' : ''}" data-action="scan-mode-switch" data-mode="search">
            🔍 ${this.t('scan.searchMode')}
          </button>
        </div>
      </div>`;

    if (isSearch) {
      return `
      <div id="scan-view" style="display:flex;flex-direction:column;height:100%">
        ${toggleBar}
        <div class="search-mode-wrap" id="search-mode-wrap">
          <div class="search-input-row">
            <input id="search-query-input" class="form-control" type="search"
                   placeholder="${this.t('scan.searchPlaceholder')}"
                   value="${this._esc(this._lastSearchQuery || '')}">
            <button class="btn btn-primary" data-action="do-wine-search">${this.t('scan.searchBtn')}</button>
          </div>
          <div id="search-results">${this._renderSearchResults()}</div>
        </div>
      </div>`;
    }

    return `
    <div id="scan-view">
      <div class="camera-area">
        <video id="camera-video" autoplay playsinline muted></video>
        <canvas id="camera-canvas"></canvas>
        <!-- Label mode frame -->
        <div class="camera-overlay" id="label-overlay"><div class="camera-frame"></div></div>
        <!-- Barcode mode frame + animated scan line -->
        <div class="barcode-overlay${mode === 'barcode' ? ' active' : ''}" id="barcode-overlay">
          <div class="barcode-frame"><div class="barcode-scanline"></div></div>
        </div>
        <div class="camera-placeholder" id="camera-placeholder">
          <p class="scan-instruction-text">${mode === 'barcode' ? this.t('scan.barcodeScanning') : this.t('scan.instruction')}</p>
        </div>
      </div>
      <div class="scan-controls">
        <!-- Mode toggle — lives in controls so it clears the safe-area notch -->
        ${toggleBar}
        <div id="scan-status" class="scan-status">&nbsp;</div>
        <!-- Statement strip: cream band with slogan -->
        <div class="scan-statement-strip">
          <span class="scan-statement-text">${this.lang === 'nl' ? 'JOUW WIJN. JOUW COLLECTIE.' : 'YOUR WINE. YOUR COLLECTION.'}</span>
        </div>
        <!-- Dark brand panel: V-bottle (→ About) · camera button · wordmark -->
        <div class="scan-brand-panel">
          <img src="Logo Vinage V-Bottle No Background.png" class="scan-brand-mark" alt="About Vinage"
               data-action="show-about" draggable="false" role="button" tabindex="0" aria-label="About Vinage">
          <button class="capture-btn" id="capture-btn" data-action="start-camera" title="${this.t('scan.startCamera')}"
                  style="${mode === 'barcode' ? 'display:none' : ''}">
            ${this._iconCamera()}
          </button>
          <img src="Logo Vinage Name No Background.png" class="scan-brand-name" alt="Vinage" draggable="false">
        </div>
        <div id="scan-action-row" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;align-items:center;padding:8px 16px 0;">
          <button class="btn btn-secondary btn-icon" id="rotate-btn" data-action="rotate-camera"
                  title="Rotate image" style="display:none">${this._iconRotate()}</button>
        </div>
        <button class="btn btn-ghost btn-full" data-action="manual-add-wine" style="margin:8px 16px 0;width:calc(100% - 32px)">${this.t('scan.manualAdd')}</button>
      </div>
    </div>`;
  },

  _renderSearchResults() {
    const results = this._searchResults;
    if (!results) return '';
    if (results.length === 0) {
      return `<div class="search-status">${this.t('scan.searchNoResults')}</div>`;
    }
    const typeColor = { red:'#8B1A2E', white:'#C8A84B', 'rosé':'#E8A0A0', sparkling:'#A0C8E8', dessert:'#C8A800', fortified:'#7A4A8A' };
    return `
      <div class="search-results-title">${this.t('scan.searchResultsTitle')} (${results.length})</div>
      ${results.map((w, i) => `
        <div class="search-result-card">
          <div class="search-result-header">
            <div class="search-result-type-dot" style="background:${typeColor[w.type] || '#999'}"></div>
            <div class="search-result-title-block">
              <div class="search-result-name">${this._esc(w.name || '—')}</div>
              <div class="search-result-producer">${this._esc(w.producer || '')}${w.vintage ? ' · ' + w.vintage : ''}</div>
            </div>
            ${w.estimatedPrice ? `<div class="search-result-price">~€${w.estimatedPrice}</div>` : ''}
          </div>
          <div class="search-result-meta">
            ${w.region  ? `<span class="search-result-tag">${this._esc(w.region)}</span>` : ''}
            ${w.country ? `<span class="search-result-tag">${this._esc(w.country)}</span>` : ''}
            ${w.type    ? `<span class="search-result-tag">${this._esc(w.type)}</span>` : ''}
            ${(w.grapes||[]).map(g => `<span class="search-result-tag">${this._esc(g)}</span>`).join('')}
          </div>
          ${w.notes ? `<div class="search-result-notes">${this._esc(w.notes)}</div>` : ''}
          <div class="search-result-actions">
            <button class="btn btn-primary" data-action="search-add-collection" data-idx="${i}">${this.t('scan.searchAddCollection')}</button>
            <button class="btn btn-secondary" data-action="search-add-wishlist" data-idx="${i}">${this.t('scan.searchAddWishlist')}</button>
          </div>
        </div>`).join('')}`;
  },

  async _doWineSearch() {
    const input = document.getElementById('search-query-input');
    const query = input?.value?.trim();
    if (!query) return;
    this._lastSearchQuery = query;

    const resultsEl = document.getElementById('search-results');
    if (resultsEl) resultsEl.innerHTML = `<div class="search-status">${this.t('scan.searching')}</div>`;

    const settings = DB.getSettings();
    if (!settings.anthropicKey && !settings.openaiKey) {
      if (resultsEl) resultsEl.innerHTML = `<div class="search-status">${this.t('scan.apiKeyMissing')}</div>`;
      return;
    }

    try {
      const results = await API.searchWines(query, settings, this.lang);
      this._searchResults = results;
      if (resultsEl) resultsEl.innerHTML = this._renderSearchResults();
    } catch (e) {
      if (resultsEl) resultsEl.innerHTML = `<div class="search-status">${this.t('scan.barcodeError')}</div>`;
    }
  },

  _searchResultToWine(idx, toWishlist = false) {
    const w = (this._searchResults || [])[idx];
    if (!w) return;
    const wineData = {
      name:           w.name     || '',
      producer:       w.producer || '',
      vintage:        w.vintage  || null,
      region:         w.region   || '',
      country:        w.country  || '',
      type:           w.type     || 'red',
      grapes:         w.grapes   || [],
      pairings:       w.pairings || [],
      notes:          w.notes    || '',
      drinkFrom:      w.drinkFrom  || null,
      drinkUntil:     w.drinkUntil || null,
      price:          w.estimatedPrice || null,
      quantity:       1,
    };
    if (toWishlist) {
      // Wishlist is stored separately from the wine collection
      DB.addWishlistItem(wineData);
      this.toast(this.lang === 'nl' ? 'Toegevoegd aan verlanglijst!' : 'Added to Wishlist!', 'success');
    } else {
      // Open the pre-filled wine form — saveWineForm() will trigger cellar placement
      this.showWineForm(wineData);
    }
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

  // ── Barcode scanning ──────────────────────────────────────────────────────
  switchScanMode(mode) {
    if (this._scanMode === mode) return;
    // Stop whatever is currently running
    this.stopCamera();
    this.stopBarcodeScanner();
    this._scanMode = mode;
    // Re-render the scan view in the new mode
    const el = document.getElementById('main-content');
    if (el && this.view === 'scan') {
      el.innerHTML = this.buildScanView();
      if (mode === 'barcode') this.startBarcodeScanner();
      else if (mode === 'search') this._initSearchInput();
      else this.initCamera();
    }
  },

  _initSearchInput() {
    const input = document.getElementById('search-query-input');
    if (!input) return;
    input.focus();
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this._doWineSearch(); }
    });
  },

  async startBarcodeScanner() {
    if (!window.ZXing) {
      this._setScanStatus('ZXing library not loaded.', 'error');
      return;
    }
    const video = document.getElementById('camera-video');
    const placeholder = document.getElementById('camera-placeholder');
    if (!video) return;

    this._setScanStatus(`<span class="spinner"></span>${this.t('scan.barcodeScanning')}`, '');
    if (placeholder) placeholder.style.display = 'none';

    try {
      const hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
        ZXing.BarcodeFormat.QR_CODE,
      ]);
      this._barcodeReader = new ZXing.BrowserMultiFormatReader(hints);

      await this._barcodeReader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        video,
        (result, err) => {
          if (result) {
            const code = result.getText();
            this._barcodeReader.reset();
            this._barcodeReader = null;
            this._onQRDetected(code);
          }
          // NotFoundException fires on every empty frame — ignore it
        }
      );
    } catch (err) {
      this._setScanStatus(this.t('scan.cameraError'), 'error');
    }
  },

  stopBarcodeScanner() {
    if (this._barcodeReader) {
      try { this._barcodeReader.reset(); } catch (_) {}
      this._barcodeReader = null;
    }
  },

  _restartBarcodeScanner() {
    // Reset UI state then restart scanning
    this.stopBarcodeScanner();
    this.scanResult = null;
    this._setScanStatus(`<span class="spinner"></span>${this.t('scan.barcodeScanning')}`, '');
    const actionRow = document.getElementById('scan-action-row');
    if (actionRow) actionRow.innerHTML = '';
    this.startBarcodeScanner();
  },

  async _onQRDetected(code) {
    const actionRow = document.getElementById('scan-action-row');

    // ── OrigoVero / GS1 Digital Link ─────────────────────────────────────────
    if (code.includes('origovero.com')) {
      this._handleOrigoVeroScan(code);
      return;
    }

    // ── Generic URL → fetch page + AI extract ────────────────────────────────
    if (code.startsWith('http://') || code.startsWith('https://')) {
      this._handleGenericQRUrl(code);
      return;
    }

    // ── Anything else (plain text, vCard, etc.) — not a wine QR ──────────────
    this._setScanStatus(this.t('scan.barcodeNotFound'), 'error');
    if (actionRow) actionRow.innerHTML = `
      <button class="btn btn-ghost btn-sm" data-action="add-wine-from-scan">${this.t('scan.manualAdd')}</button>
      <button class="btn btn-secondary btn-sm" data-action="retake-barcode">${this.t('scan.retake')}</button>`;
  },

  // ── OrigoVero / GS1 Digital Link QR handler ──────────────────────────────
  async _handleOrigoVeroScan(url) {
    this._setScanStatus(`<span class="spinner"></span>${this.t('scan.barcodeLookingUp')}`, '');

    // Extract GTIN-14 and optional per-bottle serial from GS1 Digital Link
    // Format: https://dev.origovero.com/01/{GTIN-14}/21/{serial}
    const gtinMatch   = url.match(/\/01\/(\d{14})/);
    const serialMatch = url.match(/\/21\/([^/?&#]+)/);

    if (!gtinMatch) {
      this._setScanStatus('OrigoVero QR detected, but no product ID found.', 'error');
      const ar = document.getElementById('scan-action-row');
      if (ar) ar.innerHTML = `
        <button class="btn btn-ghost btn-sm" data-action="add-wine-from-scan">${this.t('scan.manualAdd')}</button>
        <button class="btn btn-secondary btn-sm" data-action="retake-barcode">${this.t('scan.retake')}</button>`;
      return;
    }

    const gtin14 = gtinMatch[1];
    const serial = serialMatch ? serialMatch[1] : null;
    const ean13  = gtin14.startsWith('0') ? gtin14.slice(1) : gtin14;
    const settings = DB.getSettings();
    let partial = {};

    try {
      // ── Phase 2: OrigoVero DPP API ──────────────────────────────────────
      if (settings.origoveroKeyId && settings.origoveroKeySecret) {
        try {
          this._setScanStatus(`<span class="spinner"></span>${this.t('scan.dppLookingUp')}`, '');
          const product = await this._lookupOrigoVeroDpp(gtin14);
          if (product && !product.error) {
            partial = this._mapOrigoVeroProduct(product);
            if (serial) partial._serialNumber = serial;
          }
        } catch (_) { /* fall through to OFF */ }
      }

      // ── Phase 1 fallback: Open Food Facts ───────────────────────────────
      if (!partial.name) {
        try {
          const off = await this._lookupOpenFoodFacts(ean13);
          // Merge: DPP fields win; OFF fills what DPP didn't have
          partial = { ...off, ...partial };
        } catch (_) {}
      }

      // Always stamp provenance
      partial._sourceGtin = partial._sourceGtin || gtin14;
      partial._sourceEan  = ean13;
      partial._sourceUrl  = url;

      // ── AI enrichment — fills producer + any remaining gaps ─────────────
      const hasAiKey = settings.anthropicKey || settings.openaiKey;
      if (hasAiKey) {
        this._setScanStatus(`<span class="spinner"></span>${this.t('scan.barcodeEnriching')}`, '');
        try {
          const enriched = await API.enrichWineData(partial, settings, this.lang);
          if (!enriched.error) {
            // DPP-sourced fields win; AI fills what's still missing
            partial = {
              ...enriched,
              name:       partial.name       || enriched.name,
              vintage:    partial.vintage    || enriched.vintage,
              region:     partial.region     || enriched.region,
              type:       partial.type       || enriched.type,
              country:    partial.country    || enriched.country,
              grapes:     (partial.grapes?.length ? partial.grapes : null) || enriched.grapes,
              notes:      partial.notes      || enriched.notes,
              drinkFrom:  partial.drinkFrom  || enriched.drinkFrom,
              drinkUntil: partial.drinkUntil || enriched.drinkUntil,
              producer:   partial.producer   || enriched.producer,
              // Preserve all DPP metadata
              _passportId:        partial._passportId,
              _sourceGtin:        partial._sourceGtin,
              _sourceEan:         partial._sourceEan,
              _sourceUrl:         partial._sourceUrl,
              _serialNumber:      partial._serialNumber,
              _dppCertifications: partial._dppCertifications,
              _dppMaterialOrigin: partial._dppMaterialOrigin,
              _dppDescription:    partial._dppDescription,
              _dppImageUrl:       partial._dppImageUrl,
            };
          }
        } catch (_) { /* enrichment optional */ }
      }

      if (partial.estimatedPrice != null && partial.price == null) partial.price = partial.estimatedPrice;
      if (partial.country) partial.country = this._localizeCountry(partial.country);

      const actionRow = document.getElementById('scan-action-row');

      if (!partial.name) {
        this._setScanStatus(`OrigoVero QR recognised (GTIN: ${ean13}), product not found.`, 'error');
        if (actionRow) actionRow.innerHTML = `
          <button class="btn btn-ghost btn-sm" data-action="add-wine-from-scan">${this.t('scan.manualAdd')}</button>
          <button class="btn btn-secondary btn-sm" data-action="retake-barcode">${this.t('scan.retake')}</button>`;
        return;
      }

      this.scanResult = partial;
      const badge = partial._passportId ? this.t('scan.dppFound') : `${this.t('scan.barcodeFound')} · OrigoVero`;
      this._setScanStatus(badge, 'found');
      if (actionRow) actionRow.innerHTML = `
        <button class="btn btn-primary" data-action="add-wine-from-scan">${this.t('scan.addToCollection')}</button>
        <button class="btn btn-secondary btn-sm" data-action="retake-barcode">${this.t('scan.retake')}</button>`;

    } catch (err) {
      this._setScanStatus(this.t('scan.barcodeError'), 'error');
      const actionRow = document.getElementById('scan-action-row');
      if (actionRow) actionRow.innerHTML = `
        <button class="btn btn-ghost btn-sm" data-action="add-wine-from-scan">${this.t('scan.manualAdd')}</button>
        <button class="btn btn-secondary btn-sm" data-action="retake-barcode">${this.t('scan.retake')}</button>`;
    }
  },

  // ── Generic wine QR URL → fetch page text + AI extract ──────────────────────
  async _handleGenericQRUrl(url) {
    const actionRow = document.getElementById('scan-action-row');
    const settings  = DB.getSettings();
    const hasKey    = settings.anthropicKey || settings.openaiKey;

    // ── Show "Open in browser" immediately — always the guaranteed path ───────
    // Styled as primary so it's obvious before extraction even starts.
    const _showOpenBtn = () => {
      if (actionRow) actionRow.innerHTML = `
        <a class="btn btn-primary" href="${url}" target="_blank" rel="noopener"
           style="text-align:center">${this.t('scan.qrOpening')}</a>
        <button class="btn btn-ghost btn-sm" data-action="add-wine-from-scan">${this.t('scan.manualAdd')}</button>`;
    };

    if (!hasKey) {
      this._setScanStatus(this.t('scan.qrNoData'), '');
      _showOpenBtn();
      return;
    }

    // Show open button + extraction spinner simultaneously
    this._setScanStatus(`<span class="spinner"></span>${this.t('scan.qrFetching')}`, '');
    _showOpenBtn();

    try {
      const pageText = await API.fetchPageText(url, settings);

      if (!pageText || pageText.length < 20) {
        this._setScanStatus(this.t('scan.qrNoData'), 'error');
        // Open button already visible — nothing more to do
        return;
      }

      this._setScanStatus(`<span class="spinner"></span>${this.t('scan.qrParsing')}`, '');

      const extracted = await API.extractWineFromQRPage(pageText, settings, this.lang);

      if (!extracted || extracted.error || !extracted.name) {
        this._setScanStatus(this.t('scan.qrNoData'), 'error');
        return; // open button still visible
      }

      // ── Extraction succeeded — promote "Add to Collection" to primary ──────
      extracted._sourceUrl = url;
      if (extracted.country) extracted.country = this._localizeCountry(extracted.country);

      const isPartial = !extracted.vintage || !extracted.region;
      this.scanResult = extracted;

      this._setScanStatus(isPartial ? this.t('scan.qrPartial') : this.t('scan.barcodeFound'), 'found');

      if (actionRow) actionRow.innerHTML = `
        <button class="btn btn-primary" data-action="add-wine-from-scan">${this.t('scan.addToCollection')}</button>
        <a class="btn btn-ghost btn-sm" href="${url}" target="_blank" rel="noopener">${this.t('scan.qrOpening')}</a>
        <button class="btn btn-secondary btn-sm" data-action="retake-barcode">${this.t('scan.retake')}</button>`;

    } catch (err) {
      this._setScanStatus(this.t('scan.barcodeError'), 'error');
      // Open button already visible from initial render
    }
  },

  async _lookupOpenFoodFacts(barcode) {
    const url = `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(barcode)}.json`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return {};
    const data = await res.json();
    if (data.status !== 1 || !data.product) return {};

    const p    = data.product;
    const cats = (p.categories_tags || []).map(c => c.toLowerCase());

    // Detect wine type from categories
    let type = null;
    if (cats.some(c => /white.wine|wines-white/.test(c)))                                  type = 'white';
    else if (cats.some(c => /ros[eé].wine|wines-ros/.test(c)))                             type = 'rosé';
    else if (cats.some(c => /sparkling|champagne|prosecco|cava|cremant|sekt/.test(c)))     type = 'sparkling';
    else if (cats.some(c => /port|sherry|madeira|fortified|vin.doux/.test(c)))            type = 'fortified';
    else if (cats.some(c => /dessert.wine|sweet.wine|ice.wine|sauterne/.test(c)))          type = 'dessert';
    else if (cats.some(c => /red.wine|wines-red|vin.rouge/.test(c)))                       type = 'red';
    // If categories mention wine but type unclear, default to red (most common)
    else if (cats.some(c => /wine|wijn|vin\b/.test(c)))                                    type = 'red';

    // Country from tags like "en:france" → "France"
    const countryTag = (p.countries_tags || [])
      .find(t => t.startsWith('en:'));
    const country = countryTag
      ? countryTag.slice(3).split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      : null;

    // Try to extract vintage year from product name
    const nameStr = p.product_name || p.product_name_en || '';
    const vintageMatch = nameStr.match(/\b(19|20)\d{2}\b/);
    const vintage = vintageMatch ? parseInt(vintageMatch[0], 10) : null;
    // Clean name — remove the year if we extracted it
    const name = nameStr.replace(/\s*\b(19|20)\d{2}\b/, '').trim() || null;

    return {
      name,
      producer: p.brands || null,
      type,
      country,
      vintage,
    };
  },

  // ── OrigoVero DPP helpers ─────────────────────────────────────────────────

  // Sign a request using HMAC-SHA256 via WebCrypto (no server needed)
  async _signOrigoVeroRequest(keySecret, method, path, body = '') {
    const ts = Math.floor(Date.now() / 1000).toString();
    const signingString = `${ts}\n${method.toUpperCase()}\n${path}\n${body}`;
    const encoder    = new TextEncoder();
    const cryptoKey  = await crypto.subtle.importKey(
      'raw', encoder.encode(keySecret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sigBytes = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(signingString));
    const sig = Array.from(new Uint8Array(sigBytes)).map(b => b.toString(16).padStart(2, '0')).join('');
    return { ts, sig };
  },

  // Fetch a single product by GTIN-14 from the OrigoVero DPP API
  async _lookupOrigoVeroDpp(gtin14) {
    const s       = DB.getSettings();
    const baseUrl = (s.origoveroBaseUrl || 'https://dev.origovero.com').replace(/\/$/, '');
    const path    = `/api/v1/products/${gtin14}`;
    const { ts, sig } = await this._signOrigoVeroRequest(s.origoveroKeySecret, 'GET', path);
    const res = await fetch(`${baseUrl}${path}`, {
      headers: {
        'X-API-Key-Id':    s.origoveroKeyId,
        'X-API-Timestamp': ts,
        'X-API-Signature': sig,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return await res.json();
  },

  // Infer wine type from appellation + varietal strings
  _inferWineTypeFromAppellation(appellation = '', varietal = '') {
    const s = (appellation + ' ' + varietal).toLowerCase();
    if (/prosecco|franciacorta|champagne|cava|sekt|crémant|cremant|pétillant|petillant|sparkling/.test(s)) return 'sparkling';
    if (/rosato|rosé|rose|rosado/.test(s)) return 'rosé';
    if (/porto|port\b|sherry|jerez|madeira|marsala|banyuls|mavrodaphne|fortif/.test(s)) return 'fortified';
    if (/passito|sauternes|tokaj|eiswein|recioto|vin.santo|late.harvest|dolce/.test(s)) return 'dessert';
    // White grapes / appellations
    if (/lugana|greco|vermentino|soave|pinot.grigio|trebbiano|verdicchio|vernaccia|gavi|arneis|falanghina|fiano|ribolla|chardonnay|sauvignon.blanc|riesling|gewürz|gewurz|muscat|viognier|albarino|albariño|verdejo|godello|vinho.verde|grüner|gruner|chablis|burgundy.blanc|bourgogne.blanc/.test(s)) return 'white';
    // Default to red for everything else (most wine appellations are red)
    return 'red';
  },

  // Map an OrigoVero API product object → Vinage wine model
  _mapOrigoVeroProduct(product) {
    const ws = product.vertical_metadata?.wine_spirits || {};
    const ISO2 = {
      IT:'Italy', FR:'France', ES:'Spain', DE:'Germany', PT:'Portugal',
      AT:'Austria', CH:'Switzerland', US:'United States', AU:'Australia',
      NZ:'New Zealand', ZA:'South Africa', AR:'Argentina', CL:'Chile',
      GR:'Greece', HU:'Hungary', RO:'Romania', HR:'Croatia', SI:'Slovenia',
      BG:'Bulgaria', GE:'Georgia', TR:'Turkey', IL:'Israel', LB:'Lebanon',
    };
    const countryRaw  = ISO2[product.country_of_origin] || product.country_of_origin || '';
    const expiryYear  = product.expiration_date ? parseInt(product.expiration_date.slice(0, 4), 10) : null;
    let certifications = [];
    try { certifications = JSON.parse(product.certifications || '[]'); } catch (_) {}
    const baseUrl = (DB.getSettings().origoveroBaseUrl || 'https://dev.origovero.com').replace(/\/$/, '');

    return {
      name:       (product.product_name || '').replace(/\s*\(Demo\)/gi, '').trim(),
      vintage:    ws.vintage  || null,
      region:     ws.appellation || '',
      country:    this._localizeCountry(countryRaw),
      grapes:     ws.varietal ? ws.varietal.split(',').map(g => g.trim()).filter(Boolean) : [],
      notes:      ws.tasting_notes || '',
      type:       this._inferWineTypeFromAppellation(ws.appellation || '', ws.varietal || ''),
      drinkUntil: expiryYear,
      // DPP metadata stored on the wine record
      _passportId:         product.passport_id   || null,
      _sourceGtin:         product.gtin          || null,
      _dppCertifications:  certifications,
      _dppMaterialOrigin:  product.material_origin || null,
      _dppDescription:     product.description    || null,
      _dppImageUrl:        product.image_url ? `${baseUrl}${product.image_url}` : null,
    };
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
      const result = await API.identifyWine(this.capturedImage, settings, this.lang);
      if (result.error) {
        this._setScanStatus(this.t('scan.notFound'), 'error');
        this.scanResult = null;
      } else {
        // Map estimatedPrice → price for form pre-fill (only if no price set)
        if (result.estimatedPrice != null && result.price == null) {
          result.price = result.estimatedPrice;
        }
        // Normalize country to the app's current language
        if (result.country) result.country = this._localizeCountry(result.country);
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
          <div class="qty-stepper">
            <button type="button" class="qty-btn" onclick="const i=document.getElementById('wf-qty');i.value=Math.max(0,(parseInt(i.value)||0)-1)">−</button>
            <input id="wf-qty" class="form-control qty-input" type="number" min="0" value="${wine.quantity != null ? wine.quantity : 1}">
            <button type="button" class="qty-btn" onclick="const i=document.getElementById('wf-qty');i.value=(parseInt(i.value)||0)+1">+</button>
          </div>
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
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <label style="margin-bottom:0">${this.t('wine.notes')}</label>
          <button type="button" class="btn btn-ghost btn-sm" id="regen-notes-btn"
                  data-action="regen-notes" style="font-size:.75rem;padding:2px 8px">
            ✦ ${this.t('wine.regenNotes')}
          </button>
        </div>
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
          if (!byCellar[p.cellarId]) byCellar[p.cellarId] = { name: p.cellarName, id: p.cellarId, slots: [], shelfCount: 0 };
          if (p.slot !== null) byCellar[p.cellarId].slots.push(this._slotPositionLabel(p.slot));
          else byCellar[p.cellarId].shelfCount++;
        });
        const rows = Object.values(byCellar).map(c => {
          const sorted = c.slots.slice().sort((a, b) => {
            const [, al='', an='0'] = a.match(/^([A-Z]*)(\d+)$/) || [];
            const [, bl='', bn='0'] = b.match(/^([A-Z]*)(\d+)$/) || [];
            return al.localeCompare(bl) || (parseInt(an) - parseInt(bn));
          });
          const coords = sorted.length || c.shelfCount
            ? [
                ...sorted.map(s => `<span class="location-coord-pill">${s}</span>`),
                ...(c.shelfCount > 0 ? [`<span class="location-coord-pill">${c.shelfCount}×</span>`] : [])
              ].join('')
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
    // Show "Open a bottle" and "Share" only when editing an existing wine
    if (this.editWineId) {
      const w = DB.getWineById(this.editWineId);
      const wid = this.editWineId;
      // Share button (always available for existing wines)
      footerBtns.splice(footerBtns.length - 1, 0,
        { label: '📤 ' + this.t('common.shareWine'), cls: 'btn-ghost', action: () => {
          this._shareWineAsHTML(wid);
        }}
      );
      // DPP passport button (only when the wine was scanned via OrigoVero)
      if (w?._passportId) {
        const baseUrl = (DB.getSettings().origoveroBaseUrl || 'https://dev.origovero.com').replace(/\/$/, '');
        const passportUrl = `${baseUrl}/b2c/product/${w._passportId}`;
        footerBtns.splice(footerBtns.length - 1, 0,
          { label: '🔖 ' + this.t('wine.viewDpp'), cls: 'btn-ghost', action: () => window.open(passportUrl, '_blank') }
        );
      }
      // Open a bottle (only when stock > 0)
      if (w && (w.quantity || 1) > 0) {
        footerBtns.unshift({ label: '🍷 ' + this.t('consume.openBottle'), cls: 'btn-ghost', action: () => {
          this.closeModal(); this._consumeBottle(wid);
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

  // Maps English country names → Dutch (and vice-versa for reverse lookup).
  // Applied at save time so both scan results and manual entry are normalized.
  _localizeCountry(raw) {
    if (!raw) return raw;
    const EN_TO_NL = {
      'france':'Frankrijk','italy':'Italië','spain':'Spanje','portugal':'Portugal',
      'germany':'Duitsland','austria':'Oostenrijk','switzerland':'Zwitserland',
      'netherlands':'Nederland','belgium':'België','luxembourg':'Luxemburg',
      'united states':'Verenigde Staten','usa':'Verenigde Staten','us':'Verenigde Staten',
      'australia':'Australië','new zealand':'Nieuw-Zeeland','south africa':'Zuid-Afrika',
      'argentina':'Argentinië','chile':'Chili','uruguay':'Uruguay','brazil':'Brazilië',
      'greece':'Griekenland','hungary':'Hongarije','romania':'Roemenië',
      'bulgaria':'Bulgarije','croatia':'Kroatië','slovenia':'Slovenië',
      'czech republic':'Tsjechië','slovakia':'Slowakije','poland':'Polen',
      'serbia':'Servië','moldova':'Moldavië','georgia':'Georgië',
      'turkey':'Turkije','israel':'Israël','lebanon':'Libanon',
      'england':'Engeland','united kingdom':'Verenigd Koninkrijk','uk':'Verenigd Koninkrijk',
      'russia':'Rusland','ukraine':'Oekraïne','sweden':'Zweden',
      'denmark':'Denemarken','norway':'Noorwegen','finland':'Finland',
      'north macedonia':'Noord-Macedonië','albania':'Albanië',
      'montenegro':'Montenegro','cyprus':'Cyprus','malta':'Malta',
      'morocco':'Marokko','tunisia':'Tunesië','algeria':'Algerije',
      'canada':'Canada','mexico':'Mexico','japan':'Japan','china':'China',
      'india':'India','peru':'Peru','bolivia':'Bolivia',
    };
    const NL_TO_EN = Object.fromEntries(Object.entries(EN_TO_NL).map(([en,nl])=>[nl.toLowerCase(),en.charAt(0).toUpperCase()+en.slice(1)]));
    const key = raw.trim().toLowerCase();
    if (this.lang === 'nl') {
      return EN_TO_NL[key] || raw; // translate to Dutch; keep original if not in map
    } else {
      return NL_TO_EN[key] || raw; // translate to English; keep original if not in map
    }
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
      country:  this._localizeCountry(parse('wf-country')),
      grapes:   parseList('wf-grapes'),
      pairings: parseList('wf-pairings'),
      tags:     parseList('wf-tags'),
      notes:      parse('wf-notes'),
      price:      parseNum('wf-price'),
      rating:     this._formRating,
      drinkFrom:  parseNum('wf-drink-from')  ? parseInt(parse('wf-drink-from'),  10) : null,
      drinkUntil: parseNum('wf-drink-until') ? parseInt(parse('wf-drink-until'), 10) : null,
    };

    // Carry DPP metadata from scan result (new wines only)
    if (!this.editWineId && this.scanResult) {
      const dppKeys = ['_passportId','_sourceGtin','_sourceEan','_sourceUrl','_serialNumber',
                       '_dppCertifications','_dppMaterialOrigin','_dppDescription','_dppImageUrl'];
      for (const k of dppKeys) { if (this.scanResult[k] != null) data[k] = this.scanResult[k]; }
    }

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

    // Persist medium image to IndexedDB AND Firebase Storage (if signed in).
    // IndexedDB is fast/offline; Firebase Storage is permanent and cross-device.
    const savedId = editWineId || newWine?.id;
    if (savedId && mediumForSave) {
      ImageDB.save(savedId, mediumForSave);
      // Upload to Firebase Storage in the background — sets wine.imageUrl when done
      if (Sync._ready && Sync.householdId) {
        Sync._uploadImage(savedId, mediumForSave);
      }
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

    const bodyHtml = `
      <p style="margin-bottom:12px">
        ${lang === 'nl'
          ? `Je hebt de hoeveelheid verlaagd. Kies welk vak je wil vrijmaken voor <strong>${wine.name || wine.producer}</strong>.`
          : `You reduced the quantity. Choose which slot to free for <strong>${wine.name || wine.producer}</strong>.`}
      </p>
      <div class="pick-slot-list" style="display:flex;flex-direction:column;gap:8px">${rows}</div>`;
    this.showModal(title, bodyHtml, [
      { label: this.t('common.cancel'), cls: 'btn-ghost', action: () => this.closeModal() }
    ]);

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

  // ── Regenerate tasting notes via AI ─────────────────────────────────────
  async _regenNotes() {
    const settings = DB.getSettings();
    if (!settings.anthropicKey && !settings.openaiKey) {
      this.toast(this.t('scan.apiKeyMissing'), 'error'); return;
    }
    const btn = document.getElementById('regen-notes-btn');
    if (btn) { btn.disabled = true; btn.textContent = '…'; }

    // Collect current form values to give the AI context
    const name     = document.getElementById('wf-name')?.value.trim()     || '';
    const producer = document.getElementById('wf-producer')?.value.trim() || '';
    const vintage  = document.getElementById('wf-vintage')?.value.trim()  || '';
    const region   = document.getElementById('wf-region')?.value.trim()   || '';
    const country  = document.getElementById('wf-country')?.value.trim()  || '';
    const grapes   = document.getElementById('wf-grapes')?.value.trim()   || '';
    const langNote = this.lang === 'nl'
      ? 'Respond in Dutch.'
      : 'Respond in English.';

    const prompt = `You are an expert sommelier. Write a brief, elegant tasting note (2–3 sentences) for the following wine. ${langNote} Return only the tasting note text — no labels, no JSON.

Wine: ${[name, producer, vintage, region, country, grapes].filter(Boolean).join(', ')}`;

    try {
      const provider = settings.apiProvider || 'anthropic';
      const key = provider === 'anthropic' ? settings.anthropicKey : settings.openaiKey;
      const note = provider === 'anthropic'
        ? await API._claudeText(prompt, key, 'claude-haiku-4-5-20251001')
        : await API._openaiText(prompt, key, 'gpt-4o-mini');
      const ta = document.getElementById('wf-notes');
      if (ta) ta.value = note.trim();
    } catch (e) {
      this.toast('Could not generate notes: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = `✦ ${this.t('wine.regenNotes')}`; }
    }
  },

  // ── Background image migration ────────────────────────────────────────────
  async _migrateImagesToFirebase() {
    if (!Sync._ready || !Sync.householdId) return;
    const wines = DB.getWines().filter(w => !w.imageUrl);
    if (!wines.length) return;
    let count = 0;
    for (const w of wines) {
      try {
        const img = await ImageDB.get(w.id);
        if (img) {
          await Sync._uploadImage(w.id, img);
          count++;
        }
      } catch (e) {
        console.warn('[Vinage] Failed to migrate image for', w.id, e.message);
      }
    }
    if (count > 0) console.log(`[Vinage] Uploaded ${count} image(s) to Firebase Storage`);
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
      { label: this.t('scan.dupViewExisting'), cls: 'btn-ghost btn-sm', action: () => {
          this.closeModal(); this.editWine(existing.id);
        }
      },
      { label: this.t('scan.dupAddAnyway'), cls: 'btn-secondary btn-sm', action: () => {
          this.closeModal(); this.showWineForm(scan);
        }
      },
      { label: this.t('scan.dupAddToExisting'), cls: 'btn-primary', action: () => {
          this.closeModal(); this._addToExistingWine(existing);
        }
      },
    ]);
  },

  // ── Increment quantity on an existing wine + offer cellar placement ─────────
  _addToExistingWine(existing) {
    const newQty = (existing.quantity || 1) + 1;
    const patch = { quantity: newQty };
    DB.updateWine(existing.id, patch);
    if (typeof Sync !== 'undefined' && Sync.updateWine) Sync.updateWine(existing.id, patch);
    this.toast(`+1 ${this._esc(existing.name)}`, 'success');
    // Offer cellar placement for the new bottle
    setTimeout(() => this._promptCellarPlacement(existing.id, newQty, newQty), 400);
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
      const cap = c.type === 'shelf' ? '∞'
                : c.type === 'case6' ? 6
                : c.type === 'case'  ? 12
                : (c.rows||0) * (c.cols||0);
      return `<button class="btn btn-secondary" style="width:100%;margin-bottom:6px;text-align:left"
                data-cellar-pick="${c.id}">${this._esc(c.name)} <small style="opacity:.6">${cap} slots</small></button>`;
    }).join('');
    this.showModal(
      this.t('scan.cellarPlaceTitle'),
      `<p style="margin-bottom:12px">${body}</p>${cellarOpts}`,
      [{ label: this.t('scan.cellarPlaceSkip'), cls: 'btn-ghost', action: () => this.closeModal() }]
    );
    // Guard against accidental overlay-tap dismissal during multi-bottle flow
    if (isMulti) {
      this._pendingPlaceWineId    = wineId;
      this._pendingPlaceTotalQty  = totalQty;
      this._pendingPlaceBottleNum = bottleNum;
      this._modalDismissGuard = this.lang === 'nl'
        ? `Fles ${bottleNum} van ${totalQty} is nog niet geplaatst. Wil je deze wijn overslaan?`
        : `Bottle ${bottleNum} of ${totalQty} hasn't been placed yet. Skip this wine?`;
    }
    // Wire cellar pick buttons
    setTimeout(() => {
      document.querySelectorAll('[data-cellar-pick]').forEach(btn => {
        btn.onclick = () => {
          const cellarId = btn.dataset.cellarPick;
          const cellar   = cellars.find(c => c.id === cellarId);
          this.closeModal();

          // ── Shelf (and any future unlimited type): no slots to click —
          //    add the wine directly and move on.
          if (cellar && cellar.type === 'shelf') {
            Sync.assignWineToSlot(cellarId, '', wineId);
            if (bottleNum < totalQty) {
              setTimeout(() => this._promptCellarPlacement(wineId, totalQty, bottleNum + 1), 400);
            } else {
              this.toast('📍 ' + this.t('cellar.assignWine') + ' ✓', 'success');
            }
            return;
          }

          // ── Grid / diamond / case: navigate to cellar, let user click a slot.
          this.view = 'cellar';
          this.cellarDetailId = cellarId;
          this.renderView();
          this.renderNav();
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
    // If the current cellar is a shelf type, place directly — no slot click needed.
    const currentCellar = DB.getCellars().find(c => c.id === this.cellarDetailId);
    if (currentCellar && currentCellar.type === 'shelf') {
      Sync.assignWineToSlot(currentCellar.id, '', wineId);
      if (bottleNum < totalQty) {
        setTimeout(() => this._promptCellarPlacement(wineId, totalQty, bottleNum + 1), 400);
      } else {
        this.toast('📍 ' + this.t('cellar.assignWine') + ' ✓', 'success');
      }
      return;
    }

    // Store the pre-selected wine so handleSlotClick skips the wine-picker step
    this._autoPlaceWineId    = wineId;
    this._autoPlaceTotalQty  = totalQty;
    this._autoPlaceBottleNum = bottleNum;
    this._pendingPlaceWineId    = wineId;
    this._pendingPlaceTotalQty  = totalQty;
    this._pendingPlaceBottleNum = bottleNum;
  },

  // ── Consumption tracking ──────────────────────────────────────────────────
  _consumeBottle(wineId) {
    const wine = DB.getWineById(wineId);
    if (!wine) return;

    const places = (DB.getWinePlacementMap()[wineId] || []);
    const tempBadge = this._servingTempBadge(wine);

    if (places.length <= 1) {
      // 0 or 1 location — show confirm dialog with serving temp
      const place = places[0] || null;
      const locLine = place
        ? `<div style="font-size:.82rem;color:var(--text-lt);text-align:center;margin-top:6px">📍 ${this._esc(place.cellarName)}${place.slot ? ' · ' + this._slotPositionLabel(place.slot) : ''}</div>`
        : '';
      this.showModal(
        this.t('consume.openConfirm'),
        `<div style="text-align:center">
          <div style="font-size:1rem;font-weight:700;color:var(--text)">${this._esc(wine.name)}${wine.vintage ? ' <span style="font-weight:400;color:var(--text-md)">' + wine.vintage + '</span>' : ''}</div>
          ${locLine}
        </div>${tempBadge}`,
        [
          { label: this.t('common.cancel'), cls: 'btn-ghost', action: () => this.closeModal() },
          { label: this.t('consume.openBtn'), cls: 'btn-primary', action: () => {
            this.closeModal();
            this._doConsumeBottle(wine, place);
          }},
        ]
      );
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
        `<p style="margin-bottom:12px">${this.t('consume.pickLocation')}</p>${opts}${tempBadge}`,
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
        Sync.removeWineFromShelf(place.cellarId, wine.id);
      }
    }

    // Log to consumption history (synced) — returns the saved entry with its id
    const entry = Sync.logConsumption({
      wineId:        wine.id,
      wineName:      wine.name,
      wineType:      wine.type,
      wineVintage:   wine.vintage || null,
      fromCellarId:  place?.cellarId   || null,
      fromCellarName:place?.cellarName || null,
      fromSlot:      place?.slot       || null,
      price:         wine.price        || null,
    });

    // Helper: called after all modals are resolved to prompt for tasting note
    const showTasting = (wineSnap) => {
      const needsDecant = ['red','fortified','dessert'].includes(wineSnap.type);
      if (needsDecant) {
        setTimeout(() => this._showDecantModal(wineSnap, () => {
          setTimeout(() => this._showTastingNoteModal(entry.id), 400);
        }), 600);
      } else {
        setTimeout(() => this._showTastingNoteModal(entry.id), 600);
      }
    };

    const newQty = (wine.quantity || 1) - 1;

    if (newQty <= 0) {
      // Last bottle — ask keep or delete
      const wineSnap = { ...wine }; // snapshot before any deletion
      this.showModal(
        this.t('consume.lastBottleTitle'),
        `<p>${this.t('consume.lastBottleBody', { name: this._esc(wine.name) })}</p>`,
        [
          { label: this.t('consume.keep'), cls: 'btn-secondary', action: () => {
            Sync.updateWine(wine.id, { quantity: 0 });
            this.closeModal(); this.renderView();
            this.toast(this.t('consume.toasted'), 'success');
            showTasting(wineSnap);
          }},
          { label: this.t('consume.remove'), cls: 'btn-danger', action: () => {
            Sync.deleteWine(wine.id);
            ImageDB.delete(wine.id);
            this.closeModal(); this.renderView();
            this.toast(this.t('consume.toasted'), 'success');
            showTasting(wineSnap);
          }},
        ]
      );
    } else {
      Sync.updateWine(wine.id, { quantity: newQty });
      this.renderView();
      this.toast(this.t('consume.toasted'), 'success');
      showTasting(wine);
    }
  },

  _restoreConsumption(entryId) {
    const log = DB.getConsumptionLog();
    const entry = log.find(e => e.id === entryId);
    if (!entry) return;
    const wine = DB.getWineById(entry.wineId);
    if (!wine) {
      this.toast(this.lang === 'nl' ? 'Wijn niet meer gevonden in collectie' : 'Wine no longer in collection', 'error');
      return;
    }
    const wineLabel = this._esc(wine.name);
    const locLabel  = entry.fromCellarName
      ? `${this._esc(entry.fromCellarName)}${entry.fromSlot ? ' · ' + this._slotPositionLabel(entry.fromSlot) : ''}`
      : (this.lang === 'nl' ? 'geen locatie' : 'no location');
    this.showModal(
      this.lang === 'nl' ? 'Fles terugplaatsen?' : 'Put bottle back?',
      `<p>${this.lang === 'nl'
        ? `<strong>${wineLabel}</strong> wordt teruggeplaatst naar <strong>${locLabel}</strong> en de voorraad wordt met 1 verhoogd.`
        : `<strong>${wineLabel}</strong> will be placed back to <strong>${locLabel}</strong> and stock increased by 1.`}</p>`,
      [
        { label: this.t('common.cancel'), cls: 'btn-secondary', action: () => this.closeModal() },
        { label: this.lang === 'nl' ? '↩ Terugplaatsen' : '↩ Put back', cls: 'btn-primary', action: () => {
          // Restore quantity
          Sync.updateWine(wine.id, { quantity: (wine.quantity || 0) + 1 });
          // Restore cellar placement
          if (entry.fromCellarId) {
            if (entry.fromSlot) {
              Sync.assignWineToSlot(entry.fromCellarId, entry.fromSlot, wine.id);
            } else {
              // shelf — Sync.assignWineToSlot with null slot pushes to wines[] and syncs to Firestore
              Sync.assignWineToSlot(entry.fromCellarId, null, wine.id);
            }
          }
          // Remove from consumption log
          Sync.deleteConsumptionEntry(entryId);
          this.closeModal();
          this.renderView();
          this.toast(this.lang === 'nl' ? '↩ Fles teruggeplaatst' : '↩ Bottle put back', 'success');
        }},
      ]
    );
  },

  // ── Post-drink tasting note modal ────────────────────────────────────────
  _showTastingNoteModal(entryId) {
    this._tastingStarRating = 0;
    const body = `
      <div style="text-align:center;margin-bottom:16px">
        <p style="font-size:.88rem;color:var(--text-md);margin-bottom:10px">${this.t('consume.tastingSubtitle')}</p>
        <div class="star-rating" id="tasting-stars">
          ${[1,2,3,4,5].map(i =>
            `<button class="star-btn" data-star="${i}" onclick="App._setStarRating(${i})">★</button>`
          ).join('')}
        </div>
      </div>
      <div class="form-group">
        <textarea id="tasting-note-text" class="form-control" rows="3"
          placeholder="${this.t('consume.tastingNotePlaceholder')}"
          style="resize:none;font-size:.9rem"></textarea>
      </div>`;
    this.showModal(
      this.t('consume.tastingTitle'),
      body,
      [
        { label: this.t('consume.tastingSkip'), cls: 'btn-ghost', action: () => this.closeModal() },
        { label: this.t('consume.tastingSave'), cls: 'btn-primary', action: () => {
          const note   = document.getElementById('tasting-note-text')?.value?.trim() || null;
          const rating = this._tastingStarRating || null;
          if (note || rating) {
            Sync.updateConsumptionEntry(entryId, { tastingNote: note, tastingRating: rating });
            this.toast(this.t('consume.tastingSaved'), 'success');
          }
          this.closeModal();
        }},
      ]
    );
    // Render initial star state after modal DOM is ready
    setTimeout(() => this._renderTastingStars(0), 60);
  },

  _setStarRating(n) {
    this._tastingStarRating = n;
    this._renderTastingStars(n);
  },

  _renderTastingStars(active) {
    document.querySelectorAll('#tasting-stars .star-btn').forEach((btn, i) => {
      btn.classList.toggle('active', i < active);
    });
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
  // ══════════════════════════════════════════════════════════════════════════
  // HOME — Decision-first screen
  // ══════════════════════════════════════════════════════════════════════════
  buildCellarList() {
    const wines    = DB.getWines();
    const cellars  = DB.getCellars();
    const placementMap = DB.getWinePlacementMap();

    // ── Tonight's picks ──────────────────────────────────────────────────
    const picks       = this._getTonightPicks(wines, placementMap);
    const picksHtml   = this._buildPicksSection(picks, wines, placementMap);

    // ── Stats strip ──────────────────────────────────────────────────────
    const statsStrip  = this._buildHomeStatsStrip(wines, placementMap);

    // ── Quick actions ────────────────────────────────────────────────────
    const quickActions = this._buildHomeQuickActions();

    // ── Cellars section ──────────────────────────────────────────────────
    const mapSection  = cellars.length > 0 ? this._buildCellarMapSection(cellars) : '';
    const cellarCards = cellars.length === 0
      ? `<div class="empty-state" style="padding:24px 0">${this._iconCellarLg()}<p>${this.t('cellar.noLocations')}</p></div>`
      : `<div class="cellar-list">${cellars.map(c => this._buildCellarCard(c)).join('')}</div>`;

    return `
    ${picksHtml}
    ${statsStrip}
    ${quickActions}
    <div>
      <div class="home-cellars-header">
        <span class="home-cellars-title">${this.t('home.myCellars')}</span>
        <button class="home-manage-btn" data-action="add-cellar">${this.t('home.manageCellars')} +</button>
      </div>
      ${mapSection}
      ${cellarCards}
    </div>`;
  },

  // ── Tonight's picks algorithm ─────────────────────────────────────────
  _getTonightPicks(wines, placementMap) {
    const y = new Date().getFullYear();
    const scored = wines
      .filter(w => (w.quantity == null || w.quantity > 0))
      .map(w => {
        const status = this._drinkStatus(w);
        if (!status) return null; // no drink window — skip

        let score = 0;
        let tag   = 'ready';

        if (status === 'past') {
          score = 20;
          tag   = 'past';
        } else if (status === 'ready') {
          const yearsLeft = w.drinkUntil ? w.drinkUntil - y : 99;
          if (yearsLeft <= 1)      { score = 16; tag = 'peak'; }
          else if (yearsLeft <= 3) { score = 13; tag = 'peak'; }
          else                     { score = 10; tag = 'ready'; }
        } else if (status === 'cellar') {
          const yearsAway = w.drinkFrom ? w.drinkFrom - y : 99;
          if (yearsAway <= 1)      { score = 5; tag = 'soon'; }
          else if (yearsAway <= 2) { score = 2; tag = 'soon'; }
          else return null; // not opening soon enough to recommend
        }

        // Cellar placement bonus (we know exactly where it is)
        if (placementMap[w.id]?.length) score += 2;
        // Rating bonus
        if (w.rating) score += w.rating * 0.4;

        return { w, score, tag };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return scored;
  },

  // ── Tonight's picks HTML ──────────────────────────────────────────────
  _buildPicksSection(picks, allWines, placementMap) {
    const y = new Date().getFullYear();

    const header = `
    <div class="home-tonight-header">
      <span class="home-tonight-icon">🍷</span>
      <span class="home-tonight-title">${this.t('home.tonightTitle')}</span>
    </div>`;

    if (allWines.length === 0) {
      return header + `
      <div class="home-empty-picks">
        <div class="home-empty-picks-icon">🏚️</div>
        <div class="home-empty-picks-title">${this.t('home.noWinesTitle')}</div>
        <div class="home-empty-picks-sub">${this.t('home.noWinesSub')}</div>
      </div>`;
    }

    if (picks.length === 0) {
      return header + `
      <div class="home-empty-picks">
        <div class="home-empty-picks-icon">📅</div>
        <div class="home-empty-picks-title">${this.t('home.noPicksTitle')}</div>
        <div class="home-empty-picks-sub">${this.t('home.noPicksSub')}</div>
      </div>`;
    }

    const cards = picks.map(({ w, tag }, idx) => {
      const isPrimary = idx === 0;
      const dot = `<div class="home-pick-dot" style="background:${this._typeColor(w.type)}"></div>`;

      // Status pill
      let pillCls, pillText;
      if (tag === 'past') {
        pillCls  = 'status-past';
        pillText = `⚠️ ${this.t('home.pastPeak')}`;
      } else if (tag === 'peak') {
        const yearsLeft = w.drinkUntil ? w.drinkUntil - y : 1;
        pillCls  = 'status-peak';
        pillText = `🔥 ${this.t('home.peakEnding', { n: yearsLeft })}`;
      } else if (tag === 'soon') {
        const yearsAway = w.drinkFrom ? w.drinkFrom - y : 1;
        pillCls  = 'status-soon';
        pillText = `🔒 ${this.t('home.almostReady', { n: yearsAway })}`;
      } else {
        pillCls  = 'status-ready';
        pillText = `✓ ${this.t('home.readyNow')}`;
      }

      // Location
      const places = placementMap[w.id];
      const locHtml = places?.length
        ? `<span class="home-pick-location">📍 ${this._esc(places[0].cellarName)}${places[0].slot ? ' · ' + this._slotPositionLabel(places[0].slot) : ''}</span>`
        : '';

      // Qty
      const qty = w.quantity ?? 1;
      const qtyHtml = qty > 1 ? `<span class="home-pick-qty">${qty}×</span>` : '';

      return `
      <div class="home-pick-card${isPrimary ? ' home-pick-primary' : ''}"  data-wine-id="${w.id}">
        <div class="home-pick-top">
          ${dot}
          <div class="home-pick-main">
            <div class="home-pick-name">${this._esc(w.name)}${w.vintage ? ' <span style="font-weight:400;opacity:.7">' + w.vintage + '</span>' : ''}</div>
            ${w.producer ? `<div class="home-pick-producer">${this._esc(w.producer)}${w.region ? ' · ' + this._esc(w.region) : ''}</div>` : ''}
          </div>
        </div>
        <div class="home-pick-badges">
          <span class="home-pick-status ${pillCls}">${pillText}</span>
          ${locHtml}
          ${qtyHtml}
        </div>
        <div class="home-pick-actions">
          <button class="home-pick-btn-open" data-action="consume-bottle" data-id="${w.id}">${this.t('home.openBtn')} 🥂</button>
          <button class="home-pick-btn-view" data-action="edit-wine" data-id="${w.id}">${this.t('home.viewWine')}</button>
        </div>
      </div>`;
    }).join('');

    return header + `<div class="home-picks-list">${cards}</div>`;
  },

  // ── Stats strip ───────────────────────────────────────────────────────
  _buildHomeStatsStrip(wines, placementMap) {
    if (wines.length === 0) return '';
    const y = new Date().getFullYear();
    const totalBottles = wines.reduce((s, w) => s + (w.quantity ?? 1), 0);
    const ready   = wines.filter(w => this._drinkStatus(w) === 'ready').length;
    const expiring = wines.filter(w => {
      const s = this._drinkStatus(w);
      if (s === 'past') return true;
      if (s === 'ready' && w.drinkUntil && (w.drinkUntil - y) <= 1) return true;
      return false;
    }).length;

    const pills = [
      `<span class="home-stat-pill">${this.t('home.totalStat', { n: totalBottles })}</span>`,
      ready    > 0 ? `<span class="home-stat-pill pill-ready">${this.t('home.readyStat', { n: ready })}</span>` : '',
      expiring > 0 ? `<span class="home-stat-pill pill-warn">${this.t('home.expiringStat', { n: expiring })}</span>` : '',
    ].filter(Boolean).join('');

    return `<div class="home-stats-strip">${pills}</div>`;
  },

  // ── Quick actions ─────────────────────────────────────────────────────
  _buildHomeQuickActions() {
    return `
    <div class="home-quick-actions">
      <button class="home-quick-btn" data-nav="pairing">
        <span class="home-quick-btn-icon">🍽️</span>
        <span class="home-quick-btn-label">${this.t('home.pairMeal')}</span>
      </button>
      <button class="home-quick-btn" data-nav="scan">
        <span class="home-quick-btn-icon">📷</span>
        <span class="home-quick-btn-label">${this.t('home.scanBottle')}</span>
      </button>
      <button class="home-quick-btn" data-nav="collection">
        <span class="home-quick-btn-icon">🗂️</span>
        <span class="home-quick-btn-label">${this.t('nav.collection')}</span>
      </button>
    </div>`;
  },

  _buildCellarMapSection(cellars) {
    const isOpen = this._cellarMapOpen;
    const miniMaps = cellars.map(c => {
      const stats = DB.getCellarStats(c);
      const pct = stats.capacity ? Math.round(stats.occupied / stats.capacity * 100) : null;
      let dots = '';
      let dotsStyle = '';
      if (c.slots && (c.type === 'grid' || c.type === 'diamond')) {
        // Iterate in the exact same row → column order as the real rack
        // so each dot sits in the correct position
        const cols = c.cols || 8;
        const rows = c.rows || 5;
        for (let r = 0; r < rows; r++) {
          for (let col = 0; col < cols; col++) {
            const wid = c.slots[`${r}-${col}`];
            dots += wid
              ? `<div class="map-dot map-dot-filled" style="background:${this._typeColor((DB.getWineById(wid)||{}).type||'red')}"></div>`
              : `<div class="map-dot map-dot-empty"></div>`;
          }
        }
        // Use a CSS grid that mirrors the rack column count exactly
        dotsStyle = `style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:2px;justify-items:center"`;
      } else if (c.slots) {
        // case rack (12 slots)
        Object.values(c.slots).forEach(wid => {
          dots += wid
            ? `<div class="map-dot map-dot-filled" style="background:${this._typeColor((DB.getWineById(wid)||{}).type||'red')}"></div>`
            : `<div class="map-dot map-dot-empty"></div>`;
        });
      } else if (c.wines) {
        dots = c.wines.slice(0,20).map(id => {
          const w = DB.getWineById(id);
          return `<div class="map-dot map-dot-filled" style="background:${this._typeColor((w||{}).type||'red')}"></div>`;
        }).join('');
      }
      return `
      <div class="cellar-mini-map" data-action="open-cellar" data-id="${c.id}">
        <div class="mini-map-name">${this._esc(c.name)}</div>
        <div class="mini-map-dots" ${dotsStyle}>${dots}</div>
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

  _buildCellarCard(c, idx, total) {
    const stats = DB.getCellarStats(c);
    const typeLabel = this.t('cellar.types.' + c.type);
    return `
    <div class="card cellar-card" data-action="open-cellar" data-id="${c.id}">
      <div class="cellar-card-header">
        <h3>${this._esc(c.name)}</h3>
        <div style="display:flex;align-items:center;gap:6px;margin-left:auto">
          <span class="cellar-type-tag">${typeLabel}</span>
          <div class="cellar-order-btns" style="display:flex;flex-direction:column;gap:2px">
            <button class="btn btn-icon btn-xs cellar-order-btn" data-action="move-cellar-up"
                    data-id="${c.id}" title="Move up"
                    ${idx === 0 ? 'disabled' : ''} style="line-height:1;padding:1px 5px;font-size:.7rem">▲</button>
            <button class="btn btn-icon btn-xs cellar-order-btn" data-action="move-cellar-down"
                    data-id="${c.id}" title="Move down"
                    ${idx === total - 1 ? 'disabled' : ''} style="line-height:1;padding:1px 5px;font-size:.7rem">▼</button>
          </div>
        </div>
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
    else if (c.type === 'case' || c.type === 'case6') rackHtml = this._buildCaseRack(c);
    else                           rackHtml = this._buildShelfRack(c);

    return `
    <div class="page-header">
      <button class="btn btn-icon" data-action="back-cellar" aria-label="${this.t('common.back')}">${this._iconBack()}</button>
      <h1>${this._esc(c.name)}</h1>
      <div class="header-actions">
        <button class="btn btn-secondary btn-sm" data-action="rename-cellar" data-id="${c.id}"
                title="${this.t('cellar.renameLocation')}">${this._iconEdit()}</button>
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
    const isHalf = c.type === 'case6';
    const count  = isHalf ? 6 : 12;
    const cols   = isHalf ? 3 : 4;
    let cells = '';
    for (let i = 0; i < count; i++) {
      const key    = isHalf ? `h${i}` : String(i);
      const wineId = c.slots[key];
      const wine   = wineId ? DB.getWineById(wineId) : null;
      cells += this._buildSlot(c.id, key, wine);
    }
    return `<div class="rack-wood-frame" style="display:inline-block;min-width:auto"><div class="rack-case" style="grid-template-columns:repeat(${cols},1fr)">${cells}</div></div>`;
  },

  _buildShelfRack(c) {
    const wines = (c.wines || []).map(id => DB.getWineById(id)).filter(Boolean);
    const items = wines.map(w => {
      const thumb = w.thumbnail
        ? `<img class="shelf-thumb" src="data:image/jpeg;base64,${w.thumbnail}" alt="">`
        : `<div class="shelf-bottle-dot" style="background:${this._typeColor(w.type)}"></div>`;
      return `
      <div class="shelf-item" data-action="click-slot"
           data-cellarid="${c.id}" data-slot="" data-wineid="${w.id}">
        ${thumb}
        <div style="flex:1;min-width:0">
          <div class="shelf-wine-name">${this._esc(w.name)}</div>
          <div class="shelf-wine-meta">${[w.vintage, this.t('types.'+w.type), w.region].filter(Boolean).join(' · ')}</div>
        </div>
        <button class="btn btn-icon btn-sm" data-action="remove-from-shelf"
                data-cellarid="${c.id}" data-wineid="${w.id}" title="Remove">
          ${this._iconX()}
        </button>
      </div>`;
    }).join('');

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
    if (s.startsWith('h')) {
      // Half-case / Box(6): 3 cols × 2 rows → A1 B1 C1 / A2 B2 C2
      const i = parseInt(s.slice(1), 10);
      return String.fromCharCode(65 + (i % 3)) + (Math.floor(i / 3) + 1);
    }
    // Case rack 0-11: 4 cols × 3 rows → A1 B1 C1 D1 / A2 … / A3 …
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
          { label: this.t('cellar.moveWine'), cls: 'btn-secondary', action: () => {
            this.closeModal(); this._moveWine(wineId, cellarId, slot);
          }},
          { label: this.t('common.edit'), cls: 'btn-secondary', action: () => {
            this.closeModal(); this.editWine(wineId);
          }},
          { label: this.t('cellar.removeWine'), cls: 'btn-danger', action: () => {
            if (slot === '' || slot == null) {
              Sync.removeWineFromShelf(cellarId, wineId);
            } else {
              Sync.assignWineToSlot(cellarId, slot, null);
            }
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

  // ── Move wine from one cellar location to another ─────────────────────────
  _moveWine(wineId, fromCellarId, fromSlot) {
    const wine    = DB.getWineById(wineId);
    const cellars = DB.getCellars();
    if (!wine || !cellars.length) return;

    const cellarOpts = cellars.map(c => {
      const isCurrent = c.id === fromCellarId;
      const stats = DB.getCellarStats(c);
      const cap   = stats.capacity !== null ? stats.capacity : '∞';
      const occ   = stats.occupied;
      const label = isCurrent ? `${this._esc(c.name)} <small style="opacity:.5">(current)</small>` : this._esc(c.name);
      return `<button class="btn btn-secondary" style="width:100%;margin-bottom:6px;text-align:left"
                data-move-target="${c.id}"${isCurrent ? ' disabled style="opacity:.4;width:100%;margin-bottom:6px"' : ''}>
                ${label} <small style="opacity:.6;margin-left:auto">${occ}/${cap}</small></button>`;
    }).join('');

    this.showModal(
      this.t('cellar.moveTitle'),
      `<p style="margin-bottom:12px">${this._esc(wine.name)}</p>${cellarOpts}`,
      [{ label: this.t('common.cancel'), cls: 'btn-ghost', action: () => this.closeModal() }]
    );

    setTimeout(() => {
      document.querySelectorAll('[data-move-target]').forEach(btn => {
        btn.addEventListener('click', () => {
          const toCellarId = btn.dataset.moveTarget;
          const toCellar   = cellars.find(c => c.id === toCellarId);
          if (!toCellar) return;
          this.closeModal();

          // ── Remove from current location ───────────────────────────────
          if (fromSlot === '' || fromSlot == null) {
            Sync.removeWineFromShelf(fromCellarId, wineId);
          } else {
            Sync.assignWineToSlot(fromCellarId, fromSlot, null);
          }

          // ── Place in new location ──────────────────────────────────────
          if (toCellar.type === 'shelf') {
            // Shelf: add immediately, no slot to pick
            Sync.assignWineToSlot(toCellarId, '', wineId);
            this.cellarDetailId = toCellarId;
            this.renderView();
            setTimeout(() => { this._initRackHover?.(); this._initRackZoom?.(); }, 0);
            this.toast('📍 ' + this._esc(wine.name) + ' → ' + this._esc(toCellar.name), 'success');
          } else {
            // Grid / case: navigate to destination, then user taps the target slot
            this._autoPlaceWineId    = wineId;
            this._autoPlaceTotalQty  = 1;
            this._autoPlaceBottleNum = 1;
            this.cellarDetailId = toCellarId;
            this.renderView();
            setTimeout(() => { this._initRackHover?.(); this._initRackZoom?.(); }, 0);
            this.toast(this.t('cellar.tapToPlace'), '');
          }
        });
      });
    }, 50);
  },

  showAddCellarModal() {
    const types = ['grid', 'diamond', 'case', 'case6', 'shelf'];
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

  // Returns { min, max } °C serving range, or null if unknown
  _servingTemp(wine) {
    const ranges = {
      red:       { min: 16, max: 18 },
      white:     { min: 8,  max: 10 },
      rosé:      { min: 8,  max: 12 },
      sparkling: { min: 6,  max: 9  },
      dessert:   { min: 8,  max: 12 },
      fortified: { min: 12, max: 16 },
    };
    const r = ranges[wine.type];
    if (!r) return null;
    // Light reds (Pinot Noir, Gamay/Beaujolais) are better a touch cooler
    if (wine.type === 'red') {
      const grapes = (wine.grapes || []).map(g => g.toLowerCase());
      if (grapes.some(g => ['pinot noir','gamay','beaujolais','zweigelt','st. laurent'].some(lg => g.includes(lg)))) {
        return { min: 12, max: 15 };
      }
    }
    return r;
  },

  // Returns a small HTML badge string for serving temperature
  _servingTempBadge(wine) {
    const r = this._servingTemp(wine);
    if (!r) return '';
    return `<div style="text-align:center;margin-top:12px">
      <span class="serving-temp-badge">
        <span class="temp-icon">🌡️</span>
        ${this.t('consume.serveAt')} ${r.min}–${r.max}°C
      </span>
    </div>`;
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

    // Drink window alerts — clickable to set filter
    const ready = allWines.filter(w => this._drinkStatus(w) === 'ready');
    const past  = allWines.filter(w => this._drinkStatus(w) === 'past');
    const readyActive = this.collectionFilters.has('drink-now');
    const pastActive  = this.collectionFilters.has('drink-past');
    const alerts = [
      ready.length ? `<div class="drink-alert drink-alert-ready${readyActive?' drink-alert-active':''}"
        onclick="App._setExclusiveFilter('drink-now')" style="cursor:pointer">
        🍷 ${this.t('collection.drinkDueAlert', {count: ready.length})}
        <span class="drink-alert-arrow">${readyActive?'✕':'→'}</span></div>` : '',
      past.length  ? `<div class="drink-alert drink-alert-past${pastActive?' drink-alert-active':''}"
        onclick="App._setExclusiveFilter('drink-past')" style="cursor:pointer">
        ⚠️ ${this.t('collection.drinkPastAlert', {count: past.length})}
        <span class="drink-alert-arrow">${pastActive?'✕':'→'}</span></div>` : ''
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

  // Sets one filter exclusively (toggling it off if already active), clearing all others.
  // Used by the drink-alert bars so they act like radio buttons.
  _setExclusiveFilter(id) {
    if (this.collectionFilters.has(id)) {
      this.collectionFilters = new Set();
    } else {
      this.collectionFilters = new Set([id]);
    }
    this.renderView();
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
    const STATUS_FILTERS = new Set(['in-cellar','drink-now','drink-past','not-placed']);

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
          // Green bar: ready to drink only (not past peak)
          if (this._drinkStatus(w) !== 'ready') return false;
        }
        if (s === 'drink-past') {
          // Yellow bar: past peak only
          if (this._drinkStatus(w) !== 'past') return false;
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
    // Group by cellar ID and show count when > 1 (e.g. "Wijnrek: 2, Koelkast: 2, Doos 1: 1")
    const cellarTag = places ? (() => {
      const byId = {};
      places.forEach(p => {
        if (!byId[p.cellarId]) byId[p.cellarId] = { name: p.cellarName, count: 0 };
        byId[p.cellarId].count++;
      });
      return Object.values(byId)
        .map(c => c.count > 1 ? `${c.name}: ${c.count}` : c.name)
        .join(', ');
    })() : '';
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
          if (!byCellar[p.cellarId]) byCellar[p.cellarId] = { name: p.cellarName, id: p.cellarId, slots: [], shelfCount: 0 };
          if (p.slot !== null) byCellar[p.cellarId].slots.push(this._slotPositionLabel(p.slot));
          else byCellar[p.cellarId].shelfCount++;
        });
        const rows = Object.values(byCellar).map(c => {
          const sorted = c.slots.slice().sort((a, b) => {
            const [, al='', an='0'] = a.match(/^([A-Z]*)(\d+)$/) || [];
            const [, bl='', bn='0'] = b.match(/^([A-Z]*)(\d+)$/) || [];
            return al.localeCompare(bl) || (parseInt(an) - parseInt(bn));
          });
          const coords = sorted.length || c.shelfCount
            ? [
                ...sorted.map(s => `<span class="location-coord-pill">${s}</span>`),
                ...(c.shelfCount > 0 ? [`<span class="location-coord-pill">${c.shelfCount}×</span>`] : [])
              ].join('')
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
    const settings = DB.getSettings();
    const hasKey = settings.anthropicKey || settings.openaiKey;

    // Try to get user's city for local store guidance (best-effort, non-blocking)
    let city = null;
    if (hasKey && navigator.geolocation) {
      try {
        city = await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            async pos => {
              try {
                const r = await fetch(
                  `https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`,
                  { headers: { 'Accept-Language': ['nl','it','fr','es','de'].includes(this.lang) ? this.lang : 'en' } }
                );
                const d = await r.json();
                resolve(d.address?.city || d.address?.town || d.address?.village || null);
              } catch { resolve(null); }
            },
            () => resolve(null),
            { timeout: 4000 }
          );
        });
      } catch { city = null; }
    }

    let result;
    try {
      if (hasKey) {
        result = await API.suggestPairings(dish, wines, settings, this.lang, city);
      } else {
        result = API.ruleBasedPairing(dish, wines);
      }
    } catch (err) {
      resultsEl.innerHTML = `<div class="scan-status error">${this.t('common.error')} ${err.message}</div>`;
      return;
    }

    const { matches, generalSuggestion, externalSuggestions, rulesBased } = result;
    const matchedWines = (matches || []).map(m => ({ wine: wines[m.index], reason: m.reason })).filter(x => x.wine);

    let html = '';
    if (rulesBased) {
      html += `<div style="font-size:.8rem;color:var(--text-lt);margin-bottom:8px">${this.t('pairing.rulesBased')}</div>`;
    }

    // ── Section 1: Cellar matches ────────────────────────────────────────────
    html += `<div class="pairing-section-title">${this.t('pairing.fromCellar')}</div>`;
    if (matchedWines.length > 0) {
      html += matchedWines.map(({ wine: w, reason }) => `
        <div class="pairing-wine-card" style="border-left-color:${this._typeColor(w.type)}">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
              <span style="font-weight:700">${this._esc(w.name)}</span>
              ${w.vintage ? `<span style="font-size:.8rem;color:var(--text-lt)">${w.vintage}</span>` : ''}
              <span class="pairing-match-badge">${this.t('pairing.match')}</span>
              ${w.quantity === 0 ? `<span style="font-size:.75rem;color:var(--text-lt);opacity:.7">(${this.lang==='nl'?'geen voorraad':'out of stock'})</span>` : ''}
            </div>
            <div style="font-size:.82rem;color:var(--text-lt)">${[w.producer, this.t('types.'+w.type), w.region].filter(Boolean).join(' · ')}</div>
            ${reason ? `<div class="pairing-reason">${this._esc(reason)}</div>` : ''}
          </div>
        </div>`).join('');
    } else {
      html += `<div style="padding:16px 0 8px;color:var(--text-lt);font-size:.9rem">${this.t('pairing.noMatch')}</div>`;
    }

    if (generalSuggestion) {
      html += `<div class="general-suggestion">
        <strong>${this.t('pairing.generalSuggestion')}</strong>
        ${this._esc(generalSuggestion)}
      </div>`;
    }

    // ── Section 2: External suggestions ─────────────────────────────────────
    if (externalSuggestions?.length > 0) {
      const mapsCity = encodeURIComponent((city ? city + ' ' : '') + (this.lang === 'nl' ? 'wijnwinkel' : 'wine shop'));
      html += `<div class="pairing-section-title" style="margin-top:20px">${this.t('pairing.topPicks')}</div>`;
      html += externalSuggestions.map(s => `
        <div class="pairing-wine-card pairing-external-card" style="border-left-color:${this._typeColor(s.type||'red')}">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
              <span style="font-weight:700">${this._esc(s.name)}</span>
              ${s.producer ? `<span style="font-size:.8rem;color:var(--text-lt)">${this._esc(s.producer)}</span>` : ''}
              ${s.vintage ? `<span style="font-size:.8rem;color:var(--text-lt)">${s.vintage}</span>` : ''}
            </div>
            <div style="font-size:.82rem;color:var(--text-lt);margin-bottom:6px">${[this.t('types.'+(s.type||'red')), s.region].filter(Boolean).join(' · ')}</div>
            ${s.reason ? `<div class="pairing-reason">${this._esc(s.reason)}</div>` : ''}
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:8px">
              ${s.priceRange ? `<span class="pairing-price-badge">💶 ${this._esc(s.priceRange)}</span>` : ''}
              ${s.availability ? `<span style="font-size:.78rem;color:var(--text-lt)">${this._esc(s.availability)}</span>` : ''}
            </div>
          </div>
        </div>`).join('');
      html += `<a class="pairing-find-store-btn" href="https://maps.google.com/?q=${mapsCity}" target="_blank" rel="noopener">
        📍 ${city ? this.t('pairing.findNear').replace('{city}', city) : this.t('pairing.findStores')}
      </a>`;
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

    // ── Cellar health ─────────────────────────────────────────────────────────
    const healthSection = (() => {
      if (wines.length === 0) return '';

      // Readiness counts (by bottle)
      let pastCount = 0, readyCount2 = 0, cellarCount = 0, unknownCount = 0;
      wines.forEach(w => {
        const qty = w.quantity || 1;
        const s   = this._drinkStatus(w);
        if      (s === 'past')   pastCount   += qty;
        else if (s === 'ready')  readyCount2 += qty;
        else if (s === 'cellar') cellarCount += qty;
        else                     unknownCount += qty;
      });
      const knownTotal = pastCount + readyCount2 + cellarCount + unknownCount || 1;

      // Health score: penalise past-peak, reward ready, neutral for ageing
      // score 0-100: 100 = all ready, 0 = all past peak
      const actionable = pastCount + readyCount2;
      let scoreLabel, scoreCls, scoreIcon;
      if (actionable === 0) {
        scoreLabel = this.t('stats.healthScoreGood');
        scoreCls   = 'health-score-badge--good';
        scoreIcon  = '🟢';
      } else {
        const pastRatio = pastCount / knownTotal;
        if (pastRatio > 0.25) {
          scoreLabel = this.t('stats.healthScorePoor');
          scoreCls   = 'health-score-badge--poor';
          scoreIcon  = '🔴';
        } else if (pastRatio > 0.08 || readyCount2 / knownTotal > 0.6) {
          scoreLabel = this.t('stats.healthScoreOk');
          scoreCls   = 'health-score-badge--ok';
          scoreIcon  = '🟡';
        } else {
          scoreLabel = this.t('stats.healthScoreGood');
          scoreCls   = 'health-score-badge--good';
          scoreIcon  = '🟢';
        }
      }

      // Segmented bar segments (skip 0-width)
      const seg = (pct, color, title) => pct > 0
        ? `<div class="readiness-bar-segment" style="width:${pct}%;background:${color}" title="${title}"></div>`
        : '';
      const pastPct    = Math.round(pastCount    / knownTotal * 100);
      const readyPct   = Math.round(readyCount2  / knownTotal * 100);
      const cellarPct  = Math.round(cellarCount  / knownTotal * 100);
      const unknownPct = 100 - pastPct - readyPct - cellarPct;

      const bar = `
        <div class="readiness-bar">
          ${seg(pastPct,    '#c0392b', this.t('stats.healthPastPeak'))}
          ${seg(readyPct,   '#2e7d32', this.t('stats.healthReady'))}
          ${seg(cellarPct,  '#A3835B', this.t('stats.healthCellar'))}
          ${seg(unknownPct > 0 ? unknownPct : 0, '#D8C8BC', this.t('stats.healthUnknown'))}
        </div>
        <div class="readiness-legend">
          ${pastCount   > 0 ? `<div class="readiness-legend-item"><span class="readiness-dot" style="background:#c0392b"></span>${pastCount} ${this.t('stats.healthPastPeak')}</div>` : ''}
          ${readyCount2 > 0 ? `<div class="readiness-legend-item"><span class="readiness-dot" style="background:#2e7d32"></span>${readyCount2} ${this.t('stats.healthReady')}</div>` : ''}
          ${cellarCount > 0 ? `<div class="readiness-legend-item"><span class="readiness-dot" style="background:#A3835B"></span>${cellarCount} ${this.t('stats.healthCellar')}</div>` : ''}
          ${unknownCount > 0 ? `<div class="readiness-legend-item"><span class="readiness-dot" style="background:#D8C8BC"></span>${unknownCount} ${this.t('stats.healthUnknown')}</div>` : ''}
        </div>`;

      // Highlight tiles
      const winesInStock = wines.filter(w => (w.quantity || 1) > 0);
      const oldest = winesInStock.filter(w => w.vintage)
        .sort((a, b) => a.vintage - b.vintage)[0];
      const topValue = winesInStock.filter(w => w.price)
        .sort((a, b) => (b.price * (b.quantity||1)) - (a.price * (a.quantity||1)))[0];
      const vintages = winesInStock.filter(w => w.vintage).map(w => w.vintage);
      const avgVintage = vintages.length
        ? Math.round(vintages.reduce((s, v) => s + v, 0) / vintages.length)
        : null;

      const tiles = `
        <div class="health-highlights">
          <div class="health-tile${oldest ? ' health-tile--link' : ''}"
               ${oldest ? `data-action="edit-wine" data-id="${oldest.id}"` : ''}>
            <div class="health-tile-value">${oldest ? oldest.vintage : this.t('stats.healthNoVintage')}</div>
            <div class="health-tile-label">${this.t('stats.healthOldest')}</div>
          </div>
          <div class="health-tile${topValue ? ' health-tile--link' : ''}"
               ${topValue ? `data-action="edit-wine" data-id="${topValue.id}"` : ''}>
            <div class="health-tile-value">${topValue ? '€' + Math.round(topValue.price * (topValue.quantity||1)) : '—'}</div>
            <div class="health-tile-label">${this.t('stats.healthTopValue')}</div>
          </div>
          <div class="health-tile">
            <div class="health-tile-value">${avgVintage || this.t('stats.healthNoVintage')}</div>
            <div class="health-tile-label">${this.t('stats.healthAvgVintage')}</div>
          </div>
        </div>`;

      return `
        <div class="health-card">
          <div class="health-score-row">
            <span class="health-score-label">${this.t('stats.healthScore')}</span>
            <span class="health-score-badge ${scoreCls}">${scoreIcon} ${scoreLabel}</span>
          </div>
          ${bar}
          ${tiles}
        </div>`;
    })();

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

    // ── Drink Soon list ──────────────────────────────────────────────────────
    const now = new Date();
    const nowYear = now.getFullYear();
    const drinkSoonItems = wines
      .filter(w => w.drinkFrom || w.drinkUntil)
      .map(w => {
        const status = this._drinkStatus(w);
        if (!status || status === 'cellar') {
          // Show 'cellar' wines only if they open within 12 months
          if (status === 'cellar' && w.drinkFrom) {
            const monthsAway = (w.drinkFrom - nowYear) * 12;
            if (monthsAway > 12) return null;
            return { w, urgency: 2, monthsAway };
          }
          return null;
        }
        if (status === 'past')  return { w, urgency: 0, monthsAway: null };
        if (status === 'ready') return { w, urgency: 1, monthsAway: null };
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.urgency !== b.urgency) return a.urgency - b.urgency;
        if (a.urgency <= 1) return (a.w.drinkUntil || 9999) - (b.w.drinkUntil || 9999);
        return (a.monthsAway || 0) - (b.monthsAway || 0);
      })
      .slice(0, 15);

    const drinkSoonRows = drinkSoonItems.length === 0
      ? `<div class="empty-state" style="padding:16px 0;font-size:.85rem">${this.t('stats.drinkSoonEmpty')}</div>`
      : drinkSoonItems.map(({ w, urgency, monthsAway }) => {
          let pillCls, pillLabel;
          if (urgency === 0) {
            pillCls   = 'drink-soon-urgency--past';
            pillLabel = this.t('stats.pastPeak');
          } else if (urgency === 1) {
            pillCls   = 'drink-soon-urgency--ready';
            pillLabel = this.t('stats.readyNow');
          } else {
            pillCls   = 'drink-soon-urgency--soon';
            pillLabel = this.t('stats.opensSoon', { n: monthsAway });
          }
          const qty = w.quantity || 1;
          const window = [w.drinkFrom, w.drinkUntil].filter(Boolean).join('–');
          return `
          <div class="drink-soon-row" data-action="edit-wine" data-id="${w.id}" style="cursor:pointer">
            <span class="drink-soon-urgency ${pillCls}">${pillLabel}</span>
            <div class="drink-soon-info">
              <div class="drink-soon-name">${this._esc(w.name)}${w.vintage ? ' <span style="font-weight:400;color:var(--text-lt)">' + w.vintage + '</span>' : ''}</div>
              ${window ? `<div class="drink-soon-meta">${window}</div>` : ''}
            </div>
            <span class="drink-soon-qty">${qty}×</span>
          </div>`;
        }).join('');

    // ── Spending over time (last 12 months) ─────────────────────────────────
    const spendingChart = (() => {
      // Build last-12-month buckets keyed YYYY-MM
      const months = [];
      const d = new Date();
      for (let i = 11; i >= 0; i--) {
        const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
        months.push({
          key:   `${m.getFullYear()}-${String(m.getMonth()+1).padStart(2,'0')}`,
          label: m.toLocaleDateString(this.lang === 'nl' ? 'nl-NL' : 'en-GB', { month: 'short' }),
          year:  m.getFullYear(),
          total: 0,
        });
      }
      const buckets = Object.fromEntries(months.map(m => [m.key, m]));

      let anyData = false;
      log.forEach(e => {
        if (!e.price) return;
        const key = new Date(e.date).toISOString().slice(0,7); // YYYY-MM
        if (buckets[key]) { buckets[key].total += e.price; anyData = true; }
      });

      if (!anyData) {
        return `<div class="spending-no-data">${this.t('stats.spendingEmpty')}</div>`;
      }

      const max = Math.max(...months.map(m => m.total), 1);
      const grandTotal = months.reduce((s, m) => s + m.total, 0);
      const W = 320; // viewBox width
      const H = 120; // bar area height
      const barW = Math.floor(W / months.length) - 3;
      const pad  = 28; // bottom label area

      const bars = months.map((m, i) => {
        const bh  = m.total > 0 ? Math.max(4, Math.round((m.total / max) * H)) : 0;
        const x   = i * (W / months.length) + 1;
        const y   = H - bh;
        const showYear = i === 0 || (i > 0 && m.year !== months[i-1].year);
        const label = showYear && (i === 0 || i === 11)
          ? m.label + ' \'' + String(m.year).slice(2)
          : m.label;
        return `
          <rect x="${x}" y="${y}" width="${barW}" height="${bh}"
                rx="3" fill="var(--burgundy)" opacity="${m.total > 0 ? '.85' : '.12'}"/>
          ${m.total > 0 ? `<text x="${x + barW/2}" y="${y - 3}" text-anchor="middle" font-size="7" fill="var(--gold)" font-weight="600">€${Math.round(m.total)}</text>` : ''}
          <text x="${x + barW/2}" y="${H + pad - 4}" text-anchor="middle" font-size="8" fill="var(--text-lt)">${label}</text>`;
      }).join('');

      return `
        <div class="spending-chart-wrap">
          <svg class="spending-chart-svg" viewBox="0 0 ${W} ${H + pad}" xmlns="http://www.w3.org/2000/svg">
            <!-- grid lines -->
            ${[0.25, 0.5, 0.75, 1].map(f => {
              const y = H - Math.round(f * H);
              return `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="var(--cream-dk)" stroke-width="1"/>`;
            }).join('')}
            ${bars}
          </svg>
          <div class="spending-chart-total">${this.t('stats.spendingTotal')}: <strong>€${grandTotal.toFixed(0)}</strong></div>
        </div>`;
    })();

    // ── Consumption history ──────────────────────────────────────────────────
    const historyRows = log.length === 0
      ? `<div class="empty-state" style="padding:24px 0">${this.t('stats.noHistory')}</div>`
      : log.slice(0, 50).map(e => {
          const d    = new Date(e.date);
          const date = d.toLocaleDateString(this.lang === 'nl' ? 'nl-NL' : 'en-GB', { day:'numeric', month:'short', year:'numeric' });
          const loc  = e.fromCellarName
            ? `📍 ${this._esc(e.fromCellarName)}${e.fromSlot ? ' · ' + this._slotPositionLabel(e.fromSlot) : ''}`
            : this.t('stats.unknownCellar');
          const stars = e.tastingRating
            ? `<span class="stats-tasting-stars">${'★'.repeat(e.tastingRating)}${'☆'.repeat(5 - e.tastingRating)}</span>`
            : '';
          const note  = e.tastingNote
            ? `<div class="stats-history-tasting">${stars ? stars + ' ' : ''}"${this._esc(e.tastingNote)}"</div>`
            : (stars ? `<div class="stats-history-tasting">${stars}</div>` : '');
          return `
          <div class="stats-history-row">
            <div class="stats-history-main">
              <span class="type-badge type-${(e.wineType||'red').replace('é','e')}" style="font-size:.65rem;padding:2px 6px"></span>
              <div style="min-width:0;flex:1">
                <div class="stats-history-name">${this._esc(e.wineName)}${e.wineVintage ? ' <span style="opacity:.6;font-weight:400">'+e.wineVintage+'</span>' : ''}</div>
                <div class="stats-history-meta">${date} · ${loc}</div>
                ${note}
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;align-items:center">
              ${e.wineId ? `<button class="btn btn-ghost btn-sm" data-action="restore-consumption" data-id="${e.id}"
                      style="font-size:.75rem;padding:4px 8px;color:var(--gold)" title="${this.lang==='nl'?'Terugplaatsen':'Put back'}">↩</button>` : ''}
              <button class="btn btn-icon btn-sm" data-action="delete-consumption" data-id="${e.id}"
                      style="color:var(--text-lt)">${this._iconTrash()}</button>
            </div>
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

    ${healthSection ? `
    <div class="stats-section">
      <h2 class="stats-section-title">🏥 ${this.t('stats.health')}</h2>
      ${healthSection}
    </div>` : ''}

    <div class="stats-section">
      <h2 class="stats-section-title">${this.t('stats.byType')}</h2>
      <div class="stats-type-list">${byType || '<p style="opacity:.5;font-size:.88rem">—</p>'}</div>
    </div>

    <div class="stats-section">
      <h2 class="stats-section-title">
        🍷 ${this.t('stats.drinkSoon')}
        ${drinkSoonItems.length > 0 ? `<span style="font-size:.8rem;font-weight:400;color:var(--text-lt)">(${drinkSoonItems.length})</span>` : ''}
      </h2>
      <div class="drink-soon-list">${drinkSoonRows}</div>
    </div>

    <div class="stats-section">
      <h2 class="stats-section-title">📈 ${this.t('stats.spending')}</h2>
      ${spendingChart}
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
        <label>Language / Taal / Lingua / Langue / Idioma / Sprache</label>
        <div class="lang-toggle">
          <button class="${this.lang==='en'?'active':''}" data-action="toggle-lang" data-lang="en">EN</button>
          <button class="${this.lang==='nl'?'active':''}" data-action="toggle-lang" data-lang="nl">NL</button>
          <button class="${this.lang==='it'?'active':''}" data-action="toggle-lang" data-lang="it">IT</button>
          <button class="${this.lang==='fr'?'active':''}" data-action="toggle-lang" data-lang="fr">FR</button>
          <button class="${this.lang==='es'?'active':''}" data-action="toggle-lang" data-lang="es">ES</button>
          <button class="${this.lang==='de'?'active':''}" data-action="toggle-lang" data-lang="de">DE</button>
        </div>
      </div>
      <div class="settings-row" style="margin-top:10px">
        <div>
          <label style="display:block;font-weight:600">${this.t('settings.darkMode')}</label>
          <span style="font-size:.75rem;color:var(--text-lt)">${this.t('settings.darkModeHint')}</span>
        </div>
        <div class="dark-toggle" data-action="toggle-dark-mode" style="cursor:pointer">
          <div class="dark-toggle-track${s.darkMode ? ' on' : ''}">
            <div class="dark-toggle-thumb"></div>
          </div>
          <span class="dark-toggle-label">${s.darkMode ? (this.lang==='nl' ? 'Aan' : 'On') : (this.lang==='nl' ? 'Uit' : 'Off')}</span>
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

    <div class="settings-section">
      <h2>${this.t('settings.origovero')}</h2>
      <div class="form-group">
        <label>${this.t('settings.origoveroKeyId')}</label>
        <input id="s-origovero-key-id" class="form-control" type="text"
               placeholder="361688abe94c32401c8d645e61e4f657"
               value="${this._esc(s.origoveroKeyId||'')}">
      </div>
      <div class="form-group">
        <label>${this.t('settings.origoveroKeySecret')}</label>
        <div class="key-input-wrap">
          <input id="s-origovero-key-secret" class="form-control" type="password"
                 placeholder="…"
                 value="${this._esc(s.origoveroKeySecret||'')}">
          <span class="key-toggle-vis" data-action="toggle-key-vis" data-field="s-origovero-key-secret">show</span>
        </div>
      </div>
      <div class="form-group">
        <label>${this.t('settings.origoveroBaseUrl')}</label>
        <input id="s-origovero-base-url" class="form-control" type="text"
               placeholder="https://dev.origovero.com"
               value="${this._esc(s.origoveroBaseUrl||'')}">
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

    <div class="settings-section">
      <h2>${this.t('settings.legal')}</h2>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="btn btn-ghost btn-full" data-action="show-privacy">📄 ${this.t('settings.privacyLink')}</button>
        <button class="btn btn-ghost btn-full" data-action="show-terms">📋 ${this.t('settings.termsLink')}</button>
        <button class="btn btn-ghost btn-full" data-action="preview-consent" style="font-size:.82rem;color:var(--text-lt)">
          👁 ${this.lang === 'nl' ? 'Toestemmingsscherm bekijken' : 'Preview consent screen'}
        </button>
      </div>
    </div>

    <div class="about-info">
      <button class="btn btn-full" data-action="show-about"
              style="gap:10px;font-weight:600;background:#3B1421;color:#F2EBE1;border-radius:var(--radius);padding:14px 20px;justify-content:center;align-items:center;display:flex;">
        <img src="Logo Vinage V-Bottle No Background.png" style="height:22px;width:auto;filter:brightness(0) invert(1) opacity(.90)"> ${this.t('settings.about')}
      </button>
      <button class="btn btn-ghost btn-full" data-action="show-help"
              style="gap:8px;margin-top:8px;color:var(--gold);font-weight:600;border:1px solid var(--cream-dk);">
        📖 ${this.lang==='nl'?'Hulp &amp; Functies':'Help &amp; Features'}
      </button>
      <div style="font-size:.78rem;color:var(--text-lt);margin-top:10px;text-align:center;letter-spacing:.04em">
        ${this.t('settings.version')} · ${this.lang === 'nl' ? 'JOUW WIJN. JOUW COLLECTIE.' : 'YOUR WINE. YOUR COLLECTION.'}
      </div>
    </div>`;
  },

  saveSettings() {
    const s = DB.getSettings();
    s.anthropicKey       = document.getElementById('s-anthropic-key')?.value.trim()        || '';
    s.openaiKey          = document.getElementById('s-openai-key')?.value.trim()           || '';
    s.origoveroKeyId     = document.getElementById('s-origovero-key-id')?.value.trim()     || '';
    s.origoveroKeySecret = document.getElementById('s-origovero-key-secret')?.value.trim() || '';
    s.origoveroBaseUrl   = document.getElementById('s-origovero-base-url')?.value.trim()   || '';
    s.lang        = this.lang;
    s.apiProvider = s.apiProvider || 'anthropic';
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
          <div class="about-hero-tile">
            <img src="Logo Vinage V-Bottle No Background.png" class="about-hero-img" alt="Vinage">
            <span class="about-tile-name">vinage</span>
          </div>
        </div>
        <div class="about-content">
          <p class="about-tagline">${this.lang === 'nl' ? 'JOUW WIJN. JOUW COLLECTIE.' : 'YOUR WINE. YOUR COLLECTION.'}</p>
          <div class="about-features">
            <div class="about-feature-item">📷 ${this.lang === 'nl' ? 'Scannen & herkennen van wijnflessen' : 'Scan & identify wine bottles'}</div>
            <div class="about-feature-item">🗄️ ${this.lang === 'nl' ? 'Beheer jouw persoonlijke wijnkelder' : 'Manage your personal wine cellar'}</div>
            <div class="about-feature-item">🍽️ ${this.lang === 'nl' ? 'AI-gedreven spijscombinaties' : 'AI-powered food pairings'}</div>
            <div class="about-feature-item">☁️ ${this.lang === 'nl' ? 'Cloud synchronisatie & delen' : 'Cloud sync & household sharing'}</div>
            <div class="about-feature-item">🌐 ${this.lang === 'nl' ? 'Nederlands & Engels' : 'English & Dutch'}</div>
          </div>
          <div class="about-version">${this.t('settings.version')}</div>
          <div class="about-footer">
            <span>Vinage &copy;</span>
            <span>${this.lang === 'nl' ? 'Door Arnold &amp; Marianne Ruijter' : 'By Arnold &amp; Marianne Ruijter'}</span>
          </div>
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

  // ── First-run consent overlay (GDPR) ────────────────────────────────────
  _showConsent(force = false) {
    const existing = document.getElementById('consent-overlay');
    if (existing) existing.remove();
    if (!force && localStorage.getItem('vinageConsent')) return;

    const el = document.createElement('div');
    el.id = 'consent-overlay';
    el.innerHTML = `
      <div class="consent-inner">
        <div class="consent-logo-wrap">
          <img src="Logo Vinage V-Bottle No Background.png" alt="Vinage" style="height:52px;width:auto;opacity:.95">
          <img src="Logo Vinage Name No Background.png" alt="Vinage" style="height:18px;width:auto;opacity:.90;margin-top:6px">
        </div>
        <h2 class="consent-title">${this.t('settings.consentTitle')}</h2>
        <p class="consent-body">${this.t('settings.consentBody')}</p>
        <ul class="consent-list">
          <li>${this.t('settings.consentPoint1')}</li>
          <li>${this.t('settings.consentPoint2')}</li>
          <li>${this.t('settings.consentPoint3')}</li>
        </ul>
        <p class="consent-privacy-note">${this.t('settings.consentPrivacy')}</p>
        <button class="btn btn-primary btn-full consent-accept-btn" id="consent-accept-btn">
          ${this.t('settings.consentAccept')}
        </button>
      </div>`;

    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('consent-overlay-visible'));

    document.getElementById('consent-accept-btn')?.addEventListener('click', () => {
      localStorage.setItem('vinageConsent', '1');
      el.classList.remove('consent-overlay-visible');
      setTimeout(() => el.remove(), 400);
    });
  },

  // ── Privacy Policy view ───────────────────────────────────────────────────
  buildPrivacyView() {
    const nl = this.lang === 'nl';
    return `
    <div class="page-header">
      <button class="back-btn" data-action="back-to-settings" style="background:none;border:none;color:var(--gold);font-size:1rem;cursor:pointer;padding:0 8px 0 0">&#8592;</button>
      <h1>${this.t('settings.privacyTitle')}</h1>
    </div>
    <div class="legal-page-body">
      ${nl ? `
      <p class="legal-updated">Versie 1.0 — ${new Date().toLocaleDateString('nl-NL',{month:'long',year:'numeric'})}</p>

      <h2>Wie zijn wij?</h2>
      <p>Vinage is een persoonlijke wijnkelderapp ontwikkeld door Arnold &amp; Marianne Ruijter. Vinage is niet commercieel aangeboden; dit beleid beschrijft hoe de app omgaat met jouw gegevens.</p>

      <h2>Welke gegevens verwerken wij?</h2>
      <p><strong>Wijnverzameling &amp; keldergegevens</strong> — namen, jaargangen, locaties, aantekeningen en foto's die jij invoert. Deze worden uitsluitend lokaal op jouw apparaat opgeslagen, tenzij je Cloud Delen inschakelt.</p>
      <p><strong>Scanafbeeldingen</strong> — wanneer je een fles scant, wordt de afbeelding tijdelijk naar de AI-provider gestuurd (Anthropic Claude of OpenAI) voor herkenning. De afbeelding wordt <em>niet</em> door Vinage opgeslagen of gedeeld.</p>
      <p><strong>Cloud Delen (optioneel)</strong> — als je inlogt via Google en een gedeelde kelder aanmaakt, worden je wijngegevens gesynchroniseerd via Firebase (Google). Jouw Google-profiel (naam en e-mailadres) wordt uitsluitend gebruikt voor authenticatie.</p>

      <h2>Grondslag voor verwerking</h2>
      <p>Verwerking is gebaseerd op <strong>uitvoering van de overeenkomst</strong> (het verlenen van de app-functionaliteit) en, voor Cloud Delen, op jouw <strong>uitdrukkelijke toestemming</strong>.</p>

      <h2>Gegevens die wij <em>niet</em> verwerken</h2>
      <p>Wij verzamelen geen locatiegegevens, advertentie-ID's, surfgedrag of betalingsinformatie. Er worden geen analytische of trackingtrackers gebruikt.</p>

      <h2>AI-training opt-out</h2>
      <p>Alle API-aanroepen naar Anthropic en OpenAI bevatten een opt-out-header die aangeeft dat jouw gegevens niet mogen worden gebruikt voor modeltraining.</p>

      <h2>Opslag &amp; beveiliging</h2>
      <p>Lokale gegevens worden opgeslagen in de browser (localStorage / IndexedDB). Gesynchroniseerde gegevens worden beveiligd door Firebase, gecertificeerd conform ISO 27001 en SOC 2. API-sleutels worden uitsluitend lokaal op jouw apparaat bewaard.</p>

      <h2>Jouw rechten</h2>
      <p>Je hebt het recht op inzage, correctie, verwijdering en overdraagbaarheid van jouw gegevens. Gebruik de knop <em>Gegevens Exporteren</em> in Instellingen voor een volledig overzicht, of <em>Alle Gegevens Wissen</em> om alles lokaal te verwijderen. Als je Cloud Delen gebruikt, kun je jouw account permanent verwijderen via Instellingen → Cloud Delen.</p>

      <h2>Contact</h2>
      <p>Vragen over dit beleid? Neem contact op via <a href="mailto:arnold.ruijter@outlook.com" style="color:var(--gold)">arnold.ruijter@outlook.com</a>.</p>
      ` : `
      <p class="legal-updated">Version 1.0 — ${new Date().toLocaleDateString('en-GB',{month:'long',year:'numeric'})}</p>

      <h2>Who are we?</h2>
      <p>Vinage is a personal wine cellar app developed by Arnold &amp; Marianne Ruijter. Vinage is not commercially offered; this policy describes how the app handles your data.</p>

      <h2>What data do we process?</h2>
      <p><strong>Wine collection &amp; cellar data</strong> — names, vintages, locations, notes and photos that you enter. These are stored locally on your device only, unless you enable Cloud Sharing.</p>
      <p><strong>Scan images</strong> — when you scan a bottle, the image is temporarily sent to your chosen AI provider (Anthropic Claude or OpenAI) for identification. The image is <em>not</em> stored or shared by Vinage.</p>
      <p><strong>Cloud Sharing (optional)</strong> — if you sign in with Google and create a shared cellar, your wine data is synced via Firebase (Google). Your Google profile (name and e-mail) is used solely for authentication.</p>

      <h2>Legal basis for processing</h2>
      <p>Processing is based on <strong>performance of the contract</strong> (providing the app functionality) and, for Cloud Sharing, on your <strong>explicit consent</strong>.</p>

      <h2>Data we do <em>not</em> process</h2>
      <p>We do not collect location data, advertising IDs, browsing behaviour or payment information. No analytics or tracking scripts are used.</p>

      <h2>AI training opt-out</h2>
      <p>All API calls to Anthropic and OpenAI include an opt-out header indicating that your data must not be used for model training.</p>

      <h2>Storage &amp; security</h2>
      <p>Local data is stored in the browser (localStorage / IndexedDB). Synced data is secured by Firebase, certified to ISO 27001 and SOC 2. API keys are stored locally on your device only.</p>

      <h2>Your rights</h2>
      <p>You have the right to access, correct, delete and port your data. Use the <em>Export Data</em> button in Settings for a complete overview, or <em>Clear All Data</em> to delete everything locally. If you use Cloud Sharing, you can permanently delete your account from Settings → Cloud Sharing.</p>

      <h2>Contact</h2>
      <p>Questions about this policy? Contact us at <a href="mailto:arnold.ruijter@outlook.com" style="color:var(--gold)">arnold.ruijter@outlook.com</a>.</p>
      `}
    </div>`;
  },

  // ── Terms of Service view ─────────────────────────────────────────────────
  buildTermsView() {
    const nl = this.lang === 'nl';
    return `
    <div class="page-header">
      <button class="back-btn" data-action="back-to-settings" style="background:none;border:none;color:var(--gold);font-size:1rem;cursor:pointer;padding:0 8px 0 0">&#8592;</button>
      <h1>${this.t('settings.termsTitle')}</h1>
    </div>
    <div class="legal-page-body">
      ${nl ? `
      <p class="legal-updated">Versie 1.0 — ${new Date().toLocaleDateString('nl-NL',{month:'long',year:'numeric'})}</p>

      <h2>Gebruik van de app</h2>
      <p>Vinage wordt aangeboden als persoonlijk hulpmiddel voor het beheer van jouw wijnverzameling. Door de app te gebruiken ga je akkoord met deze voorwaarden.</p>

      <h2>Geen garantie</h2>
      <p>De app wordt aangeboden "zoals hij is", zonder enige garantie voor juistheid, betrouwbaarheid of beschikbaarheid. Wijnidentificatie door AI kan afwijken van de werkelijkheid; verificeer altijd de fles zelf.</p>

      <h2>API-sleutels</h2>
      <p>Je bent zelf verantwoordelijk voor de beveiliging van jouw API-sleutels (Anthropic, OpenAI). Vinage slaat deze uitsluitend lokaal op. Deel jouw sleutels nooit met anderen.</p>

      <h2>Intellectueel eigendom</h2>
      <p>De naam "Vinage", het fleslogo en de app-vormgeving zijn eigendom van Arnold Ruijter. Je mag de app gebruiken voor persoonlijk, niet-commercieel gebruik.</p>

      <h2>Aansprakelijkheid</h2>
      <p>Vinage aanvaardt geen aansprakelijkheid voor schade die voortvloeit uit het gebruik van de app, onjuiste wijnidentificatie of verlies van gegevens.</p>

      <h2>Wijzigingen</h2>
      <p>Deze voorwaarden kunnen worden bijgewerkt. De datum bovenaan geeft de meest recente versie aan.</p>

      <h2>Contact</h2>
      <p>Vragen? Neem contact op via <a href="mailto:arnold.ruijter@outlook.com" style="color:var(--gold)">arnold.ruijter@outlook.com</a>.</p>
      ` : `
      <p class="legal-updated">Version 1.0 — ${new Date().toLocaleDateString('en-GB',{month:'long',year:'numeric'})}</p>

      <h2>Use of the app</h2>
      <p>Vinage is provided as a personal tool for managing your wine collection. By using the app you agree to these terms.</p>

      <h2>No warranty</h2>
      <p>The app is provided "as is", without any guarantee of accuracy, reliability or availability. Wine identification by AI may differ from reality; always verify the bottle yourself.</p>

      <h2>API keys</h2>
      <p>You are solely responsible for securing your own API keys (Anthropic, OpenAI). Vinage stores these locally only. Never share your keys with others.</p>

      <h2>Intellectual property</h2>
      <p>The name "Vinage", the bottle logo and the app design are the property of Arnold Ruijter. You may use the app for personal, non-commercial use.</p>

      <h2>Liability</h2>
      <p>Vinage accepts no liability for damage resulting from use of the app, incorrect wine identification or loss of data.</p>

      <h2>Changes</h2>
      <p>These terms may be updated. The date at the top indicates the most recent version.</p>

      <h2>Contact</h2>
      <p>Questions? Contact us at <a href="mailto:arnold.ruijter@outlook.com" style="color:var(--gold)">arnold.ruijter@outlook.com</a>.</p>
      `}
    </div>`;
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
          <button class="btn btn-danger btn-full" data-action="delete-account" style="margin-top:2px">🗑 ${this.t('settings.deleteAccount')}</button>
        </div>
      </div>`;
    }

    // mode === 'syncing'
    // Build members list
    const members = status.members || {};
    const myUid   = status.user.uid;
    const memberRows = Object.entries(members).map(([uid, m]) => {
      const isYou    = uid === myUid;
      const initial  = this._esc(((m.name || m.email || '?')[0]).toUpperCase());
      const name     = this._esc(m.name  || m.email || 'Unknown');
      const email    = this._esc(m.email || '');
      const lastSeen = m.lastSeen
        ? (() => {
            const diff = Date.now() - m.lastSeen;
            const mins = Math.floor(diff / 60000);
            const hrs  = Math.floor(diff / 3600000);
            const days = Math.floor(diff / 86400000);
            if (mins < 2)   return this.lang === 'nl' ? 'Zojuist' : 'Just now';
            if (mins < 60)  return `${mins}m`;
            if (hrs  < 24)  return `${hrs}h`;
            return `${days}d`;
          })()
        : '';
      return `
        <div class="sync-member-row">
          <div class="sync-member-avatar${isYou ? ' sync-member-avatar--you' : ''}">${initial}</div>
          <div class="sync-member-info">
            <div class="sync-member-name">${name}</div>
            ${email ? `<div class="sync-member-email">${email}</div>` : ''}
          </div>
          ${isYou
            ? `<div class="sync-member-badge">${this.t('settings.syncMembersYou')}</div>`
            : lastSeen ? `<div class="sync-member-lastseen">${lastSeen}</div>` : ''}
        </div>`;
    }).join('');

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
      ${Object.keys(members).length > 0 ? `
        <div class="sync-members-title">${this.t('settings.syncMembers')}</div>
        <div class="sync-members-list">${memberRows}</div>
      ` : ''}
      <button class="btn btn-ghost btn-full" data-action="sync-leave" style="margin-top:8px;color:var(--text-lt)">${this.t('settings.syncLeave')}</button>
      <button class="btn btn-danger btn-full" data-action="delete-account" style="margin-top:6px">🗑 ${this.t('settings.deleteAccount')}</button>
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

  async _deleteAccount() {
    // Show confirmation modal with branded warning
    const body = `
      <div style="padding:4px 0 8px">
        <p style="font-size:.9rem;line-height:1.6;color:var(--text);margin:0 0 16px">${this.t('settings.deleteAccountBody')}</p>
        <div style="display:flex;flex-direction:column;gap:10px">
          <button class="btn btn-danger btn-full" id="confirm-delete-account-btn">${this.t('settings.deleteAccountConfirm')}</button>
          <button class="btn btn-ghost btn-full" id="cancel-delete-account-btn">${this.t('common.cancel')}</button>
        </div>
      </div>`;
    this.openModal(this.t('settings.deleteAccountTitle'), body);

    document.getElementById('cancel-delete-account-btn')?.addEventListener('click', () => this.closeModal());
    document.getElementById('confirm-delete-account-btn')?.addEventListener('click', async () => {
      this.closeModal();
      this.toast(this.lang === 'nl' ? 'Bezig met verwijderen…' : 'Deleting account…', 'info');
      try {
        await Sync.deleteAccount();
        // Clear all local data after successful Firebase deletion
        DB.clearAll();
        this.toast(this.t('settings.deleteAccountSuccess'), 'success');
        // Reset app state
        this.navigate('cellar');
      } catch (e) {
        if (e.message === 'requires_recent_login') {
          this.toast(this.t('settings.deleteAccountReauth'), 'error');
        } else {
          this.toast(this.t('common.error'), 'error');
        }
      }
    });
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DECANTING TIMER (Feature 7)
  // ══════════════════════════════════════════════════════════════════════════
  _estimateDecantTime(wine) {
    // Rule-based decant estimate — returns { mins, reason }
    const nl      = this.lang === 'nl';
    const age     = wine.vintage ? new Date().getFullYear() - wine.vintage : 6;
    const grapes  = (wine.grapes || []).map(g => g.toLowerCase().trim());
    const region  = (wine.region  || '').toLowerCase();
    const type    = wine.type || 'red';

    if (type === 'fortified') {
      return { mins: 45, reason: nl ? 'Gefortificeerde wijn heeft matige beluchting nodig' : 'Fortified wine benefits from moderate breathing' };
    }
    if (type === 'dessert') {
      return { mins: 20, reason: nl ? 'Dessertwijn heeft slechts een korte decanteer nodig' : 'Dessert wine needs only a brief decant' };
    }

    // Red wine — judge by age first
    if (age >= 20) {
      return { mins: 30, reason: nl ? `${age} jaar oud — kort decanteren om sediment te verwijderen` : `${age} years old — brief decant to separate sediment` };
    }
    if (age >= 15) {
      return { mins: 45, reason: nl ? 'Rijpe wijn — matig decanteren aanbevolen' : 'Mature wine — moderate decant recommended' };
    }

    // Determine body from grapes / region
    const boldGrapes  = ['cabernet sauvignon','cabernet','syrah','shiraz','nebbiolo','tannat','malbec','sagrantino','monastrell','mourvèdre','mouvedre','aglianico','tinta roriz','touriga nacional'];
    const lightGrapes = ['pinot noir','gamay','grenache','dolcetto','barbera','zweigelt','frappato','trousseau','poulsard','nerello'];
    const boldRegions = ['barolo','barbaresco','barossa','napa','bordeaux','rioja','cahors','priorat','amarone','brunello','bolgheri','ribera','douro','hermitage','châteauneuf','chateauneuf'];
    const lightRegions= ['burgundy','beaujolais','bourgogne','loire','alsace','volnay','chambolle','vosne'];

    const isBold  = boldGrapes.some(g => grapes.some(wg => wg.includes(g)))  || boldRegions.some(r => region.includes(r));
    const isLight = lightGrapes.some(g => grapes.some(wg => wg.includes(g))) || lightRegions.some(r => region.includes(r));

    if (isBold && age <= 5)  return { mins: 120, reason: nl ? 'Jong en tanninrijk — laat uitgebreid ademen' : 'Young and tannic — needs extended breathing' };
    if (isBold && age <= 10) return { mins: 90,  reason: nl ? 'Vol en stevig — ruime beluchting nodig' : 'Full-bodied with firm tannins — generous decant' };
    if (isBold)              return { mins: 60,  reason: nl ? 'Vol van stijl — standaard decanteertijd' : 'Full-bodied style — standard decant time' };
    if (isLight && age <= 5) return { mins: 30,  reason: nl ? 'Lichte stijl — kort ademen om te openen' : 'Lighter style — brief decant to open up' };
    if (isLight)             return { mins: 20,  reason: nl ? 'Licht en elegant — slechts even decanteren' : 'Light and elegant — just a short decant' };

    // Unknown / medium body
    if (age <= 5) return { mins: 75, reason: nl ? 'Jonge rode wijn — standaard beluchting' : 'Young red — standard breathing time' };
    return       { mins: 60, reason: nl ? 'Rode wijn — standaard decanteertijd' : 'Red wine — standard decant time' };
  },

    _showDecantModal(wineOrId, afterClose = null) {
    const wine = (typeof wineOrId === 'object') ? wineOrId : DB.getWineById(wineOrId);
    if (!wine) return;
    const { mins: suggestedMins, reason } = this._estimateDecantTime(wine);
    const presets = [20, 30, 45, 60, 90, 120];
    const body = `
      <div style="background:var(--cream);border-radius:10px;padding:10px 14px;margin-bottom:14px;display:flex;gap:10px;align-items:flex-start">
        <span style="font-size:1.1rem;flex-shrink:0">💡</span>
        <div>
          <div style="font-size:.78rem;font-weight:700;color:var(--gold);letter-spacing:.06em;text-transform:uppercase;margin-bottom:2px">${this.lang==='nl'?'Advies voor deze wijn':'Advised for this wine'}</div>
          <div style="font-size:.88rem;color:var(--text);font-weight:600">${suggestedMins} ${this.lang==='nl'?'minuten':'minutes'}</div>
          <div style="font-size:.78rem;color:var(--text-md);margin-top:2px">${reason}</div>
        </div>
      </div>
      <p style="margin-bottom:10px;color:var(--text-md);font-size:.9rem">${this.t('scan.decantMins')}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        ${presets.map(m => `<button class="btn btn-secondary btn-sm decant-preset${m===suggestedMins?' btn-primary':''}" data-mins="${m}" onclick="document.getElementById('decant-mins').value=${m}">${m}</button>`).join('')}
      </div>
      <input id="decant-mins" class="form-control" type="number" min="1" max="480" value="${suggestedMins}">`;
    this.showModal(this.t('scan.decantTitle'), body, [
      { label: this.t('common.cancel'), cls: 'btn-secondary', action: () => {
        this.closeModal();
        afterClose?.();
      }},
      { label: this.t('scan.decantStart'), cls: 'btn-primary', action: () => {
        const mins = parseInt(document.getElementById('decant-mins')?.value || '60', 10);
        this.closeModal();
        this._startDecantTimer(wine, mins);
        afterClose?.();
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
  // ══════════════════════════════════════════════════════════════════════════
  // SHARE — single wine as standalone HTML page
  // ══════════════════════════════════════════════════════════════════════════
  async _shareWineAsHTML(wineId) {
    const wine = DB.getWineById(wineId);
    if (!wine) return;

    // Try to get the best available image
    let imgSrc = null;
    try {
      const medium = await ImageDB.get(wineId);  // 360px JPEG base64
      if (medium) imgSrc = `data:image/jpeg;base64,${medium}`;
    } catch(_) {}
    if (!imgSrc && wine.imageUrl) imgSrc = wine.imageUrl;
    if (!imgSrc && wine.thumbnail) imgSrc = `data:image/jpeg;base64,${wine.thumbnail}`;

    const html = this._buildShareHTML(wine, imgSrc);
    const blob = new Blob([html], { type: 'text/html' });
    const filename = `${(wine.name||'wine').replace(/[^a-z0-9]/gi,'_')}_Vinage.html`;

    // Try Web Share API with file first (Android/iOS), fall back to download
    if (navigator.share && navigator.canShare) {
      const file = new File([blob], filename, { type: 'text/html' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: wine.name, text: `${wine.name}${wine.vintage?' '+wine.vintage:''} — Vinage` });
          return;
        } catch(_) {}
      }
    }
    // Download fallback
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },

  _buildShareHTML(wine, imgSrc) {
    const lang   = this.lang;
    const typeLabel = (TRANSLATIONS[lang]?.types?.[wine.type] || wine.type || '').toUpperCase();
    const typeColors = { red:'#7B1A2E', white:'#8B6914', 'rosé':'#B54060', sparkling:'#4A7840', dessert:'#B07020', fortified:'#7A3010' };
    const tc = typeColors[wine.type] || '#7B1A2E';
    const stars = wine.rating ? '★'.repeat(wine.rating) + '☆'.repeat(5 - wine.rating) : '';
    const meta  = [wine.vintage, wine.region, wine.country].filter(Boolean).join(' · ');
    const grapes = (wine.grapes||[]).join(', ');
    const pairings = (wine.pairings||[]).join(', ');
    const drinkFrom = wine.drinkFrom || '';
    const drinkUntil = wine.drinkUntil || '';
    const drinkWindow = drinkFrom && drinkUntil ? `${drinkFrom} – ${drinkUntil}` : drinkFrom || drinkUntil || '';
    const label = {
      producer: lang==='nl'?'Producent':'Producer',
      vintage:  lang==='nl'?'Oogstjaar':'Vintage',
      region:   lang==='nl'?'Regio':'Region',
      grapes:   lang==='nl'?'Druivensoort':'Grapes',
      drink:    lang==='nl'?'Drinkvenster':'Drink window',
      notes:    lang==='nl'?'Notities':'Tasting notes',
      pairings: lang==='nl'?'Spijscombinaties':'Food pairings',
      price:    lang==='nl'?'Prijs':'Price',
      sharedWith: lang==='nl'?'Gedeeld via Vinage':'Shared via Vinage',
    };

    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${this._esc(wine.name)} — Vinage</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,600&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Helvetica Neue',Helvetica,sans-serif;background:#F2EBE1;color:#2A0E16;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:0 0 48px}
  .hero{width:100%;max-width:520px;background:linear-gradient(160deg,#5C1828 0%,#3B1422 60%,#2A0E14 100%);padding:28px 24px 32px;display:flex;flex-direction:column;align-items:center;gap:20px}
  .logo-row{display:flex;align-items:center;gap:10px;align-self:flex-start}
  .logo-v{font-family:'Fraunces',Georgia,serif;font-weight:300;font-size:1.3rem;color:#F2EBE1;letter-spacing:.08em}
  .logo-name{font-size:.7rem;color:#A3835B;letter-spacing:.18em;text-transform:uppercase;margin-top:2px}
  .wine-img-wrap{width:180px;height:240px;border-radius:14px;overflow:hidden;background:rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;box-shadow:0 12px 40px rgba(0,0,0,.45)}
  .wine-img-wrap img{width:100%;height:100%;object-fit:cover}
  .wine-img-placeholder{font-size:4rem;opacity:.3}
  .type-badge{display:inline-block;background:${tc}33;color:${tc};border:1px solid ${tc}66;border-radius:20px;padding:4px 14px;font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
  .card{width:100%;max-width:520px;background:#fff;border-radius:0 0 20px 20px;padding:28px 24px 32px;box-shadow:0 4px 24px rgba(59,20,34,.10)}
  .wine-name{font-family:'Fraunces',Georgia,serif;font-weight:300;font-size:1.8rem;color:#3B1422;line-height:1.2;margin:8px 0 4px}
  .wine-producer{font-size:1rem;color:#A3835B;margin-bottom:4px}
  .wine-meta{font-size:.85rem;color:#6B3A30;margin-bottom:16px}
  .stars{color:#A3835B;font-size:1.1rem;margin-bottom:20px;letter-spacing:.05em}
  .divider{border:none;border-top:1px solid #E8DED2;margin:20px 0}
  .section-label{font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#A3835B;margin-bottom:8px}
  .section-value{font-size:.95rem;color:#2A0E16;line-height:1.6}
  .row{margin-bottom:18px}
  .pill-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
  .pill{background:#F2EBE1;border:1px solid #E8DED2;border-radius:20px;padding:4px 12px;font-size:.82rem;color:#3B1422}
  .notes{background:#F9F5F0;border-left:3px solid #A3835B;border-radius:0 8px 8px 0;padding:12px 16px;font-size:.9rem;color:#3B1422;line-height:1.6;font-style:italic}
  .footer{margin-top:32px;text-align:center;font-size:.75rem;color:#A3835B;letter-spacing:.06em}
  .footer strong{font-family:'Fraunces',Georgia,serif;font-weight:300;font-size:.9rem;color:#3B1422}
  @media(max-width:520px){.hero{border-radius:0}.card{border-radius:0 0 0 0}}
</style>
</head>
<body>
<div class="hero">
  <div class="logo-row">
    <div>
      <div class="logo-v">vinage</div>
      <div class="logo-name">${label.sharedWith}</div>
    </div>
  </div>
  <div class="wine-img-wrap">
    ${imgSrc ? `<img src="${imgSrc}" alt="${this._esc(wine.name)}">` : '<span class="wine-img-placeholder">🍷</span>'}
  </div>
  <span class="type-badge">${typeLabel}</span>
</div>

<div class="card">
  <div class="wine-name">${this._esc(wine.name)}</div>
  ${wine.producer ? `<div class="wine-producer">${this._esc(wine.producer)}</div>` : ''}
  ${meta ? `<div class="wine-meta">${this._esc(meta)}</div>` : ''}
  ${stars ? `<div class="stars">${stars}</div>` : ''}

  <hr class="divider">

  ${grapes ? `<div class="row"><div class="section-label">${label.grapes}</div><div class="pill-list">${(wine.grapes||[]).map(g=>`<span class="pill">${this._esc(g)}</span>`).join('')}</div></div>` : ''}
  ${drinkWindow ? `<div class="row"><div class="section-label">${label.drink}</div><div class="section-value">${drinkWindow}</div></div>` : ''}
  ${wine.price != null ? `<div class="row"><div class="section-label">${label.price}</div><div class="section-value">€${Number(wine.price).toFixed(2)}</div></div>` : ''}

  ${wine.notes ? `<hr class="divider"><div class="row"><div class="section-label">${label.notes}</div><div class="notes">${this._esc(wine.notes)}</div></div>` : ''}

  ${pairings ? `<hr class="divider"><div class="row"><div class="section-label">${label.pairings}</div><div class="pill-list">${(wine.pairings||[]).map(p=>`<span class="pill">${this._esc(p)}</span>`).join('')}</div></div>` : ''}

  <hr class="divider">
  <div class="footer"><strong>vinage</strong><br>${label.sharedWith}</div>
</div>
</body>
</html>`;
  },

  // ══════════════════════════════════════════════════════════════════════════
  // HELP OVERLAY
  // ══════════════════════════════════════════════════════════════════════════
  _showHelp() {
    const nl = this.lang === 'nl';
    const el = document.createElement('div');
    el.id = 'help-overlay';
    el.innerHTML = `
      <div class="about-overlay-inner">
        <button class="about-close-btn" data-action="close-help" aria-label="Close">✕</button>
        <div class="about-hero-wrap" style="padding:28px 24px 20px">
          <div class="about-hero-tile" style="width:auto;padding:20px 32px;gap:8px">
            <span style="font-size:1.5rem">📖</span>
            <span class="about-tile-name" style="font-size:1.1rem">${nl?'Hulp & Functies':'Help & Features'}</span>
          </div>
        </div>
        <div class="about-content" style="text-align:left">

          <div class="help-section">
            <div class="help-section-title">📷 ${nl?'Wijn scannen':'Scanning a wine'}</div>
            <ul class="help-list">
              <li>${nl?'Zorg voor goede belichting en houd de telefoon stil':'Good lighting and a steady hand make a big difference'}</li>
              <li>${nl?'Richt de camera recht op het etiket':'Point the camera straight at the label'}</li>
              <li>${nl?'Werkt het beste met duidelijke, schone etiketten':'Works best with clean, front-facing labels'}</li>
              <li>${nl?'De AI herkent druif, regio, oogstjaar en meer':'The AI identifies grape, region, vintage and more'}</li>
              <li>${nl?'Geen API-sleutel? Voeg handmatig toe via + Handmatig toevoegen':'No API key? Use + Add manually on the scan screen'}</li>
            </ul>
          </div>

          <div class="help-section">
            <div class="help-section-title">🗄️ ${nl?'Kelderlocaties':'Cellar locations'}</div>
            <ul class="help-list">
              <li><strong>${nl?'Roosterrek':'Grid rack'}</strong> — ${nl?'Klassiek rij × kolom rek. Sla op per vakje.':'Classic row × column rack. Track each slot.'}</li>
              <li><strong>${nl?'Diamantrek':'Diamond rack'}</strong> — ${nl?'Diagonaal patroon voor speciale rekken.':'Diagonal layout for specialty racks.'}</li>
              <li><strong>${nl?'Doos (12)':'Case / Box (12)'}</strong> — ${nl?'12 flessen per doos, bijgehouden als eenheid.':'12-bottle case tracked as a unit.'}</li>
              <li><strong>${nl?'Doos (6)':'Case / Box (6)'}</strong> — ${nl?'Halve doos van 6 flessen in 3 × 2 indeling.':'Half-case of 6 bottles in a 3 × 2 layout.'}</li>
              <li><strong>${nl?'Vrije plank / bak':'Free shelf / bin'}</strong> — ${nl?'Ongestructureerde opslag (koelkast, krat, plank).':'Unstructured storage — fridge, crate, shelf.'}</li>
            </ul>
          </div>

          <div class="help-section">
            <div class="help-section-title">🟢 ${nl?'Drinkvenster kleuren':'Drink window colours'}</div>
            <ul class="help-list">
              <li><span style="color:#2D6A4F">●</span> ${nl?'<strong>Groen</strong> — nu op zijn best':'<strong>Green</strong> — drinking now at its best'}</li>
              <li><span style="color:#A3835B">●</span> ${nl?'<strong>Goud</strong> — bijna of net voorbij optimum':'<strong>Gold</strong> — approaching or just past peak'}</li>
              <li><span style="color:var(--text-lt)">●</span> ${nl?'<strong>Grijs</strong> — nog te vroeg of te laat':'<strong>Grey</strong> — too early or too late to drink'}</li>
            </ul>
          </div>

          <div class="help-section">
            <div class="help-section-title">☁️ ${nl?'Kelder delen — stap voor stap':'Sharing a cellar — step by step'}</div>
            <p style="font-size:.86rem;color:var(--text-md);line-height:1.6;margin-bottom:12px">
              ${nl
                ? `Vinage slaat je collectie standaard lokaal op je apparaat op. Voor het <strong>delen van de kelder</strong> is een centrale, online database nodig — anders ziet geen enkel apparaat de wijzigingen van een ander. Die database is <strong>al ingebouwd in de app</strong>: de beheerder van Vinage heeft dit vooraf opgezet via Firebase (een clouddienst van Google). Jij als gebruiker hoeft daar niets voor in te stellen. Het enige dat je nodig hebt is een Google-account — daarmee weet het systeem bij welk huishouden je hoort en welke gegevens jij mag zien.`
                : `Vinage stores your collection locally on your device by default. To <strong>share a cellar</strong>, a central online database is needed — without one, no device can see another's changes. That database is <strong>already built into the app</strong>: the person who manages Vinage set it up in advance using Firebase (a cloud service by Google). You as a user don't need to configure anything. All you need is a Google account — that's how the system knows which household you belong to and which data you're allowed to see.`}
            </p>
            <ul class="help-list">
              <li><strong>${nl?'Stap 1 — Aanmelden':'Step 1 — Sign in'}</strong><br>
                ${nl?'Ga naar <em>Instellingen → Sync &amp; Delen</em> en tik op <em>Inloggen met Google</em>. Doe dit op alle apparaten die je wilt koppelen (bijv. jij en je partner).':'Go to <em>Settings → Sync &amp; Sharing</em> and tap <em>Sign in with Google</em>. Do this on every device you want to connect (e.g. you and your partner).'}
              </li>
              <li><strong>${nl?'Stap 2 — Huishouden aanmaken (één persoon)':'Step 2 — Create a household (one person)'}</strong><br>
                ${nl?'Tik op <em>Gedeelde kelder aanmaken</em>. Je krijgt een unieke 6-tekens uitnodigingscode. Jouw bestaande collectie wordt meteen geüpload.':'Tap <em>Create shared cellar</em>. You\'ll receive a unique 6-character invite code. Your existing collection is uploaded immediately.'}
              </li>
              <li><strong>${nl?'Stap 3 — Uitnodigingscode delen':'Step 3 — Share the code'}</strong><br>
                ${nl?'Stuur de code naar je partner via WhatsApp, sms of zeg hem gewoon. De code staat zichtbaar in Instellingen → Sync & Delen.':'Send the code to your partner via WhatsApp, text, or just say it out loud. The code is always visible in Settings → Sync & Sharing.'}
              </li>
              <li><strong>${nl?'Stap 4 — Deelnemen (andere persoon)':'Step 4 — Join (the other person)'}</strong><br>
                ${nl?'Op het andere apparaat: ga naar <em>Instellingen → Sync &amp; Delen</em>, tik op <em>Deelnemen met code</em> en voer de 6-tekens code in. De kelder wordt meteen gesynchroniseerd.':'On the other device: go to <em>Settings → Sync &amp; Sharing</em>, tap <em>Join with code</em> and enter the 6-character code. The cellar syncs immediately.'}
              </li>
              <li><strong>${nl?'Wat wordt gesynchroniseerd?':'What syncs?'}</strong><br>
                ${nl?'Alle wijnen, kelderlocaties en drinkgeschiedenis (Statistieken) synchroniseren live op alle apparaten. Wijzigingen zijn binnen seconden zichtbaar.':'All wines, cellar locations and consumption history (Stats) sync live across all devices. Changes appear within seconds.'}
              </li>
              <li><strong>${nl?'Tip — Als iets niet synchroniseert':'Tip — If something doesn\'t sync'}</strong><br>
                ${nl?'Sluit de app volledig af en open hem opnieuw, of doe een harde herlaad in de browser (⟳). Controleer of je bent aangemeld en een actieve internetverbinding hebt.':'Force-close and reopen the app, or do a hard reload in the browser (⟳). Check that you\'re signed in and have an active internet connection.'}
              </li>
            </ul>
          </div>

          <div class="help-section">
            <div class="help-section-title">✨ ${nl?'Overige functies':'Other features'}</div>
            <ul class="help-list">
              <li><strong>${nl?'Verlanglijst':'Wishlist'}</strong> — ${nl?'Sla wijnen op die je wilt kopen.':'Save wines you want to buy.'}</li>
              <li><strong>${nl?'Decanteerklok':'Decant timer'}</strong> — ${nl?'Stel een afteltimer in voor luchten.':'Set a countdown for breathing time.'}</li>
              <li><strong>${nl?'Spijscombinaties':'Food pairings'}</strong> — ${nl?'AI stelt wijnen voor bij een gerecht.':'AI suggests wines to match a dish.'}</li>
              <li><strong>${nl?'Statistieken':'Statistics'}</strong> — ${nl?'Kelderwaarde, gemiddelde prijs en drinkklaar overzicht.':'Cellar value, average price and ready-to-drink overview.'}</li>
              <li><strong>${nl?'Fles openen':'Open a bottle'}</strong> — ${nl?'Registreert consumptie en verwijdert uit kelder. Herstelbaar via Statistieken.':'Logs consumption and removes from cellar. Undoable from Stats.'}</li>
              <li><strong>${nl?'Delen':'Share'}</strong> — ${nl?'Exporteer een wijn als mooi HTML-bestand om te delen.':'Export any wine as a beautiful HTML file to share.'}</li>
            </ul>
          </div>

        </div>
      </div>`;

    document.body.appendChild(el);
    el.addEventListener('click', e => {
      if (e.target.dataset.action === 'close-help' || e.target === el) {
        el.classList.remove('about-overlay-visible');
        setTimeout(() => el.remove(), 350);
      }
    });
    requestAnimationFrame(() => el.classList.add('about-overlay-visible'));
  },

  // ══════════════════════════════════════════════════════════════════════════
  // PUSH NOTIFICATIONS
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

  // Call this when the user taps the overlay or ✕ — respects the dismiss guard.
  _tryCloseModal() {
    if (this._modalDismissGuard) {
      const msg = this._modalDismissGuard;
      // Temporarily lift the guard so the confirm modal itself can open
      this._modalDismissGuard = null;
      const lang = this.lang;
      this.showModal(
        lang === 'nl' ? 'Wijn niet plaatsen?' : 'Skip placement?',
        `<p>${msg}</p>`,
        [
          {
            label: lang === 'nl' ? 'Ja, sla over' : 'Yes, skip',
            cls: 'btn-secondary',
            action: () => {
              // Cancel the pending auto-place state
              this._autoPlaceWineId   = null;
              this._pendingPlaceWineId = null;
              this.closeModal();
            }
          },
          {
            label: lang === 'nl' ? 'Terug' : 'Go back',
            cls: 'btn-primary',
            action: () => {
              // Restore the guard and re-open the original placement modal
              const wineId    = this._pendingPlaceWineId || this._autoPlaceWineId;
              const totalQty  = this._pendingPlaceTotalQty  || 1;
              const bottleNum = this._pendingPlaceBottleNum || 1;
              this.closeModal();
              if (wineId) setTimeout(() => this._promptCellarPlacement(wineId, totalQty, bottleNum), 200);
            }
          }
        ]
      );
      return;
    }
    this.closeModal();
  },

  closeModal() {
    this._modalDismissGuard = null;
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
    return { red:'#C01020', white:'#C8A020', 'rosé':'#F020A0',
             sparkling:'#3A9030', dessert:'#E08800', fortified:'#9A3A10' }[type] || '#C01020';
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
