// Read-only provider checks for the pricing-v1 Preview. No customer data is logged.
if (process.env.VERCEL_ENV !== "preview" ||
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
