import { useRef, useMemo, useEffect, useState, memo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  makeSpineTexture,
  makeCoverTexture,
  makePagesTexture,
  makePageTexture,
  getSharedShelfCover,
} from './textures';
import { bookScroll, resetScroll, pushScroll, turnBy, setShownStep } from './bookScrollStore';
import { playPageFlip } from './pageSound';

/**
 * A book you can read. Based on the reference openable-book animation:
 *  - click -> the shelf copy hides and a hero copy flies out with an arc+spin
 *  - the front cover swings open on a real hinge
 *  - pages are bendable chains (segments curl, edge lags then catches up)
 *  - scroll / arrow keys turn pages; leaving flips pages back, shuts the
 *    cover and flies the book home.
 */

const HELD_OFFSET = new THREE.Vector3(-0.05, 0.02, -0.8);
const OPEN_ANGLE = -2.5;          // reference cover swing
const PAGE_FIN = 2.38;            // reference flat-on-left angle
const LEAF_COUNT = 6;             // 6 bendable leaves -> 6 turns
const SEGMENTS = 20;              // page bend resolution

/* ---- tween helpers (frame-driven) ---------------------------------- */
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// smootherstep: zero velocity *and* zero acceleration at both ends, so the
// flight eases in and out without the small kick a plain cubic leaves behind.
const flyEase = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const sineEase = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

/* ---- camera-relative held pose ------------------------------------- */
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _qTilt = new THREE.Quaternion();
const _qRoll = new THREE.Quaternion();
const _qHeld = new THREE.Quaternion();

/**
 * Where the held book should point. The aisle camera walks looking down +X,
 * so a fixed world yaw of ~0 leaves the pages edge-on to the reader (that was
 * the "book is not facing me" bug). Derive the yaw from the camera every
 * frame instead, with a slight lean back and a whisper of roll.
 */
function heldQuat(camera) {
  _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  _qHeld.setFromAxisAngle(WORLD_UP, Math.atan2(-_fwd.x, -_fwd.z));
  _right.crossVectors(_fwd, WORLD_UP);            // screen-right axis
  if (_right.lengthSq() > 1e-6) {
    _right.normalize();
    _qTilt.setFromAxisAngle(_right, 0.05);        // top leans toward the reader
    _qHeld.premultiply(_qTilt);
  }
  _qRoll.setFromAxisAngle(_fwd, -0.02);
  _qHeld.premultiply(_qRoll);
  return _qHeld;
}

/* ---- texture caches ------------------------------------------------ */
const spineCache = new Map();
const coverCache = new Map();
const pageCache = new Map();
let sharedPagesTexture = null;
function getPagesTexture() {
  if (!sharedPagesTexture) sharedPagesTexture = makePagesTexture();
  return sharedPagesTexture;
}
function keyFor(book) { return `${book.title}|${book.author}|${book.color}`; }
function getCachedSpine(book) {
  const key = keyFor(book);
  if (!spineCache.has(key)) {
    if (spineCache.size > 140) spineCache.delete(spineCache.keys().next().value);
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

/**
 * Bend a page chain: a strip of segments positioned along an arc whose angle
 * grows toward the free edge. `a` = base angle (0 flat right, fin flat left),
 * `c` = curl (edge lags then catches up).
 */
function bendPage(L, a, c) {
  const pos = L.geo.attributes.position;
  const N = L.n;
  const sg = L.w / N;
  const mx = L.fin + 0.03;
  let x = 0, z = 0;
  for (let i = 0; i <= N; i++) {
    if (i) {
      const aj = Math.min(Math.max(a + (c * i) / N, 0), mx);
      x += sg * Math.cos(aj);
      z += sg * Math.sin(aj);
    }
    pos.setXYZ(i, x, L.h / 2, z);           // top row
    pos.setXYZ(N + 1 + i, x, -L.h / 2, z);  // bottom row
  }
  pos.needsUpdate = true;
  L.geo.computeVertexNormals();
  L.geo.computeBoundingSphere();
}

/** Build a bendable page geometry: two rows of N+1 vertices forming a strip. */
function makePageChain(width, height, segments) {
  const geo = new THREE.PlaneGeometry(width, height, segments, 1);
  // Reposition vertices as two horizontal rows so bendPage's indexing works:
  // row 0..N = top edge, row N+1..2N+1 = bottom edge.
  const pos = geo.attributes.position;
  for (let i = 0; i <= segments; i++) {
    const x = (i / segments) * width;
    pos.setXYZ(i, x, height / 2, 0);
    pos.setXYZ(segments + 1 + i, x, -height / 2, 0);
  }
  pos.needsUpdate = true;
  return geo;
}

function Book({ book, isHeld, onSelect }) {
  const group = useRef();
  const coverPivot = useRef();
  const shelfRef = useRef();          // shelf model (hidden while held)
  const heroRef = useRef();           // hero model (added when held)
  const { camera, scene } = useThree();
  const [hovered, setHovered] = useState(false);
  const [spread, setSpread] = useState(0);
  const [spreadVisible, setSpreadVisible] = useState(false);

  const { w, h, d } = book.size;
  const thickness = Math.max(0.006, d - 0.012);
  // Held size: shelf books vary in cover width, so cap the hero's held scale
  // to keep the open spread inside the viewport on every book.
  const heldScale = Math.min(1, 0.27 / w);

  const spineTex = useMemo(() => getCachedSpine(book), [book.title, book.color, book.author]);
  // Held books get their fully printed cover; shelf books share one cloth
  // cover texture so ~1000 closed books don't each need a 512x704 canvas.
  const coverTex = useMemo(
    () => (isHeld ? getCachedCover(book) : getSharedShelfCover(book.color)),
    [isHeld, book.title, book.color, book.author]
  );
  const pagesTex = getPagesTexture();
  // Slot plan for the 14 printed faces of the open hero book:
  //   0            = inside of the front cover (left page of spread 1)
  //   2i + 1       = front of leaf i  (right-hand page while it is on top)
  //   2i + 2       = back  of leaf i  (left-hand page once it has turned)
  //   2*LEAF_COUNT + 1 = top of the page block (final right-hand page)
  // Even slots are left-hand pages (gutter right), odd are right-hand.
  const pageTextures = useMemo(
    () => (isHeld ? Array.from({ length: 2 * LEAF_COUNT + 2 }, (_, i) => getCachedPage(book, i)) : []),
    [isHeld, book.title, book.author, book.listing]
  );

  /* ---- shelf materials --------------------------------------------- */
  const shelfMats = useMemo(() => {
    const edge = new THREE.MeshStandardMaterial({ color: book.color, roughness: 0.7 });
    const spine = new THREE.MeshStandardMaterial({ map: spineTex, roughness: 0.68 });
    const coverFront = coverTex
      ? new THREE.MeshStandardMaterial({ map: coverTex, roughness: 0.66 })
      : new THREE.MeshStandardMaterial({ color: book.color, roughness: 0.66 });
    const inside = new THREE.MeshStandardMaterial({ color: '#efe7d3', roughness: 0.9 });
    const pageSide = new THREE.MeshStandardMaterial({ map: pagesTex, roughness: 0.95 });
    const pageEdge = new THREE.MeshStandardMaterial({ color: '#efe6cf', roughness: 0.95 });
    return {
      edge, spine, coverFront, inside,
      // Book box faces are [+X, -X, +Y, -Y, +Z, -Z]. On the shelf each book
      // is yawed ±90°, so its SPINE (-X) faces the aisle and shows the title;
      // +X is the page block (paper edges). The broad cover faces (+Z/-Z)
      // use the printed cover material so a closed book never looks like a
      // bare slab of paper.
      bookSet: [pageEdge, spine, pageEdge, pageEdge, coverFront, coverFront],
      all: [edge, spine, coverFront, inside, pageSide, pageEdge],
    };
  }, [book.color, spineTex, coverTex, pagesTex]);
  useEffect(() => () => shelfMats.all.forEach((m) => m.dispose()), [shelfMats]);

  /* ---- hero model (built on demand when held) ----------------------- */
  const hero = useRef(null);
  const heroGeos = useRef([]);
  const heroMats = useRef([]);
  const heroTexs = useRef([]);       // cloned back-face textures (ours to free)
  const leafRefs = useRef([]);

  function buildHero() {
    // dispose any previous hero
    disposeHero();
    const H = { group: new THREE.Group(), pivot: null, leaves: [], turned: 0 };
    const add = (gw, hh, dd, x, y, z, mat, parent) => {
      const geo = new THREE.BoxGeometry(gw, hh, dd);
      heroGeos.current.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      (parent || H.group).add(mesh);
      return mesh;
    };
    const mk = (opts) => {
      const m = new THREE.MeshStandardMaterial(opts);
      heroMats.current.push(m);
      return m;
    };

    const bc = mk({ color: book.color, roughness: 0.7 });
    const pp = mk({ color: 0xf0e4c6, roughness: 0.9 });
    const inner = mk({ map: pageTextures[2 * LEAF_COUNT + 1] || pagesTex, roughness: 0.9 });
    const sp = mk({ map: spineTex, roughness: 0.6 });
    const coverMat = mk({ map: coverTex || pagesTex, roughness: 0.6 });
    const insideMat = mk({ map: pageTextures[0] || pagesTex, roughness: 0.9 });

    // HW is the book's full cover width (matches the reference: page block and
    // cover are both HW wide, hinged at -HW/2).
    const HW = w, HH = h, HT = thickness;
    const slim = HT * 0.12;

    // page block
    add(HW - 0.006, HH - 0.02, HT - 0.008, 0, 0, 0,
      [pp, pp, pp, pp, inner, pp]);
    // back cover
    add(HW, HH, slim, 0, 0, -HT / 2 - slim / 2, bc);
    // spine strip (spine texture on -X face)
    add(slim * 1.6, HH, HT + slim, -HW / 2 - slim * 0.6, 0, 0,
      [bc, sp, bc, bc, bc, bc]);

    // front cover on a hinge at the spine edge
    const pivot = new THREE.Group();
    pivot.position.set(-HW / 2, 0, HT / 2 + slim / 2);
    H.group.add(pivot);
    H.pivot = pivot;
    // The inside of the front cover shows printed page 0 while reading.
    // During fly-in/out a right-wall book can face its -Z side toward the
    // reader; we swap in the printed jacket for those phases so you never
    // see a bare page where the cover should be.
    const coverMesh = add(HW, HH, slim, HW / 2, 0, 0,
      [bc, bc, bc, bc, coverMat, insideMat], pivot);
    H.coverMesh = coverMesh;
    H.coverInsideMat = insideMat;
    H.coverOutsideMat = coverMat;

    // bendable, two-sided leaves
    const LW = HW - 0.012, LH = HH - 0.02;
    // Closed stack: leaf 0 on top (it turns first). Turned pile: the first
    // leaf that turns lands lowest on the cover, each later one on top of it,
    // so the newest page is always the one you read near the gutter.
    const ZC = HT / 2 - slim * 0.3;
    const ZT = HT / 2 + slim * 0.5 + 0.002;
    for (let i = 0; i < LEAF_COUNT; i++) {
      const geo = makePageChain(LW, LH, SEGMENTS);
      heroGeos.current.push(geo);
      const pv = new THREE.Group();
      pv.position.set(-HW / 2 + slim * 0.5, 0, ZC + (LEAF_COUNT - 1 - i) * 0.004);
      H.group.add(pv);

      const ft = pageTextures[2 * i + 1] || pagesTex;   // front: right-hand page
      let bt = pageTextures[2 * i + 2] || pagesTex;     // back: left-hand page
      // mirror the back texture so it reads correctly from behind
      bt = bt.clone();
      bt.wrapS = THREE.RepeatWrapping;
      bt.repeat.x = -1;
      bt.offset.x = 1;
      bt.needsUpdate = true;
      heroTexs.current.push(bt);

      const frontMat = mk({ map: ft, roughness: 0.9, side: THREE.FrontSide });
      const backMat = mk({ map: bt, roughness: 0.9, side: THREE.BackSide });
      pv.add(new THREE.Mesh(geo, frontMat), new THREE.Mesh(geo, backMat));
      const L = { geo, n: SEGMENTS, w: LW, h: LH, fin: PAGE_FIN - i * 0.05, group: pv,
        z0: pv.position.z, z1: ZT + i * 0.004 };
      bendPage(L, 0, 0);
      H.leaves.push(L);
    }
    return H;
  }

  function disposeHero() {
    heroGeos.current.forEach((g) => g.dispose());
    // materials only — their maps are shared caches that must survive
    heroMats.current.forEach((m) => m.dispose());
    heroTexs.current.forEach((t) => t.dispose());
    heroGeos.current = [];
    heroMats.current = [];
    heroTexs.current = [];
    hero.current = null;
  }

  /* ---- state for animation phases ---------------------------------- */
  const phase = useRef('idle');      // idle | flyIn | coverOpen | reading | closing
  const phaseT = useRef(0);          // 0..1 progress within phase
  const phaseDur = useRef(1);
  const startPos = useRef(new THREE.Vector3());
  const startQuat = useRef(new THREE.Quaternion());
  const startScale = useRef(1);
  const fromPos = useRef(new THREE.Vector3());
  const fromQuat = useRef(new THREE.Quaternion());
  const fromScale = useRef(1);
  const turn = useRef({ active: false, t: 0, dur: 1, k: 0, dir: 1, from: 0 });
  const closeFlipBack = useRef(false);

  useEffect(() => {
    document.body.style.cursor = hovered || isHeld ? 'pointer' : 'auto';
    return () => { document.body.style.cursor = 'auto'; };
  }, [hovered, isHeld]);

  /* ---- input: wheel / touch / keyboard ----------------------------- */
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

  /* ---- main animation loop ----------------------------------------- */
  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const H = hero.current;
    // Fast path: the ~3000 shelf copies that are not being read have nothing
    // to animate — one boolean instead of a dozen phase checks each frame.
    if (!H && !isHeld) return;
    // Wall-clock progress: the reference eases with the real delta so a turn
    // always takes the same time, even in low-FPS/software rendering.
    const dt = Math.min(delta, 0.5);

    if (isHeld && !H && phase.current === 'idle') {
      // --- begin open: capture shelf position and build the hero copy ---
      camera.updateMatrixWorld(true);
      const shelfPos = new THREE.Vector3(...book.position);
      // world position of the shelf copy, converted to camera space
      if (shelfRef.current) {
        shelfRef.current.getWorldPosition(startPos.current);
        // Capture the shelf's real orientation too: the flight starts and
        // lands exactly where the book sits, so nothing pops on the swap.
        shelfRef.current.getWorldQuaternion(startQuat.current);
      }
      startScale.current = 1; // hero is built at the shelf book's real size
      hero.current = buildHero();
      const heroGroup = hero.current.group;
      heroGroup.scale.setScalar(0.001);
      // Hero lives in world space; flight targets are world positions
      // derived from the camera (the camera itself is not in the scene graph).
      scene.add(heroGroup);
      if (shelfRef.current) shelfRef.current.visible = false;
      setSpreadVisible(false);
      phase.current = 'flyIn';
      phaseT.current = 0;
      phaseDur.current = 1.15;
      fromPos.current.copy(startPos.current);
      fromScale.current = startScale.current;
    }

    if (!isHeld && H && !['idle', 'closePageBack', 'coverClose', 'flyOut'].includes(phase.current)) {
      // --- begin close: flip pages back, shut the cover, fly home ---
      // Only trigger once; otherwise an in-progress close gets restarted.
      phase.current = 'closePageBack';
      phaseT.current = 0;
      turn.current.active = false;
    }

    // ---- phase: fly in (arc + spin + scale) ----
    if (phase.current === 'flyIn' && H) {
      phaseT.current = Math.min(1, phaseT.current + dt / phaseDur.current);
      const e = flyEase(phaseT.current);
      // target is camera-relative HELD_OFFSET plus centering nudge
      const target = scratchTarget(camera, H, w);
      H.group.position.lerpVectors(fromPos.current, target, e);
      H.group.position.y += Math.sin(phaseT.current * Math.PI) * 0.45;
      // ease out of the shelf's real orientation into a camera-facing hold,
      // so the book arrives already turned toward the reader (no snap at 1)
      H.group.quaternion.copy(startQuat.current).slerp(heldQuat(camera), e);
      H.group.scale.setScalar(THREE.MathUtils.lerp(fromScale.current, heldScale, e));
      // Flight: show the printed jacket on both broad faces so the reader
      // never sees a bare page where a closed book's cover should be.
      H.coverMesh.material[5] = H.coverOutsideMat;
      if (phaseT.current >= 1) {
        phase.current = 'coverOpen';
        phaseT.current = 0;
        phaseDur.current = 0.85;
      }
    }

    // ---- phase: cover swings open on its hinge ----
    if (phase.current === 'coverOpen' && H) {
      phaseT.current = Math.min(1, phaseT.current + dt / phaseDur.current);
      H.pivot.rotation.y = OPEN_ANGLE * ease(phaseT.current);
      // once the cover is partway open, reveal the printed first page inside
      if (phaseT.current > 0.35) H.coverMesh.material[5] = H.coverInsideMat;
      const target = scratchTarget(camera, H, w);
      H.group.position.lerp(target, Math.min(1, dt * 8));
      H.group.quaternion.slerp(heldQuat(camera), Math.min(1, dt * 6));
      H.group.scale.setScalar(heldScale);
      if (phaseT.current >= 1) {
        phase.current = 'reading';
        setSpreadVisible(true);
      }
    }

    // ---- phase: reading (stable hold + page turns) ----
    if (phase.current === 'reading' && H) {
      const target = scratchTarget(camera, H, w);
      const breath = Math.sin(state.clock.elapsedTime * 1.1) * 0.002;
      target.y += breath;
      H.group.position.lerp(target, Math.min(1, dt * 10));
      H.group.quaternion.slerp(heldQuat(camera), Math.min(1, dt * 6));
      H.group.scale.setScalar(heldScale);

      // page turns driven by the shared store
      const targetStep = bookScroll.target;
      if (!turn.current.active && targetStep !== H.turned) {
        const dir = targetStep > H.turned ? 1 : -1;
        const k = dir > 0 ? H.turned : H.turned - 1;
        if (k >= 0 && k < H.leaves.length) {
          turn.current = { active: true, t: 0, dur: 0.62, k, dir };
          playPageFlip(dir);
        }
      }
      if (turn.current.active) {
        turn.current.t = Math.min(1, turn.current.t + dt / turn.current.dur);
        const L = H.leaves[turn.current.k];
        const fwd = turn.current.dir > 0;
        const u = fwd ? turn.current.t : 1 - turn.current.t;
        const e = sineEase(u);
        // edge lags, then catches up; the leaf climbs into the turned pile
        bendPage(L, e * L.fin, -0.8 * Math.sin(2 * Math.PI * u));
        L.group.position.z = THREE.MathUtils.lerp(L.z0, L.z1, e);
        if (turn.current.t >= 1) {
          bendPage(L, fwd ? L.fin : 0, 0);
          L.group.position.z = fwd ? L.z1 : L.z0;
          H.turned += turn.current.dir;
          turn.current.active = false;
          setShownStep(H.turned);
          bookScroll.turns++;
          const nextSpread = Math.max(0, Math.min(3, Math.floor(H.turned / 2)));
          setSpread(nextSpread);
        }
      }
    }

    // ---- close: flip turned pages back quickly ----
    if (phase.current === 'closePageBack' && H) {
      if (H.turned > 0 && !turn.current.active) {
        const k = H.turned - 1;
        turn.current = { active: true, t: 0, dur: 0.35, k, dir: -1 };
      } else if (H.turned === 0 && !turn.current.active) {
        phase.current = 'coverClose';
        phaseT.current = 0;
        phaseDur.current = 0.7;
      }
      if (turn.current.active) {
        turn.current.t = Math.min(1, turn.current.t + dt / turn.current.dur);
        const L = H.leaves[turn.current.k];
        const u = 1 - turn.current.t;
        const e = sineEase(u);
        bendPage(L, e * L.fin, -0.8 * Math.sin(2 * Math.PI * u));
        L.group.position.z = THREE.MathUtils.lerp(L.z0, L.z1, e);
        if (turn.current.t >= 1) {
          bendPage(L, 0, 0);
          L.group.position.z = L.z0;
          H.turned--;
          turn.current.active = false;
          setShownStep(H.turned);
        }
      }
    }

    // ---- close: cover swings shut ----
    if (phase.current === 'coverClose' && H) {
      phaseT.current = Math.min(1, phaseT.current + dt / phaseDur.current);
      H.pivot.rotation.y = OPEN_ANGLE * (1 - ease(phaseT.current));
      // as the cover shuts, flip its inside face back to the printed jacket
      if (phaseT.current > 0.65) H.coverMesh.material[5] = H.coverOutsideMat;
      if (phaseT.current >= 1) {
        phase.current = 'flyOut';
        phaseT.current = 0;
        phaseDur.current = 1.05;
        fromPos.current.copy(H.group.position);
        fromQuat.current.copy(H.group.quaternion);
        fromScale.current = H.group.scale.x;
      }
    }

    // ---- close: fly back to the shelf with arc + spin ----
    if (phase.current === 'flyOut' && H) {
      phaseT.current = Math.min(1, phaseT.current + dt / phaseDur.current);
      const e = flyEase(phaseT.current);
      const target = startPos.current; // shelf world position
      H.group.position.lerpVectors(fromPos.current, target, e);
      H.group.position.y += Math.sin(phaseT.current * Math.PI) * 0.45;
      // settle back into the exact orientation the shelf copy was hidden at
      H.group.quaternion.copy(fromQuat.current).slerp(startQuat.current, e);
      H.group.scale.setScalar(THREE.MathUtils.lerp(fromScale.current, startScale.current, e));
      H.coverMesh.material[5] = H.coverOutsideMat;
      if (phaseT.current >= 1) {
        scene.remove(H.group);
        disposeHero();
        if (shelfRef.current) shelfRef.current.visible = true;
        phase.current = 'idle';
        setSpreadVisible(false);
        setSpread(0);
      }
    }
  });

  const handleClick = (e) => {
    e.stopPropagation();
    if (!isHeld) onSelect(book);
  };

  const shelfQuat = useMemo(() => {
    // Left wall (Z>0): spine faces -Z (toward the aisle).
    // Right wall (Z<0): spine faces +Z (toward the aisle).
    // `yaw` is then applied as a world-space Y rotation so the book angles
    // back toward the reader walking down the aisle (cases are yawed too).
    const y = book.side === 'left' ? -Math.PI / 2 : Math.PI / 2;
    const base = book.flat
      ? new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, y, 0))
      : new THREE.Quaternion().setFromEuler(new THREE.Euler(0, y, 0));
    if (book.yaw) {
      base.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, book.yaw, 0)));
    }
    return base;
  }, [book.flat, book.side, book.yaw]);

  return (
    <group ref={group} position={book.position} quaternion={shelfQuat}>
      {/* Shelf model — hidden while the hero copy is out */}
      <group
        ref={shelfRef}
        onClick={handleClick}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerOut={() => setHovered(false)}
      >
        {/* Single merged box: no shadow casters either — thousands of
            shadow-casting books were forcing a second full render pass. */}
        <mesh material={shelfMats.bookSet}>
          <boxGeometry args={[w, h, d]} />
        </mesh>
      </group>

      {/* Hero model mounts here; children added imperatively in the loop */}
      <group ref={heroRef} />
    </group>
  );
}

// Clicking one book flips `isHeld` on just two copies; without memo every
// shelf book re-renders (including its textures/materials useMemo checks).
// The `book` object identity is stable from buildBookLayout, so this is safe.
export default memo(Book);

/** Camera-relative reading position for the hero book. */
function scratchTarget(camera, H, w) {
  const p = HELD_OFFSET.clone().applyQuaternion(camera.quaternion).add(camera.position);
  // Once open, the cover swings far to the left of the hinge, so the visual
  // mass of the spread sits left of the origin. Nudge right by a fraction of
  // the cover width (and ease it in with the swing) to keep it centred.
  const open = Math.min(1, Math.max(0, -H.pivot.rotation.y / 2.5));
  if (open > 0) {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    p.addScaledVector(right, 0.35 * w * open);
  }
  return p;
}
