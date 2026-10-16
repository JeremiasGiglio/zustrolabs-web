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
- Se publica con **Cloudflare Pages** conectado a este repo: sin build, carpeta de salida `site`, dominios `zustrolabs.com` y `www.zustrolabs.com`. Cada PR genera una vista previa.
- `site/_headers` define cabeceras de seguridad (CSP incluida) para Cloudflare Pages.

## Formulario de contacto
La sección de contacto tiene el formulario a la vista: nombre, correo o teléfono (uno de los dos alcanza), qué necesita y un mensaje. El navegador lo manda a [FormSubmit](https://formsubmit.co) (`https://formsubmit.co/ajax/hola@zustrolabs.com`), que lo convierte en un correo a hola@zustrolabs.com. No hace falta cuenta, clave ni servidor. Si el envío falla, la tarjeta ofrece abrir el correo del visitante con el mensaje ya armado, así no se pierde ningún contacto.

Una sola vez, al publicar: el **primer envío** hace que FormSubmit mande a hola@zustrolabs.com un correo de activación; hay que tocar el botón de confirmar y desde ahí llegan todos. Los correos vienen con el asunto "Consulta desde la web · tema · nombre" y con el correo del cliente como "responder a". El campo oculto `_honey` descarta bots; `_captcha=false` evita la pantalla intermedia de FormSubmit.

En local, el formulario también apunta a FormSubmit: no mandar pruebas con datos reales desde `localhost`, porque llegan de verdad. Los tests lo simulan sin salir a internet.

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
npm run check        # todo menos los links en vivo
npm run test:links   # chequea que Šahovnica, el Radar y GitHub respondan
```
Se prueba, en escritorio y en celular, para cada idioma:
- que la **primera casilla del damero sea roja** (logo y retratos, modo claro y oscuro);
- que el `lang` sea el correcto, haya un solo `h1` con el lema y el selector de idioma apunte a las tres versiones;
- que el hero muestre el agente de turnos (sin videos que arranquen solos) y el botón a Šahovnica, que haya 4 soluciones con su mailto, que no quede franja de credenciales, que la sección de productos aclare que los videos usan datos ficticios, la oferta gratis en el contacto, que el único contacto sea el correo, que el equipo sean tres personas con su lugar para la foto y que Radar y Šahovnica tengan sus links;
- que no haya scroll horizontal (360, 390, 768 y 1280 px) y que el menú de celular abra y cierre;
- que no aparezcan precios, "contratá" ni figuras de empresa, en ninguno de los tres idiomas;
- que las demos digan que sus datos son ficticios;
- accesibilidad con axe (WCAG 2 A/AA, sin violaciones serias);
- el formulario: exige nombre, mensaje y un correo o un teléfono, envía el JSON correcto y, si el servidor falla, ofrece el correo con el mensaje armado;
- contacto, links externos, links internos de la navegación y pósters de video;
- las páginas `/expo/` y `/pantalla/`: un solo h1, logo con la primera casilla roja, sin scroll horizontal hasta 1920 px, "reducir movimiento" y sin violaciones de axe.

La CI corre en cada push y PR, y los lunes revisa que los links sigan vivos.

## Reglas
Ver `CLAUDE.md`. © 2026 Zustro Labs. Todos los derechos reservados.
