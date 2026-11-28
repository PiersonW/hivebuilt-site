// Snowboard Cross race: up to 6 racers in the start gate (you plus bots for now). 3-2-1, the gates drop,
// first to the finish wins. Each racer is a "slot" so bots can later be swapped for real players online:
//   slot = { kind: 'you' | 'bot' | 'remote', name, rider, lane, finish: seconds | null, s (progress) }
import * as THREE from 'three';
import { Rider } from './rider.js';
import { SBX } from './sbxcourse.js';

const BOT_NAMES = ['Maya L.', 'Kai M.', 'Theo P.', 'Leo S.', 'Finn D.', 'Nora K.', 'Ava C.', 'Jonas B.'];
const COLORS = [[0x2fbf71, 0x1d2a44, 0xffd23a], [0xd63030, 0x23324d, 0x1e8fd6], [0x7b4fd6, 0x2b2b2b, 0xff7a1a], [0x1e8fd6, 0x3a2a1a, 0xf2f2f2], [0xff7aa8, 0x1d2a44, 0x2fbf71]];
const COUNT = 3.2;          // seconds of 3-2-1 before the gates drop

export class SbxRace {
  constructor(scene, terrain) {
    this.scene = scene; this.T = terrain; this.C = terrain.sbx;
    this.state = 'idle';      // idle | gate | racing | done
    this.events = [];
    this.bots = [];
    this.slots = [];
  }

  _bot(k) {
    if (!this.bots[k]) {
      const r = new Rider(this.scene, this.T);
      r.npc = true;
      const [jacket, pants, helmet] = COLORS[k % COLORS.length];
      r.mats.jacket.color.setHex(jacket); r.mats.pants.color.setHex(pants); r.mats.helmet.color.setHex(helmet);
      r.mats.board.color.setHex(helmet); r.mats.boardTop.color.setHex(helmet).lerp(new THREE.Color(1, 1, 1), 0.55);
      r.setSport('board'); r.setStance(k % 3 !== 1);
      r.root.visible = false;
      this.bots[k] = r;
    }
    return this.bots[k];
  }

  // Put everyone in the gate. `you` = { rider, name }. Returns your lane's start spot.
  start(you, nBots = 5) {
    const lanes = [0, 1, 2, 3, 4, 5].sort(() => Math.random() - 0.5);
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    this.slots = [{ kind: 'you', name: you.name, rider: you.rider, lane: lanes[0] }];
    // bots: a spread of skill so there's always someone to beat and someone to chase
    const skills = [0.86, 0.9, 0.93, 0.96, 0.985].sort(() => Math.random() - 0.5);
    for (let k = 0; k < nBots; k++) {
      const r = this._bot(k);
      this.slots.push({ kind: 'bot', name: names[k], rider: r, lane: lanes[k + 1], skill: skills[k], wobble: Math.random() * 10, line: (Math.random() - 0.5) * 4, aggro: 0.6 + Math.random() * 1.6 });
    }
    for (const sl of this.slots) {
      sl.finish = null; sl.s = 0; sl.offT = 0; sl.place = null; sl.rider.wantShove = false; sl.shoveCd = 2;
      const st = this.C.lane(sl.lane);
      sl.gatePos = st.pos; sl.gateYaw = st.yaw;
      if (sl.kind === 'bot') { sl.rider.reset(st.pos.clone(), st.yaw); sl.rider.root.visible = true; sl.rider.events.length = 0; }
    }
    this.state = 'gate'; this.t = -COUNT; this.C.setGates(0);
    return { pos: this.slots[0].gatePos, yaw: this.slots[0].gateYaw };
  }

  stop() {
    this.state = 'idle';
    for (const r of this.bots) if (r) r.root.visible = false;
    this.C.setGates(0);
  }

  get you() { return this.slots[0]; }

  // Hold everyone in the gate until it drops (call before stepping the physics).
  hold() {
    if (this.state !== 'gate') return;
    for (const sl of this.slots) { sl.rider.pos.copy(sl.gatePos); sl.rider.vel.set(0, 0, 0); sl.rider.yaw = sl.gateYaw; sl.rider.crouch = 0.5; }
  }

  // bots ride with the same physics as you, at the same fixed step
  stepBots(dt) {
    if (this.state === 'idle') return;
    for (const sl of this.slots) {
      if (sl.kind !== 'bot') continue;
      const r = sl.rider;
      if (this.state === 'gate') { r.pos.copy(sl.gatePos); r.vel.set(0, 0, 0); r.yaw = sl.gateYaw; r.crouch = 0.5; continue; }
      r.step(dt, this._botInput(sl));
      r.events.length = 0;
    }
    this._contacts();
  }

  _botInput(sl) {
    const r = sl.rider, C = this.C;
    if (sl.finish !== null) return { brake: true, steer: 0 };            // done: skid to a stop
    if (r.state !== 'ride') return {};
    const c = C.coords(r.pos.x, r.pos.z), s = c ? c.s : sl.s;
    const sp = r.speed, look = 8 + sp * 0.45;
    // aim a little ahead, drifting from your lane to your own racing line
    const laneOff = SBX.lanes[sl.lane] * Math.max(0, 1 - s / 50);
    const off = laneOff + sl.line * Math.min(1, s / 50) + Math.sin(this.t * 0.7 + sl.wobble) * 0.8;
    const tgt = C.point(s + look, off);
    let e = Math.atan2(tgt.x - r.pos.x, -(tgt.z - r.pos.z)) - r.yaw;
    while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
    // speed: tuck on the straights, scrub speed into the tight turns (the better the bot, the less it scrubs)
    const kapAhead = Math.max(Math.abs(C._at(C.kap, s + look)), Math.abs(C._at(C.kap, s + look * 0.5)));
    const vTurn = (kapAhead > 0.012 ? 13 + (0.03 - Math.min(0.03, kapAhead)) * 300 : 30) * sl.skill;
    const vMax = 24 * sl.skill;
    const want = Math.min(vMax, vTurn);
    const inp = { steer: Math.max(-1, Math.min(1, e * 2.6)), down: sp < want - 1 && Math.abs(e) < 0.25, brake: sp > want + 1.5 };
    // battle: shove anyone right alongside (some bots are pushier than others)
    sl.shoveCd = Math.max(0, (sl.shoveCd || 0) - 1 / 120);
    if (sl.shoveCd <= 0 && this._neighbour(sl, 1.9) && Math.random() < sl.aggro / 120) { inp.grab = 'Indy'; sl.shoveCd = 1.6; }
    return inp;
  }

  _neighbour(sl, range) {
    const A = sl.rider;
    for (const o of this.slots) {
      if (o === sl || o.rider.state === 'crash') continue;
      const B = o.rider, d = Math.hypot(B.pos.x - A.pos.x, B.pos.z - A.pos.z);
      if (d < range && Math.abs(B.pos.y - A.pos.y) < 1.5) return o;
    }
    return null;
  }

  // a shove: push them away from you, and maybe knock them over (easier if they're in the air or slow)
  _shove(sl) {
    const A = sl.rider;
    A.wantShove = false;
    if (A.state !== 'ride') return;
    const o = this._neighbour(sl, 2.4);
    A.shoveT = 0.35;
    if (!o) { A.shoveDir = new THREE.Vector3(Math.sin(A.yaw), 0, -Math.cos(A.yaw)); return null; }
    const B = o.rider, dx = B.pos.x - A.pos.x, dz = B.pos.z - A.pos.z, d = Math.hypot(dx, dz) || 1, nx = dx / d, nz = dz / d;
    A.shoveDir = new THREE.Vector3(nx, 0, nz);
    B.vel.x += nx * 5.5; B.vel.z += nz * 5.5;
    A.vel.x -= nx * 1.2; A.vel.z -= nz * 1.2;
    let chance = o.kind === 'you' ? 0.22 : 0.4;
    if (B.state === 'air') chance += 0.35;
    if (B.speed < 6) chance += 0.15;
    const down = Math.random() < chance;
    if (down) B.doCrash(`Shoved over by ${sl.kind === 'you' ? 'you' : sl.name}!`);
    this.events.push({ type: 'shove', from: sl, to: o, down });
    return o;
  }

  // racers bump each other instead of passing through (a hard hit can knock the slower one down)
  _contacts() {
    const S = this.slots;
    for (const sl of S) if (sl.rider.wantShove) this._shove(sl);
    for (let a = 0; a < S.length; a++) for (let b = a + 1; b < S.length; b++) {
      const A = S[a].rider, B = S[b].rider;
      if (A.state === 'crash' || B.state === 'crash') continue;
      const dx = B.pos.x - A.pos.x, dz = B.pos.z - A.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.9 || d < 1e-4 || Math.abs(A.pos.y - B.pos.y) > 1.2) continue;
      const nx = dx / d, nz = dz / d, push = (0.9 - d) / 2;
      A.pos.x -= nx * push; A.pos.z -= nz * push; B.pos.x += nx * push; B.pos.z += nz * push;
      const rv = (B.vel.x - A.vel.x) * nx + (B.vel.z - A.vel.z) * nz;
      if (rv < 0) { A.vel.x += nx * rv * 0.5; A.vel.z += nz * rv * 0.5; B.vel.x -= nx * rv * 0.5; B.vel.z -= nz * rv * 0.5; }
      if (rv < -4 && Math.random() < 0.3) { const slow = A.speed < B.speed ? A : B; slow.doCrash('Taken out in a collision!'); }
    }
  }

  // Every frame. Returns events: [{ type: 'count', n } | { type: 'go' } | { type: 'finish', slot } | { type: 'dnf', why }]
  update(dt) {
    const out = this.events.splice(0);
    if (this.state === 'idle') return out;
    const before = this.t; this.t += dt;
    if (this.state === 'gate') {
      for (const n of [3, 2, 1]) if (before < -n + 0.2 && this.t >= -n + 0.2) out.push({ type: 'count', n });
      if (this.t >= 0) { this.state = 'racing'; this.t = 0; this.dropT = 0; out.push({ type: 'go' }); }
      return out;
    }
    if (this.dropT !== undefined && this.dropT < 1) { this.dropT = Math.min(1, this.dropT + dt / 0.35); this.C.setGates(this.dropT); }
    // progress, finishes, and off-course checks
    for (const sl of this.slots) {
      const r = sl.rider, c = this.C.coords(r.pos.x, r.pos.z);
      if (c && Math.abs(c.l) < SBX.hw + 14) { sl.s = Math.max(sl.s, Math.min(c.s, sl.s + 30)); sl.offT = 0; }
      else sl.offT += dt;
      if (sl.finish === null && sl.s >= this.C.finishS) {
        sl.finish = this.t; sl.place = this.slots.filter(x => x.finish !== null).length;
        out.push({ type: 'finish', slot: sl });
      }
      if (sl.kind === 'bot' && sl.finish === null && sl.offT > 3) {
        // a bot that got lost goes back onto the course where it left it
        const p = this.C.point(sl.s, 0), d = this.C.dirAt(sl.s);
        r.reset(p, Math.atan2(d.x, -d.z)); r.vel.set(d.x * 6, 0, d.z * 6); sl.offT = 0;
      }
    }
    const me = this.you;
    if (me.finish === null && me.offT > 8) { out.push({ type: 'dnf', why: 'Left the course' }); this.state = 'done'; }
    if (me.finish !== null && this.state === 'racing') this.state = 'done';
    return out;
  }

  // racers in order: finished (by time), then by distance down the course
  order() {
    return [...this.slots].sort((a, b) => (a.finish !== null) !== (b.finish !== null) ? (a.finish !== null ? -1 : 1)
      : a.finish !== null ? a.finish - b.finish : b.s - a.s);
  }
  position(slot) { return this.order().indexOf(slot) + 1; }

  // after you finish, estimate the others' times from how far they still have to go
  results() {
    const C = this.C;
    return this.order().map(sl => {
      let t = sl.finish, est = false;
      if (t === null) { const sp = Math.max(6, sl.rider.speed); t = this.t + (C.finishS - sl.s) / sp; est = true; }
      return { name: sl.name, kind: sl.kind, time: t, est, rider: sl.rider };
    }).sort((a, b) => a.time - b.time);
  }

  updateVisuals(dt) {
    if (this.state === 'idle') return;
    for (const sl of this.slots) if (sl.kind === 'bot') sl.rider.updateVisual(dt, {});
  }
}
