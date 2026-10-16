# zustrolabs-web

Landing de **Zustro Labs**, estudio de desarrollo web, aplicaciones y agentes de IA, entregados con pruebas. Publicada en https://zustrolabs.com.

> IA que funciona porque está testeada.

## Cómo está hecha
- Sitio **estático, sin framework y sin build**: todo está en `site/`.
- Tres versiones de la misma página: `site/index.html` (castellano), `site/hr/index.html` (croata) y `site/en/index.html` (inglés), enlazadas entre sí con `hreflang` y un selector de idioma en la cabecera y el pie.
- Las tres comparten `site/assets/site.css` y `site/assets/site.js` (menú en celular, botón de copiar el correo y "reducir movimiento").
- Dos páginas de apoyo para exposiciones, solo en castellano y fuera de los buscadores: `site/expo/` (tres tarjetas con QR: Radar, Šahovnica y servicios; también sirve impresa) y `site/pantalla/` (versión para un televisor en el stand, con el video del hero y frases que rotan). Los QR están en `site/assets/qr-*.svg`.
- La captura del Radar (`site/assets/radar-home.jpg`) se regenera con `node scripts/captura-radar.mjs` cuando el sitio cambie.
- `site/assets/` tiene las imágenes y los videos que la página usa. Lo que dejó de usarse está en `archivo/`, fuera de `site/`, para que no se publique.
- Se publica con **Cloudflare Pages**, proyecto `zustrolabs-web`, por **subida directa** (no está conectado a GitHub): sin build, carpeta `site`, dominios `zustrolabs.com` y `www.zustrolabs.com`. Hoy, unir un PR no publica: Jeremías sube `site/` en el panel de Cloudflare. La publicación automática con una GitHub Action está en ZL-59.
- `site/_headers` define cabeceras de seguridad (CSP incluida) para Cloudflare Pages.

## Formulario de contacto
La sección de contacto tiene el formulario a la vista: nombre, correo o teléfono (uno de los dos alcanza), qué necesita y un mensaje. El navegador lo manda en JSON a **`/api/contacto`**, un Worker propio en Cloudflare (`worker/`). El Worker lo valida y lo manda por correo con **Email Routing** a la casilla del estudio. No hay servicios de terceros, no se guarda nada y no hay claves en el repo: la casilla de destino es un secreto del Worker.

- El correo llega con el asunto «Consulta desde la web · tema · nombre» y con el correo del visitante como «responder a».
- Antibots: un campo trampa (`web`), un tiempo mínimo de 2,5 s desde que carga el formulario, un límite de 5 envíos por minuto por IP y otro de 30 por minuto en total.
- Si el envío falla, la tarjeta ofrece abrir el correo del visitante con el mensaje ya armado, así no se pierde ningún contacto.
- Detalle, controles, prueba local y cómo publicarlo: [`worker/README.md`](worker/README.md).

En local, `npm run serve` no tiene el Worker: el formulario muestra el error y ofrece el correo. Los tests simulan la respuesta sin salir a internet.

## Equipo en la página
La sección "Quiénes somos" tiene tres lugares para fotos, hoy vacíos (`.portrait.empty`). Para cargarlas: poner cada retrato en `site/assets/` (4:5, unos 800 px de ancho, WebP) y reemplazar el `div.portrait.empty` por `div.portrait` con la `img` adentro. El damero rojo de la esquina lo pone el CSS. Los roles de David Vera y Nelson Zalazar están en blanco (`p.role`) hasta que se definan.

## Correr en local
```bash
npm ci
npm run serve        # http://localhost:4173
```

## Tests
```bash
npx playwright install chromium
npm run check        # tests del Worker + validación del HTML + Playwright (todo menos los links en vivo)
npm run test:links   # chequea que Šahovnica, el Radar y GitHub respondan
```
`npm run check` corre tres cosas:

1. **`npm run test:worker`:** 26 tests del Worker del formulario con `node --test`. Cubren:
    * orígenes, métodos, tipos y tamaños;
    * campo trampa y tiempo mínimo;
    * los dos límites (IPv4, IPv6 /64 y global) y qué pasa si fallan;
    * validación de campos;
    * inyección de cabeceras;
    * MIME y asunto codificado;
    * que los logs no lleven datos personales.
2. **`npm run lint:html`:** `html-validate` con el preset recomendado sobre todas las páginas.
3. **Playwright** (`tests/landing.spec.ts` y `tests/seguridad.spec.ts`), en escritorio y en celular. El servidor local aplica `site/_headers` igual que Cloudflare Pages, así que los tests corren con la CSP real.

**Landing**, para cada idioma:
- que la **primera casilla del damero sea roja** (logo y retratos, modo claro y oscuro);
- que el `lang` sea el correcto, haya un solo `h1` con el lema y el selector de idioma apunte a las tres versiones;
- el contenido:
    * el hero, las 4 soluciones y los productos con sus links;
    * los datos ficticios señalados en las demos;
    * que el único contacto sea el correo;
    * el equipo;
- que no haya scroll horizontal de 320 a 1920 px, que en celular los botones y links sueltos midan 24 px o más y que el menú abra y cierre;
- que no aparezcan precios, «contratá» ni figuras de empresa, en ninguno de los tres idiomas;
- accesibilidad con axe (WCAG 2 A/AA, sin violaciones serias);
- el formulario: exige nombre, mensaje y un correo o un teléfono, manda el JSON correcto por POST al mismo sitio y, si falla, ofrece el correo con el mensaje armado;
- las páginas `/expo/` y `/pantalla/`.

**Seguridad** (`tests/seguridad.spec.ts`):
- **CSP y cabeceras:**
    * sin `unsafe-eval`, sin iframes ni plugins;
    * formularios y conexiones solo al propio sitio;
    * HSTS de un año, nosniff, COOP y permisos del navegador cerrados;
    * `site.js` y `site.css` que se revalidan siempre.
- **HTML:**
    * sin manejadores en línea, sin `javascript:` y sin `http://`;
    * scripts y estilos externos solo de la lista acordada;
    * todo `target=_blank` con `noopener`;
    * campos del formulario con `maxlength`.
- **En el navegador:**
    * sin violaciones de CSP ni errores;
    * sin pedidos a sitios fuera de la lista;
    * un intento de XSS en el formulario no se ejecuta;
    * nada de lo escrito queda en la URL, en cookies ni en el almacenamiento.
- **Repo público:**
    * sin claves ni tokens;
    * sin datos personales (CUIL, DNI, CBU, IBAN, correos personales, celulares) en lo publicado ni en la documentación;
    * sin el nombre del cliente actual (se compara por hash, para no escribirlo);
    * sin carpetas sensibles;
    * el Worker sin secretos en `wrangler.toml`.
- **Servidor local:** no sirve nada fuera de `site/`.

La CI corre `npm run check` en cada push y PR, y los lunes revisa que los links sigan vivos.

## Reglas
Ver `CLAUDE.md`. © 2026 Zustro Labs. Todos los derechos reservados.
