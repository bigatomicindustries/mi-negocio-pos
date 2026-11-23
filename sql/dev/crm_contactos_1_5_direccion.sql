-- Mi Negocio CRM 1.5 — Dirección libre y opcional (solo DEV)
-- Ejecutar exclusivamente en Mi Negocio DEV (pablbrladwjuczhazsms).
-- No ejecutar en producción sin autorización independiente.

alter table public.crm_contactos
  add column direccion text
    constraint crm_contactos_direccion_longitud
    check (char_length(direccion) <= 2000);

grant insert (direccion), update (direccion)
  on public.crm_contactos to authenticated;

comment on column public.crm_contactos.direccion is
  'Dirección libre opcional, sin desglose obligatorio de calle, colonia o código postal.';
