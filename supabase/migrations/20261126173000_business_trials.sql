-- Existing businesses keep their subscription. Enrollment starts with newly created businesses.
create schema if not exists pos_private;
revoke all on schema pos_private from public, anon, authenticated;
create table pos_private.business_trials (
 business_id uuid primary key references public.businesses on delete cascade,
 owner_id uuid unique,
 activated_at timestamptz,
 welcomed_at timestamptz
);

create function pos_private.new_business() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into pos_private.business_trials(business_id) values (new.id);
 insert into public.crm_acceso_negocios(business_id,habilitado) values(new.id,true)
 on conflict (business_id) do update set habilitado=true;
 return new;
end $$;
create trigger pos_trial_new_business after insert on public.businesses for each row execute function pos_private.new_business();

create function pos_private.link_founder() returns trigger language plpgsql security definer set search_path='' as $$
declare confirmed timestamptz;
begin
 if new.role='admin' and exists(select from pos_private.business_trials where business_id=new.business_id and owner_id is null) then
  select email_confirmed_at into confirmed from auth.users where id=new.id for update;
  update pos_private.business_trials set owner_id=new.id,activated_at=confirmed where business_id=new.business_id and owner_id is null;
 end if;
 return new;
end $$;
create trigger pos_trial_founder after insert or update of role,business_id on public.profiles for each row execute function pos_private.link_founder();

create function pos_private.email_verified() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update pos_private.business_trials set activated_at=new.email_confirmed_at where owner_id=new.id and activated_at is null;
 return new;
end $$;
create trigger pos_trial_email after update of email_confirmed_at on auth.users for each row
 when (old.email_confirmed_at is null and new.email_confirmed_at is not null) execute function pos_private.email_verified();

create function pos_private.trial_end(tenant uuid) returns timestamptz language sql stable security definer set search_path='' as $$
 select t.activated_at + interval '720 hours' from pos_private.business_trials t
 where t.business_id=tenant and not exists (
 select from public.subscriptions s join public.plans p on p.id=s.plan_id
 where s.business_id=tenant and p.slug <> 'free' and p.active and s.status in ('active','trialing','past_due'))
$$;
create function public.my_trial_end() returns timestamptz language sql stable security definer set search_path='' as $$
 select pos_private.trial_end(public.current_business_id())
$$;
create function public.claim_trial_welcome() returns boolean language plpgsql security definer set search_path='' as $$
begin
 update pos_private.business_trials set welcomed_at=now() where business_id=public.current_business_id()
 and owner_id=auth.uid() and welcomed_at is null and pos_private.trial_end(business_id)>now();
 return found;
end $$;
revoke all on function public.my_trial_end(),public.claim_trial_welcome() from public,anon;
grant execute on function public.my_trial_end(),public.claim_trial_welcome() to authenticated;

-- Block tenant writes including server-side imports and device synchronization.
create function pos_private.guard_trial_write() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb; tenant uuid; sides jsonb[];
begin
 if tg_op='DELETE' then sides:=array[to_jsonb(old)];
 elsif tg_op='UPDATE' then sides:=array[to_jsonb(old),to_jsonb(new)];
 else sides:=array[to_jsonb(new)]; end if;
 foreach row_data in array sides loop
  if tg_nargs=2 then
   execute format('select business_id from public.%I where id=$1',tg_argv[1]) into tenant using (row_data->>tg_argv[0])::uuid;
  else tenant:=(row_data->>tg_argv[0])::uuid; end if;
  if pos_private.trial_end(tenant)<=statement_timestamp() then
   raise exception 'La prueba terminó. Puedes consultar y descargar tus datos. Contrata un plan para volver a operar.' using errcode='42501';
  end if;
 end loop;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
do $$
declare rel text;
begin
 foreach rel in array array['branch_inventory','branches','business_payment_settings','cash_movements','cash_sessions','crm_contactos','crm_negocio_actividades','crm_negocio_oportunidades','device_catalog_prices','device_catalog_syncs','inventory_movements','inventory_transfers','mercadopago_connections','offline_sale_conflicts','pos_device_pairing_tokens','pos_devices','pos_mobile_cash_session_links','pos_mobile_inventory_reconciliations','pos_mobile_product_links','pos_mobile_sync_operations','product_price_versions','products','profile_branches','profiles','purchase_items','purchase_return_items','purchase_returns','purchases','sale_items','sale_returns','sales','suppliers'] loop
 execute format('create trigger pos_trial_guard before insert or update or delete on public.%I for each row execute function pos_private.guard_trial_write(''business_id'')',rel);
 end loop;
end $$;
create trigger pos_trial_guard before update or delete on public.businesses for each row execute function pos_private.guard_trial_write('id');
create trigger pos_trial_guard before insert or update or delete on public.crm_contacto_medios for each row execute function pos_private.guard_trial_write('contacto_id','crm_contactos');
create trigger pos_trial_guard before insert or update or delete on public.crm_negocio_tareas for each row execute function pos_private.guard_trial_write('oportunidad_id','crm_negocio_oportunidades');
create trigger pos_trial_guard before insert or update or delete on public.sale_return_items for each row execute function pos_private.guard_trial_write('return_id','sale_returns');
create trigger pos_trial_guard before insert or update or delete on public.inventory_transfer_items for each row execute function pos_private.guard_trial_write('transfer_id','inventory_transfers');

insert into public.crm_acceso_negocios(business_id,habilitado)
select id,true from public.businesses on conflict(business_id) do update set habilitado=true;

-- Preserve every tenant, membership, active-business and platform check; remove the old CRM role filter.
do $$
declare r record; role_filter constant text := ' AND (p.role = ANY (ARRAY[''admin''::text, ''manager''::text]))'; ddl text;
begin
 for r in select * from pg_policies where schemaname='public' and tablename in ('crm_acceso_negocios','crm_contactos','crm_negocio_actividades','crm_negocio_oportunidades','crm_negocio_tareas')
 and (strpos(qual,role_filter)>0 or strpos(with_check,role_filter)>0) loop
 execute format('alter policy %I on public.%I%s%s',r.policyname,r.tablename,
 coalesce(' using (' || replace(r.qual,role_filter,'') || ')',''),
 coalesce(' with check (' || replace(r.with_check,role_filter,'') || ')',''));
 end loop;
 select pg_get_functiondef(oid) into strict ddl from pg_proc where pronamespace='public'::regnamespace and proname='crm_guardar_contacto_negocio';
 if strpos(ddl,' and p.role in (''admin'',''manager'')')=0 then raise exception 'Unexpected CRM function'; end if;
 execute replace(ddl,' and p.role in (''admin'',''manager'')','');
end $$;
