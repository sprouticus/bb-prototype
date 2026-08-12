/* ============================================================
   HISTORY SNAKE — SCROLL ANIMATION (history.html)
   Added 2026-08-10. Companion CSS is the .snake--anim /
   .snake--simple block in styles.css; read that first, it explains
   the reveal mask and why every hidden state is class-gated.

   WHAT THIS DOES
   One vehicle mark travels the horizontal run of each timeline row
   as the page scrolls, wiping that row's copy in behind it. At the
   end of a run it dissolves out, and fades back in at the start of
   the next run facing the other way. Once it reaches the last
   milestone it parks there and everything stays revealed.

   NO LIBRARY ON PURPOSE
   GSAP + ScrollTrigger was the obvious candidate and would have
   worked, but this is ~200 lines of IntersectionObserver and rAF
   against a site that currently ships zero third-party JS and has
   no build step. Not worth a 70KB CDN dependency and a second
   thing that can fail to load. If this ever grows pinning,
   timelines or scrubbed media, revisit.

   PROGRESS IS ONE-DIRECTIONAL — this is the load-bearing idea.
   Progress is a single float in [0, rowCount]: the integer part is
   which row the vehicle is on, the fraction is how far along that
   row's run it has travelled. Scroll position proposes a raw value;
   `progress` only ever accepts a larger one. So scrolling back up
   does not rewind the vehicle and does not un-reveal copy — which
   is the requested behavior, and also means a reader who scrolls up
   to re-read milestone 2 is not punished by having it wiped out
   from under them. The Start Over button is the only way back.

   MOTION IS TIED DIRECTLY TO SCROLLING. Position is a pure function
   of scroll position — no easing, no time-based loop, nothing that
   keeps moving on its own. Stop scrolling and the vehicle stops
   where it is. One line's run therefore costs exactly one row
   height of scroll, and the only way to make the traverse slower is
   to give the row more scroll distance to cover.

   NO BROWSER IN THE DEV SANDBOX — this was developed
   and checked under jsdom, which executes the module and lets the
   geometry and state machine be asserted directly. Layout numbers
   come from offsetTop/offsetHeight, which jsdom does not compute,
   so the jsdom harness stubs them. Anything about how this *looks*
   still needs a real browser.
   ============================================================ */
(function () {
  'use strict';

  var snake = document.querySelector('.snake');
  if (!snake) return;

  var rowEls = Array.prototype.slice.call(snake.querySelectorAll('.snake-row'));
  if (!rowEls.length) return;

  var traveler = snake.querySelector('.snake-traveler');
  var cue = snake.querySelector('.snake-cue');
  /* Without both wrappers there is nothing to pin against, and an
     unpinned traverse is the too-fast version this replaced — so bail
     to the plain page rather than run a degraded animation. */
  var pin = snake.closest ? snake.closest('.snake-pin') : null;
  if (!pin || !pin.querySelector('.snake-stage')) return;
  /* restartWrap, not `restart` — that name belongs to the reset
     function below. Naming both of them `restart` made the var
     assignment quietly clobber the hoisted function declaration, so
     addEventListener bound a <div> as the click listener and the
     button silently did nothing. */
  var restartWrap = document.querySelector('.snake-restart');
  var restartBtn = restartWrap ? restartWrap.querySelector('button') : null;
  var siteHeader = document.querySelector('header.site');

  /* ---- tuning ----------------------------------------------------
     PIN_LEAD   pixels of pinned scrolling before the vehicle sets
                off, held with it parked at the start of line 1 and
                no copy showing. Absorbs the overshoot of whatever
                flick brought the reader here; see measure().
     PIN_PER_LINE  THE SPEED KNOB, and the only one. Pixels of
                scrolling it takes to drive one line end to end.
                The timeline's own height gave about 300px per line,
                which was a single trackpad swipe per milestone;
                1200 is the quarter-speed that asked for. Five lines
                at 1200 is 6000px of scrolling held on this section,
                so raising this makes the page markedly longer to get
                through — it is a real cost, not a free dial.
     STAGE_ANCHOR where in the pinned stage the line currently being
                driven sits, as a fraction of stage height. 0.62
                leaves room for the milestone copy above it and the
                next turn below.
     STAGE_TAIL how much blank the timeline may be lifted past the
                bottom of the stage, in px. Without it the last rule
                lands exactly on the stage's bottom edge and the
                vehicle looks half cut off; with it the last line
                rides up clear of the edge and the stage shows this
                much white underneath.
     FADE       fraction of a run spent dissolving out at the end /
                back in at the start. Both ends together read as one
                cross-dissolve across the turn.
     BAND_MIN   floor and ceiling, in px, for the soft edge of the
     BAND_MAX   copy wipe. See revealFor().
     CUE_ABOVE_LINE  how far above the first rule the Scroll Down cue
                sits, in px. Placed from JS because it is measured
                from the rule, and the rule's position depends on a
                row height that CSS has no way to read.
     ---------------------------------------------------------------- */
  var PIN_PER_LINE = 1200;
  var PIN_LEAD = 600;
  var STAGE_ANCHOR = 0.62;
  var STAGE_TAIL = 90;
  var FADE = 0.14;
  var BAND_MIN = 40;
  var BAND_MAX = 140;
  var CUE_ABOVE_LINE = 200;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  /* 821px, not 820px: the CSS collapses the switchbacks AT max-width
     820px, so the traversing version is only valid from 821px up.
     Keep these two numbers in step. */
  var wideScreen = window.matchMedia('(min-width: 821px)');

  var mode = 'off';          // 'off' | 'full' | 'simple'
  var geo = null;            // measured layout, see measure()
  /* Where the vehicle is, in lines. Set only from scroll position,
     and only ever upward — see the ratchet note at the top. */
  var progress = 0;
  /* Is the section currently holding the viewport and driving the
     animation? Goes false for good once the vehicle parks — see
     finish() — and only comes back via Start Over. */
  var pinned = false;
  var queued = false;        // a paint is already scheduled for this frame
  var simpleObserver = null;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ---- measurement -----------------------------------------------
     Rows report offsetTop against .snake, which is position:relative.
     Two coordinate spaces are needed and conflating them is the easy
     mistake here:
       *Local  — relative to .snake, used to place the traveller,
                 which is absolutely positioned inside .snake.
       *Doc    — absolute document Y, used to compare against scroll
                 position.
     Each row's run is the 3px rule along its bottom edge, inset by
     --turn-r at both ends (see the geometry notes in styles.css), so
     the run spans x = turnR .. width - turnR at y = row bottom.
     ---------------------------------------------------------------- */
  function measure() {
    var turnR = parseFloat(
      getComputedStyle(snake).getPropertyValue('--turn-r')
    ) || 0;

    /* ---- pin geometry ----
       The stage sticks at `stickyTop` below the viewport top, so it
       becomes stuck once the pin's own top has scrolled to that
       line, and releases once the pin's bottom catches up with the
       stage's bottom. `pinStart` is the first of those; `distance`
       is how far the reader scrolls between them, and it is the pin
       height minus one stage exactly.

       `distance` opens with PIN_LEAD before any travel happens. That
       lead exists because motion is tied directly to scroll: the
       flick that carries the reader down to the section does not
       stop dead at the moment the stage sticks, it overshoots, and
       whatever it overshoots by is vehicle travel the reader never
       saw. A single trackpad flick can carry 500px, which without a
       lead put the vehicle halfway along the first line — copy
       already half uncovered — before the section was ever looked
       at. The lead absorbs that, so the parked start state is on
       screen for PIN_LEAD of scrolling no matter how hard the
       reader arrived. */
    var stickyTop = siteHeader ? siteHeader.offsetHeight : 0;
    var stageH = Math.max(window.innerHeight - stickyTop, 240);
    var travel = rowEls.length * PIN_PER_LINE;
    var distance = PIN_LEAD + travel;
    var pinTopDoc = pin.getBoundingClientRect().top + window.pageYOffset;

    pin.style.setProperty('--pin-top', stickyTop + 'px');
    pin.style.setProperty('--stage-h', stageH + 'px');
    if (pinned) pin.style.height = (stageH + distance) + 'px';

    var snakeH = snake.offsetHeight;

    /* Park the cue a fixed distance above the first rule. Clamped off
       the top edge for short rows — on a narrow-but-still-wide
       viewport the first row can be shorter than CUE_ABOVE_LINE, and
       a negative top would hang it outside the stage's overflow and
       clip it. */
    if (cue && rowEls.length) {
      var firstLine = rowEls[0].offsetTop + rowEls[0].offsetHeight;
      cue.style.top = Math.max(firstLine - CUE_ABOVE_LINE, 8) + 'px';
    }

    geo = {
      stickyTop: stickyTop,
      stageH: stageH,
      travel: travel,
      distance: distance,
      pinnedH: stageH + distance,
      pinTopDoc: pinTopDoc,
      pinStart: pinTopDoc - stickyTop,
      snakeH: snakeH,
      /* How far the timeline may be lifted inside the stage. Never
         positive — a timeline shorter than the stage does not move
         at all. */
      minShift: Math.min(0, stageH - snakeH - STAGE_TAIL),
      width: snake.clientWidth,
      turnR: turnR,
      travelerW: traveler ? traveler.offsetWidth : 0,
      travelerH: traveler ? traveler.offsetHeight : 0,
      rows: rowEls.map(function (el) {
        var lineLocal = el.offsetTop + el.offsetHeight;
        var rtl = el.classList.contains('snake-row--left');

        /* Cell geometry has to come from getBoundingClientRect, not
           offsetLeft: .snake-cell carries the staggered-cascade
           translateX, and offsetLeft does not see transforms. Both
           rects are read in the same frame, so subtracting them
           cancels the scroll offset out. */
        var cell = el.querySelector('.snake-cell');
        var cr = cell ? cell.getBoundingClientRect() : null;
        var sr = snake.getBoundingClientRect();
        var cellLeft = cr ? cr.left - sr.left : 0;
        var cellW = cr ? cr.width : 0;

        var runStart = turnR;
        var runEnd = snake.clientWidth - turnR;
        /* Everything below is expressed along the direction of
           travel, so the two directions share one set of maths.
           `origin` is the edge of the cell the wipe starts from;
           `available` is how much travel there is from that edge to
           the end of the run. */
        var origin = rtl ? cellLeft + cellW : cellLeft;
        var available = rtl ? origin - runStart : runEnd - origin;

        /* The soft edge is whatever travel is left after the vehicle
           has cleared the cell, so the wipe completes exactly as the
           vehicle reaches the end of the run. */
        var band = clamp(available - cellW, BAND_MIN, BAND_MAX);
        var need = cellW + band;
        /* If the run is too short for that — narrow viewports, or a
           cascade shift that pushes the cell close to the end — the
           wipe would stall part-revealed. Gain it up so it still
           finishes; the cost is the edge running slightly ahead of
           the vehicle rather than sitting exactly on it. */
        var gain = (available > 0 && need > available) ? need / available : 1;

        return {
          el: el,
          topLocal: el.offsetTop,
          lineLocal: lineLocal,
          origin: origin,
          band: band,
          need: need,
          gain: gain,
          /* .snake-row--left has its copy on the left, which means the
             path is running right-to-left through it. Two different
             alternations live on these rows (copy side vs. connector
             side) — see styles.css. Travel direction follows the copy
             side. */
          rtl: rtl
        };
      })
    };
  }

  /* Progress proposed by the current scroll position: simply how far
     the reader is through the pinned stretch. While the stage is
     stuck this is the only thing scrolling does, so every pixel
     scrolled is a pixel of vehicle travel and nothing else moves.

     This used to be derived from the rows' own document positions,
     which is what made the traverse unslowably fast — a row could
     only ever buy its own height in scroll distance. The pin
     decouples the two. */
  function rawProgress() {
    if (geo.travel <= 0) return 0;
    var through = (window.pageYOffset - geo.pinStart - PIN_LEAD) / geo.travel;
    return clamp(through, 0, 1) * geo.rows.length;
  }

  /* How far up the timeline is lifted inside the stage, in px, so
     that the line currently being driven sits at STAGE_ANCHOR.

     THE LINE HOLDS STILL WHILE THE VEHICLE CROSSES IT. The lift
     interpolates from this row's rule to the next one's, but not
     evenly across the run — it is held at zero for the first ~72%
     and then smoothstepped through in the last 2 x FADE, which is
     the window the vehicle spends dissolving out. So the reader
     watches a stationary line being driven along, and the page
     repositions to the next line while the vehicle is invisible.

     Interpolating evenly instead (the obvious first version) slid
     the line upward by a full row height during the traverse: the
     vehicle appeared to drive diagonally, and the copy it was
     uncovering crawled out from under it. Only noticeable once the
     pin made runs long enough to watch.

     The last row does not interpolate — there is no rule after it —
     so the timeline is still while the vehicle parks. */
  function shiftFor(p) {
    var rows = geo.rows;
    var n = rows.length;
    var idx = clamp(Math.floor(p), 0, n - 1);
    var frac = p >= n ? 1 : clamp(p - idx, 0, 1);
    var a = rows[idx].lineLocal;
    var b = idx + 1 < n ? rows[idx + 1].lineLocal : a;

    var window_ = 2 * FADE;
    var u = clamp((frac - (1 - window_)) / window_, 0, 1);
    var eased = u * u * (3 - 2 * u);        /* smoothstep, so the move
                                               has no hard start or stop */
    var lineY = a + (b - a) * eased;
    return clamp(-(lineY - geo.stageH * STAGE_ANCHOR), geo.minShift, 0);
  }

  /* How far the wipe edge has travelled into row `row`'s copy, in px
     from the cell's leading edge, given the vehicle's current centre
     x. Returned clamped to the row's completion distance so a value
     handed to CSS can never overshoot. */
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

    /* Scroll the timeline inside the pinned stage. The traveller is
       positioned against .snake, so it rides this transform for free
       and its own maths stays in .snake's coordinates throughout.
       Skipped once released — the section is in normal flow then and
       a leftover transform would offset the whole thing. */
    if (pinned) {
      snake.style.transform = 'translate3d(0,' + shiftFor(p).toFixed(1) + 'px,0)';
    }

    var row = rows[idx];
    var start = geo.turnR;
    var end = geo.width - geo.turnR;
    var from = row.rtl ? end : start;
    var to = row.rtl ? start : end;
    var cx = from + (to - from) * frac;

    /* Copy: rows behind the vehicle are fully revealed, rows ahead of
       it are not revealed at all, and the row under it has its wipe
       edge placed at the vehicle's actual x. Because p only moves
       forward this can be written statelessly — there is no "already
       revealed" flag to keep in sync. */
    for (var i = 0; i < n; i++) {
      setLead(rows[i], i < idx ? rows[i].need : (i > idx ? 0 : revealFor(rows[i], cx)));
    }

    if (!traveler) return;

    /* Centre the mark on the travel point, and sit it on the rule the
       same 3px clear that the static .snake-vehicle marks use. */
    var x = cx - geo.travelerW / 2;
    var y = row.lineLocal - geo.travelerH - 3;

    /* Dissolve across the turn. The first row never fades in (the
       vehicle is meant to be sitting at the start line waiting) and
       the last never fades out (it parks). The x jump and the flip
       both happen while opacity is at or near zero, so the vehicle is
       never seen teleporting or spinning. */
    var opacity = 1;
    if (idx > 0 && frac < FADE) opacity = frac / FADE;
    else if (idx < n - 1 && frac > 1 - FADE) opacity = (1 - frac) / FADE;

    /* scaleX is applied after the translate and pivots on the
       element's own centre (default transform-origin), so flipping
       does not shift the position. */
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

  /* ---- painting --------------------------------------------------
     THE VEHICLE'S POSITION IS A PURE FUNCTION OF SCROLL POSITION.
     Nothing here is time-based. Stop scrolling and the vehicle stops
     dead, wherever it is; every pixel it moves is a pixel the reader
     scrolled.

     An earlier version eased toward a scroll-set target so a fast
     flick still produced a slow traverse. It made the speed
     controllable, but it also meant the vehicle carried on driving
     after the reader had stopped scrolling, which read as the page
     playing an animation at them rather than them driving it. Do not
     reintroduce a time-based loop here.

     rAF is used only to coalesce bursts of scroll events into one
     paint per frame. That is throttling, not animation: the value
     painted is always whatever the scroll position says right now.
     ---------------------------------------------------------------- */
  function draw() {
    if (mode !== 'full' || !geo) return;
    render(progress);
    setRestartVisible(progress >= geo.rows.length - 0.001);
    /* The cue survives the whole lead-in — progress is still 0 there,
       and a reader scrolling through a stretch where nothing moves is
       precisely who still needs telling to keep going. It goes the
       moment the vehicle actually sets off. */
    if (cue) cue.classList.toggle('is-gone', progress > 0.001);
  }

  function paint() {
    queued = false;
    draw();
    /* Release after painting the final frame, not before: finish()
       reads the end shift out of the same geometry render() just
       used, and needs the timeline already drawn in its end state. */
    if (pinned && progress >= geo.rows.length - 0.001) finish();
  }

  function schedule() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(paint);
  }

  function onScroll() {
    if (mode !== 'full' || !geo) return;
    /* Once released the section is an ordinary static block and
       scrolling has nothing to drive. */
    if (!pinned) return;
    var raw = rawProgress();
    if (raw > progress) { progress = raw; schedule(); }
  }

  /* Scroll without the smooth easing that html{scroll-behavior:smooth}
     would otherwise impose. Used for the two moves that have to be
     instantaneous because they are compensating for a layout change
     rather than taking the reader somewhere. */
  function jumpTo(y) {
    var el = document.documentElement;
    var prev = el.style.scrollBehavior;
    el.style.scrollBehavior = 'auto';
    window.scrollTo(0, Math.max(y, 0));
    el.style.scrollBehavior = prev;
  }

  /* ---- refresh starts over ----------------------------------------
     Browsers put the reader back where they were on a reload, which
     for this page means coming back to a half-driven timeline —
     copy already uncovered, vehicle stranded mid-line, and no way
     to replay it except the button. Turning restoration off makes a
     refresh land at the top of the page instead, so progress reads
     zero and the animation is armed and waiting, which is the same
     state the Start at Beginning button produces.

     Deliberately NOT auto-scrolling down to the timeline on load,
     even though the button does. Moving the viewport by itself as a
     page loads is disorienting and takes the decision away from
     someone who may have opened this to read something else. Landing
     at the top gets the same result — nothing is spent, everything
     replays — and lets the reader arrive under their own power.

     This also covers Back/Forward onto the page, which is wanted for
     the same reason: returning to a spent animation is worse than
     returning to the top of it.

     Timing: the script is deferred, so this runs before the browser
     would restore. Set it any later and the restore lands first.
     Guarded because older Safari has no scrollRestoration; there the
     behaviour is simply what it was before, no error. */
  function setScrollRestoration(value) {
    try {
      if ('scrollRestoration' in window.history) {
        window.history.scrollRestoration = value;
      }
    } catch (e) { /* some embedded/privacy contexts refuse the write */ }
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

  /* ---- release ----------------------------------------------------
     THE POINT OF THIS: once the vehicle has parked, the section stops
     being a pinned animation and becomes an ordinary static block —
     the whole serpentine line, all five milestones, the vehicle
     standing at the finish — which the reader can scroll up and down
     freely.

     Without it the pin stays in force after the animation is over,
     so scrolling back up means scrolling through thousands of pixels
     of stuck stage showing one frozen frame, with no way to see the
     top of the timeline again. That is not a tuning problem, it is
     the pin outliving its purpose.

     Dropping the pin's height shortens the document by several
     thousand pixels, so the scroll position has to be corrected in
     the same breath or the page leaps. There are two cases and they
     need different corrections:

       inside the pinned stretch (the normal way to finish) — keep
       the timeline exactly where it is on screen. It was stuck at
       stickyTop with the end shift applied; once static its top sits
       at pinTopDoc, so the reader belongs at pinStart minus that
       shift.

       past the pin entirely (one flick carried them straight through)
       — they are looking at content below the section, and all of it
       just moved up by however much the pin shrank. Move them the
       same amount and their view does not change at all.
     ---------------------------------------------------------------- */
  function finish() {
    if (!pinned || !geo) return;
    var y = window.pageYOffset;
    var pastPin = y - (geo.pinStart + geo.distance);
    var endShift = shiftFor(geo.rows.length);

    setPinned(false);
    progress = geo.rows.length;
    render(progress);
    setRestartVisible(true);

    var shrankBy = geo.pinnedH - pin.offsetHeight;
    jumpTo(pastPin > 0 ? y - shrankBy : geo.pinStart - endShift);
  }

  /* ---- start over ------------------------------------------------
     Re-pin the section, put the reader at the start of the traverse,
     and reset progress. Order matters: the height has to be back
     before the scroll target means anything.

     THE JUMP IS INSTANT, AND THAT IS A CORRECTNESS REQUIREMENT, not
     a taste call. The first version scrolled back smoothly, which
     meant progress had to be frozen while the scroll was in flight —
     otherwise the ratchet, still reading the old position, would
     swallow the reset on the very next frame. Unfreezing was gated
     on scrolling going quiet for a moment. A reader who clicked the
     button and immediately started scrolling never gave it that
     moment: every scroll event pushed the unfreeze further out, so
     the ratchet stayed frozen indefinitely and the timeline sat dead
     while the pin held the view — scrolling, but nothing happening.
     Jumping instantly means there is no in-flight window to protect,
     so the freeze, the timer and the whole re-arm dance are gone.
     Do not reintroduce a smooth scroll here without also solving
     that starvation.

     LANDS PAST THE LEAD, not at pinStart. PIN_LEAD exists to absorb
     the overshoot of a flick arriving at the section; a reader who
     clicked this button is already here and was placed deliberately,
     so there is nothing to absorb. Landing at pinStart would have
     given them PIN_LEAD of completely frozen screen — the pin
     holding the view still and the vehicle parked — as the reward
     for asking to see it again. Landing at pinStart + PIN_LEAD reads
     progress zero exactly, so the vehicle is parked at the start and
     the next pixel of scrolling moves it.
     ---------------------------------------------------------------- */
  function restart() {
    if (mode !== 'full' || !geo) return;
    pinned = true;
    measure();
    setPinned(true);
    /* Re-measure: setPinned just changed the document height, and
       jumpTo needs a pinStart that accounts for it. */
    measure();
    jumpTo(geo.pinStart + PIN_LEAD);
    progress = rawProgress();   /* 0 at that position, by construction */
    draw();
  }

  /* ---- narrow-screen mode ---------------------------------------- */
  function startSimple() {
    snake.classList.add('snake--simple');
    if (!('IntersectionObserver' in window)) {
      /* No observer, no reveal — show everything rather than leaving
         the copy invisible. */
      rowEls.forEach(function (el) { el.classList.add('is-revealed'); });
      return;
    }
    simpleObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          simpleObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -18% 0px', threshold: 0.05 });
    rowEls.forEach(function (el) { simpleObserver.observe(el); });
  }

  /* ---- mode switching -------------------------------------------- */
  function teardown() {
    queued = false;
    if (simpleObserver) { simpleObserver.disconnect(); simpleObserver = null; }
    snake.classList.remove('snake--anim', 'snake--simple');
    /* Unpin completely: the class, the inline height that buys the
       scroll distance, the custom properties, and the transform that
       scrolls the timeline inside the stage. Leaving any one of them
       behind strands the section in a clipped sticky box with
       nothing driving it. */
    pinned = false;
    pin.classList.remove('is-pinned');
    pin.style.removeProperty('height');
    pin.style.removeProperty('--pin-top');
    pin.style.removeProperty('--stage-h');
    snake.style.removeProperty('transform');
    rowEls.forEach(function (el) {
      el.classList.remove('is-revealed');
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
    /* Hand scroll restoration back — only the pinned animation has a
       reason to suppress it, and reduced-motion and narrow-screen
       readers should keep the browser's normal behaviour. */
    setScrollRestoration('auto');
    mode = 'off';
  }

  /* Re-measure and repaint at the current progress without letting
     scroll advance anything — for resize, late layout shifts, and the
     mark finishing loading. */
  function refresh() {
    if (mode !== 'full') return;
    measure();
    /* Re-assert the height: measure() recomputes it (the stage is a
       viewport tall, so a resize changes it) but only writes it while
       pinned, and a released section must stay released. */
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
      /* The traveller's height depends on the mark having loaded; if
         it has not, re-measure when it does or the vehicle sits a
         mark-height too low on its first frames. */
      var img = traveler ? traveler.querySelector('img') : null;
      if (img && !img.complete) {
        img.addEventListener('load', refresh, { once: true });
      }
      /* Seed from wherever the reader actually is. On a refresh that
         is the top of the page — see setScrollRestoration — so this
         reads 0 and the timeline comes back untouched. It matters for
         the other caller though: crossing the 820px breakpoint runs
         apply() mid-page, and seeding 0 there would blank copy the
         reader is looking at. */
      progress = rawProgress();
      draw();
    } else if (mode === 'simple') {
      startSimple();
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', refresh, { passive: true });

  /* Late layout shifts — web fonts settling, lazy images above the
     timeline — move every row's document Y. Re-measure rather than
     trusting the first reading. */
  window.addEventListener('load', refresh);

  /* addListener is the deprecated spelling, still the only one older
     Safari has. */
  [reduceMotion, wideScreen].forEach(function (mq) {
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
  });

  if (restartBtn) restartBtn.addEventListener('click', restart);

  apply();
})();
