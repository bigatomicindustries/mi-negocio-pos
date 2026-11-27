alter table public.crm_negocio_tareas add column fecha_sin_hora date;
grant select (fecha_sin_hora), insert (fecha_sin_hora) on public.crm_negocio_tareas to authenticated;

CREATE OR REPLACE FUNCTION public.crm_agenda_negocio(p_business_id uuid, p_filter text DEFAULT 'pendientes'::text, p_query text DEFAULT ''::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with base as (select t.id,t.oportunidad_id,t.titulo,t.vence_at,t.fecha_sin_hora,t.completada_at,o.titulo as oportunidad_titulo from public.crm_negocio_tareas t join public.crm_negocio_oportunidades o on o.id=t.oportunidad_id where o.business_id=p_business_id),
matched as (select * from base where (case p_filter when 'todas' then true when 'completadas' then completada_at is not null when 'vencidas' then completada_at is null and vence_at<now() when 'proximas' then completada_at is null and vence_at>=now() and vence_at<=now()+interval '7 days' else completada_at is null end) and strpos(lower(titulo||' '||oportunidad_titulo),lower(coalesce(trim(p_query),'')))>0),
paged as (select * from matched order by vence_at,id limit 25 offset ((greatest(1,least(coalesce(p_page,1),1000000))-1)::bigint*25))
select jsonb_build_object('total',(select count(*) from matched),'rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.vence_at,p.id) from paged p),'[]'::jsonb),'counts',(select jsonb_build_object('todas',count(*),'pendientes',count(*) filter(where completada_at is null),'vencidas',count(*) filter(where completada_at is null and vence_at<now()),'proximas',count(*) filter(where completada_at is null and vence_at>=now() and vence_at<=now()+interval '7 days'),'completadas',count(*) filter(where completada_at is not null)) from base));
$function$;

create table public.crm_oportunidad_eventos (
 id uuid primary key default gen_random_uuid(),
 oportunidad_id uuid not null references public.crm_negocio_oportunidades(id) on delete cascade,
 tipo text not null,
 descripcion text not null,
 created_at timestamptz not null default now()
);
create index on public.crm_oportunidad_eventos (oportunidad_id,created_at desc);
alter table public.crm_oportunidad_eventos enable row level security;
revoke all on public.crm_oportunidad_eventos from public,anon,authenticated;
grant select on public.crm_oportunidad_eventos to authenticated;
create policy eventos_visibles on public.crm_oportunidad_eventos for select to authenticated using
 (exists (select 1 from public.crm_negocio_oportunidades o where o.id=oportunidad_id));

lock table public.crm_negocio_tareas in share row exclusive mode;
insert into public.crm_oportunidad_eventos(oportunidad_id,tipo,descripcion,created_at)
 select oportunidad_id,'Seguimiento registrado',titulo,created_at from public.crm_negocio_tareas
 union all select oportunidad_id,'Seguimiento cumplido',titulo,completada_at from public.crm_negocio_tareas where completada_at is not null;

create function pos_private.historial_seguimiento() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.crm_oportunidad_eventos(oportunidad_id,tipo,descripcion) values
 (new.oportunidad_id,case when tg_op='INSERT' then 'Seguimiento registrado' when new.completada_at is null then 'Seguimiento reabierto' else 'Seguimiento cumplido' end,new.titulo);
 return new;
end $$;
revoke all on function pos_private.historial_seguimiento() from public,anon,authenticated;
create trigger historial_al_programar after insert on public.crm_negocio_tareas for each row execute function pos_private.historial_seguimiento();
create trigger historial_al_completar after update of completada_at on public.crm_negocio_tareas for each row when (old.completada_at is distinct from new.completada_at) execute function pos_private.historial_seguimiento();
create function pos_private.historial_nota_fija() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.crm_oportunidad_eventos(oportunidad_id,tipo,descripcion) values (new.id,'Nota de oportunidad',coalesce(nullif(new.nota_fija,''),'Se eliminó la nota fija.'));
 return new;
end $$;
revoke all on function pos_private.historial_nota_fija() from public,anon,authenticated;
create trigger historial_nota_fija after update of nota_fija on public.crm_negocio_oportunidades for each row when (old.nota_fija is distinct from new.nota_fija) execute function pos_private.historial_nota_fija();

create view public.crm_historial_oportunidad with (security_invoker=true) as
 select id,oportunidad_id,tipo,descripcion,created_at from public.crm_negocio_actividades where oportunidad_id is not null
 union all select id,oportunidad_id,tipo,descripcion,created_at from public.crm_oportunidad_eventos;
revoke all on public.crm_historial_oportunidad from public,anon,authenticated;
grant select on public.crm_historial_oportunidad to authenticated;
