import { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  makeSpineTexture,
  makeCoverTexture,
  makePagesTexture,
  makeLeftPageTexture,
  makeRightPageTexture,
} from './textures';

/**
 * An individual book.
 *
 * Local "reading pose": front cover faces +Z, spine at the -X edge.
 * Shelf pose: rotated +90° around Y so the spine faces the viewer.
 *
 * When held: the book follows a camera-relative position ("your hands"),
 * tilts naturally, and the front cover swings open around the spine hinge.
 */

// Where the book floats in camera space: left of centre (clear of the
// action panel), just below centre, arm's length
const HELD_OFFSET = new THREE.Vector3(-0.05, 0.02, -0.8);
// Natural reading tilt applied in camera space
const HELD_TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.06, 0.1, -0.04));
// Cover swings open almost flat so the spread faces the reader (like a real opened book)
const OPEN_ANGLE = -3.05;

// Shared pages texture (one canvas for the whole app)
let sharedPagesTexture = null;
function getPagesTexture() {
  if (!sharedPagesTexture) sharedPagesTexture = makePagesTexture();
  return sharedPagesTexture;
}

// Spine textures are cached by title+color so repeated titles share GPU memory
const spineCache = new Map();
function getCachedSpine(book) {
  const key = `${book.title}|${book.author}|${book.color}`;
  if (!spineCache.has(key)) {
    if (spineCache.size > 60) spineCache.delete(spineCache.keys().next().value);
    spineCache.set(key, makeSpineTexture(book));
  }
  return spineCache.get(key);
}

// Cover textures are only generated for books the user actually opens
const coverCache = new Map();
function getCachedCover(book) {
  const key = `${book.title}|${book.author}|${book.color}`;
  if (!coverCache.has(key)) {
    if (coverCache.size > 40) coverCache.delete(coverCache.keys().next().value);
    coverCache.set(key, makeCoverTexture(book));
  }
  return coverCache.get(key);
}

// Inner detail pages — generated only while a book is held open
const leftPageCache = new Map();
const rightPageCache = new Map();
function pageKey(book) {
  const l = book.listing;
  return `${book.title}|${book.author}|${l ? `${l.id}|${l.listing_type}|${l.price}|${l.book_condition}` : 'decor'}`;
}
function getCachedLeftPage(book) {
  const key = pageKey(book);
  if (!leftPageCache.has(key)) {
    if (leftPageCache.size > 24) leftPageCache.delete(leftPageCache.keys().next().value);
    leftPageCache.set(key, makeLeftPageTexture(book));
  }
  return leftPageCache.get(key);
}
function getCachedRightPage(book) {
  const key = pageKey(book);
  if (!rightPageCache.has(key)) {
    if (rightPageCache.size > 24) rightPageCache.delete(rightPageCache.keys().next().value);
    rightPageCache.set(key, makeRightPageTexture(book));
  }
  return rightPageCache.get(key);
}

export default function Book({ book, isHeld, onSelect }) {
  const group = useRef();
  const coverPivot = useRef();
  const { camera } = useThree();
  const [hovered, setHovered] = useState(false);
  const openAmount = useRef(0);

  const { w, h, d } = book.size; // cover-width(X) x height(Y) x thickness(Z), reading pose
  const t = Math.min(0.02, Math.max(0.008, d * 0.07)); // cover board thickness

  const spineTex = useMemo(
    () => getCachedSpine(book),
    [book.title, book.color, book.author]
  );
  const coverTex = useMemo(
    () => (isHeld || hovered ? getCachedCover(book) : null),
    [isHeld, hovered, book.title, book.color]
  );
  // Detail pages only exist while the book is open in your hands
  const leftPageTex = useMemo(
    () => (isHeld ? getCachedLeftPage(book) : null),
    [isHeld, book.title, book.author, book.listing]
  );
  const rightPageTex = useMemo(
    () => (isHeld ? getCachedRightPage(book) : null),
    [isHeld, book.title, book.author, book.listing]
  );
  const pagesTex = getPagesTexture();

  // Material sets. BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z.
  const mats = useMemo(() => {
    const edge = new THREE.MeshStandardMaterial({ color: book.color, roughness: 0.7, metalness: 0.03 });
    const spine = new THREE.MeshStandardMaterial({ map: spineTex, roughness: 0.68, metalness: 0.03 });
    const coverFront = coverTex
      ? new THREE.MeshStandardMaterial({ map: coverTex, roughness: 0.66, metalness: 0.03 })
      : edge;
    const inside = new THREE.MeshStandardMaterial({ color: '#efe7d3', roughness: 0.9 });
    const foreEdge = new THREE.MeshStandardMaterial({ color: '#e9dfc6', roughness: 0.95 });
    // While open: real detail pages (basic material keeps the text crisp)
    const coverInner = leftPageTex
      ? new THREE.MeshBasicMaterial({ map: leftPageTex, toneMapped: false })
      : inside;
    const pageFront = rightPageTex
      ? new THREE.MeshBasicMaterial({ map: rightPageTex, toneMapped: false })
      : foreEdge;
    const pageSide = new THREE.MeshStandardMaterial({ map: pagesTex, roughness: 0.95 });
    const pageEdge = new THREE.MeshStandardMaterial({ color: '#efe6cf', roughness: 0.95 });

    // Dispose previous set when inputs change
    return {
      edge, spine, coverFront, inside, coverInner, pageFront, pageSide, pageEdge, foreEdge,
      coverSet: [edge, edge, edge, edge, coverFront, coverInner],
      pageSet: [pageSide, pageSide, pageEdge, pageEdge, pageFront, pageEdge],
      edgeSet: [edge, edge, edge, edge, edge, edge],
    };
  }, [book.color, spineTex, coverTex, leftPageTex, rightPageTex, pagesTex]);

  // Dispose GPU materials on unmount / rebuild
  useEffect(() => () => {
    [mats.edge, mats.spine, mats.coverFront, mats.inside, mats.coverInner, mats.pageFront,
      mats.pageSide, mats.pageEdge, mats.foreEdge]
      .forEach((m) => m.dispose());
  }, [mats]);

  const shelfPos = useMemo(() => new THREE.Vector3(...book.position), [book.position]);
  // Flat books lie cover-up; standing books show their spine to the viewer
  const shelfQuat = useMemo(() => {
    if (book.flat) {
      return new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    }
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
  }, [book.flat]);

  const scratch = useMemo(() => ({
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    right: new THREE.Vector3(),
    tilt: HELD_TILT.clone(),
  }), []);

  useEffect(() => {
    document.body.style.cursor = hovered || isHeld ? 'pointer' : 'auto';
    return () => { document.body.style.cursor = 'auto'; };
  }, [hovered, isHeld]);

  // Demo-style beats: fly over (~0.6s), cover faces you, THEN swing open
  const prevHeld = useRef(false);
  const holdStart = useRef(0);
  const flyP = useRef(0);
  const OPEN_DELAY = 0.55; // seconds of "cover facing you" before opening

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    // Frame-rate independent lerp factor
    const blend = (rate) => 1 - Math.pow(0.0008, Math.min(delta, 0.1) * rate);

    if (isHeld) {
      if (!prevHeld.current) {
        prevHeld.current = true;
        holdStart.current = state.clock.elapsedTime;
        flyP.current = 0;
      }
      const heldFor = state.clock.elapsedTime - holdStart.current;
      // Hold the cover closed for a beat, then ease it open
      const opening = heldFor > OPEN_DELAY;
      openAmount.current = THREE.MathUtils.damp(
        openAmount.current, opening ? 1 : 0, opening ? 3 : 8, delta
      );

      scratch.pos.copy(HELD_OFFSET).applyQuaternion(camera.quaternion).add(camera.position);
      // The open spread extends left of the hinge — nudge right to keep it centred
      scratch.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      scratch.pos.addScaledVector(
        scratch.right,
        openAmount.current * book.size.w * 0.5 * g.scale.x
      );
      scratch.quat.copy(camera.quaternion).multiply(scratch.tilt);

      // Slower, deliberate flight with a gentle lift arc
      flyP.current = THREE.MathUtils.damp(flyP.current, 1, 1.8, delta);
      g.position.lerp(scratch.pos, blend(0.65));
      g.quaternion.slerp(scratch.quat, blend(0.65));
      g.position.y += Math.sin(Math.PI * flyP.current) * 0.05;
      g.scale.setScalar(THREE.MathUtils.damp(g.scale.x, 1.0, 4, delta));
    } else {
      prevHeld.current = false;
      flyP.current = THREE.MathUtils.damp(flyP.current, 0, 4, delta);
      openAmount.current = THREE.MathUtils.damp(openAmount.current, 0, 7, delta);

      scratch.pos.copy(shelfPos);
      if (hovered) {
        scratch.pos.y += 0.05;
        scratch.pos.z += 0.05;
      }
      g.position.lerp(scratch.pos, blend(hovered ? 9 : 5));
      g.quaternion.slerp(shelfQuat, blend(5));
      g.scale.setScalar(THREE.MathUtils.damp(g.scale.x, hovered ? 1.05 : 1, 10, delta));
    }

    if (coverPivot.current) {
      coverPivot.current.rotation.y = openAmount.current * OPEN_ANGLE;
    }

    // Gentle breathing motion while held
    if (isHeld) {
      g.position.y += Math.sin(state.clock.elapsedTime * 1.6) * 0.006;
    }
  });

  const handleClick = (e) => {
    e.stopPropagation();
    if (!isHeld) onSelect(book);
  };

  return (
    <group
      ref={group}
      position={book.position}
      quaternion={shelfQuat}
      onClick={handleClick}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
    >
      {/* Back cover */}
      <mesh position={[0, 0, -(d / 2 - t / 2)]} castShadow receiveShadow material={mats.edgeSet}>
        <boxGeometry args={[w, h, t]} />
      </mesh>

      {/* Pages block */}
      <mesh position={[0, 0, 0]} castShadow receiveShadow material={mats.pageSet}>
        <boxGeometry args={[w * 0.96, h * 0.96, Math.max(0.006, d - 2 * t)]} />
      </mesh>

      {/* Spine strip (binding at the left edge) */}
      <mesh position={[-w / 2 + t / 2, 0, 0]} castShadow material={mats.spine}>
        <boxGeometry args={[t * 1.2, h, d]} />
      </mesh>

      {/* Front cover, hinged on the spine */}
      <group ref={coverPivot} position={[-w / 2, 0, d / 2 - t / 2]}>
        <mesh position={[w / 2, 0, 0]} castShadow receiveShadow material={mats.coverSet}>
          <boxGeometry args={[w, h, t]} />
        </mesh>
      </group>
    </group>
  );
}
