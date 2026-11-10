// El semáforo de un negocio (ZL-138): todo lo que tiene que estar bien para que el asistente responda, con qué hacer
// cuando no. Lo usan el script de alta (al terminar), la app y, más adelante, el control diario. Cada control nació
// de una falla real (whatsapp/FALLAS_Y_PREVENCION.md).
//
// Es una función pura: index.js junta los datos (ficha, cuentas, números, productos, Access, la charla de prueba) y
// esto decide. Así se prueba sin Cloudflare, sin Meta y sin YCloud.

export const WEBHOOK_HOST = 'zustrolabs.com';
const DIA = 86_400_000;

const ok = (id, texto) => ({ id, estado: 'ok', texto });
const aviso = (id, texto, arreglo) => ({ id, estado: 'aviso', texto, arreglo });
const mal = (id, texto, arreglo) => ({ id, estado: 'mal', texto, arreglo });

/**
 * @param d {
 *   negocio: {id, nombre, emails[], canales: {instagram, whatsapp}},
 *   ficha: {tiene, valida, activa, errores[], pendientes[]},
 *   cuentas: [{id, username, conectada, venceEnDias}],
 *   numeros: [{clave, numero, ecos, ultimo, webhook: {url}|{error}}],
 *   productos: {total, activos, agotados} | null,
 *   acceso: Set de correos | null (sin configurar),
 *   charla: [{mensaje, respuestas[], que}] | null (no se probó),
 *   now
 * }
 * → {verde, controles: [{id, estado: 'ok'|'aviso'|'mal', texto, arreglo?}]}
 */
export function verificarNegocio(d) {
  const c = [];
  const n = d.negocio;
  const emails = (n.emails ?? []).map((e) => String(e).toLowerCase());

  // Quién entra a la app.
  if (!emails.length) c.push(aviso('correos', 'Nadie del negocio puede entrar a la app', 'Administración → el negocio → correos'));
  else if (!d.acceso) c.push(aviso('acceso', 'No pude revisar Access (falta CF_API_TOKEN o no responde)', `Revisá a mano que estén en la política «Negocios y equipo»: ${emails.join(', ')}`));
  else {
    const faltan = emails.filter((e) => !d.acceso.has(e));
    c.push(faltan.length
      ? mal('acceso', `Access no deja entrar a: ${faltan.join(', ')} (no les llega el código)`, 'Guardá el negocio de nuevo en Administración (los agrega solo) o agregalos a mano en la política de Access')
      : ok('acceso', `Entran a la app: ${emails.join(', ')}`));
  }

  // La ficha.
  const f = d.ficha ?? {};
  if (!f.tiene) c.push(mal('ficha', 'No tiene ficha: el asistente no responde', 'Pestaña Asistente: pegar la ficha, Revisar y Guardar con «Activa»'));
  else if (!f.valida) c.push(mal('ficha', `La ficha tiene errores: ${(f.errores ?? []).join(' · ')}`, 'Pestaña Asistente → Revisar'));
  else if ((f.pendientes ?? []).length) c.push(mal('ficha', `Falta completar en la ficha: ${f.pendientes.join(' · ')}`, 'Completar lo que dice [COMPLETAR …] y activarla'));
  else if (!f.activa) c.push(mal('ficha', 'La ficha está apagada: el asistente no responde', 'Pestaña Asistente → Guardar con «Activa»'));
  else c.push(ok('ficha', 'Ficha completa y activa'));

  // Los canales.
  const canales = n.canales ?? {};
  if (!canales.instagram && !canales.whatsapp) c.push(mal('canales', 'No tiene ningún canal encendido', 'Administración → marcar Instagram o WhatsApp'));

  const cuentas = d.cuentas ?? [];
  if (canales.instagram) {
    if (!cuentas.length) c.push(mal('instagram', 'Instagram encendido pero sin cuenta conectada', 'Pestaña Instagram → Conectar Instagram (o instagram-cliente.ps1)'));
    for (const cu of cuentas) {
      const nombre = cu.username ? `@${cu.username}` : `la cuenta ${cu.id}`;
      if (!cu.conectada) c.push(mal('instagram', `${nombre} está desconectada`, 'Conectarla de nuevo desde la pestaña Instagram'));
      else if (cu.venceEnDias !== null && cu.venceEnDias <= 0) c.push(mal('instagram', `El permiso de ${nombre} venció`, 'Conectarla de nuevo desde la pestaña Instagram'));
      else if (cu.venceEnDias !== null && cu.venceEnDias < 15) c.push(aviso('instagram', `El permiso de ${nombre} vence en ${cu.venceEnDias} días y no se renovó solo`, 'Conectarla de nuevo desde la pestaña Instagram'));
      else c.push(ok('instagram', `${nombre} conectada`));
    }
  } else if (cuentas.length) c.push(aviso('instagram', 'Tiene cuentas de Instagram pero el canal está apagado: no responde ahí', 'Administración → marcar Instagram'));

  const numeros = d.numeros ?? [];
  if (canales.whatsapp) {
    if (!numeros.length) c.push(mal('whatsapp', 'WhatsApp encendido pero sin número conectado', 'Pestaña WhatsApp → Conectar'));
    for (const nu of numeros) {
      const w = nu.webhook ?? {};
      let host = null;
      try { host = w.url ? new URL(w.url).host : null; } catch { host = null; }
      if (w.error) c.push(aviso('whatsapp', `No pude revisar el webhook de ${nu.numero} en YCloud: ${w.error}`, 'Si la clave de API cambió: Desconectar y Conectar de nuevo'));
      else if (host !== WEBHOOK_HOST) c.push(mal('whatsapp', `El webhook de ${nu.numero} apunta a ${host ?? 'ningún lado'}: los mensajes no llegan`, `En YCloud → Developers → Webhooks, cambiar la URL a https://${WEBHOOK_HOST}/api/whatsapp/ycloud/${nu.clave} (o Desconectar y Conectar)`));
      else if (!nu.ultimo) c.push(aviso('whatsapp', `${nu.numero} conectado, pero todavía no llegó ningún mensaje`, 'Mandá un «hola» desde otro celular'));
      else if (d.now - nu.ultimo > 14 * DIA) c.push(aviso('whatsapp', `${nu.numero}: no llega nada hace ${Math.floor((d.now - nu.ultimo) / DIA)} días`, 'Que el dueño abra la app de WhatsApp Business (Meta corta la coexistencia a los 14 días sin abrirla)'));
      else c.push(ok('whatsapp', `${nu.numero} conectado y recibiendo`));
      if (!w.error && host === WEBHOOK_HOST && nu.ecos === false) c.push(aviso('whatsapp', `${nu.numero}: el asistente no sabe cuándo contesta el dueño (YCloud no manda los ecos)`, 'Pedirle a YCloud el evento whatsapp.smb.message.echoes'));
    }
  } else if (numeros.length) c.push(aviso('whatsapp', 'Tiene un número de WhatsApp pero el canal está apagado: no responde ahí', 'Administración → marcar WhatsApp'));

  // Los productos.
  const p = d.productos;
  if (p === null || p === undefined) c.push(aviso('productos', 'No pude leer los productos'));
  else if (!p.activos) c.push(aviso('productos', 'Sin productos a la venta: responde solo con la ficha', 'Pestaña Importar Excel o + Nuevo producto'));
  else c.push(ok('productos', `${p.activos} productos a la venta${p.agotados ? `, ${p.agotados} agotados` : ''}`));

  // La charla de prueba (solo con la ficha activa).
  if (d.charla) {
    const fallas = d.charla.filter((t) => t.que === 'error' || !(t.respuestas ?? []).some((r) => String(r).trim()));
    if (fallas.length) c.push(mal('charla', `La charla de prueba falló en: ${fallas.map((t) => `«${t.mensaje}»`).join(', ')}`, 'Revisar la clave de la IA y el tope diario; probar en la pestaña Asistente'));
    else if (!d.charla.some((t) => t.que === 'ia')) c.push(aviso('charla', 'La charla de prueba respondió, pero no llegó a usar la IA'));
    else c.push(ok('charla', 'Charla de prueba: saluda, responde con la IA y pasa a una persona'));
  }

  return { verde: !c.some((x) => x.estado === 'mal'), controles: c };
}

/** Los mensajes de la charla de prueba: con varios idiomas, primero elige el 1. */
export const mensajesDePrueba = (varios) => (varios ? ['hola', '1', '¿Tienen pan integral hoy?', 'PERSONA'] : ['hola', '¿Tienen pan integral hoy?', 'PERSONA']);
