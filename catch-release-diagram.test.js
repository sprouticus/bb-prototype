/* ------------------------------------------------------------------
   catch-release-diagram.test.js  —  run: node catch-release-diagram.test.js

   The annotated catch-and-release frame has to be readable in place, with
   no lightbox click. Three separate things can silently break that, and
   none of them look broken in the markup:

     1. the shared `.story-img img` rule is width:100%/height:100%/cover,
        and this image's rightmost label runs flush to the edge, so any
        crop cuts "SPRING-LOADED HOOK" in half;
     2. the override that defeats it has IDENTICAL specificity (0,1,1),
        so it only wins on source order — move it up and the crop is back;
     3. the display cap has to keep the annotation text above body size
        while still fitting one screenful under the sticky header.

   So this asserts the cascade order and does the sizing arithmetic against
   the real image dimensions and the real CSS values, rather than trusting
   that 940px "looks about right".
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

// --- intrinsic size, read from the JPEG itself --------------------------
function jpegSize(file){
  const b = fs.readFileSync(file);
  let i = 2;
  while (i < b.length){
    if (b[i] !== 0xFF) { i++; continue; }
    const marker = b[i + 1];
    if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)){
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error('no SOF marker in ' + file);
}

const DIAGRAM = 'images/catch-release-annotated.jpg';
ok('annotated diagram file exists', fs.existsSync(path.join(dir, DIAGRAM)));
const nat = jpegSize(path.join(dir, DIAGRAM));

// --- markup -------------------------------------------------------------
const fig = doc.querySelector('.story-img--diagram');
ok('diagram figure exists', !!fig);
ok('diagram uses the annotated file',
   fig && fig.querySelector('img').getAttribute('src') === DIAGRAM);
ok('diagram is NOT inside a .story-grid cell', fig && !fig.closest('.story-grid'));
ok('diagram img has alt text naming the labels',
   /camera/i.test(fig.querySelector('img').alt) &&
   /hook/i.test(fig.querySelector('img').alt) &&
   /V-shape/i.test(fig.querySelector('img').alt));
ok('the un-annotated version is gone from this page',
   !html.includes('catch-release-full-detail.jpg'));
const evenGrid = doc.querySelector('.story-grid--even');
ok('remaining two photos sit in an even two-up', !!evenGrid &&
   evenGrid.querySelectorAll('.story-img').length === 2);
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

// --- sizing arithmetic --------------------------------------------------
const px = v => parseFloat(String(v).replace('px', ''));
const cap = px(decls('.story-img--diagram')['max-width']);
const maxw = px((cssText.match(/--maxw:\s*([0-9.]+px)/) || [])[1]);
const wrapPad = px((decls('.wrap').padding || '0 28px').split(/\s+/)[1]);
const headerH = px((cssText.match(/--header-h:\s*([0-9.]+px)/) || [])[1]);
const contentW = maxw - wrapPad * 2;

ok('cap never upscales the source (' + cap + ' <= ' + nat.w + ')', cap <= nat.w);
ok('cap fits the content column (' + cap + ' <= ' + contentW + ')', cap <= contentW);

const shownH = Math.round(cap * nat.h / nat.w);
ok('diagram fits one 900px screenful under the sticky header (' +
   shownH + ' + ' + headerH + ' <= 900)', shownH + headerH <= 900,
   shownH + headerH + 'px');

// The annotation cap-height measures 32px in the 1195px-wide source, so
// display width sets the label text size directly. The target is ~1.2x the
// 16px body copy; 18px is the floor below which "readable without clicking"
// stops being true. Shrinking the cap for layout reasons fails here first.
const LABEL_CAP_PX_AT_SOURCE = 32;
const SOURCE_W_WHEN_MEASURED = 1195;
const shownLabel = LABEL_CAP_PX_AT_SOURCE / SOURCE_W_WHEN_MEASURED * cap;
ok('annotation text renders at >= 18px cap height (' + shownLabel.toFixed(1) + 'px)',
   shownLabel >= 18, shownLabel.toFixed(1) + 'px');
// Upper bound as well as lower. Two-thirds of the content column is the
// line between "a figure on the page" and "the page"; the rejected 940px
// first pass was 81% and read as the latter.
ok('diagram stays within two-thirds of the content column',
   cap <= contentW * (2 / 3), cap + ' of ' + contentW +
   ' (' + Math.round(100 * cap / contentW) + '%)');

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
