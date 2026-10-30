// Textos fijos del WhatsApp y el Instagram de Zustro Labs (no los escribe la IA), en los tres idiomas de la landing.
// Tono (ZL-115): cálido, con emojis, pensado para captar: idioma → ¿cómo estás? → qué podemos lograr juntos →
// qué necesita. Una persona del equipo entra al final, para charlar valores o cuando la piden (PERSONA).
// La política de privacidad sigue publicada en zustrolabs.com/privacidad y en la app de Meta; BORRAR sigue andando.
// Croata de «vi», como la página. Revisión de croata nativo pendiente (ZL-63).

export const IDIOMAS = ['es', 'hr', 'en'];
export const idiomaDe = (i) => (IDIOMAS.includes(i) ? i : 'es');
export const NOMBRE_IDIOMA = { es: 'Español', hr: 'Hrvatski', en: 'English' };

/** Primer mensaje: se pregunta el idioma en los tres a la vez (en WhatsApp, con botones). */
export const SALUDO_IDIOMA = [
  '¡Hola! 👋 Qué bueno que nos escribas. ¿En qué idioma charlamos?',
  'Pozdrav! 👋 Drago nam je što ste nam se javili. Na kojem jeziku razgovaramo?',
  'Hi! 👋 Great to hear from you. Which language would you like to chat in?',
].join('\n\n');

/** En canales sin botones (Instagram) el idioma se elige con un número, su nombre o su bandera. */
export const SALUDO_IDIOMA_TEXTO = `${SALUDO_IDIOMA}\n\n1️⃣ Español 🇦🇷\n2️⃣ Hrvatski 🇭🇷\n3️⃣ English 🇬🇧`;

/** Orden de los números del saludo. */
export const IDIOMA_POR_NUMERO = { 1: 'es', 2: 'hr', 3: 'en' };

const PERSONA_AL_FINAL = {
  es: '🙋 Si preferís hablar directo con alguien del equipo, escribí PERSONA.',
  hr: '🙋 Ako želite odmah razgovarati s nekim iz tima, napišite OSOBA.',
  en: '🙋 If you’d rather talk to someone on the team right away, type PERSON.',
};

export const TEXTOS = {
  es: {
    bienvenida:
      '¡Genial! 🙌 ¿Cómo estás? Espero que muy bien 😊\n\n' +
      'Soy el asistente de Zustro Labs 🟥⬜ Somos un estudio que crea webs, apps y agentes de inteligencia artificial para que tu negocio atienda mejor y vos ganes tiempo ⏱️ Y probamos todo antes de entregarlo ✅',
    menu:
      '¿Qué te gustaría lograr? 👇\n\n' +
      '1️⃣ 💬 Que tu WhatsApp o Instagram responda solo, las 24 horas\n' +
      '2️⃣ 📊 Saber cuánto vendés con solo preguntarlo\n' +
      '3️⃣ 🌐 Una web nueva, rápida y que se vea bien en el celular\n' +
      '4️⃣ 🔧 Que funcione una app o un chatbot que ya tenés y falla\n' +
      '5️⃣ 🎁 Ver lo que ya hicimos (gratis para usar)\n\n' +
      'Respondé con un número o contame con tus palabras qué necesitás ✍️',
    persona:
      '¡Buenísimo! 🙋 Ya le avisamos al equipo: te va a escribir una persona por acá para charlar tu proyecto, en horario de Argentina 🇦🇷',
    personaMail: 'Para charlar tu proyecto con alguien del equipo, escribinos a contact@zustrolabs.com 📩',
    borrado: 'Listo 🗑️ Borramos todo lo que teníamos de esta charla.',
    devuelta: '¡Acá estoy de nuevo! 😊 Si querés volver a hablar con alguien del equipo, escribí PERSONA.',
    soloTexto: 'Por ahora solo leo mensajes de texto 🙈 ¿Me lo escribís?',
    derivar: '🙋 Cuando quieras avanzar, escribí PERSONA y te atiende alguien del equipo para charlar tu proyecto y los valores.',
    falla: 'Uy, ahora no puedo responder 😓 Probá en un ratito, o escribí PERSONA y te atiende alguien del equipo.',
    sinRespuesta: 'Eso no lo sé 🤔 Escribí PERSONA y te responde alguien del equipo.',
    limite: '¡Hay muchas consultas a la vez! ⏳ Probá en unos minutos, o escribí PERSONA y te atiende alguien del equipo.',
    tope: 'Por hoy ya charlamos un montón 😅 Mañana seguimos, o escribí PERSONA y te atiende alguien del equipo.',
  },
  hr: {
    bienvenida:
      'Super! 🙌 Kako ste? Nadam se dobro 😊\n\n' +
      'Ja sam asistent Zustro Labsa 🟥⬜ Mi smo studio koji izrađuje web stranice, aplikacije i agente umjetne inteligencije kako bi vaš posao bolje služio klijentima, a vi uštedjeli vrijeme ⏱️ I sve testiramo prije isporuke ✅',
    menu:
      'Što biste željeli postići? 👇\n\n' +
      '1️⃣ 💬 Da vaš WhatsApp ili Instagram odgovara sam, 24 sata dnevno\n' +
      '2️⃣ 📊 Znati koliko prodajete samo tako da pitate\n' +
      '3️⃣ 🌐 Novu web stranicu, brzu i preglednu na mobitelu\n' +
      '4️⃣ 🔧 Da proradi aplikacija ili chatbot koji već imate, a griješi\n' +
      '5️⃣ 🎁 Pogledati što smo već napravili (besplatno za korištenje)\n\n' +
      'Odgovorite brojem ili mi svojim riječima napišite što trebate ✍️',
    persona:
      'Odlično! 🙋 Javili smo timu: ovdje će vam se javiti osoba iz tima da porazgovarate o vašem projektu, tijekom radnog vremena u Argentini 🇦🇷',
    personaMail: 'Ako o svom projektu želite razgovarati s nekim iz tima, pišite nam na contact@zustrolabs.com 📩',
    borrado: 'Gotovo 🗑️ Obrisali smo sve što smo imali iz ovog razgovora.',
    devuelta: 'Evo me opet! 😊 Ako opet želite razgovarati s nekim iz tima, napišite OSOBA.',
    soloTexto: 'Za sada čitam samo tekstualne poruke 🙈 Možete li mi to napisati?',
    derivar: '🙋 Kad god želite krenuti dalje, napišite OSOBA i javit će vam se netko iz tima da porazgovarate o projektu i iznosima.',
    falla: 'Ups, trenutačno ne mogu odgovoriti 😓 Pokušajte malo kasnije ili napišite OSOBA i javit će vam se netko iz tima.',
    sinRespuesta: 'To ne znam 🤔 Napišite OSOBA i odgovorit će vam netko iz tima.',
    limite: 'Trenutačno stiže puno upita odjednom ⏳ Pokušajte za nekoliko minuta ili napišite OSOBA i javit će vam se netko iz tima.',
    tope: 'Danas smo puno razgovarali 😅 Nastavljamo sutra, ili napišite OSOBA i javit će vam se netko iz tima.',
  },
  en: {
    bienvenida:
      'Great! 🙌 How are you? Hope you’re doing well 😊\n\n' +
      'I’m the Zustro Labs assistant 🟥⬜ We’re a studio that builds websites, apps and AI agents so your business serves people better and you save time ⏱️ And we test everything before delivery ✅',
    menu:
      'What would you like to achieve? 👇\n\n' +
      '1️⃣ 💬 Your WhatsApp or Instagram answering on its own, 24/7\n' +
      '2️⃣ 📊 Know how much you sell just by asking\n' +
      '3️⃣ 🌐 A new website, fast and great on any phone\n' +
      '4️⃣ 🔧 Fix an app or chatbot you already have that keeps failing\n' +
      '5️⃣ 🎁 See what we’ve already built (free to use)\n\n' +
      'Reply with a number or tell me in your own words what you need ✍️',
    persona:
      'Awesome! 🙋 We’ve let the team know: someone will write to you here to talk about your project, during Argentine business hours 🇦🇷',
    personaMail: 'To talk about your project with someone on the team, write to us at contact@zustrolabs.com 📩',
    borrado: 'Done 🗑️ We’ve deleted everything we had from this chat.',
    devuelta: 'I’m back! 😊 If you’d like to talk to someone on the team again, type PERSON.',
    soloTexto: 'For now I can only read text messages 🙈 Could you type it?',
    derivar: '🙋 Whenever you’re ready to move forward, type PERSON and someone on the team will talk through your project and the costs with you.',
    falla: 'Oops, I can’t answer right now 😓 Try again in a bit, or type PERSON and someone on the team will help you.',
    sinRespuesta: 'I don’t know that one 🤔 Type PERSON and someone on the team will reply.',
    limite: 'Lots of questions coming in at once! ⏳ Try again in a few minutes, or type PERSON and someone on the team will help you.',
    tope: 'We’ve chatted a lot today 😅 Let’s carry on tomorrow, or type PERSON and someone on the team will help you.',
  },
};

export const textos = (idioma) => TEXTOS[idiomaDe(idioma)];

/** Lo que se responde a cada número del menú (sin gastar IA). Cada uno termina preguntando por el negocio. */
const OPCIONES_BASE = {
  es: {
    1:
      '💬 Tu WhatsApp e Instagram, atendidos las 24 horas\n\n' +
      'Un agente de inteligencia artificial contesta al instante las preguntas de siempre, da turnos y, cuando hace falta, le pasa la charla a una persona de tu equipo. Vos dejás de responder lo mismo todo el día y nadie se queda sin respuesta, ni a la noche ni el fin de semana 🌙\n\n' +
      'Y sí: es como este que te está hablando 😉\n\n' +
      '¿Qué tipo de negocio tenés? Contame y te digo cómo lo armaríamos para vos 👇',
    2:
      '📊 Tus números, con solo preguntarlos\n\n' +
      'Si las ventas están en un Excel que entiende uno solo, armamos un panel al que le preguntás «¿cuánto vendimos en septiembre?» y te responde con el número, la comparación con el mes anterior y de dónde sale el dato. Sin esperar a nadie para saber cómo va tu negocio 📈\n\n' +
      '¿Dónde llevás hoy tus ventas? Contame 👇',
    3:
      '🌐 Una web que trabaje para vos\n\n' +
      'Un sitio nuevo, rápido, que se ve bien en cualquier celular y que probamos antes de publicarlo ✅ Para que quien te busque te encuentre y entienda en segundos qué hacés. Mirá el nuestro: zustrolabs.com\n\n' +
      '¿Ya tenés página o arrancamos de cero? 👇',
    4:
      '🔧 Lo que ya tenés, funcionando\n\n' +
      '¿Tenés un chatbot o una app que falla o dice cualquier cosa y nadie sabe por qué? La revisamos, la probamos y te decimos qué está mal y cómo arreglarlo. Probar software es lo nuestro: Jeremías, nuestro fundador, se dedica a eso desde 2018 🔍\n\n' +
      '¿Qué tenés y qué es lo que falla? Contame 👇',
    5:
      '🎁 Lo que ya hicimos, gratis para usar hoy\n\n' +
      '🗺️ Radar Croacia: programas, becas y oportunidades en Croacia para la diáspora sudamericana y para quien quiera ir, con la fuente oficial de cada una 👉 radar.zustrolabs.com\n\n' +
      '🇭🇷 Šahovnica: una app para aprender croata desde cero, en castellano, diez minutos por día 👉 croata.zustrolabs.com\n\n' +
      '¿Te imaginás algo así para tu proyecto? Contame qué tenés en mente 👇',
  },
  hr: {
    1:
      '💬 Vaš WhatsApp i Instagram, 24 sata dnevno\n\n' +
      'Agent umjetne inteligencije odmah odgovara na uobičajena pitanja, zakazuje termine i, kad zatreba, prosljeđuje razgovor osobi iz vašeg tima. Vi više ne odgovarate cijeli dan na ista pitanja, a nitko ne ostaje bez odgovora, ni noću ni vikendom 🌙\n\n' +
      'I da: baš kao ovaj koji vam sada piše 😉\n\n' +
      'Kakav posao imate? Napišite mi pa ću vam reći kako bismo ga složili za vas 👇',
    2:
      '📊 Vaše brojke, samo tako da pitate\n\n' +
      'Ako je prodaja u Excelu koji razumije samo jedna osoba, izrađujemo nadzornu ploču koju pitate «koliko smo prodali u rujnu?» i ona odgovori brojem, usporedbom s prošlim mjesecom i izvorom podatka. Bez čekanja da biste znali kako vam ide posao 📈\n\n' +
      'Gdje danas vodite prodaju? Napišite mi 👇',
    3:
      '🌐 Web stranica koja radi za vas\n\n' +
      'Nova, brza stranica koja dobro izgleda na svakom mobitelu i koju testiramo prije objave ✅ Da vas pronađe svatko tko vas traži i u nekoliko sekundi shvati čime se bavite. Pogledajte našu: zustrolabs.com/hr\n\n' +
      'Imate li već stranicu ili krećemo od nule? 👇',
    4:
      '🔧 Ono što već imate, a da radi\n\n' +
      'Imate chatbot ili aplikaciju koja griješi ili govori gluposti, a nitko ne zna zašto? Pregledamo je, testiramo i kažemo vam što ne valja i kako to popraviti. Testiranje softvera naš je posao: naš osnivač Jeremías time se bavi od 2018. 🔍\n\n' +
      'Što imate i što ne radi? Napišite mi 👇',
    5:
      '🎁 Što smo već napravili, besplatno već danas\n\n' +
      '🗺️ Radar Croacia: programi, stipendije i prilike u Hrvatskoj za južnoameričku dijasporu i sve koji žele doći, sa službenim izvorom za svaku 👉 radar.zustrolabs.com\n\n' +
      '🇭🇷 Šahovnica: aplikacija za učenje hrvatskog od nule, na španjolskom, deset minuta dnevno 👉 croata.zustrolabs.com\n\n' +
      'Možete li zamisliti nešto slično za svoj projekt? Napišite mi što imate na umu 👇',
  },
  en: {
    1:
      '💬 Your WhatsApp and Instagram, answered 24/7\n\n' +
      'An AI agent instantly answers the usual questions, books appointments and, when needed, hands the chat to someone on your team. You stop answering the same thing all day, and nobody is left without a reply, not at night and not on weekends 🌙\n\n' +
      'And yes: just like the one talking to you right now 😉\n\n' +
      'What kind of business do you have? Tell me and I’ll explain how we’d set it up for you 👇',
    2:
      '📊 Your numbers, just by asking\n\n' +
      'If your sales live in a spreadsheet only one person understands, we build a dashboard you can ask «how much did we sell in September?» and it answers with the number, the comparison with the month before and where the data comes from. No more waiting to know how your business is doing 📈\n\n' +
      'Where do you keep track of your sales today? Tell me 👇',
    3:
      '🌐 A website that works for you\n\n' +
      'A new, fast site that looks great on any phone, tested before it goes live ✅ So anyone looking for you finds you and understands what you do in seconds. Take a look at ours: zustrolabs.com/en\n\n' +
      'Do you already have a site, or are we starting from scratch? 👇',
    4:
      '🔧 What you already have, actually working\n\n' +
      'Got a chatbot or an app that fails or says nonsense and nobody knows why? We review it, test it and tell you what’s wrong and how to fix it. Testing software is what we do: Jeremías, our founder, has been doing it since 2018 🔍\n\n' +
      'What do you have and what’s failing? Tell me 👇',
    5:
      '🎁 What we’ve already built, free to use today\n\n' +
      '🗺️ Radar Croacia: programmes, grants and opportunities in Croatia for the South American diaspora and anyone who wants to go, each with its official source 👉 radar.zustrolabs.com\n\n' +
      '🇭🇷 Šahovnica: an app to learn Croatian from scratch, in Spanish, ten minutes a day 👉 croata.zustrolabs.com\n\n' +
      'Can you picture something like this for your project? Tell me what you have in mind 👇',
  },
};

export const OPCIONES = Object.fromEntries(
  IDIOMAS.map((i) => [i, Object.fromEntries(Object.entries(OPCIONES_BASE[i]).map(([n, t]) => [n, `${t}\n\n${PERSONA_AL_FINAL[i]}`]))]),
);

/** Texto para el número n del menú (1 a 5) en ese idioma, o null. */
export const opcion = (idioma, n) => OPCIONES[idiomaDe(idioma)][n] ?? null;

/** Un número suelto (también 1️⃣) como mensaje entero → el número, o null. */
export function numeroSolo(texto) {
  const t = String(texto ?? '').replace(/[️⃣]/g, '').replace(/[.)!]/g, '').trim();
  return /^[1-9]$/.test(t) ? Number(t) : null;
}

/** Nombre o bandera de un idioma escrito como mensaje entero → 'es' | 'hr' | 'en' | null. */
export function eligeIdioma(texto) {
  const crudo = String(texto ?? '').trim();
  if (/^(?:🇦🇷|🇪🇸|🇲🇽|🇺🇾|🇨🇱)$/u.test(crudo)) return 'es';
  if (/^🇭🇷$/u.test(crudo)) return 'hr';
  if (/^(?:🇬🇧|🇺🇸)$/u.test(crudo)) return 'en';
  const t = crudo
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¡!¿?.,;:]/g, '')
    .replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|[️⃣]/gu, '')
    .trim();
  if (/^(espanol|castellano|spanish|spanjolski)$/.test(t)) return 'es';
  if (/^(hrvatski|croata|croatian)$/.test(t)) return 'hr';
  if (/^(english|ingles|engleski)$/.test(t)) return 'en';
  return null;
}

// Lo que se suma al prompt del asistente de la página en los canales de mensajería: el objetivo es captar.
const CAPTAR = `- Tu objetivo: que la persona descubra lo que el estudio puede hacer por su negocio y quiera avanzar. Preguntá por su negocio o su proyecto, explicá en palabras simples cuál de las cuatro soluciones le sirve y qué ganaría con eso (tiempo, atender mejor a sus clientes, saber sus números, una web que se vea bien), sin inventar cifras, clientes ni promesas.
- Tono cálido y cercano, como alguien del estudio que atiende con ganas. Usá uno o dos emojis por respuesta (😊 🙌 💬 🌐 📊 ✅) y terminá con una pregunta corta para seguir la charla.
- Saludos, agradecimientos, «¿cómo estás?» o «bien, ¿y vos?» no son fuera de tema: respondé con calidez en una oración y preguntá qué necesita su negocio.
- Si la persona quiere avanzar, pregunta valores o plazos, o pide hablar con alguien, poné escribirnos = true: el sistema le explica cómo hablar con una persona del equipo. Vos nunca des valores.
- No hables de privacidad, datos ni comandos salvo que la persona pregunte.`;

/** Nota para el modelo: el canal es WhatsApp (se suma al prompt del asistente de la página). */
export const CANAL_WHATSAPP = `Canal: WhatsApp de Zustro Labs (no la página). Cambia esto de las reglas de arriba:
${CAPTAR}
- Ya estás hablando por WhatsApp: nunca digas «escribinos por WhatsApp» ni menciones el formulario de Contacto ni botones de la página.
- Cada mensaje llega solo, sin el historial de la charla: si falta contexto, pedilo en una oración.
- El idioma es el del último mensaje de la persona; si no se puede saber, el que eligió: {idioma}.`;

/** Nota para el modelo: el canal son los mensajes directos de Instagram (mismas reglas que WhatsApp, más cortas). */
export const CANAL_INSTAGRAM = `Canal: mensajes directos de Instagram de Zustro Labs (no la página). Cambia esto de las reglas de arriba:
${CAPTAR}
- Ya estás hablando por Instagram: nunca digas «escribinos por WhatsApp» ni menciones el formulario de Contacto ni botones de la página.
- Respondé corto: como mucho tres oraciones, sin listas ni títulos. Instagram corta los mensajes largos.
- No escribas direcciones web: el sistema agrega el link que corresponda.
- Cada mensaje llega solo, sin el historial de la charla: si falta contexto, pedilo en una oración.
- El idioma es el del último mensaje de la persona; si no se puede saber, el que eligió: {idioma}.`;
