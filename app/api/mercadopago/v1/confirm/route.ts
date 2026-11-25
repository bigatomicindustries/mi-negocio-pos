import { BillingError, uuid, providerId } from "@/lib/billing-provider";
import { billingActor, billingConfig, billingFailure, confirmAgreement } from "@/lib/billing-server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(request: Request) {
  try {
    billingConfig();
    const actor = await billingActor(request);
    const body = await request.json().catch(() => null);
    if (typeof body?.checkout_id !== "string" || !uuid.test(body.checkout_id)) throw new BillingError(400, "Contratación inválida.");
    const { data, error } = await supabaseAdmin.from("billing_contracts").select("id, provider_id")
      .eq("id", body.checkout_id).eq("business_id", actor.business).eq("requested_by", actor.id).maybeSingle();
    if (error) throw error;
    if (!data) throw new BillingError(404, "No encontramos esta contratación.");
    const id = data.provider_id ?? body.preapproval_id;
    if (!id || typeof id !== "string" || !providerId.test(id) || (body.preapproval_id && body.preapproval_id !== id)) {
      throw new BillingError(409, "No se pudo comprobar la referencia de Mercado Pago.");
    }
    const result = await confirmAgreement(id, data.id);
    return Response.json({ success: true, status: result.status });
  } catch (e) { return billingFailure(e); }
}
