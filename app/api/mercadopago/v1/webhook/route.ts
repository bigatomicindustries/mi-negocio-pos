import { BillingError, verifyWebhook, type Invoice } from "@/lib/billing-provider";
import { billingConfig, billingFailure, mpRead, readAgreement, reconcile, recordInvoice } from "@/lib/billing-server";

export async function POST(request: Request) {
  try {
    const config = billingConfig();
    const id = new URL(request.url).searchParams.get("data.id") ?? "";
    if (!verifyWebhook(request.headers.get("x-signature"), request.headers.get("x-request-id"), id, config.secret)) {
      throw new BillingError(401, "Firma inválida.");
    }
    const body = await request.json().catch(() => null);
    if (!body || String(body.data?.id) !== id) throw new BillingError(400, "Notificación inválida.");
    if (body.type === "subscription_preapproval") {
      await reconcile(await readAgreement(id), id);
    } else if (body.type === "subscription_authorized_payment") {
      const invoice = await mpRead<Invoice>("/authorized_payments/" + encodeURIComponent(id));
      if (String(invoice.id) !== id) throw new BillingError(409, "Cuota inválida.");
      await recordInvoice(invoice);
    } else if (body.type === "payment") {
      const invoices = await mpRead<{ results: Invoice[] }>("/authorized_payments/search?payment_id=" + encodeURIComponent(id));
      const matching = invoices.results.filter(invoice => String(invoice.payment?.id) === id);
      // The invoice topic independently delivers the canonical recurring payment.
      for (const invoice of matching) await recordInvoice(invoice);
    }
    return Response.json({ received: true });
  } catch (e) { return billingFailure(e); }
}
