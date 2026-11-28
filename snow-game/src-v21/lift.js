// A reusable chairlift: give it a bottom point and a top point and it builds stations, towers,
// a cable loop and moving chairs, clears trees under the line and adds the towers as obstacles.
//
//   const lift = new Chairlift(scene, terrain, bottom, top, { name: 'Summit Express' });
//   lift.update(dt);                         // every frame
//   lift.loadPoint / lift.unloadPoint        // ground points for getting on and off
//   lift.laneCoords(x, z) -> { d, l }        // position in the lift line (d along the line, l across)
// Chairs run fast on the cable and slow right down through both stations (like a detachable lift).
//   lift.nextChairToLoad() -> chair index    // the chair about to reach the load point
//   lift.chairState(i) -> { pos, dir, u }    // where a chair is; u = distance along the up line
//   lift.seatPoint(i, side) -> Vector3       // a seat on chair i (side -1 = left, 1 = right)
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const HANG = 2.6;           // cable to seat
const WHEEL_R = 2.3;        // half the gap between the up and down cables

export class Chairlift {
  constructor(scene, terrain, bottom, top, opts = {}) {
    this.scene = scene;
    this.terrain = terrain;
    this.name = opts.name || 'Chairlift';
    this.speed = opts.speed || 10;            // m/s along the cable between stations
    this.slowSpeed = opts.slowSpeed || 1.6;   // m/s through the stations
    this.spacing = opts.spacing || 34;        // m between chairs
    this.towerSpacing = opts.towerSpacing || 75;
    this.clearance = opts.clearance || 9;     // min height of the cable above the snow between towers
    this.group = new THREE.Group();
    scene.add(this.group);

    // horizontal frame of the lift line
    this.f = new THREE.Vector3(top.x - bottom.x, 0, top.z - bottom.z);
    this.length = this.f.length();
    this.f.normalize();
    this.p = new THREE.Vector3(-this.f.z, 0, this.f.x);   // to the right when looking uphill
    this.bottom = bottom.clone(); this.top = top.clone();
    this.bottom.y = terrain.heightAt(bottom.x, bottom.z);
    this.top.y = terrain.heightAt(top.x, top.z);

    this.loadU = 7;                            // load spot: 7 m up the line from the bottom wheel
    this._layoutTowers();
    this._buildPath();
    this._buildMeshes();
    terrain.clearTreesAlong(this.bottom, this.top, 7);
    for (const t of this.towers.slice(1, -1)) terrain.addObstacle(t.x, t.z, 0.7, t.y - terrain.terrainHeight(t.x, t.z), 'tower');

    // load and unload spots on the snow, on the up-cable side
    const side = this.p.clone().multiplyScalar(WHEEL_R);
    this.loadPoint = this.bottom.clone().addScaledVector(this.f, 7).add(side);
    this.loadPoint.y = terrain.heightAt(this.loadPoint.x, this.loadPoint.z);
    this.unloadPoint = this.top.clone().addScaledVector(this.f, -7).add(side);
    this.unloadPoint.y = terrain.heightAt(this.unloadPoint.x, this.unloadPoint.z);
    this.unloadU = this.upLength - 7;
    this._buildTiming();
    this.clock = 0;
    this.update(0);
  }

  // Tower spots along the line and the cable height at each (stations included at both ends).
  _layoutTowers() {
    const T = this.terrain;
    const n = Math.max(1, Math.round(this.length / this.towerSpacing));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      let d = this.length * i / n;
      const at = (dd) => this.bottom.clone().addScaledVector(this.f, dd);
      if (i > 0 && i < n) {
        // keep towers off kickers and out of the runs (try nearby spots both ways)
        const blocked = (q) => T.kickers.some(k => Math.hypot(q.x - k.x, q.z - k.z) < k.len + 5) ||
          (T.edgeDist && T.edgeDist[T._q(q.x, q.z)] < 3);
        const d0 = d;
        for (let tries = 1; tries < 16 && blocked(at(d)); tries++) d = d0 + (tries % 2 ? 1 : -1) * Math.ceil(tries / 2) * 6;
      }
      const q = at(d);
      q.y = T.heightAt(q.x, q.z) + (i === 0 || i === n ? HANG + 0.55 : this.clearance + 2);
      pts.push(q);
    }
    // raise towers until every span clears the snow (skip the low station ends)
    const groundAt = (x, z) => Math.max(T.heightAt(x + this.p.x * WHEEL_R, z + this.p.z * WHEEL_R), T.heightAt(x - this.p.x * WHEEL_R, z - this.p.z * WHEEL_R));
    for (let iter = 0; iter < 20; iter++) {
      let changed = false;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        let worst = 0;
        for (let t = 0.05; t < 1; t += 0.05) {
          const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          const fromStation = Math.min(i === 0 ? t * a.distanceTo(b) : 99, i === pts.length - 2 ? (1 - t) * a.distanceTo(b) : 99);
          if (fromStation < 30) continue;
          const need = groundAt(x, z) + this.clearance - (a.y + (b.y - a.y) * t);
          worst = Math.max(worst, need);
        }
        if (worst > 0.05) {
          if (i > 0) a.y += worst; if (i < pts.length - 2) b.y += worst;
          changed = true;
        }
      }
      if (!changed) break;
    }
    this.towers = pts;
  }

  // The cable loop: up line, around the top wheel, down line, around the bottom wheel.
  _buildPath() {
    const r = WHEEL_R, p = this.p, f = this.f;
    // through each station the cable stays low and level for a few metres, so the seat passes at
    // knee height where you load and unload, then climbs to the first tower
    const T = this.terrain, last = this.towers.length - 1;
    const flat = (d, side, exact = false) => {
      const q = this.bottom.clone().addScaledVector(f, d).addScaledVector(p, side * r);
      q.y = (exact ? T.heightAt(q.x, q.z) : Math.max(T.heightAt(q.x, q.z), T.heightAt(q.x - p.x * side * 1.2, q.z - p.z * side * 1.2))) + HANG + 0.5;
      return q;
    };
    const line = (side) => {
      const pts = this.towers.map(t => t.clone().addScaledVector(p, side * r));
      pts[0].y = Math.max(pts[0].y, flat(0, side).y);
      const exitB = this.loadU + 6, exitT = this.length - 13;
      const hd = (t) => Math.hypot(t.x - this.bottom.x, t.z - this.bottom.z);
      const tq = flat(this.length, side); pts[last].y = Math.max(pts[last].y, tq.y);
      // seat at knee height on the load and unload spots, level for a few metres, then up to the towers
      const head = [pts[0], flat(this.loadU, side, true)];
      if (this.towers[1] && exitB < hd(this.towers[1]) * 0.6) head.push(flat(exitB, side));
      const tail = [];
      if (exitT > hd(this.towers[last - 1]) + 12) tail.push(flat(exitT, side));
      tail.push(flat(this.length - 7, side, true), pts[last]);
      return [...head, ...pts.slice(1, last), ...tail];
    };
    const up = line(1);
    const down = line(-1).reverse();
    const arc = (c, startDir, midDir) => {
      const out = [];
      for (let i = 0; i <= 12; i++) {
        const a = Math.PI * i / 12;
        out.push(c.clone().addScaledVector(startDir, Math.cos(a) * r).addScaledVector(midDir, Math.sin(a) * r));
      }
      return out;
    };
    const topC = this.towers[this.towers.length - 1], botC = this.towers[0];
    const topArc = arc(topC, p, f);
    const botArc = arc(botC, p.clone().negate(), f.clone().negate());
    const loop = [...up, ...topArc.slice(1, -1), ...down, ...botArc.slice(1, -1)];
    this.loop = loop;
    this.cum = [0];
    for (let i = 1; i <= loop.length; i++) this.cum.push(this.cum[i - 1] + loop[i - 1].distanceTo(loop[i % loop.length]));
    this.total = this.cum[loop.length];
    this.upLength = this.cum[up.length - 1];
    this.topArcLen = Math.PI * r;
    this.botArcStart = this.total - Math.PI * r;
    this.nChairs = Math.floor(this.total / this.spacing);
  }

  // Cable speed at distance u along the loop: slow through the stations, fast in between.
  speedAt(u) {
    u = ((u % this.total) + this.total) % this.total;
    const zones = [[this.botArcStart - 8, this.total + this.loadU + 5], [this.unloadU - 5, this.upLength + this.topArcLen + 8]];
    let d = Infinity;
    for (const [a, b] of zones) {
      for (const uu of [u, u + this.total]) d = Math.min(d, uu < a ? a - uu : uu > b ? uu - b : 0);
    }
    const t = Math.min(1, d / 22), e = t * t * (3 - 2 * t);
    return this.slowSpeed + (this.speed - this.slowSpeed) * e;
  }

  // Time along the loop (so every chair follows the same speed profile, keeping its place in line).
  _buildTiming() {
    const step = 0.5, n = Math.ceil(this.total / step) + 1;
    this.tau = new Float32Array(n);
    for (let k = 1; k < n; k++) this.tau[k] = this.tau[k - 1] + step / this.speedAt((k - 0.5) * step);
    this.period = this.tau[n - 1] * (this.total / ((n - 1) * step));
    this._tauStep = step;
  }

  _timeAt(u) {
    const f = Math.max(0, Math.min(this.tau.length - 1.001, u / this._tauStep)), k = Math.floor(f);
    return this.tau[k] + (this.tau[k + 1] - this.tau[k]) * (f - k);
  }

  _uAtTime(t) {
    t = ((t % this.period) + this.period) % this.period;
    let lo = 0, hi = this.tau.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.tau[mid] <= t) lo = mid; else hi = mid - 1; }
    const a = this.tau[lo], b = this.tau[Math.min(this.tau.length - 1, lo + 1)];
    return Math.min(this.total, (lo + (b > a ? (t - a) / (b - a) : 0)) * this._tauStep);
  }

  // Position in the lift line: d = meters along the lift from the bottom wheel, l = meters across (load side positive).
  laneCoords(x, z) {
    const dx = x - this.bottom.x, dz = z - this.bottom.z;
    return { d: dx * this.f.x + dz * this.f.z, l: dx * this.p.x + dz * this.p.z };
  }

  _pointAt(u, outPos, outDir) {
    u = ((u % this.total) + this.total) % this.total;
    let lo = 0, hi = this.loop.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.cum[mid] <= u) lo = mid; else hi = mid - 1; }
    const a = this.loop[lo], b = this.loop[(lo + 1) % this.loop.length];
    const t = (u - this.cum[lo]) / Math.max(1e-6, this.cum[lo + 1] - this.cum[lo]);
    outPos.lerpVectors(a, b, t);
    outDir.subVectors(b, a); outDir.y = 0; outDir.normalize();
  }

  _buildMeshes() {
    const g = this.group;
    const steel = new THREE.MeshStandardMaterial({ color: 0x6b7380, roughness: 0.5, metalness: 0.4, flatShading: true });
    const paint = new THREE.MeshStandardMaterial({ color: 0x2a64c8, roughness: 0.6, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.8 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a36, flatShading: true });
    const yaw = Math.atan2(this.f.x, this.f.z);

    // towers (skip the station ends)
    for (const t of this.towers.slice(1, -1)) {
      const gy = this.terrain.terrainHeight(t.x, t.z);
      const h = t.y - gy;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, h, 6), steel);
      pole.position.set(t.x, gy + h / 2, t.z); pole.castShadow = true; g.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(WHEEL_R * 2 + 1.2, 0.35, 0.5), paint);
      arm.position.set(t.x, t.y + 0.25, t.z); arm.rotation.y = yaw; arm.castShadow = true; g.add(arm);
      for (const s of [-1, 1]) {
        const sheave = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 2.2), dark);
        sheave.position.copy(t).addScaledVector(this.p, s * WHEEL_R); sheave.position.y = t.y + 0.05;
        sheave.rotation.y = yaw; g.add(sheave);
      }
    }
    // stations: bull wheel, roof and a hut
    for (const [i, label] of [[0, 'LIFT'], [this.towers.length - 1, null]]) {
      const c = this.towers[i];
      const gy = this.terrain.heightAt(c.x, c.z);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R + 0.25, WHEEL_R + 0.25, 0.4, 16), paint);
      wheel.position.copy(c); wheel.position.y += 0.3; g.add(wheel);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(WHEEL_R * 2 + 3, 0.4, 9), paint);
      roof.position.set(c.x, c.y + 1.6, c.z); roof.rotation.y = yaw; roof.castShadow = true; g.add(roof);
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, c.y + 1.6 - gy, 0.4), steel);
        post.position.copy(c).addScaledVector(this.f, s * 3.5); post.position.y = (gy + c.y + 1.6) / 2; g.add(post);
      }
      const hut = new THREE.Mesh(new THREE.BoxGeometry(3, 2.6, 3), wood);
      hut.position.copy(c).addScaledVector(this.p, -(WHEEL_R + 4)); hut.position.y = this.terrain.heightAt(hut.position.x, hut.position.z) + 1.3;
      hut.rotation.y = yaw; hut.castShadow = true; g.add(hut);
      if (label) g.add(this._sign(label, c.clone().addScaledVector(this.p, -(WHEEL_R + 4)).addScaledVector(this.f, -4)));
    }
    // lift line at the bottom: two rope fences you ride up between, then a blue line where you wait for the chair
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0xff8a1f });
    const b0 = this.towers[0];
    this.lane = { d0: -20, d1: -2.4, l0: 0.6, l1: 4.2 };   // the line ends just behind the bull wheel; you step out to load
    for (const s of [0.6, 4.2]) {
      for (let d = -20; d <= -4; d += 4) {
        const q = b0.clone().addScaledVector(this.f, d).addScaledVector(this.p, s);
        const y = this.terrain.heightAt(q.x, q.z);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 5), dark);
        post.position.set(q.x, y + 0.55, q.z); g.add(post);
        if (d < -4) {
          const q2 = q.clone().addScaledVector(this.f, 4);
          const y2 = this.terrain.heightAt(q2.x, q2.z);
          const rope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 4), ropeMat);
          rope.position.set((q.x + q2.x) / 2, (y + y2) / 2 + 0.95, (q.z + q2.z) / 2);
          rope.rotation.y = yaw; rope.rotation.x = -Math.atan2(y2 - y, 4); g.add(rope);
        }
      }
    }
    const lp = this.towers[0].clone().addScaledVector(this.f, this.loadU).addScaledVector(this.p, WHEEL_R);
    const line = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.04, 0.35), new THREE.MeshStandardMaterial({ color: 0x2a64c8, emissive: 0x0a2a70 }));
    line.position.set(lp.x, this.terrain.heightAt(lp.x, lp.z) + 0.03, lp.z); line.rotation.y = yaw; g.add(line);
    g.add(this._sign('LIFT LINE', this.towers[0].clone().addScaledVector(this.f, -21).addScaledVector(this.p, 6)));
    // cable
    const cablePts = [...this.loop, this.loop[0]];
    const cable = new THREE.Line(new THREE.BufferGeometry().setFromPoints(cablePts), new THREE.LineBasicMaterial({ color: 0x222222 }));
    g.add(cable);
    // chairs
    this.chairs = [];
    const chairGeo = this._chairParts();
    for (let i = 0; i < this.nChairs; i++) {
      const c = new THREE.Group();
      for (const [geo, pos, rot] of chairGeo) {
        const m = new THREE.Mesh(geo, geo === chairGeo[0][0] || geo === chairGeo[1][0] ? steel : paint);
        m.position.copy(pos); if (rot) m.rotation.x = rot; m.castShadow = true; c.add(m);
      }
      g.add(c);
      this.chairs.push(c);
    }
    this._tmpP = new THREE.Vector3(); this._tmpD = new THREE.Vector3();
  }

  // Chair parts in chair space: origin at the cable grip, forward = -z.
  _chairParts() {
    return [
      [new THREE.BoxGeometry(0.08, HANG - 0.1, 0.08), new THREE.Vector3(0, -(HANG - 0.1) / 2, 0.32)],     // hanger
      [new THREE.BoxGeometry(1.5, 0.06, 0.06), new THREE.Vector3(0, -HANG + 0.05, 0.32)],                  // crossbar
      [new THREE.BoxGeometry(1.5, 0.08, 0.55), new THREE.Vector3(0, -HANG, 0.02)],                         // seat
      [new THREE.BoxGeometry(1.5, 0.6, 0.06), new THREE.Vector3(0, -HANG + 0.35, 0.32), 0.15],             // back
      [new THREE.BoxGeometry(1.5, 0.05, 0.05), new THREE.Vector3(0, -HANG + 0.62, -0.42)],                 // safety bar
      [new THREE.BoxGeometry(1.4, 0.04, 0.3), new THREE.Vector3(0, -HANG - 0.45, -0.45)],                  // footrest
    ];
  }

  _sign(text, pos) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 96;
    const x = c.getContext('2d');
    x.fillStyle = '#163566'; x.fillRect(0, 0, 256, 96);
    x.fillStyle = '#fff'; x.font = 'bold 38px Trebuchet MS, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, 128, 36);
    x.font = '20px Trebuchet MS, sans-serif'; x.fillText(this.name, 128, 74);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Group();
    const y = this.terrain.heightAt(pos.x, pos.z);
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.1), [0, 0, 0, 0, 0, 0].map((_, i) => i === 4 || i === 5 ? new THREE.MeshStandardMaterial({ map: tex }) : new THREE.MeshStandardMaterial({ color: 0x163566 })));
    board.position.set(pos.x, y + 2.4, pos.z);
    board.rotation.y = Math.atan2(this.f.x, this.f.z) + Math.PI;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2, 5), new THREE.MeshStandardMaterial({ color: 0x23272e }));
    post.position.set(pos.x, y + 1, pos.z);
    g.add(board, post);
    return g;
  }

  update(dt) {
    this.clock = (this.clock + dt) % this.period;
    for (let i = 0; i < this.chairs.length; i++) {
      this._pointAt(this.chairU(i), this._tmpP, this._tmpD);
      const c = this.chairs[i];
      c.position.copy(this._tmpP);
      c.rotation.y = Math.atan2(-this._tmpD.x, -this._tmpD.z);
    }
  }

  chairU(i) { return this._uAtTime(this.clock + i * this.period / this.chairs.length); }

  chairState(i) {
    const pos = new THREE.Vector3(), dir = new THREE.Vector3();
    const u = this.chairU(i);
    this._pointAt(u, pos, dir);
    return { pos, dir, u };
  }

  // The chair that will reach the load point next.
  nextChairToLoad() {
    let best = 0, bestWait = Infinity;
    const tl = this._timeAt(this.loadU);
    for (let i = 0; i < this.chairs.length; i++) {
      const wait = ((tl - this._timeAt(this.chairU(i))) % this.period + this.period) % this.period;
      if (wait > 0.3 && wait < bestWait) { bestWait = wait; best = i; }
    }
    return { index: best, wait: bestWait };
  }

  // World position of a seat. side: -1 left, +1 right (as seen sitting on the chair).
  seatPoint(i, side = -1) {
    this.chairs[i].updateMatrixWorld();
    return this.chairs[i].localToWorld(new THREE.Vector3(side * 0.38, -HANG + 0.05, 0.02));
  }

  // A point in chair i's own space (x = toward the right cable side, y up from the grip, z = backwards).
  chairToWorld(i, v) {
    this.chairs[i].updateMatrixWorld();
    return this.chairs[i].localToWorld(v.clone());
  }

  // Seconds until chair i reaches the unload point (0 if past it).
  timeToTop(i) {
    const u = this.chairU(i);
    return u <= this.unloadU ? this._timeAt(this.unloadU) - this._timeAt(u) : 0;
  }

  // Jump the lift forward so that chair i is at distance u along the cable (used to skip the ride).
  setChairU(i, u) { this.clock = this._timeAt(u) - i * this.period / this.chairs.length; this.update(0); }
}
