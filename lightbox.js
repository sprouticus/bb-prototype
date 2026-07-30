/* ============================================================
   SHARED PHOTO LIGHTBOX — added 2026-07-29

   Click any photo in an enhanced section to view it larger.

   WHY THIS FILE EXISTS
   The Photos, Accessories, Implements and Catch-and-Release pages each
   carry their own inline copy of a lightbox. Rather than add a fifth
   and sixth copy for the Specs / Home / Company pages, this is a single
   shared version those pages load. The four inline copies still work
   and were deliberately left alone; consolidating them onto this file
   is a follow-up, and the guard below means nothing breaks if a page
   ends up with both.

   TWO WAYS IN
   1. Explicit triggers — any element carrying data-full (the gallery
      grid's existing buttons work this way, using data-caption).
   2. Section figures — add a figure class to SELECTOR and every <img>
      inside gets wrapped in a real <button> at runtime, so the photos
      are keyboard-operable and announced properly. Nothing is
      hardcoded per page: drop a photo into an enhanced section and it
      just works.

   Full-size source: data-full if present, otherwise the img's src.
   Caption: data-caption, else the sibling <figcaption>, else the alt.

   ORDERING BUG THIS FIXES (2026-07-29)
   The inline copies on photos.html and catch-and-release.html sat in a
   plain <script> ABOVE the lightbox markup they looked up. Inline
   scripts run during parse, so getElementById('lightbox') returned
   null, the guard bailed, and clicking a photo did nothing — silently,
   since bailing is also the correct behavior on pages with no
   lightbox. It had been broken on both pages since 2026-07-18.
   Accessories and Implements happened to put their markup first, which
   is why those kept working. Loading this file with `defer` removes
   the ordering trap entirely: it runs after the document is parsed,
   and the dialog is injected rather than authored into the page.

   Degrades cleanly: with JS off, the photos render exactly as before,
   just not clickable.
   ============================================================ */
(function () {
  'use strict';

  var SELECTOR = '.story-img, .shop-feature, .shop-tile, .era-item, .shop-portrait';

  /* A page with its own inline lightbox already binds #lightbox. Bail
     out rather than double-bind and open two dialogs on one click. */
  if (document.getElementById('lightbox')) return;

  var triggers = document.querySelectorAll('[data-full]');
  var figures = document.querySelectorAll(SELECTOR);
  if (!triggers.length && !figures.length) return;

  /* -------- dialog markup, injected once -------- */
  var lightbox = document.createElement('div');
  lightbox.className = 'lightbox';
  lightbox.id = 'lightbox';
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-modal', 'true');
  lightbox.setAttribute('aria-label', 'Enlarged photo');
  lightbox.hidden = true;
  lightbox.innerHTML =
    '<button type="button" class="lightbox-close" id="lightbox-close" aria-label="Close enlarged photo">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
    '</button>' +
    '<figure class="lightbox-content">' +
      '<img src="" alt="" id="lightbox-img">' +
      '<figcaption id="lightbox-caption"></figcaption>' +
    '</figure>';
  document.body.appendChild(lightbox);

  var lightboxImg = lightbox.querySelector('#lightbox-img');
  var lightboxCaption = lightbox.querySelector('#lightbox-caption');
  var closeBtn = lightbox.querySelector('#lightbox-close');
  var lastFocused = null;

  function openLightbox(src, caption) {
    lastFocused = document.activeElement;
    lightboxImg.src = src;
    lightboxImg.alt = caption || '';
    lightboxCaption.textContent = caption || '';
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
  }

  function closeLightbox() {
    lightbox.hidden = true;
    lightboxImg.src = '';
    document.body.style.overflow = '';
    if (lastFocused) lastFocused.focus();
  }

  /* -------- 1. explicit data-full triggers (already real buttons) -------- */
  Array.prototype.forEach.call(triggers, function (el) {
    var inner = el.querySelector('img');
    var caption = el.getAttribute('data-caption') ||
                  (inner ? inner.getAttribute('alt') : '') || '';
    el.addEventListener('click', function () {
      openLightbox(el.getAttribute('data-full'), caption);
    });
  });

  /* -------- 2. section figures: wrap each photo in a button -------- */
  Array.prototype.forEach.call(figures, function (fig) {
    var img = fig.querySelector('img');
    /* Skip anything already handled above, or already wrapped. */
    if (!img || img.closest('[data-full]') || img.closest('.photo-zoom')) return;

    /* data-caption on the img wins, for captions that are marked up
       across multiple lines (a <strong> role over a <br> subtitle, say)
       and would otherwise run together as one string. */
    var cap = fig.querySelector('figcaption');
    var caption = (img.getAttribute('data-caption') ||
                   (cap ? cap.textContent : '') ||
                   img.getAttribute('alt') || '').trim();
    var full = img.getAttribute('data-full') || img.getAttribute('src');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'photo-zoom';
    btn.setAttribute('aria-label', caption ? 'View larger photo: ' + caption : 'View larger photo');

    img.parentNode.insertBefore(btn, img);
    btn.appendChild(img);

    btn.addEventListener('click', function () {
      openLightbox(full, caption);
    });
  });

  /* -------- close behaviors -------- */
  closeBtn.addEventListener('click', closeLightbox);

  lightbox.addEventListener('click', function (e) {
    if (e.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !lightbox.hidden) closeLightbox();
  });
})();
