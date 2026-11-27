begin;

create table public.personal_goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  target numeric(14,2) not null check (target > 0 and target <> 'NaN'),
  unique (owner_id, id)
);

create table public.personal_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('Gasto','Ingreso','Ahorro')),
  amount numeric(14,2) not null check (amount > 0 and amount <> 'NaN'),
  occurred_at timestamptz not null default now(),
  category text not null check (length(trim(category)) between 1 and 80),
  concept text not null default '' check (length(concept) <= 160),
  method text not null check (method in ('Efectivo','Tarjeta','Transferencia')),
  goal_id uuid,
  check (kind = 'Ahorro' or goal_id is null),
  foreign key (owner_id, goal_id) references public.personal_goals(owner_id, id)
);
create index personal_entries_period on public.personal_entries(owner_id, occurred_at desc);
create index personal_entries_savings on public.personal_entries(owner_id, goal_id) where kind = 'Ahorro';

alter table public.personal_goals enable row level security;
alter table public.personal_entries enable row level security;
revoke all on public.personal_goals, public.personal_entries from public, anon, authenticated;
grant select, insert on public.personal_goals, public.personal_entries to authenticated;
create policy own_goals_read on public.personal_goals for select to authenticated using (owner_id = (select auth.uid()));
create policy own_goals_insert on public.personal_goals for insert to authenticated with check (owner_id = (select auth.uid()));
create policy own_entries_read on public.personal_entries for select to authenticated using (owner_id = (select auth.uid()));
create policy own_entries_insert on public.personal_entries for insert to authenticated with check (owner_id = (select auth.uid()));

create function public.personal_budget_summary(period_start timestamptz, period_end timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with savings as (
    select goal_id, sum(amount) saved from public.personal_entries
    where owner_id = (select auth.uid()) and kind = 'Ahorro' group by goal_id
  ), goals as (
    select g.id, g.name, g.target, coalesce(s.saved, 0) saved
    from public.personal_goals g left join savings s on g.id = s.goal_id
    where g.owner_id = (select auth.uid())
  ), period_entries as (
    select id, category, kind, amount, concept, occurred_at, method, goal_id
    from public.personal_entries where owner_id = (select auth.uid())
    and occurred_at >= period_start and occurred_at < period_end
  )
  select jsonb_build_object(
    'goals', coalesce((select jsonb_agg(g order by name,id) from goals g), '[]'),
    'general', coalesce((select saved from savings where goal_id is null), 0),
    'entries', coalesce((select jsonb_agg(e order by occurred_at desc,id) from period_entries e), '[]')
  );
$$;
revoke all on function public.personal_budget_summary(timestamptz,timestamptz) from public, anon;
grant execute on function public.personal_budget_summary(timestamptz,timestamptz) to authenticated;
commit;
