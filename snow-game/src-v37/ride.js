// Ride together: friends in the same room (a 4-letter code, see net.js) see each other anywhere on the
// mountain: riding, on the chairlifts, in the helicopter and wingsuit. Each game sends its own rider
// ~12 times a second; everyone else's rider is drawn from those updates (slightly in the past, so smooth),
// with their name floating above their head.
import * as THREE from 'three';
import { Rider } from './rider.js';
import { applyLook, charOf, cssColor } from './characters.js';

const SEND_HZ = 12, DELAY = 0.18;
const TAG_TIME = 180, TAG_RANGE = 2.3, NO_TAGBACK = 3;   // a 3-minute round; touch within 2.3 m; no tag-backs for 3 s
const ON_SNOW = new Set(['ride', 'air', 'grind', 'crash']);
const STATES = ['ride', 'air', 'crash', 'grind', 'lift', 'fly', 'heli'];

export class RideTogether {
  constructor(scene, terrain, net) {
    this.scene = scene; this.T = terrain; this.net = net;
    this.friends = new Map();      // id -> { name, rider, tag, snaps, color }
    this.sendT = 0;
    this.events = [];              // for the game: { type: 'shoved' | 'tag' | 'tagstart' | 'tagend', ... }
    this.tag = null;               // a game of tag: { g, it, s, left, times: {id: seconds as it}, names, from, noBackT }
    this.endedG = null;
    net.on = (event, m) => {
      if (event === 'rs') this._receive(m);
      else if (event === 'bye') this._drop(m.id);
      else if (event === 'shove' && m.to === this.net.id) this.events.push({ type: 'shoved', name: m.n, nx: m.nx, nz: m.nz });
      else if (event === 'tag') this._tagMsg(m);
    };
    net.onPlayers = (list) => {
      const ids = new Set(list.map(p => p.id));
      for (const id of [...this.friends.keys()]) if (!ids.has(id)) this._drop(id);
      // whoever was "it" left: the host picks someone else
      if (this.tag && this.tag.left > 0 && !ids.has(this.tag.it) && this.net.isHost && list.length > 1) {
        const others = list.filter(p => p.id !== this.tag.it);
        this._setIt(others[Math.floor(Math.random() * others.length)].id, null, this.tag.s + 1, true);
      }
      for (const p of list) { const f = this.friends.get(p.id); if (f) this._dress(f, p.char, p.name); }
      if (this.onChange) this.onChange(list);
    };
  }
  get active() { return this.net.connected; }
  get count() { return this.net.players.length; }

  _friend(id, name) {
    let f = this.friends.get(id);
    if (!f) {
      const r = new Rider(this.scene, this.T); r.npc = true;
      r.root.visible = false;
      f = { id, name: '', rider: r, snaps: [], color: '#fff' };
      this.friends.set(id, f);
      const p = this.net.players.find(q => q.id === id);
      this._dress(f, p && p.char, name || 'Friend');
    }
    return f;
  }
  // wear the character they picked (their name tag dot is their jacket colour)
  _dress(f, charId, name) {
    const c = charOf(charId), col = cssColor(c.jacket);
    applyLook(f.rider, c.id);
    if (col !== f.color || name !== f.name || !f.tag) { f.color = col; this._setName(f, name); }
  }
  // a name tag that always faces the camera, floating over their helmet
  _setName(f, name) {
    f.name = name; f.isIt = this.tag && this.tag.left > 0 && this.tag.it === f.id;
    if (f.tag) { f.rider.root.remove(f.tag); f.tag.material.map.dispose(); f.tag.material.dispose(); }
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = f.isIt ? 'rgba(214,40,40,0.92)' : 'rgba(10,25,50,0.75)'; g.beginPath(); g.roundRect(4, 8, 248, 48, 22); g.fill();
    g.fillStyle = f.isIt ? '#fff' : f.color; g.beginPath(); g.arc(30, 32, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 28px Trebuchet MS, sans-serif'; g.textBaseline = 'middle'; g.fillText((f.isIt ? 'IT · ' : '') + name.slice(0, f.isIt ? 8 : 12), 50, 33);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(1.6, 0.4, 1); sp.position.set(0, 2.35, 0); sp.renderOrder = 10;
    f.tag = sp; f.rider.root.add(sp);
  }
  _drop(id) {
    const f = this.friends.get(id);
    if (!f) return;
    f.rider.root.visible = false; this.scene.remove(f.rider.root);
    this.friends.delete(id);
  }
  clear() { for (const id of [...this.friends.keys()]) this._drop(id); this.tag = null; }
  _nameOf(id) { if (id === this.net.id) return 'You'; const f = this.friends.get(id); if (f) return f.name; const p = this.net.players.find(q => q.id === id); return p ? p.name : 'Someone'; }
  _retag() { for (const f of this.friends.values()) { const it = !!(this.tag && this.tag.left > 0 && this.tag.it === f.id); if (it !== !!f.isIt) this._setName(f, f.name); } }

  // ---------- tag ----------
  get tagOn() { return !!(this.tag && this.tag.left > 0); }
  get iAmIt() { return this.tagOn && this.tag.it === this.net.id; }
  // start a round: someone random is "it"
  startTag() {
    const list = this.net.players;
    if (list.length < 2) return false;
    const g = Math.random().toString(36).slice(2, 8);
    this.tag = { g, it: list[Math.floor(Math.random() * list.length)].id, s: 0, left: TAG_TIME, times: {}, reported: {}, from: null, noBackT: 0, endT: 0 };
    this.net.send('tag', { g, it: this.tag.it, s: 0, left: TAG_TIME });
    this.events.push({ type: 'tagstart', it: this.tag.it, itName: this._nameOf(this.tag.it), me: this.tag.it === this.net.id });
    this._retag();
    return true;
  }
  _setIt(id, from, s, send = false) {
    const t = this.tag;
    t.it = id; t.s = s; t.from = from; t.noBackT = NO_TAGBACK;
    if (send) this.net.send('tag', { g: t.g, it: id, s, left: t.left, from });
    this.events.push({ type: 'tag', it: id, itName: this._nameOf(id), from, fromName: from ? this._nameOf(from) : null, me: id === this.net.id, byMe: from === this.net.id });
    this._retag();
  }
  // tag news, either sent right away ('tag') or riding along with everyone's updates (so late joiners catch up)
  _tagMsg(m) {
    const t = this.tag;
    if (!t || t.g !== m.g) {
      if (m.g === this.endedG || !(m.left > 2)) return;
      this.tag = { g: m.g, it: m.it, s: m.s, left: m.left, times: {}, reported: {}, from: m.from || null, noBackT: 0, endT: 0 };
      this.events.push({ type: 'tagstart', it: m.it, itName: this._nameOf(m.it), me: m.it === this.net.id });
      this._retag();
      return;
    }
    if (t.left > 0 && m.s > t.s) this._setIt(m.it, m.from || null, m.s);
  }
  // every frame: count time as "it", and if you're it, tag anyone you touch on the snow
  updateTag(dt, rider, mode) {
    const t = this.tag;
    if (!t) return;
    if (t.left <= 0) {
      // round over: give everyone's final "time as IT" a moment to arrive, then post the results
      if (t.endT > 0 && (t.endT -= dt) <= 0) {
        // each rider counts their own time as IT (so everyone sees the same numbers)
        const ids = new Set([this.net.id, ...this.net.players.map(p => p.id)]);
        const rows = [...ids].map(id => ({ id, name: this._nameOf(id), secs: id === this.net.id ? (t.times[id] || 0) : (t.reported[id] ?? t.times[id] ?? 0), me: id === this.net.id })).sort((a, b) => a.secs - b.secs || (a.id < b.id ? -1 : 1));
        this.events.push({ type: 'tagend', rows });
      }
      return;
    }
    t.left -= dt; t.noBackT = Math.max(0, t.noBackT - dt);
    t.times[t.it] = (t.times[t.it] || 0) + dt;
    if (t.left <= 0) { this.endedG = t.g; t.endT = 1.5; this._retag(); return; }
    if (t.it !== this.net.id || mode !== 'run' || !ON_SNOW.has(rider.state)) return;
    for (const f of this.friends.values()) {
      if (f.off || !f.snaps.length || !ON_SNOW.has(f.rider.state)) continue;
      if (f.id === t.from && t.noBackT > 0) continue;       // no tag-backs right away
      const p = f.rider.root.position, d = Math.hypot(p.x - rider.pos.x, p.z - rider.pos.z);
      if (d < TAG_RANGE && Math.abs(p.y - rider.pos.y) < 2.2) { this._setIt(f.id, this.net.id, t.s + 1, true); return; }
    }
  }
  // the nearest friend on the mountain: { name, d, f }
  nearest(pos, onlyId = null) {
    let best = null;
    for (const f of this.friends.values()) {
      if (f.off || !f.snaps.length || (onlyId && f.id !== onlyId)) continue;
      const p = f.rider.root.position, d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (!best || d < best.d) best = { name: f.name, d, f };
    }
    return best;
  }
  // shove a friend: their own game decides whether they go down
  shoveFriend(f, nx, nz, name) { this.net.send('shove', { to: f.id, n: name, nx, nz }); }

  // every frame: send our own rider (when we're out on the mountain)
  send(dt, rider, mode, name) {
    if (!this.active) return;
    this.sendT += dt;
    if (this.sendT < 1 / SEND_HZ) return;
    this.sendT = 0;
    const out = mode === 'run' || mode === 'lift' || mode === 'liftwait' || mode === 'heli';
    const t = this.tag, tg = t && (t.left > 0 || t.endT > 0) ? { g: t.g, it: t.it, s: t.s, left: +Math.max(0, t.left).toFixed(1), from: t.from, mine: +(t.times[this.net.id] || 0).toFixed(1) } : undefined;
    if (!out) { this.net.send('rs', { id: this.net.id, n: name, off: 1, tg }); return; }
    const p = rider.root.position, q = rider.root.quaternion;
    this.net.send('rs', { id: this.net.id, n: name, p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], q: [+q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3), +q.w.toFixed(3)],
      s: Math.max(0, STATES.indexOf(rider.state)), c: +rider.crouch.toFixed(2), l: +rider.lean.toFixed(2), k: rider.sport === 'ski' ? 1 : 0, ch: rider.chute ? 1 : 0, g: rider.regular ? 1 : 0, tg,
      v: rider.shoveT > 0.2 && rider.shoveDir ? [+rider.shoveDir.x.toFixed(2), +rider.shoveDir.z.toFixed(2)] : undefined });
  }

  _receive(m) {
    const f = this._friend(m.id, m.n);
    if (m.n && m.n !== f.name) this._setName(f, m.n);
    if (m.tg) { this._tagMsg(m.tg); if (this.tag && this.tag.g === m.tg.g) this.tag.reported[m.id] = m.tg.mine; }
    if (m.v && !(f.rider.shoveT > 0.05)) { f.rider.shoveT = 0.35; f.rider.shoveDir = new THREE.Vector3(m.v[0], 0, m.v[1]); }
    if (m.off) { f.off = true; f.rider.root.visible = false; f.snaps.length = 0; return; }
    f.off = false;
    f.snaps.push({ t: performance.now() / 1000, p: new THREE.Vector3(...m.p), q: new THREE.Quaternion(...m.q), st: STATES[m.s] || 'ride', c: m.c, l: m.l, ski: m.k, chute: m.ch, reg: m.g });
    if (f.snaps.length > 30) f.snaps.shift();
  }

  // draw everyone, slightly in the past, between two updates
  update(dt) {
    const at = performance.now() / 1000 - DELAY;
    for (const f of this.friends.values()) {
      const S = f.snaps;
      if (f.off || !S.length) continue;
      let i = S.length - 1;
      while (i > 0 && S[i - 1].t > at) i--;
      const b = S[i], a = S[Math.max(0, i - 1)], u = b.t > a.t ? Math.max(0, Math.min(1.2, (at - a.t) / (b.t - a.t))) : 1;
      const r = f.rider;
      if ((b.ski === 1) !== (r.sport === 'ski')) r.setSport(b.ski ? 'ski' : 'board');
      if (!!b.reg !== r.regular) r.setStance(!!b.reg);
      r.root.position.lerpVectors(a.p, b.p, u); r.root.quaternion.slerpQuaternions(a.q, b.q, Math.min(1, u));
      r.pos.copy(r.root.position); r.crouch = b.c; r.lean = b.l;
      if (r.state !== b.st) { r.state = b.st; if (b.st === 'crash') r.getupT = -1; if (b.st === 'lift') r.sitE = 1; }
      r.root.visible = true;
      r.renderRemote(dt, { chute: !!b.chute });
    }
  }

  // friends' spots for the trail map: [{ x, z, name, color }]
  mapDots() { return [...this.friends.values()].filter(f => !f.off && f.snaps.length).map(f => { const p = f.rider.root.position; return { x: p.x, z: p.z, name: f.isIt ? `IT · ${f.name}` : f.name, color: f.isIt ? '#e02828' : f.color }; }); }
}
