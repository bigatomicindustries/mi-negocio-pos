alter table public.crm_contacto_medios
  add column etiqueta text check (length(etiqueta)<=80),
  add column posicion integer not null default 0;

create function public.crm_guardar_contacto_con_medios(
 p_contacto_id uuid,p_nombre text,p_apellido text,p_empresa text,p_direccion text,p_notas text,
 p_fuente text,p_medios jsonb,p_expected_updated_at timestamptz
) returns uuid language plpgsql security invoker set search_path='' as $$
declare tenant uuid; contacto uuid; version timestamptz;
begin
 select p.business_id into tenant from public.profiles p
 join public.businesses b on b.id=p.business_id and b.active
 join public.crm_acceso_negocios a on a.business_id=b.id and a.habilitado
 where p.id=auth.uid() and p.active;
 if tenant is null then raise exception 'Sin acceso al CRM' using errcode='42501'; end if;
 if coalesce(nullif(trim(p_nombre),''),nullif(trim(p_empresa),'')) is null then raise exception 'Indica nombre o empresa'; end if;
 if length(p_nombre)>120 or length(p_apellido)>120 or length(p_empresa)>180 or length(p_direccion)>2000 or length(p_notas)>4000 then raise exception 'Campo demasiado largo'; end if;
 if jsonb_typeof(p_medios) is distinct from 'array' then raise exception 'Revisa los medios de contacto'; end if;
 if p_contacto_id is null then
  insert into public.crm_contactos(ambito,business_id,nombre,apellido,empresa,direccion,notas,fuente,created_by)
  values('negocio',tenant,nullif(trim(p_nombre),''),nullif(trim(p_apellido),''),nullif(trim(p_empresa),''),nullif(trim(p_direccion),''),nullif(trim(p_notas),''),p_fuente,auth.uid()) returning id into contacto;
 else
  select id,updated_at into contacto,version from public.crm_contactos where id=p_contacto_id and business_id=tenant and ambito='negocio' and archivado_at is null for update;
  if not found then raise exception 'Contacto no disponible' using errcode='42501'; end if;
  if p_expected_updated_at is distinct from version then raise exception 'El contacto cambió. Actualiza antes de guardar' using errcode='40001'; end if;
  update public.crm_contactos set nombre=nullif(trim(p_nombre),''),apellido=nullif(trim(p_apellido),''),empresa=nullif(trim(p_empresa),''),direccion=nullif(trim(p_direccion),''),notas=nullif(trim(p_notas),''),fuente=p_fuente,updated_at=clock_timestamp() where id=contacto;
  delete from public.crm_contacto_medios where contacto_id=contacto;
 end if;
 insert into public.crm_contacto_medios(contacto_id,tipo,valor,etiqueta,posicion,es_principal)
 select contacto,m->>'tipo',case when m->>'tipo'='correo' then lower(trim(m->>'valor')) else trim(m->>'valor') end,
 nullif(trim(m->>'etiqueta'),''),ord,row_number() over(partition by m->>'tipo' order by ord)=1
 from jsonb_array_elements(p_medios) with ordinality as medios(m,ord);
 return contacto;
end $$;
revoke all on function public.crm_guardar_contacto_con_medios(uuid,text,text,text,text,text,text,jsonb,timestamptz) from public,anon;
grant execute on function public.crm_guardar_contacto_con_medios(uuid,text,text,text,text,text,text,jsonb,timestamptz) to authenticated,service_role;

-- A cached single-value editor must never replace a multi-value contact.
create or replace function public.crm_guardar_contacto_negocio(
 p_contacto_id uuid,p_nombre text,p_apellido text,p_empresa text,p_direccion text,p_notas text,
 p_correo text,p_telefono text,p_expected_updated_at timestamptz default null
) returns uuid language plpgsql security invoker set search_path='' as $$
declare source text; channels jsonb;
begin
 if p_contacto_id is not null then
  select fuente into source from public.crm_contactos where id=p_contacto_id and business_id=public.current_business_id() and ambito='negocio' for update;
  if exists(select from public.crm_contacto_medios where contacto_id=p_contacto_id group by tipo having count(*)>1 or bool_or(etiqueta is not null)) then
   raise exception 'Actualiza la página para editar todos los medios de este contacto';
  end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('tipo',tipo,'valor',valor)),'[]') into channels
 from (values ('correo',p_correo),('telefono',p_telefono)) as medio(tipo,valor) where nullif(trim(valor),'') is not null;
 return public.crm_guardar_contacto_con_medios(p_contacto_id,p_nombre,p_apellido,p_empresa,p_direccion,p_notas,source,channels,p_expected_updated_at);
end $$;

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
select jsonb_build_object('total',(select count(*) from matched),'rows',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'nombre',c.nombre,'apellido',c.apellido,'empresa',c.empresa,'fuente',c.fuente,'direccion',c.direccion,'notas',c.notas,'updated_at',c.updated_at,'crm_contacto_medios',coalesce((select jsonb_agg(jsonb_build_object('tipo',m.tipo,'valor',m.valor,'etiqueta',m.etiqueta) order by m.es_principal desc,m.posicion,m.created_at,m.id) from public.crm_contacto_medios m where m.contacto_id=c.id),'[]'::jsonb)) order by c.created_at desc,c.id desc) from paged c),'[]'::jsonb));
$function$;
