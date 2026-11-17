/* ------------------------------------------------------------------
   pre-order-review.test.js  —  run: node pre-order-review.test.js

   Executes pre-order.html in jsdom and drives the real form flow to the
   Review step, because the pricing rules there are now behavioural, not
   textual: add-on prices are summed into the total, and the total has to
   flip to "TBD" the moment a TBD item is selected. Reading the markup cannot prove
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
const PRICES = {
  "Traditional Driver's Seat": ['750.00', '$750.00'], 'Folding Jump Seat': ['152.00', '$152.00'],
  '2-In-1 Split Flip Windshield': ['260.00', '$260.00'], 'West Coast Mirrors': ['260.00', '$260.00'],
  '45" Front Cargo Basket': ['165.00', '$165.00'], 'Bumper-Mounted Tow Hitch Receiver': ['70.00', '$70.00'],
  'Superwinch LT2000 12-Volt Winch': ['131.99', '$131.99'], '48" High Lift Farm Jack': ['80.00', '$80.00'],
  '32" LED Light Bar': ['63.00', '$63.00'], 'LED Flood Light Pods (Set of 4)': ['30.00', '$30.00'],
  'Kunz AcrEase Rough Cut Mower MR55BE': ['5195', '$5,195'], 'Demco Pro Series 40 Gallon Sprayer': ['2162', '$2,162'],
  'Demco Pro Series 60 Gallon Sprayer': ['2262', '$2,262'], 'Demco Pro Series 80 Gallon Sprayer': ['TBD', 'Contact for Price'],
  'B.B. Utility Trailer': ['5600', '$5,600'], 'Rammy Brush Cutter 120 ATV PRO': ['5599', '$5,599'],
  'Rammy Flail Mower 120 ATV': ['4399', '$4,399'], 'Rammy Lawn Mower 120 ATV PRO': ['TBD', 'Contact for Price'],
  'Rammy Plow W165 ATV PRO': ['6600', '$6,600'], 'Rammy Snowblower 155 UTV PRO': ['6399', '$6,399']
};
const TBD_NAMES = Object.keys(PRICES).filter(n => PRICES[n][0] === 'TBD');

const cards = [...doc.querySelectorAll('.pick-input')].map(i => {
  const label = i.closest('label') || i.parentNode;
  return { input: i, name: label.querySelector('.pick-card-name').textContent.trim(),
           shown: label.querySelector('.pick-card-price').textContent.trim() };
});
ok('every pick card has a known price entry', cards.length > 0 && cards.every(c => PRICES[c.name]),
   cards.filter(c => !PRICES[c.name]).map(c => c.name).join(', '));
for (const c of cards.filter(c => PRICES[c.name])){
  const [num, label] = PRICES[c.name];
  ok(c.name + ': card price reads ' + label, c.shown === label, c.shown);
  ok(c.name + ': data-price is ' + num, c.input.getAttribute('data-price') === num, c.input.getAttribute('data-price'));
  ok(c.name + ': data-price-label is ' + label, c.input.getAttribute('data-price-label') === label,
     c.input.getAttribute('data-price-label'));
}
ok('exactly two items show Contact for Price', cards.filter(c => c.shown === 'Contact for Price').length === 2);

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

// Case 2: one priced accessory -> total is base plus that price.
const byName = n => cards.find(c => c.name === n).input;
const acc = byName("Traditional Driver's Seat");
acc.checked = true;
gotoReview();
totalEl = doc.querySelector('.review-total-value');
lines = doc.getElementById('review-total-lines');
ok('1 add-on: total reads $34,750', totalEl && totalEl.textContent.trim() === '$34,750', totalEl && totalEl.textContent);
ok('1 add-on: singular "1 add-on selected"',
   lines && /1 add-on selected/.test(lines.textContent), lines && lines.textContent);
ok('1 add-on: add-on line reads $750',
   lines && /\$750/.test(lines.textContent), lines && lines.textContent);
ok('1 add-on: selected accessory echoes $750.00',
   /\$750\.00/.test(doc.getElementById('review-accessories').textContent));

// Case 3: accessory + implement -> plural label, summed, cents kept.
const imp = byName('Superwinch LT2000 12-Volt Winch');
imp.checked = true;
gotoReview();
totalEl = doc.querySelector('.review-total-value');
lines = doc.getElementById('review-total-lines');
ok('2 add-ons: total reads $34,881.99', totalEl && totalEl.textContent.trim() === '$34,881.99', totalEl && totalEl.textContent);
ok('2 add-ons: plural "2 add-ons selected"',
   lines && /2 add-ons selected/.test(lines.textContent), lines && lines.textContent);

// Case 3b: a TBD item makes the total TBD and the add-on line shows the priced part.
const tbd = byName('Rammy Lawn Mower 120 ATV PRO');
tbd.checked = true;
gotoReview();
totalEl = doc.querySelector('.review-total-value');
lines = doc.getElementById('review-total-lines');
ok('priced + TBD add-on: total reads TBD', totalEl && totalEl.textContent.trim() === 'TBD', totalEl && totalEl.textContent);
ok('priced + TBD add-on: line reads $881.99 + TBD', lines && /\$881\.99 \+ TBD/.test(lines.textContent),
   lines && lines.textContent);
tbd.checked = false;
gotoReview();
const tbdOnly = byName('Demco Pro Series 80 Gallon Sprayer');
acc.checked = false; imp.checked = false; tbdOnly.checked = true;
gotoReview();
ok('TBD-only add-on: line reads Price TBD',
   /Price TBD/.test(doc.getElementById('review-total-lines').textContent));
ok('TBD-only add-on: total reads TBD', doc.querySelector('.review-total-value').textContent.trim() === 'TBD');
tbdOnly.checked = false;
acc.checked = true; imp.checked = true;

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

// --- catalog pages: prices match the table -------------------------------
for (const f of ['implements.html', 'accessories.html']){
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const d = new JSDOM(src).window.document;
  const prodCards = [...d.querySelectorAll('.product-card')];
  ok(f + ': has product cards', prodCards.length > 0);
  for (const c of prodCards){
    const name = c.querySelector('h3').textContent.trim();
    const entry = PRICES[name];
    if (!entry){ ok(f + ': ' + name + ' has a known price entry', name === 'Catch-and-Release Hitch System'); continue; }
    ok(f + ': ' + name + ' reads ' + entry[1], c.querySelector('.product-price').textContent.trim() === entry[1],
       c.querySelector('.product-price').textContent);
    ok(f + ': ' + name + ' lightbox data-price reads ' + entry[1],
       c.querySelector('[data-price]').getAttribute('data-price') === entry[1]);
  }
  ok(f + ': no data-price-link left behind', d.querySelectorAll('[data-price-link]').length === 0);
  ok(f + ': no "Contact us" price label survives', !/>Contact us</.test(src));
}
{
  const d = new JSDOM(fs.readFileSync(path.join(dir, 'accessories.html'), 'utf8')).window.document;
  const hitch = [...d.querySelectorAll('.product-card')].find(c => c.querySelector('h3').textContent.trim() === 'Catch-and-Release Hitch System');
  ok('accessories.html: Catch-and-Release Hitch System reads $430.00', hitch.querySelector('.product-price').textContent.trim() === '$430.00');
  ok('accessories.html: Catch-and-Release Hitch System lightbox data-price reads $430.00', hitch.querySelector('[data-price]').getAttribute('data-price') === '$430.00');
}

// --- sitewide: "The Enabler" only ever opens a string --------------------
for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.html'))){
  const s = fs.readFileSync(path.join(dir, f), 'utf8')
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, m => m.replace(/[^\n]/g, ''));
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
