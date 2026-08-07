"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useTheme } from "@/components/theme-provider";

/**
 * Cited answers visual: an upright chat answer panel with text lines and
 * citation slots. Source cubes launch from a docs index stack, arc across,
 * and dock into the citation slots — retrieval receipts landing inline.
 */

const PANEL_ROT_Y = Math.PI / 4;
const PANEL_POS = new THREE.Vector3(0.85, 1.62, -0.25);
const PANEL_W = 2.7;
const PANEL_H = 3.1;
const PANEL_D = 0.12;

const STACK_POS = new THREE.Vector3(-2.05, 0, 1.15);
const STACK_LAYERS = 4;
const STACK_SIZE = 1.15;
const STACK_LAYER_H = 0.16;
const STACK_GAP = 0.1;

const FLYER_CYCLE = 7; // seconds per full loop per flyer

const COLORS = {
  light: {
    panel: "#ffffff",
    panelEdge: "#dbe3ea",
    line: "#c3ccd6",
    lineSoft: "#dee5ec",
    slot: "#c4a86e",
    slotIdle: "#d8cdb4",
    stack: ["#cdd6df", "#dbe3ea", "#c4a86e", "#eef2f6"],
    flyer: "#a88c5a",
    footer: "#9aa1a8",
    ring: "#a88c5a",
    plate: "#dde2e8",
  },
  dark: {
    panel: "#2a2728",
    panelEdge: "#3f3b3c",
    line: "#565152",
    lineSoft: "#454041",
    slot: "#c4a86e",
    slotIdle: "#6b6152",
    stack: ["#353132", "#3f3b3c", "#c4a86e", "#4a4647"],
    flyer: "#c4a86e",
    footer: "#5d5859",
    ring: "#c4a86e",
    plate: "#232122",
  },
};

/** Text line rows on the panel face, in panel-local coords. */
const TEXT_LINES: Array<{ y: number; width: number; cited: boolean }> = [
  { y: 1.12, width: 1.9, cited: false },
  { y: 0.78, width: 2.1, cited: true },
  { y: 0.44, width: 1.6, cited: false },
  { y: 0.1, width: 2.0, cited: true },
  { y: -0.24, width: 1.35, cited: false },
  { y: -0.58, width: 1.85, cited: true },
];

const CITED_LINES = TEXT_LINES.filter((line) => line.cited);

/** Panel-local position of the citation slot at the end of a cited line. */
function slotLocal(line: { y: number; width: number }): THREE.Vector3 {
  return new THREE.Vector3(-PANEL_W / 2 + 0.3 + line.width + 0.18, line.y, PANEL_D / 2 + 0.05);
}

/** Convert panel-local coords to world coords. */
function panelToWorld(local: THREE.Vector3): THREE.Vector3 {
  const v = local.clone();
  v.applyAxisAngle(new THREE.Vector3(0, 1, 0), PANEL_ROT_Y);
  v.add(PANEL_POS);
  return v;
}

function smoothstep(x: number) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** Flight progress for flyer i at time t: 0..1 while flying, -1 when idle. */
function flightProgress(t: number, index: number): number {
  const offset = (index * FLYER_CYCLE) / CITED_LINES.length;
  const local = ((t + offset) % FLYER_CYCLE) / FLYER_CYCLE;
  const flyWindow = 0.34;
  if (local > flyWindow) return -1;
  return local / flyWindow;
}

/** Dock pulse (0..1) right after a flyer arrives at slot i. */
function dockPulse(t: number, index: number): number {
  const offset = (index * FLYER_CYCLE) / CITED_LINES.length;
  const local = ((t + offset) % FLYER_CYCLE) / FLYER_CYCLE;
  const start = 0.34;
  const width = 0.2;
  if (local < start || local > start + width) return 0;
  const p = (local - start) / width;
  return Math.sin(p * Math.PI);
}

function AnswerPanel({ animate }: { animate: boolean }) {
  const { resolved } = useTheme();
  const palette = COLORS[resolved];
  const slotRefs = useRef<Array<THREE.MeshStandardMaterial | null>>([]);
  const slotColor = useMemo(() => new THREE.Color(palette.slot), [palette]);
  const slotIdle = useMemo(() => new THREE.Color(palette.slotIdle), [palette]);
  const work = useMemo(() => new THREE.Color(), []);

  useFrame((state) => {
    const t = animate ? state.clock.elapsedTime : 5;
    CITED_LINES.forEach((_, i) => {
      const mat = slotRefs.current[i];
      if (!mat) return;
      const pulse = dockPulse(t, i);
      work.copy(slotIdle).lerp(slotColor, 0.35 + pulse * 0.65);
      mat.color.copy(work);
      mat.emissive.copy(slotColor).multiplyScalar(pulse * 0.5);
    });
  });

  let citedIndex = -1;

  return (
    <group position={PANEL_POS} rotation={[0, PANEL_ROT_Y, 0]}>
      {/* panel body */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[PANEL_W, PANEL_H, PANEL_D]} />
        <meshStandardMaterial color={palette.panel} roughness={0.5} metalness={0.04} />
      </mesh>
      {/* header strip */}
      <mesh position={[0, PANEL_H / 2 - 0.18, PANEL_D / 2 + 0.02]}>
        <boxGeometry args={[PANEL_W - 0.3, 0.1, 0.03]} />
        <meshStandardMaterial color={palette.panelEdge} roughness={0.6} />
      </mesh>

      {/* text lines + citation slots */}
      {TEXT_LINES.map((line, i) => {
        if (line.cited) citedIndex += 1;
        const currentCited = citedIndex;
        return (
          <group key={i}>
            <mesh
              position={[
                -PANEL_W / 2 + 0.3 + line.width / 2,
                line.y,
                PANEL_D / 2 + 0.02,
              ]}
            >
              <boxGeometry args={[line.width, 0.09, 0.03]} />
              <meshStandardMaterial
                color={i % 2 === 0 ? palette.line : palette.lineSoft}
                roughness={0.65}
              />
            </mesh>
            {line.cited ? (
              <mesh position={slotLocal(line)}>
                <boxGeometry args={[0.2, 0.14, 0.1]} />
                <meshStandardMaterial
                  ref={(mat) => {
                    slotRefs.current[currentCited] = mat;
                  }}
                  roughness={0.4}
                  metalness={0.15}
                />
              </mesh>
            ) : null}
          </group>
        );
      })}

      {/* sources footer chips */}
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          position={[-PANEL_W / 2 + 0.42 + i * 0.62, -PANEL_H / 2 + 0.28, PANEL_D / 2 + 0.02]}
        >
          <boxGeometry args={[0.48, 0.12, 0.03]} />
          <meshStandardMaterial color={palette.footer} roughness={0.6} transparent opacity={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function DocsStack({ animate }: { animate: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const { resolved } = useTheme();
  const palette = COLORS[resolved];

  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    const t = animate ? state.clock.elapsedTime : 4;
    group.children.forEach((child, i) => {
      const dir = i % 2 === 0 ? 1 : -1;
      child.rotation.y = dir * t * (0.08 + i * 0.03);
    });
  });

  return (
    <group ref={groupRef} position={STACK_POS}>
      {palette.stack.map((hex, i) => {
        const shrink = 1 - i * 0.1;
        return (
          <mesh
            key={i}
            position={[0, i * (STACK_LAYER_H + STACK_GAP) + STACK_LAYER_H / 2, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry
              args={[STACK_SIZE * shrink, STACK_LAYER_H, STACK_SIZE * shrink]}
            />
            <meshStandardMaterial color={hex} roughness={0.48} metalness={0.06} />
          </mesh>
        );
      })}
    </group>
  );
}

function SourceFlyers({ animate }: { animate: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { resolved } = useTheme();
  const palette = COLORS[resolved];
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const flyerColor = useMemo(() => new THREE.Color(palette.flyer), [palette]);

  const launch = useMemo(
    () =>
      new THREE.Vector3(
        STACK_POS.x,
        STACK_LAYERS * (STACK_LAYER_H + STACK_GAP) + 0.15,
        STACK_POS.z,
      ),
    [],
  );
  const targets = useMemo(
    () => CITED_LINES.map((line) => panelToWorld(slotLocal(line))),
    [],
  );

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = animate ? state.clock.elapsedTime : 2.1;

    CITED_LINES.forEach((_, i) => {
      const p = flightProgress(t, i);
      if (p < 0) {
        dummy.position.set(0, -10, 0);
        dummy.scale.setScalar(0.001);
      } else {
        const eased = smoothstep(p);
        const target = targets[i];
        dummy.position.lerpVectors(launch, target, eased);
        // arc upward mid-flight
        dummy.position.y += Math.sin(eased * Math.PI) * 0.9;
        dummy.rotation.set(eased * Math.PI, eased * Math.PI * 1.5, 0);
        const scale = 0.16 * (1 - eased * 0.35);
        dummy.scale.setScalar(scale);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, flyerColor);
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, CITED_LINES.length]}
      castShadow
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.45} metalness={0.1} />
    </instancedMesh>
  );
}

function BasePlate() {
  const { resolved } = useTheme();
  const palette = COLORS[resolved];

  return (
    <group>
      <mesh position={[0, -0.07, 0]} receiveShadow>
        <cylinderGeometry args={[2.7, 2.85, 0.14, 48]} />
        <meshStandardMaterial color={palette.plate} roughness={0.7} metalness={0.03} />
      </mesh>
      <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.42, 2.45, 64]} />
        <meshBasicMaterial
          color={palette.ring}
          transparent
          opacity={0.22}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

function Scene({ animate }: { animate: boolean }) {
  return (
    <>
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#f4f5f7", "#8b9199", 0.4]} position={[0, 1, 0]} />
      <directionalLight
        position={[-5, 8, 6]}
        intensity={1.25}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[5, 3, -4]} intensity={0.2} />
      <BasePlate />
      <DocsStack animate={animate} />
      <AnswerPanel animate={animate} />
      <SourceFlyers animate={animate} />
    </>
  );
}

export function CitedChat3D({ className }: { className?: string }) {
  const [animate, setAnimate] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setAnimate(!media.matches);

    const onChange = () => setAnimate(!media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  if (!mounted) {
    return <div className={className} aria-hidden />;
  }

  return (
    <div
      className={className}
      role="img"
      aria-label="Source blocks flying from an index stack and docking as citations on a chat answer"
    >
      <Canvas
        className="size-full"
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        orthographic
        camera={{
          zoom: 46,
          position: [7.5, 6, 7.5],
          near: 0.1,
          far: 200,
        }}
        onCreated={({ camera }) => {
          camera.lookAt(0, 1.2, 0);
        }}
        style={{ background: "transparent" }}
      >
        <Scene animate={animate} />
      </Canvas>
    </div>
  );
}
