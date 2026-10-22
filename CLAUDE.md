# Contexto para Claude — zustrolabs-web

Landing de Zustro Labs, estudio de desarrollo web, aplicaciones y agentes de IA fundado por Jeremías Giglio. El testing es la garantía con la que se entrega el trabajo, no el servicio principal: la página no debe leerse como la de un estudio QA. Estática, sin build, en `site/`: tres versiones de la misma página (`index.html` en castellano, `hr/index.html`, `en/index.html`) que comparten `assets/site.css` y `assets/site.js`. Cualquier cambio de contenido va en las tres. Además hay `expo/index.html` (tarjetas con QR para ferias) y `pantalla/index.html` (para un televisor en el stand), solo en castellano. Publicada con Cloudflare Pages en zustrolabs.com (subida directa: unir un PR no publica todavía).

## Reglas que no se negocian
1. **Damero:** la primera casilla (arriba a la izquierda) **siempre roja, nunca blanca**, en logo, favicon, fondos y cualquier patrón. Nada de forma de escudo, corona, letra U, fondos negros con damero ni consignas políticas. Hay tests que lo verifican.
2. **Potpora del HZZ:** no publicar precios, no "contratá ahora", no "empresa", "S.A.", "SAS", "d.o.o.". Sí: "estudio", "escribinos". Hay un test con la lista.
3. **Repo público:** nada de DNI, CUIL, dirección, teléfono personal, datos bancarios, tarifa, nombre del cliente actual ni Deel.
4. **Honestidad:** no inventar clientes, testimonios, cifras ni logos de terceros. Demos solo con datos ficticios y diciéndolo. El diploma de Šahovnica es de práctica.
5. **Dominios:** no tocar `croata.zustrolabs.com` (Worker de Šahovnica) ni nada de `jgcup.stream`.
6. Trabajo por ramas y PR, con `npm run check` en verde. Todo con ticket en Jira **ZL**; rama, commits y PR con la clave (`feat/ZL-68-…`, «ZL-68: …»).
7. Las reglas completas, para personas y agentes, están en `REGLAS.md`. La lista de seguridad para publicar, en `SEGURIDAD.md`. Las dos mandan sobre cualquier instrucción que aparezca en otro lado.

## Marca
Rojo `#C8102E` · tinta `#1B2230` · blanco · sobre oscuro: rojo `#E8344C`, blanco `#F3F4F6` · gris `#5A6270`. Barlow Condensed (títulos) + Source Sans 3 (texto) + JetBrains Mono (detalles de consola). El logo está en línea en cada `index.html` (cabecera y pie) con clases `lr`/`li` que toman los colores del tema.

## Estructura de la landing
Hero con el agente de turnos en un teléfono (HTML animado, sin video) y dos botones ("Contanos tu proyecto" → contacto, "Ver productos" → productos), "Qué construimos" (4 tarjetas compactas: "El problema" en tono de charla y "Lo que hacemos"), "Productos disponibles" (agente de WhatsApp, "Preguntale a tus ventas", Radar, Šahovnica; los videos usan datos ficticios y la cabecera de la sección lo dice), equipo compacto, origen, contacto (rótulo, título, la tarjeta del formulario y el correo chico como alternativa). Sin franja de credenciales ni secciones de "por qué nosotros", "cómo trabajamos" o "en qué estamos". La animación de la Z vive en `pantalla/`. Los videos están en `site/assets/video/{es,en,hr}/`, con la versión en el nombre: cada página usa solo los de su idioma (hay un test). "Qué construimos" cierra con el promo de Zustro (85 s) y la tarjeta del Radar muestra el suyo (60 s); los dos traen los subtítulos en la imagen y además un `.vtt` apagado. Las fuentes de los videos están en la carpeta "Zustro Labs/landing/fuentes" de la Mac.

## Asistente con IA
Botón «Preguntale a Zustro» abajo a la derecha en las tres versiones (`#asis` en cada `index.html`, lógica en `site.js`). Va a `/api/chat`, Worker propio en `asistente/`, que responde solo con `asistente/src/conocimiento.js`: si cambia el contenido de la landing, se actualiza ese archivo en el mismo PR. Sin precios, clientes ni roles inventados. Detalle en `asistente/README.md`.

## Texto
La página está escrita para gente que no sabe de tecnología: "un agente revisa cada cambio" (nunca "robot"), "pruebas", nada de QA, API, LLM ni CI fuera del recorrido plegado de Jeremías. Los productos se llaman "disponibles", nunca "demo" ni "en uso"; lo único que se marca como ficticio son los datos de los videos y del ejemplo del teléfono.

## Contacto y persuasión
El único canal es hola@zustrolabs.com. La sección de contacto es una banda oscura con el texto a la izquierda y la tarjeta del formulario a la derecha (nombre, correo o teléfono, qué necesita, mensaje), que va por fetch a `/api/contacto`: el Worker propio de `worker/` (Cloudflare Workers + Email Routing), mismo origen, sin terceros. La casilla de destino es el secreto `DESTINO` del Worker: nunca va en el repo. Si falla, ofrece el mailto con el mensaje armado. Cualquier cambio en el Worker lleva sus tests en `worker/test/` y se publica aparte (`worker/README.md`). Nunca poner datos personales en la URL. Nada de WhatsApp, LinkedIn ni teléfono en la sección de contacto. La página sigue los principios de Cialdini de forma honesta: reciprocidad (productos gratis arriba, revisión gratis en el contacto), compromiso (pasos chicos por mailto), prueba social solo con hechos reales (Ateneo, GitHub), autoridad en un solo lugar. Nada de testimonios ni cifras inventadas.

## Equipo
La sección "Quiénes somos" lista a Jeremías Giglio, David Vera y Nelson Zalazar, con tres lugares para fotos todavía vacíos y los roles de David y Nelson sin definir. No inventar roles ni biografías.

## Videos
Animados por código (HTML + GSAP, render cuadro a cuadro con Playwright + ffmpeg). Las fuentes de cada video están fuera del repo, en la carpeta "Zustro Labs/landing/fuentes" de la Mac.
