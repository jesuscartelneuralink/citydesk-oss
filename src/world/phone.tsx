import { useEffect, useState } from "react";
import { useSim } from "@/game/useSim";
import { earnVouchers, payVouchers } from "@/game/sim";
import { ReportButton } from "@/world/moderation/ReportButton"; // NDU-UPG 909
import { list as moderationList } from "@/world/moderation/store";
import { getBots } from "@/world/robotLife";
import { boardRide, cancelRide, RIDE_COST, seatsLeft, timetable } from "@/world/transit";
import type { Neighbor } from "@/world/presence";
import type { Place } from "@/world/places";

const MET = "ndu-met";
const INSTALLED = "ndu-apps";

type Met = { id: string; name: string };
type AppId = "messages" | "places" | "bag" | "needs" | "routes" | "yard" | "room";

const CATALOG: { id: AppId; label: string; blurb: string }[] = [
  { id: "messages", label: "Messages", blurb: "Only people you have met." },
  { id: "places", label: "Places", blurb: "Shops already on this street." },
  { id: "bag", label: "Bag", blurb: "Things you are carrying on this phone." },
  { id: "needs", label: "Needs", blurb: "Food, rest, wash, people, ease, health." },
  { id: "routes", label: "Routes", blurb: "Ride the keke or the bus to the next stop." },
  { id: "yard", label: "Yard", blurb: "Power, clean streets, and green." },
  { id: "room", label: "Room", blurb: "Your private receipts." },
];

function readMet(): Met[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MET) || "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((row): row is Met => Boolean(row && typeof row.id === "string" && typeof row.name === "string")).slice(0, 40);
  } catch {
    return [];
  }
}

function readInstalled(): AppId[] {
  try {
    const raw = JSON.parse(localStorage.getItem(INSTALLED) || "null") as unknown;
    const known = new Set(CATALOG.map((app) => app.id));
    if (!Array.isArray(raw)) return ["messages", "places"];
    const ids = raw.filter((id): id is AppId => known.has(id as AppId));
    return ids.length ? ids : ["messages", "places"];
  } catch {
    return ["messages", "places"];
  }
}

export function rememberPerson(id: string, name: string) {
  const clean = name.trim().slice(0, 40);
  if (!id || !clean) return;
  const next = [{ id, name: clean }, ...readMet().filter((row) => row.id !== id)].slice(0, 40);
  localStorage.setItem(MET, JSON.stringify(next));
}

export function PhoneSheet({
  neighbors,
  places,
  onClose,
  onPlace,
  onOpen,
}: {
  neighbors: Neighbor[];
  places: Place[];
  onClose: () => void;
  onPlace: (place: Place) => void;
  onOpen: (name: "Yard" | "Room") => void;
}) {
  const snap = useSim();
  const [page, setPage] = useState<"home" | AppId | "store">("home");
  const [met, setMet] = useState<Met[]>([]);
  const [stallNote, setStallNote] = useState("");
  const now = new Date();
  const nearby = new Set(neighbors.map((person) => person.id));

  useEffect(() => {
    const blocked = new Set(moderationList().blocked);
    setMet(readMet().filter((row) => !blocked.has(row.id)));
    setInstalled(readInstalled());
  }, []);

  function install(id: AppId) {
    const next = installed.includes(id) ? installed : [...installed, id];
    setInstalled(next);
    localStorage.setItem(INSTALLED, JSON.stringify(next));
  }

  const title = page === "home" ? "Phone" : page === "store" ? "App Store" : CATALOG.find((app) => app.id === page)?.label;

  return (
    <div className="bg-bg/70 fixed inset-0 z-[700] grid place-items-center p-3">
      <div className="bg-surface relative flex h-[min(720px,92dvh)] w-full max-w-sm flex-col overflow-hidden rounded-[2rem] shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3">
          <button type="button" className="min-h-10 rounded-full px-3 text-sm" onClick={() => (page === "home" ? onClose() : setPage("home"))}>
            {page === "home" ? "Close" : "Back"}
          </button>
          <p className="text-muted text-xs">{title}</p>
        </div>
        {page === "home" ? (
          <div className="from-accent/30 flex flex-1 flex-col bg-gradient-to-b to-bg px-5 pt-6">
            <p className="font-display text-6xl leading-none">{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
            <p className="text-muted mt-2 text-sm">{now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</p>
            <div className="mt-8 grid grid-cols-3 gap-4">
              {installed.map((id) => {
                const app = CATALOG.find((item) => item.id === id);
                if (!app) return null;
                return <AppTile key={id} label={app.label} onClick={() => setPage(id)} />;
              })}
              <AppTile label="App Store" onClick={() => setPage("store")} />
              <AppTile label="Street" onClick={onClose} />
            </div>
            <p className="text-muted mt-auto pb-6 text-sm">Someone appears in Messages only after you meet them on the street.</p>
          </div>
        ) : null}
        {page === "store" ? (
          <ul className="flex-1 space-y-2 overflow-auto px-4 pb-6">
            {CATALOG.map((app) => (
              <li key={app.id} className="bg-bg flex items-center gap-2 rounded-2xl px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{app.label}</p>
                  <p className="text-muted text-sm">{app.blurb}</p>
                </div>
                <button
                  type="button"
                  className="bg-accent text-bg min-h-10 rounded-full px-3 text-sm disabled:opacity-50"
                  disabled={installed.includes(app.id)}
                  onClick={() => install(app.id)}
                >
                  {installed.includes(app.id) ? "In" : "Get"}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {page === "messages" ? (
          <ul className="flex-1 space-y-2 overflow-auto px-4 pb-6">
            {met.length ? null : <li className="text-muted text-sm">Meet someone on the street first. Their name is saved on this phone.</li>}
            {met.map((person) => (
              <li key={person.id} className="bg-bg rounded-2xl px-3 py-3">
                <p className="text-sm font-medium">{person.name}</p>
                <p className="text-muted mt-1 text-sm">
                  {nearby.has(person.id) ? "On this street now." : "Not on this street now."} A message is not delivered yet.
                </p>
                {/* NDU-UPG 909 */}
                <ReportButton targetId={person.id} onBlocked={() => setMet((rows) => rows.filter((row) => row.id !== person.id))} />
              </li>
            ))}
          </ul>
        ) : null}
        {page === "places" ? (
          <ul className="flex-1 space-y-2 overflow-auto px-4 pb-6">
            {places.length ? null : <li className="text-muted text-sm">No place on this street yet.</li>}
            {places.map((place) => (
              <li key={place.id}>
                <button
                  type="button"
                  className="bg-bg min-h-11 w-full rounded-2xl px-3 text-left text-sm"
                  onClick={() => {
                    onPlace(place);
                    onClose();
                  }}
                >
                  {place.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {page === "bag" ? <BagPage /> : null}
        {page === "needs" ? (
          <ul className="flex-1 space-y-2 overflow-auto px-4 pb-6">
            {(
              [
                ["Food", snap.needs.hunger],
                ["Rest", snap.needs.energy],
                ["Wash", snap.needs.hygiene],
                ["People", snap.needs.social],
                ["Ease", snap.needs.comfort],
                ["Health", snap.needs.health],
              ] as const
            ).map(([label, value]) => (
              <li key={label} className="bg-bg rounded-2xl px-3 py-3 text-sm">
                {label} · {Math.round(value)}
                {label === "Food" ? (
                  <div className="mt-2">
                    <button
                      type="button"
                      className="bg-accent text-bg min-h-11 rounded-full px-3 text-xs font-semibold"
                      onClick={() => {
                        setStallNote("Opening the till…");
                        void fetch("/api/stall/meal", { method: "POST", credentials: "include" })
                          .then((res) => res.json())
                          .then((body: { url?: string; error?: string }) => {
                            if (body.url) window.location.assign(body.url);
                            else setStallNote(body.error || "The till did not open.");
                          })
                          .catch(() => setStallNote("The till could not be reached."));
                      }}
                    >
                      Pay ₦1,500 for a plate
                    </button>
                    {stallNote ? <p className="text-muted mt-1 text-xs">{stallNote}</p> : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {page === "routes" ? (
          <ul className="flex-1 space-y-2 overflow-auto px-4 pb-6">
            {getBots()
              .filter((bot) => bot.vehicle)
              .map((bot) => (
                <li key={bot.id} className="bg-bg rounded-2xl px-3 py-3">
                  <p className="text-sm font-medium">
                    {bot.name} · {bot.vehicle}
                  </p>
                  <p className="text-muted mt-1 text-sm">{bot.note}</p>
                  <p className="text-muted mt-1 text-xs">{bot.vehicle ? `${seatsLeft(bot.vehicle)} seats · ${timetable(bot.vehicle).join(" · ")}` : null}</p>
                  <button
                    type="button"
                    className="bg-accent text-bg mt-2 min-h-10 rounded-full px-3 text-sm disabled:opacity-50"
                    disabled={!bot.nextStop || (bot.vehicle ? seatsLeft(bot.vehicle) < 1 : false)}
                    onClick={() => {
                      if (!bot.nextStop || !bot.vehicle) return;
                      if (seatsLeft(bot.vehicle) < 1) return;
                      if (!payVouchers("Ride", RIDE_COST)) return;
                      if (!boardRide(bot.vehicle, bot.nextStop)) {
                        earnVouchers("Ride back", RIDE_COST);
                        return;
                      }
                      onClose();
                    }}
                  >
                    Ride · {RIDE_COST}
                  </button>
                  <button
                    type="button"
                    className="bg-surface mt-2 ml-2 min-h-10 rounded-full px-3 text-sm"
                    onClick={() => {
                      if (cancelRide()) earnVouchers("Ride back", RIDE_COST);
                    }}
                  >
                    Cancel hail
                  </button>
                </li>
              ))}
          </ul>
        ) : null}
        {page === "yard" || page === "room" ? (
          <div className="flex-1 px-4">
            <button
              type="button"
              className="bg-accent text-bg min-h-11 w-full rounded-full text-sm"
              onClick={() => onOpen(page === "yard" ? "Yard" : "Room")}
            >
              Open {page === "yard" ? "the yard" : "your room"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BagPage() {
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("ndu-bag") || "[]") as unknown;
      setItems(Array.isArray(raw) ? raw.filter((item) => typeof item === "string") : []);
    } catch {
      setItems([]);
    }
  }, []);
  return (
    <ul className="flex-1 space-y-2 overflow-auto px-4 pb-6">
      {items.length ? null : <li className="text-muted text-sm">The bag is empty. Add a thing from the Bag button.</li>}
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="bg-bg rounded-2xl px-3 py-3 text-sm">
          {item}
        </li>
      ))}
    </ul>
  );
}

function AppTile({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="flex flex-col items-center gap-2" onClick={onClick}>
      <span className="bg-bg grid size-16 place-items-center rounded-2xl text-sm shadow">{label.slice(0, 1)}</span>
      <span className="text-xs">{label}</span>
    </button>
  );
}
