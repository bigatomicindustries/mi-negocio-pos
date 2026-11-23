-- CRM 1.5 DEV — Alta atómica de contacto y medios.
-- SECURITY INVOKER: conserva todos los permisos de columna y RLS existentes.

create function public.crm_crear_contacto(
  p_ambito text,
  p_business_id uuid,
  p_nombre text,
  p_apellido text,
  p_empresa text,
  p_notas text,
  p_correos text[] default array[]::text[],
  p_telefonos text[] default array[]::text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_valor text;
  v_indice integer := 0;
begin
  if coalesce(cardinality(p_correos), 0) > 10
    or coalesce(cardinality(p_telefonos), 0) > 10 then
    raise exception 'Máximo 10 correos y 10 teléfonos por contacto'
      using errcode = '22023';
  end if;

  insert into public.crm_contactos
    (ambito, business_id, nombre, apellido, empresa, notas)
  values
    (p_ambito, p_business_id,
     nullif(btrim(p_nombre), ''), nullif(btrim(p_apellido), ''),
     nullif(btrim(p_empresa), ''), nullif(btrim(p_notas), ''))
  returning id into v_id;

  foreach v_valor in array coalesce(p_correos, array[]::text[]) loop
    v_indice := v_indice + 1;
    insert into public.crm_contacto_medios(contacto_id, tipo, valor, es_principal)
      values (v_id, 'correo', btrim(v_valor), v_indice = 1);
  end loop;

  v_indice := 0;
  foreach v_valor in array coalesce(p_telefonos, array[]::text[]) loop
    v_indice := v_indice + 1;
    insert into public.crm_contacto_medios(contacto_id, tipo, valor, es_principal)
      values (v_id, 'telefono', btrim(v_valor), v_indice = 1);
  end loop;

  return v_id;
end;
$$;

revoke all on function public.crm_crear_contacto(
  text, uuid, text, text, text, text, text[], text[]
) from public, anon;
grant execute on function public.crm_crear_contacto(
  text, uuid, text, text, text, text, text[], text[]
) to authenticated;

-- Cambio atómico de medio principal. Requiere poder leer y editar el
-- contacto padre por RLS; no permite cambiar el propietario del medio.
create function public.crm_marcar_medio_principal(
  p_contacto_id uuid,
  p_medio_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tipo text;
begin
  select tipo into v_tipo
    from public.crm_contacto_medios
    where id = p_medio_id and contacto_id = p_contacto_id
    for update;
  if v_tipo is null then
    raise exception 'Medio no encontrado o sin permiso'
      using errcode = '42501';
  end if;

  update public.crm_contacto_medios
     set es_principal = false
   where contacto_id = p_contacto_id
     and tipo = v_tipo
     and es_principal is true;

  update public.crm_contacto_medios
     set es_principal = true
   where id = p_medio_id and contacto_id = p_contacto_id;
end;
$$;

revoke all on function public.crm_marcar_medio_principal(uuid, uuid)
  from public, anon;
grant execute on function public.crm_marcar_medio_principal(uuid, uuid)
  to authenticated;
