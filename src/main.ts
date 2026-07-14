/**
 * Rusted Sea: Refurberators — Milestone 0: the lighting proof.
 *
 * One scene: the SHELLTER at rest in dark water, warm light in the porthole,
 * god rays from the surface, drifting particulate, and the diver (original
 * Spine rig, untouched) swimming home under a flashlight cone.
 *
 * Everything here is deliberately single-file; systems get real homes in M1.
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as spine from "@esotericsoftware/spine-threejs";

// Two ends of the game's visual grammar, same engine:
//   default   — "the hearth": home waters, layered, warm, alive
//   ?drop     — "the drop": deep theatre water; the world stripped away,
//               one bubble of visibility, silhouettes at the beam's edge
const DROP = new URLSearchParams(location.search).has("drop");

// ---------------------------------------------------------------- tuning ---
const T = {
  surfaceColor: new THREE.Color("#0e3540"), // upper water
  deepColor: new THREE.Color("#010507"), // lower water
  fogColor: new THREE.Color("#04141b"),
  fogDensity: 0.055,
  ambient: 0.32,
  godRayStrength: 0.85,
  warm: new THREE.Color("#ffb066"), // porthole / interior light
  lampCool: new THREE.Color("#cfe8ff"), // diver flashlight
  bloom: { strength: 0.4, radius: 0.55, threshold: 0.82 },
  diverPos: new THREE.Vector3(-5.6, 0.3, 0.4),
  shellterPos: new THREE.Vector3(3.9, -0.55, 0),
  shellterHeight: 7.0, // world units (meters-ish)
};

// ----------------------------------------------------------------- setup ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(
  DROP ? new THREE.Color("#01060a") : T.fogColor,
  DROP ? 0.085 : T.fogDensity,
);
const texLoader = new THREE.TextureLoader();

const camera = new THREE.PerspectiveCamera(
  46,
  window.innerWidth / window.innerHeight,
  0.1,
  200,
);
camera.position.set(0, 0.4, 13.5);

// ------------------------------------------------------------ background ---
// Depth-graded water: bright(er) toward the surface, black below, with a
// soft god-glow where the sun would be. Sits far behind everything, unfogged.
const bgMat = new THREE.ShaderMaterial({
  depthWrite: false,
  uniforms: {
    surfaceColor: { value: T.surfaceColor },
    deepColor: { value: T.deepColor },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform vec3 surfaceColor;
    uniform vec3 deepColor;
    void main() {
      float depthMix = pow(smoothstep(0.05, 0.95, vUv.y), 1.6);
      vec3 col = mix(deepColor, surfaceColor, depthMix);
      // sun-glow high and slightly left, where the rays come from
      float glow = exp(-14.0 * distance(vUv, vec2(0.38, 1.05)));
      col += vec3(0.25, 0.42, 0.45) * glow;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
const bg = new THREE.Mesh(new THREE.PlaneGeometry(160, 90), bgMat);
bg.position.set(0, 6, -45);
if (!DROP) scene.add(bg);

// drop mode: near-black water — the rest of "the drop" treatment is TBD
if (DROP) scene.background = new THREE.Color("#010409");

// -------------------------------------------------------------- god rays ---
// One large additive quad; the shafts are computed in the fragment shader as
// slanted, slowly-swaying bands that fade with depth. Cheap, one draw call.
const rayMat = new THREE.ShaderMaterial({
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  uniforms: {
    time: { value: 0 },
    strength: { value: T.godRayStrength },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform float time;
    uniform float strength;

    float band(vec2 uv, float freq, float speed, float slant) {
      float x = uv.x + (1.0 - uv.y) * slant;
      float s = sin(x * freq + time * speed) * 0.5 + 0.5;
      return pow(s, 5.0);
    }

    void main() {
      float rays =
        band(vUv, 18.0, 0.10, 0.55) * 0.9 +
        band(vUv, 31.0, -0.07, 0.62) * 0.5 +
        band(vUv,  7.0, 0.05, 0.50) * 0.7;
      float depthFade = pow(smoothstep(0.0, 1.0, vUv.y), 2.2);
      float sideFade = smoothstep(0.0, 0.25, vUv.x) * (1.0 - smoothstep(0.72, 1.0, vUv.x));
      float a = rays * depthFade * sideFade * strength;
      gl_FragColor = vec4(vec3(0.45, 0.72, 0.78) * a, a);
    }
  `,
});
const rays = new THREE.Mesh(new THREE.PlaneGeometry(48, 26), rayMat);
rays.position.set(-2, 7.5, -12);
rays.rotation.z = -0.16;
scene.add(rays);

// ------------------------------------------------------------ particulate ---
const MOTE_COUNT = 700;
const motePos = new Float32Array(MOTE_COUNT * 3);
const moteSeed = new Float32Array(MOTE_COUNT);
for (let i = 0; i < MOTE_COUNT; i++) {
  motePos[i * 3 + 0] = THREE.MathUtils.randFloatSpread(30);
  motePos[i * 3 + 1] = THREE.MathUtils.randFloatSpread(16);
  motePos[i * 3 + 2] = THREE.MathUtils.randFloat(-8, 8);
  moteSeed[i] = Math.random() * 100;
}
const moteGeo = new THREE.BufferGeometry();
moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
function softDotTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const dotTex = softDotTexture();
const moteMat = new THREE.PointsMaterial({
  color: 0x9fc4cc,
  size: 0.045,
  map: dotTex,
  transparent: true,
  opacity: 0.5,
  sizeAttenuation: true,
  depthWrite: false,
});
const motes = new THREE.Points(moteGeo, moteMat);
scene.add(motes);

// a handful of big, soft, near-camera motes — cheap depth-of-field feel
const BOKEH_COUNT = 18;
const bokehPos = new Float32Array(BOKEH_COUNT * 3);
for (let i = 0; i < BOKEH_COUNT; i++) {
  bokehPos[i * 3 + 0] = THREE.MathUtils.randFloatSpread(26);
  bokehPos[i * 3 + 1] = THREE.MathUtils.randFloatSpread(12);
  bokehPos[i * 3 + 2] = THREE.MathUtils.randFloat(6, 10);
}
const bokehGeo = new THREE.BufferGeometry();
bokehGeo.setAttribute("position", new THREE.BufferAttribute(bokehPos, 3));
const bokeh = new THREE.Points(
  bokehGeo,
  new THREE.PointsMaterial({
    color: 0x8fb5bd,
    size: 0.45,
    map: dotTex,
    transparent: true,
    opacity: 0.08,
    sizeAttenuation: true,
    depthWrite: false,
  }),
);
scene.add(bokeh);

// ---------------------------------------------------------------- lights ---
scene.add(new THREE.HemisphereLight(0x2a5a68, 0x000000, T.ambient));

// broad dim moon-through-water key from above
const surfaceKey = new THREE.DirectionalLight(0x5a8894, 0.55);
surfaceKey.position.set(-4, 12, 4);
scene.add(surfaceKey);

// warm interior light bleeding out of the porthole
const portholeLight = new THREE.PointLight(T.warm, 8, 7, 2);
scene.add(portholeLight); // positioned once the SHELLTER plane is sized

// diver headlamp — the actual light that hits the SHELLTER plating
const lamp = new THREE.SpotLight(T.lampCool, 60, 24, 0.42, 0.55, 1.6);
const lampTarget = new THREE.Object3D();
scene.add(lamp, lampTarget);
lamp.target = lampTarget;

// --------------------------------------------------------------- terrain ---
// Real 3D seafloor: a displaced dune plane up close, two darker ridge layers
// behind it, and scattered rock forms. Fog does the depth-grading for free.
function noise2(x: number, z: number): number {
  // cheap value-noise stand-in: layered sines with irrational frequencies
  return (
    Math.sin(x * 0.31 + z * 0.17) * 0.5 +
    Math.sin(x * 0.113 - z * 0.271 + 1.7) * 0.85 +
    Math.sin(x * 0.053 + z * 0.089 + 4.2) * 1.4
  );
}

function makeSeafloor(
  y: number,
  amp: number,
  color: number,
  size: number,
  segs: number,
): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(size, size * 0.4, segs, Math.floor(segs * 0.4));
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, noise2(x, z) * amp);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 }),
  );
  mesh.position.y = y;
  return mesh;
}

const floorNear = makeSeafloor(-3.6, 0.55, 0x2b3b46, 90, 96);
scene.add(floorNear);
const ridgeMid = makeSeafloor(-3.3, 1.0, 0x141f26, 120, 64);
ridgeMid.position.z = -16;
scene.add(ridgeMid);
const ridgeFar = makeSeafloor(-3.0, 1.5, 0x0c151b, 160, 48);
ridgeFar.position.z = -32;
scene.add(ridgeFar);

// scattered rocks along the near floor
const rockGeo = new THREE.DodecahedronGeometry(1, 0);
const rockMat = new THREE.MeshStandardMaterial({ color: 0x1c262d, roughness: 1 });
for (let i = 0; i < 16; i++) {
  const rock = new THREE.Mesh(rockGeo, rockMat);
  const rx = THREE.MathUtils.randFloatSpread(44);
  const rz = THREE.MathUtils.randFloat(-18, 2);
  rock.position.set(rx, -3.55 + noise2(rx, rz) * 0.55, rz);
  rock.scale.set(
    THREE.MathUtils.randFloat(0.4, 1.6),
    THREE.MathUtils.randFloat(0.25, 0.9),
    THREE.MathUtils.randFloat(0.4, 1.4),
  );
  rock.rotation.y = Math.random() * Math.PI;
  scene.add(rock);
}

// ---------------------------------------------------------- set dressing ---
// Depth is layers: dark flora silhouettes framing the camera up close,
// dressed midground, wrecks and a kelp forest dissolving into the fog.
// All original game art (Sprites/Kelp, Environment, Wreckage), re-tinted.
const swayMats: THREE.ShaderMaterial[] = [];

function addFlora(
  tex: string,
  x: number,
  baseY: number,
  z: number,
  height: number,
  tint: number,
  sway = 0.12,
  flip = false,
): void {
  texLoader.load(`assets/sprites/${tex}.png`, (map) => {
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const aspect = map.image.width / map.image.height;
    const w = height * aspect;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        map: { value: map },
        tint: { value: new THREE.Color(tint) },
        time: { value: 0 },
        sway: { value: sway },
        phase: { value: Math.random() * Math.PI * 2 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        uniform float time;
        uniform float sway;
        uniform float phase;
        void main() {
          vUv = uv;
          vec3 p = position;
          // tip-weighted sway, anchored at the base (uv.y = 0 is bottom)
          float bend = sin(time * 0.7 + phase + uv.y * 1.5) * sway * uv.y * uv.y;
          p.x += bend;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform sampler2D map;
        uniform vec3 tint;
        void main() {
          vec4 c = texture2D(map, vUv);
          if (c.a < 0.15) discard;
          gl_FragColor = vec4(tint * c.rgb, c.a);
        }
      `,
    });
    swayMats.push(mat);
    const geo = new THREE.PlaneGeometry(w, height);
    geo.translate(0, height / 2, 0); // pivot at base
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, baseY, z);
    if (flip) mesh.scale.x = -1;
    scene.add(mesh);
  });
}

// FOREGROUND — huge, deep-teal silhouettes framing the bottom corners
addFlora("kelp_1", -9.2, -6.2, 6.0, 9.5, 0x0a3540, 0.3);
addFlora("kelp_2", -7.4, -5.8, 5.2, 5.5, 0x082a33, 0.24, true);
addFlora("kelp_1", 9.8, -6.4, 6.5, 10.5, 0x092f3a, 0.28, true);
addFlora("coral_1", 7.6, -4.6, 5.4, 3.4, 0x0b303a, 0.05);

// MIDGROUND — dressing the stage floor around the subjects
addFlora("kelp_3", -1.6, -3.5, -1.6, 2.6, 0x1d4652, 0.16);
addFlora("kelp_1", -3.1, -3.6, -2.6, 3.4, 0x173a46, 0.2);
addFlora("plant_1", -6.4, -3.45, -1.2, 0.7, 0x2a5561, 0.08);
addFlora("plant_2", 0.6, -3.45, -0.9, 0.8, 0x24505c, 0.08);
addFlora("coral_2", -8.3, -3.5, -2.2, 1.3, 0x274b56, 0.03);
addFlora("stone_1", 7.1, -3.45, -1.4, 0.9, 0x2c3a42, 0);
addFlora("hole_rock", -12.3, -3.6, -3.4, 1.6, 0x27343c, 0);

// BACKGROUND — silhouettes dissolving into the fog
addFlora("wreck_1", -15.5, -4.4, -14, 6.5, 0x0e2029, 0);
addFlora("wreck_2", 20.5, -5.0, -26, 5.5, 0x0a1820, 0);
for (let i = 0; i < 6; i++) {
  const bx = -21 + i * 1.9 + Math.random() * 1.2;
  addFlora(
    i % 2 ? "kelp_1" : "kelp_2",
    bx,
    -4.2,
    -17 - Math.random() * 3,
    6.5 + Math.random() * 3.5,
    0x0c1e27,
    0.14,
    i % 2 === 0,
  );
}
for (let i = 0; i < 4; i++) {
  addFlora(
    "kelp_1",
    15.5 + i * 2.4,
    -4.2,
    -20 - Math.random() * 4,
    6 + Math.random() * 2,
    0x0b1c24,
    0.14,
    i % 2 === 0,
  );
}

// ------------------------------------------- the C-Major, passing in the deep ---
// Vehicles-in-3D test: the Sea Major base station (real .glb from the old 3D
// prototype) crossing the far water as a fogged silhouette. Same lights, same
// fog — 3D machines and 2D Spine characters sharing one world.
let seaMajor: THREE.Group | null = null;
new GLTFLoader().load("assets/models/sea_major.glb", (gltf) => {
  seaMajor = gltf.scene;
  const box = new THREE.Box3().setFromObject(seaMajor);
  const size = box.getSize(new THREE.Vector3());
  const s = 11 / size.x; // ~11 world units long — a big ship, not a whale
  seaMajor.scale.setScalar(s);
  seaMajor.position.set(-6, 2.0, -21);
  seaMajor.rotation.y = Math.PI * 0.52; // beam-on to camera, nose left
  scene.add(seaMajor);
});

// ------------------------------------------------------------ fish school ---
function makeFishTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 32;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0d2129";
  g.beginPath();
  g.ellipse(38, 16, 18, 7, 0, 0, Math.PI * 2); // body
  g.moveTo(22, 16);
  g.lineTo(6, 6);
  g.lineTo(6, 26);
  g.closePath(); // tail
  g.fill();
  return new THREE.CanvasTexture(c);
}
type Fish = { mesh: THREE.Mesh; cx: number; cy: number; r: number; sp: number; ph: number };
const fishes: Fish[] = [];
{
  const fishTex = makeFishTexture();
  const fishMat = new THREE.MeshBasicMaterial({
    map: fishTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.9,
    fog: true,
  });
  const fishGeo = new THREE.PlaneGeometry(0.6, 0.3);
  for (let i = 0; i < 14; i++) {
    const mesh = new THREE.Mesh(fishGeo, fishMat);
    const f: Fish = {
      mesh,
      cx: -8 + THREE.MathUtils.randFloatSpread(6),
      cy: 0.6 + THREE.MathUtils.randFloatSpread(2.4),
      r: THREE.MathUtils.randFloat(2.5, 5),
      sp: THREE.MathUtils.randFloat(0.05, 0.11),
      ph: Math.random() * Math.PI * 2,
    };
    mesh.position.z = THREE.MathUtils.randFloat(-9, -5);
    fishes.push(f);
    scene.add(mesh);
  }
}

// -------------------------------------------------- light pools & shadow ---
function makeSoftDisc(color: THREE.Color, opacity: number): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: tex,
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

// distant god-beam striking the sand
const distantBeam = makeBeam(16, 6.5, new THREE.Color(0x5f8f9a), 0.3);
distantBeam.position.set(-13.5, 6.5, -7);
distantBeam.rotation.z = -1.32; // steeply down
scene.add(distantBeam);
const sandPool = makeSoftDisc(new THREE.Color(0x6fa3ae), 0.5);
sandPool.scale.set(7.5, 3.6, 1);
sandPool.position.set(-11.8, -3.15, -6.5);
scene.add(sandPool);

// warm spill pool under the SHELLTER's opening
const homePool = makeSoftDisc(new THREE.Color(T.warm), 0.22);
homePool.scale.set(5.5, 2.4, 1);
homePool.position.set(1.0, -3.2, -0.6);
scene.add(homePool);

// contact shadow grounding the SHELLTER
{
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.62)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(c),
      transparent: true,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(9, 3.4, 1);
  shadow.position.set(T.shellterPos.x, -3.28, 0.4);
  scene.add(shadow);
}

// ------------------------------------------------------ volumetric cones ---
// A flat "light wedge" quad: apex at the left edge, brightness falls off along
// its length and toward its edges. Reads as a volumetric beam in side view.
function makeBeam(
  length: number,
  width: number,
  color: THREE.Color,
  intensity: number,
): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: {
      color: { value: color },
      intensity: { value: intensity },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform vec3 color;
      uniform float intensity;
      uniform float time;
      void main() {
        float along = vUv.x;                       // 0 apex -> 1 far end
        float spread = abs(vUv.y - 0.5) * 2.0;     // 0 center -> 1 edge
        float cone = 1.0 - smoothstep(0.0, 1.0, spread / (0.15 + along));
        float fall = pow(1.0 - along, 1.7);
        float flicker = 0.94 + 0.06 * sin(time * 9.0 + vUv.x * 20.0);
        float a = cone * fall * intensity * flicker;
        gl_FragColor = vec4(color * a, a);
      }
    `,
  });
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(length, width), mat);
  (beam.geometry as THREE.PlaneGeometry).translate(length / 2, 0, 0); // apex at origin
  return beam;
}

const lampBeam = makeBeam(11.5, 3.8, new THREE.Color(T.lampCool), 0.55);
scene.add(lampBeam);

const portholeBeam = makeBeam(4.5, 2.2, new THREE.Color(T.warm), 0.4);
scene.add(portholeBeam);

// soft additive glow sprite generator (for porthole hot-spot)
function makeGlow(color: THREE.Color, size: number): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(size);
  return s;
}
const portholeGlow = makeGlow(T.warm, 1.15);
scene.add(portholeGlow);

// -------------------------------------------------- SHELLTER (furnished) ---
// The furnished interior cutaway, rebuilt from the original Godot scene
// (Prefabs/SHELLTER/shellter.tscn). Godot positions are root-space pixels;
// the Interior shell sprite sits at (3026, -811) with scale 1.5 and a
// 4992x3328 texture. We convert everything into world units around that.

const SHELL_ORIGIN = { x: 3026, y: -811 };
const SHELL_PX_H = 3328 * 1.5;
const PX = T.shellterHeight / SHELL_PX_H; // world units per Godot pixel

type Prop = {
  tex: string;
  x: number; // Godot root-space position (from shellter.tscn)
  y: number;
  s?: number; // Godot node scale
  z: number; // depth layer in front of the shell
};
const PROPS: Prop[] = [
  { tex: "bed", x: 1535.32, y: -739.19, z: 0.06 },
  { tex: "tank_base", x: 1370.12, y: -535.38, s: 1.5, z: 0.05 },
  { tex: "toilet", x: 2661.4, y: -855.73, s: 1.6, z: 0.06 },
  { tex: "toilet_paper", x: 2537.41, y: -1313.38, z: 0.07 },
  { tex: "sink", x: 2305.43, y: -1578.44, z: 0.07 },
  { tex: "water_filter", x: 1967.08, y: -1765.55, z: 0.07 },
  { tex: "stove", x: 3244.14, y: -1204.98, s: 2.5, z: 0.06 },
  { tex: "frying_pan", x: 2905.6, y: -1438.26, s: 0.8, z: 0.07 },
  { tex: "coffee_pot", x: 3405.35, y: -1529.93, z: 0.07 },
  { tex: "crate", x: 3263.31, y: -541.99, z: 0.04 },
  { tex: "shelf", x: 4353.81, y: -993.87, s: 1.4, z: 0.05 }, // PC_Shelf, child of PC
  { tex: "pc", x: 4924.4, y: -1101.85, s: 0.7, z: 0.06 },
  { tex: "lamp", x: 2768, y: -2514, z: 0.07 },
];

// Slight inward squeeze on x: the shell art's padding differs from the
// exterior's, so the raw tscn offsets overshoot the hull rim a touch.
const X_SQUEEZE = 0.9;

function toWorld(gx: number, gy: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(
    T.shellterPos.x + (gx - SHELL_ORIGIN.x) * PX * X_SQUEEZE,
    T.shellterPos.y - (gy - SHELL_ORIGIN.y) * PX, // Godot Y is down
    T.shellterPos.z + z,
  );
}

function addSprite(tex: string, pos: THREE.Vector3, s: number): void {
  texLoader.load(`assets/sprites/${tex}.png`, (map) => {
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const w = map.image.width * s * PX;
    const h = map.image.height * s * PX;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({
        map,
        transparent: true,
        roughness: 0.85,
        metalness: 0.15,
        alphaTest: 0.05,
      }),
    );
    mesh.position.copy(pos);
    scene.add(mesh);
  });
}

// shell first (the cutaway hull), then every prop from the original layout
addSprite("shell_interior", toWorld(SHELL_ORIGIN.x, SHELL_ORIGIN.y, 0.01), 1.5);
for (const p of PROPS) addSprite(p.tex, toWorld(p.x, p.y, p.z), p.s ?? 1);

// Lights, straight from the tscn's own rig:
// "Bulb" — the hanging lantern's actual light point
const bulbPos = toWorld(2641, -1472, 0.3);
portholeLight.position.copy(bulbPos); // warm room light (reused)
portholeGlow.position.copy(toWorld(2768, -2340, 0.32)); // lantern hot-spot
portholeGlow.scale.setScalar(0.5);

// "ComputerLight" — the CRT's phosphor glow
const pcGlowPos = toWorld(4780, -1250, 0.32);
const pcLight = new THREE.PointLight(0x77e0c2, 3, 3.2, 2);
pcLight.position.copy(pcGlowPos);
scene.add(pcLight);
const pcGlow = makeGlow(new THREE.Color(0x77e0c2), 0.5);
pcGlow.position.copy(pcGlowPos);
scene.add(pcGlow);

// "OceanLight" — warm spill out of the open cutaway side, into the sea
const openingPos = toWorld(1000, -1100, 0.28);
portholeBeam.position.copy(openingPos);
portholeBeam.rotation.z = Math.PI - 0.18; // spills out left, slightly down
portholeBeam.scale.set(1.6, 1.8, 1);

// ----------------------------------------------------------------- diver ---
let skeletonMesh: spine.SkeletonMesh | null = null;
const assetManager = new spine.AssetManager("assets/spine/");
assetManager.loadBinary("Cade_Swimming.skel");
assetManager.loadTextureAtlas("Cade_Swimming.atlas");

function onAssetsLoaded() {
  const atlas = assetManager.require("Cade_Swimming.atlas");
  const atlasLoader = new spine.AtlasAttachmentLoader(atlas);
  const binary = new spine.SkeletonBinary(atlasLoader);
  // Spine px -> world units. Sized so the diver fits the SHELLTER's door and
  // furniture (body length ≈ bed length); exact standing-mode calibration
  // happens in M1 with the 1.6-scale standing rig from player.tscn.
  binary.scale = 0.0027;
  const skeletonData = binary.readSkeletonData(
    assetManager.require("Cade_Swimming.skel"),
  );
  console.log(
    "Spine animations:",
    JSON.stringify(skeletonData.animations.map((a) => a.name)),
  );
  console.log(
    "Spine skins:",
    JSON.stringify(skeletonData.skins.map((s) => s.name)),
  );

  skeletonMesh = new spine.SkeletonMesh({ skeletonData });

  const anims = skeletonData.animations.map((a) => a.name);
  const swim =
    anims.find((a) => a === "swim_idle") ??
    anims.find((a) => a.toLowerCase().includes("swim")) ??
    anims[0];
  skeletonMesh.state.setAnimation(0, swim, true);

  // arms live in the weapon skins — "default" has none.
  // The flashlight skin puts the beam in his hand, where it belongs.
  skeletonMesh.skeleton.setSkinByName("weapons/onehanded_flashlight");
  skeletonMesh.skeleton.setSlotsToSetupPose();

  // rig faces right by default — already headed home
  skeletonMesh.position.copy(T.diverPos);
  // cool depth tint so the unlit spine mesh sits in the dark scene
  skeletonMesh.skeleton.color.set(0.42, 0.53, 0.62, 1);
  scene.add(skeletonMesh);
}

// ------------------------------------------------------------------ post ---
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  T.bloom.strength,
  T.bloom.radius,
  T.bloom.threshold,
);
composer.addPass(bloom);
const vignette = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, strength: { value: 0.42 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float strength;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = length((vUv - 0.5) * vec2(1.25, 1.0));
      float vig = smoothstep(1.0, 0.5, d); // 1 center -> 0 far corners
      c.rgb *= mix(1.0 - strength, 1.0, vig);
      // final pass owns the linear -> sRGB conversion
      c.rgb = pow(max(c.rgb, 0.0), vec3(1.0 / 2.2));
      gl_FragColor = c;
    }
  `,
});
composer.addPass(vignette);

// ------------------------------------------------------------------ loop ---
const clock = new THREE.Clock();
let assetsReady = false;

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = clock.elapsedTime;

  if (!assetsReady && assetManager.isLoadingComplete()) {
    assetsReady = true;
    onAssetsLoaded();
  }

  rayMat.uniforms.time.value = t;
  for (const m of swayMats) m.uniforms.time.value = t;
  (distantBeam.material as THREE.ShaderMaterial).uniforms.time.value = t;

  // the C-Major crawls across the deep, slow as weather
  if (seaMajor) seaMajor.position.x = -6 + Math.sin(t * 0.045) * 10;

  // fish drift lazy ellipses; flip to face travel direction
  for (const f of fishes) {
    const px = f.mesh.position.x;
    f.mesh.position.x = f.cx + Math.cos(t * f.sp + f.ph) * f.r;
    f.mesh.position.y = f.cy + Math.sin(t * f.sp * 1.7 + f.ph) * 0.5;
    f.mesh.scale.x = f.mesh.position.x > px ? 1 : -1;
  }

  // motes drift up-left with a lazy wobble
  const p = moteGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < MOTE_COUNT; i++) {
    let x = p.getX(i) - dt * 0.12;
    let y = p.getY(i) + dt * 0.05 + Math.sin(t * 0.6 + moteSeed[i]) * dt * 0.05;
    if (x < -15) x = 15;
    if (y > 8) y = -8;
    p.setXY(i, x, y);
  }
  p.needsUpdate = true;

  // diver: gentle bob + slow approach toward home
  if (skeletonMesh) {
    skeletonMesh.update(dt);
    const bob = Math.sin(t * 0.9) * 0.12;
    skeletonMesh.position.y = T.diverPos.y + bob;
    skeletonMesh.position.x = T.diverPos.x + Math.sin(t * 0.13) * 0.6;

    // headlamp + beam track the diver, aimed at the SHELLTER hatch
    const head = new THREE.Vector3(
      skeletonMesh.position.x + 0.55,
      skeletonMesh.position.y + 0.45,
      0.3,
    );
    lamp.position.copy(head);
    lampTarget.position.set(T.shellterPos.x - 1.2, T.shellterPos.y + 0.4, 0);
    lampBeam.position.copy(head);
    const aim = Math.atan2(
      lampTarget.position.y - head.y,
      lampTarget.position.x - head.x,
    );
    lampBeam.rotation.z = aim;
    (lampBeam.material as THREE.ShaderMaterial).uniforms.time.value = t;
  }
  (portholeBeam.material as THREE.ShaderMaterial).uniforms.time.value = t;

  // room light breathes very slightly, like a lived-in space
  portholeLight.intensity = 8 + Math.sin(t * 1.7) * 0.7;

  // subtle camera sway — we're floating too
  camera.position.x = Math.sin(t * 0.21) * 0.25;
  camera.position.y = 0.25 + Math.sin(t * 0.31) * 0.15;
  camera.lookAt(0, -0.35, 0);

  composer.render();
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
