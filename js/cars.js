/* NEON RUSH: DUEL RACERS — car designs, stat model and procedural car rendering. */
(function (root) {
  'use strict';

  const SS = 3;                 // sprite supersampling
  const SW = 84, SH = 50;       // sprite box in world units (car is ~64 long)

  /* base stats: [accel, topSpeed, handling, nitro] — every body sums to 20 so no car is strictly better */
  const DESIGNS = [
    { id: 'volt', name: 'VOLT', blurb: 'Balanced all-rounder', stats: [5, 5, 5, 5],
      prof: [[33, 0], [31, 5], [25, 10], [12, 13.5], [0, 14.5], [-15, 14.8], [-27, 13.5], [-32, 9], [-33, 0]],
      wheels: { fx: 20, rx: -20, y: 14, w: 11, h: 6 } },
    { id: 'viper', name: 'VIPER GT', blurb: 'Long, fast, hard to turn', stats: [4, 8, 3, 5],
      prof: [[35, 0], [34, 3.5], [27, 8], [15, 10.5], [4, 13], [-12, 15], [-28, 15.6], [-34, 11], [-35, 0]],
      wheels: { fx: 22, rx: -22, y: 14.4, w: 11.5, h: 6.4 } },
    { id: 'dart', name: 'DART', blurb: 'Agile cornering wedge', stats: [6, 3, 8, 3],
      prof: [[30, 0], [29, 4], [20, 9], [6, 12.5], [-9, 14], [-23, 13.4], [-28, 8], [-30, 0]],
      wheels: { fx: 17, rx: -18, y: 13.6, w: 10, h: 6 } },
    { id: 'comet', name: 'COMET', blurb: 'Open-wheel rocket launcher', stats: [8, 4, 4, 4], openWheel: true,
      prof: [[35, 0], [33, 2.2], [14, 4.2], [4, 8], [-12, 9.5], [-28, 6.5], [-33, 3], [-34, 0]],
      wheels: { fx: 22, rx: -22, y: 16.4, w: 12.5, h: 8.4 } },
    { id: 'phantom', name: 'PHANTOM', blurb: 'Nitro-hungry stealth wedge', stats: [4, 4, 4, 8], angular: true,
      prof: [[34, 0], [20, 6.5], [9, 10], [-5, 15], [-21, 15.2], [-30, 11], [-33, 0]],
      wheels: { fx: 20, rx: -21, y: 14.4, w: 11, h: 6 } },
    { id: 'bruiser', name: 'BRUISER', blurb: 'Heavy punch, light on grip', stats: [6, 6, 4, 4],
      prof: [[31, 0], [30, 8], [26, 14.5], [-22, 16.5], [-30, 15], [-33, 10.5], [-33, 0]],
      wheels: { fx: 20, rx: -21, y: 15.4, w: 12, h: 7 } }
  ];

  const COLORS = [
    { n: 'ELECTRIC BLUE', c: '#29a3ff' }, { n: 'HOT ORANGE', c: '#ff8a1f' },
    { n: 'RED', c: '#ff2e4d' }, { n: 'LIME', c: '#7dff3a' },
    { n: 'MAGENTA', c: '#ff3df2' }, { n: 'YELLOW', c: '#ffe033' },
    { n: 'CYAN', c: '#19f0e0' }, { n: 'VIOLET', c: '#9a5cff' }, { n: 'SILVER', c: '#e3eaf5' }
  ];

  const STAT_NAMES = ['ACCELERATION', 'TOP SPEED', 'HANDLING', 'NITRO'];
  const POOL = 8, STAT_MAX = 10;

  function specsFor(design, alloc) {
    const d = DESIGNS[design], st = d.stats.map((b, i) => Math.min(STAT_MAX, b + (alloc[i] || 0)));
    return {
      stats: st,
      accel: 380 + 38 * st[0],      // u/s²
      maxV: 520 + 22 * st[1],       // u/s
      turn: 2.6 + 0.14 * st[2],     // rad/s at low speed
      grip: 7.4 + 0.5 * st[2],      // 1/s lateral damping
      nitroCap: 70 + 6 * st[3],     // meter units
      brake: 1150
    };
  }

  /* ------------------------------ colours ------------------------------ */
  function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function shade(hex, f) { // f<0 darken, f>0 lighten
    const c = rgb(hex), t = f < 0 ? 0 : 255, k = Math.abs(f);
    return 'rgb(' + c.map((v) => Math.round(v + (t - v) * k)).join(',') + ')';
  }
  function rgba(hex, a) { const c = rgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  /* ------------------------------ sprites ------------------------------ */
  const cache = new Map();

  function bodyPath(c, d) {
    const pts = [], p = d.prof;
    for (let i = 0; i < p.length; i++) pts.push([p[i][0], -p[i][1]]);
    for (let i = p.length - 2; i >= 1; i--) pts.push([p[i][0], p[i][1]]);
    c.beginPath();
    if (d.angular) {
      c.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
      c.closePath();
    } else {
      const n = pts.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const m0 = mid(pts[0], pts[1]);
      c.moveTo(m0[0], m0[1]);
      for (let i = 1; i <= n; i++) {
        const a = pts[i % n], b = pts[(i + 1) % n], m = mid(a, b);
        c.quadraticCurveTo(a[0], a[1], m[0], m[1]);
      }
      c.closePath();
    }
  }

  function glass(c, x0, x1, hw) {
    const g = c.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, '#06101e'); g.addColorStop(0.5, '#27496b'); g.addColorStop(1, '#0a1a2e');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x1, -hw * 0.7); c.lineTo(x1 - 5, -hw); c.lineTo(x0 + 4, -hw); c.lineTo(x0, -hw * 0.75);
    c.lineTo(x0, hw * 0.75); c.lineTo(x0 + 4, hw); c.lineTo(x1 - 5, hw); c.lineTo(x1, hw * 0.7);
    c.closePath(); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 0.8; c.stroke();
  }

  function roof(c, x0, x1, hw, color) {
    const g = c.createLinearGradient(0, -hw, 0, hw);
    g.addColorStop(0, shade(color, -0.25)); g.addColorStop(0.45, shade(color, 0.28)); g.addColorStop(1, shade(color, -0.35));
    c.fillStyle = g;
    c.beginPath();
    if (c.roundRect) c.roundRect(x0, -hw, x1 - x0, hw * 2, 2.2); else c.rect(x0, -hw, x1 - x0, hw * 2);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 0.5;
    c.beginPath(); c.moveTo(x0 + 1.5, -hw + 1); c.lineTo(x1 - 1.5, -hw + 1); c.stroke();
  }

  function lights(c, d) {
    const p = d.prof, noseX = p[0][0], tailX = p[p.length - 1][0];
    const fy = p[1][1], ty = p[p.length - 2][1];
    c.fillStyle = '#fff7c8';
    [-1, 1].forEach((s) => { c.beginPath(); c.moveTo(noseX - 4.5, s * Math.max(2, fy * 0.5 + 1.5)); c.lineTo(noseX - 1.2, s * Math.max(1.5, fy * 0.5)); c.lineTo(noseX - 1.2, s * (fy * 0.5 + 3.8)); c.lineTo(noseX - 6, s * (fy * 0.5 + 4.2)); c.closePath(); c.fill(); });
    c.fillStyle = '#ff2a3a';
    [-1, 1].forEach((s) => c.fillRect(tailX + 1, s * (ty * 0.55) - 1.6 + (s > 0 ? 0 : 0), 2.4, 3.2));
  }

  function renderSprite(di, color) {
    const d = DESIGNS[di], cv = document.createElement('canvas');
    cv.width = SW * SS; cv.height = SH * SS;
    const c = cv.getContext('2d');
    c.scale(SS, SS); c.translate(SW / 2, SH / 2);
    c.lineJoin = d.angular ? 'miter' : 'round';

    // body fill
    bodyPath(c, d);
    const g = c.createLinearGradient(0, -16, 0, 16);
    g.addColorStop(0, shade(color, -0.38)); g.addColorStop(0.3, shade(color, 0.05));
    g.addColorStop(0.5, shade(color, 0.32)); g.addColorStop(0.7, shade(color, 0.02)); g.addColorStop(1, shade(color, -0.45));
    c.fillStyle = g; c.fill();

    // clipped details (stripes etc.)
    c.save(); bodyPath(c, d); c.clip();
    const dark = 'rgba(8,10,22,.82)', white = 'rgba(255,255,255,.9)';
    switch (d.id) {
      case 'volt': c.fillStyle = white; c.fillRect(-40, -3.4, 80, 1.8); c.fillRect(-40, 1.6, 80, 1.8); break;
      case 'viper': c.fillStyle = dark; c.fillRect(-40, -3.6, 80, 7.2); c.fillStyle = white; c.fillRect(-40, -0.6, 80, 1.2);
        c.fillStyle = 'rgba(0,0,0,.55)'; for (let i = 0; i < 3; i++) { c.fillRect(14 + i * 2.6, -7.8, 1.2, 4); c.fillRect(14 + i * 2.6, 3.8, 1.2, 4); } break;
      case 'dart': c.fillStyle = white; c.fillRect(-10, -16, 5, 32); c.fillStyle = dark; c.fillRect(-4, -16, 2, 32);
        c.fillStyle = dark; c.fillRect(16, -2, 10, 4); break;
      case 'comet': c.fillStyle = white; c.fillRect(24, -3, 12, 6); c.fillStyle = dark; c.fillRect(-20, -10, 12, 20); break;
      case 'phantom': c.strokeStyle = shade(color, 0.7); c.lineWidth = 1.1; c.beginPath();
        c.moveTo(34, 0); c.lineTo(8, -9); c.lineTo(-18, -13.5); c.moveTo(34, 0); c.lineTo(8, 9); c.lineTo(-18, 13.5); c.stroke();
        c.fillStyle = dark; c.beginPath(); c.moveTo(-6, -15); c.lineTo(-1, 0); c.lineTo(-6, 15); c.lineTo(-12, 15); c.lineTo(-7, 0); c.lineTo(-12, -15); c.closePath(); c.fill(); break;
      case 'bruiser': c.fillStyle = dark; c.fillRect(-40, -1.2, 80, 2.4);
        c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(17, -6, 7, 12); c.fillStyle = shade(color, 0.3); c.fillRect(18, -5, 5, 10); break;
    }
    // sheen
    const sh = c.createLinearGradient(-30, -16, 20, 4);
    sh.addColorStop(0, 'rgba(255,255,255,.28)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)');
    c.fillStyle = sh; c.fillRect(-40, -20, 80, 40);
    c.restore();

    // outline
    bodyPath(c, d);
    c.strokeStyle = 'rgba(0,0,0,.65)'; c.lineWidth = 1.2; c.stroke();

    // cabin
    switch (d.id) {
      case 'volt': glass(c, -11, 9, 8.6); roof(c, -6, 3, 6.2, color); break;
      case 'viper': glass(c, -15, 3, 9.2); roof(c, -10, -3, 6.6, color); break;
      case 'dart': glass(c, -8, 9, 8.8); roof(c, -3, 3, 6, color); break;
      case 'phantom': glass(c, -14, 8, 8.4); roof(c, -9, 0, 5.4, color); break;
      case 'bruiser':
        glass(c, -16, 11, 11.4); roof(c, -11, 4, 8.6, color);
        c.fillStyle = 'rgba(0,0,0,.55)'; for (let i = 0; i < 4; i++) c.fillRect(-9 + i * 3.6, -8.4, 1, 16.8);
        c.fillStyle = '#ffd34a'; c.fillRect(2, -6, 2.2, 12); break;
      case 'comet': // open cockpit: helmet + halo
        c.fillStyle = '#101426'; c.beginPath(); c.ellipse(-4, 0, 7, 4.6, 0, 0, 7); c.fill();
        c.fillStyle = '#f4f7ff'; c.beginPath(); c.arc(-4, 0, 3.4, 0, 7); c.fill();
        c.fillStyle = shade(color, 0.1); c.fillRect(-6, -1.3, 4, 2.6);
        c.strokeStyle = '#222a44'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(3, -5); c.lineTo(3, 5); c.stroke();
        break;
    }

    // wings / spoilers
    if (d.id === 'comet') {
      [[28, 16.5, 7, 2.6], [-35, 14.5, 7.5, 3.4]].forEach((w) => {
        c.fillStyle = shade(color, -0.2); c.fillRect(w[0] - w[2] / 2, -w[1], w[2], w[1] * 2);
        c.fillStyle = '#111627'; c.fillRect(w[0] - w[2] / 2 - 0.3, -w[1] - 0.8, w[2] + 0.6, 1.9); c.fillRect(w[0] - w[2] / 2 - 0.3, w[1] - 1.1, w[2] + 0.6, 1.9);
        c.fillStyle = white; c.fillRect(w[0] - w[2] / 2 + 1, -2, w[2] - 2, 4);
      });
    } else if (d.id === 'volt') {
      c.fillStyle = shade(color, -0.45); c.fillRect(-35, -11, 3.4, 22);
    } else if (d.id === 'viper') {
      c.fillStyle = shade(color, -0.5); c.fillRect(-37, -13.5, 3.6, 27); c.fillStyle = '#10131f'; c.fillRect(-35.6, -13.5, 1.2, 27);
    } else if (d.id === 'dart') {
      c.fillStyle = shade(color, -0.5); c.fillRect(-32, -10, 3, 20);
    } else if (d.id === 'phantom') {
      c.fillStyle = '#0c1020'; c.beginPath(); c.moveTo(-35, -9); c.lineTo(-30, -12.5); c.lineTo(-30, 12.5); c.lineTo(-35, 9); c.closePath(); c.fill();
      c.strokeStyle = shade(color, 0.5); c.lineWidth = 0.8; c.stroke();
    } else if (d.id === 'bruiser') {
      c.fillStyle = '#10131f'; c.fillRect(-35, -14, 3.4, 28); c.fillStyle = shade(color, -0.2); c.fillRect(-35, -14, 1.2, 28);
    }

    lights(c, d);
    return cv;
  }

  function getSprite(di, color) {
    const k = di + '|' + color;
    let s = cache.get(k);
    if (!s) { s = renderSprite(di, color); cache.set(k, s); }
    return s;
  }

  /* glow sprites (cached per colour) for additive underglow */
  const glowCache = new Map();
  function getGlow(color) {
    let g = glowCache.get(color);
    if (g) return g;
    g = document.createElement('canvas'); g.width = g.height = 128;
    const c = g.getContext('2d'), gr = c.createRadialGradient(64, 64, 2, 64, 64, 64);
    gr.addColorStop(0, rgba(color, 0.95)); gr.addColorStop(0.35, rgba(color, 0.35)); gr.addColorStop(1, rgba(color, 0));
    c.fillStyle = gr; c.fillRect(0, 0, 128, 128);
    glowCache.set(color, g);
    return g;
  }

  /* ---------------------------- world drawing ---------------------------- */
  function drawWheels(ctx, d, steer) {
    const w = d.wheels;
    ctx.fillStyle = '#0b0c12';
    const one = (x, y, ang) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.fillStyle = '#0a0b10'; ctx.fillRect(-w.w / 2, -w.h / 2, w.w, w.h);
      ctx.fillStyle = 'rgba(120,130,160,.35)'; ctx.fillRect(-w.w / 2 + 1, -w.h / 2 + 0.6, w.w - 2, 1);
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(-1.2, -w.h / 2, 2.4, w.h);
      ctx.restore();
    };
    const sa = steer * 0.52;
    one(w.fx, -w.y, sa); one(w.fx, w.y, sa);
    one(w.rx, -w.y, 0); one(w.rx, w.y, 0);
  }

  /** Draws a complete car at world position. `car` needs x,y,a,design,color,steerVis,braking,reversing,nitroOn */
  function drawCar(ctx, car, time, opts) {
    const d = DESIGNS[car.design], spr = getSprite(car.design, car.color);
    const night = opts && opts.night;
    ctx.save();
    ctx.translate(car.x, car.y); ctx.rotate(car.a);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.beginPath(); ctx.ellipse(3, 5, 36, 17, 0, 0, 7); ctx.fill();
    // underglow
    const glow = getGlow(car.color);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = night ? 0.8 : 0.4;
    ctx.drawImage(glow, -52, -42, 104, 84);
    // headlights
    if (night || (opts && opts.dusk)) {
      ctx.globalAlpha = night ? 0.2 : 0.1;
      const hg = ctx.createLinearGradient(30, 0, 200, 0);
      hg.addColorStop(0, 'rgba(255,248,210,.9)'); hg.addColorStop(1, 'rgba(255,248,210,0)');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.moveTo(28, -7); ctx.lineTo(210, -62); ctx.lineTo(210, 62); ctx.lineTo(28, 7); ctx.closePath(); ctx.fill();
    }
    // brake / reverse lamps
    if (car.braking || car.reversing) {
      ctx.globalAlpha = 0.9;
      const lg = getGlow(car.reversing ? '#ffffff' : '#ff2a3a');
      ctx.drawImage(lg, -52, -22, 36, 44);
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    if (!d.openWheel) drawWheels(ctx, d, car.steerVis);
    ctx.drawImage(spr, -SW / 2, -SH / 2, SW, SH);
    if (d.openWheel) drawWheels(ctx, d, car.steerVis);
    // spawn-protection blink
    if (car.ghostT > 0 && ((time * 12) | 0) % 2) { ctx.globalAlpha = 0.5; ctx.drawImage(spr, -SW / 2, -SH / 2, SW, SH); ctx.globalAlpha = 1; }
    ctx.restore();
  }

  /** Nitro flame cones (additive) – call after cars. */
  function drawFlame(ctx, car, time, power) {
    const d = DESIGNS[car.design], tailX = d.prof[d.prof.length - 1][0], ey = d.prof[d.prof.length - 2][1] * 0.45;
    ctx.save();
    ctx.translate(car.x, car.y); ctx.rotate(car.a);
    ctx.globalCompositeOperation = 'lighter';
    for (let s = -1; s <= 1; s += 2) {
      const len = (46 + Math.random() * 26 + Math.sin(time * 70 + s) * 6) * power, wid = 6.2 + Math.random() * 1.8;
      const g = ctx.createLinearGradient(tailX, 0, tailX - len, 0);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, shade(car.color, 0.55));
      g.addColorStop(0.6, rgba(car.color, 0.6)); g.addColorStop(1, rgba('#ff2fd0', 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(tailX + 1, s * ey - wid * 0.5);
      ctx.quadraticCurveTo(tailX - len * 0.55, s * ey - wid * 0.9, tailX - len, s * ey + (Math.random() - 0.5) * 3);
      ctx.quadraticCurveTo(tailX - len * 0.55, s * ey + wid * 0.9, tailX + 1, s * ey + wid * 0.5);
      ctx.closePath(); ctx.fill();
      // inner core
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.beginPath(); ctx.ellipse(tailX - len * 0.12, s * ey, len * 0.16, wid * 0.32, 0, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  /** Draws a rotated car on a preview canvas (garage / summary). */
  function drawPreview(cv, di, color, ang, scale) {
    const c = cv.getContext('2d'), w = cv.width, h = cv.height;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w, h);
    c.translate(w / 2, h / 2); c.scale(scale, scale); c.rotate(ang);
    const d = DESIGNS[di], spr = getSprite(di, color);
    c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.55; c.drawImage(getGlow(color), -64, -52, 128, 104);
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(3, 6, 38, 17, 0, 0, 7); c.fill();
    if (!d.openWheel) drawWheels(c, d, 0);
    c.drawImage(spr, -SW / 2, -SH / 2, SW, SH);
    if (d.openWheel) drawWheels(c, d, 0);
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  root.NRCars = { DESIGNS, COLORS, STAT_NAMES, POOL, STAT_MAX, specsFor, drawCar, drawFlame, drawPreview, getGlow, shade, rgba, rgb };
})(window);
