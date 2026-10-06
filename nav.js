(function () {
  var nav = document.querySelector('nav.primary');
  var navToggle = document.querySelector('.nav-toggle');
  var items = Array.prototype.slice.call(
    document.querySelectorAll('.nav-item.has-dropdown')
  );
  if (!nav && !items.length) return;

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

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = items.filter(function (i) { return i.classList.contains('open'); })[0];
    if (!open) return;
    setOpen(open, false);
    var trigger = open.querySelector('.nav-dropdown-trigger');
    if (trigger) trigger.focus();
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('.nav-item.has-dropdown')) closeAll(null);
  });

  document.addEventListener('focusin', function (e) {
    if (!e.target.closest) return;
    closeAll(e.target.closest('.nav-item.has-dropdown'));
  });

  if (navToggle && nav) {
    navToggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
      navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      if (!open) closeAll(null);
    });
  }
})();

(function () {
  var html = document.documentElement;
  var navRow = document.querySelector('.nav-row');
  if (!navRow) return;

  var measuring = false;

  function tooWide(el) {
    return !!el && el.scrollWidth > el.clientWidth + 1;
  }

  function fit() {
    if (measuring) return;
    measuring = true;

    html.removeAttribute('data-hdr-compact');
    html.removeAttribute('data-hdr-compact2');
    html.removeAttribute('data-hdr-compact3');

    if (tooWide(navRow)) {
      html.setAttribute('data-hdr-compact', '');
    }
    if (tooWide(navRow)) {
      html.setAttribute('data-hdr-compact2', '');
    }
    if (tooWide(navRow)) {
      html.setAttribute('data-hdr-compact3', '');
    }

    measuring = false;
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      fit();
    });
  }

  schedule();
  window.addEventListener('resize', schedule);
  window.addEventListener('load', schedule);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(schedule);
  }

  if (window.ResizeObserver) {
    var ro = new ResizeObserver(schedule);
    [
      document.querySelector('.logo'),
      document.querySelector('nav.primary'),
      document.querySelector('.header-ctas'),
    ].forEach(function (el) { if (el) ro.observe(el); });
  }
})();
