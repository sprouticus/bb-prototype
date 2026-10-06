(function () {
  'use strict';

  var snake = document.querySelector('.snake');
  if (!snake) return;

  var rowEls = Array.prototype.slice.call(snake.querySelectorAll('.snake-row'));
  if (!rowEls.length) return;

  var traveler = snake.querySelector('.snake-traveler');
  var cue = snake.querySelector('.snake-cue');
  var pin = snake.closest ? snake.closest('.snake-pin') : null;
  if (!pin || !pin.querySelector('.snake-stage')) return;
  var restartWrap = document.querySelector('.snake-restart');
  var restartBtn = restartWrap ? restartWrap.querySelector('button') : null;
  var siteHeader = document.querySelector('header.site');

  var PIN_DRIVE = 1200;
  var PIN_HOLD = 550;
  var PIN_FADE = 180;
  var PIN_LIFT = 300;
  var PIN_LEAD = 600;
  var STAGE_ANCHOR = 0.62;
  var STAGE_TAIL = 90;
  var BAND_MIN = 40;
  var BAND_MAX = 140;
  var CUE_ABOVE_LINE = 200;
  var UP_RELEASE = 24;
  var RESUME_SLACK = 4;

  var SIMPLE_ANCHOR = 0.42;
  var SIMPLE_HOLD = 0.55;
  var SIMPLE_REVEAL = 0.82;

  var PIN_PER_LINE = PIN_DRIVE + PIN_HOLD + PIN_FADE + PIN_LIFT;
  var P_DRIVE_END = PIN_DRIVE / PIN_PER_LINE;
  var P_HOLD_END = (PIN_DRIVE + PIN_HOLD) / PIN_PER_LINE;
  var P_FADE_END = (PIN_DRIVE + PIN_HOLD + PIN_FADE) / PIN_PER_LINE;
  var P_FADE_IN = PIN_FADE / PIN_PER_LINE;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var wideScreen = window.matchMedia('(min-width: 821px)');

  var mode = 'off';
  var geo = null;
  var progress = 0;
  var pinned = false;
  var finished = false;
  var peakY = 0;
  var queued = false;
  var simpleGeo = null;
  var simpleDone = false;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function measure() {
    var turnR = parseFloat(
      getComputedStyle(snake).getPropertyValue('--turn-r')
    ) || 0;

    var stickyTop = siteHeader ? siteHeader.offsetHeight : 0;
    var stageH = Math.max(window.innerHeight - stickyTop, 240);
    var endP = (rowEls.length - 1) + P_HOLD_END;
    var travel = endP * PIN_PER_LINE;
    var distance = PIN_LEAD + travel;
    var pinTopDoc = pin.getBoundingClientRect().top + window.pageYOffset;

    pin.style.setProperty('--pin-top', stickyTop + 'px');
    pin.style.setProperty('--stage-h', stageH + 'px');
    if (pinned) pin.style.height = (stageH + distance) + 'px';

    var snakeH = snake.offsetHeight;

    if (cue && rowEls.length) {
      var firstLine = rowEls[0].offsetTop + rowEls[0].offsetHeight;
      cue.style.top = Math.max(firstLine - CUE_ABOVE_LINE, 8) + 'px';
    }

    geo = {
      stickyTop: stickyTop,
      stageH: stageH,
      endP: endP,
      travel: travel,
      distance: distance,
      pinnedH: stageH + distance,
      pinTopDoc: pinTopDoc,
      pinStart: pinTopDoc - stickyTop,
      snakeH: snakeH,
      minShift: Math.min(0, stageH - snakeH - STAGE_TAIL),
      width: snake.clientWidth,
      turnR: turnR,
      travelerW: traveler ? traveler.offsetWidth : 0,
      travelerH: traveler ? traveler.offsetHeight : 0,
      rows: rowEls.map(function (el) {
        var lineLocal = el.offsetTop + el.offsetHeight;
        var rtl = el.classList.contains('snake-row--left');

        var cell = el.querySelector('.snake-cell');
        var cr = cell ? cell.getBoundingClientRect() : null;
        var sr = snake.getBoundingClientRect();
        var cellLeft = cr ? cr.left - sr.left : 0;
        var cellW = cr ? cr.width : 0;

        var runStart = turnR;
        var runEnd = snake.clientWidth - turnR;
        var origin = rtl ? cellLeft + cellW : cellLeft;
        var available = rtl ? origin - runStart : runEnd - origin;

        var band = clamp(available - cellW, BAND_MIN, BAND_MAX);
        var need = cellW + band;
        var gain = (available > 0 && need > available) ? need / available : 1;

        return {
          el: el,
          topLocal: el.offsetTop,
          lineLocal: lineLocal,
          origin: origin,
          band: band,
          need: need,
          gain: gain,
          rtl: rtl
        };
      })
    };
  }

  function rawProgress() {
    if (geo.travel <= 0) return 0;
    var through = (window.pageYOffset - geo.pinStart - PIN_LEAD) / geo.travel;
    return clamp(through, 0, 1) * geo.endP;
  }

  function pinnedYFor(p) {
    if (geo.travel <= 0) return geo.pinStart + PIN_LEAD;
    return geo.pinStart + PIN_LEAD + (p / geo.endP) * geo.travel;
  }

  function releasedY() {
    return geo.pinStart - shiftFor(progress);
  }

  function shiftFor(p) {
    var rows = geo.rows;
    var n = rows.length;
    var idx = clamp(Math.floor(p), 0, n - 1);
    var frac = p >= n ? 1 : clamp(p - idx, 0, 1);
    var a = rows[idx].lineLocal;
    var b = idx + 1 < n ? rows[idx + 1].lineLocal : a;

    var u = clamp((frac - P_FADE_END) / (1 - P_FADE_END), 0, 1);
    var eased = u * u * (3 - 2 * u);
    var lineY = a + (b - a) * eased;
    return clamp(-(lineY - geo.stageH * STAGE_ANCHOR), geo.minShift, 0);
  }

  function revealFor(row, vehX) {
    var travelled = row.rtl ? (row.origin - vehX) : (vehX - row.origin);
    return clamp(travelled * row.gain, 0, row.need);
  }

  function setLead(row, px) {
    row.el.style.setProperty('--lead', px.toFixed(1) + 'px');
    row.el.style.setProperty('--band', row.band.toFixed(1) + 'px');
  }

  function render(p) {
    var rows = geo.rows;
    var n = rows.length;
    var idx = clamp(Math.floor(p), 0, n - 1);
    var frac = p >= n ? 1 : clamp(p - idx, 0, 1);

    if (pinned) {
      snake.style.transform = 'translate3d(0,' + shiftFor(p).toFixed(1) + 'px,0)';
    }

    var row = rows[idx];
    var start = geo.turnR;
    var end = geo.width - geo.turnR;
    var from = row.rtl ? end : start;
    var to = row.rtl ? start : end;
    var driven = clamp(frac / P_DRIVE_END, 0, 1);
    var cx = from + (to - from) * driven;

    for (var i = 0; i < n; i++) {
      setLead(rows[i], i < idx ? rows[i].need : (i > idx ? 0 : revealFor(rows[i], cx)));
    }

    if (!traveler) return;

    var x = cx - geo.travelerW / 2;
    var y = row.lineLocal - geo.travelerH - 3;

    var opacity = 1;
    if (idx > 0 && frac < P_FADE_IN) opacity = frac / P_FADE_IN;
    else if (idx < n - 1 && frac > P_HOLD_END) {
      opacity = clamp(1 - (frac - P_HOLD_END) / (P_FADE_END - P_HOLD_END), 0, 1);
    }

    traveler.style.transform =
      'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)' +
      (row.rtl ? ' scaleX(-1)' : '');
    traveler.style.opacity = opacity.toFixed(3);
  }

  function setRestartVisible(on) {
    if (!restartWrap) return;
    restartWrap.classList.toggle('is-visible', !!on);
    if (restartBtn) restartBtn.setAttribute('tabindex', on ? '0' : '-1');
  }

  function draw() {
    if (mode !== 'full' || !geo) return;
    render(progress);
    setRestartVisible(progress >= geo.endP - 0.001);
    if (cue) cue.classList.toggle('is-gone', progress > 0.001);
  }

  function paint() {
    queued = false;
    if (mode === 'simple') { drawSimple(); return; }
    draw();
    if (pinned && progress >= geo.endP - 0.001) finish();
  }

  function schedule() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(paint);
  }

  function onScroll() {
    if (mode === 'simple') { schedule(); return; }
    if (mode !== 'full' || !geo) return;
    var y = window.pageYOffset;

    if (!pinned) {
      if (finished) return;
      if (y - releasedY() > RESUME_SLACK) reattach();
      return;
    }

    if (y > peakY) peakY = y;
    if (y < geo.pinStart && peakY > geo.pinStart) { detach(false); return; }
    if (peakY - y > UP_RELEASE && y > releasedY()) { detach(true); return; }

    var raw = rawProgress();
    if (raw > progress) { progress = raw; schedule(); }
  }

  function jumpTo(y) {
    var el = document.documentElement;
    var prev = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    window.scrollTo(0, Math.max(y, 0));
    el.style.scrollBehavior = prev;
  }

  function setScrollRestoration(value) {
    try {
      if ('scrollRestoration' in window.history) {
        window.history.scrollRestoration = value;
      }
    } catch (e) { }
  }

  function setPinned(on) {
    pinned = on;
    pin.classList.toggle('is-pinned', on);
    if (on) {
      pin.style.height = geo.pinnedH + 'px';
    } else {
      pin.style.removeProperty('height');
      snake.style.removeProperty('transform');
    }
  }

  function finish() {
    if (!pinned || !geo) return;
    var y = window.pageYOffset;
    var pastPin = y - (geo.pinStart + geo.distance);
    var endShift = shiftFor(geo.endP);

    setPinned(false);
    finished = true;
    progress = geo.endP;
    render(progress);
    setRestartVisible(true);

    var shrankBy = geo.pinnedH - pin.offsetHeight;
    jumpTo(pastPin > 0 ? y - shrankBy : geo.pinStart - endShift);
  }

  function detach(correct) {
    if (!pinned || !geo || finished) return;
    var y = releasedY();
    setPinned(false);
    draw();
    if (correct) jumpTo(y);
  }

  function reattach() {
    if (pinned || finished || mode !== 'full' || !geo) return;
    var resumeAt = progress;
    pinned = true;
    measure();
    setPinned(true);
    measure();
    jumpTo(pinnedYFor(resumeAt));
    peakY = window.pageYOffset;
    progress = Math.max(resumeAt, rawProgress());
    draw();
  }

  function restart() {
    if (mode !== 'full' || !geo) return;
    pinned = true;
    finished = false;
    measure();
    setPinned(true);
    measure();
    jumpTo(geo.pinStart + PIN_LEAD);
    peakY = window.pageYOffset;
    progress = rawProgress();
    draw();
  }

  function measureSimple() {
    var sr = snake.getBoundingClientRect();
    var top = window.pageYOffset;

    var stops = rowEls.map(function (el) {
      var node = el.querySelector('.snake-node');
      var r = (node && node.offsetHeight) ? node.getBoundingClientRect()
                                          : el.getBoundingClientRect();
      var mid = r.top + (node && node.offsetHeight ? r.height / 2 : 11);
      return { el: el, node: node, local: mid - sr.top, doc: mid + top };
    });

    var endNode = snake.querySelector('.snake-node--end');
    if (endNode && endNode.offsetHeight) {
      var er = endNode.getBoundingClientRect();
      var emid = er.top + er.height / 2;
      stops.push({ el: null, node: endNode, local: emid - sr.top, doc: emid + top });
    }

    simpleGeo = {
      travelerH: traveler ? traveler.offsetHeight : 0,
      nodes: stops
    };
  }

  function drawSimple() {
    if (mode !== 'simple' || !simpleGeo) return;
    var vh = window.innerHeight;
    var y = window.pageYOffset;
    var nodes = simpleGeo.nodes;
    var n = nodes.length;
    var i;

    for (i = 0; i < n; i++) {
      if (nodes[i].el &&
          nodes[i].el.getBoundingClientRect().top < vh * SIMPLE_REVEAL) {
        nodes[i].el.classList.add('is-revealed');
      }
    }

    if (!traveler) return;

    if (simpleDone) {
      traveler.style.transform =
        'translate3d(0,' +
        (nodes[n - 1].local - simpleGeo.travelerH / 2).toFixed(1) + 'px,0)';
      return;
    }

    function arrive(k) { return nodes[k].doc - vh * SIMPLE_ANCHOR; }

    var idx = 0;
    while (idx < n - 1 && y >= arrive(idx + 1)) idx++;

    var local = nodes[idx].local;
    var eased = 0;
    if (idx < n - 1) {
      var span = arrive(idx + 1) - arrive(idx);
      var t = span > 0 ? clamp((y - arrive(idx)) / span, 0, 1) : 0;
      var u = clamp((t - SIMPLE_HOLD) / (1 - SIMPLE_HOLD), 0, 1);
      eased = u * u * (3 - 2 * u);
      local += (nodes[idx + 1].local - nodes[idx].local) * eased;
    }

    function fill(k) {
      var target = nodes[k].el || nodes[k].node;
      if (target) target.classList.add('is-reached');
    }
    for (i = 0; i <= idx; i++) fill(i);
    if (eased >= 0.85 && idx + 1 < n) fill(idx + 1);

    if (idx === n - 1) simpleDone = true;

    traveler.style.transform =
      'translate3d(0,' + (local - simpleGeo.travelerH / 2).toFixed(1) + 'px,0)';
  }

  function startSimple() {
    snake.classList.add('snake--simple');
    measureSimple();
    var img = traveler ? traveler.querySelector('img') : null;
    if (img && !img.complete) img.addEventListener('load', refresh, { once: true });
    drawSimple();
  }

  function teardown() {
    queued = false;
    simpleGeo = null;
    simpleDone = false;
    snake.classList.remove('snake--anim', 'snake--simple');
    pinned = false;
    finished = false;
    peakY = 0;
    pin.classList.remove('is-pinned');
    pin.style.removeProperty('height');
    pin.style.removeProperty('--pin-top');
    pin.style.removeProperty('--stage-h');
    snake.style.removeProperty('transform');
    rowEls.forEach(function (el) {
      el.classList.remove('is-revealed', 'is-reached');
      el.style.removeProperty('--lead');
      el.style.removeProperty('--band');
    });
    if (traveler) {
      traveler.style.removeProperty('transform');
      traveler.style.removeProperty('opacity');
    }
    if (cue) {
      cue.classList.remove('is-gone');
      cue.style.removeProperty('top');
    }
    setRestartVisible(false);
    if (restartWrap) restartWrap.classList.remove('is-on');
    setScrollRestoration('auto');
    mode = 'off';
  }

  function refresh() {
    if (mode === 'simple') { measureSimple(); drawSimple(); return; }
    if (mode !== 'full') return;
    measure();
    if (pinned) setPinned(true);
    draw();
  }

  function apply() {
    var want = reduceMotion.matches ? 'off' : (wideScreen.matches ? 'full' : 'simple');
    if (want === mode) { refresh(); return; }
    teardown();
    mode = want;
    if (mode === 'full') {
      snake.classList.add('snake--anim');
      if (restartWrap) restartWrap.classList.add('is-on');
      setScrollRestoration('manual');
      progress = 0;
      pinned = true;
      measure();
      setPinned(true);
      var img = traveler ? traveler.querySelector('img') : null;
      if (img && !img.complete) {
        img.addEventListener('load', refresh, { once: true });
      }
      progress = rawProgress();
      peakY = window.pageYOffset;
      draw();
    } else if (mode === 'simple') {
      startSimple();
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', refresh, { passive: true });

  window.addEventListener('load', refresh);

  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(refresh);
  }

  [reduceMotion, wideScreen].forEach(function (mq) {
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
  });

  if (restartBtn) restartBtn.addEventListener('click', restart);

  apply();
})();
