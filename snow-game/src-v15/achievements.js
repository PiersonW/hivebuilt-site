// Achievements: tricks you learn, places you find, gaps you clear and a few secrets.
// Saved in this browser (localStorage). Hidden ones show as ??? until you unlock them.

export const ACHIEVEMENTS = [
  // tricks
  { id: 'first_air', icon: '🛫', name: 'Liftoff', desc: 'Land your first jump.', group: 'Tricks' },
  { id: 'spin180', icon: '↪️', name: 'Half Turn', desc: 'Land a 180.', group: 'Tricks' },
  { id: 'spin360', icon: '🔄', name: 'Full Circle', desc: 'Land a 360.', group: 'Tricks' },
  { id: 'spin540', icon: '🌀', name: 'Five-Forty', desc: 'Land a 540.', group: 'Tricks' },
  { id: 'spin720', icon: '🌪️', name: 'Seven-Twenty', desc: 'Land a 720.', group: 'Tricks' },
  { id: 'spin1080', icon: '💫', name: 'Ten-Eighty', desc: 'Land a 1080.', group: 'Tricks' },
  { id: 'backflip', icon: '🤸', name: 'Backflip', desc: 'Land a backflip.', group: 'Tricks' },
  { id: 'frontflip', icon: '🙃', name: 'Front Flip', desc: 'Land a front flip.', group: 'Tricks' },
  { id: 'double', icon: '🎡', name: 'Double Trouble', desc: 'Land a double flip.', group: 'Tricks' },
  { id: 'phantom', icon: '👻', name: 'Ghost Rider', desc: 'Land a Phantom Flip.', group: 'Tricks' },
  { id: 'grabs', icon: '✋', name: 'Grab Bag', desc: 'Land all four grabs.', group: 'Tricks', goal: 4 },
  { id: 'grind', icon: '🛤️', name: 'Rail Rookie', desc: 'Land your first grind.', group: 'Tricks' },
  { id: 'slide', icon: '↔️', name: 'Sideways', desc: 'Land a boardslide or rail slide.', group: 'Tricks' },
  { id: 'log', icon: '🪵', name: 'Lumberjack', desc: 'Ride a fallen log.', group: 'Tricks' },
  { id: 'combo3', icon: '🔥', name: 'Combo Breaker', desc: 'Land a trick worth x3 or more.', group: 'Tricks' },
  { id: 'hang', icon: '⏱️', name: 'Hang Time', desc: 'Stay in the air for 2.5 seconds and land it.', group: 'Tricks' },
  { id: 'score10k', icon: '💯', name: 'Big Score', desc: 'Score 10,000 points in one run.', group: 'Tricks' },
  { id: 'speed', icon: '⚡', name: 'Speed Demon', desc: 'Hit 65 mph.', group: 'Tricks' },
  // places
  { id: 'runs', icon: '🗺️', name: 'Mountain Tour', desc: 'Ride every run on the mountain.', group: 'Explore', goal: 8 },
  { id: 'lifts', icon: '🚡', name: 'Lift Lapper', desc: 'Ride all three chairlifts.', group: 'Explore', goal: 3 },
  { id: 'bowl', icon: '🏔️', name: 'Backside', desc: 'Drop into the backside bowl.', group: 'Explore' },
  { id: 'bowl_chute', icon: '⬇️', name: 'Chute Out', desc: 'Ride down one of the backside chutes.', group: 'Explore' },
  { id: 'bowl_chutes', icon: '🧭', name: 'Chute Collector', desc: 'Ride all three backside chutes.', group: 'Explore', goal: 3 },
  { id: 'pipe', icon: '🛹', name: 'Pipe Dream', desc: 'Land an air in the halfpipe.', group: 'Explore' },
  { id: 'pipe_big', icon: '🚀', name: 'Above the Lip', desc: 'Get 3 m above the halfpipe lip.', group: 'Explore' },
  { id: 'gullies', icon: '🏞️', name: 'Gully Hunter', desc: 'Ride all three gullies.', group: 'Explore', goal: 3 },
  { id: 'cliff', icon: '🧗', name: 'Cliff Diver', desc: 'Drop a cliff and ride away.', group: 'Explore' },
  { id: 'cliffs', icon: '⛰️', name: 'Cliff Collector', desc: 'Drop all three cliffs.', group: 'Explore', goal: 3 },
  { id: 'ridge', icon: '🏔️', name: 'Ridge Launcher', desc: 'Launch off a ridge.', group: 'Explore' },
  { id: 'rocks', icon: '🪨', name: 'Rock Hopper', desc: 'Get air off 5 different snow-covered rocks.', group: 'Explore', goal: 5 },
  { id: 'powder', icon: '❄️', name: 'Powder Hound', desc: 'Ride 500 m of untracked powder.', group: 'Explore', goal: 500 },
  { id: 'heli', icon: '🚁', name: 'Heli Drop', desc: 'Jump out of the helicopter.', group: 'Explore' },
  { id: 'wingsuit', icon: '🦅', name: 'Bird Person', desc: 'Land the wingsuit on your feet.', group: 'Explore' },
  { id: 'flight', icon: '✈️', name: 'Long Flight', desc: 'Fly 800 m in the wingsuit.', group: 'Explore' },
  // racing
  { id: 'race_finish', icon: '🏁', name: 'Racer', desc: 'Finish a race on the Race Course.', group: 'Racing' },
  { id: 'race_clean', icon: '🚩', name: 'Clean Run', desc: 'Finish a race without missing a gate.', group: 'Racing' },
  { id: 'race_pr', icon: '📈', name: 'Personal Best', desc: 'Beat your own best race time.', group: 'Racing' },
  { id: 'race_fast', icon: '🥇', name: 'Gold Medal Pace', desc: 'Finish a clean race in under 50 seconds.', group: 'Racing' },
  // gaps
  { id: 'gap_chute', icon: '🎯', name: 'Chute Gap', desc: 'Clear the Rocky Chute cliff and land 25 m past the edge.', group: 'Gaps' },
  { id: 'gap_lift', icon: '🎯', name: 'Lift Line Gap', desc: 'Jump clean over a chairlift line.', group: 'Gaps', hidden: true },
  { id: 'gap_gully', icon: '🎯', name: 'Gully Gap', desc: 'Jump across a gully, rim to rim.', group: 'Gaps', hidden: true },
  { id: 'gap_pipe', icon: '🎯', name: 'Deck to Deck', desc: 'Fly over the whole halfpipe.', group: 'Gaps', hidden: true },
  // secrets
  { id: 'yeti', icon: '🦍', name: 'Yeti Sighting', desc: 'Find the yeti.', group: 'Secrets', hidden: true },
  { id: 'trees', icon: '🌲', name: 'Tree Hugger', desc: 'Crash into 10 trees.', group: 'Secrets', hidden: true, goal: 10 },
  { id: 'cliffhanger', icon: '😬', name: 'Off the Edge', desc: 'Ride off the halfpipe deck and land outside it.', group: 'Secrets', hidden: true },
];

const KEY = 'snowAchievements';

export class Achievements {
  constructor(toastEl) {
    this.toastEl = toastEl;
    this.queue = [];
    this.showing = null;
    try { this.data = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { this.data = {}; }
    this.data.done = this.data.done || {};
    this.data.sets = this.data.sets || {};
    this.data.counts = this.data.counts || {};
    this.byId = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));
    this.onChange = null;
  }

  get count() { return Object.keys(this.data.done).length; }
  has(id) { return !!this.data.done[id]; }

  _save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch {} if (this.onChange) this.onChange(); }

  unlock(id) {
    if (this.has(id) || !this.byId[id]) return false;
    this.data.done[id] = Date.now();
    this._save();
    this.queue.push(this.byId[id]);
    return true;
  }

  // Count distinct things (runs, rocks, gullies...) toward a goal.
  addToSet(id, key) {
    const s = this.data.sets[id] || (this.data.sets[id] = []);
    if (!s.includes(key)) { s.push(key); this._save(); }
    if (s.length >= this.byId[id].goal) this.unlock(id);
  }

  // Add to a running total (metres of powder, trees hit...).
  addCount(id, n) {
    const before = this.data.counts[id] || 0;
    this.data.counts[id] = before + n;
    if (Math.floor(before / 25) !== Math.floor(this.data.counts[id] / 25) || this.data.counts[id] >= this.byId[id].goal) this._save();
    if (this.data.counts[id] >= this.byId[id].goal) this.unlock(id);
  }

  progress(a) {
    if (!a.goal) return null;
    const v = this.data.sets[a.id] ? this.data.sets[a.id].length : Math.floor(this.data.counts[a.id] || 0);
    return [Math.min(v, a.goal), a.goal];
  }

  // Toasts: one at a time, 3.5 s each.
  update(dt) {
    if (this.showing) {
      this.showing.t -= dt;
      if (this.showing.t <= 0) { this.toastEl.classList.remove('show'); this.showing = null; this._gap = 0.4; }
      return;
    }
    if (this._gap > 0) { this._gap -= dt; return; }
    const a = this.queue.shift();
    if (!a) return;
    this.toastEl.innerHTML = `<span class="ach-icon">${a.icon}</span><div><small>Achievement unlocked</small><b>${a.name}</b><span>${a.desc}</span></div>`;
    this.toastEl.classList.add('show');
    this.showing = { t: 3.5 };
  }

  // The panel listing everything.
  render(el) {
    const groups = {};
    for (const a of ACHIEVEMENTS) (groups[a.group] = groups[a.group] || []).push(a);
    let html = `<div class="panel-title">🏆 Achievements · ${this.count} / ${ACHIEVEMENTS.length}</div>`;
    for (const [g, list] of Object.entries(groups)) {
      html += `<div class="ach-group">${g}</div><div class="ach-grid">`;
      for (const a of list) {
        const done = this.has(a.id), secret = a.hidden && !done, pr = this.progress(a);
        html += `<div class="ach ${done ? 'done' : ''}"><span class="ach-icon">${secret ? '❔' : a.icon}</span><div><b>${secret ? '???' : a.name}</b><span>${secret ? 'Keep exploring…' : a.desc}</span>${pr && !done && !secret ? `<em>${pr[0]} / ${pr[1]}</em>` : ''}</div></div>`;
      }
      html += '</div>';
    }
    el.innerHTML = html;
  }
}
