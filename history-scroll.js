/* ============================================================
   HISTORY SNAKE — SCROLL ANIMATION (history.html)
   Companion CSS is the .snake--anim /
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
   which row the vehicle is on, the fraction is how far through that
   row's four phases it is. Scroll position proposes a raw value;
   `progress` only ever accepts a larger one. So scrolling back up
   does not rewind the vehicle and does not un-reveal copy — which
   is the requested behavior, and also means a reader who scrolls up
   to re-read milestone 2 is not punished by having it wiped out
   from under them. The Start Over button is the only way back.

   THE PIN LETS GO IF THE READER SCROLLS BACK UP. The ratchet on its
   own froze the frame while the stage stayed stuck, so scrolling up
   moved nothing at all — thousands of pixels of dead page. Instead
   the section releases and becomes an ordinary block, keeping every
   milestone revealed so far, and re-pins where it left off when the
   reader comes back down. See detach().

   MOTION IS TIED DIRECTLY TO SCROLLING. Position is a pure function
   of scroll position — no easing, no time-based loop, nothing that
   keeps moving on its own. Stop scrolling and the vehicle stops
   where it is. One line's run therefore costs exactly one row
   height of scroll, and the only way to make the traverse slower is
   to give the row more scroll distance to cover.

   A LINE IS FOUR PHASES, NOT ONE — drive, hold, fade, lift. See the
   tuning block. The hold is the load-bearing one: a stretch of
   scrolling where nothing moves at all, so the copy stands finished
   and still for a while before the line carries it out of view.
   Anything added here that moves the line, the copy or the vehicle
   belongs after it.
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
     A LINE'S SCROLL BUDGET IS SPENT IN FOUR PHASES, in this order,
     and the four constants below are how many pixels of scrolling
     each phase costs. They are the speed knobs, and the only ones.

       PIN_DRIVE  the traverse: the vehicle crosses the line, wiping
                that line's copy in behind it. The wipe finishes on
                the last pixel of this phase, as the vehicle reaches
                the corner. The timeline's own height gave about
                300px per line, which was a single trackpad swipe per
                milestone; 1200 is the quarter-speed that asked for.
       PIN_HOLD   nothing moves. Vehicle parked at the corner, line
                stationary, that milestone's copy fully revealed.
                THIS IS READING TIME, and it is why the phases exist
                at all. Before them a line was one undivided run: the
                wipe finished on the same pixel the vehicle finished
                on, while the line had already been sliding up since
                72% and the vehicle dissolving since 86%. So the tail
                of every milestone was carried out of view while it
                was still under the gradient — unreadable by
                construction, no matter how slowly the reader went.
       PIN_FADE   the vehicle dissolves out. Line still stationary.
       PIN_LIFT   the line rides up to the next milestone. The
                vehicle is invisible for the whole of it, so it is
                never seen teleporting or driving diagonally.

     The ordering matters more than the numbers: every phase that
     moves something sits after the phase that made the copy
     readable. Keep it that way when tuning.

     COST. Five lines is now about 11,300px of scrolling held on this
     section, against 6,600 before the hold existed. Raising any of
     these four makes the page markedly longer to get through — a
     real cost, not a free dial.

     THE REST OF THE DIALS
     PIN_LEAD   pixels of pinned scrolling before the vehicle sets
                off, held with it parked at the start of line 1 and
                no copy showing. Absorbs the overshoot of whatever
                flick brought the reader here; see measure().
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
     BAND_MIN   floor and ceiling, in px, for the soft edge of the
     BAND_MAX   copy wipe. See revealFor().
     CUE_ABOVE_LINE  how far above the first rule the Scroll Down cue
                sits, in px. Placed from JS because it is measured
                from the rule, and the rule's position depends on a
                row height that CSS has no way to read.
     UP_RELEASE how far back up the reader has to scroll, in px,
                before the pin lets go mid-run — see detach(). Small
                enough that scrolling up feels like it works
                immediately, large enough that the tail of a flick or
                a stray delta from a mouse wheel does not release it
                by accident.
     ---------------------------------------------------------------- */
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

  /* The phases as fractions of one line's budget, which is the unit
     the fractional part of `progress` is measured in. Everything
     downstream compares against these rather than against raw pixels,
     so changing a phase length above moves its boundary here and
     nothing else has to know. */
  var PIN_PER_LINE = PIN_DRIVE + PIN_HOLD + PIN_FADE + PIN_LIFT;
  var P_DRIVE_END = PIN_DRIVE / PIN_PER_LINE;
  var P_HOLD_END = (PIN_DRIVE + PIN_HOLD) / PIN_PER_LINE;
  var P_FADE_END = (PIN_DRIVE + PIN_HOLD + PIN_FADE) / PIN_PER_LINE;
  /* The fade back IN at the start of the next line costs the same as
     the fade out, so the two together read as one cross-dissolve
     across the turn. It runs against the opening of that line's
     drive, so the vehicle is already moving as it appears. */
  var P_FADE_IN = PIN_FADE / PIN_PER_LINE;

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
     animation? Three states between these two flags:
       pinned            running — scrolling drives the vehicle
       neither           released mid-run, because the reader scrolled
                         back up. Everything revealed stays revealed
                         and `progress` keeps its place; scrolling
                         back down re-pins. See detach().
       finished          the vehicle has parked at the last milestone.
                         Released for good; only Start Over comes back.
     ---------------------------------------------------------------- */
  var pinned = false;
  var finished = false;
  /* The furthest down the reader has been since the pin last took
     hold. Only used to spot them scrolling back up — see onScroll. */
  var peakY = 0;
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
    /* The last line has nowhere to move on to, so it is bought its
       drive and its hold and nothing more — a fade and a lift there
       would be scroll distance spent on a dissolve the reader must
       not see and a reposition that cannot happen. `endP` is that
       stopping point in the same line units as `progress`, and it is
       what "finished" means everywhere below. */
    var endP = (rowEls.length - 1) + P_HOLD_END;
    var travel = endP * PIN_PER_LINE;
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
      endP: endP,
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
    return clamp(through, 0, 1) * geo.endP;
  }

  /* The inverse: the scroll position, with the pin in force, that
     reads as progress `p`. Used to put the reader back where they
     were when the pin is restored. */
  function pinnedYFor(p) {
    if (geo.travel <= 0) return geo.pinStart + PIN_LEAD;
    return geo.pinStart + PIN_LEAD + (p / geo.endP) * geo.travel;
  }

  /* And the scroll position, with the section RELEASED, that leaves
     the current frame exactly where it is on screen. Pinned, the
     timeline's top sits at stickyTop + shift; released, .snake sits
     at the pin's own document top, so the reader belongs that same
     shift above pinStart.

     Derived, never stored: progress is frozen while released, so this
     only moves if a resize moves the geometry under it — and then it
     moves with it, which a stored copy would not. It is both the
     landing point on the way out and the trigger on the way back in,
     and those two have to be the same number or the frame jumps. */
  function releasedY() {
    return geo.pinStart - shiftFor(progress);
  }

  /* How far up the timeline is lifted inside the stage, in px, so
     that the line currently being driven sits at STAGE_ANCHOR.

     THE LINE HOLDS STILL UNTIL THE VEHICLE HAS GONE. The lift
     interpolates from this row's rule to the next one's, but not
     evenly across the line — it is held at zero right through the
     drive, the hold and the fade, and only then smoothstepped
     through in the PIN_LIFT tail. By then the vehicle is at zero
     opacity, so the reader watches a stationary line being driven
     along, gets the hold to read it, and the page repositions while
     there is nothing on screen to see move.

     Two earlier versions of this were wrong, in the same direction
     both times. Interpolating evenly across the whole line slid it
     upward by a full row height during the traverse: the vehicle
     appeared to drive diagonally and the copy it was uncovering
     crawled out from under it. Confining the lift to the last 28% of
     the line fixed the diagonal but still started it halfway through
     the dissolve — and, worse, before the wipe had finished, which is
     what carried the end of each milestone out of view unread.
     Whatever this window becomes, it starts after the fade.

     The last row does not interpolate — there is no rule after it —
     so the timeline is still while the vehicle parks. */
  function shiftFor(p) {
    var rows = geo.rows;
    var n = rows.length;
    var idx = clamp(Math.floor(p), 0, n - 1);
    var frac = p >= n ? 1 : clamp(p - idx, 0, 1);
    var a = rows[idx].lineLocal;
    var b = idx + 1 < n ? rows[idx + 1].lineLocal : a;

    var u = clamp((frac - P_FADE_END) / (1 - P_FADE_END), 0, 1);
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
    /* ONLY THE DRIVE PHASE MOVES THE VEHICLE. Through the hold, the
       fade and the lift it stays on the corner it arrived at, which
       is also what freezes the wipe below with the copy fully
       revealed — the reveal is a function of this x and nothing
       else, so parking the vehicle parks the reveal for free. */
    var driven = clamp(frac / P_DRIVE_END, 0, 1);
    var cx = from + (to - from) * driven;

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

    /* Dissolve across the turn. Out during PIN_FADE, once the hold is
       over; back in over the opening of the next line's drive. The
       first row never fades in (the vehicle is meant to be sitting at
       the start line waiting) and the last never fades out (it
       parks). The x jump and the flip both happen while opacity is at
       or near zero, so the vehicle is never seen teleporting or
       spinning. */
    var opacity = 1;
    if (idx > 0 && frac < P_FADE_IN) opacity = frac / P_FADE_IN;
    else if (idx < n - 1 && frac > P_HOLD_END) {
      opacity = clamp(1 - (frac - P_HOLD_END) / (P_FADE_END - P_HOLD_END), 0, 1);
    }

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
    setRestartVisible(progress >= geo.endP - 0.001);
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
    if (pinned && progress >= geo.endP - 0.001) finish();
  }

  function schedule() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(paint);
  }

  function onScroll() {
    if (mode !== 'full' || !geo) return;
    var y = window.pageYOffset;

    if (!pinned) {
      /* Finished: the section is an ordinary static block for good
         and scrolling has nothing to drive. */
      if (finished) return;
      /* Released mid-run. Coming back down past the point it let go
         at re-pins it and the run carries on from where it stopped.

         RESUME_SLACK is there because the landing point and the
         trigger are deliberately the same number: without it the
         scroll event fired by detach()'s own correction can land a
         rounded pixel past it and re-pin the section it just
         released, on the spot. */
      if (y - releasedY() > RESUME_SLACK) reattach();
      return;
    }

    if (y > peakY) peakY = y;
    /* Scrolled clean above the section in one go — a Home key, a
       dragged scrollbar, an in-page link. The stage is not stuck any
       more, so the pin is holding nothing and the timeline is left
       sitting shifted inside a clipped box with thousands of pixels
       of empty spacer under it. Let it go, and leave the scroll
       alone: collapsing the pin only takes height from BELOW the
       reader, so nothing they are looking at moves. peakY gates it
       so that the ordinary approach from the top of the page — where
       the reader is above the section and has never reached it —
       does not read as leaving. */
    if (y < geo.pinStart && peakY > geo.pinStart) { detach(false); return; }
    /* Scrolling back up inside the pinned stretch, which is the case
       this is really for. `y > releasedY()` keeps it from firing
       where the correction would have to drag the reader FORWARDS to
       meet a frame they had already left behind. */
    if (peakY - y > UP_RELEASE && y > releasedY()) { detach(true); return; }

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
    var endShift = shiftFor(geo.endP);

    setPinned(false);
    finished = true;
    progress = geo.endP;
    render(progress);
    setRestartVisible(true);

    var shrankBy = geo.pinnedH - pin.offsetHeight;
    jumpTo(pastPin > 0 ? y - shrankBy : geo.pinStart - endShift);
  }

  /* ---- letting go mid-run, and taking hold again -------------------
     THE PROBLEM. Progress ratchets forward, so with the pin in force
     scrolling back up does nothing whatsoever: the stage stays stuck,
     the frame stays frozen, and the reader can push thousands of
     pixels of scroll into a page that will not move. There is no
     way out of it except reaching the end. It reads as a broken
     page, and it is worse than the thing the ratchet was protecting
     against.

     THE FIX is the move finish() already makes, only earlier and
     reversibly: drop the pin, correct the scroll so the frame does
     not move, and let the section be an ordinary block. Everything
     revealed stays revealed, the vehicle stays parked where it
     stopped, and the reader scrolls the whole timeline under their
     own power in either direction.

     NOTHING IS SPENT BY LEAVING. `progress` is not touched by any of
     this, so the run has not lost its place — and because the reveal
     and the vehicle are pure functions of it, the released section
     paints the same frame without any special casing. The scroll
     position that preserved the frame on the way out is the position
     that preserves it on the way back in, which is why releasedY()
     is both the landing point and the trigger.

     `correct` is false only for the reader who left the section in a
     single jump rather than by scrolling — see onScroll. */
  function detach(correct) {
    if (!pinned || !geo || finished) return;
    var y = releasedY();
    setPinned(false);
    draw();
    if (correct) jumpTo(y);
  }

  /* Buy the scroll distance back and put the reader at the pinned
     position for the progress they left at. Measured twice for the
     same reason restart() is: setPinned() has just changed the
     document height and the scroll target is meaningless until that
     is accounted for.

     WHATEVER THEY SCROLLED PAST THE TRIGGER IS DROPPED, and that is
     the deliberate choice. Handing it to the ratchet instead was the
     first version and it reads worse: released, a pixel of scrolling
     moves the page a pixel; pinned, it drives the vehicle. There is
     exactly one scroll position per frame, so a handover that
     happens some way past the trigger has to jump by that much
     however it is done — the question is only what else moves with
     it. Carrying it forward compounds the jump anywhere the timeline
     is in motion: mid-lift the line travels well over a pixel per
     pixel scrolled, so a 40px overshoot landed as a ~100px lurch.
     Dropping it holds the jump to the overshoot alone, in every
     phase, which is the floor. The cost is at most one scroll
     event's worth of gesture, which nobody can see. */
  function reattach() {
    if (pinned || finished || mode !== 'full' || !geo) return;
    var resumeAt = progress;
    pinned = true;
    measure();
    setPinned(true);
    measure();
    jumpTo(pinnedYFor(resumeAt));
    /* Re-arm the up-scroll watch after the jump, for the same reason
       restart() does. */
    peakY = window.pageYOffset;
    progress = Math.max(resumeAt, rawProgress());
    draw();
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
    finished = false;
    measure();
    setPinned(true);
    /* Re-measure: setPinned just changed the document height, and
       jumpTo needs a pinStart that accounts for it. */
    measure();
    jumpTo(geo.pinStart + PIN_LEAD);
    /* Re-arm the up-scroll watch AFTER the jump. Seeding it from the
       old position — the reader was at the far end of a spent
       animation — would read the jump back to the start as the
       reader scrolling up and release the pin on the spot. */
    peakY = window.pageYOffset;
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
    finished = false;
    peakY = 0;
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
      peakY = window.pageYOffset;
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
