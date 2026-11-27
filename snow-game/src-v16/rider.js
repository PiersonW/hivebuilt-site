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
  carveScrub: 0.12,       // share of speed lost per radian the carve turns you
  snowFriction: 0.038,
  drag: 0.0070,           // normal stance air drag (v^2): straight down the steep middle tops out near 50 mph
  tuckDrag: 0.0013,       // low: a straight tuck keeps building toward 60-65 mph
  standDrag: 0.02,
  brakeDecel: 11,
  jumpBase: 3.6,          // m/s pop with no charge
  jumpCharge: 3.6,        // extra pop at full charge
  chargeTime: 0.55,
  spinRate: 7.6,          // rad/s in the air
  flipRate: 5.2,          // rad/s (a full flip takes about 1.2 s)
  landSpinTol: 1.0,       // rad (~57 deg) off the travel line and you crash
  landFlipTol: 1.25,      // rad (~72 deg) off upright and you crash
  phantomTime: 0.75,
  airGravity: 0.85,       // a little floaty in the air (arcade)
  stick: 0.0035,          // how hard the board holds the snow over rolls (higher = fewer little hops)
  maxLaunch: 7.5,         // m/s off a kicker, measured away from the landing slope
  maxSpeed: 28,           // m/s (~63 mph): above this the snow starts holding you back
  topSpeed: 65 / 2.237,   // hard cap: 65 mph
  crashTime: 4,           // longest tumble before getting up
  getupTime: 1.3,         // seconds to stand back up
  landImpact: 32,         // m/s into the slope = too hard a landing
  railFriction: 1.2,      // m/s^2 slowing on rails and boxes
  pipeGravity: 0.72,      // halfpipe walls feel lighter so you get real air out of them
  skateMaxUphill: 0.07,   // the automatic shuffle only works on flats or very gentle uphill (lift lines)
  pushMaxUphill: 0.15,    // pushing (hold up) gets you over small rises, never up a real slope
  pushMaxSpeed: 5.5,      // m/s (~12 mph): pushing stops helping above this
  pushAccel: 4.2,         // m/s^2 during each push stroke
  pushRate: 1.25,         // push strokes per second
  crashFriction: 9,       // m/s^2 slowing while tumbling
  crashMaxSpeed: 14,      // m/s, tumble speed right after a crash
};

// Skiers use the same four grab buttons with ski grab names.
export const SKI_GRABS = { 'Indy': 'Safety', 'Melon': 'Mute', 'Method': 'Japan', 'Nose Grab': 'Tail Grab' };

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const headingOf = (v) => Math.atan2(v.x, -v.z);
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

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
    this.edge = -1;             // edge you're on: 1 = toe, -1 = heel (used by the brake skid)
    this.brakeEdge = -1;
    this.getupT = -1;
    this.rail = null; this.railCooldown = 0; this.boardslide = 0;
    this.pushAmt = 0; this.pushPhase = 0;   // pushing along flats: back foot out (board) or poles (ski)
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

    // skis (two, along z, tips at -z) for the skier
    this.skisG = new THREE.Group();
    const skiMat = flat(0x1e8fd6), skiTop = flat(0xf4f4f4);
    for (const sx of [-0.14, 0.14]) {
      const ski = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 1.7), skiMat); ski.position.set(sx, 0.025, 0.05);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.01, 1.4), skiTop); stripe.position.set(sx, 0.045, 0.05);
      const tipS = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.2), skiMat); tipS.position.set(sx, 0.07, -0.86); tipS.rotation.x = 0.5;
      const tailS = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.14), skiMat); tailS.position.set(sx, 0.05, 0.94); tailS.rotation.x = -0.35;
      for (const m of [ski, stripe, tipS, tailS]) { m.castShadow = true; this.skisG.add(m); }
    }
    this.skisG.visible = false;
    root.add(this.skisG);
    this.sport = 'board';
    this.gear = this.boardG;

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
    this.poles = [mk(flat(0x9aa3ad)), mk(flat(0x9aa3ad))];
    for (const pl of this.poles) pl.visible = false;

    this.handPos = [new THREE.Vector3(0.5, 0.9, 0.1), new THREE.Vector3(-0.5, 0.9, 0.1)];
    this.pose = { hipH: 0.92, lean: 0.15, boardLift: 0, boardRX: 0, boardRZ: 0, feetLift: 0 };
    this.scene.add(root);
  }

  setStance(regular) {
    this.regular = regular;
    this._orientBody();
  }

  // 'board' (snowboarder, stands sideways) or 'ski' (skier, faces forward with poles).
  setSport(sport) {
    this.sport = sport;
    const ski = sport === 'ski';
    this.boardG.visible = !ski; this.skisG.visible = ski;
    for (const pl of this.poles) pl.visible = ski;
    this.gear = ski ? this.skisG : this.boardG;
    this.boardG.position.set(0, 0, 0); this.boardG.rotation.set(0, 0, 0); this.boardG.updateMatrix();
    this.skisG.position.set(0, 0, 0); this.skisG.rotation.set(0, 0, 0); this.skisG.updateMatrix();
    this._orientBody();
  }

  _orientBody() {
    this.body.rotation.y = this.sport === 'ski' ? Math.PI : (this.regular ? Math.PI / 2 : -Math.PI / 2);
  }

  // Board/ski-local point -> body-local point.
  _boardToBody(v, phantom) {
    const p = v.clone();
    if (!phantom) p.applyMatrix4(this.gear.matrix);
    else p.y += this.pose.feetLift;
    return p.applyMatrix4(this._bodyInv);
  }

  _updatePose(dt, input) {
    const P = this.pose;
    const sig = this.regular ? 1 : -1;          // toe edge side in board frame (+x for regular)
    this.sig = sig;
    const grab = this.state === 'air' ? this.grab : null;
    const crashing = this.state === 'crash' && this.getupT < 0;
    const phantom = this.phantomT >= 0;

    // targets
    let hipH = 0.92 - 0.32 * this.crouch, lean = 0.15 + 0.35 * this.crouch;
    let boardLift = 0, rx = 0, rz = 0, feetLift = 0;
    if (this.state === 'air') { hipH = 0.78; lean = 0.35; }
    if (grab) { hipH = 0.8; lean = 0.85; boardLift = 0.42; }
    const ski = this.sport === 'ski';
    if (!ski) {
      if (grab === 'Nose Grab') { rx = 0.35; lean = 0.95; }
      if (grab === 'Method') { rz = -sig * 0.75; boardLift = 0.6; lean = 0.55; }
      if (grab === 'Melon') { rz = sig * 0.25; }
    } else {
      if (grab === 'Method') { rx = -0.55; boardLift = 0.5; lean = 0.6; }      // Japan: skis tucked up behind
      if (grab === 'Nose Grab') { rx = -0.45; lean = 0.7; }                     // Tail grab: tails swing up
    }
    const push = this.state === 'ride' ? this.pushAmt : 0;
    const ph = this.pushPhase, stroke = ph < 0.55 ? Math.sin(Math.PI * ph / 0.55) : 0;
    if (push > 0.02) {
      if (ski) { hipH -= push * 0.14 * stroke; lean += push * 0.45 * stroke; }      // fold over the poles as you push
      else { hipH -= push * 0.1; lean += push * 0.12; }                             // flex the front knee
    }
    if (phantom) { hipH = 0.85; lean = 0.25; feetLift = 0.35; }
    if (crashing) { hipH = 0.95; lean = -0.2; }
    const seated = this.state === 'lift';
    const standing = this.state === 'ride' && this.standT < 1;
    if (standing) { const e = 1 - this.standT * this.standT * (3 - 2 * this.standT); hipH = 0.92 - 0.42 * e; lean = 0.25 - 0.37 * e + 0.25 * Math.sin(Math.PI * this.standT); }
    if (seated) { const e = this.sitE === undefined ? 1 : this.sitE; hipH = 0.92 - 0.42 * e; lean = 0.25 - 0.37 * e; }
    const gettingUp = this.state === 'crash' && this.getupT >= 0;
    const gu = gettingUp ? this.getupT : 0;
    if (gettingUp) { hipH = 0.4 + 0.5 * gu; lean = 0.9 * (1 - gu) + 0.15; }
    const r = 16;
    P.hipH = damp(P.hipH, hipH, r, dt); P.lean = damp(P.lean, lean, r, dt);
    P.boardLift = damp(P.boardLift, boardLift, r, dt); P.boardRX = damp(P.boardRX, rx, r, dt);
    P.boardRZ = damp(P.boardRZ, rz, r, dt); P.feetLift = damp(P.feetLift, feetLift, r, dt);

    // board / ski transform
    const bg = this.gear;
    bg.position.set(0, P.boardLift, 0);
    bg.rotation.set(P.boardRX, 0, P.boardRZ);
    if (seated) {
      // board swings up in front of the seat as you sit
      const e = this.sitE === undefined ? 1 : this.sitE;
      const v = new THREE.Vector3(0, 0.02, 0.45 * e).applyAxisAngle(UP, this.body.rotation.y);
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
    const bindings = ski ? [new THREE.Vector3(-0.14, 0.06, 0), new THREE.Vector3(0.14, 0.06, 0)] : [new THREE.Vector3(0, 0.07, -0.27), new THREE.Vector3(0, 0.07, 0.27)];
    const bind = bindings.map(v => this._boardToBody(v, phantom));
    // board: unstrap the back foot and kick along on the snow beside the board (toe side)
    if (!ski && push > 0.02) {
      const sw = this.switch ? -1 : 1;
      const backIdx = sw > 0 ? 1 : 0;                       // binding toward the tail (+z) when riding forward
      // foot plants by the front binding, pushes back past the tail, then lifts and swings forward again
      const z = ph < 0.55 ? -0.1 + 0.75 * (ph / 0.55) : 0.65 - 0.75 * ((ph - 0.55) / 0.45);
      const y = ph < 0.55 ? -0.02 : 0.12 * Math.sin(Math.PI * (ph - 0.55) / 0.45);
      const out = this._boardToBody(new THREE.Vector3(this.sig * 0.3, y, z * sw), false);
      out.y = Math.max(out.y, -0.03 + y);
      bind[backIdx].lerp(out, push);
    }
    bind.sort((a, b) => b.x - a.x); // index 0 = body +x side
    const lean2 = P.lean;
    const hipC = new THREE.Vector3(0, P.hipH + (phantom ? P.feetLift : 0) + P.boardLift * 0.6, -0.06 - 0.1 * lean2);
    this.hipC = hipC;
    // snowboard push: hips, upper body and the free (pushing) leg turn to face where you're going;
    // the front foot stays strapped in sideways on the board
    const tw = !ski && this.state === 'ride' ? this.pushAmt : 0;
    const twR = this._twistQ || (this._twistQ = new THREE.Quaternion());
    twR.setFromAxisAngle(UP, sig * (this.switch ? -1 : 1) * 1.2 * tw);
    const pushLeg = (sig * (this.switch ? -1 : 1)) > 0 ? 1 : 0;      // body -x side is the tail side for regular
    const fwd = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const hipOff = new THREE.Vector3(side * 0.12, 0, 0);
      if (tw > 0.02) hipOff.applyQuaternion(twR);
      const hip = hipC.clone().add(hipOff);
      const foot = bind[i];
      const pole = fwd.clone().add(new THREE.Vector3(side * (ski ? 0.05 : 0.3), 0, 0));
      const free = tw > 0.02 && i === pushLeg;
      if (free) pole.set(0, 0, 1).applyQuaternion(twR);              // knee points forward, not out the side
      const knee = ik(hip, foot, 0.46, 0.46, pole);
      placeLimb(this.thighs[i], hip, knee, 0.15);
      placeLimb(this.shins[i], knee, foot, 0.13);
      this.boots[i].position.copy(foot).add(new THREE.Vector3(0, 0.03, 0.03));
      this.boots[i].scale.set(0.14, 0.1, 0.26);
      if (free) this.boots[i].quaternion.copy(twR); else this.boots[i].quaternion.identity();
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
    // look where you're going: snowboarders look over the front shoulder, everyone looks into the turn
    const look = this.state === 'lift' ? 0 : ski ? -this.lean * 0.5 : sig * (this.switch ? -1 : 1) * 0.95 * (1 - tw) - this.lean * 0.35;
    if (Math.abs(look) > 0.01) {
      const Rh = new THREE.Quaternion().setFromAxisAngle(headDir, look);
      this.goggles.position.sub(this.head.position).applyQuaternion(Rh).add(this.head.position);
      this.goggles.quaternion.premultiply(Rh);
      this.head.quaternion.copy(Rh);
    } else this.head.quaternion.identity();

    // hands
    const sh = [neck.clone().add(new THREE.Vector3(0.21, -0.06, 0)), neck.clone().add(new THREE.Vector3(-0.21, -0.06, 0))];
    const lead = sig > 0 ? 0 : 1; // regular: body +x is the nose side
    const t = [
      sh[0].clone().add(new THREE.Vector3(0.38, -0.32 + 0.1 * this.crouch, 0.12)),
      sh[1].clone().add(new THREE.Vector3(-0.38, -0.32 + 0.1 * this.crouch, 0.12)),
    ];
    // turning swings the arms
    t[0].z += this.lean * 0.4; t[1].z -= this.lean * 0.4;
    // a bit of life: breathing sway, balance on the edges, tucking in with speed, flailing in big air
    const now = performance.now() / 1000;
    const onGround = this.state === 'ride';
    const faceSign = (this.regular ? 1 : -1) * (this.switch ? -1 : 1);
    const toe = ski ? 0 : this.lean * faceSign;                 // + = leaning onto the toe edge
    for (let i = 0; i < 2; i++) {
      const sd = i === 0 ? 1 : -1;
      t[i].y += Math.sin(now * 1.7 + i * 1.3) * 0.015;
      if (onGround) {
        if (!ski) { t[i].z -= toe * 0.3; t[i].y += Math.abs(this.lean) * 0.1; }        // counterbalance the edge
        t[i].y -= this.crouch * 0.12; t[i].x *= 1 - this.crouch * 0.3; t[i].z += this.crouch * 0.12;   // tuck in
        if (this.brakeAmt > 0.05) { t[i].y += this.brakeAmt * 0.12; t[i].x += sd * this.brakeAmt * 0.12; }
      }
      if (this.state === 'air' && !grab && !phantom) {
        // arms out for balance, lagging behind a spin and pulled in for flips
        const a = Math.min(1, this.airTime * 2.5);
        t[i].x += sd * 0.12 * a; t[i].y += 0.18 * a;
        const lag = new THREE.Quaternion().setFromAxisAngle(UP, -this.spinVel * 0.06);
        t[i].sub(neck).applyQuaternion(lag).add(neck);
        const tuckF = Math.min(1, Math.abs(this.flipVel) / 5);
        t[i].lerp(neck.clone().add(new THREE.Vector3(sd * 0.18, -0.3, 0.25)), tuckF * 0.6);
      }
      if (this.landBump > 0) { t[i].y -= this.landBump; t[i].z += this.landBump * 0.6; }
    }
    this.landBump = Math.max(0, (this.landBump || 0) - dt * 1.2);
    const edge = (side, z) => this._boardToBody(new THREE.Vector3(side * 0.16, 0.06, z), false);
    const back = 1 - lead;
    if (ski) {
      // skier: hands holding the poles out front, and ski grabs
      t[0] = sh[0].clone().add(new THREE.Vector3(0.12, -0.42 + 0.1 * this.crouch, 0.32));
      t[1] = sh[1].clone().add(new THREE.Vector3(-0.12, -0.42 + 0.1 * this.crouch, 0.32));
      for (let i = 0; i < 2; i++) t[i].y += Math.sin(now * 1.7 + i * 1.3) * 0.015;
      if (this.state === 'ride') {
        // outside hand drifts forward in a turn; a quick pole plant on the inside to start each new turn
        t[0].z += this.lean * 0.18; t[1].z -= this.lean * 0.18;
        if (this.plantT > 0) {
          const inside = this.turnSide > 0 ? 1 : 0, k = Math.sin(Math.PI * (1 - this.plantT / 0.5));
          t[inside].z += 0.22 * k; t[inside].y -= 0.12 * k;
        }
      }
      if (this.state === 'air' && !grab) { const a = Math.min(1, this.airTime * 2.5); t[0].x += 0.15 * a; t[1].x -= 0.15 * a; t[0].y += 0.12 * a; t[1].y += 0.12 * a; }
      if (this.landBump > 0) for (let i = 0; i < 2; i++) { t[i].y -= this.landBump * 0.8; t[i].z += this.landBump * 0.4; }
      const skiPt = (rootX, z) => this._boardToBody(new THREE.Vector3(rootX, 0.05, z), false);
      if (push > 0.02) {
        // double pole: reach forward, plant, pull through past the hips, swing back forward
        const reach = ph < 0.55 ? 1 - ph / 0.55 : (ph - 0.55) / 0.45;     // 1 = arms forward, 0 = pushed back
        const hy = -0.25 + 0.15 * reach, hz = -0.15 + 0.6 * reach;
        for (let i = 0; i < 2; i++) {
          const want = sh[i].clone().add(new THREE.Vector3(i === 0 ? 0.14 : -0.14, hy, hz));
          t[i].lerp(want, push);
        }
      }
      if (grab === 'Indy') t[0] = skiPt(-0.22, 0.05);              // Safety: hand to the outside of its own ski
      if (grab === 'Melon') t[1] = skiPt(-0.1, -0.15);             // Mute: hand crosses over to the other ski
      if (grab === 'Method') t[0] = skiPt(-0.14, -0.4);            // Japan: front of the ski, skis behind
      if (grab === 'Nose Grab') t[1] = skiPt(0.14, 0.62);          // Tail grab
    } else {
      if (grab === 'Indy') t[back] = edge(sig, 0.08 * (this.regular ? 1 : -1));
      if (grab === 'Melon') t[lead] = edge(-sig, 0);
      if (grab === 'Method') { t[lead] = edge(-sig, 0); t[back] = sh[back].clone().add(new THREE.Vector3((back === 0 ? 1 : -1) * 0.3, 0.45, -0.1)); }
      if (grab === 'Nose Grab') t[lead] = this._boardToBody(new THREE.Vector3(0, 0.08, -0.7), false);
    }
    if (phantom) { t[0] = sh[0].clone().add(new THREE.Vector3(0.3, 0.5, 0.1)); t[1] = sh[1].clone().add(new THREE.Vector3(-0.3, 0.5, 0.1)); }
    if (this.state === 'fly' && this.chute) {   // hands up on the steering toggles
      const pull = this.flyBank || 0;
      t[0] = sh[0].clone().add(new THREE.Vector3(0.12, 0.5 - Math.max(0, -pull) * 0.25, 0.05));
      t[1] = sh[1].clone().add(new THREE.Vector3(-0.12, 0.5 - Math.max(0, pull) * 0.25, 0.05));
    }
    if (seated) { t[0] = new THREE.Vector3(0.2, 0.62, 0.3); t[1] = new THREE.Vector3(-0.2, 0.62, 0.3); }
    if (gettingUp && gu < 0.55) {   // hands push off the snow
      t[0] = new THREE.Vector3(0.35, 0.05, 0.35); t[1] = new THREE.Vector3(-0.35, 0.05, 0.35);
    }
    if (this.state === 'grind') {   // arms out for balance
      t[0] = sh[0].clone().add(new THREE.Vector3(0.5, -0.12, 0.05)); t[1] = sh[1].clone().add(new THREE.Vector3(-0.5, -0.12, 0.05));
    }
    if (crashing) {
      const w = performance.now() / 120;
      t[0] = sh[0].clone().add(new THREE.Vector3(0.4, 0.3 * Math.sin(w), 0.3 * Math.cos(w)));
      t[1] = sh[1].clone().add(new THREE.Vector3(-0.4, 0.3 * Math.cos(w), 0.3 * Math.sin(w)));
    }
    this.plantT = Math.max(0, (this.plantT || 0) - dt);
    if (!this.handVel) this.handVel = [new THREE.Vector3(), new THREE.Vector3()];
    for (let i = 0; i < 2; i++) {
      // hands follow their target on a soft spring: they lag, swing and settle instead of snapping
      if (grab || phantom || seated || this.state === 'crash') { this.handPos[i].lerp(t[i], 1 - Math.exp(-(grab || phantom ? 22 : 12) * dt)); this.handVel[i].set(0, 0, 0); }
      else {
        const k = 140, c = 15, h = Math.min(dt, 1 / 30);
        const acc = t[i].clone().sub(this.handPos[i]).multiplyScalar(k).addScaledVector(this.handVel[i], -c);
        this.handVel[i].addScaledVector(acc, h);
        this.handPos[i].addScaledVector(this.handVel[i], h);
        if (this.handPos[i].distanceToSquared(t[i]) > 0.5) { this.handPos[i].copy(t[i]); this.handVel[i].set(0, 0, 0); }
      }
      const elbow = ik(sh[i], this.handPos[i], 0.33, 0.33, new THREE.Vector3(i === 0 ? 0.5 : -0.5, -0.6, -0.5));
      placeLimb(this.upperArms[i], sh[i], elbow, 0.11);
      placeLimb(this.foreArms[i], elbow, this.handPos[i], 0.1);
      this.hands[i].position.copy(this.handPos[i]);
      this.hands[i].scale.set(0.1, 0.1, 0.1);
      if (ski) {   // pole runs from the hand down and back toward the snow
        const flying = this.state === 'air' || this.state === 'grind';
        const tipP = this.handPos[i].clone().add(flying ? new THREE.Vector3(i === 0 ? 0.15 : -0.15, -0.55, -0.9) : new THREE.Vector3(0, -1.05, -0.35));
        if (!flying && push > 0.02 && ph < 0.55) {   // pole tips stay planted in the snow behind the hands while pushing
          tipP.copy(this.handPos[i]).add(new THREE.Vector3(0, -1.1, -0.35 - 0.25 * (ph / 0.55)));
        }
        if (!flying && this.plantT > 0 && i === (this.turnSide > 0 ? 1 : 0)) tipP.copy(this.handPos[i]).add(new THREE.Vector3(0, -1.1, 0.15));
        if (!flying) tipP.y = Math.max(tipP.y, 0.04);
        placeLimb(this.poles[i], this.handPos[i], tipP, 0.03);
      }
    }
    // snowboard push: the upper body turns with the hips (see the legs above)
    if (tw > 0.02) {
      const R = twR;
      for (const m of [this.torso, this.head, this.helmet, this.goggles, ...this.upperArms, ...this.foreArms, ...this.hands]) {
        m.position.sub(hipC).applyQuaternion(R).add(hipC);
        m.quaternion.premultiply(R);
      }
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
    this.getupT = -1; this.rail = null; this.boardslide = 0; this.pipeAir = false; this.standT = 1;
    if (this.wingMesh && this.wingMesh.visible) { this._wings(false); this._orientBody(); }   // restarted mid-flight
    this.chute = false; if (this.canopy) this.canopy.visible = false;
    this.gear.visible = true;
    this.terrain.normalAt(pos.x, pos.z, this.normal);
    this.alignQ.setFromUnitVectors(UP, this.normal);
  }

  get speed() { return this.vel.length(); }

  // Start sitting down onto a chair: blends from standing in the lift line to seated over ~1 s.
  beginSit() {
    this.sitT = 0; this.sitE = 0;
    this.sitFromPos = this.root.position.clone();
    this.sitFromQ = this.root.quaternion.clone();
  }

  // Stand up off the chair at the top: blends from the seat to riding over ~0.9 s (call after reset()).
  beginStand(fromPos, fromQ) {
    this.standT = 0;
    this.standFromPos = fromPos.clone();
    this.standFromQ = fromQ.clone();
  }

  // Sit on a chairlift seat (call every frame while riding the lift).
  sitAt(seat, dir) {
    this.state = 'lift';
    this.liftSeat = seat; this.liftDir = dir;
    this.vel.set(0, 0, 0);
    this.grab = null; this.phantomT = -1; this.crouch = 0; this.lean = 0; this.brakeAmt = 0;
  }

  step(dt, input) {
    if (this.state === 'lift' || this.state === 'heli') return;
    if (this.state === 'fly') { this._fly(dt, input); return; }
    if (this.state === 'ride') this._ground(dt, input);
    else if (this.state === 'air') this._air(dt, input);
    else if (this.state === 'grind') this._grind(dt, input);
    else if (this.state === 'crash') this._crash(dt);
    this.railCooldown = Math.max(0, this.railCooldown - dt);
    if ((this.state === 'ride' || this.state === 'air') && this.railCooldown <= 0) this._tryRail(input);
    // hard top speed (65 mph), on the ground and in the air
    const v = this.vel.length();
    if (v > TUNE.topSpeed) this.vel.multiplyScalar(TUNE.topSpeed / v);
    const sp = this.speed;
    if (this.state === 'ride') this.topSpeed = Math.max(this.topSpeed, sp);
    // tree hits
    if (this.state === 'ride' || this.state === 'air') {
      const t = this.terrain.treeNear(this.pos.x, this.pos.z);
      if (t && this.pos.y < t.y + t.h) this.doCrash({ tower: 'Hit a lift tower!', lodge: 'Hit the lodge!', yeti: 'Ran into the yeti!' }[t.kind] || 'Hit a tree!');
    }
  }

  _ground(dt, input) {
    const T = TUNE, n = this.normal;
    this.terrain.normalBehind(this.pos.x, this.pos.z, this.vel.x, this.vel.z, n);
    const speed = this.speed;
    const tuck = input.down && !input.jump;
    const brake = input.brake;
    // hold up when slow: push yourself along (back foot out on the board, poles for skiers)
    const fwdNow = Math.sin(this.yaw) * this.vel.x - Math.cos(this.yaw) * this.vel.z;
    const pushing = !!input.up && !brake && !tuck && fwdNow < T.pushMaxSpeed + 1.5;
    const stand = input.up && !pushing;
    this.pushAmt = damp(this.pushAmt, pushing ? 1 : 0, 6, dt);
    if (this.pushAmt > 0.02) this.pushPhase = (this.pushPhase + dt * T.pushRate) % 1;
    else this.pushPhase = 0;
    this.brakeAmt = damp(this.brakeAmt, brake ? 1 : 0, 8, dt);

    // crouch: tuck or charging a jump
    this.crouch = damp(this.crouch, (tuck ? 0.85 : 0) + (input.jump ? 0.6 : 0) * (1 - (tuck ? 0.85 : 0)), 10, dt);

    // steering
    const k = Math.min(1, speed / 32);
    let rate = T.turnRate + (T.turnRateFast - T.turnRate) * k;
    if (tuck) rate *= T.tuckTurnMul;
    if (brake) rate *= 1.3;
    // holding the grind button sets you up for a rail: arrows pick the boardslide side instead of steering
    const steerIn = input.grind ? 0 : input.steer;
    this.yaw += steerIn * rate * dt;
    this.lean = damp(this.lean, input.steer * (0.25 + 0.45 * k) * (brake ? 0.4 : 1), 8, dt);
    // which edge are we on? turning toward the side you face = toe edge
    const faceSign = (this.regular ? 1 : -1) * (this.switch ? -1 : 1);
    if (!brake && Math.abs(this.lean) > 0.06) this.edge = Math.sign(this.lean) === faceSign ? 1 : -1;
    if (brake && this.brakeAmt < 0.05) this.brakeEdge = this.edge;     // skid on the edge you were on
    if (!brake && this.brakeAmt < 0.05) this.brakeEdge = this.edge;
    if (Math.abs(input.steer) > 0.3) {
      if (this.turnSide && Math.sign(input.steer) !== this.turnSide) this.plantT = 0.5;   // skier: pole plant to start the new turn
      this.turnSide = Math.sign(input.steer);
    }
    if (!brake && this.brakeAmt < 0.05) this.brakeSide = this.turnSide || 1;

    // board axes on the slope
    const f = new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    f.addScaledVector(n, -f.dot(n)).normalize();
    const side = new THREE.Vector3().crossVectors(n, f).normalize();

    // halfpipe walls: a bit of arcade "pump" (lighter gravity) and the board follows your line up and down
    const pw = this.terrain.pipeAt ? this.terrain.pipeAt(this.pos.x, this.pos.z) : null;
    const onPipeWall = !!(pw && pw.onWall && n.y < 0.93);
    // gravity along the slope
    const gt = new THREE.Vector3(0, -G * (onPipeWall ? T.pipeGravity : 1), 0); gt.addScaledVector(n, -gt.dot(n));
    this.vel.addScaledVector(gt, dt);
    this.vel.addScaledVector(n, -this.vel.dot(n));

    // carve: swing the travel direction toward the board's direction. Turning only ever costs speed
    // (a little when carving, a lot when skidding), it never adds any.
    let vf = this.vel.dot(f), vs = this.vel.dot(side);
    const spd = Math.hypot(vf, vs);
    if (onPipeWall) {
      // no edge fighting gravity on the wall: point the board where you're going (riding back down = fakie)
      const hv = Math.hypot(this.vel.x, this.vel.z);
      if (hv > 0.4) {
        const h = headingOf(this.vel);
        if (Math.abs(wrap(h - this.yaw)) > Math.PI / 2) this.switch = !this.switch;
        this.yaw = h;
      }
      vf = spd; vs = 0;
    } else if (spd > 0.05) {
      const dir = vf >= 0 ? 1 : -1;                         // moving forward or backward along the board
      const slip = Math.atan2(vs, Math.abs(vf));            // angle between travel and the board
      const grip = brake ? T.brakeGrip : tuck ? T.tuckGrip : T.grip;
      const newSlip = slip * Math.exp(-grip * dt);
      const turned = Math.abs(slip - newSlip);
      const s2 = spd * Math.max(0, 1 - turned * (brake ? 0.6 : T.carveScrub));
      vf = dir * s2 * Math.cos(newSlip); vs = s2 * Math.sin(newSlip);
      this.vel.copy(f).multiplyScalar(vf).addScaledVector(side, vs);
    }
    this.slide = Math.abs(vs);

    // going backwards -> now riding switch
    if (!onPipeWall && vf < -0.8) { this.yaw = wrap(this.yaw + Math.PI); this.switch = !this.switch; }

    // friction + drag
    const sp = this.vel.length();
    // holding jump crouches you low too: the longer you charge, the more speed you carry into the pop
    const drag = tuck || input.jump ? T.tuckDrag : stand ? T.standDrag : T.drag;
    let dec = T.snowFriction * G * n.y + drag * sp * sp + (brake ? T.brakeDecel : 0) + (stand ? 1.2 : 0);
    if (sp > T.maxSpeed) dec += (sp - T.maxSpeed) * 1.5;   // soft speed limit
    if (sp > 1e-3) this.vel.multiplyScalar(Math.max(0, sp - dec * dt) / sp);
    // skating push when nearly stopped (flats and lift lines only, never up a real slope)
    if (sp < 4 && !brake && !pushing && f.y < T.skateMaxUphill) this.vel.addScaledVector(f, 2.5 * dt);
    // push stroke: the first ~55% of each cycle drives you forward, the rest is the foot / poles coming back
    if (pushing && f.y < T.pushMaxUphill && this.pushPhase < 0.55) {
      const vfw = this.vel.dot(f);
      if (vfw < T.pushMaxSpeed) this.vel.addScaledVector(f, Math.min(T.pushMaxSpeed - vfw, T.pushAccel * Math.sin(Math.PI * this.pushPhase / 0.55) * 1.6 * dt));
    }

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
    } else if (next.y - gh > 1.6 * 0.5 * G * n.y * dt * dt + T.stick) {
      // the ground curves away faster than gravity can hold us on it (lips, cliffs, sharp crests)
      this.pos.copy(next);
      this._takeoff(false);
    } else {
      this.pos.set(next.x, gh, next.z);
      const nn = this.terrain.normalBehind(next.x, next.z, this.vel.x, this.vel.z);
      const s0 = this.vel.length();
      this.vel.addScaledVector(nn, -this.vel.dot(nn));
      const s1 = this.vel.length();
      if (s1 > 1e-4) this.vel.multiplyScalar(s0 / s1);   // follow the ground without losing speed
    }

    // spray amount for particles
    this.spray = Math.min(1, this.slide * 0.25 + this.brakeAmt * Math.min(1, sp / 8) + Math.abs(input.steer) * k * 0.4);
  }

  _takeoff(ollie, fromGrind = false) {
    // keep kicker airs in a predictable range: cap the launch speed away from the slope below
    const ahead = this.pos.clone().addScaledVector(new THREE.Vector3(this.vel.x, 0, this.vel.z).normalize(), 10);
    const ln = this.terrain.normalAt(ahead.x, ahead.z);
    const vn = this.vel.dot(ln);
    // halfpipe: leaving a wall you go straight up ("vert") and come back down into the pipe
    const pa = this.terrain.pipeAt ? this.terrain.pipeAt(this.pos.x, this.pos.z) : null;
    this.pipeAir = !!(pa && pa.onWall);
    if (this.pipeAir) {
      this.pipeN = (this.pipeN || new THREE.Vector3()).copy(this.normal);
      this.pipeIn = { x: -pa.cx * Math.sign(pa.l), z: -pa.cz * Math.sign(pa.l), ax: pa.ax, az: pa.az };
      const sg = Math.sign(pa.l), ox = pa.cx * sg, oz = pa.cz * sg;     // out over the deck
      const vc = this.vel.x * ox + this.vel.z * oz;
      this.vel.x -= ox * (vc + 0.45); this.vel.z -= oz * (vc + 0.45);
    } else {
      // snow-covered rocks are small natural hits: a softer pop than a built kicker
      const rock = this.terrain.snowRockNear && this.terrain.snowRockNear(this.pos.x, this.pos.z);
      const cap = (rock ? 4.8 : TUNE.maxLaunch) + (ollie ? TUNE.jumpBase + TUNE.jumpCharge : 0);
      // (off the long jump's table you keep everything: the landing hill is built for it)
      if (vn > cap && !(this.terrain.onJumpTable && this.terrain.onJumpTable(this.pos.x, this.pos.z))) this.vel.addScaledVector(ln, cap - vn);
    }
    this.state = 'air';
    this.airTime = 0;
    this.airYaw = this.yaw + (this.switch ? Math.PI : 0);
    this.pipeYaw0 = this.airYaw;
    this.flip = 0; this.flipVel = 0; this.spinVel = 0;
    this.grab = null; this.phantomT = -1;
    const t = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    if (t.lengthSq() < 1e-4) t.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    t.normalize();
    this.flipAxis.crossVectors(UP, t).normalize();
    this.boardslide = 0; this.rail = null;
    this.events.push({ type: 'takeoff', ollie, fromGrind });
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
      // let go: settle onto the nearest 180 lined up with travel (forgiving landings).
      // In the pipe, line up with the way you'll ride back down the wall: in and along the pipe.
      let vh = headingOf(this.vel);
      if (this.pipeAir && this.pipeIn) {
        const along = this.vel.x * this.pipeIn.ax + this.vel.z * this.pipeIn.az;
        const ins = Math.max(3, Math.abs(along) * 0.9);
        vh = Math.atan2(this.pipeIn.ax * along + this.pipeIn.x * ins, -(this.pipeIn.az * along + this.pipeIn.z * ins));
      }
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
      if (Math.abs(off) < 1.2 && Math.abs(this.flipVel) < 3) this.flipVel += -off * 10 * dt;
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
    if (this.grab && this.phantomT < 0) this.events.push({ type: 'grab', name: this.sport === 'ski' ? SKI_GRABS[this.grab] : this.grab, dt });

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
    else if (!(Math.abs(d) < T.landSpinTol * (this.pipeAir ? 1.15 : 1) || Math.abs(d) > Math.PI - T.landSpinTol * (this.pipeAir ? 1.15 : 1))) reason = 'Landed sideways!';
    else if (impact > T.landImpact) reason = 'Too hard a landing!';
    if (reason) { this.doCrash(reason); return; }
    this.switch = Math.abs(d) > Math.PI / 2;
    this.yaw = vh;
    // sloppy landings scrub speed
    const sloppy = Math.min(1, Math.abs(Math.abs(d) > Math.PI / 2 ? Math.PI - Math.abs(d) : d) / T.landSpinTol);
    this.vel.multiplyScalar((1 - 0.18 * sloppy * sloppy) * (1 - Math.min(0.25, impact * 0.012)));
    this.state = 'ride';
    this.grab = null; this.flip = 0; this.pipeAir = false;
    this.crouch = 0.7 + Math.min(0.3, impact / 30);
    this.landBump = Math.min(0.35, 0.08 + impact * 0.02);   // arms drop and swing with the landing
    this.events.push({ type: 'land', impact, switch: this.switch, sloppy });
  }

  doCrash(reason) {
    if (this.state === 'crash') return;
    this.state = 'crash';
    this.crashT = 0; this.getupT = -1;
    this.grab = null; this.phantomT = -1; this.rail = null; this.boardslide = 0; this.pipeAir = false;
    this.crashSpin.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 10);
    this.crashQ.copy(this.root.quaternion);
    if (reason.startsWith('Hit')) this.vel.multiplyScalar(-0.15);
    // keep crashes low: no upward launch, and cap the tumble speed
    this.vel.y = Math.min(this.vel.y, 1);
    const sp = this.vel.length();
    if (sp > TUNE.crashMaxSpeed) this.vel.multiplyScalar(TUNE.crashMaxSpeed / sp);
    this.events.push({ type: 'crash', reason });
  }

  _crash(dt) {
    this.crashT += dt;
    if (this.getupT >= 0) { this._getup(dt); return; }
    // tumble along the snow: stay on the ground, lose speed fast, never bounce high
    this.vel.y -= G * dt;
    this.pos.addScaledVector(this.vel, dt);
    const gh = this.terrain.heightAt(this.pos.x, this.pos.z);
    let onGround = false;
    if (this.pos.y < gh + 0.3) {
      onGround = true;
      this.pos.y = gh + 0.3;
      const n = this.terrain.normalAt(this.pos.x, this.pos.z);
      const vn = this.vel.dot(n);
      if (vn < 0) this.vel.addScaledVector(n, -vn * 1.12);          // tiny bounce
      const sp = this.vel.length();
      if (sp > 1e-3) this.vel.multiplyScalar(Math.max(0, sp - TUNE.crashFriction * dt) / sp);
      this.crashSpin.multiplyScalar(Math.exp(-2.6 * dt));
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
    // once we've stopped sliding, get back up
    if ((onGround && this.vel.length() < 1.5 && this.crashT > 0.9) || this.crashT > TUNE.crashTime) this._startGetup();
  }

  _startGetup() {
    this.getupT = 0;
    this.vel.set(0, 0, 0);
    this.spray = 0;
    this.getupFromQ = this.crashQ.clone();
    this.getupFromPos = this.pos.clone();
    // step out of any tree we ended up against
    for (let i = 0; i < 8; i++) {
      const t = this.terrain.treeNear(this.pos.x, this.pos.z);
      if (!t) break;
      const dx = this.pos.x - t.x, dz = this.pos.z - t.z, l = Math.hypot(dx, dz) || 1;
      this.pos.x += dx / l * 1.0; this.pos.z += dz / l * 1.0;
    }
    this.pos.y = this.terrain.heightAt(this.pos.x, this.pos.z);
    // face down the run we're on (or straight down the hill)
    const n = this.terrain.normalAt(this.pos.x, this.pos.z, this.normal);
    let dx = n.x, dz = n.z;
    const ra = this.terrain.runAt ? this.terrain.runAt(this.pos.x, this.pos.z) : null;
    if (ra && ra.d < ra.run.hw + 30) { const a = ra.run.at(ra.s + 8); dx = a.tx; dz = a.tz; }
    this.yaw = Math.atan2(dx, -dz);
    this.switch = false;
    this.alignQ.setFromUnitVectors(UP, n);
    this.getupToQ = this.alignQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(UP, -this.yaw));
  }

  _getup(dt) {
    this.getupT = Math.min(1, this.getupT + dt / TUNE.getupTime);
    if (this.getupT >= 1) {
      this.getupT = -1;
      this.state = 'ride';
      this.crouch = 0.5;
      this.vel.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(1.5);
      this.events.push({ type: 'recovered' });
    }
  }

  // ---------------- wingsuit ----------------
  // Leave the helicopter: glide with ↓ to dive (faster, steeper), ↑ to flare (slower, flatter, a short
  // swoop up if you're fast), ← → to bank and turn. Touch down anywhere and you're riding.
  startFlying(pos, yaw, speed) {
    this.state = 'fly';
    this.pos.copy(pos); this.yaw = yaw; this.flyYaw = yaw;
    this.flySpeed = speed; this.flyGamma = 0.5; this.flyBank = 0; this.flyDist = 0;
    this.vel.set(Math.sin(yaw) * speed, -speed * 0.3, -Math.cos(yaw) * speed);
    this.grab = null; this.phantomT = -1; this.crouch = 0; this.lean = 0; this.brakeAmt = 0; this.switch = false;
    this.gear.visible = false;
    this._wings(true);
    this.chute = false; this._canopy(false);
    this.flyJumpReady = false;     // the jump press that got you out of the helicopter doesn't count
  }

  // The parachute: a ram-air canopy above you on lines down to your shoulders.
  _canopy(on) {
    if (!this.canopy) {
      const g = new THREE.Group(), R = 4.2, n = 7;
      const cA = new THREE.MeshStandardMaterial({ color: 0xff8a1f, side: THREE.DoubleSide, flatShading: true, roughness: 0.6 });
      const cB = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, side: THREE.DoubleSide, flatShading: true, roughness: 0.6 });
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = -0.75 + 1.5 * i / (n - 1);
        const cell = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.32, 2.3), i % 2 ? cB : cA);
        cell.position.set(R * Math.sin(a), R * Math.cos(a) - R, 0); cell.rotation.z = -a; cell.castShadow = true;
        g.add(cell);
        for (const z of [-0.9, 0.9]) pts.push(new THREE.Vector3(R * Math.sin(a), R * Math.cos(a) - R - 0.16, z), new THREE.Vector3(Math.sign(a || 0.001) * 0.22, -3.25, 0));
      }
      const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x333333 }));
      g.add(lines);
      g.position.set(0, 1.45 + 3.25, 0);   // lines meet just above the shoulders
      this.root.add(g);
      this.canopy = g;
    }
    this.canopy.visible = on;
    this.canopyT = 0;
  }

  _openChute() {
    this.chute = true;
    this.gear.visible = true;           // clip back in for the landing
    this._wings(false);
    this._orientBody();
    this._canopy(true);
    this.events.push({ type: 'chute' });
  }

  _fly(dt, input) {
    const T = TUNE;
    const W0 = this.terrain, alt = this.pos.y - W0.heightAt(this.pos.x, this.pos.z);
    if (!input.jump) this.flyJumpReady = true;
    if (!this.chute && this.flyJumpReady && input.jump && alt > 1) this._openChute();   // jump button: pull the chute now
    if (!this.chute && alt < 15.24 && this.vel.y < 0) this._openChute();       // otherwise it opens by itself at 50 ft
    if (this.chute) {
      // under canopy: slow to a gentle glide and steer with ← →
      this.flyYaw += (input.steer || 0) * 0.9 * dt;
      this.flyBank = damp(this.flyBank, input.steer || 0, 3, dt);
      const h = Math.hypot(this.vel.x, this.vel.z), hs = damp(h, 9, 1.8, dt);
      // come down ~4 m/s toward the snow below you, even where the slope falls away under you
      const fx = Math.sin(this.flyYaw), fz = -Math.cos(this.flyYaw);
      const fall = Math.max(0, W0.heightAt(this.pos.x, this.pos.z) - W0.heightAt(this.pos.x + fx * 4, this.pos.z + fz * 4)) / 4;
      this.vel.set(fx * hs, damp(this.vel.y, -(4 + fall * hs), 4, dt), fz * hs);
      this.flySpeed = this.vel.length(); this.flyGamma = 0.3;
      this.pos.addScaledVector(this.vel, dt);
      this.flyDist += hs * dt;
      this.yaw = this.flyYaw; this.airYaw = this.flyYaw;
      this.canopyT = Math.min(1, (this.canopyT || 0) + dt / 0.7);
      return this._flyContact();
    }
    const pitch = (input.down ? 1 : 0) - (input.up ? 1 : 0);         // + = dive
    // glide angle (down from level): normal glide ~22 deg, dive 50 deg, flare can climb briefly when fast
    const fast = smoothstep(18, 32, this.flySpeed);
    let gWant = pitch > 0 ? 0.95 : pitch < 0 ? -0.28 * fast + 0.12 * (1 - fast) : 0.41;
    if (this.flySpeed < 13) gWant = Math.max(gWant, 0.55 + (13 - this.flySpeed) * 0.05);   // stalling: nose drops
    this.flyGamma = damp(this.flyGamma, gWant, 1.6, dt);
    this.flyBank = damp(this.flyBank, input.steer || 0, 3, dt);
    this.flyYaw += this.flyBank * 1.05 * dt;
    // speed: gravity along the glide path against drag
    this.flySpeed += (G * Math.sin(this.flyGamma) - 0.0042 * this.flySpeed * this.flySpeed) * dt;
    this.flySpeed = Math.max(8, Math.min(48, this.flySpeed));
    const cg = Math.cos(this.flyGamma), sg = Math.sin(this.flyGamma);
    this.vel.set(Math.sin(this.flyYaw) * cg * this.flySpeed, -sg * this.flySpeed, -Math.cos(this.flyYaw) * cg * this.flySpeed);
    this.pos.addScaledVector(this.vel, dt);
    this.flyDist += Math.hypot(this.vel.x, this.vel.z) * dt;
    this.yaw = this.flyYaw; this.airYaw = this.flyYaw;
    // stay over the mountain
    const W = this.terrain;
    if (Math.abs(this.pos.x) > -W.x0 - 40 || this.pos.z > W.z0 - 30) {
      // near the edge of the world: ease back toward the middle of the mountain
      const want = Math.atan2(-this.pos.x, -60);
      this.flyYaw += wrap(want - this.flyYaw) * 1.2 * dt;
    }
    this._flyContact();
  }

  // trees, towers and touching down (wingsuit or parachute)
  _flyContact() {
    const W = this.terrain;
    const t = W.treeNear(this.pos.x, this.pos.z);
    const gh = W.heightAt(this.pos.x, this.pos.z);
    if (t && this.pos.y < t.y + t.h) {
      if (this.chute) {
        // under the parachute you just brush past: slide round the trunk and lose a little speed
        let dx = this.pos.x - t.x, dz = this.pos.z - t.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        this.pos.x = t.x + dx * (t.r + 0.5); this.pos.z = t.z + dz * (t.r + 0.5);
        const vn = this.vel.x * dx + this.vel.z * dz;
        if (vn < 0) { this.vel.x -= dx * vn; this.vel.z -= dz * vn; }
        this.vel.x *= 0.7; this.vel.z *= 0.7;
        if (Math.hypot(this.vel.x, this.vel.z) > 0.3) this.flyYaw = headingOf(this.vel);
        else this.flyYaw = Math.atan2(dx, -dz);
      } else { this._endFlight(); this.doCrash(t.kind === 'tree' ? 'Flew into a tree!' : 'Flew into something!'); return; }
    }
    if (this.pos.y <= gh + 0.05) {
      this.pos.y = gh;
      const underChute = this.chute;
      this._endFlight();
      if (!underChute && this.flyGamma > 0.78 && this.flySpeed > 30) { this.doCrash('Came in too steep!'); return; }
      // touch down: carry the speed along the snow (capped so it's rideable)
      const n = W.normalAt(this.pos.x, this.pos.z, this.normal);
      this.vel.addScaledVector(n, -this.vel.dot(n));
      const sp = this.vel.length(), keep = Math.min(sp, 20);
      if (sp > 0.01) this.vel.multiplyScalar(keep / sp);
      this.state = 'ride'; this.crouch = 0.9;
      this.alignQ.setFromUnitVectors(UP, n);
      this.events.push({ type: 'fly-land', dist: this.flyDist });
    }
  }

  _endFlight() {
    this.chute = false; if (this.canopy) this.canopy.visible = false;
    this.gear.visible = true;
    this._wings(false);
    this._orientBody();
    this.events.push({ type: 'fly-end', dist: this.flyDist });
  }

  // wingsuit fabric between arms and body, and between the legs
  _wings(on) {
    if (!this.wingMesh) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9 * 3 * 2 + 6 * 3), 3));
      this.wingMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: this.mats.jacket.color, side: THREE.DoubleSide, flatShading: true, roughness: 0.7 }));
      this.wingMesh.castShadow = true; this.wingMesh.frustumCulled = false;
      this.body.add(this.wingMesh);
    }
    this.wingMesh.visible = on;
    this.wingMesh.material.color = this.mats.jacket.color;
  }

  _flyPose() {
    // standing-style pose in the body frame (the root lays the whole body flat, head first)
    this.body.rotation.y = Math.PI; this.body.updateMatrix();
    const hipC = new THREE.Vector3(0, 0.95, 0);
    this.hipC = hipC;
    const neck = hipC.clone().add(new THREE.Vector3(0, 0.58, 0.02));
    const feet = [new THREE.Vector3(0.32, 0.06, -0.06), new THREE.Vector3(-0.32, 0.06, -0.06)];
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const hip = hipC.clone().add(new THREE.Vector3(side * 0.12, 0, 0));
      const knee = hip.clone().lerp(feet[i], 0.5).add(new THREE.Vector3(0, 0, -0.03));
      placeLimb(this.thighs[i], hip, knee, 0.15); placeLimb(this.shins[i], knee, feet[i], 0.13);
      this.boots[i].position.copy(feet[i]); this.boots[i].scale.set(0.14, 0.1, 0.26); this.boots[i].quaternion.identity();
    }
    placeLimb(this.torso, hipC, neck, 0.34); this.torso.scale.z = 0.22;
    this.head.position.copy(neck).add(new THREE.Vector3(0, 0.16, 0.04));
    this.helmet.position.copy(this.head.position).add(new THREE.Vector3(0, 0.02, 0)); this.helmet.quaternion.identity();
    this.goggles.position.copy(this.head.position).add(new THREE.Vector3(0, 0.02, 0.13)); this.goggles.quaternion.identity();
    const sh = [neck.clone().add(new THREE.Vector3(0.21, -0.06, 0)), neck.clone().add(new THREE.Vector3(-0.21, -0.06, 0))];
    const flap = Math.sin(performance.now() / 260) * 0.04;
    const hands = [sh[0].clone().add(new THREE.Vector3(0.66, -0.18 + flap, -0.05)), sh[1].clone().add(new THREE.Vector3(-0.66, -0.18 - flap, -0.05))];
    for (let i = 0; i < 2; i++) {
      const elbow = sh[i].clone().lerp(hands[i], 0.5).add(new THREE.Vector3(0, 0.02, -0.04));
      placeLimb(this.upperArms[i], sh[i], elbow, 0.11); placeLimb(this.foreArms[i], elbow, hands[i], 0.1);
      this.hands[i].position.copy(hands[i]); this.hands[i].scale.set(0.1, 0.1, 0.1);
      this.handPos[i].copy(hands[i]);
      if (this.poles[i].visible) placeLimb(this.poles[i], hands[i], hands[i].clone().add(new THREE.Vector3(0, -0.9, -0.1)), 0.03);
    }
    // fabric: shoulder-hand-hip triangles (x2, as fans) and the panel between the legs
    const a = this.wingMesh.geometry.attributes.position, P = [];
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1, hipS = hipC.clone().add(new THREE.Vector3(side * 0.16, -0.15, 0));
      const mid = hands[i].clone().lerp(hipS, 0.5).add(new THREE.Vector3(0, 0, -0.04));
      P.push(sh[i], hands[i], mid, sh[i], mid, hipS, sh[i], hipS, hipC.clone().add(new THREE.Vector3(side * 0.05, 0.2, 0)));
    }
    P.push(hipC.clone().add(new THREE.Vector3(0.14, -0.1, 0)), feet[0], feet[1], hipC.clone().add(new THREE.Vector3(0.14, -0.1, 0)), feet[1], hipC.clone().add(new THREE.Vector3(-0.14, -0.1, 0)));
    P.forEach((v, k) => a.setXYZ(k, v.x, v.y, v.z));
    a.needsUpdate = true; this.wingMesh.geometry.computeVertexNormals();
  }

  // ---------------- rails and boxes ----------------
  // Lock onto a rail, box or log. Riding straight onto one locks on by itself; holding the grind
  // button (E / stick click) pulls you on from further away (and with left/right, into a boardslide).
  _tryRail(input = {}) {
    const rails = this.terrain.rails;
    if (!rails) return;
    const magnet = !!input.grind;
    // no grind button, no grind: run into a rail, box or log and you go down
    if (!magnet) { if (this.state === 'ride' && !this.npc) this._railBump(); return; }
    const p = this.pos, v = this.vel, vh = Math.hypot(v.x, v.z);
    if (vh < 2 || v.y > (magnet ? 4 : 2.5)) return;
    for (const r of rails) {
      const dx = p.x - r.p0.x, dz = p.z - r.p0.z;
      if (dx * dx + dz * dz > (r.lenH + 3) * (r.lenH + 3)) continue;
      const u = (dx * r.dirH.x + dz * r.dirH.z) / r.lenH;
      if (u < 0.02 || u > 0.97) continue;
      const lat = Math.abs(-dx * r.dirH.z + dz * r.dirH.x);
      if (lat > r.halfW + (magnet ? 1.3 : 0.35)) continue;
      const ry = r.p0.y + (r.p1.y - r.p0.y) * u;
      const dy = p.y - ry;
      if (dy < -(r.snapBelow || 0.45) - (magnet ? 0.5 : 0) || dy > (magnet ? 1.6 : 0.75)) continue;
      const along = (v.x * r.dirH.x + v.z * r.dirH.z) / vh;
      if (Math.abs(along) < (magnet ? 0.35 : 0.6)) continue;
      this._startGrind(r, u, along, magnet ? Math.sign(Math.abs(input.steer) > 0.3 ? input.steer : 0) : null);
      return;
    }
  }

  _railBump() {
    const p = this.pos;
    if (Math.hypot(this.vel.x, this.vel.z) < 1.5) return;
    for (const r of this.terrain.rails) {
      const dx = p.x - r.p0.x, dz = p.z - r.p0.z;
      if (dx * dx + dz * dz > (r.lenH + 2) * (r.lenH + 2)) continue;
      const u = (dx * r.dirH.x + dz * r.dirH.z) / r.lenH;
      if (u < -0.01 || u > 1.01) continue;
      const lat = Math.abs(-dx * r.dirH.z + dz * r.dirH.x);
      if (lat > r.halfW + 0.22) continue;
      const ry = r.p0.y + (r.p1.y - r.p0.y) * Math.max(0, Math.min(1, u)) + r.top;
      if (p.y > ry - 0.1 || p.y < ry - 1.4) continue;
      this.doCrash(r.kind === 'log' ? 'Hit the log! Hold grind to ride it' : r.kind === 'box' ? 'Hit the box! Hold grind to slide it' : 'Hit the rail! Hold grind to ride it');
      return;
    }
  }

  _startGrind(r, u, along, slideChoice = null) {
    const wasAir = this.state === 'air';
    const railHead = Math.atan2(r.dirH.x * Math.sign(along), -r.dirH.z * Math.sign(along));
    // board across the rail = boardslide; along it = 50-50 (forwards or switch)
    const boardYaw = wasAir ? this.airYaw : this.yaw + (this.switch ? Math.PI : 0);
    const d = wrap(boardYaw - railHead);
    this.boardslide = slideChoice !== null ? slideChoice : (Math.abs(Math.abs(d) - Math.PI / 2) < 0.6 ? Math.sign(d) : 0);
    this.switch = !this.boardslide && Math.abs(d) > Math.PI / 2;
    this.state = 'grind';
    this.rail = r;
    this.railU = u * r.len;
    this.railV = this.vel.dot(r.dir3);
    this.yaw = railHead;
    this.flip = 0; this.flipVel = 0; this.grab = null; this.phantomT = -1;
    this._slideLatch = true;
    this.events.push({ type: 'grind-start', fromAir: wasAir });
  }

  _grind(dt, input) {
    const r = this.rail;
    this.railV += -G * r.dir3.y * dt;                                   // gravity along the rail
    this.railV -= Math.sign(this.railV) * Math.min(Math.abs(this.railV), TUNE.railFriction * dt);
    this.railU += this.railV * dt;
    // left/right while grinding swaps between 50-50 and boardslide
    if (!input.steer) this._slideLatch = false;
    else if (!this._slideLatch) { this._slideLatch = true; this.boardslide = this.boardslide ? 0 : Math.sign(input.steer); }
    this.pos.copy(r.p0).addScaledVector(r.dir3, this.railU); this.pos.y += r.top;
    this.vel.copy(r.dir3).multiplyScalar(this.railV);
    this.crouch = damp(this.crouch, 0.35, 8, dt); this.lean = damp(this.lean, 0, 8, dt);
    this.brakeAmt = 0; this.spray = 0;
    const ski = this.sport === 'ski';
    const name = r.kind === 'box' ? (this.boardslide ? 'Box Slide' : 'Box 50-50')
      : r.kind === 'log' ? (this.boardslide ? 'Log Slide' : 'Log Ride')
      : (this.boardslide ? (ski ? 'Rail Slide' : 'Boardslide') : (ski ? 'Ski 50-50' : '50-50'));
    this.events.push({ type: 'grind', name, dt });
    // pop off with a jump, or ride off the end
    if (input.jump) this.charge = Math.min(1, this.charge + dt / TUNE.chargeTime);
    if (!input.jump && this.charge > 0) {
      this.vel.y += TUNE.jumpBase + TUNE.jumpCharge * this.charge * 0.7; this.charge = 0;
      this.railCooldown = 0.4; this._takeoff(true, true); return;
    }
    if (this.railU < 0 || this.railU > r.len || Math.abs(this.railV) < 0.4) {
      this.vel.y += 0.8; this.pos.y += 0.05;
      this.railCooldown = 0.4; this._takeoff(false, true);
    }
  }

  // ---------------- visuals ----------------
  updateVisual(dt, input) {
    const root = this.root;
    if (this.state === 'lift') {
      // seated on a chair: seat point + facing direction come from the lift
      if (this.sitT === undefined) { this.sitT = 1; this.sitE = 1; }
      this.sitT = Math.min(1, this.sitT + dt / 0.8);
      const e = this.sitE = this.sitT * this.sitT * (3 - 2 * this.sitT);
      const head = Math.atan2(this.liftDir.x, this.liftDir.z);
      const q = new THREE.Quaternion().setFromAxisAngle(UP, head - this.body.rotation.y);
      this._updatePose(dt, input);
      const hip = this.hipC.clone().applyAxisAngle(UP, head);
      const p = this.liftSeat.clone().sub(hip);
      if (e < 1 && this.sitFromPos) {
        // the seat comes up behind you: sit back and down onto it
        root.quaternion.slerpQuaternions(this.sitFromQ, q, Math.min(1, e * 1.4));
        root.position.lerpVectors(this.sitFromPos, p, e);
      } else { root.quaternion.copy(q); root.position.copy(p); }
      this.pos.copy(root.position);
      return;
    }
    root.position.copy(this.pos);
    if (this.state === 'fly' && this.chute) {
      // hanging under the canopy, upright, swinging a little into turns
      const q = new THREE.Quaternion().setFromAxisAngle(UP, -this.yaw)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -this.flyBank * 0.25));
      root.quaternion.copy(q); root.position.copy(this.pos);
      const e = this.canopyT * this.canopyT * (3 - 2 * this.canopyT);
      this.canopy.scale.set(0.15 + 0.85 * e, 0.3 + 0.7 * e, 0.3 + 0.7 * e);
      this._updatePose(dt, {});
      return;
    }
    if (this.state === 'fly') {
      // lie flat, head first along the flight path, nose a little down when diving, banked into turns
      const F = new THREE.Vector3(Math.sin(this.flyYaw), -Math.sin(this.flyGamma * 0.45 + 0.05), -Math.cos(this.flyYaw)).normalize();
      const upW = new THREE.Vector3(0, 1, 0).addScaledVector(F, -F.y).normalize();
      upW.applyAxisAngle(F, this.flyBank * 0.7);     // bank into the turn (right turn = right wing down)
      const X = new THREE.Vector3().crossVectors(F, upW).normalize();
      // root axes: +y -> forward (head), +z -> up (back), so the body's chest (root -z) faces the snow
      root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, F, upW));
      root.position.copy(this.pos);
      this._flyPose();
      return;
    }
    if (this.state === 'crash' && this.getupT >= 0) {
      const e = this.getupT * this.getupT * (3 - 2 * this.getupT);
      root.quaternion.slerpQuaternions(this.getupFromQ, this.getupToQ, e);
      root.position.lerpVectors(this.getupFromPos, this.pos, e);
    } else if (this.state === 'crash') {
      root.quaternion.copy(this.crashQ);
    } else {
      const onSnow = this.state === 'ride' || this.state === 'grind';
      // follow the slope down the fall line of your travel, but stay upright across it: riding across a
      // hill, the board tips onto its uphill edge and your body stays vertical instead of sticking out sideways
      // (on steep banks -- gully walls, the halfpipe -- you lean with the wall instead, like a real rider)
      let alignN = UP;
      if (this.state === 'ride') {
        const sx = Math.cos(this.yaw), sz = Math.sin(this.yaw);        // horizontal, across your travel
        const k = this.normal.x * sx + this.normal.z * sz;
        const inPipe = this.terrain.pipeAt && this.terrain.pipeAt(this.pos.x, this.pos.z);
        const upright = inPipe ? 0 : 0.9 * (1 - smoothstep(0.38, 0.72, Math.abs(k)));
        alignN = this._alignN || (this._alignN = new THREE.Vector3());
        alignN.set(this.normal.x - upright * k * sx, this.normal.y, this.normal.z - upright * k * sz).normalize();
      }
      // out of a halfpipe wall: stay tipped in line with the wall so you come back down ready to ride it
      const pipeFly = this.state === 'air' && this.pipeAir && this.pipeN;
      if (pipeFly) alignN = this.pipeN;
      const targetAlign = new THREE.Quaternion().setFromUnitVectors(UP, alignN);
      this.alignQ.slerp(targetAlign, 1 - Math.exp(-(onSnow ? 18 : pipeFly ? 6 : 3) * dt));
      const q = new THREE.Quaternion();
      if (onSnow) {
        // brake: skid the board sideways onto the edge you were riding (toe or heel)
        const faceSign = (this.regular ? 1 : -1) * (this.switch ? -1 : 1);
        const brakeTwist = this.sport === 'ski' ? this.brakeAmt * 1.25 * (this.brakeSide || 1) : this.brakeAmt * 1.25 * faceSign * this.brakeEdge;
        const vis = this.yaw + (this.switch ? Math.PI : 0) + brakeTwist + this.boardslide * Math.PI / 2;
        const leanSign = this.switch ? -1 : 1;
        const lean = this.sport === 'ski'
          ? -this.lean * leanSign - this.brakeAmt * 0.3 * (this.brakeSide || 1) * leanSign
          : -this.lean * leanSign + this.brakeAmt * 0.25 * faceSign * this.brakeEdge * leanSign;
        q.copy(this.alignQ)
          .multiply(new THREE.Quaternion().setFromAxisAngle(UP, -vis))
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), lean));
      } else {
        q.setFromAxisAngle(this.flipAxis, this.flip)
          .multiply(this.alignQ)
          .multiply(new THREE.Quaternion().setFromAxisAngle(UP, -this.airYaw));
      }
      root.quaternion.copy(q);
      if (this.state === 'ride' && this.standT < 1) {
        // getting off the chair: slide forward off the seat and stand up
        this.standT = Math.min(1, this.standT + dt / 0.9);
        const e = this.standT * this.standT * (3 - 2 * this.standT);
        root.quaternion.slerpQuaternions(this.standFromQ, q, e);
        root.position.lerpVectors(this.standFromPos, this.pos, e);
      }
    }
    this._updatePose(dt, input);
  }
}
