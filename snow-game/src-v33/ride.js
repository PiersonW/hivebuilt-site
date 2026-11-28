// Ride together: friends in the same room (a 4-letter code, see net.js) see each other anywhere on the
// mountain: riding, on the chairlifts, in the helicopter and wingsuit. Each game sends its own rider
// ~12 times a second; everyone else's rider is drawn from those updates (slightly in the past, so smooth),
// with their name floating above their head.
import * as THREE from 'three';
import { Rider } from './rider.js';

const SEND_HZ = 12, DELAY = 0.18;
const STATES = ['ride', 'air', 'crash', 'grind', 'lift', 'fly', 'heli'];
const PAL = [[0xffd23a, 0x23324d, 0xd63030], [0x15b3c4, 0x1d2a44, 0xffffff], [0x8bd94b, 0x2b2b2b, 0x7b4fd6], [0xe0457b, 0x23324d, 0xffd23a], [0xf2f2f2, 0x2b2b2b, 0x2fbf71], [0x7b4fd6, 0x1d2a44, 0xff7a1a]];

export class RideTogether {
  constructor(scene, terrain, net) {
    this.scene = scene; this.T = terrain; this.net = net;
    this.friends = new Map();      // id -> { name, rider, tag, snaps, color }
    this.sendT = 0;
    net.on = (event, m) => { if (event === 'rs') this._receive(m); else if (event === 'bye') this._drop(m.id); };
    net.onPlayers = (list) => {
      const ids = new Set(list.map(p => p.id));
      for (const id of [...this.friends.keys()]) if (!ids.has(id)) this._drop(id);
      for (const p of list) { const f = this.friends.get(p.id); if (f && f.name !== p.name) this._setName(f, p.name); }
      if (this.onChange) this.onChange(list);
    };
  }
  get active() { return this.net.connected; }
  get count() { return this.net.players.length; }

  _friend(id, name) {
    let f = this.friends.get(id);
    if (!f) {
      const k = this.friends.size % PAL.length, r = new Rider(this.scene, this.T); r.npc = true;
      const [jacket, pants, helmet] = PAL[k];
      r.mats.jacket.color.setHex(jacket); r.mats.pants.color.setHex(pants); r.mats.helmet.color.setHex(helmet);
      r.mats.board.color.setHex(helmet); r.mats.boardTop.color.setHex(helmet).lerp(new THREE.Color(1, 1, 1), 0.55);
      r.root.visible = false;
      f = { id, name: '', rider: r, snaps: [], color: '#' + jacket.toString(16).padStart(6, '0') };
      this._setName(f, name || 'Friend');
      this.friends.set(id, f);
    }
    return f;
  }
  // a name tag that always faces the camera, floating over their helmet
  _setName(f, name) {
    f.name = name;
    if (f.tag) { f.rider.root.remove(f.tag); f.tag.material.map.dispose(); f.tag.material.dispose(); }
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(10,25,50,0.75)'; g.beginPath(); g.roundRect(4, 8, 248, 48, 22); g.fill();
    g.fillStyle = f.color; g.beginPath(); g.arc(30, 32, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 28px Trebuchet MS, sans-serif'; g.textBaseline = 'middle'; g.fillText(name.slice(0, 12), 50, 33);
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
  clear() { for (const id of [...this.friends.keys()]) this._drop(id); }

  // every frame: send our own rider (when we're out on the mountain)
  send(dt, rider, mode, name) {
    if (!this.active) return;
    this.sendT += dt;
    if (this.sendT < 1 / SEND_HZ) return;
    this.sendT = 0;
    const out = mode === 'run' || mode === 'lift' || mode === 'liftwait' || mode === 'heli';
    if (!out) { this.net.send('rs', { id: this.net.id, n: name, off: 1 }); return; }
    const p = rider.root.position, q = rider.root.quaternion;
    this.net.send('rs', { id: this.net.id, n: name, p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], q: [+q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3), +q.w.toFixed(3)],
      s: Math.max(0, STATES.indexOf(rider.state)), c: +rider.crouch.toFixed(2), l: +rider.lean.toFixed(2), k: rider.sport === 'ski' ? 1 : 0, ch: rider.chute ? 1 : 0, g: rider.regular ? 1 : 0 });
  }

  _receive(m) {
    const f = this._friend(m.id, m.n);
    if (m.n && m.n !== f.name) this._setName(f, m.n);
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
  mapDots() { return [...this.friends.values()].filter(f => !f.off && f.snaps.length).map(f => { const p = f.rider.root.position; return { x: p.x, z: p.z, name: f.name, color: f.color }; }); }
}
