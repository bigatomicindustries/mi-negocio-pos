alter table public.crm_catalogo add column eliminado_at timestamptz;

-- Keep historical records out of catalog reads, including archived items and photo lookups.
create policy catalogo_visible on public.crm_catalogo as restrictive
  for all to authenticated using (eliminado_at is null);

drop index public.crm_catalogo_sku;
create unique index crm_catalogo_sku on public.crm_catalogo(business_id,lower(trim(sku)))
  where trim(sku) <> '' and eliminado_at is null;

create function public.crm_catalogo_eliminar(articulo uuid, version_esperada timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.crm_catalogo c set eliminado_at=clock_timestamp(), activo=false
  where c.id=articulo and c.updated_at=version_esperada and c.eliminado_at is null
    and c.business_id=public.current_business_id()
    and exists (select 1 from public.crm_acceso_negocios a where a.business_id=c.business_id and a.habilitado)
    and coalesce(public.my_trial_end()>now(),true);
  return found;
end;
$$;
revoke all on function public.crm_catalogo_eliminar(uuid,timestamptz) from public,anon;
grant execute on function public.crm_catalogo_eliminar(uuid,timestamptz) to authenticated;
