alter table public.crm_negocio_actividades
  add column contacto_id uuid references public.crm_contactos(id),
  alter column oportunidad_id drop not null,
  add constraint crm_actividad_un_destino check (num_nonnulls(contacto_id,oportunidad_id)=1);

create index crm_actividad_por_contacto on public.crm_negocio_actividades(contacto_id,created_at)
  where contacto_id is not null;

create policy crm_actividad_contacto_leer on public.crm_negocio_actividades for select to authenticated
using (exists (select from public.crm_contactos c where c.id=contacto_id
  and c.business_id=crm_negocio_actividades.business_id and c.ambito='negocio'));

create policy crm_actividad_contacto_registrar on public.crm_negocio_actividades for insert to authenticated
with check (created_by=(select auth.uid()) and tipo in ('llamada','mensaje','reunion','nota')
  and exists (select from public.crm_contactos c where c.id=contacto_id
    and c.business_id=crm_negocio_actividades.business_id and c.ambito='negocio' and c.archivado_at is null));

grant select(contacto_id),insert(contacto_id) on public.crm_negocio_actividades to authenticated;
