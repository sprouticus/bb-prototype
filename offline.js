(function () {
  if (!('serviceWorker' in navigator)) return;
  var script = document.currentScript;
  var swUrl = new URL('sw.js', script ? script.src : location.href);
  var standalone = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

  var box = null;
  var hideTimer = null;

  function show(text, done) {
    if (!box) {
      box = document.createElement('div');
      box.className = 'offline-status';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.classList.add('show');
    clearTimeout(hideTimer);
    if (done) {
      hideTimer = setTimeout(function () { box.classList.remove('show'); }, 5000);
    }
  }

  function save(worker) {
    if (!navigator.onLine) return;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    show('Saving the site for offline use…');
    worker.postMessage({ type: 'save-site' });
  }

  navigator.serviceWorker.addEventListener('message', function (event) {
    var msg = event.data || {};
    if (!standalone) return;
    if (msg.type === 'progress') {
      show('Saving the site for offline use… ' + msg.done + ' of ' + msg.total);
    } else if (msg.type === 'saved') {
      show(msg.failed ? 'Some files did not save. Open the app again on wifi to finish.' : 'Saved. The site will work without internet.', true);
    }
  });

  window.addEventListener('load', function () {
    navigator.serviceWorker.register(swUrl.href, { scope: new URL('./', swUrl).href }).then(function () {
      if (!standalone) return;
      return navigator.serviceWorker.ready.then(function (reg) {
        if (reg.active && !sessionStorageGet()) {
          sessionStorageSet();
          save(reg.active);
        }
      });
    }).catch(function () {});
  });

  function sessionStorageGet() {
    try { return sessionStorage.getItem('bb-offline-saved') === '1'; } catch (e) { return false; }
  }

  function sessionStorageSet() {
    try { sessionStorage.setItem('bb-offline-saved', '1'); } catch (e) {}
  }

  window.bbSaveOffline = function () {
    return navigator.serviceWorker.ready.then(function (reg) {
      standalone = true;
      save(reg.active);
    });
  };
})();
