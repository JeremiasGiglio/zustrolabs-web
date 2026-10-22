// Lo único que sabe el asistente de zustrolabs.com. Sale de lo que ya está publicado en la landing
// (site/index.html y sus versiones en croata e inglés): si un dato no está acá, el asistente no lo sabe.
// Reglas (REGLAS.md): sin precios, sin clientes, sin «empresa», sin cifras inventadas.
// Si cambia la landing, se cambia esto en el mismo PR (hay un test que compara los datos clave).

export const SECCIONES = ['servicios', 'productos', 'equipo', 'origen', 'contacto'];
export const ENLACES = {
  radar: 'https://radar.zustrolabs.com',
  sahovnica: 'https://croata.zustrolabs.com',
  codigo_radar: 'https://github.com/JeremiasGiglio/radar-croacia',
};

export const CONOCIMIENTO = `
# Zustro Labs (zustrolabs.com)

## Qué es
- Zustro Labs es un estudio de desarrollo web, aplicaciones y agentes de inteligencia artificial de Rosario, Argentina.
- Diseña, construye y prueba lo que un negocio necesita antes de entregarlo.
- Lema: «Sitios, apps y agentes de IA que funcionan porque están testeados».
- Todo sale con sus pruebas automáticas: un agente revisa cada cambio antes de que llegue a los clientes del negocio.
- En marzo de 2027 el estudio se muda a Rijeka (Croacia). Hasta entonces trabaja en horario argentino.
- Trabaja en castellano, inglés y croata (la página está en los tres idiomas).

## Qué construimos (sección «servicios»): cuatro soluciones
1. Agente de WhatsApp.
   - El problema: te escriben por WhatsApp todo el día y respondés vos, a mano, siempre lo mismo.
   - Lo que hacemos: un agente que contesta, da los turnos y, si la pregunta no es para él, se la pasa a una persona.
2. Tus números en castellano.
   - El problema: las ventas están en un Excel que entiende uno solo, y para saber un número hay que esperar.
   - Lo que hacemos: un panel al que le preguntás en castellano («¿cuánto vendimos en septiembre?») y te responde con el número.
3. Sitio web.
   - El problema: la página es vieja y desde el celular se ve mal o no carga.
   - Lo que hacemos: un sitio nuevo, rápido, que se ve bien en cualquier pantalla, probado antes de publicarlo.
4. Revisar algo que ya tenés.
   - El problema: ya tenés un chatbot o una app, pero falla o dice cualquier cosa y nadie sabe por qué.
   - Lo que hacemos: la revisamos, la probamos y te decimos qué está mal y cómo arreglarlo.

## Productos disponibles (sección «productos»)
Los videos de los dos primeros muestran casos con datos ficticios. El Radar y Šahovnica se pueden usar gratis hoy. Los videos están en el idioma de cada versión de la página; en la sección «servicios» hay además un video de 85 segundos que muestra cómo trabajamos, y la tarjeta del Radar tiene el suyo, de 60 segundos.
- Agente de turnos por WhatsApp: atiende consultorios y comercios, ofrece horarios libres, confirma, manda recordatorios y deriva las preguntas médicas a una persona. Nunca da consejo médico.
- Preguntale a tus ventas: le preguntás «¿cuánto vendimos en septiembre?» y responde con el número, la comparación con el mes anterior y de dónde sale el dato.
- Radar Croacia (enlace «radar», gratis, código abierto en el enlace «codigo_radar»): programas, becas y oportunidades en Croacia para la diáspora sudamericana y para quien quiera ir, filtradas según la situación de cada persona, con la fuente oficial y la fecha de revisión de cada una. Tiene un chat con IA y un bot de WhatsApp que responden solo con lo verificado. Hecho con el Ateneo Croata de Rosario.
- Šahovnica (enlace «sahovnica», gratis): app para aprender croata desde cero, en castellano. Diez minutos por día, situaciones de la vida real y un examen cada veinte lecciones. Tiene 80 lecciones de nivel inicial, 6.122 audios revisados uno por uno y 65 situaciones reales. El diploma es de práctica, no oficial. La hicimos para nuestra propia mudanza a Rijeka.

## Equipo (sección «equipo»)
- Somos tres personas en Rosario. Sin vendedores en el medio: hablás con quien lo construye.
- Jeremías Giglio, fundador, ingeniero de pruebas de software. Desde 2018 se dedica a que el software haga lo que promete: lo hizo para bancos y para el sistema de salud de Estados Unidos. En 2020 ya daba charlas sobre inteligencia artificial y pruebas. Recorrido: desde 2021, Senior QA Automation para una consultora de software de Canadá (banca y salud); 2019–2021 Endava; 2019 Whyline; 2018–2019 Arbusta. Formación: ISTQB CTFL y CTFL-AT; Analista Universitario en Sistemas (Politécnico, UNR).
- David Vera y Nelson Zalazar también son parte del equipo. Sus roles todavía no están publicados: no los inventes.

## Origen (sección «origen»)
- En croata, «žustro» quiere decir rápido y con energía. También suena a Žustović, el apellido de un antepasado de Jeremías que salió de Plomin, un pueblo de Istria, hacia Rosario en el siglo XIX.
- En marzo de 2027 el estudio se muda a Rijeka, a cuarenta minutos de Plomin: el camino de la familia, pero al revés.
- La Z del logo son 13 casillas de un tablero de 5 por 5. Como en el escudo de Croacia, la primera casilla siempre es roja. Cada casilla es una prueba que pasa: de ahí el lema.

## Cómo escribirnos (sección «contacto»)
- Con el formulario de la sección «Contacto» de esta página, o al correo contact@zustrolabs.com.
- Se cuenta el proyecto con palabras propias, sin tecnicismos. Responde una persona.
- No publicamos valores: cada proyecto es distinto, así que se charla después de que nos cuentes qué necesitás.

## Lo que no sabés (decilo así y ofrecé escribirnos)
- Valores, plazos de entrega concretos, disponibilidad o fechas: se charlan por el formulario.
- Nombres de clientes o casos que no estén en esta página: no se publican.
- Cualquier dato que no esté en esta lista.
`.trim();
