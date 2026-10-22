// Textos fijos del WhatsApp de Zustro Labs (no los escribe la IA), en los tres idiomas de la landing.
// Croata de «vi», como la página. Revisión de croata nativo pendiente (ZL-63).

export const IDIOMAS = ['es', 'hr', 'en'];
export const idiomaDe = (i) => (IDIOMAS.includes(i) ? i : 'es');
export const NOMBRE_IDIOMA = { es: 'Español', hr: 'Hrvatski', en: 'English' };

/** Primer mensaje: se pregunta el idioma en los tres a la vez. */
export const SALUDO_IDIOMA = [
  'Hola, soy el asistente de Zustro Labs. ¿En qué idioma seguimos?',
  'Dobar dan! Ja sam asistent Zustro Labsa. Na kojem jeziku nastavljamo?',
  'Hi! I’m the Zustro Labs assistant. Which language should we use?',
  '',
  'Privacidad: zustrolabs.com/privacidad · BORRAR / OBRIŠI / DELETE',
].join('\n');

export const TEXTOS = {
  es: {
    bienvenida:
      'Listo. Te cuento qué hace el estudio, qué construimos y cómo escribirnos: preguntame lo que quieras.\n\n' +
      'Si querés hablar con alguien del equipo, escribí PERSONA. Para cambiar el idioma, escribí IDIOMA.\n\n' +
      'Guardamos tu número y el idioma que elegiste, por 90 días; lo que escribís al asistente no se guarda. Si escribís PERSONA, guardamos esa charla 30 días para que el equipo la lea. Para borrar todo, escribí BORRAR.',
    persona:
      'Listo, le avisamos al equipo. Te va a responder alguien por acá, en horario de Argentina. Mientras tanto, el asistente queda en pausa.',
    personaMail: 'Para hablar con alguien del equipo, escribinos a contact@zustrolabs.com.',
    borrado: 'Listo, borramos lo que teníamos de esta charla.',
    devuelta: 'La charla volvió al asistente. Si necesitás otra vez a alguien del equipo, escribí PERSONA.',
    soloTexto: 'Por ahora solo leo mensajes de texto. Escribime tu pregunta.',
    derivar: 'Si querés charlarlo con alguien del equipo, escribí PERSONA.',
    falla: 'Ahora no puedo responder. Probá en un rato, o escribí PERSONA para hablar con alguien del equipo.',
    sinRespuesta: 'Eso no lo sé. Escribí PERSONA y te responde alguien del equipo.',
    limite: 'Ahora hay muchas consultas a la vez. Probá en unos minutos, o escribí PERSONA para hablar con alguien del equipo.',
    tope: 'Por hoy ya respondí muchas preguntas desde este número. Mañana seguimos, o escribí PERSONA para hablar con alguien del equipo.',
  },
  hr: {
    bienvenida:
      'U redu. Mogu vam reći čime se studio bavi, što izrađujemo i kako nam se javiti: pitajte što god želite.\n\n' +
      'Ako želite razgovarati s nekim iz tima, napišite OSOBA. Za promjenu jezika napišite JEZIK.\n\n' +
      'Čuvamo vaš broj i jezik koji ste odabrali, 90 dana; ono što pišete asistentu ne čuvamo. Ako napišete OSOBA, taj razgovor čuvamo 30 dana da ga tim može pročitati. Da biste sve obrisali, napišite OBRIŠI.',
    persona:
      'U redu, javili smo timu. Ovdje će vam odgovoriti netko iz tima, tijekom radnog vremena u Argentini. Do tada asistent miruje.',
    personaMail: 'Ako želite razgovarati s nekim iz tima, pišite nam na contact@zustrolabs.com.',
    borrado: 'Gotovo, obrisali smo ono što smo imali iz ovog razgovora.',
    devuelta: 'Razgovor je vraćen asistentu. Ako opet trebate nekoga iz tima, napišite OSOBA.',
    soloTexto: 'Za sada čitam samo tekstualne poruke. Napišite mi svoje pitanje.',
    derivar: 'Ako o tome želite razgovarati s nekim iz tima, napišite OSOBA.',
    falla: 'Trenutačno ne mogu odgovoriti. Pokušajte malo kasnije ili napišite OSOBA ako želite razgovarati s nekim iz tima.',
    sinRespuesta: 'To ne znam. Napišite OSOBA i odgovorit će vam netko iz tima.',
    limite: 'Trenutačno ima puno upita odjednom. Pokušajte za nekoliko minuta ili napišite OSOBA ako želite razgovarati s nekim iz tima.',
    tope: 'Danas sam s ovog broja odgovorio na mnogo pitanja. Nastavljamo sutra, ili napišite OSOBA ako želite razgovarati s nekim iz tima.',
  },
  en: {
    bienvenida:
      'Great. I can tell you what the studio does, what we build and how to reach us: ask me anything.\n\n' +
      'If you’d like to talk to someone on the team, type PERSON. To change the language, type LANGUAGE.\n\n' +
      'We keep your number and the language you chose, for 90 days; what you write to the assistant is not kept. If you type PERSON, we keep that chat for 30 days so the team can read it. To delete everything, type DELETE.',
    persona:
      'Done, we’ve let the team know. Someone from the team will reply here during Argentine business hours. Until then, the assistant is paused.',
    personaMail: 'To talk to someone on the team, write to us at contact@zustrolabs.com.',
    borrado: 'Done, we’ve deleted what we had from this chat.',
    devuelta: 'The chat is back with the assistant. If you need someone on the team again, type PERSON.',
    soloTexto: 'For now I can only read text messages. Type your question.',
    derivar: 'If you’d like to talk it over with someone on the team, type PERSON.',
    falla: 'I can’t answer right now. Try again in a while, or type PERSON to talk to someone on the team.',
    sinRespuesta: 'I don’t know that. Type PERSON and someone on the team will reply.',
    limite: 'There are a lot of questions coming in right now. Try again in a few minutes, or type PERSON to talk to someone on the team.',
    tope: 'I’ve answered a lot of questions from this number today. Let’s carry on tomorrow, or type PERSON to talk to someone on the team.',
  },
};

export const textos = (idioma) => TEXTOS[idiomaDe(idioma)];

/** Nota para el modelo: el canal es WhatsApp (se suma al prompt del asistente de la página). */
export const CANAL_WHATSAPP = `Canal: WhatsApp de Zustro Labs (no la página). Cambia esto de las reglas de arriba:
- Ya estás hablando por WhatsApp: nunca digas «escribinos por WhatsApp» ni menciones el formulario de Contacto ni botones de la página.
- Cada mensaje llega solo, sin el historial de la charla: si falta contexto, pedilo en una oración.
- Si la persona quiere hacer un proyecto, pregunta valores o plazos, o necesita a alguien del equipo, poné escribirnos = true: el sistema le explica cómo hablar con una persona.
- El idioma es el del último mensaje de la persona; si no se puede saber, el que eligió: {idioma}.`;
