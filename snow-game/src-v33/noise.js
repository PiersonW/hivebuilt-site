// Small deterministic noise helpers (value noise + fractal sums). No dependencies.

export function rng(seed) {
  let s = seed % 2147483647; if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function hash(ix, iy) {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h & 0xffffff) / 0xffffff;      // 0..1
}

// Smooth value noise in -1..1.
export function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

// Fractal sum, roughly -1..1.
export function fbm(x, y, oct = 4) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { sum += amp * noise2(x * f + i * 17.3, y * f - i * 9.1); norm += amp; amp *= 0.5; f *= 2.03; }
  return sum / norm;
}

// Ridged fractal (sharp crests) 0..1 — used for mountain ranges.
export function ridged(x, y, oct = 5) {
  let sum = 0, amp = 0.5, f = 1, norm = 0, prev = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(noise2(x * f + i * 31.7, y * f + i * 11.3));
    n *= n;
    sum += n * amp * prev; norm += amp;
    prev = n; amp *= 0.5; f *= 2.1;
  }
  return sum / norm;
}

export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
