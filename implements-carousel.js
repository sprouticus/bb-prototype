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
