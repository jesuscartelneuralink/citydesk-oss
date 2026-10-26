// NDU-FP (FPXR-08/11/12/13/14): the first-person controller. Lazy-loaded by CityBuildings only when fpAllowed().
// Owns the map camera (cameraOwner "handoff" -> "fp") while the person bubble reads "1"; follow.ts, dragTurn.ts
// and mapPerf.ts stand down through fpOwns(). Exit restores every map setting it changed.
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import { readRun, readTurnFp, setProbeKeys } from "@/game/input";
import { claimCamera, releaseCamera, setFpPitchCap } from "@/world/orbit/cameraOwner";
import { publishView } from "@/world/orbit/cameraBus";
import { getPerson, recenter, setPerson } from "@/world/orbit/followBus";
import { prefersReducedMotion, wrap180 } from "@/world/orbit/orbitCore";
import { STREET_MAX_ZOOM, streetEnabled } from "@/world/orbit/streetCam";
import { getTier, onTier } from "@/world/perf/tier";
import { groundElevation } from "@/world/immerse/terrain";
import { tappableBuildingLayers } from "@/world/realism/layers";
import { getSharedAudioContext } from "@/world/workverse/audio";
import { setListenerYaw } from "@/world/immerse/sound";
import { SpatialBus, poolSize, type VehicleKind } from "@/world/audio/spatial";
import { effectiveBob, fpPrefs, onFpPrefs } from "./flag";
import { newFrameState, gaitTick, viewOf, type FrameState } from "./frame";
import { Handoff, spriteOpacity, thirdPose, type Pose } from "./handoff";
import { easeLimits, mapPitchCap, pitchLimits, type Limits } from "./limits";
import { LookMixer } from "./lookMixer";
import { OneEuro, unwrapDeg } from "./oneEuro";
import { fpCamera, M_PER_DEG, type PostureId } from "./rig";
import { FootprintIndex, refreshFromMap } from "./footprints";
import { rampVignette, vignetteStrength } from "./comfort";
import { attachMouseLook } from "./look/mouse";
import { readPad } from "./look/pad";
import { attachTouchLook, touchDegPerPx } from "./look/touch";
import { disableGyro, enableGyro, gyroSample } from "./look/gyro";
import { mountOverlay } from "./overlay";
import { playStep } from "./footsteps";

export type FpActor = { id: string; lng: number; lat: number; kind: VehicleKind };
export type FpHandle = {
  enter(): void;
  exit(reason?: string): void;
  active(): boolean;
  stepMetres(dt: number, kind: string, move: { x: number; y: number }): number;
  posture(p: PostureId): void;
  feedActors(list: FpActor[]): void;
  dispose(): void;
};
export type FpState = {
  active: boolean;
  phase: "off" | "entering" | "active" | "leaving";
  eye: { lng: number; lat: number; altM: number };
  groundM: number;
  eyeAboveGroundM: number;
  yawDeg: number;
  pitchUpDeg: number;
  mapPitch: number;
  vFovDeg: number;
  speedMps: number;
  gait: "idle" | "walk" | "jog";
  stepPhase: number;
  posture: PostureId;
  avatar: { lng: number; lat: number };
  look: { mouse: boolean; touch: boolean; gyro: "off" | "relative"; pad: boolean };
};

let singleton: FpHandle | null = null;
export const fpHandle = () => singleton;
export const fpActive = () => Boolean(singleton?.active());

type AnyMap = MapLibreMap & {
  getCenterClampedToGround?: () => boolean;
  setCenterClampedToGround?: (b: boolean) => void;
  getSky?: () => unknown;
  setSky?: (s: unknown) => void;
};
const FP_EV = { nduFp: true };

export function attachFirstPerson(map: MapLibreMap, player: MapLibreMarker, _ml?: unknown): FpHandle {
  const m = map as AnyMap;
  const container = map.getContainer();
  const canvas = map.getCanvas();
  const coarse = Boolean(window.matchMedia?.("(pointer: coarse)").matches);
  const overlay = mountOverlay(container, coarse);
  let reduced = prefersReducedMotion();
  const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const onPref = () => (reduced = Boolean(mq?.matches));
  mq?.addEventListener?.("change", onPref);

  let phase: FpState["phase"] = "off";
  let st: FrameState = newFrameState(player.getLngLat(), map.getBearing(), 0);
  let postureId: PostureId = fpPrefs().posture;
  const mixer = new LookMixer();
  const handoff = new Handoff();
  const fpIdx = new FootprintIndex();
  let idxAt: { lng: number; lat: number } | null = null;
  let limits: Limits = pitchLimits(getTier().tier);
  let raf = 0;
  let last = 0;
  let lastKind = "residential";
  let locked = false;
  let shownVig = 0;
  let lastYaw = 0;
  let lastSpeed = 0;
  let turnHeld = 0;
  let zoomScale: number | null = null;
  const lastCam = { cx: 0, cy: 0, z: 0, p: 0, b: 0, e: 0, r: 0, f: 0 };
  const gyroYawF = new OneEuro();
  const gyroPitchF = new OneEuro();
  let gyroPrevYaw: number | null = null;
  let spatial: SpatialBus | null = null;
  let actors: FpActor[] = [];
  let saved: { minPitch: number; maxPitch: number; maxZoom: number; clamp: boolean | undefined; fov: number; sky: unknown; dragPan: boolean; scroll: boolean; touch: boolean; keyboard: boolean; dblclick: boolean } | null = null;
  const detachLook: Array<() => void> = [];
  let quiet = 0; // >0 while our own setters run: their synchronous movestart events are not external moves
  const hush = <T,>(fn: () => T): T => {
    quiet += 1;
    try {
      return fn();
    } finally {
      quiet -= 1;
    }
  };

  const viewport = () => ({ w: container.clientWidth || 390, h: container.clientHeight || 844 });
  const groundAt = (lng: number, lat: number) => {
    if (getTier().tier !== "A") return 0;
    const g = groundElevation(m as never, lng, lat);
    return Number.isFinite(g) ? g : 0;
  };
  const streetView = () => ({
    height: viewport().h,
    fov: saved?.fov ?? map.getVerticalFieldOfView(),
    maxPitch: saved?.maxPitch ?? map.getMaxPitch(),
    maxZoom: Math.max(saved?.maxZoom ?? map.getMaxZoom(), STREET_MAX_ZOOM),
    street: streetEnabled(),
    person: "third" as const,
  });
  const fpPose = (): Pose => ({ lng: st.eye.lng, lat: st.eye.lat, altM: st.eye.altM, yawDeg: st.yaw, pitchUpDeg: st.pitchUp, vFovDeg: st.vFov });
  const inputs = (pos: { lng: number; lat: number }) => {
    const p = fpPrefs();
    return {
      move: { x: 0, y: 0 },
      run: false,
      kind: lastKind,
      groundM: groundAt(pos.lng, pos.lat),
      prefs: { statureM: p.statureM, bob: effectiveBob(p, reduced), hFovDeg: p.hFovDeg },
      viewport: viewport(),
      reduced,
      tier: getTier().tier,
      pos,
    };
  };
  const applyCap = (l: Limits) => {
    const cap = { min: 90 + l.min, max: 90 + l.max };
    setFpPitchCap(cap);
    hush(() => {
      try {
        map.setMinPitch(cap.min);
        map.setMaxPitch(cap.max);
      } catch {
        // style reload
      }
    });
  };
  const setSky = (on: boolean) => {
    try {
      if (!m.setSky) return;
      if (on && getTier().tier !== "A") m.setSky({ ...((saved?.sky as object) ?? {}), "fog-ground-blend": 0.6, "horizon-fog-blend": 0.4 });
      else if (!on && saved) m.setSky((saved.sky as object) ?? {});
    } catch {
      // style without sky support
    }
  };

  const save = () => {
    saved = {
      minPitch: map.getMinPitch(),
      maxPitch: map.getMaxPitch(),
      maxZoom: map.getMaxZoom(),
      clamp: m.getCenterClampedToGround?.(),
      fov: map.getVerticalFieldOfView(),
      sky: m.getSky?.(),
      dragPan: map.dragPan.isEnabled(),
      scroll: map.scrollZoom.isEnabled(),
      touch: map.touchZoomRotate.isEnabled(),
      keyboard: map.keyboard.isEnabled(),
      dblclick: map.doubleClickZoom.isEnabled(),
    };
  };
  const restore = () => hush(restoreRaw);
  const restoreRaw = () => {
    if (!saved) return;
    const s = saved;
    try {
      map.setMinPitch(s.minPitch);
      map.setMaxPitch(s.maxPitch);
      map.setMaxZoom(s.maxZoom);
      if (s.clamp !== undefined) m.setCenterClampedToGround?.(s.clamp);
      map.setVerticalFieldOfView(s.fov);
      if (s.dragPan) map.dragPan.enable();
      if (s.scroll) map.scrollZoom.enable();
      if (s.touch) map.touchZoomRotate.enable();
      if (s.keyboard) map.keyboard.enable();
      if (s.dblclick) map.doubleClickZoom.enable();
      map.jumpTo({ roll: 0 } as never, FP_EV);
    } catch {
      // style reload
    }
    setSky(false);
    saved = null;
  };

  const startLook = () => {
    detachLook.push(
      attachMouseLook(canvas, (dx, dy) => {
        const p = fpPrefs();
        mixer.applyMouse(dx, dy, p);
      }, (l) => {
        locked = l;
        overlay.hint(l ? null : coarse ? null : "Click to look · Esc to release");
      }),
    );
    detachLook.push(
      attachTouchLook(container, () => touchDegPerPx(st.vFov, viewport().h, fpPrefs().touchScale), (dy, dp) => mixer.applyDeg(dy, dp), (s) => (zoomScale = s)),
    );
    if (fpPrefs().gyro) void enableGyro();
    detachLook.push(onFpPrefs((p) => (p.gyro ? undefined : (mixer.gyroOff(), disableGyro()))));
  };
  const stopLook = () => {
    detachLook.splice(0).forEach((f) => f());
    disableGyro();
    mixer.gyroOff();
    locked = false;
  };

  const writeCam = (cam: { center: [number, number]; zoom: number; pitch: number; bearing: number; roll: number; elevation: number }, fov: number) => {
    const c = lastCam;
    // self-heal: another module (a re-attached follow lens, a style reload) may reset these under us
    const drift =
      Math.abs(map.getVerticalFieldOfView() - fov) > 0.05 ||
      map.getMaxZoom() < 24 ||
      m.getCenterClampedToGround?.() === true ||
      Math.abs(map.getPitch() - c.p) > 0.01 ||
      Math.abs(map.getZoom() - c.z) > 1e-4 ||
      Math.abs(wrap180(map.getBearing() - c.b)) > 0.01;
    if (drift)
      hush(() => {
        try {
          if (map.getMaxZoom() < 24) map.setMaxZoom(24);
          if (m.getCenterClampedToGround?.() === true) m.setCenterClampedToGround?.(false);
        } catch {
          // style reload
        }
      });
    if (!drift && c.cx === cam.center[0] && c.cy === cam.center[1] && c.z === cam.zoom && c.p === cam.pitch && c.b === cam.bearing && c.e === cam.elevation && c.r === cam.roll && c.f === fov) return;
    c.cx = cam.center[0]; c.cy = cam.center[1]; c.z = cam.zoom; c.p = cam.pitch; c.b = cam.bearing; c.e = cam.elevation; c.r = cam.roll; c.f = fov;
    quiet += 1;
    try {
      if (Math.abs(map.getVerticalFieldOfView() - fov) > 0.05) map.setVerticalFieldOfView(fov);
      map.jumpTo({ center: cam.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing, roll: cam.roll, elevation: cam.elevation } as never, FP_EV);
      publishView({ bearing: cam.bearing, pitch: cam.pitch });
    } catch {
      // style reload: next frame
    } finally {
      quiet -= 1;
    }
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.1, Math.max(0, (now - last) / 1000)) : 1 / 60;
    last = now;
    const prefs = fpPrefs();
    // look sources
    const pad = readPad();
    if (pad) mixer.applyPad(pad.rx, pad.ry, dt);
    const turn = readTurnFp();
    if (prefs.snapTurnDeg) {
      if (turn && turn !== turnHeld) mixer.applyTurn(turn, dt, prefs.snapTurnDeg);
    } else mixer.applyTurn(turn, dt);
    turnHeld = turn;
    const g = prefs.gyro ? gyroSample() : null;
    if (g) {
      gyroPrevYaw = unwrapDeg(gyroPrevYaw, g.yaw);
      mixer.setGyro(gyroYawF.filter(gyroPrevYaw, now / 1000), gyroPitchF.filter(g.pitch, now / 1000));
    }
    // tier caps ease over 300 ms
    const want = pitchLimits(getTier().tier);
    if (want.min !== limits.min || want.max !== limits.max) {
      limits = easeLimits(limits, want, dt);
      applyCap(limits);
    }
    mixer.setLimits(limits);
    const look = mixer.output(limits);
    st.yaw = look.yaw;
    st.pitchUp = look.pitchUp;
    st.posture = postureId === "stand" && prefs.posture === "wheelchair" ? "wheelchair" : postureId;
    // avatar + walls
    const at = player.getLngLat();
    if (!idxAt || Math.hypot((at.lng - idxAt.lng) * M_PER_DEG * Math.cos((at.lat * Math.PI) / 180), (at.lat - idxAt.lat) * M_PER_DEG) > (getTier().tier === "C" ? 80 : 50)) {
      idxAt = { lng: at.lng, lat: at.lat };
      const run = () => refreshFromMap(fpIdx, m as never, tappableBuildingLayers(m as never), at);
      const ric = (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback;
      if (ric) ric(run);
      else window.setTimeout(run, 0);
    }
    const pos = fpIdx.size ? fpIdx.pushOut(at.lng, at.lat, 0.25) : { lng: at.lng, lat: at.lat };
    const inp = inputs(pos);
    let cam = viewOf(st, inp, dt);
    let fov = st.vFov;
    if (zoomScale !== null) {
      // binocular pinch: narrower lens only, the eye never moves
      fov = Math.max(30, Math.min(st.vFov, st.vFov / Math.max(1, zoomScale)));
      cam = fpCamera(st.eye, st.yaw, st.pitchUp, fov, inp.viewport.h);
    }
    if (phase === "entering" || phase === "leaving") {
      const r = handoff.step(dt * 1000);
      const p = r.pose;
      fov = p.vFovDeg;
      cam = fpCamera({ lng: p.lng, lat: p.lat, altM: p.altM }, p.yawDeg, p.pitchUpDeg, fov, inp.viewport.h);
      const op = phase === "entering" ? spriteOpacity(r.t) : spriteOpacity(1 - r.t);
      player.getElement().style.opacity = String(op);
      player.getElement().style.visibility = op <= 0 ? "hidden" : "";
      if (r.done) {
        if (reduced) overlay.fade(false);
        if (phase === "entering") {
          phase = "active";
          claimCamera("fp");
        } else {
          writeCam(cam, fov);
          finishExit();
          return;
        }
      }
    }
    writeCam(cam, fov);
    // comfort
    const angVel = dt > 0 ? wrap180(st.yaw - lastYaw) / dt : 0;
    const acc = dt > 0 ? (st.gait.speed - lastSpeed) / dt : 0;
    lastYaw = st.yaw;
    lastSpeed = st.gait.speed;
    const target = reduced ? 0 : vignetteStrength(angVel, acc, prefs.vignette);
    shownVig = rampVignette(shownVig, target, dt);
    overlay.setVignette(shownVig);
    overlay.setReticle(prefs.reticle || locked);
    // spatial audio
    setListenerYaw(st.yaw);
    if (spatial && spatial.due(now)) {
      spatial.setListener(st.yaw, st.pitchUp);
      const live = new Set<string>();
      const cos = Math.cos((st.eye.lat * Math.PI) / 180);
      const near = actors
        .map((a) => ({ a, e: (a.lng - st.eye.lng) * M_PER_DEG * cos, n: (a.lat - st.eye.lat) * M_PER_DEG }))
        .filter((x) => Math.hypot(x.e, x.n) < 60)
        .sort((x, y) => Math.hypot(x.e, x.n) - Math.hypot(y.e, y.n))
        .slice(0, poolSize(getTier().tier));
      for (const x of near) {
        live.add(x.a.id);
        spatial.upsert(x.a.id, { e: x.e, n: x.n, u: -st.eye.altM + inp.groundM + 0.8 }, x.a.kind);
      }
      spatial.prune(live);
    }
  };

  const finishExit = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    phase = "off";
    stopLook();
    overlay.show(false);
    player.getElement().style.opacity = "";
    player.getElement().style.visibility = "";
    spatial?.dispose();
    spatial = null;
    restore();
    setFpPitchCap(null);
    releaseCamera("fp");
    releaseCamera("handoff");
    recenter();
  };

  const enter = () => {
    if (phase === "entering" || phase === "active") return;
    if (phase === "leaving") {
      phase = "entering";
      handoff.reverse(fpPose);
      return;
    }
    save();
    const at = player.getLngLat();
    const g0 = groundAt(at.lng, at.lat);
    const prefs = fpPrefs();
    st = newFrameState(at, map.getBearing(), g0, postureId === "stand" && prefs.posture === "wheelchair" ? "wheelchair" : postureId, prefs.statureM);
    mixer.set(map.getBearing(), -6);
    limits = pitchLimits(getTier().tier);
    gyroPrevYaw = null;
    gyroYawF.reset();
    gyroPitchF.reset();
    claimCamera("handoff");
    applyCap(limits);
    quiet += 1;
    try {
      m.setCenterClampedToGround?.(false);
      map.setMaxZoom(24);
      map.dragPan.disable();
      map.scrollZoom.disable();
      map.touchZoomRotate.disable();
      map.keyboard.disable();
      map.doubleClickZoom.disable();
    } catch {
      // style reload
    } finally {
      quiet -= 1;
    }
    setSky(true);
    viewOf(st, inputs(at), 1 / 60); // settle the FP eye before blending toward it
    const from = thirdPose(at, map.getBearing(), streetView(), g0);
    from.vFovDeg = map.getVerticalFieldOfView();
    if (reduced) overlay.fade(true);
    handoff.start(from, fpPose, 650, reduced);
    phase = "entering";
    overlay.show(true);
    overlay.hint(coarse ? null : "Click to look · Esc to release");
    startLook();
    const ctx = getSharedAudioContext();
    const n = poolSize(getTier().tier);
    if (ctx && n > 0) {
      try {
        spatial = new SpatialBus(ctx, n);
      } catch {
        spatial = null;
      }
    }
    last = 0;
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const exit = (reason?: string) => {
    if (phase === "off" || phase === "leaving") return;
    if (reason === "external-move" || reason === "dispose") {
      finishExit();
      return;
    }
    claimCamera("handoff");
    const at = player.getLngLat();
    const to = () => thirdPose(player.getLngLat(), wrap180(st.yaw), streetView(), groundAt(at.lng, at.lat));
    if (phase === "entering") handoff.reverse(to);
    else {
      if (reduced) overlay.fade(true);
      handoff.start(fpPose(), to, 650, reduced);
    }
    phase = "leaving";
  };

  // External code moves (a relocation, a search fly-to) do not end first person: the next frame puts the
  // eye back on the avatar (writeCam sees the drift), so the only ways out are the person bubble or dispose.
  const onEnter = () => enter();
  const onExit = () => exit("person");
  const onRecenter = () => {
    if (phase === "active") mixer.set(mixer.yaw, -6);
  };
  const onSettings = () => overlay.openSettings();
  window.addEventListener("ndu:fp-enter", onEnter);
  window.addEventListener("ndu:fp-exit", onExit);
  window.addEventListener("ndu:fp-recenter", onRecenter);
  window.addEventListener("ndu:fp-settings", onSettings);
  const offTier = onTier(() => {
    if (phase !== "off") setSky(true);
  });

  const handle: FpHandle = {
    enter,
    exit,
    active: () => phase !== "off",
    stepMetres: (dt, kind, move) => {
      lastKind = kind || lastKind;
      const r = gaitTick(st, dt, move, readRun(), kind, fpPrefs().statureM);
      for (const foot of r.steps) playStep(foot, kind, st.gait.speed, fpPrefs().footsteps);
      return r.metres;
    },
    posture: (p) => {
      postureId = p;
    },
    feedActors: (list) => {
      actors = list;
    },
    dispose: () => {
      exit("dispose");
        window.removeEventListener("ndu:fp-enter", onEnter);
      window.removeEventListener("ndu:fp-exit", onExit);
      window.removeEventListener("ndu:fp-recenter", onRecenter);
      window.removeEventListener("ndu:fp-settings", onSettings);
      mq?.removeEventListener?.("change", onPref);
      offTier();
      overlay.dispose();
      if (singleton === handle) singleton = null;
      delete (window as Window & { __nduFp?: unknown }).__nduFp;
    },
  };
  singleton = handle;

  // read-only QA handle (fp-smoke.mjs)
  (window as Window & { __nduFp?: unknown }).__nduFp = {
    state: (): FpState => {
      const s = st;
      const sp = s.gait.speed;
      return {
        active: phase !== "off",
        phase,
        eye: { ...s.eye },
        groundM: s.ground.y,
        eyeAboveGroundM: s.eye.altM - s.ground.y,
        yawDeg: s.yaw,
        pitchUpDeg: s.pitchUp,
        mapPitch: map.getPitch(),
        vFovDeg: map.getVerticalFieldOfView(),
        speedMps: sp,
        gait: sp < 0.05 ? "idle" : sp > 2 ? "jog" : "walk",
        stepPhase: s.gait.phase,
        posture: s.posture,
        avatar: (({ lng, lat }) => ({ lng, lat }))(player.getLngLat()),
        look: { mouse: locked, touch: coarse, gyro: fpPrefs().gyro ? "relative" : "off", pad: Boolean(readPad()) },
      };
    },
    look: { mouseDelta: (dx: number, dy: number) => mixer.applyMouse(dx, dy, fpPrefs()) },
    probeKeys: (codes: string[]) => setProbeKeys(codes),
    lastCam: () => ({ ...lastCam }),
    mapPitchCap,
  };

  // a saved "first" re-enters on mount (the soft switch was already checked by fpAllowed)
  if (getPerson() === "first") window.setTimeout(enter, 0);
  return handle;
}
