// Trail map: a top-down shaded-relief picture of the heightmap, drawn like a resort map
// (uphill at the top, seen from the bottom of the mountain), with the run, kickers, cliff and lifts.
import { centerX, halfWidth, RUN_LENGTH, CLIFF_S } from './terrain.js';

export class TrailMap {
  constructor(terrain, lifts, runName = 'Main Run') {
    this.terrain = terrain;
    this.lifts = lifts;
    this.scale = 2.6;   // px per grid cell
    const T = terrain;
    // only map the part of the grid around the run (and lifts)
    this.xMin = -85; this.xMax = 85;
    this.c0 = Math.round((this.xMin - T.x0) / 2.5); this.c1 = Math.round((this.xMax - T.x0) / 2.5);
    this.w = Math.round((this.c1 - this.c0) * this.scale);
    this.h = Math.round(T.rows * this.scale);
    this.base = document.createElement('canvas');
    this.base.width = this.w; this.base.height = this.h;
    this._drawBase(runName);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w; this.canvas.height = this.h;
    this.canvas.className = 'trailmap';
  }

  // world -> map pixels. Seen from the bottom looking up: +x is on the left.
  toMap(x, z) {
    const T = this.terrain;
    return [this.w - ((x - this.xMin) / 2.5) * this.scale, ((T.z0 - z) / 2.5) * this.scale];
  }

  _drawBase(runName) {
    const T = this.terrain, W = T.cols + 1;
    const g = this.base.getContext('2d');
    // shaded relief at grid resolution, then scaled up
    const cols = this.c1 - this.c0;
    const small = document.createElement('canvas'); small.width = cols; small.height = T.rows;
    const sg = small.getContext('2d');
    const img = sg.createImageData(cols, T.rows);
    const L = [-0.5, 0.75, 0.45]; const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
    for (let j = 0; j < T.rows; j++) for (let i = this.c0; i < this.c1; i++) {
      const h = T.H[j * W + i], hx = T.H[j * W + i + 1] - h, hz = T.H[(j + 1) * W + i] - h;
      const nx = -hx / 2.5, nz = hz / 2.5, ny = 1, nl = Math.hypot(nx, ny, nz);
      const shade = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / nl);
      const px = this.c1 - 1 - i, k = (j * cols + px) * 4;
      img.data[k] = 150 + 100 * shade; img.data[k + 1] = 170 + 82 * shade; img.data[k + 2] = 200 + 55 * shade; img.data[k + 3] = 255;
    }
    sg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(small, 0, 0, this.w, this.h);
    // trees
    g.fillStyle = 'rgba(40, 95, 62, 0.75)';
    for (const t of T.trees) {
      if (t.kind !== 'tree' || t.x < this.xMin || t.x > this.xMax) continue;
      const [x, y] = this.toMap(t.x, t.z);
      g.beginPath(); g.arc(x, y, 1.3, 0, Math.PI * 2); g.fill();
    }
    // run edges
    g.strokeStyle = 'rgba(30, 80, 160, 0.55)'; g.lineWidth = 1.5; g.setLineDash([4, 3]);
    for (const side of [-1, 1]) {
      g.beginPath();
      for (let s = 0; s <= RUN_LENGTH; s += 10) {
        const [x, y] = this.toMap(centerX(s) + side * halfWidth(s), -s);
        if (s === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.setLineDash([]);
    // run line with difficulty colours: green top, blue middle, black steep section
    const seg = (a, b, color) => {
      g.strokeStyle = color; g.lineWidth = 3; g.beginPath();
      for (let s = a; s <= b; s += 5) { const [x, y] = this.toMap(centerX(s), -s); if (s === a) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
    };
    seg(0, 200, '#2e9d4a'); seg(200, 420, '#2a64c8'); seg(420, 720, '#111'); seg(720, RUN_LENGTH, '#2a64c8');
    // kickers
    g.fillStyle = '#ff7a3d';
    for (const k of T.kickers) { const [x, y] = this.toMap(k.x, k.z); g.fillRect(x - 3, y - 2, 6, 4); }
    // cliff
    const [c1x, c1y] = this.toMap(centerX(CLIFF_S) - 20, -CLIFF_S), [c2x] = this.toMap(centerX(CLIFF_S) + 20, -CLIFF_S);
    g.strokeStyle = '#c0392b'; g.lineWidth = 3; g.beginPath(); g.moveTo(c1x, c1y); g.lineTo(c2x, c1y); g.stroke();
    // lifts
    for (const lift of this.lifts) {
      const [ax, ay] = this.toMap(lift.bottom.x, lift.bottom.z), [bx, by] = this.toMap(lift.top.x, lift.top.z);
      g.strokeStyle = '#222'; g.lineWidth = 2; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      g.fillStyle = '#222';
      for (const t of lift.towers) { const [x, y] = this.toMap(t.x, t.z); g.fillRect(x - 2, y - 2, 4, 4); }
      this._label(g, lift.name, (ax + bx) / 2 + 6, (ay + by) / 2, '#222', 'left');
    }
    // labels
    const lab = (text, s, color, dx = 0) => { const [x, y] = this.toMap(centerX(s), -s); this._label(g, text, x + dx, y, color, 'center'); };
    lab('START', 2, '#163566', 0); lab('FINISH', RUN_LENGTH, '#c0392b', 0);
    lab(runName, 300, '#163566', 0);
    lab('CLIFF', CLIFF_S + 14, '#c0392b', 0);
    // compass-ish legend
    g.font = 'bold 11px Trebuchet MS, sans-serif'; g.fillStyle = '#163566'; g.textAlign = 'left';
    g.fillText('▲ uphill', 6, 14);
  }

  _label(g, text, x, y, color, align) {
    g.font = 'bold 13px Trebuchet MS, sans-serif'; g.textAlign = align; g.textBaseline = 'middle';
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.strokeText(text, x, y);
    g.fillStyle = color; g.fillText(text, x, y);
  }

  // Redraw with a "you are here" dot.
  draw(you) {
    const g = this.canvas.getContext('2d');
    g.drawImage(this.base, 0, 0);
    if (you) {
      const [x, y] = this.toMap(you.x, you.z);
      g.fillStyle = '#ff3d3d'; g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); g.stroke();
      this._label(g, 'YOU', x + 8, y, '#ff3d3d', 'left');
    }
  }
}
