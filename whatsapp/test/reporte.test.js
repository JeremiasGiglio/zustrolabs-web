// Reportes (ZL-152): períodos con la hora del negocio, cuentas del reporte y el Excel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armarReporte, diaLocal, horaLocal, inicioDelDia, rango, xlsx } from '../src/reporte.js';

const AR = 'America/Argentina/Buenos_Aires';
// Miércoles 18/11/2026 a las 22:30 en Argentina (01:30 UTC del 19).
const NOW = Date.parse('2026-11-19T01:30:00Z');

test('hora del negocio: el día y la hora se cuentan en su zona, no en UTC', () => {
  assert.equal(diaLocal(NOW, AR), '2026-11-18');
  assert.equal(horaLocal(NOW, AR), 22);
  assert.equal(diaLocal(NOW, 'Europe/Zagreb'), '2026-11-19');
  assert.equal(inicioDelDia('2026-11-18', AR), Date.parse('2026-11-18T03:00:00Z'));
  assert.equal(diaLocal(NOW, 'Zona/Inventada'), '2026-11-18', 'una zona desconocida usa Argentina');
});

test('períodos: día, los 7 días hasta la fecha, y el mes hasta hoy; una fecha futura se corta en hoy', () => {
  assert.deepEqual(rango('dia', '2026-11-10', AR, NOW).dias, ['2026-11-10']);
  const s = rango('semana', '', AR, NOW);
  assert.deepEqual([s.dias[0], s.dias.at(-1), s.dias.length], ['2026-11-12', '2026-11-18', 7]);
  assert.equal(s.desde, Date.parse('2026-11-12T03:00:00Z'));
  assert.equal(s.hasta, Date.parse('2026-11-19T03:00:00Z'));
  const m = rango('mes', '2026-11-05', AR, NOW);
  assert.deepEqual([m.dias[0], m.dias.at(-1)], ['2026-11-01', '2026-11-18']);
  assert.equal(rango('mes', '2026-10-15', AR, NOW).dias.length, 31);
  assert.deepEqual(rango('dia', '2030-01-01', AR, NOW).dias, ['2026-11-18']);
  assert.equal(rango('cualquiera', '', AR, NOW).periodo, 'dia');
});

test('reporte: suma mensajes por hora y día de la semana, pedidos válidos, lo vendido y lo que más compran', () => {
  const horas = Array(24).fill(0);
  horas[19] = 5; horas[20] = 3; horas[10] = 1;
  const r = armarReporte({
    negocio: 'Panadería La Espiga', periodo: 'semana', fecha: '', zona: AR, now: NOW,
    metricas: [
      { dia: '2026-11-17', mensajes: 9, charlas: 4, horas, canales: { wa: 6, ig: 3 }, pases: 1 },
      { dia: '2026-11-01', mensajes: 99, charlas: 99 },
    ],
    uso: [{ dia: '2026-11-17', n: 7 }],
    datos: {
      pedidos: [
        { numero: 1, creado: Date.parse('2026-11-17T22:00:00Z'), estado: 'entregado', total: 5000, canal: 'wa' },
        { numero: 2, creado: Date.parse('2026-11-18T14:00:00Z'), estado: 'aceptado', total: 2500, canal: 'ig' },
        { numero: 3, creado: Date.parse('2026-11-18T15:00:00Z'), estado: 'vencido', total: 900, canal: 'wa' },
      ],
      productos: [{ nombre: 'Pan francés', unidades: 3, monto: 7500 }],
      consultas: [{ numero: 1, creado: Date.parse('2026-11-16T20:00:00Z'), estado: 'ganada', tipo: 'consulta', canal: 'wa', nombre: 'Ana', resumen: 'Torta (ficticio)' }],
    },
  });
  assert.deepEqual([r.desde, r.hasta], ['2026-11-12', '2026-11-18']);
  const s = r.resumen;
  assert.deepEqual([s.mensajes, s.charlas, s.respuestas, s.pedidos, s.entregados, s.caidos, s.vendido, s.ticketPromedio, s.consultas, s.ganadas], [9, 4, 7, 2, 1, 1, 5000, 5000, 1, 1]);
  assert.deepEqual(s.canales, { whatsapp: 6, instagram: 3 });
  assert.deepEqual(r.horasPico, [19, 20, 10]);
  assert.equal(r.porDiaSemana[1], 9, 'el 17/11/2026 es martes');
  assert.deepEqual(r.diasPico, ['Martes']);
  assert.equal(r.porDia.find((d) => d.dia === '2026-11-17').vendido, 5000);
  assert.equal(r.productos[0].nombre, 'Pan francés');
});

test('Excel: un .xlsx de verdad (zip con las 7 hojas); un texto que empieza con «=» no se vuelve fórmula', () => {
  const r = armarReporte({ negocio: '=HYPERLINK("http://malo.example.com") & <Ficticio>', periodo: 'dia', fecha: '', zona: AR, now: NOW, datos: { productos: [{ nombre: '=1+1', unidades: 2, monto: 10 }] } });
  const z = xlsx(r);
  assert.deepEqual([...z.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'empieza como un zip');
  const texto = new TextDecoder().decode(z);
  for (const n of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet7.xml']) assert.ok(texto.includes(n), n);
  for (const h of ['Resumen', 'Por día', 'Por hora', 'Por día de la semana', 'Productos', 'Consultas', 'Pedidos']) assert.ok(texto.includes(`name="${h}"`), h);
  assert.match(texto, /t="inlineStr"[^>]*><is><t xml:space="preserve">=1\+1<\/t>/, 'como texto');
  assert.ok(texto.includes('&lt;Ficticio&gt;'));
  assert.doesNotMatch(texto, /<f>/, 'ninguna fórmula');
});
