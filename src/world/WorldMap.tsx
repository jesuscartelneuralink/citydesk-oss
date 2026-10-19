import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"; // NDU-AI safe-ingest: lazy, Suspense
import "leaflet/dist/leaflet.css";
import { AccountSheet } from "@/world/account";
import { SignedIn, SignedOut, UserButton } from "@/lib/auth/gates";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { bindInput, readMove } from "@/game/input";
import { enterBlock, liveAct, NEED_KEYS, setAgeOk, setLifePaused, tickLife, vouchers, type NeedKey } from "@/game/sim";
import { useSim } from "@/game/useSim";
import { kindLabel, streetPlaces, type Place } from "@/world/places";
import { PhoneSheet, rememberPerson } from "@/world/phone";
import { BagButton } from "@/world/bag";
import { CityBuildings, type TripGoal } from "@/world/CityBuildings";
import { OverlayDock } from "@/world/OverlayDock";
import { NeedsSheet } from "@/world/bubbles/NeedsSheet"; // NDU-UPG bubbles
import { TopPill } from "@/world/bubbles/TopPill"; // NDU-UPG bubbles
import { useBubbleMode } from "@/world/bubbles/mode"; // NDU-UPG bubbles
import { claimGooglePlace, listOpenBusinesses, openBusiness, sessionRole } from "@/world/businesses";
import { Appointments, BookSheet, ManageSheet } from "@/world/desk";
import { YardSheet } from "@/world/yard";
import { getMine, listNearby, savePresence, type Neighbor } from "@/world/presence";
import { tripAvatars } from "@/world/registry";
import { PlacesPanel } from "@/world/PlacesPanel";
import { InsideView } from "@/world/empty-state/InsideView"; // NDU-UPG empty-state
import { RobotCard } from "@/world/robotCard";
import { getBot } from "@/world/robotLife";
import { CivicTicker, ColonySheet } from "@/world/colony/ColonySheet";
import { rulePlace, RuleStrip } from "@/world/ruleStrip";
import { KitchenRoom } from "@/world/kitchen";
import { StreetRoom } from "@/world/rooms";
import { CarRoom } from "@/world/car";
import { EcoRoom } from "@/world/eco";
import { MyRoom } from "@/world/myRoom";
// NDU-AI safe-ingest #4: lazy listing scam/impersonation hint in the register form (flags only, never blocks)
const ListingCheckHint = lazy(() => import("@/world/ingest/ListingCheckHint"));
import { Tower } from "@/world/tower";
import { J2csRoom } from "@/world/j2cs";
import { KidsHost } from "@/world/kids/door"; // NDU-UPG kids
import { WorkverseSlot } from "@/world/workverse/WorkverseSlot"; // Jarvis Verse 3D office
import type { EnterSpot } from "@/world/empty-state/footprint"; // NDU-UPG empty-state
import { exited } from "@/world/collide/bus"; // NDU-UPG collide

type Mode = "streets" | "satellite";

const FALLBACK = { lat: 4.8156, lng: 7.0498, label: "Port Harcourt, until location is on" };
const SPOT_KEY = "ndu:last-spot";

function readSpot(raw: string | null): { lat: number; lng: number } | null {
  try {
    const v = JSON.parse(raw ?? "null") as { lat?: unknown; lng?: unknown } | null;
    const lat = Number(v?.lat);
    const lng = Number(v?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

export function WorldMap() {
  const user = useCurrentUser();
  const bubbles = useBubbleMode(); // NDU-UPG bubbles
  const host = useRef<HTMLDivElement>(null);
  const figHost = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const streetsRef = useRef<import("leaflet").TileLayer | null>(null);
  const satRef = useRef<import("leaflet").TileLayer | null>(null);
  const youRef = useRef<import("leaflet").Marker | null>(null);
  const othersRef = useRef<import("leaflet").LayerGroup | null>(null);
  const placesRef = useRef<import("leaflet").LayerGroup | null>(null);
  const [mode, setMode] = useState<Mode>("satellite");
  const [inside, setInside] = useState<EnterSpot | null>(null); // NDU-UPG empty-state: + feature/bearing
  // NDU-UPG collide: every exit to the street goes through here so the avatar steps out of the same door
  const leaveInside = useCallback(() => {
    setInside(null);
    exited();
  }, []);
  const [zoom, setZoom] = useState(16);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [gps, setGps] = useState<"asking" | "on" | "off">("asking");
  const [visible, setVisible] = useState(false);
  const [avatar, setAvatar] = useState("");
  const [name, setName] = useState("");
  const [camera, setCamera] = useState(false);
  const [neighbors, setNeighbors] = useState<Neighbor[]>([]);
  // Registry trip avatars (own + accepted Spaces friends; Spaces enforces friends-only). Shown with neighbors.
  const [trippers, setTrippers] = useState<Neighbor[]>([]);
  const [placesOpen, setPlacesOpen] = useState(false);
  const shown = trippers.length ? [...neighbors, ...trippers] : neighbors;
  // The figure's last spot: `saved` seeds the 3D map on load, `spotPos` is where it is now.
  const [saved, setSaved] = useState<{ lat: number; lng: number } | null>(null);
  const [spotPos, setSpotPos] = useState<{ lat: number; lng: number } | null>(null);
  const goRef = useRef<((goal: TripGoal) => Promise<boolean>) | null>(null);
  const [phone, setPhone] = useState(false);
  const [person, setPerson] = useState<Neighbor | null>(null);
  const [robot, setRobot] = useState("");
  const [colony, setColony] = useState(false);

  useEffect(() => {
    if (person) rememberPerson(person.id, person.displayName);
  }, [person]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get("verse") === "1" || sp.get("office") === "1") {
        setInside({ name: "Zealous Pane", lat: 4.8156, lng: 7.0498, workverse: true });
      }
    }
  }, []);
  const [note, setNote] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [spot, setSpot] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [ringOpen, setRingOpen] = useState(false);
  const [ringTick, setRingTick] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [desk, setDesk] = useState<"book" | "appointments" | "manage" | null>(null);
  const [yard, setYard] = useState<string | null>(null);
  const sheetOpen = Boolean(inside || phone || yard || desk || robot || person);
  useEffect(() => {
    setLifePaused(sheetOpen);
    return () => setLifePaused(false);
  }, [sheetOpen]);
  // NEURA wallet + Compute desk (Solana devnet). Lazy-loaded so wallet code stays off the map's path.
  const [neura, setNeura] = useState<"wallet" | "compute" | null>(null);
  const [neuraUi, setNeuraUi] = useState<null | typeof import("@/world/NeuraSheets")>(null);
  function openNeura(which: "wallet" | "compute") {
    void import("@/world/NeuraSheets")
      .then((mod) => {
        setNeuraUi(mod);
        setNeura(which);
      })
      .catch(() => setNote("Could not open the wallet area."));
  }
  const driving = useRef(false);
  const feet = useRef({ lat: FALLBACK.lat, lng: FALLBACK.lng });
  const walked = useRef(false);
  const peopleRef = useRef<Neighbor[]>([]);
  const stallRef = useRef<{ lat: number; lng: number } | null>(null);
  const [admin, setAdmin] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let dead = false;
    void import("leaflet").then((L) => {
      if (dead || mapRef.current) return;
      const map = L.map(el, { zoomControl: false, attributionControl: true }).setView(
        [FALLBACK.lat, FALLBACK.lng],
        16,
      );
      streetsRef.current = null;
      othersRef.current = L.layerGroup().addTo(map);
      placesRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setMapReady(true);
    });
    // NDU-UPG u-079: the container can change size without a window resize
    // (sidebars, HUD panels, devtools). A ResizeObserver keeps the Leaflet
    // canvas in sync — without it the map flashes black until the next
    // window resize. Debounced via rAF so a resize storm costs one invalidate.
    let roFrame = 0;
    const ro = new ResizeObserver(() => {
      if (dead) return;
      cancelAnimationFrame(roFrame);
      roFrame = requestAnimationFrame(() => {
        if (!dead) mapRef.current?.invalidateSize();
      });
    });
    ro.observe(el);
    return () => {
      dead = true;
      cancelAnimationFrame(roFrame);
      ro.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  const closeUp = zoom >= 17;
  const showStreets = mode === "streets" || closeUp;

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const sync = () => setZoom(map.getZoom());
    sync();
    map.on("zoomend", sync);
    return () => {
      map.off("zoomend", sync);
    };
  }, [mapReady]);

  useEffect(() => {
    if (!mapRef.current || !streetsRef.current || !satRef.current) return;
    if (showStreets) {
      mapRef.current.removeLayer(satRef.current);
    } else {
      mapRef.current.removeLayer(streetsRef.current);
    }
  }, [showStreets, mapReady]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGps("off");
      return;
    }
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setHere(next);
        setGps("on");
        if (!walked.current && !driving.current) {
          feet.current = next;
          youRef.current?.setLatLng([next.lat, next.lng]);
        }
        const map = mapRef.current;
        if (walked.current || driving.current || !map) return;
        if (!map.getBounds().contains([next.lat, next.lng]) || map.getZoom() < 15) {
          map.setView([next.lat, next.lng], 16);
        }
      },
      () => setGps("off"),
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  useEffect(() => {
    try {
      const local = readSpot(window.localStorage.getItem(SPOT_KEY));
      if (local) setSaved(local);
    } catch {
      // storage blocked: the presence row (signed in) still restores the spot
    }
  }, []);

  function rememberSpot(spot: { lat: number; lng: number }) {
    setSpotPos(spot);
    try {
      window.localStorage.setItem(SPOT_KEY, JSON.stringify({ lat: spot.lat, lng: spot.lng }));
    } catch {
      // storage blocked: presence still saves it when signed in
    }
  }

  useEffect(() => {
    if (!user) return;
    setName((n) => n || user.displayName || "");
    void getMine()
      .then((mine) => {
        if (!mine) return;
        if (mine.displayName) setName(mine.displayName);
        if (mine.avatar) setAvatar(mine.avatar);
        setVisible(mine.visible);
        if (mine.lat !== null && mine.lng !== null) setSaved({ lat: mine.lat, lng: mine.lng });
      })
      .catch(() => setNote("Could not load your spot."));
  }, [user]);

  useEffect(() => {
    let stop = false;
    void import("leaflet").then((L) => {
      if (stop || !mapRef.current || driving.current) return;
      const map = mapRef.current;
      const point = walked.current || driving.current ? feet.current : (here ?? feet.current);
      const icon = L.divIcon({
        className: "",
        iconSize: [44, 44],
        iconAnchor: [22, 22],
        html: avatar
          ? `<img alt="" src="${avatar}" style="width:44px;height:44px;border-radius:999px;object-fit:cover;border:2px solid #f6efe2" />`
          : `<div style="width:44px;height:44px;border-radius:999px;background:#e8843a;border:2px solid #f6efe2"></div>`,
      });
      if (!youRef.current) youRef.current = L.marker([point.lat, point.lng], { icon, zIndexOffset: 800 }).addTo(map);
      else {
        youRef.current.setIcon(icon);
        if (!walked.current && !driving.current) youRef.current.setLatLng([point.lat, point.lng]);
      }
    });
    return () => {
      stop = true;
    };
  }, [here, avatar, mapReady]);

  useEffect(() => bindInput(window), []);

  useEffect(() => {
    if (!mapReady) return;
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      frame = requestAnimationFrame(step);
      if (driving.current) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const move = readMove();
      if (!move.x && !move.y) return;
      walked.current = true;
      const speed = 8 * dt;
      const lat = feet.current.lat + (move.y * speed) / 111320;
      const cos = Math.cos((feet.current.lat * Math.PI) / 180) || 1;
      const lng = feet.current.lng + (move.x * speed) / (111320 * cos);
      feet.current = { lat, lng };
      youRef.current?.setLatLng([lat, lng]);
      mapRef.current?.panTo([lat, lng], { animate: false });
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [mapReady]);

  useEffect(() => {
    // Save where the figure stands (walked / travelled / GPS); raw GPS only until it has moved.
    const pos = spotPos ?? here;
    if (!user || !pos) return;
    const push = () => {
      void savePresence({
        data: {
          displayName: name || user.displayName || "Neighbor",
          avatar,
          lat: pos.lat,
          lng: pos.lng,
          visible,
        },
      }).catch(() => setNote("Could not save your spot."));
    };
    push();
    const id = window.setInterval(push, 15_000);
    return () => window.clearInterval(id);
  }, [user, here, spotPos, name, avatar, visible]);

  useEffect(() => {
    if (!user || !here) {
      setNeighbors([]);
      return;
    }
    let stop = false;
    const pull = () => {
      void listNearby({ data: here })
        .then((rows) => {
          if (!stop) {
            peopleRef.current = rows;
            setNeighbors(rows);
          }
        })
        .catch(() => {
          if (!stop) setNeighbors([]);
        });
    };
    pull();
    const id = window.setInterval(pull, 12_000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [user, here]);

  useEffect(() => {
    if (!user) {
      setTrippers([]);
      return;
    }
    let stop = false;
    const pull = () => {
      void tripAvatars()
        .then((rows) => {
          if (!stop) setTrippers(rows);
        })
        .catch(() => {
          if (!stop) setTrippers([]);
        });
    };
    pull();
    const id = window.setInterval(pull, 4_000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [user]);

  useEffect(() => {
    let stop = false;
    void import("leaflet").then((L) => {
      const group = othersRef.current;
      if (stop || !group) return;
      group.clearLayers();
      for (const person of shown) {
        const icon = L.divIcon({
          className: "",
          iconSize: [44, 44],
          iconAnchor: [22, 22],
          html: person.avatar
            ? `<img alt="" src="${person.avatar}" style="width:44px;height:44px;border-radius:999px;object-fit:cover;border:2px solid #f6efe2" />`
            : `<div style="width:44px;height:44px;border-radius:999px;background:#2c241c;border:2px solid #f6efe2"></div>`,
        });
        L.marker([person.lat, person.lng], { icon })
          .bindTooltip(person.displayName, { direction: "top", offset: [0, -18] })
          .on("click", () => setPerson(person))
          .addTo(group);
      }
    });
    return () => {
      stop = true;
    };
  }, [neighbors, trippers, mapReady]);

  useEffect(() => {
    if (!user) {
      setAdmin(false);
      return;
    }
    void sessionRole()
      .then((role) => setAdmin(role.admin))
      .catch(() => setAdmin(false));
  }, [user]);

  const center = here ?? { lat: FALLBACK.lat, lng: FALLBACK.lng };
  const placeKey = `${center.lat.toFixed(3)},${center.lng.toFixed(3)}`;

  useEffect(() => {
    let stop = false;
    void (async () => {
      const [ring, osm] = await Promise.all([
        listOpenBusinesses({ data: center }).catch(() => []),
        streetPlaces({ data: center }).catch(() => []),
      ]);
      if (stop) return;
      const opened = ring.map((place) => ({
        id: place.id,
        name: place.listing === "pin_checked" ? place.name : place.name,
        kind: place.kind,
        lat: place.lat,
        lng: place.lng,
        source: "ring" as const,
        verified: place.verified,
        category: place.category,
        offer: place.verified
          ? `Verified · ${place.offer}`
          : place.listing === "pin_checked"
            ? `On Ndu · pin checked, not verified. ${place.offer}`
            : `On Ndu · self-listed, not verified. ${place.offer}`,
      }));
      const street = osm.map((place) => ({
        ...place,
        source: "osm" as const,
        offer: place.offer ? `OpenStreetMap · ${place.offer}` : "OpenStreetMap place. Not claimed.",
      }));
      const rows = [...opened, ...street].slice(0, 24);
      setPlaces(rows);
      setSpot((current) => (rows.some((place) => place.id === current) ? current : (rows[0]?.id ?? null)));
    })();
    return () => {
      stop = true;
    };
    // placeKey is the stable neighborhood, not every GPS tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey, ringTick]);

  useEffect(() => {
    let stop = false;
    void import("leaflet").then((L) => {
      const group = placesRef.current;
      if (stop || !group || !mapReady) return;
      group.clearLayers();
      for (const place of places) {
        const isVerse = place.name.includes("Zealous Pane") || place.name.includes("Jarvis Verse");
        const label = isVerse ? "✦ Verse" : place.verified ? "V" : place.source === "ring" ? "Ndu" : place.kind === "eat" ? "Eat" : place.kind === "shift" ? "Work" : place.kind === "rest" ? "Rest" : place.kind === "wash" ? "Wash" : "Care";
        const icon = L.divIcon({
          className: "",
          iconSize: isVerse ? [52, 52] : [44, 44],
          iconAnchor: isVerse ? [26, 26] : [22, 22],
          html: isVerse
            ? `<div style="width:52px;height:52px;border-radius:999px;background:#0c0a1a;color:#22d3ee;border:2.5px solid #22d3ee;display:grid;place-items:center;font:700 10px sans-serif;box-shadow:0 0 16px rgba(34,211,238,0.8), inset 0 0 8px rgba(34,211,238,0.4);animation:pulse 2s infinite;">✦ Verse</div>`
            : `<div style="width:44px;height:44px;border-radius:999px;background:${place.id === spot ? "#e8843a" : "#f6efe2"};color:${place.id === spot ? "#1a1511" : "#1a1511"};border:2px solid #1a1511;display:grid;place-items:center;font:600 11px sans-serif;box-shadow:${place.source === "ring" ? "0 0 0 4px rgba(232,132,58,.55)" : "0 2px 8px rgba(0,0,0,.35)"}">${label}</div>`,
        });
        L.marker([place.lat, place.lng], { icon })
          .bindTooltip(place.name, { direction: "top" })
          .on("click", () => setSpot(place.id))
          .addTo(group);
      }
    });
    return () => {
      stop = true;
    };
  }, [places, spot, mapReady]);

  const chosen = places.find((place) => place.id === spot) ?? null;
  stallRef.current = chosen ? { lat: chosen.lat, lng: chosen.lng } : null;

  useEffect(() => {
    const map = mapRef.current;
    const hostEl = figHost.current;
    if (!mapReady || !map || !hostEl) return;
    // NDU-UPG 504: the figures layer is three.js. Load it on demand, and not at all while its host is hidden
    // (the 3D street map covers it), so map-only players never download three.js or open a 2nd WebGL context.
    if (getComputedStyle(hostEl).display === "none") return;
    let stop: (() => void) | undefined;
    let live = true;
    void import("@/world/figures").then(({ mountFigures }) => {
      if (!live) return;
      stop = mountFigures(hostEl, map, () => ({
        you: feet.current,
        people: peopleRef.current,
        stall: stallRef.current,
      }));
    });
    return () => {
      live = false;
      stop?.();
    };
  }, [mapReady]);

  function act() {
    if (!chosen || working) return;
    if (chosen.kind === "shift") {
      setWorking(true);
      window.setTimeout(() => {
        liveAct("shift", chosen.name);
        setWorking(false);
      }, 8000);
      return;
    }
    liveAct(chosen.kind, chosen.name);
  }

  function driveTo(place: { id: string; lat: number; lng: number; name: string }) {
    if (driving.current) return;
    const go = goRef.current;
    if (!go) {
      setYard(place.id);
      return;
    }
    driving.current = true;
    // The visible 3D map draws the route and moves the figure along it; open the yard on arrival.
    void go({ lat: place.lat, lng: place.lng, name: place.name }).then((arrived) => {
      if (arrived) setYard(place.id);
      else driving.current = false;
    });
  }

  return (
    <main className="bg-bg relative h-dvh w-full">
      <div ref={host} className="absolute inset-0 hidden" />
      <div ref={figHost} className="pointer-events-none absolute inset-0 z-[400] hidden" />
      <CityBuildings
        lat={FALLBACK.lat}
        lng={FALLBACK.lng}
        defaultLabel="Port Harcourt"
        saved={saved}
        onMove={rememberSpot}
        goRef={goRef}
        people={shown}
        places={places}
        name={name || user?.displayName || "You"}
        photo={avatar}
        onEnter={setInside}
        onMeet={setPerson}
        onTalk={setRobot}
      />
      <OverlayDock bubbles={bubbles} />
      {/* NDU-UPG bubbles: compact top pill replaces the full top bar */}
      {bubbles ? <TopPill nearby={neighbors.length} onPhone={() => setPhone(true)} visible={visible} onVisible={() => setVisible((v) => !v)} places={places} /> : null}
      {/* NDU-UPG follow: compact rule bubble, top right under the pill (clear of the compass / N bubbles) */}
      <CivicTicker onOpen={() => setColony(true)} />
      <div className="pointer-events-none absolute right-3 top-[4.6rem] z-[500] flex justify-end">
        <RuleStrip
          place={rulePlace({
            inside: inside?.name,
            phone,
            robotVehicle: robot ? (getBot(robot)?.vehicle ?? null) : null,
          })}
        />
      </div>
      <div className={`pointer-events-none absolute inset-x-0 top-0 z-[500] flex flex-col items-center gap-2 p-3${bubbles ? " hidden" : ""}`}>
        <div data-ndu-overlay="top" className="bg-surface/95 text-fg pointer-events-auto flex w-full max-w-3xl items-center gap-2 rounded-full px-3 py-2 shadow-lg">
          <p className="font-display px-1 text-xl leading-none">Ndu</p>
          <p className="text-muted min-w-0 flex-1 truncate text-sm">
            Tap a street to go there. Drag sideways to turn, up or down to slide.
            {neighbors.length ? ` · ${neighbors.length} nearby` : ""}
          </p>
          <button type="button" className="bg-bg min-h-10 rounded-full px-3 text-sm" onClick={() => setPhone(true)}>
            Phone
          </button>
          <BagButton />
          <SignedIn>
            <button type="button" className="bg-accent text-bg min-h-10 rounded-full px-3 text-sm" onClick={() => setVisible((v) => !v)}>
              {visible ? "Visible" : "Hidden"}
            </button>
            <UserButton />
          </SignedIn>
        </div>
      </div>
      {placesOpen ? (
        <PlacesPanel
          at={spotPos ?? saved ?? here ?? { lat: FALLBACK.lat, lng: FALLBACK.lng }}
          onClose={() => setPlacesOpen(false)}
          onGo={(p) => {
            setPlacesOpen(false);
            driveTo(p);
          }}
        />
      ) : null}
      {colony ? <ColonySheet onClose={() => setColony(false)} /> : null}
      {phone ? (
        <PhoneSheet
          neighbors={neighbors}
          places={places}
          onClose={() => setPhone(false)}
          onPlace={(place) => setInside({ name: place.name, lat: place.lat, lng: place.lng })}
          onOpen={(name) => {
            setPhone(false);
            const at = spotPos ?? saved ?? { lat: FALLBACK.lat, lng: FALLBACK.lng };
            setInside({ name, lat: at.lat, lng: at.lng });
          }}
        />
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[500] flex items-end justify-between gap-2 p-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))", paddingRight: "max(12px, env(safe-area-inset-right))" }}>
        <NeedsSheet openKey={person?.id ?? null}>{/* NDU-UPG bubbles */}
        <div data-ndu-overlay="needs" className="bg-surface/95 pointer-events-auto w-full max-w-md space-y-2 rounded-3xl px-3 py-3 shadow-lg">
          <GateCard />
          <LifeStrip />
          {person ? (
            <div className="bg-bg flex items-center gap-2 rounded-2xl px-3 py-2">
              <p className="min-w-0 flex-1 text-sm">
                {person.displayName} is saved on your phone. The spot on the map is approximate.
              </p>
              <button type="button" className="bg-surface min-h-10 rounded-full px-3 text-sm" onClick={() => setPerson(null)}>
                Close
              </button>
            </div>
          ) : null}
          {chosen?.source === "ring" ? (
            <button type="button" className="bg-bg min-h-11 w-full rounded-full text-sm" onClick={() => driveTo(chosen)}>
              Drive to {chosen.name}
            </button>
          ) : null}
          {chosen?.source === "ring" && chosen.verified ? (
            <button type="button" className="bg-bg min-h-11 w-full rounded-full text-sm" onClick={() => setDesk("book")}>
              Book {chosen.name}
            </button>
          ) : chosen?.source === "ring" ? (
            <p className="text-muted text-center text-xs">Listed. A manager has to verify it before anyone can book.</p>
          ) : null}
          {chosen && (chosen.name.includes("Zealous Pane") || chosen.name.includes("Jarvis Verse")) ? (
            <button
              type="button"
              className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold min-h-11 w-full rounded-full text-sm flex items-center justify-center gap-2 shadow-lg transition-transform active:scale-95 cursor-pointer"
              onClick={() => setInside({ name: "Zealous Pane", lat: chosen.lat, lng: chosen.lng })}
            >
              <span>Enter 3D Jarvis Verse</span>
              <span>✦</span>
            </button>
          ) : chosen ? (
            <button
              type="button"
              className="bg-accent text-bg min-h-11 w-full rounded-full text-sm font-medium disabled:opacity-60"
              disabled={working}
              onClick={act}
            >
              {working ? `Working at ${chosen.name}…` : `${kindLabel(chosen.kind)} · ${chosen.name}`}
            </button>
          ) : (
            <p className="text-muted text-center text-sm">Tap a pin on the map.</p>
          )}
          <button type="button" className="text-muted w-full text-sm" onClick={() => setSheet((v) => !v)}>
            {sheet ? "Hide" : "More"}
          </button>
          {sheet ? (
            <>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {places.map((place) => (
                  <button
                    key={place.id}
                    type="button"
                    className={`min-h-10 shrink-0 rounded-full px-3 text-sm ${place.id === spot ? "bg-accent text-bg" : "bg-bg"}`}
                    onClick={() => setSpot(place.id)}
                  >
                    {place.name}
                  </button>
                ))}
              </div>
              {chosen?.offer ? <p className="text-muted text-xs">{chosen.offer}</p> : null}
              <SignedIn>
                <button type="button" className="bg-bg min-h-10 w-full rounded-full text-sm" onClick={() => setCamera(true)}>
                  Photo
                </button>
                <button type="button" className="bg-bg min-h-10 w-full rounded-full text-sm" onClick={() => setRingOpen(true)}>
                  Register your business
                </button>
                {admin ? (
                  <a href="/admin" className="bg-bg grid min-h-10 w-full place-items-center rounded-full text-sm">
                    Manager desk
                  </a>
                ) : null}
                <button type="button" className="bg-bg min-h-10 w-full rounded-full text-sm" onClick={() => setDesk("appointments")}>
                  Appointments
                </button>
                <button type="button" className="bg-bg min-h-10 w-full rounded-full text-sm" onClick={() => openNeura("wallet")}>
                  Wallet · Solana devnet
                </button>
                <button type="button" className="bg-bg min-h-10 w-full rounded-full text-sm" onClick={() => openNeura("compute")}>
                  Compute desk · devnet demo
                </button>
                <button type="button" className="bg-bg min-h-10 w-full rounded-full text-sm cursor-pointer" onClick={() => setAccountOpen(true)}>
                  Account & My Places
                </button>
                <button type="button" className="bg-bg min-h-10 w-full rounded-full text-sm cursor-pointer" onClick={() => setPlacesOpen(true)}>
                  Places & Claims
                </button>
              </SignedIn>
              <SignedOut>
                <div className="space-y-2">
                  <p className="text-muted text-xs">Sign in or create an account for this session (email & password).</p>
                  <button
                    type="button"
                    className="bg-accent text-bg min-h-11 w-full rounded-full px-3 text-sm font-semibold cursor-pointer"
                    onClick={() => setAccountOpen(true)}
                  >
                    Sign In / Sign Up
                  </button>
                  <a
                    href="/account/sessions"
                    className="bg-bg grid min-h-11 w-full place-items-center rounded-full px-3 text-xs text-muted hover:text-fg"
                  >
                    Sessions & Devices
                  </a>
                </div>
              </SignedOut>
              {note ? <p className="text-muted text-xs">{note}</p> : null}
            </>
          ) : null}
        </div>
        </NeedsSheet>
      </div>
      {robot ? <RobotCard id={robot} onClose={() => setRobot("")} /> : null}
      {accountOpen ? <AccountSheet onClose={() => setAccountOpen(false)} /> : null}
      <KidsHost /> {/* NDU-UPG kids: Kids room overlay (lazy; opens from My room / Hall or ?kids=1) */}
      {inside?.workverse || inside?.name === "Agent Office" || inside?.name === "Zealous Pane" || inside?.name === "Office" ? (
        <WorkverseSlot onLeave={leaveInside} spot={inside} />
      ) : inside?.name === "Kitchen" ? (
        <KitchenRoom onLeave={leaveInside} onGo={(room) => setInside({ name: room, lat: inside.lat, lng: inside.lng })} />
      ) : inside?.name === "Bed" || inside?.name === "Bath" || inside?.name === "Hall" ? (
        <StreetRoom name={inside.name} onLeave={leaveInside} onGo={(room) => setInside({ name: room, lat: inside.lat, lng: inside.lng })} />
      ) : inside?.name === "Car" ? (
        <CarRoom onLeave={leaveInside} onDrive={leaveInside} />
      ) : inside?.name === "Yard" ? (
        <EcoRoom onLeave={leaveInside} />
      ) : inside?.name === "Room" ? (
        <MyRoom onLeave={leaveInside} />
      ) : inside?.name === "J2CS" ? (
        <Tower onLeave={leaveInside} onStudio={() => setInside({ name: "Studio", lat: inside.lat, lng: inside.lng })} />
      ) : inside?.name === "Studio" ? (
        <J2csRoom onLeave={() => setInside({ name: "J2CS", lat: inside.lat, lng: inside.lng })} />
      ) : inside ? (
        <div className="bg-bg/80 absolute inset-0 z-[600] grid place-items-end p-3 sm:place-items-center">
          <div className="bg-surface ndu-es-card max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-3xl p-4">
            <h2 className="font-display text-2xl">{inside.name}</h2>
            <p className="text-muted mt-1 text-sm">
              You stepped inside this building. The block map stays outside. An owner can lay the room out from their place.
            </p>
            {/* NDU-UPG empty-state: isometric empty shell / slot, or the owner's version */}
            <InsideView key={`${inside.lat},${inside.lng},${inside.name}`} spot={inside} userId={user?.id ?? null} />
            <div className="mt-4 flex gap-2">
              <button type="button" className="bg-bg min-h-11 flex-1 rounded-full text-sm" onClick={leaveInside}>
                Back to the street
              </button>
              <button
                type="button"
                className="bg-accent text-bg min-h-11 flex-1 rounded-full text-sm font-semibold whitespace-nowrap px-4"
                onClick={() => setInside({ ...inside, workverse: true })}
              >
                Enter 3D Building (Jarvis Verse)
              </button>
              {(() => {
                const tagged = places.find(
                  (place) =>
                    place.source === "google" &&
                    Math.hypot(place.lat - inside.lat, place.lng - inside.lng) < 0.0006,
                );
                if (!tagged) return null;
                return (
                  <button
                    type="button"
                    className="bg-accent text-bg min-h-11 flex-1 rounded-full text-sm"
                    onClick={() => {
                      void claimGooglePlace({
                        data: {
                          placeId: tagged.id.replace(/^google-/, ""),
                          name: tagged.name,
                          lat: tagged.lat,
                          lng: tagged.lng,
                        },
                      })
                        .then((result) => setNote(result.reason))
                        .catch(() => setNote("Sign in before you claim a place."));
                    }}
                  >
                    Claim
                  </button>
                );
              })()}
              {places.find(
                (place) =>
                  place.source === "ring" &&
                  Math.hypot(place.lat - inside.lat, place.lng - inside.lng) < 0.0008,
              ) ? (
                <button
                  type="button"
                  className="bg-accent text-bg min-h-11 flex-1 rounded-full text-sm"
                  onClick={() => {
                    const near = places.find(
                      (place) =>
                        place.source === "ring" &&
                        Math.hypot(place.lat - inside.lat, place.lng - inside.lng) < 0.0008,
                    );
                    if (near) setYard(near.id);
                    setInside(null);
                  }}
                >
                  Owner's room
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {camera ? <CameraSheet onClose={() => setCamera(false)} onShot={setAvatar} /> : null}
      {yard ? (
        <YardSheet
          businessId={yard}
          userId={user?.id ?? null}
          onClose={() => {
            driving.current = false;
            setYard(null);
          }}
        />
      ) : null}
      {desk === "book" && chosen ? (
        <BookSheet businessId={chosen.id} name={chosen.name} onClose={() => setDesk(null)} />
      ) : null}
      {desk === "appointments" ? <Appointments onClose={() => setDesk(null)} /> : null}
      {desk === "manage" ? (
        <ManageSheet
          onClose={() => setDesk(null)}
          onChanged={() => setRingTick((n) => n + 1)}
        />
      ) : null}
      {user && neuraUi && neura === "wallet" ? <neuraUi.WalletSheet onClose={() => setNeura(null)} /> : null}
      {user && neuraUi && neura === "compute" ? (
        <neuraUi.ComputeSheet onClose={() => setNeura(null)} onOpenWallet={() => setNeura("wallet")} />
      ) : null}
      {ringOpen ? (
        <OpenRing
          lat={center.lat}
          lng={center.lng}
          onClose={() => setRingOpen(false)}
          onOpened={() => {
            setRingOpen(false);
            setRingTick((n) => n + 1);
          }}
        />
      ) : null}
    </main>
  );
}

function OpenRing({
  lat,
  lng,
  onClose,
  onOpened,
}: {
  lat: number;
  lng: number;
  onClose: () => void;
  onOpened: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("shop");
  const [offer, setOffer] = useState("");
  const [declared, setDeclared] = useState(false);
  const [checkPin, setCheckPin] = useState(false);
  const [err, setErr] = useState("");
  const categories = [
    ["shop", "Shop"],
    ["service", "Service"],
    ["office", "Office"],
    ["place", "Place"],
    ["home", "Home"],
    ["station", "Filling station"],
  ] as const;

  async function submit() {
    setErr("");
    try {
      await openBusiness({ data: { name, category, offer, lat, lng, declared, checkPin } });
      onOpened();
    } catch {
      setErr("Say you operate it, name what you offer, and stand at the place.");
    }
  }

  return (
    <div className="bg-bg/80 absolute inset-0 z-[600] grid place-items-end p-3 sm:place-items-center">
      <form
        className="bg-surface w-full max-w-sm space-y-3 rounded-2xl p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 className="font-display text-2xl">Register on Ndu</h2>
        <p className="text-muted text-sm">
          This listing belongs to the platform, not to Google. A manager verifies it before anyone can book. A home is the block, never the door.
        </p>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name"
          className="bg-bg min-h-11 w-full rounded-xl px-3"
        />
        <div className="flex flex-wrap gap-2">
          {categories.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`min-h-10 rounded-full px-3 text-sm ${category === id ? "bg-accent text-bg" : "bg-bg"}`}
              onClick={() => setCategory(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          value={offer}
          onChange={(event) => setOffer(event.target.value)}
          placeholder="What you sell or do"
          className="bg-bg min-h-11 w-full rounded-xl px-3"
        />
        <Suspense fallback={null}>
          <ListingCheckHint text={`${name}\n${offer}`} />
        </Suspense>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={declared} onChange={(event) => setDeclared(event.target.checked)} />
          <span>I operate this place. I am not listing someone else’s business.</span>
        </label>
        {category !== "home" ? (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={checkPin} onChange={(event) => setCheckPin(event.target.checked)} />
            <span>Optionally check the pin on Google. No match still lists you here as self-listed.</span>
          </label>
        ) : null}
        {err ? <p className="text-sm">{err}</p> : null}
        <div className="flex gap-2">
          <button type="button" className="bg-bg min-h-11 flex-1 rounded-full" onClick={onClose}>
            Close
          </button>
          <button type="submit" disabled={!declared} className="bg-accent text-bg min-h-11 flex-1 rounded-full font-medium disabled:opacity-50">
            List it
          </button>
        </div>
      </form>
    </div>
  );
}

function GateCard() {
  const snap = useSim();
  if (snap.phase === "play") return null;
  return (
    <div className="space-y-2">
      <p className="text-center text-sm">The real map is already on. You have to be 18 to take part.</p>
      <button
        type="button"
        className="bg-accent text-bg min-h-11 w-full rounded-full text-sm font-medium"
        onClick={() => {
          setAgeOk(true);
          enterBlock();
        }}
      >
        I am 18 or older
      </button>
    </div>
  );
}

function LifeStrip() {
  const snap = useSim();
  useEffect(() => {
    if (snap.phase !== "play") return;
    const id = window.setInterval(() => tickLife(1), 1000);
    return () => window.clearInterval(id);
  }, [snap.phase]);
  if (snap.phase !== "play") return null;
  const hour = Math.floor(snap.gameMinutes / 60) % 24;
  const minute = Math.floor(snap.gameMinutes % 60);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{vouchers()} vouchers</p>
        <p className="text-muted text-xs">
          {String(hour).padStart(2, "0")}:{String(minute).padStart(2, "0")}
          {snap.gameMinutes >= 60 ? " · rent is due" : ""}
        </p>
      </div>
      <div className="grid grid-cols-6 gap-1">
        {NEED_KEYS.map((key) => (
          <NeedBar key={key} need={key} value={snap.needs[key]} />
        ))}
      </div>
      {snap.toast ? <p className="text-xs">{snap.toast}</p> : null}
    </div>
  );
}

const NEED_WORD: Record<NeedKey, string> = {
  hunger: "Food",
  energy: "Rest",
  hygiene: "Wash",
  social: "People",
  comfort: "Ease",
  health: "Health",
};

function NeedBar({ need, value }: { need: NeedKey; value: number }) {
  return (
    <div className="min-w-0">
      <div className="bg-bg h-1.5 overflow-hidden rounded-full">
        <div className="bg-accent h-full" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <p className="text-muted truncate text-[10px]">{NEED_WORD[need]}</p>
    </div>
  );
}

function CameraSheet({ onClose, onShot }: { onClose: () => void; onShot: (url: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    void navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((next) => {
        stream = next;
        if (video.current) video.current.srcObject = next;
      })
      .catch(() => setErr("Camera is blocked. Allow it, or stay as a plain marker."));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  function shoot() {
    const el = video.current;
    if (!el) return;
    const canvas = document.createElement("canvas");
    const size = 160;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const side = Math.min(el.videoWidth, el.videoHeight);
    const sx = (el.videoWidth - side) / 2;
    const sy = (el.videoHeight - side) / 2;
    ctx.drawImage(el, sx, sy, side, side, 0, 0, size, size);
    onShot(canvas.toDataURL("image/jpeg", 0.72));
    onClose();
  }

  return (
    <div className="bg-bg/80 absolute inset-0 z-[600] grid place-items-center p-4">
      <div className="bg-surface w-full max-w-sm space-y-3 rounded-2xl p-4">
        <h2 className="font-display text-2xl">Your picture</h2>
        <p className="text-muted text-sm">A photo for the map. Not a scan that identifies you elsewhere.</p>
        <video ref={video} autoPlay playsInline muted className="bg-bg aspect-square w-full rounded-2xl object-cover" />
        {err ? <p className="text-sm">{err}</p> : null}
        <div className="flex gap-2">
          <button type="button" className="bg-bg min-h-11 flex-1 rounded-full" onClick={onClose}>
            Close
          </button>
          <button type="button" className="bg-accent text-bg min-h-11 flex-1 rounded-full font-medium" onClick={shoot}>
            Use this
          </button>
        </div>
      </div>
    </div>
  );
}
