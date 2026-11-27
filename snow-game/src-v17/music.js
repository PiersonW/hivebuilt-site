// Background music: original pop-punk, played live with WebAudio (no audio files).
// Fast down-picked distorted power chords, palm-muted verses, open choruses with a sing-along lead,
// punchy drums and bass. Two songs that alternate. Starts after your first click / key / button press.

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Songs: chord roots are guitar power-chord roots (MIDI, low register); each bar = 8 eighth notes.
// Sections: style 'mute' (palm-muted verse), 'open' (chorus), 'hits' (ringing accents), 'half' (half-time bridge).
const SONGS = [
  {
    name: 'Fresh Tracks', bpm: 176,
    parts: [
      { style: 'hits', drums: 'intro', bars: [50, 45, 47, 43] },
      { style: 'mute', drums: 'verse', bars: [50, 50, 45, 45, 47, 47, 43, 45] },
      { style: 'mute', drums: 'verse', bars: [50, 50, 45, 45, 47, 47, 43, 45] },
      { style: 'hits', drums: 'build', bars: [43, 45, 47, 45] },
      { style: 'open', drums: 'chorus', lead: [66, 66, 64, 62, 64, 64, 62, 61, 62, 62, 64, 66, 67, 66, 64, null, 66, 69, 69, 66, 64, 66, 64, 61, 62, 64, 66, 67, 66, 64, 61, null], bars: [50, 45, 47, 43, 50, 45, 43, 45] },
      { style: 'mute', drums: 'verse', bars: [50, 50, 45, 45, 47, 47, 43, 45] },
      { style: 'open', drums: 'chorus', lead: [66, 66, 64, 62, 64, 64, 62, 61, 62, 62, 64, 66, 67, 66, 64, null, 66, 69, 69, 66, 64, 66, 64, 61, 62, 64, 66, 67, 66, 64, 61, null], bars: [50, 45, 47, 43, 50, 45, 43, 45] },
      { style: 'half', drums: 'half', bars: [47, 43, 50, 45, 47, 43, 45, 45] },
      { style: 'open', drums: 'chorus', lead: [66, 66, 64, 62, 64, 64, 62, 61, 62, 62, 64, 66, 67, 66, 64, null, 66, 69, 69, 66, 64, 66, 64, 61, 62, 64, 66, 67, 66, 64, 61, null], bars: [50, 45, 47, 43, 50, 45, 43, 45] },
      { style: 'hits', drums: 'end', bars: [50, 50] },
    ],
  },
  {
    name: 'Lift Line', bpm: 168,
    parts: [
      { style: 'mute', drums: 'intro', bars: [52, 52, 49, 49] },
      { style: 'mute', drums: 'verse', bars: [52, 52, 49, 49, 45, 45, 47, 47] },
      { style: 'open', drums: 'verse', bars: [45, 47, 52, 49, 45, 47, 52, 52] },
      { style: 'open', drums: 'chorus', lead: [68, 68, 71, 68, 66, 66, 68, null, 64, 66, 68, 69, 68, 66, 64, null, 68, 68, 71, 73, 71, 69, 68, 66, 64, 66, 68, 66, 64, null, 64, null], bars: [45, 47, 52, 49, 45, 47, 52, 52] },
      { style: 'mute', drums: 'verse', bars: [52, 52, 49, 49, 45, 45, 47, 47] },
      { style: 'half', drums: 'half', bars: [49, 45, 52, 47] },
      { style: 'hits', drums: 'build', bars: [45, 47, 49, 47] },
      { style: 'open', drums: 'chorus', lead: [68, 68, 71, 68, 66, 66, 68, null, 64, 66, 68, 69, 68, 66, 64, null, 68, 68, 71, 73, 71, 69, 68, 66, 64, 66, 68, 66, 64, null, 64, null], bars: [45, 47, 52, 49, 45, 47, 52, 52] },
      { style: 'hits', drums: 'end', bars: [52, 52] },
    ],
  },
];

export class Music {
  constructor() {
    this.enabled = true;
    try { this.enabled = localStorage.getItem('snowMusic') !== 'off'; } catch {}
    this.ctx = null;
    this.volume = 0.28;
  }

  // call from a user gesture (click / key / button)
  start() {
    if (!this.enabled) return;
    if (!this.ctx) this._init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this.timer) {
      this.nextTime = this.ctx.currentTime + 0.15;
      this.timer = setInterval(() => this._schedule(), 30);
    }
    this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.3);
  }

  stop() {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    clearInterval(this.timer); this.timer = null;
  }

  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem('snowMusic', this.enabled ? 'on' : 'off'); } catch {}
    if (this.enabled) this.start(); else this.stop();
    return this.enabled;
  }

  _init() {
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    // two guitar tracks panned left and right (double-tracked), each through heavy distortion + a "cab" filter
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 14) * 0.9; }
    this.guitars = [-0.7, 0.7].map(pan => {
      const pre = ctx.createGain(); pre.gain.value = 1.6;
      const ws = ctx.createWaveShaper(); ws.curve = curve; ws.oversample = '2x';
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 110;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3600; lp.Q.value = 0.9;
      const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 900; mid.gain.value = -4;
      const out = ctx.createGain(); out.gain.value = 0.16;
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      pre.connect(ws); ws.connect(hp); hp.connect(mid); mid.connect(lp); lp.connect(out); out.connect(p); p.connect(this.master);
      return pre;
    });
    this.bassBus = ctx.createGain(); this.bassBus.gain.value = 0.32;
    const blp = ctx.createBiquadFilter(); blp.type = 'lowpass'; blp.frequency.value = 650;
    this.bassBus.connect(blp); blp.connect(this.master);
    this.drumBus = ctx.createGain(); this.drumBus.gain.value = 0.7; this.drumBus.connect(this.master);
    this.leadBus = ctx.createGain(); this.leadBus.gain.value = 0.14;
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 750; f1.Q.value = 1.4;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1150; f2.Q.value = 1.6;
    const lg = ctx.createGain(); lg.gain.value = 2.2;
    this.leadBus.connect(f1); this.leadBus.connect(f2); f1.connect(lg); f2.connect(lg);
    const dly = ctx.createDelay(); dly.delayTime.value = 0.26; const fb = ctx.createGain(); fb.gain.value = 0.22;
    lg.connect(this.master); lg.connect(dly); dly.connect(fb); fb.connect(dly); fb.connect(this.master);
    // white noise for the drums
    const n = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.song = 0; this.part = 0; this.bar = 0; this.step = 0;
  }

  _schedule() { this._scheduleUntil(this.ctx.currentTime + 0.15); }

  _scheduleUntil(until) {
    while (this.nextTime < until) {
      this._playStep(this.nextTime);
      const song = SONGS[this.song];
      this.nextTime += 60 / song.bpm / 2;
      // advance eighth -> bar -> part -> song
      this.step++;
      if (this.step >= 8) {
        this.step = 0; this.bar++;
        if (this.bar >= song.parts[this.part].bars.length) {
          this.bar = 0; this.part++;
          if (this.part >= song.parts.length) { this.part = 0; this.song = (this.song + 1) % SONGS.length; this.nextTime += 0.8; }
        }
      }
    }
  }

  _playStep(t) {
    const song = SONGS[this.song], part = song.parts[this.part], i = this.step, bar = this.bar;
    const root = part.bars[bar], e8 = 60 / song.bpm / 2;
    const lastBar = bar === part.bars.length - 1;
    // ---- guitars ----
    if (part.style === 'mute') this._chord(t, root, 0.075, 900, false);
    else if (part.style === 'open') this._chord(t, root, e8 * 1.05, 3200, true);
    else if (part.style === 'hits') { if (i === 0 || (i === 6 && part.drums !== 'end')) this._chord(t, root, e8 * (i === 0 ? 5.5 : 1.8), 3200, true); if (part.drums === 'end' && lastBar && i === 0) this._chord(t, root, 2.5, 3200, true); }
    else if (part.style === 'half') { if (i % 2 === 0) this._chord(t, root, e8 * 1.9, 2600, true); }
    // ---- bass: eighth notes on the root (quarters in the half-time bit) ----
    if (part.style !== 'hits' || i === 0) if (part.style !== 'half' || i % 2 === 0) this._bass(t, root - 12, part.style === 'hits' ? e8 * 5 : e8 * 0.9);
    // ---- lead (choruses) ----
    if (part.lead && i % 2 === 0) { const note = part.lead[bar * 4 + i / 2]; if (note) this._lead(t, note, e8 * 1.9); }
    // ---- drums ----
    const D = part.drums;
    if (i === 0 && bar === 0 && D !== 'intro') this._crash(t);
    if (D === 'intro') { if (lastBar && i >= 4) this._snare(t, 0.7); if (lastBar && i >= 6) this._snare(t + e8 / 2, 0.6); }
    else if (D === 'verse' || D === 'build') {
      if (i === 0 || i === 3 || i === 4) this._kick(t);
      if (i === 2 || i === 6) this._snare(t, 1);
      this._hat(t, i % 2 ? 0.18 : 0.28, false);
      if (D === 'build' && lastBar && i >= 4) { this._snare(t, 0.8); this._snare(t + e8 / 2, 0.7); }
    } else if (D === 'chorus') {
      // fast "skate beat": kick on the beat, snare on every off-beat, open hats
      if (i % 2 === 0) this._kick(t); else this._snare(t, 0.9);
      this._hat(t, 0.22, i % 2 === 1);
      if (lastBar && i === 7) this._snare(t + e8 / 2, 0.7);
    } else if (D === 'half') {
      if (i === 0 || i === 3) this._kick(t);
      if (i === 4) this._snare(t, 1);
      if (i % 2 === 0) this._hat(t, 0.25, false);
      if (lastBar && i >= 4) this._snare(t, 0.75);
    } else if (D === 'end') { if (i === 0) { this._kick(t); this._crash(t); } }
  }

  // ---- instruments ----
  _chord(t, root, len, cutoff, open) {
    const ctx = this.ctx, notes = open ? [root, root + 7, root + 12] : [root, root + 7];
    this.guitars.forEach((bus, side) => {
      const tt = t + side * 0.008;   // a hair apart, like two takes
      const g = ctx.createGain(), lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = cutoff;
      g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.5, tt + 0.004);
      g.gain.exponentialRampToValueAtTime(open ? 0.25 : 0.05, tt + len * 0.8);
      g.gain.linearRampToValueAtTime(0, tt + len);
      lp.connect(g); g.connect(bus);
      for (const m of notes) for (const det of [-6, 6]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midiHz(m); o.detune.value = det + side * 3;
        o.connect(lp); o.start(tt); o.stop(tt + len + 0.02);
      }
    });
  }

  _bass(t, m, len) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = midiHz(m);
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.25, t + len * 0.9); g.gain.linearRampToValueAtTime(0, t + len);
    o.connect(g); g.connect(this.bassBus); o.start(t); o.stop(t + len + 0.02);
  }

  _lead(t, m, len) {
    const ctx = this.ctx, g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.03); g.gain.setValueAtTime(1, t + len * 0.7); g.gain.linearRampToValueAtTime(0, t + len);
    const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 5.5; vg.gain.value = 9;
    vib.connect(vg);
    for (const [type, det] of [['sawtooth', 0], ['triangle', 1200]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = midiHz(m); o.detune.value = det;
      vg.connect(o.detune); o.connect(g); o.start(t); o.stop(t + len + 0.05);
    }
    vib.start(t); vib.stop(t + len + 0.05);
    g.connect(this.leadBus);
  }

  _noise(t, len, type, freq, q, gain) {
    const ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    s.connect(f); f.connect(g); g.connect(this.drumBus);
    s.start(t, Math.random() * 0.5); s.stop(t + len + 0.02);
  }

  _kick(t) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(1.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g); g.connect(this.drumBus); o.start(t); o.stop(t + 0.3);
  }

  _snare(t, v) {
    this._noise(t, 0.16, 'bandpass', 1900, 0.6, 0.75 * v);
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(170, t + 0.08);
    g.gain.setValueAtTime(0.45 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g); g.connect(this.drumBus); o.start(t); o.stop(t + 0.12);
  }

  _hat(t, v, open) { this._noise(t, open ? 0.18 : 0.045, 'highpass', 8000, 0.7, v); }
  _crash(t) { this._noise(t, 1.4, 'highpass', 4500, 0.5, 0.45); }
}
