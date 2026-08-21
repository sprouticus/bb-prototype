/* ============================================================
   Tests for history-scroll.js + the .snake-* CSS.

   RUN:  npm install jsdom css-tree      (once, anywhere)
         node history-scroll.test.js

   WHY THIS EXISTS
   There is no browser in the dev sandbox, so this
   executes history-scroll.js under jsdom against a fake, fully
   deterministic layout and asserts the geometry and the state
   machine directly. It has caught, so far:
     - two variable-shadowing bugs that made the restart button and
       then the reset itself silently no-op
     - the timeline sliding a full row height underneath the vehicle
       during a traverse
     - the re-arm starving: clicking Start at Beginning and then
       scrolling without pausing left the animation frozen forever
     - a one-border-width misalignment at every top join in the path
   None of those were visible by reading the code.

   WHAT IT CANNOT TELL YOU
   jsdom does no layout and paints nothing. Every offset here is a
   stub. This checks arithmetic and state, never appearance — how it
   looks, whether the dissolve reads as a dissolve, whether the pin
   release flinches, all still need real eyes in a real browser.

   THE FAKE LAYOUT (all CSS px)
     .snake at document y=700, 1000 wide, --turn-r 70, 1500 tall
     5 rows x 300 tall  -> row i spans 300i..300(i+1), rule at 300(i+1)
     .snake-cell 470 wide; x=372 on --right rows, x=158 on --left
     traveller 104x62, sticky header 120, viewport 900
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const csstree = require('css-tree');

const SITE = __dirname;

const ROW_H = 300, SNAKE_TOP = 700, SNAKE_W = 1000, TURN_R = 70;
const TRAV_W = 104, TRAV_H = 62, VH = 900, HDR_H = 120;
/* The four phases of a line, in px of scroll, and the phase
   boundaries as fractions of a line. Keep in step with the tuning
   block in history-scroll.js. */
const PIN_DRIVE = 1200, PIN_HOLD = 550, PIN_FADE = 180, PIN_LIFT = 300;
const PIN_PER_LINE = PIN_DRIVE + PIN_HOLD + PIN_FADE + PIN_LIFT;  // 2230
const P_DRIVE_END = PIN_DRIVE / PIN_PER_LINE;                     // 0.538
const P_HOLD_END = (PIN_DRIVE + PIN_HOLD) / PIN_PER_LINE;         // 0.785
const P_FADE_END = (PIN_DRIVE + PIN_HOLD + PIN_FADE) / PIN_PER_LINE;
const P_FADE_IN = PIN_FADE / PIN_PER_LINE;
const PIN_LEAD = 600, ANCHOR = 0.62, TAIL = 90;
const CUE_ABOVE_LINE = 200, N = 5;
const SNAKE_H = ROW_H * N;                                   // 1500
const STAGE_H = VH - HDR_H;                                  // 780
/* The last line buys its drive and its hold only — no fade, no lift. */
const END_P = (N - 1) + P_HOLD_END;                          // 4.785
const TRAVEL = END_P * PIN_PER_LINE;                          // 10670
const DIST = PIN_LEAD + TRAVEL;                               // 11270
const PIN_START = SNAKE_TOP - HDR_H;                         // 580
const MIN_SHIFT = Math.min(0, STAGE_H - SNAKE_H - TAIL);     // -810
/* .snake-cell is max-width:470 and --left rows justify-self:end, so both
   blocks lose their column slack from the outer edge and sit 372 from
   their respective sides. Keep these in step with the CSS. */
const CELL_W = 470, CELL_L_R = 372, CELL_L_L = SNAKE_W - CELL_L_R - CELL_W;

function build({ reduce = false, wide = true, initialY = 0 } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(SITE, 'history.html'), 'utf8'),
    { runScripts: 'outside-only' });
  const { window } = dom, doc = window.document;

  let scrollY = initialY;
  Object.defineProperty(window, 'innerHeight', { get: () => VH, configurable: true });
  Object.defineProperty(window, 'pageYOffset', { get: () => scrollY, configurable: true });
  const scrollCalls = [];
  window.scrollTo = function (a, b) {
    const rec = (typeof a === 'object' && a !== null) ? a : { top: b, behavior: 'auto' };
    scrollCalls.push(rec); scrollY = rec.top;
  };

  let restoration = 'auto';
  Object.defineProperty(window.history, 'scrollRestoration', {
    configurable: true, get: () => restoration, set: (v) => { restoration = v; },
  });

  // rAF drained by hand so "one frame" is a thing we can assert about
  let rafq = [];
  window.requestAnimationFrame = (cb) => { rafq.push(cb); return rafq.length; };
  const step = () => { const q = rafq; rafq = []; q.forEach((cb) => cb(0)); };
  const settle = () => { let n = 0; while (rafq.length && n++ < 500) step(); };

  const mqs = {};
  window.matchMedia = (q) => {
    if (mqs[q]) return mqs[q];
    const ls = [];
    return (mqs[q] = {
      media: q,
      matches: q.indexOf('reduced-motion') >= 0 ? reduce : wide,
      addEventListener: (_, fn) => ls.push(fn),
      removeEventListener: () => {},
      _set(v) { this.matches = v; ls.forEach((f) => f()); },
    });
  };

  const realGCS = window.getComputedStyle.bind(window);
  window.getComputedStyle = (el) => ({
    getPropertyValue: (p) => (p === '--turn-r' ? TURN_R + 'px' : realGCS(el).getPropertyValue(p)),
  });

  const pin = doc.querySelector('.snake-pin');
  const snake = doc.querySelector('.snake');
  const rows = [].slice.call(doc.querySelectorAll('.snake-row'));
  const traveler = doc.querySelector('.snake-traveler');
  const cue = doc.querySelector('.snake-cue');
  const header = doc.querySelector('header.site');

  const box = new WeakMap();
  rows.forEach((r, i) => box.set(r, { top: i * ROW_H, h: ROW_H, w: SNAKE_W }));
  box.set(snake, { top: 0, h: SNAKE_H, w: SNAKE_W });
  if (traveler) box.set(traveler, { top: 0, h: TRAV_H, w: TRAV_W });
  if (header) box.set(header, { top: 0, h: HDR_H, w: SNAKE_W });
  // a released pin collapses to the timeline's natural height
  box.set(pin, { top: 0, w: SNAKE_W, get h() { return parseFloat(pin.style.height) || SNAKE_H; } });

  const HE = window.HTMLElement.prototype;
  [['offsetTop', 'top'], ['offsetHeight', 'h'], ['offsetWidth', 'w']].forEach(([prop, key]) =>
    Object.defineProperty(HE, prop, {
      configurable: true, get() { const v = box.get(this); return v ? v[key] : 0; },
    }));
  Object.defineProperty(window.Element.prototype, 'clientWidth', {
    configurable: true, get() { return this === snake ? SNAKE_W : 0; },
  });
  snake.getBoundingClientRect = () => ({ top: SNAKE_TOP - scrollY, left: 0, width: SNAKE_W, height: SNAKE_H });
  pin.getBoundingClientRect = () => ({ top: SNAKE_TOP - scrollY, left: 0, width: SNAKE_W, height: 0 });
  rows.forEach((r) => {
    const cell = r.querySelector('.snake-cell');
    const left = r.classList.contains('snake-row--left') ? CELL_L_L : CELL_L_R;
    cell.getBoundingClientRect = () => ({ left, width: CELL_W, top: 0, height: 200 });
  });

  const ioTargets = [];
  window.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; ioTargets.push(this); this.seen = []; }
    observe(t) { this.seen.push(t); }
    unobserve(t) { this.seen = this.seen.filter((x) => x !== t); }
    disconnect() { this.seen = []; }
    _reveal(t) { this.cb([{ target: t, isIntersecting: true }]); }
  };

  window.eval(fs.readFileSync(path.join(SITE, 'history-scroll.js'), 'utf8'));

  return {
    window, doc, pin, snake, rows, traveler, cue, scrollCalls, ioTargets, mqs, step, settle,
    get pending() { return rafq.length; },
    scrollTo(y) { scrollY = y; window.dispatchEvent(new window.Event('scroll')); },
    go(y) { this.scrollTo(y); this.settle(); },
    click(el) { el.dispatchEvent(new window.Event('click')); this.settle(); },
    isPinned: () => pin.classList.contains('is-pinned'),
    pinHeight: () => parseFloat(pin.style.height) || 0,
    restoration: () => window.history.scrollRestoration,
    shift: () => { const m = /translate3d\(0,([-\d.]+)px/.exec(snake.style.transform); return m ? parseFloat(m[1]) : 0; },
    leads: () => rows.map((r) => parseFloat(r.style.getPropertyValue('--lead')) || 0),
    rawLeads: () => rows.map((r) => r.style.getPropertyValue('--lead')),
    bands: () => rows.map((r) => parseFloat(r.style.getPropertyValue('--band')) || 0),
    transform: () => traveler.style.transform,
    opacity: () => parseFloat(traveler.style.opacity),
    cueTop: () => parseFloat(cue.style.top),
    cueShown: () => !cue.classList.contains('is-gone'),
    restartEl: doc.querySelector('.snake-restart'),
    restartBtn: doc.querySelector('.snake-restart button'),
  };
}

let pass = 0, fail = 0;
const eq = (a, b, m) => { const ok = a === b; ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${m}${ok ? '' : `  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`); };
const near = (a, b, t, m) => { const ok = Math.abs(a - b) <= t; ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${m}${ok ? '' : `  (got ${a}, want ~${b})`}`); };
const truthy = (a, m) => eq(!!a, true, m);

// scroll position at fraction f through line i's whole four-phase budget
const at = (i, f) => PIN_START + PIN_LEAD + (i + f) * PIN_PER_LINE;
// ...and at fraction t of line i's TRAVERSE, which is only the drive phase
const atDrive = (i, t) => at(i, t * P_DRIVE_END);
const atEnd = () => PIN_START + DIST;
const vehX = (t) => parseFloat(/translate3d\(([-\d.]+)px/.exec(t)[1]) + TRAV_W / 2;
const vehY = (t) => parseFloat(/translate3d\([-\d.]+px,([-\d.]+)px/.exec(t)[1]);
const runX = (rtl, f) => (rtl ? (SNAKE_W - TURN_R) + (TURN_R - (SNAKE_W - TURN_R)) * f
                              : TURN_R + ((SNAKE_W - TURN_R) - TURN_R) * f);
const expShift = (p) => {
  const idx = Math.min(Math.floor(p), N - 1), frac = p >= N ? 1 : Math.min(Math.max(p - idx, 0), 1);
  const a = (idx + 1) * ROW_H, b = idx + 1 < N ? (idx + 2) * ROW_H : a;
  // the lift is the tail of the line, after the fade — never before it
  const u = Math.min(Math.max((frac - P_FADE_END) / (1 - P_FADE_END), 0), 1);
  const e = u * u * (3 - 2 * u);
  return Math.min(Math.max(-((a + (b - a) * e) - STAGE_H * ANCHOR), MIN_SHIFT), 0);
};
/* where a row's rule actually sits in the viewport, in both states:
   pinned it rides the stuck stage under the transform, released it is
   just document position minus scroll */
const ruleScreenY = (h, i) => h.isPinned()
  ? HDR_H + (i + 1) * ROW_H + h.shift()
  : SNAKE_TOP + (i + 1) * ROW_H - h.window.pageYOffset;
const fullyRevealed = (a) => a.leads().every((l, i) => Math.abs(l - (CELL_W + a.bands()[i])) < 0.6);

console.log('\n--- 1. page load ---');
let a = build({ initialY: 0 }); a.settle();
truthy(a.snake.classList.contains('snake--anim'), '.snake--anim added on a wide screen with motion allowed');
eq(a.rows.length, N, 'five milestone rows');
eq(a.doc.querySelectorAll('.snake-vehicle').length, N, 'five static per-row marks kept as the no-JS fallback');
near(vehX(a.transform()), TURN_R, 0.5, 'vehicle parked at the far left of line 1');
eq(a.opacity(), 1, 'and visible');
eq(/scaleX/.test(a.transform()), false, 'facing right, the way it will travel');
eq(a.leads().every((l) => l === 0), true, 'no milestone copy showing');
eq(a.restartEl.classList.contains('is-visible'), false, 'restart button hidden');
eq(a.restoration(), 'manual', 'scroll restoration suppressed, so a refresh lands at the top');

console.log('\n--- 2. the scroll cue ---');
truthy(a.cue, 'cue is in the markup');
eq(a.cue.getAttribute('aria-hidden'), 'true', 'aria-hidden: masked copy is still readable by a screen reader');
near(a.cueTop(), ROW_H - CUE_ABOVE_LINE, 0.5, `sits ${CUE_ABOVE_LINE}px above the first rule`);
truthy(a.cueShown(), 'showing while the vehicle is parked');
a.go(PIN_START + PIN_LEAD - 10);
truthy(a.cueShown(), 'still showing at the end of the lead-in, where scrolling does nothing yet');
a.go(PIN_START + PIN_LEAD + 80);
eq(a.cueShown(), false, 'gone once the vehicle sets off');
a.go(atEnd());
eq(a.cueShown(), false, 'still gone at the end');
a.click(a.restartBtn);
truthy(a.cueShown(), 'comes back after Start at Beginning');
{
  const rm = build({ reduce: true }); rm.settle();
  eq(rm.cue.style.top, '', 'reduced motion: cue never positioned');
  const nw = build({ wide: false }); nw.settle();
  eq(nw.cue.style.top, '', 'narrow: cue never positioned');
}

console.log('\n--- 3. the pin ---');
a = build({ initialY: 0 }); a.settle();
truthy(a.isPinned(), '.snake-pin gets .is-pinned');
near(a.pinHeight(), STAGE_H + DIST, 0.5, `pin is one stage plus ${DIST}px of bought scroll`);
eq(a.pin.style.getPropertyValue('--pin-top'), HDR_H + 'px', 'stage sticks below the sticky site header');
eq(a.pin.style.getPropertyValue('--stage-h'), STAGE_H + 'px', 'stage is one viewport minus the header');
eq(a.shift(), 0, 'timeline starts unshifted');

console.log('\n--- 4. the lead-in absorbs a fast arrival ---');
a = build({ initialY: 0 }); a.settle();
a.go(PIN_START + 500);
near(vehX(a.transform()), TURN_R, 0.5, 'overshooting the stick point by 500px still shows the vehicle parked');
eq(a.leads().every((l) => l === 0), true, 'and no copy showing');
a.go(PIN_START + PIN_LEAD + 60);
truthy(vehX(a.transform()) > TURN_R + 20, 'sets off immediately after the lead');

console.log('\n--- 5. motion is tied directly to scroll ---');
a = build({ initialY: 0 }); a.settle();
a.scrollTo(atDrive(0, 0.5)); a.step();
near(vehX(a.transform()), runX(false, 0.5), 0.5, 'one paint puts the vehicle exactly where scroll says');
const frozen = a.transform(), frozenShift = a.shift();
for (let i = 0; i < 200; i++) a.step();
eq(a.transform(), frozen, 'with the reader not scrolling, the vehicle does not move at all');
eq(a.shift(), frozenShift, 'and the timeline does not creep either');
eq(a.pending, 0, 'nothing queued - no self-driving loop');
{
  let ok = true, prev = null;
  const lin = build({ initialY: 0 }); lin.settle();
  for (let i = 0; i <= 12; i++) {
    lin.scrollTo(atDrive(0, i / 12)); lin.step();
    if (Math.abs(vehX(lin.transform()) - runX(false, i / 12)) > 0.6) ok = false;
    if (prev !== null && vehX(lin.transform()) < prev) ok = false;
    prev = vehX(lin.transform());
  }
  truthy(ok, 'vehicle x tracks scroll exactly at every step of a run');
}

console.log('\n--- 6. speed ---');
{
  const d = build({ initialY: 0 }); d.settle();
  d.scrollTo(atDrive(0, 0)); d.step();
  const y0 = d.window.pageYOffset;
  d.scrollTo(atDrive(0, 1)); d.step();
  near(d.window.pageYOffset - y0, PIN_DRIVE, 0.5, `crossing one line = ${PIN_DRIVE}px of scroll`);
  near(PIN_DRIVE / ROW_H, 4, 0.01, 'which is 4x the unpinned rate the timeline would give on its own');
  near(at(1, 0) - at(0, 0), PIN_PER_LINE, 0.5,
    `a whole line costs ${PIN_PER_LINE}px - the traverse plus hold, fade and lift`);
  near(DIST, 11270, 1, `the section holds ${DIST}px of scrolling in total`);
}

console.log('\n--- 7. the line holds still until the vehicle has gone ---');
{
  const h = build({ initialY: 0 }); h.settle();
  const ruleAt = (i, f) => { h.go(at(i, f)); return (i + 1) * ROW_H + h.shift(); };
  const r0 = ruleAt(1, 0.0);
  near(ruleAt(1, P_DRIVE_END * 0.5), r0, 0.5, 'line 2 has not moved at all by halfway across');
  near(ruleAt(1, P_DRIVE_END), r0, 0.5, 'still stationary when the vehicle reaches the corner');
  near(ruleAt(1, P_HOLD_END), r0, 0.5, 'STILL stationary through the whole hold - this is the reading beat');
  near(ruleAt(1, P_FADE_END), r0, 0.5, 'and through the dissolve');
  near(r0 - ruleAt(1, 1.0), ROW_H, 1.0, 'repositions by exactly one row, entirely in the lift phase');
}
{
  /* The regression this whole rebuild is about: nothing may move the
     line while there is still copy under the gradient. */
  const d = build({ initialY: 0 }); d.settle();
  const ruleY = () => 2 * ROW_H + d.shift();
  d.go(at(1, P_DRIVE_END));
  const parked = ruleY();
  near(d.leads()[1], CELL_W + d.bands()[1], 0.6, 'line 2 copy is fully revealed the moment the vehicle parks');
  eq(d.opacity(), 1, 'and the vehicle is still fully visible, standing at the corner');
  d.go(at(1, P_HOLD_END));
  near(ruleY(), parked, 0.5, 'the line has not budged for the whole hold');
  near(d.leads()[1], CELL_W + d.bands()[1], 0.6, 'copy still fully revealed');
  eq(d.opacity(), 1, 'vehicle still there, not yet dissolving');
  d.go(at(1, 0.999));
  truthy(d.opacity() < 0.01, `vehicle is gone before the line finishes moving (opacity ${d.opacity()})`);
}
{
  // the vehicle must be invisible for every frame of the lift
  let worst = 1;
  const v = build({ initialY: 0 }); v.settle();
  for (let i = 0; i <= 10; i++) {
    v.go(at(1, P_FADE_END + (1 - P_FADE_END) * (i / 10)));
    worst = Math.min(worst, 1 - v.opacity());
  }
  truthy(worst > 0.99, 'vehicle stays invisible for the whole lift, so it never drives diagonally');
}
{
  /* THE REGRESSION, stated as an invariant and swept across the whole
     pinned stretch rather than spot-checked: a line may not move
     while any of its own copy is still under the gradient. The old
     single-run version broke this on every line — the lift began at
     72% and the wipe did not finish until 100% — which is what made
     the end of each milestone unreadable no matter how slowly the
     reader scrolled. */
  const s = build({ initialY: 0 }); s.settle();
  let bad = '', parkedY = 0, lastIdx = -1;
  for (let y = PIN_START; y <= PIN_START + DIST && !bad; y += 40) {
    s.go(y);
    if (!s.isPinned()) break;
    const p = Math.min(Math.max((y - PIN_START - PIN_LEAD) / TRAVEL, 0), 1) * END_P;
    const idx = Math.min(Math.floor(p), N - 1);
    const ruleY = (idx + 1) * ROW_H + s.shift();
    if (idx !== lastIdx) { lastIdx = idx; parkedY = ruleY; }
    const revealed = s.leads()[idx] >= CELL_W + s.bands()[idx] - 0.6;
    if (!revealed && Math.abs(ruleY - parkedY) > 0.5) {
      bad = `row ${idx + 1} moved ${(ruleY - parkedY).toFixed(1)}px at y=${y} with only ` +
            `${s.leads()[idx].toFixed(0)} of ${(CELL_W + s.bands()[idx]).toFixed(0)} revealed`;
    }
  }
  eq(bad, '', `no line moves while its own copy is still coming in${bad ? ` - ${bad}` : ''}`);
}
{
  let vis = true, worst = '';
  for (let i = 0; i < N; i++) for (const f of [0, 0.5, 1]) {
    const inst = build({ initialY: 0 }); inst.settle();
    inst.go(at(i, f));
    if (!inst.isPinned()) continue;              // last frame releases the pin
    const ruleY = (i + 1) * ROW_H + inst.shift();
    if (!(ruleY - TRAV_H - 3 > 0 && ruleY < STAGE_H)) { vis = false; worst = `row${i + 1} @${f}`; }
  }
  truthy(vis, `every line's rule stays fully inside the ${STAGE_H}px stage ${worst}`);
}

console.log('\n--- 8. the wipe edge sits on the vehicle ---');
a = build({ initialY: 0 }); a.settle();
a.go(atDrive(0, 0.5));
near(a.leads()[0], vehX(a.transform()) - CELL_L_R, 1.0, 'row1: wipe edge is exactly at the vehicle x');
near(a.bands()[0], (SNAKE_W - TURN_R) - CELL_L_R - CELL_W, 0.5, 'soft band = travel left over past the cell');
{
  const e = build({ initialY: 0 }); e.settle();
  e.go(atDrive(0, 0.25));
  truthy(vehX(e.transform()) < CELL_L_R, 'at 25% of the traverse the vehicle has not reached the copy yet');
  eq(e.leads()[0], 0, 'so nothing of that copy is showing - the wipe waits for the vehicle');
}
a.go(atDrive(0, 1));
near(a.leads()[0], CELL_W + a.bands()[0], 0.6, 'row1 fully revealed exactly as the vehicle reaches the end cap');
a.go(at(0, 0.999));
near(a.leads()[0], CELL_W + a.bands()[0], 0.6, 'and stays revealed - the parked vehicle freezes the wipe');

console.log('\n--- 9. row 2 runs right-to-left ---');
a.go(atDrive(1, 0.5));
truthy(/scaleX\(-1\)/.test(a.transform()), 'flipped to face left');
near(vehX(a.transform()), runX(true, 0.5), 0.5, 'at the midpoint travelling right-to-left');
near(a.leads()[1], (CELL_L_L + CELL_W) - vehX(a.transform()), 1.0, 'wipe measured from the cell RIGHT edge, at the vehicle');
const midX = vehX(a.transform());
a.go(atDrive(1, 0.8));
truthy(vehX(a.transform()) < midX, 'keeps moving LEFT as scrolling continues');
eq(a.leads()[2], 0, 'row3 still untouched');

console.log('\n--- 10. the dissolve across a turn ---');
{
  const d = build({ initialY: 0 }); d.settle();
  d.go(at(0, P_HOLD_END)); eq(d.opacity(), 1, 'still solid at the end of the hold');
  d.go(at(0, P_HOLD_END + (P_FADE_END - P_HOLD_END) * 0.5));
  near(d.opacity(), 0.5, 0.03, 'half dissolved halfway through the fade phase');
  d.go(at(0, P_FADE_END)); near(d.opacity(), 0, 0.01, 'fully gone by the end of it');
  d.go(at(1, P_FADE_IN * 0.5)); near(d.opacity(), 0.5, 0.03, 'fading back IN over the opening of the next line');
  d.go(at(1, P_FADE_IN)); near(d.opacity(), 1, 0.01, 'solid again once the fade-in is done');
  const f = build({ initialY: 0 }); f.settle();
  f.go(at(0, 0)); eq(f.opacity(), 1, 'first row never fades in');
  f.go(atEnd());   eq(f.opacity(), 1, 'last row never fades out - it parks');
  near(vehX(f.transform()), SNAKE_W - TURN_R, 0.5, 'parked at the end cap');
  near(vehY(f.transform()), SNAKE_H - TRAV_H - 3, 0.2, 'parked on the last rule');
}

console.log('\n--- 11. the section releases once the vehicle parks ---');
{
  const f = build({ initialY: 0 }); f.settle();
  truthy(f.isPinned(), 'pinned while running');
  f.go(atEnd());
  eq(f.isPinned(), false, 'released once the vehicle reaches the end');
  eq(f.pinHeight(), 0, 'bought scroll distance given back');
  eq(f.snake.style.transform, '', 'in-stage transform dropped, so the timeline sits in normal flow');
  truthy(fullyRevealed(f), 'all five milestones still fully revealed');
  near(vehX(f.transform()), SNAKE_W - TURN_R, 0.5, 'vehicle still parked at the finish');
  truthy(f.restartEl.classList.contains('is-visible'), 'restart button showing');
  eq(f.restartBtn.getAttribute('tabindex'), '0', 'and in the tab order');
  near(f.window.pageYOffset, PIN_START - expShift(END_P), 1.0, 'scroll corrected so the timeline does not jump');
  const t = f.transform(), l = f.leads().join();
  f.go(PIN_START);
  eq(f.transform(), t, 'scrolling back up does not move the vehicle');
  eq(f.leads().join(), l, 'and does not take the copy away');
  eq(f.isPinned(), false, 'and does not re-pin - the reader scrolls the whole timeline freely');
  f.go(0);
  eq(f.leads().join(), l, 'still fully revealed at the very top of the page');
}
{
  const p = build({ initialY: 0 }); p.settle();
  const landed = PIN_START + DIST + 1500;
  p.go(landed);
  near(p.window.pageYOffset, landed - ((STAGE_H + DIST) - SNAKE_H), 1.0,
    'flicking clean past the section moves the reader by exactly what the pin shrank');
}

console.log('\n--- 12. one-directional ratchet ---');
a = build({ initialY: 0 }); a.settle();
a.go(at(2, 0.5));
const mid = a.transform(), midLeads = a.leads().join();
a.go(a.window.pageYOffset - 10);
eq(a.transform(), mid, 'a nudge back up does not rewind the vehicle');
truthy(a.isPinned(), 'and is under UP_RELEASE, so the pin keeps hold');
a.go(a.window.pageYOffset - 400);
eq(a.transform(), mid, 'a real scroll back up still does not rewind');
eq(a.leads().join(), midLeads, 'and takes no copy away');
a.go(PIN_START);
eq(a.transform(), mid, 'nor does carrying on up to the pin start');
eq(a.leads().join(), midLeads, 'still nothing un-revealed');

console.log('\n--- 13. scrolling back up lets the pin go, and coming back resumes ---');
{
  const r = build({ initialY: 0 }); r.settle();
  r.go(at(1, 0.4));
  const p0 = r.transform(), leads0 = r.leads().join(), before = ruleScreenY(r, 1);
  truthy(r.isPinned(), 'pinned and running');

  r.go(r.window.pageYOffset - 600);
  eq(r.isPinned(), false, 'scrolling back up releases the section');
  eq(r.pinHeight(), 0, 'the bought scroll distance goes back');
  eq(r.snake.style.transform, '', 'and the in-stage transform with it');
  near(ruleScreenY(r, 1), before, 0.6, 'the frame does not move as it lets go');
  const releasedAt = r.window.pageYOffset;

  /* the correction is a scroll of its own, and the trigger to come
     back is the same number it just landed on */
  r.scrollTo(releasedAt); r.settle();
  eq(r.isPinned(), false, "the correction's own scroll event does not re-pin it on the spot");

  r.go(releasedAt - 900);
  eq(r.transform(), p0, 'vehicle stays parked where it stopped while they read back');
  eq(r.leads().join(), leads0, 'and every revealed milestone stays revealed');
  eq(r.isPinned(), false, 'the page scrolls normally the whole way up');
  r.go(0);
  eq(r.leads().join(), leads0, 'still revealed at the very top of the page');

  r.go(releasedAt - 200);
  eq(r.isPinned(), false, 'not re-pinned before the point it let go at');
  r.go(releasedAt + 20);
  truthy(r.isPinned(), 're-pins on the way back down past that point');
  near(ruleScreenY(r, 1), before, 1.5, 'and the frame does not move as it takes hold');
  eq(r.transform(), p0, 'vehicle picks up exactly where it left off');
  eq(r.leads().join(), leads0, 'with exactly the copy it had, no more and no less');
  /* line 2 runs right-to-left, so "on" means a smaller x */
  const back = vehX(r.transform());
  r.go(r.window.pageYOffset + 300);
  truthy(back - vehX(r.transform()) > 100, 'and the next scroll drives it on from there');
}
{
  /* the reader who leaves in one jump rather than by scrolling */
  const j = build({ initialY: 0 }); j.settle();
  j.go(at(2, 0.3));
  const leads = j.leads().join();
  j.go(0);
  eq(j.isPinned(), false, 'a jump clean above the section releases the pin too');
  eq(j.window.pageYOffset, 0, 'and leaves the reader exactly where they put themselves');
  eq(j.leads().join(), leads, 'with everything revealed so far still revealed');
  j.go(PIN_START + 900);
  truthy(j.isPinned(), 'scrolling back down re-pins it');
}
{
  /* approaching the section for the first time must not read as leaving it */
  const n = build({ initialY: 0 }); n.settle();
  for (let y = 0; y < PIN_START; y += 60) n.go(y);
  n.go(PIN_START - 40);
  truthy(n.isPinned(), 'scrolling down to the section, then up a little, keeps it armed');
  eq(n.pinHeight() > 0, true, 'the bought distance is still there');
}

console.log('\n--- 14. start at beginning ---');
/* `a` is released mid-run from the section above: the first scroll to
   the end re-pins it at the progress it left at, the second drives it
   the rest of the way. */
a.go(atEnd());
a.go(atEnd());
eq(a.isPinned(), false, 'released before the button is clicked');
a.click(a.restartBtn);
eq(a.leads().every((l) => l === 0), true, 'hides all milestone copy again');
eq(a.restartEl.classList.contains('is-visible'), false, 'button hides itself');
eq(a.restartBtn.getAttribute('tabindex'), '-1', 'and leaves the tab order');
truthy(a.isPinned(), 're-pins the section');
near(a.pinHeight(), STAGE_H + DIST, 0.5, 'and buys the scroll distance back');
{
  const sc = a.scrollCalls[a.scrollCalls.length - 1];
  near(sc.top, PIN_START + PIN_LEAD, 0.5, 'lands past the lead-in, so the next pixel of scrolling moves the vehicle');
  eq(sc.behavior, 'auto', 'jumps instantly - a smooth scroll here is what starved the old re-arm');
}
near(vehX(a.transform()), TURN_R, 0.5, 'vehicle back at the starting position');
a.go(PIN_START + PIN_LEAD + 120);
truthy(vehX(a.transform()) > TURN_R + 10, 'a small scroll straight after restart moves it immediately');

console.log('\n--- 15. restart then scroll continuously, no pause ---');
{
  const r = build({ initialY: 0 }); r.settle();
  r.go(atEnd());
  r.click(r.restartBtn);
  for (let i = 1; i <= 40; i++) r.go(PIN_START + PIN_LEAD + i * 150);
  truthy(vehX(r.transform()) > TURN_R + 40, 'vehicle moves when the reader scrolls continuously after a restart');
  truthy(r.leads()[0] > 0, 'and copy is uncovered');
}

console.log('\n--- 16. refresh starts over ---');
{
  const spent = build({ initialY: 0 }); spent.settle();
  spent.go(atEnd());
  eq(spent.isPinned(), false, 'first run finishes and releases');
  const re = build({ initialY: 0 }); re.settle();
  near(vehX(re.transform()), TURN_R, 0.5, 'after refresh the vehicle is back at the start');
  eq(re.leads().every((l) => l === 0), true, 'and no copy is showing');
  truthy(re.isPinned(), 'and the section is pinned and armed again');
  const restored = build({ initialY: at(2, 0.5) }); restored.settle();
  truthy(restored.leads()[0] > 0, 'if a browser restores scroll anyway, the timeline matches where the reader is');
}

console.log('\n--- 17. reduced motion, narrow, resize ---');
{
  const b = build({ reduce: true }); b.settle();
  eq(b.snake.classList.contains('snake--anim'), false, 'reduced motion: no .snake--anim');
  eq(b.isPinned(), false, 'reduced motion: not pinned');
  eq(b.pinHeight(), 0, 'reduced motion: no bought scroll distance');
  eq(b.restoration(), 'auto', 'reduced motion: scroll restoration left alone');
  b.go(at(2, 0.5));
  eq(b.rawLeads().every((v) => v === ''), true, 'reduced motion: nothing hidden, no --lead written');

  const c = build({ wide: false }); c.settle();
  eq(c.snake.classList.contains('snake--simple'), true, 'narrow: .snake--simple');
  eq(c.isPinned(), false, 'narrow: not pinned');
  eq(c.restoration(), 'auto', 'narrow: scroll restoration left alone');
  c.ioTargets[0]._reveal(c.rows[1]);
  truthy(c.rows[1].classList.contains('is-revealed'), 'narrow: row reveals on intersect');
  eq(c.rows[3].classList.contains('is-revealed'), false, 'narrow: unseen rows stay hidden');

  const d = build(); d.settle();
  d.mqs['(min-width: 821px)']._set(false); d.settle();
  eq(d.snake.classList.contains('snake--anim'), false, 'wide -> narrow tears down');
  eq(d.isPinned(), false, 'wide -> narrow unpins');
  eq(d.pin.style.height, '', 'wide -> narrow drops the bought distance');
  eq(d.snake.style.transform, '', 'wide -> narrow drops the transform');
  eq(d.rawLeads().every((v) => v === ''), true, 'wide -> narrow clears --lead, nothing left masked out');
  eq(d.restoration(), 'auto', 'wide -> narrow hands scroll restoration back');
  d.mqs['(min-width: 821px)']._set(true); d.settle();
  truthy(d.isPinned(), 'narrow -> wide restores the pin');
}

console.log('\n--- 18. snake path joins (CSS arithmetic) ---');
{
  const css = fs.readFileSync(path.join(SITE, 'styles.css'), 'utf8');
  let parseErrors = 0;
  const ast = csstree.parse(css, { onParseError() { parseErrors++; } });
  eq(parseErrors, 0, 'stylesheet parses clean');

  const grab = (wanted, firstOnly) => {
    let out = null;
    csstree.walk(ast, { visit: 'Rule', enter(node) {
      if (out && firstOnly) return;
      if (csstree.generate(node.prelude) !== wanted) return;
      const d = {};
      csstree.walk(node.block, { visit: 'Declaration',
        enter(x) { d[x.property] = csstree.generate(x.value).replace(/\s+/g, ' ').trim(); } });
      out = d;
    }});
    return out;
  };

  // firstOnly: the <=820px block reuses this exact selector to hide the turns
  const conn = grab('.snake-row--turn-right::before,.snake-row--turn-left::before', true);
  const right = grab('.snake-row--turn-right::before');
  const left = grab('.snake-row--turn-left::before');
  const row = grab('.snake-row', true);   // base rule; the <=820px override sets min-height:0
  truthy(conn && right && left && row, 'found every rule the path depends on');

  // THE point: the straight runs must not be separate elements again
  eq(grab('.snake-row::after'), null,
    'no .snake-row::after - the runs are drawn by the turns, so there is no arc/straight junction to break');

  const bw = parseFloat(conn.border);

  /* The one that actually caused the broken path, three times over.
     `*{box-sizing:border-box}` does not match pseudo-elements, so
     this box is content-box unless it says otherwise, and every
     offset below is then wrong by a border width or two. */
  eq(conn['box-sizing'], 'border-box',
    'turn declares box-sizing itself - the global * reset does not reach pseudo-elements');
  {
    const reset = grab('*', true);
    truthy(reset && reset['box-sizing'] === 'border-box', 'the global reset exists...');
    let coversPseudo = false;
    csstree.walk(ast, { visit: 'Rule', enter(node) {
      const sel = csstree.generate(node.prelude);
      if (/::before/.test(sel) && /^\*/.test(sel)) coversPseudo = true;
    }});
    eq(coversPseudo, false,
      '...and still does not cover ::before, which is why the local declaration above is required');
  }

  eq(conn.width.replace(/\s/g, ''), 'calc(100%-var(--turn-r))',
    'each turn spans to the far edge, so its top and bottom borders carry the straight runs too');

  // these two must move together or the path steps at every turn
  eq(conn.top, `-${bw}px`, 'turn pulled up by exactly one border width');
  eq(conn.height.replace(/\s/g, ''), `calc(100%+${bw}px)`,
    'and given that width back, so top and bottom borders land on the rules above and below');

  // three-sided, with the two outer corners rounded - that is what makes
  // run -> arc -> vertical -> arc -> run a single continuous stroke
  eq(right['border-left'], '0', 'right-hand turn is open on the left');
  eq(left['border-right'], '0', 'left-hand turn is open on the right');
  eq(right['border-radius'].replace(/\s/g, ''), '0var(--turn-r)var(--turn-r)0',
    'right-hand turn rounds its two right corners');
  eq(left['border-radius'].replace(/\s/g, ''), 'var(--turn-r)00var(--turn-r)',
    'left-hand turn rounds its two left corners');

  eq(row['min-height'].replace(/\s/g, ''), 'calc(var(--turn-r)*2)',
    'row min-height still guarantees both corner radii fit, so the arcs are not silently scaled down');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
