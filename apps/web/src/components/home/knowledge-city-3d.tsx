"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useTheme } from "@/components/theme-provider";

const GRID = 12;
const PITCH = 0.46;
const CELL = 0.38;

type Tower = {
  x: number;
  z: number;
  baseHeight: number;
  amplitude: number;
  phase: number;
  speed: number;
  shade: number;
  /** 0..1 position along the gradient stripe, or null for neutral towers. */
  stripe: number | null;
};

const CITY_PALETTE = {
  light: { dark: "#2b2d31", lite: "#e2e6ea", base: "#5a5f66", baseEdge: "#6b7078" },
  dark: { dark: "#2e2c2d", lite: "#e0dcdb", base: "#4a4748", baseEdge: "#5a5758" },
};

/* Brand gradient (paper gold → slate → cream) for the stripe. */
const STRIPE_GOLD = new THREE.Color("#a88c5a");
const STRIPE_SLATE = new THREE.Color("#64788a");
const STRIPE_CREAM = new THREE.Color("#c8b496");

function stripeColor(t: number, target: THREE.Color) {
  if (t < 0.5) {
    target.copy(STRIPE_GOLD).lerp(STRIPE_SLATE, t * 2);
  } else {
    target.copy(STRIPE_SLATE).lerp(STRIPE_CREAM, (t - 0.5) * 2);
  }
  return target;
}

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function buildTowers(): Tower[] {
  const rand = seededRandom(1337);
  const towers: Tower[] = [];
  const half = ((GRID - 1) * PITCH) / 2;

  for (let ix = 0; ix < GRID; ix++) {
    for (let iz = 0; iz < GRID; iz++) {
      // Leave occasional gaps so it reads as streets, like the artwork
      if (rand() < 0.14) continue;

      // Taller towards the back-center, like a skyline
      const cx = (ix / (GRID - 1)) * 2 - 1;
      const cz = (iz / (GRID - 1)) * 2 - 1;
      const centerBoost = 1 - (cx * cx + cz * cz) * 0.45;
      const baseHeight = (0.25 + rand() * 1.1) * Math.max(0.35, centerBoost);

      // Darker at the front-left corner, lighter to the back-right
      const diag = (ix + (GRID - 1 - iz)) / (2 * (GRID - 1));
      const shade = Math.min(1, Math.max(0, diag * 1.15 - 0.05 + rand() * 0.12));

      // Rainbow avenue: a diagonal band of towers carries the brand gradient,
      // plus the occasional colored outlier scattered through the city.
      const onStripe = Math.abs(ix + iz - (GRID - 1)) <= 1;
      const outlier = !onStripe && rand() < 0.045;
      const stripe =
        onStripe || outlier ? ix / (GRID - 1) : null;

      towers.push({
        x: ix * PITCH - half,
        z: iz * PITCH - half,
        baseHeight,
        amplitude: 0.18 + rand() * 0.55,
        phase: rand() * Math.PI * 2,
        speed: 0.35 + rand() * 0.5,
        shade,
        stripe,
      });
    }
  }
  return towers;
}

function CityBlocks({ animate }: { animate: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { resolved } = useTheme();
  const palette = CITY_PALETTE[resolved];
  const towers = useMemo(() => buildTowers(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const geometry = useMemo(() => {
    const geo = new THREE.BoxGeometry(CELL, 1, CELL);
    // Anchor the box at its bottom so Y-scale grows upwards
    geo.translate(0, 0.5, 0);
    return geo;
  }, []);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dark = new THREE.Color(palette.dark);
    const lite = new THREE.Color(palette.lite);
    const color = new THREE.Color();
    towers.forEach((tower, i) => {
      if (tower.stripe !== null) {
        stripeColor(tower.stripe, color);
      } else {
        color.copy(dark).lerp(lite, tower.shade);
      }
      mesh.setColorAt(i, color);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [towers, palette]);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = state.clock.elapsedTime;

    towers.forEach((tower, i) => {
      const wave = animate
        ? (0.5 + 0.5 * Math.sin(t * tower.speed + tower.phase)) *
          tower.amplitude
        : tower.amplitude * 0.5;
      const height = tower.baseHeight + wave;
      dummy.position.set(tower.x, 0, tower.z);
      dummy.scale.set(1, height, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[geometry, undefined, towers.length]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial roughness={0.5} metalness={0.05} />
      </instancedMesh>

      {/* Plinth the city sits on */}
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <boxGeometry args={[GRID * PITCH + 0.5, 0.18, GRID * PITCH + 0.5]} />
        <meshStandardMaterial
          color={palette.base}
          roughness={0.68}
          metalness={0.04}
        />
      </mesh>
      {/* Subtle top edge so the base reads softer, not a flat black slab */}
      <mesh position={[0, -0.005, 0]} receiveShadow>
        <boxGeometry args={[GRID * PITCH + 0.46, 0.02, GRID * PITCH + 0.46]} />
        <meshStandardMaterial
          color={palette.baseEdge}
          roughness={0.72}
          metalness={0.03}
        />
      </mesh>
    </group>
  );
}

function Scene({ animate }: { animate: boolean }) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <hemisphereLight args={["#f4f5f7", "#8b9199", 0.4]} position={[0, 1, 0]} />
      <directionalLight
        position={[-6, 10, 6]}
        intensity={1.3}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[5, 3, -4]} intensity={0.2} />
      <CityBlocks animate={animate} />
    </>
  );
}

export function KnowledgeCity3D({ className }: { className?: string }) {
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
      aria-label="Isometric city of blocks growing as knowledge gets indexed"
    >
      <Canvas
        className="size-full"
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        orthographic
        camera={{
          zoom: 52,
          position: [8, 7.2, 8],
          near: 0.1,
          far: 200,
        }}
        onCreated={({ camera }) => {
          camera.lookAt(0, 0.6, 0);
        }}
        style={{ background: "transparent" }}
      >
        <Scene animate={animate} />
      </Canvas>
    </div>
  );
}
