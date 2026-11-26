// Run explicitly during the production rollout. This check creates no payment or agreement.
import { createHmac, randomUUID } from "node:crypto";

const env = process.env;
const api = "https://api.mercadopago.com";
const site = "https://pos.mybusiness.mx";
if (env.VERCEL_ENV !== "production" ||
    env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== "https://jfprzmxwrkbufsbqwvnc.supabase.co" ||
    !env.MP_V1_ACCESS_TOKEN || env.MP_V1_ACCESS_TOKEN.startsWith("TEST-") ||
    !/^\d+$/.test(env.MP_V1_APPLICATION_ID ?? "") || !/^\d+$/.test(env.MP_V1_COLLECTOR_ID ?? "") ||
    !env.MP_V1_WEBHOOK_SECRET) throw Error("Revisar la configuración de facturación de producción");

async function read(url, label) {
  const response = await fetch(url, {headers: {Authorization: "Bearer " + env.MP_V1_ACCESS_TOKEN},
    redirect: "error", signal: AbortSignal.timeout(15000)});
  if (!response.ok) throw Error(label + " HTTP " + response.status);
  return response.json();
}

const [seller, app] = await Promise.all([
  read(api + "/users/me", "Vendedor"),
  read("https://api.mercadolibre.com/applications/" + env.MP_V1_APPLICATION_ID, "Aplicación"),
  read(api + "/preapproval/search?limit=1", "Lectura de suscripciones"),
]);
const checks = {
  seller_matches: String(seller.id) === env.MP_V1_COLLECTOR_ID,
  mexico: seller.site_id === "MLM",
  real_seller: Array.isArray(seller.tags) && !seller.tags.includes("test_user"),
  app_matches: String(app.id) === env.MP_V1_APPLICATION_ID,
  owner_matches: app.owner_id == null ? null : String(app.owner_id) === env.MP_V1_COLLECTOR_ID,
};
console.log("MP_PRODUCTION_PREFLIGHT", JSON.stringify(checks));
if (Object.values(checks).includes(false)) throw Error("Identidad del vendedor o aplicación inesperada");

const id = "release-" + randomUUID();
const requestId = randomUUID();
const ts = String(Math.floor(Date.now() / 1000));
const digest = createHmac("sha256", env.MP_V1_WEBHOOK_SECRET)
  .update(`id:${id};request-id:${requestId};ts:${ts};`).digest("hex");
const url = new URL("/api/mercadopago/v1/webhook", site);
url.searchParams.set("data.id", id);
const response = await fetch(url, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
  headers: {"Content-Type":"application/json","x-request-id":requestId,"x-signature":`ts=${ts},v1=${digest}`},
  body: JSON.stringify({type:"release_probe",data:{id}}),
});
if (response.status !== 200 || (await response.json()).received !== true) throw Error("Webhook de producción HTTP " + response.status);
console.log("MP_PRODUCTION_WEBHOOK", response.status);
