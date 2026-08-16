/* ------------------------------------------------------------------
   carousels.test.js  —  run: node carousels.test.js

   Every carousel on the site reads its slides AND its dots out of the
   DOM at load. Nothing reconciles the two, so a slide added without a
   matching dot is simply unreachable by dot navigation, and a spare dot
   scrolls the track past the last slide to blank space. Neither looks
   wrong in the markup, and it has come up on three separate pages now
   (vehicle, photos, implements), so it gets one shared check rather
   than a fourth per-page copy.

   Also verifies the labelling that dot navigation depends on, and that
   no two slides in a carousel repeat the same photo.
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? pass++ : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

let carouselsSeen = 0;
for (const file of fs.readdirSync(__dirname).filter(n => n.endsWith('.html'))){
  const doc = new JSDOM(fs.readFileSync(path.join(__dirname, file), 'utf8')).window.document;
  const tracks = [...doc.querySelectorAll('.carousel-track')];
  if (!tracks.length) continue;

  // The scripts query dots globally per page, so more than one carousel on
  // a single page would cross-wire them. Worth knowing if that ever ships.
  ok(file + ': at most one carousel per page (the scripts query dots globally)',
     tracks.length === 1, tracks.length + ' carousels');

  for (const track of tracks){
    carouselsSeen++;
    const slides = [...track.querySelectorAll('.carousel-slide')];
    const dots = [...doc.querySelectorAll('.carousel-dot')];
    const tag = file + ' [' + slides.length + ' slides]';

    ok(tag + ': has slides', slides.length > 0);
    ok(tag + ': one dot per slide', slides.length === dots.length,
       slides.length + ' slides / ' + dots.length + ' dots');
    ok(tag + ': exactly one dot starts active',
       dots.filter(d => d.classList.contains('active')).length === 1);
    ok(tag + ': exactly one dot starts aria-selected',
       dots.filter(d => d.getAttribute('aria-selected') === 'true').length === 1);
    ok(tag + ': the active dot is the first one',
       dots[0] && dots[0].classList.contains('active'));
    ok(tag + ': dot labels number 1..n in order',
       dots.every((d, i) => d.getAttribute('aria-label') === 'Photo ' + (i + 1)),
       dots.map(d => d.getAttribute('aria-label')).join(' | '));
    ok(tag + ': has both arrows',
       !!doc.querySelector('.carousel-prev') && !!doc.querySelector('.carousel-next'));

    const srcs = slides.map(s => s.querySelector('img')?.getAttribute('src'));
    ok(tag + ': every slide has an image', srcs.every(Boolean));
    ok(tag + ': every slide image exists',
       srcs.every(s => s && fs.existsSync(path.join(__dirname, s))),
       srcs.filter(s => s && !fs.existsSync(path.join(__dirname, s))).join(', '));
    ok(tag + ': every slide image has alt text',
       slides.every(s => (s.querySelector('img')?.getAttribute('alt') || '').trim()));
    ok(tag + ': no repeated photos', new Set(srcs).size === srcs.length,
       srcs.filter((s, i) => srcs.indexOf(s) !== i).join(', '));
    ok(tag + ': every slide has a caption title',
       slides.every(s => s.querySelector('h3, .carousel-caption-title')));
  }
}
ok('found carousels to check', carouselsSeen > 0);
console.log('\n  checked ' + carouselsSeen + ' carousels\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
