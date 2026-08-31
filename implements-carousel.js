/* ------------------------------------------------------------------
   implements-carousel.js — auto-advancing photo carousel for the
   Catch-and-Release section (.implements-video.implements-carousel),
   shared by the homepage and the vehicle page since the markup and
   behavior are identical on both. It replaced the catch-release.mp4
   loop 2026-08-30; a duplicated inline copy on each page is how a
   shared block quietly drifts apart later (see nav.js).

   This deliberately isn't built on the "next-gen carousel" used on
   the Photos/Implements/vehicle-build pages (.carousel-track,
   .carousel-dot, arrows). That one is manual and its script queries
   dots globally, capping it at one instance per page — the vehicle
   page already has one further up for the build-progress photos, so
   reusing its classes here would cross-wire the two. This carousel
   advances on its own instead of being clicked through, so it earned
   separate classes anyway.

   Same play/pause contract the site's scroll-triggered videos use:
   starts once the section scrolls into view, stops once it scrolls
   back out, always respects a manual pause/play from the toggle
   button, and never self-starts for prefers-reduced-motion users —
   the button is the only way they start it. That manual pause is
   also the WCAG 2.2.2 requirement for content that moves on its own
   for more than five seconds.

   Optional data-carousel-max-rotations caps how many full passes
   through the slides an UNPROMPTED autoplay is allowed before it
   pauses itself and waits for the visitor to press play (vehicle
   page hero, set to 3 — 2026-08-30). It only ever governs the
   scroll-triggered autostart: any manual play click, whether that's
   a reduced-motion visitor's first play, a resume after this cap
   fires, or a resume after an ordinary manual pause, disarms the cap
   for the rest of the page view and the carousel loops normally
   until paused again. Omit the attribute (as the Catch-and-Release
   instances do) and playback is unchanged — loops until paused,
   same as before this was added.
   ------------------------------------------------------------------ */
document.querySelectorAll('.implements-carousel').forEach(function(container){
  const slides = Array.from(container.querySelectorAll('.implements-carousel-slide'));
  const toggle = container.querySelector('.video-toggle');
  if(slides.length < 2 || !toggle) return;

  const interval = parseInt(container.dataset.carouselInterval, 10) || 5000;
  const maxRotations = parseInt(container.dataset.carouselMaxRotations, 10) || null;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = Math.max(0, slides.findIndex(function(s){ return s.classList.contains('is-active'); }));
  let timer = null;
  let userPaused = false;
  let rotationCapArmed = !!maxRotations;
  let autoAdvanceCount = 0;

  function show(next){
    slides[index].classList.remove('is-active');
    slides[index].setAttribute('aria-hidden', 'true');
    index = next;
    slides[index].classList.add('is-active');
    slides[index].removeAttribute('aria-hidden');
  }

  function advance(){
    show((index + 1) % slides.length);
    if(rotationCapArmed){
      autoAdvanceCount++;
      if(autoAdvanceCount >= maxRotations * slides.length){
        rotationCapArmed = false;
        userPaused = true;
        stop();
      }
    }
  }

  function syncToggleUI(){
    const running = !!timer;
    toggle.classList.toggle('is-paused', !running);
    toggle.setAttribute('aria-label', running ? 'Pause slideshow' : 'Play slideshow');
    toggle.setAttribute('aria-pressed', String(running));
  }

  function start(){
    if(timer) return;
    timer = setInterval(advance, interval);
    syncToggleUI();
  }

  function stop(){
    clearInterval(timer);
    timer = null;
    syncToggleUI();
  }

  toggle.addEventListener('click', function(){
    if(timer){
      stop();
      userPaused = true;
    } else {
      rotationCapArmed = false;
      start();
      userPaused = false;
    }
  });

  if('IntersectionObserver' in window){
    const observer = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting){
          if(!userPaused && !reduceMotion) start();
        } else {
          stop();
        }
      });
    }, { threshold: 0.5 });
    observer.observe(container);
  } else if(!reduceMotion){
    start();
  }

  syncToggleUI();
});
