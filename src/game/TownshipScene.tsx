import { Canvas, useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { Group, OrthographicCamera } from "three";
import { ACCENT, CLEAR, CLOTH, CREAM, FOLIAGE, INK, MUTED, ROAD, SAND } from "./palette";
import { bench, buildings, fanSpot, lamps, shopDoor, signs, stall, tap, neighbor } from "./layout";
import { bindInput, readMove, setProbeKeys, setStick } from "./input";
import { MISSIONS, objectiveBlip } from "./missions";
import {
  acceptJob,
  buyGood,
  buyRoom,
  clockLabel,
  emitSim,
  leaveInterior,
  NEED_KEYS,
  rentDue,
  setDestination,
  setPhone,
  sim,
  stepSim,
  toggleHighRoad,
  toggleNepa,
  tryInteract,
  vouchers,
  type Basis,
  type NeedKey,
} from "./sim";
import { useSim } from "./useSim";
import { Citizen } from "./Citizen";
import { StreetDressing } from "./StreetDressing";
import "./controlsProbe";

const basis: Basis = { fx: -0.7071, fz: -0.7071, rx: 0.7071, rz: -0.7071 };
let acc = 0;

function Loop() {
  useFrame((state, delta) => {
    const camera = state.camera as OrthographicCamera;
    camera.position.set(sim.x + 22, 24, sim.z + 22);
    camera.lookAt(sim.x, 0.6, sim.z);
    camera.zoom = 28;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const fx = -e[8];
    const fz = -e[10];
    const rx = e[0];
    const rz = e[2];
    const fl = Math.hypot(fx, fz) || 1;
    const rl = Math.hypot(rx, rz) || 1;
    basis.fx = fx / fl;
    basis.fz = fz / fl;
    basis.rx = rx / rl;
    basis.rz = rz / rl;

    const step = 1 / 60;
    const d = Math.min(delta, 0.1);
    acc += d;
    let guard = 0;
    const move = readMove();
    while (acc >= step && guard < 5) {
      stepSim(step, basis, move);
      acc -= step;
      guard += 1;
    }
  });
  return null;
}

function Player() {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const bob = sim.speed > 0.2 ? Math.sin(clock.elapsedTime * 10) * 0.06 : 0;
    g.position.set(sim.x, bob, sim.z);
    g.rotation.y = sim.yaw + Math.PI;
  });
  return (
    <group ref={ref}>
      <Citizen />
    </group>
  );
}

function Fan() {
  const ref = useRef<Group>(null);
  useFrame((_, delta) => {
    const g = ref.current;
    if (!g) return;
    if (sim.nepa && sim.elapsed < sim.fanUntil) g.rotation.y += delta * 10;
  });
  return (
    <group position={[fanSpot.x, 2.2, fanSpot.z]}>
      <mesh position={[0, -1.1, 0]}>
        <cylinderGeometry args={[0.06, 0.08, 2.2, 8]} />
        <meshStandardMaterial color={INK} />
      </mesh>
      <group ref={ref}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} rotation={[0, (i * Math.PI * 2) / 3, 0]} position={[0.45, 0, 0]}>
            <boxGeometry args={[0.9, 0.05, 0.18]} />
            <meshStandardMaterial color={MUTED} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Block() {
  const snap = useSim();
  const lit = snap.nepa;
  const lampsOn = snap.nepa && snap.highRoad;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[90, 70]} />
        <meshStandardMaterial color={SAND} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <planeGeometry args={[90, 10]} />
        <meshStandardMaterial color={ROAD} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} receiveShadow>
        <planeGeometry args={[10, 70]} />
        <meshStandardMaterial color={ROAD} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, -28]} receiveShadow>
        <planeGeometry args={[90, 8]} />
        <meshStandardMaterial color={ROAD} />
      </mesh>
      {buildings.map((b) => {
        const w = b.maxX - b.minX;
        const d = b.maxZ - b.minZ;
        const cx = (b.minX + b.maxX) / 2;
        const cz = (b.minZ + b.maxZ) / 2;
        const wall = b.tone === 0 ? CREAM : INK;
        return (
          <group key={b.id} position={[cx, b.h / 2, cz]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[w, b.h, d]} />
              <meshStandardMaterial color={wall} />
            </mesh>
            <mesh position={[0, b.h / 2 + 0.15, 0]}>
              <boxGeometry args={[w + 0.4, 0.3, d + 0.4]} />
              <meshStandardMaterial color={b.tone === 0 ? ACCENT : MUTED} />
            </mesh>
            {[-1, 1].map((side) => (
              <mesh key={side} position={[side * w * 0.22, 0.4, d / 2 + 0.02]}>
                <planeGeometry args={[0.7, 0.9]} />
                <meshStandardMaterial
                  color={lit ? ACCENT : INK}
                  emissive={lit ? ACCENT : INK}
                  emissiveIntensity={lit ? 0.85 : 0}
                />
              </mesh>
            ))}
          </group>
        );
      })}
      <group position={[stall.x, 0, stall.z]}>
        <mesh position={[0, 1.1, 0]} castShadow>
          <cylinderGeometry args={[1.3, 1.5, 0.12, 8]} />
          <meshStandardMaterial color={ACCENT} />
        </mesh>
        <mesh position={[0, 0.55, 0]} castShadow>
          <boxGeometry args={[1.6, 1, 1]} />
          <meshStandardMaterial color={CREAM} />
        </mesh>
      </group>
      <mesh position={[shopDoor.x, 1.1, shopDoor.z + 1.4]} castShadow>
        <boxGeometry args={[1.2, 2.2, 0.12]} />
        <meshStandardMaterial color={ACCENT} />
      </mesh>
      {lamps.map((lamp) => (
        <group key={`${lamp.x}`} position={[lamp.x, 0, lamp.z]}>
          <mesh position={[0, 2.2, 0]} castShadow>
            <cylinderGeometry args={[0.08, 0.1, 4.4, 6]} />
            <meshStandardMaterial color={INK} />
          </mesh>
          <mesh position={[0, 4.5, 0]}>
            <sphereGeometry args={[0.28, 12, 10]} />
            <meshStandardMaterial
              color={lampsOn ? CREAM : MUTED}
              emissive={lampsOn ? ACCENT : INK}
              emissiveIntensity={lampsOn ? 1.4 : 0}
            />
          </mesh>
          {lampsOn ? <pointLight position={[0, 4.2, 0]} intensity={8} distance={16} color={ACCENT} /> : null}
        </group>
      ))}
      {signs.map((sign) => (
        <Html key={sign.name} position={[sign.x, 3.2, sign.z]} center zIndexRange={[1, 0]} style={{ pointerEvents: "none" }}>
          <div className="street-sign">{sign.name}</div>
        </Html>
      ))}
      <Fan />
      <StreetDressing />
      <ObjectiveMarker />
      <Walkers />
      {[
        [-40, -30],
        [40, 30],
        [-40, 30],
        [40, -4],
      ].map(([x, z]) => (
        <group key={`${x}-${z}`} position={[x, 0, z]}>
          <mesh position={[0, 1.2, 0]}>
            <cylinderGeometry args={[0.12, 0.18, 2.4, 6]} />
            <meshStandardMaterial color={CLOTH} />
          </mesh>
          <mesh position={[0, 2.6, 0]}>
            <sphereGeometry args={[0.9, 10, 8]} />
            <meshStandardMaterial color={FOLIAGE} />
          </mesh>
        </group>
      ))}
      <Player />
      <hemisphereLight args={[CREAM, INK, lit ? 0.7 : 0.28]} />
      <directionalLight
        position={[18, 28, 12]}
        intensity={lit ? 1.35 : 0.35}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
    </group>
  );
}

const NEED_LABEL: Record<NeedKey, string> = {
  hunger: "Hunger",
  energy: "Energy",
  hygiene: "Hygiene",
  social: "Social",
  comfort: "Comfort",
  health: "Health",
};

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr_2rem] items-center gap-2">
      <span className="text-muted text-xs">{label}</span>
      <span className="bg-bg h-2 overflow-hidden rounded-full">
        <span className="bg-accent block h-full" style={{ width: `${Math.round(value)}%` }} />
      </span>
      <span className="text-fg text-right text-xs">{Math.round(value)}</span>
    </div>
  );
}

function Interior({ kind, ownsRoom, toast }: { kind: "shop" | "hall"; ownsRoom: boolean; toast: string }) {
  const shop = kind === "shop";
  return (
    <div className="absolute inset-0 z-20 flex items-end justify-center bg-[#1a1511] p-3 sm:items-center">
      <div className="relative h-[70dvh] w-full max-w-md overflow-hidden rounded-3xl bg-[#2c241c]">
        <div className={`absolute inset-x-0 top-0 h-2/5 ${shop ? "bg-[#3a2a22]" : "bg-[#241c28]"}`} />
        <div className="absolute inset-x-8 bottom-0 h-24 rounded-t-3xl bg-[#c46a2a]" />
        <div className="relative flex h-full flex-col justify-between p-4">
          <div>
            <p className="text-muted text-xs">{shop ? "Inside" : "Inside"}</p>
            <h2 className="font-display text-4xl leading-none">{shop ? "Aggrey shop" : "Bonny Hall"}</h2>
            <p className="text-muted mt-2 text-sm">
              {shop ? "Groceries for the day. Game vouchers only." : "A hall on this street. Not a copy of anyone else's club."}
            </p>
          </div>
          <div className="grid gap-2">
            {toast ? <p className="text-sm">{toast}</p> : null}
            {shop ? (
              <>
                <button type="button" className="bg-bg min-h-11 rounded-full" onClick={() => buyGood("bread")}>
                  Bread · 8
                </button>
                <button type="button" className="bg-bg min-h-11 rounded-full" onClick={() => buyGood("water")}>
                  Water · 4
                </button>
                <button type="button" className="bg-bg min-h-11 rounded-full" onClick={() => buyGood("soap")}>
                  Soap · 6
                </button>
              </>
            ) : (
              <>
                <button type="button" className="bg-bg min-h-11 rounded-full" onClick={() => buyGood("drink")}>
                  Drink · 12
                </button>
                <button type="button" className="bg-accent text-bg min-h-11 rounded-full" onClick={buyRoom}>
                  {ownsRoom ? "Room kept" : "Buy the Bonny room · 80"}
                </button>
              </>
            )}
            <button type="button" className="bg-fg text-bg min-h-11 rounded-full" onClick={leaveInterior}>
              Step outside
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stick() {
  const pad = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = pad.current;
    if (!el) return;
    const setFrom = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let x = (clientX - cx) / (r.width / 2);
      let y = (cy - clientY) / (r.height / 2);
      const m = Math.hypot(x, y);
      if (m > 1) {
        x /= m;
        y /= m;
      }
      setStick(x, y);
    };
    const end = () => setStick(0, 0);
    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      setFrom(e.clientX, e.clientY);
    };
    const move = (e: PointerEvent) => {
      if (el.hasPointerCapture(e.pointerId)) setFrom(e.clientX, e.clientY);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      setStick(0, 0);
    };
  }, []);
  return <div ref={pad} className="border-accent/50 bg-surface/80 h-28 w-28 rounded-full border" aria-label="Move" />;
}

function WalkerBody() {
  return (
    <group>
      <mesh position={[0, 0.75, 0]} castShadow>
        <capsuleGeometry args={[0.22, 0.55, 4, 6]} />
        <meshStandardMaterial color={MUTED} />
      </mesh>
      <mesh position={[0, 1.35, 0]} castShadow>
        <sphereGeometry args={[0.16, 10, 8]} />
        <meshStandardMaterial color={SAND} />
      </mesh>
    </group>
  );
}

function Walkers() {
  const a = useRef<Group>(null);
  const b = useRef<Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (a.current) {
      const span = 50;
      const u = (t * 1.3) % (span * 2);
      const x = u < span ? -25 + u : 25 - (u - span);
      a.current.position.set(x, 0, 3.4);
      a.current.rotation.y = u < span ? Math.PI / 2 : -Math.PI / 2;
    }
    if (b.current) {
      const span = 36;
      const u = (t * 1.05) % (span * 2);
      const z = u < span ? -18 + u : 18 - (u - span);
      b.current.position.set(-3.4, 0, z);
      b.current.rotation.y = u < span ? 0 : Math.PI;
    }
  });
  return (
    <group>
      <group ref={a}>
        <WalkerBody />
      </group>
      <group ref={b}>
        <WalkerBody />
      </group>
    </group>
  );
}

function ObjectiveMarker() {
  const snap = useSim();
  const blip = objectiveBlip(snap);
  const bob = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (bob.current) bob.current.position.y = 2.4 + Math.sin(clock.elapsedTime * 3) * 0.2;
  });
  if (!blip) return null;
  return (
    <group position={[blip.x, 0, blip.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
        <ringGeometry args={[0.85, 1.1, 24]} />
        <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={0.6} />
      </mesh>
      <group ref={bob}>
        <mesh>
          <sphereGeometry args={[0.2, 12, 10]} />
          <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={1.2} />
        </mesh>
      </group>
    </group>
  );
}

function Compass({
  x,
  z,
  blip,
  dest,
}: {
  x: number;
  z: number;
  blip: { x: number; z: number } | null;
  dest: { x: number; z: number } | null;
}) {
  const spot = (wx: number, wz: number) => ({ x: ((wx + 45) / 90) * 100, y: ((wz + 35) / 70) * 100 });
  const player = spot(x, z);
  const mark = blip ? spot(blip.x, blip.z) : null;
  const goal = dest ? spot(dest.x, dest.z) : null;
  return (
    <div className="bg-surface/90 relative size-28 overflow-hidden rounded-2xl" aria-label="Compass">
      <div className="bg-muted/40 absolute top-1/2 h-px w-full" />
      <div className="bg-muted/40 absolute left-1/2 h-full w-px" />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100">
        {goal ? <line x1={player.x} y1={player.y} x2={goal.x} y2={goal.y} stroke="#e8843a" strokeWidth="1.5" /> : null}
      </svg>
      {mark ? (
        <span className="bg-fg absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${mark.x}%`, top: `${mark.y}%` }} />
      ) : null}
      {goal ? (
        <span className="bg-accent absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${goal.x}%`, top: `${goal.y}%` }} />
      ) : null}
      <span className="bg-fg absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-accent" style={{ left: `${player.x}%`, top: `${player.y}%` }} />
    </div>
  );
}

export function TownshipScene() {
  const snap = useSim();
  const [panels, setPanels] = useState(false);
  const [compass, setCompass] = useState(true);
  const [go, setGo] = useState(false);
  useEffect(() => {
    const unbind = bindInput(window);
    window.__controlsTest = {
      getYaw: () => sim.yaw,
      getSpeed: () => sim.speed,
      setKeys: (codes) => setProbeKeys(codes),
      setPos: (x: number, z: number) => {
        sim.x = x;
        sim.z = z;
      },
    };
    const id = window.setInterval(() => emitSim(), 200);
    return () => {
      unbind();
      window.clearInterval(id);
      delete window.__controlsTest;
    };
  }, []);

  const prompt =
    snap.near === "stall"
      ? "Eat · 10 game vouchers"
      : snap.near === "shop"
        ? snap.job === "working"
          ? `Shift ${Math.min(20, Math.floor(snap.jobTime))} / 20s`
          : "Shop"
        : snap.near === "fan"
          ? snap.nepa
            ? "Spin the fan"
            : "Fan needs NEPA"
          : snap.near === "bench"
            ? "Rest"
            : snap.near === "tap"
              ? "Wash"
              : snap.near === "neighbor"
                ? "Greet"
                : "";

  const stops = [
    { name: "Food stall", x: stall.x, z: stall.z, inside: null },
    { name: "Aggrey shop", x: shopDoor.x, z: shopDoor.z, inside: "shop" as const },
    { name: "Bonny Hall", x: 21, z: 10, inside: "hall" as const },
    { name: "Bench", x: bench.x, z: bench.z, inside: null },
    { name: "Standpipe", x: tap.x, z: tap.z, inside: null },
    { name: "Neighbor", x: neighbor.x, z: neighbor.z, inside: null },
  ];

  return (
    <div className="bg-bg relative h-dvh w-full overflow-hidden">
      <Canvas
        className="h-full w-full touch-none"
        shadows
        orthographic
        camera={{ position: [22, 24, 38], zoom: 28, near: 0.1, far: 400 }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={[CLEAR]} />
        <Loop />
        <Block />
      </Canvas>

      <div className="pointer-events-none absolute inset-0 p-3">
        <div className="pointer-events-auto flex items-start justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="bg-surface text-fg min-h-11 rounded-full px-3 text-sm" onClick={() => setPanels((v) => !v)}>
              {panels ? "Clear" : "Panels"}
            </button>
            <button type="button" className="bg-surface text-fg min-h-11 rounded-full px-3 text-sm" onClick={() => setCompass((v) => !v)}>
              {compass ? "Hide compass" : "Compass"}
            </button>
            <button type="button" className="bg-accent text-bg min-h-11 rounded-full px-3 text-sm" onClick={() => setGo(true)}>
              Go
            </button>
            <Link to="/" className="bg-surface text-fg inline-flex min-h-11 items-center rounded-full px-3 text-sm">
              Map
            </Link>
          </div>
          {compass ? <Compass x={snap.x} z={snap.z} blip={objectiveBlip(snap)} dest={snap.dest} /> : null}
        </div>

        {panels ? (
          <div className="pointer-events-auto mt-2 grid gap-2">
            <div className="bg-surface/90 max-w-sm rounded-2xl p-3">
              <p className="font-display text-fg text-lg leading-none">Township</p>
              <p className="text-muted mt-1 text-xs">{clockLabel(snap)}</p>
              <p className="text-fg text-sm">{rentDue(snap) ? "Rent due now" : "Rent due Saturday, 09:00"}</p>
              {MISSIONS[snap.missionIndex] ? (
                <p className="text-accent text-sm">
                  {MISSIONS[snap.missionIndex].title}: {MISSIONS[snap.missionIndex].steps[snap.missionStep]}
                </p>
              ) : (
                <p className="text-accent text-sm">Saturday list complete</p>
              )}
              {snap.dest ? <p className="text-muted text-xs">On the way to {snap.dest.name}</p> : null}
              <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1">
                {NEED_KEYS.map((key) => (
                  <Bar key={key} label={NEED_LABEL[key]} value={snap.needs[key]} />
                ))}
              </div>
            </div>
            <div className="flex max-w-sm flex-wrap gap-2">
              <button type="button" className="bg-surface text-fg min-h-11 rounded-xl px-3 text-sm" onClick={() => setPhone("life")}>
                Life
              </button>
              <button type="button" className="bg-surface text-fg min-h-11 rounded-xl px-3 text-sm" onClick={() => setPhone("jobs")}>
                Jobs
              </button>
              <button type="button" className="bg-surface text-fg min-h-11 rounded-xl px-3 text-sm" onClick={() => setPhone("wallet")}>
                Wallet
              </button>
              <button type="button" className="bg-bg text-fg min-h-11 rounded-xl px-3 text-sm" onClick={toggleNepa}>
                NEPA {snap.nepa ? "on" : "off"}
              </button>
              <button type="button" className="bg-bg text-fg min-h-11 rounded-xl px-3 text-sm" onClick={toggleHighRoad}>
                High Road {snap.highRoad ? "on" : "off"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-3">
          <div className="pointer-events-auto md:hidden">
            <Stick />
          </div>
          <div className="pointer-events-auto flex flex-1 flex-col items-center gap-2">
            {snap.toast ? <p className="bg-surface text-fg max-w-xs rounded-2xl px-3 py-2 text-center text-sm">{snap.toast}</p> : null}
            {prompt ? (
              <button type="button" className="bg-accent text-bg min-h-11 rounded-full px-5 text-sm font-medium" onClick={tryInteract}>
                {prompt}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {go ? (
        <div className="bg-bg/70 absolute inset-0 z-10 flex items-end justify-center p-3">
          <div className="bg-surface w-full max-w-md rounded-3xl p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl">Go</h2>
              <button type="button" className="bg-bg min-h-11 rounded-xl px-3 text-sm" onClick={() => setGo(false)}>
                Close
              </button>
            </div>
            <p className="text-muted mt-1 text-sm">Pick a stop. You walk there. A shop or hall opens when you arrive.</p>
            <div className="mt-3 grid gap-2">
              {stops.map((stop) => (
                <button
                  key={stop.name}
                  type="button"
                  className="bg-bg min-h-11 rounded-xl px-3 text-left text-sm"
                  onClick={() => {
                    setDestination(stop);
                    setGo(false);
                    setPanels(false);
                  }}
                >
                  {stop.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {snap.interior ? (
        <Interior kind={snap.interior} ownsRoom={snap.ownsRoom} toast={snap.toast} />
      ) : null}

      {snap.phone ? (
        <div className="bg-bg/70 absolute inset-0 flex items-end justify-center p-3 sm:items-center">
          <div className={`bg-surface max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-3xl p-4`}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl">
                {snap.phone === "life" ? "Life" : snap.phone === "jobs" ? "Jobs" : "Wallet"}
              </h2>
              <button type="button" className="bg-bg text-fg min-h-11 rounded-xl px-3 text-sm" onClick={() => setPhone(snap.phone)}>
                Close
              </button>
            </div>
            {snap.phone === "life" ? (
              <ol className="mt-4 grid gap-2">
                {MISSIONS.map((mission, index) => {
                  const state = index < snap.missionIndex ? "Done" : index === snap.missionIndex ? "Now" : "Later";
                  return (
                    <li key={mission.id} className="bg-bg rounded-xl px-3 py-2">
                      <p className="text-fg text-sm">
                        {state} · {mission.title}
                      </p>
                      <p className="text-muted text-xs">{mission.brief}</p>
                    </li>
                  );
                })}
              </ol>
            ) : snap.phone === "jobs" ? (
              <div className="mt-4">
                <p className="text-fg text-base">Shop assistant</p>
                <p className="text-muted mt-1 text-sm">Stay by the shop for 20 seconds. The list gains 30 game vouchers once.</p>
                {snap.job === "none" ? (
                  <button type="button" className="bg-accent text-bg mt-4 min-h-11 rounded-full px-4 text-sm" onClick={acceptJob}>
                    Take the shift
                  </button>
                ) : (
                  <p className="text-fg mt-4 text-sm">
                    {snap.job === "accepted" && "Accepted. Walk to the shop door and act."}
                    {snap.job === "working" && "Shift in progress. Stay at the door."}
                    {snap.job === "done" && "This shift is finished."}
                  </p>
                )}
              </div>
            ) : (
              <ul className="mt-4 grid gap-2">
                {snap.ledger.map((row) => (
                  <li key={row.id} className="bg-bg flex items-baseline justify-between gap-3 rounded-xl px-3 py-2">
                    <span className="text-fg text-sm">{row.label}</span>
                    <span className="text-accent text-sm">
                      {row.delta > 0 ? "+" : ""}
                      {row.delta} game vouchers
                    </span>
                  </li>
                ))}
                <li className="text-muted px-1 text-xs">List total {vouchers(snap)}. History only.</li>
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
