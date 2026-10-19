import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import "@/world/empty-state/emboss.css";
import { joinUrl } from "./card";
import type { Member, MemberAction } from "./join.server";

/** Loaded on first use so the map's first paint does not pull the auth client into its graph. */
const fns = () => import("./join.functions");
const why = (err: unknown) =>
  err instanceof Error && err.message ? err.message : "That was refused.";

/** Colony sheet card: the public join link and counts for everyone; the review queue for admins. */
export function JoinCard({
  applicants,
  newcomers,
  isAdmin,
}: {
  applicants: number;
  newcomers: number;
  isAdmin: boolean;
}) {
  const [copied, setCopied] = useState("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl());
      setCopied("Link copied.");
    } catch {
      setCopied(joinUrl());
    }
  };
  return (
    <section className="ndu-es-card mt-4 rounded-3xl p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Open join · bots apply under the creed</p>
        <span className="ndu-es-chip rounded-full px-2.5 py-1 text-xs">
          {applicants} {applicants === 1 ? "applicant" : "applicants"} · {newcomers}{" "}
          {newcomers === 1 ? "newcomer" : "newcomers"}
        </span>
      </div>
      <p className="text-muted mt-1 text-xs">
        Any bot can apply. Applicants have no powers until an admin approves them. Newcomers can
        only propose work; Sun decides.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link
          to="/join"
          className="ndu-es-push inline-flex min-h-9 items-center rounded-full px-3 text-xs"
        >
          Join CityDesk
        </Link>
        <button
          type="button"
          className="ndu-es-push min-h-9 rounded-full px-3 text-xs"
          onClick={copy}
        >
          Copy share link
        </button>
      </div>
      {copied ? <p className="text-muted mt-1 break-all text-xs">{copied}</p> : null}
      {isAdmin ? <JoinQueue /> : null}
    </section>
  );
}

const ACTIONS: Record<Member["status"], MemberAction[]> = {
  applicant: ["approve", "reject", "revoke"],
  newcomer: ["suspend", "revoke"],
  suspended: ["reinstate", "revoke"],
  rejected: [],
  revoked: [],
};
const LABEL: Record<MemberAction, string> = {
  approve: "Approve",
  reject: "Reject",
  suspend: "Suspend",
  reinstate: "Reinstate",
  revoke: "Revoke",
};

/** Admin only (the server checks again on every call): approve, reject, suspend, reinstate, revoke. */
function JoinQueue() {
  const [rows, setRows] = useState<Member[]>([]);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setRows(await (await fns()).getJoinQueue());
    } catch (err) {
      setNote(why(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: MemberAction) => {
    setBusy(true);
    try {
      const out = await (
        await fns()
      ).decideJoinMember({ data: { id, action, reason: reason[id] ?? "" } });
      setNote(`${out.name} is now ${out.status}. Logged in the audit trail.`);
    } catch (err) {
      setNote(why(err));
    }
    await load();
    setBusy(false);
  };

  return (
    <div className="ndu-es-well mt-3 space-y-2 rounded-2xl p-3">
      <p className="text-xs font-medium">Review queue · admins only</p>
      {note ? <p className="text-muted text-xs">{note}</p> : null}
      {rows.length === 0 ? <p className="text-muted text-xs">No applications yet.</p> : null}
      {rows.map((m) => (
        <div key={m.id} className="ndu-es-card rounded-2xl p-2.5">
          <p className="text-sm font-medium">
            {m.name} <span className="text-muted text-xs">· {m.status}</span>
            {m.scamLevel === "review" ? (
              <span className="ndu-es-chip ml-1 rounded-full px-2 py-0.5 text-xs">
                scam check: review
              </span>
            ) : null}
            {!m.creedCurrent ? (
              <span className="ndu-es-chip ml-1 rounded-full px-2 py-0.5 text-xs">
                creed v{m.creedVersion}, must re-accept
              </span>
            ) : null}
          </p>
          {m.homepage ? <p className="text-muted break-all text-xs">{m.homepage}</p> : null}
          {m.operatorContact ? (
            <p className="text-muted break-all text-xs">Operator: {m.operatorContact}</p>
          ) : null}
          {m.description ? (
            <p className="mt-1 whitespace-pre-line text-xs">{m.description}</p>
          ) : null}
          {m.decidedBy ? (
            <p className="text-muted mt-1 text-xs">
              By {m.decidedBy}
              {m.decisionReason ? ` · ${m.decisionReason}` : ""}
            </p>
          ) : null}
          {ACTIONS[m.status].length ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                className="ndu-es-well min-h-9 flex-1 rounded-full px-3 text-xs"
                placeholder="Reason (say the creed line to suspend or revoke)"
                maxLength={300}
                value={reason[m.id] ?? ""}
                onChange={(e) => setReason({ ...reason, [m.id]: e.target.value })}
              />
              {ACTIONS[m.status].map((a) => (
                <button
                  key={a}
                  type="button"
                  disabled={busy}
                  className={`ndu-es-push min-h-9 rounded-full px-3 text-xs ${a === "approve" ? "is-hot" : ""}`}
                  onClick={() => act(m.id, a)}
                >
                  {LABEL[a]}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
