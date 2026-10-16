# Worker del formulario de contacto (`zustrolabs-contacto`)

Atiende `POST https://zustrolabs.com/api/contacto` (y `www.`). Recibe el JSON del formulario de la landing, lo valida y manda un correo con **Cloudflare Email Routing** (binding `send_email`) a la casilla del estudio. No usa servicios de terceros, no guarda nada y no tiene base de datos.

```
navegador ──POST JSON──▶ zustrolabs.com/api/contacto (este Worker) ──send_email──▶ casilla verificada en Email Routing
     ▲                                  │
     └──── {"ok":true} / 4xx / 5xx ─────┘   (si falla, la página ofrece el correo con el mensaje armado)
```

## Qué controla

| Control | Detalle | Respuesta |
| --- | --- | --- |
| Método | Solo `POST` | 405 |
| Origen | `Origin` tiene que ser `https://zustrolabs.com` o `https://www.zustrolabs.com` (variable `ORIGENES`). Corta el uso desde otros sitios. | 403 |
| Tipo | `Content-Type: application/json` | 415 |
| Límite por IP | 5 por minuto por IP (en IPv6, por prefijo /64), binding `LIMITE` | 429 |
| Límite global | 30 por minuto en total, binding `LIMITE_GLOBAL` | 429 |
| Sin límites | Si falta un binding de límite, no se manda nada (falla cerrado). Si el límite falla, 503. | 500 / 503 |
| Tamaño | Cuerpo de 8 KB como máximo, aunque no declare `Content-Length` | 413 |
| JSON | Tiene que ser un objeto | 400 |
| Bots | Campo trampa `web` lleno, o el formulario enviado en menos de 2,5 s (`t`): responde «ok» y no manda nada | 200 |
| Campos | Nombre (≤100), correo **o** teléfono, mensaje (≤1000), tema (≤80). El correo solo acepta ASCII seguro porque es lo único que va sin codificar a una cabecera (`Reply-To`). | 422 con el campo |
| Cabeceras del correo | Todo lo del visitante va en el cuerpo (texto plano en base64). El asunto va codificado (RFC 2047) y sin saltos de línea. No se puede agregar `Bcc` ni otras cabeceras. | — |
| Destino | Sale solo del secreto `DESTINO`: el visitante no puede elegirlo | — |
| Privacidad | No guarda nada. En los logs solo van métricas (`resultado`, `idioma`, el campo que falló). Los registros automáticos de cada pedido están apagados (`invocation_logs = false`). | — |

## Archivos

- `src/contacto.js`: toda la lógica, sin nada de Cloudflare, para poder probarla con Node.
- `src/index.js`: conecta la lógica con `EmailMessage` y el binding `CORREO`.
- `wrangler.toml`: rutas, variables y bindings. **No lleva secretos.**
- `test/contacto.test.js`: 26 tests (`npm run test:worker` desde la raíz, o `npm test` acá).

## Probar en local

```bash
cd worker
npm ci
echo 'DESTINO=prueba@example.com' > .dev.vars   # .dev.vars está en .gitignore
npm run dev                                      # http://localhost:8787/api/contacto
curl -X POST http://localhost:8787/api/contacto \
  -H 'Origin: https://zustrolabs.com' -H 'Content-Type: application/json' \
  --data '{"nombre":"Lucía","email":"lucia@example.com","mensaje":"Hola","t":5000}'
```

En local no sale ningún correo: Wrangler lo guarda como `.eml` en `.wrangler/tmp/email/` y lo indica en la consola.

## Publicar (lo hace Jeremías, desde la Mac)

Hace falta tener **Email Routing** activo en `zustrolabs.com` y la casilla de destino **verificada** en *Email → Email Routing → Destination addresses*. Ya está hecho para el Gmail que recibe `hola@`.

```bash
cd zustrolabs-web/worker
npm ci
npx wrangler login            # si no hay sesión abierta
npx wrangler deploy           # crea el Worker y las dos rutas /api/contacto
npx wrangler secret put DESTINO
# pegar la dirección verificada en Email Routing y Enter (no se escribe en ningún archivo)
```

Después hay que publicar `site/` en Cloudflare Pages: el formulario de la página nueva ya apunta a `/api/contacto`.

**Comprobar:** mandar una consulta desde https://zustrolabs.com y ver que llega con el asunto «Consulta desde la web · …». Al tocar «Responder», la respuesta va al visitante (`Reply-To`).

**Si algo falla:**

- *Workers & Pages → zustrolabs-contacto → Logs*: aparece `resultado` (`origen`, `limite`, `invalido`, `envio`, `config`, …).
- `config` quiere decir que falta el secreto `DESTINO` o un binding.
- `envio` quiere decir que Email Routing rechazó el correo: revisar que el destino esté verificado.
- Si hay una *Redirect Rule* que manda `www` al dominio sin `www`, tiene que excluir `/api/*`: si no, el POST se convierte en GET y responde 405.
