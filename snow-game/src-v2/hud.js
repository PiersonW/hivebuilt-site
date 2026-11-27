// HUD: speed, score, timer, trick popups, on-screen controls, menu and finish screens.
import { CONTROLS } from './input.js';
import { drawDiffIcon } from './terrain.js';
import { DIFF } from './runs.js';

export const MAX_MPH = 65;

const $ = (id) => document.getElementById(id);

export function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export class Hud {
  constructor() {
    this.el = { hud: $('hud'), score: $('hud-score'), time: $('hud-time'), live: $('trick-live'), pops: $('popups'), help: $('controls-help'), runTag: $('run-tag') };
    this._buildSpeedo();
    this.runKey = null;
    this.showHelp = true;
    this.padName = undefined;
    this.renderControls(null);
    $('menu-controls').innerHTML = CONTROLS.map(([a, k, p]) => `<span>${a}</span><span><b>${k}</b> · ${p}</span>`).join('');
  }

  renderControls(padName) {
    if (padName === this.padName) return;
    this.padName = padName;
    const pad = !!padName;
    const rows = CONTROLS.map(([a, k, p]) => `<b>${pad ? p : k}</b> ${a}`).join('<br>');
    this.el.help.innerHTML = `${pad ? '🎮 Controller' : '⌨️ Keyboard'}<br>${rows}<br><span class="tog">H hides this</span>`;
  }

  toggleHelp() { this.showHelp = !this.showHelp; this.el.help.classList.toggle('hidden', !this.showHelp); }

  show(on) { this.el.hud.classList.toggle('hidden', !on); }

  // Dial speedometer, 0 to 65 mph.
  _buildSpeedo() {
    const A0 = -125, A1 = 125, R = 62, cx = 85, cy = 80;
    const pt = (deg, r) => { const a = (deg - 90) * Math.PI / 180; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
    const arc = (d0, d1, r) => { const [x0, y0] = pt(d0, r), [x1, y1] = pt(d1, r); return `M${x0},${y0} A${r},${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${x1},${y1}`; };
    const deg = (mph) => A0 + (A1 - A0) * mph / MAX_MPH;
    let ticks = '';
    for (let m = 0; m <= MAX_MPH; m += 5) {
      const big = m % 10 === 0 || m === MAX_MPH;
      const [x0, y0] = pt(deg(m), R - (big ? 11 : 6)), [x1, y1] = pt(deg(m), R);
      ticks += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#fff" stroke-width="${big ? 2.5 : 1.2}" opacity="0.9"/>`;
      if (big) { const [tx, ty] = pt(deg(m), R - 21); ticks += `<text x="${tx}" y="${ty + 4}" fill="#fff" font-size="11" text-anchor="middle" opacity="0.85">${m}</text>`; }
    }
    $('speedo').innerHTML = `<svg viewBox="0 0 170 150">
      <circle cx="${cx}" cy="${cy}" r="${R + 8}" fill="rgba(10,30,60,0.6)"/>
      <path d="${arc(A0, A1, R)}" stroke="rgba(255,255,255,0.25)" stroke-width="6" fill="none"/>
      <path d="${arc(deg(50), A1, R)}" stroke="#ff5a3d" stroke-width="6" fill="none"/>
      <path id="speedo-fill" d="" stroke="#ffd23a" stroke-width="6" fill="none" stroke-linecap="round"/>
      ${ticks}
      <line id="speedo-needle" x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - R + 6}" stroke="#ff5a3d" stroke-width="3.5" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="6" fill="#ff5a3d"/>
      <text id="speedo-num" x="${cx}" y="${cy + 34}" fill="#fff" font-size="26" font-weight="bold" text-anchor="middle">0</text>
      <text x="${cx}" y="${cy + 48}" fill="#fff" font-size="10" text-anchor="middle" letter-spacing="2" opacity="0.75">MPH</text>
    </svg>`;
    this.speedo = { needle: $('speedo-needle'), num: $('speedo-num'), fill: $('speedo-fill'), deg, arc, cx, cy, shown: 0 };
  }

  _setSpeed(mph) {
    const S = this.speedo;
    S.shown += (mph - S.shown) * 0.25;                 // a little needle smoothing
    const d = S.deg(Math.min(MAX_MPH, S.shown));
    S.needle.setAttribute('transform', `rotate(${d} ${S.cx} ${S.cy})`);
    S.fill.setAttribute('d', S.shown > 0.5 ? S.arc(-125, d, 62) : '');
    const n = String(Math.round(Math.min(MAX_MPH, mph)));
    if (S.num.textContent !== n) S.num.textContent = n;
  }

  setRun(run) {
    const key = run ? run.id : 'off';
    if (key === this.runKey) return;
    this.runKey = key;
    const el = this.el.runTag;
    if (!run) { el.innerHTML = '<span>Off-piste</span>'; return; }
    el.innerHTML = '';
    const c = document.createElement('canvas'); c.width = c.height = 44;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.beginPath(); g.arc(22, 22, 21, 0, Math.PI * 2); g.fill();
    drawDiffIcon(g, run.diff, 22, 22, 13);
    const t = document.createElement('span'); t.textContent = run.name; t.title = DIFF[run.diff].label;
    el.append(c, t);
  }

  update({ score, time, speed, live }) {
    this.el.score.textContent = score.toLocaleString();
    this.el.time.textContent = fmtTime(time);
    this._setSpeed(speed * 2.237); // m/s -> mph
    if (this.el.live.textContent !== live) this.el.live.textContent = live;
  }

  popup(text, points, bail = false) {
    const d = document.createElement('div');
    d.className = 'popup' + (bail ? ' bail' : '');
    d.innerHTML = `${text}${points ? `<span class="pts">+${points.toLocaleString()}</span>` : ''}`;
    this.el.pops.innerHTML = '';
    this.el.pops.appendChild(d);
    setTimeout(() => d.remove(), 1900);
  }

  clearPopups() { this.el.pops.innerHTML = ''; this.el.live.textContent = ''; }
}
