# zustrolabs-web

Landing de **Zustro Labs**, el estudio de QA + IA de Jeremías Giglio. Publicada en https://zustrolabs.com.

> IA que funciona porque está testeada.

## Cómo está hecha
- Sitio **estático, sin framework y sin build**: todo está en `site/` (HTML con su CSS y JS adentro, y `site/assets/` con imágenes y videos).
- Se publica con **Cloudflare Pages** conectado a este repo: sin build, carpeta de salida `site`, dominios `zustrolabs.com` y `www.zustrolabs.com`. Cada PR genera una vista previa.
- `site/_headers` define cabeceras de seguridad (CSP incluida) para Cloudflare Pages.

## Tests
```bash
npm ci
npx playwright install chromium
npm run check        # todo menos los links en vivo
npm run test:links   # chequea que Šahovnica, el Radar y GitHub respondan
```
Se prueba, en escritorio y en celular:
- que la **primera casilla del damero sea roja** (logo y retrato, modo claro y oscuro);
- que no haya scroll horizontal (360, 390, 768 y 1280 px);
- que no aparezcan precios, "contratá" ni figuras de empresa;
- que las demos digan que sus datos son ficticios;
- accesibilidad con axe (WCAG 2 A/AA, sin violaciones serias);
- contacto, links externos, pósters de video y "reducir movimiento".

La CI corre en cada push y PR, y los lunes revisa que los links sigan vivos.

## Reglas
Ver `CLAUDE.md`. © 2026 Zustro Labs. Todos los derechos reservados.
