// One mountain run built from a heightmap.
// Downhill is -z. "s" = distance down the run (s = -z). The run meanders left/right.
import * as THREE from 'three';

export const RUN_LENGTH = 1000;      // finish line at s = RUN_LENGTH
const RUNOUT = 140;                  // flat area past the finish
const CELL = 2.5;                    // grid size in meters (low-poly look)
const HALF_W = 110;                  // grid half width
const TOP_PAD = 40;                  // grid starts this far above the start

// Seeded random so the mountain is the same every run.
function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

// Course centerline x for distance s.
export function centerX(s) { return 22 * Math.sin(s / 170) + 9 * Math.sin(s / 63 + 1.3); }
function centerSlope(s) { return 22 / 170 * Math.cos(s / 170) + 9 / 63 * Math.cos(s / 63 + 1.3); }
// Half width of the open, groomed part of the run.
export function halfWidth(s) { return 30 + 8 * Math.sin(s / 110); }

// Slope steepness (rise/run) along the run: gentle top, steep middle, easier bottom, flat runout.
function steepness(s) {
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  let k = 0.18;
  k += 0.21 * ss(130, 260, s);       // into the steep middle
  k -= 0.15 * ss(700, 820, s);      // ease off near the bottom
  k -= 0.25 * ss(RUN_LENGTH + 10, RUN_LENGTH + 60, s); // runout
  return k;
}

// Cliff: a drop across the middle of the run, fading out at the sides so you can ride around it.
export const CLIFF_S = 630, CLIFF_DROP = 7;

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.cols = Math.round(2 * HALF_W / CELL);
    this.rows = Math.round((TOP_PAD + RUN_LENGTH + RUNOUT) / CELL);
    this.x0 = -HALF_W;
    this.z0 = TOP_PAD;
    this._buildBaseProfile();
    this._buildHeights();
    this.kickers = [];
    this.trees = [];
    this._buildMesh();
    this._buildKickers();
    this._buildTrees();
    this._buildRocks();
    this._buildGates();
  }

  // Integrate steepness to get the base elevation along the run.
  _buildBaseProfile() {
    const n = this.rows + 2;
    this.base = new Float32Array(n);
    let h = 600;
    for (let j = 0; j < n; j++) {
      const s = j * CELL - TOP_PAD;
      this.base[j] = h;
      h -= steepness(s) * CELL;
    }
  }

  baseAt(s) {
    const f = (s + TOP_PAD) / CELL;
    const j = Math.max(0, Math.min(this.base.length - 2, Math.floor(f)));
    const t = f - j;
    return this.base[j] * (1 - t) + this.base[j + 1] * t;
  }

  // Analytic height used to fill the grid.
  rawHeight(x, s) {
    const cx = centerX(s);
    const d = Math.abs(x - cx);
    const hw = halfWidth(s);
    let h = this.baseAt(s);
    // valley walls
    if (d > hw) { const e = d - hw; h += e * 0.16 + e * e * 0.009; }
    // gentle rolling bumps (smaller in the middle of the run)
    const bump = 0.45 * Math.sin(x * 0.083 + s * 0.051) * Math.sin(s * 0.071 + 0.7)
               + 0.25 * Math.sin(x * 0.21 - s * 0.13) + 0.15 * Math.sin(x * 0.37 + s * 0.29);
    h += bump * (0.5 + Math.min(1, d / hw) * 0.8);
    // cliff
    if (s > CLIFF_S) {
      const w = 1 - Math.min(1, Math.max(0, (Math.abs(x - cx) - 14) / 12));
      const t = Math.min(1, (s - CLIFF_S) / 2.5);
      h -= CLIFF_DROP * w * w * (3 - 2 * w) * t;
    }
    return h;
  }

  _buildHeights() {
    const { cols, rows } = this;
    this.H = new Float32Array((cols + 1) * (rows + 1));
    for (let j = 0; j <= rows; j++) {
      const s = j * CELL - TOP_PAD;
      for (let i = 0; i <= cols; i++) this.H[j * (cols + 1) + i] = this.rawHeight(this.x0 + i * CELL, s);
    }
  }

  // Height of the rendered terrain mesh (exact triangle interpolation).
  terrainHeight(x, z) {
    const gx = (x - this.x0) / CELL, gz = (this.z0 - z) / CELL;
    let i = Math.floor(gx), j = Math.floor(gz);
    i = Math.max(0, Math.min(this.cols - 1, i)); j = Math.max(0, Math.min(this.rows - 1, j));
    const fx = Math.min(1, Math.max(0, gx - i)), fz = Math.min(1, Math.max(0, gz - j));
    const W = this.cols + 1, H = this.H;
    const a = H[j * W + i], b = H[j * W + i + 1], c = H[(j + 1) * W + i], d = H[(j + 1) * W + i + 1];
    if (fx >= fz) return a + (b - a) * fx + (d - b) * fz;
    return a + (d - c) * fx + (c - a) * fz;
  }

  // Ground height including kickers.
  heightAt(x, z) {
    let h = this.terrainHeight(x, z);
    for (const k of this.kickers) {
      const dx = x - k.x, dz = z - k.z;
      const u = dx * k.dx + dz * k.dz;      // along the ramp (downhill)
      const v = dx * k.px + dz * k.pz;      // across
      if (u < 0 || u > k.len || Math.abs(v) > k.w / 2) continue;
      h = Math.max(h, k.baseH + k.profile(u));
    }
    return h;
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.35;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    out.set(-hx, 2 * e, -hz).normalize();
    // kicker side walls are vertical; don't let them produce a wall normal
    if (out.y < 0.55) {
      const tx = this.terrainHeight(x + e, z) - this.terrainHeight(x - e, z);
      const tz = this.terrainHeight(x, z + e) - this.terrainHeight(x, z - e);
      out.set(-tx, 2 * e, -tz).normalize();
    }
    return out;
  }

  // Ground normal measured from the snow just behind the rider (direction tx,tz = travel).
  // Keeps the ramp angle all the way to a kicker lip instead of averaging in the drop beyond it.
  normalBehind(x, z, tx, tz, out = new THREE.Vector3()) {
    const l = Math.hypot(tx, tz);
    if (l < 1e-3) return this.normalAt(x, z, out);
    tx /= l; tz /= l;
    const e = 0.4, sx = -tz, sz = tx;
    const h0 = this.heightAt(x, z);
    const hb = this.heightAt(x - tx * e, z - tz * e);
    const hl = this.heightAt(x - sx * e, z - sz * e), hr = this.heightAt(x + sx * e, z + sz * e);
    const along = new THREE.Vector3(tx * e, h0 - hb, tz * e);
    const across = new THREE.Vector3(sx * 2 * e, hr - hl, sz * 2 * e);
    out.crossVectors(across, along).normalize();
    if (out.y < 0) out.negate();
    if (out.y < 0.55) return this.normalAt(x, z, out);
    return out;
  }

  _buildMesh() {
    const { cols, rows } = this;
    const W = cols + 1;
    const pos = new Float32Array(W * (rows + 1) * 3);
    const col = new Float32Array(W * (rows + 1) * 3);
    const r = rng(7);
    const snow = new THREE.Color(0xeef4fc), blue = new THREE.Color(0xb3cbe8), rock = new THREE.Color(0x6f747c);
    const tmp = new THREE.Color();
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const k = j * W + i;
        const x = this.x0 + i * CELL, z = this.z0 - j * CELL;
        pos[k * 3] = x; pos[k * 3 + 1] = this.H[k]; pos[k * 3 + 2] = z;
        // steepness from neighbors for coloring
        const hl = this.H[j * W + Math.max(0, i - 1)], hr = this.H[j * W + Math.min(cols, i + 1)];
        const hu = this.H[Math.max(0, j - 1) * W + i], hd = this.H[Math.min(rows, j + 1) * W + i];
        const g = Math.hypot(hr - hl, hd - hu) / (2 * CELL);
        tmp.copy(snow).lerp(blue, Math.min(1, r() * 0.45 + Math.max(0, g - 0.25) * 1.5));
        if (g > 0.9) tmp.lerp(rock, Math.min(1, (g - 0.9) * 1.5));
        col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
      }
    }
    const idx = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.mesh = mesh;
  }

  _buildKickers() {
    // [s, offset from center, lip angle vs the slope (rise/run), length, width]
    const list = [
      [110, 0, 0.45, 7, 6],
      [260, -8, 0.5, 8, 6],
      [370, 10, 0.47, 9, 7],
      [460, -6, 0.52, 10, 8],
      [550, 6, 0.46, 8, 7],
      [760, -10, 0.5, 10, 8],
      [860, 8, 0.54, 11, 9],
      [940, -4, 0.5, 8, 7],
    ];
    const mat = new THREE.MeshStandardMaterial({ color: 0xe8f1ff, flatShading: true, roughness: 0.85 });
    const lipMat = new THREE.MeshStandardMaterial({ color: 0x2a64c8, roughness: 0.6 });
    for (const [s, off, lipAngle, len, w] of list) {
      const height = lipAngle * len / 1.65; // profile end slope = 1.65 * height / len
      const cs = centerSlope(s);
      // downhill direction in xz: s increases toward -z, x changes by cs per s
      let dx = cs, dz = -1; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
      const k = { x: centerX(s) + off, z: -s, dx, dz, px: -dz, pz: dx, len, w, height };
      k.baseH = Infinity;
      // lowest terrain under the footprint so the ramp never dips under the snow
      for (let u = 0; u <= len; u += 1) for (let v = -w / 2; v <= w / 2; v += 1)
        k.baseH = Math.min(k.baseH, this.terrainHeight(k.x + dx * u + k.px * v, k.z + dz * u + k.pz * v));
      // ramp profile rises above the terrain at the base; we blend from terrain at u=0
      const startH = this.terrainHeight(k.x, k.z) - k.baseH;
      const N = 8;
      const prof = [];
      for (let n = 0; n <= N; n++) { const t = n / N; prof.push(startH * (1 - t) + height * (0.35 * t + 0.65 * t * t)); }
      k.profile = (u) => { const f = Math.min(N - 1e-6, (u / len) * N); const n = Math.floor(f); return prof[n] + (prof[n + 1] - prof[n]) * (f - n); };
      k.lipH = k.baseH + height;
      this.kickers.push(k);
      this.scene.add(this._kickerMesh(k, prof, N, mat, lipMat));
    }
  }

  _kickerMesh(k, prof, N, mat, lipMat) {
    const verts = [];
    const P = (u, v, hOff) => {
      const x = k.x + k.dx * u + k.px * v, z = k.z + k.dz * u + k.pz * v;
      return [x, hOff === null ? this.terrainHeight(x, z) - 0.3 : k.baseH + hOff, z];
    };
    const tri = (a, b, c) => verts.push(...a, ...b, ...c);
    const hw = k.w / 2;
    for (let n = 0; n < N; n++) {
      const u0 = k.len * n / N, u1 = k.len * (n + 1) / N;
      const L0 = P(u0, -hw, prof[n]), R0 = P(u0, hw, prof[n]), L1 = P(u1, -hw, prof[n + 1]), R1 = P(u1, hw, prof[n + 1]);
      tri(L0, L1, R1); tri(L0, R1, R0);
      // sides
      const L0b = P(u0, -hw, null), L1b = P(u1, -hw, null), R0b = P(u0, hw, null), R1b = P(u1, hw, null);
      tri(L0b, L1b, L1); tri(L0b, L1, L0);
      tri(R0b, R1, R1b); tri(R0b, R0, R1);
    }
    // back face
    const Lt = P(k.len, -hw, prof[N]), Rt = P(k.len, hw, prof[N]), Lb = P(k.len, -hw, null), Rb = P(k.len, hw, null);
    tri(Lt, Lb, Rb); tri(Lt, Rb, Rt);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    const g = new THREE.Group();
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
    mat.side = THREE.DoubleSide;
    g.add(m);
    // blue lip stripe so you can read the kicker from far away
    const lip = new THREE.Mesh(new THREE.BoxGeometry(k.w, 0.08, 0.3), lipMat);
    const lp = P(k.len - 0.15, 0, prof[N] + 0.02);
    lip.position.set(lp[0], lp[1], lp[2]);
    lip.rotation.y = Math.atan2(-k.dx, -k.dz);
    g.add(lip);
    return g;
  }

  _buildTrees() {
    const r = rng(42);
    const spots = [];
    for (let s = -TOP_PAD; s < RUN_LENGTH + RUNOUT; s += 3.2) {
      const cx = centerX(s), hw = halfWidth(s);
      for (const side of [-1, 1]) {
        // dense forest beyond the edge
        for (let n = 0; n < 3; n++) {
          const d = hw + 2 + r() * 45 * (n + 1) / 3;
          if (r() < 0.55) spots.push([cx + side * d, -s + (r() - 0.5) * 3, 0.8 + r() * 0.7]);
        }
      }
      // a few lone trees inside the run to dodge
      if (r() < 0.025 && s > 60 && s < RUN_LENGTH - 30 && Math.abs(s - CLIFF_S) > 30) {
        spots.push([cx + (r() - 0.5) * hw * 1.4, -s, 0.9 + r() * 0.4]);
      }
    }
    // keep trees off kickers
    const clear = spots.filter(([x, z]) => !this.kickers.some(k => Math.hypot(x - k.x, z - k.z) < k.len + 6) && Math.abs(x) < HALF_W - 3);
    const n = clear.length;
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 1.6, 5);
    const coneA = new THREE.ConeGeometry(1.7, 3.6, 6);
    const coneB = new THREE.ConeGeometry(1.2, 2.8, 6);
    const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a3b26, flatShading: true }), n);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f6b46, flatShading: true, roughness: 0.8 });
    const lowC = new THREE.InstancedMesh(coneA, leafMat, n);
    const topC = new THREE.InstancedMesh(coneB, leafMat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const tint = new THREE.Color();
    clear.forEach(([x, z, size], i) => {
      const y = this.terrainHeight(x, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      sc.set(size, size, size);
      m.compose(p.set(x, y + 0.8 * size, z), q, sc); trunk.setMatrixAt(i, m);
      m.compose(p.set(x, y + 3.0 * size, z), q, sc); lowC.setMatrixAt(i, m);
      m.compose(p.set(x, y + 4.7 * size, z), q, sc); topC.setMatrixAt(i, m);
      tint.setHSL(0.38 + r() * 0.06, 0.35 + r() * 0.2, 0.22 + r() * 0.1);
      lowC.setColorAt(i, tint); topC.setColorAt(i, tint);
      this.trees.push({ x, z, y, r: 0.45 * size, h: 6 * size, i, kind: 'tree' });
    });
    this.treeMeshes = [trunk, lowC, topC];
    for (const im of this.treeMeshes) { im.castShadow = true; im.receiveShadow = true; this.scene.add(im); }
    // spatial buckets for collision
    this.treeGrid = new Map();
    for (const t of this.trees) {
      const key = `${Math.floor(t.x / 10)},${Math.floor(t.z / 10)}`;
      if (!this.treeGrid.has(key)) this.treeGrid.set(key, []);
      this.treeGrid.get(key).push(t);
    }
  }

  // Remove trees within `width` meters of the line a-b (Vector3s; y ignored). Used to cut lift lines.
  clearTreesAlong(a, b, width) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const abx = b.x - a.x, abz = b.z - a.z, L2 = abx * abx + abz * abz;
    const keep = [];
    for (const t of this.trees) {
      const u = Math.max(0, Math.min(1, ((t.x - a.x) * abx + (t.z - a.z) * abz) / L2));
      const d = Math.hypot(t.x - (a.x + abx * u), t.z - (a.z + abz * u));
      if (t.kind === 'tree' && d < width) { for (const im of this.treeMeshes) im.setMatrixAt(t.i, zero); }
      else keep.push(t);
    }
    for (const im of this.treeMeshes) im.instanceMatrix.needsUpdate = true;
    this.trees = keep;
    this._rebuildTreeGrid();
  }

  // Something solid the rider can hit (lift towers, etc.).
  addObstacle(x, z, r, h, kind) {
    this.trees.push({ x, z, y: this.terrainHeight(x, z), r, h, kind });
    this._rebuildTreeGrid();
  }

  _rebuildTreeGrid() {
    this.treeGrid = new Map();
    for (const t of this.trees) {
      const key = `${Math.floor(t.x / 10)},${Math.floor(t.z / 10)}`;
      if (!this.treeGrid.has(key)) this.treeGrid.set(key, []);
      this.treeGrid.get(key).push(t);
    }
  }

  treeNear(x, z) {
    const bx = Math.floor(x / 10), bz = Math.floor(z / 10);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const list = this.treeGrid.get(`${bx + a},${bz + b}`);
      if (!list) continue;
      for (const t of list) if (Math.hypot(t.x - x, t.z - z) < t.r + 0.35) return t;
    }
    return null;
  }

  _buildRocks() {
    // rocks along the cliff face
    const r = rng(99);
    const mat = new THREE.MeshStandardMaterial({ color: 0x777c84, flatShading: true, roughness: 1 });
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const n = 26;
    const im = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const cx = centerX(CLIFF_S + 1.5);
    for (let i = 0; i < n; i++) {
      const x = cx + (r() - 0.5) * 34, s = CLIFF_S + 1 + r() * 1.5;
      const y = this.terrainHeight(x, -s) - 0.4;
      e.set(r() * 3, r() * 3, r() * 3); q.setFromEuler(e);
      const sz = 0.8 + r() * 1.3;
      m.compose(new THREE.Vector3(x, y, -s), q, new THREE.Vector3(sz * 1.3, sz, sz));
      im.setMatrixAt(i, m);
    }
    im.castShadow = true;
    this.scene.add(im);
    // warning flags at the cliff edge
    const flagMat = new THREE.MeshStandardMaterial({ color: 0xff8a1f });
    for (const off of [-16, -8, 0, 8, 16]) {
      const x = cx + off, z = -(CLIFF_S - 25);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 4), flagMat);
      pole.position.set(x, this.terrainHeight(x, z) + 0.9, z);
      this.scene.add(pole);
    }
  }

  _buildGates() {
    const make = (s, color, label) => {
      const cx = centerX(s), hw = halfWidth(s) - 4;
      const z = -s;
      const mat = new THREE.MeshStandardMaterial({ color });
      const g = new THREE.Group();
      for (const side of [-1, 1]) {
        const x = cx + side * hw;
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), mat);
        pole.position.set(x, this.terrainHeight(x, z) + 3.5, z);
        pole.castShadow = true;
        g.add(pole);
      }
      const yTop = Math.max(this.terrainHeight(cx - hw, z), this.terrainHeight(cx + hw, z)) + 6.5;
      const banner = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 1.4, 0.2), new THREE.MeshStandardMaterial({ map: this._labelTexture(label, color) }));
      banner.position.set(cx, yTop, z);
      g.add(banner);
      this.scene.add(g);
    };
    make(2, 0x2a64c8, 'START');
    make(RUN_LENGTH, 0xe04a3a, 'FINISH');
  }

  _labelTexture(text, color) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#' + new THREE.Color(color).getHexString(); g.fillRect(0, 0, 512, 64);
    g.fillStyle = '#fff'; g.font = 'bold 44px Trebuchet MS, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 256, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  spawnPoint() { const s = 4; return new THREE.Vector3(centerX(s), this.heightAt(centerX(s), -s), -s); }
}
