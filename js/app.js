/* ═══════════════════════════════════════════════════════════════════════════
   Vinage — Main App
   ═══════════════════════════════════════════════════════════════════════════ */
const App = {
  // ── State ────────────────────────────────────────────────────────────────
  view: 'scan',
  lang: 'en',
  stream: null,
  capturedImage: null,      // base64 jpeg (full res, for AI + form display)
  capturedThumbnail: null,  // base64 jpeg (80×120 thumbnail, stored with wine for rack tooltip)
  scanResult: null,
  editWineId: null,
  cellarDetailId: null,
  collectionSort: 'addedAt',
  collectionFilter: 'all',
  collectionSearch: '',
  _scanRotation: 0,       // 0 | 90 | 180 | 270
  _rackZoom: 1.0,         // current rack zoom level (0.35 – 3.0)

  // ── Bootstrap ────────────────────────────────────────────────────────────
  init() {
    this.lang = detectLang();
    this.render();
    this.navigate('scan');
    document.addEventListener('click', e => this._delegateClick(e));
    Sync.init();
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
      { id: 'scan',       icon: this._iconCamera(),  label: this.t('nav.scan') },
      { id: 'cellar',     icon: this._iconCellar(),  label: this.t('nav.cellar') },
      { id: 'collection', icon: this._iconWine(),    label: this.t('nav.collection') },
      { id: 'pairing',    icon: this._iconFork(),    label: this.t('nav.pairing') },
      { id: 'settings',   icon: this._iconGear(),    label: this.t('nav.settings') },
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
      case 'pairing':    el.innerHTML = this.buildPairingView(); break;
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
      // Cloud sync actions
      case 'sync-sign-in':        Sync.signIn(); break;
      case 'sync-sign-out':       Sync.signOut(); break;
      case 'sync-create':         Sync.createHousehold(); break;
      case 'sync-join':           this._syncJoin(); break;
      case 'sync-leave':          this._syncLeave(); break;
    }
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
          <img src="Vinage Logo Pic.png" class="scan-brand-watermark" alt="" draggable="false" aria-hidden="true">
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
    this.capturedImage = null;
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

    // Create a small thumbnail for rack hover tooltip (80×120 px)
    try {
      const tC = document.createElement('canvas');
      tC.width = 80; tC.height = 120;
      tC.getContext('2d').drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 80, 120);
      this.capturedThumbnail = tC.toDataURL('image/jpeg', 0.65).split(',')[1];
    } catch (_) { this.capturedThumbnail = null; }

    // Show retake button
    const actionRow = document.getElementById('scan-action-row');
    actionRow.innerHTML = `<button class="btn btn-secondary btn-sm" data-action="retake">${this.t('scan.retake')}</button>`;

    const btn = document.getElementById('capture-btn');
    btn.style.display = 'none';

    // Extract JPEG base64
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

    const types = ['red','white','rosé','sparkling','dessert','fortified'];
    const title = this.editWineId ? this.t('common.edit') : this.t('common.add') + ' ' + this.t('nav.collection').slice(0,-1);

    const existingImgSrc = wine.imageUrl || (wine.image ? `data:image/jpeg;base64,${wine.image}` : null);
    const imageHtml = this.capturedImage
      ? `<img class="wine-form-image" src="data:image/jpeg;base64,${this.capturedImage}" alt="label">`
      : existingImgSrc
      ? `<img class="wine-form-image" src="${existingImgSrc}" alt="label">`
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
          <input id="wf-vintage" class="form-control" type="number" min="1800" max="${new Date().getFullYear()}" value="${wine.vintage||''}" placeholder="${new Date().getFullYear()}">
        </div>
        <div class="form-group">
          <label>${this.t('wine.quantity')}</label>
          <input id="wf-qty" class="form-control" type="number" min="1" value="${wine.quantity||1}">
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
      </div>`;

    this.showModal(title, body, [
      { label: this.t('common.cancel'), cls: 'btn-secondary', action: () => this.closeModal() },
      { label: this.t('common.save'),   cls: 'btn-primary',   action: () => this.saveWineForm(), id: 'wf-save-btn' }
    ]);
  },

  pickStar(val) {
    this._formRating = val;
    document.querySelectorAll('.star-btn').forEach((b, i) => b.classList.toggle('on', i < val));
  },

  pickType(type) {
    this._formType = type;
    document.querySelectorAll('.type-option').forEach(b => b.classList.toggle('selected', b.dataset.type === type));
  },

  saveWineForm() {
    const name = document.getElementById('wf-name')?.value.trim();
    if (!name) { this.toast(this.t('wine.name') + ' is required', 'error'); return; }

    const parse = id => document.getElementById(id)?.value.trim() || '';
    const parseNum = id => { const v = document.getElementById(id)?.value; return v ? parseFloat(v) : null; };
    const parseList = id => parse(id).split(',').map(s => s.trim()).filter(Boolean);

    const data = {
      name,
      image:     this.capturedImage     || null,
      thumbnail: this.capturedThumbnail || null,
      producer: parse('wf-producer'),
      vintage:  parseNum('wf-vintage') ? parseInt(parse('wf-vintage'),10) : null,
      quantity: parseInt(parse('wf-qty'),10) || 1,
      type:     this._formType,
      region:   parse('wf-region'),
      country:  parse('wf-country'),
      grapes:   parseList('wf-grapes'),
      pairings: parseList('wf-pairings'),
      notes:      parse('wf-notes'),
      price:      parseNum('wf-price'),
      rating:     this._formRating,
      drinkFrom:  parseNum('wf-drink-from')  ? parseInt(parse('wf-drink-from'),  10) : null,
      drinkUntil: parseNum('wf-drink-until') ? parseInt(parse('wf-drink-until'), 10) : null,
    };

    let newWine = null;
    if (this.editWineId) {
      Sync.updateWine(this.editWineId, data);
    } else {
      newWine = Sync.addWine(data);
    }

    this.capturedImage     = null;
    this.capturedThumbnail = null;
    this.scanResult        = null;
    this.closeModal();
    this.toast(this.t('common.save') + ' ✓', 'success');

    const fromScan = this.view === 'scan';
    if (this.view === 'collection') this.renderView();
    else if (fromScan) { this.navigate('collection'); }

    // After adding from scan, offer cellar placement
    if (newWine && fromScan) {
      setTimeout(() => this._promptCellarPlacement(newWine.id, newWine.quantity || 1, 1), 400);
    }
  },

  editWine(id) {
    const wine = DB.getWineById(id);
    if (!wine) return;
    this.capturedImage     = wine.image     || null;
    this.capturedThumbnail = wine.thumbnail || null;
    this.showWineForm(wine);
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
          this.cellarDetailId = cellarId;
          this.navigate('cellar');
          // After render, open slot picker for this wine
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

  confirmDeleteWine(id) {
    const wine = DB.getWineById(id);
    if (!wine) return;
    this.showModal(
      this.t('common.delete'),
      `<p>Delete <strong>${this._esc(wine.name)}</strong>?</p>`,
      [
        { label: this.t('common.cancel'), cls: 'btn-secondary', action: () => this.closeModal() },
        { label: this.t('common.delete'), cls: 'btn-danger', action: () => {
          Sync.deleteWine(id); this.closeModal(); this.renderView(); this.toast('Deleted', 'success');
        }}
      ]
    );
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CELLAR VIEW — List
  // ══════════════════════════════════════════════════════════════════════════
  buildCellarList() {
    const cellars = DB.getCellars();
    return `
    <div class="page-header">
      <h1>${this.t('cellar.title')}</h1>
      <div class="header-actions">
        <button class="btn btn-primary btn-sm" data-action="add-cellar">${this.t('cellar.addLocation')}</button>
      </div>
    </div>
    <div class="cellar-list">
      ${cellars.length === 0
        ? `<div class="empty-state">${this._iconCellarLg()}<p>${this.t('cellar.noLocations')}</p></div>`
        : cellars.map(c => this._buildCellarCard(c)).join('')}
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
    if (id !== this.cellarDetailId) this._rackZoom = 1.0; // reset zoom when switching cellar
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
          { label: this.t('cellar.removeWine'), cls: 'btn-danger', action: () => {
            Sync.assignWineToSlot(cellarId, slot, null);
            this.closeModal(); this.renderView();
          }},
          { label: this.t('common.edit'), cls: 'btn-secondary', action: () => {
            this.closeModal(); this.editWine(wineId);
          }}
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
    </div>
    ${alerts}`;
  },

  buildCollectionView() {
    let wines = DB.getWines();
    const placementMap = DB.getWinePlacementMap();

    // Filter
    if (this.collectionFilter !== 'all') {
      if      (this.collectionFilter === 'in-cellar')  wines = wines.filter(w => placementMap[w.id]);
      else if (this.collectionFilter === 'not-placed') wines = wines.filter(w => !placementMap[w.id]);
      else if (this.collectionFilter === 'drink-now')  wines = wines.filter(w => this._drinkStatus(w) === 'ready' || this._drinkStatus(w) === 'past');
      else wines = wines.filter(w => w.type === this.collectionFilter);
    }

    // Search
    const q = this.collectionSearch.toLowerCase();
    if (q) wines = wines.filter(w =>
      w.name.toLowerCase().includes(q) ||
      (w.producer||'').toLowerCase().includes(q) ||
      (w.region||'').toLowerCase().includes(q)
    );

    // Sort
    wines = [...wines].sort((a,b) => {
      if (this.collectionSort === 'name') return a.name.localeCompare(b.name);
      if (this.collectionSort === 'vintage') return (b.vintage||0) - (a.vintage||0);
      if (this.collectionSort === 'type') return a.type.localeCompare(b.type);
      return b.addedAt - a.addedAt;
    });

    const totalBottles = DB.getWines().reduce((s, w) => s + (w.quantity||1), 0);
    const typeSummary = [...new Set(DB.getWines().map(w => this.t('types.'+w.type)))].join(', ');

    const filters = [
      { id: 'all',        label: this.t('collection.filterAll') },
      { id: 'red',        label: this.t('types.red') },
      { id: 'white',      label: this.t('types.white') },
      { id: 'rosé',       label: this.t('types.rosé') },
      { id: 'sparkling',  label: this.t('types.sparkling') },
      { id: 'in-cellar',  label: this.t('collection.inCellar') },
      { id: 'drink-now',  label: '🍷 ' + this.t('collection.drinkDue') },
    ];

    return `
    <div class="page-header">
      <h1>${this.t('collection.title')}</h1>
      <div class="header-actions">
        <select class="form-control" style="width:auto;padding:7px 28px 7px 10px;font-size:.82rem"
                onchange="App.collectionSort=this.value;App.renderView()">
          <option value="addedAt"${this.collectionSort==='addedAt'?' selected':''}>${this.t('collection.sortAdded')}</option>
          <option value="name"${this.collectionSort==='name'?' selected':''}>${this.t('collection.sortName')}</option>
          <option value="vintage"${this.collectionSort==='vintage'?' selected':''}>${this.t('collection.sortVintage')}</option>
          <option value="type"${this.collectionSort==='type'?' selected':''}>${this.t('collection.sortType')}</option>
        </select>
        <button class="btn btn-primary btn-sm" data-action="manual-add-wine">${this.t('collection.addWine')}</button>
      </div>
    </div>
    ${DB.getWines().length > 0 ? this._buildCollectionStatsBar(DB.getWines()) : ''}
    <div class="collection-toolbar">
      <div class="search-input-wrap">
        ${this._iconSearch()}
        <input class="search-input" id="coll-search" placeholder="${this.t('collection.search')}"
               value="${this._esc(this.collectionSearch)}"
               oninput="App.collectionSearch=this.value;App._filterCollection()">
      </div>
    </div>
    <div class="filter-strip">
      ${filters.map(f => `
        <button class="filter-chip${this.collectionFilter===f.id?' active':''}"
                onclick="App.collectionFilter='${f.id}';App.renderView()">${f.label}</button>`).join('')}
    </div>
    <div class="wine-grid" id="collection-wine-grid">
      ${wines.length === 0
        ? `<div class="empty-state">${this._iconWineLg()}<p>${this.t('collection.noWines')}</p></div>`
        : wines.map(w => this._buildWineListCard(w, placementMap)).join('')}
    </div>`;
  },

  // Re-render only the wine list (called on search input to preserve focus)
  _filterCollection() {
    const grid = document.getElementById('collection-wine-grid');
    if (!grid) { this.renderView(); return; }
    let wines = DB.getWines();
    const placementMap = DB.getWinePlacementMap();
    if (this.collectionFilter !== 'all') {
      if      (this.collectionFilter === 'in-cellar')  wines = wines.filter(w => placementMap[w.id]);
      else if (this.collectionFilter === 'not-placed') wines = wines.filter(w => !placementMap[w.id]);
      else if (this.collectionFilter === 'drink-now')  wines = wines.filter(w => this._drinkStatus(w) === 'ready' || this._drinkStatus(w) === 'past');
      else wines = wines.filter(w => w.type === this.collectionFilter);
    }
    const q = this.collectionSearch.toLowerCase();
    if (q) wines = wines.filter(w =>
      w.name.toLowerCase().includes(q) ||
      (w.producer||'').toLowerCase().includes(q) ||
      (w.region||'').toLowerCase().includes(q)
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
    return `
    <div class="wine-card" data-action="edit-wine" data-id="${w.id}">
      <div class="wine-card-dot" style="background:${this._typeColor(w.type)}"></div>
      <div class="wine-card-body">
        <div class="wine-card-name">${this._esc(w.name)}</div>
        <div class="wine-card-sub">${[w.producer, w.region, w.country].filter(Boolean).join(' · ')}</div>
        <div class="wine-card-meta">
          <span class="type-badge type-${w.type.replace('é','e')}">${this.t('types.'+w.type)}</span>
          ${w.vintage ? `<span style="font-size:.8rem;color:var(--text-lt)">${w.vintage}</span>` : ''}
          ${(w.quantity||1) > 1 ? `<span class="wine-qty">${w.quantity}×</span>` : ''}
          ${w.rating ? `<span class="stars" style="font-size:.8rem">${'★'.repeat(w.rating)}</span>` : ''}
          ${drinkBadge}
          ${cellarTag ? `<span class="wine-cellar-tag">📍 ${this._esc(cellarTag)}</span>` : ''}
        </div>
      </div>
      <button class="btn btn-icon btn-sm" data-action="delete-wine" data-id="${w.id}"
              style="color:var(--text-lt)">${this._iconTrash()}</button>
    </div>`;
  },

  _buildWineCardInner(w) {
    const imgSrc = w.image     ? `data:image/jpeg;base64,${w.image}`
                 : w.imageUrl  ? w.imageUrl
                 : w.thumbnail ? `data:image/jpeg;base64,${w.thumbnail}` : null;
    return `
    <div style="text-align:left">
      ${imgSrc ? `<img src="${imgSrc}" alt="${this._esc(w.name)}"
        style="width:100%;max-height:220px;object-fit:cover;border-radius:10px;margin-bottom:14px;display:block;">` : ''}
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
    </div>`;
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
        <label class="btn btn-ghost btn-full" style="cursor:pointer;justify-content:center;display:flex;align-items:center">
          ${this.t('settings.importData')}
          <input type="file" accept=".json" id="import-file-input" style="display:none"
                 onchange="App._handleImport(this)">
        </label>
        <button class="btn btn-danger btn-full" data-action="clear-data">${this.t('settings.clearData')}</button>
      </div>
    </div>

    ${this._buildSyncSection()}

    <div class="about-info">
      <div style="font-size:2rem;margin-bottom:8px">🍷</div>
      <strong>Vinage</strong><br>
      ${this.t('settings.version')}<br>
      ${this.t('settings.madeWith')}
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
