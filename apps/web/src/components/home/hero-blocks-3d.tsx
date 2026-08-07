"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useTheme } from "@/components/theme-provider";

/**
 * Hero visual: two L-shapes assemble into the LedgeIndex logo mark.
 *
 * • Bottom L — left pillar + short bottom foot (fixed)
 * • Top L    — crane boom along −Z, hook 2×4×2 at the far end
 */

const S = 0.3;
const CUBE = 0.272;

const ASSEMBLY_STAGGER = 4.2;
const TRAVEL_TIME = 1.5;

const GRID_W = 8;
const GRID_H = 10;
const GRID_D = 2;

const GRADIENT = {
  light: { from: "#2b2d31", to: "#d6dade" },
  dark: { from: "#2e2c2d", to: "#e3dfde" },
};

type Voxel = { x: number; y: number; z: number; part: "bottom" | "top" };

function addRect(
  out: Voxel[],
  part: "bottom" | "top",
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0 = 0,
  z1 = 1,
) {
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        out.push({ x, y, z, part });
      }
    }
  }
}

function buildVoxels(): Voxel[] {
  const voxels: Voxel[] = [];

  // ── Bottom L (fixed, correct) ──────────────────────────────
  addRect(voxels, "bottom", 0, 1, 0, 9); // left pillar
  addRect(voxels, "bottom", 2, 4, 0, 1); // short bottom foot →

  // ── Top L (crane header) ───────────────────────────────────
  // Boom along −Z (direction locked). Hook is 2×4×2, shifted
  // inward so the elbow fillet fills the inside joint — no
  // blocky outward ledge, no missing cube at the corner.
  addRect(voxels, "top", 0, 1, 8, 9, -6, -1); // boom → −Z
  addRect(voxels, "top", 0, 1, 4, 7, -6, -5); // hook: 2 wide × 4 tall × 2 deep
  addRect(voxels, "top", 0, 1, 7, 8, -5, -5); // elbow fillet (inward, solid joint)

  return voxels;
}

const VOXEL_LIST = buildVoxels();
const COUNT = VOXEL_LIST.length;

type LogoCube = {
  slot: THREE.Vector3;
  scattered: THREE.Vector3;
  delay: number;
  tumble: THREE.Vector3;
  blend: number;
};

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function gridToWorld(x: number, y: number, z: number) {
  return new THREE.Vector3(
    (x - (GRID_W - 1) / 2) * S,
    (y - (GRID_H - 1) / 2) * S,
    (z - (GRID_D - 1) / 2) * S,
  );
}

function buildCubes(): LogoCube[] {
  const rand = seededRandom(9001);

  return VOXEL_LIST.map(({ x, y, z, part }) => {
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(rand() * 2 - 1);
    const radius = 2.9 + rand() * 2;

    return {
      slot: gridToWorld(x, y, z),
      scattered: new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta) * radius,
        Math.cos(phi) * radius * 0.85,
        Math.sin(phi) * Math.sin(theta) * radius,
      ),
      delay:
        part === "bottom"
          ? (y / GRID_H) * ASSEMBLY_STAGGER * 0.55 +
            rand() * ASSEMBLY_STAGGER * 0.45
          : ASSEMBLY_STAGGER * 0.4 + rand() * ASSEMBLY_STAGGER * 0.5,
      tumble: new THREE.Vector3(
        (rand() - 0.5) * 5,
        (rand() - 0.5) * 5,
        (rand() - 0.5) * 3,
      ),
      blend: 0.65 * (y / (GRID_H - 1)) + 0.35 * (x / (GRID_W - 1)),
    };
  });
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

function LogoAssembly({ animate }: { animate: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const { resolved } = useTheme();
  const cubes = useMemo(() => buildCubes(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const work = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const gradient = GRADIENT[resolved];
    const from = new THREE.Color(gradient.from);
    const to = new THREE.Color(gradient.to);
    const color = new THREE.Color();
    cubes.forEach((cube, i) => {
      const jitter = ((i * 37) % 10) / 10 - 0.5;
      color
        .copy(from)
        .lerp(to, Math.min(1, Math.max(0, cube.blend + jitter * 0.06)));
      mesh.setColorAt(i, color);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [cubes, resolved]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    if (groupRef.current) {
      groupRef.current.rotation.y = 0;
      groupRef.current.position.y = animate ? Math.sin(t * 0.5) * 0.05 : 0;
    }

    const mesh = meshRef.current;
    if (!mesh) return;

    cubes.forEach((cube, i) => {
      const progress = animate
        ? Math.min(1, Math.max(0, (t - cube.delay) / TRAVEL_TIME))
        : 1;

      let scale = CUBE;
      let tumbleAmount = 0;

      if (progress <= 0) {
        work.copy(cube.scattered);
        scale = 0;
      } else if (progress < 1) {
        const p = smoothstep(progress);
        work.copy(cube.scattered).lerp(cube.slot, p);
        scale = CUBE * (0.55 + 0.45 * p);
        tumbleAmount = 1 - p;
      } else {
        work.copy(cube.slot);
        scale = CUBE;
        tumbleAmount = 0;
      }

      dummy.position.copy(work);
      dummy.rotation.set(
        cube.tumble.x * tumbleAmount * (t * 0.6 + cube.delay * 7),
        cube.tumble.y * tumbleAmount * (t * 0.6 + cube.delay * 7),
        cube.tumble.z * tumbleAmount * (t * 0.6 + cube.delay * 7),
      );
      dummy.scale.setScalar(Math.max(scale, 0.0001));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group ref={groupRef}>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, COUNT]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.42} metalness={0.08} />
      </instancedMesh>
    </group>
  );
}

function Scene({ animate }: { animate: boolean }) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <hemisphereLight
        args={["#f4f5f7", "#8b9199", 0.4]}
        position={[0, 1, 0]}
      />
      <directionalLight
        position={[-6, 9, 5]}
        intensity={1.4}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[5, 2, -4]} intensity={0.25} />
      <LogoAssembly animate={animate} />
    </>
  );
}

export function HeroBlocks3D({ className }: { className?: string }) {
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
      aria-label="Scattered blocks assembling into the LedgeIndex logo mark"
    >
      <Canvas
        className="size-full"
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        orthographic
        camera={{
          zoom: 88,
          position: [7.5, 6.3, 7.5],
          near: 0.1,
          far: 200,
        }}
        onCreated={({ camera }) => {
          camera.lookAt(0, 0, 0);
        }}
        style={{ background: "transparent" }}
      >
        <Scene animate={animate} />
      </Canvas>
    </div>
  );
}
