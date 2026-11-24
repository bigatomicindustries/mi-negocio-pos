-- DEV. Use one transaction. All fixtures (including the test auth user) roll back.
begin;
do $test$
declare
  admin_id uuid := gen_random_uuid(); biz uuid := gen_random_uuid(); orig uuid;
  price public.billing_prices%rowtype; other_price uuid; attempt jsonb; cid uuid; remote text;
  earlier timestamptz := now() - interval '1 hour'; later timestamptz := now();
  tier_count integer := 0;
begin
  if (select count(*) from public.billing_prices where version='v1') <> 6 then raise exception 'catalog count'; end if;
  if exists (
    (select tier,interval_months,amount_cents,currency,vat_included from public.billing_prices where version='v1')
    except values ('basic',1,4900,'MXN',true),('basic',12,49900,'MXN',true),
      ('pro',1,9900,'MXN',true),('pro',12,99900,'MXN',true),
      ('business',1,19900,'MXN',true),('business',12,199900,'MXN',true)
  ) then raise exception 'catalog drift'; end if;
  if exists (select from pg_class c cross join (values ('anon'),('authenticated')) r(role_name)
    where c.relnamespace='public'::regnamespace and c.relname in ('billing_prices','billing_contracts','billing_invoices')
    and (not c.relrowsecurity or has_table_privilege(r.role_name,c.oid,'SELECT,INSERT,UPDATE,DELETE'))) then
    raise exception 'client table privileges'; end if;
  if exists (select from pg_proc p cross join (values ('anon'),('authenticated')) r(role_name)
    where p.pronamespace='public'::regnamespace and p.proname like 'billing_%'
    and (p.prosecdef or has_function_privilege(r.role_name,p.oid,'EXECUTE')
         or not has_function_privilege('service_role',p.oid,'EXECUTE'))) then raise exception 'RPC privileges'; end if;
  if has_table_privilege('service_role','public.billing_prices','UPDATE,DELETE,INSERT') then raise exception 'mutable prices'; end if;

  select id into strict orig from public.plans where slug='free';
  insert into public.businesses(id,name,slug) values(biz,'Fixture pricing','qa-'||biz);
  insert into auth.users(id) values(admin_id);
  insert into public.profiles(id,full_name,role,business_id) values(admin_id,'Fixture pricing','admin',biz);
  insert into public.subscriptions(business_id,plan_id) values(biz,orig);

  execute 'set local role service_role';
  for price in select * from public.billing_prices where version='v1' loop
    update public.subscriptions set plan_id=orig, status='active', mercadopago_subscription_id=null where business_id=biz;
    begin
      perform public.billing_begin(gen_random_uuid(),biz,price.id);
      raise exception 'unexpected actor accepted';
    exception when sqlstate 'PT403' then null; end;
    update public.subscriptions set mercadopago_subscription_id='fixture-legacy' where business_id=biz;
    begin
      perform public.billing_begin(admin_id,biz,price.id);
      raise exception 'legacy contract replaced';
    exception when sqlstate 'PT409' then null; end;
    update public.subscriptions set mercadopago_subscription_id=null where business_id=biz;
    attempt := public.billing_begin(admin_id,biz,price.id);
    cid := (attempt->>'id')::uuid; remote := 'qa-'||cid;
    if (attempt->>'create_remote')::boolean is not true then raise exception 'missing create'; end if;
    attempt := public.billing_begin(admin_id,biz,price.id);
    if (attempt->>'id')::uuid<>cid or (attempt->>'create_remote')::boolean then raise exception 'duplicate checkout'; end if;
    select id into other_price from public.billing_prices where id<>price.id limit 1;
    begin
      perform public.billing_begin(admin_id,biz,other_price);
      raise exception 'overlapping quote';
    exception when sqlstate 'PT409' then null; end;
    perform public.billing_reconcile(cid,remote,0,'pending',price.amount_cents,'MXN',price.interval_months,null);
    if not exists(select from public.subscriptions where business_id=biz and plan_id=orig and mercadopago_subscription_id is null) then
      raise exception 'premature activation'; end if;
    begin
      perform public.billing_reconcile(cid,remote,1,'authorized',price.amount_cents+1,'MXN',price.interval_months,null);
      raise exception 'amount mismatch';
    exception when sqlstate 'PT409' then null; end;
    begin
      perform public.billing_reconcile(cid,remote,1,'authorized',price.amount_cents,'USD',price.interval_months,null);
      raise exception 'currency mismatch';
    exception when sqlstate 'PT409' then null; end;
    begin
      perform public.billing_reconcile(cid,remote,1,'authorized',price.amount_cents,'MXN',2,null);
      raise exception 'interval mismatch';
    exception when sqlstate 'PT409' then null; end;
    perform public.billing_reconcile(cid,remote,1,'authorized',price.amount_cents,'MXN',price.interval_months,later);
    if not exists(select from public.subscriptions where business_id=biz and plan_id=price.plan_id and status='active'
      and current_period_ends_at=later and mercadopago_subscription_id=remote) then raise exception 'activation'; end if;
    perform public.billing_record_invoice(cid,remote,remote,price.amount_cents,'MXN','processed','p1','approved',later);
    perform public.billing_record_invoice(cid,remote,remote,price.amount_cents,'MXN','scheduled',null,null,earlier);
    perform public.billing_record_invoice(cid,remote,remote,price.amount_cents,'MXN','processed','p1','approved',later);
    if (select count(*) from public.billing_invoices where contract_id=cid and payment_status='approved')<>1 then raise exception 'invoice replay'; end if;
    perform public.billing_reconcile(cid,remote,2,'paused',price.amount_cents,'MXN',price.interval_months,null);
    perform public.billing_reconcile(cid,remote,1,'authorized',price.amount_cents,'MXN',price.interval_months,later);
    if not exists(select from public.subscriptions where business_id=biz and status='past_due') then raise exception 'stale event'; end if;
    perform public.billing_reconcile(cid,remote,3,'cancelled',price.amount_cents,'MXN',price.interval_months,null);
    if not exists(select from public.subscriptions where business_id=biz and status='cancelled') then raise exception 'cancellation'; end if;
    tier_count := tier_count+1;
  end loop;
  if tier_count<>6 then raise exception 'six modes required'; end if;
end $test$;
select 'PASS: six offers, permissions, grandfathering, replay, invoice and lifecycle' as result;
rollback;
