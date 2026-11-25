import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

export type ReconstructionMode = 'scene' | 'vision' | 'radar' | 'fusion';
type Coordinates = [number, number, number];

export interface PositionObservation {
  position: Coordinates;
  variance: Coordinates;
}

export function fusePositions(vision: PositionObservation, radar: PositionObservation): PositionObservation {
  const position: Coordinates = [0, 0, 0];
  const variance: Coordinates = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    const vp = vision.position[axis];
    const rp = radar.position[axis];
    const vv = vision.variance[axis];
    const rv = radar.variance[axis];
    if (![vp, rp, vv, rv].every(Number.isFinite) || vv <= 0 || rv <= 0) {
      throw new RangeError('融合观测坐标必须有限，且各轴方差必须大于零。');
    }
    variance[axis] = 1 / (1 / vv + 1 / rv);
    position[axis] = (vp / vv + rp / rv) * variance[axis];
  }
  return { position, variance };
}

export interface SurfaceCloud {
  positions: Float32Array;
  colors: Float32Array;
  sourceCount: number;
}

function isVisibleWithin(object: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false;
    if (current === root) return true;
  }
  return false;
}

function meshColor(mesh: THREE.Mesh): THREE.Color {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return 'color' in material && material.color instanceof THREE.Color ? material.color : new THREE.Color('#77d2ca');
}

export function sampleSceneSurfaces(root: THREE.Object3D, exclusions: THREE.Object3D[] = [], budget = 48000): SurfaceCloud {
  if (!Number.isInteger(budget) || budget <= 0) throw new RangeError('点云采样预算必须为正整数。');
  root.updateWorldMatrix(true, true);
  const excluded = new Set(exclusions);
  const sources: { mesh: THREE.Mesh; count: number; quota: number }[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !isVisibleWithin(object, root)) return;
    for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) {
      if (excluded.has(parent)) return;
    }
    const geometry = object.geometry;
    if (!geometry.getAttribute('position') || geometry.getAttribute('position').count < 3) return;
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.clone().applyMatrix4(object.matrixWorld).getSize(new THREE.Vector3());
    const count = object instanceof THREE.InstancedMesh ? object.count : 1;
    const area = 2 * (size.x * size.y + size.y * size.z + size.x * size.z);
    const quota = count > 1 ? count * 6 : object.userData.reconstructionTerrain === true || geometry.getAttribute('position').count > 10000 ? 12000
      : size.x > 70 || size.z > 70 ? 1400 : THREE.MathUtils.clamp(Math.ceil(area * 2), 14, 280);
    sources.push({ mesh: object, count, quota });
  });
  const ratio = Math.min(1, budget / Math.max(1, sources.reduce((sum, source) => sum + source.quota, 0)));
  const samplers = new Map<THREE.BufferGeometry, MeshSurfaceSampler>();
  const positions: number[] = [];
  const colors: number[] = [];
  const point = new THREE.Vector3();
  const color = new THREE.Color();
  const cyan = new THREE.Color('#64dacf');
  const instance = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  for (const { mesh, count, quota } of sources) {
    let sampler = samplers.get(mesh.geometry);
    if (!sampler) {
      sampler = new MeshSurfaceSampler(mesh).build();
      samplers.set(mesh.geometry, sampler);
    }
    const perInstance = Math.max(1, Math.floor(quota * ratio / count));
    for (let index = 0; index < count && positions.length / 3 < budget; index++) {
      world.copy(mesh.matrixWorld);
      if (mesh instanceof THREE.InstancedMesh) {
        mesh.getMatrixAt(index, instance);
        world.multiply(instance);
      }
      for (let sample = 0; sample < perInstance && positions.length / 3 < budget; sample++) {
        color.set('#ffffff');
        sampler.sample(point, undefined, color);
        point.applyMatrix4(world);
        positions.push(point.x, point.y, point.z);
        color.multiply(meshColor(mesh)).lerp(cyan, 0.6);
        colors.push(color.r, color.g, color.b);
      }
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors), sourceCount: sources.length };
}

export interface ReconstructionStats {
  mode: ReconstructionMode;
  visionPoints: number;
  radarPoints: number;
  surfaces: number;
  targetId: string;
  position: Coordinates;
  range: number;
  speed: number;
  visionError: number;
  radarError: number;
  fusionError: number;
  simulated: true;
}

interface MovingSurface {
  mesh: THREE.Mesh;
  local: Float32Array;
  wire: THREE.Mesh;
}

export function targetFrame(color: string): THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial> {
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const geometry = new THREE.EdgesGeometry(cube);
  cube.dispose();
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false }));
}

export class FusionReconstruction {
  readonly root = new THREE.Group();
  private readonly vision = new THREE.Group();
  private readonly radar = new THREE.Group();
  private readonly surfaces = new THREE.Group();
  private readonly movingSurfaces = new THREE.Group();
  private readonly associations = new THREE.Group();
  private readonly staticVision: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly staticRadar: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly movingVision: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly movingRadar: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly visionBox: THREE.LineSegments;
  private readonly radarBox: THREE.LineSegments;
  private readonly fusedBox: THREE.LineSegments;
  private readonly trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#b6f777', transparent: true, opacity: 0.9, depthTest: false }));
  private readonly associationLine = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#c4e6d9', transparent: true, opacity: 0.7, depthTest: false }));
  private readonly scanPlane: THREE.Mesh;
  private readonly wireMaterial = new THREE.MeshBasicMaterial({ color: '#39b6aa', wireframe: true, transparent: true, opacity: 0.13, depthWrite: false });
  private readonly moving: MovingSurface[] = [];
  private readonly history: THREE.Vector3[] = [];
  private readonly bounds = new THREE.Box3();
  private readonly point = new THREE.Vector3();
  private readonly truth = new THREE.Vector3();
  private readonly fused = new THREE.Vector3();
  private readonly visualOffset = new THREE.Vector3();
  private readonly radarOffset = new THREE.Vector3();
  private readonly fusionOffset = new THREE.Vector3();
  private readonly previous = new THREE.Vector3();
  private readonly radarOrigin = new THREE.Vector3();
  private target: THREE.Object3D | null = null;
  private targetId = 'TRACK-TRAIN';
  private lastUpdate = -1;
  private mode: ReconstructionMode = 'fusion';
  private speed = 0;
  private stats: ReconstructionStats | null = null;
  private readonly sourceCount: number;

  constructor(source: THREE.Scene, exclusions: THREE.Object3D[]) {
    const cloud = sampleSceneSurfaces(source, exclusions);
    this.sourceCount = cloud.sourceCount;
    this.staticVision = this.points(cloud.positions, cloud.colors, '#65d9ce', 0.38);
    const radar: number[] = [];
    for (let i = 0; i < cloud.positions.length; i += 108) {
      radar.push(
        Math.round(cloud.positions[i] * 4) / 4,
        Math.round(cloud.positions[i + 1] * 4) / 4,
        Math.round(cloud.positions[i + 2] * 4) / 4,
      );
    }
    this.staticRadar = this.points(new Float32Array(radar), null, '#ffb56a', 0.78);
    this.movingVision = this.points(new Float32Array(), null, '#a7f4df', 0.25);
    this.movingRadar = this.points(new Float32Array(), null, '#ffc477', 0.62);
    this.vision.add(this.staticVision, this.movingVision);
    this.radar.add(this.staticRadar, this.movingRadar);
    this.visionBox = targetFrame('#5ddfe4');
    this.radarBox = targetFrame('#ffb86b');
    this.fusedBox = targetFrame('#b6f777');
    this.associations.add(this.visionBox, this.radarBox, this.fusedBox, this.trail, this.associationLine);
    const grid: number[] = [];
    for (let x = -110; x <= 110; x += 10) grid.push(x, -0.15, -72, x, -0.15, 72);
    for (let z = -70; z <= 70; z += 10) grid.push(-112, -0.15, z, 112, -0.15, z);
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(grid, 3));
    const gridLines = new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: '#2d6577', transparent: true, opacity: 0.34 }));
    this.scanPlane = new THREE.Mesh(new THREE.PlaneGeometry(144, 45), new THREE.MeshBasicMaterial({ color: '#55f4de', transparent: true, opacity: 0.045, side: THREE.DoubleSide, depthWrite: false }));
    this.scanPlane.rotation.y = Math.PI / 2;
    this.scanPlane.position.y = 21;
    source.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || !isVisibleWithin(object, source)) return;
      for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) if (exclusions.includes(parent)) return;
      if (object.userData.reconstructionTerrain === true || object.geometry.getAttribute('position').count > 10000) {
        const mesh = new THREE.Mesh(object.geometry, this.wireMaterial);
        mesh.matrix.copy(object.matrixWorld);
        mesh.matrixAutoUpdate = false;
        this.surfaces.add(mesh);
      }
    });
    this.surfaces.add(this.movingSurfaces);
    this.root.add(gridLines, this.vision, this.radar, this.surfaces, this.associations, this.scanPlane);
    this.trail.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.trail.geometry.setDrawRange(0, 0);
    this.trail.frustumCulled = false;
    this.associationLine.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3).setUsage(THREE.DynamicDrawUsage));
    this.associationLine.frustumCulled = false;
    this.root.traverse((object) => object.layers.set(1));
    this.setMode('fusion');
  }

  private points(positions: Float32Array, colors: Float32Array | null, color: string, size: number): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({ size, vertexColors: colors !== null, color: colors ? '#ffffff' : color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return points;
  }

  setTarget(target: THREE.Object3D, id: string, radarOrigin: THREE.Vector3): void {
    this.target = target;
    this.targetId = id;
    this.radarOrigin.copy(radarOrigin);
    this.moving.length = 0;
    this.movingSurfaces.clear();
    this.history.length = 0;
    this.trail.geometry.setDrawRange(0, 0);
    this.lastUpdate = -1;
    this.speed = 0;
    target.updateWorldMatrix(true, true);
    let total = 0;
    target.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const sampler = new MeshSurfaceSampler(object).build();
      const count = object.geometry.getAttribute('position').count > 150 ? 90 : 28;
      const local = new Float32Array(count * 3);
      for (let index = 0; index < count; index++) {
        sampler.sample(this.point);
        this.point.toArray(local, index * 3);
      }
      const wire = new THREE.Mesh(object.geometry, this.wireMaterial);
      wire.matrixAutoUpdate = false;
      wire.layers.set(1);
      this.movingSurfaces.add(wire);
      this.moving.push({ mesh: object, local, wire });
      total += count;
    });
    this.movingVision.geometry.dispose();
    this.movingVision.geometry = new THREE.BufferGeometry();
    this.movingVision.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.movingRadar.geometry.dispose();
    this.movingRadar.geometry = new THREE.BufferGeometry();
    this.movingRadar.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.ceil(total / 12) * 3), 3).setUsage(THREE.DynamicDrawUsage));
  }

  setMode(mode: ReconstructionMode): void {
    if (this.mode === 'scene' && mode !== 'scene') {
      this.history.length = 0;
      this.trail.geometry.setDrawRange(0, 0);
      this.speed = 0;
    }
    this.mode = mode;
    this.root.visible = mode !== 'scene';
    this.vision.visible = mode === 'vision' || mode === 'fusion';
    this.radar.visible = mode === 'radar' || mode === 'fusion';
    this.surfaces.visible = mode === 'fusion';
    this.visionBox.visible = mode === 'vision' || mode === 'fusion';
    this.radarBox.visible = mode === 'radar' || mode === 'fusion';
    this.fusedBox.visible = mode === 'fusion';
    this.trail.visible = mode === 'fusion';
    this.associationLine.visible = mode === 'fusion';
    this.lastUpdate = -1;
  }

  update(time: number): ReconstructionStats | null {
    this.scanPlane.position.x = -110 + ((time * 0.07) % 1) * 220;
    if (!this.target || this.mode === 'scene' || (this.lastUpdate >= 0 && time - this.lastUpdate < 0.12)) return this.stats;
    this.target.updateWorldMatrix(true, true);
    const visualPositions = this.movingVision.geometry.getAttribute('position');
    const radarPositions = this.movingRadar.geometry.getAttribute('position');
    this.bounds.makeEmpty();
    let count = 0;
    for (const surface of this.moving) {
      const visible = isVisibleWithin(surface.mesh, this.target);
      surface.wire.visible = visible;
      if (!visible) continue;
      for (let i = 0; i < surface.local.length; i += 3) {
        this.point.fromArray(surface.local, i).applyMatrix4(surface.mesh.matrixWorld);
        this.bounds.expandByPoint(this.point);
        visualPositions.setXYZ(count++, this.point.x, this.point.y, this.point.z);
      }
    }
    if (this.bounds.isEmpty()) {
      this.associations.visible = false;
      this.movingVision.geometry.setDrawRange(0, 0);
      this.movingRadar.geometry.setDrawRange(0, 0);
      this.history.length = 0;
      this.trail.geometry.setDrawRange(0, 0);
      this.speed = 0;
      this.lastUpdate = -1;
      this.stats = null;
      return null;
    }
    this.associations.visible = true;
    this.bounds.getCenter(this.truth);
    this.visualOffset.set(Math.sin(time * 0.9) * 0.24, Math.cos(time * 0.7) * 0.08, 0.32 + Math.sin(time * 0.8) * 0.16);
    this.radarOffset.set(Math.cos(time * 0.8) * 0.07, 0.17 + Math.sin(time * 0.6) * 0.11, Math.sin(time * 1.1) * 0.07);
    const fused = fusePositions(
      { position: this.truth.clone().add(this.visualOffset).toArray(), variance: [0.24 ** 2, 0.08 ** 2, 0.4 ** 2] },
      { position: this.truth.clone().add(this.radarOffset).toArray(), variance: [0.08 ** 2, 0.22 ** 2, 0.09 ** 2] },
    );
    this.fused.fromArray(fused.position);
    this.fusionOffset.copy(this.fused).sub(this.truth);
    if (this.lastUpdate >= 0 && time - this.lastUpdate < 1) {
      this.speed = this.speed * 0.6 + this.fused.distanceTo(this.previous) / (time - this.lastUpdate) * 0.4;
    }
    this.previous.copy(this.fused);
    const offset = this.mode === 'fusion' ? this.fusionOffset : this.visualOffset;
    let radarCount = 0;
    for (let index = 0; index < count; index++) {
      const x = visualPositions.getX(index);
      const y = visualPositions.getY(index);
      const z = visualPositions.getZ(index);
      if (index % 12 === 0) radarPositions.setXYZ(radarCount++, x + this.radarOffset.x, y + this.radarOffset.y, z + this.radarOffset.z);
      visualPositions.setXYZ(index, x + offset.x, y + offset.y, z + offset.z);
    }
    visualPositions.needsUpdate = true;
    radarPositions.needsUpdate = true;
    this.movingVision.geometry.setDrawRange(0, count);
    this.movingRadar.geometry.setDrawRange(0, radarCount);
    for (const surface of this.moving) {
      surface.wire.matrix.copy(surface.mesh.matrixWorld);
      surface.wire.matrix.elements[12] += this.fusionOffset.x;
      surface.wire.matrix.elements[13] += this.fusionOffset.y;
      surface.wire.matrix.elements[14] += this.fusionOffset.z;
    }
    const size = this.bounds.getSize(this.point).addScalar(0.9);
    for (const [box, delta] of [[this.visionBox, this.visualOffset], [this.radarBox, this.radarOffset], [this.fusedBox, this.fusionOffset]] as const) {
      box.position.copy(this.truth).add(delta);
      box.scale.copy(size);
    }
    this.history.push(this.fused.clone());
    if (this.history.length > 64) this.history.shift();
    const trail = this.trail.geometry.getAttribute('position');
    this.history.forEach((point, index) => trail.setXYZ(index, point.x, point.y, point.z));
    trail.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, this.history.length);
    const connections = this.associationLine.geometry.getAttribute('position');
    [this.truth.clone().add(this.visualOffset), this.fused, this.truth.clone().add(this.radarOffset), this.fused].forEach((point, index) => connections.setXYZ(index, point.x, point.y, point.z));
    connections.needsUpdate = true;
    this.lastUpdate = time;
    this.stats = {
      mode: this.mode,
      visionPoints: this.staticVision.geometry.getAttribute('position').count + count,
      radarPoints: this.staticRadar.geometry.getAttribute('position').count + radarCount,
      surfaces: this.sourceCount,
      targetId: this.targetId, position: fused.position,
      range: this.fused.distanceTo(this.radarOrigin), speed: this.speed,
      visionError: this.visualOffset.length(), radarError: this.radarOffset.length(), fusionError: this.fusionOffset.length(),
      simulated: true,
    };
    return this.stats;
  }
}
