/* ------------------------------------------------------------------
   pre-order-validation.test.js  —  run: node pre-order-validation.test.js

   Drives step 1 of the pre-order form in jsdom. The bug this covers was
   invisible in the markup: the Next handler called reportValidity() on a
   <section>, which has no such method, so the guard fell through and the
   button did nothing a user could perceive. The form carries novalidate,
   so no native bubble was coming either. Nothing about reading the HTML
   showed that — only pressing the button does.

   Asserts the four things a user experiences: Next is blocked, every bad
   field is marked at once (not just the first), the message names what is
   wrong, and the marking clears when the field is fixed.
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
function ok(name, cond, extra){
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  -> ' + extra : '')); }
}

const html = fs.readFileSync(path.join(__dirname, 'pre-order.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.test/pre-order.html' });
const { window } = dom;
const doc = window.document;
window.Element.prototype.scrollIntoView = function(){};   // jsdom has no layout

const step1 = doc.getElementById('flow-step-1');
const step2 = doc.getElementById('flow-step-2');
const next  = [...doc.querySelectorAll('[data-flow-next]')].find(b => b.closest('.flow-step') === step1);
const name  = doc.getElementById('p-name');
const email = doc.getElementById('p-email');
const loc   = doc.getElementById('p-location');
const req   = [name, email, loc];

const fieldOf = el => el.closest('.field');
const errOf   = el => doc.getElementById(el.id + '-error');
const marked  = el => fieldOf(el).classList.contains('is-invalid') && !errOf(el).hidden;

function fill(el, v){
  el.value = v;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}

// --- 1. static markup: the user can tell required from optional -----------
ok('step 1 carries a required-fields legend', !!doc.querySelector('.field-req-legend'));
req.forEach(el => {
  const label = fieldOf(el).querySelector('label');
  ok(label.textContent.trim() + ' label is marked required', !!label.querySelector('.req'));
  ok(el.id + ' has an error slot', !!errOf(el));
  ok(el.id + ' points at its error slot', el.getAttribute('aria-describedby') === el.id + '-error');
  ok(el.id + ' carries its own missing-value copy', !!el.getAttribute('data-error-missing'));
});
ok('no required control is left without an asterisk',
   [...step1.querySelectorAll('[required]')].every(el => fieldOf(el).querySelector('.req')));

// --- 2. nothing is marked before the user tries anything -----------------
ok('form does not open already painted red',
   req.every(el => !fieldOf(el).classList.contains('is-invalid')),
   'a required field was flagged on load');
ok('error slots start hidden', req.every(el => errOf(el).hidden));

// --- 3. Next on an empty step is blocked and marks EVERY bad field --------
next.click();
ok('Next does not advance past an empty step 1', step2.hidden === true);
req.forEach(el => ok(el.id + ' is flagged after a failed Next', marked(el)));
ok('every failure is shown at once, not one at a time',
   req.filter(marked).length === req.length);
ok('the flagged field is announced as invalid',
   req.every(el => el.getAttribute('aria-invalid') === 'true'));
ok('name error names the field, not "this field"',
   /full name/i.test(errOf(name).textContent), errOf(name).textContent);
ok('focus lands on the first failure', doc.activeElement === name);

// --- 4. fixing a field clears only that field ----------------------------
fill(name, 'Dana Reyes');
ok('fixing a field clears its outline', !fieldOf(name).classList.contains('is-invalid'));
ok('fixing a field hides its message', errOf(name).hidden);
ok('fixing a field drops aria-invalid', !name.hasAttribute('aria-invalid'));
ok('the other failures stay flagged', marked(email) && marked(loc));

// --- 5. a malformed email is a different message than a missing one -------
fill(email, 'dana at example dot com');
next.click();
ok('a malformed email still blocks Next', step2.hidden === true);
ok('malformed email gets the format message, not the missing message',
   /@|typo/i.test(errOf(email).textContent) &&
   errOf(email).textContent !== email.getAttribute('data-error-missing'),
   errOf(email).textContent);

// --- 6. a complete step 1 advances ---------------------------------------
fill(email, 'dana@example.com');
fill(loc, 'Albuquerque, NM');
next.click();
ok('a complete step 1 advances to step 2', step2.hidden === false);
ok('no field is left flagged once the step passes', req.every(el => !marked(el)));

// --- 7. the conditional org block must not gate the step ------------------
const org = doc.getElementById('org-fields');
ok('the hidden organization block holds no required controls that would',
   org.hidden === true && !!org, 'org-fields is visible at rest');
ok('org fields are not required, so hiding them cannot strand the user',
   org.querySelectorAll('[required]').length === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
