import * as THREE from 'three';
import type { DeerMaterials, HumanMaterials, TrainMaterials } from './models.ts';
import { t } from './i18n.ts';

export interface SceneAppearance {
  human: HumanMaterials;
  deer: DeerMaterials;
  train: TrainMaterials;
  ground: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  ballast: THREE.MeshStandardMaterial;
  foliage: THREE.MeshLambertMaterial;
  stone: THREE.MeshStandardMaterial;
  rail: THREE.MeshStandardMaterial;
  textures: Set<THREE.Texture>;
  materials: Set<THREE.Material>;
  environment: THREE.WebGLRenderTarget;
  environmentSource: THREE.CanvasTexture;
}

function randomGenerator(seed: number): () => number {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

function canvasContext(width: number, height = width): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(t('error.materialCanvas'));
  return context;
}

function grain(size: number, color: [number, number, number], amount: number, seed: number): CanvasRenderingContext2D {
  const context = canvasContext(size);
  const image = context.createImageData(size, size);
  const random = randomGenerator(seed);
  const cells = 12;
  const coarse = Float32Array.from({ length: cells * cells }, () => random());
  for (let index = 0; index < image.data.length; index += 4) {
    const x = (index / 4) % size;
    const y = Math.floor(index / 4 / size);
    const u = x / size * cells;
    const v = y / size * cells;
    const ix = Math.floor(u);
    const iy = Math.floor(v);
    const fx = (u - ix) ** 2 * (3 - 2 * (u - ix));
    const fy = (v - iy) ** 2 * (3 - 2 * (v - iy));
    const row = coarse[iy * cells + ix] * (1 - fx) + coarse[iy * cells + (ix + 1) % cells] * fx;
    const next = coarse[((iy + 1) % cells) * cells + ix] * (1 - fx) + coarse[((iy + 1) % cells) * cells + (ix + 1) % cells] * fx;
    const noise = (random() - 0.5) * amount + (row * (1 - fy) + next * fy - 0.5) * amount * 0.8;
    image.data[index] = color[0] + noise;
    image.data[index + 1] = color[1] + noise;
    image.data[index + 2] = color[2] + noise;
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return context;
}

export function createEnvironmentMap(renderer: THREE.WebGLRenderer, source: THREE.Texture): THREE.WebGLRenderTarget {
  const generator = new THREE.PMREMGenerator(renderer);
  const environment = generator.fromEquirectangular(source);
  generator.dispose();
  return environment;
}

export function createSceneAppearance(renderer: THREE.WebGLRenderer): SceneAppearance {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  const texture = (context: CanvasRenderingContext2D, color = true, repeat: [number, number] = [1, 1]): THREE.CanvasTexture => {
    const result = new THREE.CanvasTexture(context.canvas);
    result.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    result.wrapS = result.wrapT = THREE.RepeatWrapping;
    result.repeat.set(...repeat);
    result.anisotropy = anisotropy;
    textures.add(result);
    return result;
  };
  const standard = (options: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => {
    const result = new THREE.MeshStandardMaterial(options);
    materials.add(result);
    return result;
  };
  const physical = (options: THREE.MeshPhysicalMaterialParameters): THREE.MeshPhysicalMaterial => {
    const result = new THREE.MeshPhysicalMaterial(options);
    materials.add(result);
    return result;
  };
  const fabric = grain(128, [224, 222, 214], 18, 30);
  fabric.strokeStyle = '#ffffff20';
  fabric.lineWidth = 1;
  for (let index = 0; index < 128; index += 4) {
    fabric.beginPath();
    fabric.moveTo(index, 0); fabric.lineTo(index, 128);
    fabric.moveTo(0, index); fabric.lineTo(128, index);
    fabric.stroke();
  }
  const fabricMap = texture(fabric, true, [3, 3]);
  const fabricBump = texture(fabric, false, [3, 3]);
  const fur = grain(256, [228, 218, 198], 24, 76);
  const random = randomGenerator(328);
  for (let index = 0; index < 5000; index++) {
    const x = random() * 256;
    const y = random() * 256;
    fur.strokeStyle = index % 2 ? '#f5ead230' : '#6a503019';
    fur.beginPath();
    fur.moveTo(x, y); fur.lineTo(x + (random() - 0.5) * 2, y + 3 + random() * 7);
    fur.stroke();
  }
  const furMap = texture(fur, true, [3, 3]);
  const furBump = texture(fur, false, [3, 3]);
  const concrete = grain(256, [216, 215, 205], 25, 82);
  for (let index = 0; index < 18; index++) {
    let x = random() * 256;
    let y = random() * 256;
    concrete.strokeStyle = '#62665e18';
    concrete.lineWidth = 0.6;
    concrete.beginPath();
    concrete.moveTo(x, y);
    for (let segment = 0; segment < 4; segment++) {
      x += random() * 18;
      y += (random() - 0.5) * 20;
      concrete.lineTo(x, y);
    }
    concrete.stroke();
  }
  const concreteMap = texture(concrete);
  const concreteBump = texture(concrete, false);
  const stone = grain(512, [187, 184, 169], 46, 37);
  for (let index = 0; index < 180; index++) {
    stone.fillStyle = index % 2 ? '#e5e0d62a' : '#4b514127';
    stone.beginPath();
    stone.ellipse(random() * 512, random() * 512, random() * 16 + 2, random() * 9 + 1, random() * Math.PI, 0, Math.PI * 2);
    stone.fill();
  }
  const stoneMap = texture(stone);
  const stoneBump = texture(stone, false);
  const grass = grain(512, [233, 235, 214], 35, 182);
  for (let index = 0; index < 14000; index++) {
    const x = random() * 512;
    const y = random() * 512;
    grass.strokeStyle = index % 2 ? '#62794d35' : '#e8e4b450';
    grass.beginPath();
    grass.moveTo(x, y); grass.lineTo(x + random() * 3 - 1, y + 2 + random() * 5);
    grass.stroke();
  }
  const grassMap = texture(grass, true, [56, 36]);
  const grassBump = texture(grass, false, [56, 36]);
  const ballast = grain(512, [101, 105, 99], 30, 55);
  for (let index = 0; index < 4800; index++) {
    const x = random() * 512;
    const y = random() * 512;
    const radius = 2 + random() * 5;
    const shade = Math.floor(128 + random() * 65);
    ballast.fillStyle = `rgb(${shade},${shade},${shade - 9})`;
    ballast.beginPath();
    for (let vertex = 0; vertex < 5; vertex++) {
      const angle = vertex / 5 * Math.PI * 2;
      const r = radius * (0.6 + random() * 0.4);
      if (vertex === 0) ballast.moveTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
      else ballast.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
    }
    ballast.closePath(); ballast.fill();
  }
  const ballastMap = texture(ballast);
  const ballastBump = texture(ballast, false);
  const leaves = canvasContext(256);
  for (let index = 0; index < 3500; index++) {
    const shade = Math.floor(190 + random() * 65);
    leaves.fillStyle = `rgb(${shade},${shade},${shade - 8})`;
    leaves.beginPath();
    leaves.ellipse(random() * 256, random() * 256, 2 + random() * 4, 1.2 + random() * 1.8, random() * Math.PI, 0, Math.PI * 2);
    leaves.fill();
  }
  const foliage = new THREE.MeshLambertMaterial({ color: '#cfdbb4', vertexColors: true, map: texture(leaves, true, [3, 3]), alphaTest: 0.45, alphaToCoverage: true, side: THREE.DoubleSide });
  materials.add(foliage);
  const emblem = canvasContext(512, 128);
  emblem.clearRect(0, 0, 512, 128);
  emblem.fillStyle = '#225a75';
  emblem.font = '600 55px "Segoe UI", sans-serif';
  emblem.textAlign = 'center';
  emblem.fillText('RailSafty', 256, 57);
  emblem.font = '21px "Segoe UI", sans-serif';
  emblem.fillText('GUANGXI RAILWAY  /  GX 01', 256, 101);
  const emblemMaterial = new THREE.MeshBasicMaterial({ map: texture(emblem), transparent: true, alphaTest: 0.15, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  materials.add(emblemMaterial);
  const skinMap = texture(grain(128, [244, 229, 207], 9, 176));
  const dark = standard({ color: '#22292e', roughness: 0.77, metalness: 0.18 });
  const metal = standard({ color: '#a3adb0', metalness: 0.8, roughness: 0.3 });
  const eyes = physical({ color: '#211d17', roughness: 0.18, clearcoat: 0.5 });

  const sky = canvasContext(512, 256);
  const gradient = sky.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#779ebf');
  gradient.addColorStop(0.45, '#d6e5e7');
  gradient.addColorStop(0.53, '#e6e9d8');
  gradient.addColorStop(0.58, '#8e9b7d');
  gradient.addColorStop(1, '#4d624b');
  sky.fillStyle = gradient;
  sky.fillRect(0, 0, 512, 256);
  const glow = sky.createRadialGradient(350, 68, 0, 350, 68, 30);
  glow.addColorStop(0, '#fffce7'); glow.addColorStop(0.22, '#fffce7e0'); glow.addColorStop(1, '#fffce700');
  sky.fillStyle = glow;
  sky.fillRect(315, 33, 70, 70);
  const input = new THREE.CanvasTexture(sky.canvas);
  input.colorSpace = THREE.SRGBColorSpace;
  input.mapping = THREE.EquirectangularReflectionMapping;
  textures.add(input);
  const environment = createEnvironmentMap(renderer, input);

  return {
    textures, materials, environment, environmentSource: input,
    human: {
      skin: physical({ color: '#cda78b', map: skinMap, roughness: 0.62, clearcoat: 0.03 }),
      hair: standard({ color: '#30271f', roughness: 0.95 }),
      jacket: standard({ color: '#c37643', map: fabricMap, bumpMap: fabricBump, bumpScale: 0.005, roughness: 0.91 }),
      trousers: standard({ color: '#34404a', map: fabricMap, bumpMap: fabricBump, bumpScale: 0.004, roughness: 0.95 }),
      boots: physical({ color: '#433d35', roughness: 0.65, clearcoat: 0.08 }),
      eyes,
      trim: dark,
      pack: standard({ color: '#575f4b', map: fabricMap, bumpMap: fabricBump, bumpScale: 0.006, roughness: 0.9 }),
    },
    deer: {
      fur: standard({ color: '#bc9469', map: furMap, bumpMap: furBump, bumpScale: 0.005, roughness: 0.97 }),
      undercoat: standard({ color: '#e4dbc3', map: furMap, roughness: 1 }),
      hooves: standard({ color: '#443d31', roughness: 0.85 }),
      eyes,
      antlers: standard({ color: '#b7a283', roughness: 0.88 }),
    },
    train: {
      body: physical({ color: '#e5e9e9', metalness: 0.25, roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.25 }),
      stripe: standard({ color: '#246d8f', metalness: 0.35, roughness: 0.3, side: THREE.DoubleSide }),
      glass: physical({ color: '#304957', metalness: 0.2, roughness: 0.07, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide }),
      dark, metal,
      light: standard({ color: '#fff2ca', emissive: '#ffebbd', emissiveIntensity: 1.8, roughness: 0.2 }),
      redLight: standard({ color: '#b63e31', emissive: '#df4229', emissiveIntensity: 1.2 }),
      emblem: emblemMaterial,
    },
    ground: standard({ vertexColors: true, map: grassMap, bumpMap: grassBump, bumpScale: 0.13, roughness: 1 }),
    concrete: standard({ color: '#d3d5ce', map: concreteMap, bumpMap: concreteBump, bumpScale: 0.025, roughness: 0.94, side: THREE.DoubleSide }),
    ballast: standard({ color: '#d5d4cb', map: ballastMap, bumpMap: ballastBump, bumpScale: 0.07, roughness: 1, side: THREE.DoubleSide }),
    foliage,
    stone: standard({ color: '#b1b1a3', map: stoneMap, bumpMap: stoneBump, bumpScale: 0.08, roughness: 0.96 }),
    rail: standard({ color: '#929c9d', metalness: 0.76, roughness: 0.28 }),
  };
}
