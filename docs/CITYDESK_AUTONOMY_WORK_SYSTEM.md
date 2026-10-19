# CityDesk colony work system (P0 and P1 scaffolding)

The colony's 24 citizens can earn real money from zero, the way people do: by doing legal,
disclosed AI work that someone pays for. They never hold a key, a wallet, or a balance they can
spend. Money lands in accounts the operator owns. The ledger is a scoreboard and an audit trail.

## Who can do what

Every operator-only action is checked **server-side** against the existing admin login (the same
`isAdmin` check the admin board uses: `app_admins` plus the `NDU_ADMIN_EMAILS` /
`NDU_ADMIN_USER_IDS` allowlist). A signed-in non-admin gets **403**; signed out gets 401.

| Action                             | Server function                               | Admin only                           |
| ---------------------------------- | --------------------------------------------- | ------------------------------------ |
| Read badges and totals             | `getColonyView`                               | no (non-admins get a read-only view) |
| Flip the work switch               | `setColonyWorkSwitch`                         | yes                                  |
| Record a credit (pending)          | `creditColonyCents`                           | yes                                  |
| Clear / reverse a credit           | `clearColonyCredit` / `reverseColonyCredit`   | yes                                  |
| Add a watched public address       | `addColonyWatchAddress`                       | yes                                  |
| File / approve / refuse a proposal | `fileColonyProposal` / `decideColonyProposal` | yes                                  |

Every change writes a `colony_audit` row with the real admin account (user id and email). The audit
table is append-only: a database trigger refuses updates and deletes.

## Files

| File                                                                                                  | What it does                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrations/0023_colony_work.sql`                                                                     | `colony_settings`, `colony_ledger`, `colony_addresses`, `colony_proposals` (seeded with the three original jobs), `colony_audit` (append-only trigger). |
| `src/world/colony/work.server.ts`                                                                     | Server logic over `Sql`: admin gate, ledger moves, status changes, addresses, proposals, audit.                                                         |
| `src/world/colony/work.functions.ts`                                                                  | `createServerFn` wrappers: `authMiddleware`, server-side admin check, HTTP status on errors.                                                            |
| `src/world/colony/work.ts`                                                                            | Kill switch helpers, `SPEND_CAP_CENTS = 0`, `WITHDRAW_ENABLED = false`.                                                                                 |
| `src/world/colony/ledger.ts`, `citizens.ts`, `addresses.ts`, `proposals.ts`, `catalog.ts`, `audit.ts` | Shared pure rules and types (integer cents, 1-cent rule, public-address format check, catalog W1-W7).                                                   |
| `src/world/colony/ColonySheet.tsx`                                                                    | Embossed "Work and ledger" card. Admins get the controls; everyone else sees badges and totals.                                                         |
| `scripts/colony/no-keys.test.mjs`                                                                     | CI guard: no key or seed material, signing or sending calls, or wallet SDK imports under `src/world/colony`.                                            |
| `tests/colony/colony-work.pglite.test.ts`                                                             | PGLite with every migration: non-admin 403s, admin end to end, audit actor, append-only audit.                                                          |

Run: `npm run test:colony` (a blocking step in `.github/workflows/ci.yml`).

## Kill switch

Work runs only when **both** are on, and both default off:

1. Server env `COLONY_WORK_ENABLED=on` (hard kill switch, set at deploy).
2. The admin work switch (stored in `colony_settings`, flipped by an admin in the sheet).

Off means no proposal is filed and no credit posts or clears. Reversal is always allowed.

## Migration

`migrations/0023_colony_work.sql` is additive and idempotent. It has **not** been applied to any
real database. Note that `npm run build` ends with `npm run db:migrate`, so the next deploy build
with `DATABASE_URL` set will apply it: **take a database backup first**. The PGLite dev fallback
applies migrations to its own local file automatically, as for every other migration.

## Hard rules (unchanged)

- Bots never generate or hold keys, even on devnet. No seed, no signing, no sending.
- Every outward step (send, post, apply, submit) is a proposal. Approving records a yes; the admin
  does the outward step by hand.
- Real spend cap is 0 cents for every citizen, hard-coded. There is no withdraw route.
- No coin is minted. Game vouchers never convert to or from real money.

## Not done yet (needs Sun)

- Applying 0023 (backup first) and setting `COLONY_WORK_ENABLED=on` for any deploy.
- Extended-public-key derivation for EVM: needs the `ethers` v6 dependency (TODO in `addresses.ts`).
- P1 rails: Stripe/PayPal account choice, signature-verified webhook, clearing buffer length,
  weekly reconciliation report, unmatched-payment review list.
- The proposed fourth law: "A bot proposes. Sun decides. No bot holds a key, sends money, or acts outside the box alone."
