# WhatsApp de un cliente con YCloud · ZL-135

El número de WhatsApp Business de un negocio responde con **su** ficha y **sus** productos (los mismos de Instagram y
de `negocios.zustrolabs.com`). El negocio conecta su número a **su propia cuenta gratis de YCloud** con
**coexistencia**: sigue usando la app de WhatsApp Business con el mismo número y no pierde sus charlas. Así no hace
falta que Zustro Labs sea empresa verificada ante Meta.

**Lo normal:** `scripts\whatsapp-cliente.ps1` (o `cliente-nuevo.ps1`, que lo llama). Unos 15 minutos con el cliente.

## Cómo funciona

1. El cliente crea su cuenta en YCloud y conecta el número con un QR (WhatsApp accounts → Create Channel →
   **WhatsApp Business APP Coexistence** → Connect by QR code). Elige sincronizar los últimos 6 meses de charlas.
2. El script le pide la **clave de API** de esa cuenta (sin mostrarla) y se la manda al Worker
   (`POST /api/instagram/admin/ycloud`). El Worker crea en la cuenta del cliente un webhook hacia
   `zustrolabs.com/api/whatsapp/ycloud/<clave>` y guarda la clave de API y el secreto del webhook en el Durable Object.
   Nunca se devuelven ni se registran. El negocio queda con WhatsApp encendido.
3. Cada mensaje llega firmado (`YCloud-Signature`: HMAC-SHA256 de `t.cuerpo` con el secreto de ese número, de hace
   menos de 5 minutos). El Worker lo atiende con la ficha y el catálogo, igual que Instagram, y responde con
   `POST https://api.ycloud.com/v2/whatsapp/messages/sendDirectly` y la clave del negocio.
4. El webhook recibe lo de **todos** los números de esa cuenta de YCloud: solo se atiende el número conectado. Los
   números se comparan normalizados (Argentina con o sin el 9, México con o sin el 1); para responder se usa el número
   tal como vino. Las reacciones (👍) no se contestan.
5. Cuando el dueño contesta desde su celular, YCloud avisa (`whatsapp.smb.message.echoes`) y el asistente se calla en
   esa charla las «Horas de pausa» de la ficha (y si contesta mientras la IA piensa, la respuesta del asistente no
   sale). Si la cuenta de YCloud no acepta ese aviso, el script lo dice.

## Lo que el cliente tiene que saber

- Sigue usando su app con el mismo número; sus charlas no se borran.
- En las charlas individuales dejan de andar: mensajes temporales, «ver una vez», ubicación en tiempo real y listas de
  difusión (las existentes quedan solo para leer). Los grupos siguen en la app, pero el asistente no los ve.
- Se desvinculan WhatsApp Web y las computadoras (se vuelven a vincular). **WhatsApp para Windows no funciona** con
  coexistencia: web.whatsapp.com sí.
- Tiene que abrir la app al menos **cada 14 días**: si no, Meta corta la conexión.
- WhatsApp Business 2.24.17 o más nueva. Antes de conectar, una copia de seguridad de las charlas.
- Los mensajes que manda desde la app siguen siendo gratis. Las respuestas del asistente dentro de las 24 horas de
  un mensaje del cliente son de servicio (Meta no las cobra hoy; revisar los precios de Meta si cambian).
- YCloud puede pedir verificar el negocio con sus papeles: por eso el nombre va exactamente como en los papeles.

## Comandos

```
.\whatsapp-cliente.ps1                 alta de un número (negocio nuevo o uno que ya está)
.\whatsapp-cliente.ps1 -SoloEstado     números conectados, último mensaje y si se calla cuando contesta el dueño
.\whatsapp-cliente.ps1 -Desconectar    sacar un número (borra el webhook en YCloud; el cliente sigue con su app)
```

Admin del Worker (`Authorization: Bearer <IG_ADMIN_CLAVE>`, en `https://zustrolabs.com/api/instagram/admin/…`):
`GET /ycloud`, `POST /ycloud {negocio, numero, apiKey}`, `DELETE /ycloud/<clave>`.

## Si no responde

Cloudflare → Workers & Pages → `zustrolabs-whatsapp` → Observability, buscar `"canal":"yc"`:

| `que` | Qué quiere decir | Qué hacer |
|---|---|---|
| `firma` | El secreto no coincide (se recreó el webhook a mano en YCloud) | `-Desconectar` y volver a conectar |
| `numero_desconocido` | Un webhook viejo apunta a una clave que ya no está | Borrarlo en YCloud (Developers → Webhooks) |
| `sin_ficha` / `ficha_inactiva` / `ficha_invalida` | La ficha del negocio | Pestaña Asistente: activarla |
| `canal_apagado` | WhatsApp apagado en el negocio | Administración → marcar WhatsApp |
| `eco` | El dueño contestó desde su celular: pausa en esa charla | Nada (o BORRAR desde el otro lado) |
| `contesto_el_duenio` | El dueño contestó mientras la IA pensaba: no salió la respuesta del asistente | Nada |
| `otro_numero` | Llegó un mensaje para otro número de la misma cuenta de YCloud | Nada: solo se atiende el número conectado |
| un `error` con `ycloud 401` | La clave de API se borró o cambió | `-Desconectar` y volver a conectar con la nueva |
| ningún registro | YCloud no está mandando | ¿El número figura en YCloud? ¿Terminó la sincronización? ¿El webhook está activo? |

Lo que ya falló en otras altas y cómo evitarlo: [`FALLAS_Y_PREVENCION.md`](FALLAS_Y_PREVENCION.md).
