// Chairlift art: a quad chair and a lift tower (both "Poly by Google", CC-BY 3.0, via Poly Pizza; see
// assets/CREDITS.md). Loaded once, then every Chairlift swaps its simple blocks for these.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// chair model: hanger grip at the top (x 1.35, y 129, z 5.75), seat top at y ~8, facing +z, ~122 units grip-to-seat
const CHAIR = { grip: [1.35, 129, 5.75], scale: 2.6 / 121 };
// tower model: cable wheels at x = ±155, cable over the wheels at y ~293, foot at y = -432; the pole is everything below y 180
const TOWER = { halfWidth: 155, cableY: 293, footY: -432, cutY: 180 };

let loading = null;
export function loadLiftArt() {
  if (loading) return loading;
  const loader = new GLTFLoader();
  loading = Promise.all([loader.loadAsync('assets/lift/quad_chair.glb'), loader.loadAsync('assets/lift/lift_tower.glb')]).then(([chairG, towerG]) => {
    // chair: one mesh; move the grip to the origin, scale to metres, turn to face -z (our chairs' forward)
    let chair = null;
    chairG.scene.updateMatrixWorld(true);
    chairG.scene.traverse(o => { if (o.isMesh && !chair) chair = o; });
    const cg = chair.geometry.clone().applyMatrix4(chair.matrixWorld);
    cg.translate(-CHAIR.grip[0], -CHAIR.grip[1], -CHAIR.grip[2]); cg.scale(CHAIR.scale, CHAIR.scale, CHAIR.scale); cg.rotateY(Math.PI);
    cg.computeVertexNormals();
    // tower: the pillar (pole + crossarm) and the wheel trains; the model's own cables are dropped (we have ours)
    towerG.scene.updateMatrixWorld(true);
    let pillar = null, mat = null; const rollers = [];
    towerG.scene.traverse(o => {
      if (!o.isMesh || /cable/i.test(o.name)) return;
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (/pillar/i.test(o.name)) pillar = g; else rollers.push(g);
      mat = o.material;
    });
    const steel = mat.clone(); steel.color = new THREE.Color(0x8d95a1); steel.metalness = 0.5; steel.roughness = 0.45;
    const wheels = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.4, roughness: 0.5 });
    const chairMat = chair.material;
    return { chairGeo: cg, chairMat, pillar, rollers: mergeGeometries(rollers), steel, wheels };
  });
  return loading;
}

// A tower at (x, ground y, z) with the cable at cableY, turned so its wheel trains run along the lift (yaw).
export function towerMesh(art, gy, cableY, yaw) {
  const s = TOWER.halfWidth, k = 2.3 / s;            // model units -> metres (wheels sit 2.3 m either side)
  const headH = (TOWER.cableY - TOWER.cutY) * k;     // crossarm and wheels keep their real size
  const poleH = Math.max(2, cableY - gy - headH);
  const stretch = poleH / ((TOWER.cutY - TOWER.footY) * k);
  const g = art.pillar.clone(), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let y = p.getY(i);
    y = y < TOWER.cutY ? (y - TOWER.cutY) * stretch : y - TOWER.cutY;     // stretch only the pole
    p.setY(i, y);
  }
  g.scale(k, k, k); g.translate(0, poleH, 0);
  g.computeVertexNormals(); g.computeBoundingSphere();
  const grp = new THREE.Group();
  const pole = new THREE.Mesh(g, art.steel); pole.castShadow = true;
  const wheels = new THREE.Mesh(art.rollers, art.wheels); wheels.scale.setScalar(k); wheels.position.y = poleH - TOWER.cutY * k; wheels.castShadow = true;
  grp.add(pole, wheels);
  grp.position.y = gy; grp.rotation.y = yaw;
  return grp;
}
