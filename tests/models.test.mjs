import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createDeerModel, createHumanModel, createRockGeometry, createTrainCars, createTreeCrownGeometry, TRAIN_CAR_SPACING } from '../src/models.ts';

function release(root, mixer) {
  mixer?.stopAllAction();
  mixer?.uncacheRoot(root);
  const geometries = new Set();
  const materials = new Set();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

test('the pedestrian has adult proportions and a jointed walk without baked world translation', () => {
  const material = new THREE.MeshStandardMaterial();
  const model = createHumanModel({ skin: material, hair: material, jacket: material, trousers: material, boots: material, eyes: material, trim: material, pack: material });
  const bounds = new THREE.Box3().setFromObject(model.root);
  const size = bounds.getSize(new THREE.Vector3());
  assert.ok(size.y > 1.65 && size.y < 1.9);
  assert.ok(size.x > 0.4 && size.x < 0.85);
  assert.ok(bounds.min.y > -0.03 && bounds.min.y < 0.05);
  model.mixer.update(0.26);
  const left = model.root.getObjectByName('LeftThigh');
  const right = model.root.getObjectByName('RightThigh');
  assert.ok(left.rotation.x < -0.2 && right.rotation.x > 0.2);
  assert.ok(model.root.getObjectByName('LeftForearm').rotation.x < -0.1);
  assert.deepEqual(model.root.position.toArray(), [0, 0, 0]);
  release(model.root, model.mixer);
});

test('the deer has an animal silhouette and independently animated front and rear joints', () => {
  const material = new THREE.MeshStandardMaterial();
  const model = createDeerModel({ fur: material, undercoat: material, hooves: material, eyes: material, antlers: material });
  const bounds = new THREE.Box3().setFromObject(model.root);
  const size = bounds.getSize(new THREE.Vector3());
  assert.ok(size.y > 1.7 && size.y < 2.3);
  assert.ok(size.z > 1.5 && size.z < 2.3);
  assert.ok(Math.abs(bounds.min.y) < 0.03);
  model.mixer.update(0.3);
  const front = model.root.getObjectByName('FrontLeft').rotation.x;
  const rear = model.root.getObjectByName('RearLeft').rotation.x;
  assert.ok(Math.abs(front) > 0.1);
  assert.ok(Math.abs(front - rear) > 0.1);
  assert.deepEqual(model.root.position.toArray(), [0, 0, 0]);
  release(model.root, model.mixer);
});

test('train car geometry fits its spacing and the aerodynamic nose has outward-facing normals', () => {
  const material = new THREE.MeshStandardMaterial();
  const cars = createTrainCars({ body: material, stripe: material, dark: material, glass: material, metal: material, light: material, redLight: material, emblem: material });
  const bodySize = new THREE.Box3().setFromObject(cars[1]).getSize(new THREE.Vector3());
  assert.ok(bodySize.x < TRAIN_CAR_SPACING && bodySize.x > 13);
  assert.ok(bodySize.z > 2 && bodySize.z < 2.5);
  assert.ok(bodySize.x / bodySize.z > 6);
  let meshCount = 0;
  cars[1].traverse((object) => { if (object instanceof THREE.Mesh) meshCount++; });
  assert.ok(meshCount <= 8, 'Static train parts should be batched rather than drawn individually');
  let noseNormal = -Infinity;
  cars[0].traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = object.geometry.getAttribute('position');
    const normals = object.geometry.getAttribute('normal');
    for (let index = 0; index < positions.count; index++) {
      if (positions.getX(index) > 5.1 && positions.getX(index) < 5.4 && positions.getY(index) > 2.65) {
        noseNormal = Math.max(noseNormal, normals.getY(index));
      }
    }
  });
  assert.ok(noseNormal > 0.3, 'Aerodynamic nose must face outward after batching');
  const group = new THREE.Group();
  group.add(...cars);
  release(group);
});

test('organic geometry remains finite and suitable for point-cloud reconstruction', () => {
  const crown = createTreeCrownGeometry();
  const rock = createRockGeometry(1, 29);
  for (const geometry of [crown, rock]) {
    geometry.computeBoundingBox();
    assert.ok(geometry.getAttribute('position').count > 100);
    assert.ok(geometry.getAttribute('normal').array.every(Number.isFinite));
    assert.ok(geometry.getAttribute('position').array.every(Number.isFinite));
    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    assert.ok(size.x > 0 && size.y > 0 && size.z > 0);
    geometry.dispose();
  }
});
