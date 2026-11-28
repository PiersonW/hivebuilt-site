// Keyboard + Xbox controller (Gamepad API, standard mapping) merged into one input state.

// Right hand on the arrows (steer, spin, flip); left hand on the letters (tricks).
const KEYMAP = {
  left: ['ArrowLeft'], right: ['ArrowRight'],
  up: ['ArrowUp'], down: ['ArrowDown'],
  jump: ['Space'], brake: ['ShiftLeft', 'ShiftRight'],
  g0: ['KeyA'], g1: ['KeyS'], g2: ['KeyD'], g3: ['KeyF'],
  phantom: ['KeyW'], grind: ['KeyE'],
  restart: ['KeyR'], menu: ['Escape'], confirm: ['Enter', 'NumpadEnter'], help: ['KeyH'], pause: ['KeyP'],
};

// Xbox buttons in the standard mapping.
export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

export const GRAB_NAMES = ['Indy', 'Melon', 'Method', 'Nose Grab'];

// Edge on Xbox: send the controller to the game instead of moving the mouse cursor.
try { navigator.gamepadInputEmulation = 'gamepad'; } catch { /* other browsers */ }

export class Input {
  constructor() {
    this.keys = new Set();
    this.tapped = new Set();   // keys pressed since the last poll (so quick taps are never missed)
    this.prev = {};
    this.state = {};
    this.padName = null;
    window.addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') { if (e.code === 'Enter' || e.code === 'Escape') e.target.blur(); return; }   // typing your name
      // a menu button can keep keyboard focus after a click: don't let Space / Enter / arrows press it again
      if (e.target && e.target.tagName === 'BUTTON' && (e.code === 'Space' || e.code === 'Enter' || e.code.startsWith('Arrow'))) { e.preventDefault(); e.target.blur(); }
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code);
      if (!e.repeat) this.tapped.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.target && e.target.tagName === 'BUTTON' && (e.code === 'Space' || e.code === 'Enter')) e.preventDefault();
    });
    window.addEventListener('blur', () => this.keys.clear());
    // mouse drag to look around (lift ride and replays)
    this.mdx = 0; this.mdy = 0; this.dragging = false;
    this.prevPad = [];
    window.addEventListener('pointerdown', (e) => { if (e.target.tagName === 'CANVAS') this.dragging = true; });
    window.addEventListener('pointerup', () => { this.dragging = false; });
    window.addEventListener('pointermove', (e) => { if (this.dragging) { this.mdx += e.movementX; this.mdy += e.movementY; } });
  }

  _key(name) { return KEYMAP[name].some(k => this.keys.has(k) || this.tapped.has(k)); }
  _tap(name) { return KEYMAP[name].some(k => this.tapped.has(k)); }

  // Find a controller: prefer one with the standard mapping, else any connected pad
  // (Xbox on Edge/Windows sometimes shows up at a later index or without "standard").
  _pad() {
    let pads = [];
    try { pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : []; } catch { return null; }
    return pads.find(p => p && p.connected && p.mapping === 'standard') || pads.find(p => p && p.connected) || null;
  }

  poll() {
    const k = (n) => this._key(n);
    let steer = (k('right') ? 1 : 0) - (k('left') ? 1 : 0);
    let up = k('up'), down = k('down'), jump = k('jump'), brake = k('brake'), grind = k('grind');
    const grabsHeld = [k('g0'), k('g1'), k('g2'), k('g3')];
    let pause = k('pause'), phantom = k('phantom'), restart = k('restart'), menu = k('menu'), confirm = k('confirm'), help = k('help');
    let mLeft = k('left'), mRight = k('right'), mUp = k('up'), mDown = k('down');
    let lookX = 0, lookY = 0;
    const padTaps = new Set();

    const pad = this._pad();
    this.padName = pad ? pad.id : null;
    if (pad) {
      const b = (i) => { const x = pad.buttons[i]; return !!x && (x.pressed || x.value > 0.5); };
      const dz = (v) => Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82;
      const ax = dz(pad.axes[0] || 0), ay = dz(pad.axes[1] || 0);
      // triggers: buttons 6/7 in standard mapping; some non-standard pads report them as axes
      let lt = pad.buttons[BTN.LT] ? pad.buttons[BTN.LT].value : 0;
      let rt = pad.buttons[BTN.RT] ? pad.buttons[BTN.RT].value : 0;
      if (pad.mapping !== 'standard' && pad.axes.length >= 6) { lt = Math.max(lt, (pad.axes[2] + 1) / 2); rt = Math.max(rt, (pad.axes[5] + 1) / 2); }
      const padSteer = ax + (b(BTN.RIGHT) ? 1 : 0) - (b(BTN.LEFT) ? 1 : 0);
      if (Math.abs(padSteer) > Math.abs(steer)) steer = Math.max(-1, Math.min(1, padSteer));
      up = up || ay < -0.5 || b(BTN.UP);
      down = down || ay > 0.5 || b(BTN.DOWN) || rt > 0.4;
      jump = jump || b(BTN.A);
      brake = brake || lt > 0.4;
      grabsHeld[0] = grabsHeld[0] || b(BTN.X);
      grabsHeld[1] = grabsHeld[1] || b(BTN.B);
      grabsHeld[2] = grabsHeld[2] || b(BTN.LB);
      grabsHeld[3] = grabsHeld[3] || b(BTN.Y);
      phantom = phantom || b(BTN.LS);           // left stick click
      grind = grind || b(BTN.RB);               // hold RB to grind rails, boxes and logs
      restart = restart || b(BTN.MENU);
      menu = menu || b(BTN.VIEW);
      confirm = confirm || b(BTN.A);
      mLeft = mLeft || b(BTN.LEFT) || ax < -0.6;
      mRight = mRight || b(BTN.RIGHT) || ax > 0.6;
      mUp = mUp || b(BTN.UP) || ay < -0.6; mDown = mDown || b(BTN.DOWN) || ay > 0.6;
      lookX = dz(pad.axes[2] || 0); lookY = dz(pad.axes[3] || 0);
      pad.buttons.forEach((_, i) => { if (b(i) && !this.prevPad[i]) padTaps.add(i); this.prevPad[i] = b(i); });
    }

    // most recently pressed grab wins; keep it simple: first held in list
    const gi = grabsHeld.findIndex(Boolean);
    const raw = { pause, phantom, restart, menu, confirm, help, mLeft, mRight, mUp, mDown };
    const pressed = {};
    const tapName = { pause: 'pause', phantom: 'phantom', restart: 'restart', menu: 'menu', confirm: 'confirm', help: 'help', mLeft: 'left', mRight: 'right', mUp: 'up', mDown: 'down' };
    for (const n in raw) { pressed[n] = (raw[n] && !this.prev[n]) || this._tap(tapName[n]); }
    this.prev = raw;
    const taps = new Set(this.tapped);
    this.tapped.clear();
    const mouseX = this.mdx, mouseY = this.mdy;
    this.mdx = 0; this.mdy = 0;

    this.state = {
      steer, up, down, jump, brake, grind,
      grab: gi >= 0 ? GRAB_NAMES[gi] : null,
      phantomPressed: pressed.phantom,
      restartPressed: pressed.restart, menuPressed: pressed.menu, confirmPressed: pressed.confirm,
      helpPressed: pressed.help, pausePressed: pressed.pause, leftPressed: pressed.mLeft, rightPressed: pressed.mRight, upPressed: pressed.mUp, downPressed: pressed.mDown,
      // look around: stick is a rate (-1..1), mouse is pixels moved this frame
      lookX, lookY, mouseX, mouseY,
      taps, padTaps,   // raw key codes / pad button indices pressed this frame (menus, lift)
    };
    return this.state;
  }
}

export const CONTROLS = [
  ['Steer / spin', '← →', 'Left stick'],
  ['Tuck (fast) / back flip', '↓', 'Stick down · RT'],
  ['Push along when slow / stand up / front flip', '↑', 'Stick up'],
  ['Jump (hold to charge)', 'Space', 'A'],
  ['Brake / skid', 'Shift', 'LT'],
  ['Grab 1 (Indy / Safety)', 'A', 'X'],
  ['Grab 2 (Melon / Mute)', 'S', 'B'],
  ['Grab 3 (Method / Japan)', 'D', 'LB'],
  ['Grab 4 (Nose / Tail)', 'F', 'Y'],
  ['Phantom Flip (gear off feet)', 'W', 'Left stick click'],
  ['Grind: hold it to get on a rail, box or log (+ ← → = boardslide)', 'E', 'RB (hold)'],
  ['Look around (lets go = back behind you)', 'Shift + arrows when stopped', 'Right stick'],
  ['Restart (retries a competition) / menu', 'R / Esc', 'Menu / View'],
  ['Lodge competitions (stopped at the lodge door)', 'Enter', 'A'],
  ['Pause', 'P', '—'],
];
