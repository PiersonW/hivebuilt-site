// Rider: a simple primitive-built snowboarder plus the board physics.
import * as THREE from 'three';

const G = 9.81;
const UP = new THREE.Vector3(0, 1, 0);

// ---- tuning (all the "feel" numbers live here) ----
export const TUNE = {
  turnRate: 2.5,          // rad/s at low speed
  turnRateFast: 1.45,     // rad/s at top speed
  tuckTurnMul: 0.55,      // tuck lowers turn grip
  grip: 8.5,              // how fast sideways slide is killed (carve)
  tuckGrip: 5.0,
  brakeGrip: 2.2,
  carveKeep: 0.72,        // share of sideways speed turned into forward speed while carving
  snowFriction: 0.045,
  drag: 0.0082,           // normal stance air drag (v^2)
  tuckDrag: 0.0047,
  standDrag: 0.02,
  brakeDecel: 11,
  jumpBase: 3.6,          // m/s pop with no charge
  jumpCharge: 3.6,        // extra pop at full charge
  chargeTime: 0.55,
  spinRate: 7.6,          // rad/s in the air
  flipRate: 7.2,
  landSpinTol: 0.75,      // rad (~43 deg) off the travel line and you crash
  landFlipTol: 0.95,      // rad (~55 deg) off upright and you crash
  phantomTime: 0.75,
  airGravity: 0.85,       // a little floaty in the air (arcade)
  maxLaunch: 7.5,         // m/s off a kicker, measured away from the landing slope
  maxSpeed: 26.5,         // m/s (~59 mph): above this the snow starts holding you back
  topSpeed: 65 / 2.237,   // hard cap: 65 mph
  crashTime: 2.2,
  crashFriction: 9,       // m/s^2 slowing while tumbling
  crashMaxSpeed: 14,      // m/s, tumble speed right after a crash
};

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const headingOf = (v) => Math.atan2(v.x, -v.z);

// Place a unit-tall box between two points.
function placeLimb(mesh, a, b, scaleXZ = 1) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length() || 1e-4;
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / len));
  mesh.scale.set(scaleXZ, len, scaleXZ);
}

// Two-bone IK: returns middle joint (knee/elbow). Stretches when out of reach.
function ik(a, c, l1, l2, pole) {
  const ac = new THREE.Vector3().subVectors(c, a);
  let d = ac.length();
  const reach = (l1 + l2) * 0.999;
  if (d > reach) { const k = d / reach; l1 *= k; l2 *= k; }
  d = Math.max(d, 1e-4);
  const dir = ac.clone().multiplyScalar(1 / d);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const p = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  return a.clone().addScaledVector(dir, x).addScaledVector(p, h);
}

export class Rider {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 1, 0);
    this.yaw = 0;               // travel heading (board nose when not switch)
    this.switch = false;
    this.regular = true;
    this.state = 'ride';        // ride | air | crash
    this.crouch = 0;
    this.charge = 0;
    this.lean = 0;
    this.brakeAmt = 0;
    this.airYaw = 0; this.flip = 0; this.flipVel = 0; this.spinVel = 0;
    this.flipAxis = new THREE.Vector3(1, 0, 0);
    this.grab = null;           // current grab name
    this.phantomT = -1;         // <0 = not doing it
    this.crashT = 0;
    this.airTime = 0;
    this.topSpeed = 0;
    this.events = [];           // 'takeoff', 'land', 'crash', 'respawn' for main/tricks
    this.alignQ = new THREE.Quaternion();
    this.crashSpin = new THREE.Vector3();
    this.crashQ = new THREE.Quaternion();
    this.spray = 0;
    this._buildModel();
  }

  // ---------------- model ----------------
  _buildModel() {
    const flat = (c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.75 });
    this.mats = { jacket: flat(0xff6a2b), pants: flat(0x23324d), skin: flat(0xf0c39a), helmet: flat(0x1e8fd6), board: flat(0x1b1b22), boardTop: flat(0xffd23a), glove: flat(0x222222) };
    const box = new THREE.BoxGeometry(1, 1, 1);
    const root = new THREE.Group();
    this.root = root;

    // board (length along z, nose at -z)
    this.boardG = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.04, 1.5), this.mats.board);
    deck.position.y = 0.03;
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.012, 1.3), this.mats.boardTop);
    top.position.y = 0.056;
    // turned-up nose and tail
    const tip = new THREE.BoxGeometry(0.29, 0.04, 0.22);
    const nose = new THREE.Mesh(tip, this.mats.board); nose.position.set(0, 0.07, -0.82); nose.rotation.x = 0.45;
    const tail = new THREE.Mesh(tip, this.mats.board); tail.position.set(0, 0.07, 0.82); tail.rotation.x = -0.45;
    for (const m of [deck, top, nose, tail]) { m.castShadow = true; this.boardG.add(m); }
    root.add(this.boardG);

    // body (faces +z in its own frame; rotated so it stands sideways on the board)
    this.body = new THREE.Group();
    root.add(this.body);
    const mk = (mat, sxz = 1) => { const m = new THREE.Mesh(box, mat); m.castShadow = true; this.body.add(m); m.userData.sxz = sxz; return m; };
    this.thighs = [mk(this.mats.pants), mk(this.mats.pants)];
    this.shins = [mk(this.mats.pants), mk(this.mats.pants)];
    this.boots = [mk(this.mats.glove), mk(this.mats.glove)];
    this.torso = mk(this.mats.jacket);
    this.upperArms = [mk(this.mats.jacket), mk(this.mats.jacket)];
    this.foreArms = [mk(this.mats.jacket), mk(this.mats.jacket)];
    this.hands = [mk(this.mats.glove), mk(this.mats.glove)];
    this.head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), this.mats.skin); this.head.castShadow = true; this.body.add(this.head);
    this.helmet = new THREE.Mesh(new THREE.SphereGeometry(0.165, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.55), this.mats.helmet);
    this.helmet.castShadow = true; this.body.add(this.helmet);
    this.goggles = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.06), flat(0x30e0c0)); this.body.add(this.goggles);

    this.handPos = [new THREE.Vector3(0.5, 0.9, 0.1), new THREE.Vector3(-0.5, 0.9, 0.1)];
    this.pose = { hipH: 0.92, lean: 0.15, boardLift: 0, boardRX: 0, boardRZ: 0, feetLift: 0 };
    this.scene.add(root);
  }

  setStance(regular) {
    this.regular = regular;
    this.body.rotation.y = regular ? Math.PI / 2 : -Math.PI / 2;
  }

  // Board-local point -> body-local point.
  _boardToBody(v, phantom) {
    const p = v.clone();
    if (!phantom) p.applyMatrix4(this.boardG.matrix);
    else p.y += this.pose.feetLift;
    return p.applyMatrix4(this._bodyInv);
  }

  _updatePose(dt, input) {
    const P = this.pose;
    const sig = this.regular ? 1 : -1;          // toe edge side in board frame (+x for regular)
    const grab = this.state === 'air' ? this.grab : null;
    const crashing = this.state === 'crash';
    const phantom = this.phantomT >= 0;

    // targets
    let hipH = 0.92 - 0.32 * this.crouch, lean = 0.15 + 0.35 * this.crouch;
    let boardLift = 0, rx = 0, rz = 0, feetLift = 0;
    if (this.state === 'air') { hipH = 0.78; lean = 0.35; }
    if (grab) { hipH = 0.8; lean = 0.85; boardLift = 0.42; }
    if (grab === 'Nose Grab') { rx = 0.35; lean = 0.95; }
    if (grab === 'Method') { rz = -sig * 0.75; boardLift = 0.6; lean = 0.55; }
    if (grab === 'Melon') { rz = sig * 0.25; }
    if (phantom) { hipH = 0.85; lean = 0.25; feetLift = 0.35; }
    if (crashing) { hipH = 0.95; lean = -0.2; }
    const seated = this.state === 'lift';
    if (seated) { hipH = 0.5; lean = -0.12; }
    const r = 16;
    P.hipH = damp(P.hipH, hipH, r, dt); P.lean = damp(P.lean, lean, r, dt);
    P.boardLift = damp(P.boardLift, boardLift, r, dt); P.boardRX = damp(P.boardRX, rx, r, dt);
    P.boardRZ = damp(P.boardRZ, rz, r, dt); P.feetLift = damp(P.feetLift, feetLift, r, dt);

    // board transform
    const bg = this.boardG;
    bg.position.set(0, P.boardLift, 0);
    bg.rotation.set(P.boardRX, 0, P.boardRZ);
    if (seated) {
      // board hangs off the feet in front of the seat
      const v = new THREE.Vector3(0, 0.02, 0.45).applyAxisAngle(UP, this.body.rotation.y);
      bg.position.copy(v);
      bg.rotation.set(0, 0, 0);
    }
    if (phantom) {
      const t = this.phantomT;
      bg.position.y = P.feetLift - 0.85 * Math.sin(Math.PI * t);
      bg.rotation.set(0, 2 * Math.PI * t * sig, 2 * Math.PI * t * sig);
    }
    bg.updateMatrix();
    this.body.updateMatrix();
    this._bodyInv = this.body.matrix.clone().invert();

    // feet on the bindings
    const bind = [new THREE.Vector3(0, 0.07, -0.27), new THREE.Vector3(0, 0.07, 0.27)].map(v => this._boardToBody(v, phantom));
    bind.sort((a, b) => b.x - a.x); // index 0 = body +x side
    const lean2 = P.lean;
    const hipC = new THREE.Vector3(0, P.hipH + (phantom ? P.feetLift : 0) + P.boardLift * 0.6, -0.06 - 0.1 * lean2);
    this.hipC = hipC;
    const fwd = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const hip = hipC.clone().add(new THREE.Vector3(side * 0.12, 0, 0));
      const foot = bind[i];
      const knee = ik(hip, foot, 0.46, 0.46, fwd.clone().add(new THREE.Vector3(side * 0.3, 0, 0)));
      placeLimb(this.thighs[i], hip, knee, 0.15);
      placeLimb(this.shins[i], knee, foot, 0.13);
      this.boots[i].position.copy(foot).add(new THREE.Vector3(0, 0.03, 0.03));
      this.boots[i].scale.set(0.14, 0.1, 0.26);
      this.boots[i].quaternion.identity();
    }
    // torso
    const neck = hipC.clone().add(new THREE.Vector3(0, Math.cos(lean2) * 0.58, Math.sin(lean2) * 0.58));
    placeLimb(this.torso, hipC, neck, 0.34);
    this.torso.scale.z = 0.22;
    const headDir = neck.clone().sub(hipC).normalize();
    this.head.position.copy(neck).addScaledVector(headDir, 0.16);
    this.helmet.position.copy(this.head.position).addScaledVector(headDir, 0.02);
    this.helmet.quaternion.setFromUnitVectors(UP, headDir);
    this.goggles.position.copy(this.head.position).add(new THREE.Vector3(0, 0.02, 0.13));
    this.goggles.quaternion.copy(this.helmet.quaternion);

    // hands
    const sh = [neck.clone().add(new THREE.Vector3(0.21, -0.06, 0)), neck.clone().add(new THREE.Vector3(-0.21, -0.06, 0))];
    const lead = sig > 0 ? 0 : 1; // regular: body +x is the nose side
    const t = [
      sh[0].clone().add(new THREE.Vector3(0.38, -0.32 + 0.1 * this.crouch, 0.12)),
      sh[1].clone().add(new THREE.Vector3(-0.38, -0.32 + 0.1 * this.crouch, 0.12)),
    ];
    // turning swings the arms
    t[0].z += this.lean * 0.4; t[1].z -= this.lean * 0.4;
    const edge = (side, z) => this._boardToBody(new THREE.Vector3(side * 0.16, 0.06, z), false);
    const back = 1 - lead;
    if (grab === 'Indy') t[back] = edge(sig, 0.08 * (this.regular ? 1 : -1));
    if (grab === 'Melon') t[lead] = edge(-sig, 0);
    if (grab === 'Method') { t[lead] = edge(-sig, 0); t[back] = sh[back].clone().add(new THREE.Vector3((back === 0 ? 1 : -1) * 0.3, 0.45, -0.1)); }
    if (grab === 'Nose Grab') t[lead] = this._boardToBody(new THREE.Vector3(0, 0.08, -0.7), false);
    if (phantom) { t[0] = sh[0].clone().add(new THREE.Vector3(0.3, 0.5, 0.1)); t[1] = sh[1].clone().add(new THREE.Vector3(-0.3, 0.5, 0.1)); }
    if (seated) { t[0] = new THREE.Vector3(0.2, 0.62, 0.3); t[1] = new THREE.Vector3(-0.2, 0.62, 0.3); }
    if (crashing) {
      const w = performance.now() / 120;
      t[0] = sh[0].clone().add(new THREE.Vector3(0.4, 0.3 * Math.sin(w), 0.3 * Math.cos(w)));
      t[1] = sh[1].clone().add(new THREE.Vector3(-0.4, 0.3 * Math.cos(w), 0.3 * Math.sin(w)));
    }
    for (let i = 0; i < 2; i++) {
      this.handPos[i].lerp(t[i], 1 - Math.exp(-(grab || phantom ? 22 : 12) * dt));
      const elbow = ik(sh[i], this.handPos[i], 0.33, 0.33, new THREE.Vector3(i === 0 ? 0.5 : -0.5, -0.6, -0.5));
      placeLimb(this.upperArms[i], sh[i], elbow, 0.11);
      placeLimb(this.foreArms[i], elbow, this.handPos[i], 0.1);
      this.hands[i].position.copy(this.handPos[i]);
      this.hands[i].scale.set(0.1, 0.1, 0.1);
    }
  }

  // ---------------- physics ----------------
  reset(pos, yaw = 0) {
    this.pos.copy(pos);
    this.yaw = yaw;
    this.vel.set(Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(3);
    this.state = 'ride'; this.switch = false;
    this.flip = 0; this.flipVel = 0; this.spinVel = 0; this.grab = null; this.phantomT = -1;
    this.crouch = 0; this.charge = 0; this.lean = 0; this.brakeAmt = 0;
    this.terrain.normalAt(pos.x, pos.z, this.normal);
    this.alignQ.setFromUnitVectors(UP, this.normal);
  }

  get speed() { return this.vel.length(); }

  // Sit on a chairlift seat (call every frame while riding the lift).
  sitAt(seat, dir) {
    this.state = 'lift';
    this.liftSeat = seat; this.liftDir = dir;
    this.vel.set(0, 0, 0);
    this.grab = null; this.phantomT = -1; this.crouch = 0; this.lean = 0; this.brakeAmt = 0;
  }

  step(dt, input) {
    if (this.state === 'lift') return;
    if (this.state === 'ride') this._ground(dt, input);
    else if (this.state === 'air') this._air(dt, input);
    else if (this.state === 'crash') this._crash(dt);
    // hard top speed (65 mph), on the ground and in the air
    const v = this.vel.length();
    if (v > TUNE.topSpeed) this.vel.multiplyScalar(TUNE.topSpeed / v);
    const sp = this.speed;
    if (this.state === 'ride') this.topSpeed = Math.max(this.topSpeed, sp);
    // tree hits
    if (this.state === 'ride' || this.state === 'air') {
      const t = this.terrain.treeNear(this.pos.x, this.pos.z);
      if (t && this.pos.y < t.y + t.h) this.doCrash({ tower: 'Hit a lift tower!', lodge: 'Hit the lodge!' }[t.kind] || 'Hit a tree!');
    }
  }

  _ground(dt, input) {
    const T = TUNE, n = this.normal;
    this.terrain.normalBehind(this.pos.x, this.pos.z, this.vel.x, this.vel.z, n);
    const speed = this.speed;
    const tuck = input.down && !input.jump;
    const stand = input.up;
    const brake = input.brake;
    this.brakeAmt = damp(this.brakeAmt, brake ? 1 : 0, 8, dt);

    // crouch: tuck or charging a jump
    this.crouch = damp(this.crouch, (tuck ? 0.85 : 0) + (input.jump ? 0.6 : 0) * (1 - (tuck ? 0.85 : 0)), 10, dt);

    // steering
    const k = Math.min(1, speed / 32);
    let rate = T.turnRate + (T.turnRateFast - T.turnRate) * k;
    if (tuck) rate *= T.tuckTurnMul;
    if (brake) rate *= 1.3;
    this.yaw += input.steer * rate * dt;
    this.lean = damp(this.lean, input.steer * (0.25 + 0.45 * k) * (brake ? 0.4 : 1), 8, dt);

    // board axes on the slope
    const f = new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    f.addScaledVector(n, -f.dot(n)).normalize();
    const side = new THREE.Vector3().crossVectors(n, f).normalize();

    // gravity along the slope
    const gt = new THREE.Vector3(0, -G, 0); gt.addScaledVector(n, -gt.dot(n));
    this.vel.addScaledVector(gt, dt);
    this.vel.addScaledVector(n, -this.vel.dot(n));

    // carve: kill sideways slide, keep part of it as forward speed
    let vf = this.vel.dot(f), vs = this.vel.dot(side);
    const grip = brake ? T.brakeGrip : tuck ? T.tuckGrip : T.grip;
    const nvs = vs * Math.exp(-grip * dt);
    const lost = Math.abs(vs) - Math.abs(nvs);
    vf += Math.sign(vf || 1) * lost * (brake ? 0 : T.carveKeep);
    this.vel.copy(f).multiplyScalar(vf).addScaledVector(side, nvs);
    this.slide = Math.abs(nvs);

    // going backwards -> now riding switch
    if (vf < -0.8) { this.yaw = wrap(this.yaw + Math.PI); this.switch = !this.switch; }

    // friction + drag
    const sp = this.vel.length();
    const drag = tuck ? T.tuckDrag : stand ? T.standDrag : T.drag;
    let dec = T.snowFriction * G * n.y + drag * sp * sp + (brake ? T.brakeDecel : 0) + (stand ? 1.2 : 0);
    if (sp > T.maxSpeed) dec += (sp - T.maxSpeed) * 1.5;   // soft speed limit
    if (sp > 1e-3) this.vel.multiplyScalar(Math.max(0, sp - dec * dt) / sp);
    // skating push when nearly stopped
    if (sp < 4 && !brake) this.vel.addScaledVector(f, 2.5 * dt);

    // jump charge / pop
    if (input.jump) this.charge = Math.min(1, this.charge + dt / T.chargeTime);
    let pop = 0;
    if (!input.jump && this.charge > 0) { pop = T.jumpBase + T.jumpCharge * this.charge; this.charge = 0; }

    // move and follow the ground
    const next = this.pos.clone().addScaledVector(this.vel, dt);
    const gh = this.terrain.heightAt(next.x, next.z);
    if (pop > 0) {
      this.vel.addScaledVector(n, pop);
      this.pos.copy(next); this.pos.y = Math.max(next.y, gh) + 0.02;
      this._takeoff(true);
    } else if (next.y > gh + 0.06 + 0.002 * sp) {
      // ground fell away under us (kicker lip, cliff, crest)
      this.pos.copy(next);
      this._takeoff(false);
    } else {
      this.pos.set(next.x, gh, next.z);
      const nn = this.terrain.normalBehind(next.x, next.z, this.vel.x, this.vel.z);
      const s0 = this.vel.length();
      this.vel.addScaledVector(nn, -this.vel.dot(nn));
      const s1 = this.vel.length();
      if (s1 > 1e-4) this.vel.multiplyScalar(s0 / s1 * 0.999);
    }

    // spray amount for particles
    this.spray = Math.min(1, this.slide * 0.25 + this.brakeAmt * Math.min(1, sp / 8) + Math.abs(input.steer) * k * 0.4);
  }

  _takeoff(ollie) {
    // keep kicker airs in a predictable range: cap the launch speed away from the slope below
    const ahead = this.pos.clone().addScaledVector(new THREE.Vector3(this.vel.x, 0, this.vel.z).normalize(), 10);
    const ln = this.terrain.normalAt(ahead.x, ahead.z);
    const vn = this.vel.dot(ln);
    const cap = TUNE.maxLaunch + (ollie ? TUNE.jumpBase + TUNE.jumpCharge : 0);
    if (vn > cap) this.vel.addScaledVector(ln, cap - vn);
    this.state = 'air';
    this.airTime = 0;
    this.airYaw = this.yaw + (this.switch ? Math.PI : 0);
    this.flip = 0; this.flipVel = 0; this.spinVel = 0;
    this.grab = null; this.phantomT = -1;
    const t = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    if (t.lengthSq() < 1e-4) t.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    t.normalize();
    this.flipAxis.crossVectors(UP, t).normalize();
    this.events.push({ type: 'takeoff', ollie });
  }

  _air(dt, input) {
    const T = TUNE;
    this.airTime += dt;
    this.vel.y -= G * T.airGravity * dt;
    const sp = this.vel.length();
    this.vel.multiplyScalar(1 - 0.0012 * sp * dt);
    this.pos.addScaledVector(this.vel, dt);
    this.crouch = damp(this.crouch, 0.3, 6, dt);
    this.lean = damp(this.lean, 0, 4, dt);
    this.charge = 0;

    // spin (left/right) and flip (up = front flip, down = back flip)
    if (input.steer) this.spinVel = damp(this.spinVel, input.steer * T.spinRate, 9, dt);
    else {
      // let go: settle onto the nearest 180 lined up with travel (forgiving landings)
      const vh = headingOf(this.vel);
      const off = wrap(this.airYaw - vh);
      const target = Math.abs(off) < Math.PI / 2 ? 0 : Math.sign(off) * Math.PI;
      const err = off - target;
      this.spinVel = damp(this.spinVel, 0, 10, dt) - err * 9 * dt;
    }
    const dYaw = this.spinVel * dt;
    this.airYaw += dYaw;
    const flipIn = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    if (flipIn) this.flipVel = damp(this.flipVel, flipIn * T.flipRate, 7, dt);
    else {
      this.flipVel = damp(this.flipVel, 0, 8, dt);
      // gentle self-righting when close to upright
      const off = wrap(this.flip);
      if (Math.abs(off) < 0.9 && Math.abs(this.flipVel) < 3) this.flipVel += -off * 10 * dt;
    }
    const dFlip = this.flipVel * dt;
    this.flip += dFlip;
    this.events.push({ type: 'rot', spin: dYaw, flip: dFlip });

    // grabs
    this.grab = input.grab;
    // impossible trick
    if (input.phantomPressed && this.phantomT < 0) { this.phantomT = 0; this.events.push({ type: 'phantom-start' }); }
    if (this.phantomT >= 0) {
      this.phantomT += dt / T.phantomTime;
      if (this.phantomT >= 1) { this.phantomT = -1; this.events.push({ type: 'phantom-done' }); }
    }
    if (this.grab && this.phantomT < 0) this.events.push({ type: 'grab', name: this.grab, dt });

    // landing
    const gh = this.terrain.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= gh && this.vel.y <= 0.5) {
      this.pos.y = gh;
      this._land();
    } else if (this.pos.y < gh) this.pos.y = gh;
  }

  _land() {
    const T = TUNE;
    const n = this.terrain.normalAt(this.pos.x, this.pos.z, this.normal);
    const impact = -this.vel.dot(n);
    const vh = headingOf(this.vel);   // travel heading before the landing bends it
    this.vel.addScaledVector(n, -this.vel.dot(n));
    const d = wrap(this.airYaw - vh);
    const flipOff = Math.abs(wrap(this.flip));
    let reason = null;
    if (this.phantomT >= 0) reason = 'Board not back on!';
    else if (flipOff > T.landFlipTol) reason = 'Landed on your head!';
    else if (!(Math.abs(d) < T.landSpinTol || Math.abs(d) > Math.PI - T.landSpinTol)) reason = 'Landed sideways!';
    else if (impact > 26) reason = 'Too hard a landing!';
    if (reason) { this.doCrash(reason); return; }
    this.switch = Math.abs(d) > Math.PI / 2;
    this.yaw = vh;
    // sloppy landings scrub speed
    const sloppy = Math.min(1, Math.abs(Math.abs(d) > Math.PI / 2 ? Math.PI - Math.abs(d) : d) / T.landSpinTol);
    this.vel.multiplyScalar((1 - 0.18 * sloppy * sloppy) * (1 - Math.min(0.25, impact * 0.012)));
    this.state = 'ride';
    this.grab = null; this.flip = 0;
    this.crouch = 0.7 + Math.min(0.3, impact / 30);
    this.events.push({ type: 'land', impact, switch: this.switch, sloppy });
  }

  doCrash(reason) {
    if (this.state === 'crash') return;
    this.state = 'crash';
    this.crashT = 0;
    this.grab = null; this.phantomT = -1;
    this.crashSpin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 14);
    this.crashQ.copy(this.root.quaternion);
    if (reason.startsWith('Hit')) this.vel.multiplyScalar(-0.15);
    // keep crashes low: no upward launch, and cap the tumble speed
    this.vel.y = Math.min(this.vel.y, 1);
    const sp = this.vel.length();
    if (sp > TUNE.crashMaxSpeed) this.vel.multiplyScalar(TUNE.crashMaxSpeed / sp);
    this.events.push({ type: 'crash', reason });
  }

  _crash(dt) {
    // tumble along the snow: stay on the ground, lose speed fast, never bounce high
    this.crashT += dt;
    this.vel.y -= G * dt;
    this.pos.addScaledVector(this.vel, dt);
    const gh = this.terrain.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < gh + 0.3) {
      this.pos.y = gh + 0.3;
      const n = this.terrain.normalAt(this.pos.x, this.pos.z);
      const vn = this.vel.dot(n);
      if (vn < 0) this.vel.addScaledVector(n, -vn * 1.12);          // tiny bounce
      const sp = this.vel.length();
      if (sp > 1e-3) this.vel.multiplyScalar(Math.max(0, sp - TUNE.crashFriction * dt) / sp);
      this.crashSpin.multiplyScalar(Math.exp(-2.2 * dt));
      this.spray = Math.min(1, sp / 10);
    } else this.spray = 0;
    // a tumbling rider doesn't slide through trees
    const t = this.terrain.treeNear(this.pos.x, this.pos.z);
    if (t) { this.vel.x *= -0.1; this.vel.z *= -0.1; }
    const w = this.crashSpin.length();
    if (w > 1e-3) {
      const dq = new THREE.Quaternion().setFromAxisAngle(this.crashSpin.clone().normalize(), w * dt);
      this.crashQ.premultiply(dq);
    }
    if (this.crashT > TUNE.crashTime) this.events.push({ type: 'respawn' });
  }

  // ---------------- visuals ----------------
  updateVisual(dt, input) {
    const root = this.root;
    if (this.state === 'lift') {
      // seated on a chair: seat point + facing direction come from the lift
      const head = Math.atan2(this.liftDir.x, this.liftDir.z);
      root.quaternion.setFromAxisAngle(UP, head - this.body.rotation.y);
      this._updatePose(dt, input);
      const hip = this.hipC.clone().applyAxisAngle(UP, head);
      root.position.copy(this.liftSeat).sub(hip);
      this.pos.copy(root.position);
      return;
    }
    root.position.copy(this.pos);
    if (this.state === 'crash') {
      root.quaternion.copy(this.crashQ);
    } else {
      const targetAlign = new THREE.Quaternion().setFromUnitVectors(UP, this.state === 'ride' ? this.normal : UP);
      this.alignQ.slerp(targetAlign, 1 - Math.exp(-(this.state === 'ride' ? 18 : 3) * dt));
      const q = new THREE.Quaternion();
      if (this.state === 'ride') {
        const brakeTwist = this.brakeAmt * 1.25;
        const vis = this.yaw + (this.switch ? Math.PI : 0) + brakeTwist;
        const leanSign = this.switch ? -1 : 1;
        const lean = -this.lean * leanSign + this.brakeAmt * 0.25 * (this.regular ? 1 : -1) * leanSign;
        q.copy(this.alignQ)
          .multiply(new THREE.Quaternion().setFromAxisAngle(UP, -vis))
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), lean));
      } else {
        q.setFromAxisAngle(this.flipAxis, this.flip)
          .multiply(this.alignQ)
          .multiply(new THREE.Quaternion().setFromAxisAngle(UP, -this.airYaw));
      }
      root.quaternion.copy(q);
    }
    this._updatePose(dt, input);
  }
}
