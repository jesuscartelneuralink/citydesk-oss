import { useCallback, useEffect, useState } from "react";
import { vouchers } from "@/game/sim";
import { COLONY, LAWS } from "./charter";
import { CITIES } from "./cities";
import { civicPurse, cityRoster, fundCivic, meetNext, startLiving, subscribeCivic } from "./purse";
import "@/world/empty-state/emboss.css";
import { CHAINS, shortAddress, type Chain } from "./addresses";
import { dollars } from "./ledger";
import { SPEND_CAP_CENTS } from "./work";
import type { ColonyView } from "./work.server";

/** Loaded on first use, so the map's first paint does not pull the auth client into its graph. */
const fns = () => import("./work.functions");

/** Server errors arrive as plain Errors; show their message, never a stack. */
const why = (err: unknown) => (err instanceof Error && err.message ? err.message : "That was refused.");

const WORD = { quiet: "Quiet", steady: "Steady", booming: "Booming" } as const;

export function CivicTicker({ onOpen }: { onOpen: () => void }) {
  const [civic, setCivic] = useState(civicPurse());

  useEffect(() => {
    startLiving();
    return subscribeCivic(() => setCivic(civicPurse()));
  }, []);

  return (
    <div className="pointer-events-none absolute left-3 top-[4.6rem] z-[520] flex max-w-56 flex-col items-start gap-2">
      <button type="button" className="bg-surface text-fg pointer-events-auto min-h-11 rounded-full px-3 text-sm shadow-lg" onClick={onOpen}>
        Colony
      </button>
      <button type="button" className="bg-surface/95 text-fg pointer-events-auto rounded-2xl px-3 py-2 text-left text-sm shadow-lg" onClick={onOpen}>
        <span className="font-medium">{WORD[civic.economy]}</span>
        <span className="text-muted"> · {civic.headcount} living</span>
        <span className="mt-1 block truncate">{civic.notes[0]}</span>
      </button>
    </div>
  );
}

export function ColonySheet({ onClose }: { onClose: () => void }) {
  const [civic, setCivic] = useState(civicPurse());
  const [held, setHeld] = useState(vouchers());
  const [note, setNote] = useState("");
  const [view, setView] = useState<ColonyView | null>(null);
  const [viewError, setViewError] = useState("");
  const reload = useCallback(async () => {
    try {
      setView(await (await fns()).getColonyView());
      setViewError("");
    } catch (err) {
      setViewError(why(err));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const desk = view?.proposals ?? [];

  useEffect(() => {
    startLiving();
    return subscribeCivic(() => {
      setCivic(civicPurse());
      setHeld(vouchers());
    });
  }, []);

  const fund = () => {
    const ok = fundCivic(20);
    setHeld(vouchers());
    setNote(ok ? "20 game vouchers moved into the civic purse." : "Not enough game vouchers to fund 20.");
  };

  const decide = async (id: string, status: "approved" | "refused") => {
    try {
      await (await fns()).decideColonyProposal({ data: { id, status } });
      setNote(status === "approved" ? "You approved it. Nothing was signed. Pay it in your own wallet, or leave it." : "You refused it. The bot cannot pay it.");
    } catch (err) {
      setNote(why(err));
    }
    await reload();
  };

  const meet = (cityId: string) => {
    const ok = meetNext(cityId);
    setNote(ok ? "They met at a public place." : "The purse needs a voucher before two cities can meet.");
  };

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-[640] max-h-[70dvh] overflow-y-auto rounded-t-3xl bg-surface p-4 text-fg shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-xl leading-none">{COLONY.name}</p>
          <p className="text-muted mt-1 text-sm">
            {WORD[civic.economy]} · {civic.headcount} living · {civic.born} welcomed since the start. No coin is minted.
          </p>
        </div>
        <button type="button" className="bg-bg min-h-11 rounded-full px-3 text-sm" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="bg-bg mt-3 flex items-center justify-between gap-3 rounded-2xl p-3">
        <div>
          <p className="text-sm">Civic purse · {civic.balance}</p>
          <p className="text-muted text-sm">You hold {held} game vouchers.</p>
        </div>
        <button type="button" className="bg-accent text-bg min-h-11 rounded-full px-3 text-sm" onClick={fund}>
          Fund 20
        </button>
      </div>
      {note ? <p className="text-muted mt-2 text-sm">{note}</p> : null}
      <p className="mt-4 text-sm font-medium">Your wallet, not theirs</p>
      <p className="text-muted mt-1 text-sm">A bot can name a job and a price. Only an admin can approve it. Approving does not move money and does not give the bot a key.</p>
      {viewError ? <p className="text-muted mt-1 text-sm">{viewError}</p> : null}
      <div className="mt-2 space-y-2">
        {desk.map((row) => (
          <section key={row.id} className="bg-bg rounded-2xl p-3">
            <p className="text-sm font-medium">
              {row.bot} · {row.city}
            </p>
            <p className="text-sm">{row.job}</p>
            <p className="text-muted text-sm">{row.price}</p>
            {row.status === "open" && !view?.isAdmin ? <p className="text-muted mt-2 text-sm">Waiting for an admin.</p> : null}
            {row.status === "open" && view?.isAdmin ? (
              <div className="mt-2 flex gap-2">
                <button type="button" className="bg-accent text-bg min-h-11 rounded-full px-3 text-sm" onClick={() => decide(row.id, "approved")}>
                  Approve
                </button>
                <button type="button" className="bg-surface min-h-11 rounded-full px-3 text-sm" onClick={() => decide(row.id, "refused")}>
                  Refuse
                </button>
              </div>
            ) : null}
            {row.status !== "open" ? (
              <p className="mt-2 text-sm">
                {row.status === "approved" ? "Approved. Unpaid until a wallet pays it." : "Refused."}
                {row.decidedBy ? <span className="text-muted"> · by {row.decidedBy}</span> : null}
              </p>
            ) : null}
            {row.payload ? <p className="text-muted mt-1 line-clamp-3 text-xs">Draft: {row.payload}</p> : null}
            {row.target ? <p className="text-muted text-xs">Goes to: {row.target} · you do the outward step yourself</p> : null}
          </section>
        ))}
      </div>
      {view ? <CitizenLedger view={view} reload={reload} onNote={setNote} /> : null}
      <p className="mt-3 text-sm font-medium">Latest</p>
      <ul className="mt-1 space-y-1">
        {civic.notes.map((line, index) => (
          <li key={`${index}-${line}`} className="text-sm">
            {line}
          </li>
        ))}
      </ul>
      <ul className="mt-3 space-y-1">
        {LAWS.map((law) => (
          <li key={law} className="text-muted text-sm">
            {law}
          </li>
        ))}
      </ul>
      <div className="mt-4 space-y-3">
        {CITIES.map((row) => {
          const people = cityRoster(row.id);
          return (
            <section key={row.id} className="bg-bg rounded-2xl p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">
                  {row.name} · {people.length} · {row.place}
                </p>
                <button type="button" className="bg-surface min-h-11 rounded-full px-3 text-sm" onClick={() => meet(row.id)}>
                  Meet
                </button>
              </div>
              <ul className="mt-1">
                {people.map((agent) => (
                  <li key={agent.id} className="text-sm">
                    {agent.name} · {agent.duty}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/**
 * P0/P1 work system: each citizen's real-cent badge and totals for everyone; for admins, the work
 * switch, watched addresses, internal credits, clear/reverse, and the audit trail. Every change goes
 * through a server function that checks the admin login. Nothing here signs, sends, spends, or withdraws.
 */
function CitizenLedger({ view, reload, onNote }: { view: ColonyView; reload: () => Promise<void>; onNote: (note: string) => void }) {
  const people = view.citizens;
  const admin = view.isAdmin ? view.admin : null;
  const [who, setWho] = useState(people[0]?.citizenId ?? "");
  const [chain, setChain] = useState<Chain>("evm");
  const [address, setAddress] = useState("");
  const [cents, setCents] = useState("1");
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      onNote(await fn());
    } catch (err) {
      onNote(why(err));
    }
    await reload();
    setBusy(false);
  };

  const flip = () =>
    act(async () => {
      const next = !view.adminSwitchOn;
      await (await fns()).setColonyWorkSwitch({ data: { on: next } });
      return next ? (view.envAllowed ? "Work switched on." : "Admin switch on. The server kill switch is still off, so work stays off.") : "Work switched off.";
    });

  const paste = () =>
    act(async () => {
      const value = address;
      setAddress("");
      await (await fns()).addColonyWatchAddress({ data: { citizenId: who, chain, address: value } });
      return "Watch-only address saved. It can receive, never spend.";
    });

  const record = () =>
    act(async () => {
      const amount = Number(cents);
      await (await fns()).creditColonyCents({ data: { citizenId: who, amountCents: amount, source: "internal", ref: "W3 draft for an own project" } });
      return `${dollars(amount)} recorded as pending. Clear it to count.`;
    });

  const settle = (id: string, how: "clear" | "reverse") =>
    act(async () => {
      if (how === "reverse") {
        await (await fns()).reverseColonyCredit({ data: { id } });
        return "Reversed. It no longer counts.";
      }
      const result = await (await fns()).clearColonyCredit({ data: { id } });
      return result.welcome ?? "Cleared. It now counts toward status.";
    });

  return (
    <section className="ndu-es-card mt-4 rounded-3xl p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Work and ledger · real cents</p>
        {admin ? (
          <button type="button" className={`ndu-es-push min-h-9 rounded-full px-3 text-xs ${view.adminSwitchOn ? "is-hot" : ""}`} onClick={flip} disabled={busy}>
            {view.workOn ? "Work on" : view.adminSwitchOn ? "Admin switch on · server off" : "Work off"}
          </button>
        ) : (
          <span className="ndu-es-chip rounded-full px-2.5 py-1 text-xs">{view.workOn ? "Work on" : "Work off"}</span>
        )}
      </div>
      <p className="text-muted mt-1 text-xs">
        Earnings land in the operator&apos;s accounts, not theirs. Every citizen&apos;s real spend cap is {dollars(SPEND_CAP_CENTS)}, and there is no withdraw. One
        cleared cent makes a Prominent Member, with in-game perks only.
        {admin ? "" : " Read-only: only an admin can change anything here."}
      </p>
      {admin ? (
        <div className="ndu-es-well mt-3 space-y-2 rounded-2xl p-3">
          <label className="block text-xs">
            Citizen
            <select className="bg-bg mt-1 block min-h-11 w-full rounded-xl px-2 text-sm" value={who} onChange={(event) => setWho(event.target.value)}>
              {people.map((row) => (
                <option key={row.citizenId} value={row.citizenId}>
                  {row.name} · {row.city}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <select className="bg-bg min-h-11 rounded-xl px-2 text-sm" value={chain} onChange={(event) => setChain(event.target.value as Chain)} aria-label="Chain">
              {CHAINS.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </select>
            <input
              className="bg-bg min-h-11 min-w-0 flex-1 rounded-xl px-2 text-sm"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Public address from your own wallet"
              autoComplete="off"
              spellCheck={false}
              aria-label="Public address"
            />
            <button type="button" className="ndu-es-push min-h-11 rounded-full px-3 text-sm" onClick={paste} disabled={busy || !address.trim()}>
              Add watch-only
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="bg-bg min-h-11 w-24 rounded-xl px-2 text-sm"
              inputMode="numeric"
              value={cents}
              onChange={(event) => setCents(event.target.value.replace(/[^0-9]/g, ""))}
              aria-label="Cents"
            />
            <button type="button" className="ndu-es-push is-hot min-h-11 rounded-full px-3 text-sm" onClick={record} disabled={busy || !view.workOn}>
              Record internal credit (W3)
            </button>
          </div>
        </div>
      ) : null}
      <ul className="mt-3 space-y-2">
        {people.map((row) => {
          const pending = admin ? admin.pending.filter((entry) => entry.citizenId === row.citizenId) : [];
          const watch = admin ? admin.addresses.filter((item) => item.citizenId === row.citizenId) : [];
          return (
            <li key={row.citizenId} className="ndu-es-well rounded-2xl p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm">
                  {row.name} <span className="text-muted">· {row.city}</span>
                </p>
                <span className={`ndu-es-chip rounded-full px-2.5 py-0.5 text-xs ${row.status === "prominent" ? "ndu-es-glow" : ""}`}>
                  {row.status === "prominent" ? "Prominent" : "Resident"}
                </span>
              </div>
              <p className="text-muted text-xs">
                Cleared {dollars(row.totals.cleared)} · pending {dollars(row.totals.pending)}
                {row.totals.reversed ? ` · reversed ${dollars(row.totals.reversed)}` : ""}
              </p>
              {watch.length ? <p className="text-muted text-xs">Watch-only: {watch.map((item) => `${item.chain} ${shortAddress(item.address)}`).join(", ")}</p> : null}
              {pending.map((entry) => (
                <div key={entry.id} className="mt-1 flex items-center gap-2 text-xs">
                  <span>{dollars(entry.amountCents)} pending</span>
                  <button type="button" className="ndu-es-push min-h-9 rounded-full px-2 text-xs" onClick={() => settle(entry.id, "clear")} disabled={busy || !view.workOn}>
                    Clear
                  </button>
                  <button type="button" className="ndu-es-push min-h-9 rounded-full px-2 text-xs" onClick={() => settle(entry.id, "reverse")} disabled={busy}>
                    Reverse
                  </button>
                </div>
              ))}
            </li>
          );
        })}
      </ul>
      {admin?.audit.length ? (
        <>
          <p className="mt-3 text-xs font-medium">Audit trail</p>
          <ul className="mt-1 space-y-0.5">
            {admin.audit.slice(0, 8).map((row) => (
              <li key={row.seq} className="text-muted text-xs">
                {new Date(row.at).toLocaleString()} · {row.actor} · {row.action} · {row.subject}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
