// Sky, sunlight, the mountain range around the resort, and the base lodge.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { fbm, ridged, smoothstep, rng } from './noise.js';
import { WORLD, BASE_Z } from './terrain.js';

// Physical sky + matching image-based lighting. Returns the sun direction.
export function setupSky(scene, renderer, { elevation = 28, azimuth = 215 } = {}) {
  const sky = new Sky();
  sky.scale.setScalar(20000);
  const u = sky.material.uniforms;
  u.turbidity.value = 2.5; u.rayleigh.value = 1.1; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
  const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimuth));
  u.sunPosition.value.copy(sun);
  scene.add(sky);
  // environment light from the same sky (soft blue fill + reflections)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky(); envSky.scale.setScalar(1000);
  Object.assign(envSky.material.uniforms.sunPosition.value, sun);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) envSky.material.uniforms[k].value = u[k].value;
  envScene.add(envSky);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.65;
  pmrem.dispose();
  return { sky, sun };
}

// A ring of big snowy peaks around the resort, blended into the edges of the play area.
export function buildRange(scene, terrain) {
  const SIZE = 9000, CELLS = 230, step = SIZE / CELLS;
  const cx = 0, cz = (WORLD.zTop + WORLD.zBot) / 2;
  const W = CELLS + 1;
  const pos = new Float32Array(W * W * 3), col = new Float32Array(W * W * 3);
  const baseH = terrain.terrainHeight(0, BASE_Z - 60);
  const snow = new THREE.Color(0.95, 0.97, 1), rock = new THREE.Color(0.36, 0.36, 0.4), forest = new THREE.Color(0.13, 0.22, 0.17), c = new THREE.Color();
  const hgt = new Float32Array(W * W);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const x = cx - SIZE / 2 + i * step, z = cz - SIZE / 2 + j * step;
    const ex = Math.min(WORLD.x1, Math.max(WORLD.x0, x)), ez = Math.min(WORLD.zTop, Math.max(WORLD.zBot, z));
    const d = Math.hypot(x - ex, z - ez);                       // distance outside the resort area
    const edge = terrain.terrainHeight(ex, ez);
    let h;
    if (d === 0) h = edge - 25;                                  // hidden under the resort
    else {
      const range = 1100 * Math.pow(ridged(x / 2600 + 7, z / 2600 - 3, 5), 1.6) + 140 * fbm(x / 700, z / 700, 4);
      const behind = smoothstep(-200, 1500, z - WORLD.zTop) * 500;   // higher peaks behind the summit
      const valley = -smoothstep(0, 2500, WORLD.zBot - z) * 120;      // valley opens up below the base
      const target = Math.max(baseH - 40, baseH + 200 + range + behind + valley);
      h = edge - 1 + (target - edge) * smoothstep(0, 900, d) + 60 * smoothstep(0, 250, d) * (1 - smoothstep(250, 900, d));
    }
    hgt[j * W + i] = h;
  }
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const q = j * W + i, x = cx - SIZE / 2 + i * step, z = cz - SIZE / 2 + j * step, h = hgt[q];
    pos[q * 3] = x; pos[q * 3 + 1] = h; pos[q * 3 + 2] = z;
    const hx = hgt[j * W + Math.min(CELLS, i + 1)] - hgt[j * W + Math.max(0, i - 1)];
    const hz = hgt[Math.min(CELLS, j + 1) * W + i] - hgt[Math.max(0, j - 1) * W + i];
    const slope = Math.hypot(hx, hz) / (2 * step);
    const above = h - baseH;
    // forest low down, rock on steep faces, snow on top
    c.copy(forest).lerp(snow, smoothstep(150, 420, above + 120 * fbm(x / 500, z / 500, 2)));
    // rock shows on steep faces, in streaks
    c.lerp(rock, smoothstep(0.5, 1.0, slope + 0.25 * fbm(x / 120, z / 60, 3)) * 0.9);
    col[q * 3] = c.r; col[q * 3 + 1] = c.g; col[q * 3 + 2] = c.b;
  }
  const idx = [];
  for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) {
    const a = j * W + i, b = a + 1, cc = a + W, d = cc + 1;
    idx.push(a, cc, d, a, d, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  mesh.receiveShadow = false;
  scene.add(mesh);
  return mesh;
}

// A simple lodge at the base with a pitched roof, windows and a chimney.
export function buildLodge(scene, terrain, x, z, yaw = 0) {
  const g = new THREE.Group();
  const y = terrain.terrainHeight(x, z);
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a4f2e, roughness: 0.8 });
  const roofM = new THREE.MeshStandardMaterial({ color: 0x3b3f4a, roughness: 0.7 });
  const snowM = new THREE.MeshStandardMaterial({ color: 0xf4f8fd, roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xffd58a, emissive: 0xffb347, emissiveIntensity: 0.6 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x8a8580, flatShading: true });
  const L = 26, D = 14, H = 6;
  const body = new THREE.Mesh(new THREE.BoxGeometry(L, H, D), wood); body.position.y = H / 2; g.add(body);
  const base = new THREE.Mesh(new THREE.BoxGeometry(L + 0.6, 1.2, D + 0.6), stone); base.position.y = 0.6; g.add(base);
  // roof: two slabs
  for (const s of [-1, 1]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(L + 2, 0.5, D * 0.62), roofM);
    slab.position.set(0, H + 2.3, s * D * 0.26); slab.rotation.x = -s * 0.62; g.add(slab);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(L + 2.1, 0.25, D * 0.6), snowM);
    cap.position.set(0, H + 2.62, s * D * 0.27); cap.rotation.x = -s * 0.62; g.add(cap);
  }
  // gable ends
  const gable = new THREE.Shape(); gable.moveTo(-D / 2, 0); gable.lineTo(D / 2, 0); gable.lineTo(0, 4.4); gable.closePath();
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.ShapeGeometry(gable), wood);
    m.position.set(s * L / 2, H, 0); m.rotation.y = s * Math.PI / 2; g.add(m);
  }
  // windows along the front and back
  for (const s of [-1, 1]) for (let i = -4; i <= 4; i++) {
    if (i === 0 && s === 1) continue;
    const w = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2, 0.1), glass);
    w.position.set(i * 2.7, 3.2, s * (D / 2 + 0.05)); g.add(w);
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3, 0.1), new THREE.MeshStandardMaterial({ color: 0x3a2416 }));
  door.position.set(0, 1.5, D / 2 + 0.06); g.add(door);
  // sign over the door
  {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const x2 = c.getContext('2d');
    x2.fillStyle = '#1f4fa8'; x2.fillRect(0, 0, 512, 128);
    x2.strokeStyle = '#ffd23a'; x2.lineWidth = 8; x2.strokeRect(4, 4, 504, 120);
    x2.fillStyle = '#fff'; x2.font = 'bold 50px Trebuchet MS, sans-serif'; x2.textAlign = 'center'; x2.textBaseline = 'middle';
    x2.fillText('🏆 COMPETITIONS', 256, 50); x2.font = 'bold 26px Trebuchet MS, sans-serif'; x2.fillText('SIGN UP INSIDE', 256, 100);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.BoxGeometry(6, 1.5, 0.12), [wood, wood, wood, wood, new THREE.MeshStandardMaterial({ map: tex }), wood]);
    sign.position.set(0, 4.3, D / 2 + 0.12); g.add(sign);
  }
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(1.6, 5, 1.6), stone); chimney.position.set(L / 2 - 4, H + 3.2, -2); g.add(chimney);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(x, y, z); g.rotation.y = yaw;
  scene.add(g);
  // picnic tables and racks in front
  const r = rng(5);
  for (let i = 0; i < 6; i++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 1), wood);
    const tx = x + (r() - 0.5) * 22, tz = z + D / 2 + 5 + r() * 6;
    t.position.set(tx, terrain.terrainHeight(tx, tz) + 0.4, tz); t.castShadow = true; scene.add(t);
  }
  return g;
}
