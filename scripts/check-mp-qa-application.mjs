import { randomUUID } from "node:crypto";

const env = process.env;
const buyer = env.MP_V1_QA_BUYER_EMAIL;
if (env.VERCEL_ENV !== "preview" || env.VERCEL_GIT_COMMIT_REF !== "feature/pricing-v1" ||
    env.NEXT_PUBLIC_SUPABASE_URL !== "https://pablbrladwjuczhazsms.supabase.co" ||
    env.MP_V1_APPLICATION_ID !== "1373270036164371" || env.MP_V1_COLLECTOR_ID !== "3732279320" ||
    !/^[\w.-]+@testuser\.com$/i.test(buyer ?? "")) throw Error("Configuración QA inesperada");

async function request(path, method = "GET", payload, key) {
  const response = await fetch("https://api.mercadopago.com" + path, {
    method, redirect: "error", signal: AbortSignal.timeout(20000),
    headers: { Authorization: "Bearer " + env.MP_V1_ACCESS_TOKEN, "Content-Type": "application/json",
      ...(key ? {"X-Idempotency-Key": key} : {}) },
    body: payload && JSON.stringify(payload),
  });
  if (!response.ok) throw Error(method + " " + path + " HTTP " + response.status);
  return response.json();
}
const seller = await request("/users/me");
if (String(seller.id) !== env.MP_V1_COLLECTOR_ID || seller.site_id !== "MLM" ||
    !seller.tags?.includes("test_user")) throw Error("Vendedor inesperado");

const key = randomUUID();
const reference = "qa-app-check:" + key;
console.log("QA_REFERENCE", reference);
const offer = await request("/preapproval", "POST", {
  external_reference: reference, payer_email: buyer, reason: "QA DEV - verificación de aplicación",
  status: "pending", back_url: "https://" + env.VERCEL_BRANCH_URL + "/plan",
  auto_recurring: {frequency: 1, frequency_type: "months", transaction_amount: 49, currency_id: "MXN"},
}, key);
if (!/^[a-f0-9]{32}$/i.test(offer.id) || offer.external_reference !== reference) throw Error("Referencia inesperada");
const path = "/preapproval/" + offer.id;
console.log("QA_RESOURCE", offer.id);
try {
  const current = await request(path);
  console.log("QA_APPLICATION", String(current.application_id), current.status);
  if (String(current.application_id) !== env.MP_V1_APPLICATION_ID ||
      String(current.collector_id) !== env.MP_V1_COLLECTOR_ID || current.status !== "pending") throw Error("Contrato inesperado");
} finally {
  await request(path, "PUT", {status:"cancelled"});
  const closed = await request(path);
  if (closed.status !== "cancelled") throw Error("Cancelación pendiente");
  console.log("QA_CLOSED", closed.status);
}
