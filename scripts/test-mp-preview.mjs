// Explicit, one-off run in the pricing Preview. Never part of the normal build.
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { createClient } from "@supabase/supabase-js";

const env = process.env;
const dbUrl = "https://pablbrladwjuczhazsms.supabase.co";
const email = env.MP_V1_QA_BUYER_EMAIL?.trim().toLowerCase();
if (env.VERCEL_ENV !== "preview" || env.VERCEL_GIT_COMMIT_REF !== "feature/pricing-v1" ||
    env.NEXT_PUBLIC_SUPABASE_URL !== dbUrl || !/^[a-z0-9][a-z0-9._-]*@testuser\.com$/i.test(email ?? "")) {
  throw new Error("Se requiere Preview de pricing-v1, DEV y un comprador de prueba.");
}
registerHooks({ resolve(name, context, next) {
  if (name.startsWith("@/")) return next(new URL("../" + name.slice(2) + ".ts", import.meta.url).href, context);
  if (name.startsWith("./billing-") && context.parentURL?.endsWith(".ts")) return next(name + ".ts", context);
  return next(name, context);
} });

const returnIndex = process.argv.indexOf("--verify-return");
const webhookTest = process.argv.includes("--webhook-checkout") || returnIndex !== -1;
const slug = webhookTest ? "qa-pricing-v1-webhook-mx" : "qa-pricing-v1-mp-mx";
const { billingConfig, mpRead, mpRequest, readAgreement } = await import("../lib/billing-server.ts");
const { checkoutLink, cents } = await import("../lib/billing-provider.ts");
const config = billingConfig();
const seller = await mpRead("/users/me");
if (!config.dev || seller.site_id !== "MLM" || String(seller.id) !== config.collector ||
    (!config.token.startsWith("TEST-") && !seller.tags?.includes("test_user")) ||
    seller.email?.toLowerCase() === email || seller.nickname?.toLowerCase() === email.split("@")[0]) {
  throw new Error("El vendedor y el comprador deben ser cuentas de prueba distintas en México.");
}
const options = {auth:{persistSession:false, autoRefreshToken:false, detectSessionInUrl:false}};
const admin = createClient(dbUrl,env.SUPABASE_SERVICE_ROLE_KEY,options);
const userClient = createClient(dbUrl,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
const unwrap = (result,step) => {
  if (result.error) throw new Error(step + ": " + (result.error.code ?? result.error.status ?? "error"));
  return result.data;
};
const store = unwrap(await admin.from("businesses").select("id").eq("slug",slug).eq("active",true).single(),"negocio de pruebas");

const made = await admin.auth.admin.createUser({
  email, password:randomUUID()+randomUUID(), email_confirm:true, app_metadata:{pricing_qa:store.id},
});
if (made.error && !["email_exists","user_already_exists"].includes(made.error.code)) unwrap(made,"alta de comprador DEV");
if (made.error) {
  const members = unwrap(await admin.from("profiles").select("id").eq("business_id",store.id),"perfiles de prueba");
  let owned = false;
  for (const member of members) {
    const identity = unwrap(await admin.auth.admin.getUserById(member.id),"identidad de prueba").user;
    if (identity.email?.toLowerCase() === email && identity.app_metadata?.pricing_qa === store.id) owned = true;
  }
  if (!owned) throw new Error("La cuenta existente no es un comprador de este negocio de pruebas.");
}
const link = unwrap(await admin.auth.admin.generateLink({type:"magiclink",email}),"sesión efímera de pruebas");
if (link.user.app_metadata?.pricing_qa !== store.id) throw new Error("Este usuario no pertenece al negocio de pruebas.");
const userId = link.user.id;
const profile = unwrap(await admin.from("profiles").select("business_id,role,active").eq("id",userId).maybeSingle(),"perfil");
if (!profile) {
  unwrap(await admin.from("profiles").insert({id:userId,full_name:"Comprador de prueba",role:"admin",business_id:store.id}),"crear perfil");
} else if (profile.business_id !== store.id || profile.role !== "admin" || !profile.active) throw new Error("Perfil de pruebas inesperado.");
const authenticated = unwrap(await userClient.auth.verifyOtp({token_hash:link.properties.hashed_token,type:"magiclink"}),"sesión de comprador");
const headers = {Authorization:"Bearer "+authenticated.session.access_token,"Content-Type":"application/json"};
const post = body => new Request(config.origin,{method:"POST",headers,body:JSON.stringify(body)});
const subscribe = await import("../app/api/mercadopago/subscribe/route.ts");
const confirm = await import("../app/api/mercadopago/v1/confirm/route.ts");

// Reuse the approved checkout. This mode never starts or cancels a subscription.
if (returnIndex !== -1) {
  const providerId = process.argv[returnIndex + 1];
  if (!/^[a-f0-9]{32}$/.test(providerId ?? "")) throw Error("ID de prueba inválido");
  const contract = unwrap(await admin.from("billing_contracts").select("id")
    .eq("business_id",store.id).eq("requested_by",userId).eq("provider_id",providerId).single(),"contrato QA");
  const remote = await readAgreement(providerId);
  const expected = new URL("/plan?checkout_v1=" + contract.id, config.origin);
  if (remote.status !== "authorized" || remote.back_url !== expected.href ||
      String(remote.application_id) !== config.app || String(remote.collector_id) !== config.collector) {
    throw Error("El retorno del proveedor no coincide con el checkout autorizado");
  }
  for (let pass = 1; pass <= 2; pass++) {
    const response = await confirm.POST(post({checkout_id:expected.searchParams.get("checkout_v1")}));
    const data = await response.json();
    if (!response.ok || !data.success || data.status !== "authorized") throw Error("Confirmación QA HTTP " + response.status);
    console.log("QA_RETURN", pass, response.status, data.status);
  }
  const { recordInvoice } = await import("../lib/billing-server.ts");
  const invoices = await mpRead("/authorized_payments/search?preapproval_id=" + providerId);
  if (invoices.results.length !== 1) throw Error("Se esperaba una sola cuota inicial");
  const invoice = await mpRead("/authorized_payments/" + encodeURIComponent(invoices.results[0].id));
  if (invoice.preapproval_id !== providerId || invoice.payment?.status !== "approved" ||
      invoice.currency_id !== "MXN" || cents(invoice.transaction_amount) !== 4900) throw Error("Cuota QA inesperada");
  await recordInvoice(invoice);
  await recordInvoice(invoice);
  console.log("QA_INVOICE_REPLAY", invoice.payment.status);
  process.exitCode = 0;
} else {
// Record provider status codes for troubleshooting. Exclude account data and credentials.
const transport = globalThis.fetch;
globalThis.fetch = async (input,init) => {
  const response = await transport(input,init);
  if (String(input) === "https://api.mercadopago.com/preapproval" && init?.method === "POST") {
    const body = await response.clone().json().catch(()=>({}));
    console.log("MP_QA_PROVIDER",JSON.stringify({http:response.status,
      recurring:!!body.auto_recurring,contract:!!body.id,application_match:String(body.application_id)===config.app,
      collector_match:String(body.collector_id)===config.collector,version:Number.isInteger(body.version),
      causes:(Array.isArray(body.cause)?body.cause:[]).map(item=>String(item.code??"")).filter(code=>/^[a-z0-9_-]{1,32}$/i.test(code)),
      request_id:/^[a-z0-9-]{1,80}$/i.test(response.headers.get("x-request-id")??"")?response.headers.get("x-request-id"):null,
      code:typeof body.error==="string" && /^[a-z_]+$/i.test(body.error)?body.error:null,
      user_bad_request:!response.ok && body.message==="User bad request"}));
  }
  return response;
};
const cases = [
  ["basic","annual",499],["pro","monthly",99],["pro","annual",999],
  ["business","monthly",199],["business","annual",1999],["basic","monthly",49],
];
for (const [plan,interval,total] of cases) {
  if ((webhookTest || process.argv.includes("--basic-monthly")) && (plan!=="basic" || interval!=="monthly")) continue;
  const months = interval === "annual"?12:1;
  const price = unwrap(await admin.from("billing_prices").select("id").eq("version","v1").eq("tier",plan)
    .eq("interval_months",months).single(),"tarifa");
  const closed = unwrap(await admin.from("billing_contracts").select("id").eq("price_id",price.id)
    .eq("business_id",store.id).eq("requested_by",userId).eq("status","cancelled").limit(1),"intentos previos");
  if (closed.length && !(plan==="basic" && interval==="monthly")) continue;
  const res = await subscribe.POST(post({plan,interval}));
  const checkout = await res.json();
  if (!res.ok) throw new Error("checkout " + plan + "/" + interval + " HTTP " + res.status + ": " + checkout.error);
  const contract = unwrap(await admin.from("billing_contracts").select("provider_id,status")
    .eq("id",checkout.checkout_id).eq("business_id",store.id).eq("requested_by",userId).eq("price_id",price.id).single(),"contrato local");
  const remote = await readAgreement(contract.provider_id);
  if (remote.external_reference!=="mn-v1:"+checkout.checkout_id || String(remote.application_id)!==config.app ||
      String(remote.collector_id)!==config.collector || remote.status!=="pending" ||
      remote.auto_recurring?.currency_id!=="MXN" || cents(remote.auto_recurring?.transaction_amount)!==total*100 ||
      remote.auto_recurring?.frequency!==months || remote.auto_recurring.frequency_type!=="months" ||
      checkoutLink(remote)!==checkout.checkout_url) throw new Error("Contrato de prueba inesperado");
  if (webhookTest) {
    console.log("QA_WEBHOOK_CHECKOUT", checkout.checkout_url);
    break;
  }
  const args = { checkout_id:checkout.checkout_id,preapproval_id:remote.id };
  const verified = await confirm.POST(post(args));
  if (!verified.ok || (await verified.json()).status!=="pending") throw new Error("Confirmación pendiente inesperada");
  if (plan==="basic" && interval==="monthly") {
    console.log("MP_QA_OFFER",plan,interval,total,months,"pending");
    continue;
  }
  const cancel = await mpRequest("/preapproval/"+encodeURIComponent(remote.id),
    {method:"PUT",body:JSON.stringify({status:"cancelled"})});
  if (!cancel.ok) throw new Error("No se pudo cerrar el intento pendiente de prueba. HTTP " + cancel.status);
  const done = await confirm.POST(post(args));
  if (!done.ok || (await done.json()).status!=="cancelled") throw new Error("Cancelación de prueba pendiente");
  console.log("MP_QA_OFFER",plan,interval,total,months,"cancelled");
}

}
