// Interfaz de negocios.zustrolabs.com (ZL-121): una sola página, sin librerías, pensada primero para el celular.
// - El código de la app es la función `app` de abajo: se manda al navegador con su .toString() (así no hay que
//   escapar nada dentro de un texto), junto con el lector de planillas (lector.js).
// - Todo lo que viene de la base se pone con textContent (función h): nunca como HTML.
import { FUNCIONES_LECTOR } from './lector.js';

export const APP_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Negocios · Zustro Labs</title><meta name="robots" content="noindex"><meta name="theme-color" content="#C8102E">
<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icono.svg"><link rel="apple-touch-icon" href="/icono.svg">
<meta name="apple-mobile-web-app-capable" content="yes"><link rel="stylesheet" href="/app.css"></head>
<body><div id="app"><p class="cargando">Cargando…</p></div><script src="/app.js"></script></body></html>`;

export const APP_CSS = `:root{--rojo:#C8102E;--tinta:#1B2230;--gris:#5A6270;--linea:#E3E6EB;--fondo:#F6F7F9;--ok:#1E7B4E;--alerta:#9A5100}
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
input[type=text],input[type=search],input[type=number],input[type=email],input[type=tel],input[type=url],input[type=time],input[type=date],select,textarea{border:1px solid #C9CED6;border-radius:8px;padding:.55rem .65rem;background:#fff;width:100%}
.barra select,.barra input[type=search]{width:auto}
select{max-width:100%}.barra>select,.barra>input[type=url]{flex:1 1 12rem;min-width:0;width:auto}
.wa-form,.dosc>div{min-width:0}
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
.formulario{display:grid;gap:.45rem;max-width:36rem;margin:.5rem 0}.formulario textarea{width:100%}
[hidden]{display:none!important}
.chat{display:grid;gap:.4rem;max-height:26rem;overflow:auto;padding:.5rem;background:var(--fondo);border-radius:10px;margin:.5rem 0}
.burbuja{max-width:85%;padding:.5rem .7rem;border-radius:12px;white-space:pre-wrap;font-size:.92rem}
.burbuja.foto{margin:0;padding:.35rem}.burbuja.foto img{display:block;max-width:220px;width:100%;border-radius:8px}.burbuja.foto figcaption{font-size:.82rem;color:var(--gris);padding:.3rem .2rem 0}
.burbuja.cliente{justify-self:end;background:var(--tinta);color:#fff}.burbuja.asis{justify-self:start;background:#fff;border:1px solid var(--linea)}
.pasos li{margin:.4rem 0}.wa-num{background:#fff;border:1px solid var(--linea);border-radius:12px;padding:.8rem 1rem;margin:.6rem 0}
.wa-form{display:grid;gap:.35rem;max-width:32rem;margin-top:1rem}details{margin:.8rem 0}summary{cursor:pointer;font-weight:600}
.vacio{padding:2rem 1rem;text-align:center;color:var(--gris);background:#fff;border:1px dashed var(--linea);border-radius:12px}
.seg{display:inline-flex;flex-wrap:wrap;gap:.25rem;background:#EAECEF;border-radius:10px;padding:.2rem;margin:0 0 1rem}
.seg button{border:0;background:none;border-radius:8px;padding:.4rem .8rem;cursor:pointer;color:var(--gris)}
.seg button[aria-pressed="true"]{background:#fff;color:var(--tinta);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.resumen{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.5rem;margin:0 0 1rem}
.resumen div{background:#fff;border:1px solid var(--linea);border-radius:12px;padding:.6rem .8rem}
.resumen strong{display:block;font-size:1.4rem;line-height:1.2}.resumen span{font-size:.82rem;color:var(--gris)}
.tarjeta{background:#fff;border:1px solid var(--linea);border-radius:12px;padding:.9rem 1rem;margin-bottom:.7rem}
.tarjeta h3{margin:0 0 .4rem}.tarjeta.nuevo{border-left:4px solid var(--rojo)}
.tarjeta .acciones{margin-top:.6rem}
.contacto{margin:.4rem 0;font-size:.95rem;display:flex;flex-wrap:wrap;align-items:center;gap:.35rem;overflow-wrap:anywhere}
.btn.chico{padding:.15rem .6rem;font-size:.8rem;min-height:0}
.cita{white-space:pre-line;background:#fff;border:1px solid var(--linea);border-radius:8px;padding:.5rem .7rem;margin:.4rem 0}
.dia{display:grid;grid-template-columns:6.2rem 1fr;gap:.3rem .6rem;align-items:center;padding:.45rem 0;border-bottom:1px solid var(--linea)}
.dia:last-child{border-bottom:0}.dia .nom{font-weight:600}.turnos{display:flex;flex-wrap:wrap;gap:.35rem;align-items:center}
.turnos input[type=time]{width:8.4rem}
.esp{display:grid;grid-template-columns:minmax(10rem,1.2fr) 9rem 1.5fr auto;gap:.4rem .6rem;align-items:center;padding:.45rem 0;border-bottom:1px solid var(--linea)}
.esp .cuando{font-size:.92rem}.esp .dosc{grid-column:1/-1}.turnos .a{color:var(--gris);font-size:.85rem}
.fila-ed{display:grid;grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr));gap:.2rem .5rem;align-items:end;padding:.6rem 0;border-bottom:1px solid var(--linea)}
.fila-ed label{margin:.2rem 0}.fila-ed .btn{justify-self:start}
.opciones-radio label.check{margin:.35rem 0}
.estado-ahora{display:inline-block;font-weight:600;border-radius:99px;padding:.15rem .7rem;font-size:.9rem;margin:0 0 .6rem}
.estado-ahora.ok{background:#E8F5EE;color:var(--ok)}.estado-ahora.cerrado{background:#FDECEE;color:var(--rojo)}
.guardar-fijo{position:sticky;bottom:.5rem;display:flex;justify-content:flex-end;gap:.5rem;padding:.5rem 0;z-index:3}
.pausa{background:#FFF4E5;border:1px solid #F5D3A6;color:var(--alerta);border-radius:8px;padding:.4rem .6rem;font-size:.85rem;margin:.4rem 0}
@media (max-width:699px){
  .yo{display:none}.top{padding:.5rem .8rem}.top select{max-width:11rem}
  .tabs{position:fixed;left:0;right:0;bottom:0;z-index:6;justify-content:space-around;border-top:1px solid var(--linea);border-bottom:0;padding:0 .2rem calc(.1rem + env(safe-area-inset-bottom));box-shadow:0 -2px 10px rgba(0,0,0,.05)}
  .tabs button{flex:1 1 0;padding:.65rem .2rem;font-size:.82rem;border-bottom:0;border-top:3px solid transparent}
  .tabs button[aria-selected="true"]{border-top-color:var(--rojo)}
  main{padding-bottom:5.5rem}
  .dosc{grid-template-columns:1fr}
  .guardar-fijo{bottom:4.2rem}.dia{grid-template-columns:1fr}
  .esp{grid-template-columns:1fr auto}.esp .cuando{grid-column:1/-1}.esp input[type=text]{grid-column:1/2}
  .tabla.apilada thead{display:none}.tabla.apilada tr{display:block;border-bottom:1px solid var(--linea);padding:.4rem 0}
  .tabla.apilada td{display:block;border:0;padding:.1rem .7rem}.tabla.apilada td[data-t]::before{content:attr(data-t) ": ";color:var(--gris);font-size:.8rem}
}
.grafico{display:flex;align-items:flex-end;gap:2px;height:150px;padding:1.4rem 0 0;border-bottom:1px solid var(--linea);position:relative}
.grafico .col{flex:1 1 0;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;min-width:0;position:relative}
.grafico .barra-dato{width:100%;max-width:24px;background:var(--rojo);border-radius:4px 4px 0 0;min-height:0}
.grafico .col:hover .barra-dato{opacity:.8}.grafico .valor{position:absolute;top:-1.3rem;font-size:.75rem;font-weight:600;white-space:nowrap}
.ejes{display:flex;gap:2px;font-size:.72rem;color:var(--gris);margin-top:.25rem}.ejes span{flex:1 1 0;text-align:center;min-width:0;overflow:visible;white-space:nowrap;display:flex;justify-content:center}
.titulo-reporte{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;justify-content:space-between}
@media print{.top,.tabs,.no-imprimir,.toast{display:none!important}body{background:#fff}main{max-width:none;padding:0}.caja,.tarjeta,.resumen div{break-inside:avoid}}
@media (min-width:700px){.prod{grid-template-columns:64px 1fr}.foto{width:64px;height:64px}}`;

/** El programa de la página (corre en el navegador). */
function app() {
  'use strict';
  const estado = { yo: null, negocio: null, datos: null, tab: 'inicio', sub: {}, categoria: '', q: '', pausados: true };
  const raiz = document.getElementById('app');

  function h(tag, props, ...hijos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === false || v === null || v === undefined) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      // Estilos por CSSOM (la política de seguridad no deja atributos «style»): {height: '40%'}.
      else if (k === 'estilo') Object.assign(el.style, v);
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
  // ZL-148: tres secciones para el negocio (en el celular, una barra abajo). Inicio es lo único que tiene que mirar
  // seguido: lo que el asistente le deja listo para confirmar o responder. El equipo ve además Asistente y Admin.
  // ZL-159: «Asistente» también para el negocio (pausa, aviso del día y charla de prueba); el equipo además ve la ficha.
  // ZL-164: «Mi negocio» (horarios, fechas especiales, dirección, envíos, pagos, preguntas frecuentes).
  const PESTANAS = () => [['inicio', 'Inicio'], ['productos', 'Productos'], ['minegocio', 'Mi negocio'], ['reportes', 'Reportes'], ['conexiones', 'Conexiones'], ['asistente', 'Asistente']]
    .concat(estado.yo.admin ? [['admin', 'Admin']] : []);
  // Lo guardado con los nombres de antes lleva a la sección nueva.
  const VIEJAS = { pedidos: ['inicio'], importar: ['productos', 'importar'], historial: ['productos', 'historial'], instagram: ['conexiones', 'instagram'], whatsapp: ['conexiones', 'whatsapp'] };
  /** Botones para elegir una parte de una sección (Lista · Importar · Historial). */
  function segmento(clave, opciones, alCambiar) {
    const actual = estado.sub[clave] || opciones[0][0];
    return h('div', { class: 'seg', role: 'group', 'aria-label': 'Ver' }, opciones.map(([id, t]) =>
      h('button', { type: 'button', 'aria-pressed': id === actual ? 'true' : 'false', onclick: () => { estado.sub[clave] = id; recordar(); alCambiar ? alCambiar(id) : pintarVista(); } }, t)));
  }

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
  function recordar() { try { localStorage.setItem('zl-negocios', JSON.stringify({ negocio: estado.negocio, tab: estado.tab, sub: estado.sub })); } catch (e) { /* sin almacenamiento: no pasa nada */ } }

  // ── Secciones (ZL-148) ──
  function vistaSeccionProductos() {
    const caja = h('section', {});
    const cuerpo = h('div', {});
    const id = estado.sub.productos || 'lista';
    poner(cuerpo, id === 'importar' ? vistaImportar() : id === 'historial' ? vistaHistorial() : vistaProductos());
    caja.append(segmento('productos', [['lista', 'Lista'], ['importar', 'Importar Excel'], ['historial', 'Historial']]), cuerpo);
    return caja;
  }
  function vistaConexiones() {
    const caja = h('section', {});
    const cuerpo = h('div', {});
    // ZL-159: un empleado ve cómo está todo, pero conectar canales y cambiar cómo se vende lo hace el dueño.
    if (estado.datos.negocio.rol === 'empleado') {
      caja.append(h('p', { class: 'ayuda' }, 'Conectar WhatsApp o Instagram y cambiar cómo se vende lo hace el dueño del negocio.'), vistaEstado());
      return caja;
    }
    const id = estado.sub.conexiones || 'estado';
    poner(cuerpo, id === 'instagram' ? vistaInstagram() : id === 'ajustes' ? vistaAjustes() : id === 'whatsapp' ? vistaWhatsapp() : vistaEstado());
    caja.append(segmento('conexiones', [['estado', 'Estado'], ['whatsapp', 'WhatsApp'], ['instagram', 'Instagram'], ['ajustes', 'Cómo vendés']]), cuerpo);
    return caja;
  }

  // ── Estado (ZL-150): el semáforo del negocio. Qué anda y, si algo falta, qué hacer. ──
  function vistaEstado() {
    const lista = h('div', { 'aria-live': 'polite' }, h('p', { class: 'ayuda' }, 'Revisando…'));
    const ICONO = { ok: '✓', mal: '✗', aviso: '•' };
    conError(async () => {
      const r = await api(base() + '/estado');
      poner(lista,
        h('p', { class: 'chip ' + (r.verde ? 'ok' : 'mal') }, r.verde ? 'Todo funcionando' : 'Falta algo: mirá lo que está en rojo'),
        h('ul', { class: 'lista' }, r.controles.map((c) => h('li', { class: 'tarjeta' },
          h('strong', { class: c.estado === 'mal' ? 'errores' : '' }, ICONO[c.estado] + ' ' + c.texto),
          c.arreglo && c.estado !== 'ok' ? h('p', { class: 'ayuda' }, c.arreglo) : null))));
    })();
    return h('section', {}, h('h2', {}, 'Estado'), h('p', { class: 'ayuda' }, 'Si algo está en rojo, el asistente no puede responder por ahí. Abajo dice qué hacer.'), lista);
  }

  // ── Reportes (ZL-152): día, semana o mes, para mostrarle al cliente. Se baja en Excel o se imprime como PDF. ──
  const NOMBRE_DIA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  /** Columnas de una sola serie (sin leyenda: el título dice qué es). El valor más alto lleva su número. */
  function columnas(valores, etiquetas, describir, cadaCuanto) {
    const max = Math.max(1, ...valores);
    const pico = valores.indexOf(Math.max(...valores));
    return h('div', {},
      h('div', { class: 'grafico', role: 'img', 'aria-label': describir(valores) },
        valores.map((v, i) => h('div', { class: 'col', title: etiquetas[i] + ': ' + v },
          i === pico && v > 0 ? h('span', { class: 'valor' }, String(v)) : null,
          h('div', { class: 'barra-dato', estilo: { height: Math.round((v / max) * 100) + '%' } })))),
      h('div', { class: 'ejes', 'aria-hidden': 'true' }, etiquetas.map((t, i) => h('span', {}, i % (cadaCuanto || 1) === 0 ? t : ''))));
  }
  function tablaNumeros(titulos, filas) {
    return h('details', { class: 'no-imprimir' }, h('summary', {}, 'Ver los números'),
      h('div', { class: 'scroll' }, h('table', { class: 'tabla' }, h('thead', {}, h('tr', {}, titulos.map((t) => h('th', {}, t)))), h('tbody', {}, filas.map((f) => h('tr', {}, f.map((c) => h('td', {}, String(c)))))))));
  }
  function vistaReportes() {
    if (!estado.sub.reportes) estado.sub.reportes = 'semana';
    const periodo = estado.sub.reportes;
    const hoy = new Date();
    const fecha = h('input', { type: 'date', value: estado.fechaReporte || new Date(hoy.getTime() - hoy.getTimezoneOffset() * 60000).toISOString().slice(0, 10), 'aria-label': 'Fecha del reporte' });
    const cuerpo = h('div', { 'aria-live': 'polite' }, h('p', { class: 'ayuda' }, 'Armando el reporte…'));
    const excel = h('a', { class: 'btn', download: '' }, 'Descargar Excel');
    const consulta = () => '?periodo=' + periodo + '&fecha=' + encodeURIComponent(fecha.value);
    const cargar = conError(async () => {
      estado.fechaReporte = fecha.value;
      excel.href = '/api' + base() + '/reporte' + consulta() + '&formato=xlsx';
      const r = await api(base() + '/reporte' + consulta());
      const s = r.resumen;
      const rango = r.desde === r.hasta ? r.desde.split('-').reverse().join('/') : r.desde.split('-').reverse().join('/') + ' al ' + r.hasta.split('-').reverse().join('/');
      const hs = (i) => String(i).padStart(2, '0') + ':00';
      const tarjeta = (n, t) => h('div', {}, h('strong', {}, String(n)), h('span', {}, t));
      poner(cuerpo,
        h('h3', {}, 'Reporte de ' + r.negocio + ' · ' + rango),
        h('div', { class: 'resumen' },
          tarjeta(s.charlas, 'charlas atendidas'), tarjeta(s.mensajes, 'mensajes recibidos'), tarjeta(s.respuestas, 'respuestas del asistente'),
          tarjeta(s.consultas, 'consultas'), tarjeta(s.ganadas, 'consultas ganadas'), tarjeta(s.pedidos, 'pedidos'),
          tarjeta(s.entregados, 'pedidos entregados'), tarjeta(plata(s.vendido), 'vendido'), s.entregados ? tarjeta(plata(s.ticketPromedio), 'ticket promedio') : null,
          // ZL-160: los comentarios de Instagram que respondió el asistente (si los tiene encendidos o ya respondió alguno).
          s.comentarios || (estado.datos.negocio.comentarios || {}).activo ? tarjeta(s.comentarios || 0, 'comentarios respondidos') : null,
          // ZL-164: lo que atendió con el negocio cerrado y lo que no supo (para cargarlo en Mi negocio).
          s.fueraHorario ? tarjeta(s.fueraHorario, 'mensajes con el negocio cerrado') : null,
          s.noSupo ? tarjeta(s.noSupo, 'preguntas que no supo') : null),
        h('p', { class: 'ayuda' }, 'Por WhatsApp: ' + s.canales.whatsapp + ' mensajes · por Instagram: ' + s.canales.instagram + '. Pases al equipo: ' + s.pasesAlEquipo + '. Recordatorios enviados: ' + s.seguimientos + '.' + (s.enviadosWa ? ' Mensajes que mandó el asistente por WhatsApp: ' + s.enviadosWa + '.' : '')),
        h('div', { class: 'caja' }, h('h3', {}, 'A qué hora te escriben'),
          h('p', { class: 'ayuda' }, s.mensajes ? 'Las horas con más mensajes: ' + r.horasPico.map(hs).join(', ') + '.' : 'Todavía no hay mensajes en este período.'),
          columnas(r.porHora, r.porHora.map((_, i) => hs(i)), (v) => 'Mensajes por hora del día. Más mensajes a las ' + r.horasPico.map(hs).join(', '), 3),
          tablaNumeros(['Hora', 'Mensajes'], r.porHora.map((n, i) => [hs(i), n]))),
        r.periodo !== 'dia' ? h('div', { class: 'caja' }, h('h3', {}, 'Qué días te escriben más'),
          h('p', { class: 'ayuda' }, r.diasPico.length ? 'Los días con más mensajes: ' + r.diasPico.join(' y ') + '.' : ''),
          columnas(r.porDiaSemana, NOMBRE_DIA, () => 'Mensajes por día de la semana. Más: ' + r.diasPico.join(' y ')),
          tablaNumeros(['Día', 'Mensajes'], r.porDiaSemana.map((n, i) => [NOMBRE_DIA[i], n]))) : null,
        r.porDia.length > 1 ? h('div', { class: 'caja' }, h('h3', {}, 'Mensajes día por día'),
          columnas(r.porDia.map((d) => d.mensajes), r.porDia.map((d) => d.dia.slice(8) + '/' + d.dia.slice(5, 7)), () => 'Mensajes por día del período', r.porDia.length > 10 ? 5 : 1),
          tablaNumeros(['Día', 'Mensajes', 'Charlas', 'Consultas', 'Pedidos', 'Vendido', 'Comentarios'], r.porDia.map((d) => [d.dia.split('-').reverse().join('/'), d.mensajes, d.charlas, d.consultas, d.pedidos, plata(d.vendido), d.comentarios || 0]))) : null,
        h('div', { class: 'caja' }, h('h3', {}, 'Lo que más compran'),
          r.productos.length
            ? h('div', { class: 'scroll' }, h('table', { class: 'tabla' }, h('thead', {}, h('tr', {}, h('th', {}, 'Producto'), h('th', {}, 'Unidades'), h('th', {}, 'Monto'))),
                h('tbody', {}, r.productos.map((p) => h('tr', {}, h('td', {}, p.nombre), h('td', {}, String(p.unidades)), h('td', {}, plata(p.monto)))))))
            : h('p', { class: 'ayuda' }, 'No hubo pedidos por chat en este período.')));
    });
    fecha.addEventListener('change', cargar);
    const caja = h('section', {},
      h('div', { class: 'titulo-reporte' }, h('h2', {}, 'Reportes'),
        h('div', { class: 'acciones no-imprimir', estilo: { margin: '0' } }, excel, h('button', { type: 'button', class: 'btn', onclick: () => window.print() }, 'Imprimir o guardar PDF'))),
      h('p', { class: 'ayuda no-imprimir' }, 'Cuántos te escriben, a qué hora, qué días y qué compran más. Con la hora de tu negocio (la elegís en Mi negocio).'),
      h('div', { class: 'barra no-imprimir' }, segmento('reportes', [['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes']]), fecha),
      cuerpo);
    cargar();
    return caja;
  }

  // ── Mi negocio (ZL-164): lo carga el dueño, sin pasar por el equipo. El asistente lo usa en la próxima respuesta. ──
  function vistaMiNegocio() {
    const caja = h('section', {}, h('h2', {}, 'Mi negocio'), h('p', { class: 'cargando' }, 'Cargando…'));
    api(base() + '/mi-negocio').then((d) => pintarMiNegocio(caja, d)).catch((e) => { if (e.message !== 'sesión') poner(caja, h('h2', {}, 'Mi negocio'), h('p', { class: 'errores' }, e.message)); });
    return caja;
  }
  function pintarMiNegocio(caja, d) {
    const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    const m = JSON.parse(JSON.stringify(d.minegocio));
    let zona = d.zona;
    const puede = d.puede;
    const dis = !puede;
    const marcar = () => { guardar.disabled = false; };
    const hora = (v, al) => h('input', { type: 'time', value: v || '', disabled: dis, 'aria-label': 'Hora', oninput: (e) => { al(e.target.value); marcar(); } });
    const fechaCorta = (f) => f.slice(8) + '/' + f.slice(5, 7);
    const repintar = () => pintarMiNegocio(caja, Object.assign({}, d, { minegocio: m, zona: zona }));

    // Horarios: hasta dos turnos por día; «Copiar a todos» repite el lunes.
    const filaDia = (i) => {
      const ts = m.horarios[i];
      const abierto = h('input', { type: 'checkbox', checked: ts.length > 0, disabled: dis, onchange: (e) => { m.horarios[i] = e.target.checked ? [{ abre: '09:00', cierra: '18:00' }] : []; marcar(); repintar(); } });
      const turno = (t, k) => h('span', { class: 'turnos' }, hora(t.abre, (v) => { t.abre = v; }), h('span', { class: 'a' }, 'a'), hora(t.cierra, (v) => { t.cierra = v; }),
        k === 1 && puede ? h('button', { type: 'button', class: 'btn chico', onclick: () => { ts.splice(1, 1); marcar(); repintar(); } }, 'Quitar') : null);
      return h('div', { class: 'dia' },
        h('label', { class: 'check nom' }, abierto, DIAS[i]),
        ts.length ? h('div', { class: 'turnos' }, ts.map(turno), ts.length === 1 && puede ? h('button', { type: 'button', class: 'btn chico', onclick: () => { if (ts[0].cierra > '15:00') ts[0].cierra = '13:00'; ts.push({ abre: '16:00', cierra: '20:00' }); marcar(); repintar(); } }, '+ Otro turno') : null)
          : h('span', { class: 'ayuda' }, 'Cerrado'));
    };
    const horarios = h('div', { class: 'caja' }, h('h3', {}, 'Horarios'),
      h('p', { class: 'ayuda' }, 'El asistente calcula solo si estás abierto ahora y cuándo abrís. Hasta dos turnos por día (por ejemplo, de 9 a 13 y de 16 a 20).'),
      DIAS.map((_, i) => filaDia(i)),
      puede ? h('div', { class: 'acciones' }, h('button', { type: 'button', class: 'btn', onclick: () => { for (let i = 1; i < 7; i++) m.horarios[i] = JSON.parse(JSON.stringify(m.horarios[0])); marcar(); repintar(); aviso('Copié el horario del lunes a todos los días: sacá los que no abrís.'); } }, 'Copiar el lunes a todos los días')) : null);

    // Fechas especiales y feriados (mandan sobre el horario de la semana).
    // Una fila corta por fecha («23/11 · Cerrado · Día de la Soberanía»); las fechas se eligen solo al agregarla.
    const diaSemana = (f) => ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][new Date(f + 'T12:00:00Z').getUTCDay()];
    const fechaLarga = (e) => diaSemana(e.desde) + ' ' + fechaCorta(e.desde) + '/' + e.desde.slice(0, 4) + (e.hasta !== e.desde ? ' al ' + diaSemana(e.hasta) + ' ' + fechaCorta(e.hasta) : '');
    const filaEspecial = (e, k) => {
      const tipo = h('select', { disabled: dis, 'aria-label': 'Ese día (' + fechaLarga(e) + ')', onchange: (ev) => { e.tipo = ev.target.value; e.turnos = e.tipo === 'horario' ? [{ abre: '09:00', cierra: '13:00' }] : []; marcar(); repintar(); } },
        h('option', { value: 'cerrado', selected: e.tipo === 'cerrado' }, 'Cerrado'), h('option', { value: 'horario', selected: e.tipo === 'horario' }, 'Otro horario'));
      const nota = h('input', { type: 'text', maxlength: 80, value: e.nota, disabled: dis, 'aria-label': 'Nota (' + fechaLarga(e) + ')', placeholder: 'Nota (opcional)', oninput: (ev) => { e.nota = ev.target.value; marcar(); } });
      const fechas = e.nueva ? (() => {
        const desde = h('input', { type: 'date', value: e.desde, oninput: (ev) => { e.desde = ev.target.value; if (!e.hasta || e.hasta < e.desde) e.hasta = e.desde; marcar(); } });
        const hasta = h('input', { type: 'date', value: e.hasta, oninput: (ev) => { e.hasta = ev.target.value; marcar(); } });
        return h('div', { class: 'dosc' }, h('div', {}, etiqueta('Desde', desde), desde), h('div', {}, etiqueta('Hasta', hasta), hasta));
      })() : h('strong', { class: 'cuando' }, fechaLarga(e));
      return h('div', { class: 'esp' }, fechas, tipo,
        e.tipo === 'horario' ? h('span', { class: 'turnos' }, hora(e.turnos[0].abre, (v) => { e.turnos[0].abre = v; }), h('span', { class: 'a' }, 'a'), hora(e.turnos[0].cierra, (v) => { e.turnos[0].cierra = v; })) : null,
        nota, puede ? h('button', { type: 'button', class: 'btn chico peligro', 'aria-label': 'Quitar ' + fechaLarga(e), onclick: () => { m.especiales.splice(k, 1); marcar(); repintar(); } }, 'Quitar') : null);
    };
    const cargarFeriados = conError(async () => {
      const r = await api(base() + '/mi-negocio/feriados');
      if (!r.pais) { aviso('Para tu zona horaria todavía no sé los feriados: cargalos a mano.', true); return; }
      const ya = new Set(m.especiales.map((e) => e.desde));
      const nuevos = r.feriados.filter((f) => !ya.has(f.fecha));
      nuevos.forEach((f) => m.especiales.push({ desde: f.fecha, hasta: f.fecha, tipo: 'cerrado', turnos: [], nota: f.nombre }));
      m.especiales.sort((a, b) => a.desde.localeCompare(b.desde));
      if (nuevos.length) marcar();
      repintar();
      aviso(nuevos.length ? 'Sumé ' + nuevos.length + ' feriados como cerrado: cambiá los días que abrís y tocá Guardar.' : 'Ya estaban todos los feriados.');
    });
    const especiales = h('div', { class: 'caja' }, h('h3', {}, 'Fechas especiales y feriados'),
      h('p', { class: 'ayuda' }, 'Un día que cerrás o abrís con otro horario (feriados, vacaciones, fiestas). Manda sobre el horario de la semana.'),
      m.especiales.length ? m.especiales.map(filaEspecial) : h('p', { class: 'ayuda' }, 'No cargaste ninguna.'),
      puede ? h('div', { class: 'acciones' },
        h('button', { type: 'button', class: 'btn', onclick: () => { const hoy = new Date().toISOString().slice(0, 10); m.especiales.push({ desde: hoy, hasta: hoy, tipo: 'cerrado', turnos: [], nota: '', nueva: true }); marcar(); repintar(); } }, '+ Agregar fecha'),
        h('button', { type: 'button', class: 'btn', onclick: cargarFeriados }, 'Cargar feriados')) : null);

    // Fuera de horario.
    const radio = (v, t, ayuda) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'fuera', value: v, checked: m.fueraDeHorario === v, disabled: dis, onchange: () => { m.fueraDeHorario = v; marcar(); } }), h('span', {}, h('strong', {}, t), ' — ', ayuda));
    const fuera = h('div', { class: 'caja opciones-radio' }, h('h3', {}, 'Cuando está cerrado'),
      radio('pedidos', 'Responder y tomar pedidos', 'aclara que lo preparan cuando abran (recomendado)'),
      radio('responder', 'Responder sin tomar pedidos', 'contesta las preguntas y dice cuándo abren'),
      radio('cerrado', 'No atender', 'a cada persona le dice una vez cuándo abren, y nada más'));

    // Dirección.
    const dir = h('input', { type: 'text', maxlength: 200, value: m.direccion, disabled: dis, placeholder: 'Ejemplo: San Martín 1234, Rosario', oninput: (e) => { m.direccion = e.target.value; marcar(); } });
    const direccion = h('div', { class: 'caja' }, h('h3', {}, 'Dirección'), etiqueta('Dónde está el local', dir), dir,
      h('p', { class: 'ayuda' }, 'El asistente la da con un link al mapa cuando preguntan dónde están.'),
      d.mapa ? h('a', { class: 'btn chico', href: d.mapa, target: '_blank', rel: 'noopener' }, 'Ver en el mapa') : null);

    // Envíos por zona.
    const num = (z, k, ph) => h('input', { type: 'number', min: 0, step: 'any', value: z[k] || '', disabled: dis, placeholder: ph, oninput: (e) => { z[k] = e.target.value === '' ? 0 : Number(e.target.value); marcar(); } });
    const filaZona = (z, k) => {
      const nombre = h('input', { type: 'text', maxlength: 60, value: z.nombre, disabled: dis, placeholder: 'Ejemplo: Centro', oninput: (e) => { z.nombre = e.target.value; marcar(); } });
      const costo = num(z, 'costo', '0 = sin cargo'); const minimo = num(z, 'minimo', 'Opcional'); const gratis = num(z, 'gratisDesde', 'Opcional');
      const demora = h('input', { type: 'text', maxlength: 60, value: z.demora, disabled: dis, placeholder: 'Ejemplo: en 2 horas', oninput: (e) => { z.demora = e.target.value; marcar(); } });
      return h('div', { class: 'fila-ed' },
        h('div', {}, etiqueta('Zona', nombre), nombre), h('div', {}, etiqueta('Costo', costo), costo), h('div', {}, etiqueta('Pedido mínimo', minimo), minimo),
        h('div', {}, etiqueta('Gratis desde', gratis), gratis), h('div', {}, etiqueta('Cuánto tarda', demora), demora),
        puede ? h('button', { type: 'button', class: 'btn chico peligro', onclick: () => { m.envios.zonas.splice(k, 1); marcar(); repintar(); } }, 'Quitar') : null);
    };
    const envios = h('div', { class: 'caja' }, h('h3', {}, 'Envíos por zona'),
      h('p', { class: 'ayuda' }, 'Con zonas cargadas, en el pedido por chat el asistente pregunta la zona, suma el costo y avisa si no llega al mínimo.'),
      m.envios.zonas.length ? m.envios.zonas.map(filaZona) : h('p', { class: 'ayuda' }, 'Sin zonas: el envío se arregla por el texto de Cómo vendés.'),
      puede ? h('div', { class: 'acciones' }, h('button', { type: 'button', class: 'btn', onclick: () => { m.envios.zonas.push({ nombre: '', costo: 0, minimo: 0, gratisDesde: 0, demora: '' }); marcar(); repintar(); } }, '+ Agregar zona')) : null);

    // Formas de pago.
    const check = (k, t) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: m.pagos[k], disabled: dis, onchange: (e) => { m.pagos[k] = e.target.checked; marcar(); } }), t);
    const alias = h('input', { type: 'text', maxlength: 80, value: m.pagos.alias, disabled: dis, placeholder: 'Ejemplo: MI.NEGOCIO', oninput: (e) => { m.pagos.alias = e.target.value; marcar(); } });
    const pagos = h('div', { class: 'caja' }, h('h3', {}, 'Formas de pago'),
      check('efectivo', 'Efectivo'), check('transferencia', 'Transferencia'), check('mercadopago', 'Mercado Pago'), check('tarjeta', 'Tarjeta'),
      etiqueta('Alias o CBU para transferir', alias), alias,
      h('p', { class: 'ayuda' }, 'El alias va solo en el aviso de pedido aceptado (el asistente no lo da por chat). Nunca pongas claves ni datos de tarjetas.'));

    // Contacto y zona horaria.
    const campo = (k, t, tipo, ph) => { const i = h('input', { type: tipo, maxlength: 200, value: m.contacto[k], disabled: dis, placeholder: ph, oninput: (e) => { m.contacto[k] = e.target.value; marcar(); } }); return h('div', {}, etiqueta(t, i), i); };
    const selZona = h('select', { disabled: dis, onchange: (e) => { zona = e.target.value; marcar(); } }, d.zonas.map((z) => h('option', { value: z.z, selected: z.z === zona }, z.nombre)));
    const contacto = h('div', { class: 'caja' }, h('h3', {}, 'Contacto y zona horaria'),
      h('div', { class: 'dosc' }, campo('telefono', 'Teléfono', 'tel', 'Opcional'), campo('correo', 'Correo', 'email', 'Opcional'), campo('instagram', 'Instagram', 'text', 'usuario, sin @'), campo('web', 'Web', 'url', 'https://…')),
      h('p', { class: 'ayuda' }, 'El asistente los da si se los piden.'),
      etiqueta('Zona horaria del negocio', selZona), selZona,
      h('p', { class: 'ayuda' }, 'Para los horarios, los feriados y los reportes.'));

    const guardar = h('button', { type: 'submit', class: 'btn prim', disabled: true }, 'Guardar');
    const form = h('form', { onsubmit: conError(async (e) => {
      e.preventDefault();
      const r = await api(base() + '/mi-negocio', { metodo: 'PUT', cuerpo: { minegocio: m, zona: zona } });
      estado.datos.negocio.ajustes = Object.assign({}, estado.datos.negocio.ajustes, { zona: r.zona });
      pintarMiNegocio(caja, r);
      aviso('Guardado. El asistente ya lo usa.');
    }) }, horarios, especiales, fuera, direccion, envios, pagos, contacto,
      puede ? h('div', { class: 'guardar-fijo' }, guardar) : null);

    // Lo que no supo responder → «Responder y guardar» lo pasa a las preguntas frecuentes.
    const noSupo = h('div', { class: 'caja' }, h('h3', {}, 'Lo que no supo responder'),
      d.noSupo.length ? h('ul', { class: 'lista' }, d.noSupo.map((x) => {
        const resp = h('textarea', { rows: 2, maxlength: 600, placeholder: 'Escribí la respuesta, así la próxima la sabe' });
        return h('li', { class: 'tarjeta' }, h('p', { class: 'cita' }, x.p), h('p', { class: 'ayuda' }, x.n === 1 ? 'Lo preguntaron 1 vez.' : 'Lo preguntaron ' + x.n + ' veces.'), resp,
          h('div', { class: 'acciones' },
            h('button', { type: 'button', class: 'btn', onclick: conError(async () => { pintarMiNegocio(caja, await api(base() + '/mi-negocio/no-supo', { metodo: 'POST', cuerpo: { pregunta: x.p } })); aviso('Listo, la saqué de la lista.'); }) }, 'Descartar'),
            h('button', { type: 'button', class: 'btn prim', onclick: conError(async () => {
              if (!resp.value.trim()) { resp.focus(); aviso('Escribí la respuesta primero.', true); return; }
              pintarMiNegocio(caja, await api(base() + '/mi-negocio/no-supo', { metodo: 'POST', cuerpo: { pregunta: x.p, respuesta: resp.value } }));
              aviso('Guardada en las preguntas frecuentes. El asistente ya la sabe.');
            }) }, 'Responder y guardar')));
      })) : h('p', { class: 'ayuda' }, 'Nada por ahora. Cuando el asistente no sepa algo, aparece acá para que lo cargues una sola vez.'));

    // Preguntas frecuentes (las carga el negocio; mandan sobre la ficha).
    const pf = d.preguntas.map((x) => ({ p: x.p, r: x.r, t: x.t }));
    const listaPf = h('div', {});
    const pintarPf = () => poner(listaPf, pf.length ? pf.map((x, k) => {
      const p = h('input', { type: 'text', maxlength: 200, value: x.p, placeholder: 'La pregunta', oninput: (e) => { x.p = e.target.value; } });
      const r = h('textarea', { rows: 2, maxlength: 600, placeholder: 'La respuesta', oninput: (e) => { x.r = e.target.value; } }, x.r);
      r.value = x.r;
      return h('div', { class: 'fila-ed' }, h('div', {}, etiqueta('Pregunta', p), p), h('div', {}, etiqueta('Respuesta', r), r),
        h('button', { type: 'button', class: 'btn chico peligro', onclick: () => { pf.splice(k, 1); pintarPf(); } }, 'Quitar'));
    }) : h('p', { class: 'ayuda' }, 'Todavía no hay. Sumá las que más te hacen (por ejemplo: «¿Hacen tortas sin TACC?»).'));
    pintarPf();
    const preguntas = h('div', { class: 'caja' }, h('h3', {}, 'Preguntas frecuentes'),
      h('p', { class: 'ayuda' }, 'El asistente las usa tal cual: mandan sobre lo demás.'), listaPf,
      h('div', { class: 'acciones' },
        h('button', { type: 'button', class: 'btn', onclick: () => { pf.push({ p: '', r: '' }); pintarPf(); } }, '+ Agregar pregunta'),
        h('button', { type: 'button', class: 'btn prim', onclick: conError(async () => {
          pintarMiNegocio(caja, await api(base() + '/mi-negocio/preguntas', { metodo: 'PUT', cuerpo: { preguntas: pf.filter((x) => x.p.trim() && x.r.trim()) } }));
          aviso('Preguntas guardadas. El asistente ya las usa.');
        }) }, 'Guardar preguntas')));

    const historial = d.cambios.length ? h('details', {}, h('summary', {}, 'Historial de cambios'),
      h('ul', { class: 'lista' }, d.cambios.map((c) => h('li', { class: 'ayuda' }, fecha(c.t) + ' · ' + (c.quien || 'alguien') + ' ' + c.que)))) : null;

    poner(caja,
      h('h2', {}, 'Mi negocio'),
      h('p', { class: 'ayuda' }, 'Lo que el asistente sabe de tu negocio. Lo cambiás cuando quieras y lo usa desde la próxima respuesta.'),
      d.ahora ? h('span', { class: 'estado-ahora ' + (d.ahora.abierto ? 'ok' : 'cerrado') }, (d.ahora.abierto ? 'Abierto ahora' : 'Cerrado ahora') + (d.ahora.texto ? ' · ' + (d.ahora.abierto ? '' : 'abre ') + d.ahora.texto.replace(' desde las ', ' a las ') : '')) : h('span', { class: 'estado-ahora cerrado' }, 'Sin horarios cargados'),
      !puede ? h('p', { class: 'pausa' }, 'Los datos del negocio los cambia el dueño. Vos podés responder lo que no supo y editar las preguntas frecuentes.') : null,
      form, noSupo, preguntas, historial);
  }

  // ── Cómo vendés (ZL-148): entrega, pago y cuánto se guarda un pedido aceptado. El asistente los usa solo. ──
  function vistaAjustes() {
    const a = estado.datos.negocio.ajustes || {};
    const entrega = h('select', {}, [['ambos', 'Retiro y envío'], ['retiro', 'Solo retiro en el local'], ['envio', 'Solo envío']].map(([v, t]) => h('option', { value: v, selected: a.entrega === v }, t)));
    const retiro = h('textarea', { rows: 2, maxlength: 300, placeholder: 'Ejemplo: Calle 123, de lunes a sábado de 9 a 20' }, a.retiro || '');
    const envio = h('textarea', { rows: 2, maxlength: 300, placeholder: 'Ejemplo: zona centro $ 1.500, otras zonas a convenir; de 18 a 21' }, a.envio || '');
    const pago = h('textarea', { rows: 2, maxlength: 300, placeholder: 'Ejemplo: transferencia al alias MI.NEGOCIO o efectivo al retirar' }, a.pago || '');
    const reserva = h('select', {}, [[2, '2 horas'], [24, '24 horas'], [48, '48 horas'], [168, '7 días']].map(([v, t]) => h('option', { value: v, selected: Number(a.reservaHoras || 24) === v }, t)));
    retiro.value = a.retiro || ''; envio.value = a.envio || ''; pago.value = a.pago || '';
    // ZL-164: solo lo que aplica. Sin pedidos por chat no hay reserva; con «solo retiro» no hay envío (y al revés). La
    // zona horaria pasó a «Mi negocio», con los horarios.
    const pedidos = estado.datos.negocio.pedidos === true;
    const bloqueRetiro = h('div', {}, etiqueta('Retiro: dónde y cuándo', retiro), retiro);
    const bloqueEnvio = h('div', {}, etiqueta('Envío: zonas, costo y horarios', envio), envio, h('p', { class: 'ayuda' }, 'Si cargás las zonas con su costo en Mi negocio → Envíos, el asistente pregunta la zona y suma el envío solo.'));
    const segunEntrega = () => { bloqueRetiro.hidden = entrega.value === 'envio'; bloqueEnvio.hidden = entrega.value === 'retiro'; };
    entrega.addEventListener('change', segunEntrega);
    segunEntrega();
    return h('section', {},
      h('h2', {}, 'Cómo vendés'),
      h('p', { class: 'ayuda' }, 'Lo cargás una vez. El asistente lo usa para responder, y cuando aceptás un pedido le manda al comprador cómo pagar y cómo recibirlo: no tenés que escribir nada a mano.'),
      h('form', { class: 'wa-form', onsubmit: conError(async (e) => {
        e.preventDefault();
        const r = await api(base() + '/ajustes', { metodo: 'PUT', cuerpo: { entrega: entrega.value, retiro: retiro.value, envio: envio.value, pago: pago.value, ...(pedidos && { reservaHoras: Number(reserva.value) }) } });
        estado.datos.negocio.ajustes = r;
        aviso('Guardado. El asistente ya lo usa.');
      }) },
        etiqueta('¿Cómo entregás?', entrega), entrega,
        bloqueRetiro, bloqueEnvio,
        etiqueta('Cómo se paga', pago), pago,
        h('p', { class: 'ayuda' }, 'Alias, link de pago o efectivo. Nunca pongas claves ni datos de tarjetas. Si marcás las formas de pago en Mi negocio, mandan sobre este texto.'),
        pedidos ? h('div', {}, etiqueta('Cuánto te guardo un pedido aceptado sin pagar', reserva), reserva,
          h('p', { class: 'ayuda' }, 'Pasado ese tiempo sin marcarlo pagado ni entregado, se cancela solo y los productos vuelven a la venta.')) : null,
        h('p', { class: 'ayuda' }, 'Los horarios, la dirección y la zona horaria están en Mi negocio.'),
        h('div', { class: 'acciones' }, h('button', { type: 'submit', class: 'btn prim' }, 'Guardar'))));
  }

  function pintarVista() {
    document.querySelectorAll('.tabs button').forEach((b, i) => b.setAttribute('aria-selected', PESTANAS()[i][0] === estado.tab ? 'true' : 'false'));
    const v = document.getElementById('vista');
    poner(v);
    if (!estado.negocio) {
      v.append(estado.yo.admin ? vistaAdmin() : h('div', { class: 'vacio' }, 'Tu correo todavía no está en ningún negocio. Escribinos a contact@zustrolabs.com.'));
      return;
    }
    if (estado.timerPedidos) { clearInterval(estado.timerPedidos); estado.timerPedidos = null; }
    const vistas = { inicio: vistaPedidos, productos: vistaSeccionProductos, minegocio: vistaMiNegocio, reportes: vistaReportes, conexiones: vistaConexiones, asistente: () => (estado.yo.admin ? h('div', {}, vistaMiAsistente(), vistaAsistente()) : vistaMiAsistente()), admin: vistaAdmin };
    v.append((vistas[estado.tab] || vistaPedidos)());
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
        h('span', { class: 'chip' }, 'Canales: ' + ([d.negocio.canales.instagram ? 'Instagram' : '', d.negocio.canales.whatsapp ? 'WhatsApp' : ''].filter(Boolean).join(' y ') || 'ninguno'))));
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
      // ZL-159: con más de 200 productos, «Ver más» trae los siguientes (antes solo se podían encontrar buscando).
      let mostrados = r.productos.length;
      const mas = () => {
        if (r.total <= mostrados) return null;
        const li = h('li', { class: 'acciones' });
        li.append(h('button', { type: 'button', class: 'btn', onclick: conError(async () => {
          const sig = await api(base() + '/productos?' + new URLSearchParams({ q: estado.q, categoria: estado.categoria, pausados: estado.pausados ? '1' : '0', desde: String(mostrados) }));
          li.remove();
          for (const p of sig.productos) lista.append(filaProducto(p, cargar));
          mostrados += sig.productos.length;
          const otro = sig.productos.length ? mas() : null;
          if (otro) lista.append(otro);
        }) }, 'Ver más (' + mostrados + ' de ' + r.total + ')'));
        return li;
      };
      const boton = mas();
      if (boton) lista.append(boton);
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
          p.reservado ? h('span', { class: 'chip alerta' }, p.reservado + (p.reservado === 1 ? ' reservada' : ' reservadas')) : null,
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
          enSerio ? h('div', { class: 'acciones' }, h('button', { class: 'btn', onclick: () => { estado.tab = 'productos'; estado.sub.productos = 'lista'; recordar(); pintar(); } }, 'Ver productos')) : null);
      }
    }
    return caja;
  }

  // ── Historial ──
  function vistaHistorial() {
    const caja = h('section', {}, h('h2', {}, 'Historial'), h('p', { class: 'ayuda' }, 'Cada cambio de stock, precio o producto, con quién lo hizo. Los últimos 200.'));
    const cuerpo = h('tbody', {});
    caja.append(h('div', { class: 'scroll' }, h('table', { class: 'tabla apilada' },
      h('thead', {}, h('tr', {}, ['Cuándo', 'Producto', 'Qué', 'Antes', 'Después', 'Quién'].map((t) => h('th', {}, t)))), cuerpo)));
    const QUE = { alta: 'Alta', baja: 'Borrado', stock: 'Stock', precio: 'Precio', estado: 'A la venta', dato: 'Datos' };
    conError(async () => {
      const r = await api(base() + '/historial');
      if (!r.movimientos.length) cuerpo.append(h('tr', {}, h('td', { colspan: 6 }, 'Todavía no hay cambios.')));
      // En el celular cada fila es una tarjeta (cada dato con su título); «Alta · alta» no se repite.
      for (const m of r.movimientos) {
        const que = (QUE[m.tipo] || m.tipo) + (m.detalle && m.detalle.toLowerCase() !== String(QUE[m.tipo] || m.tipo).toLowerCase() && m.detalle !== m.tipo ? ' · ' + m.detalle : '');
        cuerpo.append(h('tr', {}, h('td', {}, fecha(m.t)), h('td', { 'data-t': 'Producto' }, m.nombre), h('td', { 'data-t': 'Qué' }, que),
          m.antes !== null && m.antes !== undefined && m.antes !== '' ? h('td', { 'data-t': 'Antes' }, m.antes) : h('td', {}),
          m.despues !== null && m.despues !== undefined && m.despues !== '' ? h('td', { 'data-t': 'Después' }, m.despues) : h('td', {}),
          h('td', { 'data-t': 'Quién' }, m.quien)));
      }
    })();
    return caja;
  }

  // ── Inicio (ZL-139, ZL-146, ZL-148): lo que el asistente le deja al negocio. Pedidos para confirmar y consultas
  // para responder, con un botón para cada cosa. Lo demás lo hace el asistente. ──
  const ESTADO_PEDIDO = { pendiente: 'Nuevo', aceptado: 'Aceptado', pagado: 'Pagado', entregado: 'Entregado', rechazado: 'Rechazado', cancelado: 'Cancelado', vencido: 'Vencido' };
  const CANAL_PEDIDO = { wa: 'WhatsApp', ig: 'Instagram' };
  const plata = (n) => '$ ' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
  // ZL-162: con fecha y en 24 h («sáb 22/11, 14:05»); antes salía «sáb, 02:23 a. m..» (sin fecha y con doble punto).
  const hora = (t) => new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t));
  function sonar() {
    try {
      const c = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18].forEach((d) => { const o = c.createOscillator(); const g = c.createGain(); o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(c.destination); o.start(c.currentTime + d); o.stop(c.currentTime + d + 0.12); });
    } catch (e) { /* sin audio: no pasa nada */ }
  }
  /** Pide permiso, registra el service worker y suscribe este celular a los avisos del negocio (ZL-151). */
  async function activarAvisos() {
    sonar();
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !window.Notification) {
      aviso('Este navegador no tiene avisos. En iPhone, primero agregá la app a la pantalla de inicio (Compartir → Agregar a inicio) y abrila desde ahí. Mientras, con esta pestaña abierta, suena.');
      return;
    }
    if ((await Notification.requestPermission()) !== 'granted') { aviso('Sin permiso no te puedo avisar. Activá las notificaciones de este sitio en el navegador.', true); return; }
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const { clave } = await api(base() + '/push');
    const bytes = Uint8Array.from(atob(clave.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((clave.length + 3) % 4)), (c) => c.charCodeAt(0));
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes }));
    await api(base() + '/push', { metodo: 'POST', cuerpo: { suscripcion: sub.toJSON() } });
    await api(base() + '/push/probar', { metodo: 'POST', cuerpo: {} });
    aviso('Listo: te va a llegar un aviso por cada pedido o consulta nueva, aunque la app esté cerrada.');
  }

  /** El botón para responderle a esa persona desde la app del negocio (WhatsApp con su número, o Instagram). */
  /**
   * ZL-153: por dónde escribió y quién (el número de WhatsApp o el @usuario de Instagram), con un botón para copiarlo:
   * así se la encuentra rápido en el celular.
   */
  function lineaContacto(x) {
    const k = x.contacto;
    if (!k) return h('p', { class: 'contacto' }, 'Por ' + (CANAL_PEDIDO[x.canal] || x.canal || 'chat'));
    const copiar = h('button', { type: 'button', class: 'btn chico', 'aria-label': 'Copiar ' + k.texto }, 'Copiar');
    copiar.onclick = () => {
      const listo = () => { copiar.textContent = 'Copiado'; setTimeout(() => { copiar.textContent = 'Copiar'; }, 1500); };
      try { navigator.clipboard.writeText(k.texto).then(listo, () => {}); } catch (e) { /* nada */ }
    };
    const sinUsuario = k.canal === 'instagram' && k.texto.charAt(0) !== '@';
    return h('p', { class: 'contacto' },
      h('span', {}, 'Te escribió por ' + (k.canal === 'whatsapp' ? 'WhatsApp' : 'Instagram') + ': '),
      h('strong', {}, sinUsuario ? 'no sabemos el usuario' : k.texto), ' ',
      sinUsuario ? null : copiar);
  }
  function botonResponder(charla, canal, contacto) {
    if (contacto && contacto.enlace) return h('a', { class: 'btn', href: contacto.enlace, target: '_blank', rel: 'noopener' }, contacto.canal === 'whatsapp' ? 'Responder por WhatsApp' : contacto.texto.charAt(0) === '@' ? 'Responder por Instagram' : 'Abrir Instagram');
    const m = /^yc:\d+:(\d+)$/.exec(charla || '');
    if (m) return h('a', { class: 'btn', href: 'https://wa.me/' + m[1], target: '_blank', rel: 'noopener' }, 'Responder por WhatsApp');
    if (canal === 'ig' || /^ig:/.test(charla || '')) return h('a', { class: 'btn', href: 'https://www.instagram.com/direct/inbox/', target: '_blank', rel: 'noopener' }, 'Abrir Instagram');
    return null;
  }
  /** Dos toques para lo que no se deshace: el primero pide confirmar (y deja escribir el motivo). */
  function dosPasos(texto, confirmar, alConfirmar, conMotivo) {
    const motivo = conMotivo ? h('input', { type: 'text', maxlength: 200, placeholder: 'Motivo (opcional, lo ve el comprador)', 'aria-label': 'Motivo', hidden: true }) : null;
    const b = h('button', { type: 'button', class: 'btn' }, texto);
    b.onclick = () => {
      if (b.dataset.seguro) return alConfirmar(motivo ? motivo.value : '');
      b.dataset.seguro = '1'; b.textContent = confirmar; b.classList.add('peligro');
      if (motivo) { motivo.hidden = false; motivo.focus(); }
    };
    return motivo ? [motivo, b] : [b];
  }

  const ESTADO_CONSULTA = { nueva: 'Nueva', atendiendo: 'La estás atendiendo', ganada: 'Ganada', perdida: 'Perdida', resuelta: 'Resuelta' };
  // ZL-162: lo que dejó listo «Que siga el asistente» cuando la respuesta no pudo salir sola (pasaron las 24 h).
  const avisosConsulta = {};
  const TIPO_CONSULTA = { consulta: 'Quiere avanzar', persona: 'Necesita a alguien del negocio' };
  function tarjetaConsulta(c, recargar) {
    const pasar = (nuevo) => conError(async () => {
      const r = await api(base() + '/consultas/' + c.numero, { metodo: 'POST', cuerpo: { estado: nuevo } });
      aviso('Consulta N.º ' + c.numero + ': ' + ESTADO_CONSULTA[nuevo].toLowerCase() + (r.pausaHasta ? '. El asistente no se mete en esa charla hasta ' + hora(r.pausaHasta) + '.' : '.'));
      await recargar();
    });
    // ZL-162: «Que siga el asistente» con la respuesta opcional: se le manda, la aprende y no vuelve a pasar la charla.
    const respuesta = h('textarea', { rows: 2, maxlength: 600, id: 'resp-' + c.numero, placeholder: c.interes ? 'Por ejemplo, qué contestarle sobre «' + c.interes.slice(0, 60) + '»' : 'Lo que el asistente le tiene que decir' });
    const guardar = h('input', { type: 'checkbox', id: 'guardar-' + c.numero, checked: true });
    const devolverForm = h('form', { class: 'formulario', hidden: true, onsubmit: conError(async (e) => {
      e.preventDefault();
      const r = await api(base() + '/consultas/' + c.numero + '/devolver', { metodo: 'POST', cuerpo: { respuesta: respuesta.value, guardar: guardar.checked } });
      if (r.aviso) avisosConsulta[c.numero] = r.aviso;
      aviso(r.respondida
        ? (r.aviso ? 'El asistente sigue. La respuesta no le llegó sola: mandásela desde la tarjeta.' : 'Listo: le mandamos tu respuesta y el asistente sigue.' + (r.guardada ? ' La guardé en tus preguntas frecuentes.' : ''))
        : 'Listo: el asistente vuelve a responder en esa charla. Si vuelve a preguntar eso, le dice que todavía no está confirmado.');
      await recargar();
    }) },
      h('label', { for: 'resp-' + c.numero }, '¿Qué le respondemos? (opcional)'), respuesta,
      c.interes ? h('label', { class: 'check', for: 'guardar-' + c.numero }, guardar, 'Guardarla en mis preguntas frecuentes (el asistente la va a saber)') : null,
      h('div', { class: 'acciones' }, h('button', { type: 'submit', class: 'btn prim' }, 'Que siga el asistente')));
    const abrirDevolver = h('button', { type: 'button', class: 'btn', 'aria-expanded': 'false', onclick: () => { devolverForm.hidden = !devolverForm.hidden; abrirDevolver.setAttribute('aria-expanded', String(!devolverForm.hidden)); if (!devolverForm.hidden) respuesta.focus(); } }, 'Que siga el asistente');
    const botones = [botonResponder(c.charla, c.canal, c.contacto)];
    if (c.estado === 'nueva') botones.push(h('button', { type: 'button', class: 'btn', onclick: pasar('atendiendo') }, 'La atiendo yo'));
    if (c.tipo === 'persona' || c.pausaHasta) botones.push(abrirDevolver);
    if (c.tipo === 'persona') botones.push(h('button', { type: 'button', class: 'btn', onclick: pasar('resuelta') }, 'Ya lo resolví'));
    else botones.push(h('button', { type: 'button', class: 'btn', onclick: pasar('ganada') }, 'Ganada'), h('button', { type: 'button', class: 'btn', onclick: pasar('perdida') }, 'Perdida'));
    const manual = avisosConsulta[c.numero];
    return h('article', { class: 'tarjeta consulta' + (c.estado === 'nueva' ? ' nuevo' : '') },
      h('h3', {}, 'Consulta N.º ' + c.numero + ' · ' + (c.nombre || 'Sin nombre')),
      h('div', { class: 'chips' },
        h('span', { class: 'chip ' + (c.estado === 'nueva' ? 'alerta' : '') }, ESTADO_CONSULTA[c.estado] || c.estado),
        h('span', { class: 'chip' }, TIPO_CONSULTA[c.tipo] || c.tipo),
        h('span', { class: 'chip' }, fecha(c.actualizado))),
      lineaContacto(c),
      c.resumen ? h('p', {}, c.resumen) : h('p', { class: 'ayuda' }, 'Sin resumen: mirá la charla en tu app.'),
      c.pausaHasta ? h('div', { class: 'pausa' }, 'El asistente está callado en esta charla hasta el ' + hora(c.pausaHasta) + ' (o hasta que toques «Que siga el asistente»).') : null,
      manual ? h('div', { class: 'pausa', role: 'status' }, h('p', {}, h('strong', {}, 'Tu respuesta no le llegó sola: '), manual.motivo + '. Mandásela vos:'), h('p', { class: 'cita' }, manual.texto),
        manual.enlace ? h('div', { class: 'acciones' }, h('a', { class: 'btn prim', href: manual.enlace, target: '_blank', rel: 'noopener' }, manual.canal === 'whatsapp' ? 'Mandárselo por WhatsApp' : 'Abrir Instagram')) : null) : null,
      h('div', { class: 'acciones' }, botones),
      devolverForm,
      h('p', { class: 'ayuda' }, (c.tipo === 'persona' ? '«La atiendo yo» calla al asistente mientras le escribís vos. «Que siga el asistente» lo vuelve a encender (si escribís qué contestarle, se lo manda y lo aprende). «Ya lo resolví» la cierra.' : '«Ganada» o «Perdida» la cierran y cuentan en tus números.')));
  }

  /**
   * ZL-158: cuántos mensajes mandó el asistente por WhatsApp este mes. Meta da 1.000 gratis por número por mes; pasando
   * eso cobra cada mensaje (en la cuenta de YCloud del negocio). A los 800 se avisa.
   */
  function lineaConsumoWa(w) {
    if (!w) return null;
    const pasado = w.enviados > w.gratis;
    const cerca = w.enviados >= w.aviso;
    const fmt = (x) => Number(x).toLocaleString('es-AR');
    return h('p', { class: pasado || cerca ? 'chip alerta' : 'ayuda' },
      'WhatsApp este mes: ' + fmt(w.enviados) + ' de ' + fmt(w.gratis) + ' mensajes gratis. ' +
      (pasado ? 'Ya pasaste los gratis: Meta cobra cada mensaje que manda el asistente, en tu cuenta de YCloud.'
        : cerca ? 'Te quedan ' + fmt(w.gratis - w.enviados) + '. Pasando los ' + fmt(w.gratis) + ', Meta cobra cada mensaje (en tu cuenta de YCloud). Lo que escribís vos desde tu app no cuenta.'
          : 'Pasando los ' + fmt(w.gratis) + ', Meta cobra cada mensaje que manda el asistente. Lo que escribís vos desde tu app no cuenta.'));
  }

  function tarjetaPedido(p, recargar) {
    const accion = (nuevo, extra) => conError(async () => {
      const r = await api(base() + '/pedidos/' + p.numero, { metodo: 'POST', cuerpo: Object.assign({ estado: nuevo }, extra || {}) });
      // ZL-157: si no le llegó solo, la tarjeta queda con el mensaje listo para mandarlo con un toque.
      estado.avisosManuales = estado.avisosManuales || {};
      if (r.aviso && r.aviso.pendiente) estado.avisosManuales[p.numero] = r.aviso;
      else delete estado.avisosManuales[p.numero];
      aviso('Pedido N.º ' + p.numero + ': ' + ESTADO_PEDIDO[nuevo].toLowerCase() + (r.aviso === true ? '. Le avisamos al comprador.' : r.aviso && r.aviso.pendiente ? '. Falta avisarle: mandale el mensaje desde la tarjeta.' : '.'));
      // ZL-163: la lista sigue al pedido (antes desaparecía a otra pestaña y había que ir a buscarlo).
      if (['aceptado', 'pagado'].includes(nuevo)) { estado.filtroPedidos = nuevo; pintarVista(); return; }
      await recargar();
    });
    // ZL-163: corregir los datos del comprador (escribió mal el nombre, o cambió de envío a retiro).
    const c0 = p.comprador || {};
    const cNombre = h('input', { type: 'text', maxlength: 80, value: c0.nombre || '', id: 'cn-' + p.numero });
    const cEntrega = h('select', { id: 'ce-' + p.numero }, h('option', { value: 'retiro', selected: c0.entrega !== 'envio' }, 'Retira en el local'), h('option', { value: 'envio', selected: c0.entrega === 'envio' }, 'Envío'));
    const cDir = h('input', { type: 'text', maxlength: 200, value: c0.direccion || '', id: 'cd-' + p.numero });
    const corregir = h('form', { class: 'formulario', hidden: true, onsubmit: conError(async (e) => {
      e.preventDefault();
      await api(base() + '/pedidos/' + p.numero + '/comprador', { metodo: 'PUT', cuerpo: { nombre: cNombre.value, entrega: cEntrega.value, direccion: cDir.value } });
      aviso('Pedido N.º ' + p.numero + ': datos corregidos.');
      await recargar();
    }) },
      h('label', { for: 'cn-' + p.numero }, 'A nombre de'), cNombre,
      h('label', { for: 'ce-' + p.numero }, 'Entrega'), cEntrega,
      h('label', { for: 'cd-' + p.numero }, 'Dirección (si es envío)'), cDir,
      h('div', { class: 'acciones' }, h('button', { type: 'submit', class: 'btn prim' }, 'Guardar los datos')));
    const abrirCorregir = ['pendiente', 'aceptado', 'pagado'].includes(p.estado) && !c0.olvidado
      ? h('button', { type: 'button', class: 'btn', 'aria-expanded': 'false', onclick: (e) => { corregir.hidden = !corregir.hidden; e.target.setAttribute('aria-expanded', String(!corregir.hidden)); if (!corregir.hidden) cNombre.focus(); } }, 'Corregir datos')
      : null;
    const botones = [];
    if (p.estado === 'pendiente') botones.push(h('button', { type: 'button', class: 'btn prim', onclick: accion('aceptado') }, 'Aceptar'), ...dosPasos('Rechazar', 'Confirmar rechazo', (m) => accion('rechazado', { motivo: m })(), true));
    if (p.estado === 'aceptado') botones.push(h('button', { type: 'button', class: 'btn prim', onclick: accion('entregado') }, 'Entregado'), h('button', { type: 'button', class: 'btn', onclick: accion('pagado') }, 'Ya pagó'), ...dosPasos('Cancelar', 'Confirmar cancelación', (m) => accion('cancelado', { motivo: m })(), true));
    if (p.estado === 'pagado') botones.push(h('button', { type: 'button', class: 'btn prim', onclick: accion('entregado') }, 'Entregado'), ...dosPasos('Cancelar', 'Confirmar cancelación', (m) => accion('cancelado', { motivo: m })(), true));
    const c = p.comprador || {};
    // ZL-157: un pedido pendiente no se vence: espera a que lo aceptes o lo rechaces (los productos quedan reservados).
    const vence = p.estado === 'pendiente' ? 'Espera tu respuesta: los productos quedan reservados hasta que lo aceptes o lo rechaces.' : p.vence ? 'Guardado hasta el ' + hora(p.vence) + ' si no paga.' : null;
    return h('article', { class: 'tarjeta pedido' + (p.estado === 'pendiente' ? ' nuevo' : '') },
      h('h3', {}, 'Pedido N.º ' + p.numero + ' · ' + (c.nombre || (c.olvidado ? 'Datos borrados por privacidad' : 'Sin nombre'))),
      h('div', { class: 'chips' },
        h('span', { class: 'chip ' + (p.estado === 'pendiente' ? 'alerta' : ['pagado', 'entregado'].includes(p.estado) ? 'ok' : '') }, ESTADO_PEDIDO[p.estado] || p.estado),
        h('span', { class: 'chip' }, c.entrega === 'envio' ? 'Envío: ' + (c.direccion || '') : 'Retira en el local'),
        h('span', { class: 'chip' }, fecha(p.creado))),
      lineaContacto(p),
      h('ul', {}, p.items.map((i) => h('li', {}, i.cantidad + ' × ' + i.nombre + (i.subtotal !== null ? ' — ' + plata(i.subtotal) : '')))),
      h('p', {}, h('strong', {}, p.sinPrecio ? 'Total: a confirmar (hay productos sin precio)' : 'Total: ' + plata(p.total))),
      vence ? h('p', { class: 'ayuda' }, vence) : null,
      cajaAvisoManual(p, recargar),
      h('div', { class: 'acciones' }, botonResponder(p.charla, p.canal, p.contacto), botones, abrirCorregir),
      corregir);
  }

  /**
   * ZL-157: el aviso al comprador que no pudo salir solo (Meta no deja escribirle pasadas las 24 h de su último
   * mensaje). El dueño lo manda desde su WhatsApp o su Instagram, que no tienen ese límite; y si el comprador vuelve a
   * escribir antes, el asistente se lo dice primero.
   */
  function cajaAvisoManual(p, recargar) {
    const a = (estado.avisosManuales || {})[p.numero] || p.avisoPendiente;
    if (!a) return null;
    const copiar = h('button', { type: 'button', class: 'btn' }, 'Copiar el mensaje');
    copiar.onclick = () => {
      try { navigator.clipboard.writeText(a.texto).then(() => { copiar.textContent = 'Copiado'; }, () => {}); } catch (e) { /* nada */ }
    };
    const listo = h('button', { type: 'button', class: 'btn' }, 'Ya se lo mandé');
    listo.onclick = conError(async () => {
      await api(base() + '/pedidos/' + p.numero + '/avisado', { metodo: 'POST', cuerpo: {} });
      if (estado.avisosManuales) delete estado.avisosManuales[p.numero];
      await recargar();
    });
    const mandar = a.enlace ? h('a', { class: 'btn prim', href: a.enlace, target: '_blank', rel: 'noopener' }, a.canal === 'whatsapp' ? 'Mandárselo por WhatsApp' : 'Abrir Instagram') : null;
    return h('div', { class: 'pausa', role: 'status' },
      h('p', {}, h('strong', {}, 'Falta avisarle al comprador: '), a.motivo + ', así que no le llega solo. Mandáselo vos desde tu ' + (a.canal === 'instagram' ? 'Instagram' : 'WhatsApp') + ' (ahí no hay límite). Si vuelve a escribir antes, el asistente se lo dice primero.'),
      h('p', { class: 'cita' }, a.texto),
      h('div', { class: 'acciones' }, mandar, a.canal === 'whatsapp' ? null : copiar, listo));
  }

  function vistaPedidos() {
    const filtro = estado.filtroPedidos || 'pendiente';
    const conPedidos = estado.datos.negocio.pedidos || estado.yo.admin;
    const resumen = h('div', { class: 'resumen', 'aria-live': 'polite' });
    const listaConsultas = h('div', { 'aria-live': 'polite' });
    const lista = h('div', { 'aria-live': 'polite' });
    const chips = h('div', { class: 'seg', role: 'group', 'aria-label': 'Ver pedidos' });
    // ZL-151: avisos al celular aunque la app esté cerrada (Web Push). Sin eso, con la pestaña abierta suena igual.
    const avisos = h('button', { class: 'btn', onclick: conError(async () => { await activarAvisos(); await revisarAvisos(); }) }, 'Avisos en este celular');
    // ZL-159: si ningún celular tiene los avisos, un pedido puede esperar sin que nadie se entere: se dice arriba.
    const sinAvisos = h('div', { 'aria-live': 'polite' });
    async function revisarAvisos() {
      const r = await api(base() + '/push').catch(() => null);
      poner(sinAvisos, r && !r.celulares ? h('p', { class: 'chip alerta' }, 'Ningún celular tiene los avisos activados: si entra un pedido con la app cerrada, no te enterás. Tocá «Avisos en este celular» en el celular del negocio.') : null);
    }
    const semana = h('div', { class: 'resumen', 'aria-label': 'Últimos 7 días' });
    const consumo = h('div', { 'aria-live': 'polite' });
    const caja = h('section', {},
      h('h2', {}, 'Hola' + (estado.datos.negocio.nombre ? ', ' + estado.datos.negocio.nombre : '')),
      h('p', { class: 'ayuda' }, 'El asistente atiende y guía cada charla hasta el final. Acá te deja solo lo que necesita de vos.'),
      sinAvisos, resumen,
      h('h3', {}, 'Últimos 7 días'), semana, consumo,
      h('div', { class: 'acciones' }, avisos),
      h('h3', {}, 'Consultas para responder'),
      listaConsultas,
      conPedidos ? h('h3', {}, 'Pedidos') : null,
      conPedidos && !estado.datos.negocio.pedidos ? h('p', { class: 'chip alerta' }, 'Los pedidos por chat están apagados en este negocio: se encienden en Admin.') : null,
      conPedidos ? chips : null, conPedidos ? lista : null);
    let ultimos = null;

    async function cargar() {
      // ZL-159: las abiertas de a 20, con «Ver más».
      const cuantasK = estado.cuantasConsultas || 20;
      const k = await api(base() + '/consultas?' + new URLSearchParams({ cuantos: String(cuantasK) }));
      const abiertas = k.consultas.filter((c) => ['nueva', 'atendiendo'].includes(c.estado));
      poner(listaConsultas, abiertas.length ? abiertas.map((c) => tarjetaConsulta(c, cargar)) : h('div', { class: 'vacio' }, 'No hay consultas para responder. Cuando alguien quiera avanzar o necesite a alguien del negocio, aparece acá y suena.'));
      if ((k.abiertas || 0) > abiertas.length && cuantasK < 200) {
        listaConsultas.append(h('div', { class: 'acciones' }, h('button', { type: 'button', class: 'btn', onclick: conError(async () => { estado.cuantasConsultas = Math.min(200, cuantasK + 20); await cargar(); }) }, 'Ver más consultas (' + abiertas.length + ' de ' + k.abiertas + ')')));
      }
      // ZL-159: de a 50, con «Ver más» (antes se veían los últimos 100 y el resto no aparecía).
      const cuantos = estado.cuantosPedidos || 50;
      const r = conPedidos ? await api(base() + '/pedidos?' + new URLSearchParams({ ...(filtro === 'todos' ? {} : { estado: filtro }), cuantos: String(cuantos) })) : { pedidos: [], cuenta: {} };
      const cuenta = r.cuenta || {};
      const nuevos = (cuenta.pendiente || 0) + (k.nuevas || 0);
      if (ultimos !== null && nuevos > ultimos) {
        sonar();
        try { if (window.Notification && Notification.permission === 'granted') new Notification('Algo nuevo para revisar', { body: (estado.datos.negocio.nombre || '') + ': ' + nuevos + ' entre pedidos y consultas' }); } catch (e) { /* nada */ }
      }
      ultimos = nuevos;
      document.title = (nuevos ? '(' + nuevos + ') ' : '') + 'Negocios · Zustro Labs';
      poner(resumen,
        h('div', {}, h('strong', {}, String(k.nuevas || 0)), h('span', {}, 'consultas nuevas')),
        conPedidos ? h('div', {}, h('strong', {}, String(cuenta.pendiente || 0)), h('span', {}, 'pedidos para aceptar')) : null,
        conPedidos ? h('div', {}, h('strong', {}, String((cuenta.aceptado || 0) + (cuenta.pagado || 0))), h('span', {}, 'pedidos para entregar')) : null);
      poner(chips, [['pendiente', 'Nuevos'], ['aceptado', 'Aceptados'], ['pagado', 'Pagados'], ['entregado', 'Entregados'], ['todos', 'Todos']].map(([id, t]) =>
        h('button', { type: 'button', 'aria-pressed': id === filtro ? 'true' : 'false', onclick: () => { estado.filtroPedidos = id; estado.cuantosPedidos = 50; pintarVista(); } }, t + (id !== 'todos' && cuenta[id] ? ' (' + cuenta[id] + ')' : ''))));
      poner(lista, r.pedidos.length ? r.pedidos.map((p) => tarjetaPedido(p, cargar)) : h('div', { class: 'vacio' }, filtro === 'pendiente' ? 'No hay pedidos nuevos. Cuando el asistente arme uno, aparece acá y suena.' : 'No hay pedidos en esta lista.'));
      const totalFiltro = filtro === 'todos' ? Object.values(cuenta).reduce((a, x) => a + x, 0) : cuenta[filtro] || 0;
      if (totalFiltro > r.pedidos.length && cuantos < 500) {
        lista.append(h('div', { class: 'acciones' }, h('button', { type: 'button', class: 'btn', onclick: conError(async () => { estado.cuantosPedidos = Math.min(500, cuantos + 50); await cargar(); }) }, 'Ver más pedidos (' + r.pedidos.length + ' de ' + totalFiltro + ')')));
      }
    }
    conError(cargar)();
    conError(revisarAvisos)();
    conError(async () => {
      const n = await api(base() + '/numeros');
      poner(semana,
        h('div', {}, h('strong', {}, String(n.charlas)), h('span', {}, 'charlas atendidas')),
        h('div', {}, h('strong', {}, String(n.consultas)), h('span', {}, 'consultas')),
        conPedidos ? h('div', {}, h('strong', {}, String(n.pedidos)), h('span', {}, 'pedidos')) : null,
        h('div', {}, h('strong', {}, String((n.ganadas || 0) + (n.entregados || 0))), h('span', {}, 'ventas cerradas' + (n.vendido ? ' · ' + plata(n.vendido) : ''))));
      poner(consumo, lineaConsumoWa(n.whatsappMes));
    })();
    // Mientras la pestaña está abierta, se mira cada 20 segundos.
    estado.timerPedidos = setInterval(() => { if (!document.hidden) cargar().catch(() => {}); }, 20000);
    return caja;
  }

  // ── Instagram (ZL-137): el negocio conecta su cuenta con un botón (app de Zustro Labs para clientes) ──
  // ZL-138: qué pasó con los correos en Access al guardar.
  function textoAcceso(a) {
    if (!a) return '';
    if (a.ok) return a.agregados && a.agregados.length ? '. Agregados a Access: ' + a.agregados.join(', ') : '';
    return '. Ojo: agregá a mano en Access (' + a.error + '): ' + (a.faltan || []).join(', ');
  }

  function vistaInstagram() {
    const enlace = (texto, url) => h('a', { href: url, target: '_blank', rel: 'noopener' }, texto);
    const lista = h('div', { 'aria-live': 'polite' });
    const pasos = h('div', {});
    const comentarios = h('div', {});
    const caja = h('section', {},
      h('h2', {}, 'Instagram'),
      h('p', { class: 'ayuda' }, 'Conectá el Instagram de tu negocio para que el asistente conteste los mensajes directos con tu ficha y tus productos. No hace falta Facebook ni crear nada en Meta.'),
      estado.datos.asistente.activo ? null : h('p', { class: 'chip alerta' }, 'Tu asistente todavía no está activo: lo activa el equipo de Zustro Labs. Podés conectar la cuenta igual.'),
      lista, comentarios, pasos);
    /**
     * ZL-160: responder comentarios de las publicaciones. Apagado hasta que el dueño lo enciende; dos modos. Si una
     * cuenta se conectó antes de este permiso (o lo destildó), se le pide conectarla de nuevo.
     */
    const pintarComentarios = (r) => {
      if (!r.cuentas.length) { poner(comentarios); return; }
      const c = r.comentarios || { activo: false, modo: 'publico_privado' };
      const activo = h('input', { type: 'checkbox', id: 'cm-activo', checked: c.activo });
      const modo = h('select', { id: 'cm-modo', disabled: !c.activo },
        h('option', { value: 'publico_privado', selected: c.modo === 'publico_privado' }, 'Una frase corta en público y el detalle por privado (recomendado)'),
        h('option', { value: 'privado', selected: c.modo === 'privado' }, 'Solo por mensaje privado'));
      const guardar = conError(async () => {
        const x = await api(base() + '/instagram/comentarios', { metodo: 'PUT', cuerpo: { activo: activo.checked, modo: modo.value } });
        estado.datos.negocio.comentarios = x.comentarios;
        aviso(x.comentarios.activo ? 'Listo: el asistente responde los comentarios nuevos de tus publicaciones.' : 'Listo: el asistente ya no responde comentarios.');
        cargar();
      });
      activo.onchange = guardar;
      modo.onchange = guardar;
      const faltan = r.cuentas.filter((x) => x.conectada && x.permisoComentarios !== true);
      poner(comentarios,
        h('h3', {}, 'Comentarios de tus publicaciones'),
        h('p', { class: 'ayuda' }, 'El asistente también puede responder los comentarios con tu información: precios (si los mostrás), dónde están, horarios y productos. Los reclamos y lo que no sabe no los contesta en público: te llega un aviso para que respondas vos.'),
        h('div', { class: 'formulario' },
          h('label', { class: 'check', for: 'cm-activo' }, activo, 'Responder comentarios'),
          h('label', { for: 'cm-modo' }, 'Cómo responde'), modo),
        c.activo && faltan.length ? h('p', { class: 'chip alerta', role: 'status' }, 'Para responder comentarios, ' + faltan.map((x) => x.username ? '@' + x.username : 'la cuenta ' + x.id).join(', ') + ' tiene que dar un permiso más: tocá «Conectar Instagram» de nuevo, entrá con la cuenta del negocio y aceptá todos los permisos.') : null);
    };
    const pintarPasos = (r) => {
      const usuario = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'mi.negocio', value: r.invitacion ? r.invitacion.usuario : '' });
      const errores = h('p', { class: 'errores', role: 'alert' });
      const conectar = h('button', { type: 'button', class: 'btn prim', disabled: !r.disponible, onclick: conError(async () => {
        const x = await api(base() + '/instagram/conectar', { metodo: 'POST' });
        window.location.href = x.url;
      }) }, 'Conectar Instagram');
      poner(pasos,
        h('h3', {}, r.cuentas.length ? 'Conectar otra cuenta' : 'Conectar tu cuenta'),
        r.disponible ? null : h('p', { class: 'chip alerta' }, 'Todavía no está disponible: escribinos a contact@zustrolabs.com.'),
        h('ol', { class: 'pasos' },
          h('li', {}, 'Tu cuenta de Instagram tiene que ser profesional (Empresa o Creador): ', enlace('cómo pasarla', 'https://help.instagram.com/502981923235522'), '.'),
          h('li', {}, 'En Instagram: Configuración → Mensajes y respuestas a historias → Controles de mensajes → Herramientas conectadas → «Permitir acceso a los mensajes» encendido.'),
          h('li', {}, 'Pedinos la invitación con el usuario de Instagram del negocio:',
            h('form', { class: 'wa-form', onsubmit: conError(async (e) => {
              e.preventDefault();
              errores.textContent = '';
              try {
                await api(base() + '/instagram/invitacion', { metodo: 'POST', cuerpo: { usuario: usuario.value } });
                aviso('Listo: te avisamos cuando la invitación esté enviada.');
                cargar();
              } catch (err) { if (err.message === 'sesión') throw err; errores.textContent = err.message; }
            }) },
              etiqueta('Usuario de Instagram del negocio', usuario), usuario, errores,
              r.invitacion ? h('p', { class: 'ayuda' }, 'Pedida el ' + fecha(r.invitacion.pedido) + ' para @' + r.invitacion.usuario + '. Si te equivocaste, corregilo y pedila de nuevo.') : null,
              h('div', { class: 'acciones' }, h('button', { type: 'submit', class: 'btn' }, r.invitacion ? 'Pedir de nuevo' : 'Pedir invitación')))),
          h('li', {}, 'Cuando te avisemos, aceptala: entrá a ', enlace('instagram.com/accounts/manage_access', 'https://www.instagram.com/accounts/manage_access/'), ' con la cuenta del negocio → pestaña «Invitaciones de evaluador» → Aceptar.'),
          h('li', {}, 'Apretá «Conectar Instagram», entrá con la cuenta del negocio y aceptá los permisos. Al volver, ya queda respondiendo con tu ficha y tus productos.')),
        h('div', { class: 'acciones' }, conectar));
    };
    const cargar = conError(async () => {
      const r = await api(base() + '/instagram');
      poner(lista, ...(r.cuentas.length ? r.cuentas.map((c) => h('div', { class: 'wa-num' },
        h('strong', {}, c.username ? '@' + c.username : 'Cuenta ' + c.id),
        h('div', { class: 'chips' },
          h('span', { class: 'chip ' + (c.conectada ? 'ok' : 'mal') }, c.conectada ? 'Conectada' : 'Desconectada: conectala de nuevo'),
          r.canal ? null : h('span', { class: 'chip alerta' }, 'Instagram está apagado en tu negocio')),
        h('div', { class: 'acciones' }, h('button', { type: 'button', class: 'btn peligro', onclick: conError(async (e) => {
          if (e.target.dataset.seguro !== '1') { e.target.dataset.seguro = '1'; e.target.textContent = '¿Seguro? Tocá de nuevo para desconectar'; return; }
          await api(base() + '/instagram/' + c.id, { metodo: 'DELETE' });
          aviso('Desconectada. Tu cuenta de Instagram sigue igual; el asistente deja de responder.');
          cargar();
        }) }, 'Desconectar')))) : [h('p', { class: 'vacio' }, 'Todavía no hay una cuenta de Instagram conectada.')]));
      pintarComentarios(r);
      pintarPasos(r);
    });
    cargar();
    return caja;
  }

  // ── WhatsApp (ZL-136): el negocio conecta su número solo, con su cuenta gratis de YCloud ──
  function vistaWhatsapp() {
    const enlace = (texto, url) => h('a', { href: url, target: '_blank', rel: 'noopener' }, texto);
    const lista = h('div', { 'aria-live': 'polite' });
    const numero = h('input', { type: 'tel', autocomplete: 'off', placeholder: '+54 9 341 123 4567' });
    const clave = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false' });
    const errores = h('p', { class: 'errores', role: 'alert' });
    const caja = h('section', {},
      h('h2', {}, 'WhatsApp'),
      h('p', { class: 'ayuda' }, 'Conectá el WhatsApp Business de tu negocio para que el asistente responda con tus productos. Seguís usando tu app con el mismo número y no perdés tus charlas. Cuando contestás vos desde el celular, el asistente se calla en esa charla.'),
      estado.datos.asistente.activo ? null : h('p', { class: 'chip alerta' }, 'Tu asistente todavía no está activo: lo activa el equipo de Zustro Labs. Podés conectar el número igual.'),
      lista,
      h('h3', {}, 'Conectar un número'),
      h('ol', { class: 'pasos' },
        h('li', {}, 'En tu celular: actualizá WhatsApp Business (2.24.17 o más nueva) y hacé una copia de seguridad (Configuración → Chats → Copia de seguridad).'),
        h('li', {}, 'Creá tu cuenta gratis en ', enlace('YCloud', 'https://www.ycloud.com/console#/entry/register'), ' (no pide tarjeta).'),
        h('li', {}, 'En YCloud: WhatsApp Manager → WhatsApp accounts → «WhatsApp Business APP Coexistence» → Get started → I\'m ready to start → «Log in with WhatsApp Business app». ',
          h('strong', {}, 'No elijas «WhatsApp Business API»'), ': ese deja tu app sin el número.'),
        h('li', {}, 'Nombre del negocio exactamente como en tus papeles, y tu sitio web real (o tu Instagram). Escaneá el QR con WhatsApp Business, autorizá y elegí sincronizar el historial. Dejá la app abierta hasta que termine.'),
        h('li', {}, 'Cuando tu número aparezca en WhatsApp accounts: Developers → API keys → copiá la clave y pegala acá abajo. No se la mandes a nadie por chat.')),
      h('details', {}, h('summary', {}, 'Lo que tenés que saber antes'),
        h('ul', {},
          h('li', {}, 'En las charlas individuales dejan de andar los mensajes temporales, «ver una vez», la ubicación en tiempo real y las listas de difusión (las que tenés quedan solo para leer).'),
          h('li', {}, 'Se desvinculan WhatsApp Web y las computadoras: después las volvés a vincular. WhatsApp para Windows no funciona con esto; web.whatsapp.com sí.'),
          h('li', {}, 'Abrí la app de WhatsApp Business al menos cada 14 días: si no, Meta corta la conexión.'),
          h('li', {}, 'Meta puede limitar o suspender cuentas con datos que no coinciden con tus papeles o con reclamos de spam. Ni YCloud ni nosotros podemos revertirlo.'))),
      h('form', { class: 'wa-form', onsubmit: conError(async (e) => {
        e.preventDefault();
        errores.textContent = '';
        const boton = e.target.querySelector('button');
        boton.disabled = true;
        try {
          const r = await api(base() + '/whatsapp', { metodo: 'POST', cuerpo: { numero: numero.value, apiKey: clave.value } });
          clave.value = ''; numero.value = '';
          aviso('Conectado: ' + r.numero + '. Probalo: desde otro celular mandale «hola».');
          cargarLista();
        } catch (err) {
          if (err.message === 'sesión') throw err;
          errores.textContent = err.message;
        } finally { boton.disabled = false; }
      }) },
        etiqueta('Tu número de WhatsApp Business (con código de país)', numero), numero,
        etiqueta('Clave de API de YCloud', clave), clave,
        h('p', { class: 'ayuda' }, 'La clave queda guardada en nuestro servidor y no se vuelve a mostrar en ninguna pantalla. Si la cambiás en YCloud, desconectá y conectá de nuevo.'),
        errores,
        h('div', { class: 'acciones' }, h('button', { type: 'submit', class: 'btn prim' }, 'Conectar'))));
    const cargarLista = conError(async () => {
      const r = await api(base() + '/whatsapp');
      if (!r.numeros.length) { poner(lista, h('p', { class: 'vacio' }, 'Todavía no hay un número de WhatsApp conectado.')); return; }
      poner(lista, ...r.numeros.map((n) => h('div', { class: 'wa-num' },
        h('strong', {}, n.numero),
        h('div', { class: 'chips' },
          h('span', { class: 'chip ok' }, 'Conectado'),
          h('span', { class: 'chip' }, n.ultimo ? 'Último mensaje: ' + fecha(n.ultimo) : 'Todavía sin mensajes'),
          h('span', { class: n.ecos ? 'chip' : 'chip alerta' }, n.ecos ? 'Se calla cuando contestás vos' : 'No se entera cuando contestás vos')),
        h('div', { class: 'acciones' }, h('button', { type: 'button', class: 'btn peligro', onclick: conError(async (e) => {
          if (e.target.dataset.seguro !== '1') { e.target.dataset.seguro = '1'; e.target.textContent = '¿Seguro? Tocá de nuevo para desconectar'; return; }
          await api(base() + '/whatsapp/' + n.clave, { metodo: 'DELETE' });
          aviso('Desconectado. Tu app de WhatsApp Business sigue igual.');
          cargarLista();
        }) }, 'Desconectar')))));
    });
    cargarLista();
    return caja;
  }

  // ── Asistente (solo el equipo). ZL-150: la ficha por formulario (o en Markdown), desde una plantilla o desde la web
  // del negocio, con un revisor que avisa lo que choca con el sistema y corre charlas de prueba. ──
  /**
   * ZL-159: el asistente en manos del dueño, sin pasar por el equipo: pausarlo (vacaciones, local cerrado) con un
   * mensaje de ausencia, dejarle un aviso del día y probarlo como si fuera un cliente. Un empleado lo ve, no lo cambia.
   */
  /** ZL-161: una foto que el asistente le mandaría al cliente, en la charla de prueba (la app la muestra con la sesión). */
  function burbujaFoto(f) {
    return h('figure', { class: 'burbuja asis foto' },
      f.foto ? h('img', { src: '/api' + base() + '/fotos/' + f.foto, alt: 'Foto de ' + (f.nombre || 'un producto'), loading: 'lazy' }) : null,
      h('figcaption', {}, 'Foto: ' + (f.nombre || 'producto')));
  }

  function vistaMiAsistente() {
    const n = estado.datos.negocio;
    const dueño = n.rol !== 'empleado';
    const caja = h('section', {}, h('h2', {}, 'Tu asistente'));
    const guardar = async (cuerpo) => {
      const r = await api(base() + '/asistente', { metodo: 'PUT', cuerpo });
      n.pausa = r.pausa; n.avisoDia = r.avisoDia;
      pintarVista();
    };
    const cuando = (t) => new Date(t).toLocaleString('es-AR', { weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
    // Estado y pausa.
    if (n.pausa) {
      caja.append(h('p', { class: 'chip alerta' }, 'En pausa hasta el ' + cuando(n.pausa.hasta) + '. A quien escriba se le dice una vez cuándo vuelven, y nada más.'),
        n.pausa.mensaje ? h('p', { class: 'cita' }, n.pausa.mensaje) : null,
        dueño ? h('div', { class: 'acciones' }, h('button', { type: 'button', class: 'btn prim', onclick: conError(() => guardar({ pausa: null })) }, 'Volver a encenderlo')) : null);
    } else {
      caja.append(h('p', { class: 'chip ok' }, 'Atendiendo: responde cada mensaje con tu información y tus productos.'));
      if (dueño) {
        const hasta = h('select', { 'aria-label': '¿Hasta cuándo?' },
          [['manana', 'Hasta mañana a las 9'], ['1', '1 día'], ['3', '3 días'], ['7', '1 semana'], ['fecha', 'Elegir fecha y hora']].map(([v, t]) => h('option', { value: v }, t)));
        const fecha = h('input', { type: 'datetime-local', 'aria-label': 'Fecha y hora en que vuelve', hidden: true });
        hasta.onchange = () => { fecha.hidden = hasta.value !== 'fecha'; };
        const mensaje = h('textarea', { maxlength: 300, rows: 2, 'aria-label': 'Mensaje de ausencia (opcional)', placeholder: 'Opcional. Por ejemplo: Estamos de vacaciones hasta el lunes 🌴' });
        const calcular = () => {
          const d = new Date();
          if (hasta.value === 'manana') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); }
          if (hasta.value === 'fecha') return fecha.value ? new Date(fecha.value).getTime() : NaN;
          return d.getTime() + Number(hasta.value) * 86_400_000;
        };
        caja.append(h('details', {}, h('summary', {}, 'Pausar el asistente (vacaciones, local cerrado)'),
          h('form', { class: 'formulario', onsubmit: conError(async (e) => {
            e.preventDefault();
            const t = calcular();
            if (!(t > Date.now())) { aviso('Elegí una fecha que todavía no pasó.', true); return; }
            await guardar({ pausa: { hasta: t, mensaje: mensaje.value } });
          }) },
            etiqueta('¿Hasta cuándo?', hasta), hasta, fecha,
            etiqueta('Mensaje de ausencia (opcional)', mensaje), mensaje,
            h('p', { class: 'ayuda' }, 'Mientras esté en pausa, a cada persona que escriba se le dice una vez cuándo vuelven. Tus pedidos y consultas siguen en la app.'),
            h('button', { type: 'submit', class: 'btn' }, 'Pausar'))));
      }
    }
    // Aviso del día.
    caja.append(h('h3', {}, 'Aviso del día'));
    if (n.avisoDia) {
      caja.append(h('p', { class: 'cita' }, n.avisoDia.texto), h('p', { class: 'ayuda' }, 'El asistente lo tiene en cuenta hasta el ' + cuando(n.avisoDia.hasta) + '.'),
        dueño ? h('div', { class: 'acciones' }, h('button', { type: 'button', class: 'btn', onclick: conError(() => guardar({ avisoDia: null })) }, 'Quitar el aviso')) : null);
    } else if (dueño) {
      const texto = h('textarea', { maxlength: 300, rows: 2, 'aria-label': 'Aviso del día', placeholder: 'Por ejemplo: Hoy no hay medialunas. Cerramos a las 18.' });
      const dura = h('select', { 'aria-label': 'Cuánto dura el aviso' }, [['hoy', 'Hasta el final del día'], ['1', '24 horas'], ['3', '3 días'], ['7', '7 días']].map(([v, t]) => h('option', { value: v }, t)));
      caja.append(h('form', { class: 'formulario', onsubmit: conError(async (e) => {
        e.preventDefault();
        if (!texto.value.trim()) { aviso('Escribí el aviso.', true); return; }
        const d = new Date();
        const hasta = dura.value === 'hoy' ? (d.setHours(23, 59, 0, 0), d.getTime()) : Date.now() + Number(dura.value) * 86_400_000;
        await guardar({ avisoDia: { texto: texto.value, hasta } });
      }) },
        h('p', { class: 'ayuda' }, 'Algo de hoy que el asistente tiene que saber: lo que no hay, un horario distinto, una promo. Manda sobre la ficha.'),
        texto, etiqueta('Cuánto dura', dura), dura, h('button', { type: 'submit', class: 'btn' }, 'Guardar el aviso')));
    } else caja.append(h('p', { class: 'ayuda' }, 'Sin aviso del día.'));
    // Probar como un cliente.
    const chat = h('div', { class: 'chat' });
    const msg = h('input', { type: 'text', placeholder: 'Escribí como si fueras un cliente', 'aria-label': 'Mensaje de prueba para tu asistente' });
    let estadoPrueba = null;
    caja.append(h('h3', {}, 'Probalo como si fueras un cliente'),
      h('p', { class: 'ayuda' }, 'Charla de prueba con tu asistente y tus productos. No se le manda nada a nadie.'),
      chat,
      h('form', { class: 'barra', onsubmit: conError(async (e) => {
        e.preventDefault();
        const m = msg.value.trim();
        if (!m) return;
        msg.value = '';
        chat.append(h('div', { class: 'burbuja cliente' }, m));
        const r = await api(base() + '/prueba', { metodo: 'POST', cuerpo: { mensajes: [m], estado: estadoPrueba } });
        estadoPrueba = r.estado || null;
        const ultima = r.charla[r.charla.length - 1];
        for (const t of ultima.respuestas) chat.append(h('div', { class: 'burbuja asis' }, t));
        for (const f of ultima.fotos || []) chat.append(burbujaFoto(f));
        chat.scrollTop = chat.scrollHeight;
      }) }, msg, h('button', { class: 'btn prim', type: 'submit' }, 'Enviar')),
      h('div', { class: 'acciones' }, h('button', { class: 'btn', type: 'button', onclick: () => { estadoPrueba = null; poner(chat); msg.focus(); } }, 'Empezar de nuevo')));
    return caja;
  }

  function vistaAsistente() {
    const caja = h('section', {}, h('h2', {}, 'Asistente'),
      h('p', { class: 'ayuda' }, 'La ficha la maneja el equipo de Zustro Labs. El asistente responde con esta ficha, con «Cómo vendés» y con los productos del negocio.'));
    const st = { modo: 'form', campos: null, texto: '' };
    const info = h('div', { 'aria-live': 'polite' });
    const cuerpo = h('div', {});
    const activa = h('input', { type: 'checkbox' });
    const markdown = h('textarea', { class: 'ficha', 'aria-label': 'Ficha del negocio', spellcheck: 'false' });
    const vacios = () => ({ nombre: estado.datos.negocio.nombre || '', idioma: 'es', trato: 'vos', emojis: true, precios: false, pausaHoras: 12, objetivo: 'consultas', horario: '', saludo: '', menu: [{ titulo: '', texto: '' }], vender: '', conocimiento: '', faq: '', nunca: '', persona: '' });

    const mostrar = (r) => {
      poner(info,
        r.errores && r.errores.length ? h('ul', { class: 'errores' }, r.errores.map((e) => h('li', {}, e))) : null,
        r.pendientes && r.pendientes.length ? h('p', { class: 'chip alerta' }, 'Falta completar: ' + r.pendientes.join(' · ')) : null,
        r.avisos && r.avisos.length ? h('ul', { class: 'ayuda' }, r.avisos.map((a) => h('li', {}, 'Ojo: ' + a))) : null,
        r.conflictos && r.conflictos.length ? h('div', { class: 'caja' }, h('h3', {}, 'Lo que revisé'), h('ul', {}, r.conflictos.map((c) => h('li', { class: c.nivel === 'mal' ? 'errores' : '' }, (c.nivel === 'mal' ? '✗ ' : '• ') + c.texto)))) : null,
        r.conflictos && !r.conflictos.length ? h('p', { class: 'chip ok' }, 'La ficha no choca con nada del sistema') : null,
        r.charlas && r.charlas.length ? h('div', { class: 'caja' }, h('h3', {}, 'Charlas de prueba (' + r.charlas.filter((c) => c.ok).length + ' de ' + r.charlas.length + ' bien)'),
          r.charlas.map((c) => h('div', { class: 'tarjeta' + (c.ok ? '' : ' nuevo') },
            h('p', {}, h('strong', {}, (c.ok ? '✓ ' : '✗ ') + c.mensaje), c.motivo ? h('span', { class: 'ayuda' }, ' · ' + c.motivo) : null),
            c.respuestas.map((t) => h('div', { class: 'burbuja asis' }, t))))) : null,
        r.error ? h('p', { class: 'errores' }, r.error) : null);
    };

    /** El Markdown de lo que está en pantalla (en formulario, lo arma el servidor con el mismo formato). */
    async function textoActual() {
      if (st.modo === 'md') return markdown.value;
      const r = await api(base() + '/ficha/armar', { metodo: 'POST', cuerpo: { campos: leerFormulario() } });
      return r.texto;
    }

    // El formulario.
    const f = {};
    function campoTexto(clave, etiquetaTxt, ayuda, filas) {
      f[clave] = filas ? h('textarea', { rows: filas }) : h('input', { type: 'text' });
      return [etiqueta(etiquetaTxt, f[clave]), ayuda ? h('p', { class: 'ayuda' }, ayuda) : null, f[clave]];
    }
    function campoSelect(clave, etiquetaTxt, opciones) {
      f[clave] = h('select', {}, opciones.map(([v, t]) => h('option', { value: v }, t)));
      return h('div', {}, etiqueta(etiquetaTxt, f[clave]), f[clave]);
    }
    const listaMenu = h('div', {});
    function filaMenu(o, i) {
      const titulo = h('input', { type: 'text', maxlength: 80, value: o.titulo || '', 'data-menu': 'titulo' });
      const texto = h('textarea', { rows: 3, maxlength: 900, 'data-menu': 'texto' }, o.texto || '');
      texto.value = o.texto || '';
      return h('div', { class: 'tarjeta' },
        etiqueta('Opción ' + (i + 1) + ': título', titulo), titulo,
        etiqueta('Opción ' + (i + 1) + ': respuesta (terminala con una pregunta)', texto), texto,
        h('div', { class: 'acciones' }, h('button', { type: 'button', class: 'btn peligro', onclick: () => { const c = leerFormulario(); c.menu.splice(i, 1); pintarMenu(c.menu.length ? c.menu : [{ titulo: '', texto: '' }]); } }, 'Quitar opción')));
    }
    function pintarMenu(menu) { poner(listaMenu, menu.map(filaMenu)); }
    function leerFormulario() {
      const menu = [...listaMenu.querySelectorAll('.tarjeta')].map((t) => ({ titulo: t.querySelector('[data-menu=titulo]').value, texto: t.querySelector('[data-menu=texto]').value }));
      return {
        nombre: f.nombre.value, idioma: f.idioma.value, trato: f.trato.value, emojis: f.emojis.value === 'si', precios: f.precios.value === 'si',
        pausaHoras: Number(f.pausaHoras.value), objetivo: f.objetivo.value, horario: f.horario.value, saludo: f.saludo.value, menu,
        vender: f.vender.value, conocimiento: f.conocimiento.value, faq: f.faq.value, nunca: f.nunca.value, persona: f.persona.value,
      };
    }
    function llenarFormulario(c) {
      for (const k of ['nombre', 'idioma', 'trato', 'objetivo', 'horario', 'saludo', 'vender', 'conocimiento', 'faq', 'nunca', 'persona']) f[k].value = c[k] == null ? '' : String(c[k]);
      f.emojis.value = c.emojis === false ? 'no' : 'si';
      f.precios.value = c.precios ? 'si' : 'no';
      // Si la ficha tiene otras horas (por ejemplo 8), se agregan a la lista: guardar nunca las cambia sin querer.
      const horas = String(c.pausaHoras || 12);
      if (![...f.pausaHoras.options].some((x) => x.value === horas)) f.pausaHoras.append(h('option', { value: horas }, horas + ' horas'));
      f.pausaHoras.value = horas;
      pintarMenu(c.menu && c.menu.length ? c.menu : [{ titulo: '', texto: '' }]);
    }
    const formulario = h('div', { class: 'wa-form', estilo: { maxWidth: 'none' } },
      h('div', { class: 'dosc' },
        h('div', {}, ...campoTexto('nombre', 'Nombre del negocio')),
        campoSelect('objetivo', 'A qué cierre lleva la charla', [['consultas', 'Consultas (servicios, presupuestos, turnos)'], ['pedidos', 'Pedidos (productos del catálogo)']])),
      h('div', { class: 'dosc' },
        campoSelect('idioma', 'Idioma', [['es', 'Castellano'], ['en', 'Inglés'], ['hr', 'Croata']]),
        campoSelect('trato', 'Trato', [['vos', 'Vos'], ['tu', 'Tú'], ['usted', 'Usted']])),
      h('div', { class: 'dosc' },
        campoSelect('emojis', 'Emojis', [['si', 'Sí'], ['no', 'No']]),
        campoSelect('precios', 'Puede decir los precios escritos', [['no', 'No'], ['si', 'Sí']])),
      h('div', { class: 'dosc' },
        campoSelect('pausaHoras', 'Cuánto se calla si lo toma el negocio', [['2', '2 horas'], ['6', '6 horas'], ['12', '12 horas'], ['24', '24 horas'], ['48', '48 horas']]),
        h('div', {}, ...campoTexto('horario', 'Cuándo responde una persona', 'Por ejemplo: de lunes a sábado de 9 a 19'))),
      ...campoTexto('saludo', 'Saludo', 'Una o dos oraciones: quién es y en qué ayuda. Después va el menú.', 3),
      h('h3', {}, 'Menú (hasta 9 opciones)'), listaMenu,
      h('div', { class: 'acciones' }, h('button', { type: 'button', class: 'btn', onclick: () => { const c = leerFormulario(); if (c.menu.length >= 9) return aviso('Máximo 9 opciones.', true); c.menu.push({ titulo: '', texto: '' }); pintarMenu(c.menu); } }, '+ Agregar opción')),
      ...campoTexto('vender', 'Cómo vendemos', 'Cómo vendería el mejor vendedor del negocio: qué preguntar primero, qué recomendar, cómo responder una duda. Una idea por línea, con «- ».', 6),
      ...campoTexto('conocimiento', 'Lo que sabe el asistente', 'Todo lo que puede responder. Lo que no esté acá, no lo sabe (y le pasa la charla al equipo).', 10),
      ...campoTexto('faq', 'Preguntas frecuentes (opcional)', null, 4),
      ...campoTexto('nunca', 'Nunca', 'Lo que no tiene que decir ni prometer. Una por línea, con «- ».', 3),
      ...campoTexto('persona', 'Pasar a una persona cuando', 'Solo reclamos, casos grandes o lo que no sabe. Los pedidos y las consultas los cierra solo.', 3));
    pintarMenu([{ titulo: '', texto: '' }]);

    function pintarModo() {
      poner(cuerpo, st.modo === 'md' ? markdown : formulario);
      modoBotones.forEach((b) => b.setAttribute('aria-pressed', b.dataset.modo === st.modo ? 'true' : 'false'));
    }
    const cambiarModo = (m) => conError(async () => {
      if (m === st.modo) return;
      if (m === 'md') { markdown.value = await textoActual(); st.modo = 'md'; }
      else {
        const r = await api(base() + '/ficha/campos', { metodo: 'POST', cuerpo: { texto: markdown.value } }).catch((e) => e.datos || { ok: false, errores: [e.message] });
        if (!r.ok) return mostrar({ errores: r.errores, error: 'Corregí los errores en Markdown antes de pasar al formulario.' });
        if (r.multi) return aviso('Esta ficha tiene varios idiomas: se edita en Markdown.', true);
        llenarFormulario(r.campos); st.modo = 'form';
      }
      pintarModo();
    });
    const modoBotones = [h('button', { type: 'button', 'data-modo': 'form', onclick: () => cambiarModo('form')() }, 'Formulario'), h('button', { type: 'button', 'data-modo': 'md', onclick: () => cambiarModo('md')() }, 'Markdown')];

    // Empezar desde una plantilla o desde la web del negocio.
    const plantilla = h('select', { 'aria-label': 'Plantilla por rubro' }, h('option', { value: '' }, 'Elegí un rubro…'));
    const web = h('input', { type: 'url', placeholder: 'https://minegocio.com', 'aria-label': 'Página web del negocio' });
    let plantillas = [];
    const usar = (campos, de) => { llenarFormulario(Object.assign(vacios(), campos, { nombre: campos.nombre || estado.datos.negocio.nombre || '' })); st.modo = 'form'; pintarModo(); aviso('Listo: ' + de + '. Revisá y completá lo que dice [COMPLETAR …].'); };
    const inicio = h('div', { class: 'caja' },
      h('h3', {}, 'Empezar rápido'),
      h('div', { class: 'barra' }, plantilla, h('button', { type: 'button', class: 'btn', onclick: () => { const p = plantillas.find((x) => x.id === plantilla.value); if (p) usar(p.campos, 'plantilla «' + p.nombre + '»'); } }, 'Usar plantilla')),
      h('div', { class: 'barra' }, web, h('button', { type: 'button', class: 'btn', onclick: conError(async (e) => {
        const b = e.target; b.disabled = true; b.textContent = 'Leyendo la página…';
        try { const r = await api(base() + '/ficha/web', { metodo: 'POST', cuerpo: { url: web.value } }); usar(r.campos, 'armada desde ' + r.fuente); }
        finally { b.disabled = false; b.textContent = 'Armar desde la web'; }
      }) }, 'Armar desde la web')),
      h('p', { class: 'ayuda' }, 'La IA solo usa lo que dice la página; lo que falta queda como [COMPLETAR …]. Nada se guarda hasta que apretás Guardar.'));

    caja.append(inicio,
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Cómo editar la ficha' }, modoBotones),
      cuerpo,
      h('label', { class: 'check' }, activa, 'Activa (responde a los clientes de las cuentas de este negocio)'),
      h('div', { class: 'acciones' },
        h('button', { type: 'button', class: 'btn', onclick: conError(async (e) => {
          const b = e.target; b.disabled = true; b.textContent = 'Revisando (charlas de prueba)…';
          try { mostrar(await api(base() + '/ficha/revisar', { metodo: 'POST', cuerpo: { texto: await textoActual() } }).catch((x) => x.datos || { error: x.message })); }
          finally { b.disabled = false; b.textContent = 'Revisar todo'; }
        }) }, 'Revisar todo'),
        h('button', { type: 'button', class: 'btn prim', onclick: conError(async () => {
          try { const r = await api(base() + '/ficha', { metodo: 'PUT', cuerpo: { texto: await textoActual(), activa: activa.checked } }); mostrar(r); aviso(r.activa ? 'Ficha guardada y ACTIVA' : 'Ficha guardada (apagada)'); refrescarResumen(); }
          catch (e) { mostrar(e.datos || { error: e.message }); }
        }) }, 'Guardar')),
      info);

    // Probar: charla simulada con lo que está en pantalla.
    const chat = h('div', { class: 'chat' });
    const msg = h('input', { type: 'text', placeholder: 'Escribí como si fueras un cliente', 'aria-label': 'Mensaje de prueba' });
    let estadoPrueba = null;
    caja.append(
      h('h3', {}, 'Probar'),
      h('p', { class: 'ayuda' }, 'Charla simulada con la ficha de arriba (aunque no esté guardada) y los productos cargados. No se manda nada a nadie.'),
      h('div', { class: 'acciones' }, h('button', { class: 'btn', type: 'button', onclick: () => { estadoPrueba = null; poner(chat); msg.focus(); } }, 'Reiniciar charla')),
      chat,
      h('form', { class: 'barra', onsubmit: conError(async (e) => {
        e.preventDefault();
        const m = msg.value.trim();
        if (!m) return;
        msg.value = '';
        chat.append(h('div', { class: 'burbuja cliente' }, m));
        // La charla sigue: se manda lo que devolvió el mensaje anterior (idioma, pausa, memoria corta) (ZL-126, ZL-146).
        const r = await api(base() + '/probar', { metodo: 'POST', cuerpo: { texto: await textoActual(), mensajes: [m], estado: estadoPrueba } });
        estadoPrueba = r.estado || null;
        const ultima = r.charla[r.charla.length - 1];
        for (const t of ultima.respuestas) chat.append(h('div', { class: 'burbuja asis' }, t));
        for (const f of ultima.fotos || []) chat.append(burbujaFoto(f));
        if (ultima.que === 'error') chat.append(h('p', { class: 'ayuda' }, 'La IA no respondió (motivo: ' + (ultima.notas || []).join(', ') + '). El cliente recibiría el mensaje de arriba.'));
        else if (ultima.notas && ultima.notas.length) chat.append(h('p', { class: 'ayuda' }, 'Controles: se sacó ' + ultima.notas.join(', ') + ' (no estaba en la ficha ni en los productos).'));
        chat.scrollTop = chat.scrollHeight;
      }) }, msg, h('button', { class: 'btn prim', type: 'submit' }, 'Enviar')));

    conError(async () => {
      const [fi, pl] = await Promise.all([api(base() + '/ficha'), api(base() + '/ficha/plantillas')]);
      plantillas = pl.plantillas;
      plantillas.forEach((p) => plantilla.append(h('option', { value: p.id }, p.nombre)));
      activa.checked = fi.activa;
      markdown.value = fi.texto || '';
      if (!fi.texto) { llenarFormulario(vacios()); st.modo = 'form'; pintarModo(); poner(info, h('p', { class: 'ayuda' }, 'Sin ficha todavía: elegí una plantilla, armala desde la web o completá el formulario.')); return; }
      const r = await api(base() + '/ficha/campos', { metodo: 'POST', cuerpo: { texto: fi.texto } }).catch((e) => e.datos || { ok: false });
      if (r.ok && !r.multi) { llenarFormulario(r.campos); st.modo = 'form'; }
      else st.modo = 'md';
      pintarModo();
      mostrar(fi);
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
        h('p', { class: 'ayuda' }, 'Los correos se agregan solos a Access (la política de la app «Negocios»). Si no se puede, te avisa cuáles agregar a mano.'),
        h('div', { class: 'acciones' }, h('button', { class: 'btn prim', onclick: conError(async () => {
          const n = await api('/admin/negocios', { metodo: 'POST', cuerpo: { nombre: nombre.value, emails: emails.value } });
          aviso('Negocio creado' + textoAcceso(n.acceso)); nombre.value = ''; emails.value = '';
          estado.yo = await api('/yo'); estado.negocio = n.id; estado.tab = 'asistente'; recordar(); cargarNegocio();
        }) }, 'Crear'))),
      lista);
    conError(async () => {
      const [{ negocios }, { cuentas }] = await Promise.all([api('/admin/negocios'), api('/admin/cuentas')]);
      poner(lista, h('h3', {}, 'Negocios'));
      if (!negocios.length) lista.append(h('div', { class: 'vacio' }, 'Todavía no hay negocios.'));
      for (const n of negocios) {
        const em = h('input', { type: 'text', value: n.emails.join(', '), 'aria-label': 'Correos de ' + n.nombre });
        const lim = h('input', { type: 'number', min: 10, max: 5000, value: n.limiteDia, 'aria-label': 'Respuestas de IA por día' });
        const marcas = cuentas.filter((c) => !c.negocio || c.negocio === n.id).map((c) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: c.id, 'data-cuenta': '1', checked: n.cuentas.includes(c.id) }), '@' + (c.username || c.id) + (c.estudio ? ' (cuenta del estudio: con la ficha activa responde con ella; si no, con lo de la página)' : '')));
        const ig = h('input', { type: 'checkbox', checked: n.canales.instagram });
        const wa = h('input', { type: 'checkbox', checked: n.canales.whatsapp });
        const pe = h('input', { type: 'checkbox', checked: n.pedidos === true });
        lista.append(h('div', { class: 'caja' },
          h('h3', {}, n.nombre),
          h('div', { class: 'chips' },
            h('span', { class: 'chip ' + (n.asistente.activo ? 'ok' : 'alerta') }, n.asistente.activo ? 'Asistente activo' : n.asistente.tiene ? 'Asistente apagado' : 'Sin ficha'),
            h('span', { class: 'chip' }, 'IA hoy: ' + n.usoHoy + ' / ' + n.limiteDia),
            h('span', { class: 'chip' }, 'IA este mes: ' + n.usoMes),
            // ZL-137: el negocio pidió que lo agreguemos como evaluador de la app compartida de Instagram.
            n.invitacionIg ? h('span', { class: 'chip alerta' }, 'Pidió invitación de Instagram: @' + n.invitacionIg.usuario + ' (' + fecha(n.invitacionIg.pedido) + ')') : null),
          // ZL-148: invitación de evaluador pendiente: el enlace directo y un botón para darla por enviada.
          n.invitacionIg ? h('p', { class: 'ayuda' }, 'Agregalo como Instagram Tester de la app y después marcalo como enviado: ',
            h('a', { href: 'https://developers.facebook.com/apps/', target: '_blank', rel: 'noopener' }, 'apps de Meta → Roles de la app'), ' ',
            h('button', { type: 'button', class: 'btn', onclick: conError(async () => { await api('/admin/negocios/' + n.id, { metodo: 'PUT', cuerpo: { invitacionIg: null } }); aviso('Listo: el negocio ya puede aceptarla.'); pintarVista(); }) }, 'Invitación enviada')) : null,
          etiqueta('Quiénes entran', em), em,
          h('p', { class: 'ayuda' }, 'Canales que contrató (con un canal apagado, el asistente no responde ahí)'),
          h('label', { class: 'check' }, ig, 'Instagram'),
          h('label', { class: 'check' }, wa, 'WhatsApp (el negocio conecta su número en Conexiones → WhatsApp)'),
          h('label', { class: 'check' }, pe, 'Pedidos por chat: el asistente arma pedidos con los productos cargados y reserva stock (se ven en Inicio)'),
          h('p', { class: 'ayuda' }, 'Cuentas de Instagram'), marcas.length ? marcas : h('p', { class: 'ayuda' }, 'No hay cuentas conectadas libres. El negocio conecta su Instagram en Conexiones → Instagram.'),
          etiqueta('Tope de respuestas de la IA por día', lim), lim,
          h('div', { class: 'acciones' },
            h('button', { class: 'btn', onclick: () => { estado.negocio = n.id; estado.tab = 'inicio'; recordar(); cargarNegocio(); } }, 'Abrir'),
            h('button', { class: 'btn prim', onclick: conError(async (e) => {
              const marcadas = [...e.target.closest('.caja').querySelectorAll('input[data-cuenta]:checked')].map((x) => x.value);
              const g = await api('/admin/negocios/' + n.id, { metodo: 'PUT', cuerpo: { emails: em.value, cuentas: marcadas, limiteDia: Number(lim.value), canales: { instagram: ig.checked, whatsapp: wa.checked }, pedidos: pe.checked } });
              aviso('Guardado' + textoAcceso(g.acceso));
            }) }, 'Guardar'))));
      }
    })();
    return caja;
  }

  // ── Arranque ──
  // La app se puede instalar en la pantalla de inicio (ZL-151); el service worker también recibe los avisos.
  try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}); } catch (e) { /* nada */ }
  conError(async () => {
    estado.yo = await api('/yo');
    let guardado = {};
    try { guardado = JSON.parse(localStorage.getItem('zl-negocios') || '{}'); } catch (e) { /* nada */ }
    const ids = estado.yo.negocios.map((n) => n.id);
    estado.negocio = ids.includes(guardado.negocio) ? guardado.negocio : ids[0] || null;
    if (guardado.sub && typeof guardado.sub === 'object') estado.sub = guardado.sub;
    const vieja = VIEJAS[guardado.tab];
    if (vieja) { guardado.tab = vieja[0]; if (vieja[1]) estado.sub[vieja[0]] = vieja[1]; }
    if (PESTANAS().some(([id]) => id === guardado.tab)) estado.tab = guardado.tab;
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
