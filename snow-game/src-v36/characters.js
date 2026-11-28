// The riders you can be. Each has their own outfit, skin tone, board colours and either a helmet or a
// knit beanie with a pom. In a room or a race no two riders wear the same one: whoever joined first keeps
// theirs, and anyone else with it is moved to the next free one (see freeCharacter).
import * as THREE from 'three';

export const CHARACTERS = [
  { id: 'blaze',    name: 'Blaze',    jacket: 0xff6a2b, pants: 0x23324d, hat: 'helmet', hatColor: 0x1e8fd6, skin: 0xf0c39a, board: 0x1b1b22, top: 0xffd23a, accent: 0x1d2230, glove: 0x222222, lens: 0xff9a3c },
  { id: 'frost',    name: 'Frost',    jacket: 0xeaf4ff, pants: 0x8fa3b8, hat: 'helmet', hatColor: 0xf7f7f7, skin: 0xffdcc0, board: 0x2b6cb0, top: 0x8fd3ff, accent: 0x5c7a99, glove: 0x3a4a5c, lens: 0x4fd1ff },
  { id: 'pine',     name: 'Pine',     jacket: 0x2e7d4f, pants: 0x5a3d2b, hat: 'beanie', hatColor: 0xd63030, skin: 0xc68a5e, board: 0x3a2a1a, top: 0x8bd94b, accent: 0xf2e6c9, glove: 0x4a3222, lens: 0xffc23a },
  { id: 'ruby',     name: 'Ruby',     jacket: 0xd62839, pants: 0x141414, hat: 'helmet', hatColor: 0xffffff, skin: 0x8d5a3b, board: 0xf2f2f2, top: 0xff5a6e, accent: 0x141414, glove: 0x141414, lens: 0xc0c0c8 },
  { id: 'violet',   name: 'Violet',   jacket: 0x7b4fd6, pants: 0x13a89e, hat: 'beanie', hatColor: 0xffd23a, skin: 0xe8b48f, board: 0x13a89e, top: 0xc9a7ff, accent: 0x2a1d4a, glove: 0x2a1d4a, lens: 0xb06cff },
  { id: 'sunny',    name: 'Sunny',    jacket: 0xffd23a, pants: 0x4a4d55, hat: 'helmet', hatColor: 0x1b1b1b, skin: 0xf5cfa8, board: 0x1b1b1b, top: 0xffe680, accent: 0x1b1b1b, glove: 0x1b1b1b, lens: 0x3a9bff },
  { id: 'midnight', name: 'Midnight', jacket: 0x1c1f2a, pants: 0x101218, hat: 'helmet', hatColor: 0xd63030, skin: 0x5e3a26, board: 0xd63030, top: 0x3a3f55, accent: 0xd63030, glove: 0x101218, lens: 0xffb020 },
  { id: 'coral',    name: 'Coral',    jacket: 0xff7aa8, pants: 0xf2f2f2, hat: 'beanie', hatColor: 0x15b3c4, skin: 0xa86b48, board: 0x15b3c4, top: 0xffb3cc, accent: 0x15b3c4, glove: 0xf2f2f2, lens: 0xff5aa0 },
];
export const CHAR_BY_ID = Object.fromEntries(CHARACTERS.map(c => [c.id, c]));
export const charOf = (id) => CHAR_BY_ID[id] || CHARACTERS[0];
export const cssColor = (hex) => '#' + hex.toString(16).padStart(6, '0');

// Dress a rider (rider.js) as a character.
export function applyLook(r, id) {
  const c = charOf(id), M = r.mats;
  if (r.lookId === c.id) return;
  r.lookId = c.id;
  M.jacket.color.setHex(c.jacket); M.pants.color.setHex(c.pants); M.skin.color.setHex(c.skin);
  M.helmet.color.setHex(c.hatColor); M.helmet.roughness = c.hat === 'beanie' ? 0.95 : 0.3;
  M.board.color.setHex(c.board); M.ski.color.setHex(c.board);
  M.boardTop.color.setHex(c.top).lerp(new THREE.Color(1, 1, 1), 0.45);
  M.accent.color.setHex(c.accent); M.glove.color.setHex(c.glove);
  M.lens.color.setHex(c.lens); M.lens.emissive.setHex(c.lens).multiplyScalar(0.18);
  // beanie: a taller knit cap with a folded cuff and a pom instead of the helmet and its strap
  if (!r.beanie) {
    const knit = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    const g = new THREE.Group();
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.176, 0.176, 0.06, 18, 1, true), knit); cuff.position.y = 0.03; cuff.material.side = THREE.DoubleSide;
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), knit); pom.position.y = 0.2;
    g.add(cuff, pom); r.helmet.add(g);
    r.beanie = g; r.beanieMat = knit;
  }
  const beanie = c.hat === 'beanie';
  r.beanie.visible = beanie;
  r.beanieMat.color.setHex(0xf4f4f4);
  r.helmet.scale.set(1, beanie ? 1.18 : 1, 1);
  if (r.helmetStrap) r.helmetStrap.visible = !beanie;
}

// The first character nobody else is using (`taken` = ids), starting from the one you want.
export function freeCharacter(want, taken) {
  if (!taken.has(want)) return want;
  const i = Math.max(0, CHARACTERS.findIndex(c => c.id === want));
  for (let k = 1; k <= CHARACTERS.length; k++) { const c = CHARACTERS[(i + k) % CHARACTERS.length]; if (!taken.has(c.id)) return c.id; }
  return want;
}
