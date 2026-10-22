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
    var cerrar = function () { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A' && nav.classList.contains('open')) cerrar();
    });
    // Escape o un toque fuera del menú lo cierran
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) { cerrar(); btn.focus(); }
    });
    document.addEventListener('click', function (e) {
      if (nav.classList.contains('open') && !nav.contains(e.target) && !btn.contains(e.target)) cerrar();
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

// Formulario de contacto: valida, lo manda a /api/contacto (Worker propio en Cloudflare, ver worker/)
// y, si falla, ofrece el correo con el mensaje armado. Nada de lo que escribe la persona se mete como HTML.
(function () {
  var form = document.getElementById('form-contacto'); if (!form) return;
  var inicio = Date.now();
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
    // El Worker valida todo de nuevo y lo manda por correo a la casilla del estudio; no guarda nada.
    // «web» es el campo trampa y «t» los milisegundos desde que cargó el formulario (un bot tarda menos de 2,5 s).
    var datos = { nombre: valor('nombre'), email: valor('email'), telefono: valor('telefono'), tema: valor('tema'), mensaje: valor('mensaje'),
      pagina: location.pathname, idioma: document.documentElement.lang, web: valor('web'), t: Date.now() - inicio };
    enviar.disabled = true; enviar.textContent = d.enviando;
    var corte = typeof AbortController === 'function' ? new AbortController() : null;
    var reloj = corte ? setTimeout(function () { corte.abort(); }, 15000) : 0;
    fetch(form.getAttribute('action'), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(datos), credentials: 'omit', signal: corte ? corte.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (j) { if (!j || j.ok !== true) throw new Error('respuesta'); mostrar('ok'); form.reset(); })
      .catch(function () {
        var cuerpo = [datos.nombre, datos.email, datos.telefono, datos.tema, '', datos.mensaje].filter(Boolean).join('\n');
        mailto.href = 'mailto:contact@zustrolabs.com?subject=' + encodeURIComponent(d.asunto + ' · ' + datos.nombre) + '&body=' + encodeURIComponent(cuerpo);
        mostrar('fail');
      })
      .then(function () { clearTimeout(reloj); enviar.disabled = false; enviar.textContent = d.enviar; });
  });
})();

// Asistente «Preguntale a Zustro» (ZL-105): manda la pregunta a /api/chat (Worker propio, ver asistente/)
// y muestra la respuesta como texto. La charla vive solo en esta variable: no se guarda en el navegador ni en el Worker.
// Los botones de cada respuesta los arma esta página con sus propios links; la IA solo elige de una lista cerrada.
(function () {
  var raiz = document.getElementById('asis'); if (!raiz || !window.fetch || !window.JSON) return;
  var abrir = document.getElementById('asis-abrir'), panel = document.getElementById('asis-panel');
  var cerrar = document.getElementById('asis-cerrar'), log = document.getElementById('asis-log');
  var form = document.getElementById('asis-form'), texto = document.getElementById('asis-texto');
  var enviar = document.getElementById('asis-enviar'), sug = document.getElementById('asis-sug'), d = raiz.dataset;
  var lang = document.documentElement.lang || 'es';
  var CLAVES = ['servicios', 'productos', 'equipo', 'origen', 'contacto'];
  var ids = (d.ids || '').split(' ');
  var ENLACES = { radar: 'https://radar.zustrolabs.com', sahovnica: 'https://croata.zustrolabs.com', codigo_radar: 'https://github.com/JeremiasGiglio/radar-croacia' };
  var charla = [], ocupado = false;

  function abierto() { return !panel.hidden; }
  function mostrar(si) {
    panel.hidden = !si;
    raiz.classList.toggle('abierto', si);
    abrir.setAttribute('aria-expanded', si ? 'true' : 'false');
    if (si) texto.focus(); else abrir.focus();
  }
  abrir.hidden = false;
  abrir.addEventListener('click', function () { mostrar(true); });
  cerrar.addEventListener('click', function () { mostrar(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && abierto()) mostrar(false); });

  function burbuja(quien, contenido) {
    var p = document.createElement('p');
    p.className = 'asis-msg de-' + quien;
    var q = document.createElement('span');
    q.className = 'vh';
    q.textContent = (quien === 'vos' ? d.vos : d.zustro) + ': ';
    p.appendChild(q);
    p.appendChild(document.createTextNode(contenido));
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
    return p;
  }
  function chip(cont, href, rotulo, externo, clase) {
    if (!rotulo) return;
    var a = document.createElement('a');
    a.href = href; a.textContent = rotulo + (externo ? ' ↗' : '');
    if (clase) a.className = clase;
    if (externo) { a.target = '_blank'; a.rel = 'noopener'; }
    else a.addEventListener('click', function () { mostrar(false); });
    cont.appendChild(a);
  }
  function botones(p, r) {
    var cont = document.createElement('span');
    cont.className = 'asis-chips';
    (r.secciones || []).forEach(function (s) {
      var i = CLAVES.indexOf(s); if (i < 0 || !ids[i]) return;
      var a = document.querySelector('footer a[href="#' + ids[i] + '"]');
      chip(cont, '#' + ids[i], a && a.textContent.trim(), false);
    });
    (r.enlaces || []).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(ENLACES, k)) return;
      var a = document.querySelector('footer a[href="' + ENLACES[k] + '"]');
      chip(cont, ENLACES[k], a && a.textContent.trim(), true);
    });
    if (r.escribirnos && ids[4]) chip(cont, '#' + ids[4], d.escribirnos, false, 'escribir');
    if (cont.childNodes.length) { p.appendChild(cont); log.scrollTop = log.scrollHeight; }
  }

  function preguntar(q) {
    q = String(q || '').trim().slice(0, 500);
    if (!q || ocupado) return;
    ocupado = true; enviar.disabled = true; sug.hidden = true;
    burbuja('vos', q);
    charla.push({ de: 'persona', texto: q });
    var espera = burbuja('zustro', d.pensando);
    espera.classList.add('pensando');
    var corte = typeof AbortController === 'function' ? new AbortController() : null;
    var reloj = corte ? setTimeout(function () { corte.abort(); }, 30000) : 0;
    fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, credentials: 'omit',
      body: JSON.stringify({ idioma: lang, mensajes: charla.slice(-8) }), signal: corte ? corte.signal : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { estado: r.status, j: j }; }); })
      .then(function (x) {
        espera.remove();
        if (x.estado === 200 && x.j && x.j.ok === true && typeof x.j.respuesta === 'string') {
          charla.push({ de: 'asistente', texto: x.j.respuesta });
          botones(burbuja('zustro', x.j.respuesta), x.j);
        } else if (x.estado === 429) {
          burbuja('zustro', d.limite);
        } else {
          botones(burbuja('zustro', d.falla), { escribirnos: true });
        }
      })
      .catch(function () { espera.remove(); botones(burbuja('zustro', d.falla), { escribirnos: true }); })
      .then(function () { clearTimeout(reloj); ocupado = false; enviar.disabled = false; if (abierto()) texto.focus(); });
  }
  form.addEventListener('submit', function (e) { e.preventDefault(); var q = texto.value; texto.value = ''; preguntar(q); });
  sug.addEventListener('click', function (e) { if (e.target.tagName === 'BUTTON') preguntar(e.target.textContent); });
})();
