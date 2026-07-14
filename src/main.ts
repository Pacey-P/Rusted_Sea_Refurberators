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
import * as spine from "@esotericsoftware/spine-threejs";

// ---------------------------------------------------------------- tuning ---
const T = {
  surfaceColor: new THREE.Color("#0e3540"), // upper water
  deepColor: new THREE.Color("#010507"), // lower water
  fogColor: new THREE.Color("#04141b"),
  fogDensity: 0.055,
  ambient: 0.22,
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
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(T.fogColor, T.fogDensity);

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
scene.add(bg);

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
const moteMat = new THREE.PointsMaterial({
  color: 0x9fc4cc,
  size: 0.035,
  transparent: true,
  opacity: 0.5,
  sizeAttenuation: true,
  depthWrite: false,
});
const motes = new THREE.Points(moteGeo, moteMat);
scene.add(motes);

// ---------------------------------------------------------------- lights ---
scene.add(new THREE.HemisphereLight(0x2a5a68, 0x000000, T.ambient));

// broad dim moon-through-water key from above
const surfaceKey = new THREE.DirectionalLight(0x5a8894, 0.35);
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

const floorNear = makeSeafloor(-3.6, 0.55, 0x243139, 90, 96);
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
const texLoader = new THREE.TextureLoader();

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
  binary.scale = 0.0032; // Spine px -> world units; diver ≈ 1.9u tall
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
  camera.position.y = 0.4 + Math.sin(t * 0.31) * 0.15;
  camera.lookAt(0, 0, 0);

  composer.render();
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
