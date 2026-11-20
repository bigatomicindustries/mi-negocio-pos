-- Mi Negocio CRM 1.1: agenda, prioridad e historial. Solo DEV.
-- Cambios aditivos; no modificar datos comerciales existentes.
alter table public.demo_requests
  add column if not exists crm_prioridad text not null default 'media',
  add column if not exists crm_proximo_contacto date;
alter table public.leads
  add column if not exists crm_prioridad text not null default 'media',
  add column if not exists crm_proximo_contacto date;

alter table public.demo_requests
  add constraint demo_requests_crm_prioridad_check
  check (crm_prioridad in ('baja','media','alta'));
alter table public.leads
  add constraint leads_crm_prioridad_check
  check (crm_prioridad in ('baja','media','alta'));

grant update (crm_prioridad, crm_proximo_contacto) on public.demo_requests, public.leads to authenticated;

-- Agregar las columnas nuevas al final para conservar el contrato CRM 1.0.
create or replace view public.crm_prospectos with (security_invoker = true) as
  select id, 'demo'::text as fuente, 'landing'::text as origen,
    null::text as nombre, null::text as negocio, whatsapp, email,
    null::text as comentarios, estado, crm_notas, created_at, updated_at,
    crm_prioridad, crm_proximo_contacto
  from public.demo_requests
  union all
  select id, 'lead'::text as fuente, origen, nombre, negocio, whatsapp, email,
    comentarios, estado, crm_notas, created_at, updated_at,
    crm_prioridad, crm_proximo_contacto
  from public.leads;
revoke all on public.crm_prospectos from public, anon, authenticated;
grant select on public.crm_prospectos to authenticated;

-- Actividades vinculadas mediante claves foráneas reales a una sola fuente.
create table public.crm_actividades (
  id uuid primary key default gen_random_uuid(),
  demo_request_id uuid references public.demo_requests(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  tipo text not null check (tipo in ('llamada','whatsapp','correo','reunion','nota')),
  detalle text not null check (char_length(btrim(detalle)) between 1 and 2000),
  creado_por uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  constraint crm_actividades_un_prospecto_check
    check (num_nonnulls(demo_request_id, lead_id) = 1)
);
create index crm_actividades_demo_fecha_idx
  on public.crm_actividades (demo_request_id, created_at desc)
  where demo_request_id is not null;
create index crm_actividades_lead_fecha_idx
  on public.crm_actividades (lead_id, created_at desc)
  where lead_id is not null;
alter table public.crm_actividades enable row level security;
revoke all on public.crm_actividades from public, anon, authenticated;
grant select on public.crm_actividades to authenticated;
grant insert (demo_request_id, lead_id, tipo, detalle) on public.crm_actividades to authenticated;
grant select, insert on public.crm_actividades to service_role;

create policy crm_actividades_select on public.crm_actividades
  for select to authenticated
  using ((select public.is_platform_admin()));
create policy crm_actividades_insert on public.crm_actividades
  for insert to authenticated
  with check ((select public.is_platform_admin())
    and creado_por = (select auth.uid()));

-- Nueva RPC de actualización conjunta, preservando la RPC de CRM 1.0.
-- La marca updated_at protege contra sobrescrituras concurrentes.
create function public.crm_actualizar_prospecto_v1_1(
  p_fuente text, p_id uuid, p_estado text, p_notas text,
  p_prioridad text, p_proximo_contacto date, p_updated_at timestamptz
) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  filas integer;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Acceso denegado' using errcode = '42501';
  end if;
  if p_estado is null or p_estado not in
    ('nuevo','contactado','demo_agendada','en_negociacion','convertido','descartado') then
    raise exception 'Estado inválido' using errcode = '22023';
  end if;
  if char_length(p_notas) > 4000 then
    raise exception 'Notas demasiado largas' using errcode = '22023';
  end if;
  if p_prioridad is null or p_prioridad not in ('baja','media','alta') then
    raise exception 'Prioridad inválida' using errcode = '22023';
  end if;

  if p_fuente = 'demo' then
    update public.demo_requests
      set estado = p_estado, crm_notas = p_notas,
          crm_prioridad = p_prioridad, crm_proximo_contacto = p_proximo_contacto
    where id = p_id and updated_at = p_updated_at;
  elsif p_fuente = 'lead' then
    update public.leads
      set estado = p_estado, crm_notas = p_notas,
          crm_prioridad = p_prioridad, crm_proximo_contacto = p_proximo_contacto
    where id = p_id and updated_at = p_updated_at;
  else
    raise exception 'Fuente inválida' using errcode = '22023';
  end if;
  get diagnostics filas = row_count;
  if filas <> 1 then
    raise exception 'El prospecto cambió o ya no existe; actualiza la página.'
      using errcode = '40001';
  end if;
end;
$$;
revoke all on function public.crm_actualizar_prospecto_v1_1(text,uuid,text,text,text,date,timestamptz)
  from public, anon;
grant execute on function public.crm_actualizar_prospecto_v1_1(text,uuid,text,text,text,date,timestamptz)
  to authenticated, service_role;
