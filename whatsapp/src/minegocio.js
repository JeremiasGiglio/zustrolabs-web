// ZL-164: «Mi negocio», lo que el dueño carga y cambia solo, sin pasar por el equipo: horarios (hasta 2 turnos por
// día), fechas especiales y feriados, qué hacer fuera de horario, dirección con mapa, envíos por zona, formas de pago y
// contacto. El código calcula los hechos (qué día y hora es, si está abierto, cuándo abre) y se los da a la IA como
// datos: así «¿están atendiendo ahora?» tiene respuesta exacta. Las preguntas frecuentes y «lo que no supo responder»
// viven en el negocio (atencion.js). Este módulo no importa nada de Cloudflare: se prueba con `node --test`.

export const MAX_ZONAS = 20;
export const MAX_ESPECIALES = 80;
export const FUERA_DE_HORARIO = ['pedidos', 'responder', 'cerrado'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86_400_000;
const DIAS = { es: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'], en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], hr: ['ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota', 'nedjelja'] };

const corto = (v, n) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001F\u007F<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const plata = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.,]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
export const pesos = (n) => `$ ${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

function turnos(lista) {
  return (Array.isArray(lista) ? lista : [])
    .map((t) => ({ abre: String(t?.abre ?? ''), cierra: String(t?.cierra ?? '') }))
    .filter((t) => HHMM.test(t.abre) && HHMM.test(t.cierra) && t.abre < t.cierra)
    .sort((a, b) => a.abre.localeCompare(b.abre))
    // Un turno que se pisa con el anterior no va (9 a 18 y 16 a 20 sería un error de carga).
    .filter((t, i, ts) => i === 0 || t.abre >= ts[i - 1].cierra)
    .slice(0, 2);
}

/** Lo que llega de la app → lo que se guarda (solo campos conocidos, cortos y válidos). */
export function normalizarMiNegocio(d, antes = null) {
  const a = antes ?? {};
  const v = (k) => (d && d[k] !== undefined ? d[k] : a[k]);
  const horarios = Array.from({ length: 7 }, (_, i) => turnos(v('horarios')?.[i]));
  const especiales = (Array.isArray(v('especiales')) ? v('especiales') : [])
    .map((e) => ({ desde: String(e?.desde ?? ''), hasta: String(e?.hasta || e?.desde || ''), tipo: e?.tipo === 'horario' ? 'horario' : 'cerrado', turnos: e?.tipo === 'horario' ? turnos(e?.turnos) : [], nota: corto(e?.nota, 80) }))
    .filter((e) => FECHA.test(e.desde) && FECHA.test(e.hasta) && e.desde <= e.hasta && (Date.parse(e.hasta) - Date.parse(e.desde)) / DIA_MS <= 62)
    .sort((x, y) => x.desde.localeCompare(y.desde))
    .slice(0, MAX_ESPECIALES);
  const zonas = (Array.isArray(v('envios')?.zonas) ? v('envios').zonas : [])
    .map((z) => ({ nombre: corto(z?.nombre, 60), costo: plata(z?.costo) ?? 0, minimo: plata(z?.minimo), gratisDesde: plata(z?.gratisDesde), demora: corto(z?.demora, 60) }))
    .filter((z) => z.nombre)
    .slice(0, MAX_ZONAS);
  const p = v('pagos') ?? {};
  const c = v('contacto') ?? {};
  return {
    horarios,
    especiales,
    fueraDeHorario: FUERA_DE_HORARIO.includes(v('fueraDeHorario')) ? v('fueraDeHorario') : 'pedidos',
    direccion: corto(v('direccion'), 200),
    envios: { zonas },
    pagos: { efectivo: p.efectivo === true, transferencia: p.transferencia === true, mercadopago: p.mercadopago === true, tarjeta: p.tarjeta === true, alias: corto(p.alias, 80) },
    contacto: { telefono: corto(c.telefono, 40), correo: corto(c.correo, 120), instagram: corto(c.instagram, 60).replace(/^@/, ''), web: corto(c.web, 200) },
  };
}

/** Día, fecha y minuto del día en la zona del negocio. dia: 0 = lunes … 6 = domingo. */
export function enZona(now, zona) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const hora = Number(p.hour) % 24;
  return { fecha: `${p.year}-${p.month}-${p.day}`, dia: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday), min: hora * 60 + Number(p.minute), hhmm: `${String(hora).padStart(2, '0')}:${p.minute}` };
}
const sumarDias = (fecha, n) => new Date(Date.parse(`${fecha}T12:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const diaDeFecha = (fecha) => (new Date(`${fecha}T12:00:00Z`).getUTCDay() + 6) % 7;
const aMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const hora = (hhmm) => hhmm.replace(/^0(\d)/, '$1');

/** ¿Cargó algún horario? (sin horarios, el asistente no dice si está abierto: solo la fecha y la hora). */
export const tieneHorarios = (mn) => Boolean(mn?.horarios?.some((t) => t.length) || mn?.especiales?.length);

/** Los turnos de una fecha: la fecha especial manda sobre el horario de la semana. → {turnos, especial?} */
export function turnosDe(mn, fecha) {
  const e = (mn?.especiales ?? []).find((x) => x.desde <= fecha && fecha <= x.hasta);
  if (e) return { turnos: e.tipo === 'cerrado' ? [] : e.turnos, especial: e };
  return { turnos: mn?.horarios?.[diaDeFecha(fecha)] ?? [] };
}

/**
 * ¿Está abierto ahora? → null si no cargó horarios; si no, {abierto, cierra?, abre?: {fecha, enDias, hora, dia}, especial?}.
 */
export function estadoAhora(mn, zona, now = Date.now()) {
  if (!tieneHorarios(mn)) return null;
  const z = enZona(now, zona);
  const hoy = turnosDe(mn, z.fecha);
  const actual = hoy.turnos.find((t) => aMin(t.abre) <= z.min && z.min < aMin(t.cierra));
  if (actual) return { abierto: true, cierra: actual.cierra, ...(hoy.especial && { especial: hoy.especial }) };
  for (let n = 0; n <= 14; n++) {
    const fecha = sumarDias(z.fecha, n);
    const d = turnosDe(mn, fecha);
    const t = d.turnos.find((x) => n > 0 || aMin(x.abre) > z.min);
    if (t) return { abierto: false, abre: { fecha, enDias: n, hora: t.abre, dia: diaDeFecha(fecha) }, ...(hoy.especial && { especial: hoy.especial }) };
  }
  return { abierto: false, ...(hoy.especial && { especial: hoy.especial }) };
}

/** «hoy a las 9:00», «mañana a las 9:00», «el lunes a las 9:00» (o con fecha, si falta más de una semana). */
export function cuandoAbre(abre, idioma = 'es') {
  if (!abre) return '';
  const h = hora(abre.hora);
  const fecha = `${abre.fecha.slice(8)}/${abre.fecha.slice(5, 7)}`;
  if (idioma === 'en') return abre.enDias === 0 ? `today at ${h}` : abre.enDias === 1 ? `tomorrow at ${h}` : abre.enDias < 7 ? `on ${DIAS.en[abre.dia]} at ${h}` : `on ${fecha} at ${h}`;
  if (idioma === 'hr') return abre.enDias === 0 ? `danas u ${h}` : abre.enDias === 1 ? `sutra u ${h}` : abre.enDias < 7 ? `${DIAS.hr[abre.dia]} u ${h}` : `${fecha} u ${h}`;
  return abre.enDias === 0 ? `hoy a las ${h}` : abre.enDias === 1 ? `mañana a las ${h}` : abre.enDias < 7 ? `el ${DIAS.es[abre.dia]} a las ${h}` : `el ${fecha} a las ${h}`;
}

/** Para los textos fijos («te responden por acá …»): «hoy hasta las 20:30» o «mañana desde las 9:00». */
export function cuandoResponden(mn, zona, now, idioma = 'es') {
  const e = estadoAhora(mn, zona, now);
  if (!e) return '';
  if (e.abierto) return idioma === 'en' ? `today until ${hora(e.cierra)}` : idioma === 'hr' ? `danas do ${hora(e.cierra)}` : `hoy hasta las ${hora(e.cierra)}`;
  if (!e.abre) return '';
  return cuandoAbre(e.abre, idioma).replace(/ a las /, ' desde las ').replace(/^at /, '').replace(/ at /, ' from ').replace(/ u (\d)/, ' od $1');
}

const turnosTexto = (ts) => (ts.length ? ts.map((t) => `${hora(t.abre)} a ${hora(t.cierra)}`).join(' y ') : 'cerrado');
const fechaCorta = (f) => `${f.slice(8)}/${f.slice(5, 7)}`;

/** Lo que la IA sabe de la fecha, la hora y el horario: hechos calculados por el código. */
export function textoHorariosIa(mn, zona, now = Date.now()) {
  const z = enZona(now, zona);
  const lineas = [`Ahora: ${DIAS.es[z.dia]} ${fechaCorta(z.fecha)}/${z.fecha.slice(0, 4)}, ${hora(z.hhmm)} (hora del negocio).`];
  const e = estadoAhora(mn, zona, now);
  if (!e) return lineas.join('\n');
  lineas.push(e.abierto ? `Estado ahora: ABIERTO, cierra hoy a las ${hora(e.cierra)}.` : `Estado ahora: CERRADO${e.abre ? `, abre ${cuandoAbre(e.abre)}` : ''}.`);
  if (e.especial?.nota) lineas.push(`Hoy es una fecha especial: ${e.especial.nota}.`);
  lineas.push('Horario de la semana:', ...DIAS.es.map((d, i) => `- ${d.charAt(0).toUpperCase()}${d.slice(1)}: ${turnosTexto(mn.horarios?.[i] ?? [])}`));
  const proximas = (mn.especiales ?? []).filter((x) => x.hasta >= z.fecha && x.desde <= sumarDias(z.fecha, 30));
  if (proximas.length) {
    lineas.push('Fechas especiales (próximos 30 días, mandan sobre el horario de la semana):', ...proximas.map((x) => `- ${x.desde === x.hasta ? fechaCorta(x.desde) : `del ${fechaCorta(x.desde)} al ${fechaCorta(x.hasta)}`}: ${x.tipo === 'cerrado' ? 'cerrado' : turnosTexto(x.turnos)}${x.nota ? ` (${x.nota})` : ''}`));
  }
  const fuera = { pedidos: 'Si está cerrado, igual podés tomar el pedido: aclarale que lo preparan cuando abran y decile cuándo.', responder: 'Si está cerrado, respondé las preguntas pero no tomes pedidos: decile cuándo abren.', cerrado: 'Si está cerrado, no atiende por acá.' };
  lineas.push(fuera[mn.fueraDeHorario] ?? fuera.pedidos);
  return lineas.join('\n');
}

export const mapaDe = (direccion) => (direccion ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}` : '');

/** Envíos por zona, en texto para la IA y para el comprador. */
export function textoEnvios(mn) {
  return (mn?.envios?.zonas ?? []).map((z) => `- ${z.nombre}: ${z.costo ? pesos(z.costo) : 'sin cargo'}${z.gratisDesde ? ` (gratis desde ${pesos(z.gratisDesde)})` : ''}${z.minimo ? `, pedido mínimo ${pesos(z.minimo)}` : ''}${z.demora ? `, llega ${z.demora}` : ''}`).join('\n');
}
/** El costo de envío a una zona para un total de productos (gratis desde X). → {costo, falta?} */
export function costoEnvio(zona, total) {
  if (!zona) return { costo: 0 };
  const costo = zona.gratisDesde && total >= zona.gratisDesde ? 0 : zona.costo ?? 0;
  return { costo, ...(zona.minimo && total < zona.minimo && { falta: Math.round((zona.minimo - total) * 100) / 100 }) };
}

/** Formas de pago. `conAlias`: solo en el aviso de pedido aceptado (no se le da a la IA). */
export function textoPagos(mn, { conAlias = false } = {}) {
  const p = mn?.pagos ?? {};
  const lista = [p.efectivo && 'efectivo', p.transferencia && (conAlias && p.alias ? `transferencia (alias: ${p.alias})` : 'transferencia'), p.mercadopago && 'Mercado Pago', p.tarjeta && 'tarjeta'].filter(Boolean);
  if (!lista.length) return '';
  const t = lista.join(', ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Todo lo de «Mi negocio» como información para la IA (sin el alias de pago). */
export function textoMiNegocioIa(mn, zona, now = Date.now()) {
  const partes = [textoHorariosIa(mn ?? {}, zona, now)];
  if (mn?.direccion) partes.push(`Dirección: ${mn.direccion}. Mapa: ${mapaDe(mn.direccion)}`);
  const envios = textoEnvios(mn);
  if (envios) partes.push(`Envíos por zona (el costo lo suma el sistema al total):\n${envios}`);
  const pagos = textoPagos(mn);
  if (pagos) partes.push(`Formas de pago: ${pagos}.`);
  const c = mn?.contacto ?? {};
  const contacto = [c.telefono && `teléfono ${c.telefono}`, c.correo && `correo ${c.correo}`, c.instagram && `Instagram @${c.instagram}`, c.web && `web ${c.web}`].filter(Boolean);
  if (contacto.length) partes.push(`Contacto: ${contacto.join(', ')}.`);
  return partes.join('\n\n');
}

// ───────────────────────── Feriados ─────────────────────────

/** El país de los feriados según la zona horaria del negocio (los que sabemos calcular). */
export const paisDeZona = (zona) => ({ 'America/Argentina/Buenos_Aires': 'AR', 'Europe/Zagreb': 'HR', 'Europe/Madrid': 'ES' })[zona] ?? null;

function pascua(anio) {
  // Algoritmo de Meeus/Jones/Butcher (calendario gregoriano).
  const a = anio % 19, b = Math.floor(anio / 100), c = anio % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Feriados nacionales de un año (Argentina, Croacia o España). Los trasladables de Argentina siguen la Ley 27.399
 * (martes o miércoles → el lunes anterior; jueves o viernes → el lunes siguiente); un decreto puede cambiarlos, así que
 * se cargan como sugerencia y el dueño los revisa.
 */
export function feriados(pais, anio) {
  const f = (md, nombre) => ({ fecha: `${anio}-${md}`, nombre });
  const p = pascua(anio);
  const mover = (fecha, nombre) => {
    const d = diaDeFecha(fecha);
    const n = d === 1 || d === 2 ? -d : d === 3 || d === 4 ? 7 - d : 0;
    return { fecha: sumarDias(fecha, n), nombre };
  };
  if (pais === 'AR') return [
    f('01-01', 'Año Nuevo'), { fecha: sumarDias(p, -48), nombre: 'Carnaval' }, { fecha: sumarDias(p, -47), nombre: 'Carnaval' },
    f('03-24', 'Día de la Memoria'), f('04-02', 'Día de las Malvinas'), { fecha: sumarDias(p, -2), nombre: 'Viernes Santo' },
    f('05-01', 'Día del Trabajador'), f('05-25', 'Revolución de Mayo'), mover(`${anio}-06-17`, 'Paso a la Inmortalidad de Güemes'),
    f('06-20', 'Día de la Bandera'), f('07-09', 'Día de la Independencia'), mover(`${anio}-08-17`, 'Paso a la Inmortalidad de San Martín'),
    mover(`${anio}-10-12`, 'Día de la Diversidad Cultural'), mover(`${anio}-11-20`, 'Día de la Soberanía Nacional'),
    f('12-08', 'Inmaculada Concepción'), f('12-25', 'Navidad'),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (pais === 'HR') return [
    f('01-01', 'Nova godina'), f('01-06', 'Sveta tri kralja'), { fecha: p, nombre: 'Uskrs' }, { fecha: sumarDias(p, 1), nombre: 'Uskrsni ponedjeljak' },
    f('05-01', 'Praznik rada'), f('05-30', 'Dan državnosti'), { fecha: sumarDias(p, 60), nombre: 'Tijelovo' }, f('06-22', 'Dan antifašističke borbe'),
    f('08-05', 'Dan pobjede'), f('08-15', 'Velika Gospa'), f('11-01', 'Svi sveti'), f('11-18', 'Dan sjećanja'), f('12-25', 'Božić'), f('12-26', 'Sveti Stjepan'),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (pais === 'ES') return [
    f('01-01', 'Año Nuevo'), f('01-06', 'Reyes'), { fecha: sumarDias(p, -2), nombre: 'Viernes Santo' }, f('05-01', 'Fiesta del Trabajo'),
    f('08-15', 'Asunción'), f('10-12', 'Fiesta Nacional'), f('11-01', 'Todos los Santos'), f('12-06', 'Día de la Constitución'), f('12-08', 'Inmaculada'), f('12-25', 'Navidad'),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha));
  return [];
}

// ───────────────────────── Fuera de horario, pagos y zonas en la charla ─────────────────────────

/** El instante (ms) de una fecha y hora locales en la zona del negocio (dos pasadas: alcanza con los cambios de hora). */
export function instanteEnZona(fecha, hhmm, zona) {
  const objetivo = Date.parse(`${fecha}T${hhmm}:00Z`);
  let t = objetivo;
  for (let i = 0; i < 2; i++) {
    const z = enZona(t, zona);
    const visto = Date.parse(`${z.fecha}T${z.hhmm}:00Z`);
    t += objetivo - visto;
  }
  return t;
}

/**
 * Qué hace el asistente ahora según «Fuera de horario»: → null si está abierto o no cargó horarios; si no,
 * {modo: 'pedidos'|'responder'|'cerrado', hasta (ms en que abre, o null), cuando: {es, en, hr}}.
 */
export function fueraDeHorarioAhora(mn, zona, now = Date.now()) {
  const e = estadoAhora(mn, zona, now);
  if (!e || e.abierto) return null;
  const hasta = e.abre ? instanteEnZona(e.abre.fecha, e.abre.hora, zona) : null;
  return { modo: mn.fueraDeHorario ?? 'pedidos', hasta, cuando: Object.fromEntries(['es', 'en', 'hr'].map((i) => [i, e.abre ? cuandoAbre(e.abre, i) : ''])) };
}

/** «Cómo vendés» con lo de «Mi negocio»: las formas de pago marcadas y la dirección (si no las escribió en texto). */
export function ajustesConMiNegocio(ajustes, mn, { conAlias = false } = {}) {
  const pagos = mn ? textoPagos(mn, { conAlias }) : '';
  return {
    ...ajustes,
    pago: pagos || ajustes?.pago || '',
    retiro: ajustes?.retiro || mn?.direccion || '',
    zonas: mn?.envios?.zonas ?? [],
  };
}

/** La zona que eligió el comprador: por número («2») o por nombre («centro»). → la zona o null. */
export function elegirZona(zonas, texto) {
  const lista = Array.isArray(zonas) ? zonas : [];
  const n = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = n(texto);
  if (/^\d{1,2}$/.test(m)) return lista[Number(m) - 1] ?? null;
  if (m.length < 3) return null;
  return lista.find((z) => n(z.nombre) === m) ?? lista.find((z) => n(z.nombre).includes(m) || m.includes(n(z.nombre))) ?? null;
}
