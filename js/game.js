/* NEON RUSH: DUEL RACERS — core engine: input, physics, race logic, camera, rendering, HUD.
   Menus live in ui.js and talk to this file through window.NR. */
(function () {
  'use strict';

  const { TRACK_DEFS, buildTrack, generateScenery, rng, SPACING } = NRTracks;
  const { DESIGNS, COLORS, POOL, STAT_MAX, specsFor, drawCar, drawFlame, getGlow, rgba, shade } = NRCars;
  const A = NRAudio;

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
  const FONT = '"Avenir Next","Segoe UI","SF Pro Display","Helvetica Neue",Arial,sans-serif';
  const KMH = 0.45;               // world units/s -> displayed km/h
  const NITRO_USE = 38, NITRO_REGEN = 11, FINISH_GRACE = 12;

  /* ------------------------------------------------------------------ *
   *  Save data
   * ------------------------------------------------------------------ */
  const SAVE_KEY = 'neonrush.v1';
  const defaultSave = () => ({
    settings: { music: 0.5, sfx: 0.8, mute: false, shake: true, quality: 'high', fps: false },
    garage: [{ car: 0, color: '#29a3ff', alloc: [2, 2, 2, 2] }, { car: 1, color: '#ff8a1f', alloc: [2, 2, 2, 2] }],
    track: 'city', laps: 3, mode: 'quick', bests: {}
  });
  function loadSave() {
    const d = defaultSave();
    let o = {};
    try { o = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') || {}; } catch (e) { o = {}; }
    const s = o.settings || {};
    ['music', 'sfx'].forEach((k) => { if (typeof s[k] === 'number') d.settings[k] = clamp(s[k], 0, 1); });
    ['mute', 'shake', 'fps'].forEach((k) => { if (typeof s[k] === 'boolean') d.settings[k] = s[k]; });
    if (s.quality === 'low' || s.quality === 'high') d.settings.quality = s.quality;
    (o.garage || []).slice(0, 2).forEach((g, i) => {
      if (!g || !(g.car >= 0 && g.car < DESIGNS.length)) return;
      const al = Array.isArray(g.alloc) ? g.alloc.slice(0, 4).map((v) => clamp(v | 0, 0, 5)) : null;
      d.garage[i].car = g.car | 0;
      if (COLORS.some((c) => c.c === g.color)) d.garage[i].color = g.color;
      if (al && al.length === 4 && al.reduce((a, b) => a + b, 0) <= POOL) d.garage[i].alloc = al;
    });
    if (d.garage[0].color === d.garage[1].color) d.garage[1].color = d.garage[0].color === '#ff8a1f' ? '#29a3ff' : '#ff8a1f';
    if (TRACK_DEFS.some((t) => t.id === o.track)) d.track = o.track;
    if ([1, 3, 5, 10].includes(o.laps)) d.laps = o.laps;
    if (['quick', 'gp', 'tt', 'practice'].includes(o.mode)) d.mode = o.mode;
    if (o.bests && typeof o.bests === 'object') d.bests = o.bests;
    return d;
  }
  const save = loadSave();
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* storage unavailable */ } }

  /* ------------------------------------------------------------------ *
   *  Input — one listener set, registered once
   * ------------------------------------------------------------------ */
  const KEYMAP = {
    KeyW: [0, 'up'], KeyS: [0, 'down'], KeyA: [0, 'left'], KeyD: [0, 'right'], ShiftLeft: [0, 'nitro'], KeyQ: [0, 'reset'],
    ArrowUp: [1, 'up'], ArrowDown: [1, 'down'], ArrowLeft: [1, 'left'], ArrowRight: [1, 'right'], ShiftRight: [1, 'nitro'], Slash: [1, 'reset']
  };
  const input = [{}, {}];
  const resetEdge = [false, false];
  function clearInput() { input[0] = {}; input[1] = {}; resetEdge[0] = resetEdge[1] = false; }

  /* ------------------------------------------------------------------ *
   *  Themes & scenes (track geometry, cached graphics)
   * ------------------------------------------------------------------ */
  const THEMES = {
    city: { night: true, ground: '#080b1c', verge: '#141a36', asphalt: '#1f2440', curbA: '#eef4ff', curbB: '#ff2fd0', line: 'rgba(200,240,255,.8)', dust: [110, 120, 170], bpm: 134, root: 0 },
    desert: { dusk: false, ground: '#d6ab6a', verge: '#b98a4c', asphalt: '#3a3a40', curbA: '#ffffff', curbB: '#e0382b', line: 'rgba(255,255,255,.8)', dust: [222, 184, 128], bpm: 128, root: 3 },
    forest: { dusk: true, ground: '#1d4a29', verge: '#4b5b30', asphalt: '#30343a', curbA: '#f2f2f2', curbB: '#d12f2f', line: 'rgba(255,255,255,.8)', dust: [132, 104, 66], bpm: 126, root: 5 }
  };
  const scenes = {};
  const mainCanvas = document.getElementById('game');
  const ctx = mainCanvas.getContext('2d', { alpha: false });

  function offsetPath(tr, off, offArr) {
    const p = new Path2D(), N = tr.n;
    for (let i = 0; i < N; i++) {
      const o = offArr ? Math.sign(off) * offArr[i] : off;
      const x = tr.px[i] + tr.nx[i] * o, y = tr.py[i] + tr.ny[i] * o;
      if (i) p.lineTo(x, y); else p.moveTo(x, y);
    }
    p.closePath();
    return p;
  }

  function noiseCanvas(size, base, fn, seed) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'), r = rng(seed);
    if (base) { g.fillStyle = base; g.fillRect(0, 0, size, size); }
    const wrap = (x, y, f) => { for (let dx = -size; dx <= size; dx += size) for (let dy = -size; dy <= size; dy += size) f(x + dx, y + dy); };
    fn(g, r, wrap, size);
    return c;
  }

  function makePatterns(theme) {
    const P = {};
    if (theme === 'city') {
      P.ground = noiseCanvas(256, '#080b1c', (g, r, wrap, S) => {
        g.strokeStyle = 'rgba(40,80,170,.17)'; g.lineWidth = 2;
        for (let i = 0; i <= S; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); }
        for (let i = 0; i < 220; i++) { g.fillStyle = 'rgba(' + (60 + r() * 60) + ',' + (80 + r() * 80) + ',200,' + (0.04 + r() * 0.08) + ')'; g.fillRect(r() * S, r() * S, 2, 2); }
      }, 11);
      P.verge = noiseCanvas(128, '#141a36', (g, r, wrap, S) => {
        for (let i = 0; i < 260; i++) { const v = 30 + r() * 50; g.fillStyle = 'rgba(' + v + ',' + (v + 10) + ',' + (v + 50) + ',.35)'; g.fillRect(r() * S, r() * S, 2 + r() * 2, 2); }
      }, 12);
    } else if (theme === 'desert') {
      P.ground = noiseCanvas(256, '#d6ab6a', (g, r, wrap, S) => {
        for (let i = 0; i < 90; i++) {
          const x = r() * S, y = r() * S, w = 16 + r() * 40, a = r() < 0.5 ? 0.12 : 0.1;
          wrap(x, y, (X, Y) => { g.strokeStyle = r() < 0.5 ? 'rgba(150,100,45,' + a + ')' : 'rgba(255,230,170,' + a + ')'; g.lineWidth = 1.5; g.beginPath(); g.arc(X, Y, w, 0.2, 1.2); g.stroke(); });
        }
        for (let i = 0; i < 500; i++) { g.fillStyle = r() < 0.5 ? 'rgba(120,80,30,.16)' : 'rgba(255,240,190,.2)'; g.fillRect(r() * S, r() * S, 1.5, 1.5); }
      }, 21);
      P.verge = noiseCanvas(128, '#b98a4c', (g, r, wrap, S) => {
        for (let i = 0; i < 150; i++) { g.fillStyle = r() < 0.5 ? 'rgba(90,60,25,.4)' : 'rgba(235,200,140,.4)'; const s = 1 + r() * 3; wrap(r() * S, r() * S, (X, Y) => g.fillRect(X, Y, s, s)); }
      }, 22);
    } else {
      P.ground = noiseCanvas(256, '#1d4a29', (g, r, wrap, S) => {
        for (let i = 0; i < 70; i++) { g.fillStyle = 'rgba(' + (10 + r() * 20) + ',' + (50 + r() * 30) + ',' + (20 + r() * 20) + ',.3)'; const x = r() * S, y = r() * S, rr = 8 + r() * 22; wrap(x, y, (X, Y) => { g.beginPath(); g.arc(X, Y, rr, 0, TAU); g.fill(); }); }
        for (let i = 0; i < 900; i++) { g.strokeStyle = r() < 0.5 ? 'rgba(90,170,70,.28)' : 'rgba(10,40,18,.35)'; g.lineWidth = 1; const x = r() * S, y = r() * S; wrap(x, y, (X, Y) => { g.beginPath(); g.moveTo(X, Y); g.lineTo(X + (r() - 0.5) * 4, Y - 3 - r() * 4); g.stroke(); }); }
      }, 31);
      P.verge = noiseCanvas(128, '#4b5b30', (g, r, wrap, S) => {
        for (let i = 0; i < 200; i++) { g.fillStyle = r() < 0.5 ? 'rgba(70,50,25,.45)' : 'rgba(120,150,70,.35)'; const s = 1 + r() * 3; wrap(r() * S, r() * S, (X, Y) => g.fillRect(X, Y, s, s)); }
      }, 32);
    }
    P.noise = noiseCanvas(128, null, (g, r, wrap, S) => {
      for (let i = 0; i < 700; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.12)'; g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2); }
    }, 41);
    return {
      ground: ctx.createPattern(P.ground, 'repeat'), verge: ctx.createPattern(P.verge, 'repeat'), noise: ctx.createPattern(P.noise, 'repeat')
    };
  }

  function getScene(id) {
    if (scenes[id]) return scenes[id];
    const def = TRACK_DEFS.find((t) => t.id === id) || TRACK_DEFS[0];
    const tr = buildTrack(def), th = THEMES[def.theme];
    const sc = { tr, th, scenery: generateScenery(tr), pat: makePatterns(def.theme) };
    const rw = tr.roadHalf, N = tr.n;
    sc.P = {
      center: offsetPath(tr, 0), wallL: offsetPath(tr, -1, tr.wallOff), wallR: offsetPath(tr, 1, tr.wallOff),
      edgeL: offsetPath(tr, -(rw - 11)), edgeR: offsetPath(tr, rw - 11), glowL: offsetPath(tr, -(rw + 20)), glowR: offsetPath(tr, rw + 20)
    };
    sc.ground = sc.scenery.filter((o) => o.t === 'dune' || o.t === 'flower');
    sc.low = sc.scenery.filter((o) => o.t !== 'dune' && o.t !== 'flower' && o.t !== 'tree' && o.t !== 'pine' && o.t !== 'bush' && o.t !== 'lamp');
    sc.high = sc.scenery.filter((o) => o.t === 'tree' || o.t === 'pine' || o.t === 'bush');
    sc.lamps = sc.scenery.filter((o) => o.t === 'lamp');
    sc.arrows = [];
    for (let i = 25; i < N; i += 52) sc.arrows.push(i);
    // minimap
    const b = tr.bounds, mw = 170, mh = 120, pad = 10;
    const k = Math.min((mw - pad * 2) / (b.x1 - b.x0), (mh - pad * 2) / (b.y1 - b.y0));
    sc.mm = { w: mw, h: mh, k, ox: (mw - (b.x1 - b.x0) * k) / 2 - b.x0 * k, oy: (mh - (b.y1 - b.y0) * k) / 2 - b.y0 * k };
    const mc = document.createElement('canvas'); mc.width = mw * 2; mc.height = mh * 2;
    const g = mc.getContext('2d'); g.scale(2, 2);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const line = (w, col) => { g.lineWidth = w; g.strokeStyle = col; g.beginPath(); for (let i = 0; i <= N; i++) { const j = i % N; const x = tr.px[j] * k + sc.mm.ox, y = tr.py[j] * k + sc.mm.oy; if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); };
    line(7, 'rgba(0,0,0,.6)'); line(5, 'rgba(255,255,255,.18)'); line(3, 'rgba(210,225,255,.85)');
    g.fillStyle = '#fff'; g.fillRect(tr.px[0] * k + sc.mm.ox - 1.5, tr.py[0] * k + sc.mm.oy - 5, 3, 10);
    sc.mmCanvas = mc;
    scenes[id] = sc;
    return sc;
  }

  /** Draws a stylised outline of a track (for menu cards). */
  function drawTrackPreview(cv, id) {
    const sc = getScene(id), tr = sc.tr, g = cv.getContext('2d'), w = cv.width, h = cv.height, pad = 18;
    const b = tr.bounds, k = Math.min((w - pad * 2) / (b.x1 - b.x0), (h - pad * 2) / (b.y1 - b.y0));
    const ox = (w - (b.x1 - b.x0) * k) / 2 - b.x0 * k, oy = (h - (b.y1 - b.y0) * k) / 2 - b.y0 * k;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
    const col = { city: ['#19f0ff', '#ff2fd0'], desert: ['#ffcf7a', '#e0382b'], forest: ['#8be07a', '#2d9cdb'] }[tr.theme];
    const stroke = (lw, c, dash) => {
      g.lineWidth = lw; g.strokeStyle = c; g.lineJoin = 'round'; g.lineCap = 'round'; g.setLineDash(dash || []);
      g.beginPath();
      for (let i = 0; i <= tr.n; i++) { const j = i % tr.n, x = tr.px[j] * k + ox, y = tr.py[j] * k + oy; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    };
    if (tr.def.river) { g.strokeStyle = 'rgba(60,140,220,.55)'; g.lineWidth = 5; g.beginPath(); tr.def.river.forEach((p, i) => { const x = p[0] * k + ox, y = p[1] * k + oy; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); }
    stroke(Math.max(8, w * 0.032), 'rgba(0,0,0,.65)'); stroke(Math.max(6, w * 0.024), col[0]); stroke(Math.max(3.5, w * 0.014), '#1b2038');
    stroke(1.5, 'rgba(255,255,255,.55)', [6, 8]);
    g.fillStyle = '#fff'; g.fillRect(tr.px[0] * k + ox - 2, tr.py[0] * k + oy - 8, 4, 16);
    g.setLineDash([]);
  }

  /* ------------------------------------------------------------------ *
   *  Cars
   * ------------------------------------------------------------------ */
  function makeCar(p, o) {
    const gi = save.garage[p], design = o.design != null ? o.design : gi.car;
    const alloc = o.alloc || gi.alloc;
    const specs = specsFor(design, alloc);
    return {
      p, design, color: o.color || gi.color, specs,
      x: 0, y: 0, a: 0, vx: 0, vy: 0, ang: 0, spin: 0, steer: 0, steerVis: 0,
      nitro: specs.nitroCap, nitroOn: false, nitroLock: false, nitroIdle: 0, nitroWas: false,
      idx: -1, s: 0, lastS: 0, total: 0, dist: 0, side: 0, cx: 0, cy: 0, offroad: false,
      laps: 0, lapStart: 0, lapTimes: [], bestLap: Infinity, finished: false, finishTime: 0,
      speed: 0, vf: 0, vl: 0, topSpeed: 0, sliding: false, slip: 0, braking: false, reversing: false, throttle: 0,
      stuckT: 0, wrongT: 0, wrong: false, ghostT: 0, auto: false, bot: !!o.bot, botSkill: o.botSkill || 0.92, msg: null,
      wheelPrev: [null, null], engine: null, ctl: {}, lastWall: 0, posRank: 1, started: false
    };
  }

  function placeAt(c, tr, s, lateral) {
    const i = ((Math.round(s / (tr.L / tr.n)) % tr.n) + tr.n) % tr.n;
    c.x = tr.px[i] + tr.nx[i] * lateral; c.y = tr.py[i] + tr.ny[i] * lateral; c.a = tr.ang[i];
    c.vx = c.vy = c.ang = c.spin = c.steer = 0;
    c.idx = -1; locate(c, tr, true);
    c.lastS = c.s;
  }

  function locate(c, tr, full) {
    const N = tr.n, px = tr.px, py = tr.py;
    let bi = 0, bd = Infinity;
    if (full || c.idx < 0) {
      for (let i = 0; i < N; i++) { const dx = px[i] - c.x, dy = py[i] - c.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; bi = i; } }
    } else {
      for (let k = -24; k <= 24; k++) {
        let i = c.idx + k; if (i < 0) i += N; else if (i >= N) i -= N;
        const dx = px[i] - c.x, dy = py[i] - c.y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; bi = i; }
      }
    }
    let best = Infinity, bj = bi, bt = 0, qx = 0, qy = 0;
    for (let q = 0; q < 2; q++) {
      const j = (bi - 1 + q + N) % N, k2 = (j + 1) % N;
      const ax = px[j], ay = py[j], abx = px[k2] - ax, aby = py[k2] - ay;
      const t = clamp(((c.x - ax) * abx + (c.y - ay) * aby) / (abx * abx + aby * aby || 1), 0, 1);
      const x = ax + abx * t, y = ay + aby * t, d = Math.hypot(c.x - x, c.y - y);
      if (d < best) { best = d; bj = j; bt = t; qx = x; qy = y; }
    }
    c.idx = bt > 0.5 ? (bj + 1) % N : bj;
    c.s = tr.S[bj] + bt * (tr.S[bj + 1] - tr.S[bj]);
    c.dist = best; c.cx = qx; c.cy = qy;
    c.side = (c.x - qx) * tr.nx[c.idx] + (c.y - qy) * tr.ny[c.idx];
  }

  /* ------------------------------------------------------------------ *
   *  Particles
   * ------------------------------------------------------------------ */
  const MAXP = 900;
  const parts = [];
  for (let i = 0; i < MAXP; i++) parts.push({ on: false, t: 0, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, s0: 1, s1: 1, c: '#fff', a: 1, r: 0, vr: 0, drag: 0 });
  let pHead = 0;
  const LOWQ = () => save.settings.quality === 'low';
  function spawn(t, x, y, vx, vy, life, s0, s1, c, a, drag) {
    const p = parts[pHead]; pHead = (pHead + 1) % MAXP;
    p.on = true; p.t = t; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = life;
    p.s0 = s0; p.s1 = s1; p.c = c; p.a = a; p.drag = drag == null ? 1.5 : drag; p.r = Math.random() * TAU; p.vr = (Math.random() - 0.5) * 8;
  }
  const P_SMOKE = 0, P_DUST = 1, P_SPARK = 2, P_FLAME = 3, P_CONF = 4;
  function updateParticles(dt) {
    for (let i = 0; i < MAXP; i++) {
      const p = parts[i]; if (!p.on) continue;
      p.life -= dt; if (p.life <= 0) { p.on = false; continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
    }
  }
  function drawParticles(g, x0, y0, x1, y1, top) {
    let lastC = null;
    for (let i = 0; i < MAXP; i++) {
      const p = parts[i]; if (!p.on) continue;
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      const k = 1 - p.life / p.max, isTop = p.t === P_SPARK || p.t === P_FLAME || p.t === P_CONF;
      if (isTop !== top) continue;
      const sz = lerp(p.s0, p.s1, k);
      if (p.t === P_SPARK) {
        g.globalCompositeOperation = 'lighter'; g.globalAlpha = (1 - k) * p.a; g.strokeStyle = p.c; g.lineWidth = Math.max(1.2, sz);
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); g.stroke();
      } else if (p.t === P_FLAME) {
        g.globalCompositeOperation = 'lighter'; g.globalAlpha = (1 - k) * p.a; g.fillStyle = p.c;
        g.beginPath(); g.arc(p.x, p.y, sz, 0, TAU); g.fill();
      } else if (p.t === P_CONF) {
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = Math.min(1, (1 - k) * 2) * p.a; g.fillStyle = p.c;
        g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillRect(-sz, -sz * 0.45, sz * 2, sz * 0.9); g.restore();
      } else {
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = Math.sin(Math.min(1, k * 4) * 1.5708) * (1 - k) * p.a;
        if (p.c !== lastC) { g.fillStyle = p.c; lastC = p.c; }
        g.beginPath(); g.arc(p.x, p.y, sz, 0, TAU); g.fill();
      }
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  function sparks(x, y, nx, ny, n, power) {
    if (LOWQ()) n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(ny, nx) + (Math.random() - 0.5) * 2.2, v = (0.4 + Math.random()) * power;
      spawn(P_SPARK, x, y, Math.cos(a) * v, Math.sin(a) * v, 0.25 + Math.random() * 0.35, 2.2, 1, Math.random() < 0.5 ? '#ffd36a' : '#fff6c8', 1, 2.5);
    }
  }

  /* skid marks (ring buffer) */
  const SK = 2200;
  const skid = { x1: new Float32Array(SK), y1: new Float32Array(SK), x2: new Float32Array(SK), y2: new Float32Array(SK), n: 0, head: 0 };
  function addSkid(x1, y1, x2, y2) {
    const i = skid.head; skid.x1[i] = x1; skid.y1[i] = y1; skid.x2[i] = x2; skid.y2[i] = y2;
    skid.head = (i + 1) % SK; skid.n = Math.min(SK, skid.n + 1);
  }

  /* ------------------------------------------------------------------ *
   *  Race state
   * ------------------------------------------------------------------ */
  const app = { state: 'menu', prev: 'racing', time: 0, hooks: {} };
  let race = null;
  let gridFlip = false;
  const cam = { x: 0, y: 0, zoom: 0.5, shake: 0 };
  const view = { w: 1280, h: 720, dpr: 1 };

  function hook(n, a) { if (app.hooks[n]) app.hooks[n](a); }

  function newRace(cfg, attract) {
    const sc = getScene(cfg.track), tr = sc.tr;
    skid.n = 0; skid.head = 0;
    parts.forEach((p) => { p.on = false; });
    A.stopEngines();
    const cars = [makeCar(0, attract ? { design: (Math.random() * 6) | 0, color: '#29a3ff', bot: true } : { bot: !!cfg.bots }),
      makeCar(1, attract ? { design: (Math.random() * 6) | 0, color: '#ff8a1f', bot: true } : { bot: !!cfg.bots })];
    if (attract) {
      cars[0].specs = specsFor(cars[0].design, [2, 2, 2, 2]); cars[1].specs = specsFor(cars[1].design, [2, 2, 2, 2]);
      cars[0].nitro = cars[0].specs.nitroCap; cars[1].nitro = cars[1].specs.nitroCap;
      const s0 = Math.random() * tr.L;
      placeAt(cars[0], tr, s0, -40); placeAt(cars[1], tr, s0 - 150, 40);
      cars.forEach((c) => { c.started = true; });
    } else {
      gridFlip = cfg.flip != null ? cfg.flip : !gridFlip;
      const lat = gridFlip ? [50, -50] : [-50, 50];
      placeAt(cars[0], tr, -90, lat[0]); placeAt(cars[1], tr, -90, lat[1]);
      cars.forEach((c) => { c.total = -90; c.lastS = c.s; });
    }
    race = {
      cfg, mode: attract ? 'attract' : cfg.mode, track: tr, scene: sc, laps: cfg.mode === 'practice' ? Infinity : cfg.laps,
      cars, t: 0, cd: 3.6, goT: 0, endT: null, over: false, overT: 0, result: null, anim: 0,
      ghost: cfg.mode === 'tt', bumpCool: 0, amb: null, banner: null, lastBeep: 99
    };
    initAmbient();
    snapCamera();
  }

  function startRace(cfg) {
    A.ensure();
    clearInput();
    newRace(cfg, false);
    race.cars.forEach((c, i) => { c.engine = A.makeEngine(i === 0 ? -0.45 : 0.45); });
    setState('countdown');
    A.music.start('race', { root: THEMES[race.track.theme].root, bpm: THEMES[race.track.theme].bpm });
    A.music.duck(1);
  }
  function restartRace() { if (race && race.mode !== 'attract') startRace(Object.assign({}, race.cfg, { flip: !gridFlip })); }

  function goAttract(id) {
    A.stopEngines();
    newRace({ track: id || TRACK_DEFS[(Math.random() * TRACK_DEFS.length) | 0].id, mode: 'attract', laps: 99 }, true);
    setState('menu');
    A.music.start('menu'); A.music.duck(1);
  }

  function setState(s) { app.state = s; hook('state', s); }

  function pause() {
    if (app.state !== 'racing' && app.state !== 'countdown') return;
    app.prev = app.state; setState('paused');
    A.silenceEngines(); A.music.duck(0.35); clearInput();
  }
  function resume() {
    if (app.state !== 'paused') return;
    clearInput(); setState(app.prev); A.music.duck(1);
  }

  /* ------------------------------------------------------------------ *
   *  Bot controller (attract mode, post-finish cruising, tests)
   * ------------------------------------------------------------------ */
  function botControl(c, tr, speedScale) {
    const N = tr.n, sp = Math.max(c.speed, 60);
    const k = Math.round((150 + sp * 0.26) / SPACING), ti = (c.idx + k) % N;
    const lane = c.botLane || 0, tx = tr.px[ti] + tr.nx[ti] * lane, ty = tr.py[ti] + tr.ny[ti] * lane;
    const want = Math.atan2(ty - c.y, tx - c.x), diff = angDiff(c.a, want);
    const k2 = Math.round((300 + sp * 0.55) / SPACING), turn = Math.abs(angDiff(tr.ang[(c.idx + 6) % N], tr.ang[(c.idx + k2) % N]));
    const target = c.specs.maxV * (1 - clamp(turn / 1.7, 0, 0.6)) * c.botSkill * (speedScale || 1);
    const ctl = { up: c.vf < target, down: c.vf > target * 1.18 + 40, left: diff < -0.04, right: diff > 0.04, nitro: false };
    ctl.steerAmt = clamp(diff * 2.4, -1, 1);
    ctl.nitro = !c.auto && turn < 0.12 && Math.abs(diff) < 0.1 && c.nitro > c.specs.nitroCap * 0.5 && c.vf > c.specs.maxV * 0.8;
    return ctl;
  }

  /* ------------------------------------------------------------------ *
   *  Physics
   * ------------------------------------------------------------------ */
  function controlsFor(c, tr, racing) {
    if (!racing && !c.auto) return { up: false, down: false, left: false, right: false, nitro: false };
    if (c.auto) return botControl(c, tr, 0.4);
    if (c.bot) return botControl(c, tr, 1);
    const i = input[c.p];
    return { up: !!i.up, down: !!i.down, left: !!i.left, right: !!i.right, nitro: !!i.nitro };
  }

  function stepCar(c, dt, tr, racing) {
    const sp = c.specs, ctl = controlsFor(c, tr, racing);
    c.ctl = ctl;
    const ca = Math.cos(c.a), sa = Math.sin(c.a);
    let vf = c.vx * ca + c.vy * sa, vl = -c.vx * sa + c.vy * ca;
    const throttle = ctl.up ? 1 : 0, brake = ctl.down ? 1 : 0;
    const off = c.offroad;

    // nitro
    if (c.nitroLock && c.nitro >= sp.nitroCap * 0.2) c.nitroLock = false;
    let nOn = ctl.nitro && !c.nitroLock && c.nitro > 0 && racing;
    if (nOn) {
      c.nitro -= NITRO_USE * dt; c.nitroIdle = 0;
      if (c.nitro <= 0) { c.nitro = 0; c.nitroLock = true; nOn = false; }
    } else {
      c.nitroIdle += dt;
      if (c.nitroIdle > 0.8) c.nitro = Math.min(sp.nitroCap, c.nitro + NITRO_REGEN * dt);
    }
    if (nOn && !c.nitroWas && !c.bot && !c.auto) A.sfx.nitro();
    if (ctl.nitro && !nOn && !c.nitroWas && racing && !c.bot && !c.auto) A.sfx.nitroEmpty();
    c.nitroWas = ctl.nitro; c.nitroOn = nOn;

    let maxV = sp.maxV * (off ? 0.5 : 1);
    if (nOn) maxV *= off ? 1.2 : 1.32;

    if (throttle) vf += (vf < 0 ? sp.brake : sp.accel * (nOn ? 1.9 : 1) * Math.max(0, 1 - vf / maxV)) * dt;
    else if (nOn) vf += sp.accel * 0.9 * Math.max(0, 1 - vf / maxV) * dt;
    if (brake) {
      if (vf > 12) vf -= sp.brake * dt;
      else vf -= sp.accel * 0.55 * Math.max(0, 1 + vf / (sp.maxV * 0.33)) * dt;
    }
    const drag = (off ? 1.8 : 0.08) + (throttle || brake || nOn ? 0 : 0.4);
    vf -= vf * drag * dt;
    if (!throttle && !brake && !nOn) { const f = 45 * dt; vf = Math.abs(vf) < f ? 0 : vf - Math.sign(vf) * f; }
    if (vf > maxV) vf -= (vf - maxV) * (nOn ? 0 : 2.4) * dt;
    if (vf < -sp.maxV * 0.33) vf = -sp.maxV * 0.33;

    // lateral grip / drift
    if (!c.sliding && Math.abs(vl) > 115) c.sliding = true;
    else if (c.sliding && Math.abs(vl) < 55) c.sliding = false;
    let grip = sp.grip * (off ? 1.1 : 1) * (c.sliding ? 0.62 : 1) * (brake && vf > 100 ? 0.8 : 1);
    vl *= Math.exp(-grip * dt);

    // steering
    const steerT = ctl.steerAmt != null ? ctl.steerAmt : (ctl.right ? 1 : 0) - (ctl.left ? 1 : 0);
    c.steer += (steerT - c.steer) * Math.min(1, dt * 9);
    const af = Math.abs(vf), sf = Math.min(1, af / 110) * (1 - 0.5 * Math.min(1.3, af / sp.maxV));
    const wT = c.steer * sp.turn * sf * (vf >= 0 ? 1 : -1) * (c.sliding ? 1.12 : 1);
    c.ang += (wT - c.ang) * Math.min(1, dt * 10);
    c.spin *= Math.exp(-4 * dt);

    c.vx = vf * ca - vl * sa; c.vy = vf * sa + vl * ca;
    c.a += (c.ang + c.spin) * dt;
    c.x += c.vx * dt; c.y += c.vy * dt;
    c.vf = vf; c.vl = vl; c.speed = Math.hypot(c.vx, c.vy);
    c.braking = !!brake && vf > 12; c.reversing = !!brake && vf < -12; c.throttle = throttle;
    c.steerVis = c.steer;
    if (c.ghostT > 0) c.ghostT -= dt;
  }

  function wallCollide(c, tr, dt) {
    locate(c, tr, false);
    const lim = tr.wallOff[c.idx] - 21;
    c.offroad = c.dist > tr.roadHalf + tr.curb * 0.6;
    if (c.dist <= lim) return;
    const nx = (c.cx - c.x) / c.dist, ny = (c.cy - c.y) / c.dist;
    c.x = c.cx - nx * lim; c.y = c.cy - ny * lim;
    const vn = c.vx * nx + c.vy * ny; // negative = moving into the wall
    if (vn < 0) {
      const impact = -vn;
      c.vx -= 1.3 * vn * nx; c.vy -= 1.3 * vn * ny;
      c.vx *= 1 - 0.06; c.vy *= 1 - 0.06;
      if (impact > 70) {
        sparks(c.x - nx * 20, c.y - ny * 20, nx, ny, Math.min(14, (impact / 25) | 0), 220 + impact);
        if (race && race.mode !== 'attract') { cam.shake = Math.max(cam.shake, Math.min(1, impact / 450)); if (c.lastWall <= 0) A.sfx.collide(impact / 500); }
        c.lastWall = 0.2;
      }
      // glance: align with the wall so the car slides instead of sticking
      const tx = -ny, ty = nx, fw = Math.cos(c.a) * tx + Math.sin(c.a) * ty, sgn = fw >= 0 ? 1 : -1;
      const tang = Math.atan2(ty * sgn, tx * sgn);
      if (impact < Math.max(120, c.speed * 0.7)) c.a += angDiff(c.a, tang) * Math.min(1, 6 * dt);
      else c.spin += angDiff(c.a, tang) * 0.5 * -Math.sign(c.vf || 1) * 0 + (Math.random() - 0.5) * 1.2;
    }
    const k = Math.exp(-2.2 * dt); c.vx *= k; c.vy *= k;
    if (c.speed > 200 && race && race.mode !== 'attract' && Math.random() < 0.15) { sparks(c.x - nx * 21, c.y - ny * 21, nx, ny, 2, 160); if (Math.random() < 0.2) A.sfx.scrape(); }
  }

  function carCarCollide(a, b) {
    const offs = [-20, 0, 20], R = 15;
    let best = 0, bx = 0, by = 0, nx = 0, ny = 0;
    const ca = Math.cos(a.a), sa = Math.sin(a.a), cb = Math.cos(b.a), sb = Math.sin(b.a);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const ax = a.x + ca * offs[i], ay = a.y + sa * offs[i], bx2 = b.x + cb * offs[j], by2 = b.y + sb * offs[j];
      const dx = ax - bx2, dy = ay - by2, d = Math.hypot(dx, dy), pen = 2 * R - d;
      if (pen > best) { best = pen; const dd = d || 1; nx = dx / dd; ny = dy / dd; bx = (ax + bx2) / 2; by = (ay + by2) / 2; if (!d) { nx = 1; ny = 0; } }
    }
    if (best <= 0) return;
    a.x += nx * best / 2; a.y += ny * best / 2; b.x -= nx * best / 2; b.y -= ny * best / 2;
    const rvn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (rvn < 0) {
      const J = -(1 + 0.45) * rvn / 2;
      a.vx += J * nx; a.vy += J * ny; b.vx -= J * nx; b.vy -= J * ny;
      a.spin = clamp(a.spin + ((bx - a.x) * (J * ny) - (by - a.y) * (J * nx)) * 0.0006, -5, 5);
      b.spin = clamp(b.spin - ((bx - b.x) * (J * ny) - (by - b.y) * (J * nx)) * 0.0006, -5, 5);
      const k = Math.min(1, -rvn / 500);
      if (-rvn > 60) {
        sparks(bx, by, nx, ny, Math.min(18, 4 + ((-rvn / 30) | 0)), 200 + -rvn);
        cam.shake = Math.max(cam.shake, k * 0.9);
        if (race.bumpCool <= 0) { A.sfx.collide(k); race.bumpCool = 0.12; }
      }
    }
  }

  function resetToTrack(c, tr) {
    locate(c, tr, true);
    const i = c.idx;
    c.x = tr.px[i]; c.y = tr.py[i]; c.a = tr.ang[i];
    c.vx = c.vy = c.ang = c.spin = c.steer = 0; c.stuckT = 0; c.ghostT = 2; c.offroad = false;
    c.lastS = c.s; locate(c, tr, true); c.lastS = c.s;
    c.wheelPrev = [null, null];
    sparks(c.x, c.y, 0, -1, 10, 180);
    if (!c.bot) { A.sfx.reset(); setMsg(c, 'BACK ON TRACK', '#19f0ff', 1.4); }
  }

  function setMsg(c, text, color, dur) { c.msg = { text, color, t: dur || 2, max: dur || 2 }; }

  /* ------------------------------------------------------------------ *
   *  Race update
   * ------------------------------------------------------------------ */
  function physicsStep(dt) {
    const tr = race.track, racing = app.state === 'racing' && race.mode !== 'attract' || race.mode === 'attract';
    const [a, b] = race.cars;
    race.cars.forEach((c) => { stepCar(c, dt, tr, racing); wallCollide(c, tr, dt); c.lastWall -= dt; });
    race.bumpCool -= dt;
    if (!race.ghost && a.ghostT <= 0 && b.ghostT <= 0) carCollide(a, b);
  }
  function carCollide(a, b) { if (Math.hypot(a.x - b.x, a.y - b.y) < 130) carCarCollide(a, b); }

  function updateRaceLogic(dt) {
    const tr = race.track, L = tr.L, racing = app.state === 'racing' && !race.over;
    race.cars.forEach((c, i) => {
      // progress (unwrapped so reversing can never gain laps)
      let ds = c.s - c.lastS; if (ds < -L / 2) ds += L; else if (ds > L / 2) ds -= L;
      c.lastS = c.s;
      if (race.mode !== 'attract' && app.state !== 'countdown') c.total += ds;
      c.topSpeed = Math.max(c.topSpeed, c.speed * KMH);

      // wrong way
      const fwd = Math.cos(c.a - tr.ang[c.idx]);
      if (fwd < -0.35 && c.speed > 90 && !c.finished) c.wrongT += dt; else c.wrongT = Math.max(0, c.wrongT - dt * 2);
      c.wrong = c.wrongT > 0.9;

      if (c.msg) { c.msg.t -= dt; if (c.msg.t <= 0) c.msg = null; }
      if (race.mode === 'attract') {
        if (c.stuckT > 2.5) resetToTrack(c, tr);
        c.stuckT = c.speed < 25 ? c.stuckT + dt : 0;
        return;
      }
      if (!racing) return;
      // stuck recovery
      const trying = !c.bot && !c.finished && (c.ctl.up || c.ctl.down);
      c.stuckT = trying && c.speed < 60 ? c.stuckT + dt : (c.bot && c.speed < 25 ? c.stuckT + dt : Math.max(0, c.stuckT - dt));
      if (resetEdge[i] && !c.bot && !c.finished) { resetEdge[i] = false; resetToTrack(c, tr); }
      else if (c.stuckT > (c.bot ? 2.5 : 3.2)) resetToTrack(c, tr);

      // laps
      while (!c.finished && c.total >= (c.laps + 1) * L) {
        c.laps++;
        const over = c.total - c.laps * L, tcross = Math.max(c.lapStart, race.t - over / Math.max(c.speed, 60));
        const lt = tcross - c.lapStart; c.lapStart = tcross; c.lapTimes.push(lt);
        const isBest = lt < c.bestLap; if (isBest) c.bestLap = lt;
        if (c.laps >= race.laps) {
          c.finished = true; c.finishTime = tcross; c.auto = true;
          if (!race.endT) race.endT = FINISH_GRACE;
          setMsg(c, 'FINISHED!', '#ffe033', 99);
          if (!c.bot) { A.sfx.finish(); }
        } else {
          setMsg(c, 'LAP ' + (c.laps + 1) + '/' + (race.laps === Infinity ? '∞' : race.laps) + '  ' + fmt(lt) + (isBest && c.laps > 1 ? '  BEST!' : ''), isBest ? '#7dff3a' : '#e8f6ff', 2.6);
          (isBest && c.laps > 1 ? A.sfx.bestLap : A.sfx.lap)();
        }
      }
    });
    if (!racing || race.mode === 'practice') return;
    race.t += dt;
    if (race.endT != null) {
      race.endT -= dt;
      if (race.cars.every((c) => c.finished) || race.endT <= 0) finishRace();
    }
  }

  function rankOrder() {
    const cs = race.cars.slice();
    cs.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1; if (b.finished) return 1;
      return b.total - a.total;
    });
    return cs;
  }

  function finishRace() {
    if (race.over) return;
    race.over = true; race.overT = 0;
    const order = rankOrder();
    race.cars.forEach((c) => { if (!c.finished) c.auto = true; });
    const winner = race.mode === 'practice' ? null : order[0];
    race.result = { order: order.map((c) => c.p), winner: winner ? winner.p : -1, mode: race.mode, track: race.track.id, laps: race.laps,
      cars: race.cars.map((c) => ({ p: c.p, finished: c.finished, time: c.finishTime, best: c.bestLap, top: c.topSpeed, laps: c.laps, lapTimes: c.lapTimes.slice(), name: DESIGNS[c.design].name, color: c.color })) };
    const bl = Math.min(race.cars[0].bestLap, race.cars[1].bestLap);
    if (isFinite(bl)) {
      const prev = save.bests[race.track.id];
      if (!prev || bl < prev) { save.bests[race.track.id] = bl; race.result.record = true; persist(); }
    }
    if (winner) {
      race.banner = { text: 'P' + (winner.p + 1) + ' WINS!', color: winner.color, t: 0 };
      const col = ['#ff2fd0', '#19f0ff', '#ffe033', '#7dff3a', winner.color, '#fff'];
      for (let i = 0; i < 160; i++) { const a = Math.random() * TAU, v = 150 + Math.random() * 600; spawn(P_CONF, winner.x, winner.y, Math.cos(a) * v, Math.sin(a) * v, 2.2 + Math.random(), 5 + Math.random() * 5, 4, col[(Math.random() * col.length) | 0], 1, 1.8); }
      A.sfx.win();
    }
  }

  function endRaceNow() { if (race && race.mode !== 'attract' && !race.over) { resume(); finishRace(); } }

  function update(dt) {
    app.time += dt;
    if (!race || app.state === 'paused') return;
    race.anim += dt;
    const st = app.state;
    if (st === 'countdown') {
      race.cd -= dt;
      const n = Math.ceil(race.cd);
      if (n <= 3 && n >= 1 && n < race.lastBeep) { race.lastBeep = n; A.sfx.beep(); }
      if (race.cd <= 0) { race.goT = 0.9; race.cars.forEach((c) => { c.started = true; }); setState('racing'); A.sfx.go(); }
    }
    if (st === 'racing' || st === 'menu' || st === 'results') {
      const steps = Math.max(1, Math.ceil(dt / (1 / 100))), h = dt / steps;
      for (let i = 0; i < steps; i++) physicsStep(h);
      updateRaceLogic(dt);
    } else if (st === 'countdown') {
      race.cars.forEach((c) => { if (c.idx < 0) locate(c, race.track, true); });
    }
    if (race.goT > 0) race.goT -= dt;
    if (race.over) {
      race.overT += dt;
      if (race.overT > 2.2 && app.state === 'racing') { setState('results'); A.music.start('menu'); hook('results', race.result); }
    }
    race.cars.forEach((c) => emitCarFx(c, dt));
    updateParticles(dt);
    updateCamera(dt);
    cam.shake = Math.max(0, cam.shake - dt * 2.4);
    updateAudio();
  }

  function emitCarFx(c, dt) {
    const d = DESIGNS[c.design], w = d.wheels, ca = Math.cos(c.a), sa = Math.sin(c.a), lq = LOWQ() ? 0.5 : 1;
    const slip = clamp((Math.abs(c.vl) - 60) / 170, 0, 1);
    const hardBrake = c.braking && c.vf > 260 ? 0.6 : 0;
    c.slip = Math.max(slip, hardBrake);
    const th = race.scene.th;
    for (let s = -1; s <= 1; s += 2) {
      const wx = c.x + ca * w.rx - sa * w.y * s, wy = c.y + sa * w.rx + ca * w.y * s, k = s < 0 ? 0 : 1;
      if (c.slip > 0.2 && !c.offroad && c.speed > 80) {
        if (Math.random() < dt * 55 * c.slip * lq) spawn(P_SMOKE, wx, wy, -c.vx * 0.15 + (Math.random() - 0.5) * 40, -c.vy * 0.15 + (Math.random() - 0.5) * 40, 0.7 + Math.random() * 0.6, 7, 22, 'rgb(225,230,240)', 0.55, 1.6);
        const pv = c.wheelPrev[k];
        if (pv && Math.hypot(wx - pv[0], wy - pv[1]) > 7) { addSkid(pv[0], pv[1], wx, wy); c.wheelPrev[k] = [wx, wy]; }
        else if (!pv) c.wheelPrev[k] = [wx, wy];
      } else c.wheelPrev[k] = null;
      if (c.offroad && c.speed > 110 && Math.random() < dt * 60 * lq) {
        const col = th.dust;
        spawn(P_DUST, wx, wy, -c.vx * 0.2 + (Math.random() - 0.5) * 90, -c.vy * 0.2 + (Math.random() - 0.5) * 90, 0.5 + Math.random() * 0.6, 5, 20, 'rgb(' + col[0] + ',' + col[1] + ',' + col[2] + ')', 0.6, 2);
      }
    }
    if (c.nitroOn) {
      const n = (LOWQ() ? 2 : 4);
      for (let i = 0; i < n; i++) {
        const side = Math.random() < 0.5 ? -1 : 1, ex = c.x + ca * (w.rx - 14) - sa * 5.5 * side, ey = c.y + sa * (w.rx - 14) + ca * 5.5 * side;
        const col = ['#ffffff', shade(c.color, 0.5), c.color, '#ff2fd0'][(Math.random() * 4) | 0];
        spawn(P_FLAME, ex, ey, -ca * 260 + c.vx * 0.6 + (Math.random() - 0.5) * 80, -sa * 260 + c.vy * 0.6 + (Math.random() - 0.5) * 80, 0.25 + Math.random() * 0.25, 7, 1.5, col, 0.55, 3);
      }
    }
  }

  function updateAudio() {
    if (!race || !A.ready) return;
    const active = (app.state === 'racing' || app.state === 'countdown') && race.mode !== 'attract';
    if (!active) { if (app.state !== 'paused') A.silenceEngines(); return; }
    race.cars.forEach((c) => {
      if (!c.engine) return;
      const sf = clamp(c.speed / c.specs.maxV, 0, 1.4);
      c.engine.update(sf, c.throttle || (app.state === 'countdown' ? 0.2 : 0), c.slip, c.nitroOn, c.offroad, true);
    });
  }

  /* ------------------------------------------------------------------ *
   *  Camera
   * ------------------------------------------------------------------ */
  function camTarget() {
    const [a, b] = race.cars, W = view.w, H = view.h;
    const base = clamp(Math.min(W / 1600, H / 900), 0.55, 1.5);
    let cx, cy, zoom;
    if (race.mode === 'attract') {
      cx = (a.x + b.x) / 2 + (a.vx + b.vx) * 0.12; cy = (a.y + b.y) / 2 + (a.vy + b.vy) * 0.12; zoom = base * 0.85;
      return { cx, cy, zoom };
    }
    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
    const fit = Math.min(W / (dx + 620), H / (dy + 560));
    zoom = clamp(fit, base * 0.34, base * 1.0);
    const sf = (a.speed + b.speed) / (a.specs.maxV + b.specs.maxV);
    zoom *= 1 - 0.07 * Math.min(1, sf);
    if (a.nitroOn || b.nitroOn) zoom *= 0.96;
    cx = (a.x + b.x) / 2 + (a.vx + b.vx) * 0.14; cy = (a.y + b.y) / 2 + (a.vy + b.vy) * 0.14;
    // keep the leader on screen even when the pair cannot fit
    const lead = rankOrder()[0], hw = W / (2 * zoom) - 260, hh = H / (2 * zoom) - 240;
    cx = clamp(cx, lead.x - hw, lead.x + hw); cy = clamp(cy, lead.y - hh, lead.y + hh);
    return { cx, cy, zoom };
  }
  function snapCamera() { const t = camTarget(); cam.x = t.cx; cam.y = t.cy; cam.zoom = t.zoom * (race.mode === 'attract' ? 1 : 0.55); }
  function updateCamera(dt) {
    const t = camTarget(), k = 1 - Math.exp(-5.5 * dt), kz = 1 - Math.exp(-2.6 * dt);
    cam.x += (t.cx - cam.x) * k; cam.y += (t.cy - cam.y) * k; cam.zoom += (t.zoom - cam.zoom) * kz;
  }

  /* ------------------------------------------------------------------ *
   *  Rendering helpers
   * ------------------------------------------------------------------ */
  function fmt(t) {
    if (!isFinite(t)) return '--:--.--';
    const m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }
  const ord = (n) => (n === 1 ? '1ST' : n === 2 ? '2ND' : n + 'TH');

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = window.innerWidth, h = window.innerHeight, d = dpr;
    if (w * h * d * d > 4.2e6 * 1.6) d = Math.max(1, Math.sqrt((4.2e6 * 1.6) / (w * h)));
    view.w = w; view.h = h; view.dpr = d;
    mainCanvas.width = Math.round(w * d); mainCanvas.height = Math.round(h * d);
    makeVignette();
  }
  let vignette = null;
  function makeVignette() {
    vignette = document.createElement('canvas'); vignette.width = 256; vignette.height = 144;
    const g = vignette.getContext('2d'), gr = g.createRadialGradient(128, 72, 40, 128, 72, 160);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.55)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 144);
  }

  function initAmbient() {
    const n = LOWQ() ? 24 : 55;
    race.amb = [];
    for (let i = 0; i < n; i++) race.amb.push({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random(), p: Math.random() * TAU });
  }

  /* ----------------------------- scenery ----------------------------- */
  const rr = (seed, i) => { const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return x - Math.floor(x); };

  function drawBuilding(g, o, t) {
    const w = o.w, h = o.h, hx = w / 2, hy = h / 2;
    g.save(); g.translate(o.x, o.y);
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(-hx + 12, -hy + 14, w, h);
    const gr = g.createLinearGradient(-hx, -hy, hx, hy);
    gr.addColorStop(0, '#1e2548'); gr.addColorStop(1, '#0d1128');
    g.fillStyle = gr; g.fillRect(-hx, -hy, w, h);
    g.strokeStyle = 'hsl(' + o.hue + ',100%,62%)'; g.lineWidth = 3; g.strokeRect(-hx + 1.5, -hy + 1.5, w - 3, h - 3);
    g.fillStyle = '#161c3c'; g.fillRect(-hx + 10, -hy + 10, w - 20, h - 20);
    for (let i = 0; i < o.lvl + 1; i++) {
      const bw = 18 + rr(o.x, i) * 36, bh = 14 + rr(o.y, i) * 30, bx = (rr(o.x + 3, i) - 0.5) * (w - bw - 30), by = (rr(o.y + 5, i) - 0.5) * (h - bh - 30);
      g.fillStyle = '#242c58'; g.fillRect(bx - bw / 2, by - bh / 2, bw, bh);
      g.fillStyle = 'hsla(' + o.hue + ',100%,60%,.4)'; g.fillRect(bx - bw / 2, by - bh / 2, bw, 3);
    }
    if (o.k === 0) { g.fillStyle = '#0a0e22'; g.beginPath(); g.arc(hx * 0.4, hy * 0.3, Math.min(hx, hy) * 0.28, 0, TAU); g.fill(); g.strokeStyle = 'rgba(120,150,255,.5)'; g.lineWidth = 2; g.stroke(); }
    g.fillStyle = (Math.floor(t * 1.3 + o.x) & 1) ? '#ff2a3a' : '#5a1018'; g.beginPath(); g.arc(-hx + 18, -hy + 18, 3.2, 0, TAU); g.fill();
    g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'hsla(' + o.hue + ',100%,60%,.16)'; g.lineWidth = 14; g.strokeRect(-hx, -hy, w, h);
    g.restore();
  }
  function drawRock(g, o) {
    g.save(); g.translate(o.x, o.y);
    const pts = []; for (let i = 0; i < 9; i++) { const a = i / 9 * TAU, rv = o.r * (0.7 + rr(o.seed, i) * 0.4); pts.push([Math.cos(a) * rv, Math.sin(a) * rv]); }
    const path = () => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
    g.save(); g.translate(o.r * 0.25, o.r * 0.3); g.fillStyle = 'rgba(70,40,10,.3)'; path(); g.fill(); g.restore();
    const gr = g.createLinearGradient(-o.r, -o.r, o.r, o.r); gr.addColorStop(0, '#c8946a'); gr.addColorStop(1, '#7a4c30');
    g.fillStyle = gr; path(); g.fill(); g.strokeStyle = 'rgba(60,30,10,.6)'; g.lineWidth = 2; g.stroke();
    g.fillStyle = 'rgba(255,225,180,.28)'; g.beginPath(); g.moveTo(pts[7][0] * 0.8, pts[7][1] * 0.8); g.lineTo(pts[0][0] * 0.5, pts[0][1] * 0.5); g.lineTo(pts[5][0] * 0.4, pts[5][1] * 0.4); g.lineTo(pts[6][0] * 0.8, pts[6][1] * 0.8); g.fill();
    g.restore();
  }
  function drawCactus(g, o) {
    g.save(); g.translate(o.x, o.y); g.rotate(o.a); g.scale(o.s, o.s);
    g.fillStyle = 'rgba(40,30,10,.28)'; g.beginPath(); g.ellipse(5, 7, 14, 10, 0, 0, TAU); g.fill();
    g.fillStyle = '#2f7a3a'; g.strokeStyle = '#1b4a22'; g.lineWidth = 1.5;
    [[0, 0, 11], [-14, 2, 6], [14, -2, 6], [0, -14, 6]].forEach((c) => { g.beginPath(); g.arc(c[0], c[1], c[2], 0, TAU); g.fill(); g.stroke(); });
    g.fillStyle = '#5bb868'; g.beginPath(); g.arc(-2, -2, 5, 0, TAU); g.fill();
    g.restore();
  }
  function drawTree(g, o) {
    g.save(); g.translate(o.x, o.y);
    g.fillStyle = 'rgba(0,15,5,.35)'; g.beginPath(); g.ellipse(o.r * 0.25, o.r * 0.3, o.r, o.r * 0.9, 0, 0, TAU); g.fill();
    const pal = [['#14401f', '#1f6a2e', '#3f9a47'], ['#17482a', '#26753a', '#52ad55'], ['#2b4a1a', '#477a2a', '#7ab33e'], ['#1a3d2e', '#2a6a4e', '#4aa07a'], ['#3b4a18', '#69801f', '#a2b73a']][o.v % 5];
    if (o.t === 'tree') {
      g.fillStyle = pal[0]; g.beginPath(); g.arc(0, 0, o.r, 0, TAU); g.fill();
      g.fillStyle = pal[1]; for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + o.seed; g.beginPath(); g.arc(Math.cos(a) * o.r * 0.42, Math.sin(a) * o.r * 0.42, o.r * 0.55, 0, TAU); g.fill(); }
      g.fillStyle = pal[2]; g.beginPath(); g.arc(-o.r * 0.22, -o.r * 0.25, o.r * 0.38, 0, TAU); g.fill();
    } else if (o.t === 'pine') {
      for (let l = 0; l < 3; l++) {
        const R = o.r * (1 - l * 0.28); g.fillStyle = pal[l]; g.beginPath();
        for (let i = 0; i < 16; i++) { const a = i / 16 * TAU, rv = i % 2 ? R * 0.62 : R; g.lineTo(Math.cos(a) * rv, Math.sin(a) * rv); }
        g.closePath(); g.fill();
      }
    } else { g.fillStyle = pal[1]; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(Math.cos(i * 1.7 + o.seed) * o.r * 0.5, Math.sin(i * 1.7 + o.seed) * o.r * 0.5, o.r * 0.55, 0, TAU); g.fill(); } g.fillStyle = pal[2]; g.beginPath(); g.arc(-2, -3, o.r * 0.35, 0, TAU); g.fill(); }
    g.restore();
  }
  function drawScenery(g, o, t, x0, y0, x1, y1) {
    if (o.x + o.r < x0 || o.x - o.r > x1 || o.y + o.r < y0 || o.y - o.r > y1) return;
    switch (o.t) {
      case 'bld': drawBuilding(g, o, t); break;
      case 'sign': {
        g.save(); g.translate(o.x, o.y); g.rotate(o.a);
        g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(-o.len / 2 + 6, -3 + 8, o.len, 14);
        g.fillStyle = '#0c1024'; g.fillRect(-o.len / 2, -9, o.len, 16);
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = 'hsla(' + o.hue + ',100%,60%,.9)'; g.fillRect(-o.len / 2 + 4, -5, o.len - 8, 8);
        g.fillStyle = 'hsla(' + o.hue + ',100%,60%,.18)'; g.fillRect(-o.len / 2 - 10, -22, o.len + 20, 40);
        g.restore(); break;
      }
      case 'rock': drawRock(g, o); break;
      case 'cac': drawCactus(g, o); break;
      case 'flag': {
        g.save(); g.translate(o.x, o.y); g.rotate(o.a);
        g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(-28, -5, 60, 14);
        g.fillStyle = ['#e0382b', '#2d9cdb', '#f2c230'][o.hue]; g.fillRect(-30, -8, 60, 14);
        g.fillStyle = '#fff'; g.fillRect(-30, -2, 60, 3);
        g.restore(); break;
      }
      case 'tree': case 'pine': case 'bush': drawTree(g, o); break;
    }
  }

  function drawRiver(g, sc, now) {
    const rv = sc.tr.def.river; if (!rv) return;
    g.lineJoin = 'round'; g.lineCap = 'round';
    const path = () => { g.beginPath(); rv.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); };
    g.strokeStyle = '#3d5a2a'; g.lineWidth = 250; path();
    g.strokeStyle = '#1b5078'; g.lineWidth = 190; path();
    g.strokeStyle = '#2c86b8'; g.lineWidth = 150; path();
    g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 3; g.setLineDash([40, 90]); g.lineDashOffset = -now * 40; path();
    g.lineDashOffset = now * 25 + 50; g.lineWidth = 2; g.setLineDash([24, 110]); path(); g.setLineDash([]); g.lineDashOffset = 0;
  }

  function drawBridges(g, sc) {
    const tr = sc.tr, N = tr.n, half = tr.roadHalf + tr.curb + 10;
    tr.bridges.forEach(([a, b]) => {
      const i0 = a - 1, i1 = b + 1;
      g.fillStyle = '#5c3f24'; g.beginPath();
      for (let i = i0; i <= i1; i++) { const j = (i + N) % N; g.lineTo(tr.px[j] - tr.nx[j] * half, tr.py[j] - tr.ny[j] * half); }
      for (let i = i1; i >= i0; i--) { const j = (i + N) % N; g.lineTo(tr.px[j] + tr.nx[j] * half, tr.py[j] + tr.ny[j] * half); }
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3; g.beginPath();
      for (let i = i0; i <= i1; i += 2) { const j = (i + N) % N; g.moveTo(tr.px[j] - tr.nx[j] * half, tr.py[j] - tr.ny[j] * half); g.lineTo(tr.px[j] + tr.nx[j] * half, tr.py[j] + tr.ny[j] * half); }
      g.stroke();
    });
  }

  function drawRoad(g, sc, now, vx0, vy0, vx1, vy1) {
    const tr = sc.tr, th = sc.th, P = sc.P, pat = sc.pat, rw = tr.roadHalf * 2;
    g.lineJoin = 'round'; g.lineCap = 'butt';
    g.strokeStyle = pat.verge; g.lineWidth = tr.wallHalf * 2 + 40; g.stroke(P.center);
    if (tr.def.river) drawRiver(g, sc, now);
    g.strokeStyle = th.curbA; g.lineWidth = rw + tr.curb * 2; g.stroke(P.center);
    g.strokeStyle = th.curbB; g.setLineDash([36, 36]); g.stroke(P.center); g.setLineDash([]);
    g.strokeStyle = th.asphalt; g.lineWidth = rw; g.stroke(P.center);
    g.strokeStyle = pat.noise; g.stroke(P.center);
    if (tr.theme === 'city') {
      g.globalCompositeOperation = 'lighter';
      g.lineWidth = 26; g.strokeStyle = 'rgba(25,240,255,.1)'; g.stroke(P.glowL); g.strokeStyle = 'rgba(255,47,208,.1)'; g.stroke(P.glowR);
      g.lineWidth = 6; g.strokeStyle = 'rgba(25,240,255,.55)'; g.stroke(P.glowL); g.strokeStyle = 'rgba(255,47,208,.55)'; g.stroke(P.glowR);
      g.globalCompositeOperation = 'source-over';
    }
    g.strokeStyle = th.line; g.lineWidth = 4; g.stroke(P.edgeL); g.stroke(P.edgeR);
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 3; g.setLineDash([36, 52]); g.stroke(P.center); g.setLineDash([]);
    // direction chevrons
    g.fillStyle = 'rgba(255,255,255,.13)';
    sc.arrows.forEach((i) => {
      const x = tr.px[i], y = tr.py[i]; if (x < vx0 - 60 || x > vx1 + 60 || y < vy0 - 60 || y > vy1 + 60) return;
      g.save(); g.translate(x, y); g.rotate(tr.ang[i]);
      g.beginPath(); g.moveTo(26, 0); g.lineTo(-10, -30); g.lineTo(-22, -30); g.lineTo(10, 0); g.lineTo(-22, 30); g.lineTo(-10, 30); g.closePath(); g.fill(); g.restore();
    });
    // start / finish line + grid boxes
    g.save(); g.translate(tr.px[0], tr.py[0]); g.rotate(tr.ang[0]);
    const rows = 12, sq = rw / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < 2; c++) { g.fillStyle = (r + c) & 1 ? '#10131f' : '#f4f7ff'; g.fillRect(-sq + c * sq, -tr.roadHalf + r * sq, sq, sq); }
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 2;
    for (let s = -1; s <= 1; s += 2) g.strokeRect(-130, s * 50 - 20 + (s > 0 ? 0 : 0), 76, 40);
    g.restore();
    if (tr.bridges.length) drawBridges(g, sc);
    // barriers
    g.lineJoin = 'round';
    if (tr.theme === 'city') {
      g.strokeStyle = '#080b18'; g.lineWidth = 16; g.stroke(P.wallL); g.stroke(P.wallR);
      g.globalCompositeOperation = 'lighter';
      g.lineWidth = 26; g.strokeStyle = 'rgba(25,240,255,.12)'; g.stroke(P.wallL); g.strokeStyle = 'rgba(255,47,208,.12)'; g.stroke(P.wallR);
      g.lineWidth = 4; g.strokeStyle = 'rgba(25,240,255,.95)'; g.stroke(P.wallL); g.strokeStyle = 'rgba(255,47,208,.95)'; g.stroke(P.wallR);
      g.globalCompositeOperation = 'source-over';
    } else if (tr.theme === 'desert') {
      g.strokeStyle = '#4f361c'; g.lineWidth = 20; g.stroke(P.wallL); g.stroke(P.wallR);
      g.strokeStyle = '#d9a86a'; g.lineWidth = 15; g.setLineDash([22, 6]); g.stroke(P.wallL); g.stroke(P.wallR);
      g.strokeStyle = 'rgba(255,240,200,.45)'; g.lineWidth = 5; g.stroke(P.wallL); g.stroke(P.wallR); g.setLineDash([]);
    } else {
      g.strokeStyle = '#2d1d10'; g.lineWidth = 12; g.stroke(P.wallL); g.stroke(P.wallR);
      g.strokeStyle = '#8c6338'; g.lineWidth = 7; g.stroke(P.wallL); g.stroke(P.wallR);
      g.strokeStyle = '#4a321c'; g.lineWidth = 20; g.setLineDash([8, 52]); g.stroke(P.wallL); g.stroke(P.wallR); g.setLineDash([]);
    }
  }

  function drawGantry(g, tr, th) {
    g.save(); g.translate(tr.px[0], tr.py[0]); g.rotate(tr.ang[0]);
    const h = tr.roadHalf + tr.curb + 24;
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(6, -h + 10, 18, h * 2);
    g.fillStyle = '#0d1226'; g.fillRect(-9, -h, 18, h * 2);
    g.fillStyle = '#1b2448'; g.fillRect(-9, -h - 6, 18, 18); g.fillRect(-9, h - 12, 18, 18);
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = tr.theme === 'city' ? 'rgba(255,47,208,.9)' : 'rgba(255,230,120,.8)'; g.fillRect(-3, -h + 12, 6, h * 2 - 24);
    g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(-26, -h + 12, 52, h * 2 - 24);
    g.restore();
  }

  /* ----------------------------- world ----------------------------- */
  function drawWorld(now) {
    const sc = race.scene, tr = sc.tr, th = sc.th, g = ctx;
    const z = cam.zoom * view.dpr, shake = save.settings.shake ? cam.shake : 0;
    const sx = (Math.random() - 0.5) * 22 * shake * view.dpr, sy = (Math.random() - 0.5) * 22 * shake * view.dpr;
    g.setTransform(z, 0, 0, z, mainCanvas.width / 2 - cam.x * z + sx, mainCanvas.height / 2 - cam.y * z + sy);
    const hw = mainCanvas.width / (2 * z) + 60, hh = mainCanvas.height / (2 * z) + 60;
    const x0 = cam.x - hw, y0 = cam.y - hh, x1 = cam.x + hw, y1 = cam.y + hh;
    g.fillStyle = sc.pat.ground; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    // ground decals
    sc.ground.forEach((o) => {
      if (o.x + o.r < x0 || o.x - o.r > x1 || o.y + o.r < y0 || o.y - o.r > y1) return;
      if (o.t === 'dune') {
        g.save(); g.translate(o.x, o.y); g.rotate(o.a);
        g.fillStyle = 'rgba(150,100,45,.16)'; g.beginPath(); g.ellipse(0, 0, o.rx, o.ry, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,230,170,.16)'; g.beginPath(); g.ellipse(-o.rx * 0.08, -o.ry * 0.18, o.rx * 0.85, o.ry * 0.6, 0, 0, TAU); g.fill();
        g.restore();
      } else {
        g.fillStyle = ['#ffe45c', '#ff8ad8', '#ffffff', '#ff7a5c'][o.c]; g.beginPath(); g.arc(o.x, o.y, 3, 0, TAU); g.fill();
      }
    });
    drawRoad(g, sc, now, x0, y0, x1, y1);
    // skid marks
    if (skid.n) {
      g.strokeStyle = tr.theme === 'desert' ? 'rgba(20,12,5,.38)' : 'rgba(0,0,0,.42)'; g.lineWidth = 4.5; g.lineCap = 'round'; g.beginPath();
      for (let i = 0; i < skid.n; i++) {
        const ax = skid.x1[i], ay = skid.y1[i];
        if (ax < x0 || ax > x1 || ay < y0 || ay > y1) continue;
        g.moveTo(ax, ay); g.lineTo(skid.x2[i], skid.y2[i]);
      }
      g.stroke(); g.lineCap = 'butt';
    }
    // lamp pools & low scenery
    if (th.night) {
      const gl = getGlow('#ffd98a'); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.5;
      sc.lamps.forEach((o) => { if (o.x > x0 - 200 && o.x < x1 + 200 && o.y > y0 - 200 && o.y < y1 + 200) g.drawImage(gl, o.x - o.r, o.y - o.r, o.r * 2, o.r * 2); });
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    for (let i = 0; i < sc.low.length; i++) drawScenery(g, sc.low[i], now, x0, y0, x1, y1);
    drawParticles(g, x0, y0, x1, y1, false);
    // cars (rear one first)
    const order = race.cars.slice().sort((a, b) => a.y - b.y);
    order.forEach((c) => drawCar(g, c, now, { night: th.night, dusk: th.dusk }));
    race.cars.forEach((c) => { if (c.nitroOn) drawFlame(g, c, now, 1); });
    drawParticles(g, x0, y0, x1, y1, true);
    drawGantry(g, tr, th);
    for (let i = 0; i < sc.high.length; i++) drawScenery(g, sc.high[i], now, x0, y0, x1, y1);
  }

  function drawScreenFx(now) {
    const g = ctx, W = mainCanvas.width, H = mainCanvas.height, d = view.dpr, th = race.track.theme;
    g.setTransform(d, 0, 0, d, 0, 0);
    // ambient drifting particles
    const am = race.amb, vw = view.w, vh = view.h;
    if (am) {
      g.lineCap = 'round';
      for (let i = 0; i < am.length; i++) {
        const a = am[i];
        if (th === 'city') { const y = ((a.y + now * 0.9 * a.s) % 1) * vh, x = ((a.x - now * 0.25 * a.s) % 1 + 1) % 1 * vw; g.strokeStyle = 'rgba(160,220,255,.16)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 5, y - 26); g.stroke(); }
        else if (th === 'desert') { const x = ((a.x + now * 0.5 * a.s) % 1) * vw, y = (a.y + Math.sin(now + a.p) * 0.02) * vh; g.strokeStyle = 'rgba(255,230,180,.16)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 90 * a.s, y + 6); g.stroke(); }
        else { const y = ((a.y + now * 0.06 * a.s) % 1) * vh, x = ((a.x + Math.sin(now * 0.8 + a.p) * 0.03) % 1) * vw; g.fillStyle = a.p > 3 ? 'rgba(220,140,40,.5)' : 'rgba(120,200,80,.45)'; g.beginPath(); g.ellipse(x, y, 4, 2, a.p + now, 0, TAU); g.fill(); }
      }
      g.lineCap = 'butt';
    }
    if (race.mode !== 'attract') {
      // nitro speed lines
      race.cars.forEach((c) => {
        if (!c.nitroOn) return;
        const sxp = (c.x - cam.x) * cam.zoom + vw / 2, syp = (c.y - cam.y) * cam.zoom + vh / 2;
        g.globalCompositeOperation = 'lighter'; g.strokeStyle = rgba(c.color, 0.5); g.lineWidth = 2;
        g.beginPath();
        for (let k = 0; k < 26; k++) {
          const ph = (now * 2.6 + k * 0.381) % 1, an = k * 2.399 + Math.floor(now * 2.6 + k * 0.381) * 1.7, r0 = 150 + ph * 560, ln = 30 + ph * 150;
          g.moveTo(sxp + Math.cos(an) * r0, syp + Math.sin(an) * r0); g.lineTo(sxp + Math.cos(an) * (r0 + ln), syp + Math.sin(an) * (r0 + ln));
        }
        g.stroke(); g.globalCompositeOperation = 'source-over';
      });
    }
    g.drawImage(vignette, 0, 0, vw, vh);
    if (th === 'city') { g.fillStyle = 'rgba(10,0,40,.12)'; g.fillRect(0, 0, vw, vh); }
  }

  /* ------------------------------ HUD ------------------------------ */
  function txt(g, s, x, y, size, o) {
    o = o || {};
    g.font = (o.w || 800) + (o.i === false ? ' ' : ' italic ') + size + 'px ' + FONT;
    g.textAlign = o.a || 'left'; g.textBaseline = o.b || 'alphabetic';
    if (o.glow) { g.shadowColor = o.glow; g.shadowBlur = o.gb || 10; }
    g.fillStyle = o.c || '#fff'; g.fillText(s, x, y);
    if (o.glow) g.shadowBlur = 0;
  }
  function slant(g, x, y, w, h, s, fill) {
    g.beginPath(); g.moveTo(x + s, y); g.lineTo(x + w, y); g.lineTo(x + w - s, y + h); g.lineTo(x, y + h); g.closePath();
    g.fillStyle = fill; g.fill();
  }

  function drawPlayerHud(g, c, rank, x, y, w, hs, right, now) {
    const h = 126 * hs, ac = c.color;
    g.save();
    g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 14;
    slant(g, x, y, w, h, right ? -14 * hs : 14 * hs, 'rgba(6,9,26,.78)'); g.shadowBlur = 0;
    g.fillStyle = ac; g.fillRect(right ? x + w - 5 : x, y, 5, h);
    const px = right ? x + w - 24 * hs : x + 24 * hs, al = right ? 'right' : 'left', o = right ? -1 : 1;
    txt(g, 'P' + (c.p + 1), px, y + 26 * hs, 17 * hs, { c: ac, a: al, glow: ac, gb: 8 });
    txt(g, DESIGNS[c.design].name, px + o * 38 * hs, y + 26 * hs, 12 * hs, { c: '#8fa3c0', a: al, w: 700 });
    // position badge
    const bx = right ? x + 20 * hs : x + w - 20 * hs;
    txt(g, ord(rank), bx, y + 34 * hs, 30 * hs, { c: rank === 1 ? '#ffd84a' : '#cfd8ea', a: right ? 'left' : 'right', glow: rank === 1 ? '#ffb400' : null });
    // speed
    const kmh = Math.round(Math.abs(c.vf) * KMH);
    txt(g, String(kmh), px, y + 78 * hs, 46 * hs, { c: c.nitroOn ? '#9ff8ff' : '#fff', a: al, glow: c.nitroOn ? '#19f0ff' : null, gb: 16 });
    const sw = g.measureText(String(kmh)).width;
    txt(g, 'KM/H', px + o * (sw + 8 * hs), y + 78 * hs, 12 * hs, { c: '#8fa3c0', a: al, w: 700 });
    // laps
    const lapTxt = race.mode === 'practice' ? 'LAP ' + (c.laps + 1) : 'LAP ' + Math.min(c.laps + 1, race.laps) + '/' + race.laps;
    txt(g, lapTxt, bx, y + 76 * hs, 20 * hs, { c: '#e8f6ff', a: right ? 'left' : 'right' });
    // nitro bar
    const bw = w - 60 * hs, bh = 11 * hs, by = y + 96 * hs, bxx = right ? x + w - 24 * hs - bw : x + 24 * hs;
    g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(bxx, by, bw, bh);
    const f = c.nitro / c.specs.nitroCap;
    const gr = g.createLinearGradient(bxx, 0, bxx + bw, 0);
    gr.addColorStop(0, c.nitroLock ? '#ff5c6c' : '#19f0ff'); gr.addColorStop(1, c.nitroLock ? '#ff2e4d' : '#ff2fd0');
    g.fillStyle = gr; g.globalAlpha = c.nitroOn ? 0.75 + 0.25 * Math.sin(now * 40) : (c.nitroLock ? 0.6 + 0.4 * Math.sin(now * 14) : 1);
    if (right) g.fillRect(bxx + bw * (1 - f), by, bw * f, bh); else g.fillRect(bxx, by, bw * f, bh);
    g.globalAlpha = 1;
    txt(g, c.nitroLock ? 'RECHARGING' : (f > 0.99 ? 'NITRO READY' : 'NITRO'), bxx + (right ? bw : 0), by + bh + 14 * hs, 10.5 * hs, { c: c.nitroLock ? '#ff8f9a' : '#8fa3c0', a: al, w: 800 });
    g.restore();
  }

  function drawHUD(now) {
    const g = ctx, W = view.w, H = view.h, hs = clamp(Math.min(W / 1400, H / 800), 0.62, 1.3);
    g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    const cars = race.cars, order = rankOrder(), pw = 310 * hs;
    cars.forEach((c, i) => drawPlayerHud(g, c, order[0] === c ? 1 : 2, i === 0 ? 14 * hs : W - pw - 14 * hs, 14 * hs, pw, hs, i === 1, now));

    // centre: timer
    const cw = 190 * hs;
    slant(g, W / 2 - cw / 2, 14 * hs, cw, 58 * hs, 12 * hs, 'rgba(6,9,26,.78)');
    const tShow = race.mode === 'practice' ? Math.max(cars[0].laps ? 0 : 0, race.t) : race.t;
    txt(g, fmt(tShow), W / 2, 56 * hs, 33 * hs, { a: 'center', c: '#fff', w: 800 });
    txt(g, race.track.name + (race.mode === 'practice' ? ' · PRACTICE' : race.mode === 'tt' ? ' · TIME TRIAL' : ''), W / 2, 90 * hs, 11.5 * hs, { a: 'center', c: '#8fa3c0', w: 700 });
    if (race.mode === 'tt') {
      const par = race.track.def.lapPar;
      txt(g, 'GOLD ' + fmt(par) + ' · SILVER ' + fmt(par * 1.1) + ' · BRONZE ' + fmt(par * 1.22), W / 2, 108 * hs, 11 * hs, { a: 'center', c: '#ffd84a', w: 700 });
    }
    if (isFinite(Math.min(cars[0].bestLap, cars[1].bestLap)) && race.mode !== 'tt')
      txt(g, 'BEST LAP ' + fmt(Math.min(cars[0].bestLap, cars[1].bestLap)), W / 2, 108 * hs, 11 * hs, { a: 'center', c: '#7dff3a', w: 700 });
    if (race.endT != null && !race.over && race.mode !== 'practice')
      txt(g, 'RACE ENDS IN ' + Math.ceil(race.endT), W / 2, 134 * hs, 17 * hs, { a: 'center', c: '#ff8f9a', glow: '#ff2e4d' });

    // per-player messages
    cars.forEach((c, i) => {
      const right = i === 1, mx = right ? W - 14 * hs - pw / 2 : 14 * hs + pw / 2;
      let text = null, col = '#fff';
      if (c.msg) { text = c.msg.text; col = c.msg.color; }
      else if (c.wrong) { text = Math.floor(now * 3) & 1 ? '⚠ WRONG WAY' : ''; col = '#ff4a5e'; }
      else if (c.offroad && !c.finished && c.speed > 60) { text = 'OFF TRACK'; col = '#ffb347'; }
      if (text) {
        const a = c.msg ? Math.min(1, c.msg.t * 3) : 1;
        g.globalAlpha = a; txt(g, text, mx, 160 * hs, 18 * hs, { a: 'center', c: col, glow: col, gb: 12 }); g.globalAlpha = 1;
      }
      if (c.finished && race.result) { /* final shown via banner */ }
    });

    // minimap
    const sc = race.scene, mm = sc.mm, mw = mm.w * hs, mh = mm.h * hs, mx0 = W / 2 - mw / 2, my0 = H - mh - 12 * hs;
    g.fillStyle = 'rgba(6,9,26,.86)'; g.fillRect(mx0, my0, mw, mh);
    g.drawImage(sc.mmCanvas, mx0, my0, mw, mh);
    cars.forEach((c) => {
      const x = mx0 + (c.x * mm.k + mm.ox) * hs, y = my0 + (c.y * mm.k + mm.oy) * hs;
      g.fillStyle = '#000'; g.beginPath(); g.arc(x, y, 6 * hs, 0, TAU); g.fill();
      g.fillStyle = c.color; g.beginPath(); g.arc(x, y, 4.5 * hs, 0, TAU); g.fill();
      txt(g, String(c.p + 1), x, y + 3.5 * hs, 7.5 * hs, { a: 'center', c: '#000', i: false, w: 900 });
    });

    // off-screen pointer to the trailing car
    const sxy = (c) => [(c.x - cam.x) * cam.zoom + W / 2, (c.y - cam.y) * cam.zoom + H / 2];
    cars.forEach((c, i) => {
      const [x, y] = sxy(c), m = 60 * hs;
      if (x > m && x < W - m && y > m + 70 && y < H - m) return;
      const cx = clamp(x, m, W - m), cy = clamp(y, m + 110 * hs, H - m), an = Math.atan2(y - H / 2, x - W / 2), other = cars[1 - i];
      g.save(); g.translate(cx, cy); g.rotate(an);
      g.fillStyle = c.color; g.shadowColor = c.color; g.shadowBlur = 14; g.beginPath(); g.moveTo(20 * hs, 0); g.lineTo(-10 * hs, -15 * hs); g.lineTo(-4 * hs, 0); g.lineTo(-10 * hs, 15 * hs); g.closePath(); g.fill(); g.restore();
      txt(g, 'P' + (c.p + 1) + ' · ' + Math.round(Math.hypot(c.x - other.x, c.y - other.y) * 0.05) + ' m', cx, cy + (cy > H / 2 ? -24 : 30) * hs, 12 * hs, { a: 'center', c: c.color });
    });

    // countdown
    if (app.state === 'countdown') {
      const n = Math.ceil(race.cd), fr = race.cd - Math.floor(race.cd);
      if (n > 3) txt(g, 'GET READY', W / 2, H * 0.4, 52 * hs, { a: 'center', c: '#fff', glow: '#19f0ff', gb: 24 });
      else {
        const sz = 170 * hs * (1 + 0.5 * Math.pow(fr, 3)), col = n === 1 ? '#7dff3a' : n === 2 ? '#ffe033' : '#ff4a5e';
        g.globalAlpha = Math.min(1, fr * 3 + 0.35);
        g.strokeStyle = col; g.lineWidth = 6 * hs; g.beginPath(); g.arc(W / 2, H * 0.42, 110 * hs * (1.6 - fr * 0.6), 0, TAU); g.globalAlpha *= 0.5; g.stroke(); g.globalAlpha = Math.min(1, fr * 3 + 0.35);
        txt(g, String(n), W / 2, H * 0.42 + sz * 0.35, sz, { a: 'center', c: col, glow: col, gb: 40 });
        g.globalAlpha = 1;
      }
    } else if (race.goT > 0) {
      const k = race.goT / 0.9;
      g.globalAlpha = Math.min(1, k * 2); txt(g, 'GO!', W / 2, H * 0.42 + 60 * hs, 190 * hs * (1 + (1 - k) * 0.9), { a: 'center', c: '#7dff3a', glow: '#7dff3a', gb: 50 }); g.globalAlpha = 1;
    }
    if (race.banner) {
      race.banner.t += 1 / 60; const k = Math.min(1, race.banner.t * 3);
      g.globalAlpha = k; txt(g, race.banner.text, W / 2, H * 0.4, 90 * hs * (0.7 + 0.3 * k), { a: 'center', c: '#fff', glow: race.banner.color, gb: 40 }); g.globalAlpha = 1;
    } else if (race.over && race.mode === 'practice') {
      txt(g, 'PRACTICE ENDED', W / 2, H * 0.4, 70 * hs, { a: 'center', c: '#fff', glow: '#19f0ff', gb: 30 });
    }
  }

  let fpsAcc = 0, fpsN = 0, fpsShow = 60;
  function render(now, rawDt) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05060f'; ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
    if (!race) return;
    drawWorld(now);
    drawScreenFx(now);
    if (race.mode !== 'attract' && app.state !== 'menu' && app.state !== 'results') drawHUD(now);
    if (save.settings.fps) {
      fpsAcc += rawDt; fpsN++; if (fpsAcc > 0.5) { fpsShow = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      txt(ctx, fpsShow + ' FPS', view.w - 12, view.h - 12, 13, { a: 'right', c: '#7dff3a', i: false, w: 700 });
    }
  }

  /* ------------------------------------------------------------------ *
   *  Main loop (exactly one rAF chain)
   * ------------------------------------------------------------------ */
  let rafId = 0, lastTs = 0;
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const raw = Math.min(0.1, Math.max(0, (ts - lastTs) / 1000)); lastTs = ts;
    const dt = Math.min(raw, 0.05);
    try {
      update(dt);
      hook('frame', dt);
      render(ts / 1000, raw || 0.016);
    } catch (e) { console.error(e); }
  }
  function startLoop() { if (rafId) return; lastTs = performance.now(); rafId = requestAnimationFrame(frame); }

  /* ------------------------------------------------------------------ *
   *  Global event wiring (once)
   * ------------------------------------------------------------------ */
  let resizeQueued = false;
  window.addEventListener('resize', () => { if (resizeQueued) return; resizeQueued = true; requestAnimationFrame(() => { resizeQueued = false; resize(); }); });
  window.addEventListener('blur', () => { clearInput(); if (app.state === 'racing' || app.state === 'countdown') { pause(); hook('autopause'); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearInput(); if (app.state === 'racing' || app.state === 'countdown') { pause(); hook('autopause'); } } });

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) { return; }
    A.ensure();
    const m = KEYMAP[e.code];
    const inRace = app.state === 'racing' || app.state === 'countdown';
    if (m) {
      if (inRace) {
        e.preventDefault();
        if (!input[m[0]][m[1]] && m[1] === 'reset' && app.state === 'racing') resetEdge[m[0]] = true;
        input[m[0]][m[1]] = true;
      } else if (e.code.startsWith('Arrow') || e.code === 'Slash') { if (e.code.startsWith('Arrow')) e.preventDefault(); }
    }
    if (e.repeat && e.code !== 'ArrowUp' && e.code !== 'ArrowDown') { if (e.code === 'Escape') return; }
    hook('key', e);
  });
  window.addEventListener('keyup', (e) => {
    const m = KEYMAP[e.code];
    if (m) input[m[0]][m[1]] = false;
  });
  window.addEventListener('contextmenu', (e) => { if (app.state === 'racing') e.preventDefault(); });

  /* ------------------------------------------------------------------ *
   *  Public API for ui.js
   * ------------------------------------------------------------------ */
  window.NR = {
    save, persist, app, THEMES, TRACK_DEFS, getScene, drawTrackPreview, fmt, KMH,
    startRace, restartRace, goAttract, pause, resume, endRaceNow, clearInput, setState,
    get race() { return race; }, get state() { return app.state; },
    hooks: app.hooks,
    startLoop, resize,
    debug: { input, get cars() { return race && race.cars; }, cam, parts, setBots(on) { race.cars.forEach((c) => { c.bot = on; }); }, finishRace, skid }
  };
})();
