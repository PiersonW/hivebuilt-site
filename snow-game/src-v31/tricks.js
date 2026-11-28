// Trick tracking and scoring for one jump at a time.

export const PHANTOM_NAME = 'Phantom Flip';  // board leaves the feet, flips, comes back

const SPIN_PTS = { 180: 100, 360: 250, 540: 450, 720: 700, 900: 1000, 1080: 1400, 1260: 1800, 1440: 2300 };

export class TrickTracker {
  constructor() { this.reset(); }

  reset() {
    this.active = false;
    this.spin = 0; this.flip = 0;
    this.grabs = new Map();   // name -> seconds held
    this.grabOrder = [];
    this.grinds = new Map();  // name -> seconds on the rail / box
    this.phantoms = 0;
    this.phantomOn = false;
    this.airTime = 0;
  }

  begin() { this.reset(); this.active = true; }

  handle(ev) {
    if (!this.active) return;
    if (ev.type === 'rot') { this.spin += ev.spin; this.flip += ev.flip; }
    else if (ev.type === 'grab') {
      if (!this.grabs.has(ev.name)) { this.grabs.set(ev.name, 0); this.grabOrder.push(ev.name); }
      this.grabs.set(ev.name, this.grabs.get(ev.name) + ev.dt);
    } else if (ev.type === 'grind') {
      this.grinds.set(ev.name, (this.grinds.get(ev.name) || 0) + ev.dt);
    } else if (ev.type === 'phantom-start') this.phantomOn = true;
    else if (ev.type === 'phantom-done') { this.phantoms++; this.phantomOn = false; }
  }

  // List of trick parts so far: [{name, pts}]
  parts() {
    const out = [];
    const deg = Math.abs(this.spin) * 180 / Math.PI;
    const spinDeg = Math.floor((deg + 35) / 180) * 180;
    const flips = Math.floor((Math.abs(this.flip) + 0.95) / (2 * Math.PI));
    if (flips > 0) {
      const dir = this.flip > 0 ? 'Front Flip' : 'Backflip';
      const pre = flips === 2 ? 'Double ' : flips === 3 ? 'Triple ' : flips > 3 ? `${flips}x ` : '';
      out.push({ name: pre + dir, pts: 500 * flips + (flips > 1 ? 300 * (flips - 1) : 0) });
    }
    for (const [g, t] of this.grinds) if (t > 0.15) out.push({ name: g, pts: Math.round(200 + 260 * Math.min(t, 4)) });
    if (spinDeg >= 180) out.push({ name: `${spinDeg}`, pts: SPIN_PTS[spinDeg] || (2300 + (spinDeg - 1440) * 4) });
    for (const g of this.grabOrder) {
      const t = this.grabs.get(g);
      if (t < 0.12) continue;
      out.push({ name: g, pts: Math.round(150 + 350 * Math.min(t, 2.5)) });
    }
    if (this.phantoms > 0) out.push({ name: this.phantoms > 1 ? `${this.phantoms}x ${PHANTOM_NAME}` : PHANTOM_NAME, pts: 900 * this.phantoms });
    return out;
  }

  liveName() {
    // spin/flip in progress + grabs, rounded
    const names = this.parts().map(x => x.name);
    if (this.phantomOn) names.push(PHANTOM_NAME + '…');
    return names.join(' + ');
  }

  // Close out the jump. Returns {name, points} or null if nothing worth scoring.
  finish(clean, airTime) {
    this.active = false;
    const p = this.parts();
    if (!p.length) {
      if (clean && airTime > 1.0) return { name: 'Big Air', points: Math.round(airTime * 80), mult: 1 };
      return null;
    }
    const base = p.reduce((a, b) => a + b.pts, 0) + Math.round(airTime * 60);
    const mult = p.length;
    return { name: p.map(x => x.name).join(' + '), points: clean ? base * mult : 0, mult, base };
  }
}
