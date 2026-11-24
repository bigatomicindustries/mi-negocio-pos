import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingInterval, CommercialPlan } from "./pricing-v1";

export type Price = { id: string; tier: CommercialPlan; amount_cents: number; interval_months: number; currency: string; vat_included: boolean };
export type RemoteAgreement = {
  id: string; version: number; external_reference: string; collector_id: number; application_id: number;
  status: string; next_payment_date?: string; init_point?: string;
  auto_recurring?: { transaction_amount: number | string; currency_id: string; frequency: number; frequency_type: string };
};
export type Invoice = {
  id: number; preapproval_id: string; currency_id: string; transaction_amount: string | number;
  status: string; last_modified: string; payment?: { id: number; status: string } | null;
};
export class BillingError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
export const providerId = /^[a-zA-Z0-9_-]{1,100}$/;
export const months = (interval: BillingInterval) => interval === "annual" ? 12 : 1;

export function cents(value: unknown) {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d+(\.\d{1,2})?$/.test(String(value))) return -1;
  const [whole, fraction = ""] = String(value).split(".");
  const total = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(total) ? total : -1;
}

export function checkoutPayload(id: string, email: string, price: Price, label: string, origin: string) {
  return {
    external_reference: "mn-v1:" + id, payer_email: email, reason: "Mi Negocio " + label,
    back_url: new URL("/plan?checkout_v1=" + id, origin).href, status: "pending",
    auto_recurring: { frequency: price.interval_months, frequency_type: "months",
      transaction_amount: price.amount_cents / 100, currency_id: price.currency },
  };
}

export function checkAgreement(remote: RemoteAgreement, id: string, collector: string, app: string) {
  if (remote.id !== id || !providerId.test(id) || String(remote.collector_id) !== collector ||
      String(remote.application_id) !== app || !remote.external_reference?.startsWith("mn-v1:")) {
    throw new BillingError(409, "El contrato no corresponde a esta aplicación.");
  }
  const contract = remote.external_reference.slice(6);
  if (!uuid.test(contract) || !Number.isSafeInteger(remote.version) || remote.version < 0 ||
      remote.auto_recurring?.frequency_type !== "months" || ![1,12].includes(remote.auto_recurring.frequency)) {
    throw new BillingError(409, "La referencia o periodicidad del contrato es inválida.");
  }
  return contract;
}
export function checkoutLink(remote: RemoteAgreement) {
  const url = URL.canParse(remote.init_point ?? "") ? new URL(remote.init_point!) : null;
  if (!url || url.protocol !== "https:" || url.port || url.username || url.password ||
      !["www.mercadopago.com.mx", "sandbox.mercadopago.com.mx", "www.mercadopago.com", "sandbox.mercadopago.com"].includes(url.hostname) ||
      url.pathname !== "/subscriptions/checkout" || url.searchParams.get("preapproval_id") !== remote.id) {
    throw new BillingError(502, "El enlace de Mercado Pago no corresponde al contrato.");
  }
  return url.href;
}
export function verifyWebhook(signature: string | null, requestId: string | null, id: string, secret: string) {
  if (!signature || !requestId || !providerId.test(id) || !secret) return false;
  const parts = Object.fromEntries(signature.split(",").map(part => part.trim().split("=")));
  if (!/^\d+$/.test(parts.ts ?? "") || !/^[a-f\d]{64}$/i.test(parts.v1 ?? "")) return false;
  const manifest = `id:${id.toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  return timingSafeEqual(createHmac("sha256", secret).update(manifest).digest(), Buffer.from(parts.v1, "hex"));
}
