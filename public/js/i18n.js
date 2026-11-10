/**
 * Kul-Kirti i18n Engine
 * ----------------------
 * Centralised translation system for the Hindi-first bilingual website.
 *
 * Public API (all attached to window.I18n):
 *   I18n.t(key, vars)        – translate a dot-separated key with optional interpolation
 *   I18n.lang                – current language code ("hi" | "en")
 *   I18n.init()              – load saved preference and apply translations
 *   I18n.setLanguage(lang)   – switch language, persist, and re-apply
 *   I18n.applyAll()          – re-translate every data-i18n* element in the DOM
 *
 * data-i18n attributes understood:
 *   data-i18n="key"            → sets element.textContent
 *   data-i18n-html="key"       → sets element.innerHTML  (for entries with <br> etc.)
 *   data-i18n-placeholder="key"→ sets input placeholder
 *   data-i18n-aria-label="key" → sets aria-label
 *   data-i18n-title="key"      → sets title attribute
 */

(function (window) {
  "use strict";

  const STORAGE_KEY = "kulkirti-language";
  const SUPPORTED   = ["hi", "en"];
  const DEFAULT     = "hi";

  /* ── internal state ─────────────────────────────────────────────── */
  const _store = { hi: null, en: null };
  let _lang    = DEFAULT;

  /* ── helpers ─────────────────────────────────────────────────────── */

  /** Resolve a dot-separated key inside a nested object. */
  function _get(obj, key) {
    return key.split(".").reduce(
      (node, part) => (node && node[part] !== undefined ? node[part] : undefined),
      obj
    );
  }

  /**
   * Interpolate {placeholder} tokens.
   * t("search.resultSummary", { count: 5 })  →  "5 records found · …"
   */
  function _interpolate(str, vars) {
    if (!vars || typeof str !== "string") return str;
    return str.replace(/\{(\w+)\}/g, (_, k) =>
      vars[k] !== undefined ? vars[k] : `{${k}}`
    );
  }

  /* ── public translate ────────────────────────────────────────────── */

  /**
   * Translate a key.
   * Falls back to the other language if the key is missing in the current one.
   * Falls back to the key itself if neither language has it.
   */
  function t(key, vars) {
    const dict   = _store[_lang];
    const fallback = _store[_lang === "hi" ? "en" : "hi"];

    let val = dict  ? _get(dict,  key) : undefined;
    if (val === undefined) val = fallback ? _get(fallback, key) : undefined;
    if (val === undefined) {
      // last-resort: return a human-readable version of the key
      const leaf = key.split(".").pop();
      return leaf;
    }
    return _interpolate(String(val), vars);
  }

  /* ── DOM application ─────────────────────────────────────────────── */

  function _applyElement(el) {
    const k     = el.getAttribute("data-i18n");
    const kHtml = el.getAttribute("data-i18n-html");
    const kPh   = el.getAttribute("data-i18n-placeholder");
    const kAria = el.getAttribute("data-i18n-aria-label");
    const kTitle= el.getAttribute("data-i18n-title");

    if (k)     el.textContent = t(k);
    if (kHtml) el.innerHTML   = t(kHtml);
    if (kPh)   el.setAttribute("placeholder", t(kPh));
    if (kAria) el.setAttribute("aria-label", t(kAria));
    if (kTitle)el.setAttribute("title", t(kTitle));
  }

  /** Walk every annotated element and re-translate it. */
  function applyAll() {
    document.querySelectorAll(
      "[data-i18n],[data-i18n-html],[data-i18n-placeholder],[data-i18n-aria-label],[data-i18n-title]"
    ).forEach(_applyElement);

    /* update <html lang="…"> */
    document.documentElement.lang = _lang;

    /* update page <title> and <meta description> from meta.{page} */
    _applyPageMeta();

    /* update hreflang canonical tags */
    _applyHreflang();

    /* update language-switcher button */
    _applyLangSwitcher();
  }

  /* ── page-level meta ─────────────────────────────────────────────── */

  function _pageKey() {
    const path = window.location.pathname.replace(/\/$/, "");
    if (!path || path === "")          return "index";
    if (path.endsWith("history.html")) return "history";
    if (path.endsWith("search.html"))  return "search";
    if (path.endsWith("submit.html"))  return "submit";
    if (path.endsWith("vanshawali.html")) return "vanshawali";
    if (path.endsWith("samiti.html"))  return "samiti";
    if (path.endsWith("admin.html"))   return "admin";
    return "index";
  }

  function _applyPageMeta() {
    const pk   = _pageKey();
    const dict = _store[_lang];
    if (!dict || !dict.meta) return;

    const meta = dict.meta[pk];
    if (!meta)  return;

    /* title */
    if (meta.title) document.title = meta.title;

    /* <meta name="description"> */
    let descEl = document.querySelector('meta[name="description"]');
    if (!descEl) {
      descEl = document.createElement("meta");
      descEl.setAttribute("name", "description");
      document.head.appendChild(descEl);
    }
    if (meta.description) descEl.setAttribute("content", meta.description);

    /* Open Graph */
    _setMeta("property", "og:title",       meta.title       || "");
    _setMeta("property", "og:description", meta.description || "");
    _setMeta("property", "og:locale",      _lang === "hi" ? "hi_IN" : "en_IN");
    _setMeta("property", "og:locale:alternate", _lang === "hi" ? "en_IN" : "hi_IN");

    /* canonical */
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    canonical.setAttribute("href", window.location.href.split("?")[0]);
  }

  function _setMeta(attrName, attrVal, content) {
    let el = document.querySelector(`meta[${attrName}="${attrVal}"]`);
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(attrName, attrVal);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  }

  /* ── hreflang ────────────────────────────────────────────────────── */

  function _applyHreflang() {
    const base = window.location.origin;
    const path = window.location.pathname;

    /* remove old hreflang links to avoid duplication */
    document.querySelectorAll('link[rel="alternate"][hreflang]').forEach(el => el.remove());

    const makeLink = (hreflang, href) => {
      const link = document.createElement("link");
      link.setAttribute("rel", "alternate");
      link.setAttribute("hreflang", hreflang);
      link.setAttribute("href", href);
      document.head.appendChild(link);
    };

    makeLink("hi",        `${base}${path}?lang=hi`);
    makeLink("en",        `${base}${path}?lang=en`);
    makeLink("x-default", `${base}${path}`);
  }

  /* ── language switcher UI ────────────────────────────────────────── */

  function _applyLangSwitcher() {
    const isHi = _lang === "hi";
    document.querySelectorAll(".language-switch").forEach(btn => {
      btn.innerHTML =
        `<span>${isHi ? "अ" : "A"}</span> ${t("langSwitch.label")} <i>⌄</i>`;
      btn.setAttribute("aria-label", t("langSwitch.ariaSwitch"));
      btn.setAttribute("lang", isHi ? "en" : "hi"); // label is in the OTHER language
    });
  }

  /* ── loading dictionaries ────────────────────────────────────────── */

  /**
   * Load a locale JSON file.
   * First tries /locales/{lang}.json (server), then falls back to
   * a bundled inline copy (set by app.js for offline / cached use).
   */
  async function _loadDict(lang) {
    if (_store[lang]) return; // already loaded
    try {
      const res = await fetch(`/locales/${lang}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      _store[lang] = await res.json();
    } catch (err) {
      console.warn(`[i18n] Could not load /locales/${lang}.json — ${err.message}`);
      /* _store[lang] remains null; t() will fall back gracefully */
    }
  }

  /* ── setLanguage ─────────────────────────────────────────────────── */

  async function setLanguage(lang) {
    if (!SUPPORTED.includes(lang)) lang = DEFAULT;
    _lang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    await _loadDict(lang);
    applyAll();
    /* dispatch custom event so other scripts can react */
    document.dispatchEvent(new CustomEvent("languagechange", { detail: { lang } }));
  }

  /* ── init ────────────────────────────────────────────────────────── */

  /**
   * Call once at page load.
   * Priority: URL ?lang= param → localStorage → "hi" default.
   */
  async function init() {
    /* 1. URL param (lets hreflang links work) */
    const urlParam = new URLSearchParams(window.location.search).get("lang");
    let preferred  = SUPPORTED.includes(urlParam) ? urlParam : null;

    /* 2. localStorage */
    if (!preferred) {
      const saved = localStorage.getItem(STORAGE_KEY);
      preferred   = SUPPORTED.includes(saved) ? saved : null;
    }

    /* 3. default */
    if (!preferred) preferred = DEFAULT;

    /* pre-load both dicts in parallel for snappier switching */
    await Promise.all([_loadDict("hi"), _loadDict("en")]);

    _lang = preferred;
    localStorage.setItem(STORAGE_KEY, preferred);
    applyAll();
    document.dispatchEvent(new CustomEvent("languagechange", { detail: { lang: preferred } }));
  }

  /* ── expose public API ───────────────────────────────────────────── */

  window.I18n = {
    get lang()      { return _lang; },
    t,
    init,
    setLanguage,
    applyAll,
  };

}(window));
