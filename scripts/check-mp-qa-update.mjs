// Exercise a signed provider event on the isolated paid QA checkout, without changing billing terms.
import { createClient } from "@supabase/supabase-js";
const env = process.env;
if (env.VERCEL_ENV !== "preview" || env.VERCEL_GIT_COMMIT_REF !== "feature/pricing-v1" ||
    env.NEXT_PUBLIC_SUPABASE_URL !== "https://pablbrladwjuczhazsms.supabase.co" ||
    env.MP_V1_APPLICATION_ID !== "1373270036164371") throw Error("Solo Preview DEV");
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const id = "df9cb364452d4608b8d2072769db732e";
async function local() {
  const {data,error} = await db.from("billing_contracts").select("id,status,provider_version,businesses!inner(slug)")
    .eq("provider_id",id).eq("businesses.slug","qa-pricing-v1-webhook-mx").single();
  if (error) throw Error("Contrato QA no disponible");
  return data;
}
async function remote(reason) {
  const response = await fetch("https://api.mercadopago.com/preapproval/"+id, {
    method:reason ? "PUT" : "GET", redirect:"error",signal:AbortSignal.timeout(12000),
    headers:{Authorization:"Bearer "+env.MP_V1_ACCESS_TOKEN,"Content-Type":"application/json"},
    body:reason ? JSON.stringify({reason}) : undefined
  });
  if (!response.ok) throw Error("Mercado Pago HTTP "+response.status);
  return response.json();
}
const first = await local();
const original = await remote();
if (original.external_reference !== "mn-v1:"+first.id || original.status !== "authorized" ||
    String(original.application_id) !== env.MP_V1_APPLICATION_ID || original.reason !== "Mi Negocio Básico")
  throw Error("Contrato inesperado");
async function observe(reason, previous) {
  const data = await remote(reason);
  const version = Date.parse(data.last_modified);
  if (!(version > previous) || data.reason !== reason) throw Error("Actualización no verificada");
  for (let i=0;i<24;i++) {
    const row = await local();
    if (Number(row.provider_version) === version && row.status === "authorized") {
      console.log("QA_WEBHOOK_VERSION",version,"observed"); return version;
    }
    await new Promise(resolve=>setTimeout(resolve,2500));
  }
  console.log("QA_WEBHOOK_VERSION",version,"unobserved");
  return version;
}
try {
  await observe(original.reason+" QA",Date.parse(original.last_modified));
} finally {
  await observe(original.reason,Date.parse(original.last_modified));
}
