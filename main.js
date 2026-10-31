/* Boîte manuelle — interactions générales (sans dépendance) */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const store = {
    get(k, d) { try { const v = localStorage.getItem("bm_" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("bm_" + k, JSON.stringify(v)); } catch (e) {} }
  };
  window.BM = { $, $$, clamp, store };

  /* ---------- Audio moteur (Web Audio, synthèse) ---------- */
  const Engine = {
    ctx: null, on: false,
    ensure() {
      if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return true; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.gain.value = 0;
      this.filter = c.createBiquadFilter(); this.filter.type = "lowpass"; this.filter.Q.value = 3;
      this.o1 = c.createOscillator(); this.o1.type = "sawtooth";
      this.o2 = c.createOscillator(); this.o2.type = "square";
      this.g2 = c.createGain(); this.g2.gain.value = .35;
      this.am = c.createGain(); this.am.gain.value = 1;
      this.lfo = c.createOscillator(); this.lfo.type = "sine";
      this.lfoG = c.createGain(); this.lfoG.gain.value = 0;
      this.lfo.connect(this.lfoG); this.lfoG.connect(this.am.gain);
      this.o1.connect(this.am); this.o2.connect(this.g2); this.g2.connect(this.am);
      this.am.connect(this.filter); this.filter.connect(this.master); this.master.connect(c.destination);
      this.o1.start(); this.o2.start(); this.lfo.start();
      return true;
    },
    set(rpm, load, vol) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime, f = Math.max(rpm, 1) / 60 * 2; // 4 cylindres : 2 explosions / tour
      this.o1.frequency.setTargetAtTime(f, t, .03);
      this.o2.frequency.setTargetAtTime(f / 2, t, .03);
      this.filter.frequency.setTargetAtTime(250 + rpm * .22 + load * 900, t, .05);
      // broutement sous ~1300 tr/min
      const rough = rpm > 200 && rpm < 1300 ? (1300 - rpm) / 1300 : 0;
      this.lfo.frequency.setTargetAtTime(f / 4, t, .05);
      this.lfoG.gain.setTargetAtTime(rough * .9, t, .05);
      this.master.gain.setTargetAtTime(vol, t, .06);
    },
    silence() { if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, .08); }
  };
  window.BMEngine = Engine;

  /* ---------- Compte-tours SVG réutilisable ---------- */
  const TMAX = 7000, CX = 110, CY = 120, R = 90;
  function pt(rpm, r = R) { const a = Math.PI - rpm / TMAX * Math.PI; return [CX + r * Math.cos(a), CY - r * Math.sin(a)]; }
  function arc(a, b) { const p = pt(a), q = pt(b); return `M${p[0].toFixed(1)} ${p[1].toFixed(1)} A${R} ${R} 0 0 1 ${q[0].toFixed(1)} ${q[1].toFixed(1)}`; }
  function buildTacho(svg) {
    $(".t-low", svg).setAttribute("d", arc(0, 1400));
    $(".t-good", svg).setAttribute("d", arc(1500, 3600));
    $(".t-red", svg).setAttribute("d", arc(6000, 7000));
    const g = $(".t-ticks", svg); let h = "";
    for (let k = 0; k <= 7; k++) {
      const a = pt(k * 1000, R - 12), b = pt(k * 1000, R - 20), t = pt(k * 1000, R - 32);
      h += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/><text x="${t[0]}" y="${t[1] + 4}">${k}</text>`;
    }
    g.innerHTML = h;
  }
  function setTacho(svg, rpm) {
    const deg = clamp(rpm, 0, TMAX) / TMAX * 180 - 90;
    $(".t-needle", svg).style.transform = `rotate(${deg}deg)`;
  }
  window.BMTacho = { build: buildTacho, set: setTacho };
  $$(".tacho").forEach(buildTacho);

  /* ---------- Rapports de boîte (approximatifs, citadine type Agila) ---------- */
  const RATIOS = { 1: 3.545, 2: 1.904, 3: 1.31, 4: .969, 5: .815, "-1": -3.272 };
  const FINAL = 4.235, WHEEL_R = .29;
  window.BMGear = { RATIOS, FINAL, WHEEL_R };
  const rpmFor = (kmh, g) => kmh / 3.6 / (2 * Math.PI * WHEEL_R) * 60 * RATIOS[g] * FINAL;

  /* ---------- Barre de progression + chapitres ---------- */
  const bar = $("#progressBar"), nav = $("#chapters"), hero = $(".hero");
  const chapters = $$(".chapter");
  const done = new Set(store.get("done", []));
  const markDone = () => $$("a", nav).forEach(a => a.classList.toggle("done", done.has(a.dataset.ch)));
  markDone();
  let ticking = false;
  function onScroll() {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const h = document.documentElement, max = h.scrollHeight - innerHeight;
      bar.style.width = (max > 0 ? h.scrollTop / max * 100 : 0) + "%";
      nav.classList.toggle("show", hero.getBoundingClientRect().bottom < 60);
      let cur = null;
      chapters.forEach(c => {
        const r = c.getBoundingClientRect();
        if (r.top < innerHeight * .4) cur = c.id;
        if (r.bottom < innerHeight * .6 && !done.has(c.id)) { done.add(c.id); store.set("done", [...done]); markDone(); }
      });
      $$("a", nav).forEach(a => {
        const on = a.dataset.ch === cur;
        if (on && !a.classList.contains("active")) a.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
        a.classList.toggle("active", on);
      });
    });
  }
  addEventListener("scroll", onScroll, { passive: true }); onScroll();

  /* ---------- Apparition au scroll ---------- */
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }), { threshold: .12, rootMargin: "0px 0px -6% 0px" });
  $$(".reveal").forEach(el => io.observe(el));
  io.observe($("#bands"));

  /* ---------- Sliders : remplissage ---------- */
  function fillRange(r) { r.style.setProperty("--p", ((r.value - r.min) / (r.max - r.min) * 100) + "%"); }
  $$("input[type=range]").forEach(r => { fillRange(r); r.addEventListener("input", () => fillRange(r)); });

  /* ---------- Héro : le levier qui passe les vitesses ---------- */
  (function heroKnob() {
    const k = $(".hg-knob"); if (!k) return;
    const P = { N: [130, 100], 1: [50, 30], 2: [50, 170], 3: [130, 30], 4: [130, 170], 5: [210, 30] };
    const route = [["N"], [50, 100], ["1"], [50, 100], ["2"], [50, 100], ["N"], ["3"], ["N"], ["4"], ["N"], [210, 100], ["5"], [210, 100], ["N"]];
    const pts = route.map(r => r.length === 1 ? { p: P[r[0]], stop: r[0] !== "N" } : { p: r, stop: false });
    let i = 0, t0 = performance.now(), from = pts[0].p;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    function step(now) {
      const tgt = pts[(i + 1) % pts.length], dur = 260, hold = tgt.stop ? 520 : 40;
      let u = (now - t0) / dur;
      if (u >= 1 + hold / dur) { i = (i + 1) % pts.length; from = tgt.p; t0 = now; u = 0; }
      const e = u >= 1 ? 1 : (u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
      const x = from[0] + (tgt.p[0] - from[0]) * e, y = from[1] + (tgt.p[1] - from[1]) * e;
      k.setAttribute("cx", x); k.setAttribute("cy", y);
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  })();

  /* ---------- Chapitre 1 : labo régime ---------- */
  (function lab() {
    const svg = $("#labTacho"), sp = $("#labSpeed"), msg = $("#labMsg"), val = $("#labRpmVal"), spv = $("#labSpeedVal");
    let g = 2;
    const ev = document.createElement("p"); ev.className = "small muted center"; msg.after(ev);
    function upd() {
      const kmh = +sp.value; spv.textContent = kmh;
      let rpm = kmh === 0 ? 800 : rpmFor(kmh, g), cls, t;
      if (kmh > 0 && rpm < 800) rpm = rpm; // affiché tel quel : sous le ralenti, il cale
      if (kmh === 0) { cls = "zero"; t = "À l'arrêt, les roues ne tournent pas, mais le moteur tourne au ralenti (~800 tr/min). Il faut débrayer, sinon il cale."; }
      else if (rpm < 1000) { cls = "low"; t = "Bien trop bas : le moteur broute et va caler. Descends une vitesse."; }
      else if (rpm < 1500) { cls = "low"; t = "Un peu bas : ça passe sur le plat, mais le moteur manque de force."; }
      else if (rpm <= 3600) { cls = "good"; t = "Parfait, le moteur est à l'aise."; }
      else if (rpm <= 5000) { cls = "high"; t = "Ça monte haut : il est temps de passer la vitesse supérieure."; }
      else if (rpm <= 6200) { cls = "high"; t = "Le moteur hurle ! Passe vite la vitesse supérieure."; }
      else { cls = "high"; t = "Zone rouge : le moteur ne peut pas tourner aussi vite. Impossible dans cette vitesse."; }
      msg.className = "lab-msg " + cls; msg.textContent = t;
      val.textContent = Math.round(Math.min(rpm, 7500) / 50) * 50;
      setTacho(svg, rpm);
      ev.textContent = kmh === 0 ? "Ton électrique, elle, est simplement à 0 tr/min, et ça ne la gêne pas."
        : `Ton électrique à ${kmh} km/h : une seule vitesse, ~${(Math.round(kmh * 85 / 100) * 100).toLocaleString("fr-FR")} tr/min, et tout va bien.`;
    }
    $$("#labGears button").forEach(b => b.addEventListener("click", () => {
      g = +b.dataset.g; $$("#labGears button").forEach(x => x.classList.toggle("on", x === b)); upd();
    }));
    sp.addEventListener("input", upd); upd();
  })();

  /* ---------- Chapitre 2 : disques d'embrayage ---------- */
  (function clutch() {
    const range = $("#clutchRange"), state = $("#clutchState");
    const discB = $("#discB"), shaftB = $("#shaftB"), wheel = $("#wheel"), fan = $("#engineFan");
    const sparks = $$("#sparks circle");
    const spokesA = $$("#discA .c-spokes line"), spokesB = $$("#discB .c-spokes line");
    let phA = 0, phB = 0, ang = 0, wAng = 0, last = performance.now(), visible = false, lastState = "";
    new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) { last = performance.now(); requestAnimationFrame(frame); } }).observe($("#clutchSvg"));
    function eng(v) { return v < 38 ? 0 : v > 68 ? 1 : (v - 38) / 30; }
    function spokes(lines, ph) {
      lines.forEach((l, k) => {
        let y = ((ph + k * 52) % 104) - 52; // défilement = rotation vue de profil
        l.setAttribute("y1", y); l.setAttribute("y2", y + 8);
        l.style.opacity = 1 - Math.abs(y) / 60;
      });
    }
    function frame(now) {
      if (!visible) return;
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      const v = +range.value, e = eng(v);
      const x = 150 - 16 * Math.min(1, v / 38);
      discB.setAttribute("transform", `translate(${x} 95)`);
      shaftB.setAttribute("x", x + 8); shaftB.setAttribute("width", 238 - (x + 8));
      const engineSpeed = 1 - .18 * (e > 0 && e < 1 ? Math.sin(e * Math.PI) : 0); // le moteur « baisse » un peu au patinage
      const wheelSpeed = engineSpeed * Math.pow(e, 1.4);
      phA += dt * 260 * engineSpeed; phB += dt * 260 * wheelSpeed;
      ang += dt * 720 * engineSpeed; wAng += dt * 300 * wheelSpeed;
      spokes(spokesA, phA); spokes(spokesB, phB);
      fan.setAttribute("transform", `translate(41 74) rotate(${ang % 360})`);
      wheel.setAttribute("transform", `translate(272 95) rotate(${wAng % 360})`);
      const slipping = e > 0 && e < 1;
      sparks.forEach((s, k) => {
        if (slipping && Math.random() < .5) {
          s.setAttribute("cx", 126 + (Math.random() - .5) * 10);
          s.setAttribute("cy", 95 + (Math.random() - .5) * 110);
          s.style.opacity = .4 + Math.random() * .6;
        } else s.style.opacity = slipping ? .2 : 0;
      });
      const st = e === 0 ? "off" : e < 1 ? "bite" : "on";
      if (st !== lastState) {
        lastState = st; state.className = "clutch-state " + (st === "off" ? "" : st);
        state.innerHTML = st === "off" ? "<b>Pédale enfoncée</b><span>Les disques sont écartés. Le moteur tourne seul, les roues ne bougent pas.</span>"
          : st === "bite" ? "<b>Point de patinage</b><span>Les disques se frottent. Les roues commencent à tourner, le moteur ralentit un peu. C'est la zone où il faut être douce.</span>"
          : "<b>Pédale relâchée</b><span>Les disques sont collés : moteur et roues tournent ensemble.</span>";
      }
      requestAnimationFrame(frame);
    }
  })();

  /* ---------- Chapitre 3 : pédales ---------- */
  (function pedals() {
    const info = $("#pedalInfo");
    const T = {
      e: "<b>Embrayage, au pied gauche.</b> Il sépare le moteur des roues. On l'enfonce à fond pour démarrer le moteur, changer de vitesse et s'arrêter. On le relâche doucement pour partir.",
      f: "<b>Frein, au pied droit, comme avant.</b> Un détail : sans régénération, il sert plus souvent qu'en électrique.",
      a: "<b>Accélérateur, au pied droit, comme avant.</b> Mais ici, on le lâche à chaque changement de vitesse."
    };
    $$("#pedalboard .pedal").forEach(p => p.addEventListener("click", () => {
      $$("#pedalboard .pedal").forEach(x => x.classList.toggle("on", x === p && !p.classList.contains("on")));
      info.innerHTML = T[p.dataset.p];
    }));
  })();

  /* ---------- Chapitre 4 : grille ---------- */
  (function grid() {
    const knob = $("#gbKnob"), txt = $("#gbKnobTxt"), info = $("#gearInfo"), chBtn = $("#gbChallenge"), chTxt = $("#gbChallengeTxt");
    const POS = { N: [150, 125], 1: [60, 40], 2: [60, 210], 3: [150, 40], 4: [150, 210], 5: [240, 40], R: [240, 210] };
    const INFO = {
      N: ["Point mort (N)", "Aucune vitesse engagée : le levier se balance librement de gauche à droite. Le moteur tourne, la voiture n'avance pas."],
      1: ["1re : pour démarrer", "La plus forte et la plus lente. On la quitte assez vite, vers 10 à 15 km/h."],
      2: ["2e", "Juste après le démarrage : tire le levier tout droit vers le bas, depuis la 1re."],
      3: ["3e : la ville", "Entre 30 et 50 km/h. Le levier repasse par le milieu, puis monte."],
      4: ["4e", "De 50 à 70 km/h : grands boulevards, routes."],
      5: ["5e : la croisière", "Route et voie rapide, à partir d'environ 70 km/h."],
      R: ["Marche arrière (R)", "Seulement voiture arrêtée ! Embrayage à fond, attendre 3 secondes (conseil du manuel de l'Agila), puis engager. Recule au point de patinage, presque sans accélérer."]
    };
    let cur = "N", anim = null, target = null, streak = 0;
    function move(to) {
      if (anim) cancelAnimationFrame(anim);
      const a = POS[cur], b = POS[to];
      const path = [a, [a[0], 125], [b[0], 125], b].filter((p, i, arr) => i === 0 || p[0] !== arr[i - 1][0] || p[1] !== arr[i - 1][1]);
      let seg = 0, t0 = performance.now();
      txt.textContent = "";
      function f(now) {
        const p = path[seg], q = path[seg + 1];
        if (!q) { knob.setAttribute("transform", `translate(${b[0]} ${b[1]})`); txt.textContent = to; return; }
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]), dur = Math.max(90, len * 1.6);
        let u = Math.min(1, (now - t0) / dur); const e = 1 - Math.pow(1 - u, 3);
        knob.setAttribute("transform", `translate(${p[0] + (q[0] - p[0]) * e} ${p[1] + (q[1] - p[1]) * e})`);
        if (u >= 1) { seg++; t0 = now; }
        anim = requestAnimationFrame(f);
      }
      anim = requestAnimationFrame(f);
      cur = to;
      info.innerHTML = `<b>${INFO[to][0]}</b><span>${INFO[to][1]}</span>`;
    }
    function ask() {
      const opts = ["1", "2", "3", "4", "5", "R"].filter(g => g !== target);
      target = opts[Math.floor(Math.random() * opts.length)];
      chTxt.textContent = `Où est la ${target === "R" ? "marche arrière" : target === "1" ? "1re" : target + "e"} ? (${streak}/5)`;
    }
    $$(".gb-targets g").forEach(g => g.addEventListener("click", () => {
      const to = g.dataset.g;
      if (target && to !== "N") {
        const ok = to === target, c = $(`.gb-targets g[data-g="${to}"]`);
        c.classList.add(ok ? "hit" : "miss"); setTimeout(() => c.classList.remove("hit", "miss"), 500);
        if (ok) {
          streak++; move(to);
          if (streak >= 5) { chTxt.textContent = "🎉 Bravo, tu connais la grille par cœur !"; target = null; chBtn.textContent = "🎯 Rejouer le défi"; store.set("grid", 1); return; }
          setTimeout(ask, 450);
        } else { streak = 0; chTxt.textContent = `Raté ! Ça, c'est la ${to === "R" ? "marche arrière" : to === "1" ? "1re" : to + "e"}. Où est la ${target === "R" ? "marche arrière" : target === "1" ? "1re" : target + "e"} ? (0/5)`; }
        return;
      }
      move(to);
    }));
    chBtn.addEventListener("click", () => { streak = 0; target = null; move("N"); ask(); });
  })();

  /* ---------- Chapitre 6 : écouter le moteur ---------- */
  (function listen() {
    let timer = null, raf = null;
    $$(".listen-btn").forEach(b => b.addEventListener("click", () => {
      if (!Engine.ensure()) { b.querySelector("small").textContent = "son non disponible"; return; }
      $$(".listen-btn").forEach(x => x.classList.remove("playing")); b.classList.add("playing");
      clearTimeout(timer); cancelAnimationFrame(raf);
      const base = +b.dataset.rpm, t0 = performance.now();
      (function f(now) {
        const t = (now - t0) / 1000;
        const wob = b.dataset.kind === "low" ? Math.sin(t * 19) * 60 : Math.sin(t * 3) * 40;
        Engine.set(base + wob, b.dataset.kind === "high" ? .9 : .4, .22);
        raf = requestAnimationFrame(f);
      })(t0);
      timer = setTimeout(() => { cancelAnimationFrame(raf); Engine.silence(); b.classList.remove("playing"); window.dispatchEvent(new Event("bm-listen-end")); }, 2200);
    }));
  })();

  /* ---------- Chapitre 7 : pas à pas ---------- */
  (function howto() {
    // e/f/a : 0 relâchée, 1 à moitié, 2 à fond, "b" point de patinage
    const S = {
      "Démarrer le moteur": [
        { e: 2, f: 2, g: "N", hb: 1, t: "Pied gauche : embrayage à fond. Pied droit : frein.", w: "Sur l'Agila, on enfonce l'embrayage pour démarrer. Le frein, c'est par sécurité." },
        { e: 2, f: 2, g: "N", hb: 1, t: "Vérifie le point mort : le levier doit se balancer librement de gauche à droite.", w: "Si une vitesse est engagée, la voiture pourrait faire un bond en avant." },
        { e: 2, f: 2, g: "N", hb: 1, t: "Tourne la clé : le moteur démarre. Lâche la clé dès qu'il tourne.", w: "" },
        { e: 0, f: 2, g: "N", hb: 1, t: "Au point mort, tu peux relâcher l'embrayage : la voiture ne bouge pas.", w: "Le moteur tourne au ralenti, autour de 800 tr/min." }
      ],
      "Partir": [
        { e: 2, f: 2, g: "N", hb: 1, t: "Moteur allumé : embrayage à fond, pied droit sur le frein.", w: "" },
        { e: 2, f: 2, g: "1", hb: 1, t: "Passe la 1re : en haut à gauche.", w: "Main ouverte, sans forcer." },
        { e: 2, f: 2, g: "1", hb: 0, t: "Desserre le frein à main, en gardant le pied sur le frein.", w: "Regarde dans tes rétros et mets ton clignotant." },
        { e: "b", f: 0, a: 0, g: "1", hb: 0, t: "Pied droit vers l'accélérateur. Remonte l'embrayage doucement jusqu'au point de patinage.", w: "Tu le sens : le moteur baisse un peu de régime et la voiture veut avancer." },
        { e: "b", a: 1, g: "1", hb: 0, t: "Accélère un tout petit peu et continue de relâcher l'embrayage lentement.", w: "Comme une balance : le pied gauche remonte pendant que le pied droit descend." },
        { e: 0, a: 1, g: "1", hb: 0, t: "La voiture roule : retire complètement le pied gauche. Tu es partie ! 🎉", w: "" }
      ],
      "Monter une vitesse": [
        { e: 0, a: 1, g: "1", hb: 0, t: "Vers 2 500 tr/min, ou quand le moteur commence à forcer, on change.", w: "" },
        { e: 2, a: 0, g: "1", hb: 0, t: "En même temps : lâche l'accélérateur et enfonce l'embrayage à fond.", w: "" },
        { e: 2, a: 0, g: "2", hb: 0, t: "Passe la 2e : tire le levier tout droit vers le bas.", w: "Sans forcer et sans te presser : la voiture continue de rouler." },
        { e: "b", a: 1, g: "2", hb: 0, t: "Relâche l'embrayage en ré-accélérant doucement.", w: "Plus vite qu'au démarrage : la voiture roule déjà, le patinage passe vite." },
        { e: 0, a: 1, g: "2", hb: 0, t: "Pied gauche au repos. Même principe pour la 3e, la 4e et la 5e.", w: "" }
      ],
      "S'arrêter": [
        { e: 0, a: 0, g: "3", hb: 0, t: "Lâche l'accélérateur : le frein moteur ralentit doucement la voiture.", w: "C'est une sorte de régénération légère." },
        { e: 0, f: 1, g: "3", hb: 0, t: "Freine normalement.", w: "" },
        { e: 2, f: 1, g: "3", hb: 0, t: "Vers 15-20 km/h, ou dès que le moteur vibre : embrayage à fond.", w: "Sinon les roues ralentissent le moteur jusqu'à le faire caler." },
        { e: 2, f: 2, g: "N", hb: 0, t: "Une fois arrêtée : point mort.", w: "Pas besoin de repasser toutes les vitesses en ralentissant : de la 3e, on s'arrête, puis on repart en 1re." },
        { e: 0, f: 2, g: "N", hb: 0, t: "Relâche l'embrayage. Garde le pied sur le frein, ou serre le frein à main si l'arrêt dure.", w: "" }
      ],
      "En côte": [
        { e: 2, f: 2, g: "1", hb: 1, t: "Arrêtée en montée : frein à main serré, embrayage à fond, 1re engagée.", w: "" },
        { e: 2, a: 1, g: "1", hb: 1, t: "Pied droit sur l'accélérateur : un peu plus que sur le plat (~2 000 tr/min).", w: "Le frein à main retient la voiture, tu as les deux pieds libres." },
        { e: "b", a: 1, g: "1", hb: 1, t: "Remonte l'embrayage jusqu'au point de patinage… et un poil plus.", w: "Le signal : l'avant se soulève légèrement et le bruit du moteur baisse. La voiture tire contre le frein à main." },
        { e: "b", a: 1, g: "1", hb: 0, t: "À ce moment-là, desserre le frein à main : la voiture avance au lieu de reculer.", w: "" },
        { e: 0, a: 1, g: "1", hb: 0, t: "Continue de relâcher l'embrayage doucement en accélérant. Gagné ! 🏔️", w: "Si tu cales : frein, frein à main, et on recommence. Aucun drame." }
      ],
      "Marche arrière": [
        { e: 2, f: 2, g: "N", hb: 0, t: "Voiture complètement arrêtée : embrayage à fond, pied sur le frein.", w: "" },
        { e: 2, f: 2, g: "N", hb: 0, t: "Attends 3 secondes.", w: "C'est une recommandation du manuel de l'Agila : sinon la marche arrière peut refuser d'entrer." },
        { e: 2, f: 2, g: "R", hb: 0, t: "Engage la marche arrière (regarde la position sur le pommeau).", w: "Si elle ne rentre pas : point mort, relâche l'embrayage, ré-enfonce-le et réessaie." },
        { e: "b", f: 0, a: 0, g: "R", hb: 0, t: "Relâche très doucement l'embrayage : la voiture recule toute seule, sans accélérer.", w: "Pour ralentir, enfonce un peu l'embrayage. Pour accélérer, relâche-le un peu." },
        { e: 2, f: 2, g: "R", hb: 0, t: "Pour t'arrêter : embrayage à fond et frein.", w: "" }
      ]
    };
    const tabs = $("#howtoTabs"), mp = $$("#miniPedals .mp"), gear = $("#miniGear"), hb = $("#miniHb");
    const cnt = $("#howtoCount"), st = $("#howtoStep"), why = $("#howtoWhy"), dots = $("#howtoDots"), textBox = $(".howto-text");
    let cat = Object.keys(S)[0], i = 0;
    Object.keys(S).forEach(k => {
      const b = document.createElement("button"); b.textContent = k; b.setAttribute("role", "tab");
      b.addEventListener("click", () => { cat = k; i = 0; render(); b.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" }); });
      tabs.appendChild(b);
    });
    function render() {
      const steps = S[cat], s = steps[i];
      $$("button", tabs).forEach(b => b.classList.toggle("on", b.textContent === cat));
      mp.forEach(m => {
        const v = s[m.dataset.p] || 0;
        m.classList.toggle("l1", v === 1); m.classList.toggle("l2", v === 2); m.classList.toggle("bite", v === "b");
      });
      if (gear.textContent !== s.g) { gear.classList.remove("pop"); void gear.offsetWidth; gear.classList.add("pop"); }
      gear.textContent = s.g; hb.classList.toggle("off", !s.hb);
      textBox.classList.add("anim"); void textBox.offsetWidth; textBox.classList.remove("anim");
      cnt.textContent = `Étape ${i + 1}/${steps.length}`; st.textContent = s.t; why.textContent = s.w;
      dots.innerHTML = steps.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("");
      $("#howtoPrev").disabled = i === 0;
      $("#howtoNext").textContent = i === steps.length - 1 ? "Suivant ↻" : "Suiv. →";
    }
    $("#howtoPrev").addEventListener("click", () => { if (i > 0) { i--; render(); } });
    $("#howtoNext").addEventListener("click", () => {
      const keys = Object.keys(S);
      if (i < S[cat].length - 1) i++; else { cat = keys[(keys.indexOf(cat) + 1) % keys.length]; i = 0; $$("button", tabs).find(b => b.textContent === cat).scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" }); }
      render();
    });
    render();
  })();

  /* ---------- Chapitre 8 : cartes ---------- */
  $$(".flip").forEach(f => f.addEventListener("click", () => f.classList.toggle("on")));

  /* ---------- Chapitre 9 : quiz ---------- */
  (function quiz() {
    const Q = [
      ["À quoi sert l'embrayage ?", ["À freiner plus fort", "À séparer le moteur des roues", "À accélérer plus vite"], 1, "Il sépare le moteur des roues, pour s'arrêter ou changer de vitesse sans caler."],
      ["Avec quel pied appuie-t-on sur l'embrayage ?", ["Le pied gauche", "Le pied droit", "Ça dépend"], 0, "Toujours le gauche, et le gauche ne fait que ça."],
      ["Tu viens de caler à un feu. Que fais-tu ?", ["J'accélère fort pour relancer", "Frein, embrayage à fond, point mort, et je redémarre", "Je relâche l'embrayage et je tourne la clé"], 1, "On sécurise d'abord (frein), puis embrayage à fond pour redémarrer. Et on respire 😌"],
      ["Le moteur hurle et le compte-tours dépasse 4 000 tr/min. Que faire ?", ["Descendre une vitesse", "Monter une vitesse", "Freiner"], 1, "Une vitesse plus haute fait tourner le moteur moins vite à la même allure."],
      ["Tu roules à 45 km/h en ville. Quelle vitesse est la plus logique ?", ["1re", "3e", "5e"], 1, "La 3e, c'est la vitesse de la ville (30-50 km/h)."],
      ["En freinant pour t'arrêter, quand enfonces-tu l'embrayage ?", ["Vers 15-20 km/h, avant que le moteur vibre", "Jamais, ce n'est pas utile", "Dès que je lève le pied de l'accélérateur"], 0, "Pas trop tôt (le frein moteur aide à ralentir), pas trop tard (sinon tu cales)."],
      ["Pour engager la marche arrière sur l'Agila :", ["Je roule encore doucement, c'est plus fluide", "Arrêtée, embrayage à fond, j'attends 3 secondes", "Pas besoin d'embrayage"], 1, "Voiture complètement arrêtée, et les 3 secondes recommandées par le manuel de l'Agila."],
      ["Démarrage en côte : quel est le signal pour desserrer le frein à main ?", ["Quand le moteur hurle", "L'avant se soulève et le bruit du moteur baisse", "Quand quelqu'un klaxonne derrière"], 1, "C'est le point de patinage : la voiture tire contre le frein à main."]
    ];
    const box = $("#quizBox");
    let i = 0, score = 0;
    function show() {
      if (i >= Q.length) return end();
      const [q, opts, ok, ex] = Q[i];
      box.innerHTML = `<p class="q-count">Question ${i + 1}/${Q.length}</p><p class="q-text">${q}</p><div class="q-opts">${opts.map((o, k) => `<button data-k="${k}">${o}</button>`).join("")}</div><div class="q-expl" hidden></div>`;
      $$(".q-opts button", box).forEach(b => b.addEventListener("click", () => {
        const k = +b.dataset.k, right = k === ok;
        if (right) score++;
        $$(".q-opts button", box).forEach(x => { x.disabled = true; if (+x.dataset.k === ok) x.classList.add("right"); });
        if (!right) b.classList.add("wrong");
        const e = $(".q-expl", box); e.hidden = false;
        e.innerHTML = (right ? "✅ " : "❌ ") + ex + `<div class="row-btns"><button class="btn btn-small" id="qNext">${i === Q.length - 1 ? "Voir mon score" : "Question suivante →"}</button></div>`;
        $("#qNext").addEventListener("click", () => { i++; show(); });
      }));
    }
    function end() {
      const best = Math.max(score, store.get("quiz", 0)); store.set("quiz", best);
      const m = score === Q.length ? "Parfait ! Tu es prête pour le parking 🚗" : score >= 6 ? "Très bien ! Relis juste les points ratés." : "Pas mal pour un début. Refais un tour des chapitres et réessaie !";
      box.innerHTML = `<div class="q-end"><p class="q-count">Résultat</p><p class="q-score">${score}/${Q.length}</p><p>${m}</p><div class="row-btns"><button class="btn btn-small btn-ghost" id="qAgain">↺ Recommencer</button></div></div>`;
      $("#qAgain").addEventListener("click", () => { i = 0; score = 0; show(); });
      if (score >= 6) confetti();
    }
    show();
  })();

  function confetti() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const colors = ["#1846e0", "#ffd29e", "#ff8a3d", "#14a06a", "#ffffff"];
    for (let k = 0; k < 60; k++) {
      const c = document.createElement("i"); c.className = "confetti";
      c.style.left = Math.random() * 100 + "vw"; c.style.background = colors[k % colors.length];
      c.style.animationDuration = 1.6 + Math.random() * 1.8 + "s"; c.style.animationDelay = Math.random() * .4 + "s";
      c.style.borderRadius = Math.random() < .5 ? "50%" : "2px";
      document.body.appendChild(c); setTimeout(() => c.remove(), 4200);
    }
  }
  window.BMConfetti = confetti;
})();
