// Run recording (ring buffer), the 3 best tricks as highlights, and highlight playback.
import * as THREE from 'three';

export const REC_HZ = 30;
const F = 17;               // floats per frame
const RING = REC_HZ * 240;  // 4 minutes
const GRABS = [null, 'Indy', 'Melon', 'Method', 'Nose Grab'];
const STATES = ['ride', 'air', 'crash', 'grind'];
const PRE = 1.2, POST = 1.2; // seconds kept before takeoff and after landing

export class Recorder {
  constructor() {
    this.buf = new Float32Array(RING * F);
    this.reset();
  }

  reset() {
    this.count = 0; this.acc = 0;
    this.takeoffFrame = 0;
    this.pending = [];
    this.highlights = [];   // best first, max 3
  }

  // Call every frame while riding.
  record(dt, rider) {
    this.acc += dt;
    while (this.acc >= 1 / REC_HZ) {
      this.acc -= 1 / REC_HZ;
      const o = (this.count % RING) * F, b = this.buf, q = rider.root.quaternion;
      b[o] = rider.pos.x; b[o + 1] = rider.pos.y; b[o + 2] = rider.pos.z;
      b[o + 3] = q.x; b[o + 4] = q.y; b[o + 5] = q.z; b[o + 6] = q.w;
      b[o + 7] = rider.crouch; b[o + 8] = rider.lean;
      b[o + 9] = rider.state === 'air' ? Math.max(0, GRABS.indexOf(rider.grab)) : 0;
      b[o + 10] = rider.phantomT;
      b[o + 11] = Math.max(0, STATES.indexOf(rider.state));
      b[o + 12] = rider.switch ? 1 : 0; b[o + 13] = rider.brakeAmt; b[o + 14] = rider.regular ? 1 : 0;
      b[o + 15] = rider.speed;
      b[o + 16] = rider.boardslide || 0;
      this.count++;
      this._finishPending(false);
    }
  }

  onTakeoff() { this.takeoffFrame = this.count; }

  // A landed trick worth keeping. Frames after the landing are added as they are recorded.
  onTrick(name, points) {
    const start = Math.max(0, this.takeoffFrame - Math.round(PRE * REC_HZ), this.count - RING + 1);
    this.pending.push({ name, points, start, end: this.count + Math.round(POST * REC_HZ) });
  }

  // Close out highlights (force = end of run).
  _finishPending(force) {
    this.pending = this.pending.filter(h => {
      if (!force && this.count < h.end) return true;
      const end = Math.min(h.end, this.count);
      const n = end - h.start;
      if (n < 2) return false;
      const frames = new Float32Array(n * F);
      for (let i = 0; i < n; i++) frames.set(this.buf.subarray(((h.start + i) % RING) * F, ((h.start + i) % RING) * F + F), i * F);
      this.highlights.push({ name: h.name, points: h.points, frames, n, sport: this.sport || 'board' });
      this.highlights.sort((a, b) => b.points - a.points);
      this.highlights.length = Math.min(3, this.highlights.length);
      return false;
    });
  }

  finishRun() { this._finishPending(true); }
}

// Plays a highlight on a separate rider model.
export class Replayer {
  constructor(ghost) {
    this.ghost = ghost;        // a Rider used only for its model
    this.ghost.root.visible = false;
    this.h = null;
    this.t = 0;
    this.slow = false;
    this.camMode = 'orbit';    // orbit | follow
    this.yaw = 0; this.pitch = -0.25; this.dist = 7;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
  }

  start(h) {
    this.h = h; this.t = 0;
    this.ghost.root.visible = true;
    this.ghost.regular = h.frames[14] === 1;
    this.ghost.setSport(h.sport || 'board');
    this.ghost.setStance(this.ghost.regular);
    this._apply(0, 1 / 30);
    this.yaw = Math.atan2(-this.vel.x, -this.vel.z) + 2.4;
  }

  stop() { this.h = null; this.ghost.root.visible = false; }

  get active() { return !!this.h; }
  get duration() { return this.h ? (this.h.n - 1) / REC_HZ : 0; }

  update(dt) {
    if (!this.h) return;
    const rate = this.slow ? 0.3 : 1;
    this.t += dt * rate;
    if (this.t > this.duration + 0.6) this.t = 0;     // loop with a short hold at the end
    this._apply(Math.min(this.t, this.duration), dt * rate);
  }

  _apply(t, dt) {
    const fr = this.h.frames, n = this.h.n;
    const x = t * REC_HZ, i = Math.min(n - 2, Math.floor(x)), a = x - i;
    const A = i * F, B = (i + 1) * F;
    const lerp = (k) => fr[A + k] + (fr[B + k] - fr[A + k]) * a;
    const g = this.ghost;
    this.vel.set(fr[B] - fr[A], fr[B + 1] - fr[A + 1], fr[B + 2] - fr[A + 2]).multiplyScalar(REC_HZ);
    this.pos.set(lerp(0), lerp(1), lerp(2));
    g.pos.copy(this.pos);
    g.root.position.copy(this.pos);
    const qa = new THREE.Quaternion(fr[A + 3], fr[A + 4], fr[A + 5], fr[A + 6]);
    const qb = new THREE.Quaternion(fr[B + 3], fr[B + 4], fr[B + 5], fr[B + 6]);
    g.root.quaternion.copy(qa.slerp(qb, a));
    const near = a < 0.5 ? A : B;
    g.crouch = lerp(7); g.lean = lerp(8);
    g.state = STATES[fr[near + 11]] || 'ride';
    g.grab = GRABS[fr[near + 9]] || null;
    g.phantomT = fr[A + 10] >= 0 && fr[B + 10] >= 0 ? lerp(10) : fr[near + 10];
    g.switch = fr[near + 12] === 1; g.brakeAmt = lerp(13); g.boardslide = fr[near + 16];
    g._updatePose(Math.max(dt, 1 / 240), {});
  }

  // Camera for the replay. look = {x, y} from mouse / right stick.
  updateCamera(camera, dt, look, terrain) {
    const target = this.pos.clone(); target.y += 0.9;
    let want;
    if (this.camMode === 'orbit') {
      this.yaw -= look.x * 2.5 * dt; this.pitch = Math.max(-1.3, Math.min(0.4, this.pitch - look.y * 2 * dt));
      if (!look.x && !look.y) this.yaw += 0.25 * dt;   // slow drift so it feels alive
      want = target.clone().add(new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(this.dist));
    } else {
      const d = new THREE.Vector3(this.vel.x, 0, this.vel.z);
      if (d.lengthSq() < 0.5) d.set(0, 0, -1);
      d.normalize();
      want = target.clone().addScaledVector(d, -6.5); want.y += 2;
    }
    want.y = Math.max(want.y, terrain.heightAt(want.x, want.z) + 0.8);
    camera.position.lerp(want, this.camMode === 'orbit' ? 1 : 1 - Math.exp(-6 * dt));
    camera.lookAt(target);
  }
}
