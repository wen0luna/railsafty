import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

type Position = [number, number, number];

export interface AnimatedModel {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  action: THREE.AnimationAction;
}

export interface HumanMaterials {
  skin: THREE.Material;
  hair: THREE.Material;
  jacket: THREE.Material;
  trousers: THREE.Material;
  boots: THREE.Material;
  eyes: THREE.Material;
  trim: THREE.Material;
  pack: THREE.Material;
}

export interface DeerMaterials {
  fur: THREE.Material;
  undercoat: THREE.Material;
  hooves: THREE.Material;
  eyes: THREE.Material;
  antlers: THREE.Material;
}

export interface TrainMaterials {
  body: THREE.Material;
  stripe: THREE.Material;
  dark: THREE.Material;
  glass: THREE.Material;
  metal: THREE.Material;
  light: THREE.Material;
  redLight: THREE.Material;
  emblem: THREE.Material;
}

export const TRAIN_CAR_SPACING = 14.4;

function part(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, position: Position, scale: Position = [1, 1, 1]): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function joint(parent: THREE.Object3D, name: string, position: Position): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...position);
  parent.add(group);
  return group;
}

function animated(root: THREE.Group, duration: number, tracks: THREE.KeyframeTrack[]): AnimatedModel {
  const mixer = new THREE.AnimationMixer(root);
  const clip = new THREE.AnimationClip('Walk', duration, tracks);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopRepeat, Infinity).play();
  return { root, mixer, action };
}

function rotationTrack(name: string, axis: 'x' | 'y' | 'z', times: number[], values: number[]): THREE.NumberKeyframeTrack {
  return new THREE.NumberKeyframeTrack(`${name}.rotation[${axis}]`, times, values, THREE.InterpolateSmooth);
}

export function createHumanModel(materials: HumanMaterials): AnimatedModel {
  const root = new THREE.Group();
  root.name = 'Pedestrian';
  const sphere = new THREE.SphereGeometry(1, 20, 14);
  const box = new RoundedBoxGeometry(1, 1, 1, 2, 0.12);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 16);
  const upperArm = new THREE.CapsuleGeometry(0.062, 0.18, 5, 14);
  const lowerArm = new THREE.CapsuleGeometry(0.049, 0.19, 5, 14);
  const thigh = new THREE.CapsuleGeometry(0.077, 0.245, 5, 14);
  const shin = new THREE.CapsuleGeometry(0.058, 0.268, 5, 14);
  const finger = new THREE.CapsuleGeometry(0.008, 0.037, 3, 7);
  const hips = joint(root, 'Hips', [0, 0.9, 0]);
  part(hips, sphere, materials.trousers, [0, 0, 0], [0.17, 0.13, 0.115]);
  const torso = joint(hips, 'Torso', [0, 0.025, 0]);
  const profile = [
    new THREE.Vector2(0.14, 0), new THREE.Vector2(0.167, 0.045),
    new THREE.Vector2(0.187, 0.17), new THREE.Vector2(0.22, 0.34),
    new THREE.Vector2(0.205, 0.405), new THREE.Vector2(0.083, 0.455),
  ];
  part(torso, new THREE.LatheGeometry(profile, 28), materials.jacket, [0, 0, 0], [1, 1, 0.64]);
  part(torso, box, materials.trim, [0, 0.215, 0.128], [0.012, 0.39, 0.008]);
  part(torso, box, materials.pack, [0, 0.235, -0.15], [0.27, 0.34, 0.13]);
  for (const side of [-1, 1]) {
    const strap = part(torso, box, materials.pack, [side * 0.125, 0.255, 0.119], [0.027, 0.32, 0.018]);
    strap.rotation.z = side * 0.09;
    part(torso, box, materials.trim, [side * 0.095, 0.19, 0.126], [0.095, 0.004, 0.008]);
  }
  part(hips, cylinder, materials.skin, [0, 0.565, 0], [0.053, 0.13, 0.05]);
  const head = joint(hips, 'Head', [0, 0.62, 0.005]);
  part(head, sphere, materials.skin, [0, 0.115, 0.008], [0.087, 0.122, 0.092]);
  part(head, sphere, materials.skin, [0, 0.042, 0.008], [0.074, 0.06, 0.075]);
  const hair = new THREE.SphereGeometry(1, 22, 12, 0, Math.PI * 2, 0, 1.4);
  part(head, hair, materials.hair, [0, 0.137, 0.004], [0.092, 0.116, 0.098]);
  part(head, sphere, materials.hair, [0, 0.10, -0.056], [0.089, 0.087, 0.051]);
  part(head, sphere, materials.skin, [0, 0.108, 0.103], [0.014, 0.021, 0.020]);
  part(head, box, materials.hair, [0, 0.061, 0.086], [0.031, 0.0025, 0.003]);
  for (const side of [-1, 1]) {
    part(head, sphere, materials.skin, [side * 0.087, 0.11, 0.003], [0.015, 0.026, 0.014]);
    part(head, sphere, materials.eyes, [side * 0.032, 0.145, 0.093], [0.011, 0.005, 0.004]);
    const brow = part(head, box, materials.hair, [side * 0.031, 0.163, 0.09], [0.026, 0.004, 0.005]);
    brow.rotation.z = side * 0.1;
    const label = side < 0 ? 'Left' : 'Right';
    const arm = joint(hips, `${label}Arm`, [side * 0.212, 0.435, 0]);
    arm.rotation.z = side * 0.065;
    part(arm, upperArm, materials.jacket, [side * 0.008, -0.14, 0], [1, 1, 0.88]);
    const elbow = joint(arm, `${label}Forearm`, [side * 0.014, -0.28, 0]);
    part(elbow, lowerArm, materials.jacket, [0, -0.14, 0], [1, 1, 0.88]);
    part(elbow, cylinder, materials.trim, [0, -0.259, 0], [0.043, 0.032, 0.041]);
    const wrist = joint(elbow, `${label}Hand`, [0, -0.28, 0]);
    part(wrist, sphere, materials.skin, [0, -0.035, 0.003], [0.036, 0.052, 0.021]);
    for (let digit = 0; digit < 4; digit++) {
      const mesh = part(wrist, finger, materials.skin, [(digit - 1.5) * 0.016, -0.087, 0.011], [1, 1 - Math.abs(digit - 1.5) * 0.1, 1]);
      mesh.rotation.x = -0.18;
    }
    const thumb = part(wrist, finger, materials.skin, [-side * 0.035, -0.049, 0.013], [1, 0.9, 1]);
    thumb.rotation.z = -side * 0.55;
    const hip = joint(hips, `${label}Thigh`, [side * 0.092, -0.005, 0]);
    part(hip, thigh, materials.trousers, [0, -0.19, 0], [1, 1, 0.91]);
    const knee = joint(hip, `${label}Shin`, [0, -0.4, 0]);
    part(knee, shin, materials.trousers, [0, -0.19, 0], [1, 1, 0.92]);
    const ankle = joint(knee, `${label}Foot`, [0, -0.39, 0]);
    part(ankle, box, materials.boots, [0, -0.045, 0.065], [0.13, 0.095, 0.25]);
    part(ankle, box, materials.trim, [0, -0.087, 0.075], [0.14, 0.022, 0.28]);
  }
  const duration = 1.25;
  const times = Array.from({ length: 17 }, (_, index) => index / 16 * duration);
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [label, phase] of [['Left', 0], ['Right', Math.PI]] as const) {
    const waves = times.map((time) => Math.sin(time / duration * Math.PI * 2 + phase));
    const knees = waves.map((wave) => 0.06 + Math.max(0, wave) * 1.1);
    tracks.push(
      rotationTrack(`${label}Thigh`, 'x', times, waves.map((wave) => -wave * 0.4)),
      rotationTrack(`${label}Shin`, 'x', times, knees),
      rotationTrack(`${label}Foot`, 'x', times, waves.map((wave, index) => wave * 0.4 - knees[index] - Math.max(0, wave) * 0.08)),
      rotationTrack(`${label}Arm`, 'x', times, waves.map((wave) => wave * 0.32)),
      rotationTrack(`${label}Forearm`, 'x', times, waves.map((wave) => -0.19 - Math.max(0, -wave) * 0.16)),
    );
  }
  tracks.push(
    new THREE.NumberKeyframeTrack('Hips.position[y]', times, times.map((time) => 0.9 - Math.sin(time / duration * Math.PI * 2) ** 2 * 0.08)),
    rotationTrack('Torso', 'y', times, times.map((time) => Math.sin(time / duration * Math.PI * 2) * 0.035)),
    rotationTrack('Head', 'y', times, times.map((time) => Math.sin(time / duration * Math.PI * 2) * -0.025)),
  );
  return animated(root, duration, tracks);
}

function branch(parent: THREE.Object3D, from: Position, to: Position, radius: number, material: THREE.Material): void {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const direction = end.clone().sub(start);
  const mesh = part(parent, new THREE.CylinderGeometry(radius * 0.35, radius, direction.length(), 8), material, start.clone().add(end).multiplyScalar(0.5).toArray());
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
}

export function createDeerModel(materials: DeerMaterials): AnimatedModel {
  const root = new THREE.Group();
  root.name = 'Deer';
  const sphere = new THREE.SphereGeometry(1, 20, 12);
  const cylinder = new THREE.CylinderGeometry(0.68, 1, 1, 12);
  const hoof = new RoundedBoxGeometry(1, 1, 1, 2, 0.12);
  const body = joint(root, 'DeerBody', [0, 0, 0]);
  part(body, sphere, materials.fur, [0, 1.03, -0.05], [0.3, 0.35, 0.66]);
  part(body, sphere, materials.fur, [0, 1.0, -0.46], [0.285, 0.32, 0.3]);
  part(body, sphere, materials.undercoat, [0, 0.85, 0.07], [0.255, 0.19, 0.52]);
  const neck = part(body, sphere, materials.fur, [0, 1.31, 0.48], [0.14, 0.36, 0.16]);
  neck.rotation.x = 0.45;
  const bib = part(body, sphere, materials.undercoat, [0, 1.25, 0.61], [0.09, 0.22, 0.055]);
  bib.rotation.x = 0.4;
  const head = joint(body, 'DeerHead', [0, 1.54, 0.67]);
  part(head, sphere, materials.fur, [0, 0.04, 0.13], [0.126, 0.145, 0.235]);
  part(head, sphere, materials.fur, [0, -0.008, 0.315], [0.085, 0.079, 0.135]);
  part(head, sphere, materials.hooves, [0, 0.004, 0.426], [0.067, 0.043, 0.035]);
  for (const side of [-1, 1]) {
    part(head, sphere, materials.eyes, [side * 0.111, 0.083, 0.19], [0.015, 0.019, 0.013]);
    const ear = part(head, sphere, materials.fur, [side * 0.153, 0.222, 0.018], [0.058, 0.139, 0.027]);
    ear.rotation.z = -side * 0.55;
    const inner = part(head, sphere, materials.undercoat, [side * 0.156, 0.221, 0.041], [0.038, 0.104, 0.008]);
    inner.rotation.z = -side * 0.55;
    branch(head, [side * 0.065, 0.15, 0.03], [side * 0.12, 0.39, -0.01], 0.024, materials.antlers);
    branch(head, [side * 0.12, 0.39, -0.01], [side * 0.19, 0.57, -0.07], 0.016, materials.antlers);
    branch(head, [side * 0.10, 0.31, 0.0], [side * 0.18, 0.43, 0.12], 0.013, materials.antlers);
    branch(head, [side * 0.15, 0.48, -0.04], [side * 0.24, 0.55, 0.03], 0.01, materials.antlers);
  }
  const tail = joint(body, 'DeerTail', [0, 1.12, -0.69]);
  const tailMesh = part(tail, sphere, materials.fur, [0, 0.025, -0.1], [0.075, 0.12, 0.105]);
  tailMesh.rotation.x = -0.4;
  part(tail, sphere, materials.undercoat, [0, 0.014, -0.132], [0.045, 0.095, 0.06]);
  const legNames = ['FrontLeft', 'FrontRight', 'RearLeft', 'RearRight'] as const;
  legNames.forEach((name, index) => {
    const side = index % 2 ? 1 : -1;
    const rear = index > 1;
    const hip = joint(body, name, [side * (rear ? 0.218 : 0.19), 1.0, rear ? -0.43 : 0.39]);
    part(hip, sphere, materials.fur, [0, -0.15, 0], [rear ? 0.1 : 0.064, 0.23, rear ? 0.115 : 0.065]);
    const knee = joint(hip, `${name}Knee`, [0, -0.36, 0]);
    part(knee, cylinder, materials.fur, [0, -0.185, 0], [0.037, 0.37, 0.037]);
    part(knee, sphere, materials.fur, [0, 0, 0], [0.043, 0.055, 0.045]);
    const ankle = joint(knee, `${name}Ankle`, [0, -0.37, 0]);
    part(ankle, cylinder, materials.fur, [0, -0.09, 0], [0.026, 0.18, 0.026]);
    part(ankle, hoof, materials.hooves, [0, -0.225, 0.025], [0.077, 0.09, 0.12]);
  });
  const duration = 1.6;
  const times = Array.from({ length: 17 }, (_, index) => index / 16 * duration);
  const tracks: THREE.KeyframeTrack[] = [];
  legNames.forEach((name, index) => {
    const phase = [0, Math.PI, Math.PI * 0.65, Math.PI * 1.65][index];
    const values = times.map((time) => Math.sin(time / duration * Math.PI * 2 + phase));
    tracks.push(
      rotationTrack(name, 'x', times, values.map((value) => -value * 0.32)),
      rotationTrack(`${name}Knee`, 'x', times, values.map((value) => 0.025 + Math.max(0, value) * 0.58)),
      rotationTrack(`${name}Ankle`, 'x', times, values.map((value) => -Math.max(0, value) * 0.19)),
    );
  });
  tracks.push(
    new THREE.NumberKeyframeTrack('DeerBody.position[y]', times, times.map((time) => -0.018 + Math.cos(time / duration * Math.PI * 4) * 0.01)),
    rotationTrack('DeerHead', 'x', times, times.map((time) => 0.025 + Math.sin(time / duration * Math.PI * 2) * 0.045)),
    rotationTrack('DeerTail', 'z', times, times.map((time) => Math.sin(time / duration * Math.PI * 2) * 0.1)),
  );
  return animated(root, duration, tracks);
}

function noseGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const rings = 20;
  const sides = 28;
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring / rings;
    const width = Math.max(0.018, 1.075 * (1 - t) ** 0.67);
    const height = Math.max(0.018, 1.2 * (1 - t) ** 0.8);
    const center = 1.68 - t * 1.02;
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * Math.PI * 2;
      positions.push(4.95 + t * 4.1, center + Math.cos(angle) * height, Math.sin(angle) * width);
      uvs.push(t, side / sides);
      if (ring < rings && side < sides) {
        const index = ring * (sides + 1) + side;
        indices.push(index, index + 1, index + sides + 1, index + 1, index + sides + 2, index + sides + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function mergeTrainParts(root: THREE.Group, originals: Set<THREE.BufferGeometry>, emblem: THREE.Material): void {
  root.updateMatrixWorld(true);
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (Array.isArray(object.material)) throw new Error('Train parts require a single material before batching.');
    originals.add(object.geometry);
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    if (!geometry.getAttribute('uv')) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2));
    }
    let batch = batches.get(object.material);
    if (!batch) { batch = []; batches.set(object.material, batch); }
    batch.push(geometry);
  });
  root.clear();
  for (const [material, geometries] of batches) {
    const geometry = mergeGeometries(geometries);
    geometries.forEach((value) => value.dispose());
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = material !== emblem;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
}

export function createTrainCars(materials: TrainMaterials): THREE.Group[] {
  const body = new RoundedBoxGeometry(13.8, 2.4, 2.15, 4, 0.35);
  const cabBody = new RoundedBoxGeometry(11.9, 2.4, 2.15, 4, 0.35);
  const window = new RoundedBoxGeometry(0.86, 0.6, 0.035, 1, 0.12);
  const box = new RoundedBoxGeometry(1, 1, 1, 2, 0.08);
  const wheel = new THREE.CylinderGeometry(0.3, 0.3, 0.15, 20);
  const hub = new THREE.CylinderGeometry(0.12, 0.12, 0.16, 16);
  const nose = noseGeometry();
  const lamp = new THREE.SphereGeometry(1, 12, 8);
  const emblem = new THREE.PlaneGeometry(1.7, 0.36);
  const originals = new Set<THREE.BufferGeometry>();
  const cars = Array.from({ length: 5 }, (_, index) => {
    const root = new THREE.Group();
    root.name = `EMU-${index + 1}`;
    const shell = new THREE.Group();
    const cab = index === 0 || index === 4;
    if (index === 4) shell.rotation.y = Math.PI;
    root.add(shell);
    part(shell, cab ? cabBody : body, materials.body, [cab ? -1 : 0, 1.68, 0]);
    part(shell, box, materials.dark, [cab ? -0.9 : 0, 0.48, 0], [cab ? 11.6 : 13.2, 0.32, 1.7]);
    for (const side of [-1, 1]) {
      part(shell, box, materials.stripe, [cab ? -1 : 0, 1.24, side * 1.065], [cab ? 11.6 : 13.55, 0.14, 0.035]);
      part(shell, box, materials.metal, [cab ? -1 : 0, 0.74, side * 1.037], [cab ? 11.6 : 13.5, 0.025, 0.02]);
      for (let x = -5.15; x <= (cab ? 3.2 : 5.2); x += 1.15) part(shell, window, materials.glass, [x, 2.12, side * 1.073]);
      const doorPositions = cab ? [-6.15] : [-6.0, 6.0];
      for (const x of doorPositions) {
        part(shell, box, materials.metal, [x, 1.65, side * 1.075], [0.66, 1.8, 0.018]);
        part(shell, box, materials.body, [x, 1.65, side * 1.09], [0.61, 1.74, 0.02]);
        part(shell, window, materials.glass, [x, 2.09, side * 1.11], [0.48, 1, 1]);
      }
      const label = part(shell, emblem, materials.emblem, [-2.4, 1.66, side * 1.098]);
      label.rotation.y = side < 0 ? Math.PI : 0;
    }
    for (const x of [-4.6, cab ? 2.7 : 4.6]) {
      part(shell, box, materials.dark, [x, 0.47, 0], [1.8, 0.34, 1.45]);
      for (const offset of [-0.55, 0.55]) {
        for (const z of [-0.74, 0.74]) {
          const tire = part(shell, wheel, materials.dark, [x + offset, 0.3, z]);
          tire.rotation.x = Math.PI / 2;
          const center = part(shell, hub, materials.metal, [x + offset, 0.3, z * 1.02]);
          center.rotation.x = Math.PI / 2;
        }
      }
    }
    if (cab) {
      part(shell, nose, materials.body, [0, 0, 0]);
      const windshieldGeometry = new THREE.BufferGeometry();
      windshieldGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
        5.05, 2.85, -0.67, 5.05, 2.85, 0.67, 6.65, 1.96, -0.43, 6.65, 1.96, 0.43,
      ], 3));
      windshieldGeometry.setIndex([0, 1, 2, 1, 3, 2]);
      windshieldGeometry.computeVertexNormals();
      part(shell, windshieldGeometry, materials.glass, [0, 0.025, 0]);
      for (const side of [-1, 1]) {
        const positions: number[] = [];
        for (let step = 0; step <= 16; step++) {
          const t = step / 20;
          const width = 1.075 * (1 - t) ** 0.67;
          const height = 1.2 * (1 - t) ** 0.8;
          const center = 1.68 - t * 1.02;
          for (const fraction of [-0.4, -0.28]) {
            positions.push(4.96 + t * 4.1, center + height * fraction, side * (width * Math.sqrt(1 - fraction ** 2) + 0.005));
          }
        }
        const stripeGeometry = new THREE.BufferGeometry();
        stripeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const indices: number[] = [];
        for (let step = 0; step < 16; step++) indices.push(step * 2, step * 2 + 1, step * 2 + 2, step * 2 + 1, step * 2 + 3, step * 2 + 2);
        stripeGeometry.setIndex(indices);
        stripeGeometry.computeVertexNormals();
        part(shell, stripeGeometry, materials.stripe, [0, 0, 0]);
        part(shell, lamp, index === 4 ? materials.redLight : materials.light, [8.44, 0.79, side * 0.23], [0.08, 0.045, 0.055]);
      }
      part(shell, box, materials.dark, [5.65, 2.55, 0], [0.045, 0.04, 1.1]).rotation.z = -0.48;
      part(shell, box, materials.dark, [-7, 1.35, 0], [0.28, 1.8, 1.6]);
    } else {
      for (const x of [-7, 7]) part(shell, box, materials.dark, [x, 1.35, 0], [0.28, 1.8, 1.6]);
      part(shell, box, materials.metal, [0, 2.97, 0], [2.4, 0.21, 1.35]);
      for (let x = -0.9; x <= 1; x += 0.3) part(shell, box, materials.dark, [x, 3.085, 0], [0.075, 0.02, 1.0]);
      if (index === 2) {
        branch(shell, [-0.6, 3.12, 0], [0.35, 4.0, 0], 0.035, materials.metal);
        branch(shell, [0.35, 4.0, 0], [-0.4, 4.94, 0], 0.028, materials.metal);
        part(shell, box, materials.dark, [-0.4, 4.94, 0], [0.16, 0.07, 1.35]);
      }
    }
    mergeTrainParts(root, originals, materials.emblem);
    return root;
  });
  originals.forEach((geometry) => geometry.dispose());
  return cars;
}

export function createRockGeometry(radius: number, seed: number): THREE.BufferGeometry {
  const raw = new THREE.IcosahedronGeometry(radius, 2);
  const positions = raw.getAttribute('position');
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index) / radius;
    const y = positions.getY(index) / radius;
    const z = positions.getZ(index) / radius;
    const noise = 1 + Math.sin(x * 4 + seed) * Math.cos(z * 5 - seed) * 0.13 + Math.sin(y * 7 + x * 3) * 0.07;
    positions.setXYZ(index, x * radius * noise * 1.1, y * radius * noise * 0.78, z * radius * noise);
  }
  const geometry = mergeVertices(raw);
  raw.dispose();
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createTreeCrownGeometry(): THREE.BufferGeometry {
  const clusters: THREE.BufferGeometry[] = [];
  for (const [x, y, z, sx, sy, sz] of [[0, 0, 0, 1.5, 1.55, 1.35], [-0.7, -0.35, 0.25, 1.1, 1.1, 1.05], [0.65, 0.35, -0.2, 1.05, 1.2, 1.0]]) {
    const geometry = new THREE.SphereGeometry(1, 12, 6);
    const positions = geometry.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    for (let index = 0; index < positions.count; index++) {
      const px = positions.getX(index);
      const py = positions.getY(index);
      const pz = positions.getZ(index);
      const noise = 1 + Math.sin(px * 7 + py * 4) * Math.cos(pz * 6) * 0.13;
      positions.setXYZ(index, px * noise * sx + x, py * noise * sy + y, pz * noise * sz + z);
      const shade = 0.72 + (py + 1) * 0.14;
      colors.set([shade, shade, shade * 0.9], index * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    clusters.push(geometry);
  }
  const merged = mergeGeometries(clusters);
  clusters.forEach((geometry) => geometry.dispose());
  merged.computeBoundingSphere();
  return merged;
}
