begin;

alter table public.personal_goals add column completed_at timestamptz;
alter table public.personal_entries add column date_only date;
grant update (completed_at) on public.personal_goals to authenticated;
grant update (occurred_at, date_only) on public.personal_entries to authenticated;
create policy complete_own_goals on public.personal_goals for update to authenticated
  using (owner_id = (select auth.uid()) and completed_at is null)
  with check (owner_id = (select auth.uid()) and completed_at is not null);
create policy date_own_entries on public.personal_entries for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create function public.check_personal_goal_open() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.personal_goals where owner_id = new.owner_id and id = new.goal_id
    and completed_at is null for share;
  if not found then raise exception 'La meta ya no admite aportaciones'; end if;
  return new;
end;
$$;
create trigger check_personal_goal_open before insert on public.personal_entries
for each row when (new.goal_id is not null) execute function public.check_personal_goal_open();

create or replace function public.personal_budget_details(period_start timestamptz, period_end timestamptz, start_day date, end_day date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with savings as (
    select goal_id, sum(amount) saved from public.personal_entries
    where owner_id = (select auth.uid()) and kind = 'Ahorro' group by goal_id
  ), goals as (
    select g.id, g.name, g.target, g.completed_at, coalesce(s.saved, 0) saved
    from public.personal_goals g left join savings s on g.id = s.goal_id
    where g.owner_id = (select auth.uid())
  ), charges as (
    select card_id, sum(amount) over (partition by card_id order by occurred_at,id) as spent,
      row_number() over (partition by card_id order by occurred_at desc,id desc) as recent
    from public.personal_entries where owner_id = (select auth.uid()) and card_id is not null
  ), cards as (
    select c.id, c.name, c.card_type, c.cutoff_day, c.opening_available,
      c.opening_available - coalesce(max(ch.spent),0) as available,
      coalesce(jsonb_agg(c.opening_available - ch.spent order by ch.recent desc)
        filter (where ch.recent is not null), '[]') as balances
    from public.personal_cards c left join charges ch on ch.card_id = c.id and ch.recent <= 15
    where c.owner_id = (select auth.uid()) group by c.id
  ), period_entries as (
    select id, category, kind, amount, concept, occurred_at, date_only, method, goal_id, card_id
    from public.personal_entries where owner_id = (select auth.uid())
    and ((date_only is null and occurred_at >= period_start and occurred_at < period_end)
      or (date_only >= start_day and date_only < end_day))
  )
  select jsonb_build_object(
    'cards', coalesce((select jsonb_agg(c order by name,id) from cards c), '[]'),
    'goals', coalesce((select jsonb_agg(g order by name,id) from goals g), '[]'),
    'general', coalesce((select saved from savings where goal_id is null), 0),
    'entries', coalesce((select jsonb_agg(e order by occurred_at desc,id) from period_entries e), '[]')
  );
$$;
revoke all on function public.personal_budget_details(timestamptz,timestamptz,date,date) from public, anon;
grant execute on function public.personal_budget_details(timestamptz,timestamptz,date,date) to authenticated;
commit;
