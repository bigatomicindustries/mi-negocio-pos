-- Mi Negocio CRM — Vínculo explícito entre prospectos y contactos.
-- SOLO Supabase DEV: pablbrladwjuczhazsms. NO aplicar en producción.
-- Mantiene intactos leads, demo_requests, estados e historial de actividades.
-- Cada solicitud se vincula a un contacto; un contacto puede tener varias solicitudes.

create table public.crm_prospecto_contactos (
  id uuid primary key default gen_random_uuid(),
  demo_request_id uuid unique references public.demo_requests(id) on delete cascade,
  lead_id uuid unique references public.leads(id) on delete cascade,
  contacto_id uuid not null references public.crm_contactos(id) on delete restrict,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint crm_prospecto_contactos_origen_exclusivo check (
    (demo_request_id is not null) <> (lead_id is not null)
  )
);

create index crm_prospecto_contactos_por_contacto
  on public.crm_prospecto_contactos(contacto_id, created_at desc);

alter table public.crm_prospecto_contactos enable row level security;
revoke all on public.crm_prospecto_contactos from public, anon, authenticated;
grant select, delete on public.crm_prospecto_contactos to authenticated;
grant insert (demo_request_id, lead_id, contacto_id)
  on public.crm_prospecto_contactos to authenticated;
grant all on public.crm_prospecto_contactos to service_role;

create policy crm_prospecto_contactos_select
on public.crm_prospecto_contactos for select to authenticated
using (
  (select public.is_platform_admin())
  and exists (
    select 1 from public.crm_contactos c
    where c.id = contacto_id and c.ambito = 'plataforma'
  )
  and (
    (demo_request_id is not null and exists (
      select 1 from public.demo_requests d where d.id = demo_request_id
    ))
    or
    (lead_id is not null and exists (
      select 1 from public.leads l where l.id = lead_id
    ))
  )
);

create policy crm_prospecto_contactos_insert
on public.crm_prospecto_contactos for insert to authenticated
with check (
  (select public.is_platform_admin())
  and exists (
    select 1 from public.crm_contactos c
    where c.id = contacto_id and c.ambito = 'plataforma'
      and c.archivado_at is null
  )
  and (
    (demo_request_id is not null and exists (
      select 1 from public.demo_requests d where d.id = demo_request_id
    ))
    or
    (lead_id is not null and exists (
      select 1 from public.leads l where l.id = lead_id
    ))
  )
);

create policy crm_prospecto_contactos_delete
on public.crm_prospecto_contactos for delete to authenticated
using (
  (select public.is_platform_admin())
  and exists (
    select 1 from public.crm_contactos c
    where c.id = contacto_id and c.ambito = 'plataforma'
  )
);

-- Alta de contacto + vínculo en una sola transacción.
-- Si hay un medio duplicado, el guardado atómico y su trigger rechazan todo.
create function public.crm_crear_contacto_desde_prospecto(
  p_fuente text,
  p_prospecto_id uuid,
  p_nombre text,
  p_apellido text,
  p_empresa text,
  p_correo text,
  p_telefono text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_contacto_id uuid;
begin
  if (select auth.uid()) is null
    or not coalesce((select public.is_platform_admin()), false) then
    raise exception 'No autorizado para crear contactos desde prospectos'
      using errcode = '42501';
  end if;

  if p_fuente not in ('demo', 'lead') or p_fuente is null
    or p_prospecto_id is null then
    raise exception 'Origen de prospecto inválido' using errcode = '22023';
  end if;

  -- Bloquear la solicitud mientras se crea y vincula el contacto.
  if p_fuente = 'demo' then
    perform 1 from public.demo_requests where id = p_prospecto_id for update;
  else
    perform 1 from public.leads where id = p_prospecto_id for update;
  end if;
  if not found then
    raise exception 'Prospecto no encontrado o sin permiso' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.crm_prospecto_contactos v
    where (p_fuente = 'demo' and v.demo_request_id = p_prospecto_id)
       or (p_fuente = 'lead' and v.lead_id = p_prospecto_id)
  ) then
    raise exception 'El prospecto ya está vinculado a un contacto'
      using errcode = '23505';
  end if;

  v_contacto_id := public.crm_guardar_contacto_plataforma(
    null, null, p_nombre, p_apellido, p_empresa, null, null,
    case when nullif(btrim(p_correo), '') is null
      then array[]::text[] else array[btrim(p_correo)] end,
    case when nullif(btrim(p_telefono), '') is null
      then array[]::text[] else array[btrim(p_telefono)] end
  );

  insert into public.crm_prospecto_contactos
    (demo_request_id, lead_id, contacto_id)
  values (
    case when p_fuente = 'demo' then p_prospecto_id else null end,
    case when p_fuente = 'lead' then p_prospecto_id else null end,
    v_contacto_id
  );

  return v_contacto_id;
end;
$$;

revoke all on function public.crm_crear_contacto_desde_prospecto(
  text, uuid, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.crm_crear_contacto_desde_prospecto(
  text, uuid, text, text, text, text, text
) to authenticated;

comment on table public.crm_prospecto_contactos is
  'CRM DEV: vínculo explícito entre solicitud demo/lead y contacto de plataforma; no cambia estado ni historial comercial.';
comment on function public.crm_crear_contacto_desde_prospecto(
  text, uuid, text, text, text, text, text
) is 'CRM DEV: crea contacto y vínculo atómicamente, solo superadmin y sujeto a RLS y bloqueo de duplicados.';

select pg_notify('pgrst', 'reload schema');
