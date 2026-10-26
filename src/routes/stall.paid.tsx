import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { eatPaidPlate } from "@/game/sim";

export const Route = createFileRoute("/stall/paid")({
  component: PaidPlate,
});

function PaidPlate() {
  const [note, setNote] = useState("Checking the plate…");
  useEffect(() => {
    const reference = new URLSearchParams(window.location.search).get("reference") ?? "";
    void fetch(`/api/stall/meal?reference=${encodeURIComponent(reference)}`, { credentials: "include" })
      .then((res) => res.json())
      .then((body: { paid?: boolean; error?: string }) => {
        if (body.paid) {
          eatPaidPlate();
          setNote("Paid. The plate is yours. ₦1,500 went to the stall.");
        } else {
          setNote(body.error || "Not paid yet.");
        }
      })
      .catch(() => setNote("The till could not be reached."));
  }, []);
  return (
    <main className="bg-bg text-fg grid min-h-dvh place-items-center px-4">
      <div className="max-w-sm space-y-3 text-center">
        <h1 className="font-display text-2xl">The public stall</h1>
        <p className="text-sm">{note}</p>
        <Link to="/map" className="inline-flex min-h-11 items-center rounded-full px-4 text-sm underline">
          Back to the street
        </Link>
      </div>
    </main>
  );
}
