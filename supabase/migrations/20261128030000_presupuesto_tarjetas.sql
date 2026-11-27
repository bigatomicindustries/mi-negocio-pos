begin;

create table public.personal_cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  card_type text not null check (card_type in ('Crédito','Débito')),
  opening_available numeric(14,2) not null check (opening_available >= 0 and opening_available <> 'NaN'),
  cutoff_day smallint check (cutoff_day between 1 and 31),
  check (card_type <> 'Crédito' or cutoff_day is not null),
  unique(owner_id,id)
);
alter table public.personal_cards enable row level security;
revoke all on public.personal_cards from public, anon, authenticated;
grant select, insert on public.personal_cards to authenticated;
create policy own_cards_read on public.personal_cards for select to authenticated using (owner_id = (select auth.uid()));
create policy own_cards_insert on public.personal_cards for insert to authenticated with check (owner_id = (select auth.uid()));

alter table public.personal_entries add column card_id uuid,
  add foreign key (owner_id, card_id) references public.personal_cards(owner_id,id),
  add check (card_id is null or (method = 'Tarjeta' and kind = 'Gasto'));
create index personal_entries_card on public.personal_entries(owner_id,card_id,occurred_at,id) where card_id is not null;

create or replace function public.personal_budget_summary(period_start timestamptz, period_end timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with savings as (
    select goal_id, sum(amount) saved from public.personal_entries
    where owner_id = (select auth.uid()) and kind = 'Ahorro' group by goal_id
  ), goals as (
    select g.id, g.name, g.target, coalesce(s.saved, 0) saved
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
    select id, category, kind, amount, concept, occurred_at, method, goal_id, card_id
    from public.personal_entries where owner_id = (select auth.uid())
    and occurred_at >= period_start and occurred_at < period_end
  )
  select jsonb_build_object(
    'cards', coalesce((select jsonb_agg(c order by name,id) from cards c), '[]'),
    'goals', coalesce((select jsonb_agg(g order by name,id) from goals g), '[]'),
    'general', coalesce((select saved from savings where goal_id is null), 0),
    'entries', coalesce((select jsonb_agg(e order by occurred_at desc,id) from period_entries e), '[]')
  );
$$;
revoke all on function public.personal_budget_summary(timestamptz,timestamptz) from public, anon;
grant execute on function public.personal_budget_summary(timestamptz,timestamptz) to authenticated;
commit;
