// HUD: speed, score, timer, trick popups, on-screen controls, menu and finish screens.
import { CONTROLS } from './input.js';

const $ = (id) => document.getElementById(id);

export function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export class Hud {
  constructor() {
    this.el = { hud: $('hud'), score: $('hud-score'), time: $('hud-time'), speed: $('hud-speed'), live: $('trick-live'), pops: $('popups'), help: $('controls-help') };
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

  update({ score, time, speed, live }) {
    this.el.score.textContent = score.toLocaleString();
    this.el.time.textContent = fmtTime(time);
    this.el.speed.textContent = Math.round(speed * 2.237); // m/s -> mph
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
