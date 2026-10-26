import React, { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ToyFigure } from "./ToyFigure";
import { clampToWalkable, isWalkable } from "./nav";
import { useWorkverseStore } from "./store";
import { getWorkverseLayout } from "./layout";
import { WORKVERSE_PALETTE } from "./palette";
import { readPortrait, onPortrait } from "@/world/address/portrait";
import { playFootstep } from "./audio";

// Shared mutable player transform for zero-allocation 60fps tracking by WorkverseCamera
export const workversePlayerState = {
  x: 0,
  y: 0,
  z: 1.5,
  heading: 0,
  moving: false,
  running: false,
};

// Target point for click-to-walk requests
let pendingWalkTarget: { x: number; z: number } | null = null;

export const virtualThumbstick = { dx: 0, dz: 0 };
export const virtualActionTriggered = { jump: false, interact: false };

export function triggerVirtualAction(action: 'jump' | 'interact') {
  if (action === 'jump') virtualActionTriggered.jump = true;
  if (action === 'interact') virtualActionTriggered.interact = true;
}

export function requestPlayerWalkTo(x: number, z: number) {
  pendingWalkTarget = { x, z };
}

export function resetPlayerPosition(x = 0, y = 0, z = 1.5, heading = 0) {
  workversePlayerState.x = x;
  workversePlayerState.y = y;
  workversePlayerState.z = z;
  workversePlayerState.heading = heading;
  workversePlayerState.moving = false;
  pendingWalkTarget = null;
}

const PLAYER_WALK_SPEED = 2.4; // m/s
const PLAYER_SPRINT_SPEED = 4.8; // m/s
const INTERACT_RANGE = 2.2; // metres

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

function ownsKeyboard(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!target.closest("[role='dialog']");
}

export function WorkversePlayer({
  initialPosition,
  initialPos,
  onPositionChange,
  onInteractElevator,
}: {
  initialPosition?: [number, number, number];
  initialPos?: [number, number, number] | number[];
  onPositionChange?: (pos: [number, number, number]) => void;
  onInteractElevator?: () => void;
}) {
  const initP: [number, number, number] = (initialPosition || (initialPos as [number, number, number]) || [0, 0, 1.5]);
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);

  const { currentFloor, selectAgent, triggerCameraDive } = useWorkverseStore();
  const layout = useMemo(() => getWorkverseLayout(currentFloor), [currentFloor]);

  // Movement input tracking
  const pressedKeys = useRef<Set<string>>(new Set());
  const isShiftHeld = useRef(false);

  // Jump physics state
  const jumpProgress = useRef<number | null>(null);
  const stepAccumulator = useRef<number>(0);

  // Local state for UI prompt
  const [promptText, setPromptText] = useState<string | null>(null);
  const promptRef = useRef<string | null>(null); // NDU-UPG collide
  const nearbyInteractableRef = useRef<{
    type: "agent" | "elevator" | "spawn";
    id: string;
    label: string;
    pos: [number, number, number];
  } | null>(null);

  useEffect(() => {
    resetPlayerPosition(initP[0], initP[1], initP[2]);
  }, [initP[0], initP[1], initP[2]]);

  // Keyboard listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (ownsKeyboard(e.target)) return;

      if (e.code in MOVE_KEYS) {
        pressedKeys.current.add(e.code);
        pendingWalkTarget = null; // keyboard input cancels click-to-walk
        e.preventDefault();
      } else if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
        isShiftHeld.current = true;
      } else if (e.code === "Space") {
        if (jumpProgress.current === null) {
          jumpProgress.current = 0;
        }
        e.preventDefault();
      } else if (e.code === "KeyE") {
        // Interact key pressed
        const nearby = nearbyInteractableRef.current;
        if (nearby) {
          if (nearby.type === "agent") {
            selectAgent(nearby.id);
            // Dive camera slightly toward the agent's desk
            triggerCameraDive([nearby.pos[0], nearby.pos[1] + 1.1, nearby.pos[2]], `pane:council:${nearby.id}`);
          } else if (nearby.type === "elevator") {
            onInteractElevator?.();
          }
        }
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      pressedKeys.current.delete(e.code);
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
        isShiftHeld.current = false;
      }
    };

    const handleBlur = () => {
      pressedKeys.current.clear();
      isShiftHeld.current = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [selectAgent, triggerCameraDive, onInteractElevator]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const speed = (isShiftHeld.current ? PLAYER_SPRINT_SPEED : PLAYER_WALK_SPEED);

    let moveX = 0;
    let moveZ = 0;

    // 1. Check keyboard WASD/arrows movement (camera-relative)
    let rawIx = 0;
    let rawIz = 0;
    for (const code of pressedKeys.current) {
      const vec = MOVE_KEYS[code];
      if (vec) {
        rawIx += vec[0];
        rawIz += vec[1];
      }
    }
    
    // Add virtual thumbstick (clamp magnitude to 1)
    if (virtualThumbstick.dx !== 0 || virtualThumbstick.dz !== 0) {
      rawIx += virtualThumbstick.dx;
      rawIz += virtualThumbstick.dz;
    }
    
    // Check virtual actions
    if (virtualActionTriggered.jump) {
      if (jumpProgress.current === null) {
        jumpProgress.current = 0;
      }
      virtualActionTriggered.jump = false;
    }
    
    if (virtualActionTriggered.interact) {
      const nearby = nearbyInteractableRef.current;
      if (nearby) {
        if (nearby.type === "agent") {
          selectAgent(nearby.id);
          triggerCameraDive([nearby.pos[0], nearby.pos[1] + 1.1, nearby.pos[2]], `pane:council:${nearby.id}`);
        } else if (nearby.type === "elevator") {
          onInteractElevator?.();
        }
      }
      virtualActionTriggered.interact = false;
    }

    if (rawIx !== 0 || rawIz !== 0) {
      // Calculate camera horizontal forward vector
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() < 1e-5) forward.set(0, 0, -1);
      forward.normalize();

      // Right vector is perpendicular to forward in XZ plane (forward × up)
      // forward = (fx, 0, fz) => right = (-fz, 0, fx)
      const rx = -forward.z;
      const rz = forward.x;

      // Camera-relative direction:
      // rawIx: A=-1, D=+1 => -rx / +rx
      // rawIz: S=-1, W=+1 => -forward / +forward
      const dirX = forward.x * rawIz + rx * rawIx;
      const dirZ = forward.z * rawIz + rz * rawIx;
      const len = Math.hypot(dirX, dirZ);

      if (len > 1e-4) {
        moveX = (dirX / len) * speed * dt;
        moveZ = (dirZ / len) * speed * dt;
      }
    } else if (pendingWalkTarget) {
      // 2. Click-to-walk steering
      const toX = pendingWalkTarget.x - workversePlayerState.x;
      const toZ = pendingWalkTarget.z - workversePlayerState.z;
      const dist = Math.hypot(toX, toZ);

      if (dist < 0.15) {
        pendingWalkTarget = null;
      } else {
        const step = Math.min(dist, speed * dt);
        moveX = (toX / dist) * step;
        moveZ = (toZ / dist) * step;
      }
    }

    if (!isWalkable(workversePlayerState.x, workversePlayerState.z, 0.2)) resetPlayerPosition(0, 0, 1.5);
    // Apply movement with obstacle collision clamping
    const isMoving = Math.abs(moveX) > 1e-5 || Math.abs(moveZ) > 1e-5;
    if (isMoving) {
      const [nextX, nextZ] = clampToWalkable(
        workversePlayerState.x,
        workversePlayerState.z,
        workversePlayerState.x + moveX,
        workversePlayerState.z + moveZ,
        0.35,
      );

      workversePlayerState.x = nextX;
      workversePlayerState.z = nextZ;

      // Smooth heading angle update
      const targetHeading = Math.atan2(moveX, moveZ);
      let angleDiff = targetHeading - workversePlayerState.heading;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      workversePlayerState.heading += angleDiff * Math.min(1, 14 * dt);
    }

    workversePlayerState.moving = isMoving;
    workversePlayerState.running = isShiftHeld.current && isMoving;

    // Procedural footstep audio interval
    if (isMoving) {
      stepAccumulator.current += dt;
      const stepInterval = isShiftHeld.current ? 0.22 : 0.36;
      if (stepAccumulator.current >= stepInterval) {
        stepAccumulator.current = 0;
        playFootstep("wood");
      }
    } else {
      stepAccumulator.current = 0;
    }

    // Jump parabola update
    let jumpY = 0;
    if (jumpProgress.current !== null) {
      jumpProgress.current += dt * 3.8;
      if (jumpProgress.current >= 1) {
        jumpProgress.current = null;
      } else {
        jumpY = Math.sin(jumpProgress.current * Math.PI) * 0.42;
      }
    }
    workversePlayerState.y = jumpY;

    // Update 3D mesh transforms
    if (groupRef.current) {
      groupRef.current.position.set(workversePlayerState.x, workversePlayerState.y, workversePlayerState.z);
      groupRef.current.rotation.y = workversePlayerState.heading;
      if (isMoving && onPositionChange) {
        onPositionChange([workversePlayerState.x, workversePlayerState.y, workversePlayerState.z]);
      }
    }

    // Pulse floor ring
    if (ringRef.current) {
      const ringScale = isMoving ? 1.0 + Math.sin(performance.now() * 0.008) * 0.08 : 1.0;
      ringRef.current.scale.set(ringScale, ringScale, ringScale);
    }

    // Check nearest interactables
    let nearest: typeof nearbyInteractableRef.current = null;
    let minDistance = INTERACT_RANGE;

    // Check Council Desks
    for (const desk of layout.desks) {
      const d = Math.hypot(desk.x - workversePlayerState.x, desk.z - workversePlayerState.z);
      if (d < minDistance) {
        minDistance = d;
        nearest = {
          type: "agent",
          id: desk.memberId,
          label: `${desk.name} (${desk.department})`,
          pos: [desk.x, desk.y, desk.z],
        };
      }
    }

    // Check Elevator
    const elevatorDist = Math.hypot(layout.elevatorPoint[0] - workversePlayerState.x, layout.elevatorPoint[2] - workversePlayerState.z);
    if (elevatorDist < Math.min(minDistance, 2.5)) {
      minDistance = elevatorDist;
      nearest = {
        type: "elevator",
        id: "elevator",
        label: "Elevator · Change Floor",
        pos: layout.elevatorPoint,
      };
    }

    nearbyInteractableRef.current = nearest;
    // NDU-UPG collide: change-only (was a setState every frame)
    const nextPrompt = nearest ? `Press [E] to interact with ${nearest.label}` : null;
    if (promptRef.current !== nextPrompt) {
      promptRef.current = nextPrompt;
      setPromptText(nextPrompt);
    }
  });

  return (
    <>
      <group ref={groupRef}>
        {/* Pulsing Floor Ring beneath player feet */}
        <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.38, 0.48, 36]} />
          <meshBasicMaterial
            color={WORKVERSE_PALETTE.brassGlow}
            transparent
            opacity={0.8}
            side={THREE.DoubleSide}
          />
        </mesh>

        <FaceDisc />
        {/* Chibi Character Figure */}
        <ToyFigure
          id="player"
          name="Navigator"
          isPlayer={true}
          state={workversePlayerState.moving ? "working" : "idle"}
          position={[0, 0, 0]}
        />
      </group>

      {/* Floating HUD Interaction Prompt on bottom center if near an agent or elevator */}
      {promptText && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[700] pointer-events-none transition-all duration-200">
          <div className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-slate-950/85 border border-amber-400/80 text-amber-200 shadow-2xl backdrop-blur-md animate-bounce">
            <span className="w-5 h-5 flex items-center justify-center rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold border border-amber-400">
              E
            </span>
            <span className="text-sm font-medium">{promptText}</span>
          </div>
        </div>
      )}
    </>
  );
}

function FaceDisc() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(readPortrait());
    return onPortrait(() => setUrl(readPortrait()));
  }, []);
  const tex = useMemo(() => {
    if (!url) return null;
    const t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [url]);
  if (!tex) return null;
  return (
    <mesh position={[0, 1.35, 0.22]}>
      <circleGeometry args={[0.16, 24]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  );
}
