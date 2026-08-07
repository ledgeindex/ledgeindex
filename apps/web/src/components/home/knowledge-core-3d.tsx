"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useTheme } from "@/components/theme-provider";

/**
 * Accelerator visual: a central index core built from stacked, slowly
 * counter-rotating layers. Small query cubes orbit the core and briefly
 * dive toward it — retrieval hitting the engine and returning grounded.
 */

const LAYER_COUNT = 5;
const LAYER_SIZE = 1.55;
const LAYER_HEIGHT = 0.22;
const LAYER_GAP = 0.14;
const ORBITER_COUNT = 10;

// Brand style: white/neutral plates with one gradient accent layer just
// under the top plate — mirrors the isometric stack used on the page.
const COLORS = {
  light: {
    layers: ["#cdd6df", "#dbe3ea", "#eef2f6", "#c4a86e", "#ffffff"],
    orbiter: "#9aa1a8",
    pulse: "#a88c5a",
    ring: "#a88c5a",
  },
  dark: {
    layers: ["#353132", "#3f3b3c", "#4a4647", "#c4a86e", "#e0dcdb"],
    orbiter: "#5d5859",
    pulse: "#c4a86e",
    ring: "#c4a86e",
  },
};

type Orbiter = {
  radius: number;
  height: number;
  speed: number;
  phase: number;
  size: number;
  // when in the orbit cycle this cube dives toward the core (0..1)
  divePhase: number;
};

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function buildOrbiters(): Orbiter[] {
  const rand = seededRandom(4177);
  const orbiters: Orbiter[] = [];
  for (let i = 0; i < ORBITER_COUNT; i++) {
    orbiters.push({
      radius: 1.75 + rand() * 0.9,
      height: 0.25 + rand() * 1.35,
      speed: 0.24 + rand() * 0.22,
      phase: rand() * Math.PI * 2,
      size: 0.16 + rand() * 0.1,
      divePhase: rand(),
    });
  }
  return orbiters;
}

/** Triangle pulse around `center`, width `w`, in cyclic phase space (0..1). */
function cyclicPulse(t: number, center: number, w: number) {
  let d = Math.abs(t - center);
  d = Math.min(d, 1 - d);
  return Math.max(0, 1 - d / w);
}

function CoreLayers({ animate }: { animate: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const { resolved } = useTheme();
  const palette = COLORS[resolved];

  const layerColors = useMemo(
    () => palette.layers.map((hex) => new THREE.Color(hex)),
    [palette],
  );

  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    const t = animate ? state.clock.elapsedTime : 4;
    group.children.forEach((child, i) => {
      // alternate rotation direction per layer, slightly different speeds
      const dir = i % 2 === 0 ? 1 : -1;
      child.rotation.y = dir * t * (0.1 + i * 0.035);
    });
  });

  return (
    <group ref={groupRef}>
      {layerColors.map((color, i) => {
        const shrink = 1 - i * 0.09;
        return (
          <mesh
            key={i}
            position={[0, i * (LAYER_HEIGHT + LAYER_GAP) + LAYER_HEIGHT / 2, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry
              args={[LAYER_SIZE * shrink, LAYER_HEIGHT, LAYER_SIZE * shrink]}
            />
            <meshStandardMaterial color={color} roughness={0.48} metalness={0.06} />
          </mesh>
        );
      })}
    </group>
  );
}

function Orbiters({ animate }: { animate: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { resolved } = useTheme();
  const palette = COLORS[resolved];
  const orbiters = useMemo(() => buildOrbiters(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const baseColor = useMemo(() => new THREE.Color(palette.orbiter), [palette]);
  const pulseColor = useMemo(() => new THREE.Color(palette.pulse), [palette]);
  const workColor = useMemo(() => new THREE.Color(), []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = animate ? state.clock.elapsedTime : 6;

    orbiters.forEach((orb, i) => {
      const angle = orb.phase + t * orb.speed;
      // cycle position 0..1 used for the dive-toward-core moment
      const cycle = (angle / (Math.PI * 2)) % 1;
      const dive = cyclicPulse(cycle, orb.divePhase, 0.06);
      const eased = dive * dive * (3 - 2 * dive);

      // pull radius inward during the dive
      const radius = orb.radius - eased * (orb.radius - LAYER_SIZE * 0.62);

      dummy.position.set(
        Math.cos(angle) * radius,
        orb.height + Math.sin(t * 0.8 + orb.phase) * 0.05,
        Math.sin(angle) * radius,
      );
      dummy.rotation.set(0, -angle, 0);
      dummy.scale.setScalar(orb.size * (1 + eased * 0.25));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      workColor.copy(baseColor).lerp(pulseColor, eased);
      mesh.setColorAt(i, workColor);
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, ORBITER_COUNT]}
      castShadow
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.5} metalness={0.05} />
    </instancedMesh>
  );
}

function BasePlate() {
  const { resolved } = useTheme();
  const palette = COLORS[resolved];
  const plateColor = resolved === "dark" ? "#232122" : "#dde2e8";

  return (
    <group>
      <mesh position={[0, -0.07, 0]} receiveShadow>
        <cylinderGeometry args={[2.15, 2.3, 0.14, 48]} />
        <meshStandardMaterial color={plateColor} roughness={0.7} metalness={0.03} />
      </mesh>
      {/* orbit guide rings */}
      {[1.9, 2.45].map((radius) => (
        <mesh
          key={radius}
          position={[0, 0.015, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[radius - 0.015, radius + 0.015, 64]} />
          <meshBasicMaterial
            color={palette.ring}
            transparent
            opacity={0.22}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
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
      <CoreLayers animate={animate} />
      <Orbiters animate={animate} />
    </>
  );
}

export function KnowledgeCore3D({ className }: { className?: string }) {
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
      aria-label="Rotating index core with query blocks orbiting and docking"
    >
      <Canvas
        className="size-full"
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        orthographic
        camera={{
          zoom: 52,
          position: [7.5, 6, 7.5],
          near: 0.1,
          far: 200,
        }}
        onCreated={({ camera }) => {
          camera.lookAt(0, 0.8, 0);
        }}
        style={{ background: "transparent" }}
      >
        <Scene animate={animate} />
      </Canvas>
    </div>
  );
}
