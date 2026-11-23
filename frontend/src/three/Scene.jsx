import { useRef, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import Shelf, { buildBookLayout, CASES_PER_FLOOR } from './Shelf';
import Hands from './Hands';
import { scrollStore, easeInOut, clamp01 } from './scrollStore';
import { FLOORS, FLOOR_HEIGHT, libraryStore } from './libraryStore';

/**
 * Camera rig: scroll walks you along the current floor's aisle; changing
 * floors eases the camera up/down through the stairwell. While a book is
 * held, the camera eases closer for a reading feel.
 */

const CASE_WIDTH = 2.6, GAP = 0.28;
const WALL_HALF = (CASES_PER_FLOOR * (CASE_WIDTH + GAP)) / 2 - 2;

function CameraRig({ heldKey }) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3(-8, 1.7, 0.4));
  const lookTarget = useRef(new THREE.Vector3(0, 1.6, 0));
  const aimed = useRef(new THREE.Vector3(0, 1.6, 0));

  useFrame((_, delta) => {
    const p = easeInOut(clamp01(scrollStore.progress));
    const x = -WALL_HALF + p * 2 * WALL_HALF;

    // Ease the floor transition (0..1) toward 1 each frame.
    libraryStore.transition = Math.min(1, libraryStore.transition + delta * 1.1);
    const ft = easeInOut(libraryStore.transition);
    const fromY = FLOORS[libraryStore.previousFloor].y;
    const toY = FLOORS[libraryStore.floor].y;
    const floorY = THREE.MathUtils.lerp(fromY, toY, ft);

    if (heldKey) {
      target.current.set(x, floorY + 1.55, 0.4);
      lookTarget.current.set(x + 3, floorY + 1.45, 0);
    } else {
      target.current.set(x, floorY + 1.7, 0.4);
      lookTarget.current.set(x + 3, floorY + 1.6, 0);
    }

    const damp = 1 - Math.pow(0.002, Math.min(delta, 0.1));
    camera.position.lerp(target.current, damp);
    aimed.current.lerp(lookTarget.current, damp);
    camera.lookAt(aimed.current);
  });

  return null;
}

function Lights() {
  const { camera } = useThree();
  const follow = useRef(null);
  useFrame(() => {
    // keep the warm pendant lights centred on the current floor
    if (follow.current) follow.current.position.y = FLOORS[libraryStore.floor].y;
  });
  return (
    <>
      <ambientLight intensity={0.85} color="#ffe9c9" />
      <directionalLight
        position={[6, 14, 8]}
        intensity={1.45}
        color="#fff3dd"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={20}
        shadow-camera-bottom={-6}
        shadow-camera-far={40}
        shadow-bias={-0.0004}
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
      shadows
      dpr={[1, 1.5]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 70, near: 0.1, far: 80, position: [0, 1.7, 0.5] }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
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
