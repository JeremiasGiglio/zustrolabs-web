# Contexto para Claude — zustrolabs-web

Landing de Zustro Labs (estudio de QA + IA de Jeremías Giglio). Estática, sin build, en `site/`. Publicada con Cloudflare Pages en zustrolabs.com.

## Reglas que no se negocian
1. **Damero:** la primera casilla (arriba a la izquierda) **siempre roja, nunca blanca**, en logo, favicon, fondos y cualquier patrón. Nada de forma de escudo, corona, letra U, fondos negros con damero ni consignas políticas. Hay tests que lo verifican.
2. **Potpora del HZZ:** no publicar precios, no "contratá ahora", no "empresa", "S.A.", "SAS", "d.o.o.". Sí: "estudio", "escribinos". Hay un test con la lista.
3. **Repo público:** nada de DNI, CUIL, dirección, teléfono personal, datos bancarios, tarifa, nombre del cliente actual ni Deel.
4. **Honestidad:** no inventar clientes, testimonios, cifras ni logos de terceros. Demos solo con datos ficticios y diciéndolo. El diploma de Šahovnica es de práctica.
5. **Dominios:** no tocar `croata.zustrolabs.com` (Worker de Šahovnica) ni nada de `jgcup.stream`.
6. Trabajo por ramas y PR, con `npm run check` en verde.

## Marca
Rojo `#C8102E` · tinta `#1B2230` · blanco · sobre oscuro: rojo `#E8344C`, blanco `#F3F4F6` · gris `#5A6270`. Barlow Condensed (títulos) + Source Sans 3 (texto) + JetBrains Mono (detalles de consola). El logo está en línea en `index.html` con clases `lr`/`li` que toman los colores del tema.

## Videos
Animados por código (HTML + GSAP, render cuadro a cuadro con Playwright + ffmpeg). Las fuentes de cada video están fuera del repo, en la carpeta "Zustro Labs/landing/fuentes" de la Mac.
