# Entrega — zustrolabs-web

Esta carpeta es la landing de Zustro Labs completa, lista para subir a GitHub y publicar en Cloudflare Pages. Lo que sigue es lo que hay que saber para seguir trabajando sin romper nada.

## Qué hay en la carpeta

| Carpeta / archivo | Qué es |
|---|---|
| `site/` | **Todo lo que se publica.** Tres versiones de la landing (`index.html` castellano, `en/`, `hr/`), dos páginas de apoyo (`expo/` con QR para ferias, `pantalla/` para un televisor), `assets/` con estilos, script, imágenes y videos, y `_headers` con las cabeceras de seguridad. |
| `tests/` | Tests de Playwright: marca, contenido, idiomas, formulario, accesibilidad, ancho en celular, palabras prohibidas. |
| `scripts/` | `serve.mjs` (servidor local para los tests y para mirar la página) y `captura-radar.mjs` (regenera la captura del Radar). |
| `.github/workflows/ci.yml` | La CI: corre los tests en cada push y PR, y los lunes revisa los links externos. |
| `archivo/` | Material que la página ya no usa (videos y una foto). No se publica. Se puede borrar si nadie lo quiere. |
| `CLAUDE.md`, `AGENTS.md` | Contexto para agentes de IA (Claude Code, Codex, Cursor, etc.). Los leen solos. |
| `REGLAS.md` | **Las reglas inquebrantables.** Para personas y agentes. Leerlas antes de tocar nada. |
| `SEGURIDAD.md` | Qué protege al sitio, la lista de 20 minutos para activar en Cloudflare y GitHub, y qué hacer si algo pasa. |
| `README.md` | Cómo está hecho, cómo correr y testear, cómo cargar las fotos del equipo. |

No hay `node_modules/` ni resultados de tests en la entrega: se regeneran con los comandos de abajo.

## Cómo se integró (15/10/2026, ZL-68)

Esta entrega entró al repo existente `JeremiasGiglio/zustrolabs-web` por el PR de ZL-68, no como repo nuevo. En ese PR:

- el formulario dejó FormSubmit y pasó a un Worker propio (`worker/`);
- se sumaron tests de seguridad y `html-validate`;
- se revisó la responsividad.

**Publicar hoy:**

1. Publicar el Worker (`worker/README.md`).
2. Subir `site/` en Cloudflare: *Workers & Pages → zustrolabs-web → Create deployment*.

El proyecto de Pages es de subida directa y no está conectado a Git.

## Cómo se trabaja después

- Siempre con ticket en Jira ZL, en una rama con la clave y por PR. `main` es lo publicado.
- Antes de pedir el PR: `npm run check` en verde. La CI lo vuelve a correr y bloquea si falla.
- Para mirar la página en local: `npm run serve` y abrir `http://localhost:4173`.
- Cualquier cambio de texto va en los tres idiomas. Si no hay traducción, se dice en el PR.
- Si se usa un agente de IA para trabajar, lee solo `CLAUDE.md` y `REGLAS.md`. Igual conviene recordarle: "respetá REGLAS.md y corré npm run check antes de terminar".

## Lo que quedó pendiente (no bloquea publicar)

- **Fotos del equipo.** La sección "Equipo" tiene tres lugares vacíos para Jeremías Giglio, David Vera y Nelson Zalazar. El README explica cómo cargarlas.
- **Roles de David y Nelson.** Están en blanco en las tres páginas (`p.role`). Se completan cuando se definan.
- **Revisión del croata** por un hablante nativo antes de difundir la versión `hr/`.
- **Números reales de uso** del Radar o de Šahovnica, si alguna vez existen, para la sección de productos. Hoy no hay ninguno y la página no inventa.
- **Captura del Radar:** si el sitio del Radar cambia, `node scripts/captura-radar.mjs` la regenera, y hay que revisar los tres números (14 oportunidades, 3 situaciones, 5 tipos) en las tres páginas.

## Dónde preguntar
Jeremías Giglio, por `hola@zustrolabs.com`.
