// Zustro Labs · comportamiento mínimo compartido por las tres versiones.
(function () {
  // Menú en celular
  var btn = document.getElementById('menu');
  var nav = document.getElementById('nav');
  if (btn && nav) {
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A' && nav.classList.contains('open')) {
        nav.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Copiar el correo
  var b = document.getElementById('copy'), s = document.getElementById('copied'), m = document.getElementById('mail');
  if (b && s && m) {
    var ok = b.getAttribute('data-ok') || 'Copiado';
    var fallback = b.getAttribute('data-fallback') || 'Seleccionado: copialo con Ctrl+C';
    b.addEventListener('click', function () {
      var t = m.textContent.trim();
      function sel() {
        var r = document.createRange(); r.selectNodeContents(m);
        var g = getSelection(); g.removeAllRanges(); g.addRange(r);
        s.textContent = fallback;
      }
      try { navigator.clipboard.writeText(t).then(function () { s.textContent = ok; }, sel); } catch (e) { sel(); }
    });
  }

  // Modo claro / oscuro: el atributo data-theme manda; si no está, manda el sistema
  var tb = document.getElementById('theme'), root = document.documentElement;
  if (tb) {
    var actual = function () { return root.getAttribute('data-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); };
    var rotular = function () { tb.setAttribute('aria-label', actual() === 'dark' ? tb.getAttribute('data-light') : tb.getAttribute('data-dark')); };
    tb.addEventListener('click', function () {
      var n = actual() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', n);
      try { localStorage.setItem('tema', n); } catch (e) {}
      rotular();
    });
    rotular();
  }

  // Aparición al hacer scroll (sin movimiento si el sistema lo pide)
  var rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var pm = document.querySelector('.phone-mock');
  if (pm && !rm) pm.classList.add('chat-anim');
  var els = document.querySelectorAll('.reveal');
  if (!rm && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    els.forEach(function (el) { io.observe(el); });
  } else {
    els.forEach(function (el) { el.classList.add('in'); });
  }

  // Con "reducir movimiento", el video del hero no arranca solo
  var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (mq.matches) {
    document.querySelectorAll('video[autoplay]').forEach(function (v) { v.removeAttribute('autoplay'); v.pause(); });
  }
})();

// Formulario de contacto: valida, manda a FormSubmit y, si falla, ofrece el correo con el mensaje armado.
(function () {
  var form = document.getElementById('form-contacto'); if (!form) return;
  var err = document.getElementById('form-error'), ok = document.getElementById('form-ok'), fail = document.getElementById('form-fail');
  var mailto = document.getElementById('form-mailto'), enviar = document.getElementById('form-enviar'), d = form.dataset;
  function mostrar(cual) { form.hidden = cual !== 'form'; ok.hidden = cual !== 'ok'; fail.hidden = cual !== 'fail'; }
  function marcar(n, mal) { var el = form.querySelector('[name=' + n + ']'); if (el) el.classList.toggle('invalid', !!mal); }
  function valor(n) { var el = form.querySelector('[name=' + n + ']'); return el ? el.value.trim() : ''; }
  function validar() {
    var nombre = valor('nombre'), email = valor('email'), tel = valor('telefono'), mensaje = valor('mensaje');
    var emailOk = !email || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    var telOk = !tel || /^[\d+()\s.-]{6,}$/.test(tel);
    marcar('nombre', !nombre); marcar('email', (!email && !tel) || !emailOk); marcar('telefono', (!email && !tel) || !telOk); marcar('mensaje', !mensaje);
    if (!nombre) return d.errNombre;
    if (!email && !tel) return d.errContacto;
    if (!emailOk) return d.errEmail;
    if (!telOk) return d.errContacto;
    if (!mensaje) return d.errMensaje;
    return '';
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var problema = validar();
    if (problema) { err.textContent = problema; err.hidden = false; return; }
    err.hidden = true;
    // FormSubmit convierte este JSON en un correo a hola@zustrolabs.com (sin cuenta ni clave; el primer envío pide confirmar el destino)
    var datos = { name: valor('nombre'), email: valor('email'), phone: valor('telefono'), topic: valor('tema'), message: valor('mensaje'), page: location.pathname, lang: document.documentElement.lang,
      _subject: d.asunto + ' · ' + valor('tema') + ' · ' + valor('nombre'), _replyto: valor('email'), _template: 'table', _captcha: 'false', _honey: valor('web') };
    enviar.disabled = true; enviar.textContent = d.enviando;
    fetch(form.getAttribute('action'), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(datos) })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (j) { if (!j || !(j.success === true || j.success === 'true')) throw new Error('respuesta'); mostrar('ok'); form.reset(); })
      .catch(function () {
        var cuerpo = [datos.name, datos.email, datos.phone, datos.topic, '', datos.message].filter(Boolean).join('\n');
        mailto.href = 'mailto:hola@zustrolabs.com?subject=' + encodeURIComponent(d.asunto + ' · ' + datos.name) + '&body=' + encodeURIComponent(cuerpo);
        mostrar('fail');
      })
      .then(function () { enviar.disabled = false; enviar.textContent = d.enviar; });
  });
})();
