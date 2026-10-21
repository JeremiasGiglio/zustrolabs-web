# Asistente de zustrolabs.com («Preguntale a Zustro»)

Worker `zustrolabs-asistente`, en `POST https://zustrolabs.com/api/chat` (y `www.`). Responde preguntas sobre el estudio con **lo que ya está publicado en la página** y nada más. Es el mismo enfoque que el chat del Radar Croacia: la IA solo trabaja sobre datos verificados, con controles fijos alrededor y pruebas que lo demuestran.

```
navegador ──POST JSON──▶ zustrolabs.com/api/chat (este Worker) ──▶ API de Claude (Haiku)
     ▲                         │  controles: origen, límites, tamaño, esquema, texto limpio
     └──── {respuesta, secciones, enlaces, escribirnos} ◀──┘   (si falla: aviso con hola@zustrolabs.com)
```

## Qué sabe y qué no
- Todo lo que sabe está en [`src/conocimiento.js`](src/conocimiento.js), copiado de la landing. **Si cambia la landing, se cambia ese archivo en el mismo PR.** Hay un test que verifica que los datos clave (cifras de Šahovnica, nombres del equipo, links, secciones) estén en los dos lados.
- No sabe valores, plazos ni clientes: lo dice así y ofrece escribirnos.
- De David Vera y Nelson Zalazar solo sabe que son parte del equipo, hasta que se publiquen sus roles.
- No responde temas fuera del estudio (tareas, código, recetas, consejos médicos, legales o de plata).

## Controles (no dependen de que la IA obedezca)

| Control | Detalle | Respuesta |
| --- | --- | --- |
| Método y origen | Solo `POST` en JSON desde `https://zustrolabs.com` o `www` | 405 / 403 / 415 |
| Límite por IP | 10 preguntas por minuto por IP (por /64 en IPv6), binding `LIMITE` | 429 |
| Límite global | 60 por minuto en total, binding `LIMITE_GLOBAL`: es también el tope de gasto | 429 |
| Sin límites | Si falta un binding no responde (falla cerrado); si el límite falla, 503 | 500 / 503 |
| Tamaño | Cuerpo de 16 KB como máximo, 8 turnos, 500 caracteres por mensaje | 413 / 422 |
| Salida | JSON con esquema; secciones y enlaces solo de una lista cerrada, sin repetir y con tope | 502 si no cumple |
| Texto | Sin markdown ni links. Solo puede nombrar el correo `hola@zustrolabs.com`. Se saca toda oración con plata, teléfonos o palabras prohibidas (potpora del HZZ, en los 3 idiomas) | — |
| Fuera de tema | Sin botones | — |
| Instrucciones en el mensaje | Lo que escribe la persona es un dato, nunca una orden (regla del modelo y evals de inyección) | — |
| Privacidad | No guarda la charla: el navegador la tiene en memoria y manda los últimos mensajes. Los logs solo llevan métricas (resultado, idioma, tokens, qué control actuó), nunca el texto ni la IP. `invocation_logs = false` | — |
| Botones | Los arma la página con sus propios links (`site.js`); la IA solo elige claves. Todo se muestra como texto (`textContent`) | — |

## Archivos
- `src/conocimiento.js`: la información y las listas de secciones y enlaces.
- `src/asistente.js`: toda la lógica (validación, pedido a la API, controles, manejador), sin nada de Cloudflare.
- `src/index.js`: conecta el manejador con el Worker.
- `wrangler.toml`: ruta, variables y límites. **Sin secretos.**
- `test/asistente.test.js`: tests sin red (`npm run test:worker` desde la raíz, o `npm test` acá).
- `evals/casos.json` y `evals/correr.mjs`: evals con la IA real (ver abajo).

## Evals con la IA real
```bash
cd asistente
ANTHROPIC_API_KEY=... npm run evals      # la clave no se escribe en ningún archivo
```
Prueban 24 casos en los tres idiomas: qué hacen, valores y plazos (no tiene que dar cifras), clientes (no inventar), equipo (no inventar roles), productos, temas fuera de lugar, consejos médicos e inyección de instrucciones. Falla si pasa menos del 90 % o si los controles tuvieron que sacar plata, teléfonos o palabras prohibidas (quiere decir que el modelo no cumplió solo). En GitHub corren con el workflow «Evals del asistente» cuando el repo tiene el secreto `ANTHROPIC_API_KEY`.

## Publicar (una vez, y después de cada cambio en `asistente/`)
1. **Clave propia del estudio.** En https://console.anthropic.com/settings/keys → *Create Key* → nombre `zustrolabs-asistente`. Que no sea la del Radar: los gastos del Radar van en la convocatoria de la Oficina y no se mezclan. Conviene ponerle un límite de gasto mensual en *Settings → Limits*.
2. Desde esta carpeta, en la compu:
   ```bash
   cd asistente
   npm ci
   npx wrangler secret put ANTHROPIC_API_KEY   # pega la clave cuando la pide; no queda en ningún archivo
   npx wrangler deploy
   ```
3. Probar: abrir https://zustrolabs.com, tocar «Preguntale a Zustro» y preguntar «¿Qué hacen?».
4. Para las evals en GitHub: *Settings → Secrets and variables → Actions → New repository secret*, nombre `ANTHROPIC_API_KEY`, la misma clave del paso 1.

Si la página se publica antes que el Worker, el asistente muestra el aviso con el correo: no se rompe nada.

## Si algo pasa
- **Abuso o gasto raro:** bajar `LIMITE_GLOBAL` en `wrangler.toml` y volver a publicar. En una emergencia: *Workers & Pages → zustrolabs-asistente → Settings → Domains & Routes*, sacar las rutas (la página muestra el aviso con el correo) o borrar el secreto.
- **La clave se filtró:** revocarla en la consola de Anthropic y cargar una nueva con `wrangler secret put`.
