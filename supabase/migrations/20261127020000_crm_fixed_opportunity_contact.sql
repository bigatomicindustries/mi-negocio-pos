create function pos_private.keep_opportunity_contact() returns trigger
language plpgsql set search_path='' as $$
begin
 raise exception 'El contacto de una oportunidad creada no se puede cambiar.' using errcode='23514';
end $$;
create trigger crm_keep_opportunity_contact before update of contacto_id on public.crm_negocio_oportunidades
for each row when (old.contacto_id is distinct from new.contacto_id)
execute function pos_private.keep_opportunity_contact();
