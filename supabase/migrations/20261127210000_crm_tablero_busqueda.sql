create function public.crm_tablero_comercial(p_business_id uuid, p_busqueda text, p_paginas jsonb)
returns table(etapa text, cantidad bigint, importe numeric, filas jsonb)
language sql stable security invoker set search_path='' as $$
  with coincidencias as (
    select o.id,o.contacto_id,o.titulo,o.etapa,o.valor_estimado,o.partidas,o.nota_fija,o.updated_at,o.created_at
    from public.crm_negocio_oportunidades o
    left join public.crm_contactos c on c.id=o.contacto_id and c.business_id=o.business_id
      and c.ambito='negocio' and c.archivado_at is null
    where o.business_id=p_business_id and o.business_id=public.current_business_id()
      and (trim(p_busqueda)='' or strpos(lower(concat_ws(' ',o.titulo,c.nombre,c.apellido,c.empresa)),lower(trim(p_busqueda)))>0)
  ), ordenadas as (
    select c.*,row_number() over(partition by c.etapa order by c.created_at desc,c.id desc) as posicion
    from coincidencias c
  )
  select r.etapa::text,count(*),sum(r.valor_estimado),
    coalesce(jsonb_agg(to_jsonb(r)-'posicion' order by r.posicion) filter (
      where (r.posicion-1)/25=greatest(1,coalesce((p_paginas->>r.etapa::text)::integer,1))-1
    ),'[]'::jsonb)
  from ordenadas r group by r.etapa
$$;
revoke all on function public.crm_tablero_comercial(uuid,text,jsonb) from public,anon;
grant execute on function public.crm_tablero_comercial(uuid,text,jsonb) to authenticated;
