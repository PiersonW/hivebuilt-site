// Competitions you sign up for at the Base Lodge, the bot riders you're up against, and your wallet.
//
// Each event is one run. Your result is ranked against a fixed field of bot riders; finish in the top 5 to
// win prize money. When multiplayer exists, fieldFor() is the one place to swap the bots for real players'
// results.

export const COMPS = [
  { id: 'pipe', name: 'Halfpipe', icon: '🛹', unit: 'pts', low: false,
    desc: 'One run down the halfpipe. Every trick you land off the walls scores: spins, flips and grabs. Crashes score nothing.' },
  { id: 'park', name: 'Slopestyle', icon: '🏔️', unit: 'pts', low: false,
    desc: 'One run through The Yard, from the top banner to the finish line above the halfpipe. Hit the jumps and rails; landed tricks score.' },
  { id: 'jump', name: 'Long Jump', icon: '🎿', unit: 'm', low: false,
    desc: 'One jump off the backside ski-jump hill. Tuck (↓) down the inrun, jump at the blue lip, hold ↑ in the air. Land it on the hill.' },
  { id: 'race', name: 'Downhill Race', icon: '🏁', unit: 'time', low: true,
    desc: 'One run through every gate on the Race Course. Fastest time wins; each missed gate adds 2 seconds.' },
];
export const COMP_BY_ID = Object.fromEntries(COMPS.map(c => [c.id, c]));

// Prize money by finishing place (1st..5th); anyone else who finishes gets a little for showing up.
export const PRIZES = [500, 300, 200, 120, 80];
export const FINISH_PRIZE = 25;
// a bonus for each achievement you unlock
export const ACH_PRIZE = 50;

// The bot field (made-up riders), best first.
const BOTS = [
  ['Maya L.', 'board'], ['Jonas B.', 'ski'], ['Kai M.', 'board'], ['Sofia R.', 'ski'], ['Theo P.', 'board'],
  ['Ava C.', 'ski'], ['Leo S.', 'board'], ['Nora K.', 'ski'], ['Finn D.', 'board'], ['Ruby T.', 'ski'],
];
const ORDER = { pipe: [0, 2, 4, 1, 6, 8, 3, 5, 9, 7], park: [2, 0, 6, 4, 1, 3, 8, 5, 7, 9], jump: [1, 3, 5, 0, 7, 2, 9, 4, 6, 8], race: [3, 1, 0, 5, 2, 7, 4, 9, 6, 8] };
const VALUES = {
  pipe: [16800, 14200, 12100, 10400, 8900, 7300, 5900, 4600, 3300, 2100],
  park: [28500, 24000, 20500, 17200, 14400, 11800, 9300, 7100, 5000, 3000],
  jump: [141.5, 134, 127.5, 121, 114.5, 106, 98.5, 89, 78.5, 66],
  race: [48.62, 49.85, 51.1, 52.47, 53.9, 55.36, 57.21, 59.48, 62.05, 66.9],
};
export function fieldFor(id) {
  return VALUES[id].map((v, i) => { const [name, sport] = BOTS[ORDER[id][i]]; return { name, sport, value: v, bot: true }; });
}

export function fmtValue(c, v) {
  if (v === null || v === undefined) return '—';
  const comp = typeof c === 'string' ? COMP_BY_ID[c] : c;
  if (comp.unit === 'm') return `${v.toFixed(1)} m`;
  if (comp.unit === 'time') { const m = Math.floor(v / 60), s = v - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; }
  return `${Math.round(v).toLocaleString()} pts`;
}
const better = (comp, a, b) => comp.low ? a < b : a > b;

const KEY = 'snowComps';
export class Comps {
  constructor() {
    try { this.data = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { this.data = {}; }
    this.data.cash = this.data.cash || 0;
    this.data.earned = this.data.earned || 0;
    this.data.best = this.data.best || {};       // comp id -> { value, name, sport, place }
    this.data.wins = this.data.wins || 0;
    this.data.entries = this.data.entries || 0;
    this.onCash = null;
  }
  _save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch {} }
  get cash() { return this.data.cash; }
  addCash(n) { if (!n) return; this.data.cash += n; this.data.earned += n; this._save(); if (this.onCash) this.onCash(n); }

  // Where `value` would place against the field (1 = first).
  placeOf(id, value) {
    const comp = COMP_BY_ID[id];
    return 1 + fieldFor(id).filter(b => better(comp, b.value, value)).length;
  }

  // Standings: the bots plus your best (or this run's result, when given).
  standings(id, mine) {
    const comp = COMP_BY_ID[id];
    const rows = fieldFor(id);
    const me = mine || this.data.best[id];
    if (me) rows.push({ ...me, me: true });
    rows.sort((a, b) => better(comp, a.value, b.value) ? -1 : better(comp, b.value, a.value) ? 1 : (a.me ? -1 : 1));
    return rows;
  }

  // Record a finished run (value null = did not finish). Returns { place, prize, pb, prev }.
  finish(id, value, name, sport) {
    this.data.entries++;
    if (value === null) { this._save(); return { place: null, prize: 0, pb: false }; }
    const comp = COMP_BY_ID[id];
    const place = this.placeOf(id, value);
    const prize = place <= PRIZES.length ? PRIZES[place - 1] : FINISH_PRIZE;
    const prev = this.data.best[id] ? this.data.best[id].value : null;
    const pb = prev === null || better(comp, value, prev);
    if (pb) this.data.best[id] = { value, name, sport, place };
    if (place === 1) this.data.wins++;
    this._save();
    this.addCash(prize);
    return { place, prize, pb, prev };
  }

  boardHtml(id, mine, limit = 11) {
    const comp = COMP_BY_ID[id];
    return '<table class="race-board">' + this.standings(id, mine).slice(0, limit).map((e, i) =>
      `<tr class="${e.me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(e.me ? `${e.name} (you)` : e.name)}</td><td>${e.sport === 'ski' ? '⛷️' : '🏂'}</td><td>${fmtValue(comp, e.value)}</td><td>${i < PRIZES.length ? `$${PRIZES[i]}` : ''}</td></tr>`).join('') + '</table>';
  }
}

export const ordinal = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
export const money = (n) => '$' + Math.round(n).toLocaleString();
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
