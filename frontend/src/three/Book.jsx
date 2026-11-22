import { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  makeSpineTexture,
  makeCoverTexture,
  makePagesTexture,
  makePageTexture,
} from './textures';
import { bookScroll, resetScroll, pushScroll, turnBy, setShownStep } from './bookScrollStore';
import { playPageFlip } from './pageSound';

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

/* ---- curved turning page ------------------------------------------- */
function makeTurnGeometry(width, height, segments = 16) {
  // A single plane (not a box) avoids double-face ghosting while bending.
  const g = new THREE.PlaneGeometry(width, height, segments, 2);
  g.translate(width / 2, 0, 0); // hinge at spine (x = 0)
  const pos = g.attributes.position;
  g.userData.restX = new Float32Array(pos.array);
  g.userData.width = width;
  return g;
}

function bendTurn(geo, bend, sweep = 0) {
  const pos = geo.attributes.position;
  const restX = geo.userData.restX;
  const w = geo.userData.width;
  for (let i = 0; i < pos.count; i++) {
    const u = w > 0 ? restX[i * 3] / w : 0; // 0 at spine, 1 at free edge
    const wave = Math.sin((u * 0.85 + sweep * 0.35) * Math.PI);
    pos.setZ(i, wave * (0.55 + 0.25 * sweep) * bend * w);
  }
  pos.needsUpdate = true;
}

/** Smoothstep — slow at the ends, quick through the middle (weighted flip). */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/* ---- a page plane --------------------------------------------------- */
function PagePlane({ texture, backTexture, geometry, planeRef, flipU = false }) {
  const mat = useMemo(() => {
    let map = texture;
    if (flipU && texture) {
      map = texture.clone();
      map.wrapS = THREE.RepeatWrapping;
      map.repeat.x = -1;
      map.offset.x = 1;
      map.needsUpdate = true;
    }
    return new THREE.MeshBasicMaterial({ map, toneMapped: false, side: THREE.DoubleSide });
  }, [texture, flipU]);
  return (
    <group ref={planeRef}>
      <mesh geometry={geometry} material={mat} frustumCulled={false} />
    </group>
  );
}

export default function Book({ book, isHeld, onSelect }) {
  const group = useRef();
  const rightPlane = useRef();
  const { camera } = useThree();
  const [hovered, setHovered] = useState(false);
  const openAmount = useRef(0);
  const [spread, setSpread] = useState(0); // current 0-based spread index
  const [spreadVisible, setSpreadVisible] = useState(false);

  const { w, h, d } = book.size;
  const t = Math.min(0.02, Math.max(0.008, d * 0.07));
  // A few thin sheets under the turning page give the stack real thickness
  const underLeaves = useRef([]);

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

  // Two static page planes + one curlable right page, all hinged geometry
  const pageGeo = useMemo(() => makeTurnGeometry(w * 0.97, h * 0.96, 2), [w, h]);
  const curlGeo = useMemo(() => makeTurnGeometry(w * 0.97, h * 0.96, 20), [w, h]);
  useEffect(() => () => {
    pageGeo.dispose(); curlGeo.dispose();
  }, [pageGeo, curlGeo]);

  // Materials for the static/turning surfaces
  const coverMat = useMemo(
    () => new THREE.MeshStandardMaterial({
      map: coverTex || spineTex, color: coverTex ? '#ffffff' : book.color,
      roughness: 0.66, metalness: 0.03,
    }),
    [coverTex, spineTex, book.color]
  );
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
      dispose: [edge, spine, inside, foreEdge, pageSide, pageEdge, coverMat],
    };
  }, [book.color, spineTex, pagesTex, coverMat]);
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
  const turnRef = useRef({ lastTarget: 0, shownStep: 0, flip: 0, dir: 1, from: 0 });

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
    const key = (e) => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault(); turnBy(1);
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) {
        e.preventDefault(); turnBy(-1);
      }
    };
    window.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('keydown', key);
    return () => {
      bookScroll.active = false;
      window.removeEventListener('wheel', wheel);
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('keydown', key);
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

      // Build ONE stable target (offset + centering + arc + breathing), then
      // ease the group toward it. Adding motion AFTER a lerp each frame is
      // what caused the visible shaking while turning pages.
      flyP.current = THREE.MathUtils.damp(flyP.current, 1, 1.5, delta);
      const settle = 1 - flyP.current;
      const arc = Math.sin(Math.PI * Math.pow(flyP.current, 0.7));
      const breath = Math.sin(state.clock.elapsedTime * 1.1) * 0.003;

      scratch.pos.copy(HELD_OFFSET).applyQuaternion(camera.quaternion).add(camera.position);
      scratch.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      scratch.pos.addScaledVector(scratch.right, openAmount.current * w * 0.5 * g.scale.x);
      scratch.pos.y += arc * 0.06 + breath;
      g.position.lerp(scratch.pos, blend(0.9));

      // Stable rotation target: tilt eases from "arriving" to "reading"
      scratch.tilt.setFromEuler(new THREE.Euler(
        0.06 + settle * 0.12,
        0.1 + settle * 0.18,
        -0.04 + settle * 0.1
      ));
      scratch.quat.copy(camera.quaternion).multiply(scratch.tilt);
      g.quaternion.slerp(scratch.quat, blend(0.9));
      g.scale.setScalar(THREE.MathUtils.damp(g.scale.x, 1.0, 3, delta));
    } else {
      prevHeld.current = false;
      if (spreadVisible) setSpreadVisible(false);
      turnRef.current = { lastTarget: 0, shownStep: 0, flip: 0, dir: 1, from: 0 };
      flyP.current = THREE.MathUtils.damp(flyP.current, 0, 4, delta);
      openAmount.current = THREE.MathUtils.damp(openAmount.current, 0, 7, delta);
      scratch.pos.copy(shelfPos);
      if (hovered) { scratch.pos.y += 0.05; scratch.pos.z += 0.05; }
      g.position.lerp(scratch.pos, blend(hovered ? 9 : 5));
      g.quaternion.slerp(shelfQuat, blend(5));
      g.scale.setScalar(THREE.MathUtils.damp(g.scale.x, hovered ? 1.05 : 1, 10, delta));
    }

    // Turn animation: when the target step changes, run one weighted flip.
    const target = isHeld ? bookScroll.target : 0;
    if (target !== turnRef.current.lastTarget) {
      turnRef.current.lastTarget = target;
      if (target > turnRef.current.shownStep && turnRef.current.shownStep < 6) {
        turnRef.current.flip = 1;          // start a forward flip
        turnRef.current.dir = 1;
        turnRef.current.from = turnRef.current.shownStep;
        playPageFlip(1);
      } else if (target < turnRef.current.shownStep) {
        turnRef.current.flip = 1;          // start a reverse flip
        turnRef.current.dir = -1;
        turnRef.current.from = turnRef.current.shownStep;
        playPageFlip(-1);
      }
    }
    // advance the current flip (duration ~0.62s), then commit the new page
    if (turnRef.current.flip > 0) {
      // Clamp per-frame progress so even low-FPS/software rendering shows
      // several distinct frames of the roll instead of jumping instantly.
      turnRef.current.flip = Math.max(0, turnRef.current.flip - Math.min(delta / 0.62, 0.18));
      const p = 1 - turnRef.current.flip;            // 0..1
      const e = easeInOutCubic(p);
      const mid = Math.sin(p * Math.PI);             // 0..1..0
      // Lift and curl the right-hand page itself so the roll is always
      // visible — it's the same mesh that carries the printed page.
      if (rightPlane.current) {
        rightPlane.current.rotation.y = OPEN_ANGLE * e * 0.9 * turnRef.current.dir;
        rightPlane.current.position.z = mid * w * 0.25;
        rightPlane.current.position.y = mid * h * 0.04;
        // stacked sheets peel with a slight stagger
        underLeaves.current.forEach((leaf, i) => {
          if (!leaf) return;
          leaf.visible = false;
        });
      }
      bendTurn(curlGeo, mid, p);
      if (turnRef.current.flip === 0) {
        turnRef.current.shownStep = target;
        setShownStep(target);
        bookScroll.turns++;
        if (rightPlane.current) {
          rightPlane.current.rotation.y = 0;
          rightPlane.current.position.set(0, 0, 0);
        }
        underLeaves.current.forEach((leaf) => {
          if (leaf) { leaf.visible = false; leaf.rotation.y = 0; leaf.position.set(0, 0, 0); }
        });
        bendTurn(curlGeo, 0, 0);
      }
    } else {
      turnRef.current.shownStep = target;
      if (rightPlane.current) {
        rightPlane.current.rotation.y = 0;
        rightPlane.current.position.set(0, 0, 0);
      }
      underLeaves.current.forEach((leaf) => {
        if (leaf) { leaf.visible = false; leaf.rotation.y = 0; leaf.position.set(0, 0, 0); }
      });
    }
    // Commit the printed spread only when the flip has fully settled —
    // swapping textures mid-turn reads as a visible pop/shake.
    const targetSpread = Math.max(0, Math.min(TOTAL_SPREADS - 1, Math.floor(turnRef.current.shownStep / 2)));
    if (targetSpread !== spread) setSpread(targetSpread);
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
          {/* inner face is plain cream endpaper; cloth faces away */}
          <mesh material={mats.inside}>
            <boxGeometry args={[w, h, t]} />
          </mesh>
        </group>
      )}

      {/* Open spread: static left + right pages, hinged at the spine */}
      {showSpread && (
        <group position={[-w / 2 + t / 2, 0, d / 2 + 0.012]}>
          {/* Left page lies flat to the left of the spine */}
          <group rotation={[0, -OPEN_ANGLE, 0]}>
            <PagePlane texture={leftTex} geometry={pageGeo} flipU />
          </group>
          {/* Thin sheets beneath the turning page — they peel with a stagger */}
          {/* Right page — curls and lifts as it rolls over */}
          <PagePlane
            texture={rightTex}
            geometry={curlGeo}
            planeRef={rightPlane}
          />
        </group>
      )}

    </group>
  );
}
