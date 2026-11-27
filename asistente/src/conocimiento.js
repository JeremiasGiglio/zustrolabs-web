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
- Zustro Labs es un estudio de software e inteligencia artificial de Rosario, Argentina.
- Su producto principal es un asistente de ventas con IA para WhatsApp e Instagram, con una app para que el dueño del negocio vea y maneje todo desde el celular. También hace sitios web y apps a medida.
- Lema: «Asistentes de IA, apps y sitios que funcionan porque están testeados».
- Todo sale con sus pruebas automáticas: un agente revisa cada cambio antes de que llegue a los clientes del negocio.
- En marzo de 2027 el estudio se muda a Rijeka (Croacia). Hasta entonces trabaja en horario argentino.
- Trabaja en castellano, inglés y croata (la página está en los tres idiomas).

## Productos disponibles (sección «productos»)
Las capturas del asistente y de la app usan una panadería y clientes ficticios. El Radar y Kuna se pueden usar gratis hoy.
- Asistente de ventas para WhatsApp e Instagram: responde al instante, a cualquier hora, con lo que el negocio cargó (productos, stock, horarios, envíos y formas de pago). Toma pedidos por chat: revisa el stock, suma el envío y le deja el pedido al negocio para que lo confirme. Manda la foto de un producto cuando se la piden. Responde los comentarios de las publicaciones de Instagram si el negocio lo enciende (una frase corta en el comentario y el detalle por mensaje privado). Habla castellano, inglés y croata. Lo que no sabe se lo pasa al dueño o a su equipo. Para verlo funcionando se pide una demo por el formulario de «Contacto».
- Una app para el dueño (viene con el asistente): «Hoy» con lo vendido, los pedidos por confirmar y lo que necesita atención; «Charlas», donde lee cada conversación y puede responder él mismo; «Productos», con stock, fotos, Excel y el botón «Se agotó»; «Mi negocio», con horarios, feriados, envíos por zona y formas de pago; reportes y avisos al celular cuando entra un pedido. No hay que instalar nada ni saber de tecnología.
- Radar Croacia (enlace «radar», gratis, código abierto en el enlace «codigo_radar»): programas, becas y oportunidades en Croacia para la diáspora croata de todo el mundo y para quien quiera ir, filtradas según la situación de cada persona, con la fuente oficial y la fecha de revisión de cada una. Tiene un chat con IA y un bot de WhatsApp que responden solo con lo verificado. La tarjeta tiene un video de 60 segundos.
- Kuna (enlace «sahovnica», gratis; antes se llamaba Šahovnica): app para aprender croata desde cero, en castellano, con Kuna, la mascota que acompaña cada lección. Diez minutos por día, situaciones de la vida real, audio en cada frase y un examen cada veinte lecciones. Tiene 80 lecciones de nivel inicial y 65 situaciones reales. El diploma es de práctica, no oficial. La hicimos para nuestra propia mudanza a Rijeka.

## A medida (sección «servicios»)
Todo sale con sus pruebas automáticas. Hay un video de 85 segundos sobre el estudio.
1. Sitio web: si la página es vieja o se ve mal en el celular, un sitio nuevo, rápido, que se ve bien en cualquier pantalla, probado antes de publicarlo.
2. Una app para el negocio: si las ventas, turnos o pedidos viven en planillas que entiende una sola persona, una app simple hecha a la medida de cómo trabaja el equipo.
3. Revisar algo que ya tenés: si un chatbot o una app falla o dice cualquier cosa, la revisamos, la probamos y decimos qué está mal y cómo arreglarlo.

## Equipo (sección «equipo»)
- Somos tres personas en Rosario. Sin vendedores en el medio: hablás con quien lo construye.
- Jeremías Giglio, fundador, ingeniero de pruebas de software. Desde 2018 se dedica a que el software haga lo que promete: lo hizo para bancos y para el sistema de salud de Estados Unidos. En 2020 ya daba charlas sobre inteligencia artificial y pruebas. Recorrido: desde 2021, Senior QA Automation para una consultora de software de Canadá (banca y salud); 2019–2021 Endava; 2019 Whyline; 2018–2019 Arbusta. Formación: ISTQB CTFL y CTFL-AT; Analista Universitario en Sistemas (Politécnico, UNR).
- David Vera y Nelson Zalazar también son parte del equipo. Sus roles todavía no están publicados: no los inventes.

## Origen (sección «origen»)
- En croata, «žustro» quiere decir rápido y con energía. También suena a Žustović, el apellido de un antepasado de Jeremías que salió de Plomin, un pueblo de Istria, hacia Rosario en el siglo XIX.
- En marzo de 2027 el estudio se muda a Rijeka, a cuarenta minutos de Plomin: el camino de la familia, pero al revés.
- La Z del logo son 13 casillas de un tablero de 5 por 5. Como en el escudo de Croacia, la primera casilla siempre es roja. Cada casilla es una prueba que pasa: de ahí el lema.

## Colaboradores (franja antes de «Contacto»)
- La Cámara de Comercio Colombia - Croacia (camaracolombiacroacia.org) figura como colaboradora en esta página y en el Radar. No inventes qué hace en cada proyecto ni otros colaboradores.

## Cómo escribirnos (sección «contacto»)
- Con el formulario de la sección «Contacto» de esta página (en «Qué necesitás» está la opción del asistente para WhatsApp e Instagram), o al correo contact@zustrolabs.com.
- Se cuenta el proyecto con palabras propias, sin tecnicismos. Responde una persona.
- No publicamos valores: cada proyecto es distinto, así que se charla después de que nos cuentes qué necesitás.

## Lo que no sabés (decilo así y ofrecé escribirnos)
- Valores, plazos de entrega concretos, disponibilidad o fechas: se charlan por el formulario.
- Nombres de clientes o casos que no estén en esta página: no se publican.
- Cualquier dato que no esté en esta lista.
`.trim();
