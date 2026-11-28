// Sound effects, made live with WebAudio (no audio files): snow under your board or skis, wind,
// take-offs and landings, crashes, rail grinds, the chairlift, the helicopter, the wingsuit and the
// parachute. Continuous sounds are noise loops whose filters and volume follow what you're doing.
// Starts after your first click / key / button press (browser rule). On/off with the 🔊 button or B.

export class Sfx {
  constructor() {
    this.enabled = true;
    try { this.enabled = localStorage.getItem('snowSfx') !== 'off'; } catch {}
    this.ctx = null;
    this.volume = 0.8;
  }

  start() {
    if (!this.enabled) return;
    if (!this.ctx) this._init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.2);
  }
  stop() { if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); }
  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem('snowSfx', this.enabled ? 'on' : 'off'); } catch {}
    if (this.enabled) this.start(); else this.stop();
    return this.enabled;
  }
  get live() { return this.ctx && this.enabled && this.ctx.state === 'running'; }

  _init() {
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    // noise: white, and a darker "brown" noise for rumbles and wind
    const n = ctx.sampleRate * 6;     // long enough that the loop doesn't pulse
    this.white = ctx.createBuffer(1, n, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, n, ctx.sampleRate);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { w[i] = Math.random() * 2 - 1; last = (last + 0.02 * w[i]) / 1.02; b[i] = last * 3.5; }
    // continuous channels: { gain, filter }
    const loop = (buf, type, f, q) => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      s.connect(fl); fl.connect(g); g.connect(this.master); s.start(0, Math.random() * 1.5);
      return { g, f: fl };
    };
    this.carve = loop(this.white, 'bandpass', 1200, 0.8);     // edges biting into the snow
    this.hiss = loop(this.white, 'highpass', 3500, 0.5);      // skidding / spraying snow
    this.powder = loop(this.brown, 'lowpass', 500, 0.7);      // soft whoomp of deep powder
    this.wind = loop(this.brown, 'lowpass', 400, 0.6);        // wind past your helmet
    this.grind = loop(this.white, 'bandpass', 2600, 6);       // metal rail / box scrape
    this.flutter = loop(this.white, 'bandpass', 700, 1.2);    // wingsuit / canopy fabric
    this.lift = loop(this.brown, 'lowpass', 160, 0.8);        // lift motor and cable hum
    // the flutter is shaken by a fast wobble (fabric flapping)
    this.flutLfo = ctx.createOscillator(); this.flutLfo.frequency.value = 11;
    const fd = ctx.createGain(); fd.gain.value = 0; this.flutLfo.connect(fd); fd.connect(this.flutter.g.gain); this.flutLfo.start();
    this.flutDepth = fd;
    // helicopter: rotor "whop" (noise pulsed by the blade rate) + turbine whine
    const rotorSrc = ctx.createBufferSource(); rotorSrc.buffer = this.brown; rotorSrc.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 260;
    const pulse = ctx.createGain(); pulse.gain.value = 0;
    const blade = ctx.createOscillator(); blade.type = 'square'; blade.frequency.value = 9.5;
    const bladeAmt = ctx.createGain(); bladeAmt.gain.value = 0.5; blade.connect(bladeAmt); bladeAmt.connect(pulse.gain);
    const heliG = ctx.createGain(); heliG.gain.value = 0;
    rotorSrc.connect(rf); rf.connect(pulse); pulse.connect(heliG);
    const pulseBias = ctx.createConstantSource(); pulseBias.offset.value = 0.55; pulseBias.connect(pulse.gain); pulseBias.start();
    const turb = ctx.createOscillator(); turb.type = 'sawtooth'; turb.frequency.value = 1150;
    const tf = ctx.createBiquadFilter(); tf.type = 'bandpass'; tf.frequency.value = 1150; tf.Q.value = 8;
    const tg = ctx.createGain(); tg.gain.value = 0.05; turb.connect(tf); tf.connect(tg); tg.connect(heliG);
    heliG.connect(this.master); rotorSrc.start(); blade.start(); turb.start();
    this.heli = { g: heliG };
    this.prevTowerD = null; this.towerClose = false;
  }

  // ---- one-shots ----
  _burst(t, { buf = this.white, type = 'bandpass', f = 1000, f2 = null, q = 0.8, gain = 0.5, len = 0.2, attack = 0.005 }) {
    const ctx = this.ctx, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = buf; fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(fl); fl.connect(g); g.connect(this.master); s.start(t, Math.random() * 1.5); s.stop(t + len + 0.05);
  }
  _thump(t, f0, f1, gain, len) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + len * 0.7);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + len + 0.02);
  }
  _clank(t, gain = 0.25) {
    // metal on metal: a couple of inharmonic rings
    const ctx = this.ctx;
    for (const [f, d] of [[310, 0.35], [775, 0.22], [1240, 0.12]]) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(gain * (f < 500 ? 1 : 0.5), t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + d + 0.02);
    }
    this._burst(t, { type: 'highpass', f: 2500, gain: gain * 0.6, len: 0.05 });
  }

  takeoff(speed = 10) {
    if (!this.live) return;
    const t = this.ctx.currentTime, k = Math.min(1, speed / 20);
    this._burst(t, { type: 'bandpass', f: 1800, f2: 700, gain: 0.25 + 0.2 * k, len: 0.22 });     // snow spray off the lip
    this._thump(t, 120, 60, 0.25, 0.12);
  }
  land(impact = 4, powder = false) {
    if (!this.live) return;
    const t = this.ctx.currentTime, k = Math.min(1, impact / 14);
    this._thump(t, 95, 40, 0.35 + 0.55 * k, 0.25 + 0.15 * k);
    this._burst(t, { type: powder ? 'lowpass' : 'bandpass', f: powder ? 900 : 1500, f2: 400, q: 0.7, gain: 0.25 + 0.5 * k, len: 0.3 + 0.3 * k });   // snow crunch
  }
  crash() {
    if (!this.live) return;
    const t = this.ctx.currentTime;
    this._thump(t, 85, 35, 1.0, 0.4);
    this._burst(t, { buf: this.brown, type: 'lowpass', f: 1400, f2: 250, gain: 0.9, len: 0.9, attack: 0.01 });   // tumbling through the snow
    this._burst(t + 0.12, { type: 'bandpass', f: 2000, f2: 600, gain: 0.35, len: 0.5 });
    this._thump(t + 0.25, 70, 40, 0.5, 0.25);
  }
  hit() {   // hitting a tree or tower
    if (!this.live) return;
    const t = this.ctx.currentTime;
    this._thump(t, 140, 50, 0.9, 0.3);
    this._burst(t, { type: 'bandpass', f: 500, q: 1.5, gain: 0.6, len: 0.25 });     // woody knock
    this._burst(t + 0.05, { type: 'highpass', f: 3000, gain: 0.35, len: 0.6 });      // snow falling off the branches
  }
  chute() {   // canopy bursting open
    if (!this.live) return;
    const t = this.ctx.currentTime;
    this._burst(t, { type: 'bandpass', f: 400, f2: 2200, q: 0.9, gain: 0.5, len: 0.45, attack: 0.15 });   // whoosh as it fills
    this._burst(t + 0.42, { type: 'highpass', f: 1800, gain: 0.8, len: 0.12 });                         // fabric snap
    this._thump(t + 0.42, 110, 60, 0.6, 0.18);
  }
  jumpOut() {   // leaving the helicopter
    if (!this.live) return;
    const t = this.ctx.currentTime;
    this._burst(t, { buf: this.brown, type: 'lowpass', f: 300, f2: 1600, gain: 0.7, len: 0.8, attack: 0.2 });
  }
  click() { if (this.live) this._clank(this.ctx.currentTime, 0.12); }

  // ---- every frame ----
  // s: { mode, state, speed, onGround, edge (0..1 turning), skid (0..1), powder (0..1), grinding, flying, chute,
  //      lift: { seat, towers } | null, heliDist, paused }
  update(dt, s) {
    if (!this.live) return;
    const t = this.ctx.currentTime, set = (p, v, tc = 0.06) => p.setTargetAtTime(v, t, tc);
    const quiet = s.paused || s.mode === 'menu' || s.mode === 'lodge';
    const sp = quiet ? 0 : s.speed, ground = !quiet && s.onGround;
    const vk = Math.min(1, sp / 25);
    // snow under you
    set(this.carve.g.gain, ground ? (0.05 + 0.25 * s.edge) * Math.min(1, sp / 6) * (1 - 0.7 * s.powder) : 0);
    set(this.carve.f.frequency, 600 + 1400 * vk + 500 * s.edge);
    set(this.hiss.g.gain, ground ? 0.35 * s.skid * Math.min(1, sp / 4) * (1 - 0.5 * s.powder) : 0);
    set(this.powder.g.gain, ground ? 0.45 * s.powder * Math.min(1, sp / 8) : 0);
    set(this.powder.f.frequency, 300 + 500 * vk);
    // wind rises with speed (and a lot in the wingsuit)
    const windK = quiet ? 0 : s.flying && !s.chute ? 0.2 + 0.28 * vk : s.chute ? 0.1 : 0.45 * vk * vk;
    set(this.wind.g.gain, windK, 0.15);
    set(this.wind.f.frequency, 250 + 900 * vk);
    set(this.grind.g.gain, !quiet && s.grinding ? 0.18 * Math.min(1, sp / 4 + 0.3) : 0, 0.03);
    // wingsuit fabric / canopy flapping
    const flut = quiet ? 0 : s.flying && !s.chute ? 0.12 + 0.15 * vk : s.chute ? 0.1 : 0;
    set(this.flutter.g.gain, flut, 0.1);
    set(this.flutDepth.gain, flut * 0.8, 0.1);
    this.flutLfo.frequency.setTargetAtTime(s.chute ? 4 : 9 + 8 * vk, t, 0.2);
    // chairlift: motor hum, plus a clank-clank each time the chair rolls over a tower's wheels
    const onLift = s.lift && !quiet;
    set(this.lift.g.gain, onLift ? 0.2 : 0, 0.4);
    if (onLift && s.lift.seat && s.lift.towers) {
      let d = Infinity;
      for (const tw of s.lift.towers) d = Math.min(d, Math.hypot(tw.x - s.lift.seat.x, tw.z - s.lift.seat.z));
      if (this.prevTowerD !== null && d > this.prevTowerD && this.prevTowerD < 4 && !this.towerClose) {
        this.towerClose = true; this._clank(t, 0.22); this._clank(t + 0.18, 0.18); this._clank(t + 0.36, 0.14);
      }
      if (d > 8) this.towerClose = false;
      this.prevTowerD = d;
    } else this.prevTowerD = null;
    // helicopter, louder when it's close
    const hv = s.heliDist === null || s.heliDist === undefined || s.mode === 'menu' ? 0 : Math.min(0.9, 30 / Math.max(15, s.heliDist));
    set(this.heli.g.gain, hv, 0.2);
  }
}
