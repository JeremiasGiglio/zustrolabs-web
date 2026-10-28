#!/usr/bin/env node
// Suscribe la página de Facebook «Zustro Labs» a los avisos de mensajes de Instagram y muestra los ids que van en
// wrangler.toml. Se corre una vez desde la Mac, con el token del usuario del sistema (nunca se guarda ni se pega
// en el chat):
//
//   IG_TOKEN='…' node scripts/instagram-suscribir.mjs
// (si el token no lista páginas, agregá IG_PAGE_ID='<id de la página>' delante)
//
// Qué hace:
// 1. Mira qué páginas ve el token y cuál tiene vinculada la cuenta @zustrolabs → imprime IG_ID e IG_PAGE_ID.
// 2. Si el token es de usuario (no de página), pide el token de la página para esa página: ese es el que va en
//    el secreto IG_TOKEN del Worker (un token de usuario del sistema sin vencimiento da un token de página sin
//    vencimiento).
// 3. Suscribe la página a los avisos (`messages`) de la app, igual que lo hace el cron diario del Worker.
// Después de esto, en el panel de la app de Meta: Webhooks → Instagram → messages, con la URL
// https://zustrolabs.com/api/instagram y el verify token del secreto IG_VERIFY_TOKEN.

import { revisarSuscripcion } from '../src/instagram.js';
import { GRAPH_VERSION } from '../src/whatsapp.js';

const TOKEN = process.env.IG_TOKEN;
if (!TOKEN) {
  console.error("Falta IG_TOKEN. Usá: IG_TOKEN='…' node scripts/instagram-suscribir.mjs");
  process.exit(1);
}
const USUARIO = process.env.IG_USUARIO || 'zustrolabs';
const API = `https://graph.facebook.com/${process.env.IG_GRAPH_VERSION || GRAPH_VERSION}`;

async function llamar(ruta, token = TOKEN) {
  const r = await fetch(`${API}/${ruta}`, { headers: { authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`${ruta.split('?')[0]}: ${j.error?.message ?? r.status} (código ${j.error?.code ?? '?'})`);
  return j;
}

// 1. Páginas que ve el token y la que tiene vinculada la cuenta de Instagram
const yo = await llamar('me?fields=id,name');
const paginas = (await llamar('me/accounts?fields=id,name,instagram_business_account{id,username}')).data ?? [];
let pagina = paginas.find((p) => p.instagram_business_account?.username === USUARIO);
// Si el token no lista páginas (falta pages_show_list), se prueba directo con el id de la página, si se pasó.
if (!pagina && process.env.IG_PAGE_ID) {
  const p = await llamar(`${process.env.IG_PAGE_ID}?fields=id,name,instagram_business_account{id,username}`).catch(() => null);
  if (p?.instagram_business_account?.username === USUARIO) pagina = p;
}
if (!pagina) {
  console.error(`Ninguna página que vea este token tiene vinculada la cuenta @${USUARIO}.`);
  console.error('Páginas vistas:', paginas.map((p) => `${p.name} (${p.id})`).join(', ') || 'ninguna');
  console.error('Revisá en Business settings que el usuario del sistema tenga la página y la cuenta de Instagram asignadas.');
  process.exit(1);
}
console.log(`Página: ${pagina.name}`);
console.log(`IG_PAGE_ID = "${pagina.id}"`);
console.log(`IG_ID = "${pagina.instagram_business_account.id}"   (@${USUARIO})`);

// 2. Token de página (si el que se pasó es de usuario)
let tokenPagina = TOKEN;
if (String(yo.id) !== String(pagina.id)) {
  tokenPagina = (await llamar(`${pagina.id}?fields=access_token`)).access_token;
  console.log('\nEl token que pasaste es de usuario. El Worker necesita el de la página: guardalo así (no lo pegues en el chat):');
  console.log('  cd whatsapp && npx wrangler secret put IG_TOKEN');
  console.log('y cuando lo pida, pegá este:');
  console.log(`  ${tokenPagina}`);
}

// 3. Suscripción de la página a los avisos de mensajes
const r = await revisarSuscripcion({ IG_TOKEN: tokenPagina, IG_PAGE_ID: pagina.id });
if (!r.suscripta) {
  console.error(`\nNo se pudo suscribir la página: ${r.error ?? 'sin detalle'}. El token necesita pages_manage_metadata.`);
  process.exit(1);
}
console.log(r.arreglada ? '\nPágina suscripta a los avisos de mensajes (messages).' : '\nLa página ya estaba suscripta a los avisos de mensajes.');
console.log('Falta: en la app de Meta → Webhooks → Instagram, poner https://zustrolabs.com/api/instagram y suscribir «messages».');
