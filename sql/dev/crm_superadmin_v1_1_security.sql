-- CRM 1.0 / DEV: minimal platform-admin hardening.
-- Apply in Mi Negocio DEV first. Do not apply to PROD without launch approval.
--
-- platform_admins is read only through the SECURITY DEFINER membership check.
-- RLS does not restrict TRUNCATE; remove table-level privileges from clients.
revoke all privileges on table public.platform_admins from public, anon, authenticated;

-- A revoked/inactive profile must never retain platform-wide CRM access.
-- Keep SECURITY DEFINER for the private membership lookup, with a fixed path.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.platform_admins pa
    join public.profiles p on p.id = pa.user_id
    where pa.user_id = auth.uid()
      and p.active is true
  );
$$;

-- Only authenticated sessions and trusted server code may call the check.
revoke all privileges on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;
