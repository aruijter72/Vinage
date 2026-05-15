// ── Vinage Marketing Site — Shared JS ───────────────────────────────────────
// Language, theme, nav behaviour shared across all marketing pages.

// ── Translations ─────────────────────────────────────────────────────────────
const T = {
  nl: {
    nav: { features:'Functies', pricing:'Abonnementen', about:'Over ons', blog:'Blog', openApp:'Open app' },
    footer: {
      tagline: 'Jouw digitale wijnkelder',
      links: { privacy:'Privacybeleid', terms:'Gebruiksvoorwaarden', app:'Open app' },
      copy: '© 2025 Vinage. Alle rechten voorbehouden.',
    },
  },
  en: {
    nav: { features:'Features', pricing:'Pricing', about:'About', blog:'Blog', openApp:'Open app' },
    footer: {
      tagline: 'Your digital wine cellar',
      links: { privacy:'Privacy Policy', terms:'Terms of Service', app:'Open app' },
      copy: '© 2025 Vinage. All rights reserved.',
    },
  },
  de: {
    nav: { features:'Funktionen', pricing:'Preise', about:'Über uns', blog:'Blog', openApp:'App öffnen' },
    footer: {
      tagline: 'Ihr digitaler Weinkeller',
      links: { privacy:'Datenschutz', terms:'Nutzungsbedingungen', app:'App öffnen' },
      copy: '© 2025 Vinage. Alle Rechte vorbehalten.',
    },
  },
  fr: {
    nav: { features:'Fonctions', pricing:'Tarifs', about:'À propos', blog:'Blog', openApp:"Ouvrir l'app" },
    footer: {
      tagline: 'Votre cave à vin numérique',
      links: { privacy:'Confidentialité', terms:"Conditions d'utilisation", app:"Ouvrir l'app" },
      copy: '© 2025 Vinage. Tous droits réservés.',
    },
  },
  es: {
    nav: { features:'Funciones', pricing:'Precios', about:'Nosotros', blog:'Blog', openApp:'Abrir app' },
    footer: {
      tagline: 'Tu bodega digital',
      links: { privacy:'Privacidad', terms:'Términos de uso', app:'Abrir app' },
      copy: '© 2025 Vinage. Todos los derechos reservados.',
    },
  },
  it: {
    nav: { features:'Funzioni', pricing:'Prezzi', about:'Chi siamo', blog:'Blog', openApp:"Apri l'app" },
    footer: {
      tagline: 'La tua cantina digitale',
      links: { privacy:'Privacy', terms:"Termini d'uso", app:"Apri l'app" },
      copy: '© 2025 Vinage. Tutti i diritti riservati.',
    },
  },
};

// ── State ─────────────────────────────────────────────────────────────────────
let LANG  = localStorage.getItem('vinage_site_lang')  || navigator.language?.slice(0,2) || 'nl';
let THEME = localStorage.getItem('vinage_site_theme') || 'light';
const SUPPORTED = ['nl','en','de','fr','es','it'];
if (!SUPPORTED.includes(LANG)) LANG = 'nl';

// ── Helpers ───────────────────────────────────────────────────────────────────
function t(path) {
  const parts = path.split('.');
  let obj = T[LANG];
  for (const p of parts) { obj = obj?.[p]; }
  return obj || path;
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', THEME);
  const btn = document.getElementById('themeBtn');
  if (btn) btn.textContent = THEME === 'dark' ? '☀️' : '🌙';
}

function applyLang() {
  // Update nav
  const el = id => document.getElementById(id);
  setText('nav-features', t('nav.features'));
  setText('nav-pricing',  t('nav.pricing'));
  setText('nav-about',    t('nav.about'));
  setText('nav-blog',     t('nav.blog'));
  setAll('.nav-app-btn', t('nav.openApp'));
  // Update footer
  setText('footer-tagline', t('footer.tagline'));
  setText('footer-privacy', t('footer.links.privacy'));
  setText('footer-terms',   t('footer.links.terms'));
  setText('footer-app',     t('footer.links.app'));
  setText('footer-copy',    t('footer.copy'));
  // Update lang pills active state
  document.querySelectorAll('.lang-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === LANG);
  });
  // Page-specific translations
  if (typeof applyPageLang === 'function') applyPageLang(LANG);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el && text) el.textContent = text;
}
function setAll(sel, text) {
  document.querySelectorAll(sel).forEach(el => { if (text) el.textContent = text; });
}

function setLang(lang) {
  if (!SUPPORTED.includes(lang)) return;
  LANG = lang;
  localStorage.setItem('vinage_site_lang', lang);
  applyLang();
}

function toggleTheme() {
  THEME = THEME === 'light' ? 'dark' : 'light';
  localStorage.setItem('vinage_site_theme', THEME);
  applyTheme();
}

// ── Mobile menu ───────────────────────────────────────────────────────────────
function toggleMobileMenu() {
  const menu = document.getElementById('mobileMenu');
  if (menu) menu.classList.toggle('open');
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  applyLang();

  // Highlight active nav link
  const path = location.pathname.replace(/\/$/, '') || '/';
  document.querySelectorAll('.nav-links a').forEach(a => {
    const href = a.getAttribute('href')?.replace(/\/$/, '') || '';
    if (href === path || (path === '' && href === '/')) {
      a.classList.add('active');
    }
  });
});
