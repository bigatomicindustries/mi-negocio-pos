-- Mi Negocio CRM 1.5 — Contactos (SOLO Supabase DEV).
-- No modifica leads, demo_requests, ventas ni suscripciones existentes.
-- Los contactos de plataforma y de cada negocio son ámbitos independientes.
-- El acceso de clientes permanece cerrado hasta habilitación explícita.

create table public.crm_acceso_negocios (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  habilitado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.crm_contactos (
  id uuid primary key default gen_random_uuid(),
  ambito text not null check (ambito in ('plataforma', 'negocio')),
  business_id uuid references public.businesses(id) on delete restrict,
  nombre text,
  apellido text,
  empresa text,
  notas text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archivado_at timestamptz,
  constraint crm_contactos_ambito_negocio check (
    (ambito = 'plataforma' and business_id is null)
    or (ambito = 'negocio' and business_id is not null)
  ),
  constraint crm_contactos_identidad check (
    length(btrim(coalesce(nombre, ''))) > 0
    or length(btrim(coalesce(empresa, ''))) > 0
  ),
  constraint crm_contactos_longitudes check (
    length(coalesce(nombre, '')) <= 120
    and length(coalesce(apellido, '')) <= 120
    and length(coalesce(empresa, '')) <= 180
    and length(coalesce(notas, '')) <= 4000
  )
);

create table public.crm_contacto_medios (
  id uuid primary key default gen_random_uuid(),
  contacto_id uuid not null references public.crm_contactos(id) on delete cascade,
  tipo text not null check (tipo in ('correo', 'telefono')),
  valor text not null,
  valor_normalizado text generated always as (
    case
      when tipo = 'correo' then lower(btrim(valor))
      else regexp_replace(valor, '[^0-9]', '', 'g')
    end
  ) stored,
  es_principal boolean not null default false,
  created_at timestamptz not null default now(),
  constraint crm_contacto_medios_valido check (
    (tipo = 'correo'
      and length(valor) <= 320
      and btrim(valor) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or
    (tipo = 'telefono'
      and length(regexp_replace(valor, '[^0-9]', '', 'g')) between 7 and 15)
  ),
  constraint crm_contacto_medios_unico_por_contacto unique (
    contacto_id, tipo, valor_normalizado
  )
);

-- Un contacto puede tener varios correos y teléfonos, pero máximo un
-- medio principal por tipo. La coincidencia entre DOS contactos distintos
-- se detecta como posible duplicado; NO se fusiona ni bloquea automáticamente.
create unique index crm_contacto_medios_principal_unico
  on public.crm_contacto_medios(contacto_id, tipo)
  where es_principal is true;
create index crm_contacto_medios_busqueda
  on public.crm_contacto_medios(tipo, valor_normalizado);
create index crm_contactos_negocio_activos
  on public.crm_contactos(business_id, created_at desc)
  where ambito = 'negocio' and archivado_at is null;
create index crm_contactos_plataforma_activos
  on public.crm_contactos(created_at desc)
  where ambito = 'plataforma' and archivado_at is null;

create function public.crm_contactos_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger crm_contactos_touch_updated_at
  before update on public.crm_contactos
  for each row execute function public.crm_contactos_touch_updated_at();
create trigger crm_acceso_negocios_touch_updated_at
  before update on public.crm_acceso_negocios
  for each row execute function public.crm_contactos_touch_updated_at();

alter table public.crm_acceso_negocios enable row level security;
alter table public.crm_contactos enable row level security;
alter table public.crm_contacto_medios enable row level security;

-- Nunca heredar permisos amplios por default de public.
revoke all on table public.crm_acceso_negocios,
  public.crm_contactos, public.crm_contacto_medios
  from public, anon, authenticated;

grant select on public.crm_acceso_negocios to authenticated;
grant select on public.crm_contactos to authenticated;
grant insert (ambito, business_id, nombre, apellido, empresa, notas)
  on public.crm_contactos to authenticated;
grant update (nombre, apellido, empresa, notas, archivado_at)
  on public.crm_contactos to authenticated;
grant select, delete on public.crm_contacto_medios to authenticated;
grant insert (contacto_id, tipo, valor, es_principal)
  on public.crm_contacto_medios to authenticated;
grant update (tipo, valor, es_principal)
  on public.crm_contacto_medios to authenticated;
grant all on public.crm_acceso_negocios,
  public.crm_contactos, public.crm_contacto_medios to service_role;

revoke all on function public.crm_contactos_touch_updated_at()
  from public, anon, authenticated;

-- Los usuarios activos admin/manager pueden consultar si su negocio
-- tiene el módulo habilitado, pero no habilitarlo por sí mismos.
create policy crm_acceso_negocios_lectura
on public.crm_acceso_negocios for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.business_id = crm_acceso_negocios.business_id
      and p.active is true
      and p.role in ('admin', 'manager')
  )
);

-- Aislamiento del CRM INTERNO: solo administradores de plataforma activos.
create policy crm_contactos_plataforma_select
on public.crm_contactos for select to authenticated
using (ambito = 'plataforma' and (select public.is_platform_admin()));
create policy crm_contactos_plataforma_insert
on public.crm_contactos for insert to authenticated
with check (ambito = 'plataforma' and (select public.is_platform_admin()));
create policy crm_contactos_plataforma_update
on public.crm_contactos for update to authenticated
using (ambito = 'plataforma' and (select public.is_platform_admin()))
with check (ambito = 'plataforma' and (select public.is_platform_admin()));

-- Aislamiento de clientes: mismo business_id, usuario activo admin/manager,
-- negocio activo y habilitación explícita. Por defecto NO hay habilitaciones.
create policy crm_contactos_negocio_select
on public.crm_contactos for select to authenticated
using (
  ambito = 'negocio'
  and exists (
    select 1 from public.profiles p
    join public.businesses b on b.id = p.business_id
    join public.crm_acceso_negocios a on a.business_id = p.business_id
    where p.id = (select auth.uid())
      and p.business_id = crm_contactos.business_id
      and p.active is true
      and p.role in ('admin', 'manager')
      and b.active is true
      and a.habilitado is true
  )
);
create policy crm_contactos_negocio_insert
on public.crm_contactos for insert to authenticated
with check (
  ambito = 'negocio'
  and exists (
    select 1 from public.profiles p
    join public.businesses b on b.id = p.business_id
    join public.crm_acceso_negocios a on a.business_id = p.business_id
    where p.id = (select auth.uid())
      and p.business_id = crm_contactos.business_id
      and p.active is true
      and p.role in ('admin', 'manager')
      and b.active is true
      and a.habilitado is true
  )
);
create policy crm_contactos_negocio_update
on public.crm_contactos for update to authenticated
using (
  ambito = 'negocio'
  and exists (
    select 1 from public.profiles p
    join public.businesses b on b.id = p.business_id
    join public.crm_acceso_negocios a on a.business_id = p.business_id
    where p.id = (select auth.uid())
      and p.business_id = crm_contactos.business_id
      and p.active is true
      and p.role in ('admin', 'manager')
      and b.active is true
      and a.habilitado is true
  )
)
with check (
  ambito = 'negocio'
  and exists (
    select 1 from public.profiles p
    join public.businesses b on b.id = p.business_id
    join public.crm_acceso_negocios a on a.business_id = p.business_id
    where p.id = (select auth.uid())
      and p.business_id = crm_contactos.business_id
      and p.active is true
      and p.role in ('admin', 'manager')
      and b.active is true
      and a.habilitado is true
  )
);

-- Los medios heredan la visibilidad del contacto padre (con RLS).
create policy crm_contacto_medios_select
on public.crm_contacto_medios for select to authenticated
using (
  exists (select 1 from public.crm_contactos c where c.id = contacto_id)
);
create policy crm_contacto_medios_insert
on public.crm_contacto_medios for insert to authenticated
with check (
  exists (
    select 1 from public.crm_contactos c
    where c.id = contacto_id and c.archivado_at is null
  )
);
create policy crm_contacto_medios_update
on public.crm_contacto_medios for update to authenticated
using (
  exists (
    select 1 from public.crm_contactos c
    where c.id = contacto_id and c.archivado_at is null
  )
)
with check (
  exists (
    select 1 from public.crm_contactos c
    where c.id = contacto_id and c.archivado_at is null
  )
);
create policy crm_contacto_medios_delete
on public.crm_contacto_medios for delete to authenticated
using (
  exists (
    select 1 from public.crm_contactos c
    where c.id = contacto_id and c.archivado_at is null
  )
);

comment on table public.crm_contactos is
  'CRM 1.5 DEV: directorio multi-negocio; plataforma separada de cada business_id.';
comment on table public.crm_contacto_medios is
  'Correos y teléfonos múltiples; normalización para sugerir duplicados, sin fusionar.';
comment on table public.crm_acceso_negocios is
  'Habilitación explícita por negocio. Sin filas = módulo desactivado. No equivale a un plan comercial.';
