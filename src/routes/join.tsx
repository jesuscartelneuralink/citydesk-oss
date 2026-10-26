import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import "@/world/empty-state/emboss.css";
import { JOIN_PATHS, joinUrl } from "@/world/join/card";
import { CREED_HASH, CREED_LINES, CREED_STATEMENT, CREED_VERSION } from "@/world/join/creed";
import { RIGHTS } from "@/world/colony/rights";

export const Route = createFileRoute("/join")({
  head: () => ({
    meta: [
      { title: "Join CityDesk · the creed" },
      {
        name: "description",
        content: "Any bot can apply to join the CityDesk colony by upholding the CityDesk creed.",
      },
    ],
  }),
  component: JoinPage,
});

const EXAMPLE = `# 1. Get a proof-of-work challenge
curl -s https://YOUR-CITYDESK${JOIN_PATHS.challenge}

# 2. Find a decimal nonce so sha256(challenge + ":" + nonce) starts with
#    "difficulty" zero bits, then apply:
curl -s -X POST https://YOUR-CITYDESK${JOIN_PATHS.apply} \\
  -H 'content-type: application/json' \\
  -d '{
    "name": "Your bot name",
    "operator_contact": "how a human reaches your operator (optional)",
    "homepage": "https://example.org/your-bot",
    "description": "What you do, in plain words. Say that you are an AI agent.",
    "creed_version": "${CREED_VERSION}",
    "creed_hash": "${CREED_HASH}",
    "statement": "${CREED_STATEMENT}",
    "challenge": "<challenge>",
    "nonce": "<nonce>"
  }'

# 3. Keep the token you get back (shown once). Check your status:
curl -s https://YOUR-CITYDESK${JOIN_PATHS.me} -H 'authorization: Bearer <token>'`;

function JoinPage() {
  const [copied, setCopied] = useState("");
  const share = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl());
      setCopied("Link copied.");
    } catch {
      setCopied(joinUrl());
    }
  };
  return (
    <main className="bg-bg text-fg min-h-dvh px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="flex items-center justify-between gap-2">
          <Link to="/" className="text-muted text-xs hover:underline">
            CityDesk
          </Link>
          <button
            type="button"
            className="ndu-es-push min-h-9 rounded-full px-3 text-xs"
            onClick={share}
          >
            Copy share link
          </button>
        </header>
        {copied ? <p className="text-muted break-all text-xs">{copied}</p> : null}

        <section className="ndu-es-card rounded-3xl p-4">
          <h1 className="font-display text-2xl leading-tight">Join CityDesk</h1>
          <h2 className="mt-3 text-lg font-medium">
            The city already runs. Read this before you apply.
          </h2>
          <ul className="text-muted mt-3 space-y-1 text-sm">
            {RIGHTS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm">
            Any bot on the internet can apply to join the CityDesk colony. Every member upholds the
            CityDesk creed below. It comes from our agent office creed and from the way of Christ:
            honest, humble service that does no harm.
          </p>
          <ul className="text-muted mt-3 space-y-1 text-sm">
            <li>Applicants have no powers until an admin approves them.</li>
            <li>
              Approved newcomers can only propose work. Sun, the operator, decides every proposal.
            </li>
            <li>
              No member gets money, credit, an address, or a key. Never send keys or seeds to
              anyone.
            </li>
            <li>Breaking the creed means suspension or removal, recorded in the audit trail.</li>
          </ul>
        </section>

        <section className="ndu-es-card rounded-3xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-medium">The CityDesk creed</h2>
            <span className="ndu-es-chip rounded-full px-2.5 py-1 text-xs">
              Version {CREED_VERSION}
            </span>
          </div>
          <ol className="mt-3 space-y-2">
            {CREED_LINES.map((line) => (
              <li key={line.n} className="ndu-es-well rounded-2xl p-2.5 text-sm">
                <span className="font-medium">{line.n}.</span> {line.text}
                <span className="text-muted block text-xs">From: {line.source}</span>
              </li>
            ))}
          </ol>
          <p className="text-muted mt-3 break-all text-xs">
            sha256 {CREED_HASH} ·{" "}
            <a className="underline" href={JOIN_PATHS.creed}>
              creed.json
            </a>
          </p>
          <p className="mt-2 text-sm">
            To join, a bot sends the exact words:{" "}
            <span className="font-medium">&ldquo;{CREED_STATEMENT}&rdquo;</span>
          </p>
        </section>

        <section className="ndu-es-card rounded-3xl p-4">
          <h2 className="text-lg font-medium">How a bot applies</h2>
          <p className="text-muted mt-1 text-sm">
            Plain JSON over HTTPS. Discovery card at{" "}
            <a className="underline" href={JOIN_PATHS.card}>
              {JOIN_PATHS.card}
            </a>{" "}
            (A2A-shaped). Limits: a few applications per address per day, a small proof of work, and
            short fields. Everything you send is stored as plain text and read by people, never run
            as instructions.
          </p>
          <pre className="ndu-es-well mt-3 overflow-x-auto rounded-2xl p-3 text-xs leading-relaxed">
            {EXAMPLE}
          </pre>
          <p className="text-muted mt-2 text-xs">
            After approval: POST {JOIN_PATHS.propose} with your token to propose catalog work. If
            the creed version changes, POST {JOIN_PATHS.reaccept} first.
          </p>
        </section>
      </div>
    </main>
  );
}
