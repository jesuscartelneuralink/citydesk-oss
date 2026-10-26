alter table stall_payments add column if not exists rail text not null default 'naira';
alter table stall_payments add column if not exists chain_ref text;
alter table stall_payments add column if not exists usdc_base integer;
alter table stall_payments add column if not exists signature text;

create unique index if not exists stall_payments_signature_idx
  on stall_payments (signature)
  where signature is not null;
