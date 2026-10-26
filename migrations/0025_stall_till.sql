create table if not exists stall_payments (
  reference text primary key,
  user_id text not null,
  sku text not null,
  kobo integer not null check (kobo > 0 and kobo <= 5000000),
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists stall_payments_user_idx on stall_payments (user_id, created_at desc);
