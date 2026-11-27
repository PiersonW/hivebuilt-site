// The resort's runs. Each run is a smooth path down the mountain (control points in world x,z;
// downhill is -z). Runs cross and join each other on purpose. Terrain carves a groomed corridor
// along each one (see terrain.js).

export const DIFF = {
  green: { label: 'Easier', color: '#2e9d4a', minSlope: 0.07 },
  blue: { label: 'More difficult', color: '#2a64c8', minSlope: 0.10 },
  black: { label: 'Most difficult', color: '#111111', minSlope: 0.14 },
  park: { label: 'Terrain park', color: '#ff7a1a', minSlope: 0.10 },
};

export const RUN_DEFS = [
  {
    id: 'main', name: 'Main Street', diff: 'blue', width: 40,
    pts: [[48, 0], [60, -140], [25, -290], [38, -430], [40, -560], [36, -690], [80, -820], [62, -960], [12, -1100], [40, -1250], [95, -1345], [124, -1418]],
  },
  {
    id: 'long', name: 'Long Haul', diff: 'green', width: 34,
    pts: [[30, 2], [-50, -110], [-170, -210], [-232, -360], [-212, -520], [-140, -680], [-70, -800], [-110, -930], [-215, -1060], [-200, -1210], [-235, -1320], [-276, -1420]],
  },
  {
    id: 'chute', name: 'Rocky Chute', diff: 'black', width: 26,
    pts: [[62, 0], [140, -110], [200, -270], [232, -440], [222, -600], [244, -760], [205, -930], [165, -1080], [150, -1240], [150, -1330], [126, -1418]],
  },
  {
    id: 'cross', name: 'Crossover', diff: 'blue', width: 30,
    pts: [[170, -170], [120, -330], [40, -480], [-50, -570], [-120, -660], [-118, -735]],
  },
  {
    id: 'park', name: 'The Yard', diff: 'park', width: 50,
    pts: [[-106, -932], [-100, -1010], [-98, -1090], [-106, -1170], [-126, -1250], [-170, -1318], [-214, -1332]],
  },
  {
    id: 'timber', name: 'Timber Line', diff: 'blue', width: 30,
    pts: [[-305, -640], [-330, -780], [-336, -910], [-326, -1050], [-332, -1190], [-305, -1330], [-278, -1418]],
  },
  {
    id: 'ridge', name: 'Ridge Run', diff: 'black', width: 26,
    pts: [[-278, -645], [-205, -760], [-120, -860], [-30, -930], [40, -990], [140, -1110], [100, -1270], [122, -1416]],
  },
];

const STEP = 2;  // meters between path samples

export class Run {
  constructor(def) {
    Object.assign(this, def);
    this.hw = def.width / 2;
    this._build();
  }

  // Catmull-Rom through the control points, resampled every STEP meters.
  _build() {
    const P = this.pts, dense = [];
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
      for (let k = 0; k < 24; k++) {
        const t = k / 24, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    dense.push(P[P.length - 1]);
    const cum = [0];
    for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    this.length = cum[cum.length - 1];
    const n = Math.floor(this.length / STEP) + 1;
    this.xs = new Float32Array(n); this.zs = new Float32Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const s = i * STEP;
      while (j < cum.length - 2 && cum[j + 1] < s) j++;
      const t = Math.min(1, (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]));
      this.xs[i] = dense[j][0] + (dense[j + 1][0] - dense[j][0]) * t;
      this.zs[i] = dense[j][1] + (dense[j + 1][1] - dense[j][1]) * t;
    }
    this.n = n;
    this.prof = new Float32Array(n);   // groomed surface height along the run (set by the terrain)
  }

  // Point and downhill direction at distance s along the run.
  at(s) {
    const f = Math.max(0, Math.min(this.n - 1.001, s / STEP)), i = Math.floor(f), t = f - i;
    const x = this.xs[i] + (this.xs[i + 1] - this.xs[i]) * t, z = this.zs[i] + (this.zs[i + 1] - this.zs[i]) * t;
    const a = Math.max(0, i - 2), b = Math.min(this.n - 1, i + 3);
    let tx = this.xs[b] - this.xs[a], tz = this.zs[b] - this.zs[a];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    return { x, z, tx, tz, s };
  }

  profileAt(s) {
    const f = Math.max(0, Math.min(this.n - 1.001, s / STEP)), i = Math.floor(f), t = f - i;
    return this.prof[i] + (this.prof[i + 1] - this.prof[i]) * t;
  }

  // Distance along the run of the sample nearest to world z (runs head steadily downhill).
  sAtZ(z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.n; i++) { const d = Math.abs(this.zs[i] - z); if (d < bd) { bd = d; best = i; } }
    return best * STEP;
  }
}

export const RUN_STEP = STEP;
export function makeRuns() { return RUN_DEFS.map(d => new Run(d)); }
