// Reportes del negocio (ZL-152): día, semana o mes. Lo que se ve en la pestaña Reportes y el Excel para mostrarle al
// cliente. Todo con la hora del negocio (su zona horaria, en «Cómo vendés»).
// - armarReporte: junta los números del día (Durable Object «Atencion»), los pedidos y las consultas (base del negocio).
// - xlsx: el Excel de verdad (.xlsx con varias hojas), armado a mano: un zip sin comprimir con el XML de cada hoja.
// Sin librerías y sin nada de Cloudflare: se prueba con `node --test`.

export const ZONA_POR_DEFECTO = 'America/Argentina/Buenos_Aires';
export const ZONAS = [
  ['America/Argentina/Buenos_Aires', 'Argentina'],
  ['America/Montevideo', 'Uruguay'],
  ['America/Santiago', 'Chile'],
  ['America/Sao_Paulo', 'Brasil (São Paulo)'],
  ['Europe/Zagreb', 'Croacia'],
  ['Europe/Madrid', 'España'],
];
export const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DIA_MS = 86_400_000;

const zonaValida = (z) => (ZONAS.some(([id]) => id === z) ? z : ZONA_POR_DEFECTO);
function partes(ms, zona) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zonaValida(zona), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) % 24 };
}
/** La fecha (AAAA-MM-DD) y la hora (0 a 23) de un momento, con la hora del negocio. */
export const diaLocal = (ms, zona) => partes(ms, zona).dia;
export const horaLocal = (ms, zona) => partes(ms, zona).hora;
/** 0 = lunes … 6 = domingo. */
export const diaSemana = (dia) => (new Date(`${dia}T12:00:00Z`).getUTCDay() + 6) % 7;
const sumarDias = (dia, n) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);

/** El primer milisegundo de ese día en la zona del negocio. */
export function inicioDelDia(dia, zona) {
  let t = Date.parse(`${dia}T00:00:00Z`);
  for (let i = 0; i < 3; i++) {
    const p = partes(t, zona);
    const desfase = Date.parse(`${p.dia}T${String(p.hora).padStart(2, '0')}:00:00Z`) - Date.parse(`${dia}T00:00:00Z`);
    if (!desfase) break;
    t -= desfase;
  }
  return t;
}

/**
 * Los días del período: «dia» (esa fecha), «semana» (los 7 días que terminan en esa fecha) o «mes» (el mes de esa
 * fecha, hasta hoy si es el mes actual). → {periodo, dias[], desde, hasta (ms, sin incluir)}.
 */
export function rango(periodo, fecha, zona, now = Date.now()) {
  const hoy = diaLocal(now, zona);
  let fin = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha ?? '')) && !Number.isNaN(Date.parse(`${fecha}T12:00:00Z`)) ? fecha : hoy;
  if (fin > hoy) fin = hoy;
  let dias;
  if (periodo === 'semana') dias = Array.from({ length: 7 }, (_, i) => sumarDias(fin, i - 6));
  else if (periodo === 'mes') {
    const primero = `${fin.slice(0, 7)}-01`;
    const ultimo = sumarDias(`${sumarDias(primero, 32).slice(0, 7)}-01`, -1);
    const hasta = ultimo < hoy ? ultimo : hoy;
    dias = [];
    for (let d = primero; d <= hasta; d = sumarDias(d, 1)) dias.push(d);
  } else dias = [fin];
  return { periodo: ['semana', 'mes'].includes(periodo) ? periodo : 'dia', dias, desde: inicioDelDia(dias[0], zona), hasta: inicioDelDia(sumarDias(dias.at(-1), 1), zona) };
}

const ESTADOS_CAIDOS = ['rechazado', 'cancelado', 'vencido'];

/**
 * El reporte. `metricas`: [{dia, mensajes, horas[24], canales{wa, ig}, charlas, pases, seguimientos, audios}] del
 * Durable Object; `uso`: [{dia, n}] respuestas de la IA; `datos`: {pedidos, productos, consultas} de la base del negocio.
 */
export function armarReporte({ negocio, periodo, fecha, zona, now = Date.now(), metricas = [], uso = [], datos = {} }) {
  const r = rango(periodo, fecha, zona, now);
  const z = zonaValida(zona);
  const enRango = (dia) => dia >= r.dias[0] && dia <= r.dias.at(-1);
  const porDia = Object.fromEntries(r.dias.map((d) => [d, { dia: d, mensajes: 0, charlas: 0, respuestas: 0, consultas: 0, pedidos: 0, vendido: 0, comentarios: 0 }]));
  const porHora = Array(24).fill(0);
  const porSemana = Array(7).fill(0);
  const canales = { whatsapp: 0, instagram: 0 };
  const tot = { charlas: 0, mensajes: 0, respuestas: 0, pases: 0, seguimientos: 0, audios: 0, enviadosWa: 0, comentarios: 0 };

  for (const m of metricas) {
    if (!enRango(m.dia)) continue;
    const d = porDia[m.dia];
    d.mensajes += m.mensajes ?? 0;
    d.charlas += m.charlas ?? 0;
    d.comentarios += m.comentarios ?? 0;
    // ZL-160: «comentarios», los comentarios de Instagram que respondió el asistente.
    for (const k of ['charlas', 'mensajes', 'pases', 'seguimientos', 'audios', 'enviadosWa', 'comentarios']) tot[k] += m[k] ?? 0;
    (m.horas ?? []).forEach((n, h) => { if (h < 24) porHora[h] += n ?? 0; });
    porSemana[diaSemana(m.dia)] += m.mensajes ?? 0;
    canales.whatsapp += m.canales?.wa ?? 0;
    canales.instagram += m.canales?.ig ?? 0;
  }
  for (const u of uso) if (enRango(u.dia)) { porDia[u.dia].respuestas += u.n; tot.respuestas += u.n; }

  const pedidos = (datos.pedidos ?? []).filter((p) => p.creado >= r.desde && p.creado < r.hasta);
  const validos = pedidos.filter((p) => !ESTADOS_CAIDOS.includes(p.estado));
  for (const p of validos) { const d = porDia[diaLocal(p.creado, z)]; if (d) { d.pedidos++; if (p.estado === 'entregado') d.vendido += p.total ?? 0; } }
  const consultas = (datos.consultas ?? []).filter((c) => c.creado >= r.desde && c.creado < r.hasta);
  for (const c of consultas) { const d = porDia[diaLocal(c.creado, z)]; if (d) d.consultas++; }
  const redondo = (n) => Math.round(n * 100) / 100;
  const entregados = validos.filter((p) => p.estado === 'entregado');

  const top = (arr, n) => arr.map((v, i) => [i, v]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([i]) => i);
  return {
    negocio, periodo: r.periodo, desde: r.dias[0], hasta: r.dias.at(-1), zona: z, generado: now,
    resumen: {
      ...tot,
      consultas: consultas.length,
      ganadas: consultas.filter((c) => c.estado === 'ganada').length,
      perdidas: consultas.filter((c) => c.estado === 'perdida').length,
      pasesAlEquipo: consultas.filter((c) => c.tipo === 'persona').length,
      pedidos: validos.length,
      entregados: entregados.length,
      caidos: pedidos.length - validos.length,
      vendido: redondo(entregados.reduce((a, p) => a + (p.total ?? 0), 0)),
      ticketPromedio: entregados.length ? redondo(entregados.reduce((a, p) => a + (p.total ?? 0), 0) / entregados.length) : 0,
      canales,
    },
    porDia: Object.values(porDia).map((d) => ({ ...d, vendido: redondo(d.vendido) })),
    porHora,
    porDiaSemana: porSemana,
    horasPico: top(porHora, 3),
    diasPico: top(porSemana, 2).map((i) => DIAS_SEMANA[i]),
    productos: (datos.productos ?? []).slice(0, 20).map((p) => ({ nombre: p.nombre, unidades: p.unidades, monto: redondo(p.monto ?? 0) })),
    consultasLista: consultas.slice(0, 500).map((c) => ({ numero: c.numero, fecha: diaLocal(c.creado, z), tipo: c.tipo, estado: c.estado, canal: c.canal, nombre: c.nombre, resumen: c.resumen })),
    pedidosLista: pedidos.slice(0, 1000).map((p) => ({ numero: p.numero, fecha: diaLocal(p.creado, z), estado: p.estado, canal: p.canal, total: p.total, nombre: p.nombre ?? '', entrega: p.entrega ?? '', productos: p.productos ?? '' })),
  };
}

// ───────────────────────── Excel (.xlsx) ─────────────────────────

const enc = new TextEncoder();
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const unir = (partes) => {
  const out = new Uint8Array(partes.reduce((a, p) => a + p.length, 0));
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
};

/** Un zip sin comprimir (método «store»): lo que necesita un .xlsx. archivos: [{nombre, texto}]. */
export function zip(archivos) {
  const partes = [];
  const central = [];
  let off = 0;
  for (const a of archivos) {
    const nombre = enc.encode(a.nombre);
    const datos = enc.encode(a.texto);
    const crc = crc32(datos);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, datos.length, true);
    lh.setUint32(22, datos.length, true); lh.setUint16(26, nombre.length, true); lh.setUint16(28, 0, true);
    partes.push(new Uint8Array(lh.buffer), nombre, datos);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, datos.length, true); ch.setUint32(24, datos.length, true); ch.setUint16(28, nombre.length, true);
    ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nombre);
    off += 30 + nombre.length + datos.length;
  }
  const tam = central.reduce((a, p) => a + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tam, true); fin.setUint32(16, off, true);
  return unir([...partes, ...central, new Uint8Array(fin.buffer)]);
}

const xml = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/** Una hoja: filas de celdas (número o texto). La primera fila va en negrita (estilo 1); `anchos` en caracteres. */
function hoja(filas, anchos = []) {
  const rows = filas.map((fila, r) => `<row r="${r + 1}">${fila.map((v, c) => {
    const ref = `${col(c)}${r + 1}`;
    const s = r === 0 || (fila.length === 1 && r > 0 && typeof v === 'string' && v.endsWith(':')) ? ' s="1"' : '';
    // Los textos van como texto («inlineStr»): Excel nunca los toma como fórmula, aunque empiecen con «=».
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const cols = anchos.length ? `<cols>${anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

const ESTADO = { nueva: 'Nueva', atendiendo: 'Atendiendo', ganada: 'Ganada', perdida: 'Perdida', resuelta: 'Resuelta', pendiente: 'Nuevo', aceptado: 'Aceptado', pagado: 'Pagado', entregado: 'Entregado', rechazado: 'Rechazado', cancelado: 'Cancelado', vencido: 'Vencido' };
const CANAL = { wa: 'WhatsApp', ig: 'Instagram' };
const NOMBRE_PERIODO = { dia: 'Día', semana: 'Semana', mes: 'Mes' };

/** El Excel del reporte: Resumen, Por día, Por hora, Por día de la semana, Productos, Consultas, Pedidos. */
export function xlsx(r) {
  const s = r.resumen;
  const f = (dia) => String(dia ?? '').split('-').reverse().join('/');
  const hojas = [
    ['Resumen', hoja([
      [`Reporte de ${r.negocio}`, ''],
      ['Período', `${NOMBRE_PERIODO[r.periodo]}: ${r.desde === r.hasta ? f(r.desde) : `${f(r.desde)} al ${f(r.hasta)}`}`],
      ['Zona horaria', r.zona],
      ['', ''],
      ['Charlas atendidas', s.charlas],
      ['Mensajes recibidos', s.mensajes],
      ['Respuestas del asistente', s.respuestas],
      ['Mensajes por WhatsApp', s.canales.whatsapp],
      ['Mensajes por Instagram', s.canales.instagram],
      ['Consultas', s.consultas],
      ['Consultas ganadas', s.ganadas],
      ['Consultas perdidas', s.perdidas],
      ['Pases al equipo', s.pasesAlEquipo],
      ['Pedidos', s.pedidos],
      ['Pedidos entregados', s.entregados],
      ['Pedidos cancelados o vencidos', s.caidos],
      ['Vendido (entregados)', s.vendido],
      ['Ticket promedio', s.ticketPromedio],
      ['Recordatorios enviados', s.seguimientos],
      ['Mensajes enviados por WhatsApp', s.enviadosWa],
      ['Comentarios de Instagram respondidos', s.comentarios],
      ['Audios recibidos', s.audios],
      ['Horas con más mensajes', r.horasPico.map((h) => `${h}:00`).join(', ') || '-'],
      ['Días con más mensajes', r.diasPico.join(', ') || '-'],
    ], [34, 30])],
    ['Por día', hoja([['Día', 'Mensajes', 'Charlas', 'Respuestas', 'Consultas', 'Pedidos', 'Vendido', 'Comentarios'], ...r.porDia.map((d) => [f(d.dia), d.mensajes, d.charlas, d.respuestas, d.consultas, d.pedidos, d.vendido, d.comentarios])], [12, 10, 10, 11, 10, 9, 12, 12])],
    ['Por hora', hoja([['Hora', 'Mensajes'], ...r.porHora.map((n, h) => [`${String(h).padStart(2, '0')}:00`, n])], [10, 10])],
    ['Por día de la semana', hoja([['Día', 'Mensajes'], ...r.porDiaSemana.map((n, i) => [DIAS_SEMANA[i], n])], [12, 10])],
    ['Productos', hoja([['Producto', 'Unidades', 'Monto'], ...r.productos.map((p) => [p.nombre, p.unidades, p.monto])], [36, 10, 12])],
    ['Consultas', hoja([['N.º', 'Fecha', 'Tipo', 'Estado', 'Canal', 'Nombre', 'Resumen'], ...r.consultasLista.map((c) => [c.numero, f(c.fecha), c.tipo === 'persona' ? 'Pase al equipo' : 'Quiere avanzar', ESTADO[c.estado] ?? c.estado, CANAL[c.canal] ?? c.canal, c.nombre, c.resumen])], [6, 12, 16, 12, 11, 20, 60])],
    // ZL-159: con quién compró, cómo se entrega y qué llevó (la dirección no va al Excel).
    ['Pedidos', hoja([['N.º', 'Fecha', 'Estado', 'Canal', 'Comprador', 'Entrega', 'Productos', 'Total'], ...r.pedidosLista.map((p) => [p.numero, f(p.fecha), ESTADO[p.estado] ?? p.estado, CANAL[p.canal] ?? p.canal, p.nombre ?? '', p.entrega === 'envio' ? 'Envío' : p.entrega === 'retiro' ? 'Retiro' : '', p.productos ?? '', p.total ?? ''])], [6, 12, 12, 11, 20, 9, 48, 12])],
  ];
  const ns = 'http://schemas.openxmlformats.org';
  return zip([
    { nombre: '[Content_Types].xml', texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { nombre: '_rels/.rels', texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { nombre: 'xl/workbook.xml', texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets>${hojas.map(([n], i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { nombre: 'xl/_rels/workbook.xml.rels', texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${ns}/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${hojas.length + 1}" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { nombre: 'xl/styles.xml', texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="${ns}/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...hojas.map(([, texto], i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, texto })),
  ]);
}
