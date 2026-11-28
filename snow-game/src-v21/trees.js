// Detailed trees near the camera. The whole forest (about 5,800 trees) is drawn as simple stand-ins
// (terrain.js); the trees within `radius` of the camera swap to the real pine models (Quaternius, CC0,
// assets/trees), with snow on the upward-facing branches. Re-picked whenever the camera moves 5 m.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TREE_VARIANTS } from './terrain.js';
import { tex } from './art.js';

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// Snow settles on whatever faces up: whiten those faces (a bit more or less on each tree).
function snowy(mat, amount) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vSnowUp;\nvarying float vSnowH;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 snN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
vSnowUp = snN.y;
vSnowH = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSnowUp;\nvarying float vSnowH;')
      .replace('#include <map_fragment>', `#include <map_fragment>
float snUp = gl_FrontFacing ? vSnowUp : -vSnowUp;
float snowK = smoothstep(0.3, 0.75, snUp + (vSnowH - 0.5) * 0.6) * ${amount.toFixed(2)};
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 1.0), snowK);`);
  };
  mat.customProgramCacheKey = () => 'snowy-tree-' + amount;
  return mat;
}

export class TreeLOD {
  constructor(scene, terrain, { radius = 110, max = 900 } = {}) {
    this.scene = scene; this.terrain = terrain; this.radius = radius; this.max = max;
    this.ready = false; this.shown = new Set(); this.lastPos = null;
    this._load().catch(e => console.warn('tree models failed to load; keeping simple trees', e));
  }

  async _load() {
    const leaf = snowy(new THREE.MeshStandardMaterial({ map: tex('assets/trees/tex/leaf_pine.png', { srgb: true }), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9 }), 0.75);
    const bark = snowy(new THREE.MeshStandardMaterial({ map: tex('assets/trees/tex/bark_pine.jpg', { srgb: true }), roughness: 1 }), 0.4);
    const dead = snowy(new THREE.MeshStandardMaterial({ map: tex('assets/trees/tex/bark_dead.jpg', { srgb: true }), color: 0xb8b0a8, roughness: 1 }), 0.6);
    const loader = new GLTFLoader();
    const models = await Promise.all(TREE_VARIANTS.map(v => loader.loadAsync(`assets/trees/${v.file}.glb`)));
    this.variants = models.map((g, vi) => {
      const parts = [];
      g.scene.updateMatrixWorld(true);
      g.scene.traverse(o => {
        if (!o.isMesh) return;
        const geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld);
        const mat = vi === 5 ? dead : /leaves|leaf/i.test(o.material.name) ? leaf : bark;
        const im = new THREE.InstancedMesh(geo, mat, this.max);
        im.count = 0; im.frustumCulled = false; im.receiveShadow = true;
        this.scene.add(im); parts.push(im);
      });
      return parts;
    });
    this.ready = true;
  }

  // call every frame with the camera position
  update(cam) {
    if (!this.ready) return;
    if (this.lastPos && (cam.x - this.lastPos.x) ** 2 + (cam.z - this.lastPos.z) ** 2 < 25) return;
    this.lastPos = { x: cam.x, z: cam.z };
    const R2 = this.radius * this.radius, near = new Set(), counts = this.variants.map(() => 0);
    for (const t of this.terrain.trees) {
      if (t.kind !== 'tree' || !t.near) continue;
      const dx = t.x - cam.x, dz = t.z - cam.z;
      if (dx * dx + dz * dz > R2 || counts[t.v] >= this.max) continue;
      for (const im of this.variants[t.v]) im.setMatrixAt(counts[t.v], t.near);
      counts[t.v]++; near.add(t);
    }
    this.variants.forEach((parts, v) => { for (const im of parts) { im.count = counts[v]; im.instanceMatrix.needsUpdate = true; } });
    // the simple stand-ins: hide the ones now drawn in detail, bring back the ones that dropped out
    const touched = new Set();
    for (const t of near) if (!this.shown.has(t)) { t.mesh.setMatrixAt(t.i, ZERO); touched.add(t.mesh); }
    for (const t of this.shown) if (!near.has(t)) { t.mesh.setMatrixAt(t.i, t.far); touched.add(t.mesh); }
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
    this.shown = near;
  }
}
