/* ------------------------------------------------------------------
   catch-release-diagram.test.js  —  run: node catch-release-diagram.test.js

   The labelled catch-and-release illustration must never be cropped.
   Two things can silently break that, and neither looks broken in the
   markup:

     1. the shared `.story-img img` rule is width:100%/height:100%/cover,
        and this image's rightmost label runs flush to the edge, so any
        crop cuts "SPRING-LOADED HOOK" in half;
     2. the override that defeats it has IDENTICAL specificity (0,1,1),
        so it only wins on source order — move it up and the crop is back.

   So this asserts the markup and the cascade order.
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const csstree = require('css-tree');

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? pass++ : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

const dir = __dirname;
const cssText = fs.readFileSync(path.join(dir, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(dir, 'catch-and-release.html'), 'utf8');
const doc = new JSDOM(html).window.document;

const DIAGRAM = 'images/catch-release-illustration-crop.jpg';
ok('diagram file exists', fs.existsSync(path.join(dir, DIAGRAM)));

// --- markup -------------------------------------------------------------
const fig = doc.querySelector('.story-img--diagram');
ok('diagram figure exists', !!fig);
ok('diagram uses the labelled illustration',
   fig && fig.querySelector('img').getAttribute('src') === DIAGRAM);
ok('diagram img has alt text naming the labels',
   /camera/i.test(fig.querySelector('img').alt) &&
   /hook/i.test(fig.querySelector('img').alt) &&
   /V-shape/i.test(fig.querySelector('img').alt));
ok('the un-annotated version is gone from this page',
   !html.includes('catch-release-full-detail.jpg'));
ok('no orphaned .story-stack left behind', !doc.querySelector('.story-stack'));

// --- cascade order (the trap) -------------------------------------------
const ruleIndex = (selector) => {
  let found = -1;
  const ast = csstree.parse(cssText, { positions: true });
  csstree.walk(ast, { visit: 'Rule', enter(node){
    if (this.atrule) return;                       // base rules only
    const sels = csstree.generate(node.prelude).split(',').map(x => x.trim());
    if (sels.includes(selector) && found === -1) found = node.loc.start.offset;
  }});
  return found;
};
const shared = ruleIndex('.story-img img');
const override = ruleIndex('.story-img--diagram img');
ok('shared .story-img img rule found', shared > -1);
ok('diagram override found', override > -1);
ok('override is declared AFTER the shared rule (identical specificity, so ' +
   'source order is the only thing making it win)', override > shared,
   'shared@' + shared + ' override@' + override);

const decls = (sel) => {
  const out = {};
  csstree.walk(csstree.parse(cssText), { visit: 'Rule', enter(node){
    if (this.atrule) return;
    if (csstree.generate(node.prelude).split(',').map(x => x.trim()).includes(sel))
      node.block.children.forEach(d => { if (d.type === 'Declaration')
        out[d.property] = csstree.generate(d.value).trim(); });
  }});
  return out;
};
const dImg = decls('.story-img--diagram img');
ok('override releases the forced height so the image keeps its own aspect',
   dImg.height === 'auto', dImg.height);
ok('override stops cropping', dImg['object-fit'] === 'contain', dImg['object-fit']);

// Nothing later may re-crop it inside a media query either.
let reCrop = null;
csstree.walk(csstree.parse(cssText), { visit: 'Rule', enter(node){
  const sels = csstree.generate(node.prelude).split(',').map(x => x.trim());
  if (!sels.some(s => s === '.story-img img' || s === '.story-img--diagram img')) return;
  if (!this.atrule) return;
  node.block.children.forEach(d => {
    if (d.type === 'Declaration' && ['height', 'object-fit'].includes(d.property))
      reCrop = csstree.generate(this.atrule.prelude) + ' { ' + d.property + ' }';
  });
}});
ok('no media query re-crops the diagram', reCrop === null, reCrop);

// --- lightbox: the diagram opens enlarged on click or tap --------------
ok('page loads lightbox.js', !!doc.querySelector('script[src="lightbox.js"]'));
{
  const live = new JSDOM(html, { runScripts: 'outside-only' });
  live.window.eval(fs.readFileSync(path.join(dir, 'lightbox.js'), 'utf8'));
  const ld = live.window.document;
  const img = ld.querySelector('.story-img--diagram img');
  const trigger = img && img.closest('button.photo-zoom, [data-full]');
  ok('diagram image is wrapped in a lightbox trigger', !!trigger);
  ok('lightbox trigger has an accessible label', !!trigger && /^View larger photo/.test(trigger.getAttribute('aria-label') || ''),
     trigger && trigger.getAttribute('aria-label'));
  if (trigger) trigger.click();
  const box = ld.getElementById('lightbox');
  ok('clicking the diagram opens the lightbox', !!box && !box.hidden);
  ok('lightbox shows the diagram', !!box && ld.getElementById('lightbox-img').getAttribute('src') === DIAGRAM,
     box && ld.getElementById('lightbox-img').getAttribute('src'));
  ok('lightbox carries the diagram alt text', !!box && ld.getElementById('lightbox-img').alt === img.alt);
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
