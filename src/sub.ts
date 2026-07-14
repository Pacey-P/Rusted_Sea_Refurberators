/**
 * Rusted Sea — 3D sub prototype ("the game as it began").
 *
 * Pilot a rusty submarine through black water. One bubble of visibility,
 * silhouettes at the edge of the beam. The Sea Major model stands in for
 * the player sub until a player-scale hull exists; a second instance lies
 * wrecked on the seafloor as the salvage target.
 *
 * W/S thrust, A/D turn, R/F depth, drag mouse to orbit the camera.
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// ----------------------------------------------------------------- setup ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#020a10");
scene.fog = new THREE.FogExp2(new THREE.Color("#020a10"), 0.026);

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  300,
);

// ---------------------------------------------------------------- lights ---
scene.add(new THREE.HemisphereLight(0x1c3a44, 0x000000, 0.14));

// the sub's headlight — the only real light in the world
const headlight = new THREE.SpotLight(0xcfe8ff, 260, 55, 0.36, 0.5, 1.5);
const headlightTarget = new THREE.Object3D();
scene.add(headlightTarget);
headlight.target = headlightTarget;

// faint warm running light on the sub itself so its own hull reads
const runningLight = new THREE.PointLight(0xffb066, 5, 10, 1.8);

// ------------------------------------------------------------- player sub ---
const subGroup = new THREE.Group();
scene.add(subGroup);
subGroup.add(headlight, runningLight);
runningLight.position.set(0, 1.2, -1);

let subReady = false;
const loader = new GLTFLoader();
loader.load("assets/models/sea_major.glb", (gltf) => {
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center); // center it on the group origin
  console.log("sea_major size:", JSON.stringify(size));

  // bbox is nearly square (antennas/tail pipe) — orient the hull by eye:
  // profile runs along X in the glb with the tail toward +X, so -90° puts
  // the bow on +Z (our forward). The extra correction cancels a few degrees
  // of yaw baked into the model, which read as "veering" under thrust.
  model.rotation.y = -Math.PI / 2 - 0.12;
  const long = Math.max(size.x, size.z);
  model.scale.setScalar(9 / long); // player sub ~9 units long
  subGroup.add(model);
  subReady = true;
});

// headlight mounted at the nose, aimed ahead (targets updated per-frame)
headlight.position.set(0, 0.4, 4.2);

// volumetric beam cone off the nose
const beamMat = new THREE.ShaderMaterial({
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.BackSide, // render the far inside wall — softer silhouette
  uniforms: { time: { value: 0 } },
  vertexShader: /* glsl */ `
    varying float vAlong; // 0 at apex (nose) -> 1 at far end
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      vAlong = 1.0 - uv.y;
      vNormal = normalMatrix * normal;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vView = -mv.xyz;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    varying float vAlong;
    varying vec3 vNormal;
    varying vec3 vView;
    uniform float time;
    void main() {
      // soft radial edge: fade out where the view grazes the cone's rim
      float facing = abs(dot(normalize(vNormal), normalize(vView)));
      float body = smoothstep(0.0, 0.65, facing);
      float fall = pow(1.0 - vAlong, 2.0);
      float shimmer = 0.92 + 0.08 * sin(time * 6.0 + vAlong * 14.0);
      float a = body * fall * 0.14 * shimmer;
      gl_FragColor = vec4(vec3(0.62, 0.82, 0.95) * a, a);
    }
  `,
});
const beamGeo = new THREE.ConeGeometry(4.2, 22, 24, 1, true);
const beam = new THREE.Mesh(beamGeo, beamMat);
// unambiguous orientation: cone's apex axis (+Y) mapped onto -Z, so the apex
// sits at the nose and the cone opens along +Z (our forward)
beam.quaternion.setFromUnitVectors(
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, -1),
);
beam.position.set(0, 0.4, 3.6 + 11);
subGroup.add(beam);

// anchor the beam to a visible light source: a hot lamp glow at the nose
function softDiscTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, "rgba(255,255,255,0.5)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const lampGlow = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: softDiscTexture(),
    color: 0xd9edff,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
);
lampGlow.scale.setScalar(0.8);
(lampGlow.material as THREE.SpriteMaterial).opacity = 0.55;
lampGlow.position.set(0, 0.4, 4.4);
subGroup.add(lampGlow);
// and a small real light so the bow itself catches the lamp
const noseLight = new THREE.PointLight(0xd9edff, 7, 7, 1.8);
noseLight.position.set(0, 0.4, 3.4);
subGroup.add(noseLight);

// ------------------------------------------------------------- the wreck ---
// A second Sea Major, dead on the seafloor — the salvage target.
loader.load("assets/models/sea_major.glb", (gltf) => {
  const wreck = gltf.scene;
  const box = new THREE.Box3().setFromObject(wreck);
  const size = box.getSize(new THREE.Vector3());
  if (size.x > size.z) wreck.rotation.y = Math.PI / 2;
  const long = Math.max(size.x, size.z);
  wreck.scale.setScalar(26 / long); // the wreck is a big ship
  wreck.position.set(10, -22.5, 55);
  wreck.rotation.z = 0.34; // keeled over
  wreck.rotation.y = 2.3;
  scene.add(wreck);
});

// --------------------------------------------------------------- seafloor ---
function noise2(x: number, z: number): number {
  return (
    Math.sin(x * 0.11 + z * 0.07) * 1.2 +
    Math.sin(x * 0.043 - z * 0.091 + 1.7) * 2.2 +
    Math.sin(x * 0.021 + z * 0.033 + 4.2) * 3.5
  );
}
{
  const geo = new THREE.PlaneGeometry(600, 600, 140, 140);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, noise2(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();
  const floor = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0x18242c, roughness: 1 }),
  );
  floor.position.y = -26;
  scene.add(floor);
}

// ------------------------------------------------------------ particulate ---
// Motes live in a cube around the sub and wrap as it moves — this is what
// sells speed and direction in open water.
const MOTES = 1400;
const RANGE = 46;
const motePos = new Float32Array(MOTES * 3);
for (let i = 0; i < MOTES * 3; i++) motePos[i] = THREE.MathUtils.randFloatSpread(RANGE * 2);
const moteGeo = new THREE.BufferGeometry();
moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
function softDot(): THREE.CanvasTexture {
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
const motes = new THREE.Points(
  moteGeo,
  new THREE.PointsMaterial({
    color: 0x93b7c0,
    size: 0.14,
    map: softDot(),
    transparent: true,
    opacity: 0.55,
    sizeAttenuation: true,
    depthWrite: false,
  }),
);
scene.add(motes);

// (No wildlife yet — empty water is scarier than placeholder fish. Creatures
// come back later done properly: Spine billboards or simple rigged meshes.)

// ------------------------------------------------------------------ input ---
const keys = new Set<string>();
window.addEventListener("keydown", (e) => keys.add(e.code));
window.addEventListener("keyup", (e) => keys.delete(e.code));

const params = new URLSearchParams(location.search);
let orbitYaw = parseFloat(params.get("yaw") ?? "0");
let orbitPitch = parseFloat(params.get("pitch") ?? "0.12");
let dragging = false;
window.addEventListener("mousedown", () => (dragging = true));
window.addEventListener("mouseup", () => (dragging = false));
window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  orbitYaw -= e.movementX * 0.004;
  orbitPitch = THREE.MathUtils.clamp(orbitPitch + e.movementY * 0.003, -0.5, 0.9);
});

// ---------------------------------------------------------------- physics ---
const sub = {
  pos: new THREE.Vector3(0, -6, 0),
  vel: new THREE.Vector3(),
  yaw: 0,
  yawVel: 0,
};
const THRUST = 14;
const VTHRUST = 8;
const TURN = 1.4;
const DRAG = 0.55;

// ------------------------------------------------------------------- post ---
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(
  new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.5,
    0.6,
    0.8,
  ),
);
composer.addPass(
  new ShaderPass({
    uniforms: { tDiffuse: { value: null }, strength: { value: 0.5 } },
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
        float vig = smoothstep(1.0, 0.5, d);
        c.rgb *= mix(1.0 - strength, 1.0, vig);
        c.rgb = pow(max(c.rgb, 0.0), vec3(1.0 / 2.2));
        gl_FragColor = c;
      }
    `,
  }),
);

// ------------------------------------------------------------------- loop ---
const clock = new THREE.Clock();
const forward = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // --- steer ---
  let turn = 0;
  if (keys.has("KeyA")) turn += 1;
  if (keys.has("KeyD")) turn -= 1;
  sub.yawVel += turn * TURN * dt;
  sub.yawVel *= Math.exp(-2.2 * dt);
  sub.yaw += sub.yawVel * dt * 60 * 0.02;

  forward.set(Math.sin(sub.yaw), 0, Math.cos(sub.yaw));
  let thrust = 0;
  if (keys.has("KeyW")) thrust += 1;
  if (keys.has("KeyS")) thrust -= 0.5;
  sub.vel.addScaledVector(forward, thrust * THRUST * dt);
  if (keys.has("KeyR")) sub.vel.y += VTHRUST * dt;
  if (keys.has("KeyF")) sub.vel.y -= VTHRUST * dt;
  sub.vel.multiplyScalar(Math.exp(-DRAG * dt));
  sub.pos.addScaledVector(sub.vel, dt);
  sub.pos.y = Math.min(sub.pos.y, 8); // don't fly out of the sea
  sub.pos.y = Math.max(sub.pos.y, -24 + 3); // don't dig into the floor

  // --- pose the sub: heading, gentle roll into turns, pitch with climb ---
  subGroup.position.copy(sub.pos);
  subGroup.rotation.y = sub.yaw;
  subGroup.rotation.z = THREE.MathUtils.lerp(
    subGroup.rotation.z,
    -sub.yawVel * 0.5,
    1 - Math.exp(-4 * dt),
  );
  subGroup.rotation.x = THREE.MathUtils.lerp(
    subGroup.rotation.x,
    THREE.MathUtils.clamp(-sub.vel.y * 0.03, -0.2, 0.2),
    1 - Math.exp(-4 * dt),
  );
  // idle bob when nearly still
  subGroup.position.y += Math.sin(t * 0.8) * 0.08;

  // headlight aims where the nose points
  headlightTarget.position
    .copy(sub.pos)
    .addScaledVector(forward, 30);
  beamMat.uniforms.time.value = t;

  // --- camera: soft third-person follow with mouse orbit ---
  const camYaw = sub.yaw + orbitYaw;
  const camDir = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
  const desired = sub.pos
    .clone()
    .addScaledVector(camDir, -14)
    .add(new THREE.Vector3(0, 4.5 + orbitPitch * 10, 0));
  camera.position.lerp(desired, 1 - Math.exp(-3.5 * dt));
  camera.lookAt(sub.pos.x, sub.pos.y + 1.2, sub.pos.z);

  // --- motes wrap around the sub ---
  const p = moteGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < MOTES; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    // drift
    y += dt * 0.15;
    // wrap into the cube centered on the sub
    if (x - sub.pos.x > RANGE) x -= RANGE * 2;
    if (x - sub.pos.x < -RANGE) x += RANGE * 2;
    if (y - sub.pos.y > RANGE) y -= RANGE * 2;
    if (y - sub.pos.y < -RANGE) y += RANGE * 2;
    if (z - sub.pos.z > RANGE) z -= RANGE * 2;
    if (z - sub.pos.z < -RANGE) z += RANGE * 2;
    p.setXYZ(i, x, y, z);
  }
  p.needsUpdate = true;

  composer.render();
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
