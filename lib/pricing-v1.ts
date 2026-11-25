// Public launch prices in MXN cents, VAT included. Legacy contracts are separate.
export const PRICING_VERSION = "v1" as const;
export const PRICING_CURRENCY = "MXN" as const;
export const PRICING = {
  basic: { name: "Básico", monthly: 4900, annual: 49900 },
  pro: { name: "Pro", monthly: 9900, annual: 99900 },
  business: { name: "Business", monthly: 19900, annual: 199900 },
} as const;
export type CommercialPlan = keyof typeof PRICING;
export type BillingInterval = "monthly" | "annual";
export function priceInCents(plan: CommercialPlan, interval: BillingInterval): number {
  return PRICING[plan][interval];
}
