import * as THREE from 'three';
import { clamp01, damp, dampAngle, lerp } from '../core/math';
import type { QualityProfile } from './quality';

/**
 * Procedurally-built, fully rigged wrestler.
 *
 * Rather than shipping a 30MB GLB, the athlete is generated from parametric
 * primitives with a real bone hierarchy. That keeps the APK small, lets every
 * body proportion be driven by attributes, and still gives us proper skeletal
 * animation with IK-ish limb targeting.
 */

export interface BodyParams {
  height: number;
  bulk: number;
  skin: number;
  trunks: number;
  accent: number;
}

interface Bone {
  obj: THREE.Object3D;
  restRot: THREE.Euler;
  restPos: THREE.Vector3;
}

export type Rig = {
  root: THREE.Group;
  hips: Bone;
  spine: Bone;
  chest: Bone;
  neck: Bone;
  head: Bone;
  shoulderL: Bone;
  shoulderR: Bone;
  elbowL: Bone;
  elbowR: Bone;
  handL: Bone;
  handR: Bone;
  hipL: Bone;
  hipR: Bone;
  kneeL: Bone;
  kneeR: Bone;
  footL: Bone;
  footR: Bone;
};

const bone = (obj: THREE.Object3D): Bone => ({
  obj,
  restRot: obj.rotation.clone(),
  restPos: obj.position.clone(),
});

const mat = (color: number, rough: number, metal = 0, quality?: QualityProfile) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: rough,
    metalness: metal,
    flatShading: (quality?.bodySegments ?? 16) <= 8,
  });

const capsule = (
  radius: number,
  length: number,
  material: THREE.Material,
  seg: number,
): THREE.Mesh => {
  const g = new THREE.CapsuleGeometry(radius, length, Math.max(2, Math.floor(seg / 3)), seg);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

const sphere = (radius: number, material: THREE.Material, seg: number): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, seg, Math.max(4, seg / 2)), material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

export const buildWrestler = (p: BodyParams, q: QualityProfile): { rig: Rig; dispose: () => void } => {
  const seg = q.bodySegments;
  const s = p.height;
  const b = p.bulk;

  const skinMat = mat(p.skin, 0.62, 0.02, q);
  const trunkMat = mat(p.trunks, 0.5, 0.06, q);
  const accentMat = mat(p.accent, 0.35, 0.25, q);
  const shoeMat = mat(0x1a1c22, 0.75, 0.05, q);
  const materials = [skinMat, trunkMat, accentMat, shoeMat];

  const root = new THREE.Group();
  root.name = 'wrestler';

  // ---- Hips (rig root)
  const hips = new THREE.Group();
  hips.position.y = 0.92 * s;
  root.add(hips);

  const pelvis = capsule(0.17 * b, 0.1 * s, trunkMat, seg);
  pelvis.rotation.z = Math.PI / 2;
  pelvis.scale.set(1, 1.25, 0.85);
  hips.add(pelvis);

  // ---- Spine chain
  const spine = new THREE.Group();
  spine.position.y = 0.1 * s;
  hips.add(spine);

  const abs = capsule(0.155 * b, 0.14 * s, skinMat, seg);
  abs.position.y = 0.09 * s;
  abs.scale.set(1, 1, 0.8);
  spine.add(abs);

  const chest = new THREE.Group();
  chest.position.y = 0.2 * s;
  spine.add(chest);

  const torso = capsule(0.2 * b, 0.16 * s, skinMat, seg);
  torso.position.y = 0.07 * s;
  torso.scale.set(1.12, 1, 0.78);
  chest.add(torso);

  // Singlet straps — reads instantly as a wrestler.
  const strapGeo = new THREE.BoxGeometry(0.055 * b, 0.3 * s, 0.03);
  for (const dir of [-1, 1]) {
    const strap = new THREE.Mesh(strapGeo, accentMat);
    strap.position.set(dir * 0.1 * b, 0.06 * s, -0.13 * b);
    strap.rotation.z = dir * 0.13;
    strap.castShadow = true;
    chest.add(strap);
  }
  const bib = new THREE.Mesh(new THREE.BoxGeometry(0.26 * b, 0.24 * s, 0.03), trunkMat);
  bib.position.set(0, 0.04 * s, -0.145 * b);
  chest.add(bib);

  // ---- Neck + head
  const neck = new THREE.Group();
  neck.position.y = 0.17 * s;
  chest.add(neck);
  const neckMesh = capsule(0.072 * b, 0.05 * s, skinMat, seg);
  neckMesh.position.y = 0.025 * s;
  neck.add(neckMesh);

  const head = new THREE.Group();
  head.position.y = 0.09 * s;
  neck.add(head);
  const skull = sphere(0.105 * s, skinMat, seg);
  skull.scale.set(0.92, 1.08, 1.0);
  head.add(skull);
  const jaw = capsule(0.06 * s, 0.03 * s, skinMat, Math.max(6, seg - 4));
  jaw.rotation.x = Math.PI / 2;
  jaw.position.set(0, -0.045 * s, -0.045 * s);
  jaw.scale.set(1, 1, 0.7);
  head.add(jaw);
  // Headgear — small detail that sells the sport.
  if (seg >= 12) {
    const gear = new THREE.Mesh(new THREE.TorusGeometry(0.1 * s, 0.016 * s, 6, seg), accentMat);
    gear.rotation.y = Math.PI / 2;
    gear.position.y = 0.005 * s;
    gear.castShadow = true;
    head.add(gear);
  }

  // ---- Arms
  const makeArm = (side: -1 | 1) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.2 * b, 0.13 * s, 0);
    chest.add(shoulder);

    const delt = sphere(0.082 * b, skinMat, seg);
    delt.scale.setScalar(1.05);
    shoulder.add(delt);

    const upper = capsule(0.062 * b, 0.17 * s, skinMat, seg);
    upper.position.y = -0.1 * s;
    upper.scale.set(1.1, 1, 1.1);
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -0.2 * s;
    shoulder.add(elbow);

    const fore = capsule(0.052 * b, 0.16 * s, skinMat, seg);
    fore.position.y = -0.09 * s;
    elbow.add(fore);

    const hand = new THREE.Group();
    hand.position.y = -0.185 * s;
    elbow.add(hand);
    const fist = sphere(0.055 * b, skinMat, Math.max(6, seg - 6));
    fist.scale.set(1, 1.15, 0.9);
    hand.add(fist);

    // Natural rest pose: arms hanging slightly out.
    shoulder.rotation.z = side * 0.16;
    elbow.rotation.x = -0.18;
    return { shoulder: bone(shoulder), elbow: bone(elbow), hand: bone(hand) };
  };

  const armL = makeArm(-1);
  const armR = makeArm(1);

  // ---- Legs
  const makeLeg = (side: -1 | 1) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.093 * b, -0.03 * s, 0);
    hips.add(hip);

    const thigh = capsule(0.083 * b, 0.2 * s, trunkMat, seg);
    thigh.position.y = -0.13 * s;
    thigh.scale.set(1.08, 1, 1.05);
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.26 * s;
    hip.add(knee);

    const shin = capsule(0.062 * b, 0.21 * s, skinMat, seg);
    shin.position.y = -0.13 * s;
    knee.add(shin);

    const foot = new THREE.Group();
    foot.position.y = -0.26 * s;
    knee.add(foot);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.09 * b, 0.07 * s, 0.2 * s), shoeMat);
    boot.position.set(0, -0.025 * s, 0.045 * s);
    boot.castShadow = true;
    foot.add(boot);
    const laces = new THREE.Mesh(new THREE.BoxGeometry(0.05 * b, 0.02 * s, 0.1 * s), accentMat);
    laces.position.set(0, 0.012 * s, 0.02 * s);
    foot.add(laces);

    // Wrestling stance: knees bent, feet staggered.
    hip.rotation.x = side * 0.05 - 0.16;
    knee.rotation.x = 0.3;
    return { hip: bone(hip), knee: bone(knee), foot: bone(foot) };
  };

  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  const rig: Rig = {
    root,
    hips: bone(hips),
    spine: bone(spine),
    chest: bone(chest),
    neck: bone(neck),
    head: bone(head),
    shoulderL: armL.shoulder,
    shoulderR: armR.shoulder,
    elbowL: armL.elbow,
    elbowR: armR.elbow,
    handL: armL.hand,
    handR: armR.hand,
    hipL: legL.hip,
    hipR: legR.hip,
    kneeL: legL.knee,
    kneeR: legR.knee,
    footL: legL.foot,
    footR: legR.foot,
  };

  const dispose = () => {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    for (const m of materials) m.dispose();
  };

  return { rig, dispose };
};

// ---------------------------------------------------------------- animation

export type ClipName =
  | 'idle'
  | 'stance'
  | 'walk'
  | 'guard'
  | 'snap'
  | 'knee'
  | 'tieup'
  | 'underhook'
  | 'double_leg'
  | 'single_leg'
  | 'ankle_pick'
  | 'hip_toss'
  | 'suplex'
  | 'headlock_throw'
  | 'armbar'
  | 'half_nelson'
  | 'guillotine'
  | 'thunder_slam'
  | 'lightning_roll'
  | 'crusher'
  | 'iron_clutch'
  | 'hit'
  | 'down'
  | 'ground_idle'
  | 'pinned'
  | 'celebrate'
  | 'taunt'
  | 'exhausted';

interface Pose {
  hips?: [number, number, number];
  hipsY?: number;
  spine?: [number, number, number];
  chest?: [number, number, number];
  head?: [number, number, number];
  shoulderL?: [number, number, number];
  shoulderR?: [number, number, number];
  elbowL?: [number, number, number];
  elbowR?: [number, number, number];
  hipL?: [number, number, number];
  hipR?: [number, number, number];
  kneeL?: [number, number, number];
  kneeR?: [number, number, number];
  rootY?: number;
  rootPitch?: number;
}

/** Keyframed pose library. Times are normalised 0..1 across the clip. */
const CLIPS: Record<ClipName, { loop: boolean; duration: number; keys: [number, Pose][] }> = {
  idle: {
    loop: true,
    duration: 2.6,
    keys: [
      [0, { spine: [0.02, 0, 0], chest: [0, 0.05, 0], shoulderL: [0, 0, -0.2], shoulderR: [0, 0, 0.2] }],
      [0.5, { spine: [0.06, 0, 0], chest: [0, -0.05, 0], shoulderL: [0.05, 0, -0.24], shoulderR: [0.05, 0, 0.24], hipsY: -0.015 }],
      [1, { spine: [0.02, 0, 0], chest: [0, 0.05, 0], shoulderL: [0, 0, -0.2], shoulderR: [0, 0, 0.2] }],
    ],
  },
  stance: {
    loop: true,
    duration: 1.5,
    keys: [
      [0, { hips: [0.16, 0, 0], spine: [0.1, 0, 0], chest: [-0.05, 0, 0], shoulderL: [-0.7, 0, -0.5], shoulderR: [-0.7, 0, 0.5], elbowL: [-1.0, 0, 0], elbowR: [-1.0, 0, 0], kneeL: [0.55, 0, 0], kneeR: [0.55, 0, 0], hipL: [-0.35, 0, 0], hipR: [-0.3, 0, 0], hipsY: -0.09 }],
      [0.5, { hips: [0.19, 0, 0], spine: [0.12, 0, 0], chest: [-0.05, 0, 0], shoulderL: [-0.78, 0, -0.55], shoulderR: [-0.78, 0, 0.55], elbowL: [-1.1, 0, 0], elbowR: [-1.1, 0, 0], kneeL: [0.62, 0, 0], kneeR: [0.58, 0, 0], hipL: [-0.4, 0, 0], hipR: [-0.34, 0, 0], hipsY: -0.12 }],
      [1, { hips: [0.16, 0, 0], spine: [0.1, 0, 0], chest: [-0.05, 0, 0], shoulderL: [-0.7, 0, -0.5], shoulderR: [-0.7, 0, 0.5], elbowL: [-1.0, 0, 0], elbowR: [-1.0, 0, 0], kneeL: [0.55, 0, 0], kneeR: [0.55, 0, 0], hipL: [-0.35, 0, 0], hipR: [-0.3, 0, 0], hipsY: -0.09 }],
    ],
  },
  walk: {
    loop: true,
    duration: 0.72,
    keys: [
      [0, { hipL: [-0.75, 0, 0], hipR: [0.25, 0, 0], kneeL: [0.35, 0, 0], kneeR: [0.75, 0, 0], shoulderL: [-0.5, 0, -0.5], shoulderR: [-0.9, 0, 0.5], hips: [0.16, 0, 0], hipsY: -0.1, elbowL: [-1.0, 0, 0], elbowR: [-1.0, 0, 0] }],
      [0.5, { hipL: [0.25, 0, 0], hipR: [-0.75, 0, 0], kneeL: [0.75, 0, 0], kneeR: [0.35, 0, 0], shoulderL: [-0.9, 0, -0.5], shoulderR: [-0.5, 0, 0.5], hips: [0.16, 0, 0], hipsY: -0.1, elbowL: [-1.0, 0, 0], elbowR: [-1.0, 0, 0] }],
      [1, { hipL: [-0.75, 0, 0], hipR: [0.25, 0, 0], kneeL: [0.35, 0, 0], kneeR: [0.75, 0, 0], shoulderL: [-0.5, 0, -0.5], shoulderR: [-0.9, 0, 0.5], hips: [0.16, 0, 0], hipsY: -0.1, elbowL: [-1.0, 0, 0], elbowR: [-1.0, 0, 0] }],
    ],
  },
  guard: {
    loop: true,
    duration: 1.1,
    keys: [
      [0, { hips: [0.24, 0, 0], spine: [0.16, 0, 0], head: [0.2, 0, 0], shoulderL: [-1.5, 0, -0.35], shoulderR: [-1.5, 0, 0.35], elbowL: [-2.0, 0, 0], elbowR: [-2.0, 0, 0], kneeL: [0.7, 0, 0], kneeR: [0.7, 0, 0], hipL: [-0.45, 0, 0], hipR: [-0.45, 0, 0], hipsY: -0.16 }],
      [0.5, { hips: [0.26, 0, 0], spine: [0.18, 0, 0], head: [0.22, 0, 0], shoulderL: [-1.55, 0, -0.38], shoulderR: [-1.55, 0, 0.38], elbowL: [-2.05, 0, 0], elbowR: [-2.05, 0, 0], kneeL: [0.74, 0, 0], kneeR: [0.74, 0, 0], hipL: [-0.48, 0, 0], hipR: [-0.48, 0, 0], hipsY: -0.18 }],
      [1, { hips: [0.24, 0, 0], spine: [0.16, 0, 0], head: [0.2, 0, 0], shoulderL: [-1.5, 0, -0.35], shoulderR: [-1.5, 0, 0.35], elbowL: [-2.0, 0, 0], elbowR: [-2.0, 0, 0], kneeL: [0.7, 0, 0], kneeR: [0.7, 0, 0], hipL: [-0.45, 0, 0], hipR: [-0.45, 0, 0], hipsY: -0.16 }],
    ],
  },
  snap: {
    loop: false,
    duration: 0.42,
    keys: [
      [0, { shoulderL: [-1.2, 0, -0.4], shoulderR: [-0.8, 0, 0.4], elbowL: [-1.6, 0, 0], chest: [0, 0.2, 0], hips: [0.16, 0, 0] }],
      [0.4, { shoulderL: [-2.3, 0.3, -0.2], shoulderR: [-1.0, 0, 0.4], elbowL: [-0.6, 0, 0], chest: [0.15, -0.35, 0], hips: [0.28, -0.1, 0], hipsY: -0.05 }],
      [1, { shoulderL: [-1.2, 0, -0.4], shoulderR: [-0.8, 0, 0.4], elbowL: [-1.6, 0, 0], chest: [0, 0.2, 0], hips: [0.16, 0, 0] }],
    ],
  },
  knee: {
    loop: false,
    duration: 0.6,
    keys: [
      [0, { hips: [0.2, 0, 0], hipR: [-0.4, 0, 0], kneeR: [0.6, 0, 0], shoulderL: [-1.8, 0, -0.3], shoulderR: [-1.8, 0, 0.3], elbowL: [-2.2, 0, 0], elbowR: [-2.2, 0, 0] }],
      [0.45, { hips: [0.05, 0, 0], hipR: [-1.7, 0, 0], kneeR: [1.9, 0, 0], chest: [-0.25, 0, 0], shoulderL: [-2.0, 0, -0.4], shoulderR: [-2.0, 0, 0.4], hipsY: 0.06 }],
      [1, { hips: [0.2, 0, 0], hipR: [-0.4, 0, 0], kneeR: [0.6, 0, 0], shoulderL: [-1.8, 0, -0.3], shoulderR: [-1.8, 0, 0.3], elbowL: [-2.2, 0, 0], elbowR: [-2.2, 0, 0] }],
    ],
  },
  tieup: {
    loop: false,
    duration: 0.66,
    keys: [
      [0, { hips: [0.18, 0, 0], shoulderL: [-1.0, 0, -0.4], shoulderR: [-1.0, 0, 0.4], elbowL: [-1.2, 0, 0], elbowR: [-1.2, 0, 0] }],
      [0.4, { hips: [0.3, 0, 0], spine: [0.2, 0, 0], shoulderL: [-2.1, 0.2, -0.5], shoulderR: [-2.1, -0.2, 0.5], elbowL: [-0.9, 0, 0], elbowR: [-0.9, 0, 0], kneeL: [0.8, 0, 0], kneeR: [0.8, 0, 0], hipsY: -0.14 }],
      [1, { hips: [0.24, 0, 0], spine: [0.14, 0, 0], shoulderL: [-1.9, 0.15, -0.45], shoulderR: [-1.9, -0.15, 0.45], elbowL: [-1.1, 0, 0], elbowR: [-1.1, 0, 0], kneeL: [0.7, 0, 0], kneeR: [0.7, 0, 0], hipsY: -0.1 }],
    ],
  },
  underhook: {
    loop: false,
    duration: 0.76,
    keys: [
      [0, { hips: [0.22, 0, 0], shoulderL: [-1.4, 0.3, -0.5], shoulderR: [-1.4, -0.3, 0.5], elbowL: [-1.4, 0, 0], elbowR: [-1.4, 0, 0] }],
      [0.45, { hips: [0.34, 0, 0], spine: [0.24, 0, 0], shoulderL: [-2.4, 0.6, -0.7], shoulderR: [-2.4, -0.6, 0.7], elbowL: [-0.7, 0, 0], elbowR: [-0.7, 0, 0], kneeL: [0.9, 0, 0], kneeR: [0.9, 0, 0], hipsY: -0.2 }],
      [1, { hips: [0.26, 0, 0], spine: [0.16, 0, 0], shoulderL: [-2.1, 0.5, -0.6], shoulderR: [-2.1, -0.5, 0.6], elbowL: [-1.0, 0, 0], elbowR: [-1.0, 0, 0], kneeL: [0.76, 0, 0], kneeR: [0.76, 0, 0], hipsY: -0.14 }],
    ],
  },
  double_leg: {
    loop: false,
    duration: 0.96,
    keys: [
      [0, { hips: [0.2, 0, 0], kneeL: [0.6, 0, 0], kneeR: [0.6, 0, 0], hipsY: -0.1 }],
      [0.3, { hips: [0.62, 0, 0], spine: [0.4, 0, 0], head: [-0.4, 0, 0], kneeL: [1.5, 0, 0], kneeR: [0.9, 0, 0], hipL: [-1.0, 0, 0], hipR: [-0.4, 0, 0], shoulderL: [-2.6, 0.4, -0.3], shoulderR: [-2.6, -0.4, 0.3], elbowL: [-0.5, 0, 0], elbowR: [-0.5, 0, 0], hipsY: -0.42, rootPitch: 0.25 }],
      [0.62, { hips: [0.75, 0, 0], spine: [0.5, 0, 0], head: [-0.5, 0, 0], kneeL: [1.9, 0, 0], kneeR: [1.2, 0, 0], hipL: [-1.3, 0, 0], hipR: [-0.7, 0, 0], shoulderL: [-2.9, 0.5, -0.2], shoulderR: [-2.9, -0.5, 0.2], hipsY: -0.5, rootPitch: 0.45 }],
      [1, { hips: [0.4, 0, 0], spine: [0.3, 0, 0], kneeL: [1.2, 0, 0], kneeR: [1.0, 0, 0], hipL: [-0.8, 0, 0], hipR: [-0.6, 0, 0], hipsY: -0.34, rootPitch: 0.2 }],
    ],
  },
  single_leg: {
    loop: false,
    duration: 0.92,
    keys: [
      [0, { hips: [0.2, 0, 0], kneeL: [0.6, 0, 0], kneeR: [0.6, 0, 0], hipsY: -0.1 }],
      [0.32, { hips: [0.55, 0.2, 0], spine: [0.3, 0.15, 0], kneeL: [1.6, 0, 0], kneeR: [0.7, 0, 0], hipL: [-1.1, 0, 0], shoulderL: [-2.4, 0.6, -0.4], shoulderR: [-2.2, -0.3, 0.4], elbowL: [-0.8, 0, 0], hipsY: -0.4, rootPitch: 0.2 }],
      [0.66, { hips: [0.45, 0.45, 0], spine: [0.25, 0.3, 0], kneeL: [1.3, 0, 0], kneeR: [0.9, 0, 0], shoulderL: [-2.6, 0.9, -0.5], shoulderR: [-2.3, -0.4, 0.5], hipsY: -0.3, rootPitch: 0.28 }],
      [1, { hips: [0.35, 0.2, 0], spine: [0.2, 0.1, 0], kneeL: [1.0, 0, 0], kneeR: [0.9, 0, 0], hipsY: -0.26, rootPitch: 0.15 }],
    ],
  },
  ankle_pick: {
    loop: false,
    duration: 0.8,
    keys: [
      [0, { hips: [0.22, 0, 0], hipsY: -0.12 }],
      [0.35, { hips: [0.8, 0.25, 0], spine: [0.5, 0.2, 0], head: [-0.5, 0, 0], kneeL: [1.8, 0, 0], kneeR: [1.0, 0, 0], hipL: [-1.4, 0, 0], shoulderR: [-3.0, -0.3, 0.3], elbowR: [-0.3, 0, 0], hipsY: -0.55, rootPitch: 0.5 }],
      [1, { hips: [0.4, 0.1, 0], spine: [0.24, 0.1, 0], kneeL: [1.1, 0, 0], kneeR: [0.9, 0, 0], hipsY: -0.3, rootPitch: 0.2 }],
    ],
  },
  hip_toss: {
    loop: false,
    duration: 1.14,
    keys: [
      [0, { hips: [0.2, 0, 0], shoulderL: [-2.0, 0.4, -0.5], shoulderR: [-2.0, -0.4, 0.5], hipsY: -0.12 }],
      [0.28, { hips: [0.32, -0.7, 0], spine: [0.2, -0.5, 0], shoulderL: [-2.6, 0.9, -0.6], shoulderR: [-2.4, -0.2, 0.6], kneeL: [1.0, 0, 0], kneeR: [1.0, 0, 0], hipsY: -0.22 }],
      [0.58, { hips: [-0.25, 1.3, 0], spine: [-0.2, 0.9, 0], chest: [-0.15, 0.5, 0], shoulderL: [-3.0, 1.2, -0.4], shoulderR: [-2.8, 0.4, 0.4], kneeL: [0.5, 0, 0], kneeR: [0.5, 0, 0], hipsY: 0.06, rootPitch: -0.15 }],
      [0.8, { hips: [0.35, 1.6, 0], spine: [0.3, 1.0, 0], shoulderL: [-2.4, 1.0, -0.3], shoulderR: [-2.2, 0.5, 0.3], kneeL: [1.2, 0, 0], kneeR: [1.2, 0, 0], hipsY: -0.28, rootPitch: 0.3 }],
      [1, { hips: [0.24, 0.6, 0], spine: [0.16, 0.3, 0], kneeL: [0.8, 0, 0], kneeR: [0.8, 0, 0], hipsY: -0.16 }],
    ],
  },
  suplex: {
    loop: false,
    duration: 1.4,
    keys: [
      [0, { hips: [0.24, 0, 0], shoulderL: [-2.2, 0.5, -0.5], shoulderR: [-2.2, -0.5, 0.5], hipsY: -0.14 }],
      [0.25, { hips: [0.5, 0, 0], spine: [0.35, 0, 0], shoulderL: [-2.8, 0.7, -0.6], shoulderR: [-2.8, -0.7, 0.6], kneeL: [1.3, 0, 0], kneeR: [1.3, 0, 0], hipsY: -0.36 }],
      [0.5, { hips: [-0.7, 0, 0], spine: [-0.5, 0, 0], chest: [-0.35, 0, 0], head: [-0.5, 0, 0], shoulderL: [-3.1, 0.5, -0.5], shoulderR: [-3.1, -0.5, 0.5], kneeL: [0.2, 0, 0], kneeR: [0.2, 0, 0], hipL: [0.35, 0, 0], hipR: [0.35, 0, 0], hipsY: 0.14, rootPitch: -0.6 }],
      [0.72, { hips: [-1.1, 0, 0], spine: [-0.7, 0, 0], chest: [-0.5, 0, 0], head: [-0.6, 0, 0], kneeL: [0.1, 0, 0], kneeR: [0.1, 0, 0], hipL: [0.6, 0, 0], hipR: [0.6, 0, 0], hipsY: 0.05, rootPitch: -1.0 }],
      [1, { hips: [0.2, 0, 0], spine: [0.15, 0, 0], kneeL: [0.9, 0, 0], kneeR: [0.9, 0, 0], hipsY: -0.3, rootPitch: -0.3 }],
    ],
  },
  headlock_throw: {
    loop: false,
    duration: 1.16,
    keys: [
      [0, { hips: [0.2, 0, 0], shoulderL: [-2.4, 0.8, -0.4], elbowL: [-1.6, 0, 0], hipsY: -0.12 }],
      [0.3, { hips: [0.3, -0.9, 0], spine: [0.2, -0.6, 0], shoulderL: [-2.9, 1.1, -0.5], shoulderR: [-2.0, -0.3, 0.5], kneeL: [1.1, 0, 0], kneeR: [1.1, 0, 0], hipsY: -0.24 }],
      [0.62, { hips: [0.15, 1.5, 0], spine: [0.1, 1.0, 0], chest: [0.1, 0.6, 0], shoulderL: [-2.6, 1.4, -0.3], kneeL: [0.7, 0, 0], kneeR: [0.7, 0, 0], hipsY: -0.1, rootPitch: 0.2 }],
      [1, { hips: [0.3, 0.7, 0], spine: [0.2, 0.4, 0], kneeL: [1.0, 0, 0], kneeR: [1.0, 0, 0], hipsY: -0.28, rootPitch: 0.25 }],
    ],
  },
  armbar: {
    loop: false,
    duration: 1.0,
    keys: [
      [0, { hips: [0.9, 0, 0], hipsY: -0.6, kneeL: [1.7, 0, 0], kneeR: [1.7, 0, 0], hipL: [-1.5, 0, 0], hipR: [-1.5, 0, 0], rootPitch: 0.5 }],
      [0.45, { hips: [1.1, 0.3, 0], spine: [0.4, 0.2, 0], shoulderL: [-2.8, 0.8, -0.5], shoulderR: [-2.8, -0.5, 0.5], elbowL: [-0.5, 0, 0], elbowR: [-0.5, 0, 0], kneeL: [1.9, 0, 0], kneeR: [1.9, 0, 0], hipsY: -0.68, rootPitch: 0.7 }],
      [1, { hips: [0.95, 0.15, 0], spine: [0.3, 0.1, 0], kneeL: [1.8, 0, 0], kneeR: [1.8, 0, 0], hipsY: -0.62, rootPitch: 0.55 }],
    ],
  },
  half_nelson: {
    loop: false,
    duration: 0.88,
    keys: [
      [0, { hips: [0.85, 0, 0], hipsY: -0.58, kneeL: [1.6, 0, 0], kneeR: [1.6, 0, 0], hipL: [-1.4, 0, 0], hipR: [-1.4, 0, 0], rootPitch: 0.45 }],
      [0.5, { hips: [0.95, -0.4, 0], spine: [0.35, -0.3, 0], shoulderL: [-3.0, 0.6, -0.6], elbowL: [-0.4, 0, 0], shoulderR: [-2.2, -0.4, 0.5], kneeL: [1.8, 0, 0], kneeR: [1.7, 0, 0], hipsY: -0.62, rootPitch: 0.6 }],
      [1, { hips: [0.88, -0.2, 0], spine: [0.3, -0.15, 0], kneeL: [1.7, 0, 0], kneeR: [1.65, 0, 0], hipsY: -0.6, rootPitch: 0.5 }],
    ],
  },
  guillotine: {
    loop: false,
    duration: 1.1,
    keys: [
      [0, { hips: [0.7, 0, 0], hipsY: -0.5, kneeL: [1.5, 0, 0], kneeR: [1.5, 0, 0], rootPitch: 0.35 }],
      [0.5, { hips: [0.8, 0.2, 0], spine: [0.5, 0.1, 0], chest: [0.3, 0, 0], shoulderL: [-2.9, 1.0, -0.7], shoulderR: [-2.9, -0.9, 0.7], elbowL: [-2.4, 0, 0], elbowR: [-2.4, 0, 0], head: [0.3, 0, 0], kneeL: [1.7, 0, 0], kneeR: [1.7, 0, 0], hipsY: -0.55, rootPitch: 0.45 }],
      [1, { hips: [0.75, 0.1, 0], spine: [0.45, 0.05, 0], kneeL: [1.6, 0, 0], kneeR: [1.6, 0, 0], hipsY: -0.52, rootPitch: 0.4 }],
    ],
  },
  thunder_slam: {
    loop: false,
    duration: 1.32,
    keys: [
      [0, { hips: [0.2, 0, 0], shoulderL: [-2.2, 0.5, -0.5], shoulderR: [-2.2, -0.5, 0.5], hipsY: -0.12 }],
      [0.22, { hips: [0.55, 0, 0], spine: [0.4, 0, 0], shoulderL: [-2.9, 0.8, -0.7], shoulderR: [-2.9, -0.8, 0.7], kneeL: [1.5, 0, 0], kneeR: [1.5, 0, 0], hipsY: -0.44 }],
      [0.48, { hips: [-0.4, 0, 0], spine: [-0.3, 0, 0], chest: [-0.3, 0, 0], shoulderL: [-3.2, 0.6, -0.4], shoulderR: [-3.2, -0.6, 0.4], kneeL: [0.15, 0, 0], kneeR: [0.15, 0, 0], hipsY: 0.2, rootPitch: -0.35 }],
      [0.72, { hips: [1.0, 0, 0], spine: [0.7, 0, 0], chest: [0.4, 0, 0], shoulderL: [-1.6, 0.3, -0.5], shoulderR: [-1.6, -0.3, 0.5], kneeL: [1.9, 0, 0], kneeR: [1.9, 0, 0], hipsY: -0.6, rootPitch: 0.8 }],
      [1, { hips: [0.6, 0, 0], spine: [0.4, 0, 0], kneeL: [1.5, 0, 0], kneeR: [1.5, 0, 0], hipsY: -0.45, rootPitch: 0.45 }],
    ],
  },
  lightning_roll: {
    loop: false,
    duration: 1.08,
    keys: [
      [0, { hips: [0.8, 0, 0], hipsY: -0.55, kneeL: [1.6, 0, 0], kneeR: [1.6, 0, 0], rootPitch: 0.4 }],
      [0.3, { hips: [0.9, -1.2, 0], spine: [0.4, -0.8, 0], shoulderL: [-2.8, 0.9, -0.6], shoulderR: [-2.8, -0.9, 0.6], hipsY: -0.6, rootPitch: 0.5 }],
      [0.6, { hips: [0.9, 1.2, 0], spine: [0.4, 0.8, 0], shoulderL: [-2.8, -0.9, -0.6], shoulderR: [-2.8, 0.9, 0.6], hipsY: -0.6, rootPitch: 0.5 }],
      [1, { hips: [0.85, 0, 0], spine: [0.35, 0, 0], kneeL: [1.6, 0, 0], kneeR: [1.6, 0, 0], hipsY: -0.56, rootPitch: 0.42 }],
    ],
  },
  crusher: {
    loop: false,
    duration: 1.7,
    keys: [
      [0, { hips: [0.24, 0, 0], shoulderL: [-2.3, 0.6, -0.5], shoulderR: [-2.3, -0.6, 0.5], hipsY: -0.14 }],
      [0.18, { hips: [0.6, 0, 0], spine: [0.45, 0, 0], shoulderL: [-3.0, 0.9, -0.8], shoulderR: [-3.0, -0.9, 0.8], kneeL: [1.6, 0, 0], kneeR: [1.6, 0, 0], hipsY: -0.5 }],
      [0.38, { hips: [-0.55, 0, 0], spine: [-0.4, 0, 0], chest: [-0.4, 0, 0], head: [-0.4, 0, 0], shoulderL: [-3.3, 0.7, -0.5], shoulderR: [-3.3, -0.7, 0.5], kneeL: [0.1, 0, 0], kneeR: [0.1, 0, 0], hipsY: 0.28, rootPitch: -0.5 }],
      [0.55, { hips: [-0.6, 0.4, 0], spine: [-0.45, 0.3, 0], chest: [-0.4, 0.2, 0], kneeL: [0.1, 0, 0], kneeR: [0.1, 0, 0], hipsY: 0.32, rootPitch: -0.55 }],
      [0.78, { hips: [1.2, 0, 0], spine: [0.85, 0, 0], chest: [0.5, 0, 0], shoulderL: [-1.2, 0.2, -0.5], shoulderR: [-1.2, -0.2, 0.5], kneeL: [2.0, 0, 0], kneeR: [2.0, 0, 0], hipL: [-1.6, 0, 0], hipR: [-1.6, 0, 0], hipsY: -0.72, rootPitch: 1.0 }],
      [1, { hips: [0.7, 0, 0], spine: [0.5, 0, 0], kneeL: [1.6, 0, 0], kneeR: [1.6, 0, 0], hipsY: -0.5, rootPitch: 0.5 }],
    ],
  },
  iron_clutch: {
    loop: false,
    duration: 1.5,
    keys: [
      [0, { hips: [0.8, 0, 0], hipsY: -0.55, kneeL: [1.6, 0, 0], kneeR: [1.6, 0, 0], rootPitch: 0.4 }],
      [0.35, { hips: [0.95, 0.3, 0], spine: [0.5, 0.2, 0], shoulderL: [-3.1, 1.1, -0.8], shoulderR: [-3.1, -1.0, 0.8], elbowL: [-2.6, 0, 0], elbowR: [-2.6, 0, 0], kneeL: [1.9, 0, 0], kneeR: [1.9, 0, 0], hipsY: -0.65, rootPitch: 0.55 }],
      [0.7, { hips: [1.0, 0.15, 0], spine: [0.55, 0.1, 0], shoulderL: [-3.2, 1.2, -0.9], shoulderR: [-3.2, -1.1, 0.9], elbowL: [-2.8, 0, 0], elbowR: [-2.8, 0, 0], hipsY: -0.68, rootPitch: 0.6 }],
      [1, { hips: [0.9, 0.1, 0], spine: [0.5, 0.05, 0], kneeL: [1.75, 0, 0], kneeR: [1.75, 0, 0], hipsY: -0.62, rootPitch: 0.52 }],
    ],
  },
  hit: {
    loop: false,
    duration: 0.4,
    keys: [
      [0, { chest: [0, 0, 0], head: [0, 0, 0] }],
      [0.25, { chest: [-0.35, 0.15, 0.1], head: [-0.5, 0.25, 0.15], spine: [-0.2, 0.1, 0], shoulderL: [-0.4, 0, -0.5], shoulderR: [-0.4, 0, 0.5], hipsY: -0.06 }],
      [1, { chest: [0, 0, 0], head: [0, 0, 0] }],
    ],
  },
  down: {
    loop: false,
    duration: 0.55,
    keys: [
      [0, { hips: [0.2, 0, 0], hipsY: -0.1 }],
      [1, { hips: [1.45, 0, 0], spine: [0.2, 0, 0], chest: [0.15, 0, 0], head: [0.3, 0, 0], hipL: [-0.9, 0, 0], hipR: [-0.9, 0, 0], kneeL: [1.2, 0, 0], kneeR: [1.2, 0, 0], shoulderL: [-1.0, 0, -1.0], shoulderR: [-1.0, 0, 1.0], hipsY: -0.78, rootPitch: 1.25 }],
    ],
  },
  ground_idle: {
    loop: true,
    duration: 2.0,
    keys: [
      [0, { hips: [0.95, 0, 0], hipsY: -0.62, kneeL: [1.7, 0, 0], kneeR: [1.7, 0, 0], hipL: [-1.5, 0, 0], hipR: [-1.5, 0, 0], shoulderL: [-1.6, 0.3, -0.5], shoulderR: [-1.6, -0.3, 0.5], elbowL: [-1.2, 0, 0], elbowR: [-1.2, 0, 0], rootPitch: 0.55 }],
      [0.5, { hips: [1.0, 0.08, 0], hipsY: -0.66, kneeL: [1.75, 0, 0], kneeR: [1.68, 0, 0], hipL: [-1.55, 0, 0], hipR: [-1.45, 0, 0], shoulderL: [-1.7, 0.35, -0.55], shoulderR: [-1.7, -0.35, 0.55], elbowL: [-1.3, 0, 0], elbowR: [-1.3, 0, 0], rootPitch: 0.6 }],
      [1, { hips: [0.95, 0, 0], hipsY: -0.62, kneeL: [1.7, 0, 0], kneeR: [1.7, 0, 0], hipL: [-1.5, 0, 0], hipR: [-1.5, 0, 0], shoulderL: [-1.6, 0.3, -0.5], shoulderR: [-1.6, -0.3, 0.5], elbowL: [-1.2, 0, 0], elbowR: [-1.2, 0, 0], rootPitch: 0.55 }],
    ],
  },
  pinned: {
    loop: true,
    duration: 1.2,
    keys: [
      [0, { hips: [1.5, 0, 0], hipsY: -0.8, hipL: [-1.1, 0.2, 0], hipR: [-1.1, -0.2, 0], kneeL: [1.0, 0, 0], kneeR: [1.0, 0, 0], shoulderL: [-0.6, 0, -1.3], shoulderR: [-0.6, 0, 1.3], rootPitch: 1.45 }],
      [0.5, { hips: [1.5, 0.12, 0], hipsY: -0.82, hipL: [-1.3, 0.3, 0], hipR: [-0.9, -0.3, 0], kneeL: [1.3, 0, 0], kneeR: [0.8, 0, 0], shoulderL: [-0.8, 0, -1.4], shoulderR: [-0.4, 0, 1.2], rootPitch: 1.45 }],
      [1, { hips: [1.5, 0, 0], hipsY: -0.8, hipL: [-1.1, 0.2, 0], hipR: [-1.1, -0.2, 0], kneeL: [1.0, 0, 0], kneeR: [1.0, 0, 0], shoulderL: [-0.6, 0, -1.3], shoulderR: [-0.6, 0, 1.3], rootPitch: 1.45 }],
    ],
  },
  celebrate: {
    loop: true,
    duration: 1.6,
    keys: [
      [0, { shoulderL: [-2.8, 0, -0.7], shoulderR: [-2.8, 0, 0.7], elbowL: [-0.3, 0, 0], elbowR: [-0.3, 0, 0], chest: [-0.2, 0, 0], head: [-0.3, 0, 0], hipsY: 0 }],
      [0.3, { shoulderL: [-3.1, 0, -0.5], shoulderR: [-3.1, 0, 0.5], elbowL: [-0.2, 0, 0], elbowR: [-0.2, 0, 0], chest: [-0.3, 0, 0], head: [-0.4, 0, 0], hipsY: 0.14, kneeL: [0.2, 0, 0], kneeR: [0.2, 0, 0] }],
      [0.6, { shoulderL: [-2.6, 0.3, -0.8], shoulderR: [-2.6, -0.3, 0.8], chest: [-0.15, 0.3, 0], head: [-0.2, 0.3, 0], hipsY: -0.04, kneeL: [0.5, 0, 0], kneeR: [0.5, 0, 0] }],
      [1, { shoulderL: [-2.8, 0, -0.7], shoulderR: [-2.8, 0, 0.7], elbowL: [-0.3, 0, 0], elbowR: [-0.3, 0, 0], chest: [-0.2, 0, 0], head: [-0.3, 0, 0], hipsY: 0 }],
    ],
  },
  taunt: {
    loop: false,
    duration: 1.2,
    keys: [
      [0, { chest: [0, 0, 0] }],
      [0.3, { shoulderL: [-2.4, 0.5, -0.9], shoulderR: [-2.4, -0.5, 0.9], elbowL: [-1.6, 0, 0], elbowR: [-1.6, 0, 0], chest: [-0.25, 0, 0], head: [-0.35, 0, 0], hips: [-0.1, 0, 0] }],
      [0.65, { shoulderL: [-2.6, 0.7, -1.0], shoulderR: [-2.6, -0.7, 1.0], elbowL: [-1.2, 0, 0], elbowR: [-1.2, 0, 0], chest: [-0.3, 0, 0], head: [-0.4, 0, 0], hips: [-0.12, 0, 0] }],
      [1, { chest: [0, 0, 0] }],
    ],
  },
  exhausted: {
    loop: true,
    duration: 2.2,
    keys: [
      [0, { hips: [0.3, 0, 0], spine: [0.28, 0, 0], chest: [0.2, 0, 0], head: [0.35, 0, 0], shoulderL: [-0.2, 0, -0.35], shoulderR: [-0.2, 0, 0.35], elbowL: [-0.5, 0, 0], elbowR: [-0.5, 0, 0], kneeL: [0.5, 0, 0], kneeR: [0.5, 0, 0], hipsY: -0.12 }],
      [0.5, { hips: [0.36, 0, 0], spine: [0.34, 0, 0], chest: [0.26, 0, 0], head: [0.42, 0, 0], shoulderL: [-0.28, 0, -0.4], shoulderR: [-0.28, 0, 0.4], elbowL: [-0.55, 0, 0], elbowR: [-0.55, 0, 0], kneeL: [0.58, 0, 0], kneeR: [0.58, 0, 0], hipsY: -0.17 }],
      [1, { hips: [0.3, 0, 0], spine: [0.28, 0, 0], chest: [0.2, 0, 0], head: [0.35, 0, 0], shoulderL: [-0.2, 0, -0.35], shoulderR: [-0.2, 0, 0.35], elbowL: [-0.5, 0, 0], elbowR: [-0.5, 0, 0], kneeL: [0.5, 0, 0], kneeR: [0.5, 0, 0], hipsY: -0.12 }],
    ],
  },
};

const POSE_BONES: Array<[keyof Pose, keyof Rig]> = [
  ['hips', 'hips'],
  ['spine', 'spine'],
  ['chest', 'chest'],
  ['head', 'head'],
  ['shoulderL', 'shoulderL'],
  ['shoulderR', 'shoulderR'],
  ['elbowL', 'elbowL'],
  ['elbowR', 'elbowR'],
  ['hipL', 'hipL'],
  ['hipR', 'hipR'],
  ['kneeL', 'kneeL'],
  ['kneeR', 'kneeR'],
];

const samplePose = (clip: (typeof CLIPS)[ClipName], t: number, out: Pose): void => {
  const keys = clip.keys;
  let a = keys[0];
  let bK = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (t >= keys[i][0] && t <= keys[i + 1][0]) {
      a = keys[i];
      bK = keys[i + 1];
      break;
    }
  }
  const span = bK[0] - a[0];
  const f = span <= 0 ? 0 : (t - a[0]) / span;
  // Smoothstep between keys for organic motion.
  const k = f * f * (3 - 2 * f);

  for (const [poseKey] of POSE_BONES) {
    const av = a[1][poseKey] as [number, number, number] | undefined;
    const bv = bK[1][poseKey] as [number, number, number] | undefined;
    if (!av && !bv) {
      delete out[poseKey];
      continue;
    }
    const from = av ?? [0, 0, 0];
    const to = bv ?? [0, 0, 0];
    out[poseKey] = [lerp(from[0], to[0], k), lerp(from[1], to[1], k), lerp(from[2], to[2], k)] as never;
  }
  const ay = a[1].hipsY ?? 0;
  const by = bK[1].hipsY ?? 0;
  out.hipsY = lerp(ay, by, k);
  const ap = a[1].rootPitch ?? 0;
  const bp = bK[1].rootPitch ?? 0;
  out.rootPitch = lerp(ap, bp, k);
};

/**
 * Animator with cross-fade blending between clips.
 */
export class Animator {
  private rig: Rig;
  private current: ClipName = 'stance';
  private previous: ClipName | null = null;
  private time = 0;
  private prevTime = 0;
  private blend = 1;
  private blendSpeed = 8;
  private poseA: Pose = {};
  private poseB: Pose = {};
  private speed = 1;
  /** Additive impact shake applied on hits. */
  private impact = 0;
  private impactDir = 1;
  finished = false;

  constructor(rig: Rig) {
    this.rig = rig;
  }

  get clip(): ClipName {
    return this.current;
  }

  play(name: ClipName, opts: { fade?: number; speed?: number; restart?: boolean } = {}): void {
    if (this.current === name && !opts.restart) {
      this.speed = opts.speed ?? this.speed;
      return;
    }
    this.previous = this.current;
    this.prevTime = this.time;
    this.current = name;
    this.time = 0;
    this.blend = 0;
    this.blendSpeed = 1 / Math.max(0.04, opts.fade ?? 0.16);
    this.speed = opts.speed ?? 1;
    this.finished = false;
  }

  addImpact(strength: number, dir = 1): void {
    this.impact = Math.min(1.4, this.impact + strength);
    this.impactDir = dir;
  }

  update(dt: number): void {
    const clip = CLIPS[this.current];
    this.time += dt * this.speed;
    let t = this.time / clip.duration;
    if (clip.loop) t = t % 1;
    else if (t >= 1) {
      t = 1;
      this.finished = true;
    }
    samplePose(clip, t, this.poseA);

    let pose = this.poseA;
    if (this.blend < 1 && this.previous) {
      const prevClip = CLIPS[this.previous];
      this.prevTime += dt;
      let pt = this.prevTime / prevClip.duration;
      pt = prevClip.loop ? pt % 1 : Math.min(1, pt);
      samplePose(prevClip, pt, this.poseB);
      this.blend = Math.min(1, this.blend + dt * this.blendSpeed);
      pose = this.blendPoses(this.poseB, this.poseA, this.blend);
    }

    this.applyPose(pose, dt);
    this.impact = Math.max(0, this.impact - dt * 4.5);
  }

  private blended: Pose = {};
  private blendPoses(a: Pose, b: Pose, k: number): Pose {
    const out = this.blended;
    for (const [poseKey] of POSE_BONES) {
      const av = a[poseKey] as [number, number, number] | undefined;
      const bv = b[poseKey] as [number, number, number] | undefined;
      if (!av && !bv) {
        delete out[poseKey];
        continue;
      }
      const from = av ?? [0, 0, 0];
      const to = bv ?? [0, 0, 0];
      out[poseKey] = [lerp(from[0], to[0], k), lerp(from[1], to[1], k), lerp(from[2], to[2], k)] as never;
    }
    out.hipsY = lerp(a.hipsY ?? 0, b.hipsY ?? 0, k);
    out.rootPitch = lerp(a.rootPitch ?? 0, b.rootPitch ?? 0, k);
    return out;
  }

  private applyPose(pose: Pose, dt: number): void {
    const lambda = 26;
    for (const [poseKey, boneKey] of POSE_BONES) {
      const b = this.rig[boneKey] as Bone;
      const target = pose[poseKey] as [number, number, number] | undefined;
      const tx = (target?.[0] ?? 0) + b.restRot.x;
      const ty = (target?.[1] ?? 0) + b.restRot.y;
      const tz = (target?.[2] ?? 0) + b.restRot.z;
      b.obj.rotation.x = dampAngle(b.obj.rotation.x, tx, lambda, dt);
      b.obj.rotation.y = dampAngle(b.obj.rotation.y, ty, lambda, dt);
      b.obj.rotation.z = dampAngle(b.obj.rotation.z, tz, lambda, dt);
    }

    const shake = this.impact * 0.055 * this.impactDir;
    const hips = this.rig.hips;
    hips.obj.position.y = damp(
      hips.obj.position.y,
      hips.restPos.y + (pose.hipsY ?? 0),
      18,
      dt,
    ) + shake;

    this.rig.root.rotation.x = dampAngle(this.rig.root.rotation.x, pose.rootPitch ?? 0, 14, dt);
    this.rig.chest.obj.rotation.z += shake * 0.6;
  }

  /** Snap instantly to the current pose (used when spawning). */
  snap(): void {
    for (let i = 0; i < 30; i++) this.update(1 / 60);
  }
}

export const clipForMove = (clipKey: string): ClipName =>
  (clipKey in CLIPS ? clipKey : 'snap') as ClipName;

export const breathIntensity = (staminaRatio: number): number => clamp01(1 - staminaRatio) * 0.6;
