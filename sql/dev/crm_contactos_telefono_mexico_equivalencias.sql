-- Mi Negocio CRM DEV: equivalencias de números mexicanos en bloqueo de duplicados.
-- SOLO Supabase DEV: pablbrladwjuczhazsms. No modifica datos existentes.
-- 10 dígitos, 52 + 10 y 521 + 10 se tratan como el mismo teléfono.
-- No cambia la columna generada ni sus índices; se aplica en el trigger.

create or replace function public.crm_contacto_medios_evitar_duplicado_plataforma()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_normalizado text;
  v_clave text;
  v_anterior text;
begin
  if not exists (
    select 1 from public.crm_contactos c
    where c.id = new.contacto_id and c.ambito = 'plataforma'
  ) then
    return new;
  end if;

  v_normalizado := case when new.tipo = 'correo' then lower(btrim(new.valor))
    else regexp_replace(new.valor, '[^0-9]', '', 'g') end;

  v_clave := case
    when new.tipo = 'telefono' and v_normalizado ~ '^521[0-9]{10}$'
      then right(v_normalizado, 10)
    when new.tipo = 'telefono' and v_normalizado ~ '^52[0-9]{10}$'
      then right(v_normalizado, 10)
    else v_normalizado
  end;

  if tg_op = 'UPDATE' then
    v_anterior := case when old.tipo = 'correo' then lower(btrim(old.valor))
      else regexp_replace(old.valor, '[^0-9]', '', 'g') end;
    if old.tipo = 'telefono' and (v_anterior ~ '^521[0-9]{10}$' or v_anterior ~ '^52[0-9]{10}$') then
      v_anterior := right(v_anterior, 10);
    end if;
    if old.contacto_id = new.contacto_id
      and old.tipo = new.tipo and v_anterior = v_clave then
      return new;
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('crm_contacto_plataforma:' || new.tipo || ':' || v_clave, 0)
  );

  if exists (
    select 1
    from public.crm_contacto_medios m
    join public.crm_contactos c on c.id = m.contacto_id
    where c.ambito = 'plataforma'
      and m.tipo = new.tipo
      and (
        case
          when m.tipo = 'telefono'
            and (m.valor_normalizado ~ '^521[0-9]{10}$' or m.valor_normalizado ~ '^52[0-9]{10}$')
            then right(m.valor_normalizado, 10)
          else m.valor_normalizado
        end
      ) = v_clave
      and (tg_op <> 'UPDATE' or m.id <> new.id)
  ) then
    raise exception 'Este % ya está registrado en otro contacto o repetido en la misma ficha',
      case when new.tipo = 'correo' then 'correo' else 'teléfono' end
      using errcode = '23505';
  end if;

  return new;
end;
$$;

comment on function public.crm_contacto_medios_evitar_duplicado_plataforma()
  is 'CRM DEV: bloquea nuevos medios repetidos, también equivalencias mexicanas 10/52+10/521+10, conservando duplicados históricos.';
