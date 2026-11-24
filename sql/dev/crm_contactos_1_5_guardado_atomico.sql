-- Mi Negocio CRM 1.5 — Guardado atómico de contactos de plataforma.
-- EXCLUSIVAMENTE Supabase DEV: pablbrladwjuczhazsms.
-- Un único RPC inserta/actualiza ficha, correos y teléfonos en la misma transacción.
-- SECURITY INVOKER conserva los permisos de columna y las políticas RLS.
-- No habilita acceso a clientes ni modifica datos comerciales del POS.

create function public.crm_guardar_contacto_plataforma(
  p_contacto_id uuid,
  p_expected_updated_at timestamptz,
  p_nombre text,
  p_apellido text,
  p_empresa text,
  p_direccion text,
  p_notas text,
  p_correos text[],
  p_telefonos text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_valor text;
  v_indice integer;
begin
  -- La función es solo para el directorio interno de plataforma.
  if (select auth.uid()) is null
    or not coalesce((select public.is_platform_admin()), false) then
    raise exception 'No autorizado para guardar contactos de plataforma'
      using errcode = '42501';
  end if;

  if coalesce(cardinality(p_correos), 0) > 10
    or coalesce(cardinality(p_telefonos), 0) > 10 then
    raise exception 'Máximo 10 correos y 10 teléfonos por contacto'
      using errcode = '22023';
  end if;

  if p_contacto_id is null then
    if p_expected_updated_at is not null then
      raise exception 'Fecha de versión inesperada para un contacto nuevo'
        using errcode = '22023';
    end if;

    insert into public.crm_contactos
      (ambito, business_id, nombre, apellido, empresa, direccion, notas)
    values
      ('plataforma', null,
       nullif(btrim(p_nombre), ''), nullif(btrim(p_apellido), ''),
       nullif(btrim(p_empresa), ''), nullif(btrim(p_direccion), ''),
       nullif(btrim(p_notas), ''))
    returning id into v_id;
  else
    if p_expected_updated_at is null then
      raise exception 'Falta la versión del contacto; actualiza la lista'
        using errcode = '22023';
    end if;

    -- UPDATE bloquea la fila hasta terminar esta transacción. El timestamp
    -- evita sobrescribir cambios guardados por otra sesión.
    update public.crm_contactos
       set nombre = nullif(btrim(p_nombre), ''),
           apellido = nullif(btrim(p_apellido), ''),
           empresa = nullif(btrim(p_empresa), ''),
           direccion = nullif(btrim(p_direccion), ''),
           notas = nullif(btrim(p_notas), '')
     where id = p_contacto_id
       and ambito = 'plataforma'
       and business_id is null
       and archivado_at is null
       and updated_at = p_expected_updated_at
    returning id into v_id;

    if v_id is null then
      raise exception 'El contacto cambió o no está disponible; actualiza la lista'
        using errcode = 'P0001';
    end if;

    -- Borrar e insertar medios ocurre dentro de la misma transacción.
    -- Si cualquier inserción falla, también se revierten el borrado y la ficha.
    delete from public.crm_contacto_medios where contacto_id = v_id;
  end if;

  v_indice := 0;
  foreach v_valor in array coalesce(p_correos, array[]::text[]) loop
    if v_valor is null or btrim(v_valor) = '' then
      raise exception 'No se permiten correos vacíos'
        using errcode = '22023';
    end if;
    v_indice := v_indice + 1;
    insert into public.crm_contacto_medios
      (contacto_id, tipo, valor, es_principal)
    values (v_id, 'correo', btrim(v_valor), v_indice = 1);
  end loop;

  v_indice := 0;
  foreach v_valor in array coalesce(p_telefonos, array[]::text[]) loop
    if v_valor is null or btrim(v_valor) = '' then
      raise exception 'No se permiten teléfonos vacíos'
        using errcode = '22023';
    end if;
    v_indice := v_indice + 1;
    insert into public.crm_contacto_medios
      (contacto_id, tipo, valor, es_principal)
    values (v_id, 'telefono', btrim(v_valor), v_indice = 1);
  end loop;

  return v_id;
end;
$$;

revoke all on function public.crm_guardar_contacto_plataforma(
  uuid, timestamptz, text, text, text, text, text, text[], text[]
) from public, anon, authenticated;

grant execute on function public.crm_guardar_contacto_plataforma(
  uuid, timestamptz, text, text, text, text, text, text[], text[]
) to authenticated;

comment on function public.crm_guardar_contacto_plataforma(
  uuid, timestamptz, text, text, text, text, text, text[], text[]
) is 'CRM DEV: guardado transaccional solo del directorio interno de plataforma, sujeto a RLS.';

select pg_notify('pgrst', 'reload schema');
