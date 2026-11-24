-- Mi Negocio CRM 1.7. Ejecutar como una migración transaccional sobre CRM 1.0.
-- Solo esquema. Las habilitaciones comerciales se administran por separado.
SET LOCAL lock_timeout = '4s';
SET LOCAL search_path = pg_catalog, public;

alter table public.demo_requests
  add column if not exists crm_prioridad text not null default 'media',
  add column if not exists crm_proximo_contacto date;
alter table public.leads
  add column if not exists crm_prioridad text not null default 'media',
  add column if not exists crm_proximo_contacto date;

alter table public.demo_requests
  add constraint demo_requests_crm_prioridad_check
  check (crm_prioridad in ('baja','media','alta'));
alter table public.leads
  add constraint leads_crm_prioridad_check
  check (crm_prioridad in ('baja','media','alta'));

grant update (crm_prioridad, crm_proximo_contacto) on public.demo_requests, public.leads to authenticated;

-- Agregar las columnas nuevas al final para conservar el contrato CRM 1.0.
create or replace view public.crm_prospectos with (security_invoker = true) as
  select id, 'demo'::text as fuente, 'landing'::text as origen,
    null::text as nombre, null::text as negocio, whatsapp, email,
    null::text as comentarios, estado, crm_notas, created_at, updated_at,
    crm_prioridad, crm_proximo_contacto
  from public.demo_requests
  union all
  select id, 'lead'::text as fuente, origen, nombre, negocio, whatsapp, email,
    comentarios, estado, crm_notas, created_at, updated_at,
    crm_prioridad, crm_proximo_contacto
  from public.leads;
revoke all on public.crm_prospectos from public, anon, authenticated;
grant select on public.crm_prospectos to authenticated;

CREATE TABLE public.crm_acceso_negocios (
    business_id uuid NOT NULL,
    habilitado boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_acceso_negocios_pkey PRIMARY KEY (business_id)
);
ALTER TABLE public.crm_acceso_negocios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_acceso_negocios FROM PUBLIC, anon, authenticated;

CREATE TABLE public.crm_actividades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    demo_request_id uuid,
    lead_id uuid,
    tipo text NOT NULL,
    detalle text NOT NULL,
    creado_por uuid DEFAULT auth.uid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_actividades_detalle_check CHECK (char_length(btrim(detalle)) >= 1 AND char_length(btrim(detalle)) <= 2000),
    CONSTRAINT crm_actividades_pkey PRIMARY KEY (id),
    CONSTRAINT crm_actividades_tipo_check CHECK (tipo = ANY (ARRAY['llamada'::text, 'whatsapp'::text, 'correo'::text, 'reunion'::text, 'nota'::text])),
    CONSTRAINT crm_actividades_un_prospecto_check CHECK (num_nonnulls(demo_request_id, lead_id) = 1)
);
ALTER TABLE public.crm_actividades ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_actividades FROM PUBLIC, anon, authenticated;

CREATE TABLE public.crm_contacto_medios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contacto_id uuid NOT NULL,
    tipo text NOT NULL,
    valor text NOT NULL,
    valor_normalizado text GENERATED ALWAYS AS (CASE
    WHEN (tipo = 'correo'::text) THEN lower(btrim(valor))
    ELSE regexp_replace(valor, '[^0-9]'::text, ''::text, 'g'::text)
END) STORED,
    es_principal boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_contacto_medios_pkey PRIMARY KEY (id),
    CONSTRAINT crm_contacto_medios_tipo_check CHECK (tipo = ANY (ARRAY['correo'::text, 'telefono'::text])),
    CONSTRAINT crm_contacto_medios_unico_por_contacto UNIQUE (contacto_id, tipo, valor_normalizado),
    CONSTRAINT crm_contacto_medios_valido CHECK (tipo = 'correo'::text AND length(valor) <= 320 AND btrim(valor) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'::text OR tipo = 'telefono'::text AND length(regexp_replace(valor, '[^0-9]'::text, ''::text, 'g'::text)) >= 7 AND length(regexp_replace(valor, '[^0-9]'::text, ''::text, 'g'::text)) <= 15)
);
ALTER TABLE public.crm_contacto_medios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_contacto_medios FROM PUBLIC, anon, authenticated;

CREATE TABLE public.crm_contactos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ambito text NOT NULL,
    business_id uuid,
    nombre text,
    apellido text,
    empresa text,
    notas text,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archivado_at timestamp with time zone,
    direccion text,
    CONSTRAINT crm_contactos_ambito_check CHECK (ambito = ANY (ARRAY['plataforma'::text, 'negocio'::text])),
    CONSTRAINT crm_contactos_ambito_negocio CHECK (ambito = 'plataforma'::text AND business_id IS NULL OR ambito = 'negocio'::text AND business_id IS NOT NULL),
    CONSTRAINT crm_contactos_direccion_longitud CHECK (char_length(direccion) <= 2000),
    CONSTRAINT crm_contactos_identidad CHECK (length(btrim(COALESCE(nombre, ''::text))) > 0 OR length(btrim(COALESCE(empresa, ''::text))) > 0),
    CONSTRAINT crm_contactos_longitudes CHECK (length(COALESCE(nombre, ''::text)) <= 120 AND length(COALESCE(apellido, ''::text)) <= 120 AND length(COALESCE(empresa, ''::text)) <= 180 AND length(COALESCE(notas, ''::text)) <= 4000),
    CONSTRAINT crm_contactos_pkey PRIMARY KEY (id)
);
ALTER TABLE public.crm_contactos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_contactos FROM PUBLIC, anon, authenticated;

CREATE TABLE public.crm_negocio_actividades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    oportunidad_id uuid NOT NULL,
    tipo text NOT NULL,
    descripcion text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_negocio_actividades_descripcion_check CHECK (char_length(btrim(descripcion)) >= 1 AND char_length(btrim(descripcion)) <= 2000),
    CONSTRAINT crm_negocio_actividades_pkey PRIMARY KEY (id),
    CONSTRAINT crm_negocio_actividades_tipo_check CHECK (tipo = ANY (ARRAY['llamada'::text, 'mensaje'::text, 'reunion'::text, 'nota'::text, 'cambio_etapa'::text]))
);
ALTER TABLE public.crm_negocio_actividades ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_negocio_actividades FROM PUBLIC, anon, authenticated;

CREATE TABLE public.crm_negocio_oportunidades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_id uuid NOT NULL,
    contacto_id uuid NOT NULL,
    titulo text NOT NULL,
    etapa text DEFAULT 'nuevo'::text NOT NULL,
    valor_estimado numeric(14,2) DEFAULT 0 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_negocio_oportunidades_etapa_check CHECK (etapa = ANY (ARRAY['nuevo'::text, 'contactado'::text, 'propuesta'::text, 'negociacion'::text, 'ganado'::text, 'perdido'::text])),
    CONSTRAINT crm_negocio_oportunidades_pkey PRIMARY KEY (id),
    CONSTRAINT crm_negocio_oportunidades_titulo_check CHECK (length(btrim(titulo)) >= 1 AND length(btrim(titulo)) <= 240),
    CONSTRAINT crm_negocio_oportunidades_valor_estimado_check CHECK (valor_estimado >= 0::numeric)
);
ALTER TABLE public.crm_negocio_oportunidades ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_negocio_oportunidades FROM PUBLIC, anon, authenticated;

CREATE TABLE public.crm_negocio_tareas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    oportunidad_id uuid NOT NULL,
    titulo text NOT NULL,
    vence_at timestamp with time zone NOT NULL,
    completada_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_negocio_tareas_pkey PRIMARY KEY (id),
    CONSTRAINT crm_negocio_tareas_titulo_check CHECK (length(btrim(titulo)) >= 1 AND length(btrim(titulo)) <= 240)
);
ALTER TABLE public.crm_negocio_tareas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_negocio_tareas FROM PUBLIC, anon, authenticated;

CREATE TABLE public.crm_oportunidad_actividades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    oportunidad_id uuid NOT NULL,
    tipo text NOT NULL,
    detalle text NOT NULL,
    creado_por uuid DEFAULT auth.uid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_oportunidad_actividades_detalle_check CHECK (length(TRIM(BOTH FROM detalle)) >= 1 AND length(TRIM(BOTH FROM detalle)) <= 3000),
    CONSTRAINT crm_oportunidad_actividades_pkey PRIMARY KEY (id),
    CONSTRAINT crm_oportunidad_actividades_tipo_check CHECK (tipo = ANY (ARRAY['llamada'::text, 'whatsapp'::text, 'correo'::text, 'reunion'::text, 'tarea'::text, 'nota'::text]))
);
ALTER TABLE public.crm_oportunidad_actividades ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_oportunidad_actividades FROM PUBLIC, anon, authenticated;

CREATE TABLE public.crm_oportunidad_tareas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    oportunidad_id uuid NOT NULL,
    titulo text NOT NULL,
    vence_at timestamp with time zone NOT NULL,
    completada_at timestamp with time zone,
    creado_por uuid DEFAULT auth.uid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_oportunidad_tareas_pkey PRIMARY KEY (id),
    CONSTRAINT crm_oportunidad_tareas_titulo_check CHECK (length(TRIM(BOTH FROM titulo)) >= 1 AND length(TRIM(BOTH FROM titulo)) <= 240)
);
ALTER TABLE public.crm_oportunidad_tareas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_oportunidad_tareas FROM PUBLIC, anon, authenticated;

CREATE TABLE public.crm_oportunidades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contacto_id uuid NOT NULL,
    titulo text NOT NULL,
    etapa text DEFAULT 'nuevo'::text NOT NULL,
    valor_estimado numeric(14,2) DEFAULT 0 NOT NULL,
    fecha_cierre_estimada date,
    notas text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_oportunidades_etapa_check CHECK (etapa = ANY (ARRAY['nuevo'::text, 'contactado'::text, 'propuesta'::text, 'negociacion'::text, 'ganado'::text, 'perdido'::text])),
    CONSTRAINT crm_oportunidades_pkey PRIMARY KEY (id),
    CONSTRAINT crm_oportunidades_titulo_check CHECK (length(btrim(titulo)) >= 1 AND length(btrim(titulo)) <= 180),
    CONSTRAINT crm_oportunidades_valor_estimado_check CHECK (valor_estimado >= 0::numeric)
);
ALTER TABLE public.crm_oportunidades ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_oportunidades FROM PUBLIC, anon, authenticated;

CREATE TABLE public.crm_prospecto_contactos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    demo_request_id uuid,
    lead_id uuid,
    contacto_id uuid NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_prospecto_contactos_demo_request_id_key UNIQUE (demo_request_id),
    CONSTRAINT crm_prospecto_contactos_lead_id_key UNIQUE (lead_id),
    CONSTRAINT crm_prospecto_contactos_origen_exclusivo CHECK ((demo_request_id IS NOT NULL) <> (lead_id IS NOT NULL)),
    CONSTRAINT crm_prospecto_contactos_pkey PRIMARY KEY (id)
);
ALTER TABLE public.crm_prospecto_contactos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_prospecto_contactos FROM PUBLIC, anon, authenticated;

ALTER TABLE public.crm_acceso_negocios ADD CONSTRAINT crm_acceso_negocios_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE RESTRICT;

ALTER TABLE public.crm_actividades ADD CONSTRAINT crm_actividades_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES auth.users(id);

ALTER TABLE public.crm_actividades ADD CONSTRAINT crm_actividades_demo_request_id_fkey FOREIGN KEY (demo_request_id) REFERENCES demo_requests(id) ON DELETE CASCADE;

ALTER TABLE public.crm_actividades ADD CONSTRAINT crm_actividades_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;

CREATE INDEX crm_actividades_demo_fecha_idx ON public.crm_actividades USING btree (demo_request_id, created_at DESC) WHERE (demo_request_id IS NOT NULL);

CREATE INDEX crm_actividades_lead_fecha_idx ON public.crm_actividades USING btree (lead_id, created_at DESC) WHERE (lead_id IS NOT NULL);

ALTER TABLE public.crm_contacto_medios ADD CONSTRAINT crm_contacto_medios_contacto_id_fkey FOREIGN KEY (contacto_id) REFERENCES crm_contactos(id) ON DELETE CASCADE;

CREATE INDEX crm_contacto_medios_busqueda ON public.crm_contacto_medios USING btree (tipo, valor_normalizado);

CREATE UNIQUE INDEX crm_contacto_medios_principal_unico ON public.crm_contacto_medios USING btree (contacto_id, tipo) WHERE (es_principal IS TRUE);

ALTER TABLE public.crm_contactos ADD CONSTRAINT crm_contactos_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE RESTRICT;

ALTER TABLE public.crm_contactos ADD CONSTRAINT crm_contactos_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX crm_contactos_negocio_activos ON public.crm_contactos USING btree (business_id, created_at DESC) WHERE ((ambito = 'negocio'::text) AND (archivado_at IS NULL));

CREATE INDEX crm_contactos_plataforma_activos ON public.crm_contactos USING btree (created_at DESC) WHERE ((ambito = 'plataforma'::text) AND (archivado_at IS NULL));

ALTER TABLE public.crm_negocio_actividades ADD CONSTRAINT crm_negocio_actividades_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id);

ALTER TABLE public.crm_negocio_actividades ADD CONSTRAINT crm_negocio_actividades_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.crm_negocio_actividades ADD CONSTRAINT crm_negocio_actividades_oportunidad_id_fkey FOREIGN KEY (oportunidad_id) REFERENCES crm_negocio_oportunidades(id);

CREATE INDEX crm_negocio_actividades_oportunidad_fecha_idx ON public.crm_negocio_actividades USING btree (oportunidad_id, created_at DESC);

ALTER TABLE public.crm_negocio_oportunidades ADD CONSTRAINT crm_negocio_oportunidades_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id);

ALTER TABLE public.crm_negocio_oportunidades ADD CONSTRAINT crm_negocio_oportunidades_contacto_id_fkey FOREIGN KEY (contacto_id) REFERENCES crm_contactos(id);

ALTER TABLE public.crm_negocio_oportunidades ADD CONSTRAINT crm_negocio_oportunidades_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

CREATE INDEX crm_negocio_oportunidades_business_id_created_at_idx ON public.crm_negocio_oportunidades USING btree (business_id, created_at DESC);

ALTER TABLE public.crm_negocio_tareas ADD CONSTRAINT crm_negocio_tareas_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.crm_negocio_tareas ADD CONSTRAINT crm_negocio_tareas_oportunidad_id_fkey FOREIGN KEY (oportunidad_id) REFERENCES crm_negocio_oportunidades(id) ON DELETE CASCADE;

CREATE INDEX crm_negocio_tareas_oportunidad_id_vence_at_idx ON public.crm_negocio_tareas USING btree (oportunidad_id, vence_at);

ALTER TABLE public.crm_oportunidad_actividades ADD CONSTRAINT crm_oportunidad_actividades_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES auth.users(id);

ALTER TABLE public.crm_oportunidad_actividades ADD CONSTRAINT crm_oportunidad_actividades_oportunidad_id_fkey FOREIGN KEY (oportunidad_id) REFERENCES crm_oportunidades(id) ON DELETE CASCADE;

CREATE INDEX crm_oportunidad_actividades_oportunidad_fecha_idx ON public.crm_oportunidad_actividades USING btree (oportunidad_id, created_at DESC);

ALTER TABLE public.crm_oportunidad_tareas ADD CONSTRAINT crm_oportunidad_tareas_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES auth.users(id);

ALTER TABLE public.crm_oportunidad_tareas ADD CONSTRAINT crm_oportunidad_tareas_oportunidad_id_fkey FOREIGN KEY (oportunidad_id) REFERENCES crm_oportunidades(id) ON DELETE CASCADE;

CREATE INDEX crm_oportunidad_tareas_fecha_idx ON public.crm_oportunidad_tareas USING btree (completada_at, vence_at);

CREATE INDEX crm_oportunidad_tareas_oportunidad_idx ON public.crm_oportunidad_tareas USING btree (oportunidad_id);

ALTER TABLE public.crm_oportunidades ADD CONSTRAINT crm_oportunidades_contacto_id_fkey FOREIGN KEY (contacto_id) REFERENCES crm_contactos(id) ON DELETE RESTRICT;

ALTER TABLE public.crm_oportunidades ADD CONSTRAINT crm_oportunidades_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

CREATE INDEX crm_oportunidades_contacto_idx ON public.crm_oportunidades USING btree (contacto_id);

CREATE INDEX crm_oportunidades_etapa_idx ON public.crm_oportunidades USING btree (etapa);

ALTER TABLE public.crm_prospecto_contactos ADD CONSTRAINT crm_prospecto_contactos_contacto_id_fkey FOREIGN KEY (contacto_id) REFERENCES crm_contactos(id) ON DELETE RESTRICT;

ALTER TABLE public.crm_prospecto_contactos ADD CONSTRAINT crm_prospecto_contactos_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.crm_prospecto_contactos ADD CONSTRAINT crm_prospecto_contactos_demo_request_id_fkey FOREIGN KEY (demo_request_id) REFERENCES demo_requests(id) ON DELETE CASCADE;

ALTER TABLE public.crm_prospecto_contactos ADD CONSTRAINT crm_prospecto_contactos_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;

CREATE INDEX crm_prospecto_contactos_por_contacto ON public.crm_prospecto_contactos USING btree (contacto_id, created_at DESC);

CREATE FUNCTION public.crm_actualizar_prospecto_v1_1(p_fuente text, p_id uuid, p_estado text, p_notas text, p_prioridad text, p_proximo_contacto date, p_updated_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  filas integer;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Acceso denegado' using errcode = '42501';
  end if;
  if p_estado is null or p_estado not in
    ('nuevo','contactado','demo_agendada','en_negociacion','convertido','descartado') then
    raise exception 'Estado inválido' using errcode = '22023';
  end if;
  if char_length(p_notas) > 4000 then
    raise exception 'Notas demasiado largas' using errcode = '22023';
  end if;
  if p_prioridad is null or p_prioridad not in ('baja','media','alta') then
    raise exception 'Prioridad inválida' using errcode = '22023';
  end if;

  if p_fuente = 'demo' then
    update public.demo_requests
      set estado = p_estado, crm_notas = p_notas,
          crm_prioridad = p_prioridad, crm_proximo_contacto = p_proximo_contacto
    where id = p_id and updated_at = p_updated_at;
  elsif p_fuente = 'lead' then
    update public.leads
      set estado = p_estado, crm_notas = p_notas,
          crm_prioridad = p_prioridad, crm_proximo_contacto = p_proximo_contacto
    where id = p_id and updated_at = p_updated_at;
  else
    raise exception 'Fuente inválida' using errcode = '22023';
  end if;
  get diagnostics filas = row_count;
  if filas <> 1 then
    raise exception 'El prospecto cambió o ya no existe; actualiza la página.'
      using errcode = '40001';
  end if;
end;
$function$;
REVOKE ALL ON FUNCTION public.crm_actualizar_prospecto_v1_1(text, uuid, text, text, text, date, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_actualizar_prospecto_v1_1(text, uuid, text, text, text, date, timestamp with time zone) TO authenticated, service_role;

CREATE FUNCTION public.crm_agenda_negocio(p_business_id uuid, p_filter text DEFAULT 'pendientes'::text, p_query text DEFAULT ''::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with base as (select t.id,t.oportunidad_id,t.titulo,t.vence_at,t.completada_at,o.titulo as oportunidad_titulo from public.crm_negocio_tareas t join public.crm_negocio_oportunidades o on o.id=t.oportunidad_id where o.business_id=p_business_id),
matched as (select * from base where (case p_filter when 'todas' then true when 'completadas' then completada_at is not null when 'vencidas' then completada_at is null and vence_at<now() when 'proximas' then completada_at is null and vence_at>=now() and vence_at<=now()+interval '7 days' else completada_at is null end) and strpos(lower(titulo||' '||oportunidad_titulo),lower(coalesce(trim(p_query),'')))>0),
paged as (select * from matched order by vence_at,id limit 25 offset ((greatest(1,least(coalesce(p_page,1),1000000))-1)::bigint*25))
select jsonb_build_object('total',(select count(*) from matched),'rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.vence_at,p.id) from paged p),'[]'::jsonb),'counts',(select jsonb_build_object('todas',count(*),'pendientes',count(*) filter(where completada_at is null),'vencidas',count(*) filter(where completada_at is null and vence_at<now()),'proximas',count(*) filter(where completada_at is null and vence_at>=now() and vence_at<=now()+interval '7 days'),'completadas',count(*) filter(where completada_at is not null)) from base));
$function$;
REVOKE ALL ON FUNCTION public.crm_agenda_negocio(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_agenda_negocio(uuid, text, text, integer) TO authenticated, service_role;

CREATE FUNCTION public.crm_buscar_contactos_negocio(p_business_id uuid, p_query text DEFAULT ''::text, p_page integer DEFAULT 1)
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
select jsonb_build_object('total',(select count(*) from matched),'rows',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'nombre',c.nombre,'apellido',c.apellido,'empresa',c.empresa,'direccion',c.direccion,'notas',c.notas,'updated_at',c.updated_at,'crm_contacto_medios',coalesce((select jsonb_agg(jsonb_build_object('tipo',m.tipo,'valor',m.valor)) from public.crm_contacto_medios m where m.contacto_id=c.id),'[]'::jsonb)) order by c.created_at desc,c.id desc) from paged c),'[]'::jsonb));
$function$;
REVOKE ALL ON FUNCTION public.crm_buscar_contactos_negocio(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_buscar_contactos_negocio(uuid, text, integer) TO authenticated, service_role;

CREATE FUNCTION public.crm_contacto_medios_evitar_duplicado_negocio()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_business uuid; v_key text;
begin
 select c.business_id into v_business from public.crm_contactos c where c.id=new.contacto_id and c.ambito='negocio';
 if v_business is null then return new; end if;
 v_key:=case when new.tipo='correo' then lower(btrim(new.valor))
 else regexp_replace(new.valor,'[^0-9]','','g') end;
 if new.tipo='telefono' and (v_key ~ '^521[0-9]{10}$' or v_key ~ '^52[0-9]{10}$') then v_key:=right(v_key,10);end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_negocio:'||v_business::text||':'||new.tipo||':'||v_key,0));
 if exists (
  select 1 from public.crm_contacto_medios m join public.crm_contactos c on c.id=m.contacto_id
  where c.ambito='negocio' and c.business_id=v_business and m.tipo=new.tipo and m.id is distinct from new.id
  and (case when m.tipo='telefono' and (m.valor_normalizado ~ '^521[0-9]{10}$' or m.valor_normalizado ~ '^52[0-9]{10}$') then right(m.valor_normalizado,10) else m.valor_normalizado end)=v_key
 ) then raise exception 'Este % ya está registrado en otro contacto del negocio',case when new.tipo='correo' then 'correo' else 'teléfono' end using errcode='23505';end if;
 return new;
end;$function$;
REVOKE ALL ON FUNCTION public.crm_contacto_medios_evitar_duplicado_negocio() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_contacto_medios_evitar_duplicado_negocio() TO service_role;

CREATE FUNCTION public.crm_contacto_medios_evitar_duplicado_plataforma()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.crm_contacto_medios_evitar_duplicado_plataforma() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_contacto_medios_evitar_duplicado_plataforma() TO service_role;

CREATE FUNCTION public.crm_contactos_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION public.crm_contactos_touch_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_contactos_touch_updated_at() TO service_role;

CREATE FUNCTION public.crm_crear_contacto(p_ambito text, p_business_id uuid, p_nombre text, p_apellido text, p_empresa text, p_notas text, p_correos text[] DEFAULT ARRAY[]::text[], p_telefonos text[] DEFAULT ARRAY[]::text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.crm_crear_contacto(text, uuid, text, text, text, text, text[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_crear_contacto(text, uuid, text, text, text, text, text[], text[]) TO authenticated, service_role;

CREATE FUNCTION public.crm_crear_contacto_desde_prospecto(p_fuente text, p_prospecto_id uuid, p_nombre text, p_apellido text, p_empresa text, p_correo text, p_telefono text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_contacto_id uuid;
begin
  if (select auth.uid()) is null
    or not coalesce((select public.is_platform_admin()), false) then
    raise exception 'No autorizado para crear contactos desde prospectos'
      using errcode = '42501';
  end if;

  if p_fuente not in ('demo', 'lead') or p_fuente is null
    or p_prospecto_id is null then
    raise exception 'Origen de prospecto inválido' using errcode = '22023';
  end if;

  -- Bloquear la solicitud mientras se crea y vincula el contacto.
  if p_fuente = 'demo' then
    perform 1 from public.demo_requests where id = p_prospecto_id for update;
  else
    perform 1 from public.leads where id = p_prospecto_id for update;
  end if;
  if not found then
    raise exception 'Prospecto no encontrado o sin permiso' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.crm_prospecto_contactos v
    where (p_fuente = 'demo' and v.demo_request_id = p_prospecto_id)
       or (p_fuente = 'lead' and v.lead_id = p_prospecto_id)
  ) then
    raise exception 'El prospecto ya está vinculado a un contacto'
      using errcode = '23505';
  end if;

  v_contacto_id := public.crm_guardar_contacto_plataforma(
    null, null, p_nombre, p_apellido, p_empresa, null, null,
    case when nullif(btrim(p_correo), '') is null
      then array[]::text[] else array[btrim(p_correo)] end,
    case when nullif(btrim(p_telefono), '') is null
      then array[]::text[] else array[btrim(p_telefono)] end
  );

  insert into public.crm_prospecto_contactos
    (demo_request_id, lead_id, contacto_id)
  values (
    case when p_fuente = 'demo' then p_prospecto_id else null end,
    case when p_fuente = 'lead' then p_prospecto_id else null end,
    v_contacto_id
  );

  return v_contacto_id;
end;
$function$;
REVOKE ALL ON FUNCTION public.crm_crear_contacto_desde_prospecto(text, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_crear_contacto_desde_prospecto(text, uuid, text, text, text, text, text) TO authenticated, service_role;

CREATE FUNCTION public.crm_guardar_contacto_negocio(p_contacto_id uuid, p_nombre text, p_apellido text, p_empresa text, p_direccion text, p_notas text, p_correo text, p_telefono text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_business uuid;v_id uuid;v_updated timestamptz;v_email text;v_phone text;v_phone_key text;
begin
 select p.business_id into v_business from public.profiles p join public.businesses b on b.id=p.business_id join public.crm_acceso_negocios a on a.business_id=b.id
 where p.id=(select auth.uid()) and p.active and p.role in ('admin','manager') and b.active and a.habilitado;
 if v_business is null then raise exception 'Sin acceso al CRM' using errcode='42501';end if;
 if nullif(btrim(coalesce(p_nombre,'')),'') is null and nullif(btrim(coalesce(p_empresa,'')),'') is null then raise exception 'Indica nombre o empresa';end if;
 if length(coalesce(p_nombre,''))>120 or length(coalesce(p_apellido,''))>120 or length(coalesce(p_empresa,''))>180 or length(coalesce(p_direccion,''))>2000 or length(coalesce(p_notas,''))>4000 then raise exception 'Campo demasiado largo';end if;
 v_email:=nullif(lower(btrim(coalesce(p_correo,''))),'');
 v_phone:=nullif(btrim(coalesce(p_telefono,'')),'');
 if v_email is not null and (length(v_email)>320 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then raise exception 'Correo no válido';end if;
 v_phone_key:=regexp_replace(coalesce(v_phone,''),'[^0-9]','','g');
 if v_phone is not null and (length(v_phone_key)<7 or length(v_phone_key)>15) then raise exception 'Teléfono no válido';end if;
 if v_phone_key ~ '^521[0-9]{10}$' or v_phone_key ~ '^52[0-9]{10}$' then v_phone_key:=right(v_phone_key,10);end if;
 if p_contacto_id is null then
  insert into public.crm_contactos(ambito,business_id,nombre,apellido,empresa,direccion,notas,created_by)
  values('negocio',v_business,nullif(btrim(p_nombre),''),nullif(btrim(p_apellido),''),nullif(btrim(p_empresa),''),nullif(btrim(p_direccion),''),nullif(btrim(p_notas),''),(select auth.uid())) returning id into v_id;
 else
  select updated_at into v_updated from public.crm_contactos where id=p_contacto_id and business_id=v_business and ambito='negocio' and archivado_at is null for update;
  if not found then raise exception 'Contacto no disponible' using errcode='42501';end if;
  if p_expected_updated_at is null or v_updated is distinct from p_expected_updated_at then raise exception 'El contacto cambió. Actualiza antes de guardar' using errcode='40001';end if;
  update public.crm_contactos set nombre=nullif(btrim(p_nombre),''),apellido=nullif(btrim(p_apellido),''),empresa=nullif(btrim(p_empresa),''),direccion=nullif(btrim(p_direccion),''),notas=nullif(btrim(p_notas),''),updated_at=clock_timestamp() where id=p_contacto_id;
  v_id:=p_contacto_id;
 end if;
 delete from public.crm_contacto_medios where contacto_id=v_id and tipo in ('correo','telefono');
 if v_email is not null then insert into public.crm_contacto_medios(contacto_id,tipo,valor,es_principal) values(v_id,'correo',v_email,true);end if;
 if v_phone is not null then insert into public.crm_contacto_medios(contacto_id,tipo,valor,es_principal) values(v_id,'telefono',v_phone,true);end if;
 return v_id;
end;$function$;
REVOKE ALL ON FUNCTION public.crm_guardar_contacto_negocio(uuid, text, text, text, text, text, text, text, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_guardar_contacto_negocio(uuid, text, text, text, text, text, text, text, timestamp with time zone) TO authenticated, service_role;

CREATE FUNCTION public.crm_guardar_contacto_plataforma(p_contacto_id uuid, p_expected_updated_at timestamp with time zone, p_nombre text, p_apellido text, p_empresa text, p_direccion text, p_notas text, p_correos text[], p_telefonos text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.crm_guardar_contacto_plataforma(uuid, timestamp with time zone, text, text, text, text, text, text[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_guardar_contacto_plataforma(uuid, timestamp with time zone, text, text, text, text, text, text[], text[]) TO authenticated, service_role;

CREATE FUNCTION public.crm_indicadores_negocio(p_business_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with s as (select etapa,count(*) as n,coalesce(sum(valor_estimado),0) as monto from public.crm_negocio_oportunidades where business_id=p_business_id group by etapa)
select jsonb_build_object('counts',coalesce((select jsonb_object_agg(etapa,n) from s),'{}'::jsonb),'amounts',coalesce((select jsonb_object_agg(etapa,monto) from s),'{}'::jsonb),'agenda',public.crm_agenda_negocio(p_business_id,'pendientes','',1));
$function$;
REVOKE ALL ON FUNCTION public.crm_indicadores_negocio(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_indicadores_negocio(uuid) TO authenticated, service_role;

CREATE FUNCTION public.crm_listar_contactos_plataforma(p_busqueda text DEFAULT ''::text, p_archivados boolean DEFAULT false, p_limite integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.crm_listar_contactos_plataforma(text, boolean, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_listar_contactos_plataforma(text, boolean, integer, integer) TO authenticated, service_role;

CREATE FUNCTION public.crm_marcar_medio_principal(p_contacto_id uuid, p_medio_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.crm_marcar_medio_principal(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_marcar_medio_principal(uuid, uuid) TO authenticated, service_role;

CREATE FUNCTION public.crm_registrar_cambio_etapa_negocio()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if new.etapa is distinct from old.etapa then
  insert into public.crm_negocio_actividades
   (business_id,oportunidad_id,tipo,descripcion,created_by)
  values
   (new.business_id,new.id,'cambio_etapa',
    'Etapa: ' || initcap(replace(old.etapa,'_',' ')) || ' → ' || initcap(replace(new.etapa,'_',' ')),
    (select auth.uid()));
 end if;
 return new;
end;
$function$;
REVOKE ALL ON FUNCTION public.crm_registrar_cambio_etapa_negocio() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_registrar_cambio_etapa_negocio() TO service_role;

CREATE TRIGGER crm_acceso_negocios_touch_updated_at BEFORE UPDATE ON crm_acceso_negocios FOR EACH ROW EXECUTE FUNCTION crm_contactos_touch_updated_at();

CREATE POLICY crm_acceso_negocios_lectura ON public.crm_acceso_negocios
    AS PERMISSIVE FOR SELECT TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.business_id = crm_acceso_negocios.business_id) AND (p.active IS TRUE) AND (p.role = ANY (ARRAY['admin'::text, 'manager'::text]))))));

CREATE POLICY crm_actividades_insert ON public.crm_actividades
    AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK ((( SELECT is_platform_admin() AS is_platform_admin) AND (creado_por = ( SELECT auth.uid() AS uid))));

CREATE POLICY crm_actividades_select ON public.crm_actividades
    AS PERMISSIVE FOR SELECT TO authenticated
    USING (( SELECT is_platform_admin() AS is_platform_admin));

CREATE TRIGGER crm_contacto_medios_evitar_duplicado_negocio BEFORE INSERT OR UPDATE OF contacto_id, tipo, valor ON crm_contacto_medios FOR EACH ROW EXECUTE FUNCTION crm_contacto_medios_evitar_duplicado_negocio();

CREATE TRIGGER crm_contacto_medios_evitar_duplicado_plataforma BEFORE INSERT OR UPDATE OF contacto_id, tipo, valor ON crm_contacto_medios FOR EACH ROW EXECUTE FUNCTION crm_contacto_medios_evitar_duplicado_plataforma();

CREATE POLICY crm_contacto_medios_delete ON public.crm_contacto_medios
    AS PERMISSIVE FOR DELETE TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM crm_contactos c
  WHERE ((c.id = crm_contacto_medios.contacto_id) AND (c.archivado_at IS NULL)))));

CREATE POLICY crm_contacto_medios_insert ON public.crm_contacto_medios
    AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK ((EXISTS ( SELECT 1
   FROM crm_contactos c
  WHERE ((c.id = crm_contacto_medios.contacto_id) AND (c.archivado_at IS NULL)))));

CREATE POLICY crm_contacto_medios_select ON public.crm_contacto_medios
    AS PERMISSIVE FOR SELECT TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM crm_contactos c
  WHERE (c.id = crm_contacto_medios.contacto_id))));

CREATE POLICY crm_contacto_medios_update ON public.crm_contacto_medios
    AS PERMISSIVE FOR UPDATE TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM crm_contactos c
  WHERE ((c.id = crm_contacto_medios.contacto_id) AND (c.archivado_at IS NULL)))))
    WITH CHECK ((EXISTS ( SELECT 1
   FROM crm_contactos c
  WHERE ((c.id = crm_contacto_medios.contacto_id) AND (c.archivado_at IS NULL)))));

CREATE TRIGGER crm_contactos_touch_updated_at BEFORE UPDATE ON crm_contactos FOR EACH ROW EXECUTE FUNCTION crm_contactos_touch_updated_at();

CREATE POLICY crm_contactos_negocio_insert ON public.crm_contactos
    AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK ((((ambito = 'negocio'::text) AND (EXISTS ( SELECT 1
   FROM ((profiles p
     JOIN businesses b ON ((b.id = p.business_id)))
     JOIN crm_acceso_negocios a ON ((a.business_id = p.business_id)))
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.business_id = crm_contactos.business_id) AND (p.active IS TRUE) AND (p.role = ANY (ARRAY['admin'::text, 'manager'::text])) AND (b.active IS TRUE) AND (a.habilitado IS TRUE)))))) AND created_by = (SELECT auth.uid()));

CREATE POLICY crm_contactos_negocio_select ON public.crm_contactos
    AS PERMISSIVE FOR SELECT TO authenticated
    USING (((ambito = 'negocio'::text) AND (EXISTS ( SELECT 1
   FROM ((profiles p
     JOIN businesses b ON ((b.id = p.business_id)))
     JOIN crm_acceso_negocios a ON ((a.business_id = p.business_id)))
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.business_id = crm_contactos.business_id) AND (p.active IS TRUE) AND (p.role = ANY (ARRAY['admin'::text, 'manager'::text])) AND (b.active IS TRUE) AND (a.habilitado IS TRUE))))));

CREATE POLICY crm_contactos_negocio_update ON public.crm_contactos
    AS PERMISSIVE FOR UPDATE TO authenticated
    USING (((ambito = 'negocio'::text) AND (EXISTS ( SELECT 1
   FROM ((profiles p
     JOIN businesses b ON ((b.id = p.business_id)))
     JOIN crm_acceso_negocios a ON ((a.business_id = p.business_id)))
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.business_id = crm_contactos.business_id) AND (p.active IS TRUE) AND (p.role = ANY (ARRAY['admin'::text, 'manager'::text])) AND (b.active IS TRUE) AND (a.habilitado IS TRUE))))))
    WITH CHECK (((ambito = 'negocio'::text) AND (EXISTS ( SELECT 1
   FROM ((profiles p
     JOIN businesses b ON ((b.id = p.business_id)))
     JOIN crm_acceso_negocios a ON ((a.business_id = p.business_id)))
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.business_id = crm_contactos.business_id) AND (p.active IS TRUE) AND (p.role = ANY (ARRAY['admin'::text, 'manager'::text])) AND (b.active IS TRUE) AND (a.habilitado IS TRUE))))));

CREATE POLICY crm_contactos_plataforma_insert ON public.crm_contactos
    AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK ((((ambito = 'plataforma'::text) AND ( SELECT is_platform_admin() AS is_platform_admin))) AND created_by = (SELECT auth.uid()));

CREATE POLICY crm_contactos_plataforma_select ON public.crm_contactos
    AS PERMISSIVE FOR SELECT TO authenticated
    USING (((ambito = 'plataforma'::text) AND ( SELECT is_platform_admin() AS is_platform_admin)));

CREATE POLICY crm_contactos_plataforma_update ON public.crm_contactos
    AS PERMISSIVE FOR UPDATE TO authenticated
    USING (((ambito = 'plataforma'::text) AND ( SELECT is_platform_admin() AS is_platform_admin)))
    WITH CHECK (((ambito = 'plataforma'::text) AND ( SELECT is_platform_admin() AS is_platform_admin)));

CREATE POLICY crm_negocio_actividades_insert ON public.crm_negocio_actividades
    AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM (((crm_negocio_oportunidades o
     JOIN profiles p ON ((p.business_id = o.business_id)))
     JOIN businesses b ON ((b.id = o.business_id)))
     JOIN crm_acceso_negocios a ON ((a.business_id = o.business_id)))
  WHERE ((o.id = crm_negocio_actividades.oportunidad_id) AND (o.business_id = crm_negocio_actividades.business_id) AND (p.id = ( SELECT auth.uid() AS uid)) AND (p.active IS TRUE) AND (p.role = ANY (ARRAY['admin'::text, 'manager'::text])) AND (b.active IS TRUE) AND (a.habilitado IS TRUE))))));

CREATE POLICY crm_negocio_actividades_select ON public.crm_negocio_actividades
    AS PERMISSIVE FOR SELECT TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM (((crm_negocio_oportunidades o
     JOIN profiles p ON ((p.business_id = o.business_id)))
     JOIN businesses b ON ((b.id = o.business_id)))
     JOIN crm_acceso_negocios a ON ((a.business_id = o.business_id)))
  WHERE ((o.id = crm_negocio_actividades.oportunidad_id) AND (o.business_id = crm_negocio_actividades.business_id) AND (p.id = ( SELECT auth.uid() AS uid)) AND (p.active IS TRUE) AND (p.role = ANY (ARRAY['admin'::text, 'manager'::text])) AND (b.active IS TRUE) AND (a.habilitado IS TRUE)))));

CREATE TRIGGER crm_negocio_oportunidades_auditar_etapa AFTER UPDATE OF etapa ON crm_negocio_oportunidades FOR EACH ROW WHEN (old.etapa IS DISTINCT FROM new.etapa) EXECUTE FUNCTION crm_registrar_cambio_etapa_negocio();

CREATE POLICY crm_negocio_oportunidades_insert ON public.crm_negocio_oportunidades
    AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM ((profiles p
     JOIN businesses b ON ((b.id = p.business_id)))
     JOIN crm_acceso_negocios a ON ((a.business_id = p.business_id)))
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.business_id = crm_negocio_oportunidades.business_id) AND (p.active IS TRUE) AND (p.role = ANY (ARRAY['admin'::text, 'manager'::text])) AND (b.active IS TRUE) AND (a.habilitado IS TRUE)))) AND (EXISTS ( SELECT 1
   FROM crm_contactos c
  WHERE ((c.id = crm_negocio_oportunidades.contacto_id) AND (c.business_id = crm_negocio_oportunidades.business_id) AND (c.ambito = 'negocio'::text) AND (c.archivado_at IS NULL))))));

CREATE POLICY crm_negocio_oportunidades_select ON public.crm_negocio_oportunidades
    AS PERMISSIVE FOR SELECT TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM ((profiles p
     JOIN businesses b ON ((b.id = p.business_id)))
     JOIN crm_acceso_negocios a ON ((a.business_id = p.business_id)))
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.business_id = crm_negocio_oportunidades.business_id) AND (p.active IS TRUE) AND (p.role = ANY (ARRAY['admin'::text, 'manager'::text])) AND (b.active IS TRUE) AND (a.habilitado IS TRUE)))));

CREATE POLICY crm_negocio_oportunidades_update ON public.crm_negocio_oportunidades
    AS PERMISSIVE FOR UPDATE TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM ((profiles p
     JOIN businesses b ON ((b.id = p.business_id)))
     JOIN crm_acceso_negocios a ON ((a.business_id = p.business_id)))
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.business_id = crm_negocio_oportunidades.business_id) AND (p.active IS TRUE) AND (p.role = ANY (ARRAY['admin'::text, 'manager'::text])) AND (b.active IS TRUE) AND (a.habilitado IS TRUE)))))
    WITH CHECK (((EXISTS ( SELECT 1
   FROM ((profiles p
     JOIN businesses b ON ((b.id = p.business_id)))
     JOIN crm_acceso_negocios a ON ((a.business_id = p.business_id)))
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.business_id = crm_negocio_oportunidades.business_id) AND (p.active IS TRUE) AND (p.role = ANY (ARRAY['admin'::text, 'manager'::text])) AND (b.active IS TRUE) AND (a.habilitado IS TRUE)))) AND (EXISTS ( SELECT 1
   FROM crm_contactos c
  WHERE ((c.id = crm_negocio_oportunidades.contacto_id) AND (c.business_id = crm_negocio_oportunidades.business_id) AND (c.ambito = 'negocio'::text) AND (c.archivado_at IS NULL))))));

CREATE POLICY crm_negocio_tareas_insert ON public.crm_negocio_tareas
    AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM crm_negocio_oportunidades o
  WHERE (o.id = crm_negocio_tareas.oportunidad_id)))));

CREATE POLICY crm_negocio_tareas_select ON public.crm_negocio_tareas
    AS PERMISSIVE FOR SELECT TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM crm_negocio_oportunidades o
  WHERE (o.id = crm_negocio_tareas.oportunidad_id))));

CREATE POLICY crm_negocio_tareas_update ON public.crm_negocio_tareas
    AS PERMISSIVE FOR UPDATE TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM (((crm_negocio_oportunidades o
     JOIN profiles p ON ((p.business_id = o.business_id)))
     JOIN businesses b ON ((b.id = o.business_id)))
     JOIN crm_acceso_negocios a ON ((a.business_id = o.business_id)))
  WHERE ((o.id = crm_negocio_tareas.oportunidad_id) AND (p.id = ( SELECT auth.uid() AS uid)) AND (p.active IS TRUE) AND (p.role = ANY (ARRAY['admin'::text, 'manager'::text])) AND (b.active IS TRUE) AND (a.habilitado IS TRUE)))))
    WITH CHECK ((EXISTS ( SELECT 1
   FROM (((crm_negocio_oportunidades o
     JOIN profiles p ON ((p.business_id = o.business_id)))
     JOIN businesses b ON ((b.id = o.business_id)))
     JOIN crm_acceso_negocios a ON ((a.business_id = o.business_id)))
  WHERE ((o.id = crm_negocio_tareas.oportunidad_id) AND (p.id = ( SELECT auth.uid() AS uid)) AND (p.active IS TRUE) AND (p.role = ANY (ARRAY['admin'::text, 'manager'::text])) AND (b.active IS TRUE) AND (a.habilitado IS TRUE)))));

CREATE POLICY crm_oportunidad_actividades_insert_admin ON public.crm_oportunidad_actividades
    AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK ((( SELECT is_platform_admin() AS is_platform_admin) AND (creado_por = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM crm_oportunidades o
  WHERE (o.id = crm_oportunidad_actividades.oportunidad_id)))));

CREATE POLICY crm_oportunidad_actividades_select_admin ON public.crm_oportunidad_actividades
    AS PERMISSIVE FOR SELECT TO authenticated
    USING (( SELECT is_platform_admin() AS is_platform_admin));

CREATE POLICY crm_oportunidad_tareas_insert_admin ON public.crm_oportunidad_tareas
    AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK ((( SELECT is_platform_admin() AS is_platform_admin) AND (creado_por = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM crm_oportunidades o
  WHERE (o.id = crm_oportunidad_tareas.oportunidad_id)))));

CREATE POLICY crm_oportunidad_tareas_read_admin ON public.crm_oportunidad_tareas
    AS PERMISSIVE FOR SELECT TO authenticated
    USING (( SELECT is_platform_admin() AS is_platform_admin));

CREATE POLICY crm_oportunidad_tareas_update_admin ON public.crm_oportunidad_tareas
    AS PERMISSIVE FOR UPDATE TO authenticated
    USING (( SELECT is_platform_admin() AS is_platform_admin))
    WITH CHECK ((( SELECT is_platform_admin() AS is_platform_admin) AND (creado_por = ( SELECT auth.uid() AS uid))));

CREATE POLICY crm_oportunidades_insert ON public.crm_oportunidades
    AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK ((( SELECT is_platform_admin() AS is_platform_admin) AND (created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM crm_contactos c
  WHERE ((c.id = crm_oportunidades.contacto_id) AND (c.ambito = 'plataforma'::text) AND (c.archivado_at IS NULL))))));

CREATE POLICY crm_oportunidades_select ON public.crm_oportunidades
    AS PERMISSIVE FOR SELECT TO authenticated
    USING ((( SELECT is_platform_admin() AS is_platform_admin) AND (EXISTS ( SELECT 1
   FROM crm_contactos c
  WHERE ((c.id = crm_oportunidades.contacto_id) AND (c.ambito = 'plataforma'::text))))));

CREATE POLICY crm_oportunidades_update ON public.crm_oportunidades
    AS PERMISSIVE FOR UPDATE TO authenticated
    USING ((( SELECT is_platform_admin() AS is_platform_admin) AND (EXISTS ( SELECT 1
   FROM crm_contactos c
  WHERE ((c.id = crm_oportunidades.contacto_id) AND (c.ambito = 'plataforma'::text))))))
    WITH CHECK ((( SELECT is_platform_admin() AS is_platform_admin) AND (created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM crm_contactos c
  WHERE ((c.id = crm_oportunidades.contacto_id) AND (c.ambito = 'plataforma'::text) AND (c.archivado_at IS NULL))))));

CREATE POLICY crm_prospecto_contactos_delete ON public.crm_prospecto_contactos
    AS PERMISSIVE FOR DELETE TO authenticated
    USING ((( SELECT is_platform_admin() AS is_platform_admin) AND (EXISTS ( SELECT 1
   FROM crm_contactos c
  WHERE ((c.id = crm_prospecto_contactos.contacto_id) AND (c.ambito = 'plataforma'::text))))));

CREATE POLICY crm_prospecto_contactos_insert ON public.crm_prospecto_contactos
    AS PERMISSIVE FOR INSERT TO authenticated
    WITH CHECK ((( SELECT is_platform_admin() AS is_platform_admin) AND (EXISTS ( SELECT 1
   FROM crm_contactos c
  WHERE ((c.id = crm_prospecto_contactos.contacto_id) AND (c.ambito = 'plataforma'::text) AND (c.archivado_at IS NULL)))) AND (((demo_request_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM demo_requests d
  WHERE (d.id = crm_prospecto_contactos.demo_request_id)))) OR ((lead_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM leads l
  WHERE (l.id = crm_prospecto_contactos.lead_id)))))));

CREATE POLICY crm_prospecto_contactos_select ON public.crm_prospecto_contactos
    AS PERMISSIVE FOR SELECT TO authenticated
    USING ((( SELECT is_platform_admin() AS is_platform_admin) AND (EXISTS ( SELECT 1
   FROM crm_contactos c
  WHERE ((c.id = crm_prospecto_contactos.contacto_id) AND (c.ambito = 'plataforma'::text)))) AND (((demo_request_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM demo_requests d
  WHERE (d.id = crm_prospecto_contactos.demo_request_id)))) OR ((lead_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM leads l
  WHERE (l.id = crm_prospecto_contactos.lead_id)))))));

GRANT SELECT ON TABLE public.crm_acceso_negocios TO authenticated;
GRANT ALL ON TABLE public.crm_acceso_negocios TO service_role;

GRANT SELECT, INSERT (demo_request_id, lead_id, tipo, detalle) ON TABLE public.crm_actividades TO authenticated;
GRANT ALL ON TABLE public.crm_actividades TO service_role;

GRANT SELECT, INSERT (contacto_id, tipo, valor, es_principal), UPDATE (tipo, valor, es_principal), DELETE ON TABLE public.crm_contacto_medios TO authenticated;
GRANT ALL ON TABLE public.crm_contacto_medios TO service_role;

GRANT SELECT, INSERT (ambito, business_id, nombre, apellido, empresa, direccion, notas, created_by), UPDATE (nombre, apellido, empresa, direccion, notas, archivado_at, updated_at) ON TABLE public.crm_contactos TO authenticated;
GRANT ALL ON TABLE public.crm_contactos TO service_role;

GRANT SELECT, INSERT (business_id, oportunidad_id, tipo, descripcion, created_by) ON TABLE public.crm_negocio_actividades TO authenticated;
GRANT ALL ON TABLE public.crm_negocio_actividades TO service_role;

GRANT SELECT, INSERT (business_id, contacto_id, titulo, etapa, valor_estimado, created_by), UPDATE (titulo, contacto_id, valor_estimado, etapa, updated_at) ON TABLE public.crm_negocio_oportunidades TO authenticated;
GRANT ALL ON TABLE public.crm_negocio_oportunidades TO service_role;

GRANT SELECT, INSERT (oportunidad_id, titulo, vence_at, created_by), UPDATE (completada_at) ON TABLE public.crm_negocio_tareas TO authenticated;
GRANT ALL ON TABLE public.crm_negocio_tareas TO service_role;

GRANT SELECT, INSERT (oportunidad_id, tipo, detalle, creado_por) ON TABLE public.crm_oportunidad_actividades TO authenticated;
GRANT ALL ON TABLE public.crm_oportunidad_actividades TO service_role;

GRANT SELECT, INSERT (oportunidad_id, titulo, vence_at, creado_por), UPDATE (completada_at, updated_at) ON TABLE public.crm_oportunidad_tareas TO authenticated;
GRANT ALL ON TABLE public.crm_oportunidad_tareas TO service_role;

GRANT SELECT, INSERT (contacto_id, titulo, etapa, valor_estimado, fecha_cierre_estimada, notas, created_by), UPDATE (contacto_id, titulo, etapa, valor_estimado, fecha_cierre_estimada, notas, updated_at) ON TABLE public.crm_oportunidades TO authenticated;
GRANT ALL ON TABLE public.crm_oportunidades TO service_role;

GRANT SELECT, INSERT (demo_request_id, lead_id, contacto_id), DELETE ON TABLE public.crm_prospecto_contactos TO authenticated;
GRANT ALL ON TABLE public.crm_prospecto_contactos TO service_role;

NOTIFY pgrst, 'reload schema';
