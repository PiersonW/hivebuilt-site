// The menu's lobby: you and everyone in your friends room stand side by side at the summit, each in
// their own character, with their name and what they're up to floating above them. The camera frames
// the whole group (closer when you're on your own).
import * as THREE from 'three';
import { Rider } from './rider.js';
import { applyLook, charOf } from './characters.js';

const GAP = 1.7;               // metres between riders in the line
const SLOTS = 6;

export class Lobby {
  constructor(scene, terrain, camera) {
    this.scene = scene; this.T = terrain; this.camera = camera;
    const sp = terrain.spawnPoint();
    this.center = new THREE.Vector3(sp.x, 0, sp.z + 4);
    this.face = new THREE.Vector3(0, 0, 1);               // the line looks this way (toward the camera)
    this.side = new THREE.Vector3(1, 0, 0);
    this.mates = [];                                       // stand-in riders for your friends
    this.tagsEl = document.getElementById('lb-tags');
    this.tags = [];
    this.dist = 5; this.t = 0;
    this.active = false;
  }

  // spot k in the line, centre out: you in the middle, then right, left, right...
  _spot(k, n) {
    const order = [0, 1, -1, 2, -2, 3];
    const firstOff = n % 2 === 0 ? -0.5 : 0;     // even groups sit evenly around the centre
    const off = (order[k] + firstOff) * GAP;
    const p = this.center.clone().addScaledVector(this.side, off);
    p.y = this.T.heightAt(p.x, p.z);
    return p;
  }
  // stand a rider facing the camera
  _stand(r, p) {
    const toCam = Math.atan2(this.face.x, -this.face.z);
    // a snowboarder stands sideways on the board: turn the board across so they face us
    const yaw = r.sport === 'ski' ? toCam : toCam + (r.regular ? -Math.PI / 2 : Math.PI / 2);
    r.reset(p, yaw);
    r.vel.set(0, 0, 0);
  }

  _mate(k) {
    if (!this.mates[k]) {
      const r = new Rider(this.scene, this.T); r.npc = true; r.root.visible = false;
      this.mates[k] = r;
    }
    return this.mates[k];
  }
  _tag(k) {
    if (!this.tags[k]) { const el = document.createElement('div'); el.className = 'lb-tag'; this.tagsEl.appendChild(el); this.tags[k] = el; }
    return this.tags[k];
  }

  show(me) { this.active = true; this.me = me; this.n = 0; this.tagsEl.classList.remove('hidden'); }
  hide() {
    this.active = false;
    for (const r of this.mates) if (r) r.root.visible = false;
    this.tagsEl.classList.add('hidden');
  }

  // party: [{ id, name, char, sport, regular, status }] (not including you). meInfo: { name, char }
  update(dt, rider, meInfo, party) {
    if (!this.active) return;
    this.t += dt;
    const list = party.slice(0, SLOTS - 1), n = list.length + 1;
    // you
    const p0 = this._spot(0, n);
    if (rider.pos.distanceToSquared(p0) > 0.01 || this._meKey !== rider.sport + rider.regular) { this._stand(rider, p0); this._meKey = rider.sport + rider.regular; }
    rider.updateVisual(dt, {});
    // friends
    for (let k = 0; k < SLOTS - 1; k++) {
      const r = this._mate(k), f = list[k];
      if (!f) { r.root.visible = false; continue; }
      applyLook(r, f.char);
      if ((f.sport === 'ski') !== (r.sport === 'ski')) r.setSport(f.sport === 'ski' ? 'ski' : 'board');
      if (f.regular !== undefined && !!f.regular !== r.regular) r.setStance(!!f.regular);
      const p = this._spot(k + 1, n), key = `${p.x.toFixed(2)},${p.z.toFixed(2)},${r.sport},${r.regular}`;
      if (r._lobbyKey !== key) { this._stand(r, p); r._lobbyKey = key; }
      r.root.visible = true;
      r.updateVisual(dt, {});
    }
    // camera: in front of the line, framing everyone (a touch above eye level, gently drifting)
    const span = (n - 1) * GAP + 1.6;
    const want = n === 1 ? 3.5 : Math.max(4.4, span * 1.05 + 1.8);
    this.dist += (want - this.dist) * Math.min(1, dt * 2.5);
    const sway = Math.sin(this.t * 0.25) * 0.35;
    const mid = this.center.clone(); mid.y = this.T.heightAt(mid.x, mid.z);
    // (aim a little to the left of the group so it sits right of centre, clear of the menu on the left)
    const shift = -this.dist * 0.2 * (window.innerWidth > 760 ? 1 : 0.7);
    const cam = mid.clone().addScaledVector(this.face, this.dist).addScaledVector(this.side, sway + shift);
    cam.y = mid.y + 1.35 + this.dist * 0.06;
    this.camera.position.copy(cam);
    const look = mid.clone().addScaledVector(this.side, shift); look.y = mid.y + 1.0;
    this.camera.lookAt(look);
    // name tags over everyone's heads
    const W = window.innerWidth, H = window.innerHeight, v = new THREE.Vector3();
    const people = [{ r: rider, name: meInfo.name, char: meInfo.char, status: 'You', me: true }, ...list.map((f, k) => ({ r: this.mates[k], ...f }))];
    for (let k = 0; k < SLOTS; k++) {
      const el = this._tag(k), who = people[k];
      if (!who) { el.style.display = 'none'; continue; }
      v.copy(who.r.root.position); v.y += 2.0; v.project(this.camera);
      if (v.z > 1) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2 * W).toFixed(0)}px, ${((1 - v.y) / 2 * H).toFixed(0)}px)`;
      const html = `<b>${esc(who.name)}</b><span>${charOf(who.char).name}${who.status && !who.me ? ' · ' + esc(who.status) : ''}</span>`;
      if (el._html !== html) { el.innerHTML = html; el._html = html; }
      el.classList.toggle('me', !!who.me);
    }
  }
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
