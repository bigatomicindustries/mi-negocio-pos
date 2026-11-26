update public.plans as p
set max_users = limits.users, max_products = limits.products, updated_at = now()
from (values
  ('free', 1, 100),
  ('basic', 1, 100),
  ('pro', 3, 1000),
  ('business', 10, 10000)
) as limits(tier, users, products)
where p.slug in (limits.tier, limits.tier || '-v1')
  and (p.max_users, p.max_products) is distinct from (limits.users, limits.products);
