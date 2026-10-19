# CityDesk colony work system (P0 and P1 scaffolding)

The colony's 24 citizens can earn real money from zero, the way people do: by doing legal,
disclosed AI work that someone pays for. They never hold a key, a wallet, or a balance they can
spend. Money lands in accounts Sun owns. The ledger is a scoreboard and an audit trail.

## What shipped

| File                               | What it does                                                                                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/world/colony/work.ts`         | Kill switch `COLONY_WORK_ENABLED` (default **off**), `SPEND_CAP_CENTS = 0`, `WITHDRAW_ENABLED = false`, operator check (`sun`).                                                                |
| `src/world/colony/ledger.ts`       | Off-chain ledger in integer US cents. Credits start `pending`; Sun clears or reverses them.                                                                                                    |
| `src/world/colony/citizens.ts`     | Citizen records from `cities.ts`. 1 cleared cent makes a **Prominent Member** (in-game perks only). Reversal takes it back. `workCharterHolds()`.                                              |
| `src/world/colony/catalog.ts`      | Work catalog W1-W7. P0 opens W3 (drafts for Sun's own projects), P1 adds W1/W2 (paid CityDesk and Mantle tasks).                                                                               |
| `src/world/colony/proposals.ts`    | Extended, not replaced: `kind`, `payload`, `target`, `expectedCents`, `decidedBy`. `proposeWork()` is gated by the kill switch and an open-proposal limit; only Sun decides; no re-deciding.   |
| `src/world/colony/addresses.ts`    | Watch-only receive addresses that Sun pastes from his own wallet. Public-address format check only (EVM `0x`+40 hex; Solana base58 of 32 bytes). Key-shaped input is refused and never logged. |
| `src/world/colony/audit.ts`        | Append-only audit log of proposals, decisions, ledger changes, addresses, status changes and blocked actions.                                                                                  |
| `src/world/colony/ColonySheet.tsx` | "Work and ledger" card: switch state, each citizen's badge and cleared/pending cents, watch-only addresses, internal credit, clear/reverse, and the audit trail.                               |
| `scripts/colony/no-keys.test.mjs`  | CI guard: fails if key or seed material, signing or sending calls, wallet SDK imports, or key-shaped literals appear under `src/world/colony`.                                                 |

Run: `npm run test:colony` (also a blocking step in `.github/workflows/ci.yml`).

## Storage

Same pattern as the existing colony: in memory with a `localStorage` cache, per browser. No
migration was added. Moving the ledger, proposals and audit server-side (tables `colony_*`, admin
routes behind the session + admin check) needs Sun's OK and a backup first.

## Hard rules (unchanged)

- Bots never generate or hold keys, even on devnet. No seed, no signing, no sending.
- Every outward step (send, post, apply, submit) is a proposal. Approving records a yes; Sun does
  the outward step himself.
- Real spend cap is 0 cents for every citizen, hard-coded. There is no withdraw route.
- No coin is minted. Game vouchers never convert to or from real money.

## Not done yet (needs Sun)

- Turning `VITE_COLONY_WORK_ENABLED=on` for any deploy.
- Extended-public-key derivation for EVM: needs the `ethers` v6 dependency (TODO in `addresses.ts`).
- P1 rails: Stripe/PayPal account choice, signature-verified webhook, clearing buffer length,
  weekly reconciliation report, unmatched-payment review list.
- Server-side tables and admin routes (needs a migration OK).
- The proposed fourth law: "A bot proposes. Sun decides. No bot holds a key, sends money, or acts outside the box alone."
