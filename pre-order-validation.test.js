/* ------------------------------------------------------------------
   pre-order-validation.test.js  —  run: node pre-order-validation.test.js

   Drives step 1 of the pre-order form in jsdom, and the agreement
   checkbox on the Review step (section 8). The bug this covers was
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
const city  = doc.getElementById('p-city');
const state = doc.getElementById('p-state');
const req   = [name, email, city, state];

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
ok('the other failures stay flagged', marked(email) && marked(city) && marked(state));

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
fill(city, 'Albuquerque');
fill(state, 'New Mexico');
next.click();
ok('a complete step 1 advances to step 2', step2.hidden === false);
ok('no field is left flagged once the step passes', req.every(el => !marked(el)));

// --- 7. the conditional org block must not gate the step ------------------
const org = doc.getElementById('org-fields');
ok('the hidden organization block holds no required controls that would',
   org.hidden === true && !!org, 'org-fields is visible at rest');
ok('org fields are not required, so hiding them cannot strand the user',
   org.querySelectorAll('[required]').length === 0);

// --- 8. the Review step's agreement checkbox gates Submit ---------------
const step3  = doc.getElementById('flow-step-3');
const step4  = doc.getElementById('flow-step-4');
const nextOf = st => [...doc.querySelectorAll('[data-flow-next]')].find(b => b.closest('.flow-step') === st);
nextOf(step2).click();
nextOf(step3).click();
ok('steps 2 and 3 are optional and reach Review', step4.hidden === false);

const terms   = doc.getElementById('p-terms');
const success = doc.getElementById('pre-order-success');
const submit  = step4.querySelector('button[type="submit"]');
const links   = [...fieldOf(terms).querySelectorAll('a')];
ok('agreement checkbox is on the Review step and required',
   !!terms && terms.closest('.flow-step') === step4 && terms.required);
ok('agreement label is marked required', !!fieldOf(terms).querySelector('.req'));
ok('agreement links to the Privacy Policy',
   links.some(a => a.getAttribute('href') === 'privacy-policy.html'));
ok('agreement links to the Terms and Conditions',
   links.some(a => a.getAttribute('href') === 'terms-and-conditions.html'));
ok('agreement links open in a new tab so the form is not lost',
   links.length === 2 && links.every(a => a.target === '_blank' && /noopener/.test(a.rel)));
const flagged = el => fieldOf(el).classList.contains('is-invalid') && el.getAttribute('aria-invalid') === 'true';
ok('agreement starts unchecked and unflagged', !terms.checked && !flagged(terms));
ok('agreement has no error message, by design', !errOf(terms) && !terms.hasAttribute('data-error-missing'));

submit.click();
ok('Submit without agreeing does not submit', !success.classList.contains('show'));
ok('Submit without agreeing stays on Review', step4.hidden === false);
ok('the agreement checkbox is flagged', flagged(terms));
ok('focus lands on the agreement checkbox', doc.activeElement === terms);

terms.checked = true;
terms.dispatchEvent(new window.Event('change', { bubbles: true }));
ok('checking the box clears its error', !flagged(terms));

submit.click();
ok('Submit after agreeing goes through', success.classList.contains('show'));
ok('the agreement is sent with the form',
   new window.FormData(doc.getElementById('preorder-flow-form')).get('terms-agreed') === 'yes');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
