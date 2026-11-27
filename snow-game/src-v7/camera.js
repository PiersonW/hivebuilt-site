// Chase camera: sits behind the travel direction, swings out to the side in the air.
import * as THREE from 'three';

const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

export class ChaseCam {
  constructor(camera, terrain) {
    this.cam = camera;
    this.terrain = terrain;
    this.dir = new THREE.Vector3(0, 0, -1);
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.swing = 0;      // -1..1 side offset in the air
    this.swingSide = 1;
    this.dist = 6;
    this.height = 2.4;
    this.shake = 0;
    this.off = new THREE.Vector3(0, 2.4, 6);
    this.crashAnchor = new THREE.Vector3();
    this.shift = 0.85;   // m the camera sits to the right of the rider, so you ride a little left of centre
  }

  snap(rider) {
    this.dir.set(Math.sin(rider.yaw), 0, -Math.cos(rider.yaw));
    this.off.copy(this.dir).multiplyScalar(-4.6); this.off.y = 1.9;
    this.off.addScaledVector(new THREE.Vector3(-this.dir.z, 0, this.dir.x), this.shift);
    this.pos.copy(rider.pos).add(this.off);
    this.crashAnchor.copy(rider.pos);
    this.look.copy(rider.pos);
  }

  update(dt, rider) {
    const v = rider.vel;
    const air = rider.state === 'air';
    const crash = rider.state === 'crash';
    const sp = v.length();
    // follow horizontal travel direction (not the board), so spins don't spin the camera
    const h = new THREE.Vector3(v.x, 0, v.z);
    if (h.length() > 1.5 && !crash) {
      h.normalize();
      this.dir.lerp(h, 1 - Math.exp(-(air ? 1.2 : 3.5) * dt)).normalize();
    }
    if (air && rider.airTime < 0.05) this.swingSide = Math.random() < 0.5 ? -1 : 1;
    const wantSwing = air && rider.airTime > 0.15 ? 1 : 0;
    this.swing = damp(this.swing, wantSwing, air ? 1.6 : 3, dt);
    this.dist = damp(this.dist, crash ? 7 : 4.3 + sp * 0.04 + this.swing * 1.5, 2.5, dt);
    this.height = damp(this.height, crash ? 3.2 : 1.85 + this.swing * 0.7, 2.5, dt);

    const side = new THREE.Vector3(-this.dir.z, 0, this.dir.x);
    // smooth the offset from the rider (not the world position) so fast travel doesn't drag the camera back
    const wantOff = new THREE.Vector3()
      .addScaledVector(this.dir, -this.dist)
      .addScaledVector(side, this.swing * this.swingSide * 3.5 + this.shift * (1 - this.swing));
    wantOff.y = this.height;
    if (crash) { this.off.lerp(wantOff, 1 - Math.exp(-1.5 * dt)); }
    else {
      const r = air ? 3 : 6;
      this.off.x = damp(this.off.x, wantOff.x, r, dt);
      this.off.z = damp(this.off.z, wantOff.z, r, dt);
      this.off.y = damp(this.off.y, wantOff.y, air ? 2 : 5, dt);
    }
    this.pos.copy(crash ? this.crashAnchor : rider.pos).add(this.off);
    if (!crash) this.crashAnchor.copy(rider.pos);
    else this.crashAnchor.lerp(rider.pos, 1 - Math.exp(-2 * dt));
    this.pos.y = Math.max(this.pos.y, this.terrain.heightAt(this.pos.x, this.pos.z) + 1.2);

    const lookWant = rider.pos.clone().addScaledVector(this.dir, crash ? 0 : 3.5)
      .addScaledVector(side, this.shift * (1 - this.swing));
    lookWant.y += 0.9;
    this.look.lerp(lookWant, 1 - Math.exp(-12 * dt));

    // small shake on hard landings / speed
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const jitter = this.shake * 0.25 + Math.max(0, sp - 25) * 0.002 * (rider.state === 'ride' ? 1 : 0);
    this.cam.position.copy(this.pos).add(new THREE.Vector3((Math.random() - 0.5) * jitter, (Math.random() - 0.5) * jitter, 0));
    this.cam.lookAt(this.look);
    const fov = 62 + Math.min(16, sp * 0.35);
    if (Math.abs(this.cam.fov - fov) > 0.05) { this.cam.fov = damp(this.cam.fov, fov, 3, dt); this.cam.updateProjectionMatrix(); }
  }
}
