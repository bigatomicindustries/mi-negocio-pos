import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createSupabaseUserClient } from "@/lib/supabaseUser";
import { BillingError, checkAgreement, cents, providerId, type Invoice, type RemoteAgreement } from "./billing-provider";

export function billingDatabaseMatches() {
  const dev = process.env.VERCEL_ENV !== "production";
  const host = dev ? "pablbrladwjuczhazsms.supabase.co" : "jfprzmxwrkbufsbqwvnc.supabase.co";
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") === "https://" + host;
}

export function billingConfig() {
  const dev = process.env.VERCEL_ENV !== "production";
  const expectedOrigin = dev ? process.env.VERCEL_BRANCH_URL : "pos.mybusiness.mx";
  const origin = expectedOrigin ? "https://" + expectedOrigin : process.env.MP_V1_DEV_ORIGIN;
  const token = process.env.MP_V1_ACCESS_TOKEN;
  const collector = process.env.MP_V1_COLLECTOR_ID;
  const app = process.env.MP_V1_APPLICATION_ID;
  const secret = process.env.MP_V1_WEBHOOK_SECRET;
  if (!origin || !token || !collector || !app || !secret ||
      !billingDatabaseMatches() ||
      (dev && new URL(origin).hostname === "pos.mybusiness.mx")) {
    throw new BillingError(503, "La contratación aún no está habilitada en este entorno.");
  }
  return { origin, token, collector, app, secret, dev };
}
export function salesEnabled() {
  if (process.env.PRICING_V1_SALES_ENABLED !== "true") return false;
  try { billingConfig(); return true; } catch { return false; }
}
export async function billingActor(request: Request) {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) throw new BillingError(401, "Inicia sesión para continuar.");
  const token = auth.slice(7).trim();
  if (!token) throw new BillingError(401, "Sesión inválida.");
  const { data: { user }, error } = await createSupabaseUserClient(token).auth.getUser(token);
  if (error || !user?.email) throw new BillingError(401, "Sesión inválida.");
  const profile = await supabaseAdmin.from("profiles").select("business_id")
    .eq("id", user.id).eq("active", true).eq("role", "admin").maybeSingle();
  if (profile.error) throw profile.error;
  if (!profile.data) throw new BillingError(403, "Se requiere un administrador activo.");
  const business = await supabaseAdmin.from("businesses").select("id")
    .eq("id", profile.data.business_id).eq("active", true).maybeSingle();
  if (business.error) throw business.error;
  if (!business.data) throw new BillingError(403, "El negocio no está disponible.");
  return { id: user.id, email: user.email, business: business.data.id as string };
}

export async function mpRequest(path: string, init?: RequestInit) {
  const { token } = billingConfig();
  return fetch("https://api.mercadopago.com" + path, {
    ...init, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...init?.headers },
    cache: "no-store", signal: AbortSignal.timeout(9000), redirect: "error",
  });
}
export async function mpRead<T>(path: string): Promise<T> {
  const r = await mpRequest(path);
  if (!r.ok) throw new BillingError(503, "No pudimos consultar la operación en Mercado Pago.");
  return r.json();
}
export function dbFailure(e: { code?: string; message: string }): never {
  if (e.code === "PT409" || e.code === "PT403") throw new BillingError(Number(e.code.slice(2)), e.message);
  throw e;
}
export function billingFailure(e: unknown) {
  if (e instanceof BillingError) return Response.json({ error: e.message }, { status: e.status });
  console.error("Error en facturación v1", { code: typeof e === "object" && e && "code" in e ? String(e.code) : "unexpected" });
  return Response.json({ error: "No pudimos completar la operación. Intenta de nuevo." }, { status: 503 });
}
export async function reconcile(remote: RemoteAgreement, id: string, expected?: string) {
  const { collector, app } = billingConfig();
  const contract = checkAgreement(remote, id, collector, app);
  if (expected && contract !== expected) throw new BillingError(409, "La referencia de contratación no coincide.");
  // Mercado Pago may omit version. Use the same provider clock for every state.
  const modified = Date.parse(remote.last_modified);
  if (!Number.isSafeInteger(modified) || modified < 0) throw new BillingError(409, "Fecha de actualización inválida.");
  const recurring = remote.auto_recurring!;
  const { data, error } = await supabaseAdmin.rpc("billing_reconcile", {
    p_contract: contract, p_provider: id, p_version: modified, p_status: remote.status,
    p_cents: cents(recurring.transaction_amount), p_currency: recurring.currency_id,
    p_months: recurring.frequency, p_next: remote.next_payment_date || null,
  });
  if (error) dbFailure(error);
  return { contract, status: data as string };
}
export async function readAgreement(id: string) {
  if (typeof id !== "string" || !providerId.test(id)) throw new BillingError(400, "Referencia inválida.");
  return mpRead<RemoteAgreement>("/preapproval/" + encodeURIComponent(id));
}
export async function recordInvoice(invoice: Invoice) {
  const id = invoice.preapproval_id;
  const remote = await readAgreement(id);
  const { contract } = await reconcile(remote, id);
  const saved = await supabaseAdmin.rpc("billing_record_invoice", {
    p_contract: contract, p_provider: id, p_invoice: String(invoice.id),
    p_cents: cents(invoice.transaction_amount), p_currency: invoice.currency_id,
    p_status: invoice.status, p_payment: invoice.payment?.id ? String(invoice.payment.id) : null,
    p_payment_status: invoice.payment?.status ?? null, p_updated: invoice.last_modified,
  });
  if (saved.error) dbFailure(saved.error);
}


// Recover a lost POST response without issuing another preapproval.
export async function recoverAgreementId(email: string, checkout: string) {
  const search = await mpRead<{ results: RemoteAgreement[] }>("/preapproval/search?payer_email=" + encodeURIComponent(email));
  const matches = search.results.filter(item => item.external_reference === "mn-v1:" + checkout);
  if (matches.length !== 1) throw new BillingError(409, "Tu contratación sigue en verificación. Vuelve a consultar en unos minutos.");
  return matches[0].id;
}
