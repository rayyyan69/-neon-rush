/* NEON RUSH: DUEL RACERS — track definitions, geometry builder and scenery generator.
   Pure data/maths (no DOM) so it can also be unit-checked from Node. */
(function (root) {
  'use strict';

  const SPACING = 14; // distance between centre-line samples (world units)

  /* ------------------------------------------------------------------ *
   *  Track definitions. Control points form a closed loop; the first
   *  point sits in the middle of the start/finish straight (heading
   *  east) and the loop is driven in point order.
   * ------------------------------------------------------------------ */
  const TRACK_DEFS = [
    {
      id: 'city', name: 'NEON CITY', theme: 'city',
      tagline: 'Futuristic night circuit. Glowing signs, sharp turns.',
      width: 210, margin: 80, difficulty: 4, lapPar: 31,
      points: [
        [0, 0], [900, 0], [1700, 0], [2250, 20], [2650, 330], [2700, 850],
        [2300, 1180], [1800, 1050], [1450, 1350], [1600, 1900], [2150, 2150],
        [2250, 2700], [1650, 3000], [850, 2900], [350, 2450], [700, 1950],
        [250, 1550], [-450, 1600], [-1000, 1200], [-950, 600], [-650, 150], [-350, 0]
      ]
    },
    {
      id: 'desert', name: 'DESERT STORM', theme: 'desert',
      tagline: 'Sun-baked canyon run. Wide corners, huge top speeds.',
      width: 270, margin: 90, difficulty: 2, lapPar: 38,
      points: [
        [0, 0], [1000, 0], [2000, -60], [3000, -40], [3900, 350], [4200, 1100],
        [3800, 1800], [3000, 2000], [2400, 2500], [2500, 3200], [1900, 3700],
        [1000, 3600], [500, 3000], [800, 2400], [300, 1900], [-500, 2000],
        [-1100, 1500], [-1000, 700], [-600, 200]
      ]
    },
    {
      id: 'forest', name: 'FOREST SPEEDWAY', theme: 'forest',
      tagline: 'Flowing woodland loop with river bridges.',
      width: 230, margin: 80, difficulty: 3, lapPar: 35,
      river: [[-1500, 1500], [-300, 1350], [700, 1500], [1700, 1250], [2700, 1400], [3700, 1250]],
      points: [
        [0, 0], [900, 0], [1800, 100], [2500, 500], [2900, 1200], [2700, 1900],
        [2000, 2300], [1900, 2900], [2400, 3400], [1900, 3900], [1000, 3800],
        [500, 3200], [900, 2600], [400, 2000], [-300, 2200], [-900, 1800],
        [-1000, 1000], [-700, 400], [-350, 100]
      ]
    }
  ];

  /* ----------------------------- helpers ----------------------------- */
  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function crPoint(p0, p1, p2, p3, t) { // centripetal Catmull-Rom (Barry–Goldman)
    const d = (a, b) => Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])) || 1e-4;
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    const tt = t1 + (t2 - t1) * t;
    const L = (a, b, ta, tb) => {
      const k = (tt - ta) / (tb - ta);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    };
    const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
    const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
    return L(B1, B2, t1, t2);
  }

  function buildTrack(def) {
    const P = def.points, n = P.length, SUB = 48, dense = [];
    for (let i = 0; i < n; i++) {
      const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
      for (let k = 0; k < SUB; k++) dense.push(crPoint(p0, p1, p2, p3, k / SUB));
    }
    dense.push(dense[0]);
    const cum = [0];
    for (let i = 1; i < dense.length; i++)
      cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    const total = cum[cum.length - 1];
    const N = Math.round(total / SPACING), step = total / N;
    const px = new Float32Array(N), py = new Float32Array(N);
    let j = 0;
    for (let i = 0; i < N; i++) {
      const s = i * step;
      while (cum[j + 1] < s) j++;
      const f = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
      px[i] = dense[j][0] + (dense[j + 1][0] - dense[j][0]) * f;
      py[i] = dense[j][1] + (dense[j + 1][1] - dense[j][1]) * f;
    }
    // light smoothing keeps tangents clean
    for (let pass = 0; pass < 2; pass++) {
      const ox = Float32Array.from(px), oy = Float32Array.from(py);
      for (let i = 0; i < N; i++) {
        const a = (i - 1 + N) % N, b = (i + 1) % N;
        px[i] = ox[a] * 0.25 + ox[i] * 0.5 + ox[b] * 0.25;
        py[i] = oy[a] * 0.25 + oy[i] * 0.5 + oy[b] * 0.25;
      }
    }
    const S = new Float32Array(N + 1), ang = new Float32Array(N), nx = new Float32Array(N), ny = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const b = (i + 1) % N;
      S[i + 1] = S[i] + Math.hypot(px[b] - px[i], py[b] - py[i]);
    }
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      const tx = px[b] - px[a], ty = py[b] - py[a], l = Math.hypot(tx, ty) || 1;
      ang[i] = Math.atan2(ty, tx);
      nx[i] = -ty / l; ny[i] = tx / l; // right-hand normal (screen coordinates, y down)
    }
    const tr = {
      def, id: def.id, name: def.name, theme: def.theme,
      n: N, px, py, S, L: S[N], ang, nx, ny,
      roadHalf: def.width / 2, wallHalf: def.width / 2 + def.margin, curb: 16
    };
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < N; i++) {
      x0 = Math.min(x0, px[i]); x1 = Math.max(x1, px[i]);
      y0 = Math.min(y0, py[i]); y1 = Math.max(y1, py[i]);
    }
    tr.bounds = { x0, y0, x1, y1 };
    // bridges = stretches of road that cross the river
    tr.bridges = [];
    if (def.river) {
      const rh = 95, near = [];
      for (let i = 0; i < N; i++) near.push(distToPolyline(px[i], py[i], def.river) < rh + 70);
      let start = -1;
      for (let i = 0; i <= N; i++) {
        const v = i < N && near[i];
        if (v && start < 0) start = i;
        if (!v && start >= 0) { tr.bridges.push([start, i - 1]); start = -1; }
      }
    }
    // wall distance per sample: narrows to rails on bridges
    tr.wallOff = new Float32Array(N).fill(tr.wallHalf);
    const narrow = tr.roadHalf + tr.curb + 14, ramp = 12;
    tr.bridges.forEach(([a, b]) => {
      for (let i = a - ramp; i <= b + ramp; i++) {
        const dd = i < a ? a - i : i > b ? i - b : 0, f = Math.min(1, dd / ramp), idx = (i + N) % N;
        tr.wallOff[idx] = Math.min(tr.wallOff[idx], narrow + (tr.wallHalf - narrow) * f * f);
      }
    });
    return tr;
  }

  function distToPolyline(x, y, pl) {
    let best = 1e18;
    for (let i = 0; i < pl.length - 1; i++) {
      const ax = pl[i][0], ay = pl[i][1], bx = pl[i + 1][0], by = pl[i + 1][1];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
    }
    return best;
  }

  /* Diagnostics: tightest radius and the closest approach of two distant parts of the lap. */
  function analyzeTrack(tr) {
    const N = tr.n, k = 6;
    let minR = 1e9, minRi = 0;
    for (let i = 0; i < N; i++) {
      const a = (i - k + N) % N, b = (i + k) % N;
      const d1 = Math.atan2(tr.py[i] - tr.py[a], tr.px[i] - tr.px[a]);
      const d2 = Math.atan2(tr.py[b] - tr.py[i], tr.px[b] - tr.px[i]);
      let da = d2 - d1; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      const ds = tr.S[b > i ? b : b + N] - tr.S[a < i ? a : a - N + N] || 1;
      const seg = Math.hypot(tr.px[b] - tr.px[a], tr.py[b] - tr.py[a]);
      const r = Math.abs(da) < 1e-4 ? 1e9 : seg / Math.abs(da) / 1;
      if (r < minR) { minR = r; minRi = i; }
    }
    let minSep = 1e9, sepI = 0, sepJ = 0;
    for (let i = 0; i < N; i += 2) for (let j = i + 1; j < N; j += 2) {
      const along = Math.min(j - i, N - (j - i)) * SPACING;
      if (along < 900) continue;
      const d = Math.hypot(tr.px[i] - tr.px[j], tr.py[i] - tr.py[j]);
      if (d < minSep) { minSep = d; sepI = i; sepJ = j; }
    }
    return { length: tr.L, minRadius: minR, minRadiusAt: minRi, minSep, sepI, sepJ, samples: N };
  }

  /* --------------------------- scenery ------------------------------- */
  function generateScenery(tr) {
    const def = tr.def, r = rng(def.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
    const N = tr.n, sub = [];
    for (let i = 0; i < N; i += 2) sub.push(i);
    const dist = (x, y) => {
      let b = 1e18;
      for (let q = 0; q < sub.length; q++) {
        const i = sub[q], dx = tr.px[i] - x, dy = tr.py[i] - y, d = dx * dx + dy * dy;
        if (d < b) b = d;
      }
      return Math.sqrt(b);
    };
    const B = tr.bounds, pad = 1100;
    const X0 = B.x0 - pad, X1 = B.x1 + pad, Y0 = B.y0 - pad, Y1 = B.y1 + pad;
    const out = [], placed = [];
    const wall = tr.wallHalf;
    const riverOK = (x, y, m) => !def.river || distToPolyline(x, y, def.river) > 95 + m;
    const free = (x, y, rad) => {
      for (let i = 0; i < placed.length; i++) {
        const p = placed[i];
        if (Math.hypot(p[0] - x, p[1] - y) < p[2] + rad) return false;
      }
      return true;
    };
    const add = (o) => { out.push(o); placed.push([o.x, o.y, o.r * 0.85]); };
    const rx = () => X0 + r() * (X1 - X0), ry = () => Y0 + r() * (Y1 - Y0);

    if (def.theme === 'city') {
      const hues = [185, 300, 330, 205, 270, 160, 45];
      for (let tries = 0; tries < 5200 && out.length < 340; tries++) {
        const x = rx(), y = ry(), w = 90 + r() * 200, h = 90 + r() * 200;
        const rad = Math.hypot(w, h) / 2;
        const d = dist(x, y);
        if (d < wall + rad * 0.75 + 30 || d > 1100) continue;
        if (!free(x, y, rad)) continue;
        add({ t: 'bld', x, y, w, h, a: 0, r: rad, hue: hues[(r() * hues.length) | 0], lvl: 1 + ((r() * 3) | 0), k: (r() * 4) | 0 });
      }
      // lamps + neon signs along the barrier
      for (let i = 0; i < N; i += 28) {
        const side = ((i / 28) | 0) % 2 ? 1 : -1, off = wall + 46;
        out.push({ t: 'lamp', x: tr.px[i] + tr.nx[i] * off * side, y: tr.py[i] + tr.ny[i] * off * side, r: 190, side });
      }
      for (let i = 14; i < N; i += 60) {
        const side = ((i / 60) | 0) % 2 ? -1 : 1, off = wall + 70;
        out.push({ t: 'sign', x: tr.px[i] + tr.nx[i] * off * side, y: tr.py[i] + tr.ny[i] * off * side,
          a: tr.ang[i], r: 120, len: 150 + r() * 70, hue: hues[(r() * hues.length) | 0] });
      }
    } else if (def.theme === 'desert') {
      for (let tries = 0; tries < 900 && out.length < 90; tries++) {
        const x = rx(), y = ry(), rr = 120 + r() * 220;
        if (dist(x, y) < wall + 40) continue;
        out.push({ t: 'dune', x, y, rx: rr, ry: rr * (0.35 + r() * 0.3), a: r() * Math.PI, r: rr });
      }
      const dunes = out.length;
      for (let tries = 0; tries < 4200 && out.length < dunes + 230; tries++) {
        const x = rx(), y = ry(), rad = 24 + r() * 60, d = dist(x, y);
        if (d < wall + rad + 20 || d > 1300 || !free(x, y, rad)) continue;
        add({ t: 'rock', x, y, r: rad, seed: (r() * 1000) | 0 });
      }
      for (let tries = 0; tries < 3000 && out.length < dunes + 330; tries++) {
        const x = rx(), y = ry(), rad = 18, d = dist(x, y);
        if (d < wall + 40 || d > 1100 || !free(x, y, rad)) continue;
        add({ t: 'cac', x, y, r: rad + 6, s: 0.8 + r() * 0.7, a: r() * 6.28 });
      }
      for (let i = 0; i < N; i += 40) { // sponsor tyre stacks near the barrier
        const side = ((i / 40) | 0) % 2 ? 1 : -1, off = wall + 52;
        out.push({ t: 'flag', x: tr.px[i] + tr.nx[i] * off * side, y: tr.py[i] + tr.ny[i] * off * side, r: 40, a: tr.ang[i], hue: ((i / 40) | 0) % 3 });
      }
    } else { // forest
      for (let tries = 0; tries < 7000 && out.length < 520; tries++) {
        const x = rx(), y = ry(), rad = 30 + r() * 46, d = dist(x, y);
        if (d < wall + rad * 0.55 + 18 || d > 1250 || !riverOK(x, y, rad * 0.5) || !free(x, y, rad * 0.8)) continue;
        const k = r();
        add({ t: k < 0.62 ? 'tree' : k < 0.84 ? 'pine' : 'bush', x, y, r: k < 0.84 ? rad : rad * 0.55, v: (r() * 5) | 0, seed: (r() * 1000) | 0 });
      }
      for (let tries = 0; tries < 2000 && out.length < 600; tries++) {
        const x = rx(), y = ry(), d = dist(x, y);
        if (d < wall + 30 || d > 900 || !riverOK(x, y, 30)) continue;
        out.push({ t: 'flower', x, y, r: 10, c: (r() * 4) | 0 });
      }
    }
    return out;
  }

  const api = { TRACK_DEFS, buildTrack, analyzeTrack, generateScenery, distToPolyline, rng, SPACING };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NRTracks = api;
})(typeof window !== 'undefined' ? window : globalThis);
