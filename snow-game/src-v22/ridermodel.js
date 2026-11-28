// Shapes for the riders: rounded limbs, a shaped jacket, helmet with mirrored goggles and a strap, a neck
// gaiter, chunky boots, mittens, a shaped snowboard with bindings and a printed top, shaped skis with
// bindings, and poles with grips and baskets. Every limb shape is "unit" sized (1 tall along y, about 1
// wide) because the rider's pose code stretches each one between its two joints.
import * as THREE from 'three';

// ---- unit body shapes ----
function capsule(r = 0.5, len = 0.5, radial = 12) {
  const g = new THREE.CapsuleGeometry(r, len, 4, radial);
  g.scale(1, 1 / (len + 2 * r), 1);       // total height 1, centred
  return g;
}
export const SHAPES = (() => {
  const limb = capsule(0.5, 0.55, 10);
  // torso: rounded, wider at the shoulders than the waist
  const torso = capsule(0.5, 0.45, 16);
  const p = torso.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i), k = 0.86 + 0.16 * (y + 0.5); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
  torso.computeVertexNormals();
  // boot: a rounded block, flat sole, toe a little lower than the cuff
  const boot = capsule(0.5, 0.5, 10); boot.rotateX(Math.PI / 2);
  const bp = boot.attributes.position;
  for (let i = 0; i < bp.count; i++) { bp.setY(i, Math.max(-0.38, bp.getY(i))); }
  boot.computeVertexNormals();
  const mitt = new THREE.SphereGeometry(0.5, 10, 8); mitt.scale(1, 1.15, 1.05);
  const head = new THREE.SphereGeometry(0.15, 16, 12);
  const pole = new THREE.CylinderGeometry(0.5, 0.35, 1, 6);
  return { limb, torso, boot, mitt, head, pole };
})();

// A canvas "print" for the top of a board or ski.
function printTexture(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const BOARD_PRINT = printTexture(64, 512, (g, w, h) => {
  g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h);
  const cols = ['#ff5a36', '#ffc23a', '#2bb3ff', '#1d2a44'];
  for (let i = 0; i < 9; i++) { g.fillStyle = cols[i % 4]; g.beginPath(); g.moveTo(0, 40 + i * 50); g.lineTo(w, 10 + i * 50); g.lineTo(w, 34 + i * 50); g.lineTo(0, 64 + i * 50); g.fill(); }
  g.fillStyle = '#1d2a44'; g.fillRect(0, h * 0.42, w, h * 0.16);
  g.save(); g.translate(w / 2, h / 2); g.rotate(-Math.PI / 2); g.fillStyle = '#fff'; g.font = 'bold 30px Trebuchet MS, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('POWDER', 0, 2); g.restore();
});
const SKI_PRINT = printTexture(32, 512, (g, w, h) => {
  g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#1d2a44'; g.fillRect(0, 0, w, h * 0.18); g.fillRect(0, h * 0.82, w, h * 0.18);
  g.fillStyle = '#ff5a36'; g.fillRect(w * 0.25, h * 0.18, w * 0.5, h * 0.64);
  g.fillStyle = '#ffc23a'; for (let i = 0; i < 6; i++) g.fillRect(0, h * 0.25 + i * h * 0.09, w, h * 0.025);
});

// A flat outline (x across, z along) turned into a thin plank with turned-up nose and tail, and the
// print mapped over the top. Returns a geometry with two groups: 0 = top and base, 1 = edges.
function plank(halfW, waistW, len, thick, rise, bendFrom) {
  const s = new THREE.Shape(), L = len / 2, nose = halfW;
  s.moveTo(-halfW, -L + nose);
  s.quadraticCurveTo(-waistW, 0, -halfW, L - nose);
  s.absarc(0, L - nose, halfW, Math.PI, 0, true);
  s.quadraticCurveTo(waistW, 0, halfW, -L + nose);
  s.absarc(0, -L + nose, halfW, 0, Math.PI, true);
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 10 });
  g.rotateX(Math.PI / 2);                 // shape y -> z, extrusion -> -y
  g.translate(0, thick, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i), a = Math.abs(z);
    if (a > bendFrom) p.setY(i, p.getY(i) + rise * ((a - bendFrom) / (L - bendFrom)) ** 2);
    uv.setXY(i, p.getX(i) / (halfW * 2) + 0.5, z / len + 0.5);
  }
  g.computeVertexNormals();
  return g;
}

export function buildBoard(mats) {
  const grp = new THREE.Group();
  const top = mats.boardTop; top.map = BOARD_PRINT; top.color.set(0xffffff); top.roughness = 0.4;   // print tinted by boardTop
  const deck = new THREE.Mesh(plank(0.145, 0.124, 1.55, 0.025, 0.13, 0.58), [top, mats.board]);
  deck.position.y = 0.012; deck.castShadow = true; grp.add(deck);
  // bindings: a base plate, two straps and a highback at each foot
  const bind = new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.6 });
  const strap = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.7 });
  const backs = [];
  for (const z of [-0.27, 0.27]) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.025, 0.2), bind); base.position.set(0, 0.05, z); grp.add(base);
    for (const dx of [0.03, -0.06]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.07, 0.21), strap); s.position.set(dx, 0.11, z); grp.add(s); }
    const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 10, 1, true, Math.PI * 0.6, Math.PI * 0.8), bind);
    hb.position.set(0, 0.16, z); hb.material.side = THREE.DoubleSide; grp.add(hb); backs.push(hb);
  }
  grp.userData.highbacks = backs;
  return grp;
}

// two skis as two groups (left first), each pivoting at its binding (z = 0.05)
export function buildSkis(mats) {
  const grp = new THREE.Group();
  const top = new THREE.MeshStandardMaterial({ map: SKI_PRINT, color: 0xffffff, roughness: 0.4 });
  const geo = plank(0.048, 0.038, 1.72, 0.02, 0.11, 0.62);
  const bind = new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.5, metalness: 0.3 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xff5a36, roughness: 0.5 });
  for (const sx of [-0.14, 0.14]) {
    const s = new THREE.Group(); s.position.set(sx, 0, 0.05);
    const ski = new THREE.Mesh(geo, [top, mats.ski]); ski.position.set(0, 0.012, -0.05); ski.castShadow = true; s.add(ski);
    const toe = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.09), bind); toe.position.set(0, 0.06, -0.15); s.add(toe);
    const heel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.1), bind); heel.position.set(0, 0.065, 0.17); s.add(heel);
    const brake = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.012, 0.05), accent); brake.position.set(0, 0.1, 0.17); s.add(brake);
    grp.add(s);
  }
  return grp;
}

// helmet strap, goggles (frame + mirrored lens, centred on the head), neck gaiter, jacket collar and zip
export function dressRider(r, mats) {
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.162, 0.014, 6, 28), mats.accent);
  strap.rotation.x = Math.PI / 2 - 0.15; strap.position.y = 0.025; r.helmet.add(strap);
  const frameG = new THREE.CylinderGeometry(0.172, 0.172, 0.075, 18, 1, true, -1.05, 2.1); frameG.translate(0, 0, -0.13);
  const lensG = new THREE.CylinderGeometry(0.176, 0.176, 0.058, 18, 1, true, -0.92, 1.84); lensG.translate(0, 0, -0.13);
  r.goggles.geometry = frameG; r.goggles.material = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.5, side: THREE.DoubleSide });
  const lens = new THREE.Mesh(lensG, mats.lens); r.goggles.add(lens);
  const gaiter = new THREE.Mesh(new THREE.CylinderGeometry(0.128, 0.12, 0.13, 14), mats.accent);
  gaiter.position.y = -0.075; r.head.add(gaiter);
  // collar and zip live in the torso's unit space (the torso is stretched between hips and neck)
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.12, 16), mats.accent); collar.position.y = 0.47; r.torso.add(collar);
  const zip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.82, 0.04), mats.accent); zip.position.set(0, 0.02, 0.49); r.torso.add(zip);
  const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.08, 16), mats.accent); hem.position.y = -0.44; r.torso.add(hem);
}

// pole grip and basket, in the pole's unit space
export function dressPole(pole, mats) {
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.0, 0.14, 8), mats.glove); grip.position.y = 0.42; pole.add(grip);
  const basket = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.012, 10), mats.accent); basket.position.y = -0.44; pole.add(basket);
}
