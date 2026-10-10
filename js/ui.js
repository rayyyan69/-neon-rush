/* NEON RUSH: DUEL RACERS — menus, garage, settings, results. Talks to the engine through window.NR. */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const { save, persist, TRACK_DEFS, fmt } = NR;
  const { DESIGNS, COLORS, STAT_NAMES, POOL, STAT_MAX, drawPreview } = NRCars;
  const A = NRAudio;

  const MODE_NAMES = { quick: 'QUICK RACE', gp: 'GRAND PRIX', tt: 'TIME TRIAL', practice: 'PRACTICE' };
  const ui = { cur: null, stack: [], busy: false };
  let gp = null;            // grand prix progress
  let gpScored = false;

  /* ------------------------------------------------------------ helpers */
  const toastEl = $('#toast'); let toastTimer = 0;
  function toast(t) { toastEl.textContent = t; toastEl.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('on'), 1800); }

  // wrap button labels so the skewed buttons keep upright text
  $$('.btn').forEach((b) => { if (!b.querySelector('span')) { const s = document.createElement('span'); s.textContent = b.textContent; b.textContent = ''; b.appendChild(s); } });

  function keysHTML(p) {
    if (p === '1') return '<div class="kgrid"><div class="kc up">W</div><div class="kc l">A</div><div class="kc d">S</div><div class="kc r">D</div></div>' +
      '<div><div class="kc nitro">L-SHIFT</div><div class="klegend" style="margin-top:8px"><b>W</b> accelerate · <b>S</b> brake / reverse<br><b>A / D</b> steer · <b>Left Shift</b> nitro<br><b>Q</b> back on track</div></div>';
    return '<div class="kgrid"><div class="kc up">↑</div><div class="kc l">←</div><div class="kc d">↓</div><div class="kc r">→</div></div>' +
      '<div><div class="kc nitro">R-SHIFT</div><div class="klegend" style="margin-top:8px"><b>↑</b> accelerate · <b>↓</b> brake / reverse<br><b>← / →</b> steer · <b>Right Shift</b> nitro<br><b>/</b> back on track</div></div>';
  }
  $$('[data-keys]').forEach((el) => { el.innerHTML = keysHTML(el.dataset.keys); });

  /* ------------------------------------------------------- screen manager */
  function activate(name) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.dataset.screen === name));
    ui.cur = name;
    $('#mute-btn').classList.remove('hidden');
    const enter = ENTER[name]; if (enter) enter();
    setTimeout(() => { // wait for visibility transition so the element is focusable
      if (ui.cur !== name) return;
      const scr = $('.screen[data-screen="' + name + '"]');
      const t = scr.querySelector('[autofocus]') || scr.querySelector('.btn.primary') || scr.querySelector('.sel') || scr.querySelector('button:not(:disabled)');
      if (t) t.focus({ preventScroll: true });
    }, 30);
  }
  function hideAll() {
    $$('.screen').forEach((s) => s.classList.remove('active'));
    ui.cur = null; ui.stack = [];
    $('#mute-btn').classList.add('hidden');
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  }
  function go(name) { if (ui.cur && ui.cur !== name) ui.stack.push(ui.cur); activate(name); }
  function back() {
    const p = ui.stack.pop() || (NR.state === 'paused' ? 'pause' : 'menu');
    activate(p);
  }
  function fadeThen(fn) {
    if (ui.busy) return; ui.busy = true;
    const f = $('#fade'); f.classList.add('on');
    setTimeout(() => { try { fn(); } finally { setTimeout(() => { f.classList.remove('on'); ui.busy = false; }, 80); } }, 280);
  }

  /* ----------------------------------------------------------- navigation */
  function navMove(dir) {
    const scr = $('.screen.active'); if (!scr) return;
    const els = $$('button:not(:disabled), input[type=range]', scr).filter((e) => e.offsetParent !== null);
    if (!els.length) return;
    const cur = document.activeElement && els.includes(document.activeElement) ? document.activeElement : null;
    if (!cur) { els[0].focus(); return; }
    const r = cur.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bs = Infinity;
    els.forEach((e) => {
      if (e === cur) return;
      const b = e.getBoundingClientRect(), x = b.left + b.width / 2 - cx, y = b.top + b.height / 2 - cy;
      let main, off;
      if (dir === 'up') { main = -y; off = Math.abs(x); } else if (dir === 'down') { main = y; off = Math.abs(x); }
      else if (dir === 'left') { main = -x; off = Math.abs(y); } else { main = x; off = Math.abs(y); }
      if (main < 4) return;
      const s = main + off * 2.2;
      if (s < bs) { bs = s; best = e; }
    });
    if (best) { best.focus({ preventScroll: false }); A.sfx.hover(); }
  }

  function onEscape() {
    const st = NR.state;
    if (st === 'racing' || st === 'countdown') { NR.pause(); return; }
    if (st === 'paused') { if (ui.cur === 'pause') { A.sfx.back(); NR.resume(); } else { A.sfx.back(); back(); } return; }
    if (st === 'results') return;
    if (ui.cur && ui.cur !== 'menu') { A.sfx.back(); back(); }
  }

  NR.hooks.key = (e) => {
    const st = NR.state;
    if (e.code === 'KeyM' && !e.repeat && !e.target.matches('input')) { toggle('mute'); return; }
    if (e.code === 'Escape') { if (!e.repeat) onEscape(); return; }
    if (st === 'racing' || st === 'countdown') return;
    if (!A.music.running && st === 'menu') A.music.start('menu');
    if (e.code === 'KeyR' && !e.repeat) {
      if (st === 'paused' && ui.cur === 'pause') { act('restart'); return; }
      if (st === 'results') { act(gp && gp.round < 2 ? 'next' : 'rematch'); return; }
    }
    const dirs = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
    const d = dirs[e.code];
    if (d) {
      if (document.activeElement && document.activeElement.type === 'range' && (d === 'left' || d === 'right') && e.code.startsWith('Arrow')) return;
      e.preventDefault(); navMove(d); return;
    }
    if (e.code === 'Enter' && !e.repeat) {
      const ae = document.activeElement;
      if (!ae || ae === document.body || ae.tagName === 'CANVAS') { const p = $('.screen.active .btn.primary'); if (p) p.click(); }
    }
  };

  /* ------------------------------------------------------------- rendering */
  function updateMenuInfo() {
    $('#m-mode').textContent = MODE_NAMES[save.mode];
    $('#m-track').textContent = save.mode === 'gp' ? 'ALL 3 TRACKS' : TRACK_DEFS.find((t) => t.id === save.track).name;
    $('#m-laps').textContent = save.mode === 'practice' ? 'FREE LAPS' : save.laps + (save.laps === 1 ? ' LAP' : ' LAPS');
  }

  // track chips (setup)
  const chipBox = $('#track-chips');
  TRACK_DEFS.forEach((t) => {
    const b = document.createElement('button'); b.className = 'chip'; b.dataset.act = 'track'; b.dataset.val = t.id;
    const cv = document.createElement('canvas'); cv.width = 112; cv.height = 80;
    b.appendChild(cv); b.appendChild(document.createTextNode(t.name)); chipBox.appendChild(b);
  });

  function renderSetup() {
    $$('#mode-cards .card').forEach((c) => c.classList.toggle('sel', c.dataset.val === save.mode));
    $$('#lap-chips .chip').forEach((c) => { c.classList.toggle('sel', +c.dataset.val === save.laps); c.disabled = save.mode === 'practice'; c.style.opacity = save.mode === 'practice' ? 0.35 : 1; });
    $$('#track-chips .chip').forEach((c) => { c.classList.toggle('sel', c.dataset.val === save.track && save.mode !== 'gp'); c.style.opacity = save.mode === 'gp' ? 0.45 : 1; });
    $('#setup-note').textContent = {
      quick: 'First to finish wins. Cars collide, so use your elbows.',
      gp: 'Races run on NEON CITY, DESERT STORM and FOREST SPEEDWAY in order. ' + save.laps + ' laps each.',
      tt: 'Cars ghost through each other. Chase the gold / silver / bronze lap times.',
      practice: 'Endless laps with collisions on. Pause and choose END RACE when done.'
    }[save.mode];
    [0, 1].forEach((p) => {
      const g = save.garage[p];
      $('#sum-n' + (p + 1)).textContent = DESIGNS[g.car].name + ' · ' + COLORS.find((c) => c.c === g.color).n;
    });
    $$('#track-chips canvas').forEach((cv, i) => NR.drawTrackPreview(cv, TRACK_DEFS[i].id));
    updateMenuInfo();
  }

  function stars(n) { return '★'.repeat(n) + '<span style="opacity:.25">' + '★'.repeat(5 - n) + '</span>'; }
  function renderTracks() {
    const box = $('#track-cards');
    if (!box.children.length) {
      TRACK_DEFS.forEach((t) => {
        const b = document.createElement('button'); b.className = 'tcard'; b.dataset.act = 'pick-track'; b.dataset.val = t.id;
        b.innerHTML = '<canvas width="640" height="400"></canvas><h3>' + t.name + '</h3><p>' + t.tagline + '</p><div class="tstats"><div>LENGTH<b data-s="len"></b></div><div>DIFFICULTY<b class="stars">' + stars(t.difficulty) + '</b></div><div>BEST LAP<b data-s="best"></b></div></div>';
        box.appendChild(b);
        NR.drawTrackPreview(b.querySelector('canvas'), t.id);
        b.querySelector('[data-s=len]').textContent = (NR.getScene(t.id).tr.L * 0.00012).toFixed(1) + ' KM';
      });
    }
    $$('.tcard', box).forEach((b) => { b.classList.toggle('sel', b.dataset.val === save.track); const bl = save.bests[b.dataset.val]; b.querySelector('[data-s=best]').textContent = bl ? fmt(bl) : '--:--.--'; });
  }

  /* garage */
  let garageFocus = null;
  function renderGarage() {
    const ae = document.activeElement; if (ae && ae.dataset && ae.dataset.k) garageFocus = ae.dataset.k;
    $$('.gp').forEach((box) => {
      const p = +box.dataset.p, g = save.garage[p], d = DESIGNS[g.car], other = save.garage[1 - p];
      const used = g.alloc.reduce((a, b) => a + b, 0), left = POOL - used;
      let h = '<div class="ph">PLAYER ' + (p + 1) + '</div><canvas class="pv" width="640" height="260"></canvas>' +
        '<div class="top"><button class="sq" data-act="car" data-p="' + p + '" data-val="-1" data-k="' + p + 'c-1">‹</button><div class="nm"><b>' + d.name + '</b><small>' + d.blurb + '</small></div><button class="sq" data-act="car" data-p="' + p + '" data-val="1" data-k="' + p + 'c1">›</button></div>' +
        '<div class="swatches">';
      COLORS.forEach((c, i) => { h += '<button class="sw' + (c.c === g.color ? ' sel' : '') + '" style="background:' + c.c + ';color:' + c.c + '" title="' + c.n + '" data-act="color" data-p="' + p + '" data-val="' + c.c + '" data-k="' + p + 'w' + i + '"' + (c.c === other.color ? ' disabled' : '') + '></button>'; });
      h += '</div>';
      const names = ['ACCEL', 'TOP SPEED', 'HANDLING', 'NITRO'];
      for (let i = 0; i < 4; i++) {
        const base = d.stats[i], al = g.alloc[i];
        h += '<div class="stat"><span>' + names[i] + '</span><div class="bar"><i class="base" style="width:' + base * 10 + '%"></i><i class="bonus" style="left:' + base * 10 + '%;width:' + al * 10 + '%"></i></div>' +
          '<button class="sq" data-act="stat" data-p="' + p + '" data-i="' + i + '" data-val="-1" data-k="' + p + 's' + i + '-"' + (al <= 0 ? ' disabled' : '') + '>−</button>' +
          '<button class="sq" data-act="stat" data-p="' + p + '" data-i="' + i + '" data-val="1" data-k="' + p + 's' + i + '+"' + (left <= 0 || base + al >= STAT_MAX ? ' disabled' : '') + '>+</button></div>';
      }
      h += '<div class="pts"><span>BONUS POINTS LEFT</span><b>' + left + ' / ' + POOL + '</b></div><div class="keys" data-keys="' + (p + 1) + '">' + keysHTML(String(p + 1)) + '</div>';
      box.innerHTML = h;
    });
    if (garageFocus) { const t = $('[data-k="' + garageFocus + '"]:not(:disabled)'); if (t) t.focus({ preventScroll: true }); }
    updateMenuInfo();
  }

  function renderSettings() {
    const s = save.settings;
    $('#set-music').value = Math.round(s.music * 100); $('#o-music').textContent = Math.round(s.music * 100) + '%';
    $('#set-sfx').value = Math.round(s.sfx * 100); $('#o-sfx').textContent = Math.round(s.sfx * 100) + '%';
    const t = (id, on, a, b) => { const el = $(id); el.textContent = on ? a : b; el.classList.toggle('on', on); };
    t('#t-mute', s.mute, 'MUTED', 'SOUND ON'); t('#t-shake', s.shake, 'ON', 'OFF'); t('#t-quality', s.quality === 'high', 'HIGH', 'LOW'); t('#t-fps', s.fps, 'ON', 'OFF');
    syncMute();
  }
  function syncMute() {
    const m = save.settings.mute;
    $('#mute-x').style.display = m ? '' : 'none'; $('#mute-waves').style.display = m ? 'none' : '';
  }

  const ENTER = {
    menu: updateMenuInfo, setup: renderSetup, tracks: renderTracks, garage: renderGarage, settings: renderSettings,
    pause: () => { const r = NR.race; $('#b-endrace').firstChild.textContent = r && r.mode === 'practice' ? 'END PRACTICE' : 'END RACE'; }
  };

  /* garage previews + attract mode animate with the shared frame hook */
  NR.hooks.frame = () => {
    if (ui.cur === 'garage') {
      const t = performance.now() / 1000;
      $$('.gp canvas.pv').forEach((cv, i) => { const g = save.garage[i]; drawPreview(cv, g.car, g.color, -0.5 + Math.sin(t * 0.9 + i) * 0.35 + t * 0.15 * (i ? -1 : 1), 3.1); });
    } else if (ui.cur === 'setup') {
      const t = performance.now() / 1000;
      [0, 1].forEach((i) => { const g = save.garage[i]; drawPreview($('#sum-p' + (i + 1)), g.car, g.color, Math.sin(t + i) * 0.3, 1.9); });
    }
  };

  /* ------------------------------------------------------------- actions */
  function launch(trackId) {
    fadeThen(() => {
      ui.stack = [];
      NR.startRace({ mode: save.mode, track: trackId, laps: save.laps });
    });
  }
  function beginFromSetup() {
    A.ensure(); gpScored = false;
    if (save.mode === 'gp') { gp = { round: 0, pts: [0, 0], tracks: TRACK_DEFS.map((t) => t.id), wins: [0, 0], time: [0, 0] }; launch(gp.tracks[0]); }
    else { gp = null; launch(save.track); }
  }
  function toMenu() {
    fadeThen(() => { NR.goAttract(); ui.stack = []; gp = null; activate('menu'); });
  }
  function toggle(k) {
    const s = save.settings;
    if (k === 'quality') s.quality = s.quality === 'high' ? 'low' : 'high'; else s[k] = !s[k];
    persist(); A.setVolumes({ music: s.music, sfx: s.sfx, mute: s.mute }); A.sfx.click();
    renderSettings();
  }

  function act(name, el) {
    const val = el ? el.dataset.val : undefined;
    switch (name) {
      case 'play': A.sfx.click(); go('setup'); break;
      case 'quick': A.sfx.click(); save.mode = 'quick'; persist(); beginFromSetup(); break;
      case 'gp': A.sfx.click(); save.mode = 'gp'; persist(); go('setup'); break;
      case 'go': A.sfx.click(); go(val); break;
      case 'back': A.sfx.back(); back(); break;
      case 'mode': A.sfx.click(); save.mode = val; persist(); renderSetup(); break;
      case 'laps': A.sfx.click(); save.laps = +val; persist(); renderSetup(); break;
      case 'track': A.sfx.click(); save.track = val; if (save.mode === 'gp') save.mode = 'quick'; persist(); renderSetup(); break;
      case 'pick-track': A.sfx.click(); save.track = val; if (save.mode === 'gp') save.mode = 'quick'; persist(); renderTracks(); toast('TRACK: ' + TRACK_DEFS.find((t) => t.id === val).name); setTimeout(() => { if (ui.cur === 'tracks') back(); }, 450); break;
      case 'start': A.sfx.click(); beginFromSetup(); break;
      case 'car': {
        A.sfx.click();
        const g = save.garage[+el.dataset.p]; g.car = (g.car + +val + DESIGNS.length) % DESIGNS.length;
        const d = DESIGNS[g.car]; g.alloc = g.alloc.map((a, i) => Math.min(a, STAT_MAX - d.stats[i]));
        persist(); renderGarage(); break;
      }
      case 'color': { A.sfx.click(); save.garage[+el.dataset.p].color = val; persist(); renderGarage(); break; }
      case 'stat': {
        const g = save.garage[+el.dataset.p], i = +el.dataset.i, d = DESIGNS[g.car], used = g.alloc.reduce((a, b) => a + b, 0);
        if (+val > 0 && (used >= POOL || d.stats[i] + g.alloc[i] >= STAT_MAX)) return;
        if (+val < 0 && g.alloc[i] <= 0) return;
        A.sfx.click(); g.alloc[i] += +val; persist(); renderGarage(); break;
      }
      case 'garage-reset': A.sfx.click(); save.garage.forEach((g) => { g.alloc = [2, 2, 2, 2]; }); persist(); renderGarage(); break;
      case 'tog': toggle(val); break;
      case 'fullscreen':
        try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) { toast('FULLSCREEN NOT AVAILABLE'); }
        break;
      case 'test-sound': A.ensure(); A.sfx.beep(); setTimeout(A.sfx.collide, 250, 0.7); setTimeout(A.sfx.nitro, 600); break;
      case 'clear-records': save.bests = {}; persist(); A.sfx.click(); toast('RECORDS CLEARED'); break;
      case 'resume': A.sfx.click(); NR.resume(); break;
      case 'restart': A.sfx.click(); fadeThen(() => { ui.stack = []; NR.restartRace(); }); break;
      case 'endrace': A.sfx.click(); NR.endRaceNow(); break;
      case 'quit': A.sfx.click(); toMenu(); break;
      case 'rematch':
        A.sfx.click();
        if (gp && gp.round >= 2) { gp = { round: 0, pts: [0, 0], tracks: gp.tracks, wins: [0, 0], time: [0, 0] }; gpScored = false; fadeThen(() => { ui.stack = []; NR.startRace({ mode: 'gp', track: gp.tracks[0], laps: save.laps }); }); }
        else fadeThen(() => { ui.stack = []; NR.restartRace(); });
        break;
      case 'next':
        A.sfx.click(); gp.round++; gpScored = false;
        fadeThen(() => { ui.stack = []; NR.startRace({ mode: 'gp', track: gp.tracks[gp.round], laps: save.laps }); });
        break;
      case 'res-setup': A.sfx.click(); fadeThen(() => { NR.goAttract(); ui.stack = ['menu']; gp = null; activate('setup'); }); break;
    }
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
    A.ensure(); if (!A.music.running && NR.state === 'menu') A.music.start('menu');
    act(el.dataset.act, el);
  });
  document.addEventListener('mouseover', (e) => { const b = e.target.closest('.btn, .card, .chip, .tcard'); if (b && b !== ui.lastHover) { ui.lastHover = b; if (A.ready) A.sfx.hover(); } });
  $('#set-music').addEventListener('input', (e) => { save.settings.music = e.target.value / 100; $('#o-music').textContent = e.target.value + '%'; A.ensure(); A.setVolumes({ music: save.settings.music }); persist(); });
  $('#set-sfx').addEventListener('input', (e) => { save.settings.sfx = e.target.value / 100; $('#o-sfx').textContent = e.target.value + '%'; A.ensure(); A.setVolumes({ sfx: save.settings.sfx }); persist(); });
  $('#set-sfx').addEventListener('change', () => A.sfx.click());

  /* ------------------------------------------------------- engine hooks */
  NR.hooks.state = (s) => {
    if (s === 'racing' || s === 'countdown') hideAll();
    else if (s === 'paused') { ui.stack = []; activate('pause'); }
  };
  NR.hooks.autopause = () => toast('PAUSED — WINDOW LOST FOCUS');

  NR.hooks.results = (res) => {
    const race = NR.race, def = race.track.def;
    const nm = (p) => 'PLAYER ' + (p + 1);
    const winner = res.winner;
    let banner, color = '#19f0ff';
    if (res.mode === 'practice') banner = 'PRACTICE COMPLETE';
    else if (!res.cars.some((c) => c.finished)) banner = 'NO FINISHERS';
    else { banner = nm(winner) + ' WINS!'; color = res.cars[winner].color; }
    $('#res-banner').textContent = banner; $('#res-banner').style.setProperty('--c', color);
    let sub = def.name + ' · ' + MODE_NAMES[res.mode] + (res.mode === 'practice' ? '' : ' · ' + res.laps + (res.laps === 1 ? ' LAP' : ' LAPS'));
    const f = res.order.map((p) => res.cars[p]);
    if (f[0].finished && f[1].finished) sub += ' · MARGIN ' + (f[1].time - f[0].time).toFixed(2) + 's';
    if (res.record) sub += ' · NEW TRACK RECORD!';
    if (res.mode === 'tt') {
      const best = Math.min(res.cars[0].best, res.cars[1].best), par = def.lapPar;
      if (isFinite(best)) sub += ' · ' + (best <= par ? 'GOLD' : best <= par * 1.1 ? 'SILVER' : best <= par * 1.22 ? 'BRONZE' : 'NO MEDAL') + ' LAP';
    }
    $('#res-sub').textContent = sub;

    // grand prix scoring
    let gpHtml = '';
    const pts = [0, 0];
    if (gp && !gpScored) {
      gpScored = true;
      res.order.forEach((p, i) => { if (res.cars[p].finished) { pts[p] = i === 0 ? 10 : 6; } });
      gp.pts[0] += pts[0]; gp.pts[1] += pts[1];
      [0, 1].forEach((p) => { gp.time[p] += res.cars[p].finished ? res.cars[p].time : 999; });
      gp.last = pts.slice();
    } else if (gp) pts[0] = gp.last[0], pts[1] = gp.last[1];
    const rows = res.order.map((p, i) => {
      const c = res.cars[p];
      const t = res.mode === 'practice' ? c.laps + ' LAPS' : (c.finished ? fmt(c.time) : 'DNF');
      return '<tr class="' + (i === 0 && res.mode !== 'practice' && c.finished ? 'w' : '') + '"><td>' + (res.mode === 'practice' ? '–' : i + 1) + '</td><td class="pn' + (p + 1) + '">' + nm(p) + ' <small style="color:#8fa3c0">' + c.name + '</small></td><td>' + t + '</td><td>' + fmt(c.best) + '</td><td>' + Math.round(c.top * NR.KMH) + ' km/h</td>' + (gp ? '<td>+' + pts[p] + '</td>' : '') + '</tr>';
    }).join('');
    $('#res-table').innerHTML = '<tr><th>POS</th><th>DRIVER</th><th>' + (res.mode === 'practice' ? 'LAPS' : 'TIME') + '</th><th>BEST LAP</th><th>TOP SPEED</th>' + (gp ? '<th>PTS</th>' : '') + '</tr>' + rows;
    if (gp) {
      const final = gp.round >= 2;
      gpHtml = 'GRAND PRIX · RACE ' + (gp.round + 1) + ' OF 3 &nbsp;|&nbsp; <b style="color:var(--p1)">P1 ' + gp.pts[0] + ' PTS</b> &nbsp; <b style="color:var(--p2)">P2 ' + gp.pts[1] + ' PTS</b>';
      if (final) {
        const champ = gp.pts[0] === gp.pts[1] ? (gp.time[0] <= gp.time[1] ? 0 : 1) : (gp.pts[0] > gp.pts[1] ? 0 : 1);
        gpHtml += '<span class="champ">🏆 GRAND PRIX CHAMPION: PLAYER ' + (champ + 1) + '</span>';
      }
    }
    $('#gp-box').innerHTML = gpHtml;
    const next = $('#b-next'), re = $('#b-rematch');
    next.style.display = gp && gp.round < 2 ? '' : 'none';
    re.style.display = gp && gp.round < 2 ? 'none' : '';
    re.firstChild.textContent = gp ? 'NEW GRAND PRIX' : 'REMATCH';
    $('.res-btns').style.gridTemplateColumns = '1fr 1fr';
    ui.stack = [];
    activate('results');
    setTimeout(() => { const t = gp && gp.round < 2 ? next : re; if (ui.cur === 'results') t.focus(); }, 60);
  };

  /* ------------------------------------------------------------- boot */
  function boot() {
    A.setVolumes({ music: save.settings.music, sfx: save.settings.sfx, mute: save.settings.mute });
    NR.resize();
    NR.goAttract('city');
    renderSettings(); updateMenuInfo();
    activate('menu');
    NR.startLoop();
    // attract mode: swap scenery every so often while on the main menu
    setInterval(() => { if (NR.state === 'menu' && ui.cur === 'menu' && !ui.busy) NR.goAttract(); }, 45000);
  }
  boot();
})();
