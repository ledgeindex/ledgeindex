"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useTheme } from "@/components/theme-provider";

/**
 * Features visual: a stream of blocks flows along a belt. A single
 * scanner cube sits beside the pipeline (not on it) and beams inward
 * as blocks pass — raw blocks become indexed on the other side.
 */

const LANES_X = 14;
const LANES_Z = 4;
const PITCH_X = 0.62;
const PITCH_Z = 0.5;
const CUBE = 0.34;
const COUNT = LANES_X * LANES_Z;
const FLOW_LENGTH = LANES_X * PITCH_X;
const SPEED = 0.55;
const SCAN_X = 0.55; // blocks are indexed after passing this point
const SCANNER_SIZE = 0.52;

// Brand palette: raw grey blocks pass the scanner and come out in the
// paper gold → slate → cream gradient used across the landing page.
const COLORS = {
  light: {
    raw: "#9aa1a8",
    clean: "#a88c5a",
    cleanLite: "#c8b496",
    scanner: "#2b2d31",
    beam: "#64788a",
  },
  dark: {
    raw: "#5d5859",
    clean: "#c4a86e",
    cleanLite: "#d8c8b0",
    scanner: "#e0dcdb",
    beam: "#8494a3",
  },
};

type PipelineBlock = {
  lane: number; // z row index
  offset: number; // start position along the flow
  jitter: THREE.Vector3; // pre-scan positional noise
  tilt: THREE.Vector3; // pre-scan rotational noise
  shade: number; // post-scan gradient position
};

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function buildBlocks(): PipelineBlock[] {
  const rand = seededRandom(7331);
  const blocks: PipelineBlock[] = [];
  for (let ix = 0; ix < LANES_X; ix++) {
    for (let iz = 0; iz < LANES_Z; iz++) {
      blocks.push({
        lane: iz,
        offset: ix * PITCH_X + rand() * PITCH_X * 0.3,
        jitter: new THREE.Vector3(
          (rand() - 0.5) * 0.16,
          rand() * 0.34,
          (rand() - 0.5) * 0.24,
        ),
        tilt: new THREE.Vector3(
          (rand() - 0.5) * 1.1,
          (rand() - 0.5) * 1.4,
          (rand() - 0.5) * 0.8,
        ),
        shade: rand(),
      });
    }
  }
  return blocks;
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function ConveyorBlocks({ animate }: { animate: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { resolved } = useTheme();
  const blocks = useMemo(() => buildBlocks(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const palette = COLORS[resolved];
  const rawColor = useMemo(() => new THREE.Color(palette.raw), [palette]);
  const cleanA = useMemo(() => new THREE.Color(palette.clean), [palette]);
  const cleanB = useMemo(() => new THREE.Color(palette.cleanLite), [palette]);
  const workColor = useMemo(() => new THREE.Color(), []);
  const gradColor = useMemo(() => new THREE.Color(), []);
  const scanColor = useMemo(() => new THREE.Color(palette.beam), [palette]);
  const halfZ = ((LANES_Z - 1) * PITCH_Z) / 2;
  const beltHalfDepth = halfZ + 0.4;

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = animate ? state.clock.elapsedTime : 8;

    blocks.forEach((block, i) => {
      const x =
        ((block.offset + t * SPEED) % FLOW_LENGTH) - FLOW_LENGTH / 2;

      // Indexed after passing the scanner point along the belt
      const cleaned = smoothstep(SCAN_X - 0.18, SCAN_X + 0.12, x);
      // Pulse when the block is in the scanner beam
      const inBeamZ =
        Math.abs(block.lane * PITCH_Z - halfZ) < beltHalfDepth;
      const scanning =
        (inBeamZ ? 1 : 0) *
        (1 - Math.min(1, Math.abs(x - SCAN_X) / 0.32));

      dummy.position.set(
        x + block.jitter.x * (1 - cleaned),
        CUBE / 2 + block.jitter.y * (1 - cleaned),
        block.lane * PITCH_Z - halfZ + block.jitter.z * (1 - cleaned),
      );
      dummy.rotation.set(
        block.tilt.x * (1 - cleaned),
        block.tilt.y * (1 - cleaned),
        block.tilt.z * (1 - cleaned),
      );
      // Slight grow as blocks get "structured"
      dummy.scale.setScalar(CUBE * (0.82 + 0.18 * cleaned));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Color: raw grey → a spot on the sky→rose gradient (per block),
      // with a glow pulse at the gate
      gradColor.copy(cleanA).lerp(cleanB, block.shade);
      workColor.copy(rawColor).lerp(gradColor, cleaned);
      if (scanning > 0) {
        workColor.lerp(scanColor, scanning * 0.35);
      }
      mesh.setColorAt(i, workColor);
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, COUNT]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.48} metalness={0.06} />
    </instancedMesh>
  );
}

function ScannerUnit() {
  const { resolved } = useTheme();
  const palette = COLORS[resolved];
  const halfZ = ((LANES_Z - 1) * PITCH_Z) / 2;
  // Single cube beside the belt, offset to the side — not on the pipeline
  const sideOffset = halfZ + 1.2;

  return (
    <group position={[SCAN_X, 0, sideOffset]}>
      <mesh position={[0, SCANNER_SIZE / 2, 0]} castShadow>
        <boxGeometry args={[SCANNER_SIZE, SCANNER_SIZE, SCANNER_SIZE]} />
        <meshStandardMaterial
          color={palette.scanner}
          roughness={0.42}
          metalness={0.08}
        />
      </mesh>
      {/* beam from scanner inward toward the pipeline */}
      <mesh position={[0, SCANNER_SIZE / 2, -0.85]}>
        <planeGeometry args={[SCANNER_SIZE * 1.8, SCANNER_SIZE * 1.5]} />
        <meshBasicMaterial
          color={palette.beam}
          transparent
          opacity={0.2}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* soft ring at the scanner base */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[SCANNER_SIZE * 0.42, SCANNER_SIZE * 0.68, 32]} />
        <meshBasicMaterial
          color={palette.beam}
          transparent
          opacity={0.28}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function Belt() {
  const { resolved } = useTheme();
  const color = resolved === "dark" ? "#232122" : "#dde2e8";
  return (
    <mesh position={[0, -0.06, 0]} receiveShadow>
      <boxGeometry
        args={[FLOW_LENGTH + 0.6, 0.12, (LANES_Z - 1) * PITCH_Z + 0.8]}
      />
      <meshStandardMaterial color={color} roughness={0.7} metalness={0.03} />
    </mesh>
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
      <Belt />
      <ConveyorBlocks animate={animate} />
      <ScannerUnit />
    </>
  );
}

export function KnowledgePipeline3D({ className }: { className?: string }) {
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
      aria-label="Pipeline of blocks moving through a scanner and coming out indexed"
    >
      <Canvas
        className="size-full"
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        orthographic
        camera={{
          zoom: 42,
          position: [7.5, 6, 7.5],
          near: 0.1,
          far: 200,
        }}
        onCreated={({ camera }) => {
          camera.lookAt(0, 0.3, 0);
        }}
        style={{ background: "transparent" }}
      >
        <Scene animate={animate} />
      </Canvas>
    </div>
  );
}
