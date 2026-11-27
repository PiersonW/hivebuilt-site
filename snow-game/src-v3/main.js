// Game setup and main loop.
import * as THREE from 'three';
import { Terrain, BASE_Z, RIDGE_TOP, EXPRESS_TOP } from './terrain.js';
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

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 15000);

// sky, sunlight and haze
const { sun: SUN_DIR } = setupSky(scene, renderer, { elevation: 30, azimuth: 205 });
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
  { name: 'Summit Express', bottom: new THREE.Vector3(140, 0, -1404), top: new THREE.Vector3(EXPRESS_TOP.x, 0, EXPRESS_TOP.z), speed: 26 },
  { name: 'Ridge Lift', bottom: new THREE.Vector3(-262, 0, -1404), top: new THREE.Vector3(RIDGE_TOP.x, 0, RIDGE_TOP.z + 6), speed: 20 },
];
const terrain = new Terrain(scene, { treeSpacing: LOW_GFX ? 9.5 : 6.5, liftLines: LIFTS.map(l => [l.bottom, l.top]) });
buildRange(scene, terrain);
buildLodge(scene, terrain, -40, BASE_Z - 68);
for (const dx of [-9.5, 0, 9.5]) terrain.addObstacle(-40 + dx, BASE_Z - 68, 6.5, 12, 'lodge');
const lifts = LIFTS.map(l => new Chairlift(scene, terrain, l.bottom, l.top, { name: l.name, speed: l.speed }));
let curLift = lifts[0];
const trailMap = new TrailMap(terrain, lifts);
document.getElementById('map-wrap').appendChild(trailMap.canvas);

const rider = new Rider(scene, terrain);
const ghost = new Rider(scene, terrain);        // model used for highlight replays
const recorder = new Recorder();
const replayer = new Replayer(ghost);
const tricks = new TrickTracker();
const input = new Input();
const chase = new ChaseCam(camera, terrain);
const hud = new Hud();

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

// ---------- game state ----------
const menuEl = document.getElementById('menu');
const game = {
  mode: 'menu',      // menu | run | liftwait | lift
  regular: true,
  score: 0, time: 0, crashes: 0, bestTrick: null, tricksLanded: 0, started: false,
};
window.__game = { IS_XBOX, LOW_GFX, game, rider, terrain, tricks, input, chase, camera, lifts, recorder, replayer, startLift: (i) => startLift(lifts[i]), endRun: (i) => endRun(lifts[i]) }; // handy for debugging in the console

function setStance(regular) {
  game.regular = regular;
  document.getElementById('btn-regular').classList.toggle('on', regular);
  document.getElementById('btn-goofy').classList.toggle('on', !regular);
  rider.setStance(regular);
}
setStance(true);

// Start a run at the top (or at `at`, e.g. the lift unload point).
function startRun(at = null, yaw = 0) {
  game.mode = 'run';
  game.paused = false; game.runsVisited = []; game.score = 0; game.time = 0; game.crashes = 0; game.bestTrick = null; game.tricksLanded = 0; game.started = false;
  rider.topSpeed = 0;
  rider.reset(at || terrain.spawnPoint(), yaw);
  rider.events.length = 0;
  tricks.reset();
  recorder.reset();
  replayer.stop();
  chase.snap(rider);
  menuEl.classList.add('hidden');
  liftEl.classList.add('hidden');
  glide = null;
  hud.show(true);
  hud.clearPopups();
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
  document.querySelector('#lift-ui .lift-name').textContent = '🚡 ' + l.name;
  game.mode = 'liftwait';
  hud.show(false);
  liftEl.classList.remove('hidden');
  replayEl.classList.add('hidden');
  const loadYaw = Math.atan2(curLift.f.x, -curLift.f.z);
  if (doGlide) {
    glide = { from: rider.pos.clone(), yaw0: rider.yaw, yaw1: loadYaw, t: 0 };
    rider.reset(rider.pos.clone(), rider.yaw);
  } else {
    glide = null;
    rider.reset(curLift.loadPoint, loadYaw);
    chase.snap(rider);
  }
  rider.vel.set(0, 0, 0);
  chairIdx = curLift.nextChairToLoad().index;
  hlSel = 0;
  renderHighlights();
  document.getElementById('lift-status').textContent = doGlide ? 'Getting in line…' : 'Wait for the chair…';
}

function updateGlide(dt) {
  glide.t = Math.min(1, glide.t + dt / 1.6);
  const e = glide.t * glide.t * (3 - 2 * glide.t);
  const p = glide.from.clone().lerp(curLift.loadPoint, e);
  p.y = terrain.heightAt(p.x, p.z);
  let dy = glide.yaw1 - glide.yaw0; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
  rider.pos.copy(p); rider.yaw = glide.yaw0 + dy * e;
  rider.vel.set(Math.sin(rider.yaw), 0, -Math.cos(rider.yaw)).multiplyScalar(2 * (1 - e) + 0.01);
  terrain.normalAt(p.x, p.z, rider.normal);
  rider.brakeAmt = 1 - e;
  if (glide.t >= 1) {
    glide = null; rider.brakeAmt = 0; rider.vel.set(0, 0, 0);
    chairIdx = curLift.nextChairToLoad().index;
    document.getElementById('lift-status').textContent = 'Wait for the chair…';
  }
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
function updateLiftGuide() {
  if (rider.pos.z > BASE_Z + 160) { liftGuideEl.classList.add('hidden'); return; }
  let best = null, bd = Infinity;
  for (const l of lifts) { const d = Math.hypot(l.loadPoint.x - rider.pos.x, l.loadPoint.z - rider.pos.z); if (d < bd) { bd = d; best = l; } }
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  const toL = new THREE.Vector3(best.loadPoint.x - rider.pos.x, 0, best.loadPoint.z - rider.pos.z);
  const ang = Math.atan2(fwd.x * toL.z - fwd.z * toL.x, fwd.x * toL.x + fwd.z * toL.z);   // + = to the right
  const arrows = ['⬆', '↗', '➡', '↘', '⬇', '↙', '⬅', '↖'];
  const k = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
  liftGuideEl.innerHTML = `<span class="arrow">${arrows[k]}</span> 🚡 ${best.name} · ${Math.round(bd)} m<br><small>Ride into the lift line to head back up</small>`;
  liftGuideEl.classList.remove('hidden');
}

function boardChair() {
  game.mode = 'lift';
  // look out over the run: toward the run side (+p) and back downhill
  const d = curLift.p.clone().multiplyScalar(1).addScaledVector(curLift.f, -0.9);
  liftCam.yaw = Math.atan2(d.x, d.z); liftCam.pitch = -0.42;
}

function skipLift() {
  if (game.mode === 'liftwait') boardChair();
  replayer.stop();
  curLift.setChairU(chairIdx, curLift.unloadU);
}

function unload() {
  const p = curLift.unloadPoint.clone();
  // ride off down the nearest run
  const ra = terrain.runAt(p.x, p.z);
  const t = ra ? ra.run.at(Math.min(ra.run.length, ra.s + 40)) : { x: p.x, z: p.z - 10 };
  const yaw = Math.atan2(t.x - p.x, -(t.z - p.z));
  startRun(p, yaw);
}

function renderHighlights() {
  const list = document.getElementById('hl-list');
  const hs = recorder.highlights;
  if (!hs.length) { list.innerHTML = '<p class="muted">No landed tricks this run yet. Hit a kicker!</p>'; return; }
  list.innerHTML = hs.map((h, i) => `<button class="hl ${i === hlSel ? 'sel' : ''}" data-i="${i}"><b>${i + 1}</b> ${h.name}<span>${h.points.toLocaleString()}</span></button>`).join('');
  list.querySelectorAll('.hl').forEach(b => b.onclick = () => playHighlight(+b.dataset.i));
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
  const n = recorder.highlights.length;
  for (let i = 0; i < n; i++) if (tap(`Digit${i + 1}`)) playHighlight(i);
  if (n && (pad(BTN.DOWN) || tap('ArrowDown'))) { hlSel = (hlSel + 1) % n; renderHighlights(); }
  if (n && (pad(BTN.UP) || tap('ArrowUp'))) { hlSel = (hlSel + n - 1) % n; renderHighlights(); }
  if (n && pad(BTN.A)) playHighlight(hlSel);
  // look around
  liftCam.yaw -= inp.mouseX * 0.005 + inp.lookX * 2.2 * dt;
  liftCam.pitch = Math.max(-1.2, Math.min(0.6, liftCam.pitch - inp.mouseY * 0.004 - inp.lookY * 1.8 * dt));
}

function updateLiftCamera() {
  // sit just outside the chair on the run side, a little behind and above the seat
  const eye = curLift.chairToWorld(chairIdx, new THREE.Vector3(1.25, -1.0, 1.3));
  const d = new THREE.Vector3(Math.sin(liftCam.yaw) * Math.cos(liftCam.pitch), Math.sin(liftCam.pitch), Math.cos(liftCam.yaw) * Math.cos(liftCam.pitch));
  camera.position.copy(eye);
  camera.lookAt(eye.add(d));
  if (Math.abs(camera.fov - 70) > 0.1) { camera.fov = 70; camera.updateProjectionMatrix(); }
}

function showMenu() {
  game.mode = 'menu';
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
document.getElementById('btn-start').onclick = () => startRun();

function handleEvents() {
  for (const ev of rider.events) {
    if (ev.type === 'takeoff') { tricks.begin(); recorder.onTakeoff(); }
    else if (ev.type === 'land') {
      const res = tricks.finish(true, rider.airTime);
      if (res && res.points > 0) {
        game.score += res.points;
        game.tricksLanded++;
        if (!game.bestTrick || res.points > game.bestTrick.points) game.bestTrick = res;
        recorder.onTrick(res.mult > 1 ? `${res.name} x${res.mult}` : res.name, res.points);
        hud.popup(res.mult > 1 ? `${res.name} <small>x${res.mult}</small>` : res.name, res.points);
      }
      if (ev.impact > 6) { chase.shake = Math.min(1, ev.impact / 14); emit(Math.min(60, Math.round(ev.impact * 4)), rider.pos, rider.vel, 4); }
    } else if (ev.type === 'crash') {
      const res = tricks.finish(false, rider.airTime);
      game.crashes++;
      hud.popup(`${ev.reason}${res ? `<span class="pts">lost: ${res.name}</span>` : ''}`, 0, true);
      chase.shake = 0.8;
      emit(50, rider.pos, rider.vel, 4);
    } else if (ev.type === 'respawn') {
      // put the rider back near the crash spot, nudged toward the middle of the run, facing downhill
      const ra = terrain.runAt(rider.pos.x, rider.pos.z);
      let x = rider.pos.x, z = rider.pos.z - 3, yaw = 0;
      if (ra) {
        const c = ra.run.at(ra.s + 4), ahead = ra.run.at(ra.s + 14);
        const k = ra.d > ra.run.hw * 0.6 ? 0.6 : 0.15;           // move back toward the middle of the run
        x = rider.pos.x + (c.x - rider.pos.x) * k; z = rider.pos.z + (c.z - rider.pos.z) * k;
        yaw = Math.atan2(ahead.x - c.x, -(ahead.z - c.z));
      }
      rider.reset(new THREE.Vector3(x, terrain.heightAt(x, z), z), yaw);
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
let last = performance.now();
let fpsT = 0, fpsN = 0;
window.__fps = 0;

function frame(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = Math.max(last, now);
  tick(dt, now);
  requestAnimationFrame(frame);
}

// Debug: advance the game by hand (works even when the tab is in the background).
window.__game.advance = (seconds, fps = 60) => {
  for (let i = 0; i < Math.round(seconds * fps); i++) { last += 1000 / fps; tick(1 / fps, last); }
};

function tick(dt, now) {
  fpsT += dt; fpsN++;
  if (fpsT > 1) { window.__fps = Math.round(fpsN / fpsT); fpsT = 0; fpsN = 0; }

  const inp = input.poll();
  hud.renderControls(input.padName || (IS_XBOX ? 'Xbox' : null));
  padHelpEl.classList.toggle('hidden', !(IS_XBOX && !input.padName));
  if (inp.helpPressed) hud.toggleHelp();

  if (game.mode === 'menu') {
    if (inp.leftPressed) setStance(true);
    if (inp.rightPressed) setStance(false);
    if (inp.confirmPressed) startRun();
    // slow orbit preview of the rider at the top
    const t = now / 4000;
    camera.position.set(rider.pos.x + Math.sin(t) * 7, rider.pos.y + 2.5, rider.pos.z + Math.cos(t) * 7);
    camera.lookAt(rider.pos.x, rider.pos.y + 0.9, rider.pos.z);
    rider.updateVisual(dt, inp);
  } else if (game.mode === 'run') {
    if (inp.restartPressed) startRun();
    else if (inp.menuPressed) showMenu();
    if (inp.pausePressed) game.paused = !game.paused;
    acc += game.paused ? 0 : dt;
    while (acc >= STEP) {
      rider.step(STEP, inp);
      acc -= STEP;
    }
    handleEvents();
    if (!game.started && rider.speed > 0.5) game.started = true;
    if (game.started && !game.paused) game.time += dt;
    rider.updateVisual(dt, inp);
    if (!game.paused) recorder.record(dt, rider);
    chase.update(dt, rider);

    // spray
    if (rider.state !== 'air' && rider.spray > 0.15) {
      const n = Math.round(rider.spray * 4);
      emit(n, rider.pos, rider.vel, 1.5 + rider.spray * 2);
    }
    hud.update({ score: game.score, time: game.time, speed: rider.state === 'crash' ? 0 : rider.speed, live: rider.state === 'air' ? tricks.liveName() : '' });

    // which run are we on? (for the HUD and the run summary)
    const ra = terrain.runAt(rider.pos.x, rider.pos.z);
    const onRun = ra && ra.d < ra.run.hw + 4 ? ra.run : null;
    hud.setRun(onRun);
    if (onRun && rider.state !== 'crash') {
      const last = game.runsVisited[game.runsVisited.length - 1];
      if (!last || last.id !== onRun.id) game.runsVisited.push({ id: onRun.id, name: onRun.name, t: 0 });
      game.runsVisited[game.runsVisited.length - 1].t += dt;
    }

    // ride into a lift line to end the run and head back up
    if (rider.state === 'ride') {
      for (const l of lifts) {
        const dl = Math.hypot(rider.pos.x - l.loadPoint.x, rider.pos.z - l.loadPoint.z);
        const ds = Math.hypot(rider.pos.x - l.towers[0].x, rider.pos.z - l.towers[0].z);
        if (dl < 11 || ds < 9) { endRun(l); break; }
      }
    }
    updateLiftGuide();
  }

  else if (game.mode === 'liftwait' || game.mode === 'lift') {
    liftInput(inp, dt);
    if (game.mode === 'liftwait') {
      const u = curLift.chairU(chairIdx);
      if (glide) updateGlide(dt);
      else if (u >= curLift.loadU && u < curLift.loadU + 10) boardChair();
      rider.updateVisual(dt, inp);
      chase.update(dt, rider);
    }
    if (game.mode === 'lift') {
      const st = curLift.chairState(chairIdx);
      rider.sitAt(curLift.seatPoint(chairIdx, -1), st.dir);
      rider.updateVisual(dt, inp);
      const left = curLift.timeToTop(chairIdx);
      document.getElementById('lift-status').textContent = replayer.active ? 'Lift paused while you watch' : `${Math.ceil(left)} s to the top`;
      if (replayer.active) { replayer.update(dt); replayer.updateCamera(camera, dt, { x: inp.lookX + inp.mouseX * 0.4, y: inp.lookY + inp.mouseY * 0.4 }, terrain); }
      else updateLiftCamera();
      if (st.u >= curLift.unloadU && st.u < curLift.unloadU + 15) unload();
    }
    trailMap.draw(rider.pos);
  }

  if (!replayer.active) for (const l of lifts) l.update(dt);

  // wide view of the resort from the lift, normal fog while riding
  const fogWant = game.mode === 'lift' && !replayer.active ? 0.00022 : 0.00042;
  scene.fog.density += (fogWant - scene.fog.density) * Math.min(1, dt * 2);

  updateParticles(dt);
  // shadow box follows the rider (or the replay)
  const focus = replayer.active ? replayer.pos : rider.pos;
  sun.position.copy(focus).add(SUN_OFFSET);
  sun.target.position.copy(focus);

  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
