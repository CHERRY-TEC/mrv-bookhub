import { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import Shelf, { buildBookLayout } from './Shelf';
import Hands from './Hands';
import { scrollStore, easeInOut, clamp01 } from './scrollStore';

/**
 * Camera rig: scroll moves you along the library wall.
 * While a book is held, the camera eases closer for a reading feel.
 */

const WALL_HALF = 6.6;

function CameraRig({ heldKey }) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3(0, 1.7, 4.2));
  const lookTarget = useRef(new THREE.Vector3(0, 1.6, 0));

  useFrame((_, delta) => {
    const p = easeInOut(clamp01(scrollStore.progress));
    const x = (p - 0.5) * 2 * WALL_HALF;

    if (heldKey) {
      // Reading pose: drift slightly closer and lower
      target.current.set(x * 0.25, 1.55, 2.5);
      lookTarget.current.set(x * 0.25, 1.45, -0.4);
    } else {
      target.current.set(x, 1.7 + Math.sin(p * Math.PI) * 0.25, 4.2 - Math.sin(p * Math.PI) * 0.5);
      lookTarget.current.set(x, 1.6, -0.2);
    }

    const damp = 1 - Math.pow(0.002, Math.min(delta, 0.1));
    camera.position.lerp(target.current, damp);

    // Smooth look-at
    const currentLook = new THREE.Vector3();
    camera.getWorldDirection(currentLook).multiplyScalar(5).add(camera.position);
    currentLook.lerp(lookTarget.current, damp);
    camera.lookAt(currentLook);
  });

  return null;
}

function Lights() {
  return (
    <>
      <ambientLight intensity={0.45} color="#ffe9c9" />
      <directionalLight
        position={[6, 8, 6]}
        intensity={1.15}
        color="#fff3dd"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={8}
        shadow-camera-bottom={-2}
        shadow-camera-far={30}
        shadow-bias={-0.0004}
      />
      {/* Warm pendant lamps along the wall */}
      {[-5, -1.7, 1.7, 5].map((x) => (
        <group key={x}>
          <pointLight position={[x, 4.4, 1.4]} intensity={9} distance={7} decay={2} color="#ffcf8f" />
          <mesh position={[x, 4.55, 1.4]}>
            <sphereGeometry args={[0.09, 16, 16]} />
            <meshStandardMaterial color="#ffdba8" emissive="#ffc978" emissiveIntensity={2.2} />
          </mesh>
        </group>
      ))}
      <hemisphereLight args={['#f5e6c8', '#3a2a1c', 0.35]} />
      <fog attach="fog" args={['#241a12', 9, 22]} />
    </>
  );
}

/** Invisible backdrop so fog + wall read depth */
function RoomShell() {
  return (
    <group>
      <mesh position={[0, 5, -1]}>
        <boxGeometry args={[40, 12, 0.2]} />
        <meshStandardMaterial color="#2b2118" roughness={1} />
      </mesh>
      {/* Ceiling */}
      <mesh position={[0, 5.2, 2]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[40, 16]} />
        <meshStandardMaterial color="#241a12" roughness={1} />
      </mesh>
    </group>
  );
}

export default function Scene({ apiBooks, onSelectBook, heldKey }) {
  // Rebuild the shelf layout whenever the API book list changes
  const books = useMemo(() => buildBookLayout(apiBooks || []), [apiBooks]);

  return (
    <Canvas
      shadows
      dpr={[1, 1.8]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 48, near: 0.1, far: 60, position: [0, 1.7, 4.2] }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
      onPointerMissed={() => {
        // Clicking empty space "closes" the held book
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
