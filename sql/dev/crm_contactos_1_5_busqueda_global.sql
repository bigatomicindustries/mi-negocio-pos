-- Mi Negocio CRM 1.5 — Búsqueda global y paginación del directorio.
-- Solo Supabase DEV: pablbrladwjuczhazsms.
-- La consulta es SECURITY INVOKER y se somete a las políticas RLS.
-- No habilita acceso de clientes ni modifica tablas comerciales.

create function public.crm_listar_contactos_plataforma(
  p_busqueda text default '',
  p_archivados boolean default false,
  p_limite integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_busqueda text := lower(btrim(coalesce(p_busqueda, '')));
  v_digitos text := regexp_replace(lower(btrim(coalesce(p_busqueda, ''))), '[^0-9]', '', 'g');
  v_resultado jsonb;
begin
  if (select auth.uid()) is null
     or not coalesce((select public.is_platform_admin()), false) then
    raise exception 'No autorizado para consultar el directorio de plataforma'
      using errcode = '42501';
  end if;

  if length(v_busqueda) > 120
     or p_limite is null or p_limite < 1 or p_limite > 100
     or p_offset is null or p_offset < 0 or p_offset > 100000
     or p_archivados is null then
    raise exception 'Parámetros de búsqueda fuera de rango'
      using errcode = '22023';
  end if;

  with filtrados as materialized (
    select c.id, c.nombre, c.apellido, c.empresa, c.direccion, c.notas,
           c.created_at, c.updated_at, c.archivado_at
      from public.crm_contactos c
     where c.ambito = 'plataforma'
       and c.business_id is null
       and (c.archivado_at is not null) = p_archivados
       and (
         v_busqueda = ''
         or position(v_busqueda in lower(concat_ws(' ', c.nombre, c.apellido))) > 0
         or position(v_busqueda in lower(coalesce(c.empresa, ''))) > 0
         or exists (
           select 1
             from public.crm_contacto_medios m
            where m.contacto_id = c.id
              and (
                position(v_busqueda in lower(m.valor)) > 0
                or (length(v_digitos) >= 3
                    and position(v_digitos in m.valor_normalizado) > 0)
              )
         )
       )
  ),
  pagina as (
    select *
      from filtrados
     order by created_at desc, id desc
     limit p_limite offset p_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtrados),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'nombre', p.nombre,
          'apellido', p.apellido,
          'empresa', p.empresa,
          'direccion', p.direccion,
          'notas', p.notas,
          'created_at', p.created_at,
          'updated_at', p.updated_at,
          'archivado_at', p.archivado_at,
          'crm_contacto_medios', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', m.id,
                'tipo', m.tipo,
                'valor', m.valor,
                'valor_normalizado', m.valor_normalizado,
                'es_principal', m.es_principal
              )
              order by m.es_principal desc, m.created_at, m.id
            )
              from public.crm_contacto_medios m
             where m.contacto_id = p.id
          ), '[]'::jsonb)
        )
        order by p.created_at desc, p.id desc
      )
        from pagina p
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;

revoke all on function public.crm_listar_contactos_plataforma(text, boolean, integer, integer)
  from public, anon, authenticated;

grant execute on function public.crm_listar_contactos_plataforma(text, boolean, integer, integer)
  to authenticated;

comment on function public.crm_listar_contactos_plataforma(text, boolean, integer, integer)
  is 'CRM DEV: búsqueda global paginada por nombre, empresa, correo o teléfono; solo administradores de plataforma, con RLS.';

select pg_notify('pgrst', 'reload schema');
