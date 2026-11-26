import { PRICING, PRICING_VERSION, PRICING_CURRENCY, type CommercialPlan } from "@/lib/pricing-v1";
import { BillingError, checkoutLink, checkoutPayload, months, type Price, type RemoteAgreement } from "@/lib/billing-provider";
import { billingActor, billingConfig, billingDatabaseMatches, billingFailure, dbFailure, mpRead, mpRequest, readAgreement, recoverAgreementId, reconcile, salesEnabled } from "@/lib/billing-server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET() {
  let catalogReady = false;
  if (billingDatabaseMatches()) {
    const { data, error } = await supabaseAdmin.from("billing_prices").select("tier,interval_months,amount_cents,currency,vat_included")
      .eq("version", PRICING_VERSION);
    catalogReady = !error && data?.length === 6 && (Object.keys(PRICING) as CommercialPlan[]).every(tier =>
      (["monthly", "annual"] as const).every(interval => data.some(price =>
        price.tier === tier && price.interval_months === months(interval) && price.currency === PRICING_CURRENCY &&
        price.vat_included === true && price.amount_cents === PRICING[tier][interval])));
  }
  return Response.json({ enabled: catalogReady && salesEnabled(), catalog_ready: catalogReady }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    if (!salesEnabled()) throw new BillingError(503, "La contratación todavía no está habilitada.");
    const actor = await billingActor(request);
    const body = await request.json().catch(() => null);
    if (typeof body?.plan !== "string" || !Object.hasOwn(PRICING, body.plan) ||
        (body.interval !== "annual" && body.interval !== "monthly")) throw new BillingError(400, "Selecciona plan y periodicidad.");
    const tier = body.plan as CommercialPlan;
    const interval = body.interval as "monthly" | "annual";
    const { data, error } = await supabaseAdmin.from("billing_prices").select("*")
      .eq("version", PRICING_VERSION).eq("tier", tier).eq("interval_months", months(interval)).single();
    const price = data as Price | null;
    if (error || !price || price.amount_cents !== PRICING[tier][interval] ||
        !price.vat_included || price.currency !== PRICING_CURRENCY) {
      throw new BillingError(503, "La tarifa seleccionada no está disponible.");
    }
    const config = billingConfig();
    if (config.dev && !config.token.startsWith("TEST-")) {
      const seller = await mpRead<{ id: number; tags: string[] }>("/users/me");
      if (String(seller.id) !== config.collector || !seller.tags?.includes("test_user")) {
        throw new BillingError(503, "Preview requiere una cuenta de prueba de Mercado Pago.");
      }
    }
    const attempt = await supabaseAdmin.rpc("billing_begin", { p_actor: actor.id, p_business: actor.business, p_price: price.id });
    if (attempt.error) dbFailure(attempt.error);
    const { id, provider_id, create_remote } = attempt.data;
    if (!create_remote) {
      const resolvedId = provider_id ?? await recoverAgreementId(actor.email, id);
      const existing = await readAgreement(resolvedId);
      const state = await reconcile(existing, resolvedId, id);
      if (state.status !== "pending") throw new BillingError(409, "Esta contratación ya cambió de estado. Actualiza tu plan.");
      return Response.json({ success: true, checkout_id: id, checkout_url: checkoutLink(existing) });
    }

    const payload = checkoutPayload(id, actor.email, price, PRICING[tier].name, config.origin);
    const response = await mpRequest("/preapproval", { method: "POST",
      headers: { "X-Idempotency-Key": id }, body: JSON.stringify(payload) });
    if (!response.ok) {
      // An ambiguous outcome must never trigger a second charge agreement.
      if ([400, 401, 403, 422].includes(response.status)) {
        const closed = await supabaseAdmin.from("billing_contracts").update({ status: "failed" })
          .eq("id", id).eq("status", "creating").is("provider_id", null);
        if (closed.error) dbFailure(closed.error);
      }
      throw new BillingError(502, "Mercado Pago no pudo iniciar la contratación.");
    }
    const remote = await response.json() as RemoteAgreement;
    await reconcile(remote, remote.id, id);
    return Response.json({ success: true, checkout_id: id, checkout_url: checkoutLink(remote) });
  } catch (e) { return billingFailure(e); }
}
