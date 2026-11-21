import { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  makeSpineTexture,
  makeCoverTexture,
  makePagesTexture,
  makePageTexture,
} from './textures';
import { bookScroll, resetScroll, pushScroll } from './bookScrollStore';

/**
 * A book you can read: click to fly it into your hands, then scroll to turn
 * pages side by side. A single curved leaf sweeps across on each turn while
 * the static left/right pages underneath update to the current spread.
 */

const HELD_OFFSET = new THREE.Vector3(-0.05, 0.02, -0.8);
const HELD_TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.06, 0.1, -0.04));
const OPEN_ANGLE = Math.PI - 0.09;
const TOTAL_SPREADS = 3; // 6 printed pages

let sharedPagesTexture = null;
function getPagesTexture() {
  if (!sharedPagesTexture) sharedPagesTexture = makePagesTexture();
  return sharedPagesTexture;
}

/* ---- texture caches ------------------------------------------------ */
const spineCache = new Map();
const coverCache = new Map();
const pageCache = new Map();
function keyFor(book) { return `${book.title}|${book.author}|${book.color}`; }

function getCachedSpine(book) {
  const key = keyFor(book);
  if (!spineCache.has(key)) {
    if (spineCache.size > 60) spineCache.delete(spineCache.keys().next().value);
    spineCache.set(key, makeSpineTexture(book));
  }
  return spineCache.get(key);
}
function getCachedCover(book) {
  const key = keyFor(book);
  if (!coverCache.has(key)) {
    if (coverCache.size > 40) coverCache.delete(coverCache.keys().next().value);
    coverCache.set(key, makeCoverTexture(book));
  }
  return coverCache.get(key);
}
function getCachedPage(book, index) {
  const l = book.listing;
  const key = `${index}|${keyFor(book)}|${l ? `${l.id}|${l.listing_type}|${l.price}|${l.book_condition}` : 'decor'}`;
  if (!pageCache.has(key)) {
    if (pageCache.size > 48) pageCache.delete(pageCache.keys().next().value);
    pageCache.set(key, makePageTexture(book, index));
  }
  return pageCache.get(key);
}

/* ---- curved turning leaf ------------------------------------------- */
function makeTurnGeometry(width, height, segments = 16) {
  const g = new THREE.BoxGeometry(width, height, 0.006, segments, 1, 1);
  g.translate(width / 2, 0, 0); // hinge at spine (x = 0)
  const pos = g.attributes.position;
  g.userData.restX = new Float32Array(pos.array);
  g.userData.restZ = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) g.userData.restZ[i] = pos.getZ(i);
  g.userData.width = width;
  return g;
}

function bendTurn(geo, bend) {
  const pos = geo.attributes.position;
  const restX = geo.userData.restX;
  const restZ = geo.userData.restZ;
  const w = geo.userData.width;
  for (let i = 0; i < pos.count; i++) {
    const u = w > 0 ? restX[i * 3] / w : 0; // 0 at spine, 1 at free edge
    pos.setZ(i, restZ[i] + Math.sin(u * Math.PI) * bend * w * 0.28);
  }
  pos.needsUpdate = true;
}

/* ---- a static page plane ------------------------------------------- */
function PagePlane({ texture, geometry }) {
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({
      map: texture, toneMapped: false, side: THREE.DoubleSide,
    }),
    [texture]
  );
  return <mesh geometry={geometry} material={mat} />;
}

export default function Book({ book, isHeld, onSelect }) {
  const group = useRef();
  const turnPivot = useRef();
  const { camera } = useThree();
  const [hovered, setHovered] = useState(false);
  const openAmount = useRef(0);
  const [spread, setSpread] = useState(0); // current 0-based spread index
  const [spreadVisible, setSpreadVisible] = useState(false);

  const { w, h, d } = book.size;
  const t = Math.min(0.02, Math.max(0.008, d * 0.07));

  const spineTex = useMemo(() => getCachedSpine(book), [book.title, book.color, book.author]);
  const coverTex = useMemo(
    () => (isHeld || hovered ? getCachedCover(book) : null),
    [isHeld, hovered, book.title, book.color]
  );
  const pagesTex = getPagesTexture();

  const pageTextures = useMemo(
    () => (isHeld ? Array.from({ length: 6 }, (_, i) => getCachedPage(book, i)) : []),
    [isHeld, book.title, book.author, book.listing]
  );

  // Two static page planes + one turning leaf, all hinged geometry
  const pageGeo = useMemo(() => makeTurnGeometry(w * 0.97, h * 0.96, 2), [w, h]);
  const turnGeo = useMemo(() => makeTurnGeometry(w * 0.97, h * 0.96, 16), [w, h]);
  useEffect(() => () => {
    pageGeo.dispose(); turnGeo.dispose();
  }, [pageGeo, turnGeo]);

  // Materials for the static/turning surfaces
  const coverMat = useMemo(
    () => new THREE.MeshStandardMaterial({
      map: coverTex || spineTex, color: coverTex ? '#ffffff' : book.color,
      roughness: 0.66, metalness: 0.03,
    }),
    [coverTex, spineTex, book.color]
  );
  // The turning leaf shows the cover on the first turn, then printed pages
  const turnTex = bookScroll.target <= 1 ? (coverTex || pagesTex) : (pageTextures[spread * 2] || pagesTex);
  const paperMat = useMemo(() => new THREE.MeshBasicMaterial({
    map: turnTex, toneMapped: false, side: THREE.DoubleSide,
  }), [turnTex]);

  /* ---- Book body materials (box order +X,-X,+Y,-Y,+Z,-Z) --------- */
  const mats = useMemo(() => {
    const edge = new THREE.MeshStandardMaterial({ color: book.color, roughness: 0.7 });
    const spine = new THREE.MeshStandardMaterial({ map: spineTex, roughness: 0.68 });
    const inside = new THREE.MeshStandardMaterial({ color: '#efe7d3', roughness: 0.9 });
    const foreEdge = new THREE.MeshStandardMaterial({ color: '#e9dfc6', roughness: 0.95 });
    const pageSide = new THREE.MeshStandardMaterial({ map: pagesTex, roughness: 0.95 });
    const pageEdge = new THREE.MeshStandardMaterial({ color: '#efe6cf', roughness: 0.95 });
    return {
      edge, spine, inside, foreEdge,
      coverSet: [edge, edge, edge, edge, coverMat, inside],
      pageSet: [pageSide, pageSide, pageEdge, pageEdge, foreEdge, pageEdge],
      edgeSet: [edge, edge, edge, edge, edge, edge],
      dispose: [edge, spine, inside, foreEdge, pageSide, pageEdge, coverMat, paperMat],
    };
  }, [book.color, spineTex, pagesTex, coverMat, paperMat]);
  useEffect(() => () => mats.dispose.forEach((m) => m.dispose()), [mats]);

  const shelfPos = useMemo(() => new THREE.Vector3(...book.position), [book.position]);
  const shelfQuat = useMemo(() => book.flat
    ? new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
    : new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), [book.flat]);

  const scratch = useMemo(() => ({
    pos: new THREE.Vector3(), quat: new THREE.Quaternion(),
    right: new THREE.Vector3(), tilt: HELD_TILT.clone(),
  }), []);

  /* ---- flight/open + scroll --------------------------------------- */
  const prevHeld = useRef(false);
  const holdStart = useRef(0);
  const flyP = useRef(0);
  const OPEN_DELAY = 0.55;

  useEffect(() => {
    document.body.style.cursor = hovered || isHeld ? 'pointer' : 'auto';
    return () => { document.body.style.cursor = 'auto'; };
  }, [hovered, isHeld]);

  useEffect(() => {
    bookScroll.active = isHeld;
    if (!isHeld) resetScroll();
    if (!isHeld) return;
    const wheel = (e) => { e.preventDefault(); pushScroll(e.deltaY); };
    let touchY = 0;
    const start = (e) => { touchY = e.touches[0].clientY; };
    const move = (e) => {
      const y = e.touches[0].clientY;
      pushScroll((touchY - y) * 2);
      touchY = y;
    };
    window.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    return () => {
      bookScroll.active = false;
      window.removeEventListener('wheel', wheel);
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
    };
  }, [isHeld]);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const blend = (rate) => 1 - Math.pow(0.0008, Math.min(delta, 0.1) * rate);

    if (isHeld) {
      if (!prevHeld.current) {
        prevHeld.current = true;
        holdStart.current = state.clock.elapsedTime;
        flyP.current = 0;
        setSpread(0);
      }
      const heldFor = state.clock.elapsedTime - holdStart.current;
      const opening = heldFor > OPEN_DELAY;
      openAmount.current = THREE.MathUtils.damp(
        openAmount.current, opening ? 1 : 0, opening ? 3 : 8, delta
      );
      const shouldShow = opening && openAmount.current > 0.15;
      if (shouldShow !== spreadVisible) setSpreadVisible(shouldShow);

      scratch.pos.copy(HELD_OFFSET).applyQuaternion(camera.quaternion).add(camera.position);
      scratch.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      scratch.pos.addScaledVector(scratch.right, openAmount.current * w * 0.5 * g.scale.x);
      scratch.quat.copy(camera.quaternion).multiply(scratch.tilt);

      flyP.current = THREE.MathUtils.damp(flyP.current, 1, 1.8, delta);
      g.position.lerp(scratch.pos, blend(0.65));
      g.quaternion.slerp(scratch.quat, blend(0.65));
      g.position.y += Math.sin(Math.PI * flyP.current) * 0.05;
      g.scale.setScalar(THREE.MathUtils.damp(g.scale.x, 1.0, 4, delta));
      g.position.y += Math.sin(state.clock.elapsedTime * 1.6) * 0.006;
    } else {
      prevHeld.current = false;
      if (spreadVisible) setSpreadVisible(false);
      flyP.current = THREE.MathUtils.damp(flyP.current, 0, 4, delta);
      openAmount.current = THREE.MathUtils.damp(openAmount.current, 0, 7, delta);
      scratch.pos.copy(shelfPos);
      if (hovered) { scratch.pos.y += 0.05; scratch.pos.z += 0.05; }
      g.position.lerp(scratch.pos, blend(hovered ? 9 : 5));
      g.quaternion.slerp(shelfQuat, blend(5));
      g.scale.setScalar(THREE.MathUtils.damp(g.scale.x, hovered ? 1.05 : 1, 10, delta));
    }

    // Ease scroll and derive current spread / turn progress
    bookScroll.current = THREE.MathUtils.damp(bookScroll.current, bookScroll.target, 1.8, delta);
    const targetSpread = Math.min(TOTAL_SPREADS - 1, Math.floor(bookScroll.target / 2));
    if (targetSpread !== spread) setSpread(targetSpread);

    const turnP = bookScroll.current - Math.floor(bookScroll.current / 2) * 2;
    // Turn progress within the current step (0..1) from fractional part
    const stepFrac = bookScroll.current - Math.floor(bookScroll.current);
    const turning = isHeld && openAmount.current > 0.5 && bookScroll.target > 0;
    const midTurn = turning && stepFrac > 0.02 && stepFrac < 0.98;
    if (turnPivot.current) {
      turnPivot.current.visible = midTurn;
      turnPivot.current.rotation.y = midTurn ? -OPEN_ANGLE * stepFrac : 0;
    }
    if (midTurn) bendTurn(turnGeo, Math.sin(stepFrac * Math.PI));
    else bendTurn(turnGeo, 0);
  });

  const handleClick = (e) => {
    e.stopPropagation();
    if (!isHeld) onSelect(book);
  };

  const leftTex = pageTextures[spread * 2] || pagesTex;
  const rightTex = pageTextures[spread * 2 + 1] || pagesTex;
  // `spreadVisible` is React state (flipped by the frame loop after the
  // open beat) so the spread meshes mount/unmount at the right time.
  const showSpread = isHeld && spreadVisible;

  return (
    <group
      ref={group}
      position={book.position}
      quaternion={shelfQuat}
      onClick={handleClick}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
    >
      {/* Back cover + page stack */}
      <mesh position={[0, 0, -(d / 2 - t / 2)]} castShadow receiveShadow material={mats.edgeSet}>
        <boxGeometry args={[w, h, t]} />
      </mesh>
      <mesh position={[0, 0, 0]} castShadow receiveShadow material={mats.pageSet}>
        <boxGeometry args={[w * 0.96, h * 0.96, Math.max(0.006, d - 2 * t)]} />
      </mesh>
      <mesh position={[-w / 2 + t / 2, 0, 0]} castShadow material={mats.spine}>
        <boxGeometry args={[t * 1.2, h, d]} />
      </mesh>

      {/* Front cover — visible on the shelf, swung flat once opened */}
      {!showSpread && (
        <group position={[-w / 2 + t / 2, 0, d / 2 - t / 2]}>
          <mesh material={mats.coverSet} castShadow receiveShadow>
            <boxGeometry args={[w, h, t]} />
          </mesh>
        </group>
      )}
      {/* While reading, the cloth cover lies flat on the left of the spread */}
      {showSpread && (
        <group position={[-w / 2 + t / 2, 0, d / 2 + 0.006]} rotation={[0, -OPEN_ANGLE, 0]}>
          <mesh material={coverMat}>
            <boxGeometry args={[w, h, t]} />
          </mesh>
        </group>
      )}

      {/* Open spread: static left + right pages, hinged at the spine */}
      {showSpread && (
        <group position={[-w / 2 + t / 2, 0, d / 2 + 0.012]}>
          {/* Left page faces up after the cover opens (rotated flat to -X) */}
          <group rotation={[0, -OPEN_ANGLE, 0]}>
            <PagePlane texture={leftTex} geometry={pageGeo} />
          </group>
          {/* Right page stays on the right */}
          <PagePlane texture={rightTex} geometry={pageGeo} />
        </group>
      )}

      {/* The turning leaf sweeps right-to-left as you scroll (visibility
          is driven imperatively in useFrame — React never re-renders here) */}
      <group
        ref={turnPivot}
        position={[-w / 2 + t / 2, 0, d / 2 + 0.022]}
        visible={false}
      >
        <mesh geometry={turnGeo} material={paperMat} />
      </group>
    </group>
  );
}
