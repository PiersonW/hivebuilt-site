// Background music: original upbeat pop-punk, made in the browser (no audio files).
// Each song is built once into an audio clip (about a second) and then played back as a clip,
// so the beat stays rock steady no matter how busy the game is. Two songs alternate.
// Starts after your first click / key / button press (browser rule).

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const RATE = 32000;

// A song: tempo, then sections. Each section lists one chord root per bar (power-chord root, MIDI) and,
// for choruses, a lead melody: per bar, a list of [note, length in eighth notes] (null = rest).
// Section types: intro, verse (palm-muted), pre (building), chorus (open chords + lead), bridge (half time), outro.
const D = 50, A = 45, Bm = 47, G = 43, Fsm = 42, E = 52, Cs = 49;
const CHORUS1 = [
  [[69, 2], [66, 2], [69, 2], [71, 1], [69, 1]],
  [[69, 3], [64, 1], [64, 2], [61, 2]],
  [[62, 2], [66, 2], [71, 3], [69, 1]],
  [[67, 4], [66, 2], [64, 2]],
  [[69, 2], [66, 2], [69, 2], [74, 2]],
  [[73, 3], [69, 1], [69, 2], [64, 2]],
  [[71, 2], [67, 2], [66, 2], [64, 2]],
  [[64, 2], [66, 2], [62, 4]],
];
const VERSE1 = [
  [[null, 4], [62, 1], [64, 1], [66, 2]], [[64, 4], [null, 4]], [[null, 4], [62, 1], [64, 1], [66, 2]], [[67, 3], [66, 1], [64, 4]],
  [[null, 4], [62, 1], [64, 1], [66, 2]], [[64, 4], [null, 4]], [[71, 2], [69, 2], [67, 2], [66, 2]], [[64, 6], [null, 2]],
];
const CHORUS2 = [
  [[73, 2], [73, 2], [69, 2], [66, 2]],
  [[66, 3], [69, 1], [74, 2], [73, 2]],
  [[69, 2], [76, 2], [73, 3], [71, 1]],
  [[71, 4], [68, 2], [64, 2]],
  [[73, 2], [76, 2], [78, 2], [76, 2]],
  [[74, 3], [73, 1], [69, 2], [66, 2]],
  [[69, 2], [71, 2], [73, 2], [76, 2]],
  [[71, 4], [null, 4]],
];
const SONGS = [
  {
    name: 'Fresh Tracks', bpm: 150,
    sections: [
      { type: 'intro', bars: [D, A, Bm, G] },
      { type: 'verse', bars: [D, D, A, A, Bm, Bm, G, A], lead: VERSE1, leadSoft: true },
      { type: 'chorus', bars: [D, A, Bm, G, D, A, G, A], lead: CHORUS1 },
      { type: 'verse', bars: [D, D, A, A, Bm, Bm, G, A], lead: VERSE1, leadSoft: true },
      { type: 'chorus', bars: [D, A, Bm, G, D, A, G, A], lead: CHORUS1 },
      { type: 'bridge', bars: [Bm, G, D, A, Bm, G, A, A] },
      { type: 'chorus', bars: [D, A, Bm, G, D, A, G, A], lead: CHORUS1 },
      { type: 'outro', bars: [D, D] },
    ],
  },
  {
    name: 'Lift Line', bpm: 140,
    sections: [
      { type: 'intro', bars: [Fsm, D, A, E] },
      { type: 'verse', bars: [A, A, E, E, Fsm, Fsm, D, E] },
      { type: 'pre', bars: [D, E, Fsm, E] },
      { type: 'chorus', bars: [Fsm, D, A, E, Fsm, D, A, E], lead: CHORUS2 },
      { type: 'verse', bars: [A, A, E, E, Fsm, Fsm, D, E] },
      { type: 'pre', bars: [D, E, Fsm, E] },
      { type: 'chorus', bars: [Fsm, D, A, E, Fsm, D, A, E], lead: CHORUS2 },
      { type: 'bridge', bars: [D, E, Cs, Fsm, D, E, E, E] },
      { type: 'chorus', bars: [Fsm, D, A, E, Fsm, D, A, E], lead: CHORUS2 },
      { type: 'outro', bars: [A, A] },
    ],
  },
];

// Render one song to an AudioBuffer (mono).
// Render one song to an AudioBuffer (mono). Fast: every distinct sound (a chord stab, a bass note, a drum
// hit, a lead note) is synthesized once in a single short offline render, then the song is laid out by
// copying those sounds to their exact sample positions, so the timing is perfect and it takes ~1 s.
async function renderSong(song) {
  const e8 = 60 / song.bpm / 2, barLen = e8 * 8;

  // ---- 1. arrange: list every note as { key, t, gain } ----
  const events = [], kinds = new Map();
  const add = (key, spec, t, gain = 1, track = 'main') => { if (!kinds.has(key)) kinds.set(key, spec); events.push({ key, t, gain, track }); };
  const q = (x) => Math.round(x * 1000) / 1000;
  const chord = (t, root, len, open, vel = 1) => add(`c${open ? 'o' : 'm'}${root}:${q(len)}`, { k: 'chord', root, len, open }, t, vel);
  const bass = (t, m, len) => add(`b${m}:${q(len)}`, { k: 'bass', m, len }, t);
  const lead = (t, m, len, soft) => add(`l${m}:${q(len)}`, { k: 'lead', m, len }, t, soft ? 0.5 : 1, 'lead');
  const kick = (t, v = 1) => add('kick', { k: 'kick' }, t, v);
  const snare = (t, v = 1) => add(`snare${Math.round(t / e8) % 2}`, { k: 'snare', alt: Math.round(t / e8) % 2 }, t, v);
  const tom = (t, f, v = 1) => add(`tom${f}`, { k: 'tom', f }, t, v);
  const hat = (t, v, open = false) => add(open ? 'hatO' : `hat${Math.round(t / e8) % 3}`, { k: 'hat', open, alt: Math.round(t / e8) % 3 }, t, v / 0.26);
  const crash = (t) => add('crash', { k: 'crash' }, t);
  const ride = (t, v) => add('ride', { k: 'ride' }, t, v / 0.2);

  let t = 0.1;
  song.sections.forEach((sec, si) => {
    const next = song.sections[si + 1];
    sec.bars.forEach((root, b) => {
      const last = b === sec.bars.length - 1, ty = sec.type;
      const fill = last && next && next.type !== ty && ty !== 'outro';
      for (let i = 0; i < 8; i++) {
        const s = t + i * e8;
        // guitars
        if (ty === 'verse') chord(s, root, e8 * 0.92, false, i % 2 ? 0.8 : 1);
        else if (ty === 'chorus' || ty === 'pre') chord(s, root, e8 * 0.98, true, i % 2 ? 0.85 : 1);
        else if (ty === 'intro') { if (i === 0) chord(s, root, e8 * 5.8, true); if (i === 6) chord(s, root, e8 * 1.9, true, 0.9); }
        else if (ty === 'bridge') { if (i === 0 || i === 4) chord(s, root, e8 * 3.9, true, 0.9); }
        else if (ty === 'outro') { if (b === 0 && i === 0) chord(s, root, e8 * 15, true); }
        // bass
        if (ty === 'verse' || ty === 'chorus' || ty === 'pre') bass(s, root - 12 + (ty === 'chorus' && i === 7 ? 12 : 0), e8 * 0.9);
        else if (ty === 'bridge') { if (i % 2 === 0) bass(s, root - 12, e8 * 1.85); }
        else if (ty === 'intro') { if (i === 0) bass(s, root - 12, e8 * 5.8); if (i === 6) bass(s, root - 12, e8 * 1.9); }
        else if (ty === 'outro' && b === 0 && i === 0) bass(s, root - 12, e8 * 15);
        // drums
        if (fill && i >= 4) {
          // a quick fill into the next section
          if (ty === 'intro' || ty === 'bridge') { snare(s, 0.6 + 0.1 * (i - 4)); snare(s + e8 / 2, 0.55 + 0.1 * (i - 4)); }
          else { if (i === 4 || i === 5) snare(s, 0.85); else tom(s, i === 6 ? 140 : 95); if (i === 7) tom(s + e8 / 2, 80); }
          if (i === 4) kick(s);
          continue;
        }
        if (ty === 'verse' || ty === 'pre') {
          if (i === 0 || i === 4 || i === 5) kick(s, i === 5 ? 0.8 : 1);
          if (i === 2 || i === 6) snare(s);
          hat(s, i % 2 ? 0.16 : 0.26);
          if (ty === 'pre' && i % 2 === 1 && i !== 5) kick(s, 0.6);
        } else if (ty === 'chorus') {
          if (i === 0 || i === 3 || i === 4 || i === 7) kick(s, i % 4 === 0 ? 1 : 0.8);
          if (i === 2 || i === 6) snare(s);
          ride(s, i % 2 ? 0.12 : 0.2);
          if (i === 0 && b % 2 === 0) crash(s);
        } else if (ty === 'bridge') {
          if (i === 0) kick(s); if (i === 4) snare(s); if (i % 2 === 0) hat(s, 0.22, i === 6);
        } else if (ty === 'intro') {
          if (i === 0) { kick(s); crash(s); } if (i === 6) { kick(s); snare(s, 0.8); }
        } else if (ty === 'outro') { if (b === 0 && i === 0) { kick(s); crash(s); } }
      }
      // lead melody
      if (sec.lead) {
        let k = 0;
        for (const [n, len] of sec.lead[b]) { if (n) lead(t + k * e8, n, len * e8 * 0.96, !!sec.leadSoft); k += len; }
      }
      t += barLen;
    });
  });
  const songLen = t + 2.5;

  // ---- 2. synthesize each distinct sound once, one after another, in a single offline render ----
  const TAIL = { chord: 0.12, bass: 0.08, lead: 0.15, kick: 0.36, snare: 0.22, tom: 0.34, hat: 0.22, crash: 1.7, ride: 0.3 };
  const slots = []; let at = 0.02;
  for (const [key, spec] of kinds) {
    const dur = (spec.len || 0) + TAIL[spec.k];
    slots.push({ key, spec, at, dur }); at += dur + 0.03;
  }
  const ctx = new OfflineAudioContext(1, Math.ceil((at + 0.1) * RATE), RATE);
  const curve = new Float32Array(2048);
  for (let i = 0; i < 2048; i++) { const x = i / 1023.5 - 1; curve[i] = Math.tanh(x * 3.2) / Math.tanh(3.2); }
  const gIn = ctx.createGain();
  const ws = ctx.createWaveShaper(); ws.curve = curve; ws.oversample = '2x';
  const ghp = ctx.createBiquadFilter(); ghp.type = 'highpass'; ghp.frequency.value = 90;
  const glp = ctx.createBiquadFilter(); glp.type = 'lowpass'; glp.frequency.value = 2600; glp.Q.value = 0.7;
  const gmid = ctx.createBiquadFilter(); gmid.type = 'peaking'; gmid.frequency.value = 600; gmid.gain.value = -3; gmid.Q.value = 0.8;
  const gOut = ctx.createGain(); gOut.gain.value = 0.42;
  gIn.connect(ws); ws.connect(ghp); ghp.connect(gmid); gmid.connect(glp); glp.connect(gOut); gOut.connect(ctx.destination);
  const bassBus = ctx.createGain(); bassBus.gain.value = 0.5;
  const blp = ctx.createBiquadFilter(); blp.type = 'lowpass'; blp.frequency.value = 500;
  bassBus.connect(blp); blp.connect(ctx.destination);
  const drumBus = ctx.createGain(); drumBus.gain.value = 0.85; drumBus.connect(ctx.destination);
  const leadBus = ctx.createGain(); leadBus.gain.value = 0.2;
  const llp = ctx.createBiquadFilter(); llp.type = 'lowpass'; llp.frequency.value = 3000; llp.Q.value = 0.5;
  leadBus.connect(llp); llp.connect(ctx.destination);
  const noise = ctx.createBuffer(1, RATE, RATE);
  { const d = noise.getChannelData(0); let s = 12345; for (let i = 0; i < RATE; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = s / 0x3fffffff - 1; } }
  const hiss = (t, len, type, freq, qq, gain, off = 0) => {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; f.type = type; f.frequency.value = freq; f.Q.value = qq;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    s.connect(f); f.connect(g); g.connect(drumBus); s.start(t, off); s.stop(t + len + 0.02);
  };
  const SYN = {
    chord(t, { root, len, open }) {
      const g = ctx.createGain(), notes = open ? [root, root + 7, root + 12] : [root, root + 7];
      const peak = open ? 0.22 : 0.3;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.005);
      g.gain.setTargetAtTime(peak * (open ? 0.55 : 0.15), t + 0.01, open ? len * 0.5 : 0.04);
      g.gain.setTargetAtTime(0, t + len - 0.02, 0.012);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = open ? 3000 : 1100;
      g.connect(lp); lp.connect(gIn);
      for (const m of notes) for (const det of [-7, 7]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midiHz(m); o.detune.value = det;
        o.connect(g); o.start(t); o.stop(t + len + 0.06);
      }
    },
    bass(t, { m, len }) {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth'; o2.type = 'sine'; o.frequency.value = o2.frequency.value = midiHz(m);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.55, t + 0.006); g.gain.setTargetAtTime(0.35, t + 0.01, 0.08);
      g.gain.setTargetAtTime(0, t + len - 0.02, 0.01);
      o.connect(g); o2.connect(g); g.connect(bassBus); o.start(t); o2.start(t); o.stop(t + len + 0.05); o2.stop(t + len + 0.05);
    },
    lead(t, { m, len }) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.012); g.gain.setTargetAtTime(0.7, t + 0.02, 0.15);
      g.gain.setTargetAtTime(0, t + len - 0.03, 0.02);
      const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 5.2;
      vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(len > 0.4 ? 12 : 0, t + Math.min(len, 0.45));
      vib.connect(vg);
      for (const [type, det, a] of [['square', 0, 0.5], ['sawtooth', 5, 0.35], ['triangle', -1200, 0.5]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = midiHz(m); o.detune.value = det; og.gain.value = a;
        vg.connect(o.detune); o.connect(og); og.connect(g); o.start(t); o.stop(t + len + 0.1);
      }
      vib.start(t); vib.stop(t + len + 0.1);
      g.connect(leadBus);
    },
    kick(t) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
      g.gain.setValueAtTime(1.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      o.connect(g); g.connect(drumBus); o.start(t); o.stop(t + 0.34);
      hiss(t, 0.012, 'lowpass', 3000, 0.5, 0.35);
    },
    snare(t, { alt }) {
      hiss(t, 0.18, 'bandpass', 2200, 0.7, 0.75, alt * 0.31);
      hiss(t, 0.07, 'highpass', 5000, 0.5, 0.3, 0.5 + alt * 0.13);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.06);
      g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(g); g.connect(drumBus); o.start(t); o.stop(t + 0.12);
    },
    tom(t, { f }) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(f * 1.4, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
      g.gain.setValueAtTime(0.8, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g); g.connect(drumBus); o.start(t); o.stop(t + 0.32);
    },
    hat(t, { open, alt }) { hiss(t, open ? 0.2 : 0.04, 'highpass', 7500, 0.6, 0.26, 0.2 + (alt || 0) * 0.17); },
    crash(t) { hiss(t, 1.6, 'highpass', 4200, 0.4, 0.42, 0.1); },
    ride(t) { hiss(t, 0.25, 'bandpass', 6500, 1.2, 0.2, 0.6); },
  };
  for (const s of slots) SYN[s.spec.k](s.at, s.spec);
  const bank = (await ctx.startRendering()).getChannelData(0);
  const sound = new Map(slots.map(s => [s.key, bank.subarray(Math.round(s.at * RATE), Math.round((s.at + s.dur) * RATE))]));

  // ---- 3. lay the song out, sample-exact ----
  const N = Math.ceil(songLen * RATE);
  const main = new Float32Array(N), leadT = new Float32Array(N);
  for (const ev of events) {
    const src = sound.get(ev.key), dst = ev.track === 'lead' ? leadT : main, o = Math.round(ev.t * RATE), g = ev.gain;
    const n = Math.min(src.length, N - o);
    for (let i = 0; i < n; i++) dst[o + i] += src[i] * g;
  }
  // echo on the lead (3 eighth notes later, fading)
  const Dl = Math.round(e8 * 3 * RATE);
  for (let i = Dl; i < N; i++) leadT[i] += 0.25 * leadT[i - Dl];
  for (let i = 0; i < N; i++) main[i] += leadT[i];
  // gentle soft clip, then level to a 0.9 peak
  let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(main[i]));
  const pre = pk > 0 ? 1.4 / pk : 1, norm = 0.9 / Math.tanh(1.4);
  for (let i = 0; i < N; i++) main[i] = Math.tanh(main[i] * pre) * norm;
  const buf = new AudioBuffer({ length: N, sampleRate: RATE, numberOfChannels: 1 });
  buf.copyToChannel(main, 0);
  return buf;
}


export class Music {
  constructor() {
    this.enabled = true;
    try { this.enabled = localStorage.getItem('snowMusic') !== 'off'; } catch {}
    this.ctx = null;
    this.volume = 0.3;
    this.buffers = [];
    this.song = 0;
    this.src = null;
    // render the first song shortly after the page loads, so it's ready when you start playing
    this._rendering = null;
    setTimeout(() => this._render(0), 1500);
  }

  _render(i) {
    if (this.buffers[i] || (this._rendering && this._rendering.i === i)) return this._rendering && this._rendering.p;
    const p = renderSong(SONGS[i]).then(b => { this.buffers[i] = b; this._rendering = null; if (this.playing && !this.src) this._play(); return b; })
      .catch(() => { this._rendering = null; });
    this._rendering = { i, p };
    return p;
  }

  // call from a user gesture (click / key / button)
  start() {
    if (!this.enabled) return;
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = 0; this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.playing = true;
    this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.3);
    if (!this.src) this._play();
  }

  _play() {
    const buf = this.buffers[this.song];
    if (!buf) { this._render(this.song); return; }
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.connect(this.master); s.start(this.ctx.currentTime + 0.05);
    this.src = s;
    s.onended = () => {
      if (this.src !== s) return;
      this.src = null;
      this.song = (this.song + 1) % SONGS.length;
      if (this.playing) this._play();
    };
    // get the next song ready while this one plays
    setTimeout(() => this._render((this.song + 1) % SONGS.length), 4000);
  }

  stop() {
    this.playing = false;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    const s = this.src; this.src = null;
    if (s) { s.onended = null; try { s.stop(this.ctx.currentTime + 0.6); } catch {} }
  }

  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem('snowMusic', this.enabled ? 'on' : 'off'); } catch {}
    if (this.enabled) this.start(); else this.stop();
    return this.enabled;
  }
}

export { SONGS, renderSong };
