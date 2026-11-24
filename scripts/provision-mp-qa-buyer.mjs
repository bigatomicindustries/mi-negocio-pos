// One explicitly authorized test account. A DEV-only Vault reservation survives retries.
import { createClient } from "@supabase/supabase-js";

const env = process.env;
const dbUrl = "https://pablbrladwjuczhazsms.supabase.co";
if (env.VERCEL_ENV !== "preview" || env.VERCEL_GIT_COMMIT_REF !== "feature/pricing-v1" ||
    env.NEXT_PUBLIC_SUPABASE_URL !== dbUrl || process.argv[2] !== "--create-one" ||
    !env.MP_V1_ACCESS_TOKEN || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Se requiere el entorno de QA.");
const options = {
  headers: { Authorization: "Bearer " + env.MP_V1_ACCESS_TOKEN, "Content-Type": "application/json" },
  redirect: "error",
};
const sellerResponse = await fetch("https://api.mercadopago.com/users/me", {
  ...options, signal: AbortSignal.timeout(10000),
});
const seller = sellerResponse.ok ? await sellerResponse.json() : {};
if (seller.site_id !== "MLM" || !seller.tags?.includes("test_user") ||
    String(seller.id) !== env.MP_V1_COLLECTOR_ID || String(seller.id) !== process.argv[3]) {
  throw new Error("El vendedor debe coincidir con la cuenta de prueba de México.");
}
const admin = createClient(dbUrl, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const reserve = await admin.rpc("qa_pricing_store_buyer", { p_account: null });
if (reserve.error || reserve.data !== true) throw new Error("La creación ya se intentó o falta el permiso de QA.");

const res = await fetch("https://api.mercadopago.com/users/test", {
  ...options, method: "POST", signal: AbortSignal.timeout(15000),
  body: JSON.stringify({ site_id: "MLM", description: "Mi Negocio POS DEV - comprador de suscripciones" }),
});
const account = await res.json().catch(() => ({}));
if (!res.ok) {
  const reason = [account.message, account.error].filter(v => typeof v === "string" &&
    /^[a-zA-Z _.:/-]{1,130}$/.test(v)).join(" / ");
  console.log("MP_QA_CREATE", JSON.stringify({ http: res.status, reason,
    request_id: /^[a-z0-9-]{1,80}$/i.test(res.headers.get("x-request-id") ?? "") ? res.headers.get("x-request-id") : null }));
  throw new Error("El proveedor rechazó la creación del comprador de prueba.");
}
const saved = await admin.rpc("qa_pricing_store_buyer", { p_account: {
  id: account.id, nickname: account.nickname, password: account.password, email: account.email, site_id: account.site_id,
} });
console.log("MP_QA_CREATE", JSON.stringify({ http: res.status, saved: saved.data === true,
  buyer_distinct: account.id != null && String(account.id) !== String(seller.id),
  test_email_present: /^[a-z0-9][a-z0-9._-]*@testuser\.com$/i.test(account.email ?? "") }));
if (saved.error || saved.data !== true) throw new Error("Revisar el registro en Vault antes de reintentar.");
if ((account.site_id && account.site_id !== "MLM") || String(account.id) === String(seller.id) ||
    !/^[a-z0-9][a-z0-9._-]*@testuser\.com$/i.test(account.email ?? "")) {
  throw new Error("Revisar los datos del comprador de prueba guardado en Vault.");
}
process.env.MP_V1_QA_BUYER_EMAIL = account.email;
await import("./test-mp-preview.mjs");
