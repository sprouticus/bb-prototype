(function () {
  var FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxPNaIHYkC7CG9ki8lYCcvQLMtPIW-fwi_X9SSL3scLqp3OXRYzwpHIyAUpqp5KTyw/exec';

  function track(formName) {
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'generate_lead', { form_name: formName });
    }
  }

  window.bbSubmitForm = function (form, extra) {
    if (!FORM_ENDPOINT) {
      return Promise.reject(new Error('not-configured'));
    }
    var params = new URLSearchParams(new FormData(form));
    params.append('form', form.getAttribute('data-form') || '');
    params.append('page', location.pathname);
    if (extra) {
      Object.keys(extra).forEach(function (k) { params.append(k, extra[k]); });
    }
    return fetch(FORM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: params.toString()
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.ok) track(form.getAttribute('data-form') || 'form');
        return data;
      });
  };

  function showError(form, msg) {
    var box = form.querySelector('.form-error');
    if (!box) {
      box = document.createElement('p');
      box.className = 'form-error';
      box.setAttribute('role', 'alert');
      form.appendChild(box);
    }
    box.textContent = msg;
  }

  document.querySelectorAll('form[data-form][data-success-target]').forEach(function (form) {
    var success = document.getElementById(form.getAttribute('data-success-target'));
    var btn = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Sending…';

      window.bbSubmitForm(form)
        .then(function (data) {
          if (data && data.ok) {
            form.hidden = true;
            if (success) {
              success.classList.add('show');
              success.setAttribute('tabindex', '-1');
              success.focus();
            }
          } else {
            throw new Error((data && data.error) || 'failed');
          }
        })
        .catch(function () {
          btn.disabled = false;
          btn.textContent = label;
          showError(form, 'That did not go through. Please try again, or email info@bbengineering.us or call 505-226-5944.');
        });
    });
  });
})();
