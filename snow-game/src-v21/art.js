// Art files (textures and the sky photo) in assets/. All from Poly Haven (CC0); see assets/CREDITS.md.
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const cache = new Map();

// A tiling texture from assets/textures. Colour images are sRGB; normal / roughness maps are data.
// Each call returns its own texture (so repeats can differ) sharing the one downloaded image.
export function tex(file, { srgb = false, repeat = [1, 1] } = {}) {
  let base = cache.get(file);
  if (!base) { base = loader.load(file.includes('/') ? file : 'assets/textures/' + file); cache.set(file, base); }
  const t = base.clone();
  t.source = base.source;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}

export const SKY_PHOTO = 'assets/sky/kloofendal_48d_partly_cloudy_puresky_2k.hdr';
