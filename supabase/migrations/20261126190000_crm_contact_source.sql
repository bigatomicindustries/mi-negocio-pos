alter table public.crm_contactos add column fuente text
  check (fuente in ('Referido','IA','Google','Redes sociales','Página web','WhatsApp','Evento','Visita al negocio','Otro'));

-- Keep existing callers on the original save operation. Both writes are atomic.
create function public.crm_guardar_contacto_con_fuente(
  p_contacto_id uuid, p_nombre text, p_apellido text, p_empresa text,
  p_direccion text, p_notas text, p_correo text, p_telefono text,
  p_expected_updated_at timestamptz, p_fuente text
) returns uuid language plpgsql security invoker set search_path='' as $$
declare contacto uuid;
begin
  contacto := public.crm_guardar_contacto_negocio(p_contacto_id,p_nombre,p_apellido,p_empresa,
    p_direccion,p_notas,p_correo,p_telefono,p_expected_updated_at);
  update public.crm_contactos set fuente=p_fuente where id=contacto and fuente is distinct from p_fuente;
  return contacto;
end $$;

revoke all on function public.crm_guardar_contacto_con_fuente(uuid,text,text,text,text,text,text,text,timestamptz,text) from public, anon;
grant execute on function public.crm_guardar_contacto_con_fuente(uuid,text,text,text,text,text,text,text,timestamptz,text) to authenticated;

CREATE OR REPLACE FUNCTION public.crm_buscar_contactos_negocio(p_business_id uuid, p_query text DEFAULT ''::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with matched as (
 select c.* from public.crm_contactos c
 where c.business_id=p_business_id and c.ambito='negocio' and c.archivado_at is null
 and (coalesce(trim(p_query),'')='' or strpos(lower(concat_ws(' ',c.nombre,c.apellido,c.empresa)),lower(trim(p_query)))>0
 or exists(select 1 from public.crm_contacto_medios m where m.contacto_id=c.id and strpos(lower(m.valor),lower(trim(p_query)))>0))
), paged as (
 select * from matched order by created_at desc,id desc limit 25 offset ((greatest(1,least(coalesce(p_page,1),1000000))-1)::bigint*25)
)
select jsonb_build_object('total',(select count(*) from matched),'rows',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'nombre',c.nombre,'apellido',c.apellido,'empresa',c.empresa,'fuente',c.fuente,'direccion',c.direccion,'notas',c.notas,'updated_at',c.updated_at,'crm_contacto_medios',coalesce((select jsonb_agg(jsonb_build_object('tipo',m.tipo,'valor',m.valor)) from public.crm_contacto_medios m where m.contacto_id=c.id),'[]'::jsonb)) order by c.created_at desc,c.id desc) from paged c),'[]'::jsonb));
$function$;
