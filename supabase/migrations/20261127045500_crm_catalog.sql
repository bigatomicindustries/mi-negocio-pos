create table public.crm_catalogo (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id),
 nombre text not null check(length(trim(nombre)) between 1 and 240),
 tipo text not null check(tipo in ('Producto','Servicio')),
 precio numeric(14,2) not null check(precio >= 0 and precio <> 'NaN'::numeric),
 sku text not null default '', categoria text not null default '', descripcion text not null default '',
 disponibilidad text not null check(disponibilidad in ('Disponible','Sobre pedido','Importación','Sin disponibilidad')),
 campos jsonb not null default '{}' check(jsonb_typeof(campos)='object' and not jsonb_path_exists(campos, '$.* ? (@.type() != "string")')),
 activo boolean not null default true,
 updated_at timestamptz not null default now()
);
create unique index crm_catalogo_sku on public.crm_catalogo(business_id,lower(trim(sku))) where trim(sku)<>'';
create index crm_catalogo_listado on public.crm_catalogo(business_id,activo,nombre,id);
alter table public.crm_catalogo enable row level security;
revoke all on public.crm_catalogo from public,anon,authenticated;
grant select, insert(business_id,nombre,tipo,precio,sku,categoria,descripcion,disponibilidad,campos,activo),
 update(nombre,tipo,precio,sku,categoria,descripcion,disponibilidad,campos,activo)
 on public.crm_catalogo to authenticated;
create policy catalogo_mi_negocio on public.crm_catalogo for all to authenticated
 using (business_id=public.current_business_id() and exists(select from public.crm_acceso_negocios a where a.business_id=crm_catalogo.business_id and a.habilitado));
create trigger pos_trial_guard before insert or update or delete on public.crm_catalogo
 for each row execute function pos_private.guard_trial_write('business_id');
create function pos_private.catalogo_fecha() returns trigger language plpgsql as $$
begin new.updated_at:=clock_timestamp(); return new; end $$;
create trigger catalogo_actualizado before update on public.crm_catalogo for each row execute function pos_private.catalogo_fecha();

-- Each opportunity keeps the name and price that were accepted when the item was selected.
alter table public.crm_negocio_oportunidades add column partidas jsonb not null default '[]';
grant select(partidas), insert(partidas), update(partidas) on public.crm_negocio_oportunidades to authenticated;

create function pos_private.catalogo_calcular_importe() returns trigger language plpgsql security invoker set search_path='' as $$
declare
 linea jsonb; anterior jsonb; previas jsonb := '[]'; resultado jsonb := '[]';
 articulo uuid; cantidad integer; nombre text; precio numeric; total numeric:=0; vistos uuid[]:='{}';
begin
 if jsonb_typeof(new.partidas) is distinct from 'array' then raise exception 'Selección de catálogo inválida'; end if;
 if new.partidas='[]' then return new; end if;
 if tg_op='UPDATE' then previas:=old.partidas; end if;
 for linea in select value from jsonb_array_elements(new.partidas) loop
  articulo:=(linea->>'id')::uuid;
  cantidad:=(linea->>'cantidad')::integer;
  if articulo is null or articulo=any(vistos) or cantidad is null or cantidad<1 then raise exception 'Revisa los artículos y cantidades'; end if;
  vistos:=array_append(vistos,articulo);
  select value into anterior from jsonb_array_elements(previas) where value->>'id'=articulo::text;
  if anterior is null then
   select c.nombre,c.precio into nombre,precio from public.crm_catalogo c where c.id=articulo and c.business_id=new.business_id and c.activo;
   if not found then raise exception 'Artículo no disponible en el catálogo'; end if;
  else nombre:=anterior->>'nombre'; precio:=(anterior->>'precio')::numeric; end if;
  if precio is distinct from (linea->>'precio')::numeric then raise exception 'El precio cambió. Actualiza la selección antes de guardar.'; end if;
  total:=total+precio*cantidad;
  resultado:=resultado || jsonb_build_array(jsonb_build_object('id',articulo,'cantidad',cantidad,'precio',precio,'nombre',nombre));
 end loop;
 new.partidas:=resultado; new.valor_estimado:=total; return new;
end $$;
create trigger crm_catalogo_importe before insert or update of partidas,valor_estimado on public.crm_negocio_oportunidades
 for each row execute function pos_private.catalogo_calcular_importe();
