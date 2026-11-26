// Game setup and main loop.
import * as THREE from 'three';
import { Terrain, RUN_LENGTH, centerX } from './terrain.js';
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
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
const SKY_FOG = 0xb9d4ee;
scene.fog = new THREE.Fog(SKY_FOG, 70, 420);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2500);

// sky dome with a vertical gradient
{
  const geo = new THREE.SphereGeometry(1500, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x4f8fdc) }, bottom: { value: new THREE.Color(SKY_FOG) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y * 2.2, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }',
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -1;
  scene.add(sky);
  scene.userData.sky = sky;
}

// lights
const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5d6f8f, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera; sc.left = -35; sc.right = 35; sc.top = 35; sc.bottom = -35; sc.near = 1; sc.far = 200;
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(-55, 45, 20);

const terrain = new Terrain(scene);

// distant low-poly peaks (not fogged so they read as a skyline)
{
  const mat = new THREE.MeshStandardMaterial({ color: 0xdde8f5, flatShading: true, fog: false, roughness: 1 });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8d9ab0, flatShading: true, fog: false, roughness: 1 });
  let seed = 3; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + r() * 0.1;
    const d = 900 + r() * 300;
    const hgt = 180 + r() * 260;
    const geo = new THREE.ConeGeometry(160 + r() * 140, hgt, 5 + Math.floor(r() * 3));
    const m = new THREE.Mesh(geo, i % 3 ? mat : rockMat);
    m.position.set(Math.cos(a) * d, terrain.baseAt(RUN_LENGTH / 2) - 260 + hgt / 2 + r() * 80, -RUN_LENGTH / 2 + Math.sin(a) * d);
    m.rotation.y = r() * 3;
    scene.add(m);
  }
}

// one chairlift from the bottom of the run back to the top
const lift = new Chairlift(scene, terrain,
  new THREE.Vector3(centerX(RUN_LENGTH + 70) + 30, 0, -(RUN_LENGTH + 70)),
  new THREE.Vector3(centerX(-22) + 24, 0, 22),
  { name: 'Summit Express', speed: 22 });
const trailMap = new TrailMap(terrain, [lift], 'Main Run');
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
const pMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.28, map: flake, transparent: true, opacity: 0.85, depthWrite: false });
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
const finishEl = document.getElementById('finish');
const game = {
  mode: 'menu',      // menu | run | finish | liftwait | lift
  regular: true,
  score: 0, time: 0, crashes: 0, bestTrick: null, tricksLanded: 0, started: false,
};
window.__game = { IS_XBOX, LOW_GFX, game, rider, terrain, tricks, input, chase, camera, lift, recorder, replayer }; // handy for debugging in the console

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
  game.paused = false; game.score = 0; game.time = 0; game.crashes = 0; game.bestTrick = null; game.tricksLanded = 0; game.started = false;
  rider.topSpeed = 0;
  rider.reset(at || terrain.spawnPoint(), yaw);
  rider.events.length = 0;
  tricks.reset();
  recorder.reset();
  replayer.stop();
  chase.snap(rider);
  menuEl.classList.add('hidden');
  finishEl.classList.add('hidden');
  liftEl.classList.add('hidden');
  hud.show(true);
  hud.clearPopups();
}

// ---------- chairlift ride ----------
const liftEl = document.getElementById('lift-ui');
const replayEl = document.getElementById('replay-ui');
const liftCam = { yaw: 0, pitch: -0.3 };
let chairIdx = 0, hlSel = 0;

function startLift() {
  game.mode = 'liftwait';
  finishEl.classList.add('hidden');
  hud.show(false);
  liftEl.classList.remove('hidden');
  replayEl.classList.add('hidden');
  rider.reset(lift.loadPoint, Math.atan2(lift.f.x, -lift.f.z));
  rider.vel.set(0, 0, 0);
  chase.snap(rider);
  chairIdx = lift.nextChairToLoad().index;
  hlSel = 0;
  renderHighlights();
  document.getElementById('lift-status').textContent = 'Wait for the chair…';
}

function boardChair() {
  game.mode = 'lift';
  // look out over the run: toward the run side (+p) and back downhill
  const d = lift.p.clone().multiplyScalar(1).addScaledVector(lift.f, -0.9);
  liftCam.yaw = Math.atan2(d.x, d.z); liftCam.pitch = -0.42;
}

function skipLift() {
  if (game.mode === 'liftwait') boardChair();
  replayer.stop();
  lift.setChairU(chairIdx, lift.unloadU);
}

function unload() {
  const p = lift.unloadPoint.clone();
  // ride off toward the start of the run
  const tx = centerX(8), tz = -8;
  const yaw = Math.atan2(tx - p.x, -(tz - p.z));
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
  const eye = lift.chairToWorld(chairIdx, new THREE.Vector3(1.25, -1.0, 1.3));
  const d = new THREE.Vector3(Math.sin(liftCam.yaw) * Math.cos(liftCam.pitch), Math.sin(liftCam.pitch), Math.cos(liftCam.yaw) * Math.cos(liftCam.pitch));
  camera.position.copy(eye);
  camera.lookAt(eye.add(d));
  if (Math.abs(camera.fov - 70) > 0.1) { camera.fov = 70; camera.updateProjectionMatrix(); }
}

function showMenu() {
  game.mode = 'menu';
  replayer.stop();
  liftEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
  finishEl.classList.add('hidden');
  hud.show(false);
  rider.reset(terrain.spawnPoint(), 0);
  chase.snap(rider);
}

function finishRun() {
  game.mode = 'finish';
  recorder.finishRun();
  hud.show(false);
  const rows = [
    ['Time', fmtTime(game.time)],
    ['Score', game.score.toLocaleString()],
    ['Tricks landed', game.tricksLanded],
    ['Best trick', game.bestTrick ? `${game.bestTrick.name} (${game.bestTrick.points.toLocaleString()})` : '—'],
    ['Top speed', `${Math.round(rider.topSpeed * 2.237)} mph`],
    ['Crashes', game.crashes],
  ];
  document.getElementById('summary').innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  finishEl.classList.remove('hidden');
}

// full screen (needs a real click; on Xbox use the cursor, or the View button's full screen option)
const fsBtn = document.getElementById('btn-fullscreen');
fsBtn.onclick = () => { try { document.documentElement.requestFullscreen(); } catch {} };
document.addEventListener('fullscreenchange', () => fsBtn.classList.toggle('hidden', !!document.fullscreenElement));
const padHelpEl = document.getElementById('pad-help');

document.getElementById('btn-regular').onclick = () => setStance(true);
document.getElementById('btn-goofy').onclick = () => setStance(false);
document.getElementById('btn-start').onclick = () => startRun();
document.getElementById('btn-restart').onclick = () => startRun();
document.getElementById('btn-lift').onclick = () => startLift();

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
      const s = -rider.pos.z;
      const cx = centerX(s + 3);
      const x = rider.pos.x + (cx - rider.pos.x) * 0.5;
      const z = Math.min(rider.pos.z, -6) - 3;
      rider.reset(new THREE.Vector3(x, terrain.heightAt(x, z), z), Math.atan2(centerX(s + 13) - centerX(s + 3), 10));
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

    if (-rider.pos.z >= RUN_LENGTH && rider.state !== 'crash') finishRun();
  } else if (game.mode === 'finish') {
    if (inp.confirmPressed) startLift();
    else if (inp.restartPressed) startRun();
    else if (inp.menuPressed) showMenu();
    // let the rider coast through the runout behind the summary
    acc += dt;
    while (acc >= STEP) { rider.step(STEP, { steer: 0, up: false, down: false, jump: false, brake: rider.speed > 3, grab: null }); acc -= STEP; }
    rider.events.length = 0;
    rider.updateVisual(dt, {});
    chase.update(dt, rider);
  }

  else if (game.mode === 'liftwait' || game.mode === 'lift') {
    liftInput(inp, dt);
    if (!replayer.active) lift.update(dt);
    if (game.mode === 'liftwait') {
      const u = lift.chairU(chairIdx);
      if (u >= lift.loadU && u < lift.loadU + 10) boardChair();
      rider.updateVisual(dt, inp);
      chase.update(dt, rider);
    }
    if (game.mode === 'lift') {
      const st = lift.chairState(chairIdx);
      rider.sitAt(lift.seatPoint(chairIdx, -1), st.dir);
      rider.updateVisual(dt, inp);
      const left = lift.timeToTop(chairIdx);
      document.getElementById('lift-status').textContent = replayer.active ? 'Lift paused while you watch' : `${Math.ceil(left)} s to the top`;
      if (replayer.active) { replayer.update(dt); replayer.updateCamera(camera, dt, { x: inp.lookX + inp.mouseX * 0.4, y: inp.lookY + inp.mouseY * 0.4 }, terrain); }
      else updateLiftCamera();
      if (st.u >= lift.unloadU && st.u < lift.unloadU + 15) unload();
    }
    trailMap.draw(rider.pos);
  }

  // wide view of the resort from the lift, normal fog while riding
  scene.fog.far += ((game.mode === 'lift' && !replayer.active ? 1100 : 420) - scene.fog.far) * Math.min(1, dt * 2);

  updateParticles(dt);
  // shadow box follows the rider (or the replay)
  const focus = replayer.active ? replayer.pos : rider.pos;
  sun.position.copy(focus).add(SUN_OFFSET);
  sun.target.position.copy(focus);
  scene.userData.sky.position.copy(camera.position);

  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
