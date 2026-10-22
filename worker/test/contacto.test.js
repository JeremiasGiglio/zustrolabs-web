// Tests del Worker de contacto: `node --test worker/test/` (no necesita Cloudflare ni internet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearHandler, validar, armarMime, unaLinea, claveIp, cabeceraUtf8, LIMITES } from '../src/contacto.js';

const ENV = {
  ORIGENES: 'https://zustrolabs.com,https://www.zustrolabs.com',
  REMITENTE: 'web@avisos.zustrolabs.com',
  DESTINO: 'destino-verificado@example.com',
};
const BUENO = { nombre: 'Lucía Benítez', email: 'lucia@example.com', telefono: '', tema: 'Sitio web', mensaje: 'Hola,\nquiero una web.', pagina: '/', idioma: 'es', web: '', t: 8000 };

function armar({ falla = false, limite = true } = {}) {
  const enviados = [];
  const logs = [];
  const handler = crearHandler({
    enviar: async (mime, dirs) => { if (falla) throw new TypeError('no'); enviados.push({ mime, dirs }); },
    log: (o) => logs.push(o),
    ahora: () => new Date('2026-10-16T12:00:00Z'),
    uuid: () => 'id-fijo',
  });
  // Límite simulado como el de Cloudflare: cuenta por clave, con su tope.
  const limitador = (tope) => ({ claves: [], cuenta: new Map(), async limit({ key }) { this.claves.push(key); const n = (this.cuenta.get(key) || 0) + 1; this.cuenta.set(key, n); return { success: n <= tope }; } });
  const env = { ...ENV, LIMITE: limitador(limite ? 5 : Infinity), LIMITE_GLOBAL: limitador(limite ? 30 : Infinity) };
  return { handler, enviados, logs, env };
}

function pedido(cuerpo, { origen = 'https://zustrolabs.com', tipo = 'application/json', metodo = 'POST', ip = '203.0.113.7' } = {}) {
  const headers = { 'CF-Connecting-IP': ip };
  if (origen) headers.Origin = origen;
  if (tipo) headers['Content-Type'] = tipo;
  const body = metodo === 'GET' ? undefined : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
  return new Request('https://zustrolabs.com/api/contacto', { method: metodo, headers, body });
}

function decodificarCuerpo(mime) {
  const b64 = mime.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

test('una consulta válida manda un correo al destino del secreto, con Reply-To de la persona', async () => {
  const { handler, enviados, env } = armar();
  const r = await handler(pedido(BUENO), env);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.equal(enviados.length, 1);
  assert.deepEqual(enviados[0].dirs, { de: 'web@avisos.zustrolabs.com', para: 'destino-verificado@example.com' });
  const { mime } = enviados[0];
  assert.match(mime, /^From: =\?UTF-8\?B\?[^?]+\?= <web@zustrolabs\.com>\r\n/);
  assert.match(mime, /\r\nTo: <destino-verificado@example\.com>\r\n/);
  assert.match(mime, /\r\nReply-To: <lucia@example\.com>\r\n/);
  assert.match(mime, /\r\nMessage-ID: <id-fijo@zustrolabs\.com>\r\n/);
  const cuerpo = decodificarCuerpo(mime);
  assert.match(cuerpo, /Nombre: Lucía Benítez/);
  assert.match(cuerpo, /Hola,\r?\nquiero una web\./);
});

test('acepta www.zustrolabs.com y solo teléfono, sin Reply-To', async () => {
  const { handler, enviados, env } = armar();
  const r = await handler(pedido({ ...BUENO, email: '', telefono: '+54 9 341 000-0000' }, { origen: 'https://www.zustrolabs.com' }), env);
  assert.equal(r.status, 200);
  assert.doesNotMatch(enviados[0].mime, /Reply-To/);
});

test('solo POST: GET y otros métodos dan 405', async () => {
  const { handler, enviados, env } = armar();
  for (const metodo of ['GET', 'PUT', 'DELETE']) {
    const r = await handler(pedido(BUENO, { metodo }), env);
    assert.equal(r.status, 405, metodo);
    assert.equal(r.headers.get('Allow'), 'POST');
  }
  assert.equal(enviados.length, 0);
});

test('rechaza otros orígenes y pedidos sin Origin (otro sitio no puede usar el formulario)', async () => {
  const { handler, enviados, env } = armar();
  for (const origen of ['https://evil.example', 'http://zustrolabs.com', 'https://zustrolabs.com.evil.example', 'null', '']) {
    const r = await handler(pedido(BUENO, { origen }), env);
    assert.equal(r.status, 403, `origen ${origen || '(vacío)'}`);
  }
  assert.equal(enviados.length, 0);
});

test('exige JSON: formularios clásicos y texto dan 415', async () => {
  const { handler, env } = armar();
  for (const tipo of ['application/x-www-form-urlencoded', 'text/plain', 'multipart/form-data', '']) {
    const r = await handler(pedido('nombre=x', { tipo }), env);
    assert.equal(r.status, 415, tipo || '(sin tipo)');
  }
});

test('cuerpos de más de 8 KB dan 413, aunque no declaren el largo', async () => {
  const { handler, enviados, env } = armar();
  const r = await handler(pedido({ ...BUENO, relleno: 'x'.repeat(LIMITES.cuerpoBytes + 10) }), env);
  assert.equal(r.status, 413);
  assert.equal(enviados.length, 0);
});

test('JSON roto, listas y valores sueltos dan 400', async () => {
  const { handler, env } = armar();
  for (const cuerpo of ['{', '[]', '"hola"', 'null', '42']) {
    const r = await handler(pedido(cuerpo), env);
    assert.equal(r.status, 400, cuerpo);
  }
});

test('campo trampa lleno o envío demasiado rápido: responde ok y no manda nada', async () => {
  const { handler, enviados, logs, env } = armar();
  for (const extra of [{ web: 'https://spam.example' }, { t: 300 }, { t: 'rapido' }, { t: undefined }]) {
    const r = await handler(pedido({ ...BUENO, ...extra }), env);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
  }
  assert.equal(enviados.length, 0);
  assert.ok(logs.every((l) => l.resultado === 'bot'));
});

test('valida los campos y explica cuál falta', async () => {
  const { handler, enviados, env } = armar({ limite: false });
  const casos = [
    [{ nombre: '   ' }, 'nombre'],
    [{ email: '', telefono: '' }, 'contacto'],
    [{ email: 'no-es-un-correo' }, 'email'],
    [{ email: 'a@b' }, 'email'],
    [{ email: 'x'.repeat(250) + '@example.com' }, 'email'],
    [{ email: '', telefono: 'llamame' }, 'telefono'],
    [{ mensaje: '' }, 'mensaje'],
    [{ mensaje: 'x'.repeat(LIMITES.mensaje * 2 + 1) }, 'mensaje'],
    [{ nombre: 42 }, 'formato'],
    [{ mensaje: ['a'] }, 'formato'],
  ];
  for (const [cambio, campo] of casos) {
    const r = await handler(pedido({ ...BUENO, ...cambio }), env);
    assert.equal(r.status, 422, JSON.stringify(cambio));
    assert.deepEqual(await r.json(), { ok: false, error: campo });
  }
  assert.equal(enviados.length, 0);
});

test('inyección de cabeceras: un salto de línea en el correo se rechaza', async () => {
  const { handler, enviados, env } = armar();
  for (const email of ['lucia@example.com\r\nBcc: victima@example.com', 'lucia@example.com\nBcc: x@example.com', 'lucia@example.com>\r\nBcc: <x@example.com']) {
    const r = await handler(pedido({ ...BUENO, email }), env);
    assert.equal(r.status, 422);
  }
  assert.equal(enviados.length, 0);
});

test('inyección de cabeceras: saltos en nombre y tema no llegan a las cabeceras', async () => {
  const { handler, enviados, env } = armar();
  const r = await handler(pedido({ ...BUENO, nombre: 'Lucía\r\nBcc: victima@example.com', tema: 'Web\nX-Spam: 1' }), env);
  assert.equal(r.status, 200);
  // se despliegan los pliegues (CRLF + espacio) antes de leer las cabeceras
  const [crudas] = enviados[0].mime.split('\r\n\r\n');
  const cabeceras = crudas.replace(/\r\n /g, ' ');
  const nombres = cabeceras.split('\r\n').map((l) => l.split(':')[0]);
  // y el asunto decodificado tampoco trae saltos: los limpia la validación, no solo la codificación
  const asunto = cabeceras.match(/^Subject: (.*)$/m)[1].split(' ').map((p) => new TextDecoder().decode(Uint8Array.from(atob(p.slice(10, -2)), (c) => c.charCodeAt(0)))).join('');
  assert.doesNotMatch(asunto, /[\r\n]/);
  assert.match(asunto, /Lucía Bcc: victima@example\.com/);
  assert.deepEqual(nombres, ['From', 'To', 'Reply-To', 'Subject', 'Date', 'Message-ID', 'MIME-Version', 'Content-Type', 'Content-Transfer-Encoding']);
  assert.doesNotMatch(cabeceras, /Bcc|X-Spam/i);
});

test('HTML y scripts del visitante viajan como texto plano, nunca como HTML', async () => {
  const { handler, enviados, env } = armar();
  const mensaje = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  await handler(pedido({ ...BUENO, mensaje }), env);
  assert.match(enviados[0].mime, /Content-Type: text\/plain; charset=UTF-8/);
  assert.ok(decodificarCuerpo(enviados[0].mime).includes(mensaje));
});

test('límite por IP: el sexto envío del minuto da 429, y otra IP sigue pudiendo', async () => {
  const { handler, enviados, env } = armar();
  const estados = [];
  for (let i = 0; i < 6; i++) estados.push((await handler(pedido(BUENO), env)).status);
  assert.deepEqual(estados, [200, 200, 200, 200, 200, 429]);
  assert.equal(enviados.length, 5);
  assert.ok(env.LIMITE.claves.every((k) => k === '203.0.113.7'), 'la clave es la IP del visitante');
  assert.equal((await handler(pedido(BUENO, { ip: '198.51.100.9' }), env)).status, 200);
});

test('límite por IPv6: todas las direcciones del mismo /64 comparten el contador', async () => {
  const { handler, env } = armar();
  const estados = [];
  for (let i = 1; i <= 6; i++) estados.push((await handler(pedido(BUENO, { ip: `2001:db8:abcd:12::${i.toString(16)}` }), env)).status);
  assert.deepEqual(estados, [200, 200, 200, 200, 200, 429]);
  assert.equal((await handler(pedido(BUENO, { ip: '2001:db8:abcd:13::1' }), env)).status, 200);
});

test('límite global: 30 por minuto en total, aunque cambien las IP', async () => {
  const { handler, enviados, env } = armar();
  let ultimo = 0;
  for (let i = 0; i < 31; i++) ultimo = (await handler(pedido(BUENO, { ip: `198.51.100.${i}` }), env)).status;
  assert.equal(ultimo, 429);
  assert.equal(enviados.length, 30);
});

test('si el límite de Cloudflare falla, no manda nada (503)', async () => {
  const { handler, enviados, env } = armar();
  env.LIMITE.limit = async () => { throw new Error('caído'); };
  const r = await handler(pedido(BUENO), env);
  assert.equal(r.status, 503);
  assert.equal(enviados.length, 0);
});

test('si Email Routing falla da 502, y el log no lleva datos de la persona', async () => {
  const { handler, logs, env } = armar({ falla: true });
  const r = await handler(pedido(BUENO), env);
  assert.equal(r.status, 502);
  const todo = JSON.stringify(logs);
  for (const dato of ['Lucía', 'lucia@example.com', 'quiero una web', '203.0.113.7']) assert.ok(!todo.includes(dato), dato);
});

test('ningún log lleva datos personales, ni en el caso feliz', async () => {
  const { handler, logs, env } = armar();
  await handler(pedido(BUENO), env);
  await handler(pedido({ ...BUENO, email: 'malo' }), env);
  const todo = JSON.stringify(logs);
  for (const dato of ['Lucía', 'lucia@example.com', 'malo', 'quiero una web', '203.0.113.7']) assert.ok(!todo.includes(dato), dato);
});

test('sin el secreto DESTINO no intenta mandar (500 de configuración)', async () => {
  const { handler, enviados, env } = armar();
  const r = await handler(pedido(BUENO), { ...env, DESTINO: '' });
  assert.equal(r.status, 500);
  assert.equal(enviados.length, 0);
});

test('sin los bindings de límite no manda nada: falla cerrado (500)', async () => {
  const { handler, enviados, env } = armar();
  for (const falta of ['LIMITE', 'LIMITE_GLOBAL']) {
    const r = await handler(pedido(BUENO), { ...env, [falta]: undefined });
    assert.equal(r.status, 500, falta);
  }
  assert.equal(enviados.length, 0);
});

test('el correo, que va sin codificar al Reply-To, solo acepta ASCII seguro', async () => {
  const { handler, enviados, env } = armar({ limite: false });
  for (const email of ['a\u0000b@example.com', 'lucía@example.com', 'a\u202Eb@example.com', 'a\u0085b@example.com', 'a b@example.com', '"x"@example.com', 'a..b@example.com', '.a@example.com']) {
    const r = await handler(pedido({ ...BUENO, email }), env);
    assert.equal(r.status, 422, JSON.stringify(email));
  }
  assert.equal(enviados.length, 0);
  for (const email of ['lucia.benitez+web@example.com', "o'brien@example.co.uk", 'x_y-z@sub.example.com.ar']) {
    assert.equal((await handler(pedido({ ...BUENO, email }), env)).status, 200, email);
  }
});

test('el asunto se parte en palabras codificadas de 75 caracteres como máximo, sin romper letras', () => {
  const largo = '東京のクリニック予約システムについて相談したいです'.repeat(4);
  const h = cabeceraUtf8(largo);
  const palabras = h.split('\r\n ');
  assert.ok(palabras.length > 1);
  for (const p of palabras) { assert.match(p, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/); assert.ok(p.length <= 75, `${p.length}`); }
  const texto = palabras.map((p) => new TextDecoder().decode(Uint8Array.from(atob(p.slice(10, -2)), (c) => c.charCodeAt(0)))).join('');
  assert.equal(texto, largo.slice(0, 200));
});

test('claveIp agrupa IPv6 por /64 y deja IPv4 como está', () => {
  assert.equal(claveIp('203.0.113.7'), '203.0.113.7');
  assert.equal(claveIp('2001:db8:abcd:12::1'), '2001:db8:abcd:12::/64');
  assert.equal(claveIp('2001:0db8:abcd:0012:ffff:0:0:1'), '2001:db8:abcd:12::/64');
  assert.equal(claveIp('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(claveIp(null), 'sin-ip');
});

test('unaLinea saca saltos y caracteres de control, y corta al largo máximo', () => {
  assert.equal(unaLinea('a\r\nb\u0000c\u2028d', 100), 'a b c d');
  assert.equal(unaLinea('x'.repeat(10), 4), 'xxxx');
  assert.equal(unaLinea(undefined, 4), '');
});

test('validar ignora campos desconocidos y normaliza idioma y página', () => {
  const v = validar({ ...BUENO, idioma: 'xx', pagina: '/../<script>', admin: true });
  assert.equal(v.ok, true);
  assert.equal(v.datos.idioma, 'es');
  assert.equal(v.datos.pagina, '/');
  assert.equal('admin' in v.datos, false);
});

test('el MIME es válido: CRLF, base64 en líneas de 76 y asunto codificado', () => {
  const mime = armarMime({ de: 'web@avisos.zustrolabs.com', para: 'd@example.com', datos: validar(BUENO).datos, fecha: new Date('2026-10-16T12:00:00Z'), id: 'x' });
  assert.ok(!/[^\r]\n/.test(mime), 'todos los saltos son CRLF');
  const [, cuerpo] = mime.split('\r\n\r\n');
  for (const linea of cuerpo.trim().split('\r\n')) assert.ok(linea.length <= 76);
  assert.match(mime, /\r\nSubject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/);
  assert.match(mime, /\r\nDate: Fri, 16 Oct 2026 12:00:00 \+0000\r\n/);
});
