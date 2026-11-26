insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('crm-catalogo','crm-catalogo',false,2097152,array['image/jpeg','image/png','image/webp']);

create function public.crm_catalogo_foto_permitida(ruta text) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select from public.crm_catalogo c where c.business_id=public.current_business_id()
  and ruta=c.business_id::text||'/'||c.id::text)
$$;
revoke all on function public.crm_catalogo_foto_permitida(text) from public,anon;
grant execute on function public.crm_catalogo_foto_permitida(text) to authenticated;
create policy crm_catalogo_foto_leer on storage.objects for select to authenticated
 using (bucket_id='crm-catalogo' and public.crm_catalogo_foto_permitida(name));
create policy crm_catalogo_foto_crear on storage.objects for insert to authenticated
 with check(bucket_id='crm-catalogo' and public.crm_catalogo_foto_permitida(name) and coalesce(public.my_trial_end()>now(),true));
create policy crm_catalogo_foto_cambiar on storage.objects for update to authenticated
 using(bucket_id='crm-catalogo' and public.crm_catalogo_foto_permitida(name) and coalesce(public.my_trial_end()>now(),true))
 with check(bucket_id='crm-catalogo' and public.crm_catalogo_foto_permitida(name) and coalesce(public.my_trial_end()>now(),true));

create function public.crm_catalogo_fotos(rutas text[]) returns setof text
language sql stable security invoker set search_path='' as $$
 select name from storage.objects where bucket_id='crm-catalogo' and name=any(rutas)
$$;
revoke all on function public.crm_catalogo_fotos(text[]) from public,anon;
grant execute on function public.crm_catalogo_fotos(text[]) to authenticated;
