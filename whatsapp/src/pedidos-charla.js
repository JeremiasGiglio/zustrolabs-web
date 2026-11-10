// Pedidos dentro de la charla (ZL-139). La IA solo traduce lo que pide la persona a «estos productos del catálogo,
// estas cantidades» (campo `pedido` de su respuesta, con la ref de cada producto). TODO lo demás es código fijo, igual
// para todos los negocios: el resumen con precios y total, la reserva, las preguntas de retiro o envío, nombre y
// dirección, y la confirmación. Así un error de la IA nunca confirma un pedido ni inventa un total.
//
// La charla guarda en la memoria `pedido: {paso, entrega, nombre}`:
//   confirmar → (SÍ) → entrega → nombre → [direccion] → pedido pendiente con número.
// CANCELAR, en cualquier paso, vacía el carrito y libera el stock. PEDIDO muestra el carrito.

import { normalizar, pesos } from './catalogo.js';

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
    error: 'No pude registrar el pedido. Probá de nuevo en un rato o escribí PERSONA.',
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
    error: 'I could not place the order. Please try again later or write PERSONA.',
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
    error: 'Nisam mogao zaprimiti narudžbu. Pokušajte kasnije ili napišite PERSONA.',
  },
};
export const textosPedido = (idioma) => T[idioma] ?? T.es;
export const MINUTOS_CARRITO = 20;

const SI = /^(si|sí|s|dale|ok|okay|listo|confirmo|confirmar|confirmado|de una|perfecto|yes|y|yep|sure|da|moze|može|potvrdujem|potvrđujem)\b/;
const CANCELAR = /^(cancelar|cancelo|cancela|anular|anulo|no quiero nada|cancel|odustani|odustajem)\b/;
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
export function pedidosDeCharla({ cat, charla, canal, negocio, precios }) {
  const op = async (nombre, args) => {
    const r = await cat.ejecutar(nombre, args);
    if (!r?.ok) { const e = new Error(r?.error ?? 'error'); e.catalogo = true; throw e; }
    return r.valor;
  };

  return {
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
    async antes(texto, estadoPedido, idioma) {
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
        return { texto: `${resumenPedido(p, { precios, idioma })}\n\n${t.confirmar}`, pedido: { paso: 'confirmar' }, metrica: 'pedido_ver' };
      }
      if (!paso) return null;
      if (paso === 'confirmar') {
        // Solo un «sí» corto confirma («sí, pero agregá pan» es un cambio: sigue la IA y el carrito queda).
        if (!SI.test(m) || m.split(' ').length > 3) return null;
        const p = await op('carritoDe', [charla]).catch(() => null);
        if (!p) return { texto: t.vencido(MINUTOS_CARRITO), pedido: null, metrica: 'pedido_vencido' };
        return { texto: t.entrega, pedido: { paso: 'entrega' }, metrica: 'pedido_entrega' };
      }
      if (paso === 'entrega') {
        const entrega = RETIRO.test(m) ? 'retiro' : ENVIO.test(m) ? 'envio' : null;
        if (!entrega) return { texto: t.entregaOtraVez, pedido: estadoPedido, metrica: 'pedido_entrega' };
        return { texto: t.nombre, pedido: { paso: 'nombre', entrega }, metrica: 'pedido_nombre' };
      }
      const limpio = String(texto ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
      if (paso === 'nombre') {
        if (limpio.length < 2 || /^\d+$/.test(limpio)) return { texto: t.nombre, pedido: estadoPedido, metrica: 'pedido_nombre' };
        const nuevo = { ...estadoPedido, nombre: limpio.slice(0, 80) };
        if (nuevo.entrega === 'envio') return { texto: t.direccion, pedido: { ...nuevo, paso: 'direccion' }, metrica: 'pedido_direccion' };
        return this.cerrar(nuevo, idioma);
      }
      if (paso === 'direccion') {
        if (limpio.length < 5) return { texto: t.direccion, pedido: estadoPedido, metrica: 'pedido_direccion' };
        return this.cerrar({ ...estadoPedido, direccion: limpio.slice(0, 200) }, idioma);
      }
      return null;
    },

    /** Confirma el carrito como pedido pendiente. */
    async cerrar(datos, idioma) {
      const t = textosPedido(idioma);
      try {
        const p = await op('confirmar', [charla, { nombre: datos.nombre, entrega: datos.entrega, direccion: datos.direccion ?? '' }]);
        return { texto: `${t.listo(p.numero, negocio)}\n\n${resumenPedido(p, { precios, idioma }).split('\n').slice(1).join('\n')}`, pedido: null, metrica: 'pedido_nuevo', numero: p.numero };
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
      // Si nada de lo pedido se pudo, el «¡Dale!» de la IA no va: solo lo que dice el sistema (soloSistema).
      if (!r.pedido) {
        const falt = resumenPedido(null, { precios, idioma, faltantes: r.faltantes });
        return { texto: falt || t.vacio, pedido: null, soloSistema: Boolean(falt) };
      }
      return { texto: `${resumenPedido(r.pedido, { precios, idioma, faltantes: r.faltantes })}\n\n${t.confirmar}`, pedido: { paso: 'confirmar' }, soloSistema: Boolean(r.sinCambios) };
    },
  };
}
