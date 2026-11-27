// Trail map: a top-down shaded-relief picture of the mountain, drawn like a resort map
// (uphill at the top, seen from the base looking up), with runs, lifts, kickers, the cliff and you.
import { CELL, BASE_Z, drawDiffIcon } from './terrain.js';
import { DIFF } from './runs.js';

export class TrailMap {
  constructor(terrain, lifts) {
    this.terrain = terrain;
    this.lifts = lifts;
    this.scale = 1.25;   // px per grid cell
    const T = terrain;
    this.w = Math.round(T.cols * this.scale);
    this.h = Math.round(T.rows * this.scale);
    this.base = document.createElement('canvas');
    this.base.width = this.w; this.base.height = this.h;
    this._drawBase();
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w; this.canvas.height = this.h;
    this.canvas.className = 'trailmap';
  }

  // world -> map pixels. Seen from the base looking up: +x is on the left.
  toMap(x, z) {
    const T = this.terrain;
    return [this.w - ((x - T.x0) / CELL) * this.scale, ((T.z0 - z) / CELL) * this.scale];
  }

  _drawBase() {
    const T = this.terrain, W = T.cols + 1;
    const g = this.base.getContext('2d');
    // shaded relief
    const small = document.createElement('canvas'); small.width = T.cols; small.height = T.rows;
    const sg = small.getContext('2d'), img = sg.createImageData(T.cols, T.rows);
    const L = [0.55, 0.7, 0.45]; const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
    for (let j = 0; j < T.rows; j++) for (let i = 0; i < T.cols; i++) {
      const q = j * W + i, h = T.H[q], hx = T.H[q + 1] - h, hz = T.H[q + W] - h;
      const nx = hx / CELL, nz = hz / CELL, ny = 1, nl = Math.hypot(nx, ny, nz);   // x mirrored on the map
      const shade = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / nl);
      const groom = T.groom[q];
      const k = (j * T.cols + (T.cols - 1 - i)) * 4;
      img.data[k] = 150 + 100 * shade + groom * 8; img.data[k + 1] = 168 + 84 * shade + groom * 6; img.data[k + 2] = 198 + 57 * shade;
      img.data[k + 3] = 255;
    }
    sg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(small, 0, 0, this.w, this.h);
    // forest
    g.fillStyle = 'rgba(38, 92, 60, 0.55)';
    for (const t of T.trees) {
      if (t.kind !== 'tree') continue;
      const [x, y] = this.toMap(t.x, t.z);
      g.fillRect(x - 1, y - 1, 2.2, 2.2);
    }
    // runs: wide pale corridor + coloured centre line
    for (const run of T.runs) {
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = run.width / CELL * this.scale; g.lineCap = 'round'; g.lineJoin = 'round';
      this._path(g, run); g.stroke();
    }
    for (const run of T.runs) {
      g.strokeStyle = DIFF[run.diff].color; g.lineWidth = 3;
      this._path(g, run); g.stroke();
    }
    // kickers and the cliff
    g.fillStyle = '#ff7a1a';
    for (const k of T.kickers) { const [x, y] = this.toMap(k.x, k.z); g.fillRect(x - 2.5, y - 2, 5, 4); }
    g.strokeStyle = '#333'; g.lineWidth = 2;
    for (const r of T.rails || []) { const [x1, y1] = this.toMap(r.p0.x, r.p0.z), [x2, y2] = this.toMap(r.p1.x, r.p1.z); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
    const chute = T.runs.find(r => r.cliffS !== undefined);
    if (chute) {
      const a = chute.at(chute.cliffS);
      const [x1, y1] = this.toMap(a.x - a.tz * 16, a.z + a.tx * 16), [x2, y2] = this.toMap(a.x + a.tz * 16, a.z - a.tx * 16);
      g.strokeStyle = '#c0392b'; g.lineWidth = 3; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      this._label(g, 'CLIFF', (x1 + x2) / 2, (y1 + y2) / 2 + 10, '#c0392b', 'center', 11);
    }
    // natural cliffs, snow-covered rocks and the halfpipe
    const mk = T.mapMarks || { cliffs: [], rocks: [] };
    g.strokeStyle = '#c0392b'; g.lineWidth = 3;
    for (const [[ax, az], [bx, bz]] of mk.cliffs) {
      const [x1, y1] = this.toMap(ax, az), [x2, y2] = this.toMap(bx, bz);
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
    g.fillStyle = '#5f5b58';
    for (const [x, z] of mk.rocks) { const [px, py] = this.toMap(x, z); g.beginPath(); g.arc(px, py, 2.2, 0, Math.PI * 2); g.fill(); }
    if (T.pipe) {
      const P = T.pipe, w = 11;
      const c = [[0, -w], [P.L, -w], [P.L, w], [0, w]].map(([u, l]) => this.toMap(P.ox + P.ax * u + P.cx * l, P.oz + P.az * u + P.cz * l));
      g.fillStyle = 'rgba(42,100,200,0.35)'; g.strokeStyle = '#163566'; g.lineWidth = 1.5;
      g.beginPath(); c.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill(); g.stroke();
      const [mx, my] = this.toMap(P.ox + P.ax * P.L / 2 + P.cx * 22, P.oz + P.az * P.L / 2 + P.cz * 22);
      this._label(g, 'HALFPIPE', mx, my, '#163566', 'center', 10);
    }
    // lifts
    for (const lift of this.lifts) {
      const [ax, ay] = this.toMap(lift.bottom.x, lift.bottom.z), [bx, by] = this.toMap(lift.top.x, lift.top.z);
      g.strokeStyle = '#1b1b1b'; g.lineWidth = 2; g.setLineDash([6, 3]); g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#1b1b1b';
      for (const t of lift.towers) { const [x, y] = this.toMap(t.x, t.z); g.fillRect(x - 1.5, y - 1.5, 3, 3); }
      const ang = Math.atan2(by - ay, bx - ax);
      g.save(); g.translate((ax + bx) / 2, (ay + by) / 2); g.rotate(ang + (Math.abs(ang) > Math.PI / 2 ? Math.PI : 0));
      this._label(g, '🚡 ' + lift.name, 0, -8, '#1b1b1b', 'center', 11); g.restore();
    }
    // run names with symbols
    for (const run of T.runs) {
      const a = run.at(run.length * 0.3);
      let [x, y] = this.toMap(a.x, a.z);
      g.font = 'bold 12px Trebuchet MS, sans-serif';
      const w = g.measureText(run.name).width;
      x = Math.max(w / 2 + 20, Math.min(this.w - w / 2 - 8, x));   // keep the label on the map
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(x - w / 2 - 16, y - 9, w + 22, 18);
      drawDiffIcon(g, run.diff, x - w / 2 - 7, y, 5.5);
      this._label(g, run.name, x + 5, y, '#14213a', 'center', 12, false);
    }
    // base and summit
    const [lx, ly] = this.toMap(-60, BASE_Z - 70);
    g.fillStyle = '#7a4f2e'; g.fillRect(lx - 8, ly - 4, 16, 8);
    this._label(g, 'BASE LODGE', lx, ly + 13, '#5a3418', 'center', 11);
    const [sx, sy] = this.toMap(50, 30);
    this._label(g, '▲ SUMMIT', sx, sy - 4, '#14213a', 'center', 12);
  }

  _path(g, run) {
    g.beginPath();
    for (let i = 0; i < run.n; i += 3) { const [x, y] = this.toMap(run.xs[i], run.zs[i]); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
  }

  _label(g, text, x, y, color, align, size = 12, outline = true) {
    g.font = `bold ${size}px Trebuchet MS, sans-serif`; g.textAlign = align; g.textBaseline = 'middle';
    if (outline) { g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.strokeText(text, x, y); }
    g.fillStyle = color; g.fillText(text, x, y);
  }

  // Redraw with a "you are here" dot.
  draw(you) {
    const g = this.canvas.getContext('2d');
    g.drawImage(this.base, 0, 0);
    if (you) {
      const [x, y] = this.toMap(you.x, you.z);
      g.fillStyle = '#ff3d3d'; g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill(); g.stroke();
      this._label(g, 'YOU', x + 10, y, '#ff3d3d', 'left', 12);
    }
  }
}
