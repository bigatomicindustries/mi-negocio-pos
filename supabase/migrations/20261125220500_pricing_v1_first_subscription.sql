create or replace function public.billing_begin(p_actor uuid, p_business uuid, p_price uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  s public.subscriptions%rowtype;
  c public.billing_contracts%rowtype;
begin
  if not exists (select from public.profiles p join public.businesses b on b.id=p.business_id
                 where p.id=p_actor and p.business_id=p_business and p.active and p.role='admin' and b.active) then
    raise sqlstate 'PT403' using message='Administrador de negocio requerido';
  end if;
  -- A business may reach checkout before it has any subscription row.
  perform 1 from public.businesses where id=p_business for no key update;
  select * into s from public.subscriptions where business_id=p_business for update;
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
create or replace function public.billing_reconcile(p_contract uuid, p_provider text, p_version bigint,
  p_status text, p_cents integer, p_currency text, p_months integer, p_next timestamptz)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  s public.subscriptions%rowtype;
  c public.billing_contracts%rowtype;
  price public.billing_prices%rowtype;
  linked boolean;
begin
  perform 1 from public.businesses b join public.billing_contracts c0
    on c0.business_id=b.id where c0.id=p_contract for no key update of b;
  select s0.* into s from public.subscriptions s0 join public.billing_contracts c0
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
  if p_status='authorized' and s.id is null then
    insert into public.subscriptions(business_id,plan_id,mercadopago_subscription_id,current_period_ends_at)
      values(c.business_id,price.plan_id,p_provider,p_next)
      on conflict (business_id) do nothing;
    select * into strict s from public.subscriptions where business_id=c.business_id for update;
  end if;
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
