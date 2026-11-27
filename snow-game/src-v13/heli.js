// The helicopter that drops you at the start: hovers high over the mountain with the door open,
// then peels away once you jump.
import * as THREE from 'three';

export class Helicopter {
  constructor(scene) {
    const g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: 0xd8362b, roughness: 0.45, metalness: 0.2, flatShading: true });
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5, flatShading: true });
    const glass = new THREE.MeshStandardMaterial({ color: 0x1d2b3a, roughness: 0.1, metalness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.6 });
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; parent.add(m); return m; };
    // cabin (nose toward -z), with an open door on the right (+x) side
    add(new THREE.BoxGeometry(2.4, 2.2, 4.6), paint, 0, 0, 0);
    add(new THREE.CylinderGeometry(1.2, 1.2, 2.4, 10, 1, false, 0, Math.PI), paint, 0, 0, -2.3, 0, 0, Math.PI / 2);
    add(new THREE.BoxGeometry(2.3, 1.0, 1.6), glass, 0, 0.35, -2.7, -0.35);
    add(new THREE.BoxGeometry(0.05, 1.6, 1.8), dark, 1.21, 0, 0.2);            // open doorways, both sides
    add(new THREE.BoxGeometry(0.05, 1.6, 1.8), dark, -1.21, 0, 0.2);
    add(new THREE.BoxGeometry(2.42, 0.25, 4.62), white, 0, -0.6, 0);            // stripe
    // tail boom, fin and tail rotor
    add(new THREE.BoxGeometry(0.55, 0.6, 6.5), paint, 0, 0.45, 5.4);
    add(new THREE.BoxGeometry(0.15, 1.8, 1.1), paint, 0, 1.2, 8.4);
    this.tailRotor = add(new THREE.BoxGeometry(0.06, 1.6, 0.2), dark, 0.25, 1.2, 8.4);
    // skids
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.12, 0.12, 4.6), dark, s * 1.15, -1.75, 0.1);
      for (const z of [-1.2, 1.3]) add(new THREE.BoxGeometry(0.08, 0.7, 0.08), dark, s * 1.05, -1.4, z, 0, 0, s * 0.25);
    }
    // main rotor
    add(new THREE.CylinderGeometry(0.25, 0.3, 0.6, 8), dark, 0, 1.35, 0);
    this.rotor = new THREE.Group(); this.rotor.position.set(0, 1.7, 0); g.add(this.rotor);
    for (const a of [0, Math.PI / 2]) add(new THREE.BoxGeometry(11, 0.06, 0.4), dark, 0, 0, 0, 0, a, 0, this.rotor);
    this.group = g;
    g.visible = false;
    scene.add(g);
    this.t = 0;
    this.leaving = 0;
    this.vel = new THREE.Vector3();
  }

  // Hover at `pos`, nose pointing along `yaw` (0 = downhill, -z).
  hover(pos, yaw) {
    this.home = pos.clone(); this.yaw = yaw;
    this.group.position.copy(pos);
    this.group.rotation.set(0, -yaw, 0);
    this.group.visible = true;
    this.leaving = 0; this.vel.set(0, 0, 0);
  }

  // Fly back and forth across the top of the mountain on its own: between two points, turning round
  // gently at each end, holding a steady height over the ridge.
  patrol(terrain, a, b, pos) {
    this.terrain = terrain; this.route = [a, b]; this.leg = 1; this.speed = 17;
    this.home = null; this.leaving = 0; this.vel.set(0, 0, 0);
    this.group.position.copy(pos);
    this.yaw = Math.atan2(b.x - pos.x, -(b.z - pos.z));
    this.group.rotation.set(0, -this.yaw, 0, 'YXZ');
    this.group.visible = true; this.bank = 0;
  }

  // The doorway on the downhill side (where you stand) and its outward direction.
  door() {
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const side = right.z < 0 ? 1 : -1;            // whichever side faces down the mountain
    this.group.updateMatrixWorld();
    return { pos: this.group.localToWorld(new THREE.Vector3(side * 1.35, -1.75, 0.2)), out: right.multiplyScalar(side), side };
  }

  doorPoint() { return this.door().pos; }

  leave() { this.leaving = 0.001; this.route = null; }

  hide() { this.group.visible = false; this.leaving = 0; this.route = null; }

  update(dt) {
    if (!this.group.visible) return;
    this.t += dt;
    this.rotor.rotation.y += dt * 28;
    this.tailRotor.rotation.x += dt * 40;
    if (this.leaving > 0) {
      // bank away and climb out
      this.leaving += dt;
      if (this.leaving > 1.5) this.yaw -= dt * 0.35;        // swing round to the left, away from you
      const f = new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.vel.lerp(f.multiplyScalar(this.leaving > 1.5 ? 16 : 2).setY(this.leaving > 1.5 ? 6 : 1), 1 - Math.exp(-0.7 * dt));
      this.group.position.addScaledVector(this.vel, dt);
      this.group.rotation.set(-Math.min(0.2, this.leaving * 0.06), -this.yaw, Math.min(0.3, Math.max(0, this.leaving - 1.5) * 0.15), 'YXZ');
      if (this.leaving > 14) this.hide();
    } else if (this.route) {
      const T = this.terrain, p = this.group.position, tgt = this.route[this.leg];
      if (Math.hypot(tgt.x - p.x, tgt.z - p.z) < 40) this.leg = 1 - this.leg;
      const want = Math.atan2(tgt.x - p.x, -(tgt.z - p.z));
      let d = want - this.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      const turn = Math.max(-0.45, Math.min(0.45, d * 1.2));
      this.yaw += turn * dt;
      this.bank += (turn * 0.5 - this.bank) * Math.min(1, dt * 2);
      const f = new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      p.addScaledVector(f, this.speed * dt);
      // hold ~140 m over the highest snow just below and ahead (room for a long wingsuit flight)
      let ground = -Infinity;
      for (const k of [0, 25, 50, 80]) ground = Math.max(ground, T.heightAt(p.x + f.x * k, p.z + f.z * k));
      p.y += (ground + 140 - p.y) * Math.min(1, dt * 0.6) + Math.sin(this.t * 1.3) * 0.01;
      this.vel.copy(f).multiplyScalar(this.speed);
      this.group.rotation.set(0.06, -this.yaw, -this.bank, 'YXZ');      // nose a touch down, banking in turns
    } else if (this.home) {
      // gentle hover bob
      this.group.position.y = this.home.y + Math.sin(this.t * 1.3) * 0.25;
      this.group.rotation.z = Math.sin(this.t * 0.9) * 0.02;
    }
  }
}
