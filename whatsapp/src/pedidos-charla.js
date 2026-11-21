// Pedidos dentro de la charla (ZL-139). La IA solo traduce lo que pide la persona a «estos productos del catálogo,
// estas cantidades» (campo `pedido` de su respuesta, con la ref de cada producto). TODO lo demás es código fijo, igual
// para todos los negocios: el resumen con precios y total, la reserva, las preguntas de retiro o envío, nombre y
// dirección, y la confirmación. Así un error de la IA nunca confirma un pedido ni inventa un total.
//
// La charla guarda en la memoria `pedido: {paso, entrega, nombre}`:
//   confirmar → (SÍ) → entrega → nombre → [direccion] → pedido pendiente con número.
// CANCELAR, en cualquier paso, vacía el carrito y libera el stock. PEDIDO muestra el carrito.

import { normalizar, pesos } from './catalogo.js';

// ZL-154: cómo se le cuenta a la IA el estado de un pedido de la persona (para responder «¿ya salió mi pedido?»).
const ESTADO_PARA_IA = {
  pendiente: 'esperando que el negocio lo confirme',
  aceptado: 'confirmado por el negocio, todavía sin pagar ni entregar',
  pagado: 'pagado, falta entregarlo',
  entregado: 'entregado',
  rechazado: 'el negocio no lo pudo tomar',
  cancelado: 'cancelado',
  vencido: 'se canceló solo porque nadie lo confirmó a tiempo',
};

const T = {
  es: {
    titulo: (min) => `Tu pedido (lo guardo ${min} minutos):`,
    total: (t) => `Total: ${t}`,
    totalNegocio: 'El total te lo confirma el negocio.',
    sinPrecioAlgunos: 'Algunos productos no tienen precio cargado: el total te lo confirma el negocio.',
    confirmar: '¿Lo confirmamos? Respondé SÍ, o decime qué cambiar. CANCELAR para anularlo.',
    noPude: 'No pude sumar:',
    noExiste: 'un producto que no encontré en el catálogo',
    pausado: (n) => `${n} (no está disponible)`,
    sinStock: (n, d) => (d > 0 ? `${n} (quedan ${d})` : `${n} (no queda)`),
    cantidad: (n) => `${n} (esa cantidad no se puede)`,
    vacio: 'Tu pedido quedó vacío.',
    entrega: '¿Lo retirás o te lo enviamos?\n1. Retiro\n2. Envío',
    entregaOtraVez: 'Respondé 1 para retirar o 2 para envío (o CANCELAR).',
    nombre: '¿A nombre de quién lo dejo?',
    direccion: '¿A qué dirección lo enviamos? (calle, número y barrio)',
    listo: (n, negocio) => `¡Listo! Tu pedido N.º ${n} quedó registrado. ${negocio} lo revisa y te confirma por acá.`,
    vencido: (min) => `Tu pedido se venció (lo guardo ${min} minutos sin confirmar). Decime de nuevo qué querés y lo armo.`,
    cancelado: 'Listo, cancelé tu pedido.',
    nada: 'No tenés un pedido armado. Decime qué querés y lo armo.',
    error: 'Uy, no pude registrar el pedido 😓 ¿Probamos de nuevo en un ratito?',
    botones: { si: 'Sí, confirmo', cancelar: 'Cancelar', retiro: 'Retiro', envio: 'Envío' },
    preguntaEntrega: '¿Lo retirás o te lo enviamos?',
    // ZL-163: revisión final, cambios en el camino y el cierre con los datos.
    revisarTitulo: 'Revisá tu pedido:',
    entregaRetiro: (d) => `Entrega: retirás en el local${d ? ` (${d})` : ''}`,
    entregaEnvio: (d) => `Entrega: envío a ${d}`,
    aNombre: (n) => `A nombre de: ${n}`,
    pago: (p) => `Pago: ${p}`,
    confirmarRevision: '¿Está todo bien? Respondé SÍ para confirmar o decime qué cambiar.',
    cambiadaRetiro: 'Perfecto, lo retirás en el local.',
    cambiadaEnvio: 'Perfecto, te lo enviamos.',
    soloNombre: 'Decime solo el nombre, por favor (por ejemplo: Ana).',
    ajustado: (n, d) => `De ${n} ${d === 1 ? 'queda 1: te sumé 1' : `quedan ${d}: te sumé ${d}`}.`,
    listoCon: (n, negocio, nombre, entrega) => `¡Listo${nombre ? `, ${nombre}` : ''}! Tu pedido N.º ${n} quedó registrado (${entrega}). ${negocio} lo revisa y te confirma por acá.`,
    entregaCorta: (e, d) => (e === 'envio' ? `envío a ${d}` : 'retiro en el local'),
  },
  en: {
    titulo: (min) => `Your order (held for ${min} minutes):`,
    total: (t) => `Total: ${t}`,
    totalNegocio: 'The shop will confirm the total.',
    sinPrecioAlgunos: 'Some products have no price yet: the shop will confirm the total.',
    confirmar: 'Shall we confirm it? Reply YES, or tell me what to change. CANCEL to drop it.',
    noPude: 'I could not add:',
    noExiste: 'a product I could not find in the catalogue',
    pausado: (n) => `${n} (not available)`,
    sinStock: (n, d) => (d > 0 ? `${n} (only ${d} left)` : `${n} (sold out)`),
    cantidad: (n) => `${n} (that quantity is not possible)`,
    vacio: 'Your order is empty now.',
    entrega: 'Pick-up or delivery?\n1. Pick-up\n2. Delivery',
    entregaOtraVez: 'Reply 1 for pick-up or 2 for delivery (or CANCEL).',
    nombre: 'What name should I put it under?',
    direccion: 'What is the delivery address? (street, number, area)',
    listo: (n, negocio) => `Done! Your order no. ${n} has been placed. ${negocio} will check it and confirm here.`,
    vencido: (min) => `Your order expired (I hold it ${min} minutes without confirmation). Tell me again what you want.`,
    cancelado: 'OK, I cancelled your order.',
    nada: 'You have no order yet. Tell me what you want.',
    error: 'Oops, I could not place the order 😓 Shall we try again in a moment?',
    botones: { si: 'Yes, confirm', cancelar: 'Cancel', retiro: 'Pick-up', envio: 'Delivery' },
    preguntaEntrega: 'Pick-up or delivery?',
    revisarTitulo: 'Check your order:',
    entregaRetiro: (d) => `Delivery: pick-up at the shop${d ? ` (${d})` : ''}`,
    entregaEnvio: (d) => `Delivery: to ${d}`,
    aNombre: (n) => `Name: ${n}`,
    pago: (p) => `Payment: ${p}`,
    confirmarRevision: 'Is everything right? Reply YES to confirm or tell me what to change.',
    cambiadaRetiro: 'Great, you’ll pick it up at the shop.',
    cambiadaEnvio: 'Great, we’ll deliver it.',
    soloNombre: 'Just the name, please (for example: Ana).',
    ajustado: (n, d) => `Only ${d} ${n} left: I added ${d}.`,
    listoCon: (n, negocio, nombre, entrega) => `Done${nombre ? `, ${nombre}` : ''}! Your order no. ${n} has been placed (${entrega}). ${negocio} will check it and confirm here.`,
    entregaCorta: (e, d) => (e === 'envio' ? `delivery to ${d}` : 'pick-up at the shop'),
  },
  hr: {
    titulo: (min) => `Vaša narudžba (čuvam je ${min} minuta):`,
    total: (t) => `Ukupno: ${t}`,
    totalNegocio: 'Ukupan iznos potvrdit će trgovina.',
    sinPrecioAlgunos: 'Neki proizvodi nemaju cijenu: ukupan iznos potvrdit će trgovina.',
    confirmar: 'Potvrđujemo? Odgovorite DA ili mi recite što promijeniti. ODUSTANI za otkazivanje.',
    noPude: 'Nisam mogao dodati:',
    noExiste: 'proizvod koji nisam našao u katalogu',
    pausado: (n) => `${n} (nije dostupno)`,
    sinStock: (n, d) => (d > 0 ? `${n} (ostalo ${d})` : `${n} (rasprodano)`),
    cantidad: (n) => `${n} (ta količina nije moguća)`,
    vacio: 'Vaša narudžba je sada prazna.',
    entrega: 'Preuzimanje ili dostava?\n1. Preuzimanje\n2. Dostava',
    entregaOtraVez: 'Odgovorite 1 za preuzimanje ili 2 za dostavu (ili ODUSTANI).',
    nombre: 'Na čije ime?',
    direccion: 'Na koju adresu dostavljamo? (ulica, broj, kvart)',
    listo: (n, negocio) => `Gotovo! Vaša narudžba br. ${n} je zaprimljena. ${negocio} će je provjeriti i potvrditi ovdje.`,
    vencido: (min) => `Narudžba je istekla (čuvam je ${min} minuta bez potvrde). Recite mi ponovno što želite.`,
    cancelado: 'U redu, otkazao sam narudžbu.',
    nada: 'Još nemate narudžbu. Recite mi što želite.',
    error: 'Ups, nisam mogao zaprimiti narudžbu 😓 Pokušamo ponovno za koji trenutak?',
    botones: { si: 'Da, potvrđujem', cancelar: 'Odustani', retiro: 'Preuzimanje', envio: 'Dostava' },
    preguntaEntrega: 'Preuzimanje ili dostava?',
    revisarTitulo: 'Provjerite narudžbu:',
    entregaRetiro: (d) => `Preuzimanje u trgovini${d ? ` (${d})` : ''}`,
    entregaEnvio: (d) => `Dostava na: ${d}`,
    aNombre: (n) => `Na ime: ${n}`,
    pago: (p) => `Plaćanje: ${p}`,
    confirmarRevision: 'Je li sve u redu? Odgovorite DA za potvrdu ili mi recite što promijeniti.',
    cambiadaRetiro: 'U redu, preuzimate u trgovini.',
    cambiadaEnvio: 'U redu, dostavljamo.',
    soloNombre: 'Samo ime, molim (na primjer: Ana).',
    ajustado: (n, d) => `${n}: ostalo je ${d}, dodao sam ${d}.`,
    listoCon: (n, negocio, nombre, entrega) => `Gotovo${nombre ? `, ${nombre}` : ''}! Vaša narudžba br. ${n} je zaprimljena (${entrega}). ${negocio} će je provjeriti i potvrditi ovdje.`,
    entregaCorta: (e, d) => (e === 'envio' ? `dostava na ${d}` : 'preuzimanje u trgovini'),
  },
};
export const textosPedido = (idioma) => T[idioma] ?? T.es;
export const MINUTOS_CARRITO = 20;

// ZL-163: «sí» solo si TODO el mensaje es afirmativo («y una gaseosa» empezaba con «y», que valía como «yes», y
// confirmaba el pedido). CANCELAR solo si es todo el mensaje («cancelá la gaseosa» saca un producto: lo hace la IA).
const PALABRAS_SI = new Set(['si', 'dale', 'ok', 'okay', 'okey', 'oka', 'listo', 'confirmo', 'confirmar', 'confirmado', 'confirmalo', 'de', 'una', 'perfecto', 'yes', 'yep', 'yeah', 'sure', 'da', 'moze', 'potvrdujem', 'gracias', 'porfa', 'por', 'favor', 'joya', 'genial', 'bueno', 'claro', 'eso', 'esta', 'todo', 'bien', 'correcto', 'va', 'please']);
export const esSiPedido = (m) => { const w = String(m ?? '').split(' ').filter(Boolean); return w.length >= 1 && w.length <= 5 && w.every((x) => PALABRAS_SI.has(x)); };
const CANCELAR = /^(cancelar|cancelo|cancela|cancelalo|cancela todo|cancelar todo|cancelar el pedido|cancelar pedido|cancela el pedido|cancelame el pedido|anular|anulo|anula|anular el pedido|no quiero nada|ya no quiero nada|ya no lo quiero|olvidalo|cancel|cancel it|cancel order|cancel the order|odustani|odustajem)$/;
const PREGUNTA = /^(cuanto|cuando|donde|como|que|cual|hacen|tienen|aceptan|puedo|se puede|hay|how|what|when|where|do you|can i|koliko|kada|gdje)\b/;
const PALABRAS_NO_NOMBRE = /\b(hacen|tienen|quiero|queria|necesito|busco|encarg\w*|comprar|pedir|cuanto|precio|factura|envio|retiro|mejor|mandalo|direccion|pedido|hola|gracias|cancel\w*|si|no|ok|dale|pago|transferencia|efectivo|torta|tortas|productos?)\b/;
/** ZL-163: palabras que no van en un nombre («quiero encargarla», «hacen factura A»). También la usa la consulta. */
export const noEsNombre = (t) => PALABRAS_NO_NOMBRE.test(normalizar(t));
/** ZL-163: «mejor retiro», «lo paso a buscar», «mandámelo» en cualquier paso → cambia la entrega. */
function cambioEntrega(m) {
  if (String(m).split(' ').length > 8) return null;
  if (/\b(retiro|retirar|lo retiro|paso a buscar|lo paso a buscar|lo busco|lo voy a buscar|voy a buscar|pick ?up|collect|preuzim\w*)\b/.test(m)) return 'retiro';
  if (/\b(envio|enviar|envialo|enviamelo|mandalo|mandamelo|a domicilio|delivery|deliver|dostav\w*)\b/.test(m)) return 'envio';
  return null;
}
/** ZL-163: un nombre de verdad («Ana», «soy Ana Pérez»); una pregunta, un número o una frase no son un nombre. */
export function nombreDePedido(texto) {
  const t = String(texto ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim()
    .replace(/[.!,;:]+$/, '').replace(/^(soy|me llamo|mi nombre es|a nombre de|el nombre es|ponelo a nombre de|i'?m|my name is|ja sam|zovem se)\s+/i, '').trim();
  if (t.length < 2 || t.length > 60 || /[?¿@\d]|https?:/i.test(t) || t.split(/\s+/).length > 4) return '';
  if (PALABRAS_NO_NOMBRE.test(normalizar(t))) return '';
  return t.split(/\s+/).map((w) => w.charAt(0).toLocaleUpperCase() + w.slice(1)).join(' ');
}
const VER = /^(pedido|mi pedido|carrito|ver pedido|my order|order|narudzba|narudžba)$/;
const RETIRO = /^(1|retiro|retirar|lo retiro|paso a buscar|lo busco|voy a buscar|retiro en el local|pick ?up|collect|preuzimanje|preuzimam)\b/;
const ENVIO = /^(2|envio|envío|enviar|envialo|mandalo|delivery|a domicilio|deliver|dostava|dostavu)\b/;

/** El resumen que ve el comprador: lo arma el código con los datos del catálogo, nunca la IA. */
export function resumenPedido(p, { precios, idioma = 'es', faltantes = [], min = MINUTOS_CARRITO } = {}) {
  const t = textosPedido(idioma);
  const lineas = [];
  if (p?.items?.length) {
    lineas.push(t.titulo(min));
    for (const i of p.items) lineas.push(`• ${i.cantidad} × ${i.nombre}${precios && i.subtotal !== null ? ` — ${pesos(i.subtotal)}` : ''}`);
    if (!precios) lineas.push(t.totalNegocio);
    else if (p.sinPrecio) lineas.push(t.sinPrecioAlgunos);
    else lineas.push(t.total(pesos(p.total)));
  }
  if (faltantes.length) {
    const cuales = faltantes.map((f) => (f.motivo === 'no_existe' ? t.noExiste : f.motivo === 'pausado' ? t.pausado(f.nombre) : f.motivo === 'sin_stock' ? t.sinStock(f.nombre, f.disponible) : t.cantidad(f.nombre)));
    lineas.push(`${t.noPude} ${cuales.join(', ')}.`);
  }
  return lineas.join('\n');
}

/**
 * Lo que necesita la charla de un negocio con pedidos encendidos.
 * @param o {cat: {ejecutar(op, args)}, charla, canal: 'ig'|'wa', negocio: nombre, precios: bool}
 */
export function pedidosDeCharla({ cat, charla, canal, negocio, precios, ajustes = null }) {
  // ZL-149: «Cómo vendés» del negocio. Si solo hace retiro o solo envío, no se pregunta; la pregunta lleva dónde,
  // cuándo y cuánto cuesta cada uno.
  const fija = ajustes?.entrega === 'retiro' || ajustes?.entrega === 'envio' ? ajustes.entrega : null;
  const preguntaEntrega = (t) => `${t.preguntaEntrega}\n1. ${t.botones.retiro}${ajustes?.retiro ? ` (${ajustes.retiro})` : ''}\n2. ${t.botones.envio}${ajustes?.envio ? ` (${ajustes.envio})` : ''}`;
  const botonesEntrega = (t) => [{ id: '1', titulo: t.botones.retiro }, { id: '2', titulo: t.botones.envio }];
  const botonesConfirmar = (t) => [{ id: 'SI', titulo: t.botones.si }, { id: 'CANCELAR', titulo: t.botones.cancelar }];
  const op = async (nombre, args) => {
    const r = await cat.ejecutar(nombre, args);
    if (!r?.ok) { const e = new Error(r?.error ?? 'error'); e.catalogo = true; throw e; }
    return r.valor;
  };

  return {
    /**
     * ZL-154: los últimos pedidos de esta persona, para que la IA los recuerde (qué pidió, en qué estado está, «lo mismo
     * que la otra vez»). Solo lectura: la IA nunca los cambia. Sin la dirección ni otros datos de la persona. →
     * {texto, montos} (los totales pasan a ser montos que puede nombrar) o null si no tiene.
     */
    async compras(now = Date.now()) {
      const lista = await op('comprasDe', [charla, 3]).catch(() => null);
      if (!lista?.length) return null;
      const zona = ajustes?.zona || 'America/Argentina/Buenos_Aires';
      const dia = (t) => { try { return new Intl.DateTimeFormat('es-AR', { timeZone: zona, day: '2-digit', month: '2-digit' }).format(new Date(t)); } catch { return ''; } };
      const cuando = (t) => { try { return new Intl.DateTimeFormat('es-AR', { timeZone: zona, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t)); } catch { return ''; } };
      const montos = [];
      const lineas = lista.map((p) => {
        const estado = ESTADO_PARA_IA[p.estado] ?? p.estado;
        const vence = p.vence && p.vence > now && p.estado === 'aceptado' ? `; guardado hasta el ${cuando(p.vence)}` : '';
        const entrega = p.comprador?.entrega === 'envio' ? 'con envío' : p.comprador?.entrega === 'retiro' ? 'retira en el local' : '';
        const items = p.items.map((i) => `[ref ${i.id}] ${i.cantidad} × ${i.nombre}`).join(', ');
        let total = '';
        if (precios && !p.sinPrecio && Number.isFinite(p.total)) {
          total = ` · total ${pesos(p.total)}`;
          montos.push(pesos(p.total).replace(/\D/g, ''), String(p.total).replace(/\D/g, ''));
        }
        return `- Pedido N.º ${p.numero ?? '?'} del ${dia(p.creado)} · ${estado}${vence}${entrega ? ` · ${entrega}` : ''} · ${items}${total}`;
      });
      return { texto: lineas.join('\n'), montos: [...new Set(montos.filter(Boolean))] };
    },

    /** ZL-159: BORRAR también borra sus datos de los pedidos cerrados (los abiertos los necesita el negocio). */
    async olvidar() {
      await op('olvidarCompradores', [{ charla }]).catch(() => null);
    },

    /** ZL-157: el número del pedido abierto de esta persona (pendiente, aceptado o pagado), o null. */
    async abierto() {
      const lista = await op('comprasDe', [charla, 3]).catch(() => null);
      return lista?.find((p) => ['pendiente', 'aceptado', 'pagado'].includes(p.estado))?.numero ?? null;
    },

    /** Lo que la IA tiene que saber antes de responder: el carrito actual, con la ref de cada producto. */
    async contexto() {
      const p = await op('carritoDe', [charla]).catch(() => null);
      if (!p?.items?.length) return '(vacío)';
      return p.items.map((i) => `- [ref ${i.id}] ${i.cantidad} × ${i.nombre}`).join('\n');
    },

    /**
     * Antes de la IA: los pasos fijos del pedido. Devuelve {texto, pedido (el nuevo estado de la charla), metrica,
     * numero?} o null si el mensaje no es parte del pedido (sigue la IA).
     */
    async antes(texto, estadoPedido, idioma, { nombre = '' } = {}) {
      const t = textosPedido(idioma);
      const m = normalizar(texto);
      const paso = estadoPedido?.paso ?? null;
      if (CANCELAR.test(m)) {
        const habia = await op('carritoDe', [charla]).catch(() => null);
        if (!habia && !paso) return null;
        await op('carrito', [charla, [], { canal }]).catch(() => null);
        return { texto: t.cancelado, pedido: null, metrica: 'pedido_cancelado' };
      }
      if (VER.test(m)) {
        const p = await op('carritoDe', [charla]).catch(() => null);
        if (!p) return { texto: t.nada, pedido: null, metrica: 'pedido_ver' };
        return { texto: `${resumenPedido(p, { precios, idioma })}\n\n${t.confirmar}`, pedido: { paso: 'confirmar' }, metrica: 'pedido_ver', opciones: botonesConfirmar(t) };
      }
      if (!paso) return null;
      // ZL-163: mientras avanza, la reserva se renueva (antes vencía a los 20 minutos del carrito, aunque estuviera
      // dando los datos).
      await op('renovar', [charla, MINUTOS_CARRITO]).catch(() => null);
      const pregunta = /[?¿]/.test(texto) || PREGUNTA.test(m);
      // Lo que no es el dato del paso (una pregunta, un cambio en el carrito) lo responde la IA y después se repite el paso.
      const alaIa = (repetir, opciones = null) => ({ ia: true, repetir, ...(opciones && { opciones }) });
      const datos = { ...estadoPedido };
      // El orden: entrega → nombre (si no lo sabemos) → dirección (si es envío) → revisión.
      const siguiente = async (d) => {
        if (!d.nombre) {
          const conocido = String(nombre ?? '').trim().slice(0, 80);
          if (!conocido) return { texto: t.nombre, pedido: { ...d, paso: 'nombre' }, metrica: 'pedido_nombre' };
          d = { ...d, nombre: conocido };
        }
        if (d.entrega === 'envio' && !d.direccion) return { texto: t.direccion, pedido: { ...d, paso: 'direccion' }, metrica: 'pedido_direccion', nombre: d.nombre };
        return this.revisar(d, idioma);
      };
      if (paso === 'confirmar') {
        if (!esSiPedido(m)) return alaIa(t.confirmar, botonesConfirmar(t));
        const p = await op('carritoDe', [charla]).catch(() => null);
        if (!p) return { texto: t.vencido(MINUTOS_CARRITO), pedido: null, metrica: 'pedido_vencido' };
        if (!fija) return { texto: preguntaEntrega(t), pedido: { paso: 'entrega' }, metrica: 'pedido_entrega', opciones: botonesEntrega(t) };
        return siguiente({ entrega: fija });
      }
      if (paso === 'entrega') {
        const entrega = !pregunta ? (RETIRO.test(m) ? 'retiro' : ENVIO.test(m) ? 'envio' : cambioEntrega(m)) : null;
        // Un número que no es 1 ni 2 no es el menú: se vuelve a pedir la entrega.
        if (!entrega && /^\d+$/.test(m)) return { texto: t.entregaOtraVez, pedido: estadoPedido, metrica: 'pedido_entrega', opciones: botonesEntrega(t) };
        if (!entrega) return alaIa(preguntaEntrega(t), botonesEntrega(t));
        return siguiente({ ...datos, entrega });
      }
      // En nombre, dirección o la revisión: «mejor retiro» o «mandámelo» cambian la entrega.
      const cambio = !pregunta && !fija ? cambioEntrega(m) : null;
      if (cambio && cambio !== datos.entrega) {
        const r = await siguiente({ ...datos, entrega: cambio, ...(cambio === 'retiro' && { direccion: '' }) });
        return { ...r, texto: `${cambio === 'retiro' ? t.cambiadaRetiro : t.cambiadaEnvio}\n\n${r.texto}` };
      }
      if (paso === 'nombre') {
        const n = nombreDePedido(texto);
        if (n) return siguiente({ ...datos, nombre: n });
        if (pregunta || m.split(' ').length > 4) return alaIa(t.nombre);
        return { texto: t.soloNombre, pedido: estadoPedido, metrica: 'pedido_nombre' };
      }
      if (paso === 'direccion') {
        const limpio = String(texto ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
        if (pregunta) return alaIa(t.direccion);
        if (limpio.length < 6 || (!/\d/.test(limpio) && limpio.split(/\s+/).length < 2)) return { texto: t.direccion, pedido: estadoPedido, metrica: 'pedido_direccion' };
        return siguiente({ ...datos, direccion: limpio.slice(0, 200) });
      }
      if (paso === 'revisar') {
        if (esSiPedido(m)) return this.cerrar(datos, idioma);
        const n = /^(a nombre de|el nombre es|ponelo a nombre de)\b/.test(m) ? nombreDePedido(texto) : '';
        if (n) return this.revisar({ ...datos, nombre: n }, idioma);
        if (/^\d+$/.test(m)) return { texto: t.confirmarRevision, pedido: estadoPedido, metrica: 'pedido_revisar', opciones: botonesConfirmar(t) };
        return alaIa(t.confirmarRevision, botonesConfirmar(t));
      }
      return null;
    },

    /** ZL-163: la revisión final, con todo lo que va a quedar registrado, antes de confirmar. */
    async revisar(d, idioma) {
      const t = textosPedido(idioma);
      const p = await op('carritoDe', [charla]).catch(() => null);
      if (!p) return { texto: t.vencido(MINUTOS_CARRITO), pedido: null, metrica: 'pedido_vencido' };
      const lineas = [t.revisarTitulo, ...resumenPedido(p, { precios, idioma }).split('\n').slice(1),
        d.entrega === 'envio' ? t.entregaEnvio(d.direccion) : t.entregaRetiro(ajustes?.retiro ?? ''),
        t.aNombre(d.nombre), ...(ajustes?.pago ? [t.pago(ajustes.pago)] : [])];
      return { texto: `${lineas.join('\n')}\n\n${t.confirmarRevision}`, pedido: { ...d, paso: 'revisar' }, metrica: 'pedido_revisar', opciones: botonesConfirmar(t), nombre: d.nombre };
    },

    /** Confirma el carrito como pedido pendiente. */
    async cerrar(datos, idioma) {
      const t = textosPedido(idioma);
      try {
        const p = await op('confirmar', [charla, { nombre: datos.nombre, entrega: datos.entrega, direccion: datos.direccion ?? '' }]);
        // ZL-163: el cierre repite a nombre de quién, la entrega y cómo se paga (antes no decía nada de eso).
        const cierre = [t.listoCon(p.numero, negocio, datos.nombre, t.entregaCorta(datos.entrega, datos.direccion)), resumenPedido(p, { precios, idioma }).split('\n').slice(1).join('\n'), ajustes?.pago ? t.pago(ajustes.pago) : ''].filter(Boolean);
        return { texto: cierre.join('\n\n'), pedido: null, metrica: 'pedido_nuevo', numero: p.numero, nombre: datos.nombre };
      } catch (e) {
        if (e.catalogo && /venci|no hay un carrito/.test(e.message)) return { texto: t.vencido(MINUTOS_CARRITO), pedido: null, metrica: 'pedido_vencido' };
        return { texto: t.error, pedido: null, metrica: 'pedido_error' };
      }
    },

    /**
     * Después de la IA: si propuso cambiar el carrito, el código lo valida contra el catálogo, reserva y arma el
     * resumen. → {texto (para agregar a la respuesta), pedido} o null si no hubo cambio.
     */
    async despues(propuesta, idioma) {
      if (!propuesta?.cambia || !Array.isArray(propuesta.items)) return null;
      const t = textosPedido(idioma);
      const items = propuesta.items.slice(0, 30).map((i) => ({ id: String(i?.ref ?? '').replace(/^ref\s*/i, '').trim(), cantidad: Number(i?.cantidad) }));
      let r;
      try { r = await op('carrito', [charla, items, { canal, minutos: MINUTOS_CARRITO }]); } catch { return { texto: t.error, pedido: null }; }
      // ZL-163: si de algo quedan menos de los que pidió, se suma lo que hay y se lo dice (antes lo sacaba entero).
      const parciales = (r.faltantes ?? []).filter((f) => f.motivo === 'sin_stock' && f.disponible > 0);
      let ajustados = [];
      if (parciales.length) {
        const mapa = new Map(parciales.map((f) => [f.id, f.disponible]));
        try {
          const r2 = await op('carrito', [charla, items.map((i) => (mapa.has(i.id) ? { ...i, cantidad: mapa.get(i.id) } : i)), { canal, minutos: MINUTOS_CARRITO }]);
          ajustados = parciales.map((f) => t.ajustado(f.nombre, f.disponible));
          r = { ...r2, faltantes: (r2.faltantes ?? []).filter((f) => !mapa.has(f.id)) };
        } catch { /* queda lo primero */ }
      }
      // Si nada de lo pedido se pudo, el «¡Dale!» de la IA no va: solo lo que dice el sistema (soloSistema).
      if (!r.pedido) {
        const falt = resumenPedido(null, { precios, idioma, faltantes: r.faltantes });
        return { texto: falt || t.vacio, pedido: null, soloSistema: Boolean(falt) };
      }
      return { texto: `${resumenPedido(r.pedido, { precios, idioma, faltantes: r.faltantes })}${ajustados.length ? `\n${ajustados.join(' ')}` : ''}\n\n${t.confirmar}`, pedido: { paso: 'confirmar' }, soloSistema: Boolean(r.sinCambios), opciones: botonesConfirmar(t) };
    },
  };
}
