// Online play: friends race (snowgame:sbx:<CODE>) or ride the mountain together (snowgame:ride:<CODE>)
// using a 4-letter room code. Uses Supabase Realtime "broadcast" and "presence" only (no database tables),
// on the Road Rivals project.
// Each player sends their own rider ~15 times a second; the host also runs any bots and sends theirs.
//
//   const net = new Net();
//   await net.join('SNOW', { name: 'Pierson' });   // everyone in the same room sees each other (net.players)
//   net.on = (event, payload) => { ... };           // messages from the others
//   net.send('st', {...}); net.leave();
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.47.10/+esm';

// Road Rivals' project. This is its public (anon) key, the same one already inside the Road Rivals app;
// it only allows what the project's row-level security allows, and the game touches no tables.
const URL = 'https://gsgnwlbykdgdzqijocot.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzZ253bGJ5a2RnZHpxaWpvY290Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxMTQ2NTYsImV4cCI6MjEwOTY5MDY1Nn0.lTebHLjVVjmVd_h2tvo6lF8ARPFCR-cuKareLSHjk1A';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';      // no I or O (they look like 1 and 0)
export const MAX_PLAYERS = 6;

let sharedClient = null;
export function newCode() { let c = ''; for (let i = 0; i < 4; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)]; return c; }
export { LETTERS };

export class Net {
  constructor() {
    this.id = Math.random().toString(36).slice(2, 10);
    this.client = null; this.channel = null; this.code = null;
    this.players = [];            // [{ id, name, joinedAt }] sorted by when they joined (first = host)
    this.on = null;               // (event, payload) => void
    this.onPlayers = null;        // (players) => void
    this.status = 'offline';
  }
  get connected() { return this.status === 'connected'; }
  get isHost() { return this.players.length > 0 && this.players[0].id === this.id; }

  async join(code, me, kind = 'sbx') {
    await this.leave();
    if (!sharedClient) sharedClient = createClient(URL, KEY, { realtime: { params: { eventsPerSecond: 40 } } });
    this.client = sharedClient;
    this.code = code; this.status = 'connecting'; this.me = { ...me, id: this.id, joinedAt: Date.now() };
    const ch = this.client.channel(`snowgame:${kind}:${code}`, { config: { broadcast: { self: false }, presence: { key: this.id } } });
    this.channel = ch;
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState(), list = [];
      for (const id of Object.keys(st)) { const p = st[id][0]; if (p) list.push({ id, name: p.name, joinedAt: p.joinedAt, char: p.char, sport: p.sport, regular: p.regular }); }
      list.sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
      this.players = list;
      if (this.onPlayers) this.onPlayers(list);
    });
    ch.on('broadcast', { event: '*' }, ({ event, payload }) => { if (this.on) this.on(event, payload); });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Could not reach the game server')), 10000);
      ch.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') { clearTimeout(timer); this.status = 'connected'; await ch.track(this.me); resolve(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); this.status = 'offline'; reject(new Error('Connection failed')); }
        else if (status === 'CLOSED') this.status = 'offline';
      });
    });
  }

  // change what the others see of you (e.g. your character), keeping your place in the join order
  update(fields) { if (!this.me) return; Object.assign(this.me, fields); if (this.channel && this.connected) this.channel.track(this.me); }

  send(event, payload) { if (this.channel && this.connected) this.channel.send({ type: 'broadcast', event, payload }); }

  async leave() {
    if (this.channel) { try { await this.channel.untrack(); await this.client.removeChannel(this.channel); } catch { /* already gone */ } }
    this.channel = null; this.players = []; this.status = 'offline'; this.code = null;
  }
}
