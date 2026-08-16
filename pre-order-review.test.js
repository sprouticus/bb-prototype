/* ------------------------------------------------------------------
   pre-order-review.test.js  —  run: node pre-order-review.test.js

   Executes pre-order.html in jsdom and drives the real form flow to the
   Review step, because the pricing rules there are now behavioural, not
   textual: every add-on reads "Price TBD" and the total has to flip to
   "TBD" the moment anything is selected. Reading the markup cannot prove
   that; the arithmetic used to live in renderList and was removed.

   Also sweeps the two catalog pages for any surviving dollar figure on a
   product card, which is the failure mode that would put a stale price in
   front of a supplier during the review round.
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
function ok(name, cond, extra){
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'pre-order.html'), 'utf8');

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.test/pre-order.html' });
const { window } = dom;
const doc = window.document;

// jsdom implements no layout, so scrollIntoView is missing and the page's
// goToStep() throws on it before buildReview() ever runs. Stubbing it is
// the difference between exercising the review logic and silently asserting
// against the static markup that shipped in the file.
window.Element.prototype.scrollIntoView = function(){};

// --- static markup expectations -----------------------------------------
const cardPrices = [...doc.querySelectorAll('.pick-card-price')].map(e => e.textContent.trim());
ok('every pick-card price reads "Price TBD"',
   cardPrices.length > 0 && cardPrices.every(t => t === 'Price TBD'),
   [...new Set(cardPrices)].join(' | '));

const picks = [...doc.querySelectorAll('.pick-input')];
ok('every pick-input carries data-price="TBD"',
   picks.length > 0 && picks.every(i => i.getAttribute('data-price') === 'TBD'),
   picks.filter(i => i.getAttribute('data-price') !== 'TBD').map(i => i.value).join(', '));
ok('every pick-input carries data-price-label="Price TBD"',
   picks.every(i => i.getAttribute('data-price-label') === 'Price TBD'));

ok('review total block exists', !!doc.getElementById('review-total-lines'));
ok('review total value element exists', !!doc.querySelector('.review-total-value'));
ok('old reference-subtotal wording is gone', !html.includes('Reference subtotal'));

// --- drive the flow to Review -------------------------------------------
function fill(id, val){ const el = doc.getElementById(id); if (el) el.value = val; }
function click(el){ el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); }

const radio = doc.querySelector('input[name="pre-order-for"][value="myself"]')
           || doc.querySelector('input[name="pre-order-for"]');
if (radio){ radio.checked = true; radio.dispatchEvent(new window.Event('change', { bubbles: true })); }
fill('p-name', 'Test Person');
fill('p-email', 'test@example.test');
fill('p-location', 'Albuquerque, NM');
fill('p-use', 'Ranch work');

function gotoReview(){
  const btn = [...doc.querySelectorAll('[data-flow-next]')].find(b => b.getAttribute('data-flow-next') === '4');
  ok('step-4 next button found', !!btn);
  if (btn) click(btn);
}

// Case 1: no add-ons selected -> total is the base vehicle, firm.
gotoReview();
let totalEl = doc.querySelector('.review-total-value');
let lines = doc.getElementById('review-total-lines');
ok('no add-ons: total reads $34,000', totalEl && totalEl.textContent.trim() === '$34,000',
   totalEl && totalEl.textContent);
ok('no add-ons: base vehicle line rendered',
   lines && /Base vehicle, first 50 pre-orders/.test(lines.textContent));
ok('no add-ons: no "add-on selected" line',
   lines && !/add-on/.test(lines.textContent));
ok('no add-ons: accessories list says None selected',
   /None selected/.test(doc.getElementById('review-accessories').textContent));

// Case 2: one accessory -> total must flip to TBD, never a dollar figure.
const acc = doc.querySelector('input[name="accessories"]');
acc.checked = true;
gotoReview();
totalEl = doc.querySelector('.review-total-value');
lines = doc.getElementById('review-total-lines');
ok('1 add-on: total reads TBD', totalEl && totalEl.textContent.trim() === 'TBD',
   totalEl && totalEl.textContent);
ok('1 add-on: singular "1 add-on selected"',
   lines && /1 add-on selected/.test(lines.textContent), lines && lines.textContent);
ok('1 add-on: selected accessory echoes "Price TBD"',
   /Price TBD/.test(doc.getElementById('review-accessories').textContent));
ok('1 add-on: no dollar figure anywhere in the add-on lists',
   !/\$[0-9]/.test(doc.getElementById('review-accessories').textContent +
                  doc.getElementById('review-implements').textContent));

// Case 3: accessory + implement -> plural label, still TBD.
const imp = doc.querySelector('input[name="implements"]');
imp.checked = true;
gotoReview();
totalEl = doc.querySelector('.review-total-value');
lines = doc.getElementById('review-total-lines');
ok('2 add-ons: total still TBD', totalEl && totalEl.textContent.trim() === 'TBD');
ok('2 add-ons: plural "2 add-ons selected"',
   lines && /2 add-ons selected/.test(lines.textContent), lines && lines.textContent);

// Case 4: unchecking everything must restore the firm base price. This is
// the path that regressed in the old code, which injected subtotal markup
// and then had to hunt it down again on the next render.
acc.checked = false; imp.checked = false;
gotoReview();
totalEl = doc.querySelector('.review-total-value');
ok('after unchecking: total returns to $34,000',
   totalEl && totalEl.textContent.trim() === '$34,000', totalEl && totalEl.textContent);
ok('after unchecking: no stale add-on line',
   !/add-on/.test(doc.getElementById('review-total-lines').textContent));
ok('after unchecking: no duplicated total rows',
   doc.querySelectorAll('.review-total-value').length === 1,
   String(doc.querySelectorAll('.review-total-value').length));

// --- catalog pages: no surviving prices ---------------------------------
for (const f of ['implements.html', 'accessories.html']){
  const s = fs.readFileSync(path.join(dir, f), 'utf8');
  const d = new JSDOM(s).window.document;
  const cards = [...d.querySelectorAll('.product-price')].map(e => e.textContent.trim());
  ok(f + ': every product-price reads "Price TBD"',
     cards.length > 0 && cards.every(t => t === 'Price TBD'),
     [...new Set(cards)].join(' | '));
  const lb = [...d.querySelectorAll('[data-price]')].map(e => e.getAttribute('data-price'));
  ok(f + ': every lightbox data-price reads "Price TBD"',
     lb.length > 0 && lb.every(t => t === 'Price TBD'), [...new Set(lb)].join(' | '));
  ok(f + ': no data-price-link left behind',
     d.querySelectorAll('[data-price-link]').length === 0);
  ok(f + ': no "Contact us" price label survives', !/>Contact us</.test(s));
}

// --- sitewide: "The Enabler" only ever opens a string --------------------
for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.html'))){
  const s = fs.readFileSync(path.join(dir, f), 'utf8');
  s.split('\n').forEach((line, i) => {
    let m;
    const re = /The Enabler/g;
    while ((m = re.exec(line)) !== null){
      const before = line.slice(0, m.index).replace(/\s+$/, '');
      const opensString = before === '' || /(="|>|\|)$/.test(before);
      ok(f + ':' + (i + 1) + ' "The Enabler" opens a string or sentence',
         opensString, line.trim().slice(Math.max(0, m.index - 50), m.index + 20));
    }
  });
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
