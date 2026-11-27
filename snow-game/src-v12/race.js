// The Race Course: a giant slalom down the far right of the mountain. Ride through the start, between
// every pair of flags (miss one = +2 s), and through the finish. Your best time, a leaderboard for
// everyone who plays on this device, and a ghost of your best run are saved in this browser.
import * as THREE from 'three';
import { Rider } from './rider.js';

const GATE_EVERY = 34;      // m between gates
const GATE_OFF = 5.5;       // gates alternate this far left / right of the centre line
const OPENING = 7.5;        // m between the two flags you ride through
const PENALTY = 2;          // s per missed gate
const GHOST_HZ = 20;
const KEY = 'snowRace';

export class Race {
  constructor(scene, terrain) {
    this.scene = scene; this.terrain = terrain;
    this.run = terrain.runById.race;
    this.ri = terrain.runs.indexOf(this.run);
    const run = this.run;
    this.startS = 22;
    this.finishS = run.length - 110;     // before it runs out into Rocky Chute
    this.gates = [];
    let k = 0;
    for (let s = this.startS + 30; s < this.finishS - 20; s += GATE_EVERY, k++) {
      const a = run.at(s), off = (k % 2 ? 1 : -1) * GATE_OFF;
      this.gates.push({ s, off, x: a.x - a.tz * off, z: a.z + a.tx * off, cx: a.x, cz: a.z, tx: a.tx, tz: a.tz, red: k % 2 === 0 });
    }
    this.line = (s) => { const a = run.at(s); return { x: a.x, z: a.z, tx: a.tx, tz: a.tz }; };
    this.startLine = this.line(this.startS);
    this.finishLine = this.line(this.finishS);
    this._buildMeshes();
    try { this.data = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { this.data = {}; }
    this.data.board = this.data.board || [];
    this.state = 'idle';
    this.ghost = null;
    this.prevAlong = null;
  }

  _save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch {} }

  _buildMeshes() {
    const T = this.terrain;
    const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.9, 5);
    const panelGeo = new THREE.PlaneGeometry(1.25, 0.85);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd8262b, side: THREE.DoubleSide, roughness: 0.7 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x1f56c8, side: THREE.DoubleSide, roughness: 0.7 });
    const nPanels = this.gates.length * 2;
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, nPanels * 2);
    const reds = new THREE.InstancedMesh(panelGeo, red, nPanels), blues = new THREE.InstancedMesh(panelGeo, blue, nPanels);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    let ip = 0, ir = 0, ib = 0;
    for (const g of this.gates) {
      // a GS gate: two flag panels (each between an inner and an outer pole), the opening between them
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(g.tx, g.tz));     // panels face up the hill
      for (const side of [-1, 1]) {
        const inner = OPENING / 2, mid = inner + 0.62, outer = inner + 1.25;
        for (const d of [inner, outer]) {
          const x = g.x - g.tz * side * d, z = g.z + g.tx * side * d;
          m.compose(p.set(x, T.heightAt(x, z) + 0.95, z), new THREE.Quaternion(), one); poles.setMatrixAt(ip++, m);
        }
        const x = g.x - g.tz * side * mid, z = g.z + g.tx * side * mid;
        m.compose(p.set(x, T.heightAt(x, z) + 1.35, z), q, one);
        if (g.red) reds.setMatrixAt(ir++, m); else blues.setMatrixAt(ib++, m);
      }
    }
    reds.count = ir; blues.count = ib;
    for (const im of [poles, reds, blues]) { im.castShadow = true; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); this.scene.add(im); }
    this._banner('RACE START', this.startLine, '#d63030');
    this._banner('FINISH', this.finishLine, '#163566');
    // start hut beside the start line
    const a = this.startLine, hw = this.run.hw;
    const hut = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.6, 3), new THREE.MeshStandardMaterial({ color: 0x8a5a36, flatShading: true }));
    const hx = a.x + a.tz * (hw + 3), hz = a.z - a.tx * (hw + 3);
    hut.position.set(hx, T.heightAt(hx, hz) + 1.3, hz); hut.rotation.y = Math.atan2(a.tx, a.tz); hut.castShadow = true;
    this.scene.add(hut);
  }

  _banner(text, a, color) {
    const T = this.terrain, hw = this.run.hw - 2;
    const c = document.createElement('canvas'); c.width = 1024; c.height = 128;
    const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 1024, 128);
    g.fillStyle = '#fff'; g.font = 'bold 78px Trebuchet MS, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('🏁 ' + text + ' 🏁', 512, 68);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const post = new THREE.MeshStandardMaterial({ color: 0x3a3f48 });
    let top = -Infinity;
    for (const sgn of [-1, 1]) {
      const x = a.x - a.tz * hw * sgn, z = a.z + a.tx * hw * sgn, y = T.heightAt(x, z);
      top = Math.max(top, y + 6.5);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7.5, 0.4), post); pole.position.set(x, y + 3.75, z); pole.castShadow = true; this.scene.add(pole);
    }
    const b = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 2.2, 0.2), new THREE.MeshStandardMaterial({ map: tex }));
    b.position.set(a.x, top, a.z); b.rotation.y = Math.atan2(-a.tx, -a.tz); this.scene.add(b);
  }

  // signed distance past a line across the run at (x, z) with downhill tangent (tx, tz); and how far across
  _rel(L, p) { const dx = p.x - L.x, dz = p.z - L.z; return { along: dx * L.tx + dz * L.tz, across: -dx * L.tz + dz * L.tx }; }

  get best() { return this.data.best ? this.data.best.time : null; }

  // Call every frame while riding. Returns events: [{type:'start'|'gate'|'miss'|'finish'|'abort', ...}]
  update(dt, rider, name, sport) {
    const out = [], p = rider.pos;
    if (this.state === 'running') {
      this.t += dt;
      // ghost recording
      this.recAcc += dt;
      while (this.recAcc >= 1 / GHOST_HZ) {
        this.recAcc -= 1 / GHOST_HZ;
        const q = rider.root.quaternion;
        this.rec.push(+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3), +q.w.toFixed(3), +rider.crouch.toFixed(2));
      }
      // gates in order
      const g = this.gates[this.next];
      if (g) {
        const r = this._rel({ x: g.cx, z: g.cz, tx: g.tx, tz: g.tz }, p);
        if (this.prevGate !== null && this.prevGate < 0 && r.along >= 0) {
          const made = Math.abs(r.across - g.off) <= OPENING / 2 + 0.3;
          if (!made) this.penalty += PENALTY;
          this.splits.push(this.t);
          const bestSplit = this.data.best && this.data.best.splits ? this.data.best.splits[this.next] : null;
          out.push({ type: made ? 'gate' : 'miss', index: this.next, delta: bestSplit != null ? this.t + this.penalty - bestSplit : null });
          if (!made) this.missed++;
          this.next++;
          this.prevGate = null;
        } else this.prevGate = r.along;
      }
      const f = this._rel(this.finishLine, p);
      if (this.prevFinish !== null && this.prevFinish < 0 && f.along >= 0 && Math.abs(f.across) < this.run.hw + 6) {
        // gates you skipped entirely count as missed
        while (this.next < this.gates.length) { this.penalty += PENALTY; this.missed++; this.next++; }
        const time = this.t + this.penalty;
        const prev = this.best;
        const pr = prev === null || time < prev;
        if (pr) this.data.best = { time, name, sport, splits: this.splits.map((t, i) => t), ghost: this.rec, ghostSport: sport };
        this.data.board.push({ name, time, sport, missed: this.missed, date: Date.now() });
        this.data.board.sort((a, b) => a.time - b.time);
        this.data.board.length = Math.min(10, this.data.board.length);
        this._save();
        this.state = 'idle';
        this._hideGhost();
        out.push({ type: 'finish', time, raw: this.t, missed: this.missed, pr, prev });
      } else this.prevFinish = f.along;
      // wandered off the course: race over
      const q = this.terrain._q(p.x, p.z);
      if (this.terrain.runDist[this.ri][q] > this.run.hw + 45) { this.offT = (this.offT || 0) + dt; if (this.offT > 2.5) { this.abort(); out.push({ type: 'abort', why: 'Left the course' }); } }
      else this.offT = 0;
      this._updateGhost(dt);
    } else {
      // riding through the start line from above starts a race
      const r = this._rel(this.startLine, p);
      if (this.prevStart !== null && this.prevStart < 0 && r.along >= 0 && Math.abs(r.across) < this.run.hw + 2 && rider.state !== 'fly') {
        this.state = 'running'; this.t = 0; this.penalty = 0; this.missed = 0; this.next = 0; this.splits = [];
        this.prevGate = null; this.prevFinish = null; this.rec = []; this.recAcc = 0; this.offT = 0;
        this._startGhost();
        out.push({ type: 'start' });
      }
      this.prevStart = r.along;
    }
    return out;
  }

  abort() { this.state = 'idle'; this._hideGhost(); }
  reset() { this.abort(); this.prevStart = null; }

  // ---- ghost of your best run ----
  _startGhost() {
    const b = this.data.best;
    if (!b || !b.ghost || b.ghost.length < 16) return;
    if (!this.ghostRider) {
      this.ghostRider = new Rider(this.scene, this.terrain);
      this.ghostRider.root.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.38; o.material.depthWrite = false; o.castShadow = false; } });
    }
    const gr = this.ghostRider;
    gr.setSport(b.ghostSport || 'board');
    gr.root.traverse(o => { if (o.isMesh) { o.material.transparent = true; o.material.opacity = 0.38; } });
    gr.root.visible = true;
    this.ghost = b.ghost; this.ghostT = 0;
  }
  _hideGhost() { if (this.ghostRider) this.ghostRider.root.visible = false; this.ghost = null; }
  _updateGhost(dt) {
    if (!this.ghost) return;
    const F = 8, n = this.ghost.length / F, x = this.t * GHOST_HZ;
    if (x >= n - 1) { this._hideGhost(); return; }
    const i = Math.floor(x), a = x - i, G = this.ghost, A = i * F, B = (i + 1) * F;
    const gr = this.ghostRider;
    gr.pos.set(G[A] + (G[B] - G[A]) * a, G[A + 1] + (G[B + 1] - G[A + 1]) * a, G[A + 2] + (G[B + 2] - G[A + 2]) * a);
    gr.root.position.copy(gr.pos);
    gr.root.quaternion.slerpQuaternions(new THREE.Quaternion(G[A + 3], G[A + 4], G[A + 5], G[A + 6]), new THREE.Quaternion(G[B + 3], G[B + 4], G[B + 5], G[B + 6]), a);
    gr.crouch = G[A + 7]; gr.state = 'ride'; gr.lean = 0;
    gr._updatePose(dt, {});
  }

  leaderboardHtml(highlightTime) {
    const b = this.data.board;
    if (!b.length) return '<p class="muted">No race times yet.</p>';
    return '<table class="race-board">' + b.slice(0, 5).map((e, i) =>
      `<tr class="${e.time === highlightTime ? 'me' : ''}"><td>${i + 1}</td><td>${escapeHtml(e.name)}</td><td>${e.sport === 'ski' ? '⛷️' : '🏂'}</td><td>${fmtRace(e.time)}</td><td>${e.missed ? `${e.missed} missed` : 'clean'}</td></tr>`).join('') + '</table>';
  }
}

export function fmtRace(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
