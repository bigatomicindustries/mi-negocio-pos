-- CRM 1.0: additive schema changes; apply to DEV first.
-- Existing capture APIs keep writing to their original tables.
alter table public.demo_requests
  add column if not exists whatsapp text,
  alter column email drop not null,
  add column if not exists estado text not null default 'nuevo',
  add column if not exists crm_notas text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.leads add column if not exists crm_notas text;

-- NOT VALID preserves any historical states; all future writes are checked.
alter table public.demo_requests add constraint demo_requests_crm_estado_check
  check (estado in ('nuevo','contactado','demo_agendada','en_negociacion','convertido','descartado')) not valid;
alter table public.leads add constraint leads_crm_estado_check
  check (estado in ('nuevo','contactado','demo_agendada','en_negociacion','convertido','descartado')) not valid;
alter table public.demo_requests add constraint demo_requests_crm_notas_check
  check (char_length(crm_notas) <= 4000) not valid;
alter table public.leads add constraint leads_crm_notas_check
  check (char_length(crm_notas) <= 4000) not valid;

alter table public.demo_requests enable row level security;
alter table public.leads enable row level security;

-- Browser users can read and edit commercial fields only, and only with
-- platform-admin membership. No insert/delete/truncate from the browser.
revoke all on public.demo_requests, public.leads from public, anon, authenticated;
grant select on public.demo_requests, public.leads to authenticated;
grant update (estado, crm_notas) on public.demo_requests, public.leads to authenticated;
grant select, insert, update on public.demo_requests, public.leads to service_role;

create policy crm_demo_select on public.demo_requests for select to authenticated
  using ((select public.is_platform_admin()));
create policy crm_demo_update on public.demo_requests for update to authenticated
  using ((select public.is_platform_admin()))
  with check ((select public.is_platform_admin()));
create policy crm_leads_select on public.leads for select to authenticated
  using ((select public.is_platform_admin()));
create policy crm_leads_update on public.leads for update to authenticated
  using ((select public.is_platform_admin()))
  with check ((select public.is_platform_admin()));

create function public.crm_touch_updated_at() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.crm_touch_updated_at() from public, anon, authenticated;
create trigger crm_demo_touch before update on public.demo_requests
  for each row execute function public.crm_touch_updated_at();
create trigger crm_leads_touch before update on public.leads
  for each row execute function public.crm_touch_updated_at();

-- UNION ALL preserves each original request, including repeated inquiries.
-- The composite identity (fuente, id) prevents cross-source ID collisions.
create view public.crm_prospectos with (security_invoker = true) as
  select id, 'demo'::text as fuente, 'landing'::text as origen,
    null::text as nombre, null::text as negocio, whatsapp, email,
    null::text as comentarios, estado, crm_notas, created_at, updated_at
  from public.demo_requests
  union all
  select id, 'lead'::text as fuente, origen, nombre, negocio, whatsapp, email,
    comentarios, estado, crm_notas, created_at, updated_at
  from public.leads;

revoke all on public.crm_prospectos from public, anon, authenticated;
grant select on public.crm_prospectos to authenticated;

-- RLS remains in force. The timestamp prevents silent concurrent overwrites.
create function public.crm_actualizar_prospecto(
  p_fuente text, p_id uuid, p_estado text, p_notas text,
  p_updated_at timestamptz
) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  filas integer;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Acceso denegado' using errcode = '42501';
  end if;
  if p_estado is null or p_estado not in ('nuevo','contactado','demo_agendada','en_negociacion','convertido','descartado') then
    raise exception 'Estado inválido' using errcode = '22023';
  end if;
  if char_length(p_notas) > 4000 then
    raise exception 'Notas demasiado largas' using errcode = '22023';
  end if;
  if p_fuente = 'demo' then
    update public.demo_requests set estado = p_estado, crm_notas = nullif(btrim(p_notas), '')
      where id = p_id and updated_at = p_updated_at;
  elsif p_fuente = 'lead' then
    update public.leads set estado = p_estado, crm_notas = nullif(btrim(p_notas), '')
      where id = p_id and updated_at = p_updated_at;
  else
    raise exception 'Fuente inválida' using errcode = '22023';
  end if;
  get diagnostics filas = row_count;
  if filas <> 1 then
    raise exception 'El prospecto cambió o ya no está disponible. Actualiza la lista.' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.crm_actualizar_prospecto(text,uuid,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.crm_actualizar_prospecto(text,uuid,text,text,timestamptz) to authenticated;

create index if not exists demo_requests_created_at_idx on public.demo_requests (created_at desc);
create index if not exists demo_requests_estado_idx on public.demo_requests (estado);
