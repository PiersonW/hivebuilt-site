// Other people on the mountain: skiers and snowboarders riding the runs, and people sitting on the chairs.
// Riders on the snow use the same Rider physics as you, driven by a simple "follow the run" brain.
// When a chair with people on it reaches the top, they get off and ride down (if a rider is free).
import * as THREE from 'three';
import { SHAPES } from './ridermodel.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rider } from './rider.js';

const JACKETS = [0x2bb3ff, 0x8a3bd6, 0x2fbf71, 0xffd23a, 0xe83f6f, 0x222831, 0xf2f2f2, 0x1d5fd1, 0xff8f1f, 0x13a89e];
const PANTS = [0x23324d, 0x141414, 0x5a3d2b, 0x3b5d3b, 0x6d6f7a, 0x2a2a52];
const HELMETS = [0x1b1b1b, 0xf4f4f4, 0xd63030, 0x1e8fd6, 0x6a6a6a];
const BOARDS = [0x1b1b22, 0xd63030, 0x2fbf71, 0x1e8fd6, 0xf2f2f2];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const HANG = 2.6;   // must match lift.js (cable grip to seat)

function randomLook() {
  return { sport: Math.random() < 0.5 ? 'ski' : 'board', regular: Math.random() < 0.7, jacket: pick(JACKETS), pants: pick(PANTS), helmet: pick(HELMETS), board: pick(BOARDS) };
}

// ---------- people sitting on chairs (one merged mesh each, so they're cheap) ----------
function seatedGeometry(look) {
  const parts = [];
  const col = new THREE.Color();
  const add = (geo, color, m) => {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    if (m) g.applyMatrix4(m);
    col.setHex(color).convertSRGBToLinear();
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) { c[i] = col.r; c[i + 1] = col.g; c[i + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  };
  const box = new THREE.BoxGeometry(1, 1, 1);
  const UPV = new THREE.Vector3(0, 1, 0);
  // a box stretched between two points (chair space: forward = -z, seat at y = -HANG)
  const limb = (a, b, w, color, d = w) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const dir = B.clone().sub(A), len = dir.length();
    const m = new THREE.Matrix4().compose(A.clone().addScaledVector(dir, 0.5), new THREE.Quaternion().setFromUnitVectors(UPV, dir.normalize()), new THREE.Vector3(w, len, d));
    add(SHAPES.limb, color, m);     // rounded, like the riders
  };
  const y0 = -HANG + 0.04;   // top of the seat
  for (const sx of [-0.1, 0.1]) {
    limb([sx, y0 + 0.08, 0.12], [sx, y0 + 0.1, -0.33], 0.15, look.pants);                  // thigh
    limb([sx, y0 + 0.1, -0.35], [sx, y0 - 0.38, -0.44], 0.13, look.pants);                 // shin
    limb([sx, y0 - 0.38, -0.39], [sx, y0 - 0.38, -0.6], 0.14, 0x222222, 0.1);              // boot
  }
  limb([0, y0 + 0.06, 0.16], [0, y0 + 0.62, 0.22], 0.34, look.jacket, 0.22);               // torso, leaning back a touch
  for (const sx of [-1, 1]) {
    limb([sx * 0.2, y0 + 0.55, 0.2], [sx * 0.25, y0 + 0.3, 0.02], 0.11, look.jacket);       // upper arm
    limb([sx * 0.25, y0 + 0.3, 0.02], [sx * 0.2, y0 + 0.56, -0.4], 0.1, look.jacket);       // forearm up to the safety bar
    add(SHAPES.mitt, 0x222222, new THREE.Matrix4().compose(new THREE.Vector3(sx * 0.2, y0 + 0.58, -0.42), new THREE.Quaternion(), new THREE.Vector3(0.11, 0.11, 0.11)));
  }
  const headP = new THREE.Vector3(0, y0 + 0.82, 0.2);
  add(SHAPES.head, 0xf0c39a, new THREE.Matrix4().makeTranslation(headP.x, headP.y, headP.z));
  add(new THREE.SphereGeometry(0.168, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.56), look.helmet, new THREE.Matrix4().makeTranslation(headP.x, headP.y + 0.02, headP.z));
  // goggles (facing -z, the way the chair faces), neck gaiter and collar
  add(new THREE.CylinderGeometry(0.174, 0.174, 0.07, 14, 1, true, Math.PI - 1.0, 2.0), 0xff9a3c, new THREE.Matrix4().makeTranslation(headP.x, headP.y + 0.02, headP.z));
  add(new THREE.CylinderGeometry(0.128, 0.12, 0.13, 12), 0x1d2230, new THREE.Matrix4().makeTranslation(headP.x, headP.y - 0.075, headP.z));
  add(new THREE.CylinderGeometry(0.13, 0.15, 0.05, 12), 0x1d2230, new THREE.Matrix4().makeTranslation(0, y0 + 0.62, 0.22));
  if (look.sport === 'board') {
    // board hangs off the front foot, resting across the footrest
    add(new THREE.BoxGeometry(1.5, 0.04, 0.29), look.board, new THREE.Matrix4().makeRotationZ(0.12).setPosition(0.3, y0 - 0.46, -0.5));
  } else {
    for (const sx of [-0.12, 0.12]) add(new THREE.BoxGeometry(0.09, 0.03, 1.7), look.board, new THREE.Matrix4().makeRotationX(-0.25).setPosition(sx, y0 - 0.5, -0.65));
  }
  return mergeGeometries(parts);
}

export class Npcs {
  // opts: { count, lifts, playerChair: () => ({ lift, index }) | null, laneEntrance(lift) }
  constructor(scene, terrain, opts) {
    this.scene = scene;
    this.terrain = terrain;
    this.lifts = opts.lifts;
    this.playerChair = opts.playerChair || (() => null);
    this.laneEntrance = opts.laneEntrance;
    this.acc = 0;
    this.camPos = new THREE.Vector3();
    this.playerPos = new THREE.Vector3(1e9, 0, 0);

    // seated people: a few looks, shared between all chairs
    this.looks = Array.from({ length: 14 }, randomLook);
    this.seatGeos = this.looks.map(seatedGeometry);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    this.seats = [];   // per lift: per chair: { meshes: [left, right], up }
    for (const l of this.lifts) {
      const list = l.chairs.map((c) => {
        const meshes = [-1, 1].map((side) => {
          const m = new THREE.Mesh(this.seatGeos[0], mat);
          m.position.set(side * 0.38, 0, 0);
          m.castShadow = true; m.visible = false;
          c.add(m);
          return m;
        });
        return { meshes, looks: [null, null], up: false };
      });
      this.seats.push(list);
    }

    // riders on the snow
    this.riders = [];
    for (let i = 0; i < opts.count; i++) {
      const r = new Rider(scene, terrain);
      r.npc = true;   // other riders don't grind or hit rails
      const npc = { rider: r, active: false, goneT: 0, look: null };
      r.root.visible = false;
      this.riders.push(npc);
    }
    // spread the first riders out over the mountain
    for (const n of this.riders) this._spawnOnRun(n, null, 0.08 + Math.random() * 0.8);
    // fill the chairs already on the way up
    for (let li = 0; li < this.lifts.length; li++) this.lifts[li].chairs.forEach((_, i) => this._loadChair(li, i, this._isUp(li, i)));
  }

  _isUp(li, i) { const l = this.lifts[li], u = l.chairU(i); return u > l.loadU + 1 && u < l.unloadU - 0.5; }

  _loadChair(li, i, up) {
    const st = this.seats[li][i];
    st.up = up;
    for (let k = 0; k < 2; k++) {
      const on = up && Math.random() < (k === 0 ? 0.55 : 0.45);
      st.looks[k] = on ? Math.floor(Math.random() * this.looks.length) : null;
      if (on) st.meshes[k].geometry = this.seatGeos[st.looks[k]];
      st.meshes[k].visible = on;
    }
  }

  _dress(n, look) {
    const r = n.rider;
    n.look = look;
    r.setSport(look.sport);
    r.setStance(look.regular);
    r.mats.jacket.color.setHex(look.jacket);
    r.mats.pants.color.setHex(look.pants);
    r.mats.helmet.color.setHex(look.helmet);
    r.mats.board.color.setHex(look.board);
    r.mats.boardTop.color.setHex(look.board).lerp(new THREE.Color(1, 1, 1), 0.55);   // tint the board's print
    r.mats.ski.color.setHex(look.board);
  }

  // Start a rider somewhere on a run. at = a fraction of the way down (or null = the top of a run near `near`).
  _spawnOnRun(n, near, frac) {
    const T = this.terrain;
    let run, s;
    if (near) {
      // runs that start close to this lift's unload point
      const q = T._q(near.x, near.z);
      const cand = T.runs.filter((r, ri) => T.runDist[ri][q] < 90);
      run = pick(cand.length ? cand : T.runs);
      const ri = T.runs.indexOf(run);
      s = T.runS[ri][T._q(near.x, near.z)];
    } else {
      // somewhere out of the player's sight
      for (let tries = 0; tries < 12; tries++) {
        run = pick(T.runs); s = run.length * frac;
        const a = run.at(s);
        if (Math.hypot(a.x - this.playerPos.x, a.z - this.playerPos.z) > 120) break;
        frac = 0.08 + Math.random() * 0.8;
      }
    }
    if (!n.look || near) this._dress(n, n.pendingLook || randomLook());
    n.pendingLook = null;
    n.run = run; n.ri = T.runs.indexOf(run);
    n.lane = (Math.random() * 2 - 1) * 0.45;                     // which part of the run they like
    n.swing = 0.25 + Math.random() * 0.35;                       // how wide their turns are
    n.turnLen = 28 + Math.random() * 30;                         // m per turn
    n.phase = Math.random() * Math.PI * 2;
    n.skill = Math.random();
    n.cruise = 9 + n.skill * 9 + (run.diff === 'black' ? 2 : run.diff === 'green' ? -2 : 0);   // m/s they like to ride at
    n.tricky = n.skill > 0.55;
    n.slowT = 0; n.finishT = 0; n.target = null;
    let pos;
    if (near) pos = near.clone();
    else {
      const a = run.at(s), hw = run.width / 2;
      const lat = n.lane * (hw - 4);
      pos = new THREE.Vector3(a.x - a.tz * lat, 0, a.z + a.tx * lat);
      if (T.treeNear(pos.x, pos.z)) pos.set(a.x, 0, a.z);
    }
    pos.y = T.heightAt(pos.x, pos.z);
    const a2 = run.at(Math.min(run.length, s + 45));
    n.rider.reset(pos, Math.atan2(a2.x - pos.x, -(a2.z - pos.z)));
    n.rider.vel.multiplyScalar(near ? 0.8 : 2.5);
    n.rider.events.length = 0;
    n.active = true; n.goneT = 0;
    n.rider.root.visible = true;
  }

  _retire(n) { n.active = false; n.goneT = 0; n.rider.root.visible = false; }

  // The brain: aim at a point ahead on the run, weave a little, keep to a comfortable speed.
  _think(n, dt) {
    const r = n.rider, T = this.terrain, run = n.run;
    const inp = { steer: 0, up: false, down: false, jump: false, brake: false, grind: false, grab: null, phantomPressed: false };
    if (r.state === 'air') {
      if (n.tricky && r.airTime > 0.25 && r.airTime < 0.9) inp.grab = n.grabName || (n.grabName = pick(['Indy', 'Melon', 'Method', 'Nose Grab']));
      return inp;
    }
    n.grabName = null;
    if (r.state !== 'ride') return inp;
    const p = r.pos, sp = r.speed;
    const q = T._q(p.x, p.z);
    const s = T.runS[n.ri][q], d = T.runDist[n.ri][q];
    let tx, tz;
    // a run that ends mid-mountain (it joins another one): carry on down the run it joins
    if (s > run.length - 30 && n.finishT === 0) {
      let near = Infinity;
      for (const l of this.lifts) { const e = this.laneEntrance(l); near = Math.min(near, Math.hypot(e.x - p.x, e.z - p.z)); }
      if (near > 150) {
        let bi = -1, bd = Infinity;
        T.runs.forEach((r2, ri) => { if (ri !== n.ri && T.runS[ri][q] < r2.length - 60 && T.runDist[ri][q] < bd) { bd = T.runDist[ri][q]; bi = ri; } });
        if (bi >= 0) { n.ri = bi; n.run = T.runs[bi]; return this._think(n, 0); }
      }
    }
    if (s > run.length - 30 || n.finishT > 0) {
      // end of the run: head for the nearest lift line and get in it
      n.finishT += dt;
      if (!n.target) {
        let best = null, bd = Infinity;
        for (const l of this.lifts) { const e = this.laneEntrance(l); const dd = Math.hypot(e.x - p.x, e.z - p.z); if (dd < bd) { bd = dd; best = e; } }
        n.target = best;
      }
      tx = n.target.x; tz = n.target.z;
      if (Math.hypot(tx - p.x, tz - p.z) < 5 || n.finishT > 40) { this._retire(n); return inp; }
    } else {
      n.phase += dt * Math.max(2, sp) / n.turnLen * Math.PI;
      // off the run (e.g. just off the lift): aim further down it so you never aim back uphill
      const look = 9 + sp * 0.8 + Math.max(0, Math.min(60, d - run.width / 2));
      const a = run.at(s + look), hw = run.width / 2;
      let lat = (n.lane + n.swing * Math.sin(n.phase)) * (hw - 4);
      // through the halfpipe: stay on the flat bottom
      const P = T.pipe;
      if (P) { const u = (a.x - P.ox) * P.ax + (a.z - P.oz) * P.az, u0 = (p.x - P.ox) * P.ax + (p.z - P.oz) * P.az;
        if ((u > -25 && u < P.L + 5) || (u0 > -25 && u0 < P.L + 5)) lat = 0; }
      lat = Math.max(-(hw - 3), Math.min(hw - 3, lat));
      tx = a.x - a.tz * lat; tz = a.z + a.tx * lat;
      // give the player some room
      const dx = this.playerPos.x - p.x, dz = this.playerPos.z - p.z, pd = Math.hypot(dx, dz);
      if (pd < 6 && pd > 0.01) { tx -= dx / pd * (6 - pd) * 1.2; tz -= dz / pd * (6 - pd) * 1.2; }
      if (d > run.width / 2 + 30) n.slowT += dt * 2;                // way off the run: give up sooner
    }
    let want = Math.atan2(tx - p.x, -(tz - p.z));
    // going slowly or off the run: don't aim up a rise you can't push over, go round it downhill
    if (sp < 6 || d > run.width / 2) {
      let best = want, bestRise = Infinity;
      for (const o of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.8, -1.8]) {
        const h = want + o, sx = Math.sin(h), sz = -Math.cos(h);
        const near = T.heightAt(p.x + sx * 3, p.z + sz * 3) - p.y, rise = Math.max(near * 2.3, T.heightAt(p.x + sx * 7, p.z + sz * 7) - p.y);
        if (rise < 0.25) { best = h; bestRise = rise; break; }
        if (rise < bestRise) { bestRise = rise; best = h; }
      }
      want = best;
    }
    const err = wrap(want - r.yaw);
    inp.steer = Math.max(-1, Math.min(1, err * 2.2));
    const cruise = n.finishT > 0 ? 6 : T.pipeAt(p.x, p.z) ? Math.min(n.cruise, 9) : n.cruise;
    if (sp > cruise + 1.5 || (Math.abs(err) > 1.2 && sp > 6)) inp.brake = true;
    else if (sp < cruise - 4 && Math.abs(err) < 0.25 && n.skill > 0.4) inp.down = true;
    if (sp < 2.5 && Math.abs(err) < 0.8) inp.up = true;            // push along the flats
    // stuck somewhere: give up and come back later
    if (sp < 0.6) n.slowT += dt; else n.slowT = Math.max(0, n.slowT - dt);
    if (n.slowT > 8) this._retire(n);
    return inp;
  }

  update(dt, camPos, playerPos) {
    this.camPos.copy(camPos);
    this.playerPos.copy(playerPos || camPos);
    // chairs: people sit down at the bottom and get off at the top
    for (let li = 0; li < this.lifts.length; li++) {
      const l = this.lifts[li], pc = this.playerChair();
      this.seats[li].forEach((st, i) => {
        const up = this._isUp(li, i);
        if (up && !st.up) this._loadChair(li, i, true);
        else if (!up && st.up) {
          // reaching the top: whoever was on the chair rides off down the mountain
          if (l.chairU(i) >= l.unloadU - 0.5 && l.chairU(i) < l.unloadU + 20) {
            for (let k = 0; k < 2; k++) if (st.looks[k] !== null) {
              const free = this.riders.find(n => !n.active && n.goneT > 1.5);
              if (free) { free.pendingLook = this.looks[st.looks[k]]; this._spawnOnRun(free, l.unloadPoint.clone().addScaledVector(l.p, k ? 1.2 : 0)); }
            }
          }
          this._loadChair(li, i, false);
        }
        // keep the player's chair to themselves
        const mine = pc && pc.lift === l && pc.index === i;
        for (let k = 0; k < 2; k++) st.meshes[k].visible = st.up && st.looks[k] !== null && !mine;
      });
    }
    // riders on the snow (60 steps a second is plenty for them)
    const STEP = 1 / 60;
    this.acc = Math.min(this.acc + dt, STEP * 6);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      for (const n of this.riders) {
        if (!n.active) { n.goneT += STEP; if (n.goneT > 45) this._spawnOnRun(n, null, 0.05 + Math.random() * 0.5); continue; }
        n.inp = this._think(n, STEP);
        if (!n.active) continue;
        n.rider.step(STEP, n.inp);
        n.rider.events.length = 0;
        if (n.rider.pos.y < -5000 || !isFinite(n.rider.pos.x)) this._retire(n);
      }
    }
    for (const n of this.riders) {
      if (!n.active) continue;
      const far = n.rider.pos.distanceToSquared(this.camPos) > 380 * 380;
      n.rider.root.visible = !far;
      if (!far) n.rider.updateVisual(dt, n.inp || {});
    }
  }

  get activeCount() { return this.riders.filter(n => n.active).length; }
}
