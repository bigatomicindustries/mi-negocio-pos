// Explicit Preview diagnostic. The synthetic webhook topic has no billing action.
import { createHmac, randomUUID } from "node:crypto";

if (process.env.VERCEL_ENV !== "preview" ||
    process.env.VERCEL_GIT_COMMIT_REF !== "feature/pricing-v1" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !== "https://pablbrladwjuczhazsms.supabase.co") {
  throw new Error("La verificación requiere Preview y Mi Negocio DEV.");
}
const token = process.env.MP_V1_ACCESS_TOKEN;
const collector = process.env.MP_V1_COLLECTOR_ID;
if (!token || !collector) throw new Error("Falta la configuración del vendedor.");

async function read(path) {
  return fetch("https://api.mercadopago.com" + path, {
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
}

const [seller, subscriptions] = await Promise.all([read("/users/me"), read("/preapproval/search?limit=1")]);
const account = seller.ok ? await seller.json() : {};
const result = {
  seller_http: seller.status,
  subscriptions_http: subscriptions.status,
  mexico: account.site_id === "MLM",
  collector_matches: seller.ok && String(account.id) === collector,
  test_mode: token.startsWith("TEST-") || account.tags?.includes("test_user") === true,
  application_id_format: /^\d+$/.test(process.env.MP_V1_APPLICATION_ID || ""),
};
console.log("MP_PREVIEW_CHECK", JSON.stringify(result));
if (!seller.ok || !subscriptions.ok || !result.mexico || !result.collector_matches ||
    !result.test_mode || !result.application_id_format) throw new Error("Revisar el vendedor de prueba.");

const secret = process.env.MP_V1_WEBHOOK_SECRET;
if (!secret) throw new Error("Falta la firma del webhook de prueba.");
const target = new URL("https://mi-negocio-mp-webhook-dev.vercel.app/api/mercadopago/v1/webhook");
const id = "qa-" + randomUUID();
const requestId = randomUUID();
const ts = String(Math.floor(Date.now() / 1000));
const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
const digest = createHmac("sha256", secret).update(manifest).digest("hex");
target.searchParams.set("data.id", id);
const response = await fetch(target, {
  method: "POST",
  redirect: "error",
  signal: AbortSignal.timeout(15000),
  headers: {
    "Content-Type": "application/json",
    "x-request-id": requestId,
    "x-signature": `ts=${ts},v1=${digest}`,
  },
  body: JSON.stringify({ type: "pricing_qa_ping", data: { id } }),
});
const ack = await response.json().catch(() => ({}));
console.log("MP_WEBHOOK_CHECK", JSON.stringify({ http: response.status, received: ack.received === true }));
if (response.status !== 200 || ack.received !== true) throw new Error("El receptor DEV no confirmó la prueba de firma.");
