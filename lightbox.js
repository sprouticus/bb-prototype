(function () {
  'use strict';

  var SELECTOR = '.story-img, .shop-feature, .shop-tile, .era-item, .shop-portrait';

  if (document.getElementById('lightbox')) return;

  var triggers = document.querySelectorAll('[data-full]');
  var figures = document.querySelectorAll(SELECTOR);
  if (!triggers.length && !figures.length) return;

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

  function openLightbox(src, alt, caption) {
    lastFocused = document.activeElement;
    lightboxImg.src = src;
    lightboxImg.alt = alt || '';
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

  Array.prototype.forEach.call(triggers, function (el) {
    var inner = el.querySelector('img');
    var alt = inner ? (inner.getAttribute('alt') || '') : '';
    var caption = el.getAttribute('data-caption') || '';
    el.addEventListener('click', function () {
      openLightbox(el.getAttribute('data-full'), alt, caption);
    });
  });

  Array.prototype.forEach.call(figures, function (fig) {
    var img = fig.querySelector('img');
    if (!img || img.closest('[data-full]') || img.closest('.photo-zoom')) return;

    var alt = (img.getAttribute('alt') || '').trim();
    var cap = fig.querySelector('figcaption');
    var caption = (img.getAttribute('data-caption') ||
                   (cap ? cap.textContent : '') || '').trim();
    var full = img.getAttribute('data-full') || img.getAttribute('src');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'photo-zoom';
    var labelText = caption || alt;
    btn.setAttribute('aria-label', labelText ? 'View larger photo: ' + labelText : 'View larger photo');

    img.parentNode.insertBefore(btn, img);
    btn.appendChild(img);

    btn.addEventListener('click', function () {
      openLightbox(full, alt, caption);
    });
  });

  closeBtn.addEventListener('click', closeLightbox);

  lightbox.addEventListener('click', function (e) {
    if (e.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !lightbox.hidden) closeLightbox();
  });
})();
