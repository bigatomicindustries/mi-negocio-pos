// Explicit reconciliation of one provider contract belonging to the isolated DEV business.
import { registerHooks } from "node:module";
if (process.env.VERCEL_ENV !== "preview" || process.env.VERCEL_GIT_COMMIT_REF !== "feature/pricing-v1" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !== "https://pablbrladwjuczhazsms.supabase.co") throw Error("Solo Preview de QA");
registerHooks({resolve(name, ctx, next) {
  if (name.startsWith("@/")) return next(new URL("../"+name.slice(2)+".ts",import.meta.url).href,ctx);
  if (name.startsWith("./billing-") && ctx.parentURL?.endsWith(".ts")) return next(name+".ts",ctx);
  return next(name,ctx);
}});
const {supabaseAdmin:db}=await import("../lib/supabaseAdmin.ts");
const {readAgreement,reconcile,recordInvoice,mpRead,confirmAgreement}=await import("../lib/billing-server.ts");
if (process.argv.includes("--inspect-offers") || process.argv.includes("--confirm-offers")) {
  const slugs = ["basic-annual","pro-monthly","pro-annual","business-monthly","business-annual"]
    .map(offer => "qa-pricing-v1-" + offer);
  const {data, error} = await db.from("billing_contracts")
    .select("id,provider_id,businesses!inner(slug),billing_prices!inner(amount_cents,interval_months)")
    .in("businesses.slug", slugs).eq("status", "authorized");
  if (error || data.length !== 5) throw Error("Se esperaban cinco contratos de QA autorizados");
  for (const contract of data) {
    const agreement = await readAgreement(contract.provider_id);
    if (agreement.external_reference !== "mn-v1:" + contract.id ||
        String(agreement.application_id) !== process.env.MP_V1_APPLICATION_ID ||
        String(agreement.collector_id) !== process.env.MP_V1_COLLECTOR_ID) throw Error("Contrato de QA inesperado");
    if (process.argv.includes("--confirm-offers")) {
      const verified = await confirmAgreement(contract.provider_id, contract.id);
      if (verified.status !== "authorized") throw Error("Estado inesperado tras confirmar");
    }
    const result = await mpRead("/authorized_payments/search?preapproval_id=" + encodeURIComponent(contract.provider_id));
    console.log("QA_CUOTAS", contract.businesses.slug, result.results.length);
    for (const row of result.results) {
      const invoice = await mpRead("/authorized_payments/" + encodeURIComponent(row.id));
      if (invoice.preapproval_id !== agreement.id || String(invoice.id) !== String(row.id)) throw Error("Cuota ajena");
      console.log("QA_CUOTA", contract.businesses.slug, invoice.status, invoice.payment?.status,
        invoice.transaction_amount, invoice.currency_id, invoice.payment?.id ?? "sin_pago");
    }
  }
  process.exit(0);
}
const id=process.argv[2];
const {data:business,error}=await db.from("businesses").select("id").eq("slug","qa-pricing-v1-mp-mx").single();
if(error) throw Error("Negocio de prueba no disponible");
const local=await db.from("billing_contracts").select("id").eq("business_id",business.id).eq("provider_id",id).single();
if(local.error) throw Error("El contrato no pertenece a QA");
const remote=await readAgreement(id);
const result=await reconcile(remote,id,local.data.id);
console.log("QA_CONTRACT",result.status);
const invoices=await mpRead("/authorized_payments/search?preapproval_id="+encodeURIComponent(id));
for(const invoice of invoices.results){
  if(invoice.preapproval_id!==id) throw Error("Cuota ajena");
  const full=await mpRead("/authorized_payments/"+encodeURIComponent(invoice.id));
  if(full.preapproval_id!==id || String(full.id)!==String(invoice.id)) throw Error("Referencia de cuota distinta");
  console.log("QA_INVOICE",full.status,full.payment?.status,full.payment?.status_detail,full.transaction_amount);
  await recordInvoice(full);
}
console.log("QA_COUNT",invoices.results.length);
