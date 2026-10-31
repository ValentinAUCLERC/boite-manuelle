/* Simulateur anti-calage : petite physique moteur + embrayage + voiture */
(function () {
  "use strict";
  const { $, $$, clamp, store } = window.BM;
  const Engine = window.BMEngine, Tacho = window.BMTacho, { RATIOS, FINAL, WHEEL_R } = window.BMGear;

  const M = 1000, G = 9.81, IE = .12, RPM = 60 / (2 * Math.PI);
  const BITE = .52; // pression de pédale où l'embrayage commence à « mordre »
  const el = {
    sim: $("#sim"), tacho: $("#simTacho"), rpm: $("#simRpm"), speed: $("#simSpeed"), gear: $("#simGearBig"), led: $("#simEngineLed"),
    coach: $("#simCoach"), toast: $("#simToast"), road: $("#road"), lines: $("#roadLines"), car: $("#car"),
    w1: $("#carW1"), w2: $("#carW2"), smoke: $$("#smoke circle"), start: $("#simStart"), hand: $("#simHand"), sound: $("#simSound"),
    mission: $("#simMission"), list: $("#missionList"), reset: $("#simReset")
  };

  const S = {
    running: false, starting: 0, rpm: 0, gear: 0, v: 0, x: 0, hb: true, hill: false,
    p: { clutch: 0, brake: 0, gas: 0 }, touch: { clutch: null, brake: null, gas: null },
    slipTime: 0, sound: false, stalls: 0
  };

  /* ---------- Entrées : pédales tactiles ---------- */
  $$(".spedal").forEach(pd => {
    const key = pd.dataset.p, fill = $(".spedal-fill", pd);
    pd._fill = fill;
    const read = ev => { const r = pd.getBoundingClientRect(); return clamp(((ev.clientY - r.top) / r.height) * 1.12 - .04, 0, 1); };
    pd.addEventListener("pointerdown", ev => {
      ev.preventDefault(); pd.setPointerCapture(ev.pointerId);
      S.touch[key] = read(ev); pd.classList.add("active"); audioKick();
    });
    pd.addEventListener("pointermove", ev => { if (S.touch[key] !== null) S.touch[key] = read(ev); });
    const up = () => { S.touch[key] = null; pd.classList.remove("active"); };
    pd.addEventListener("pointerup", up); pd.addEventListener("pointercancel", up); pd.addEventListener("lostpointercapture", up);
    pd.addEventListener("contextmenu", e => e.preventDefault());
  });

  const clutchDown = () => Math.max(S.p.clutch, S.touch.clutch || 0) >= .8;

  /* ---------- Diagnostic : ajouter #debug à l'URL ---------- */
  if (location.hash === "#debug") {
    const box = document.createElement("div"); box.className = "dbg"; document.body.appendChild(box);
    const log = [];
    const name = t => t.id || (t.dataset && (t.dataset.p || t.dataset.g)) || t.className || t.tagName;
    ["pointerdown", "pointerup", "pointercancel", "lostpointercapture", "click"].forEach(type =>
      addEventListener(type, e => {
        log.unshift(`${(performance.now() / 1000).toFixed(2)} ${type} #${e.pointerId ?? "-"} ${e.pointerType || ""} → ${String(name(e.target)).slice(0, 24)}`);
        log.length = 12;
        box.textContent = `embrayage ${S.p.clutch.toFixed(2)} (doigt ${S.touch.clutch === null ? "—" : S.touch.clutch.toFixed(2)})  moteur ${S.running ? "ON" : "off"}\n` + log.join("\n");
      }, true));
  }

  /* ---------- Boutons multi-touch ----------
     Chrome Android ne génère pas de « click » pour un 2e doigt quand le 1er est
     déjà posé (sur une pédale) : on réagit donc au pointerdown, émis pour chaque
     doigt. Le « click » ne sert plus qu'au clavier (detail === 0). */
  function press(btn, fn) {
    btn.addEventListener("pointerdown", ev => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      ev.preventDefault(); fn(ev);
    });
    btn.addEventListener("click", ev => { if (ev.detail === 0) fn(ev); });
    btn.addEventListener("contextmenu", e => e.preventDefault());
  }

  /* ---------- Levier ---------- */
  const gearBtns = $$("#simGears button");
  const gname = g => g === 0 ? "N" : g === -1 ? "R" : String(g);
  gearBtns.forEach(b => press(b, () => {
    const g = +b.dataset.g;
    if (g === S.gear) return;
    const deny = (txt) => { b.classList.remove("deny"); void b.offsetWidth; b.classList.add("deny"); toast(txt, false); buzz(60); };
    if (g !== 0 && !clutchDown()) return deny("Craaac ! Embrayage à fond d'abord");
    if (g === -1 && Math.abs(S.v) > .3) return deny("Arrête-toi avant la marche arrière");
    if (g > 0 && S.v < -.3) return deny("Tu recules : arrête-toi d'abord");
    setGear(g);
  }));
  function setGear(g) { S.gear = g; gearBtns.forEach(x => x.classList.toggle("on", +x.dataset.g === g)); }

  press(el.start, () => {
    audioKick();
    if (S.running || S.starting) return;
    if (!clutchDown()) { toast("Embrayage à fond pour démarrer", false); buzz(60); coachSay("Sur l'Agila, il faut enfoncer l'embrayage à fond pour démarrer : glisse ton pouce tout en bas de la pédale de gauche.", "warn"); return; }
    S.starting = .6;
  });
  press(el.hand, () => { S.hb = !S.hb; el.hand.setAttribute("aria-pressed", S.hb); });
  press(el.sound, () => {
    S.sound = !S.sound; el.sound.setAttribute("aria-pressed", S.sound); el.sound.textContent = S.sound ? "🔊 Son" : "🔇 Son";
    if (S.sound) Engine.ensure(); else Engine.silence();
  });
  function audioKick() { if (S.sound) Engine.ensure(); }
  addEventListener("bm-listen-end", () => { if (S.sound && S.running) Engine.ensure(); });

  /* ---------- Feedback ---------- */
  let toastT = null;
  function toast(t, good) {
    el.toast.textContent = t; el.toast.classList.toggle("good", !!good); el.toast.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => el.toast.classList.remove("show"), 1600);
  }
  function buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }
  let forcedCoach = null, forcedUntil = 0;
  function coachSay(t, cls, ms = 3500) { forcedCoach = [t, cls]; forcedUntil = performance.now() + ms; }

  /* ---------- Physique ---------- */
  const engage = p => Math.pow(clamp((BITE - p) / .34, 0, 1), 2);
  function tmax(rpm) {
    if (rpm < 1000) return 55 + rpm / 1000 * 30;
    if (rpm < 4000) return 85 + (rpm - 1000) / 3000 * 30;
    return Math.max(0, 115 - (rpm - 4000) / 2500 * 45);
  }
  function stall() {
    S.running = false; S.stalls++; T.stalled = true;
    toast("Calé !", false); buzz([80, 40, 120]);
    el.car.classList.remove("shake"); void el.car.offsetWidth; el.car.classList.add("shake");
    coachSay("Calé ! Pas grave, ça arrive à tout le monde. Embrayage à fond, puis 🔑 Démarrer.", "bad", 4500);
  }
  function step(dt) {
    const p = S.p;
    // pédales : suivent le doigt, sinon ressort
    for (const k in p) {
      const tgt = S.touch[k] === null ? 0 : S.touch[k];
      const rate = S.touch[k] === null ? 7 : 30;
      p[k] += (tgt - p[k]) * Math.min(1, rate * dt);
      if (S.touch[k] === null && p[k] < .005) p[k] = 0;
    }
    if (S.starting > 0) {
      S.starting -= dt; S.rpm = 250 + Math.sin(performance.now() / 30) * 60;
      if (S.starting <= 0) { S.starting = 0; S.running = true; S.rpm = 1150; puff(); }
    }
    const ratio = S.gear === 0 ? 0 : RATIOS[S.gear] * FINAL;
    const e = ratio ? engage(p.clutch) : 0;
    const C = 230 * e;
    const wr = S.v / WHEEL_R * ratio * RPM;     // régime côté boîte
    const slip = S.rpm - wr;
    const Tc = ratio ? clamp(slip * 1.2, -C, C) : 0;
    // moteur
    let Te = 0;
    if (S.running) {
      const thr = S.rpm > 6300 ? 0 : p.gas;
      Te = thr * tmax(S.rpm);
      if (S.rpm < 1150) Te += clamp(10.6 + (850 - S.rpm) * .12, 0, 45); // régulation de ralenti (aide anti-calage)
    }
    const Tf = S.rpm > 1 ? 6 + S.rpm * .005 : 0;
    if (!S.starting) {
      S.rpm += (Te - Tf - Tc) / IE * RPM * dt;
      if (!S.running && S.rpm < 0) S.rpm = 0;
      if (!S.running && ratio && e > .5) S.rpm = Math.max(0, wr); // moteur éteint entraîné par les roues
      if (S.running && S.rpm < 350) stall();
    }
    // voiture
    const Fd = ratio ? Tc * ratio * .9 / WHEEL_R : 0;
    const theta = S.hill ? Math.atan(.1) : 0;
    const Fg = -M * G * Math.sin(theta);
    const Faero = -.82 * S.v * Math.abs(S.v);
    const Fnet = Fd + Fg + Faero;
    const Bcap = p.brake * 9000 + (S.hb ? 6500 : 0) + .013 * M * G;
    if (Math.abs(S.v) < .03 && Math.abs(Fnet) <= Bcap) S.v = 0;
    else {
      const dir = Math.abs(S.v) < .03 ? Math.sign(Fnet) : Math.sign(S.v);
      const nv = S.v + (Fnet - dir * Bcap) / M * dt;
      S.v = (Math.sign(nv) !== dir && Math.abs(S.v) > 0 && Math.sign(S.v) === dir) ? 0 : nv;
    }
    S.x += S.v * dt;
    // patinage prolongé
    S.slipTime = (e > .05 && e < .95 && Math.abs(slip) > 1200 && p.gas > .45) ? S.slipTime + dt : Math.max(0, S.slipTime - dt * 2);
    S._e = e; S._slip = slip;
  }

  /* ---------- Coach ---------- */
  function coach() {
    const now = performance.now();
    if (forcedCoach && now < forcedUntil) return forcedCoach;
    const kmh = Math.abs(S.v) * 3.6, e = S._e || 0, p = S.p;
    if (S.starting) return ["Le démarreur tourne…", ""];
    if (!S.running) return !clutchDown() ? ["Moteur éteint. Glisse ton pouce tout en bas de l'embrayage, puis 🔑 Démarrer.", ""] : ["Embrayage enfoncé 👍 Maintenant, 🔑 Démarrer.", ""];
    if (S.rpm > 5600) return ["Ça hurle ! Passe la vitesse supérieure : lâche l'accélérateur, embrayage à fond, levier.", "bad"];
    if (S.slipTime > 1.5) return ["Tu fais patiner l'embrayage en accélérant fort : ça l'use. Relâche-le un peu plus franchement.", "warn"];
    if (S.hb && S.gear !== 0 && e > .15) return ["Attention, le frein à main est encore serré !", "warn"];
    if (S.v < -.4 && S.gear >= 0) return ["La voiture recule ! Freine, ou serre le frein à main.", "bad"];
    if (S.gear > 0 && e > .9 && S.rpm > 3800) return ["Le moteur monte haut : passe la vitesse supérieure.", "warn"];
    if (S.gear > 1 && e > .9 && S.rpm < 1150) return ["Le moteur broute : il manque de régime. Débraye, ou passe une vitesse plus basse.", "warn"];
    if (S.gear !== 0 && e > 0 && e < .95 && kmh < 8) return ["Point de patinage : la voiture commence à tirer… doucement, ne lâche pas d'un coup !", "ok"];
    if (S.gear === 0 && kmh < 1) return S.hill ? ["En côte : embrayage à fond, 1re. Garde le frein à main serré pour l'instant.", ""] : ["Moteur au ralenti. Embrayage à fond, puis passe la 1re.", ""];
    if (S.gear === 1 && kmh < 1 && p.clutch > .85) return S.hb ? ["1re engagée. Desserre le frein à main (sauf en côte), puis remonte l'embrayage doucement jusqu'au trait.", ""] : ["Remonte doucement l'embrayage jusqu'au trait jaune…", ""];
    if (S.gear === 0 && kmh > 3) return ["Point mort en roulant : la voiture avance sur son élan, sans frein moteur.", ""];
    if (e > .95 && S.gear > 0) return [kmh < 3 ? "Embrayé." : "Nickel, ça roule 👌", "ok"];
    return ["", ""];
  }

  /* ---------- Missions ---------- */
  const T = {}; // suivi de la mission en cours
  const base = (o = {}) => Object.assign(S, { running: false, starting: 0, rpm: 0, v: 0, x: 0, hb: true, hill: false }, o);
  const MISSIONS = [
    { t: "Démarrer le moteur", d: "Embrayage à fond, puis la clé.", setup() { base(); setGear(0); }, ok: () => S.running },
    { t: "Avancer sans accélérateur", d: "1re, frein à main desserré, remonte l'embrayage très doucement. Sans gaz, comme en D !",
      setup() { base({ running: true, rpm: 850 }); setGear(0); T.gasMax = 0; },
      tick() { if (Math.abs(S.v) < .05 && S.p.clutch > .85) T.gasMax = 0; T.gasMax = Math.max(T.gasMax, S.p.gas); if (T.gasMax > .08 && S.v > .5) coachSay("Pour cette mission, n'accélère pas du tout 😉 Arrête-toi et recommence.", "warn", 800); },
      ok: () => S.gear === 1 && S.v * 3.6 >= 5 && T.gasMax <= .08 },
    { t: "Démarrer et atteindre 15 km/h", d: "Embrayage jusqu'au trait, un peu d'accélérateur, puis relâche lentement.", setup() { base({ running: true, rpm: 850 }); setGear(0); }, ok: () => S.gear === 1 && S.v * 3.6 >= 15 },
    { t: "Passer la 2e et rouler à 25 km/h", d: "Vers 15 km/h : lâche l'accélérateur, embrayage à fond, 2e, relâche.", setup() { base({ running: true, rpm: 850 }); setGear(0); }, ok: () => S.gear === 2 && S._e > .95 && S.v * 3.6 >= 25 },
    { t: "Monter jusqu'en 3e à 40 km/h", d: "1re → 2e → 3e. Écoute le moteur.", setup() { base({ running: true, rpm: 850 }); setGear(0); }, ok: () => S.gear === 3 && S._e > .95 && S.v * 3.6 >= 40 },
    { t: "S'arrêter sans caler", d: "Tu roules à 40 km/h en 3e. Freine, et débraye avant que le moteur vibre.",
      setup() { base({ running: true, hb: false, v: 40 / 3.6 }); setGear(3); S.rpm = S.v / WHEEL_R * RATIOS[3] * FINAL * RPM; T.stalled = false; T.t = 0; },
      tick(dt) { T.t += dt; }, ok: () => T.t > 1 && Math.abs(S.v) < .05 && S.running && !T.stalled },
    { t: "Démarrage en côte (10 %)", d: "Frein à main serré, 1re, embrayage au trait avec un peu de gaz, puis desserre le frein à main.",
      setup() { base({ running: true, rpm: 850, hill: true }); setGear(0); T.minX = 0; },
      tick() { T.minX = Math.min(T.minX, S.x); if (T.minX < -.6) coachSay(`Tu as reculé de ${(-T.minX).toFixed(1)} m. Serre le frein à main, puis ↺ Recommencer.`, "bad", 600); },
      ok: () => S.gear === 1 && S.v * 3.6 >= 10 && T.minX > -.6 }
  ];
  const done = new Set(store.get("missions", []));
  let mi = Math.min(MISSIONS.findIndex((_, k) => !done.has(k)), MISSIONS.length - 1); if (mi < 0) mi = 0;
  let succeeded = false, advanceGen = 0;
  function loadMission(k) {
    mi = k; succeeded = false; advanceGen++; for (const key in T) delete T[key];
    S.p.clutch = 0; S.p.gas = 0; S.p.brake = 0; S.slipTime = 0;
    MISSIONS[k].setup();
    el.hand.setAttribute("aria-pressed", S.hb);
    el.road.classList.toggle("hill", S.hill);
    el.mission.innerHTML = `<b>Mission ${k + 1}/${MISSIONS.length} · ${MISSIONS[k].t}</b><small>${MISSIONS[k].d}</small>`;
    renderList(); forcedCoach = null;
  }
  function renderList() {
    el.list.innerHTML = MISSIONS.map((m, k) => `<li data-k="${k}" class="${k === mi ? "cur" : ""} ${done.has(k) ? "done" : ""}"><i>${done.has(k) ? "✓" : k + 1}</i><span>${m.t}<small>${m.d}</small></span></li>`).join("");
    $$("li", el.list).forEach(li => li.addEventListener("click", () => { loadMission(+li.dataset.k); if (matchMedia("(pointer:coarse)").matches) enterFocus(); }));
  }
  el.reset.addEventListener("click", () => loadMission(mi));
  $("#simRetry").addEventListener("click", () => loadMission(mi));

  /* ---------- Mode plein écran ----------
     Le simulateur passe en position:fixed sur tout l'écran, la page dessous est
     bloquée (plus de défilement accidentel ni de « tirer pour actualiser »), et on
     demande le vrai plein écran au navigateur quand c'est possible. */
  const root = document.documentElement, focusBtn = $("#simFocus");
  let focusOn = false, usedFS = false;
  function enterFocus() {
    if (focusOn) return;
    focusOn = true; root.classList.add("sim-open"); el.sim.classList.add("focus");
    focusBtn.textContent = "✕"; focusBtn.setAttribute("aria-label", "Quitter le plein écran");
    history.pushState({ simFocus: 1 }, "");
    usedFS = false;
    if (root.requestFullscreen && matchMedia("(pointer:coarse)").matches)
      root.requestFullscreen({ navigationUI: "hide" }).then(() => { usedFS = true; }).catch(() => {});
    audioKick();
  }
  function exitFocus(fromHistory) {
    if (!focusOn) return;
    focusOn = false; root.classList.remove("sim-open"); el.sim.classList.remove("focus");
    focusBtn.textContent = "⛶"; focusBtn.setAttribute("aria-label", "Plein écran");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (!fromHistory && history.state && history.state.simFocus) history.back();
    el.sim.scrollIntoView({ block: "start", behavior: "instant" });
  }
  focusBtn.addEventListener("click", () => focusOn ? exitFocus() : enterFocus());
  $("#simCta").addEventListener("click", enterFocus);
  addEventListener("popstate", () => exitFocus(true));
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && usedFS) { usedFS = false; exitFocus(); } });
  addEventListener("keydown", e => { if (e.key === "Escape") exitFocus(); });

  /* ---------- Rendu ---------- */
  function puff() {
    el.smoke.forEach((c, k) => c.animate([{ opacity: .7, transform: "translate(0,0) scale(.6)" }, { opacity: 0, transform: `translate(${14 + k * 8}px,-${10 + k * 6}px) scale(1.6)` }], { duration: 900, easing: "ease-out" }));
  }
  let lastCoach = "";
  function render() {
    Tacho.set(el.tacho, S.rpm);
    el.rpm.textContent = Math.round(Math.max(0, S.rpm) / 50) * 50;
    el.speed.textContent = Math.round(Math.abs(S.v) * 3.6);
    el.gear.textContent = gname(S.gear);
    el.led.textContent = S.running ? "moteur allumé" : S.starting ? "démarrage…" : "moteur éteint";
    el.led.classList.toggle("on", S.running);
    el.start.classList.toggle("running", S.running);
    $$(".spedal").forEach(pd => pd._fill.style.height = (S.p[pd.dataset.p] * 100) + "%");
    const px = S.x * 22;
    el.lines.style.backgroundPositionX = (-px % 64) + "px";
    const rot = (S.x / WHEEL_R) * 180 / Math.PI;
    el.w1.setAttribute("transform", `translate(36 68) rotate(${rot % 360})`);
    el.w2.setAttribute("transform", `translate(114 68) rotate(${rot % 360})`);
    el.car.classList.toggle("idle", S.running && Math.abs(S.v) < .1 && !el.car.classList.contains("shake"));
    const [t, cls] = coach();
    if (t !== lastCoach) { el.coach.textContent = t || "\u00a0"; el.coach.className = "coach " + (cls || ""); lastCoach = t; }
    if (S.sound && (S.running || S.starting)) Engine.set(S.rpm, S.p.gas, .18);
    else if (S.sound) Engine.silence();
  }
  el.car.addEventListener("animationend", e => { if (e.animationName === "shake") el.car.classList.remove("shake"); });

  /* ---------- Boucle ---------- */
  let visible = false, last = 0;
  function loop(now) {
    if (!visible) return;
    let dt = Math.min(.05, (now - last) / 1000); last = now;
    const n = Math.max(1, Math.round(dt * 240)), h = dt / n;
    for (let k = 0; k < n; k++) step(h);
    const m = MISSIONS[mi];
    if (m.tick) m.tick(dt);
    if (!succeeded && m.ok()) {
      succeeded = true; done.add(mi); store.set("missions", [...done]); renderList();
      toast("Mission réussie ! 🎉", true); buzz(40);
      coachSay(done.size < MISSIONS.length ? "Bravo ! Mission suivante dans un instant…" : "Toutes les missions sont réussies, tu es une cheffe 👑", "ok", 2500);
      if (done.size === MISSIONS.length && window.BMConfetti) window.BMConfetti();
      const from = mi, gen = ++advanceGen;
      if (from < MISSIONS.length - 1) setTimeout(() => { if (mi === from && gen === advanceGen) loadMission(from + 1); }, 2200);
    }
    render();
    requestAnimationFrame(loop);
  }
  new IntersectionObserver(es => {
    visible = es[0].isIntersecting;
    if (visible) { last = performance.now(); requestAnimationFrame(loop); } else Engine.silence();
  }, { threshold: .05 }).observe(el.sim);
  document.addEventListener("visibilitychange", () => { if (document.hidden) Engine.silence(); });

  loadMission(mi);
  render();
  window.BMSim = { S, MISSIONS, loadMission, enterFocus, exitFocus }; // debug
})();
