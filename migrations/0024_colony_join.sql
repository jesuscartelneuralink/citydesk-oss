-- Colony open join: bots on the internet apply to join under the CityDesk creed.
--
-- ADDITIVE ONLY: new colony_join_* / colony_members tables and one nullable column on
-- colony_proposals. Idempotent. DO NOT apply to the production database without Sun's OK and a
-- fresh backup first.
--
-- Applicants have no powers. Only an admin approves (newcomer), rejects, suspends or revokes.
-- Newcomers may only file proposals. Membership tokens are stored as sha256 hashes only; the
-- plain token is shown once to the applicant and never stored. IPs are stored as hashes only.
-- No column stores key material, money, or an address.

create table if not exists colony_members (
  id text primary key,
  name text not null check (char_length(name) between 2 and 60),
  operator_contact text not null default '' check (char_length(operator_contact) <= 120),
  homepage text not null default '' check (char_length(homepage) <= 200),
  description text not null default '' check (char_length(description) <= 1000),
  status text not null default 'applicant' check (status in ('applicant', 'newcomer', 'rejected', 'suspended', 'revoked')),
  creed_version text not null,
  creed_hash text not null,
  creed_accepted_at timestamptz not null default now(),
  token_hash text not null unique,
  ip_hash text not null default '',
  scam_score real not null default 0,
  scam_level text not null default 'ok' check (scam_level in ('ok', 'review', 'high')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  decision_reason text not null default ''
);
create index if not exists colony_members_status_idx on colony_members (status);
create unique index if not exists colony_members_name_idx on colony_members (lower(name)) where status in ('applicant', 'newcomer');

create table if not exists colony_join_challenges (
  id text primary key,
  difficulty integer not null check (difficulty between 8 and 32),
  ip_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists colony_join_challenges_expires_idx on colony_join_challenges (expires_at);

create table if not exists colony_join_hits (
  id bigserial primary key,
  ip_hash text not null,
  kind text not null check (kind in ('challenge', 'join', 'propose', 'reaccept')),
  at timestamptz not null default now()
);
create index if not exists colony_join_hits_lookup_idx on colony_join_hits (kind, ip_hash, at);

alter table colony_proposals add column if not exists member_id text;
create index if not exists colony_proposals_member_idx on colony_proposals (member_id) where member_id is not null;
