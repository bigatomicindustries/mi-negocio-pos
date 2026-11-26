alter table public.crm_negocio_oportunidades add column nota_fija text not null default '';
grant select (nota_fija), update (nota_fija) on public.crm_negocio_oportunidades to authenticated;
