create function pos_private.guard_branch_activation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  branch_limit integer;
begin
  if not new.active or (tg_op = 'UPDATE' and old.active) then return new; end if;
  -- Initial provisioning creates the main branch before the subscription.
  if tg_op = 'INSERT' and new.is_main then return new; end if;
  perform 1 from public.businesses where id = new.business_id for update;
  select least(p.max_branches, 3) into branch_limit
    from public.subscriptions s join public.plans p on p.id = s.plan_id
    where s.business_id = new.business_id and p.active
      and p.slug in ('business','business-v1') and s.status in ('active','trialing','past_due');
  if branch_limit is null then
    raise exception 'Se requiere un plan Business para activar una sucursal adicional.';
  end if;
  if (select count(*) from public.branches where business_id = new.business_id and active) >= branch_limit then
    raise exception 'Has alcanzado el límite de tres sucursales activas.';
  end if;
  return new;
end;
$$;
create trigger business_branch_activation before insert or update of active on public.branches
  for each row execute function pos_private.guard_branch_activation();
