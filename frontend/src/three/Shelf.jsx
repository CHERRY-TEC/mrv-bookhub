import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Book from './Book';
import { makeFloorTexture, mulberry32 } from './textures';

/**
 * The library wall: wooden bookcases, shelves, and all the books.
 * Books are laid out deterministically so the shelf never "jumps".
 */

const BOOKCASES = 4;
const SHELVES_PER_CASE = 4;
const CASE_WIDTH = 3.2;
const CASE_HEIGHT = 4.6;
const CASE_DEPTH = 0.55;
const GAP = 0.35;

const SPINE_COLORS = [
  '#7b2d26', '#1f3a5f', '#2e5144', '#5c3a6e', '#8a5a1e',
  '#37474f', '#6d4c41', '#283593', '#00695c', '#ad1457',
  '#4527a0', '#ef6c00', '#33691e', '#b71c1c', '#01579b',
];

const DECOR_TITLES = [
  'Calculus', 'Physics', 'Chemistry', 'Biology', 'History',
  'Literature', 'Economics', 'Psychology', 'Sociology', 'Philosophy',
  'Statistics', 'Linear Algebra', 'Organic Chemistry', 'Mechanics',
  'Electronics', 'Programming', 'Algorithms', 'Databases', 'Networks',
  'Architectural Design', 'Fluid Dynamics', 'Material Science',
];

/**
 * Build the full book layout once.
 * Real books from the API are placed in the front-most slots;
 * decorative fillers complete the shelves.
 */
export function buildBookLayout(apiBooks = []) {
  const rand = mulberry32(20240915);
  const books = [];
  const totalSlots = BOOKCASES * SHELVES_PER_CASE * 9; // ~9 books per shelf
  const startX = -((BOOKCASES - 1) * (CASE_WIDTH + GAP)) / 2;

  let slot = 0;
  for (let c = 0; c < BOOKCASES; c++) {
    const caseX = startX + c * (CASE_WIDTH + GAP);
    for (let s = 0; s < SHELVES_PER_CASE; s++) {
      const shelfY = 0.55 + s * ((CASE_HEIGHT - 0.7) / SHELVES_PER_CASE);
      let cursorX = caseX - CASE_WIDTH / 2 + 0.28;

      // ~9 books per shelf, varied thickness
      const count = 8 + Math.floor(rand() * 3);
      for (let i = 0; i < count && slot < totalSlots; i++) {
        const thickness = 0.07 + rand() * 0.09;  // spine thickness (shelf footprint)
        const h = 0.34 + rand() * 0.16;          // book height
        const coverW = 0.24 + rand() * 0.1;      // cover width (depth into the shelf)
        const lean = rand() < 0.12 ? (rand() - 0.5) * 0.3 : 0;

        const apiBook = apiBooks[slot];
        const title = apiBook?.title || DECOR_TITLES[slot % DECOR_TITLES.length];
        const author = apiBook?.author || 'MRV Press';
        const color = apiBook?.color || SPINE_COLORS[Math.floor(rand() * SPINE_COLORS.length)];

        books.push({
          key: `book-${slot}`,
          slot,
          title,
          author,
          color,
          size: { w: coverW, h, d: thickness },
          position: [
            cursorX + thickness / 2 + (rand() - 0.5) * 0.01,
            shelfY + h / 2,
            -coverW / 2 + (rand() - 0.5) * 0.03,
          ],
          lean,
          source: apiBook ? 'api' : 'decorative',
          listing: apiBook?.listing || null,
          bookId: apiBook?.bookId || null,
          shelfIndex: s,
          caseIndex: c,
        });

        cursorX += thickness + 0.018 + rand() * 0.02;
        slot++;
      }

      // A few books lying flat on top of the row (visual richness)
      if (rand() < 0.35 && slot < totalSlots) {
        const thickness = 0.08 + rand() * 0.05;
        const h = 0.3 + rand() * 0.08;
        const coverW = 0.22 + rand() * 0.08;
        const apiBook = apiBooks[slot];
        books.push({
          key: `book-${slot}`,
          slot,
          title: apiBook?.title || DECOR_TITLES[(slot + 5) % DECOR_TITLES.length],
          author: apiBook?.author || 'MRV Press',
          color: apiBook?.color || SPINE_COLORS[Math.floor(rand() * SPINE_COLORS.length)],
          size: { w: coverW, h, d: thickness },
          position: [
            cursorX + coverW / 2,
            shelfY + thickness / 2 + 0.01,
            -h / 2 - 0.02,
          ],
          lean: 0,
          flat: true,
          source: apiBook ? 'api' : 'decorative',
          listing: apiBook?.listing || null,
          bookId: apiBook?.bookId || null,
          shelfIndex: s,
          caseIndex: c,
        });
        slot++;
      }
    }
  }
  return books;
}

function Bookcase({ x }) {
  const wood = useMemo(() => new THREE.MeshStandardMaterial({ color: '#4a3020', roughness: 0.85 }), []);
  const back = useMemo(() => new THREE.MeshStandardMaterial({ color: '#3a2416', roughness: 0.9 }), []);
  const shelfCount = SHELVES_PER_CASE;

  return (
    <group position={[x, 0, -0.32]}>
      {/* Back panel */}
      <mesh position={[0, CASE_HEIGHT / 2, -CASE_DEPTH / 2]} material={back} receiveShadow>
        <boxGeometry args={[CASE_WIDTH, CASE_HEIGHT, 0.04]} />
      </mesh>
      {/* Sides */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * CASE_WIDTH / 2, CASE_HEIGHT / 2, 0]} material={wood} castShadow receiveShadow>
          <boxGeometry args={[0.06, CASE_HEIGHT, CASE_DEPTH]} />
        </mesh>
      ))}
      {/* Top & bottom */}
      <mesh position={[0, CASE_HEIGHT - 0.03, 0]} material={wood} castShadow receiveShadow>
        <boxGeometry args={[CASE_WIDTH + 0.06, 0.06, CASE_DEPTH]} />
      </mesh>
      <mesh position={[0, 0.28, 0]} material={wood} castShadow receiveShadow>
        <boxGeometry args={[CASE_WIDTH + 0.06, 0.06, CASE_DEPTH]} />
      </mesh>
      {/* Shelves */}
      {Array.from({ length: shelfCount }).map((_, i) => (
        <mesh
          key={i}
          position={[0, 0.55 + i * ((CASE_HEIGHT - 0.7) / shelfCount) - 0.02, 0]}
          material={wood}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[CASE_WIDTH, 0.05, CASE_DEPTH]} />
        </mesh>
      ))}
      {/* Crown moulding */}
      <mesh position={[0, CASE_HEIGHT + 0.06, 0]} material={wood} castShadow>
        <boxGeometry args={[CASE_WIDTH + 0.2, 0.1, CASE_DEPTH + 0.08]} />
      </mesh>
    </group>
  );
}

export default function Shelf({ books, heldKey, onSelectBook }) {
  const floorTex = useMemo(() => makeFloorTexture(), []);
  const totalWidth = BOOKCASES * (CASE_WIDTH + GAP);

  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 1]} receiveShadow>
        <planeGeometry args={[totalWidth + 14, 14]} />
        <meshStandardMaterial map={floorTex} roughness={0.9} />
      </mesh>

      {/* Back wall */}
      <mesh position={[0, 3, -0.62]} receiveShadow>
        <planeGeometry args={[totalWidth + 14, 9]} />
        <meshStandardMaterial color="#2b2118" roughness={0.95} />
      </mesh>

      {/* Bookcases */}
      {Array.from({ length: BOOKCASES }).map((_, i) => (
        <Bookcase
          key={i}
          x={-((BOOKCASES - 1) * (CASE_WIDTH + GAP)) / 2 + i * (CASE_WIDTH + GAP)}
        />
      ))}

      {/* Books */}
      {books.map((b) => (
        <Book key={b.key} book={b} isHeld={heldKey === b.key} onSelect={onSelectBook} />
      ))}
    </group>
  );
}
