(function () {
  var GA_ID = 'G-HE7WL42B5C';
  var KEY = 'bb-consent-v1';

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    wait_for_update: 500
  });

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function write(choice) {
    try { localStorage.setItem(KEY, JSON.stringify(choice)); } catch (e) {}
  }

  function apply(choice) {
    var ads = choice.marketing ? 'granted' : 'denied';
    gtag('consent', 'update', {
      analytics_storage: choice.analytics ? 'granted' : 'denied',
      ad_storage: ads,
      ad_user_data: ads,
      ad_personalization: ads
    });
  }

  var saved = read();
  if (saved) apply(saved);

  if (/^G-[A-Z0-9]+$/.test(GA_ID) && GA_ID !== 'G-XXXXXXXXXX') {
    gtag('js', new Date());
    gtag('config', GA_ID);
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
  }

  var banner;

  function save(choice) {
    choice.at = new Date().toISOString();
    write(choice);
    apply(choice);
    if (banner) banner.hidden = true;
  }

  function build() {
    banner = document.createElement('section');
    banner.className = 'cookie-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Cookie choices');
    banner.hidden = true;
    banner.innerHTML =
      '<div class="cookie-banner__inner">' +
        '<button type="button" class="cookie-banner__close" data-consent-close aria-label="Close"><svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' +
        '<p class="cookie-banner__text">This site uses cookies for analytics, performance, and marketing. Learn more in our <a href="/privacy-policy.html">Privacy Policy</a>.</p>' +
        '<div class="cookie-banner__prefs" hidden>' +
          '<label><input type="checkbox" checked disabled> Necessary <span>Required for the site to work. Always on.</span></label>' +
          '<label><input type="checkbox" data-consent="analytics"> Analytics <span>Helps us see which pages people visit and how the site is used.</span></label>' +
          '<label><input type="checkbox" data-consent="marketing"> Marketing <span>Helps us measure and improve our advertising.</span></label>' +
        '</div>' +
        '<div class="cookie-banner__actions">' +
          '<button type="button" class="btn btn-orange" data-consent-all>Accept</button>' +
          '<button type="button" class="btn btn-outline" data-consent-none>Reject</button>' +
          '<button type="button" class="btn btn-outline" data-consent-save hidden>Save choices</button>' +
          '<button type="button" class="cookie-banner__link" data-consent-choose>Cookie settings</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(banner);

    var prefs = banner.querySelector('.cookie-banner__prefs');
    var chooseBtn = banner.querySelector('[data-consent-choose]');
    var saveBtn = banner.querySelector('[data-consent-save]');
    var boxA = banner.querySelector('[data-consent="analytics"]');
    var boxM = banner.querySelector('[data-consent="marketing"]');

    banner.querySelector('[data-consent-all]').addEventListener('click', function () {
      save({ analytics: true, marketing: true });
    });
    banner.querySelector('[data-consent-none]').addEventListener('click', function () {
      save({ analytics: false, marketing: false });
    });
    function openPrefs() {
      prefs.hidden = false;
      saveBtn.hidden = false;
      chooseBtn.hidden = true;
    }
    chooseBtn.addEventListener('click', function () {
      openPrefs();
      boxA.focus();
    });
    function closeBanner() {
      if (!read()) save({ analytics: false, marketing: false });
      else banner.hidden = true;
    }
    banner.querySelector('[data-consent-close]').addEventListener('click', closeBanner);
    banner.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeBanner();
    });
    saveBtn.addEventListener('click', function () {
      save({ analytics: boxA.checked, marketing: boxM.checked });
    });

    window.bbOpenCookieSettings = function () {
      var current = read() || {};
      boxA.checked = !!current.analytics;
      boxM.checked = !!current.marketing;
      openPrefs();
      banner.hidden = false;
      boxA.focus();
    };

    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-cookie-settings]');
      if (!t) return;
      e.preventDefault();
      window.bbOpenCookieSettings();
    });

    if (!saved) banner.hidden = false;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
