/* Traductions FR → EN / 中文, sans build.
   Le français reste la source : la page HTML et les scripts sont écrits en français,
   et chaque texte français sert de clé dans les dictionnaires i18n/en.js et i18n/zh.js.
   - HTML : les « unités » de texte (éléments ne contenant que du texte et des balises
     inline) sont repérées au chargement et remplacées par leur traduction.
   - JS : les textes passent par T("texte français", { variables }).
   Ce script doit être chargé APRÈS les dictionnaires et AVANT main.js / sim.js. */
(function () {
  "use strict";
  const LANGS = ["fr", "en", "zh"];
  const D = (window.BM_I18N = window.BM_I18N || { dicts: {} });
  D.add = D.add || ((l, d) => { D.dicts[l] = Object.assign(D.dicts[l] || {}, d); });

  function pickLang() {
    const q = new URLSearchParams(location.search).get("lang");
    if (LANGS.includes(q)) { try { localStorage.setItem("bm_lang", q); } catch (e) {} return q; }
    try { const s = localStorage.getItem("bm_lang"); if (LANGS.includes(s)) return s; } catch (e) {}
    for (const l of navigator.languages || [navigator.language || "fr"]) {
      const b = String(l).toLowerCase().slice(0, 2);
      if (b === "fr") return "fr";
      if (b === "zh") return "zh";
      if (b === "en") return "en";
    }
    return "fr";
  }
  const lang = pickLang();
  const dict = lang === "fr" ? {} : (D.dicts[lang] || {});
  const missing = new Set();
  const norm = s => s.replace(/\s+/g, " ").trim();

  function T(s, vars) {
    let r = s;
    if (lang !== "fr") {
      const k = norm(s);
      if (Object.prototype.hasOwnProperty.call(dict, k)) r = dict[k];
      else missing.add(k);
    }
    if (vars) r = r.replace(/\{(\w+)\}/g, (m, n) => (n in vars ? vars[n] : m));
    return r;
  }
  /* nom d'un rapport : 1 → « 1re » / « 1st gear » / « 1挡 », R → marche arrière */
  const ORD = {
    fr: g => g === "R" || g === -1 ? "marche arrière" : (+g === 1 ? "1re" : g + "e"),
    en: g => g === "R" || g === -1 ? "reverse" : ({ 1: "1st", 2: "2nd", 3: "3rd" }[g] || g + "th") + " gear",
    zh: g => g === "R" || g === -1 ? "倒挡" : g + "挡"
  };
  const gearName = g => ORD[lang](g);

  /* ---------- Repérage des unités de texte HTML ---------- */
  const INLINE = new Set(["B", "I", "EM", "STRONG", "SUP", "SUB", "SMALL", "BR", "A", "SPAN", "CODE", "KBD", "ABBR", "U", "S", "MARK", "WBR"]);
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
  const HAS_WORD = /[A-Za-zÀ-ÿ]{2}/;
  const ORDINAL = /^\s*\d<sup>e<\/sup>\s*$/; // « 2<sup>e</sup> » seul (une seule lettre)
  const allInline = el => Array.from(el.children).every(c => INLINE.has(c.tagName) && allInline(c));
  function units(root) {
    const out = [];
    (function walk(el) {
      if (SKIP.has(el.tagName) || el.getAttribute("translate") === "no") return;
      if (el instanceof SVGElement) {
        if (el.tagName === "text" && !el.children.length && HAS_WORD.test(el.textContent)) out.push({ el, svg: true });
        else Array.from(el.children).forEach(walk);
        return;
      }
      if (el.hasAttribute("data-i18n")) return;
      if (allInline(el) && (HAS_WORD.test(el.textContent) || ORDINAL.test(el.innerHTML))) { out.push({ el }); return; }
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType === 3 && HAS_WORD.test(n.nodeValue)) out.push({ el: n, text: true });
        else if (n.nodeType === 1) walk(n);
      }
    })(root);
    return out;
  }
  const ATTRS = ["aria-label", "title", "alt", "placeholder"];
  const attrEls = root => Array.from(root.querySelectorAll("[" + ATTRS.join("],[") + "]")).filter(e => !e.closest('[translate="no"]'));
  function keysOf(root) {
    const keys = [];
    for (const u of units(root)) keys.push(norm(u.svg || u.text ? (u.text ? u.el.nodeValue : u.el.textContent) : u.el.innerHTML));
    attrEls(root).forEach(e => ATTRS.forEach(a => { const v = e.getAttribute(a); if (v && HAS_WORD.test(v)) keys.push(norm(v)); }));
    root.querySelectorAll("[data-i18n]").forEach(e => keys.push(norm(e.dataset.i18n)));
    return keys;
  }
  function translateDOM(root) {
    for (const u of units(root)) {
      if (u.text) { const v = u.el.nodeValue, t = T(v); if (t !== norm(v)) u.el.nodeValue = v.replace(/\S[\s\S]*\S|\S/, t); }
      else if (u.svg) u.el.textContent = T(u.el.textContent);
      else { const k = norm(u.el.innerHTML), t = T(k); if (t !== k) u.el.innerHTML = t; }
    }
    attrEls(root).forEach(e => ATTRS.forEach(a => { const v = e.getAttribute(a); if (v && HAS_WORD.test(v)) e.setAttribute(a, T(v)); }));
    // textes trop courts pour être repérés seuls (initiales) : la clé est dans data-i18n
    root.querySelectorAll("[data-i18n]").forEach(e => { e.textContent = T(e.dataset.i18n); });
  }

  /* ---------- Application ---------- */
  const html = document.documentElement;
  html.lang = lang === "zh" ? "zh-CN" : lang;
  if (lang !== "fr") {
    document.title = T(document.title);
    const md = document.querySelector('meta[name="description"]'); if (md) md.content = T(md.content);
    translateDOM(document.body);
  }
  // sélecteurs de langue : <div class="lang-switch"><button data-lang="en">… (recharge la page)
  document.querySelectorAll(".lang-switch [data-lang]").forEach(b => {
    if (b.dataset.lang === lang) b.setAttribute("aria-current", "true");
    b.addEventListener("click", () => {
      try { localStorage.setItem("bm_lang", b.dataset.lang); } catch (e) {}
      const u = new URL(location.href); u.searchParams.delete("lang"); u.hash = "";
      location.replace(u.toString());
    });
  });

  window.T = T;
  window.BM_I18N.lang = lang;
  window.BM_I18N.gearName = gearName;
  window.BM_I18N.missing = missing;
  window.BM_I18N.keysOf = keysOf;
  // outil d'extraction : clé + contexte (section, élément) pour les traducteurs
  window.BM_I18N.contextOf = root => units(root).map(u => {
    const e = u.text ? u.el.parentElement : u.el, sec = e.closest("section[id],header[id],nav[id],footer,[id]");
    return [norm(u.text ? u.el.nodeValue : u.svg ? u.el.textContent : u.el.innerHTML), `#${sec ? sec.id || sec.tagName.toLowerCase() : ""} <${e.tagName.toLowerCase()}${e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : ""}${e.id ? "#" + e.id : ""}>`];
  });
  if (lang !== "fr") setTimeout(() => { if (missing.size) console.warn("[i18n] " + missing.size + " textes sans traduction", Array.from(missing)); }, 3000);
})();
