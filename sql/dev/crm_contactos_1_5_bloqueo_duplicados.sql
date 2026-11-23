-- Mi Negocio CRM 1.5 — Bloqueo de nuevos medios duplicados en plataforma.
-- EXCLUSIVAMENTE Supabase DEV: pablbrladwjuczhazsms.
-- No borra, fusiona ni altera los contactos duplicados preexistentes.
-- Se consideran registrados también los medios de contactos archivados.
-- Los ámbitos de negocios no cambian; clientes continúan deshabilitados.

create function public.crm_contacto_medios_evitar_duplicado_plataforma()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_normalizado text;
  v_anterior text;
begin
  -- La regla solo se aplica al directorio interno de plataforma.
  if not exists (
    select 1 from public.crm_contactos c
     where c.id = new.contacto_id and c.ambito = 'plataforma'
  ) then
    return new;
  end if;

  v_normalizado := case when new.tipo = 'correo' then lower(btrim(new.valor))
    else regexp_replace(new.valor, '[^0-9]', '', 'g') end;

  -- Cambiar solo el indicador principal o el formato del mismo valor
  -- no crea un duplicado nuevo. Conserva los registros históricos.
  if tg_op = 'UPDATE' then
    v_anterior := case when old.tipo = 'correo' then lower(btrim(old.valor))
      else regexp_replace(old.valor, '[^0-9]', '', 'g') end;
    if old.contacto_id = new.contacto_id
       and old.tipo = new.tipo
       and v_anterior = v_normalizado then
      return new;
    end if;
  end if;

  -- Bloqueo transaccional por tipo+valor para serializar escrituras concurrentes.
  -- La función VOLATILE consulta nuevamente después de adquirir el bloqueo.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('crm_contacto_plataforma:' || new.tipo || ':' || v_normalizado, 0)
  );

  if exists (
    select 1
      from public.crm_contacto_medios m
      join public.crm_contactos c on c.id = m.contacto_id
     where c.ambito = 'plataforma'
       and m.contacto_id <> new.contacto_id
       and m.tipo = new.tipo
       and m.valor_normalizado = v_normalizado
  ) then
    raise exception 'Este % ya está registrado en otro contacto; usa uno diferente', 
      case when new.tipo = 'correo' then 'correo' else 'teléfono' end
      using errcode = '23505';
  end if;

  return new;
end;
$$;

create trigger crm_contacto_medios_evitar_duplicado_plataforma
before insert or update of contacto_id, tipo, valor
on public.crm_contacto_medios
for each row
execute function public.crm_contacto_medios_evitar_duplicado_plataforma();

revoke all on function public.crm_contacto_medios_evitar_duplicado_plataforma()
  from public, anon, authenticated;

comment on function public.crm_contacto_medios_evitar_duplicado_plataforma()
  is 'CRM DEV: evita nuevos correos/teléfonos repetidos entre contactos de plataforma (incluidos archivados); preserva duplicados históricos.';

comment on table public.crm_contacto_medios is
  'CRM DEV: medios múltiples; nuevas coincidencias entre contactos de plataforma bloqueadas, duplicados históricos preservados.';

select pg_notify('pgrst', 'reload schema');
