// Moving around a menu with a controller or the arrow keys.
// Rows are the elements marked data-row inside the root, top to bottom:
//   a button            → A / Enter presses it
//   data-opt  (◀ value ▶) → left / right change it (the row gets a 'change' event with detail = -1 or 1)
//   data-group (chips)  → left / right move between its buttons, A presses the highlighted one
//   data-input          → A / Enter puts the cursor in its text box
// Hovering a row with the mouse highlights it too, so mouse, touch and controller always agree.

const vis = (row) => [...row.querySelectorAll('button')].filter(b => b.offsetParent !== null);

export class MenuNav {
  constructor(root) {
    this.root = root; this.i = 0; this.sub = 0;
    root.addEventListener('pointermove', (e) => {
      const row = e.target.closest && e.target.closest('[data-row]');
      if (!row) return;
      const rows = this.rows(), i = rows.indexOf(row);
      if (i < 0) return;
      let sub = this.sub;
      if (row.hasAttribute('data-group')) { const b = e.target.closest('button'), bs = vis(row); if (b && bs.includes(b)) sub = bs.indexOf(b); }
      if (i !== this.i || sub !== this.sub) { this.i = i; this.sub = sub; this.paint(false); }
    });
  }
  rows() { return [...this.root.querySelectorAll('[data-row]')].filter(el => el.offsetParent !== null && !el.classList.contains('disabled')); }
  reset() { this.i = 0; this.sub = 0; this.paint(); }
  paint(scroll = true) {
    const rows = this.rows();
    if (!rows.length) return;
    this.i = Math.max(0, Math.min(rows.length - 1, this.i));
    for (const el of this.root.querySelectorAll('.focus')) el.classList.remove('focus');
    const row = rows[this.i];
    row.classList.add('focus');
    if (row.hasAttribute('data-group')) {
      const bs = vis(row);
      this.sub = Math.max(0, Math.min(bs.length - 1, this.sub));
      if (bs[this.sub]) bs[this.sub].classList.add('focus');
    }
    if (scroll) row.scrollIntoView({ block: 'nearest' });
  }
  // inp: the game's input state (upPressed, downPressed, leftPressed, rightPressed, confirmPressed)
  handle(inp) {
    const rows = this.rows(), n = rows.length;
    if (!n) return;
    let moved = false;
    if (inp.upPressed) { this.i = (this.i - 1 + n) % n; this.sub = 0; moved = true; }
    if (inp.downPressed) { this.i = (this.i + 1) % n; this.sub = 0; moved = true; }
    const row = rows[Math.max(0, Math.min(n - 1, this.i))];
    const dir = (inp.rightPressed ? 1 : 0) - (inp.leftPressed ? 1 : 0);
    if (dir && !moved) {
      if (row.hasAttribute('data-opt')) row.dispatchEvent(new CustomEvent('change', { detail: dir }));
      else if (row.hasAttribute('data-group')) { const k = vis(row).length; this.sub = (this.sub + dir + k) % k; moved = true; }
    }
    if (inp.confirmPressed && !moved) {
      if (row.hasAttribute('data-opt')) row.dispatchEvent(new CustomEvent('change', { detail: 1 }));
      else if (row.hasAttribute('data-group')) { const b = vis(row)[this.sub]; if (b) b.click(); }
      else if (row.hasAttribute('data-input')) { const t = row.querySelector('input'); if (t) t.focus(); }
      else row.click();
    }
    if (moved || dir || inp.confirmPressed) this.paint();
  }
}
