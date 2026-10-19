-- Colony work system P0/P1: server-side ledger, watch-only addresses, proposals, audit, switch.
--
-- ADDITIVE ONLY: new colony_* tables, nothing existing is altered or dropped. Idempotent
-- (if not exists / on conflict do nothing). DO NOT apply to the production database without Sun's
-- OK and a fresh backup first.
--
-- No column anywhere stores key material, a word list, or a signature secret. Addresses are public
-- addresses only (format-checked server-side). Amounts are integer US cents. Bots have no spend
-- path: there is no withdraw table, column, or route.

create table if not exists colony_settings (
  key text primary key,
  value text not null,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

-- The admin work switch starts OFF. The server env COLONY_WORK_ENABLED=on is also required.
insert into colony_settings (key, value, updated_by) values ('work_switch', 'off', 'migration')
  on conflict (key) do nothing;

create table if not exists colony_ledger (
  id text primary key,
  citizen_id text not null,
  job_id text not null,
  source text not null check (source in ('internal', 'stripe', 'paypal', 'chain')),
  ref text not null default '',
  amount_cents integer not null check (amount_cents > 0),
  state text not null default 'pending' check (state in ('pending', 'cleared', 'reversed')),
  created_by text not null,
  created_at timestamptz not null default now(),
  changed_at timestamptz not null default now()
);
create index if not exists colony_ledger_citizen_idx on colony_ledger (citizen_id);

create table if not exists colony_addresses (
  id text primary key,
  citizen_id text not null,
  chain text not null check (chain in ('evm', 'solana-devnet', 'solana')),
  address text not null check (char_length(address) between 32 and 44),
  active boolean not null default true,
  added_by text not null,
  added_at timestamptz not null default now()
);
create unique index if not exists colony_addresses_chain_address_idx on colony_addresses (chain, lower(address));

create table if not exists colony_proposals (
  id text primary key,
  citizen_id text,
  bot text not null,
  city text not null,
  job text not null,
  price text not null,
  kind text not null,
  work_id text,
  payload text not null default '',
  target text not null default '',
  expected_cents integer not null default 0 check (expected_cents >= 0),
  status text not null default 'open' check (status in ('open', 'approved', 'refused')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text
);
create index if not exists colony_proposals_open_idx on colony_proposals (citizen_id) where status = 'open';

insert into colony_proposals (id, bot, city, job, price, kind) values
  ('ride-kemi', 'Kemi', 'Port Harcourt', 'A keke ride between two public stops', 'The fare is paid to the driver, in your wallet', 'ride'),
  ('stall-chioma', 'Chioma', 'Lagos', 'One stall hour at the public market', 'The fee is paid to the shop, in your wallet', 'stall'),
  ('compute-eko', 'Eko', 'Port Harcourt', 'One sandboxed job from our own catalog', 'The fee is paid for that job, in your wallet', 'compute')
  on conflict (id) do nothing;

create table if not exists colony_audit (
  seq bigserial primary key,
  at timestamptz not null default now(),
  actor_id text not null,
  actor text not null,
  action text not null,
  subject text not null,
  detail text not null default ''
);

-- Append-only: refuse any edit or delete of an audit row.
create or replace function colony_audit_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'colony_audit is append-only';
end;
$$;
drop trigger if exists colony_audit_no_edit on colony_audit;
create trigger colony_audit_no_edit before update or delete on colony_audit
  for each row execute function colony_audit_append_only();
