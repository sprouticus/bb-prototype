/* ============ PRIMARY NAVIGATION — hamburger + Vehicle / Gallery /
   Company dropdowns. (2026-08-21)

   This used to be two IIFEs pasted into the bottom of all 14 pages. It
   is one file now because the dropdown logic grew past the point where
   keeping fourteen copies in sync was realistic — change it here and
   every page gets it.

   The menu parents are <button aria-expanded>, not links. Their old
   hrefs (enabler-2-0 / photos / company-purpose) are the first item
   inside each menu, so nothing became unreachable, and the hit target
   went from a 17px caret to the whole word.

   .open is the single source of truth for click state, on desktop and
   mobile alike. Hover is handled entirely in CSS and only on real
   pointers. :focus-within is deliberately not used to open the panel:
   that was what made a click open the menu and a second click fail to
   close it, because focus outlived the class toggle. ============ */
(function () {
  var nav = document.querySelector('nav.primary');
  var navToggle = document.querySelector('.nav-toggle');
  var items = Array.prototype.slice.call(
    document.querySelectorAll('.nav-item.has-dropdown')
  );
  if (!nav && !items.length) return;

  /* Closing a menu while the pointer is still sitting on its button is
     the one case hover and click disagree about: the class comes off,
     :hover is still true, and the panel never visually closes — which
     looks exactly like the "clicking again won't close it" bug this
     rewrite exists to kill. So a deliberate close also suppresses hover
     on that item until the pointer actually leaves it. */
  function setOpen(item, open) {
    item.classList.toggle('open', open);
    item.classList.toggle('hover-suppressed', !open);
    var trigger = item.querySelector('.nav-dropdown-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', String(open));
  }

  items.forEach(function (item) {
    item.addEventListener('mouseleave', function () {
      item.classList.remove('hover-suppressed');
    });
  });

  function closeAll(except) {
    items.forEach(function (item) {
      if (item !== except && item.classList.contains('open')) setOpen(item, false);
    });
  }

  items.forEach(function (item) {
    var trigger = item.querySelector('.nav-dropdown-trigger');
    if (!trigger) return;
    trigger.addEventListener('click', function () {
      var willOpen = !item.classList.contains('open');
      closeAll(item);
      setOpen(item, willOpen);
    });
  });

  /* Escape closes the open menu and puts focus back on the button that
     opened it, so keyboard users don't get dumped at the top of the page. */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = items.filter(function (i) { return i.classList.contains('open'); })[0];
    if (!open) return;
    setOpen(open, false);
    var trigger = open.querySelector('.nav-dropdown-trigger');
    if (trigger) trigger.focus();
  });

  /* A click anywhere outside the menus closes whatever is open. */
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('.nav-item.has-dropdown')) closeAll(null);
  });

  /* Tabbing out of a menu closes it, so focus never lands on a link
     sitting behind an invisible panel. */
  document.addEventListener('focusin', function (e) {
    if (!e.target.closest) return;
    closeAll(e.target.closest('.nav-item.has-dropdown'));
  });

  /* Hamburger. Closing the whole menu also collapses every dropdown
     inside it, so reopening it later starts from a clean state. */
  if (navToggle && nav) {
    navToggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
      navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      if (!open) closeAll(null);
    });
  }
})();
