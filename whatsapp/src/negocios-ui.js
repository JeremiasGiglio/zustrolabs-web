// Interfaz de negocios.zustrolabs.com (ZL-121): una sola página, sin librerías, pensada primero para el celular.
// - El código de la app es la función `app` de abajo: se manda al navegador con su .toString() (así no hay que
//   escapar nada dentro de un texto), junto con el lector de planillas (lector.js).
// - Todo lo que viene de la base se pone con textContent (función h): nunca como HTML.
import { FUNCIONES_LECTOR } from './lector.js';

export const APP_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Negocios · Zustro Labs</title><meta name="robots" content="noindex"><meta name="theme-color" content="#C8102E">
<link rel="stylesheet" href="/app.css"></head>
<body><div id="app"><p class="cargando">Cargando…</p></div><script src="/app.js"></script></body></html>`;

export const APP_CSS = `:root{--rojo:#C8102E;--tinta:#1B2230;--gris:#5A6270;--linea:#E3E6EB;--fondo:#F6F7F9;--ok:#1E7B4E;--alerta:#B25E00}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--tinta);background:var(--fondo)}
button,input,select,textarea{font:inherit;color:inherit}
.cargando{padding:2rem;text-align:center;color:var(--gris)}
.top{display:flex;align-items:center;gap:.6rem;padding:.6rem 1rem;background:#fff;border-bottom:1px solid var(--linea);position:sticky;top:0;z-index:5;flex-wrap:wrap}
.marca{display:flex;align-items:center;gap:.5rem;font-weight:700;letter-spacing:.02em;margin-right:auto}
.marca svg{width:22px;height:22px}.marca span{font-size:1.05rem}
.top select{max-width:14rem}.yo{color:var(--gris);font-size:.85rem}
.tabs{display:flex;gap:.25rem;padding:0 1rem;background:#fff;border-bottom:1px solid var(--linea);overflow-x:auto}
.tabs button{border:0;background:none;padding:.7rem .8rem;border-bottom:3px solid transparent;color:var(--gris);cursor:pointer;white-space:nowrap}
.tabs button[aria-selected="true"]{color:var(--tinta);border-bottom-color:var(--rojo);font-weight:600}
main{max-width:960px;margin:0 auto;padding:1rem}
h2{margin:.2rem 0 .8rem;font-size:1.25rem}h3{margin:1.2rem 0 .5rem;font-size:1.05rem}
.barra{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:.8rem}
.barra input[type=search]{flex:1 1 12rem;min-width:0}
input[type=text],input[type=search],input[type=number],input[type=email],select,textarea{border:1px solid #C9CED6;border-radius:8px;padding:.55rem .65rem;background:#fff;width:100%}
.barra select,.barra input[type=search]{width:auto}
textarea{min-height:6rem;resize:vertical}textarea.ficha{min-height:24rem;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace}
label{display:block;font-size:.9rem;font-weight:600;margin:.7rem 0 .25rem}
label.check{display:flex;align-items:center;gap:.45rem;font-weight:400}
.ayuda{font-size:.85rem;color:var(--gris);margin:.2rem 0}
.btn{display:inline-flex;align-items:center;gap:.35rem;border:1px solid #C9CED6;background:#fff;border-radius:8px;padding:.5rem .85rem;cursor:pointer;text-decoration:none}
.btn:hover{border-color:var(--tinta)}.btn.prim{background:var(--rojo);border-color:var(--rojo);color:#fff;font-weight:600}
.btn.peligro{color:var(--rojo);border-color:var(--rojo)}.btn[disabled]{opacity:.5;cursor:default}
.chips{display:flex;flex-wrap:wrap;gap:.4rem;margin:.2rem 0 .8rem}
.chip{font-size:.8rem;padding:.15rem .55rem;border-radius:99px;background:#fff;border:1px solid var(--linea);color:var(--gris)}
.chip.mal{background:#FDECEE;border-color:#F3C2C9;color:var(--rojo)}.chip.ok{background:#E8F5EE;border-color:#BFE3CF;color:var(--ok)}
.chip.alerta{background:#FFF4E5;border-color:#F5D3A6;color:var(--alerta)}
.lista{list-style:none;margin:0;padding:0;display:grid;gap:.5rem}
.prod{display:grid;grid-template-columns:56px 1fr;gap:.7rem;background:#fff;border:1px solid var(--linea);border-radius:12px;padding:.6rem}
.prod.pausado{opacity:.6}
.foto{width:56px;height:56px;border-radius:8px;background:var(--fondo) center/cover no-repeat;border:1px solid var(--linea);display:flex;align-items:center;justify-content:center;color:#B7BDC6;font-size:1.4rem;overflow:hidden}
.foto img{width:100%;height:100%;object-fit:cover}
.prod .nombre{font-weight:600;border:0;background:none;padding:0;text-align:left;cursor:pointer;text-decoration:underline;text-decoration-color:#C9CED6;text-underline-offset:3px}
.prod .meta{font-size:.82rem;color:var(--gris)}
.prod .fila{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .9rem;margin-top:.35rem}
.precio{font-weight:600}
.stock{display:inline-flex;align-items:center;border:1px solid #C9CED6;border-radius:8px;overflow:hidden;background:#fff}
.stock button{border:0;background:var(--fondo);width:2.3rem;height:2.1rem;font-size:1.15rem;cursor:pointer}
.stock span{min-width:2.6rem;text-align:center;font-weight:600}
.stock.cero span{color:var(--rojo)}
.tabla{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--linea);border-radius:12px;overflow:hidden;font-size:.9rem}
.tabla th,.tabla td{padding:.45rem .55rem;border-bottom:1px solid var(--linea);text-align:left;vertical-align:top}
.tabla th{background:var(--fondo);font-size:.8rem;color:var(--gris)}
.scroll{overflow-x:auto}
.caja{background:#fff;border:1px solid var(--linea);border-radius:12px;padding:1rem;margin-bottom:1rem}
.soltar{border:2px dashed #C9CED6;border-radius:12px;padding:1.5rem;text-align:center;background:#fff}
.soltar.encima{border-color:var(--rojo);background:#FFF7F8}
.errores{color:var(--rojo);font-size:.9rem}.errores li{margin:.15rem 0}
.toast{position:fixed;left:50%;bottom:1rem;transform:translateX(-50%);background:var(--tinta);color:#fff;padding:.6rem 1rem;border-radius:10px;max-width:calc(100% - 2rem);box-shadow:0 6px 20px rgba(0,0,0,.2);z-index:20}
.toast.mal{background:var(--rojo)}
dialog{border:0;border-radius:14px;padding:0;width:min(34rem,calc(100% - 1.5rem));max-height:calc(100% - 2rem)}
dialog::backdrop{background:rgba(27,34,48,.45)}
dialog form{padding:1rem 1.1rem}
.dosc{display:grid;grid-template-columns:1fr 1fr;gap:0 .7rem}
.acciones{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:flex-end;margin-top:1rem}
.acciones .izq{margin-right:auto}
.vista-foto{display:flex;align-items:center;gap:.7rem;flex-wrap:wrap}
.oculto{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
a.btn,label.btn{color:inherit;font-weight:400;margin:0}
.foto .ini{font-weight:700;color:#9AA1AC;font-size:1.3rem}.vista-foto .foto{width:72px;height:72px}
.chat{display:grid;gap:.4rem;max-height:26rem;overflow:auto;padding:.5rem;background:var(--fondo);border-radius:10px;margin:.5rem 0}
.burbuja{max-width:85%;padding:.5rem .7rem;border-radius:12px;white-space:pre-wrap;font-size:.92rem}
.burbuja.cliente{justify-self:end;background:var(--tinta);color:#fff}.burbuja.asis{justify-self:start;background:#fff;border:1px solid var(--linea)}
.vacio{padding:2rem 1rem;text-align:center;color:var(--gris);background:#fff;border:1px dashed var(--linea);border-radius:12px}
@media (min-width:700px){.prod{grid-template-columns:64px 1fr}.foto{width:64px;height:64px}}`;

/** El programa de la página (corre en el navegador). */
function app() {
  'use strict';
  const estado = { yo: null, negocio: null, datos: null, tab: 'productos', categoria: '', q: '', pausados: true };
  const raiz = document.getElementById('app');

  function h(tag, props, ...hijos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === false || v === null || v === undefined) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of hijos.flat(9)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }
  /** Reemplaza el contenido salteando lo vacío (replaceChildren escribiría «null»). */
  function poner(el, ...hijos) {
    el.replaceChildren(...hijos.flat(9).filter((c) => c !== null && c !== undefined && c !== false));
  }
  let ids = 0;
  /** Etiqueta unida a su campo (for/id): el lector de pantalla dice qué es cada campo. */
  function etiqueta(texto, campo) {
    if (!campo.id) campo.id = 'c' + (++ids);
    return h('label', { for: campo.id }, texto);
  }
  const pesos = (n) => '$ ' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
  const fecha = (t) => new Date(t).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
  let avisoT;
  function aviso(texto, mal) {
    let a = document.getElementById('aviso');
    if (!a) { a = h('div', { id: 'aviso', role: 'status', 'aria-live': 'polite' }); document.body.append(a); }
    a.className = 'toast' + (mal ? ' mal' : '');
    a.textContent = texto;
    a.hidden = false;
    clearTimeout(avisoT);
    avisoT = setTimeout(() => { a.hidden = true; }, mal ? 6000 : 2500);
  }
  async function api(ruta, op) {
    op = op || {};
    const metodo = op.metodo || 'GET';
    const headers = {};
    let body;
    if (metodo !== 'GET') headers['x-zl'] = '1';
    if (op.blob) { body = op.blob; headers['content-type'] = op.blob.type; }
    else if (op.cuerpo !== undefined) { body = JSON.stringify(op.cuerpo); headers['content-type'] = 'application/json'; }
    const r = await fetch('/api' + ruta, { method: metodo, headers, body, credentials: 'same-origin' });
    if (r.status === 401) { aviso('Tu sesión venció: recargá la página para entrar de nuevo.', true); throw new Error('sesión'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || 'Algo falló. Probá de nuevo.'), { datos: d });
    return d;
  }
  const base = () => '/n/' + estado.negocio;
  const conError = (fn) => async (...a) => { try { await fn(...a); } catch (e) { if (e.message !== 'sesión') aviso(e.message, true); } };

  // ── Armado general ──
  function logo() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 3 3');
    svg.setAttribute('aria-hidden', 'true');
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', 1); r.setAttribute('height', 1);
      r.setAttribute('fill', (x + y) % 2 === 0 ? '#C8102E' : '#FFFFFF'); // la primera casilla, roja
      r.setAttribute('stroke', '#E3E6EB'); r.setAttribute('stroke-width', '.04');
      svg.append(r);
    }
    return svg;
  }
  const PESTANAS = () => [['productos', 'Productos'], ['importar', 'Importar Excel'], ['historial', 'Historial']]
    .concat(estado.yo.admin ? [['asistente', 'Asistente'], ['admin', 'Administración']] : []);

  function pintar() {
    poner(raiz);
    const sel = estado.yo.negocios.length > 1 || estado.yo.admin
      ? h('select', { 'aria-label': 'Negocio', onchange: (e) => { estado.negocio = e.target.value; recordar(); cargarNegocio(); } },
          estado.yo.negocios.map((n) => h('option', { value: n.id, selected: n.id === estado.negocio }, n.nombre)))
      : h('strong', {}, (estado.yo.negocios[0] || {}).nombre || '');
    // poner() saltea lo vacío: sin negocio no hay pestañas (append escribiría «null»).
    poner(raiz,
      h('header', { class: 'top' },
        h('div', { class: 'marca' }, logo(), h('span', {}, 'Negocios')),
        estado.yo.negocios.length ? sel : null,
        h('span', { class: 'yo' }, estado.yo.email),
        h('a', { class: 'btn', href: '/cdn-cgi/access/logout' }, 'Salir')),
      estado.negocio ? h('nav', { class: 'tabs', role: 'tablist' }, PESTANAS().map(([id, t]) =>
        h('button', { role: 'tab', 'aria-selected': estado.tab === id ? 'true' : 'false', onclick: () => { estado.tab = id; recordar(); pintarVista(); } }, t))) : null,
      h('main', { id: 'vista' }));
    pintarVista();
  }
  function recordar() { try { localStorage.setItem('zl-negocios', JSON.stringify({ negocio: estado.negocio, tab: estado.tab })); } catch (e) { /* sin almacenamiento: no pasa nada */ } }

  function pintarVista() {
    document.querySelectorAll('.tabs button').forEach((b, i) => b.setAttribute('aria-selected', PESTANAS()[i][0] === estado.tab ? 'true' : 'false'));
    const v = document.getElementById('vista');
    poner(v);
    if (!estado.negocio) {
      v.append(estado.yo.admin ? vistaAdmin() : h('div', { class: 'vacio' }, 'Tu correo todavía no está en ningún negocio. Escribinos a contact@zustrolabs.com.'));
      return;
    }
    const vistas = { productos: vistaProductos, importar: vistaImportar, historial: vistaHistorial, asistente: vistaAsistente, admin: vistaAdmin };
    v.append((vistas[estado.tab] || vistaProductos)());
  }

  async function cargarNegocio() {
    estado.datos = await api(base());
    pintar();
  }

  // ── Productos ──
  function vistaProductos() {
    const caja = h('section', {});
    const d = estado.datos;
    const as = d.asistente;
    caja.append(
      h('h2', {}, 'Productos'),
      h('div', { class: 'chips' },
        h('span', { class: 'chip' }, (d.resumen ? d.resumen.total : 0) + ((d.resumen && d.resumen.total === 1) ? ' producto' : ' productos')),
        h('span', { class: 'chip' }, (d.resumen ? d.resumen.activos : 0) + ' a la venta'),
        d.resumen && d.resumen.agotados ? h('span', { class: 'chip mal' }, d.resumen.agotados + (d.resumen.agotados === 1 ? ' agotado' : ' agotados')) : null,
        h('span', { class: 'chip ' + (as.activo ? 'ok' : 'alerta') }, as.activo ? 'Asistente activo' : as.tiene ? 'Asistente apagado' : 'Asistente sin configurar'),
        h('span', { class: 'chip' }, 'Canales: ' + ([d.negocio.canales.instagram ? 'Instagram' : '', d.negocio.canales.whatsapp ? 'WhatsApp (en prueba)' : ''].filter(Boolean).join(' y ') || 'ninguno'))));
    const buscar = h('input', { type: 'search', placeholder: 'Buscar por nombre, código o categoría', 'aria-label': 'Buscar', value: estado.q });
    const cats = h('select', { 'aria-label': 'Categoría' }, h('option', { value: '' }, 'Todas las categorías'));
    const pausados = h('input', { type: 'checkbox', checked: estado.pausados });
    const lista = h('ul', { class: 'lista', 'aria-live': 'polite' });
    caja.append(
      h('div', { class: 'barra' }, buscar, cats,
        h('label', { class: 'check' }, pausados, 'Ver pausados'),
        h('button', { class: 'btn prim', onclick: () => editor(null) }, '+ Nuevo producto'),
        h('button', { class: 'btn', onclick: conError(exportar) }, 'Exportar a Excel')),
      lista);
    let t;
    const cargar = conError(async () => {
      const p = new URLSearchParams({ q: estado.q, categoria: estado.categoria, pausados: estado.pausados ? '1' : '0' });
      const r = await api(base() + '/productos?' + p);
      poner(cats, h('option', { value: '' }, 'Todas las categorías'), r.categorias.map((c) => h('option', { value: c.nombre, selected: c.nombre === estado.categoria }, c.nombre + ' (' + c.n + ')')));
      poner(lista);
      if (!r.productos.length) {
        lista.append(h('li', { class: 'vacio' }, estado.q || estado.categoria ? 'No hay productos con esa búsqueda.' : 'Todavía no hay productos. Cargá uno con «+ Nuevo producto» o subí tu Excel en «Importar Excel».'));
        return;
      }
      for (const p of r.productos) lista.append(filaProducto(p, cargar));
      if (r.total > r.productos.length) lista.append(h('li', { class: 'ayuda' }, 'Se muestran ' + r.productos.length + ' de ' + r.total + '. Buscá para encontrar el resto.'));
    });
    buscar.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { estado.q = buscar.value; cargar(); }, 250); });
    cats.addEventListener('change', () => { estado.categoria = cats.value; cargar(); });
    pausados.addEventListener('change', () => { estado.pausados = pausados.checked; cargar(); });
    estado.recargarProductos = cargar;
    cargar();
    return caja;
  }

  function miniFoto(p) {
    return h('div', { class: 'foto' }, p.foto ? h('img', { src: '/api' + base() + '/fotos/' + p.foto, alt: '', loading: 'lazy' }) : h('span', { class: 'ini', 'aria-hidden': 'true' }, (p.nombre || '?').trim().charAt(0).toUpperCase()));
  }

  function filaProducto(p, recargar) {
    const disp = p.stock === null ? null : p.stock - (p.reservado || 0);
    const num = h('span', { 'aria-label': 'Stock' }, p.stock === null ? '—' : String(p.stock));
    const mover = (delta) => conError(async () => {
      const r = await api(base() + '/productos/' + p.id + '/stock', { metodo: 'POST', cuerpo: { delta, motivo: delta > 0 ? 'ingreso' : 'venta o ajuste' } });
      p.stock = r.stock;
      num.textContent = String(r.stock);
      ctrl.classList.toggle('cero', r.stock <= 0);
      refrescarResumen();
    });
    const ctrl = p.stock === null
      ? h('span', { class: 'meta' }, 'Sin control de stock')
      : h('span', { class: 'stock' + (disp <= 0 ? ' cero' : '') },
          h('button', { 'aria-label': 'Restar uno a ' + p.nombre, onclick: mover(-1) }, '−'), num,
          h('button', { 'aria-label': 'Sumar uno a ' + p.nombre, onclick: mover(1) }, '+'));
    return h('li', { class: 'prod' + (p.activo ? '' : ' pausado') },
      miniFoto(p),
      h('div', {},
        h('button', { class: 'nombre', onclick: () => editor(p, recargar) }, p.nombre),
        h('div', { class: 'meta' }, [p.categoria, p.codigo ? 'código ' + p.codigo : '', p.activo ? '' : 'pausado'].filter(Boolean).join(' · ')),
        h('div', { class: 'fila' },
          h('span', { class: 'precio' }, p.precio === null ? 'Sin precio' : pesos(p.precio) + (p.unidad ? ' / ' + p.unidad : '')),
          ctrl,
          p.reservado ? h('span', { class: 'chip alerta' }, p.reservado + ' reservadas') : null,
          disp !== null && disp <= 0 && p.activo ? h('span', { class: 'chip mal' }, 'Agotado') : null)));
  }

  async function refrescarResumen() {
    try { estado.datos = await api(base()); } catch (e) { /* el resumen no es crítico */ }
  }

  async function achicarFoto(archivo) {
    const img = await createImageBitmap(archivo);
    const lado = 800;
    const k = Math.min(1, lado / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = (tipo, q) => new Promise((ok) => c.toBlob(ok, tipo, q));
    let b = await blob('image/webp', 0.8);
    if (!b || b.type !== 'image/webp') b = await blob('image/jpeg', 0.82);
    if (b.size > 590000) b = await blob('image/jpeg', 0.6);
    return b;
  }

  function editor(p, recargar) {
    recargar = recargar || estado.recargarProductos || (() => {});
    const dlg = h('dialog', { 'aria-label': p ? 'Editar producto' : 'Nuevo producto' });
    let foto = p ? p.foto : null;
    const campos = {
      nombre: h('input', { type: 'text', required: true, maxlength: 120, value: p ? p.nombre : '' }),
      codigo: h('input', { type: 'text', maxlength: 40, value: p ? p.codigo : '' }),
      categoria: h('input', { type: 'text', maxlength: 60, value: p ? p.categoria : '', list: 'zl-cats' }),
      precio: h('input', { type: 'number', min: 0, step: '0.01', inputmode: 'decimal', value: p && p.precio !== null ? p.precio : '' }),
      unidad: h('input', { type: 'text', maxlength: 30, placeholder: 'unidad, caja, kg…', value: p ? p.unidad : '' }),
      stock: h('input', { type: 'number', min: 0, step: 1, inputmode: 'numeric', value: p && p.stock !== null ? p.stock : '' }),
      descripcion: h('textarea', { maxlength: 500 }, p ? p.descripcion : ''),
      activo: h('input', { type: 'checkbox', checked: p ? p.activo : true }),
    };
    const vista = h('div', { class: 'foto' });
    const pintarFoto = () => { poner(vista, foto ? h('img', { src: '/api' + base() + '/fotos/' + foto, alt: 'Foto del producto' }) : h('span', { class: 'ini', 'aria-hidden': 'true' }, '+')); };
    pintarFoto();
    const subir = h('input', { type: 'file', accept: 'image/*', class: 'oculto', onchange: conError(async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      aviso('Achicando y subiendo la foto…');
      const b = await achicarFoto(f);
      const r = await api(base() + '/fotos', { metodo: 'POST', blob: b });
      foto = r.id;
      pintarFoto();
      aviso('Foto lista. Guardá para que quede.');
    }) });
    const errores = h('p', { class: 'errores', role: 'alert' });
    const borrar = p ? h('button', { type: 'button', class: 'btn peligro izq', onclick: conError(async (e) => {
      if (e.target.dataset.seguro !== '1') { e.target.dataset.seguro = '1'; e.target.textContent = '¿Seguro? Tocá de nuevo para borrar'; return; }
      await api(base() + '/productos/' + p.id, { metodo: 'DELETE' });
      dlg.close(); aviso('Producto borrado'); recargar(); refrescarResumen();
    }) }, 'Borrar') : null;
    const form = h('form', { method: 'dialog', onsubmit: conError(async (e) => {
      e.preventDefault();
      errores.textContent = '';
      const datos = {
        nombre: campos.nombre.value, codigo: campos.codigo.value, categoria: campos.categoria.value, precio: campos.precio.value,
        unidad: campos.unidad.value, stock: campos.stock.value, descripcion: campos.descripcion.value, activo: campos.activo.checked, foto,
      };
      try {
        if (p) await api(base() + '/productos/' + p.id, { metodo: 'PUT', cuerpo: datos });
        else await api(base() + '/productos', { metodo: 'POST', cuerpo: datos });
      } catch (err) {
        errores.textContent = err.message;
        if (err.datos && err.datos.campo && campos[err.datos.campo]) campos[err.datos.campo].focus();
        return;
      }
      dlg.close(); aviso(p ? 'Guardado' : 'Producto creado'); recargar(); refrescarResumen();
    }) },
      h('h2', {}, p ? 'Editar producto' : 'Nuevo producto'),
      etiqueta('Nombre *', campos.nombre), campos.nombre,
      h('div', { class: 'dosc' },
        h('div', {}, etiqueta('Precio', campos.precio), campos.precio),
        h('div', {}, etiqueta('Por', campos.unidad), campos.unidad),
        h('div', {}, etiqueta('Stock', campos.stock), campos.stock),
        h('div', {}, etiqueta('Código', campos.codigo), campos.codigo)),
      h('p', { class: 'ayuda' }, 'Stock vacío: el asistente no informa cantidades (lo ofrece siempre). Precio vacío: no dice precio.'),
      etiqueta('Categoría', campos.categoria), campos.categoria,
      etiqueta('Descripción (lo que el asistente puede contar)', campos.descripcion), campos.descripcion,
      h('p', { class: 'ayuda' }, 'Foto (se achica sola antes de subirla)'), h('div', { class: 'vista-foto' }, vista, subir,
        (() => { const l = etiqueta(foto ? 'Cambiar foto' : 'Subir foto', subir); l.className = 'btn'; return l; })(),
        h('button', { type: 'button', class: 'btn', onclick: () => { foto = null; pintarFoto(); } }, 'Quitar')),
      h('label', { class: 'check' }, campos.activo, 'A la venta (si lo pausás, el asistente no lo ofrece)'),
      errores,
      h('div', { class: 'acciones' }, borrar,
        h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancelar'),
        h('button', { type: 'submit', class: 'btn prim' }, 'Guardar')));
    dlg.append(form);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    campos.nombre.focus();
  }

  // ── Exportar e importar ──
  function descargar(nombre, texto) {
    const url = URL.createObjectURL(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: nombre });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  const celdaCsv = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  // Un texto que empieza con = + - @ Excel lo tomaría como fórmula al abrir el archivo: se le antepone un apóstrofo.
  const textoCsv = (v) => { const s = v === null || v === undefined ? '' : String(v); return celdaCsv(/^[=+\-@\t\r]/.test(s) ? "'" + s : s); };
  const numCsv = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
  const TITULOS = ['Código', 'Nombre', 'Categoría', 'Precio', 'Stock', 'Unidad', 'Descripción', 'Activo'];
  async function exportar() {
    const r = await api(base() + '/exportar');
    const filas = [TITULOS.map(celdaCsv)].concat(r.productos.map((p) => [textoCsv(p.codigo), textoCsv(p.nombre), textoCsv(p.categoria), celdaCsv(numCsv(p.precio)), celdaCsv(numCsv(p.stock)), textoCsv(p.unidad), textoCsv(p.descripcion), p.activo ? 'sí' : 'no']));
    descargar('productos-' + new Date().toISOString().slice(0, 10) + '.csv', filas.map((f) => f.join(';')).join('\r\n'));
  }

  const CAMPOS = [['', 'No usar'], ['nombre', 'Nombre'], ['codigo', 'Código'], ['precio', 'Precio'], ['stock', 'Stock'], ['categoria', 'Categoría'], ['descripcion', 'Descripción'], ['unidad', 'Unidad'], ['activo', 'A la venta (sí/no)']];

  function vistaImportar() {
    const caja = h('section', {});
    const zona = h('div', { class: 'soltar' },
      h('p', {}, h('strong', {}, 'Arrastrá tu planilla acá'), ' o elegila:'),
      h('input', { type: 'file', accept: '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'aria-label': 'Elegir planilla', onchange: (e) => leer(e.target.files[0]) }),
      h('p', { class: 'ayuda' }, 'Excel (.xlsx) o CSV. Si tenés un .xls viejo, abrilo y guardalo como .xlsx. La primera fila tienen que ser los títulos.'));
    const paso2 = h('div', {});
    caja.append(
      h('h2', {}, 'Importar desde Excel'),
      h('p', { class: 'ayuda' }, 'Nada se guarda hasta que lo confirmes. Primero vas a ver qué va a pasar.'),
      h('p', {}, h('button', { class: 'btn', onclick: () => descargar('planilla-modelo.csv', [TITULOS, ['A1', 'Ejemplo: caja de bombones x12', 'Bombones', '18000', '5', 'caja', 'Borrá esta fila', 'sí']].map((f) => f.map(celdaCsv).join(';')).join('\r\n')) }, 'Bajar planilla modelo')),
      zona, paso2);
    ['dragover', 'dragenter'].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('encima'); }));
    ['dragleave', 'drop'].forEach((ev) => zona.addEventListener(ev, () => zona.classList.remove('encima')));
    zona.addEventListener('drop', (e) => { e.preventDefault(); leer(e.dataTransfer.files[0]); });

    const leer = conError(async (archivo) => {
      if (!archivo) return;
      poner(paso2, h('p', { class: 'ayuda' }, 'Leyendo ' + archivo.name + '…'));
      let tabla;
      try {
        tabla = /\.csv$/i.test(archivo.name) || archivo.type === 'text/csv' ? leerCsv(await archivo.text()) : await leerXlsx(await archivo.arrayBuffer());
      } catch (e) {
        poner(paso2, h('p', { class: 'errores' }, 'No pude leer el archivo: ' + e.message));
        return;
      }
      if (tabla.length < 2) { poner(paso2, h('p', { class: 'errores' }, 'El archivo no tiene filas debajo de los títulos.')); return; }
      mapear(tabla, archivo.name);
    });

    function mapear(tabla, nombre) {
      const titulos = tabla[0].map((c) => String(c.v));
      const mapeo = adivinarColumnas(titulos);
      const selects = titulos.map((t, i) => h('select', { 'aria-label': 'Qué es la columna ' + t, onchange: (e) => { mapeo[i] = e.target.value; } },
        CAMPOS.map(([v, txt]) => h('option', { value: v, selected: mapeo[i] === v }, txt))));
      const clave = h('select', {}, h('option', { value: 'codigo' }, 'por código (y si no tiene, por nombre)'), h('option', { value: 'nombre' }, 'por nombre'));
      const modo = h('select', {}, h('option', { value: 'actualizar' }, 'Agregar y actualizar (lo que no está en el archivo queda igual)'), h('option', { value: 'reemplazar' }, 'Reemplazar (lo que no está en el archivo se pausa, no se borra)'));
      const resultado = h('div', { 'aria-live': 'polite' });
      const muestra = tabla.slice(1, 6);
      poner(paso2, 
        h('div', { class: 'caja' },
          h('h3', {}, nombre + ' · ' + (tabla.length - 1) + ' filas'),
          h('p', { class: 'ayuda' }, 'Revisá qué es cada columna. Las que no reconocí quedan en «No usar».'),
          h('div', { class: 'scroll' }, h('table', { class: 'tabla' },
            h('thead', {}, h('tr', {}, titulos.map((t) => h('th', {}, t))), h('tr', {}, selects.map((s) => h('th', {}, s)))),
            h('tbody', {}, muestra.map((f) => h('tr', {}, titulos.map((_, i) => h('td', {}, f[i] ? String(f[i].v) : ''))))))),
          etiqueta('Reconocer los productos que ya están', clave), clave,
          etiqueta('Qué hacer', modo), modo,
          h('div', { class: 'acciones' }, h('button', { class: 'btn prim', onclick: conError(() => probar(false)) }, 'Ver qué va a pasar')),
          resultado));
      async function probar(enSerio) {
        if (!mapeo.includes('nombre') && !mapeo.includes('codigo')) { poner(resultado, h('p', { class: 'errores' }, 'Elegí qué columna es el Nombre (o el Código).')); return; }
        const { filas, problemas } = filasAProductos(tabla, mapeo);
        const r = await api(base() + '/importar', { metodo: 'POST', cuerpo: { filas, modo: modo.value, clave: clave.value, probar: !enSerio } });
        // Para una misma fila, el aviso del navegador (dice qué celda) es más claro que el del servidor.
        const errs = problemas.concat(r.errores.filter((e) => !problemas.some((p) => p.fila === e.fila))).sort((x, y) => x.fila - y.fila);
        poner(resultado, 
          h('h3', {}, enSerio ? 'Listo, importado' : 'Esto es lo que va a pasar'),
          h('div', { class: 'chips' },
            h('span', { class: 'chip ok' }, r.creados + (enSerio ? ' creados' : ' nuevos')),
            h('span', { class: 'chip' }, r.actualizados + (enSerio ? ' actualizados' : ' se actualizan')),
            h('span', { class: 'chip' }, r.sinCambios + ' sin cambios'),
            r.pausados ? h('span', { class: 'chip alerta' }, r.pausados + (enSerio ? ' pausados' : ' se pausan (no estaban en el archivo)')) : null,
            errs.length ? h('span', { class: 'chip mal' }, errs.length + (errs.length === 1 ? ' fila con problemas' : ' filas con problemas')) : null),
          errs.length ? h('ul', { class: 'errores' }, errs.slice(0, 30).map((e) => h('li', {}, 'Fila ' + e.fila + ': ' + e.motivo))) : null,
          errs.length > 30 ? h('p', { class: 'ayuda' }, 'Y ' + (errs.length - 30) + ' más.') : null,
          !enSerio && (r.creados || r.actualizados || r.pausados)
            ? h('div', { class: 'acciones' }, h('button', { class: 'btn prim', onclick: conError(async (e) => { e.target.disabled = true; await probar(true); refrescarResumen(); }) }, 'Importar ahora'))
            : null,
          enSerio ? h('div', { class: 'acciones' }, h('button', { class: 'btn', onclick: () => { estado.tab = 'productos'; pintar(); } }, 'Ver productos')) : null);
      }
    }
    return caja;
  }

  // ── Historial ──
  function vistaHistorial() {
    const caja = h('section', {}, h('h2', {}, 'Historial'), h('p', { class: 'ayuda' }, 'Cada cambio de stock, precio o producto, con quién lo hizo. Los últimos 200.'));
    const cuerpo = h('tbody', {});
    caja.append(h('div', { class: 'scroll' }, h('table', { class: 'tabla' },
      h('thead', {}, h('tr', {}, ['Cuándo', 'Producto', 'Qué', 'Antes', 'Después', 'Quién'].map((t) => h('th', {}, t)))), cuerpo)));
    const QUE = { alta: 'Alta', baja: 'Borrado', stock: 'Stock', precio: 'Precio', estado: 'A la venta', dato: 'Datos' };
    conError(async () => {
      const r = await api(base() + '/historial');
      if (!r.movimientos.length) cuerpo.append(h('tr', {}, h('td', { colspan: 6 }, 'Todavía no hay cambios.')));
      for (const m of r.movimientos) cuerpo.append(h('tr', {}, h('td', {}, fecha(m.t)), h('td', {}, m.nombre), h('td', {}, (QUE[m.tipo] || m.tipo) + (m.detalle ? ' · ' + m.detalle : '')), h('td', {}, m.antes), h('td', {}, m.despues), h('td', {}, m.quien)));
    })();
    return caja;
  }

  // ── Asistente (solo el equipo) ──
  function vistaAsistente() {
    const caja = h('section', {}, h('h2', {}, 'Asistente'),
      h('p', { class: 'ayuda' }, 'La ficha la maneja solo el equipo de Zustro Labs. El asistente responde con esta ficha y con los productos de este negocio.'));
    const texto = h('textarea', { class: 'ficha', 'aria-label': 'Ficha del negocio', spellcheck: 'false' });
    const activa = h('input', { type: 'checkbox' });
    const info = h('div', { 'aria-live': 'polite' });
    const chat = h('div', { class: 'chat' });
    const msg = h('input', { type: 'text', placeholder: 'Escribí como si fueras un cliente', 'aria-label': 'Mensaje de prueba' });
    const mostrar = (r) => {
      poner(info, 
        r.errores && r.errores.length ? h('ul', { class: 'errores' }, r.errores.map((e) => h('li', {}, e))) : null,
        r.pendientes && r.pendientes.length ? h('p', { class: 'chip alerta' }, 'Falta completar: ' + r.pendientes.join(' · ')) : null,
        r.menu ? h('p', { class: 'ayuda' }, 'Menú: ' + r.menu.join(' · ')) : null,
        r.error ? h('p', { class: 'errores' }, r.error) : null);
    };
    caja.append(texto,
      h('label', { class: 'check' }, activa, 'Activa (responde a los clientes de las cuentas de este negocio)'),
      h('div', { class: 'acciones' },
        h('button', { class: 'btn', onclick: conError(async () => mostrar(await api(base() + '/probar', { metodo: 'POST', cuerpo: { texto: texto.value, mensajes: ['hola'] } }).catch((e) => e.datos || { error: e.message }))) }, 'Revisar'),
        h('button', { class: 'btn prim', onclick: conError(async () => {
          try { const r = await api(base() + '/ficha', { metodo: 'PUT', cuerpo: { texto: texto.value, activa: activa.checked } }); mostrar(r); aviso(r.activa ? 'Ficha guardada y ACTIVA' : 'Ficha guardada (apagada)'); refrescarResumen(); }
          catch (e) { mostrar(e.datos || { error: e.message }); }
        }) }, 'Guardar')),
      info,
      h('h3', {}, 'Probar'),
      h('p', { class: 'ayuda' }, 'Charla simulada con la ficha de arriba (aunque no esté guardada) y los productos cargados. No se manda nada a Instagram.'),
      chat,
      h('form', { class: 'barra', onsubmit: conError(async (e) => {
        e.preventDefault();
        const m = msg.value.trim();
        if (!m) return;
        msg.value = '';
        chat.append(h('div', { class: 'burbuja cliente' }, m));
        const r = await api(base() + '/probar', { metodo: 'POST', cuerpo: { texto: texto.value, mensajes: ['hola', m] } });
        const ultima = r.charla[r.charla.length - 1];
        for (const t of ultima.respuestas) chat.append(h('div', { class: 'burbuja asis' }, t));
        // Una falla de la IA no es un control: se muestra como lo que es (ZL-125).
        if (ultima.que === 'error') chat.append(h('p', { class: 'ayuda' }, 'La IA no respondió (motivo: ' + (ultima.notas || []).join(', ') + '). El cliente recibiría el mensaje de arriba.'));
        else if (ultima.notas && ultima.notas.length) chat.append(h('p', { class: 'ayuda' }, 'Controles: se sacó ' + ultima.notas.join(', ') + ' (no estaba en la ficha ni en los productos).'));
        chat.scrollTop = chat.scrollHeight;
      }) }, msg, h('button', { class: 'btn prim', type: 'submit' }, 'Enviar')));
    conError(async () => {
      const f = await api(base() + '/ficha');
      texto.value = f.texto;
      activa.checked = f.activa;
      if (f.texto) mostrar(f);
      else poner(info, h('p', { class: 'ayuda' }, 'Sin ficha todavía: pegá la plantilla (whatsapp/fichas/PLANTILLA.md) y completala.'));
    })();
    return caja;
  }

  // ── Administración (solo el equipo) ──
  function vistaAdmin() {
    const caja = h('section', {}, h('h2', {}, 'Administración'));
    const nombre = h('input', { type: 'text', placeholder: 'Nombre del negocio', 'aria-label': 'Nombre del negocio' });
    const emails = h('input', { type: 'text', placeholder: 'correos separados por coma', 'aria-label': 'Correos de quienes entran' });
    const lista = h('div', {});
    caja.append(
      h('div', { class: 'caja' }, h('h3', {}, 'Nuevo negocio'), etiqueta('Nombre', nombre), nombre, etiqueta('Quiénes entran', emails), emails,
        h('p', { class: 'ayuda' }, 'Además, agregá esos correos en Cloudflare Zero Trust → Access → la app «Negocios» → su política. Sin eso, Access no los deja pasar.'),
        h('div', { class: 'acciones' }, h('button', { class: 'btn prim', onclick: conError(async () => {
          const n = await api('/admin/negocios', { metodo: 'POST', cuerpo: { nombre: nombre.value, emails: emails.value } });
          aviso('Negocio creado'); nombre.value = ''; emails.value = '';
          estado.yo = await api('/yo'); estado.negocio = n.id; estado.tab = 'productos'; recordar(); cargarNegocio();
        }) }, 'Crear'))),
      lista);
    conError(async () => {
      const [{ negocios }, { cuentas }] = await Promise.all([api('/admin/negocios'), api('/admin/cuentas')]);
      poner(lista, h('h3', {}, 'Negocios'));
      if (!negocios.length) lista.append(h('div', { class: 'vacio' }, 'Todavía no hay negocios.'));
      for (const n of negocios) {
        const em = h('input', { type: 'text', value: n.emails.join(', '), 'aria-label': 'Correos de ' + n.nombre });
        const lim = h('input', { type: 'number', min: 10, max: 5000, value: n.limiteDia, 'aria-label': 'Respuestas de IA por día' });
        const marcas = cuentas.filter((c) => !c.negocio || c.negocio === n.id).map((c) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: c.id, 'data-cuenta': '1', checked: n.cuentas.includes(c.id) }), '@' + (c.username || c.id)));
        const ig = h('input', { type: 'checkbox', checked: n.canales.instagram });
        const wa = h('input', { type: 'checkbox', checked: n.canales.whatsapp });
        lista.append(h('div', { class: 'caja' },
          h('h3', {}, n.nombre),
          h('div', { class: 'chips' },
            h('span', { class: 'chip ' + (n.asistente.activo ? 'ok' : 'alerta') }, n.asistente.activo ? 'Asistente activo' : n.asistente.tiene ? 'Asistente apagado' : 'Sin ficha'),
            h('span', { class: 'chip' }, 'IA hoy: ' + n.usoHoy + ' / ' + n.limiteDia),
            h('span', { class: 'chip' }, 'IA este mes: ' + n.usoMes)),
          etiqueta('Quiénes entran', em), em,
          h('p', { class: 'ayuda' }, 'Canales que contrató (con un canal apagado, el asistente no responde ahí)'),
          h('label', { class: 'check' }, ig, 'Instagram'),
          h('label', { class: 'check' }, wa, 'WhatsApp (en prueba: todavía no se conecta)'),
          h('p', { class: 'ayuda' }, 'Cuentas de Instagram'), marcas.length ? marcas : h('p', { class: 'ayuda' }, 'No hay cuentas conectadas libres. Conectalas con el script instagram-cliente.ps1.'),
          etiqueta('Tope de respuestas de la IA por día', lim), lim,
          h('div', { class: 'acciones' },
            h('button', { class: 'btn', onclick: () => { estado.negocio = n.id; estado.tab = 'productos'; recordar(); cargarNegocio(); } }, 'Abrir'),
            h('button', { class: 'btn prim', onclick: conError(async (e) => {
              const marcadas = [...e.target.closest('.caja').querySelectorAll('input[data-cuenta]:checked')].map((x) => x.value);
              await api('/admin/negocios/' + n.id, { metodo: 'PUT', cuerpo: { emails: em.value, cuentas: marcadas, limiteDia: Number(lim.value), canales: { instagram: ig.checked, whatsapp: wa.checked } } });
              aviso('Guardado');
            }) }, 'Guardar'))));
      }
    })();
    return caja;
  }

  // ── Arranque ──
  conError(async () => {
    estado.yo = await api('/yo');
    let guardado = {};
    try { guardado = JSON.parse(localStorage.getItem('zl-negocios') || '{}'); } catch (e) { /* nada */ }
    const ids = estado.yo.negocios.map((n) => n.id);
    estado.negocio = ids.includes(guardado.negocio) ? guardado.negocio : ids[0] || null;
    if (guardado.tab && (estado.yo.admin || !['asistente', 'admin'].includes(guardado.tab))) estado.tab = guardado.tab;
    if (estado.negocio) await cargarNegocio();
    else { estado.tab = 'admin'; pintar(); }
  })();
}

/**
 * Wrangler empaqueta con esbuild «keepNames», que agrega `__name(fn, "nombre")` adentro de las funciones. Como la página
 * se arma con .toString(), esas llamadas llegan al navegador, donde `__name` no existe, y la app no arrancaba (se
 * quedaba en «Cargando…», ZL-123). Esta definición las vuelve inofensivas, se empaquete como se empaquete.
 */
const SIN_NOMBRES = 'var __name = function (f) { return f; };';

/**
 * Cada función del lector, con su nombre de siempre. Al empaquetar, esbuild puede renombrarlas (leerCsv → leerCsv2) para
 * no chocar con los nombres que usa la app; con keepNames, f.name sigue siendo el original. Se declara con el nombre que
 * quedó en el código (las funciones se llaman entre sí así) y además con el original (así las llama la app).
 */
function declarar(f) {
  const src = f.toString();
  const declarado = (/^(?:async\s+)?function\s*\*?\s*([\w$]+)/.exec(src) || [])[1];
  if (!declarado) throw new Error(`el lector tiene que usar funciones con nombre: ${f.name}`);
  return declarado === f.name ? src : `${src}\nvar ${f.name} = ${declarado};`;
}

/** El JS que se manda: el lector de planillas + la app. */
export const appJs = () => `${SIN_NOMBRES}\n${FUNCIONES_LECTOR.map(declarar).join('\n')}\n(${app.toString()})();\n`;
