// Lector de planillas para la app de negocios (ZL-121): .xlsx (Excel, LibreOffice, Google Sheets descargado) y .csv,
// en el navegador, sin librerías de terceros: el archivo nunca sale de la computadora hasta que se confirma.
// Las funciones son autocontenidas porque la app las manda al navegador tal cual (negocios-ui.js usa su .toString());
// por eso no usan nada de afuera de sí mismas salvo entre ellas. Se prueban con node (test/lector.test.js).

/** CSV con «;», «,» o tabulador (se adivina por la primera línea), comillas y saltos de línea dentro de comillas. */
function leerCsv(texto) {
  const t = String(texto).replace(/^﻿/, '');
  const primera = t.split(/\r?\n/)[0] || '';
  const cuenta = (c) => primera.split(c).length - 1;
  const sep = [';', ',', '\t'].sort((a, b) => cuenta(b) - cuenta(a))[0];
  const filas = [];
  let fila = [];
  let celda = '';
  let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (comillas) {
      if (ch === '"' && t[i + 1] === '"') { celda += '"'; i++; }
      else if (ch === '"') comillas = false;
      else celda += ch;
    } else if (ch === '"' && celda === '') comillas = true;
    else if (ch === sep) { fila.push(celda); celda = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      fila.push(celda); filas.push(fila); fila = []; celda = '';
    } else celda += ch;
  }
  if (celda !== '' || fila.length) { fila.push(celda); filas.push(fila); }
  return filas
    .map((f, i) => Object.assign(f.map((c) => ({ v: c, n: false })), { num: i + 1 }))
    .filter((f) => f.some((c) => String(c.v).trim() !== ''));
}

/** Descomprime una entrada «deflate» de un zip (el formato de los .xlsx) con lo que trae el navegador. */
async function inflar(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const flujo = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

/** Lee las entradas de un zip: {nombre → Uint8Array}. Solo las que pide `quiero(nombre)`. */
async function leerZip(buffer, quiero) {
  const b = new Uint8Array(buffer);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let fin = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error('no es un archivo .xlsx válido');
  const total = dv.getUint16(fin + 10, true);
  let p = dv.getUint32(fin + 16, true);
  const out = {};
  const dec = new TextDecoder();
  for (let k = 0; k < total; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('el .xlsx está dañado');
    const metodo = dv.getUint16(p + 10, true);
    const comprimido = dv.getUint32(p + 20, true);
    const largoNombre = dv.getUint16(p + 28, true);
    const largoExtra = dv.getUint16(p + 30, true);
    const largoComentario = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const nombre = dec.decode(b.subarray(p + 46, p + 46 + largoNombre));
    p += 46 + largoNombre + largoExtra + largoComentario;
    if (!quiero(nombre)) continue;
    const ln = dv.getUint16(local + 26, true);
    const le = dv.getUint16(local + 28, true);
    const datos = b.subarray(local + 30 + ln + le, local + 30 + ln + le + comprimido);
    if (metodo === 0) out[nombre] = datos;
    else if (metodo === 8) out[nombre] = await inflar(datos);
    else throw new Error('compresión de .xlsx no soportada');
  }
  return out;
}

/** Desarma el XML de un .xlsx con expresiones (sin DOM, para que ande igual en el navegador y en las pruebas). */
function textoXml(s) {
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** Primera hoja de un .xlsx → filas de celdas {v: texto, n: true si Excel la guardó como número}. */
async function leerXlsx(buffer) {
  const dec = new TextDecoder();
  const base = await leerZip(buffer, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml');
  if (!base['xl/workbook.xml']) throw new Error('no es un archivo .xlsx válido (¿es un .xls viejo? guardalo como .xlsx o .csv)');
  const libro = dec.decode(base['xl/workbook.xml']);
  const relHoja = (/<sheet\b[^>]*\br:id="([^"]+)"/.exec(libro) || /<sheet\b[^>]*\bid="([^"]+)"/.exec(libro) || [])[1];
  const rels = base['xl/_rels/workbook.xml.rels'] ? dec.decode(base['xl/_rels/workbook.xml.rels']) : '';
  let destino = 'worksheets/sheet1.xml';
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    if (new RegExp(`\\bId="${relHoja}"`).test(m[1])) destino = (/\bTarget="([^"]+)"/.exec(m[1]) || [])[1] || destino;
  }
  const ruta = destino.startsWith('/') ? destino.slice(1) : `xl/${destino.replace(/^\.\//, '')}`;
  const hojaBytes = (await leerZip(buffer, (n) => n === ruta))[ruta];
  if (!hojaBytes) throw new Error('el .xlsx no tiene hojas');
  const compartidos = [];
  if (base['xl/sharedStrings.xml']) {
    for (const si of dec.decode(base['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      compartidos.push([...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => textoXml(t[1])).join(''));
    }
  }
  const hoja = dec.decode(hojaBytes);
  const col = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  const filas = [];
  for (const row of hoja.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const fila = [];
    fila.num = Number((/\br="(\d+)"/.exec(row[1]) || [])[1]) || filas.length + 1;
    for (const c of row[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = (/\br="([A-Z]+\d+)"/.exec(attrs) || [])[1];
      const tipo = (/\bt="([^"]+)"/.exec(attrs) || [])[1] || 'n';
      const dentro = c[2] || '';
      const v = (/<v>([\s\S]*?)<\/v>/.exec(dentro) || [])[1];
      let celda;
      if (tipo === 's') celda = { v: compartidos[Number(v)] ?? '', n: false };
      else if (tipo === 'inlineStr') celda = { v: [...dentro.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => textoXml(t[1])).join(''), n: false };
      else if (tipo === 'str' || tipo === 'e') celda = { v: textoXml(v ?? ''), n: false };
      else if (tipo === 'b') celda = { v: v === '1' ? 'sí' : 'no', n: false };
      else celda = { v: v === undefined ? '' : textoXml(v), n: v !== undefined };
      fila[ref ? col(ref) : fila.length] = celda;
    }
    for (let i = 0; i < fila.length; i++) if (!fila[i]) fila[i] = { v: '', n: false };
    if (fila.some((x) => String(x.v).trim() !== '')) filas.push(fila);
  }
  return filas;
}

/** Para cada columna, qué campo parece ser según el título. */
function adivinarColumnas(titulos) {
  const reglas = [
    ['codigo', /^(cod|codigo|sku|id|ref|referencia|art|articulo cod|cod art|cod barras|ean)$/],
    ['nombre', /^(nombre|producto|productos|articulo|item|descripcion corta|titulo|nombre del producto)$/],
    ['precio', /^(precio|precios|precio venta|precio de venta|pvp|precio final|importe|valor|precio unitario|\$)$/],
    ['stock', /^(stock|cantidad|cant|existencia|existencias|disponible|unidades|inventario|stock actual)$/],
    ['categoria', /^(categoria|rubro|familia|tipo|linea|seccion|grupo)$/],
    ['descripcion', /^(descripcion|detalle|detalles|observaciones|info)$/],
    ['unidad', /^(unidad|presentacion|medida|unidad de medida)$/],
    ['activo', /^(activo|estado|visible|publicado|disponible para venta)$/],
  ];
  const usados = new Set();
  return titulos.map((t) => {
    const n = String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9$ ]/g, ' ').replace(/\s+/g, ' ').trim();
    const r = reglas.find(([campo, re]) => !usados.has(campo) && re.test(n));
    if (!r) return '';
    usados.add(r[0]);
    return r[0];
  });
}

/** «$ 1.250,50», «1250.5», «1,250.50», «12 u.» → número; vacío → null; texto que no es número → NaN. */
function aNumero(celda) {
  if (celda && celda.n) return Number(celda.v);
  let s = String(celda && celda.v !== undefined ? celda.v : celda ?? '').trim();
  if (!s || /^[-–]$/.test(s)) return null;
  s = s.replace(/\s/g, '').replace(/^(?:\$|ar\$|usd|u\$s|€)/i, '').replace(/(?:u|un|unid|unidades|kg|g|\.)+$/i, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/**
 * Tabla leída + qué campo es cada columna → filas para el servidor y los problemas encontrados en el navegador.
 * La primera fila son los títulos.
 */
function filasAProductos(tabla, mapeo) {
  const out = [];
  const problemas = [];
  tabla.slice(1).forEach((f, i) => {
    const num = f.num || i + 2;
    const fila = { _fila: num };
    let algo = false;
    mapeo.forEach((campo, c) => {
      if (!campo) return;
      const celda = f[c] || { v: '', n: false };
      const v = String(celda.v ?? '').trim();
      if (v !== '') algo = true;
      if (campo === 'precio' || campo === 'stock') {
        const n = aNumero(celda);
        if (n === null) return;
        if (Number.isNaN(n)) { problemas.push({ fila: num, motivo: `«${v.slice(0, 30)}» no es un número (${campo})` }); fila[campo] = v; return; }
        fila[campo] = campo === 'stock' ? Math.round(n) : n;
      } else if (campo === 'activo') {
        if (v) fila.activo = !/^(no|0|false|falso|inactivo|pausado|oculto)$/i.test(v);
      } else if (v) fila[campo] = v;
    });
    if (algo) out.push(fila);
  });
  return { filas: out, problemas };
}

export const FUNCIONES_LECTOR = [leerCsv, inflar, leerZip, textoXml, leerXlsx, adivinarColumnas, aNumero, filasAProductos];
export { leerCsv, leerXlsx, adivinarColumnas, aNumero, filasAProductos };
