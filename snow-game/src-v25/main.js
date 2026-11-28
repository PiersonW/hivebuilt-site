// Game setup and main loop.
import * as THREE from 'three';
import { Terrain, BASE_Z, LODGE, RIDGE_TOP, EXPRESS_TOP, LIFT_BOTTOMS, BACKSIDE_TOP } from './terrain.js';
import { setupSky, buildRange, buildLodge } from './scenery.js';
import { Rider } from './rider.js';
import { TrickTracker } from './tricks.js';
import { Input } from './input.js';
import { ChaseCam } from './camera.js';
import { Hud, fmtTime } from './hud.js';
import { Chairlift } from './lift.js';
import { Recorder, Replayer } from './replay.js';
import { TrailMap } from './trailmap.js';
import { BTN } from './input.js';
import { Npcs } from './npcs.js';
import { Helicopter } from './heli.js';
import { Achievements } from './achievements.js';
import { Race, fmtRace } from './race.js';
import { LongJump } from './longjump.js';
import { Music } from './music.js';
import { LONG_JUMP } from './terrain.js';
import { YETI, PIPE } from './terrain.js';
import { SKI_GRABS } from './rider.js';
import { TreeLOD } from './trees.js';
import { Sfx } from './sfx.js';
import { Comps, COMPS, COMP_BY_ID, PRIZES, FINISH_PRIZE, ACH_PRIZE, fmtValue, ordinal, money } from './comps.js';

// ---------- renderer / scene ----------
const canvas = document.getElementById('game');
// Xbox (Edge on the console): lighter graphics so it stays smooth. ?gfx=high / ?gfx=low override.
const IS_XBOX = /Xbox/i.test(navigator.userAgent || '');
const gfxParam = new URLSearchParams(location.search).get('gfx');
const LOW_GFX = gfxParam ? gfxParam === 'low' : IS_XBOX;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !LOW_GFX });
renderer.setPixelRatio(LOW_GFX ? 1 : Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = !LOW_GFX;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5;

// if the graphics chip resets (Xbox when it runs short of memory), reload cleanly instead of coming back
// half-drawn (all-white materials); your records, money and settings are saved in the browser
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  const n = document.createElement('div'); n.className = 'gfx-reset'; n.textContent = 'Graphics reset, reloading…'; document.body.appendChild(n);
  setTimeout(() => location.reload(), 1500);
});
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 15000);

// sky, sunlight and haze
const { sun: SUN_DIR } = setupSky(scene, renderer, { elevation: 30, azimuth: 205, low: LOW_GFX });
scene.fog = new THREE.FogExp2(0xa9c3e0, 0.00038);
const hemi = new THREE.HemisphereLight(0xdfeaff, 0x7a8aa8, 0.3);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0dc, 4.2);
sun.castShadow = !LOW_GFX;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera; sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 400;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
const SUN_OFFSET = SUN_DIR.clone().multiplyScalar(150);

// lifts (defined first so the forest leaves their lines open)
const LIFTS = [
  { name: 'Summit Express', bottom: new THREE.Vector3(LIFT_BOTTOMS.express.x, 0, LIFT_BOTTOMS.express.z), top: new THREE.Vector3(EXPRESS_TOP.x, 0, EXPRESS_TOP.z), speed: 13 },
  { name: 'Ridge Lift', bottom: new THREE.Vector3(LIFT_BOTTOMS.ridge.x, 0, LIFT_BOTTOMS.ridge.z), top: new THREE.Vector3(RIDGE_TOP.x, 0, RIDGE_TOP.z + 6), speed: 10 },
  { name: 'Backside Lift', bottom: new THREE.Vector3(LIFT_BOTTOMS.backside.x, 0, LIFT_BOTTOMS.backside.z), top: new THREE.Vector3(BACKSIDE_TOP.x, 0, BACKSIDE_TOP.z), speed: 10 },
];
const terrain = new Terrain(scene, { sunDir: SUN_DIR, shadowRes: LOW_GFX ? 1.5 : 1.0, treeSpacing: LOW_GFX ? 12 : 9.5, liftLines: LIFTS.map(l => [l.bottom, l.top]) });
buildRange(scene, terrain);
// detailed pine models for the trees near the camera
const treeLod = new TreeLOD(scene, terrain, { radius: LOW_GFX ? 60 : 115, max: LOW_GFX ? 300 : 900 });
buildLodge(scene, terrain, LODGE.x, LODGE.z);
for (const dx of [-9.5, 0, 9.5]) terrain.addObstacle(-40 + dx, BASE_Z - 68, 6.5, 12, 'lodge');
const lifts = LIFTS.map(l => new Chairlift(scene, terrain, l.bottom, l.top, { name: l.name, speed: l.speed }));
let curLift = lifts[0];
const trailMap = new TrailMap(terrain, lifts);
document.getElementById('map-wrap').appendChild(trailMap.canvas);

const rider = new Rider(scene, terrain);
const heli = new Helicopter(scene);
const race = new Race(scene, terrain);
const longJump = new LongJump(terrain);
// background music (original pop-punk): starts on the first click / key / controller press (browser rule)
const music = new Music();
const musicBtns = [document.getElementById('btn-music'), document.getElementById('btn-music-lift')];
function showMusicState() { for (const b of musicBtns) b.classList.toggle('on', music.enabled); }
function toggleMusic() { music.toggle(); showMusicState(); }
for (const b of musicBtns) b.onclick = (e) => { e.stopPropagation(); toggleMusic(); };
showMusicState();
// sound effects (own on/off: 🔊 button or B)
const sfx = new Sfx();
const sfxBtns = [document.getElementById('btn-sfx'), document.getElementById('btn-sfx-lift')];
function showSfxState() { for (const b of sfxBtns) b.classList.toggle('on', sfx.enabled); }
function toggleSfx() { sfx.toggle(); showSfxState(); }
for (const b of sfxBtns) b.onclick = (e) => { e.stopPropagation(); toggleSfx(); };
showSfxState();
const kickMusic = () => { music.start(); sfx.start(); };
window.addEventListener('pointerdown', kickMusic);
window.addEventListener('keydown', (e) => { if (e.code !== 'KeyN' && e.code !== 'KeyB') kickMusic(); });
const ach = new Achievements(document.getElementById('ach-toast'));
// competitions at the lodge, and the money you win (saved in this browser)
const comps = new Comps();
const cashToastEl = document.getElementById('cash-toast');
let cashToastT = 0;
function showCash() { for (const el of document.querySelectorAll('.cash-amt')) el.textContent = money(comps.cash); }
comps.onCash = (n) => { showCash(); cashToastEl.innerHTML = `+${money(n)}<small>💰 ${money(comps.cash)}</small>`; cashToastEl.classList.remove('hidden'); cashToastT = 3; };
ach.onUnlock = () => comps.addCash(ACH_PRIZE);
showCash();
// other skiers and snowboarders, on the runs and on the chairs
const npcs = new Npcs(scene, terrain, {
  count: LOW_GFX ? 7 : 14, lifts, laneEntrance,
  playerChair: () => (game.mode === 'liftwait' || game.mode === 'lift') ? { lift: curLift, index: chairIdx } : null,
});
const ghost = new Rider(scene, terrain);        // model used for highlight replays
const recorder = new Recorder();
const replayer = new Replayer(ghost);
const tricks = new TrickTracker();
const input = new Input();
const chase = new ChaseCam(camera, terrain);
const hud = new Hud();

// soft dark spot under the rider when live shadows are off (Xbox / low graphics)
const blob = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, 'rgba(20,30,60,0.55)'); grd.addColorStop(1, 'rgba(20,30,60,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 1; m.visible = LOW_GFX;
  scene.add(m);
  return m;
})();

// ---------- snow spray particles ----------
const MAXP = 600;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(MAXP * 3);
const pVel = new Float32Array(MAXP * 3);
const pLife = new Float32Array(MAXP);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
const flake = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'); const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
})();
const pMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.2, map: flake, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, fog: false });
const points = new THREE.Points(pGeo, pMat);
points.frustumCulled = false;
scene.add(points);
let pNext = 0;
let powderAcc = 0;
function emit(n, pos, vel, spread) {
  for (let i = 0; i < n; i++) {
    const k = pNext; pNext = (pNext + 1) % MAXP;
    pPos[k * 3] = pos.x + (Math.random() - 0.5) * 0.6; pPos[k * 3 + 1] = pos.y + 0.05; pPos[k * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.6;
    pVel[k * 3] = vel.x * 0.4 + (Math.random() - 0.5) * spread;
    pVel[k * 3 + 1] = 1.2 + Math.random() * spread * 0.8;
    pVel[k * 3 + 2] = vel.z * 0.4 + (Math.random() - 0.5) * spread;
    pLife[k] = 0.5 + Math.random() * 0.5;
  }
}
function updateParticles(dt) {
  for (let k = 0; k < MAXP; k++) {
    if (pLife[k] <= 0) { pPos[k * 3 + 1] = -9999; continue; }
    pLife[k] -= dt;
    pVel[k * 3 + 1] -= 6 * dt;
    pPos[k * 3] += pVel[k * 3] * dt; pPos[k * 3 + 1] += pVel[k * 3 + 1] * dt; pPos[k * 3 + 2] += pVel[k * 3 + 2] * dt;
  }
  pGeo.attributes.position.needsUpdate = true;
}

// ---------- powder clouds (riding off the groomed runs) ----------
const MAXD = LOW_GFX ? 160 : 360;
const dGeo = new THREE.BufferGeometry();
const dPos = new Float32Array(MAXD * 3), dVel = new Float32Array(MAXD * 3), dLife = new Float32Array(MAXD);
dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
const dMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.1, map: flake, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
const dPoints = new THREE.Points(dGeo, dMat); dPoints.frustumCulled = false; scene.add(dPoints);
let dNext = 0;
function emitPowder(n, pos, vel, up = 1.5) {
  for (let i = 0; i < n; i++) {
    const k = dNext; dNext = (dNext + 1) % MAXD;
    dPos[k * 3] = pos.x + (Math.random() - 0.5) * 0.8; dPos[k * 3 + 1] = pos.y + 0.15; dPos[k * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.8;
    dVel[k * 3] = vel.x * 0.25 + (Math.random() - 0.5) * 2.2;
    dVel[k * 3 + 1] = up * (0.6 + Math.random());
    dVel[k * 3 + 2] = vel.z * 0.25 + (Math.random() - 0.5) * 2.2;
    dLife[k] = 0.9 + Math.random() * 0.8;
  }
}
function updatePowder(dt) {
  for (let k = 0; k < MAXD; k++) {
    if (dLife[k] <= 0) { dPos[k * 3 + 1] = -9999; continue; }
    dLife[k] -= dt;
    const drag = Math.exp(-1.6 * dt);
    dVel[k * 3] *= drag; dVel[k * 3 + 2] *= drag; dVel[k * 3 + 1] = dVel[k * 3 + 1] * drag - 1.2 * dt;   // hangs in the air
    dPos[k * 3] += dVel[k * 3] * dt; dPos[k * 3 + 1] += dVel[k * 3 + 1] * dt; dPos[k * 3 + 2] += dVel[k * 3 + 2] * dt;
  }
  dGeo.attributes.position.needsUpdate = true;
}

// ---------- game state ----------
const menuEl = document.getElementById('menu');
const game = {
  mode: 'menu',      // menu | run | liftwait | lift
  regular: true,
  score: 0, time: 0, crashes: 0, bestTrick: null, tricksLanded: 0, started: false,
};
window.__game = { sfx, treeLod, comps, enterComp: (id) => enterComp(id), openLodge: () => openLodge(), getComp: () => comp, music, longJump, race, ach, npcs, scene, renderer, IS_XBOX, LOW_GFX, game, rider, terrain, tricks, input, chase, camera, lifts, laneEntrance, recorder, replayer, startLift: (i) => startLift(lifts[i]), endRun: (i) => endRun(lifts[i]) }; // handy for debugging in the console

function setStance(regular) {
  game.regular = regular;
  document.getElementById('btn-regular').classList.toggle('on', regular);
  document.getElementById('btn-goofy').classList.toggle('on', !regular);
  rider.setStance(regular);
}
// snowboarder or skier
function setSport(sport) {
  game.sport = sport;
  document.getElementById('btn-board').classList.toggle('on', sport === 'board');
  document.getElementById('btn-ski').classList.toggle('on', sport === 'ski');
  document.getElementById('stance-row').classList.toggle('disabled', sport === 'ski');
  rider.setSport(sport);
  try { localStorage.setItem('snowSport', sport); } catch {}
}
setStance(true);
setSport((() => { try { return localStorage.getItem('snowSport') || 'board'; } catch { return 'board'; } })());
document.getElementById('btn-board').onclick = () => setSport('board');
document.getElementById('btn-ski').onclick = () => setSport('ski');

// Start a run at the top (or at `at`, e.g. the lift unload point).
function startRun(at = null, yaw = 0) {
  game.mode = 'run';
  comp = null; compHudEl.classList.add('hidden');
  // drop keyboard focus from the menu (a focused button or the name box would eat the arrow keys)
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  race.reset(); raceHudEl.classList.add('hidden');
  game.paused = false; game.runsVisited = []; game.score = 0; game.time = 0; game.crashes = 0; game.bestTrick = null; game.tricksLanded = 0; game.started = false;
  rider.topSpeed = 0;
  rider.reset(at || terrain.spawnPoint(), yaw);
  rider.events.length = 0;
  tricks.reset();
  recorder.reset();
  recorder.sport = game.sport; recorder.regular = game.regular;
  replayer.stop();
  chase.snap(rider);
  menuEl.classList.add('hidden');
  liftEl.classList.add('hidden');
  glide = null;
  hud.show(true);
  hud.clearPopups();
  runCamBlend = null;
}

// ---------- helicopter drop ----------
const heliUi = document.getElementById('heli-ui');
// the how-to for the drop shows only until you've jumped once (remembered in this browser)
let heliSeen = false;
try { heliSeen = localStorage.getItem('snowHeliSeen') === '1'; } catch {}
if (ach.has('heli')) heliSeen = true;      // you've done it before
let heliCam = 0;
function startHeli() {
  startRun();
  game.mode = 'heli';
  hud.show(false);
  heliUi.classList.toggle('hidden', heliSeen);
  // the helicopter flies itself back and forth along the top ridge, from the right side to the left
  const z = -25, a = new THREE.Vector3(330, 0, z), b = new THREE.Vector3(-330, 0, z);
  const start = new THREE.Vector3(300, terrain.heightAt(300, z) + 140, z);
  heli.patrol(terrain, a, b, start);
  rider.state = 'heli';
  rider.flip = 0; rider.alignQ.identity();
  heliCam = { yaw: 0.35, pitch: 0.32, t: 0 };
}
function updateHeliMode(dt, inp) {
  if (inp.menuPressed) { showMenu(); return; }
  const d = heli.door();
  rider.pos.copy(d.pos); rider.yaw = Math.atan2(d.out.x, -d.out.z); rider.airYaw = rider.yaw;
  rider.updateVisual(dt, {});
  // camera: well out from the helicopter so you see all of it and the mountain; arrows / right stick / mouse look around
  const k = (c) => input.keys.has(c);
  const lx = (k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0) + (inp.lookX || 0) + (inp.steer && !k('ArrowLeft') && !k('ArrowRight') ? inp.steer : 0);
  const ly = (k('ArrowUp') ? 1 : 0) - (k('ArrowDown') ? 1 : 0) - (inp.lookY || 0);
  heliCam.yaw -= lx * 1.4 * dt + (inp.mouseX || 0) * 0.005;
  heliCam.pitch = Math.max(-0.25, Math.min(1.2, heliCam.pitch + ly * 1.0 * dt + (inp.mouseY || 0) * 0.004));
  heliCam.t += dt;
  const c = heli.group.position, D = 32;
  // yaw 0 = looking down the mountain from behind the helicopter's uphill side
  const cp = new THREE.Vector3(c.x + Math.sin(heliCam.yaw) * Math.cos(heliCam.pitch) * D, c.y + Math.sin(heliCam.pitch) * D, c.z + Math.cos(heliCam.yaw) * Math.cos(heliCam.pitch) * D);
  cp.y = Math.max(cp.y, terrain.heightAt(cp.x, cp.z) + 3);
  camera.position.lerp(cp, heliCam.t < 0.05 ? 1 : 1 - Math.exp(-6 * dt));
  camera.lookAt(c.x, c.y - 6, c.z);
  if (Math.abs(camera.fov - 62) > 0.1) { camera.fov = 62; camera.updateProjectionMatrix(); }
  if (inp.confirmPressed || inp.taps.has('Space') || inp.padTaps.has(BTN.A)) {
    heliUi.classList.add('hidden');
    if (!heliSeen) { heliSeen = true; try { localStorage.setItem('snowHeliSeen', '1'); } catch {} }
    // dive out the downhill door, carrying the helicopter's speed
    const f = new THREE.Vector3(Math.sin(heli.yaw), 0, -Math.cos(heli.yaw));
    const dir = d.out.clone().multiplyScalar(14).addScaledVector(f, heli.speed);
    heli.leave();
    sfx.jumpOut();
    rider.startFlying(d.pos, Math.atan2(dir.x, -dir.z), Math.min(22, dir.length()));
    game.mode = 'run'; hud.show(true);
    chase.snap(rider);
    ach.unlock('heli');
  }
}

// ---------- right stick: swing the camera round you; let go and it eases back behind you ----------
const stickLook = { yaw: 0, pitch: 0 };
function applyStickLook(dt, inp, skip) {
  const lx = inp.lookX || 0, ly = inp.lookY || 0;
  if (!skip && (Math.abs(lx) > 0.05 || Math.abs(ly) > 0.05)) {
    stickLook.yaw = Math.max(-Math.PI, Math.min(Math.PI, stickLook.yaw - lx * 2.6 * dt));
    stickLook.pitch = Math.max(-0.25, Math.min(0.95, stickLook.pitch - ly * 1.6 * dt));
  } else {
    const k = 1 - Math.exp(-5 * dt);
    stickLook.yaw -= stickLook.yaw * k; stickLook.pitch -= stickLook.pitch * k;
  }
  if (Math.abs(stickLook.yaw) < 1e-3 && Math.abs(stickLook.pitch) < 1e-3) return;
  const t = rider.pos.clone(); t.y += 1;
  const off = camera.position.clone().sub(t);
  off.applyAxisAngle(new THREE.Vector3(0, 1, 0), stickLook.yaw);
  const hd = Math.hypot(off.x, off.z), d = off.length(), el = Math.atan2(off.y, hd) + stickLook.pitch;
  const e = Math.max(-0.2, Math.min(1.3, el));
  off.set(off.x / (hd || 1) * Math.cos(e) * d, Math.sin(e) * d, off.z / (hd || 1) * Math.cos(e) * d);
  camera.position.copy(t).add(off);
  camera.position.y = Math.max(camera.position.y, terrain.heightAt(camera.position.x, camera.position.z) + 0.8);
  camera.lookAt(t);
}

// ---------- look around (Shift + arrows when stopped or under the parachute) ----------
const freeLook = { on: false, blend: 0, yaw: 0, pitch: 0.3 };
let helpRideT = 0;
function updateFreeLook(dt, inp, looking) {
  if (looking && !freeLook.on) {
    // start from where the camera is now
    const d = camera.position.clone().sub(rider.pos);
    freeLook.yaw = Math.atan2(d.x, d.z);
    freeLook.pitch = Math.max(0.05, Math.min(1.2, Math.atan2(d.y, Math.hypot(d.x, d.z))));
  }
  freeLook.on = looking;
  freeLook.blend = Math.max(0, Math.min(1, freeLook.blend + (looking ? dt / 0.35 : -dt / 0.45)));
  if (!looking) return;
  const lx = (inp.steer || 0) + (inp.lookX || 0), ly = (inp.up ? 1 : 0) - (inp.down ? 1 : 0) - (inp.lookY || 0);
  freeLook.yaw -= lx * 1.7 * dt + (inp.mouseX || 0) * 0.005;
  freeLook.pitch = Math.max(-0.15, Math.min(1.3, freeLook.pitch + ly * 1.2 * dt + (inp.mouseY || 0) * 0.004));
}
function applyFreeLook(dt) {
  if (freeLook.blend <= 0) return;
  const D = rider.state === 'fly' ? 11 : 7.5, t = rider.pos.clone(); t.y += 1;
  const cp = t.clone().add(new THREE.Vector3(Math.sin(freeLook.yaw) * Math.cos(freeLook.pitch), Math.sin(freeLook.pitch), Math.cos(freeLook.yaw) * Math.cos(freeLook.pitch)).multiplyScalar(D));
  cp.y = Math.max(cp.y, terrain.heightAt(cp.x, cp.z) + 1);
  const chasePos = camera.position.clone(), chaseQ = camera.quaternion.clone();
  camera.position.copy(cp); camera.lookAt(t);
  const e = freeLook.blend * freeLook.blend * (3 - 2 * freeLook.blend);
  camera.position.lerpVectors(chasePos, cp, e);
  camera.quaternion.slerpQuaternions(chaseQ, camera.quaternion.clone(), e);
}

// ---------- racing ----------
const raceHudEl = document.getElementById('race-hud'), raceResultEl = document.getElementById('race-result');
const nameEl = document.getElementById('racer-name');
try { nameEl.value = localStorage.getItem('snowRacerName') || ''; } catch {}
nameEl.addEventListener('change', () => { try { localStorage.setItem('snowRacerName', nameEl.value.trim()); } catch {} });
const racerName = () => nameEl.value.trim() || 'Player';
let raceResultT = 0, raceDelta = null;
function updateRace(dt) {
  for (const ev of race.update(dt, rider, racerName(), game.sport)) {
    if (ev.type === 'start') { hud.popup('GO!', 0); raceDelta = null; if (comp && comp.id === 'race') comp.state = 'live'; }
    else if (ev.type === 'gate') raceDelta = ev.delta;
    else if (ev.type === 'miss') { hud.popup('Missed gate <small>+2 s</small>', 0, true); raceDelta = ev.delta; }
    else if (ev.type === 'abort') { hud.popup(`Race over: ${ev.why}`, 0, true); if (comp && comp.id === 'race' && comp.state !== 'done') finishComp(null, ev.why); }
    else if (ev.type === 'finish') {
      const head = ev.pr ? (ev.prev === null ? 'First time on the board!' : `New personal best! (was ${fmtRace(ev.prev)})`) : `Your best: ${fmtRace(race.best)}`;
      raceResultEl.innerHTML = `<h2>🏁 ${fmtRace(ev.time)}</h2><div class="${ev.pr ? 'pr' : ''}">${head}</div>` +
        `<div class="muted">${ev.missed ? `${ev.missed} missed gate${ev.missed > 1 ? 's' : ''} (+${ev.missed * 2} s)` : 'Clean run, every gate'}</div>` +
        `<div class="panel-title" style="margin-top:10px">Fastest on this device</div>${race.leaderboardHtml(ev.time)}`;
      raceResultEl.classList.remove('hidden'); raceResultT = 8;
      ach.unlock('race_finish');
      if (!ev.missed) ach.unlock('race_clean');
      if (ev.pr && ev.prev !== null) ach.unlock('race_pr');
      if (!ev.missed && ev.time < 50) ach.unlock('race_fast');
      if (comp && comp.id === 'race' && comp.state !== 'done') finishComp(ev.time);
    }
  }
  if (race.state === 'running') {
    const pb = race.best !== null ? `<small>Best ${fmtRace(race.best)}</small>` : '';
    const d = raceDelta === null ? '' : `<small class="${raceDelta < 0 ? 'ahead' : 'behind'}">${raceDelta < 0 ? '−' : '+'}${Math.abs(raceDelta).toFixed(2)}</small>`;
    raceHudEl.innerHTML = `🏁 ${fmtRace(race.t + race.penalty)}<small>Gate ${Math.min(race.next + 1, race.gates.length)} / ${race.gates.length}</small>${d}${pb}`;
    raceHudEl.classList.remove('hidden');
  } else raceHudEl.classList.add('hidden');
  if (raceResultT > 0) { raceResultT -= dt; if (raceResultT <= 0) raceResultEl.classList.add('hidden'); }
}

// ---------- long jump ----------
function showJumpResult(r) {
  if (r.dist === null) { hud.popup('Long jump: landed off the hill, no distance', 0, true); return; }
  const head = r.record && r.prevHill !== null ? `🏆 New hill record! (was ${r.prevHill.toFixed(1)} m)`
    : r.pb ? (r.prevMine === null ? 'Your first mark on the board!' : `New personal best! (was ${r.prevMine.toFixed(1)} m)`)
    : `Your best: ${longJump.bestFor(racerName()).toFixed(1)} m`;
  raceResultEl.innerHTML = `<h2>🎿 ${r.dist.toFixed(1)} m</h2><div class="${r.pb ? 'pr' : ''}">${head}</div>` +
    `<div class="muted">K-point ${LONG_JUMP.K} m · takeoff ${Math.round(longJump.takeoffSpeed * 2.237)} mph</div>` +
    `<div class="panel-title" style="margin-top:10px">Longest jumps on this device</div>${longJump.boardHtml(r.dist)}`;
  raceResultEl.classList.remove('hidden'); raceResultT = 8;
  ach.unlock('jump_land');
  if (r.dist >= LONG_JUMP.K) ach.unlock('jump_k');
  if (r.dist >= 120) ach.unlock('jump_far');
  if (r.dist >= 140) ach.unlock('jump_fly');
}
// on the inrun: show the hill record and your best
function updateJumpHud() {
  if (race.state === 'running') return;
  const w = rider.state === 'ride' ? terrain.jumpWeight(rider.pos.x, rider.pos.z) : null;
  if (w && w.k > 0.5 && w.u < LONG_JUMP.edgeU) {
    const mine = longJump.bestFor(racerName()), rec = longJump.best;
    raceHudEl.innerHTML = `🎿 LONG JUMP · ${Math.round(rider.speed * 2.237)} mph<small>${rec !== null ? `Hill record ${rec.toFixed(1)} m` : 'No record yet'}${mine !== null ? ` · your best ${mine.toFixed(1)} m` : ''}</small><small>hold ↓ to tuck, jump at the blue lip, then hold ↑ in the air to fly</small>`;
    raceHudEl.classList.remove('hidden');
  } else if (race.state !== 'running') raceHudEl.classList.add('hidden');
}

// ---------- competitions (sign up at the Base Lodge) ----------
const compHudEl = document.getElementById('comp-hud');
const lodgeEl = document.getElementById('lodge-panel'), lodgeHintEl = document.getElementById('lodge-hint');
let comp = null;          // { id, state: 'ready' | 'live' | 'done', score, stillT, offT }
let lodgeSel = 0;
const parkRun = terrain.runById.park, parkIdx = terrain.runs.indexOf(parkRun);
const PARK_START_S = 28, PARK_FINISH_S = parkRun.sAtZ(-975);      // the entrance banner .. just above the halfpipe
const LODGE_FRONT = new THREE.Vector3(LODGE.x, 0, LODGE.z + 13);
const yawAlong = (x, z) => Math.atan2(x, -z);

// where each competition starts
function compStart(id) {
  let x, z, yaw;
  if (id === 'pipe') { const P = terrain.pipe; x = P.ox - P.ax * 14; z = P.oz - P.az * 14; yaw = yawAlong(P.ax, P.az); }
  else if (id === 'park') { const a = parkRun.at(PARK_START_S - 14); x = a.x; z = a.z; yaw = yawAlong(a.tx, a.tz); }
  else if (id === 'jump') { const J = terrain.jump; x = J.ox + J.ax * 3; z = J.oz + J.az * 3; yaw = yawAlong(J.ax, J.az); }
  else { const a = race.line(race.startS - 14); x = a.x; z = a.z; yaw = yawAlong(a.tx, a.tz); }
  return { pos: new THREE.Vector3(x, terrain.heightAt(x, z), z), yaw };
}

function enterComp(id) {
  const c = COMP_BY_ID[id], st = compStart(id);
  lodgeEl.classList.add('hidden'); lodgeHintEl.classList.add('hidden');
  startRun(st.pos, st.yaw);
  rider.vel.set(Math.sin(st.yaw), 0, -Math.cos(st.yaw)).multiplyScalar(1.5);
  game.holdJump = true;
  comp = { id, state: 'ready', score: 0, stillT: 0, offT: 0 };
  raceResultEl.classList.add('hidden'); raceResultT = 0;
  hud.popup(`${c.icon} ${c.name} competition`, 0);
}

function finishComp(value, why = null) {
  const c = COMP_BY_ID[comp.id];
  comp.state = 'done';
  const r = comps.finish(comp.id, value, racerName(), game.sport);
  const mine = value === null ? null : { value, name: racerName(), sport: game.sport };
  const medal = r.place === 1 ? '🥇' : r.place === 2 ? '🥈' : r.place === 3 ? '🥉' : c.icon;
  let html = value === null
    ? `<h2>${c.icon} Did not finish</h2><div class="muted">${why || ''}</div>`
    : `<h2>${medal} ${ordinal(r.place)} place · ${fmtValue(c, value)}</h2>` +
      `<div class="pr">+${money(r.prize)} prize money · wallet ${money(comps.cash)}</div>` +
      `<div class="${r.pb ? 'pr' : 'muted'}">${r.pb ? (r.prev === null ? 'Your first result in this event!' : `Personal best! (was ${fmtValue(c, r.prev)})`) : `Your best: ${fmtValue(c, comps.data.best[comp.id].value)}`}</div>`;
  html += `<div class="panel-title" style="margin-top:10px">${c.name} standings</div>${comps.boardHtml(comp.id, mine)}` +
    `<div class="muted">${input.padName ? 'Menu button' : 'R'}: try again · ${input.padName ? 'View' : 'Esc'}: menu (pick another event at the lodge)</div>`;
  raceResultEl.innerHTML = html;
  raceResultEl.classList.remove('hidden'); raceResultT = 14;
  compHudEl.classList.add('hidden');
}
function cancelComp(why) { hud.popup(`${COMP_BY_ID[comp.id].name} comp cancelled: ${why}`, 0, true); comp = null; compHudEl.classList.add('hidden'); }

// every frame while riding in a competition: start, finish, and the score on screen
function updateComp(dt) {
  if (!comp || comp.state === 'done') return;
  const c = COMP_BY_ID[comp.id], p = rider.pos, onSnow = rider.state === 'ride';
  const busy = rider.state === 'air' || rider.state === 'grind' || rider.state === 'crash';
  let line = '';
  if (comp.id === 'pipe') {
    const P = terrain.pipe, pc = pipeCoords(p);
    if (comp.state === 'ready') {
      if (pc.u > 0 && Math.abs(pc.l) < PIPE.outer) comp.state = 'live';
      else if (pc.u < -60 || Math.abs(pc.l) > 60) { cancelComp('Left the halfpipe'); return; }
      line = 'Drop in! Ride down the pipe and land tricks off the walls';
    } else {
      comp.stillT = onSnow && rider.speed < 0.8 ? comp.stillT + dt : 0;
      const out = pc.u > P.L + 3 || Math.abs(pc.l) > PIPE.outer + 8;
      if ((out || comp.stillT > 4) && !busy) { finishComp(comp.score > 0 ? comp.score : null, 'No tricks landed'); return; }
      line = `${Math.max(0, Math.round(P.L - pc.u))} m of pipe left`;
    }
  } else if (comp.id === 'park') {
    const q = terrain._q(p.x, p.z), s = terrain.runS[parkIdx][q], d = terrain.runDist[parkIdx][q];
    comp.offT = d > parkRun.hw + 35 ? comp.offT + dt : 0;
    if (comp.offT > 3) { if (comp.state === 'live') finishComp(null, 'Left the course'); else cancelComp('Left the park'); return; }
    if (comp.state === 'ready') { if (s > PARK_START_S) comp.state = 'live'; line = 'Go through the orange banner to start'; }
    else {
      if (s > PARK_FINISH_S && !busy) { finishComp(comp.score > 0 ? comp.score : null, 'No tricks landed'); return; }
      line = `${Math.max(0, Math.round(PARK_FINISH_S - s))} m to the finish (above the halfpipe)`;
    }
  } else if (comp.id === 'jump') {
    const w = terrain.jumpWeight(p.x, p.z);
    if (comp.state === 'ready') {
      if (!terrain.nearJump(p.x, p.z, 20)) { cancelComp('Left the jump hill'); return; }
      if (w && w.u > LONG_JUMP.edgeU + 8 && onSnow) { finishComp(null, 'Rolled past the lip without jumping'); return; }
      line = 'Tuck (↓) down the inrun, jump at the blue lip, hold ↑ in the air';
    } else line = 'Fly! Hold ↑, then land it on the hill';
  } else if (comp.id === 'race') {
    if (comp.state === 'ready') {
      const a = race.startLine;
      if (Math.hypot(p.x - a.x, p.z - a.z) > 120) { cancelComp('Left the start area'); return; }
      line = 'Ride through the start gate, then every pair of flags';
    } else line = 'Every gate! Missed gates add 2 s';
  }
  const leader = fmtValue(c, comps.standings(comp.id, null)[0].value);
  const score = comp.id === 'pipe' || comp.id === 'park' ? ` · ${Math.round(comp.score).toLocaleString()} pts` : '';
  compHudEl.innerHTML = `${c.icon} ${c.name.toUpperCase()} COMP${score}<small>Leader ${leader} · ${line}</small>`;
  compHudEl.classList.remove('hidden');
}

// the lodge: ride up to the front door, stop, and press Enter / A
function updateLodgeDoor(inp) {
  const d = Math.hypot(rider.pos.x - LODGE_FRONT.x, rider.pos.z - LODGE_FRONT.z);
  const near = d < 45 && !comp;
  const atDoor = d < 11 && rider.state === 'ride' && rider.speed < 2.5 && !comp;
  // ride right up to the front door (any speed) and you go straight in
  const dx = rider.pos.x - LODGE.x, dz = rider.pos.z - LODGE.z;
  if (!comp && rider.state === 'ride' && Math.abs(dx) < 6 && dz > 6 && dz < 10.5) { openLodge(); return; }
  if (near) {
    lodgeHintEl.innerHTML = atDoor ? `🏠 Base Lodge · <b>${input.padName ? 'A' : 'Enter'}</b> to sign up for competitions`
      : '🏠 Base Lodge: ride up to the front door to sign up for competitions';
    lodgeHintEl.classList.remove('hidden');
  } else lodgeHintEl.classList.add('hidden');
  if (atDoor && inp.confirmPressed) openLodge();
}

function openLodge() {
  game.mode = 'lodge';
  comp = null; compHudEl.classList.add('hidden'); lodgeHintEl.classList.add('hidden');
  race.reset(); raceHudEl.classList.add('hidden'); raceResultEl.classList.add('hidden');
  heli.hide(); heliUi.classList.add('hidden'); replayer.stop(); liftEl.classList.add('hidden'); menuEl.classList.add('hidden');
  hud.show(false);
  const p = LODGE_FRONT.clone(); p.y = terrain.heightAt(p.x, p.z);
  rider.reset(p, Math.PI);
  rider.updateVisual(0, {});
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  renderLodge();
  lodgeEl.classList.remove('hidden');
}
function closeLodge() {
  lodgeEl.classList.add('hidden');
  const p = LODGE_FRONT.clone(); p.y = terrain.heightAt(p.x, p.z);
  startRun(p, Math.PI);
  game.holdJump = true;
}

function renderLodge() {
  showCash();
  const usePad = !!input.padName || IS_XBOX;
  document.getElementById('lodge-cards').innerHTML = COMPS.map((c, i) => {
    const b = comps.data.best[c.id];
    const lead = comps.standings(c.id, null)[0];
    return `<button class="comp-card ${i === lodgeSel ? 'sel' : ''}" data-i="${i}"><span class="comp-icon">${c.icon}</span><b>${c.name}</b>` +
      `<span>Leader: ${lead.me ? 'You' : lead.name} · ${fmtValue(c, lead.value)}</span>` +
      `<span class="${b ? 'mine' : ''}">${b ? `Your best: ${fmtValue(c, b.value)} (${ordinal(b.place)})` : 'Not entered yet'}</span></button>`;
  }).join('');
  document.querySelectorAll('.comp-card').forEach(el => el.onclick = () => { const i = +el.dataset.i; if (i === lodgeSel) enterComp(COMPS[i].id); else { lodgeSel = i; renderLodge(); } });
  const c = COMPS[lodgeSel];
  document.getElementById('lodge-detail').innerHTML = `<div class="comp-desc">${c.icon} <b>${c.name}</b> · ${c.desc}</div>` +
    `<div class="muted">Prizes: ${PRIZES.map((v, i) => `${ordinal(i + 1)} ${money(v)}`).join(' · ')} · finishing ${money(FINISH_PRIZE)} · each achievement ${money(ACH_PRIZE)}</div>` +
    comps.boardHtml(c.id, null);
  document.getElementById('lodge-enter').textContent = `Sign up: ${c.name}`;
  document.getElementById('lodge-help').innerHTML = usePad ? '🎮 D-pad pick · <b>A</b> sign up · <b>B</b> back outside' : '← → pick · <b>Enter</b> sign up · <b>Esc</b> back outside · or click';
}

function updateLodge(dt, inp) {
  const pad = (...b) => b.some(i => inp.padTaps.has(i));
  const n = COMPS.length;
  if (inp.leftPressed || inp.upPressed) { lodgeSel = (lodgeSel + n - 1) % n; renderLodge(); }
  if (inp.rightPressed || inp.downPressed) { lodgeSel = (lodgeSel + 1) % n; renderLodge(); }
  if (inp.confirmPressed) { enterComp(COMPS[lodgeSel].id); return; }
  if (inp.menuPressed || pad(BTN.B)) { closeLodge(); return; }
  // camera: out in front of the lodge, looking at the door
  const t = performance.now() / 9000;
  camera.position.set(LODGE.x + 14 + Math.sin(t) * 3, terrain.heightAt(LODGE.x, LODGE.z + 30) + 6, LODGE.z + 32);
  camera.lookAt(LODGE.x, terrain.heightAt(LODGE.x, LODGE.z) + 3.5, LODGE.z + 4);
  if (Math.abs(camera.fov - 62) > 0.1) { camera.fov = 62; camera.updateProjectionMatrix(); }
  rider.updateVisual(dt, {});
}
document.getElementById('lodge-enter').onclick = () => enterComp(COMPS[lodgeSel].id);
document.getElementById('lodge-close').onclick = () => closeLodge();

// ---------- achievements ----------
const achPanel = document.getElementById('ach-panel');
let achOpen = false;
function toggleAch(on) {
  achOpen = on;
  if (on) ach.render(document.getElementById('ach-body'));
  achPanel.classList.toggle('hidden', !on);
}
const BOARD_GRAB = { ...Object.fromEntries(Object.entries(SKI_GRABS).map(([b, s]) => [s, b])), Indy: 'Indy', Melon: 'Melon', Method: 'Method', 'Nose Grab': 'Nose Grab' };
let airCtx = null;
const chuteRun = terrain.runById.chute, chuteIdx = terrain.runs.indexOf(chuteRun);
function pipeCoords(p) { const P = terrain.pipe; const dx = p.x - P.ox, dz = p.z - P.oz; return { u: dx * P.ax + dz * P.az, l: dx * P.cx + dz * P.cz }; }
function placeCtx(p) {
  const q = terrain._q(p.x, p.z);
  return { pos: p.clone(), land: terrain.landformAt(p.x, p.z), rock: terrain.snowRockIndex(p.x, p.z), lifts: lifts.map(l => l.laneCoords(p.x, p.z)),
    chuteD: terrain.runDist[chuteIdx][q], chuteS: terrain.runS[chuteIdx][q], pipe: pipeCoords(p) };
}
function onTakeoffAch() { airCtx = placeCtx(rider.pos); airCtx.pipeAir = rider.pipeAir; airCtx.lipMax = 0; }
function onLandAch(res, parts, airTime) {
  if (airTime > 0.4) ach.unlock('first_air');
  for (const p of parts) {
    const n = p.name;
    const deg = parseInt(n, 10);
    if (deg >= 180) ach.unlock('spin180');
    if (deg >= 360) ach.unlock('spin360');
    if (deg >= 540) ach.unlock('spin540');
    if (deg >= 720) ach.unlock('spin720');
    if (deg >= 1080) ach.unlock('spin1080');
    if (n.includes('Backflip')) ach.unlock('backflip');
    if (n.includes('Front Flip')) ach.unlock('frontflip');
    if (/Double|Triple|\dx /.test(n) && n.includes('lip')) ach.unlock('double');
    if (n.includes('Phantom')) ach.unlock('phantom');
    if (BOARD_GRAB[n]) ach.addToSet('grabs', BOARD_GRAB[n]);
    if (/50-50|Slide|Boardslide|Log/.test(n)) ach.unlock('grind');
    if (/Slide|Boardslide/.test(n)) ach.unlock('slide');
    if (n.startsWith('Log')) ach.unlock('log');
  }
  if (res && res.mult >= 3) ach.unlock('combo3');
  if (airTime >= 2.5) ach.unlock('hang');
  if (!airCtx) return;
  const a = airCtx, b = placeCtx(rider.pos);
  if (a.pipeAir && airTime > 0.3) { ach.unlock('pipe'); if (a.lipMax >= 3) ach.unlock('pipe_big'); }
  if (a.rock >= 0 && airTime > 0.4) ach.addToSet('rocks', a.rock);
  if (a.land.ridge && a.land.ridge.v > -5 && a.land.ridge.v < 5 && airTime > 0.5) ach.unlock('ridge');
  if (a.land.cliff && a.land.cliff.v > -8 && a.land.cliff.v < 3 && b.land.cliff && b.land.cliff.i === a.land.cliff.i && b.land.cliff.v > 4) { ach.unlock('cliff'); ach.addToSet('cliffs', 'c' + a.land.cliff.i); }
  if (a.chuteD < chuteRun.hw + 8 && a.chuteS > chuteRun.cliffS - 14 && a.chuteS < chuteRun.cliffS + 1.5 && b.chuteS > chuteRun.cliffS + 3) {
    ach.unlock('cliff'); ach.addToSet('cliffs', 'chute');
    if (b.chuteS > chuteRun.cliffS + 25) ach.unlock('gap_chute');
  }
  lifts.forEach((l, i) => {
    const c0 = a.lifts[i], c1 = b.lifts[i];
    if (c0.d > 15 && c0.d < l.length - 15 && c1.d > 15 && c1.d < l.length - 15 && Math.sign(c0.l) !== Math.sign(c1.l) && Math.abs(c0.l) > 4 && Math.abs(c1.l) > 4) ach.unlock('gap_lift');
  });
  const g0 = a.land.gully, g1 = b.land.gully;
  if (g0 && g1 && g0.i === g1.i && g0.side !== g1.side && g0.d > g0.hw - 4 && g1.d > g1.hw - 4) ach.unlock('gap_gully');
  const P = terrain.pipe, lip = PIPE.fw + PIPE.wallW - 1;
  if (a.pipe.u > 0 && a.pipe.u < P.L && b.pipe.u > 0 && b.pipe.u < P.L && Math.abs(a.pipe.l) > lip && Math.abs(b.pipe.l) > lip && Math.sign(a.pipe.l) !== Math.sign(b.pipe.l)) ach.unlock('gap_pipe');
  if (a.pipe.u > 0 && a.pipe.u < P.L && Math.abs(a.pipe.l) > PIPE.fw + PIPE.wallW + 0.5 && Math.abs(a.pipe.l) < PIPE.outer && Math.abs(b.pipe.l) > PIPE.outer + 2) ach.unlock('cliffhanger');
}
// every frame while riding
const gullyTime = [0, 0, 0, 0, 0, 0];
function trackAch(dt) {
  const st = rider.state;
  if ((st === 'ride' || st === 'air') && rider.speed >= 64.5 / 2.237) ach.unlock('speed');
  if (game.score >= 10000) ach.unlock('score10k');
  if (st === 'air' && airCtx && airCtx.pipeAir) airCtx.lipMax = Math.max(airCtx.lipMax, rider.pos.y - terrain.terrainHeight(rider.pos.x, rider.pos.z) - PIPE.H);
  if (st === 'ride') {
    if (terrain.groomAt(rider.pos.x, rider.pos.z) < 0.3) ach.addCount('powder', rider.speed * dt);
    const g = terrain.landformAt(rider.pos.x, rider.pos.z).gully;
    if (g && g.d < g.hw * 0.8) {
      gullyTime[g.i] += dt;
      if (g.i < 3 && gullyTime[g.i] > 2) ach.addToSet('gullies', 'g' + g.i);
      if (g.i >= 3 && gullyTime[g.i] > 1.5) { ach.unlock('bowl_chute'); ach.addToSet('bowl_chutes', 'c' + g.i); }    // backside chutes
    }
    if (rider.pos.z > 140) ach.unlock('bowl');
  }
  if (Math.hypot(rider.pos.x - YETI.x, rider.pos.z - YETI.z) < 14) ach.unlock('yeti');
  const last = game.runsVisited[game.runsVisited.length - 1];
  if (last && last.t > 3) ach.addToSet('runs', last.id);
}

// ---------- chairlift ride ----------
const liftEl = document.getElementById('lift-ui');
const replayEl = document.getElementById('replay-ui');
const liftCam = { yaw: 0, pitch: -0.3 };
let chairIdx = 0, hlSel = 0;

// Get on lift `l`. With glide, the rider slides from where they are into the loading spot first.
let glide = null;
function startLift(l = lifts[0], doGlide = false) {
  curLift = l;
  if (race.state === 'running') race.abort();
  comp = null; compHudEl.classList.add('hidden'); lodgeHintEl.classList.add('hidden');
  raceHudEl.classList.add('hidden');
  document.querySelector('#lift-ui .lift-name').textContent = '🚡 ' + l.name;
  game.mode = 'liftwait';
  hud.show(false);
  liftEl.classList.remove('hidden');
  replayEl.classList.add('hidden');
  const loadYaw = Math.atan2(curLift.f.x, -curLift.f.z);
  // you wait at the end of the ropes, just behind the bull wheel where no chair passes
  loading = { phase: 'wait', uP: WAIT_U, ahead: -1 };
  if (doGlide) {
    glide = { from: rider.pos.clone(), yaw0: rider.yaw, yaw1: loadYaw, t: 0 };
    rider.reset(rider.pos.clone(), rider.yaw);
  } else {
    glide = null;
    rider.reset(linePoint(curLift, WAIT_U), loadYaw);
    chase.snap(rider);
  }
  rider.vel.set(0, 0, 0);
  chairIdx = -1;
  hlSel = 0;
  renderHighlights();
  document.getElementById('lift-status').textContent = doGlide ? 'Getting in line…' : 'Wait for the chair…';
}

// Loading like a real detachable lift: chairs bunch up ~3 m apart through the station, so you step out
// right behind a chair as it passes, follow it to the load spot, and the next chair scoops you up.
const WAIT_U = -3.2;
let loading = null;
function linePoint(l, u) {
  const p = l.bottom.clone().addScaledVector(l.f, u).addScaledVector(l.p, 2.3);
  p.y = terrain.heightAt(p.x, p.z);
  return p;
}
// distance of chair i past the start of the up line (negative = still coming round the bull wheel)
function chairDu(l, i) { const u = l.chairU(i); return u > l.total / 2 ? u - l.total : u; }
function updateLoading(dt) {
  const l = curLift, L = loading, n = l.chairs.length;
  const FOLLOW_GAP = l.slowSpeed * (l.period / n) / 2;      // half the gap between chairs in the station
  if (L.phase === 'wait') {
    // a chair just coming round the wheel: step out behind it
    for (let i = 0; i < n; i++) { const du = chairDu(l, i); if (du > WAIT_U + FOLLOW_GAP && du < WAIT_U + FOLLOW_GAP + 0.8) { L.ahead = i; L.phase = 'follow'; break; } }
    if (L.phase === 'wait') { animatePush(dt, false); document.getElementById('lift-status').textContent = 'Wait for the chair in front to pass…'; return; }
    chairIdx = (L.ahead - 1 + n) % n;     // the chair behind it is yours
  }
  if (L.phase === 'follow') {
    const want = Math.min(l.loadU, chairDu(l, L.ahead) - FOLLOW_GAP);
    const prev = L.uP;
    L.uP = Math.max(L.uP, want);
    rider.pos.copy(linePoint(l, L.uP));
    rider.yaw = Math.atan2(l.f.x, -l.f.z);
    rider.vel.copy(l.f).multiplyScalar((L.uP - prev) / Math.max(dt, 1e-4));
    terrain.normalAt(rider.pos.x, rider.pos.z, rider.normal);
    document.getElementById('lift-status').textContent = L.uP >= l.loadU - 0.01 ? 'Sit back as the chair comes…' : 'Follow the chair to the blue line…';
    animatePush(dt, L.uP - prev > 0.0005);
    if (L.uP >= l.loadU - 0.01) { L.phase = 'ready'; rider.vel.set(0, 0, 0); }
  }
  if (L.phase === 'ready') animatePush(dt, false);
}

// shuffle along in the lift line with the same one-foot push (or poles) you use on flats
function animatePush(dt, moving) {
  rider.pushAmt += ((moving ? 1 : 0) - rider.pushAmt) * (1 - Math.exp(-6 * dt));
  if (rider.pushAmt > 0.02) rider.pushPhase = (rider.pushPhase + dt * 1.3) % 1; else rider.pushPhase = 0;
}

function updateGlide(dt) {
  animatePush(dt, true);
  glide.t = Math.min(1, glide.t + dt / 1.1);
  const e = glide.t * glide.t * (3 - 2 * glide.t);
  const p = glide.from.clone().lerp(linePoint(curLift, WAIT_U), e);
  p.y = terrain.heightAt(p.x, p.z);
  let dy = glide.yaw1 - glide.yaw0; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
  rider.pos.copy(p); rider.yaw = glide.yaw0 + dy * e;
  rider.vel.set(Math.sin(rider.yaw), 0, -Math.cos(rider.yaw)).multiplyScalar(1 * (1 - e) + 0.01);
  terrain.normalAt(p.x, p.z, rider.normal);
  rider.brakeAmt = 0;
  if (glide.t >= 1) {
    glide = null; rider.brakeAmt = 0; rider.vel.set(0, 0, 0);
  }
  return;
}

// Riding into a lift line ends the run.
function endRun(l) {
  recorder.finishRun();
  const rows = [
    ['Time', fmtTime(game.time)],
    ['Score', game.score.toLocaleString()],
    ['Runs', runsSummary() || '—'],
    ['Best trick', game.bestTrick ? `${game.bestTrick.name} (${game.bestTrick.points.toLocaleString()})` : '—'],
    ['Top speed', `${Math.round(rider.topSpeed * 2.237)} mph`],
    ['Crashes', game.crashes],
  ];
  document.getElementById('run-summary').innerHTML = '<div class="panel-title">Last run</div><table>' + rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('') + '</table>';
  startLift(l, true);
}

// Near the base: which lift is closest, how far, and which way (relative to the camera).
const liftGuideEl = document.getElementById('lift-guide');
const pushHintEl = document.getElementById('push-hint');
const pushHint = { t: 0 };
let inLane = null;
// where the lift line starts (between the ropes, at the back of the line)
function laneEntrance(l) { return l.bottom.clone().addScaledVector(l.f, l.lane.d0 - 3).addScaledVector(l.p, (l.lane.l0 + l.lane.l1) / 2); }
// flying tips only on your first couple of flights; after that just the height
let flightCount = 0;
try { flightCount = +(localStorage.getItem('snowFlights') || 0); } catch {}
let flightTips = flightCount < 2 && !ach.has('heli');
function updateLiftGuide() {
  if (rider.state !== 'fly') {
    let near = Infinity;
    for (const l of lifts) { const e = laneEntrance(l); near = Math.min(near, Math.hypot(e.x - rider.pos.x, e.z - rider.pos.z)); }
    if (near > 230 && !inLane) { liftGuideEl.classList.add('hidden'); return; }
  }
  if (rider.state === 'fly') {
    const above = Math.max(0, rider.pos.y - terrain.heightAt(rider.pos.x, rider.pos.z));
    const ft = Math.round(above * 3.281);
    liftGuideEl.innerHTML = rider.chute
      ? `🪂 ${ft} ft` + (flightTips ? `<br><small>← → steer · hold Shift + arrows to look around · you'll touch down and ride away</small>` : '')
      : `🦅 ${ft} ft` + (flightTips ? `<br><small>↓ dive · ↑ flare · ← → turn · Space / A opens the parachute (it opens by itself at 50 ft)</small>` : '');
    liftGuideEl.classList.remove('hidden');
    return;
  }

  if (inLane) {
    liftGuideEl.innerHTML = `🚡 ${inLane.name}<br><small>Ride to the end of the ropes, then follow the chair in front</small>`;
    liftGuideEl.classList.remove('hidden');
    return;
  }
  let best = null, bd = Infinity, target = null;
  for (const l of lifts) { const e = laneEntrance(l); const d = Math.hypot(e.x - rider.pos.x, e.z - rider.pos.z); if (d < bd) { bd = d; best = l; target = e; } }
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  const toL = new THREE.Vector3(target.x - rider.pos.x, 0, target.z - rider.pos.z);
  const ang = Math.atan2(fwd.x * toL.z - fwd.z * toL.x, fwd.x * toL.x + fwd.z * toL.z);   // + = to the right
  const arrows = ['⬆', '↗', '➡', '↘', '⬇', '↙', '⬅', '↖'];
  const k = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
  liftGuideEl.innerHTML = `<span class="arrow">${arrows[k]}</span> 🚡 ${best.name} · ${Math.round(bd)} m<br><small>Ride into the lift line (between the orange ropes)</small>`;
  liftGuideEl.classList.remove('hidden');
}

let camBlend = null;   // eases the camera from the lift line over to the chair view
function boardChair() {
  game.mode = 'lift';
  ach.addToSet('lifts', curLift.name);
  rider.beginSit();
  camBlend = { t: 0, pos: camera.position.clone(), quat: camera.quaternion.clone() };
  // look up the mountain along the cable, with the chairs ahead in view
  const d = curLift.f.clone().addScaledVector(curLift.p, -0.12);
  liftCam.yaw = Math.atan2(d.x, d.z); liftCam.pitch = 0.04;
}

function skipLift() {
  if (game.mode === 'liftwait') { if (chairIdx < 0) chairIdx = curLift.nextChairToLoad().index; glide = null; boardChair(); }
  if (replayer.active) stopReplay();
  curLift.setChairU(chairIdx, curLift.unloadU);
}

// At the top: stand up and slide off the chair the way it was going, then turn wherever you like.
let runCamBlend = null;
function unload() {
  const p = curLift.unloadPoint.clone();
  const fromPos = rider.root.position.clone(), fromQ = rider.root.quaternion.clone();
  const camPos = camera.position.clone(), camQ = camera.quaternion.clone();
  const f = curLift.f;
  startRun(p, Math.atan2(f.x, -f.z));
  rider.vel.set(f.x, 0, f.z).multiplyScalar(2.5);
  rider.beginStand(fromPos, fromQ);
  rider.updateVisual(0, {});
  runCamBlend = { t: 0, pos: camPos, quat: camQ };
}

function renderHighlights() {
  const list = document.getElementById('hl-list');
  const hs = recorder.highlights;
  if (!hs.length) { list.innerHTML = '<p class="muted">No landed tricks this run yet. Hit a kicker!</p>'; return; }
  const usePad = !!input.padName || IS_XBOX;
  list.innerHTML = hs.map((h, i) => `<button class="hl ${i === hlSel ? 'sel' : ''}" data-i="${i}"><b>${i + 1}</b> ${h.name}<span>${h.points.toLocaleString()}</span>${usePad && i === hlSel ? '<em class="pad-badge">Ⓐ play</em>' : ''}</button>`).join('');
  list.querySelectorAll('.hl').forEach(b => b.onclick = () => playHighlight(+b.dataset.i));
}

// lift screen help: controller buttons when a controller is in use, keys otherwise
let liftHelpPad = null;
function updateLiftHelp() {
  const usePad = !!input.padName || IS_XBOX;
  if (usePad === liftHelpPad) return;
  liftHelpPad = usePad;
  document.getElementById('lift-hint').innerHTML = usePad
    ? '🎮 <b>D-pad ↑ ↓</b> pick a highlight · <b>A</b> play it · <b>B</b> stop · <b>RB</b> show/hide highlights · <b>LB</b> map · <b>Y</b> achievements · <b>right stick</b> look around · <b>Menu</b> skip to the top'
    : 'Look around: arrow keys, drag the mouse, or right stick · M / LB map · H / RB highlights · 1 / 2 / 3 replay · T / Y achievements · Enter / Menu skip to the top';
  document.getElementById('hl-help').innerHTML = usePad ? '🎮 D-pad ↑ ↓ to pick, <b>A</b> to play · in the replay: X slow-mo, Y camera, B back' : '1 / 2 / 3 or click to replay';
  renderHighlights();
}

function playHighlight(i) {
  const h = recorder.highlights[i];
  if (!h) return;
  hlSel = i;
  replayer.start(h);
  replayEl.classList.remove('hidden');
  liftEl.classList.add('replaying');
  updateReplayBar();
}

function stopReplay() {
  replayer.stop();
  replayEl.classList.add('hidden');
  liftEl.classList.remove('replaying');
  renderHighlights();
}

function updateReplayBar() {
  const h = recorder.highlights[hlSel];
  document.getElementById('replay-title').textContent = `Replay: ${h.name} · ${h.points.toLocaleString()}`;
  document.getElementById('replay-speed').textContent = replayer.slow ? 'Slow-mo' : 'Normal speed';
  document.getElementById('replay-cam').textContent = replayer.camMode === 'orbit' ? 'Orbit camera' : 'Follow camera';
}

document.getElementById('btn-skip').onclick = () => skipLift();
// show / hide the trail map and the highlights panel (remembered between visits)
const panelPref = (() => { try { return JSON.parse(localStorage.getItem('snowPanels') || '{}'); } catch { return {}; } })();
function applyPanels() {
  liftEl.classList.toggle('hide-map', panelPref.map === false);
  liftEl.classList.toggle('hide-hl', panelPref.hl === false);
  document.getElementById('btn-map').classList.toggle('on', panelPref.map !== false);
  document.getElementById('btn-hl').classList.toggle('on', panelPref.hl !== false);
}
function togglePanel(which) {
  panelPref[which] = panelPref[which] === false;
  try { localStorage.setItem('snowPanels', JSON.stringify(panelPref)); } catch {}
  applyPanels();
}
document.getElementById('btn-map').onclick = () => togglePanel('map');
document.getElementById('btn-hl').onclick = () => togglePanel('hl');
applyPanels();
document.getElementById('replay-back').onclick = () => stopReplay();
document.getElementById('replay-slow').onclick = () => { replayer.slow = !replayer.slow; updateReplayBar(); };
document.getElementById('replay-camtoggle').onclick = () => { replayer.camMode = replayer.camMode === 'orbit' ? 'follow' : 'orbit'; updateReplayBar(); };

function liftInput(inp, dt) {
  const tap = (...codes) => codes.some(c => inp.taps.has(c));
  const pad = (...b) => b.some(i => inp.padTaps.has(i));
  if (replayer.active) {
    if (tap('Escape', 'Backspace') || pad(BTN.B)) { stopReplay(); return; }
    if (tap('KeyS') || pad(BTN.X)) { replayer.slow = !replayer.slow; updateReplayBar(); }
    if (tap('KeyC') || pad(BTN.Y)) { replayer.camMode = replayer.camMode === 'orbit' ? 'follow' : 'orbit'; updateReplayBar(); }
    return;
  }
  if (tap('Enter', 'NumpadEnter') || pad(BTN.MENU)) { skipLift(); return; }
  if (tap('Escape') || pad(BTN.VIEW)) { liftEl.classList.add('hidden'); showMenu(); return; }
  if (tap('KeyM') || pad(BTN.LB)) togglePanel('map');
  if (tap('KeyH') || pad(BTN.RB)) togglePanel('hl');
  const n = recorder.highlights.length;
  for (let i = 0; i < n; i++) if (tap(`Digit${i + 1}`)) playHighlight(i);
  // controller: D-pad picks a highlight (and opens the list if it's hidden), A plays it
  if (pad(BTN.DOWN, BTN.UP) && panelPref.hl === false) togglePanel('hl');
  if (n && pad(BTN.DOWN)) { hlSel = (hlSel + 1) % n; renderHighlights(); }
  if (n && pad(BTN.UP)) { hlSel = (hlSel + n - 1) % n; renderHighlights(); }
  if (n && pad(BTN.A)) playHighlight(hlSel);
  // look around: mouse drag, right stick, arrow keys
  const k = (c) => input.keys.has(c);
  const keyX = (k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0);
  const keyY = (k('ArrowDown') ? 1 : 0) - (k('ArrowUp') ? 1 : 0);
  liftCam.yaw -= inp.mouseX * 0.005 + (inp.lookX + keyX) * 1.8 * dt;
  liftCam.pitch = Math.max(-1.2, Math.min(0.6, liftCam.pitch - inp.mouseY * 0.004 - (inp.lookY + keyY) * 1.4 * dt));
}

function updateLiftCamera() {
  // sit just outside the chair on the run side, a little behind and above the seat
  const eye = curLift.chairToWorld(chairIdx, new THREE.Vector3(1.25, -1.0, 1.3));
  const d = new THREE.Vector3(Math.sin(liftCam.yaw) * Math.cos(liftCam.pitch), Math.sin(liftCam.pitch), Math.cos(liftCam.yaw) * Math.cos(liftCam.pitch));
  camera.position.copy(eye);
  camera.lookAt(eye.add(d));
  if (camBlend) {
    camBlend.t = Math.min(1, camBlend.t + dtLast / 1.8);
    const e = camBlend.t * camBlend.t * (3 - 2 * camBlend.t);
    camera.position.lerpVectors(camBlend.pos, camera.position.clone(), e);
    camera.quaternion.slerpQuaternions(camBlend.quat, camera.quaternion.clone(), e);
    if (camBlend.t >= 1) camBlend = null;
  }
  if (Math.abs(camera.fov - 70) > 0.1) { camera.fov += (70 - camera.fov) * 0.1; camera.updateProjectionMatrix(); }
}

function showMenu() {
  game.mode = 'menu';
  comp = null; compHudEl.classList.add('hidden'); lodgeEl.classList.add('hidden'); lodgeHintEl.classList.add('hidden');
  showCash();
  race.reset(); raceHudEl.classList.add('hidden'); raceResultEl.classList.add('hidden');
  heli.hide(); heliUi.classList.add('hidden');
  camBlend = null;
  glide = null;
  replayer.stop();
  liftEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
  hud.show(false);
  rider.reset(terrain.spawnPoint(), 0);
  chase.snap(rider);
}

// "Main Street → Crossover → Long Haul" (ignores quick crossings under 2 s)
function runsSummary() {
  const out = [];
  for (const r of game.runsVisited) if (r.t > 2 && out[out.length - 1] !== r.name) out.push(r.name);
  return out.join(' → ');
}

// full screen (needs a real click; on Xbox use the cursor, or the View button's full screen option)
const fsBtn = document.getElementById('btn-fullscreen');
fsBtn.onclick = () => { try { document.documentElement.requestFullscreen(); } catch {} };
document.addEventListener('fullscreenchange', () => fsBtn.classList.toggle('hidden', !!document.fullscreenElement));
const padHelpEl = document.getElementById('pad-help');

document.getElementById('btn-regular').onclick = () => setStance(true);
document.getElementById('btn-goofy').onclick = () => setStance(false);
document.getElementById('btn-start').onclick = () => startHeli();
document.getElementById('btn-summit').onclick = () => startRun();
document.getElementById('btn-lodge').onclick = () => openLodge();
document.getElementById('btn-ach').onclick = () => toggleAch(true);
document.getElementById('btn-ach-lift').onclick = () => toggleAch(true);
document.getElementById('ach-close').onclick = () => toggleAch(false);

function handleEvents() {
  for (const ev of rider.events) {
    if (ev.type === 'takeoff') {
      if (!ev.fromGrind || !tricks.active) { tricks.begin(); recorder.onTakeoff(); } onTakeoffAch(); longJump.takeoff(rider.pos, rider.speed);
      sfx.takeoff(rider.speed);
      if (comp && comp.id === 'jump' && comp.state === 'ready' && longJump.armed) comp.state = 'live';
    }
    else if (ev.type === 'fly-land') {
      hud.popup('Wingsuit landing!', 0);
      sfx.land(5, true);
      ach.unlock('wingsuit');
      if (ev.dist >= 800) ach.unlock('flight');
      emitPowder(30, rider.pos, rider.vel, 2.5);
    }
    else if (ev.type === 'fly-end') {   // flight over (landed or crashed): count it for the flying tips
      flightCount = (flightCount || 0) + 1; flightTips = flightCount < 2;
      try { localStorage.setItem('snowFlights', String(flightCount)); } catch {}
    }
    else if (ev.type === 'chute') { hud.popup('🪂 Parachute!', 0); sfx.chute(); }
    else if (ev.type === 'grind-start') { if (!tricks.active) { tricks.begin(); recorder.onTakeoff(); } sfx.click(); }
    else if (ev.type === 'land') {
      sfx.land(ev.impact, terrain.groomAt(rider.pos.x, rider.pos.z) < 0.3);
      const parts = tricks.active ? tricks.parts() : [];
      const res = tricks.finish(true, rider.airTime);
      onLandAch(res, parts, rider.airTime);
      const lj = longJump.land(rider.pos, racerName(), game.sport);
      if (lj) showJumpResult(lj);
      if (lj && comp && comp.id === 'jump' && comp.state !== 'done') finishComp(lj.dist, lj.dist === null ? 'Landed off the hill' : null);
      if (res && res.points > 0) {
        game.score += res.points;
        if (comp && comp.state === 'live' && (comp.id === 'pipe' || comp.id === 'park')) comp.score += res.points;
        game.tricksLanded++;
        if (!game.bestTrick || res.points > game.bestTrick.points) game.bestTrick = res;
        recorder.onTrick(res.mult > 1 ? `${res.name} x${res.mult}` : res.name, res.points);
        hud.popup(res.mult > 1 ? `${res.name} <small>x${res.mult}</small>` : res.name, res.points);
      }
      if (ev.impact > 6) { chase.shake = Math.min(1, ev.impact / 14); emit(Math.min(60, Math.round(ev.impact * 4)), rider.pos, rider.vel, 4); }
      if (terrain.groomAt(rider.pos.x, rider.pos.z) < 0.3) emitPowder(Math.min(40, 10 + Math.round(ev.impact * 2)), rider.pos, rider.vel, 2.5);
    } else if (ev.type === 'crash') {
      const res = tricks.finish(false, rider.airTime);
      if (/tree/i.test(ev.reason)) ach.addCount('trees', 1);
      if (/tree|tower|lodge|yeti/i.test(ev.reason)) sfx.hit();
      sfx.crash();
      if (longJump.armed) { longJump.crashed(); hud.popup('Fell on the long jump: no distance', 0, true); if (comp && comp.id === 'jump' && comp.state !== 'done') finishComp(null, 'Fell on the landing'); }
      airCtx = null;
      game.crashes++;
      hud.popup(`${ev.reason}${res ? `<span class="pts">lost: ${res.name}</span>` : ''}`, 0, true);
      chase.shake = 0.8;
      emit(50, rider.pos, rider.vel, 4);
    } else if (ev.type === 'recovered') {
      hud.clearPopups();
    } else {
      tricks.handle(ev);
    }
  }
  rider.events.length = 0;
}

// ---------- loop ----------
const STEP = 1 / 120;
let acc = 0;
const prevPos = new THREE.Vector3(), realPos = new THREE.Vector3();
let last = performance.now();
let fpsT = 0, fpsN = 0;
window.__fps = 0;

function frame(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = Math.max(last, now);
  // keep the loop alive even if one frame hits a bug (log it once instead of freezing the game)
  try { tick(dt, now); } catch (e) { if (!frame.errs) frame.errs = 0; if (frame.errs++ < 3) console.error(e); }
  requestAnimationFrame(frame);
}

// Debug: advance the game by hand (works even when the tab is in the background).
window.__game.advance = (seconds, fps = 60) => {
  for (let i = 0; i < Math.round(seconds * fps); i++) { last += 1000 / fps; tick(1 / fps, last); }
};

let dtLast = 1 / 60;
function tick(dt, now) {
  dtLast = dt;
  fpsT += dt; fpsN++;
  if (fpsT > 1) { window.__fps = Math.round(fpsN / fpsT); fpsT = 0; fpsN = 0; }

  const inp = input.poll();
  hud.renderControls(input.padName || (IS_XBOX ? 'Xbox' : null));
  padHelpEl.classList.toggle('hidden', !(IS_XBOX && !input.padName));
  if (inp.helpPressed) hud.toggleHelp();

  ach.update(dt);
  if (cashToastT > 0) { cashToastT -= dt; if (cashToastT <= 0) cashToastEl.classList.add('hidden'); }
  heli.update(dt);
  if (inp.padTaps.size) kickMusic();
  if (inp.taps.has('KeyN')) toggleMusic();
  if (inp.taps.has('KeyB')) toggleSfx();
  if (achOpen) {
    // achievements panel is up: Esc / B / T / Y closes it, nothing else reacts
    if (inp.menuPressed || inp.taps.has('KeyT') || inp.padTaps.has(BTN.B) || inp.padTaps.has(BTN.Y)) toggleAch(false);
    inp.confirmPressed = inp.restartPressed = inp.menuPressed = inp.leftPressed = inp.rightPressed = inp.upPressed = inp.downPressed = false;
    inp.taps.clear(); inp.padTaps.clear();
  } else if ((game.mode === 'menu' || game.mode === 'lift' || game.mode === 'liftwait') && !replayer.active && (inp.taps.has('KeyT') || inp.padTaps.has(BTN.Y))) toggleAch(true);
  // right stick (or mouse wheel) scrolls whatever screen is open
  const scrollY = (inp.lookY || 0) * 900 * dt;
  if (Math.abs(scrollY) > 0.5) {
    if (achOpen) achPanel.scrollTop += scrollY;
    else if (game.mode === 'menu') menuEl.scrollTop += scrollY;
    else if (game.mode === 'lodge') lodgeEl.scrollTop += scrollY;
  }
  if (game.mode === 'menu') {
    if (inp.leftPressed && game.sport === 'board') setStance(true);
    if (inp.rightPressed && game.sport === 'board') setStance(false);
    if (inp.upPressed) setSport('board');
    if (inp.downPressed) setSport('ski');
    if (inp.confirmPressed) startHeli();
    else if (inp.taps.has('KeyL') || inp.padTaps.has(BTN.X)) openLodge();
    // slow orbit preview of the rider at the top
    const t = now / 4000;
    camera.position.set(rider.pos.x + Math.sin(t) * 7, rider.pos.y + 2.5, rider.pos.z + Math.cos(t) * 7);
    camera.lookAt(rider.pos.x, rider.pos.y + 0.9, rider.pos.z);
    rider.updateVisual(dt, inp);
  } else if (game.mode === 'heli') {
    updateHeliMode(dt, inp);
  } else if (game.mode === 'lodge') {
    updateLodge(dt, inp);
  } else if (game.mode === 'run') {
    if (inp.restartPressed) { if (comp) enterComp(comp.id); else startRun(); }
    else if (inp.menuPressed) showMenu();
    if (inp.pausePressed) game.paused = !game.paused;
    acc += game.paused ? 0 : dt;
    // look around: hold Shift (LT) when you're stopped, or while floating under the parachute,
    // and the arrows (left stick) swing the camera instead of moving you
    const canLook = (rider.state === 'ride' && rider.speed < (freeLook.on ? 4 : 2)) || (rider.state === 'fly' && rider.chute);
    const looking = !!inp.brake && canLook;
    // (the A press that signed you up shouldn't also pop a jump at the start line)
    if (game.holdJump && !inp.jump) game.holdJump = false;
    const stepInp = looking ? { ...inp, steer: 0, up: false, down: false, jump: false } : game.holdJump ? { ...inp, jump: false } : inp;
    updateFreeLook(dt, inp, looking);
    while (acc >= STEP) {
      prevPos.copy(rider.pos);
      rider.step(STEP, stepInp);
      acc -= STEP;
    }
    handleEvents();
    if (!game.started && rider.speed > 0.5) game.started = true;
    if (game.started && !game.paused) game.time += dt;
    // draw the rider (and aim the camera) between the last two physics steps, so fast motion is smooth
    // instead of stuttering when a frame happens to get one or three steps
    realPos.copy(rider.pos);
    if (prevPos.distanceToSquared(realPos) < 9) rider.pos.lerpVectors(prevPos, realPos, acc / STEP);
    rider.updateVisual(dt, inp);
    if (!game.paused) recorder.record(dt, rider);
    chase.update(dt, rider);
    applyStickLook(dt, inp, looking);
    applyFreeLook(dt);
    // on a controller the controls panel tucks itself away after a few seconds of riding
    if (input.padName || IS_XBOX) { helpRideT += dt; if (helpRideT > 8 && hud.showHelp && !hud.helpTouched) hud.setHelp(false); }
    rider.pos.copy(realPos);
    if (runCamBlend) {
      // ease the camera from the chair view to behind you
      runCamBlend.t = Math.min(1, runCamBlend.t + dt / 1.3);
      const e = runCamBlend.t * runCamBlend.t * (3 - 2 * runCamBlend.t);
      camera.position.lerpVectors(runCamBlend.pos, camera.position.clone(), e);
      camera.quaternion.slerpQuaternions(runCamBlend.quat, camera.quaternion.clone(), e);
      if (runCamBlend.t >= 1) runCamBlend = null;
    }

    // powder: a cloud kicks up behind you off the groomed runs (bigger when you turn or brake)
    if (rider.state === 'ride' && rider.speed > 3 && terrain.groomAt(rider.pos.x, rider.pos.z) < 0.3) {
      powderAcc += dt * (6 + rider.speed * 0.9 + rider.spray * 25);
      while (powderAcc >= 1) { powderAcc -= 1; emitPowder(1, rider.pos, rider.vel); }
    }
    // spray
    if (rider.state !== 'air' && rider.spray > 0.15) {
      const n = Math.round(rider.spray * 4);
      emit(n, rider.pos, rider.vel, 1.5 + rider.spray * 2);
    }
    hud.update({ score: game.score, time: game.time, speed: rider.state === 'crash' ? 0 : rider.speed, live: rider.state === 'air' || rider.state === 'grind' ? tricks.liveName() : '' });

    // which run are we on? (for the HUD and the run summary)
    const ra = terrain.runAt(rider.pos.x, rider.pos.z);
    const onRun = ra && ra.d < ra.run.hw + 4 ? ra.run : null;
    hud.setRun(onRun);
    if (onRun && rider.state !== 'crash') {
      const last = game.runsVisited[game.runsVisited.length - 1];
      if (!last || last.id !== onRun.id) game.runsVisited.push({ id: onRun.id, name: onRun.name, t: 0 });
      game.runsVisited[game.runsVisited.length - 1].t += dt;
    }

    // lift line: ride in between the ropes, slowly up to the blue line, and the chair picks you up
    inLane = null;
    if (rider.state === 'ride') {
      for (const l of lifts) {
        const { d, l: across } = l.laneCoords(rider.pos.x, rider.pos.z), L = l.lane;
        if (across > L.l0 - 0.4 && across < L.l1 + 0.4 && d > L.d0 - 1 && d < L.d1 + 2) {
          inLane = l;
          const sp = rider.speed;
          if (sp > 3) rider.vel.multiplyScalar(Math.max(3, sp - 8 * dt) / sp);   // shuffle along in line
          if (d >= L.d1 - 1.2) { endRun(l); break; }
        }
      }
    }
    if (game.mode === 'run') updateLiftGuide();
    if (game.mode === 'run') trackAch(dt);
    if (game.mode === 'run') updateRace(dt);
    if (game.mode === 'run') updateJumpHud();
    if (game.mode === 'run') updateComp(dt);
    if (game.mode === 'run') updateLodgeDoor(inp);
    // stopped on a flat: remind how to push along
    const slow = game.mode === 'run' && rider.state === 'ride' && rider.speed < 1.2 && !inLane && rider.pushAmt < 0.2;
    pushHint.t = slow ? pushHint.t + dt : 0;
    const showHint = pushHint.t > 1.2;
    if (showHint) pushHintEl.textContent = input.padName ? 'Left stick up to push along (or climb a hill) · hold LT + left stick to look around' : 'Hold ↑ to push along (or climb a hill) · hold Shift + arrows to look around';
    pushHintEl.classList.toggle('hidden', !showHint);
  }

  else if (game.mode === 'liftwait' || game.mode === 'lift') {
    updateLiftHelp();
    liftInput(inp, dt);
    if (game.mode === 'liftwait') {
      if (glide) updateGlide(dt);
      else {
        updateLoading(dt);
        const u = chairIdx >= 0 ? curLift.chairU(chairIdx) : -1;
        if (loading.phase === 'ready' && u >= curLift.loadU - 0.9 && u < curLift.loadU + 10) boardChair();   // chair comes up behind you: sit back onto it
      }
      rider.updateVisual(dt, inp);
      chase.update(dt, rider);
    }
    if (game.mode === 'lift') {
      const st = curLift.chairState(chairIdx);
      rider.sitAt(curLift.seatPoint(chairIdx, -1), st.dir);
      rider.updateVisual(dt, inp);
      const left = curLift.timeToTop(chairIdx);
      document.getElementById('lift-status').textContent = `${Math.ceil(left)} s to the top`;   // the lift keeps going while you watch
      if (replayer.active) {
        const k = (c) => input.keys.has(c);
        const kx = (k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0), ky = (k('ArrowDown') ? 1 : 0) - (k('ArrowUp') ? 1 : 0);
        replayer.update(dt); replayer.updateCamera(camera, dt, { x: inp.lookX + kx + inp.mouseX * 0.4, y: inp.lookY + ky + inp.mouseY * 0.4 }, terrain);
      }
      else updateLiftCamera();
      if (st.u >= curLift.unloadU && st.u < curLift.unloadU + 15) { if (replayer.active) stopReplay(); unload(); }
    }
    trailMap.draw(rider.pos);
  }

  for (const l of lifts) l.update(dt);
  if (!(game.mode === 'run' && game.paused)) npcs.update(dt, camera.position, rider.pos);

  // wide view of the resort from the lift, normal fog while riding
  const fogWant = game.mode === 'lift' && !replayer.active ? 0.00022 : 0.00042;
  scene.fog.density += (fogWant - scene.fog.density) * Math.min(1, dt * 2);

  if (LOW_GFX) {
    const gy = terrain.heightAt(rider.pos.x, rider.pos.z), above = rider.pos.y - gy;
    blob.visible = rider.state !== 'lift' && above < 6;
    blob.position.set(rider.pos.x, gy + 0.05, rider.pos.z);
    blob.scale.setScalar(1 + above * 0.15); blob.material.opacity = Math.max(0, 1 - above / 6);
  }
  updateParticles(dt);
  updatePowder(dt);
  // shadow box follows the rider (or the replay)
  const focus = replayer.active ? replayer.pos : rider.pos;
  sun.position.copy(focus).add(SUN_OFFSET);
  sun.target.position.copy(focus);

  treeLod.update(camera.position);
  // sound effects follow what you're doing
  const st = rider.state, onLiftNow = game.mode === 'lift' || game.mode === 'liftwait';
  sfx.update(dt, {
    mode: game.mode, paused: game.mode === 'run' && game.paused,
    speed: onLiftNow ? 0 : rider.speed, onGround: st === 'ride' && !rider.climbing,
    edge: Math.min(1, Math.abs(rider.lean || 0) * 1.4), skid: Math.min(1, rider.spray || 0),
    powder: st === 'ride' ? 1 - Math.min(1, terrain.groomAt(rider.pos.x, rider.pos.z) / 0.3) : 0,
    grinding: st === 'grind', flying: st === 'fly', chute: !!rider.chute,
    lift: onLiftNow ? { seat: game.mode === 'lift' && chairIdx >= 0 ? curLift.seatPoint(chairIdx, -1) : null, towers: curLift.towers } : null,
    heliDist: heli.group.visible ? camera.position.distanceTo(heli.group.position) : null,
  });
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// Get the graphics card ready for everything up front (the race ghost, the helicopter, the replay rider,
// the trees and lift once their models arrive), so nothing stalls the first time it shows up.
race.prepareGhost();
function warmUp() {
  const hidden = [];
  for (const o of [race.ghostRider && race.ghostRider.root, heli.group, ghost.root]) if (o && !o.visible) { o.visible = true; hidden.push(o); }
  try { renderer.compile(scene, camera); } catch (e) { console.warn(e); }
  for (const o of hidden) o.visible = false;
}
setTimeout(warmUp, 300);
setTimeout(warmUp, 6000);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
