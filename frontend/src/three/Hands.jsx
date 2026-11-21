import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Stylised low-poly hands that appear under the held book,
 * parented to the camera so they always sit in "your" view.
 */

function Finger({ length = 0.075, radius = 0.014, curl = 0.55, color }) {
  const ref = useRef();
  // Simple 2-segment finger made of two capsules with a bend
  return (
    <group ref={ref}>
      <mesh position={[0, 0, -length * 0.25]} castShadow>
        <capsuleGeometry args={[radius, length * 0.5, 4, 8]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      <group position={[0, 0, -length * 0.55]} rotation={[curl, 0, 0]}>
        <mesh position={[0, 0, -length * 0.22]} castShadow>
          <capsuleGeometry args={[radius * 0.9, length * 0.4, 4, 8]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
      </group>
    </group>
  );
}

function Hand({ side = 1, color = '#e8b48c' }) {
  // side: 1 = right hand, -1 = left hand
  return (
    <group scale={[side, 1, 1]}>
      {/* Palm */}
      <mesh castShadow>
        <boxGeometry args={[0.11, 0.03, 0.13]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      {/* Wrist */}
      <mesh position={[0, -0.005, 0.095]} castShadow>
        <boxGeometry args={[0.085, 0.032, 0.08]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      {/* Four fingers, splayed slightly */}
      {[-0.036, -0.012, 0.012, 0.036].map((x, i) => (
        <group key={i} position={[x, 0.004, -0.066]} rotation={[-0.15, (i - 1.5) * -0.08, 0]}>
          <Finger
            length={i === 0 || i === 3 ? 0.07 : 0.082}
            radius={0.0135}
            curl={0.65}
            color={color}
          />
        </group>
      ))}
      {/* Thumb */}
      <group position={[-0.055, 0.006, -0.01]} rotation={[0.3, 0.85, 0.2]}>
        <Finger length={0.065} radius={0.016} curl={0.5} color={color} />
      </group>
    </group>
  );
}

export default function Hands({ visible }) {
  const group = useRef();
  const { camera } = useThree();

  // Hands sit in camera space: below the book, palms up
  const leftPos = useMemo(() => new THREE.Vector3(-0.17, -0.30, -0.60), []);
  const rightPos = useMemo(() => new THREE.Vector3(0.17, -0.30, -0.60), []);
  const baseTilt = useMemo(
    () => new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.55, 0, 0)),
    []
  );

  const visRef = useRef(0);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;

    visRef.current = THREE.MathUtils.damp(visRef.current, visible ? 1 : 0, 6, delta);

    // Parent group copies the camera transform, so children use camera-space offsets directly
    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);

    const l = g.children[0];
    const r = g.children[1];
    if (l && r) {
      const scale = visRef.current;
      const sway = Math.sin(state.clock.elapsedTime * 1.6) * 0.004;

      // Local (camera-space) placement: below the book, palms angled up
      l.position.set(leftPos.x, leftPos.y - (1 - scale) * 0.5 + sway, leftPos.z);
      r.position.set(rightPos.x, rightPos.y - (1 - scale) * 0.5 - sway, rightPos.z);

      l.quaternion.copy(baseTilt);
      r.quaternion.copy(baseTilt);
      l.scale.setScalar(Math.max(0.001, scale));
      r.scale.setScalar(Math.max(0.001, scale));
    }
  });

  return (
    <group ref={group}>
      {/* Children positions are set in world space each frame */}
      <group>
        <Hand side={-1} />
      </group>
      <group>
        <Hand side={1} />
      </group>
    </group>
  );
}
