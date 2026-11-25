import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { icon } from './icons.ts';
import { createEnvironmentMap, createSceneAppearance } from './appearance.ts';
import type { SceneAppearance } from './appearance.ts';
import { createDeerModel, createHumanModel, createRockGeometry, createTrainCars, createTreeCrownGeometry, TRAIN_CAR_SPACING } from './models.ts';
import type { AnimatedModel } from './models.ts';
import { FusionReconstruction, targetFrame } from './reconstruction.ts';
import type { ReconstructionMode, ReconstructionStats } from './reconstruction.ts';
import { DEVICES, LABEL_DEVICE_IDS, routeY, routeZ, SCENARIOS, SENSOR_TYPES, sensorReading } from './simulation.ts';
import type { Device, ResponsePhase, ScenarioId, Telemetry } from './simulation.ts';
import { getLanguage, t } from './i18n.ts';

type ViewMode = 'overview' | 'top' | 'patrol' | 'slope';
type Surface = (x: number, z: number) => number;

interface SceneOptions {
  host: HTMLElement;
  hdCanvas: HTMLCanvasElement;
  irCanvas: HTMLCanvasElement;
  onSelect: (device: Device) => void;
  onViewChange: (view: ViewMode) => void;
  onReconstructionUpdate: (stats: ReconstructionStats | null) => void;
  onError: (message: string) => void;
}

interface SensorObject {
  device: Device;
  group: THREE.Group;
  led: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  label: HTMLButtonElement;
  anchor: THREE.Vector3;
}

const hills = [
  [-88, -41, 28, 27, 24],
  [-42, -55, 37, 29, 22],
  [5, -57, 31, 31, 21],
  [56, -49, 38, 35, 25],
  [101, -34, 24, 24, 25],
  [-104, 35, 19, 26, 27],
  [94, 51, 17, 26, 20],
];

function riverX(z: number): number {
  return -38 + Math.sin(z / 25) * 13 + z * 0.21;
}

export function terrainHeight(x: number, z: number): number {
  let height = 1.15 + Math.sin(x * 0.08) * Math.cos(z * 0.09) * 0.5;
  for (const [cx, cz, h, sx, sz] of hills) {
    height += h * Math.exp(-(((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));
  }
  const corridor = Math.exp(-(((z - routeZ(x)) / 11) ** 4));
  height = height * (1 - corridor * 0.91);
  const riverDistance = Math.abs(x - riverX(z));
  const riverBlend = THREE.MathUtils.smoothstep(riverDistance, 4.5, 11);
  return THREE.MathUtils.lerp(0.15, height, riverBlend);
}

function randomGenerator(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export class RailwayScene {
  private readonly options: SceneOptions;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(41, 1, 0.5, 650);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly sun = new THREE.DirectionalLight('#fff5e3', 3.1);
  private readonly ambient = new THREE.HemisphereLight('#d9e7ee', '#6f775d', 1.8);
  private readonly appearance: SceneAppearance;
  private readonly humanModel: AnimatedModel;
  private readonly deerModel: AnimatedModel;
  private readonly materialCache = new Map<string, THREE.MeshStandardMaterial>();
  private readonly cube = new THREE.BoxGeometry(1, 1, 1);
  private readonly cylinder = new THREE.CylinderGeometry(1, 1, 1, 10);
  private readonly sphere = new THREE.SphereGeometry(1, 12, 8);
  private readonly sensors: SensorObject[] = [];
  private readonly pickables: THREE.Object3D[] = [];
  private readonly coverage = new THREE.Group();
  private readonly links = new THREE.Group();
  private readonly linkPulses: { mesh: THREE.Mesh; curve: THREE.QuadraticBezierCurve3 }[] = [];
  private readonly incidentEffects = new THREE.Group();
  private readonly incidentFrame = targetFrame('#ff694f');
  private readonly incidentBounds = new THREE.Box3();
  private readonly incidentCenter = new THREE.Vector3();
  private readonly incidentSize = new THREE.Vector3();
  private readonly rockRotation = new THREE.Matrix4();
  private readonly rockSupport = new THREE.Vector3();
  private readonly incidentPatch = new THREE.Mesh(new THREE.PlaneGeometry(20, 16, 20, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#f07447', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  private readonly incidentBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 1.2, 14, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#ff7755', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
  private readonly incidentDisk = new THREE.Mesh(new THREE.CircleGeometry(5.2, 64), new THREE.MeshBasicMaterial({ color: '#f57350', transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
  private readonly highlightedSensors = new Set<string>();
  private readonly actors = new THREE.Group();
  private readonly person = new THREE.Group();
  private readonly animal = new THREE.Group();
  private readonly rocks = new THREE.Group();
  private readonly train = new THREE.Group();
  private readonly trainCars: THREE.Group[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly projected = new THREE.Vector3();
  private readonly eventAnchor = new THREE.Vector3();
  private readonly eventLabel: HTMLDivElement;
  private readonly eventRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly rain: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly rainPositions: Float32Array;
  private readonly previewRenderer: THREE.WebGLRenderer;
  private readonly previewEnvironment: THREE.WebGLRenderTarget;
  private readonly hdCamera = new THREE.PerspectiveCamera(52, 16 / 9, 0.2, 400);
  private readonly irCamera = new THREE.PerspectiveCamera(52, 16 / 9, 0.2, 400);
  private readonly hdContext: CanvasRenderingContext2D;
  private readonly irContext: CanvasRenderingContext2D;
  private readonly thermalMaterial: THREE.ShaderMaterial;
  private readonly resizeObserver: ResizeObserver;
  private readonly events = new AbortController();
  private readonly sweep: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>[] = [];
  private scenario: ScenarioId = 'normal';
  private responsePhase: ResponsePhase = 'detected';
  private reconstructionMode: ReconstructionMode = 'scene';
  private reconstruction: FusionReconstruction | null = null;
  private reconstructionStats: ReconstructionStats | null = null;
  private lastReconstructionUpdate = -1;
  private latestTelemetry: Telemetry | null = null;
  private trackId = 'TRACK-TRAIN';
  private selectedId = 'HD-003';
  private showLabels = true;
  private night = false;
  private view: ViewMode = 'overview';
  private width = 1;
  private height = 1;
  private lastTime = 0;
  private elapsed = 0;
  private lastPreview = -1;
  private incidentScale = 1;
  private trainX = 7;
  private hdDeviceId = 'HD-003';
  private irDeviceId = 'IR-003';
  private cameraGoal: THREE.Vector3 | null = null;
  private readonly targetGoal = new THREE.Vector3();

  constructor(options: SceneOptions) {
    this.options = options;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'world-canvas';
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', t('scene.canvasLabel'));
    options.host.prepend(this.renderer.domElement);
    this.appearance = createSceneAppearance(this.renderer);
    this.scene.environment = this.appearance.environment.texture;
    this.scene.environmentIntensity = 0.65;
    this.humanModel = createHumanModel(this.appearance.human);
    this.deerModel = createDeerModel(this.appearance.deer);
    this.scene.background = new THREE.Color('#dce6e9');
    this.scene.fog = new THREE.Fog('#dce6e9', 190, 340);
    this.camera.position.set(105, 83, 115);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 3, -4);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 245;
    this.controls.minPolarAngle = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.maxTargetRadius = 95;
    this.controls.addEventListener('start', () => {
      this.cameraGoal = null;
      if (this.view !== 'overview') {
        this.view = 'overview';
        options.host.dataset.view = 'overview';
        options.onViewChange('overview');
      }
    });
    this.sun.position.set(-45, 85, 45);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -125, right: 125, top: 100, bottom: -100, near: 5, far: 220 });
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.bias = -0.00015;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun, this.ambient, this.coverage, this.links, this.actors, this.train, this.incidentEffects);
    this.buildLandscape();
    this.buildRailway();
    this.buildTrain();
    this.buildSensors();
    this.buildActors();
    this.eventRing = new THREE.Mesh(
      new THREE.RingGeometry(4.5, 4.75, 64),
      new THREE.MeshBasicMaterial({ color: '#ff694f', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, depthTest: false }),
    );
    this.eventRing.rotation.x = -Math.PI / 2;
    this.eventRing.visible = false;
    this.scene.add(this.eventRing);
    this.incidentDisk.rotation.x = -Math.PI / 2;
    this.incidentDisk.position.y = 0.03;
    this.incidentBeam.position.y = 7;
    this.incidentEffects.add(this.incidentDisk, this.incidentFrame, this.incidentBeam, this.incidentPatch);
    const patchGrid = new THREE.Mesh(this.incidentPatch.geometry, new THREE.MeshBasicMaterial({ color: '#f7ad70', wireframe: true, transparent: true, opacity: 0.35, depthWrite: false }));
    this.incidentPatch.add(patchGrid);
    this.incidentEffects.visible = false;
    this.eventLabel = document.createElement('div');
    this.eventLabel.className = 'event-tag';
    this.eventLabel.hidden = true;
    options.host.append(this.eventLabel);

    this.rainPositions = new Float32Array(900 * 6);
    const random = randomGenerator(84);
    for (let i = 0; i < this.rainPositions.length; i += 6) {
      const x = (random() - 0.5) * 210;
      const y = random() * 85;
      const z = (random() - 0.5) * 130;
      this.rainPositions.set([x, y, z, x - 0.3, y + 2.2, z], i);
    }
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: '#d3e8ec', transparent: true, opacity: 0.55 }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);

    const hdContext = options.hdCanvas.getContext('2d');
    const irContext = options.irCanvas.getContext('2d');
    if (!hdContext || !irContext) throw new Error(t('error.previewCanvas'));
    this.hdContext = hdContext;
    this.irContext = irContext;
    this.previewRenderer = new THREE.WebGLRenderer({ antialias: true });
    this.previewRenderer.setSize(480, 270);
    this.previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    this.previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.previewRenderer.toneMappingExposure = 1.02;
    this.previewEnvironment = createEnvironmentMap(this.previewRenderer, this.appearance.environmentSource);
    this.thermalMaterial = new THREE.ShaderMaterial({
      uniforms: { heatTarget: { value: new THREE.Vector3() }, targetActive: { value: 0 } },
      vertexShader: `
        varying vec3 vWorld;
        varying vec3 vNormal;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          #ifdef USE_INSTANCING
            world = modelMatrix * instanceMatrix * vec4(position, 1.0);
          #endif
          vWorld = world.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        uniform vec3 heatTarget;
        uniform float targetActive;
        varying vec3 vWorld;
        varying vec3 vNormal;
        void main() {
          float heat = 0.13 + max(vNormal.y, 0.0) * 0.19
            + sin(vWorld.x * 0.18 + vWorld.z * 0.14) * 0.035;
          heat = max(heat, exp(-distance(vWorld, heatTarget) * 0.45) * targetActive);
          vec3 cold = vec3(0.055, 0.07, 0.22);
          vec3 purple = vec3(0.40, 0.12, 0.57);
          vec3 warm = vec3(0.96, 0.32, 0.26);
          vec3 hot = vec3(1.0, 0.94, 0.52);
          vec3 color = mix(cold, purple, smoothstep(0.05, 0.42, heat));
          color = mix(color, warm, smoothstep(0.35, 0.7, heat));
          color = mix(color, hot, smoothstep(0.65, 1.0, heat));
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    this.resetPreviewCameras();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(options.host);
    this.bindEvents();
    this.resize();
    this.updateTrain();
    this.controls.update();
    options.host.dataset.deviceCount = String(DEVICES.length);
    options.host.dataset.scenario = 'normal';
    options.host.dataset.view = 'overview';
    options.host.dataset.reconstruction = 'scene';
    this.animate(performance.now());
    options.host.dataset.ready = 'true';
    this.renderer.setAnimationLoop((time) => this.animate(time));
  }

  private material(color: string, roughness = 0.85): THREE.MeshStandardMaterial {
    const key = `${color}:${roughness}`;
    let material = this.materialCache.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color, roughness });
      this.materialCache.set(key, material);
    }
    return material;
  }

  private box(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], color: string, shadow = false): THREE.Mesh {
    const mesh = new THREE.Mesh(this.cube, this.material(color));
    mesh.scale.set(...size);
    mesh.position.set(...position);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private post(parent: THREE.Object3D, radius: number, height: number, position: [number, number, number], color: string): THREE.Mesh {
    const mesh = new THREE.Mesh(this.cylinder, this.material(color));
    mesh.scale.set(radius, height, radius);
    mesh.position.set(...position);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private line(parent: THREE.Object3D, points: THREE.Vector3[], color: string, opacity = 1): THREE.Line {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
    parent.add(line);
    return line;
  }

  private ribbon(points: THREE.Vector3[], width: number, color: string, surface?: Surface): THREE.Mesh {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let distance = 0;
    points.forEach((point, index) => {
      const before = points[Math.max(0, index - 1)];
      const after = points[Math.min(points.length - 1, index + 1)];
      const direction = after.clone().sub(before).normalize();
      const lateral = new THREE.Vector3(-direction.z, 0, direction.x).normalize().multiplyScalar(width / 2);
      distance += point.distanceTo(before);
      for (const sign of [-1, 1]) {
        const x = point.x + lateral.x * sign;
        const z = point.z + lateral.z * sign;
        positions.push(x, surface ? surface(x, z) : point.y, z);
        uvs.push(distance * 0.5, sign > 0 ? width * 0.5 : 0);
      }
      if (index < points.length - 1) {
        const i = index * 2;
        indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.9 }));
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  private buildLandscape(): void {
    const geometry = new THREE.PlaneGeometry(224, 144, 112, 72);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    const low = new THREE.Color('#9aa67c');
    const high = new THREE.Color('#738b62');
    const color = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const height = terrainHeight(x, z);
      positions.setY(i, height);
      const variation = Math.sin(x * 0.31 + z * 0.21) * 0.035;
      color.copy(low).lerp(high, Math.min(height / 32 + variation, 1));
      colors.set([color.r, color.g, color.b], i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const ground = new THREE.Mesh(geometry, this.appearance.ground);
    ground.userData.reconstructionTerrain = true;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.box(this.scene, [224, 3.2, 144], [0, -1.65, 0], '#a6b69b');
    const river: THREE.Vector3[] = [];
    for (let z = -73; z <= 73; z += 1.5) river.push(new THREE.Vector3(riverX(z), 0.34, z));
    this.ribbon(river, 12, '#c2ccb1');
    river.forEach((point) => { point.y = 0.4; });
    const water = this.ribbon(river, 8.6, '#91bdba');
    if (water.material instanceof THREE.MeshStandardMaterial) {
      water.material.color.set('#789eaa');
      water.material.roughness = 0.22;
      water.material.metalness = 0.14;
    }
    for (const offset of [-2.4, 1.6]) {
      this.line(this.scene, river.map((point) => new THREE.Vector3(point.x + offset + Math.sin(point.z * 0.2) * 0.2, 0.44, point.z)), '#d3e4d8', 0.45);
    }
    const road: THREE.Vector3[] = [];
    for (let x = -111; x <= 111; x += 2) road.push(new THREE.Vector3(x, 0, routeZ(x) + 17));
    this.ribbon(road, 3.2, '#c6c8b4', (x, z) => terrainHeight(x, z) + 0.035).material = this.appearance.concrete;
    this.line(this.scene, road.map((point) => new THREE.Vector3(point.x, terrainHeight(point.x, point.z) + 0.045, point.z)), '#e3e1cf', 0.6);

    const random = randomGenerator(226);
    const trees: { x: number; z: number; y: number; scale: number; shade: number }[] = [];
    for (let i = 0; i < 1600; i++) {
      const x = (random() - 0.5) * 220;
      const z = (random() - 0.5) * 138;
      const scale = 0.65 + random() * 1.05;
      if (Math.abs(z - routeZ(x)) < 14 || Math.abs(x - riverX(z)) < 8) continue;
      if (Math.abs(x - 29) < 12 && z > -37 && z < -13) continue;
      if (DEVICES.some((device) => Math.hypot(device.x - x, device.z - z) < 4)) continue;
      trees.push({ x, z, y: terrainHeight(x, z), scale, shade: random() });
    }
    const foliage = new THREE.InstancedMesh(createTreeCrownGeometry(), this.appearance.foliage, trees.length);
    const trunks = new THREE.InstancedMesh(this.cylinder, this.material('#7a7960'), trees.length);
    const dummy = new THREE.Object3D();
    const leafColor = new THREE.Color();
    trees.forEach((tree, index) => {
      dummy.position.set(tree.x, tree.y + tree.scale, tree.z);
      dummy.scale.set(0.15 * tree.scale, 2 * tree.scale, 0.15 * tree.scale);
      dummy.rotation.y = 0;
      dummy.updateMatrix();
      trunks.setMatrixAt(index, dummy.matrix);
      dummy.position.y = tree.y + 3.2 * tree.scale;
      dummy.scale.setScalar(tree.scale);
      dummy.rotation.y = tree.shade * Math.PI;
      dummy.updateMatrix();
      foliage.setMatrixAt(index, dummy.matrix);
      leafColor.setHSL(0.265 + tree.shade * 0.07, 0.27 + tree.shade * 0.13, 0.2 + tree.shade * 0.13);
      foliage.setColorAt(index, leafColor);
    });
    foliage.castShadow = true;
    foliage.receiveShadow = true;
    this.scene.add(foliage, trunks);

    const slopePoints: THREE.Vector3[] = [];
    for (let x = 20; x <= 40; x += 1) slopePoints.push(new THREE.Vector3(x, 0, -23 + Math.sin(x * 0.15)));
    this.ribbon(slopePoints, 14, '#aeb89c', (x, z) => terrainHeight(x, z) + 0.13);
    for (let x = 21; x < 42; x += 4) {
      const points: THREE.Vector3[] = [];
      for (let z = -30; z <= -14; z += 0.8) points.push(new THREE.Vector3(x, terrainHeight(x, z) + 0.2, z));
      this.line(this.scene, points, '#d3d5bd', 0.8);
    }
    for (let z = -30; z <= -14; z += 4) {
      const points: THREE.Vector3[] = [];
      for (let x = 21; x <= 41; x++) points.push(new THREE.Vector3(x, terrainHeight(x, z) + 0.21, z));
      this.line(this.scene, points, '#d3d5bd', 0.8);
    }
    const hut = new THREE.Group();
    hut.position.set(-67, terrainHeight(-67, 25), 25);
    this.box(hut, [7, 3.6, 4.5], [0, 1.8, 0], '#e3e2d5', true);
    this.box(hut, [7.6, 0.4, 5], [0, 3.8, 0], '#64796c');
    this.box(hut, [1.2, 2.5, 0.08], [-1.6, 1.3, 2.29], '#71897f');
    this.box(hut, [2.4, 1.3, 0.09], [1.4, 2.1, 2.3], '#a7c7c6');
    this.scene.add(hut);
  }

  private buildRailway(): void {
    const deck: THREE.Vector3[] = [];
    for (let x = -111; x <= 111; x++) deck.push(new THREE.Vector3(x, routeY(x) - 0.24, routeZ(x)));
    this.ribbon(deck, 8.8, '#d1d1bf').material = this.appearance.concrete;
    for (const lane of [-2.05, 2.05]) {
      this.ribbon(deck.map((point) => new THREE.Vector3(point.x, point.y + 0.14, point.z + lane)), 3.15, '#aaa99d').material = this.appearance.ballast;
    }
    const underside = deck.map((point) => new THREE.Vector3(point.x, point.y - 0.7, point.z));
    this.ribbon(underside, 8.8, '#b0b4a6');
    for (const side of [-4.4, 4.4]) {
      const sideTop = deck.map((point) => new THREE.Vector3(point.x, point.y + 0.01, point.z + side));
      const sideBottom = deck.map((point) => new THREE.Vector3(point.x, point.y - 0.7, point.z + side));
      const positions: number[] = [];
      const indices: number[] = [];
      sideTop.forEach((point, index) => {
        positions.push(point.x, point.y, point.z, sideBottom[index].x, sideBottom[index].y, sideBottom[index].z);
        if (index < sideTop.length - 1) {
          const i = index * 2;
          indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
        }
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#bdc0b1', side: THREE.DoubleSide }));
      mesh.castShadow = true;
      this.scene.add(mesh);
    }
    for (let x = -105; x < 110; x += 14) {
      const z = routeZ(x);
      const floor = terrainHeight(x, z);
      const height = routeY(x) - floor - 1.2;
      if (height <= 0) continue;
      this.box(this.scene, [1.65, height, 3.6], [x, floor + height / 2 + 0.25, z], '#bcc0b0', true).material = this.appearance.concrete;
      this.box(this.scene, [2.4, 0.8, 7.7], [x, routeY(x) - 1.1, z], '#c8caba', true).material = this.appearance.concrete;
      this.box(this.scene, [3, 0.5, 5], [x, floor + 0.15, z], '#adb4a3').material = this.appearance.concrete;
    }
    const dummy = new THREE.Object3D();
    const sleepers = new THREE.InstancedMesh(this.cube, this.appearance.concrete, 592);
    let sleeperIndex = 0;
    for (let x = -110; x < 111; x += 0.75) {
      for (const lane of [-2.05, 2.05]) {
        dummy.position.set(x, routeY(x) - 0.02, routeZ(x) + lane);
        dummy.scale.set(0.23, 0.16, 2.7);
        dummy.rotation.y = -Math.atan(Math.cos(x / 58) * 10 / 58);
        dummy.updateMatrix();
        sleepers.setMatrixAt(sleeperIndex++, dummy.matrix);
      }
    }
    sleepers.count = sleeperIndex;
    this.scene.add(sleepers);
    for (const lane of [-2.05, 2.05]) {
      for (const offset of [-0.74, 0.74]) {
        const points = deck.map((point) => new THREE.Vector3(point.x, routeY(point.x) + 0.12, point.z + lane + offset));
        const curve = new THREE.CatmullRomCurve3(points);
        this.scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 320, 0.075, 7, false), this.appearance.rail));
      }
      this.line(this.scene, deck.map((point) => new THREE.Vector3(point.x, routeY(point.x) + 5.2, point.z + lane)), '#6f8178', 0.7);
      this.line(this.scene, deck.map((point) => new THREE.Vector3(point.x, routeY(point.x) + 5.8, point.z + lane)), '#8a978c', 0.55);
    }
    for (let x = -105; x < 111; x += 17.5) {
      const y = routeY(x);
      const z = routeZ(x);
      for (const side of [-4.7, 4.7]) {
        this.box(this.scene, [0.2, 6.7, 0.25], [x, y + 3.05, z + side], '#84958b');
        this.box(this.scene, [0.55, 0.35, 0.6], [x, y - 0.12, z + side], '#b3bbaa');
      }
      this.box(this.scene, [0.17, 0.22, 9.7], [x, y + 6.3, z], '#84958b');
      for (const lane of [-2.05, 2.05]) {
        this.post(this.scene, 0.13, 0.6, [x, y + 5.8, z + lane], '#bfc6b9');
      }
    }
    const fence = new THREE.InstancedMesh(this.cube, this.material('#a8b7a5'), 112);
    let fenceIndex = 0;
    for (let x = -110; x <= 110; x += 4) {
      for (const side of [-4.25, 4.25]) {
        dummy.position.set(x, routeY(x) + 0.35, routeZ(x) + side);
        dummy.scale.set(0.065, 0.95, 0.065);
        dummy.rotation.y = 0;
        dummy.updateMatrix();
        fence.setMatrixAt(fenceIndex++, dummy.matrix);
      }
    }
    fence.count = fenceIndex;
    this.scene.add(fence);
    for (const side of [-4.25, 4.25]) {
      this.line(this.scene, deck.map((point) => new THREE.Vector3(point.x, routeY(point.x) + 0.8, point.z + side)), '#8eaa9b');
    }
  }

  private buildTrain(): void {
    this.trainCars.push(...createTrainCars(this.appearance.train));
    this.train.add(...this.trainCars);
  }

  private buildSensors(): void {
    for (const device of DEVICES) {
      const definition = SENSOR_TYPES[device.type];
      const group = new THREE.Group();
      const ground = terrainHeight(device.x, device.z);
      group.position.set(device.x, ground + 0.1, device.z);
      this.post(group, 1.1, 0.2, [0, 0.1, 0], '#c9d2bd');
      const height = device.type === 'displacement' ? 1.8 : device.type === 'rain' ? 2.5 : device.type === 'radar' ? 5.5 : 8.5;
      this.post(group, 0.12, height, [0, height / 2, 0], '#dde3d8');
      this.box(group, [0.65, 1, 0.4], [0, 1.2, 0.3], '#e8e8d9', true);
      if (device.type === 'camera' || device.type === 'infrared') {
        const head = new THREE.Group();
        head.position.set(0, height - 0.1, 0);
        this.box(head, [0.75, 0.6, 1.5], [0, 0, 0.35], '#eeeee1', true);
        this.box(head, [0.62, 0.43, 0.08], [0, -0.02, 1.12], '#344f52');
        const lens = new THREE.Mesh(this.sphere, this.material(device.type === 'infrared' ? '#b3769f' : '#4195a0', 0.2));
        lens.scale.setScalar(0.19);
        lens.position.set(0, -0.02, 1.2);
        head.add(lens);
        head.rotation.y = device.z > routeZ(device.x) ? Math.PI : 0;
        head.rotation.x = -0.14;
        group.add(head);
      } else if (device.type === 'radar') {
        this.box(group, [1.4, 1.5, 0.35], [0, height - 0.2, 0], '#e1e8dc', true);
        this.box(group, [1.1, 1.17, 0.04], [0, height - 0.2, 0.2], '#438b7a');
        for (const radius of [5, 9, 13]) {
          const points: THREE.Vector3[] = [];
          for (let angle = 0; angle <= Math.PI * 2 + 0.01; angle += Math.PI / 50) {
            const x = device.x + Math.cos(angle) * radius;
            const z = device.z + Math.sin(angle) * radius;
            points.push(new THREE.Vector3(x, terrainHeight(x, z) + 0.22, z));
          }
          this.line(this.coverage, points, '#459b88', 0.4);
        }
        const sweep = new THREE.Mesh(
          new THREE.CircleGeometry(13, 48, 0, Math.PI * 0.4),
          new THREE.MeshBasicMaterial({ color: '#5eaf98', transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false }),
        );
        sweep.rotation.x = -Math.PI / 2;
        sweep.position.set(device.x, ground + 0.3, device.z);
        this.coverage.add(sweep);
        this.sweep.push(sweep);
      } else if (device.type === 'rain') {
        const collector = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.4, 0.8, 16), this.material('#e3e7d8'));
        collector.position.y = height;
        group.add(collector);
        this.post(group, 0.66, 0.06, [0, height + 0.42, 0], '#526d62');
        this.box(group, [1.7, 0.1, 1.1], [1.15, 1.8, 0], '#4a6e78');
      } else {
        this.box(group, [0.9, 0.5, 0.75], [0, height, 0], '#e5c27b', true);
        this.box(group, [0.65, 0.15, 0.55], [0, height + 0.3, 0], '#7a8a74');
        for (const x of [-0.8, 0.8]) this.post(group, 0.06, 1, [x, 0.5, 0], '#adb9a7');
      }
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: '#60c6a0' }));
      led.position.set(0, height + 0.7, 0);
      group.add(led);
      group.traverse((child) => { child.userData.deviceId = device.id; });
      this.scene.add(group);
      this.pickables.push(group);
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'sensor-tag';
      label.style.setProperty('--sensor-color', definition.color);
      label.dataset.deviceId = device.id;
      label.setAttribute('aria-label', t('scene.deviceLabel', { id: device.id, name: definition.name }));
      label.innerHTML = `<span class="tag-icon">${icon(definition.icon, 15)}</span><span class="tag-copy"><b>${definition.name}</b><small class="tag-reading">${device.id}</small></span><i class="tag-status"></i>`;
      label.addEventListener('click', () => this.selectAndNotify(device), { signal: this.events.signal });
      this.options.host.append(label);
      this.sensors.push({ device, group, led, label, anchor: new THREE.Vector3(device.x, ground + height + 1.3, device.z) });
    }
  }

  private buildActors(): void {
    this.person.add(this.humanModel.root);
    this.animal.add(this.deerModel.root);
    for (let i = 0; i < 9; i++) {
      const geometry = createRockGeometry(0.5 + (i % 3) * 0.35, i + 11);
      const material = i % 2 ? this.appearance.stone.clone() : this.appearance.stone;
      if (i % 2) material.color.multiplyScalar(0.86);
      const rock = new THREE.Mesh(geometry, material);
      rock.position.set(Math.sin(i * 3) * 3.2, -geometry.boundingBox!.min.y, Math.cos(i * 2) * 2);
      rock.rotation.set(i, i * 2, 0);
      rock.userData.basePosition = rock.position.clone();
      rock.userData.baseRotation = rock.rotation.clone();
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.rocks.add(rock);
    }
    this.actors.add(this.person, this.animal, this.rocks);
    this.person.visible = false;
    this.animal.visible = false;
    this.rocks.visible = false;
  }

  private bindEvents(): void {
    const canvas = this.renderer.domElement;
    let startX = 0;
    let startY = 0;
    canvas.addEventListener('pointerdown', (event) => {
      startX = event.clientX;
      startY = event.clientY;
    }, { signal: this.events.signal });
    canvas.addEventListener('pointerup', (event) => {
      if (this.reconstructionMode !== 'scene') return;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 5) return;
      const rect = canvas.getBoundingClientRect();
      this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObjects(this.pickables, true)[0];
      if (!hit) return;
      const device = DEVICES.find((item) => item.id === hit.object.userData.deviceId);
      if (device) this.selectAndNotify(device);
    }, { signal: this.events.signal });
    canvas.addEventListener('keydown', (event) => {
      if (event.key === '0') this.setView('overview');
      else if (event.key === '+' || event.key === '=') this.zoom(0.85);
      else if (event.key === '-') this.zoom(1.15);
      else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const index = DEVICES.findIndex((device) => device.id === this.selectedId);
        const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + DEVICES.length) % DEVICES.length;
        this.selectAndNotify(DEVICES[next]);
      }
    }, { signal: this.events.signal });
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.renderer.setAnimationLoop(null);
      this.options.onError(t('error.contextLost'));
    }, { signal: this.events.signal });
  }

  private selectAndNotify(device: Device): void {
    this.selectDevice(device.id, true);
    this.options.onSelect(device);
  }

  private resize(): void {
    this.width = Math.max(this.options.host.clientWidth, 1);
    this.height = Math.max(this.options.host.clientHeight, 1);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
  }

  private updateTrain(): void {
    this.trainCars.forEach((car, index) => {
      const x = this.trainX - index * TRAIN_CAR_SPACING;
      car.position.set(x, routeY(x) + 0.19, routeZ(x) - 2.05);
      car.rotation.set(0, -Math.atan(Math.cos(x / 58) * 10 / 58), Math.atan(-Math.sin(x / 75) * 0.01));
      car.visible = x > -120 && x < 120;
    });
  }

  private placeRock(rock: THREE.Mesh, x: number, z: number): void {
    const positions = rock.geometry.getAttribute('position');
    this.rockRotation.makeRotationFromQuaternion(rock.quaternion).scale(rock.scale);
    let minimum = Infinity;
    for (let index = 0; index < positions.count; index++) {
      this.rockSupport.fromBufferAttribute(positions, index).applyMatrix4(this.rockRotation);
      minimum = Math.min(minimum, this.rockSupport.y);
    }
    rock.position.set(x, terrainHeight(this.eventAnchor.x + x, this.eventAnchor.z + z) - this.eventAnchor.y - minimum + 0.015, z);
  }

  private animate(time: number): void {
    const frameDelta = Math.max(0, (time - (this.lastTime || time)) / 1000);
    const delta = Math.min(frameDelta, 0.05);
    const cameraDelta = Math.min(frameDelta, 0.25);
    this.lastTime = time;
    this.elapsed += delta;
    this.trainX += delta * 4.3;
    if (this.trainX > 120 + (this.trainCars.length - 1) * TRAIN_CAR_SPACING) this.trainX = -120;
    this.updateTrain();
    if (this.view === 'patrol') {
      const x = THREE.MathUtils.clamp(this.trainX - 10, -85, 85);
      this.camera.position.lerp(new THREE.Vector3(x + 21, routeY(x) + 21, routeZ(x) + 37), 1 - Math.exp(-cameraDelta * 1.8));
      this.controls.target.lerp(new THREE.Vector3(x, routeY(x) + 1.5, routeZ(x)), 1 - Math.exp(-cameraDelta * 2));
    } else if (this.cameraGoal) {
      const weight = 1 - Math.exp(-cameraDelta * 4);
      this.camera.position.lerp(this.cameraGoal, weight);
      this.controls.target.lerp(this.targetGoal, weight);
      if (this.camera.position.distanceTo(this.cameraGoal) < 0.06 && this.controls.target.distanceTo(this.targetGoal) < 0.06) this.cameraGoal = null;
    }
    this.controls.update();
    this.sweep.forEach((sweep, index) => { sweep.rotation.z = this.elapsed * 0.45 + index * 1.5; });
    this.eventRing.scale.setScalar(this.incidentScale * (0.8 + ((this.elapsed * 0.45) % 1) * 0.65));
    this.eventRing.material.opacity = 0.9 - ((this.elapsed * 0.45) % 1) * 0.7;
    this.linkPulses.forEach(({ mesh, curve }, index) => mesh.position.copy(curve.getPoint((this.elapsed * 0.35 + index / 3) % 1)));
    this.sensors.forEach((sensor) => {
      const active = SCENARIOS[this.scenario].sensors.includes(sensor.device.type);
      sensor.led.material.color.set(active ? this.responsePhase === 'responding' ? '#62b8d5' : '#f09a51' : '#59c398');
      sensor.led.scale.setScalar(sensor.device.id === this.selectedId ? 1.5 + Math.sin(this.elapsed * 3) * 0.25 : 1);
    });
    if (this.person.visible) {
      const phase = this.elapsed * 0.5;
      const vx = Math.cos(phase) * 0.45;
      const vz = -Math.sin(phase) * 0.275;
      this.person.position.x = this.eventAnchor.x + Math.sin(phase) * 0.9;
      this.person.position.z = this.eventAnchor.z + Math.cos(phase) * 0.55;
      this.person.position.y = terrainHeight(this.person.position.x, this.person.position.z) + 0.015;
      this.person.rotation.y = Math.atan2(vx, vz);
      this.humanModel.action.timeScale = Math.hypot(vx, vz) / 0.78;
      this.humanModel.mixer.update(delta);
    }
    if (this.animal.visible) {
      const phase = this.elapsed * 0.33;
      const vx = Math.cos(phase) * 0.4455;
      const vz = -Math.sin(phase) * 0.2805;
      this.animal.position.x = this.eventAnchor.x + Math.sin(phase) * 1.35;
      this.animal.position.z = this.eventAnchor.z + Math.cos(phase) * 0.85;
      this.animal.position.y = terrainHeight(this.animal.position.x, this.animal.position.z) + 0.015;
      this.animal.rotation.y = Math.atan2(vx, vz);
      this.deerModel.action.timeScale = Math.hypot(vx, vz) / 0.75;
      this.deerModel.mixer.update(delta);
    }
    if (this.scenario === 'rockfall') {
      this.rocks.children.forEach((rock, index) => {
        if (!(rock instanceof THREE.Mesh)) return;
        const progress = (this.elapsed * 0.16 + index * 0.09) % 1;
        const x = Math.sin(index * 3) * 3.2 + progress;
        const z = -8 + progress * 14;
        rock.rotation.x += delta * 2;
        rock.rotation.z += delta;
        this.placeRock(rock, x, z);
      });
    }
    if (this.scenario !== 'normal') {
      const target = this.reconstructionTarget();
      target.updateWorldMatrix(true, true);
      this.incidentBounds.setFromObject(target);
      this.incidentBounds.getCenter(this.incidentCenter);
      this.incidentBounds.getSize(this.incidentSize).addScalar(0.8);
      if (this.scenario === 'person' || this.scenario === 'animal') {
        this.thermalMaterial.uniforms.heatTarget.value.copy(this.incidentCenter);
      }
      this.incidentFrame.position.copy(this.incidentCenter).sub(this.eventAnchor);
      this.incidentFrame.scale.copy(this.incidentSize);
      this.incidentBeam.material.opacity = this.incidentScale < 1 ? 0.025 + Math.sin(this.elapsed * 2) * 0.01 : 0.08 + Math.sin(this.elapsed * 2) * 0.035;
    }
    if (this.rain.visible) {
      for (let i = 0; i < this.rainPositions.length; i += 6) {
        this.rainPositions[i + 1] -= delta * 47;
        if (this.rainPositions[i + 1] < 0) this.rainPositions[i + 1] = 85;
        this.rainPositions[i + 4] = this.rainPositions[i + 1] + 2.2;
      }
      this.rain.geometry.getAttribute('position').needsUpdate = true;
    }
    if (this.reconstruction && this.reconstructionMode !== 'scene') {
      this.reconstructionStats = this.reconstruction.update(this.elapsed);
      if (this.elapsed - this.lastReconstructionUpdate > 0.2) {
        this.lastReconstructionUpdate = this.elapsed;
        this.options.onReconstructionUpdate(this.reconstructionStats);
      }
    }
    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
    if (this.elapsed - this.lastPreview > 0.22) {
      this.lastPreview = this.elapsed;
      this.renderPreviews();
    }
  }

  private updateLabels(): void {
    const occupied: { x: number; y: number }[] = [];
    const english = getLanguage() === 'en';
    const margin = english && this.width >= 480 ? 88 : 78;
    const spacing = english ? 170 : 139;
    for (const sensor of this.sensors) {
      const representative = this.scenario === 'normal' ? LABEL_DEVICE_IDS.includes(sensor.device.id) : this.highlightedSensors.has(sensor.device.id);
      const show = this.showLabels && this.reconstructionMode === 'scene' && (representative || sensor.device.id === this.selectedId);
      sensor.label.hidden = !show;
      if (!show) continue;
      this.projected.copy(sensor.anchor).project(this.camera);
      if (this.projected.z > 1 || Math.abs(this.projected.x) > 1.12 || Math.abs(this.projected.y) > 1.12) {
        sensor.label.hidden = true;
        continue;
      }
      const x = THREE.MathUtils.clamp((this.projected.x * 0.5 + 0.5) * this.width, margin, this.width - margin);
      let y = THREE.MathUtils.clamp((-this.projected.y * 0.5 + 0.5) * this.height - 7, 66, this.height - 91);
      for (const other of occupied) {
        if (Math.abs(x - other.x) < spacing && Math.abs(y - other.y) < 48) y = Math.max(65, other.y - 49);
      }
      occupied.push({ x, y });
      sensor.label.style.left = `${x}px`;
      sensor.label.style.top = `${y}px`;
      sensor.label.classList.toggle('selected', sensor.device.id === this.selectedId);
      sensor.label.classList.toggle('alerting', SCENARIOS[this.scenario].sensors.includes(sensor.device.type));
    }
    if (this.scenario !== 'normal') {
      this.projected.copy(this.incidentCenter).add(new THREE.Vector3(0, this.incidentSize.y / 2 + (this.incidentScale < 1 ? 0.65 : 2.2), 0)).project(this.camera);
      this.eventLabel.hidden = this.projected.z > 1 || Math.abs(this.projected.x) > 1 || Math.abs(this.projected.y) > 1;
      this.eventLabel.style.left = `${(this.projected.x * 0.5 + 0.5) * this.width}px`;
      this.eventLabel.style.top = `${(-this.projected.y * 0.5 + 0.5) * this.height}px`;
    }
  }

  private resetPreviewCameras(): void {
    if (this.scenario === 'normal') {
      for (const [id, camera, direction] of [[this.hdDeviceId, this.hdCamera, 1], [this.irDeviceId, this.irCamera, -1]] as const) {
        const sensor = this.sensors.find((item) => item.device.id === id);
        if (!sensor) continue;
        const targetX = sensor.device.x + direction * 24;
        camera.position.copy(sensor.anchor).y -= 1.1;
        camera.lookAt(targetX, routeY(targetX) + 1, routeZ(targetX));
      }
    } else {
      const [x, offset] = SCENARIOS[this.scenario].position;
      const z = routeZ(x) + offset;
      const y = terrainHeight(x, z);
      const close = this.scenario === 'person' || this.scenario === 'animal';
      this.hdCamera.position.set(x - (close ? 4.5 : 14), y + (close ? 2.8 : 11), z + (close ? 6.2 : 19));
      this.hdCamera.lookAt(x, y + (close ? 1 : 1.6), z);
      this.irCamera.position.set(x + (close ? 4.5 : 13), y + (close ? 3.2 : 11), z - (close ? 5.8 : 16));
      this.irCamera.lookAt(x, y + (close ? 1 : 1.6), z);
    }
  }

  private renderPreviews(): void {
    const coverageVisible = this.coverage.visible;
    const linksVisible = this.links.visible;
    const eventVisible = this.eventRing.visible;
    const effectsVisible = this.incidentEffects.visible;
    const background = this.scene.background;
    const fog = this.scene.fog;
    const environment = this.scene.environment;
    this.coverage.visible = false;
    this.links.visible = false;
    this.eventRing.visible = false;
    this.incidentEffects.visible = false;
    const worldBackground = this.worldBackground();
    this.scene.background = new THREE.Color(worldBackground);
    this.scene.fog = new THREE.Fog(worldBackground, this.scenario === 'rain' ? 105 : 190, this.scenario === 'rain' ? 240 : 340);
    this.scene.environment = this.previewEnvironment.texture;
    this.previewRenderer.render(this.scene, this.hdCamera);
    this.hdContext.drawImage(this.previewRenderer.domElement, 0, 0, this.options.hdCanvas.width, this.options.hdCanvas.height);
    this.scene.background = new THREE.Color('#10132e');
    this.scene.overrideMaterial = this.thermalMaterial;
    this.previewRenderer.render(this.scene, this.irCamera);
    this.irContext.drawImage(this.previewRenderer.domElement, 0, 0, this.options.irCanvas.width, this.options.irCanvas.height);
    this.scene.overrideMaterial = null;
    this.scene.background = background;
    this.scene.fog = fog;
    this.scene.environment = environment;
    this.coverage.visible = coverageVisible;
    this.links.visible = linksVisible;
    this.eventRing.visible = eventVisible;
    this.incidentEffects.visible = effectsVisible;
  }

  setScenario(scenario: ScenarioId, trackId?: string): void {
    this.scenario = scenario;
    this.responsePhase = 'detected';
    this.trackId = scenario === 'normal' ? 'TRACK-TRAIN' : `TRACK-${trackId ?? scenario.toUpperCase()}`;
    this.options.host.dataset.scenario = scenario;
    const definition = SCENARIOS[scenario];
    this.person.visible = scenario === 'person';
    this.animal.visible = scenario === 'animal';
    this.rocks.visible = scenario === 'rockfall' || scenario === 'slope';
    this.rain.visible = scenario === 'rain';
    this.eventRing.visible = scenario !== 'normal';
    this.incidentEffects.visible = scenario !== 'normal';
    this.incidentScale = scenario === 'person' ? 0.45 : scenario === 'animal' ? 0.6 : 1;
    this.incidentDisk.scale.setScalar(this.incidentScale);
    this.incidentBeam.scale.set(this.incidentScale, this.incidentScale, this.incidentScale);
    this.incidentBeam.position.y = 7 * this.incidentScale;
    this.incidentPatch.visible = scenario === 'rain' || scenario === 'slope';
    this.highlightedSensors.clear();
    this.linkPulses.length = 0;
    if (scenario === 'person') this.humanModel.mixer.setTime(0);
    if (scenario === 'animal') this.deerModel.mixer.setTime(0);
    this.eventLabel.hidden = scenario === 'normal';
    this.links.traverse((object) => {
      if (object instanceof THREE.Line || object instanceof THREE.Mesh) {
        object.geometry.dispose();
        if (object.material instanceof THREE.Material) object.material.dispose();
      }
    });
    this.links.clear();
    if (scenario !== 'normal') {
      const [x, offset] = definition.position;
      const z = routeZ(x) + offset;
      const y = terrainHeight(x, z);
      this.eventAnchor.set(x, y + 0.035, z);
      this.person.position.copy(this.eventAnchor);
      this.animal.position.copy(this.eventAnchor);
      this.rocks.position.copy(this.eventAnchor);
      this.rocks.children.forEach((rock) => {
        if (!(rock instanceof THREE.Mesh)) return;
        rock.rotation.copy(rock.userData.baseRotation);
        const base = rock.userData.basePosition;
        this.placeRock(rock, base.x, base.z);
      });
      this.eventRing.position.copy(this.eventAnchor).y += 0.025;
      this.incidentEffects.position.copy(this.eventAnchor);
      const patchPositions = this.incidentPatch.geometry.getAttribute('position');
      for (let index = 0; index < patchPositions.count; index++) {
        const px = patchPositions.getX(index);
        const pz = patchPositions.getZ(index);
        patchPositions.setY(index, terrainHeight(x + px, z + pz) - y + 0.03);
      }
      patchPositions.needsUpdate = true;
      this.incidentPatch.geometry.computeBoundingBox();
      this.incidentPatch.geometry.computeBoundingSphere();
      this.incidentPatch.material.color.set(scenario === 'rain' ? '#348fae' : '#f07447');
      this.eventLabel.innerHTML = `${icon(definition.icon, 19)}<span>${definition.name}<small>${t('scene.phaseDetected')}</small></span><i></i>`;
      this.thermalMaterial.uniforms.heatTarget.value.copy(this.eventAnchor).y += 1.3;
      this.thermalMaterial.uniforms.targetActive.value = scenario === 'person' || scenario === 'animal' ? 1 : 0.6;
      for (const type of definition.sensors) {
        const nearest = this.sensors.filter((sensor) => sensor.device.type === type).sort((a, b) => a.anchor.distanceTo(this.eventAnchor) - b.anchor.distanceTo(this.eventAnchor))[0];
        if (!nearest) continue;
        this.highlightedSensors.add(nearest.device.id);
        const middle = nearest.anchor.clone().lerp(this.eventAnchor, 0.5);
        middle.y += 8;
        const curve = new THREE.QuadraticBezierCurve3(nearest.anchor, middle, this.eventAnchor);
        this.line(this.links, curve.getPoints(35), '#ed8e59', 0.85);
        const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffb373' }));
        this.links.add(pulse);
        this.linkPulses.push({ mesh: pulse, curve });
      }
    } else {
      this.thermalMaterial.uniforms.targetActive.value = 0;
    }
    this.applyLighting();
    this.resetPreviewCameras();
    this.setResponsePhase('detected');
    this.syncReconstructionTarget();
  }

  setResponsePhase(phase: ResponsePhase): void {
    this.responsePhase = phase;
    this.options.host.dataset.responsePhase = phase;
    const color = phase === 'responding' ? '#49a9d1' : phase === 'verified' || SCENARIOS[this.scenario].risk === 'warning' ? '#ed9b42' : '#ff674e';
    this.incidentFrame.material.color.set(color);
    this.eventRing.material.color.set(color);
    this.incidentBeam.material.color.set(color);
    this.eventLabel.style.setProperty('--incident-color', color);
    const label = this.eventLabel.querySelector('small');
    if (label) label.textContent = t(phase === 'responding' ? 'scene.phaseResponding' : phase === 'verified' ? 'scene.phaseVerified' : 'scene.phaseDetected');
  }

  focusIncident(): void {
    if (this.scenario === 'normal') { this.setView('overview'); return; }
    const target = this.eventAnchor.clone().add(new THREE.Vector3(0, this.scenario === 'person' ? 0.95 : this.scenario === 'animal' ? 1.1 : 2, 0));
    const offset = this.scenario === 'person' ? new THREE.Vector3(5.5, 3.8, 8.5)
      : this.scenario === 'animal' ? new THREE.Vector3(7.5, 4.6, 10.5)
      : new THREE.Vector3(25, 23, 33);
    this.flyTo(target.clone().add(offset), target);
  }

  focusReconstructionTarget(): void {
    if (this.scenario !== 'normal') { this.focusIncident(); return; }
    if (!this.reconstructionStats) return;
    const target = new THREE.Vector3().fromArray(this.reconstructionStats.position);
    this.flyTo(target.clone().add(new THREE.Vector3(31, 23, 36)), target);
  }

  private reconstructionTarget(): THREE.Object3D {
    switch (this.scenario) {
      case 'person': return this.person;
      case 'animal': return this.animal;
      case 'rockfall': return this.rocks;
      case 'rain':
      case 'slope': return this.incidentPatch;
      default: return this.train;
    }
  }

  private syncReconstructionTarget(): void {
    if (!this.reconstruction) return;
    const reference = this.scenario === 'normal' ? new THREE.Vector3(this.trainX, routeY(this.trainX), routeZ(this.trainX)) : this.eventAnchor;
    const nearest = this.sensors.filter((sensor) => sensor.device.type === 'radar').sort((a, b) => a.anchor.distanceTo(reference) - b.anchor.distanceTo(reference))[0];
    this.reconstruction.setTarget(this.reconstructionTarget(), this.trackId, nearest.anchor);
    this.reconstructionStats = null;
    if (this.reconstructionMode !== 'scene') this.options.onReconstructionUpdate(null);
  }

  setReconstructionMode(mode: ReconstructionMode): void {
    if (mode !== 'scene' && !this.reconstruction) {
      this.reconstruction = new FusionReconstruction(this.scene, [this.coverage, this.links, this.actors, this.train, this.eventRing, this.incidentEffects, this.rain]);
      this.scene.add(this.reconstruction.root);
      this.syncReconstructionTarget();
    }
    this.reconstructionMode = mode;
    this.reconstruction?.setMode(mode);
    this.camera.layers.set(mode === 'scene' ? 0 : 1);
    this.options.host.dataset.reconstruction = mode;
    this.applyLighting();
    if (this.reconstruction && mode !== 'scene') {
      this.reconstructionStats = this.reconstruction.update(this.elapsed);
      this.options.onReconstructionUpdate(this.reconstructionStats);
    }
  }

  getReconstructionStats(): ReconstructionStats | null {
    return this.reconstructionStats ? { ...this.reconstructionStats, mode: this.reconstructionMode } : null;
  }

  updateReadings(telemetry: Telemetry): void {
    this.latestTelemetry = telemetry;
    this.sensors.forEach((sensor) => {
      const reading = sensor.label.querySelector<HTMLElement>('.tag-reading');
      if (reading) reading.textContent = sensorReading(sensor.device.type, telemetry, this.scenario);
    });
  }

  updateLocale(): void {
    this.renderer.domElement.setAttribute('aria-label', t('scene.canvasLabel'));
    for (const sensor of this.sensors) {
      const definition = SENSOR_TYPES[sensor.device.type];
      sensor.label.setAttribute('aria-label', t('scene.deviceLabel', { id: sensor.device.id, name: definition.name }));
      sensor.label.querySelector('b')!.textContent = definition.name;
    }
    this.eventLabel.innerHTML = `${icon(SCENARIOS[this.scenario].icon, 19)}<span>${SCENARIOS[this.scenario].name}<small></small></span><i></i>`;
    this.setResponsePhase(this.responsePhase);
    if (this.latestTelemetry) this.updateReadings(this.latestTelemetry);
  }

  selectDevice(id: string, focus = false): void {
    const sensor = this.sensors.find((item) => item.device.id === id);
    if (!sensor) return;
    this.selectedId = id;
    this.options.host.dataset.selectedDevice = id;
    if (sensor.device.type === 'camera') this.hdDeviceId = id;
    if (sensor.device.type === 'infrared') this.irDeviceId = id;
    if (sensor.device.type === 'camera' || sensor.device.type === 'infrared') this.resetPreviewCameras();
    if (focus) {
      const target = sensor.anchor.clone();
      target.y = Math.max(target.y - 2, 3);
      this.flyTo(target.clone().add(new THREE.Vector3(30, 28, 39)), target);
    }
  }

  private flyTo(position: THREE.Vector3, target: THREE.Vector3): void {
    this.view = 'overview';
    this.options.host.dataset.view = 'overview';
    this.options.onViewChange('overview');
    this.cameraGoal = position;
    this.targetGoal.copy(target);
  }

  focusLocation(x: number, zOffset: number): void {
    const z = routeZ(x) + zOffset;
    const target = new THREE.Vector3(x, Math.max(terrainHeight(x, z) + 1, 5), z);
    this.flyTo(target.clone().add(new THREE.Vector3(38, 34, 49)), target);
  }

  setView(view: ViewMode): void {
    if (view === 'patrol' && this.view === 'patrol') view = 'overview';
    this.view = view;
    this.options.host.dataset.view = view;
    this.options.onViewChange(view);
    if (view === 'overview') {
      this.cameraGoal = new THREE.Vector3(105, 83, 115);
      this.targetGoal.set(0, 3, -4);
    } else if (view === 'top') {
      this.cameraGoal = new THREE.Vector3(0, 173, 2);
      this.targetGoal.set(0, 0, 0);
    } else if (view === 'slope') {
      const target = new THREE.Vector3(29, terrainHeight(29, -23), -23);
      this.cameraGoal = target.clone().add(new THREE.Vector3(39, 32, 49));
      this.targetGoal.copy(target);
    } else {
      this.cameraGoal = null;
    }
  }

  zoom(factor: number): void {
    if (this.view === 'patrol') this.setView('overview');
    this.cameraGoal = null;
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance));
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  setCoverage(visible: boolean): void {
    this.coverage.visible = visible;
    this.options.host.dataset.coverage = String(visible);
  }

  setLabels(visible: boolean): void {
    this.showLabels = visible;
    this.options.host.dataset.labels = String(visible);
  }

  setNight(night: boolean): void {
    this.night = night;
    this.options.host.dataset.night = String(night);
    this.applyLighting();
  }

  private applyLighting(): void {
    const rainy = this.scenario === 'rain';
    const background = this.reconstructionMode === 'scene' ? this.worldBackground() : '#081d2a';
    this.scene.background = new THREE.Color(background);
    this.scene.fog = new THREE.Fog(background, rainy ? 105 : 190, rainy ? 240 : 340);
    this.sun.intensity = this.night ? 0.25 : rainy ? 1.05 : 3.1;
    this.ambient.intensity = this.night ? 0.65 : rainy ? 1.6 : 1.8;
    this.scene.environmentIntensity = this.night ? 0.18 : rainy ? 0.45 : 0.65;
  }

  private worldBackground(): string {
    return this.night ? '#172e37' : this.scenario === 'rain' ? '#a9bdba' : '#dce6e9';
  }

  capture(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.events.abort();
    this.controls.dispose();
    for (const model of [this.humanModel, this.deerModel]) {
      model.mixer.stopAllAction();
      model.mixer.uncacheRoot(model.root);
    }
    const geometries = new Set<THREE.BufferGeometry>([this.cube, this.cylinder, this.sphere]);
    const materials = new Set<THREE.Material>([this.thermalMaterial, ...this.materialCache.values(), ...this.appearance.materials]);
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
        geometries.add(object.geometry);
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        objectMaterials.forEach((material: THREE.Material) => materials.add(material));
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.appearance.textures.forEach((texture) => texture.dispose());
    this.scene.environment = null;
    this.appearance.environment.dispose();
    this.previewEnvironment.dispose();
    this.renderer.dispose();
    this.previewRenderer.dispose();
    this.scene.clear();
    this.renderer.domElement.remove();
    this.sensors.forEach((sensor) => sensor.label.remove());
    this.eventLabel.remove();
  }
}
