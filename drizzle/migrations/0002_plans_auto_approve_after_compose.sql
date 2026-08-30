alter table public.plans
  add column if not exists auto_approve_after_compose boolean not null default false;