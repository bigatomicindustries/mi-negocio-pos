// Read-only routing diagnostics for a single subscription payment in the isolated DEV business.
const env = process.env;
if (env.VERCEL_ENV !== "preview" || env.VERCEL_GIT_COMMIT_REF !== "feature/pricing-v1" ||
    env.NEXT_PUBLIC_SUPABASE_URL !== "https://pablbrladwjuczhazsms.supabase.co") throw Error("Solo DEV");

const [agreementId, paymentId] = process.argv.slice(2);
if (!/^[a-f0-9]{32}$/.test(agreementId ?? "") || !/^\d+$/.test(paymentId ?? "")) throw Error("IDs inválidos");
const {createClient} = await import("@supabase/supabase-js");
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const {data:local, error} = await db.from("billing_contracts")
  .select("id,businesses!inner(slug),billing_invoices!inner(payment_id)")
  .eq("provider_id", agreementId).eq("businesses.slug","qa-pricing-v1-webhook-mx")
  .eq("billing_invoices.payment_id",paymentId).single();
if (error || !local) throw Error("Pago ajeno al negocio de QA");

async function read(path) {
  const response = await fetch("https://api.mercadopago.com" + path, {
    headers: { Authorization: "Bearer " + env.MP_V1_ACCESS_TOKEN }, redirect:"error", signal:AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error("Lectura del proveedor HTTP " + response.status);
  return response.json();
}
const [agreement,payment] = await Promise.all([read("/preapproval/"+agreementId),read("/v1/payments/"+paymentId)]);
if (agreement.external_reference !== "mn-v1:"+local.id || String(payment.id) !== paymentId ||
    String(agreement.collector_id) !== env.MP_V1_COLLECTOR_ID) throw Error("Recurso inesperado");

const receiver = "https://mi-negocio-mp-webhook-dev.vercel.app/api/mercadopago/v1/webhook";
function destination(resource) {
  if (!Object.hasOwn(resource, "notification_url")) return "field_absent";
  if (!resource.notification_url) return "empty";
  try {
    const url = new URL(resource.notification_url);
    return url.origin + url.pathname === receiver ? "dev_receiver" : "other_destination";
  } catch { return "unrecognized"; }
}
console.log("QA_DELIVERY", JSON.stringify({
  agreement_app_matches:String(agreement.application_id) === env.MP_V1_APPLICATION_ID,
  agreement_status:agreement.status, agreement_callback:destination(agreement),
  payment_status:payment.status, payment_live_mode:payment.live_mode ?? null, payment_callback:destination(payment),
  payment_app_matches:payment.application_id == null ? null : String(payment.application_id) === env.MP_V1_APPLICATION_ID,
}));
