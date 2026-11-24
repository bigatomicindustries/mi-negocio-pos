create index billing_contracts_price_idx on public.billing_contracts(price_id);
create index billing_contracts_actor_idx on public.billing_contracts(requested_by);
create index billing_contracts_business_history_idx on public.billing_contracts(business_id,created_at desc);
create index billing_prices_plan_idx on public.billing_prices(plan_id);
