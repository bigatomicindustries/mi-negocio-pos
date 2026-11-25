-- New sales only. Existing subscription and checkout rows are never backfilled.
-- POS capacity uses the current Free / Pro / Business limits for this stage.
insert into public.plans (name, slug, max_users, max_products, max_branches)
values ('Básico', 'basic-v1', 2, 100, 1), ('Pro', 'pro-v1', 10, 5000, 1),
       ('Business', 'business-v1', 50, 50000, 3);

create table public.billing_prices (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  tier text not null,
  plan_id uuid not null references public.plans(id),
  interval_months smallint not null check (interval_months in (1,12)),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency = 'MXN'),
  vat_included boolean not null check (vat_included),
  unique (version, tier, interval_months)
);

insert into public.billing_prices (version, tier, plan_id, interval_months, amount_cents, currency, vat_included)
select 'v1', s.tier, p.id, s.months, s.cents, 'MXN', true
from (values ('basic',1,4900),('basic',12,49900),('pro',1,9900),
             ('pro',12,99900),('business',1,19900),('business',12,199900)) s(tier,months,cents)
join public.plans p on p.slug = s.tier || '-v1';

create table public.billing_contracts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  requested_by uuid not null references public.profiles(id),
  price_id uuid not null references public.billing_prices(id),
  provider_id text unique,
  provider_version bigint not null default -1,
  status text not null default 'creating' check (status in
    ('creating','failed','pending','authorized','paused','cancelled')),
  created_at timestamptz not null default now()
);
create unique index billing_one_open_contract on public.billing_contracts (business_id)
  where status not in ('cancelled','failed');

create table public.billing_invoices (
  provider_invoice_id text primary key,
  contract_id uuid not null references public.billing_contracts(id),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency = 'MXN'),
  invoice_status text not null,
  payment_status text,
  payment_id text,
  provider_updated_at timestamptz not null
);
create index billing_invoices_contract_idx on public.billing_invoices(contract_id);

alter table public.billing_prices enable row level security;
alter table public.billing_contracts enable row level security;
alter table public.billing_invoices enable row level security;
revoke all on public.billing_prices, public.billing_contracts, public.billing_invoices
  from public, anon, authenticated, service_role;
grant select on public.billing_prices to service_role;
grant select, insert, update on public.billing_contracts, public.billing_invoices to service_role;

-- Lock the existing subscription first in both RPCs. One caller gets permission to POST.
create function public.billing_begin(p_actor uuid, p_business uuid, p_price uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  s public.subscriptions%rowtype;
  c public.billing_contracts%rowtype;
begin
  if not exists (select from public.profiles p join public.businesses b on b.id=p.business_id
                 where p.id=p_actor and p.business_id=p_business and p.active and p.role='admin' and b.active) then
    raise sqlstate 'PT403' using message='Administrador de negocio requerido';
  end if;
  select * into strict s from public.subscriptions where business_id=p_business for update;
  if s.status <> 'cancelled' and (s.mercadopago_subscription_id is not null
    or not exists (select from public.plans where id=s.plan_id and slug='free')) then
    raise sqlstate 'PT409' using message='Ya tienes un contrato vigente';
  end if;
  if exists (select from public.subscription_checkouts where business_id=p_business
             and mercadopago_status='pending' and expires_at>now()) then
    raise sqlstate 'PT409' using message='Hay una contratación anterior pendiente';
  end if;
  select * into c from public.billing_contracts where business_id=p_business and status not in ('cancelled','failed');
  if found then
    if c.price_id<>p_price or c.requested_by<>p_actor or c.status not in ('creating','pending') then
      raise sqlstate 'PT409' using message='Ya hay otra contratación en curso';
    end if;
    return jsonb_build_object('id',c.id,'provider_id',c.provider_id,'create_remote',false);
  end if;
  insert into public.billing_contracts (business_id,requested_by,price_id)
    values (p_business,p_actor,p_price) returning * into c;
  return jsonb_build_object('id',c.id,'create_remote',true);
end $$;

-- Called only with the canonical preapproval fetched by the server. A cancellation
-- before first authorization closes the attempt without touching the original plan.
create function public.billing_reconcile(p_contract uuid, p_provider text, p_version bigint,
  p_status text, p_cents integer, p_currency text, p_months integer, p_next timestamptz)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  s public.subscriptions%rowtype;
  c public.billing_contracts%rowtype;
  price public.billing_prices%rowtype;
  linked boolean;
begin
  select s0.* into strict s from public.subscriptions s0 join public.billing_contracts c0
    on c0.business_id=s0.business_id where c0.id=p_contract for update of s0;
  select * into strict c from public.billing_contracts where id=p_contract for update;
  select * into strict price from public.billing_prices where id=c.price_id;
  if (c.provider_id is not null and c.provider_id is distinct from p_provider)
     or nullif(p_provider,'') is null or p_version is null or p_version<0
     or price.amount_cents is distinct from p_cents or price.currency is distinct from p_currency
     or price.interval_months is distinct from p_months or p_status is null
     or p_status not in ('pending','authorized','paused','cancelled') then
    raise sqlstate 'PT409' using message='El contrato no coincide con Mercado Pago';
  end if;
  if p_version<=c.provider_version or c.status in ('cancelled','failed') then return c.status; end if;
  linked := s.mercadopago_subscription_id is not distinct from p_provider;
  if p_status='authorized' and not linked and
      (s.status<>'cancelled' and (s.mercadopago_subscription_id is not null or not exists
      (select from public.plans where id=s.plan_id and slug='free'))) then
    raise sqlstate 'PT409' using message='Existe otro contrato vigente';
  end if;
  if p_status='authorized' or (linked and p_status in ('paused','cancelled')) then
    update public.subscriptions set plan_id=price.plan_id,
      status=case p_status when 'authorized' then 'active' when 'paused' then 'past_due' else 'cancelled' end,
      starts_at=case when linked then s.starts_at else now() end, trial_ends_at=null,
      current_period_ends_at=coalesce(p_next,case when linked then s.current_period_ends_at end),
      mercadopago_subscription_id=p_provider, mercadopago_plan_id=null,
      mercadopago_payer_email=case when linked then s.mercadopago_payer_email end, updated_at=now()
    where id=s.id;
  end if;
  update public.billing_contracts set provider_id=p_provider, provider_version=p_version, status=p_status where id=c.id;
  return p_status;
end $$;

create function public.billing_record_invoice(p_contract uuid, p_provider text, p_invoice text,
  p_cents integer, p_currency text, p_status text, p_payment text, p_payment_status text, p_updated timestamptz)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select from public.billing_contracts c join public.billing_prices p on p.id=c.price_id
    where c.id=p_contract and c.provider_id=p_provider and p.amount_cents=p_cents and p.currency=p_currency) then
    raise sqlstate 'PT409' using message='La cuota no coincide con el contrato';
  end if;
  insert into public.billing_invoices as i values
    (p_invoice,p_contract,p_cents,p_currency,p_status,p_payment_status,p_payment,p_updated)
    on conflict (provider_invoice_id) do update set invoice_status=excluded.invoice_status,
      payment_status=excluded.payment_status,payment_id=excluded.payment_id,provider_updated_at=excluded.provider_updated_at
    where i.contract_id=excluded.contract_id and i.provider_updated_at<excluded.provider_updated_at;
end $$;

revoke all on function public.billing_begin(uuid,uuid,uuid),
  public.billing_reconcile(uuid,text,bigint,text,integer,text,integer,timestamptz),
  public.billing_record_invoice(uuid,text,text,integer,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.billing_begin(uuid,uuid,uuid),
  public.billing_reconcile(uuid,text,bigint,text,integer,text,integer,timestamptz),
  public.billing_record_invoice(uuid,text,text,integer,text,text,text,text,timestamptz) to service_role;
