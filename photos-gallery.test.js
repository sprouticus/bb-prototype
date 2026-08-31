/* ------------------------------------------------------------------
   photos-gallery.test.js  —  run: node photos-gallery.test.js

   The gallery page is mostly data, but the filter buttons are logic and
   break silently when photos are added or removed: they derive counts
   from data-cat, so a typo'd or missing category yields a filter that
   shows an empty grid.

   So this drives the real page in jsdom rather than reading the markup.
   Also checks every referenced file exists and every image has alt text.

   The featured carousel this file used to also cover was removed from
   photos.html 2026-08-30 (the page is grid-only now); those assertions
   went with it rather than being left to test a DOM that no longer
   exists. carousels.test.js, which only ever exercised this same
   carousel, was deleted the same day — see git history for both if a
   carousel-testing approach is needed again elsewhere.
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond ? pass++ : (fail++, console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')));

const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'photos.html'), 'utf8'),
                      { runScripts: 'dangerously', url: 'https://example.test/photos.html' });
const { window } = dom;
const doc = window.document;
const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

// ---- filters ------------------------------------------------------------
const items = [...doc.querySelectorAll('.gallery-item[data-cat]')];
const cats = [...new Set(items.map(i => i.dataset.cat))];
const btns = [...doc.querySelectorAll('.gallery-filter-btn')];
const btnFilters = btns.map(b => b.dataset.filter);
ok('every category has a filter button', cats.every(c => btnFilters.includes(c)),
   'orphan categories: ' + cats.filter(c => !btnFilters.includes(c)).join(', '));
ok('every filter button matches a real category',
   btnFilters.filter(f => f !== 'all').every(f => cats.includes(f)),
   'empty filters: ' + btnFilters.filter(f => f !== 'all' && !cats.includes(f)).join(', '));

// Filtering hides tiles with the .is-hidden class, not the hidden attribute
// or inline display, so the grid keeps its own display rules. Asserting on
// the wrong mechanism here would pass against a filter that does nothing.
const visible = () => items.filter(i => !i.classList.contains('is-hidden')).length;
for (const b of btns){
  click(b);
  const f = b.dataset.filter;
  const expect = f === 'all' ? items.length : items.filter(i => i.dataset.cat === f).length;
  ok('filter "' + f + '" shows ' + expect + ' item(s)', visible() === expect, 'saw ' + visible());
  ok('filter "' + f + '" is not empty', expect > 0);
  ok('filter "' + f + '" sets aria-pressed', b.getAttribute('aria-pressed') === 'true');
  ok('filter "' + f + '" leaves exactly one button pressed',
     btns.filter(x => x.getAttribute('aria-pressed') === 'true').length === 1);
  ok('filter "' + f + '" count readout says ' + expect,
     doc.querySelector('.gallery-filter-count').textContent ===
       expect + (expect === 1 ? ' photo' : ' photos'),
     doc.querySelector('.gallery-filter-count').textContent);
}
click(btns[0]);
ok('empty-state message stays hidden while every filter has photos',
   doc.querySelector('.gallery-empty').hidden);

// ---- asset + a11y integrity --------------------------------------------
for (const it of items){
  const b = it.querySelector('.gallery-item-inner');
  const img = it.querySelector('img');
  const label = it.querySelector('.gallery-item-label');
  const full = b.getAttribute('data-full');
  const id = full.replace('images/', '');
  ok(id + ': data-full matches thumbnail src', full === img.getAttribute('src'));
  ok(id + ': file exists', fs.existsSync(path.join(__dirname, full)));
  ok(id + ': has alt text', !!(img.getAttribute('alt') || '').trim());
  ok(id + ': lightbox caption matches visible label', b.getAttribute('data-caption') === label.textContent);
  ok(id + ': aria-label is announceable', /^View larger photo: /.test(b.getAttribute('aria-label')));
}
const srcs = items.map(i => i.querySelector('img').getAttribute('src'));
ok('no duplicate photos in the grid', new Set(srcs).size === srcs.length,
   srcs.filter((s, i) => srcs.indexOf(s) !== i).join(', '));

// Photos retired from this gallery. They must not creep back in.
const raw = fs.readFileSync(path.join(__dirname, 'photos.html'), 'utf8');
for (const gone of ['enabler-side-indoor.jpg', 'enabler-warehouse-wide.jpg', 'enabler-warehouse-bright.jpg',
                    'catch-release-hooked.jpg']){
  ok('retired photo stays out: ' + gone, !raw.includes(gone));
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
