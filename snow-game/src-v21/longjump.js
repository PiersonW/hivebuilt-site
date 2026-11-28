// Long jump records: each clean landing off the jump's takeoff table is measured along the landing
// hill from the lip (like real ski jumping) to the nearest half metre. Best and top 10 saved in this browser.
import { LONG_JUMP } from './terrain.js';

const KEY = 'snowLongJump';

export class LongJump {
  constructor(terrain) {
    this.terrain = terrain;
    try { this.data = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { this.data = {}; }
    this.data.board = this.data.board || [];
    this.armed = false;
  }

  get best() { return this.data.board.length ? this.data.board[0].dist : null; }
  bestFor(name) { const e = this.data.board.find(b => b.name === name); return e ? e.dist : null; }

  // the rider left the ground somewhere
  takeoff(pos, speed) { this.armed = this.terrain.onJumpTable(pos.x, pos.z); this.takeoffSpeed = speed; }

  // the rider came down cleanly: returns a result if this was a long jump that landed on the hill
  land(pos, name, sport) {
    if (!this.armed) return null;
    this.armed = false;
    const T = this.terrain, J = T.jump, dx = pos.x - J.ox, dz = pos.z - J.oz;
    const u = dx * J.ax + dz * J.az, l = dx * J.cx + dz * J.cz;
    if (u < LONG_JUMP.edgeU || Math.abs(l) > T.jumpHW(u) + 4) return { dist: null };
    const dist = Math.round((T.jumpArc(u) - T.jumpArc(LONG_JUMP.edgeU)) * 2) / 2;
    const prevMine = this.bestFor(name), prevHill = this.best;
    this.data.board.push({ name, dist, sport, speed: Math.round(this.takeoffSpeed * 2.237), date: Date.now() });
    this.data.board.sort((a, b) => b.dist - a.dist);
    this.data.board.length = Math.min(10, this.data.board.length);
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch {}
    return { dist, pb: prevMine === null || dist > prevMine, prevMine, record: prevHill === null || dist > prevHill, prevHill };
  }

  crashed() { this.armed = false; }

  boardHtml(highlight) {
    const b = this.data.board;
    if (!b.length) return '<p class="muted">No jumps yet.</p>';
    return '<table class="race-board">' + b.slice(0, 5).map((e, i) =>
      `<tr class="${e.dist === highlight ? 'me' : ''}"><td>${i + 1}</td><td>${esc(e.name)}</td><td>${e.sport === 'ski' ? '⛷️' : '🏂'}</td><td>${e.dist.toFixed(1)} m</td><td>${e.speed} mph</td></tr>`).join('') + '</table>';
  }
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
