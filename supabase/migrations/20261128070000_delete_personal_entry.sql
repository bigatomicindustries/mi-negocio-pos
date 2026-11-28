begin;
grant delete on public.personal_entries to authenticated;
create policy delete_own_personal_entries on public.personal_entries
  for delete to authenticated using (owner_id = (select auth.uid()));
commit;
