// Phone / tablet controls: a thumb stick on the left, a few big buttons on the right.
// Each button simply holds the matching keyboard key (Jump = Space, Grab = A, Grind = E, Brake = Shift,
// ☰ = Esc), so everything that works on a keyboard works here too. The stick gives analog steering.
//
//   const touch = new TouchControls(input);   // only on touch screens
//   touch.setMode('run' | 'lift' | 'heli' | 'off');   // which buttons to show, every frame

export const IS_TOUCH = (() => {
  const q = new URLSearchParams(location.search).get('touch');
  if (q) return q === '1';
  if (/Xbox/i.test(navigator.userAgent || '')) return false;
  return (navigator.maxTouchPoints || 0) > 0 && !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
})();

const BUTTONS = [
  // id, label, key, modes it shows in
  ['jump', 'JUMP', 'Space', ['run', 'heli', 'lift']],
  ['grab', 'GRAB', 'KeyA', ['run']],
  ['grind', 'GRIND', 'KeyE', ['run']],
  ['brake', 'BRAKE', 'ShiftLeft', ['run']],
];

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.mode = 'off';
    document.body.classList.add('touch');
    const el = this.el = document.createElement('div');
    el.id = 'touch';
    el.innerHTML = `<div id="t-stick-zone"><div id="t-stick"><div id="t-knob"></div></div></div>` +
      `<div id="t-btns">${BUTTONS.map(([id, label]) => `<div class="t-btn" id="t-${id}" data-id="${id}">${label}</div>`).join('')}</div>` +
      `<div class="t-btn t-small" id="t-menu">☰</div>`;
    document.body.appendChild(el);
    this.stick = { id: null, x0: 0, y0: 0 };
    const zone = el.querySelector('#t-stick-zone'), base = el.querySelector('#t-stick'), knob = el.querySelector('#t-knob');
    const R = 55;
    const setStick = (dx, dy) => {
      const d = Math.hypot(dx, dy), k = d > R ? R / d : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      const sx = Math.max(-1, Math.min(1, dx / R)), sy = Math.max(-1, Math.min(1, dy / R));
      input.touchSteer = Math.abs(sx) < 0.12 ? 0 : sx;
      input.touchY = sy;
    };
    zone.addEventListener('pointerdown', (e) => {
      if (this.stick.id !== null) return;
      e.preventDefault();
      this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
      const r = zone.getBoundingClientRect();
      base.style.left = `${e.clientX - r.left}px`; base.style.top = `${e.clientY - r.top}px`;
      base.classList.add('on');
      try { zone.setPointerCapture(e.pointerId); } catch {}
      setStick(0, 0);
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === this.stick.id) { e.preventDefault(); setStick(e.clientX - this.stick.x0, e.clientY - this.stick.y0); } });
    const endStick = (e) => { if (e.pointerId !== this.stick.id) return; this.stick.id = null; base.classList.remove('on'); setStick(0, 0); input.touchY = 0; };
    zone.addEventListener('pointerup', endStick); zone.addEventListener('pointercancel', endStick);

    // buttons hold their key while a finger is on them
    const hold = (b, code) => {
      const down = (e) => { e.preventDefault(); b.classList.add('down'); input.keys.add(code); input.tapped.add(code); try { b.setPointerCapture(e.pointerId); } catch {} };
      const up = (e) => { e.preventDefault(); b.classList.remove('down'); input.keys.delete(code); };
      b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    for (const [id, , code] of BUTTONS) hold(el.querySelector(`#t-${id}`), code);
    hold(el.querySelector('#t-menu'), 'Escape');
    this.btns = Object.fromEntries(BUTTONS.map(([id, , , modes]) => [id, { el: el.querySelector(`#t-${id}`), modes }]));
    this.setMode('off');
  }

  setMode(mode, label = null) {
    if (mode === this.mode && label === this.label) return;
    this.mode = mode; this.label = label;
    this.el.classList.toggle('hidden', mode === 'off');
    this.el.querySelector('#t-stick-zone').classList.toggle('hidden', mode === 'lift');
    this.el.querySelector('#t-menu').classList.toggle('hidden', mode === 'lift');
    for (const [id, b] of Object.entries(this.btns)) b.el.classList.toggle('hidden', !b.modes.includes(mode));
    this.btns.jump.el.textContent = mode === 'lift' ? 'JUMP OFF' : 'JUMP';
    // leaving a screen: let go of everything
    for (const k of ['Space', 'KeyA', 'KeyE', 'ShiftLeft', 'Escape']) this.input.keys.delete(k);
    this.input.touchSteer = 0; this.input.touchY = 0;
  }
}
