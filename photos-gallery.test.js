/* ------------------------------------------------------------------
   photos-gallery.test.js  —  run: node photos-gallery.test.js

   The gallery page is mostly data, but two things about it are logic and
   both break silently when photos are added or removed:

     1. the carousel reads its slides AND its dots from the DOM, so a slide
        added without a matching dot is simply unreachable by dot nav; and
     2. the filter buttons derive counts from data-cat, so a typo'd or
        missing category yields a filter that shows an empty grid.

   So this drives the real page in jsdom rather than reading the markup.
   Also checks every referenced file exists and every image has alt text.
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

// ---- carousel -----------------------------------------------------------
const slides = [...doc.querySelectorAll('.carousel-slide')];
const dots   = [...doc.querySelectorAll('.carousel-dot')];
ok('carousel has slides', slides.length > 0);
ok('one dot per slide', slides.length === dots.length, slides.length + ' slides / ' + dots.length + ' dots');
ok('exactly one dot starts active', dots.filter(d => d.classList.contains('active')).length === 1);
ok('every slide has a caption heading', slides.every(s => s.querySelector('h3')));

// Every dot must actually reach its slide. translateX percentage is the only
// observable the carousel exposes, so assert on that.
const track = doc.getElementById('carousel-track');
let dotNavOk = true, dotDetail = '';
dots.forEach((d, i) => {
  click(d);
  const want = 'translateX(-' + (i * 100) + '%)';
  if (track.style.transform !== want){ dotNavOk = false; dotDetail = 'dot ' + (i+1) + ' -> ' + track.style.transform; }
  if (!d.classList.contains('active')) { dotNavOk = false; dotDetail = 'dot ' + (i+1) + ' not marked active'; }
});
ok('every dot navigates to its own slide', dotNavOk, dotDetail);

// Arrows must wrap, not run off the end.
click(dots[0]);
click(doc.querySelector('.carousel-prev'));
ok('prev from first slide wraps to last',
   track.style.transform === 'translateX(-' + ((slides.length - 1) * 100) + '%)', track.style.transform);
click(doc.querySelector('.carousel-next'));
ok('next from last slide wraps to first', track.style.transform === 'translateX(-0%)', track.style.transform);

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

// ---- featured carousel is reachable in one screenful ---------------------
// The controls used to sit in a bar under a full-bleed 16/7 photo, which on
// a wide monitor put them below the fold: you scrolled down to click and
// back up to look. Both halves of the fix are asserted here because either
// one alone leaves the page usable-but-annoying.
const csstree = require('css-tree');
const cssText = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
const ast = csstree.parse(cssText);
// media defaults to null = base rules only. Merging a media-query override
// into the base lookup silently reads the phone layout while claiming to
// describe the desktop one, which is exactly the bug this caught once.
const decls = (selector, media) => {
  const out = {};
  csstree.walk(ast, {
    visit: 'Rule',
    enter(node){
      const inside = this.atrule ? csstree.generate(this.atrule.prelude || {}) : null;
      if (media == null ? inside !== null : inside !== media) return;
      const sel = csstree.generate(node.prelude);
      if (sel.split(',').map(x => x.trim()).includes(selector)){
        node.block.children.forEach(d => {
          if (d.type === 'Declaration') out[d.property] = csstree.generate(d.value).trim();
        });
      }
    }
  });
  return out;
};

const controlsEl = doc.querySelector('.carousel-controls');
ok('controls markup sits inside .carousel, not after it',
   !!controlsEl && !!controlsEl.closest('.carousel'));
ok('controls are still inside the section that styles them',
   !!controlsEl && !!controlsEl.closest('.gallery-carousel-section'));

const ctrl = decls('.gallery-carousel-section .carousel-controls');
ok('controls overlay is absolutely positioned', ctrl.position === 'absolute', ctrl.position);
ok('controls overlay covers the whole photo', ctrl.inset === '0', ctrl.inset);
ok('controls overlay does not swallow pointer events', ctrl['pointer-events'] === 'none');

const btn = decls('.gallery-carousel-section .carousel-btn');
ok('arrows are absolutely positioned over the photo', btn.position === 'absolute');
ok('arrows are vertically centred', btn.top === '50%' && /translateY\(-50%\)/.test(btn.transform || ''));
ok('arrows take pointer events back', btn['pointer-events'] === 'auto');
const dotsCss = decls('.gallery-carousel-section .carousel-dots');
ok('dots are absolutely positioned over the photo', dotsCss.position === 'absolute');
ok('dots take pointer events back', dotsCss['pointer-events'] === 'auto');

const slide = decls('.gallery-carousel-section .carousel-slide');
ok('slide height is capped against the viewport',
   /max-height/.test(Object.keys(slide).join(',')) && /100vh/.test(slide['max-height'] || ''),
   slide['max-height']);
ok('slide cap subtracts the sticky header rather than guessing',
   /var\(--header-h\)/.test(slide['max-height'] || ''), slide['max-height']);
ok('--header-h is actually defined', /--header-h\s*:/.test(cssText));

// The caption is bottom-left and the dots are bottom-right. Reserve enough
// caption padding for the dot row, derived from the real dot count so that
// adding slides fails here instead of silently overlapping the text.
const px = v => parseFloat(String(v).replace('px', ''));
const dotBase = decls('.carousel-dot');
const dotW = px(dotBase.width), gap = px(decls('.carousel-dots').gap);
const n = dots.length;
const needed = px(dotsCss.right) + n * dotW + (n - 1) * gap;
const reserved = px(decls('.gallery-carousel-section .carousel-caption')['padding-right']);
ok(n + ' dots need ' + needed + 'px and the caption reserves ' + reserved + 'px',
   reserved >= needed);

// Narrow viewports have no room for caption text and a dot row side by
// side, so the dots move to bottom-centre and the caption clears them.
const MQ = '(max-width:760px)';
const mDots = decls('.gallery-carousel-section .carousel-dots', MQ);
const mCap  = decls('.gallery-carousel-section .carousel-caption', MQ);
ok('narrow: dots centre instead of hugging the right edge',
   mDots['justify-content'] === 'center' && mDots.left === '0' && mDots.right === '0');
ok('narrow: caption drops its right reservation', mCap['padding-right'] === '20px');
ok('narrow: caption leaves vertical room for the centred dots',
   px(mCap['padding-bottom']) >= px(mDots.bottom) + dotW * 1.4,
   mCap['padding-bottom'] + ' vs ' + mDots.bottom);
const mBtn = decls('.gallery-carousel-section .carousel-btn', MQ);
ok('narrow: arrows shrink and pull in from the edges',
   px(mBtn.width) < px(decls('.carousel-btn').width) &&
   px(decls('.gallery-carousel-section .carousel-prev', MQ).left) <
   px(decls('.gallery-carousel-section .carousel-prev').left));

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
