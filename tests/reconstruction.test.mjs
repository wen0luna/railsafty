import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fusePositions, FusionReconstruction, sampleSceneSurfaces } from '../src/reconstruction.ts';

test('fusion weights each axis using the corresponding sensor uncertainty', () => {
  const result = fusePositions(
    { position: [1, 2, 10], variance: [1, 0.25, 9] },
    { position: [3, 6, 4], variance: [3, 1, 1] },
  );
  assert.ok(Math.abs(result.position[0] - 1.5) < 1e-10);
  assert.ok(Math.abs(result.position[1] - 2.8) < 1e-10);
  assert.ok(Math.abs(result.position[2] - 4.6) < 1e-10);
  assert.ok(result.variance.every((value, axis) => value < [1, 0.25, 9][axis] && value < [3, 1, 1][axis]));
  assert.throws(() => fusePositions({ position: [0, 0, 0], variance: [0, 1, 1] }, { position: [0, 0, 0], variance: [1, 1, 1] }), RangeError);
  assert.throws(() => fusePositions({ position: [NaN, 0, 0], variance: [1, 1, 1] }, { position: [0, 0, 0], variance: [1, 1, 1] }), RangeError);
});

test('point clouds sample real geometry and apply both instance and parent transforms', () => {
  const scene = new THREE.Scene();
  const parent = new THREE.Group();
  parent.position.set(20, 3, -5);
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const material = new THREE.MeshBasicMaterial({ color: '#44cbb0' });
  const mesh = new THREE.InstancedMesh(geometry, material, 2);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, 0));
  mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(10, 0, 0));
  parent.add(mesh);
  scene.add(parent);
  const cloud = sampleSceneSurfaces(scene);
  const xs = [];
  for (let i = 0; i < cloud.positions.length; i += 3) {
    const x = cloud.positions[i];
    const y = cloud.positions[i + 1];
    const z = cloud.positions[i + 2];
    xs.push(x);
    assert.ok((x >= 19 && x <= 21) || (x >= 29 && x <= 31));
    assert.ok(y >= 2 && y <= 4);
    assert.ok(z >= -6 && z <= -4);
  }
  assert.ok(xs.some((x) => x < 22) && xs.some((x) => x > 28));
  assert.equal(cloud.colors.length, cloud.positions.length);
  assert.ok(cloud.colors.every(Number.isFinite));
  geometry.dispose();
  material.dispose();
});

test('reconstruction excludes overlays and hidden geometry and respects its sample budget', () => {
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const material = new THREE.MeshBasicMaterial();
  const visible = new THREE.Mesh(geometry, material);
  const overlay = new THREE.Group();
  const hidden = new THREE.Mesh(geometry, material);
  overlay.position.x = 100;
  overlay.add(new THREE.Mesh(geometry, material));
  hidden.position.x = 200;
  hidden.visible = false;
  scene.add(visible, overlay, hidden);
  const cloud = sampleSceneSurfaces(scene, [overlay], 10);
  assert.equal(cloud.sourceCount, 1);
  assert.ok(cloud.positions.length / 3 <= 10);
  assert.ok(cloud.positions.every((value) => Math.abs(value) <= 1));
  geometry.dispose();
  material.dispose();
});

test('lower-density terrain retains dense reconstruction samples and its fused surface', () => {
  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicMaterial();
  const terrain = new THREE.Mesh(new THREE.PlaneGeometry(30, 30, 4, 4), material);
  terrain.rotation.x = -Math.PI / 2;
  terrain.userData.reconstructionTerrain = true;
  scene.add(terrain);
  const cloud = sampleSceneSurfaces(scene, [], 4000);
  assert.ok(cloud.positions.length / 3 >= 3000);
  const reconstruction = new FusionReconstruction(scene, []);
  let surfaceFound = false;
  reconstruction.root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.geometry === terrain.geometry) surfaceFound = true;
  });
  assert.equal(surfaceFound, true);
  scene.add(reconstruction.root);
  const geometries = new Set([terrain.geometry]);
  const materials = new Set([material]);
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line) {
      geometries.add(object.geometry);
      for (const value of Array.isArray(object.material) ? object.material : [object.material]) materials.add(value);
    }
  });
  geometries.forEach((value) => value.dispose());
  materials.forEach((value) => value.dispose());
});

test('switching reconstruction layers preserves camera sources and changing targets resets tracking', () => {
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const material = new THREE.MeshBasicMaterial();
  const ground = new THREE.Mesh(geometry, material);
  ground.scale.set(10, 0.1, 10);
  const first = new THREE.Mesh(geometry, material);
  first.position.set(3, 1, 0);
  const second = new THREE.Mesh(geometry, material);
  second.position.set(30, 2, 0);
  scene.add(ground, first, second);
  const reconstruction = new FusionReconstruction(scene, [first, second]);
  scene.add(reconstruction.root);
  reconstruction.setTarget(first, 'TRACK-A', new THREE.Vector3());
  for (const [index, mode] of ['vision', 'radar', 'fusion'].entries()) {
    reconstruction.setMode(mode);
    const stats = reconstruction.update(index + 1);
    assert.equal(stats.mode, mode);
    assert.equal(stats.targetId, 'TRACK-A');
    assert.ok(stats.visionPoints > stats.radarPoints && stats.radarPoints > 0);
    assert.equal(first.visible, true);
    assert.equal(first.layers.mask, 1);
    assert.equal(ground.layers.mask, 1);
  }
  reconstruction.setTarget(second, 'TRACK-B', new THREE.Vector3());
  const changed = reconstruction.update(4);
  assert.equal(changed.targetId, 'TRACK-B');
  assert.ok(changed.position[0] > 28);
  assert.equal(changed.speed, 0);
  reconstruction.setMode('scene');
  assert.equal(reconstruction.root.visible, false);
  const geometries = new Set([geometry]);
  const materials = new Set([material]);
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line) {
      geometries.add(object.geometry);
      for (const value of Array.isArray(object.material) ? object.material : [object.material]) materials.add(value);
    }
  });
  geometries.forEach((value) => value.dispose());
  materials.forEach((value) => value.dispose());
});
