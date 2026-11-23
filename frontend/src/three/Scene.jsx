import { useRef, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import Shelf, { buildBookLayout, CASES_PER_FLOOR, FLOOR_WIDTH } from './Shelf';
import Hands from './Hands';
import { scrollStore, easeInOut, clamp01 } from './scrollStore';
import { FLOORS, FLOOR_HEIGHT, libraryStore, syncFloor } from './libraryStore';

/**
 * Camera rig: scroll walks you along the current floor's aisle; changing
 * floors eases the camera up/down through the stairwell. While a book is
 * held, the camera eases closer for a reading feel.
 */

const CASE_WIDTH = 2.6, GAP = 0.28;
const WALL_HALF = (CASES_PER_FLOOR * (CASE_WIDTH + GAP)) / 2 - 2;

function CameraRig({ heldKey }) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3(-WALL_HALF, 1.7, 0.4));
  const lookTarget = useRef(new THREE.Vector3(0, 1.6, 0));
  const aimed = useRef(new THREE.Vector3(0, 1.6, 0));
  const stairX = FLOOR_WIDTH / 2 - 1.4;   // where the staircase sits

  useFrame((_, delta) => {
    // The page is split into three equal bands, one per floor. Inside a band
    // the camera strolls down the aisle; the last ~18% is the walk to the
    // stairs and the climb itself, so scrolling physically takes you up.
    const p = easeInOut(clamp01(scrollStore.progress));
    const band = p * FLOORS.length;                 // 0..3
    const floor = Math.min(FLOORS.length - 1, Math.floor(band));
    const local = clamp01(band - floor);            // 0..1 within this floor

    // Aisle walk covers 0..0.78 of the band; 0.78..1 is the stair climb.
    const walk = clamp01(local / 0.78);
    const climb = clamp01((local - 0.78) / 0.22);
    scrollStore.climbing = floor < FLOORS.length - 1 ? climb : 0;

    // Keep the shared stores in sync for the UI (floor rail, lighting, etc.).
    if (scrollStore.floor !== floor) {
      scrollStore.floor = floor;
      syncFloor(floor);   // updates libraryStore + notifies React, no scroll loop
    }
    libraryStore.transition = Math.min(1, libraryStore.transition + delta * 1.1);

    // X: walk the aisle, then approach the staircase at the far end.
    const aisleX = -WALL_HALF + walk * (2 * WALL_HALF);
    const x = floor < FLOORS.length - 1
      ? THREE.MathUtils.lerp(aisleX, stairX, climb)
      : aisleX;

    // FloorY blends from this floor to the next while climbing.
    const baseY = FLOORS[floor].y;
    const nextY = floor < FLOORS.length - 1 ? FLOORS[floor + 1].y : baseY;
    const floorY = THREE.MathUtils.lerp(baseY, nextY, climb);

    if (heldKey) {
      target.current.set(x, floorY + 1.55, 0.4);
      lookTarget.current.set(x + 3, floorY + 1.45, 0);
    } else if (climb > 0 && floor < FLOORS.length - 1) {
      // Looking along the stairs as we ascend makes the climb readable.
      target.current.set(x, floorY + 1.7, 0.4);
      lookTarget.current.set(stairX + 0.4, floorY + 2.2, 0);
    } else {
      target.current.set(x, floorY + 1.7, 0.4);
      lookTarget.current.set(x + 3, floorY + 1.6, 0);
    }

    // Fast follow while climbing so the camera actually keeps up with scroll.
    const damp = 1 - Math.pow(0.002, Math.min(delta, 0.1));
    camera.position.lerp(target.current, Math.max(damp, climb > 0 ? 1 - Math.pow(0.001, Math.min(delta, 0.1)) : 0));
    aimed.current.lerp(lookTarget.current, damp);
    camera.lookAt(aimed.current);
  });

  return null;
}

function Lights() {
  const { camera } = useThree();
  const follow = useRef(null);
  useFrame(() => {
    // keep the warm pendant lights centred on the camera's current floor
    // (including mid-climb on the stairs).
    if (follow.current) {
      const f = scrollStore.floor;
      const next = Math.min(FLOORS.length - 1, f + 1);
      follow.current.position.y = THREE.MathUtils.lerp(
        FLOORS[f].y, FLOORS[next].y, scrollStore.climbing);
    }
  });
  return (
    <>
      <ambientLight intensity={0.85} color="#ffe9c9" />
      <directionalLight
        position={[6, 14, 8]}
        intensity={1.45}
        color="#fff3dd"
      />
      <group ref={follow}>
        {[-6, -2, 2, 6].map((x) => (
          <group key={x}>
            <pointLight position={[x, 4.1, 1.4]} intensity={16} distance={9} decay={2} color="#ffcf8f" />
            <mesh position={[x, 4.25, 1.4]}>
              <sphereGeometry args={[0.09, 16, 16]} />
              <meshStandardMaterial color="#ffdba8" emissive="#ffc978" emissiveIntensity={2.2} />
            </mesh>
          </group>
        ))}
      </group>
      <hemisphereLight args={['#f5e6c8', '#3a2a1c', 0.55]} />
      <fog attach="fog" args={['#2b2018', 16, 42]} />
    </>
  );
}

function RoomShell() {
  // Backdrop only — kept far behind both shelf walls so it never occludes
  // the aisle. The per-floor plates provide the room surfaces.
  return (
    <mesh position={[0, 15, -6]}>
      <boxGeometry args={[46, 34, 0.2]} />
      <meshStandardMaterial color="#2b2118" roughness={1} />
    </mesh>
  );
}

export default function Scene({ apiBooks, onSelectBook, heldKey }) {
  const books = useMemo(() => buildBookLayout(apiBooks || []), [apiBooks]);

  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 70, near: 0.1, far: 80, position: [0, 1.7, 0.5] }}
      onCreated={({ gl, scene, camera }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        if (import.meta.env.DEV) {
          window.__mrvGL = gl; window.__mrvScene = scene; window.__mrvCamera = camera;
        }
      }}
      onPointerMissed={() => {
        if (scrollStore.locked) onSelectBook(null);
      }}
    >
      <color attach="background" args={['#241a12']} />
      <Lights />
      <CameraRig heldKey={heldKey} />
      <RoomShell />
      <Shelf books={books} heldKey={heldKey} onSelectBook={onSelectBook} />
      <Hands visible={Boolean(heldKey)} />
    </Canvas>
  );
}
