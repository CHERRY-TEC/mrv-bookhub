import { useMemo, useRef, useEffect, useReducer } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Book from './Book';
import { makeFloorTexture, mulberry32 } from './textures';
import { FLOORS, FLOOR_HEIGHT, setBillerOpen, goToFloor } from './libraryStore';
import { cartStore, subscribeCart } from './cartStore';

/**
 * Three-floor library, two facing walls of shelves per floor.
 * Left wall  (Z = +AISLE_Z) faces the aisle toward -Z.
 * Right wall (Z = -AISLE_Z) faces the aisle toward +Z.
 * The camera walks down the middle of the aisle (Z = 0).
 */

export const CASES_PER_FLOOR = 8;
export const SHELVES_PER_CASE = 4;
const CASE_WIDTH = 2.6;
const CASE_HEIGHT = 3.6;
const CASE_DEPTH = 0.55;
const GAP = 0.28;
const RIGHT_Z = -1.8;            // far wall books face +Z (toward the aisle)
const LEFT_Z = 1.8;              // near wall books face -Z toward the aisle
export const FLOOR_WIDTH = CASES_PER_FLOOR * (CASE_WIDTH + GAP) + 3.2;
/** Cases on both walls are yawed so their spines angle back toward the
 *  reader walking down the aisle (~29 degrees), like angled display racks. */
export const SHELF_YAW = 0.5;
const caseYaw = (side) => (side === 'left' ? SHELF_YAW : -SHELF_YAW);

const CATEGORY_PALETTES = [
  ['#7b2d26', '#1f3a5f', '#37474f', '#283593', '#b71c1c', '#ef6c00'],
  ['#2e5144', '#00695c', '#01579b', '#33691e', '#00838f', '#4527a0'],
  ['#5c3a6e', '#8a5a1e', '#ad1457', '#6d4c41', '#4527a0', '#880e4f'],
];

const DECOR_TITLES = [
  'Calculus', 'Physics', 'Chemistry', 'Biology', 'History', 'Literature',
  'Economics', 'Psychology', 'Sociology', 'Philosophy', 'Statistics',
  'Linear Algebra', 'Organic Chemistry', 'Mechanics', 'Electronics',
  'Programming', 'Algorithms', 'Databases', 'Networks', 'Design',
  'Fluid Dynamics', 'Material Science', 'Thermodynamics', 'Circuit Theory',
  'Microbiology', 'Genetics', 'Anatomy', 'Pharmacology', 'Astronomy',
  'Geology', 'Environmental Science', 'Biochemistry', 'Immunology',
  'World History', 'Modern Literature', 'Fine Arts', 'Accountancy',
  'Business Law', 'Marketing', 'Political Science', 'Development Studies',
];

/** Build books for three floors x two walls. ~600 books. */
export function buildBookLayout(apiBooks = [], filter = null) {
  const rand = mulberry32(20240915);
  const books = [];
  let slot = 0;
  const startX = -((CASES_PER_FLOOR - 1) * (CASE_WIDTH + GAP)) / 2 - 0.8;

  for (let f = 0; f < FLOORS.length; f++) {
    const floorY = FLOORS[f].y;
    const palette = CATEGORY_PALETTES[f];
    for (const side of ['left', 'right']) {
      const wallZ = side === 'left' ? LEFT_Z : RIGHT_Z;
      const yaw = caseYaw(side);
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      // rotate a point about the case centre (caseX, wallZ) by the shelf yaw
      const place = (px, pz, cx) => {
        const dx = px - cx;
        const dz = pz - wallZ;
        return [cx + dx * cosY + dz * sinY, wallZ - dx * sinY + dz * cosY];
      };
      for (let c = 0; c < CASES_PER_FLOOR; c++) {
        const caseX = startX + c * (CASE_WIDTH + GAP);
        for (let s = 0; s < SHELVES_PER_CASE; s++) {
          const shelfY = floorY + 0.5 + s * ((CASE_HEIGHT - 0.6) / SHELVES_PER_CASE);
          let cursorX = caseX - CASE_WIDTH / 2 + 0.22;
          const count = 14 + Math.floor(rand() * 4);
          const cursorEnd = caseX + CASE_WIDTH / 2 - 0.25;

          for (let i = 0; i < count; i++) {
            const thickness = 0.07 + rand() * 0.09;
            if (cursorX + thickness > cursorEnd) break;
            const h = 0.32 + rand() * 0.14;
            const coverW = 0.24 + rand() * 0.1;
            const lean = rand() < 0.12 ? (rand() - 0.5) * 0.3 : 0;
            const candidate = apiBooks[(slot + f) % Math.max(1, apiBooks.length)];
            const cat = FLOORS[f].category.toLowerCase();
            const apiBook = candidate && (
              !filter || `${candidate.title} ${candidate.author}`.toLowerCase().includes(filter)
            ) && (!candidate.category || cat.includes(String(candidate.category).toLowerCase())
              || slot % FLOORS.length === f) ? candidate : null;

            const rawX = cursorX + thickness / 2 + (rand() - 0.5) * 0.01;
            const rawZ = wallZ + (side === 'left' ? 0.28 : -0.28) + (rand() - 0.5) * 0.03;
            const [px, pz] = place(rawX, rawZ, caseX);

            books.push({
              key: `f${f}-${side}-book-${slot}`, slot,
              title: apiBook?.title || DECOR_TITLES[slot % DECOR_TITLES.length],
              author: apiBook?.author || 'MRV Press',
              color: apiBook?.color || palette[Math.floor(rand() * palette.length)],
              size: { w: coverW, h, d: thickness },
              position: [px, shelfY + h / 2, pz],
              lean, side, yaw,
              source: apiBook ? 'api' : 'decorative',
              listing: apiBook?.listing || null,
              bookId: apiBook?.bookId || null,
              floor: f, caseIndex: c, shelfIndex: s,
            });
            cursorX += thickness + 0.018 + rand() * 0.02;
            slot++;
          }

          if (rand() < 0.35) {
            const thickness = 0.08 + rand() * 0.05;
            const h = 0.3 + rand() * 0.08;
            const coverW = 0.22 + rand() * 0.08;
            const apiBook = apiBooks[(slot + f) % Math.max(1, apiBooks.length)];
            const rawFX = cursorX + coverW / 2;
            const rawFZ = wallZ + (side === 'left' ? 1 : -1) * (0.28 + h / 2 + 0.02);
            const [fpx, fpz] = place(rawFX, rawFZ, caseX);
            books.push({
              key: `f${f}-${side}-book-${slot}`, slot,
              title: apiBook?.title || DECOR_TITLES[(slot + 5) % DECOR_TITLES.length],
              author: apiBook?.author || 'MRV Press',
              color: apiBook?.color || palette[Math.floor(rand() * palette.length)],
              size: { w: coverW, h, d: thickness },
              position: [fpx, shelfY + thickness / 2 + 0.01, fpz],
              lean: 0, flat: true, side, yaw,
              source: apiBook ? 'api' : 'decorative',
              listing: apiBook?.listing || null,
              bookId: apiBook?.bookId || null,
              floor: f, caseIndex: c, shelfIndex: s,
            });
            slot++;
          }
        }
      }
    }
  }
  return books;
}

function Bookcase({ x, y, side, palette }) {
  const sign = side === 'left' ? 1 : -1;
  const wallZ = side === 'left' ? LEFT_Z : RIGHT_Z;
  const wood = useMemo(() => new THREE.MeshStandardMaterial({ color: '#4a3020', roughness: 0.85 }), []);
  const back = useMemo(() => new THREE.MeshStandardMaterial({ color: palette, roughness: 0.9 }), [palette]);

  return (
    <group position={[x, y, wallZ]} rotation={[0, caseYaw(side), 0]}>
      {/* back panel on the outer side of the aisle; the near (left) wall's
          back would only ever be seen from outside the room, so skip it */}
      {side === 'right' && (
        <mesh position={[0, CASE_HEIGHT / 2, -CASE_DEPTH / 2 - 0.02]} material={back} receiveShadow>
          <boxGeometry args={[CASE_WIDTH, CASE_HEIGHT, 0.04]} /></mesh>
      )}
      {side === 'left' && (
        <mesh position={[0, CASE_HEIGHT / 2, CASE_DEPTH / 2 + 0.02]} material={back} receiveShadow>
          <boxGeometry args={[CASE_WIDTH, CASE_HEIGHT, 0.04]} /></mesh>
      )}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * CASE_WIDTH / 2, CASE_HEIGHT / 2, 0]} material={wood} castShadow receiveShadow>
          <boxGeometry args={[0.06, CASE_HEIGHT, CASE_DEPTH]} /></mesh>
      ))}
      <mesh position={[0, CASE_HEIGHT - 0.03, 0]} material={wood} castShadow receiveShadow>
        <boxGeometry args={[CASE_WIDTH + 0.06, 0.06, CASE_DEPTH]} /></mesh>
      <mesh position={[0, 0.28, 0]} material={wood} castShadow receiveShadow>
        <boxGeometry args={[CASE_WIDTH + 0.06, 0.06, CASE_DEPTH]} /></mesh>
      {Array.from({ length: SHELVES_PER_CASE }).map((_, i) => (
        <mesh key={i} position={[0, 0.5 + i * ((CASE_HEIGHT - 0.6) / SHELVES_PER_CASE) - 0.02, 0]}
          material={wood} castShadow receiveShadow>
          <boxGeometry args={[CASE_WIDTH, 0.05, CASE_DEPTH]} /></mesh>
      ))}
      <mesh position={[0, CASE_HEIGHT + 0.06, 0]} material={wood} castShadow>
        <boxGeometry args={[CASE_WIDTH + 0.2, 0.1, CASE_DEPTH + 0.08]} /></mesh>
    </group>
  );
}

function Staircase({ y, targetFloor }) {
  const sign = useRef();
  const steps = 14;
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5b3c27', roughness: 0.85 }), []);
  const rail = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8a6436', roughness: 0.6, metalness: 0.25 }), []);
  useFrame(() => {
    if (sign.current) sign.current.material.emissiveIntensity = 0.6 + 0.4 * Math.sin(performance.now() * 0.003);
  });
  return (
    <group position={[FLOOR_WIDTH / 2 - 1.4, y, 0]}>
      {Array.from({ length: steps }).map((_, i) => (
        <mesh key={i} position={[-0.55 + i * 0.075, (i + 1) * (FLOOR_HEIGHT / steps / 2), 0]}
          material={mat} castShadow receiveShadow>
          <boxGeometry args={[0.16, FLOOR_HEIGHT / steps, 1.2]} /></mesh>
      ))}
      {[-0.55, 0.55].map((z) => (
        <mesh key={z} position={[0, FLOOR_HEIGHT / 2, z]} rotation={[0, 0, -Math.atan2(FLOOR_HEIGHT, 1.05)]}
          material={rail} castShadow><boxGeometry args={[1.35, 0.045, 0.045]} /></mesh>
      ))}
      <group position={[0, FLOOR_HEIGHT - 0.15, 0.85]}
        onClick={(e) => { e.stopPropagation(); goToFloor(targetFloor); }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = 'auto'; }}>
        <mesh><boxGeometry args={[0.85, 0.45, 0.08]} />
          <meshStandardMaterial color="#241a12" roughness={0.6} /></mesh>
        <mesh ref={sign} position={[0, 0, 0.05]}>
          <planeGeometry args={[0.7, 0.32]} />
          <meshStandardMaterial color={FLOORS[targetFloor].color} emissive={FLOORS[targetFloor].color}
            emissiveIntensity={0.8} side={THREE.DoubleSide} /></mesh>
      </group>
    </group>
  );
}

function BillerDesk({ floor }) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6b4529', roughness: 0.8 }), []);
  const cloth = useMemo(() => new THREE.MeshStandardMaterial({ color: FLOORS[floor].color, roughness: 0.85 }), [floor]);
  const skin = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d7a578', roughness: 0.9 }), []);
  return (
    <group position={[-FLOOR_WIDTH / 2 + 3.2, FLOORS[floor].y, 0.9]}
      onClick={(e) => { e.stopPropagation(); setBillerOpen(true); }}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { document.body.style.cursor = 'auto'; }}>
      <mesh position={[0, 0.52, 0]} material={mat} castShadow receiveShadow>
        <boxGeometry args={[1.5, 0.95, 0.65]} /></mesh>
      <mesh position={[0, 1.02, 0]} material={mat} castShadow receiveShadow>
        <boxGeometry args={[1.7, 0.09, 0.8]} /></mesh>
      <mesh position={[0.4, 1.15, 0]} material={cloth} castShadow>
        <boxGeometry args={[0.35, 0.22, 0.3]} /></mesh>
      <mesh position={[-0.3, 1.4, -0.35]} material={cloth} castShadow>
        <capsuleGeometry args={[0.22, 0.4, 4, 8]} /></mesh>
      <mesh position={[-0.3, 1.82, -0.35]} material={skin} castShadow>
        <sphereGeometry args={[0.16, 12, 10]} /></mesh>
      <mesh position={[-0.3, 1.9, -0.37]} castShadow>
        <sphereGeometry args={[0.165, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#2c1d14" roughness={0.9} /></mesh>
      <mesh position={[0, 0.72, 0.34]}>
        <planeGeometry args={[1.1, 0.22]} />
        <meshStandardMaterial color={FLOORS[floor].color} roughness={0.7} side={THREE.DoubleSide} /></mesh>
    </group>
  );
}

/** The counter table with the books the reader has chosen to buy/borrow. */
function CartTable({ floor }) {
  const items = useRef([]);
  useEffect(() => subscribeCart((s) => { items.current = s.items; }), []);

  const top = 1.05;
  const wood = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7a5230', roughness: 0.8 }), []);
  return (
    <group position={[-FLOOR_WIDTH / 2 + 4.6, FLOORS[floor].y, 1.1]}>
      {/* table top + legs */}
      <mesh position={[0, top, 0]} material={wood} castShadow receiveShadow>
        <boxGeometry args={[1.7, 0.1, 1.0]} /></mesh>
      {[-0.7, 0.7].map((x) => [-0.4, 0.4].map((z) => (
        <mesh key={`${x}-${z}`} position={[x, top / 2, z]} material={wood} castShadow>
          <boxGeometry args={[0.09, top, 0.09]} /></mesh>
      )))}
      {/* flat books on the table */}
      <CartBooks y={top + 0.06} floor={floor} />
    </group>
  );
}

function CartBooks({ y, floor }) {
  const group = useRef();
  const [, force] = useReducer((n) => n + 1, 0);
  useEffect(() => subscribeCart(() => force()), []);
  return (
    <group ref={group}>
      {cartStore.items.slice(0, 12).map((b, i) => {
        const col = i % 4, row = Math.floor(i / 4);
        return (
          <mesh key={b.key} position={[(col - 1.5) * 0.38, y + row * 0.045, (row - 0.5) * 0.3]}
            rotation={[0, 0.15, 0]} castShadow>
            <boxGeometry args={[0.34, 0.04, 0.26]} />
            <meshStandardMaterial color={b.color} roughness={0.7} /></mesh>
        );
      })}
    </group>
  );
}

function FloorPlate({ y }) {
  const floorTex = useMemo(() => makeFloorTexture(), []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y - 0.02, 1.6]} receiveShadow>
        <planeGeometry args={[FLOOR_WIDTH + 4, LEFT_Z - RIGHT_Z + 4]} />
        <meshStandardMaterial map={floorTex} roughness={0.9} /></mesh>
      {y < FLOOR_HEIGHT * 2 && (
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, y + FLOOR_HEIGHT - 0.04, 1.6]}>
          <planeGeometry args={[FLOOR_WIDTH + 4, LEFT_Z - RIGHT_Z + 4]} />
          <meshStandardMaterial color="#2b2018" roughness={1} side={THREE.DoubleSide} /></mesh>
      )}
    </group>
  );
}

export default function Shelf({ books, heldKey, onSelectBook }) {
  const startX = -((CASES_PER_FLOOR - 1) * (CASE_WIDTH + GAP)) / 2 - 0.8;
  return (
    <group>
      {FLOORS.map((f) => (
        <group key={f.id}>
          <FloorPlate y={f.y} />
          <BillerDesk floor={f.id} />
          <CartTable floor={f.id} />
          {f.id < FLOORS.length - 1 && <Staircase y={f.y} targetFloor={f.id + 1} />}
          {['left', 'right'].map((side) =>
            Array.from({ length: CASES_PER_FLOOR }).map((_, c) => (
              <Bookcase key={`${side}-${c}`} x={startX + c * (CASE_WIDTH + GAP)}
                y={f.y} side={side} palette={CATEGORY_PALETTES[f.id][c % CATEGORY_PALETTES[f.id].length]} />
            ))
          )}
        </group>
      ))}
      {books.map((b) => (
        <Book key={b.key} book={b} isHeld={heldKey === b.key} onSelect={onSelectBook} />
      ))}
    </group>
  );
}
