/* 상담신청 다이얼로그 — innerHTML 미사용(모든 텍스트는 textContent), 입력 내용은 브라우저에 저장하지 않음 */
(function () {
  'use strict';
  var PHONE_TEXT = '전화 02-523-8434';
  var config = null, dialog = null, els = {}, token = null, current = null, labelOverride = null;

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === 'text') el.textContent = v;
      else if (k === 'className') el.className = v;
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    });
    (children || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }

  function fetchToken() {
    token = String(Date.now());
    fetch('/api/consult', { method: 'GET', credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && typeof j.token === 'string') token = j.token; })
      .catch(function () {});
  }

  function build() {
    dialog = h('dialog', { className: 'consult-dialog', 'aria-labelledby': 'consult-title' });
    var close = h('button', { type: 'button', className: 'consult-close', 'aria-label': '상담신청 닫기', text: '닫기' });
    close.addEventListener('click', function () { dialog.close(); });
    els.kicker = h('p', { className: 'consult-kicker' });
    els.title = h('h2', { id: 'consult-title' });
    els.desc = h('p', { className: 'consult-desc' });
    els.chooser = h('div', { className: 'consult-chooser' });
    config.fields.forEach(function (f) {
      var b = h('button', { type: 'button', className: 'consult-choice', 'data-field': f.key }, [h('strong', { text: f.label }), h('span', { text: f.summary || '' })]);
      b.addEventListener('click', function () { showForm(f.key); });
      els.chooser.appendChild(b);
    });
    els.form = h('form', { className: 'consult-form', novalidate: true });
    els.form.addEventListener('submit', onSubmit);
    els.status = h('p', { className: 'consult-status', role: 'status', 'aria-live': 'polite' });
    els.done = h('div', { className: 'consult-done', hidden: true }, [
      h('h3', { text: '상담신청이 접수되었습니다' }),
      h('p', { text: '남겨주신 연락처로 연락드리겠습니다. 급한 문의는 ' + PHONE_TEXT + '로 연락 부탁드립니다.' })
    ]);
    var phone = h('p', { className: 'consult-phone' }, ['전화로 바로 문의하셔도 됩니다. ', h('a', { href: 'tel:025238434', text: PHONE_TEXT })]);
    dialog.append(close, els.kicker, els.title, els.desc, els.chooser, els.form, els.done, phone);
    dialog.addEventListener('click', function (e) {
      if (e.target !== dialog) return;
      var r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
    });
    document.body.appendChild(dialog);
  }

  function inputFor(def) {
    var id = 'c-' + def.name;
    var label = h('label', { for: id }, [def.label, def.required ? h('span', { className: 'req', text: ' 필수' }) : h('span', { className: 'opt', text: ' 선택' })]);
    var ctl;
    if (def.type === 'select') {
      ctl = h('select', { id: id, name: def.name, required: !!def.required });
      ctl.appendChild(h('option', { value: '', text: '선택해 주세요' }));
      def.options.forEach(function (o) { ctl.appendChild(h('option', { value: o, text: o })); });
    } else if (def.type === 'textarea') {
      ctl = h('textarea', { id: id, name: def.name, rows: '4', maxlength: String(def.max), placeholder: def.placeholder || '', required: !!def.required });
    } else {
      ctl = h('input', {
        id: id, name: def.name, type: def.type === 'tel' ? 'tel' : def.type === 'email' ? 'email' : 'text',
        maxlength: String(def.max), minlength: def.min ? String(def.min) : null, placeholder: def.placeholder || '',
        pattern: def.type === 'tel' ? '0[0-9]{1,2}-?[0-9]{3,4}-?[0-9]{4}' : null,
        autocomplete: def.autocomplete || 'off', inputmode: def.type === 'tel' ? 'tel' : null, required: !!def.required
      });
    }
    var wrap = h('div', { className: 'consult-row' + (def.half ? ' half' : '') }, [label, ctl]);
    if (def.type === 'textarea' && config.messageNotice) {
      ctl.setAttribute('aria-describedby', id + '-notice');
      wrap.appendChild(h('p', { id: id + '-notice', className: 'consult-notice', text: config.messageNotice }));
    }
    if (def.type === 'textarea') {
      var counter = h('small', { className: 'consult-count', text: '0 / ' + def.max });
      ctl.addEventListener('input', function () { counter.textContent = Array.from(ctl.value).length + ' / ' + def.max; });
      wrap.appendChild(counter);
    }
    return wrap;
  }

  /* 항목별 동의(기본 모두 해제). 필수 항목이 모두 체크되어야 제출 버튼이 활성화됩니다. */
  function consentBlock() {
    var box = h('fieldset', { className: 'consult-consents' }, [h('legend', { text: '개인정보 동의' })]);
    config.consents.forEach(function (d) {
      var id = 'c-consent-' + d.key;
      var cb = h('input', { id: id, name: 'consent_' + d.key, type: 'checkbox', required: !!d.required, 'data-consent': d.key });
      cb.addEventListener('change', syncSubmit);
      var details = h('details', { className: 'consult-consent-detail' }, [
        h('summary', { text: '상세 고지 보기' }),
        d.title ? h('p', { className: 'consult-consent-title', text: d.title }) : null,
        d.intro ? h('p', { text: d.intro }) : null,
        d.items && d.items.length ? h('ul', {}, d.items.map(function (t) { return h('li', { text: t }); })) : null
      ]);
      box.appendChild(h('div', { className: 'consult-consent-item' }, [
        h('label', { for: id }, [cb, h('span', { text: d.label })]),
        details
      ]));
    });
    return box;
  }

  function requiredConsentsOk() {
    if (!config.consents) return true;
    return config.consents.every(function (d) {
      if (!d.required) return true;
      var cb = els.form.querySelector('[data-consent="' + d.key + '"]');
      return !!(cb && cb.checked);
    });
  }

  function syncSubmit() {
    var btn = els.form && els.form.querySelector('.consult-submit');
    if (!btn || btn.getAttribute('aria-busy') === 'true') return;
    btn.disabled = !requiredConsentsOk();
  }

  function showChooser() {
    current = null;
    els.kicker.textContent = labelOverride || '상담신청';
    els.title.textContent = config.chooserTitle;
    els.desc.textContent = config.chooserDesc;
    els.chooser.hidden = false; els.form.hidden = true; els.done.hidden = true;
    var c = els.chooser.querySelector('button'); if (c) c.focus();
  }

  function showForm(key) {
    var f = config.fields.find(function (x) { return x.key === key; });
    if (!f) return showChooser();
    current = f;
    var name = labelOverride || f.label + ' 상담';
    els.kicker.textContent = name;
    els.title.textContent = f.title;
    els.desc.textContent = f.desc;
    els.chooser.hidden = true; els.done.hidden = true; els.form.hidden = false;
    els.form.replaceChildren();
    if (config.fields.length > 1) {
      var back = h('button', { type: 'button', className: 'consult-back', text: '다른 분야 선택' });
      back.addEventListener('click', function () { labelOverride = null; showChooser(); });
      els.form.appendChild(back);
    }
    var grid = h('div', { className: 'consult-grid' });
    f.inputs.concat(config.common).forEach(function (d) { grid.appendChild(inputFor(d)); });
    els.form.appendChild(grid);
    els.form.appendChild(h('div', { className: 'consult-hp', 'aria-hidden': 'true' }, [
      h('label', { for: 'c-website', text: '웹사이트' }),
      h('input', { id: 'c-website', name: 'website', type: 'text', tabindex: '-1', autocomplete: 'off' })
    ]));
    if (config.consents) els.form.appendChild(consentBlock());
    else els.form.appendChild(h('div', { className: 'consult-consent' }, [
      h('label', { for: 'c-consent' }, [h('input', { id: 'c-consent', name: 'consent', type: 'checkbox', required: true }), ' [필수] 개인정보 수집·이용에 동의합니다']),
      h('ul', {}, config.consentItems.map(function (t) { return h('li', { text: t }); }))
    ]));
    var submitBtn = h('button', { type: 'submit', className: 'button consult-submit', text: name + ' 신청하기' });
    els.form.appendChild(submitBtn);
    els.status.textContent = '';
    els.form.appendChild(els.status);
    if (config.privacyUrl) els.form.appendChild(h('p', { className: 'consult-privacy' }, [h('a', { href: config.privacyUrl, target: '_blank', rel: 'noopener', text: '개인정보 처리방침' })]));
    syncSubmit();
    var first = els.form.querySelector('.consult-grid select, .consult-grid input, .consult-grid textarea');
    if (first) first.focus();
  }

  function onSubmit(e) {
    e.preventDefault();
    if (!current) return;
    var form = els.form;
    if (!form.checkValidity()) {
      els.status.textContent = '필수 항목과 입력 형식을 확인해 주세요.';
      var bad = form.querySelector(':invalid'); if (bad) bad.focus();
      return;
    }
    if (!requiredConsentsOk()) { els.status.textContent = '필수 동의 항목에 체크해 주세요.'; return; }
    var payload = { field: current.key, token: token, website: form.elements.website.value };
    if (config.consents) {
      payload.consents = {};
      config.consents.forEach(function (d) { payload.consents[d.key] = !!form.querySelector('[data-consent="' + d.key + '"]').checked; });
    } else payload.consent = form.elements.consent.checked;
    current.inputs.concat(config.common).forEach(function (d) { var v = form.elements[d.name].value.trim(); if (v) payload[d.name] = v; });
    var submit = form.querySelector('.consult-submit');
    submit.disabled = true; submit.setAttribute('aria-busy', 'true');
    els.status.textContent = '보내는 중입니다…';
    fetch('/api/consult', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        submit.removeAttribute('aria-busy'); syncSubmit(); if (!config.consents) submit.disabled = false;
        if (res.status === 200 && res.body.ok) { form.reset(); form.hidden = true; els.done.hidden = false; return; }
        var code = res.body && res.body.code;
        els.status.textContent = ({
          400: code === 'TIMING' ? '잠시 후 다시 시도해 주세요.'
            : code === 'SENSITIVE' ? '주민등록번호·계좌번호 등 민감한 정보가 포함된 것 같습니다. 해당 내용을 지우고 다시 신청해 주세요.'
            : code === 'CONSENT' ? '필수 동의 항목에 체크해 주세요.'
            : '입력 내용을 다시 확인해 주세요.',
          413: '입력 내용이 너무 깁니다. 문의 내용을 줄여 주세요.',
          429: '짧은 시간에 여러 번 신청되어 잠시 제한되었습니다. 잠시 후 다시 시도해 주세요.',
          503: '접수 일시 오류: 지금은 온라인 접수가 되지 않습니다. ' + PHONE_TEXT + '로 연락 부탁드립니다.',
          502: '접수 일시 오류: 잠시 후 다시 시도하시거나 ' + PHONE_TEXT + '로 연락 부탁드립니다.'
        })[res.status] || '접수 중 문제가 생겼습니다. ' + PHONE_TEXT + '로 연락 부탁드립니다.';
      })
      .catch(function () { submit.removeAttribute('aria-busy'); submit.disabled = false; syncSubmit(); els.status.textContent = '네트워크 연결을 확인해 주세요. ' + PHONE_TEXT; });
  }

  function loadConfig() {
    return fetch('/consult-forms.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (j) { config = j; return j; });
  }

  function open(key, label) {
    if (!config) { loadConfig().then(function () { open(key, label); }).catch(function () { window.location.href = 'tel:025238434'; }); return; }
    if (!dialog) build();
    labelOverride = label || null;
    fetchToken();
    if (!dialog.open) dialog.showModal();
    if (key) showForm(key); else showChooser();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-consult]');
    if (!t) return;
    e.preventDefault();
    open(t.getAttribute('data-consult') || '', t.getAttribute('data-consult-label') || '');
  });
  loadConfig().catch(function () {});
})();
