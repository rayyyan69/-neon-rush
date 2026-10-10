/* NEON RUSH: DUEL RACERS — fully procedural audio (Web Audio API). No audio files, no network. */
(function (root) {
  'use strict';

  let ctx = null, master, musicBus, sfxBus, noiseBuf = null;
  const vol = { music: 0.5, sfx: 0.8, mute: false };
  let engines = [];
  let musicTimer = null;
  const mus = { mode: 'menu', step: 0, next: 0, root: 45, bpm: 100, on: false, duck: 1 };

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function ensure() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return false;
      try { ctx = new AC(); } catch (e) { ctx = null; return false; }
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
      master = ctx.createGain(); musicBus = ctx.createGain(); sfxBus = ctx.createGain();
      musicBus.connect(master); sfxBus.connect(master); master.connect(comp); comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      applyVolumes();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  }

  function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(vol.mute ? 0 : 1, t, 0.03);
    musicBus.gain.setTargetAtTime(vol.music * 0.5 * mus.duck, t, 0.05);
    sfxBus.gain.setTargetAtTime(vol.sfx, t, 0.03);
  }

  function setVolumes(v) { Object.assign(vol, v); applyVolumes(); }

  /* ----------------------------- one-shots ----------------------------- */
  function tone(freq, dur, type, gain, when, slideTo, bus) {
    if (!ctx) return;
    const t = (when || ctx.currentTime), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise(dur, gain, type, f0, f1, when, bus, q) {
    if (!ctx) return;
    const t = when || ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true;
    f.type = type || 'lowpass'; f.Q.value = q || 0.8;
    f.frequency.setValueAtTime(f0 || 1000, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.3, t + Math.min(0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus || sfxBus);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  const sfx = {
    click() { if (ensure()) { tone(880, 0.07, 'square', 0.07); tone(1320, 0.06, 'square', 0.05, ctx.currentTime + 0.035); } },
    hover() { if (ctx) tone(520, 0.04, 'triangle', 0.035); },
    back() { if (ensure()) tone(520, 0.09, 'square', 0.07, 0, 330); },
    beep() { if (ensure()) { tone(440, 0.22, 'square', 0.16); tone(440, 0.22, 'sine', 0.2); } },
    go() {
      if (!ensure()) return;
      tone(880, 0.55, 'square', 0.15); tone(1760, 0.55, 'sine', 0.18);
      noise(0.7, 0.25, 'bandpass', 400, 4000);
    },
    lap() { if (ensure()) { const t = ctx.currentTime; tone(988, 0.12, 'triangle', 0.18, t); tone(1319, 0.2, 'triangle', 0.18, t + 0.1); } },
    bestLap() { if (ensure()) { const t = ctx.currentTime; [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.16, 'triangle', 0.16, t + i * 0.07)); } },
    finish() { if (ensure()) { const t = ctx.currentTime; [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'square', 0.1, t + i * 0.09)); } },
    win() {
      if (!ensure()) return;
      const t = ctx.currentTime, n = [523, 659, 784, 1047, 784, 1047, 1319];
      n.forEach((f, i) => { tone(f, 0.28, 'square', 0.1, t + i * 0.13); tone(f / 2, 0.28, 'triangle', 0.14, t + i * 0.13); });
    },
    lose() { if (ensure()) { const t = ctx.currentTime; [392, 349, 311, 261].forEach((f, i) => tone(f, 0.3, 'sawtooth', 0.07, t + i * 0.16)); } },
    nitro() {
      if (!ensure()) return;
      noise(0.55, 0.3, 'bandpass', 600, 5200, 0, 0, 1.2);
      tone(180, 0.5, 'sawtooth', 0.09, 0, 720);
    },
    nitroEmpty() { if (ensure()) tone(200, 0.12, 'square', 0.08, 0, 120); },
    collide(k) {
      if (!ensure()) return;
      k = Math.max(0.15, Math.min(1, k));
      noise(0.25, 0.5 * k, 'lowpass', 1800, 150);
      tone(130, 0.22, 'sine', 0.5 * k, 0, 45);
      if (k > 0.4) noise(0.18, 0.2 * k, 'highpass', 3000, 6000);
    },
    scrape() { if (ctx) noise(0.12, 0.08, 'bandpass', 2500, 1500, 0, 0, 2); },
    reset() { if (ensure()) tone(300, 0.3, 'triangle', 0.14, 0, 900); }
  };

  /* ------------------------- continuous engines ------------------------- */
  function makeEngine(pan) {
    if (!ensure()) return null;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o1.type = 'sawtooth'; o2.type = 'square';
    f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 2;
    g.gain.value = 0;
    const pn = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pn) pn.pan.value = pan;
    o1.connect(f); o2.connect(f); f.connect(g);
    if (pn) { g.connect(pn); pn.connect(sfxBus); } else g.connect(sfxBus);
    // tyre screech
    const sn = ctx.createBufferSource(), sf = ctx.createBiquadFilter(), sg = ctx.createGain();
    sn.buffer = noiseBuf; sn.loop = true; sf.type = 'bandpass'; sf.frequency.value = 1700; sf.Q.value = 4; sg.gain.value = 0;
    sn.connect(sf); sf.connect(sg);
    // nitro hiss
    const nn = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = ctx.createGain();
    nn.buffer = noiseBuf; nn.loop = true; nf.type = 'highpass'; nf.frequency.value = 1600; ng.gain.value = 0;
    nn.connect(nf); nf.connect(ng);
    // off-road rumble
    const rn = ctx.createBufferSource(), rf = ctx.createBiquadFilter(), rg = ctx.createGain();
    rn.buffer = noiseBuf; rn.loop = true; rf.type = 'lowpass'; rf.frequency.value = 280; rg.gain.value = 0;
    rn.connect(rf); rf.connect(rg);
    if (pn) { sg.connect(pn); ng.connect(pn); rg.connect(pn); } else { sg.connect(sfxBus); ng.connect(sfxBus); rg.connect(sfxBus); }
    o1.start(); o2.start(); sn.start(0, Math.random()); nn.start(0, Math.random()); rn.start(0, Math.random());
    const eng = {
      update(speedFrac, throttle, screech, nitro, offroad, active) {
        const t = ctx.currentTime, s = Math.max(0, speedFrac) * 4.2, gear = Math.min(3, Math.floor(s)), within = Math.min(1, s - gear);
        const freq = 58 + gear * 16 + within * 62 + throttle * 20 + (nitro ? 18 : 0);
        o1.frequency.setTargetAtTime(freq, t, 0.04);
        o2.frequency.setTargetAtTime(freq * 0.502, t, 0.04);
        f.frequency.setTargetAtTime(380 + within * 700 + throttle * 600 + (nitro ? 500 : 0), t, 0.05);
        g.gain.setTargetAtTime(active ? 0.05 + throttle * 0.04 + speedFrac * 0.03 : 0, t, 0.06);
        sg.gain.setTargetAtTime(active ? Math.min(0.2, screech * 0.2) : 0, t, 0.04);
        sf.frequency.setTargetAtTime(1500 + screech * 900, t, 0.1);
        ng.gain.setTargetAtTime(active && nitro ? 0.16 : 0, t, 0.05);
        rg.gain.setTargetAtTime(active && offroad ? 0.18 * Math.min(1, speedFrac * 2) : 0, t, 0.08);
      },
      silence() {
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(0, t, 0.05); sg.gain.setTargetAtTime(0, t, 0.05);
        ng.gain.setTargetAtTime(0, t, 0.05); rg.gain.setTargetAtTime(0, t, 0.05);
      },
      stop() {
        try { o1.stop(); o2.stop(); sn.stop(); nn.stop(); rn.stop(); } catch (e) { /* already stopped */ }
        [o1, o2, f, g, sn, sf, sg, nn, nf, ng, rn, rf, rg].forEach((n) => { try { n.disconnect(); } catch (e) { /* noop */ } });
      }
    };
    engines.push(eng);
    return eng;
  }

  function stopEngines() { engines.forEach((e) => e.stop()); engines = []; }
  function silenceEngines() { engines.forEach((e) => e.silence()); }

  /* ------------------------------ music ------------------------------- */
  // Am – F – C – G progression, 16 steps per bar (ROOTS are semitone offsets from A)
  const ROOTS = [0, -4, 3, -2];
  const ARP = [0, 1, 2, 1, 2, 1, 0, 1, 2, 1, 2, 3, 2, 1, 0, 1];

  function scheduleStep(step, t) {
    const bar = ((step / 16) | 0) % 4, s16 = step % 16;
    const root = mus.root + ROOTS[bar], race = mus.mode === 'race', spb = 60 / mus.bpm / 4;
    const chord = [0, bar === 0 ? 3 : 4, 7];
    // bass
    if (race ? s16 % 2 === 0 || s16 % 8 === 7 : s16 % 8 === 0) {
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = mtof(root - 12 + (s16 % 8 === 6 ? 12 : 0));
      f.type = 'lowpass'; f.frequency.setValueAtTime(race ? 900 : 420, t); f.frequency.exponentialRampToValueAtTime(160, t + spb * 1.8);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(race ? 0.2 : 0.16, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + spb * (race ? 1.7 : 6));
      o.connect(f); f.connect(g); g.connect(musicBus); o.start(t); o.stop(t + spb * 6 + 0.1);
    }
    // arpeggio
    if (race || s16 % 2 === 0) {
      const n = root + 12 + chord[ARP[s16] % 3] + (ARP[s16] === 3 ? 12 : 0) + 12;
      tone(mtof(n), spb * 1.6, race ? 'square' : 'triangle', race ? 0.05 : 0.07, t, 0, musicBus);
    }
    // pad on bar start
    if (s16 === 0) {
      chord.forEach((c) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sawtooth'; o.frequency.value = mtof(root + 12 + c); o.detune.value = (Math.random() - 0.5) * 12;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(race ? 0.025 : 0.045, t + spb * 3);
        g.gain.linearRampToValueAtTime(0.0001, t + spb * 16);
        o.connect(f); f.connect(g); g.connect(musicBus); o.start(t); o.stop(t + spb * 16 + 0.1);
      });
    }
    if (race) {
      if (s16 % 4 === 0) { // kick
        tone(150, 0.16, 'sine', 0.5, t, 40, musicBus);
      }
      if (s16 % 4 === 2) noise(0.05, 0.07, 'highpass', 7000, 9000, t, musicBus); // hat
      if (s16 % 8 === 4) noise(0.12, 0.12, 'bandpass', 1800, 1500, t, musicBus, 0.8); // snare
    } else if (s16 % 4 === 2) noise(0.04, 0.03, 'highpass', 8000, 9000, t, musicBus);
  }

  function pump() {
    if (!ctx || !mus.on) return;
    if (ctx.state !== 'running') { mus.next = ctx.currentTime + 0.05; return; }
    const spb = 60 / mus.bpm / 4;
    if (mus.next < ctx.currentTime - 0.3) mus.next = ctx.currentTime + 0.05;
    while (mus.next < ctx.currentTime + 0.25) {
      scheduleStep(mus.step, mus.next);
      mus.step = (mus.step + 1) % 64;
      mus.next += spb;
    }
  }

  const music = {
    start(mode, opts) {
      if (!ensure()) return;
      opts = opts || {};
      const changed = mus.mode !== mode || (opts.root != null && opts.root !== mus.root - 45);
      mus.mode = mode;
      mus.root = 45 + (opts.root || 0);
      mus.bpm = mode === 'race' ? (opts.bpm || 132) : 92;
      if (!mus.on || changed) { mus.step = 0; mus.next = ctx.currentTime + 0.08; }
      mus.on = true;
      if (!musicTimer) musicTimer = setInterval(pump, 50);
    },
    stop() { mus.on = false; if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } },
    duck(v) { mus.duck = v; applyVolumes(); },
    get running() { return mus.on; }
  };

  root.NRAudio = { ensure, setVolumes, sfx, music, makeEngine, stopEngines, silenceEngines, get ready() { return !!ctx; } };
})(typeof window !== 'undefined' ? window : globalThis);
