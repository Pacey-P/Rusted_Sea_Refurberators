/**
 * Rusted Sea — 3D sub prototype ("the game as it began").
 *
 * Pilot a rusty submarine, built from primitives, through black water.
 * One bubble of visibility, silhouettes at the edge of the beam. A
 * two-joint IK claw hangs off the nose, reaching for things. A wrecked
 * Sea Major (the old prototype's .glb — fine for static dressing, since
 * nothing depends on its baked orientation) lies on the seafloor as the
 * salvage target.
 *
 * The hull is procedural rather than an imported model specifically so
 * forward/up and every mount point (headlight, claw shoulder, camera) are
 * numbers we chose, not numbers we reverse-engineered from someone else's
 * export — that's what made the .glb version fiddly to wire up correctly.
 *
 * W/S thrust, A/D turn, R/F depth, drag mouse to orbit, E reach-and-grab.
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
const params0 = new URLSearchParams(location.search);
scene.add(new THREE.HemisphereLight(0x1c3a44, 0x000000, params0.has("lit") ? 1.1 : 0.14));
if (params0.has("lit")) {
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(5, 8, 6);
  scene.add(key);
}

// the sub's headlight — the only real light in the world
const headlight = new THREE.SpotLight(0xcfe8ff, 260, 55, 0.36, 0.5, 1.5);
const headlightTarget = new THREE.Object3D();
scene.add(headlightTarget);
headlight.target = headlightTarget;

// faint warm running light on the sub itself so its own hull reads
const runningLight = new THREE.PointLight(0xffb066, 5, 10, 1.8);

// ------------------------------------------------------------- player sub ---
// Built by hand, nose at +Z, up at +Y, centered on the group origin — every
// number below is a coordinate we chose, so headlight/claw/camera mounts
// are exact instead of measured off a screenshot.
const HULL_LEN = 6.0; // cylindrical section length
const HULL_R = 1.05;
const NOSE_Z = HULL_LEN / 2 + HULL_R; // = 4.05, the true bow tip

const rust = new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.9, metalness: 0.35 });
const rustDark = new THREE.MeshStandardMaterial({ color: 0x2e241c, roughness: 0.95, metalness: 0.2 });
const brass = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.6, metalness: 0.6 });

const subGroup = new THREE.Group();
scene.add(subGroup);
subGroup.add(headlight, runningLight);
runningLight.position.set(0, 1.2, -1);

{
  // Hull as a lathe profile, not a capsule: a blunt nose, a ribbed
  // mid-section with slight radius steps (plating), and a tapered stern.
  // A plain capsule reads as a smooth sausage; the radius steps and rib
  // rings are what make the eye read "riveted machine."
  const profile: THREE.Vector2[] = [];
  profile.push(new THREE.Vector2(0.0, -HULL_LEN / 2 - HULL_R)); // stern point
  profile.push(new THREE.Vector2(HULL_R * 0.55, -HULL_LEN / 2 - HULL_R * 0.55));
  profile.push(new THREE.Vector2(HULL_R * 0.92, -HULL_LEN / 2 - HULL_R * 0.1));
  const ribs = 5;
  for (let i = 0; i <= ribs; i++) {
    const z = -HULL_LEN / 2 + (HULL_LEN * i) / ribs;
    const step = i % 2 === 0 ? 1.0 : 0.94; // alternating plating steps
    profile.push(new THREE.Vector2(HULL_R * step, z));
  }
  profile.push(new THREE.Vector2(HULL_R * 0.85, HULL_LEN / 2 + HULL_R * 0.18));
  profile.push(new THREE.Vector2(HULL_R * 0.62, HULL_LEN / 2 + HULL_R * 0.42));
  profile.push(new THREE.Vector2(HULL_R * 0.32, HULL_LEN / 2 + HULL_R * 0.68));
  profile.push(new THREE.Vector2(0.0, HULL_LEN / 2 + HULL_R * 0.88)); // bow point

  const hull = new THREE.Mesh(new THREE.LatheGeometry(profile, 24), rust);
  hull.rotation.x = -Math.PI / 2; // lathe axis is Y; bow (+Y end) -> +Z
  subGroup.add(hull);

  // a raised keel strip and a hatch disc, purely to break up the silhouette
  const keel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, HULL_LEN * 0.8), rustDark);
  keel.position.set(0, -HULL_R - 0.02, 0.2);
  subGroup.add(keel);
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 16), rustDark);
  hatch.rotation.x = Math.PI / 2;
  hatch.position.set(0, HULL_R * 0.98, -0.6);
  subGroup.add(hatch);

  // conning tower, set back from the bow like a real hull
  const tower = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 1.6), rustDark);
  tower.position.set(0, HULL_R + 0.45, -0.6);
  subGroup.add(tower);

  const periscope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 1.1, 8),
    brass,
  );
  periscope.position.set(0.2, HULL_R + 1.05, -0.9);
  subGroup.add(periscope);

  // tail fins (rudder + planes) so "which way is aft" is unambiguous at a
  // glance, and a propeller nub to sell it as a machine
  const finGeo = new THREE.BoxGeometry(0.08, 0.9, 0.7);
  const finTop = new THREE.Mesh(finGeo, rustDark);
  finTop.position.set(0, HULL_R * 0.55, -HULL_LEN / 2 - 0.2);
  subGroup.add(finTop);
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.6), rustDark);
    fin.position.set(side * HULL_R * 0.9, -HULL_R * 0.2, -HULL_LEN / 2 - 0.1);
    subGroup.add(fin);
  }
  const prop = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 8), brass);
  prop.rotation.x = -Math.PI / 2;
  prop.position.set(0, 0, -HULL_LEN / 2 - HULL_R - 0.15);
  subGroup.add(prop);

  // side ballast pods, riveted-industrial detail
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.22, 2.6, 4, 8),
      rustDark,
    );
    pod.rotation.x = Math.PI / 2;
    pod.position.set(side * (HULL_R + 0.25), -HULL_R * 0.5, -0.4);
    subGroup.add(pod);
  }
}

// headlight mounted at the nose, aimed ahead (targets updated per-frame)
headlight.position.set(0, 0.15, NOSE_Z - 0.3);

// ------------------------------------------------------------- claw arm ---
// Two-bone IK: a shoulder mounted under the bow reaches for a world-space
// target. yaw+pitch at the shoulder aim the plane of the arm; a single
// elbow bend (law of cosines) hits the target distance within that plane.
const SHOULDER_LOCAL = new THREE.Vector3(0, -HULL_R - 0.1, NOSE_Z - 1.4);
const UPPER_LEN = 1.5;
const FORE_LEN = 1.4;

const shoulder = new THREE.Group();
shoulder.position.copy(SHOULDER_LOCAL);
subGroup.add(shoulder);

const upperArm = new THREE.Group(); // pitches at the shoulder
shoulder.add(upperArm);
const upperMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(0.14, 0.11, UPPER_LEN, 8),
  rustDark,
);
upperMesh.rotation.x = Math.PI / 2;
upperMesh.position.z = UPPER_LEN / 2;
upperArm.add(upperMesh);

const elbow = new THREE.Group(); // pitches relative to the upper arm
elbow.position.z = UPPER_LEN;
upperArm.add(elbow);
const foreMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(0.1, 0.08, FORE_LEN, 8),
  rustDark,
);
foreMesh.rotation.x = Math.PI / 2;
foreMesh.position.z = FORE_LEN / 2;
elbow.add(foreMesh);

const clawHead = new THREE.Group();
clawHead.position.z = FORE_LEN;
elbow.add(clawHead);
const fingerGeo = new THREE.ConeGeometry(0.07, 0.55, 6);
const fingerL = new THREE.Mesh(fingerGeo, brass);
const fingerR = new THREE.Mesh(fingerGeo, brass);
for (const [f, side] of [[fingerL, -1], [fingerR, 1]] as const) {
  f.rotation.x = Math.PI / 2;
  f.position.set(side * 0.08, 0, 0.28);
  clawHead.add(f);
}

/** Solve a 2-bone yaw/pitch+elbow IK in `shoulder`'s local space, aiming at
 *  `targetLocal`. Rest pose (all angles 0) points the arm along local +Z. */
function solveArm(targetLocal: THREE.Vector3): void {
  const horiz = Math.hypot(targetLocal.x, targetLocal.z);
  const yaw = Math.atan2(targetLocal.x, targetLocal.z);
  const reach = THREE.MathUtils.clamp(
    Math.hypot(horiz, targetLocal.y),
    Math.abs(UPPER_LEN - FORE_LEN) + 0.05,
    UPPER_LEN + FORE_LEN - 0.05,
  );
  const elevation = Math.atan2(targetLocal.y, horiz);
  const shoulderOffset = Math.acos(
    THREE.MathUtils.clamp(
      (UPPER_LEN ** 2 + reach ** 2 - FORE_LEN ** 2) / (2 * UPPER_LEN * reach),
      -1,
      1,
    ),
  );
  const elbowInterior = Math.acos(
    THREE.MathUtils.clamp(
      (UPPER_LEN ** 2 + FORE_LEN ** 2 - reach ** 2) / (2 * UPPER_LEN * FORE_LEN),
      -1,
      1,
    ),
  );
  shoulder.rotation.y = yaw;
  upperArm.rotation.x = -(elevation + shoulderOffset);
  elbow.rotation.x = Math.PI - elbowInterior;
}
function setClaw(open: number): void {
  // 0 = closed, 1 = open
  fingerL.rotation.z = open * 0.5;
  fingerR.rotation.z = -open * 0.5;
}
setClaw(1);

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
beam.position.set(0, 0.15, NOSE_Z - 0.4 + 11);
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
lampGlow.position.set(0, 0.15, NOSE_Z + 0.35);
subGroup.add(lampGlow);
// and a small real light so the bow itself catches the lamp
const noseLight = new THREE.PointLight(0xd9edff, 7, 7, 1.8);
noseLight.position.set(0, 0.15, NOSE_Z - 0.65);
subGroup.add(noseLight);

// ------------------------------------------------------------- the wreck ---
// A second, unrelated hull (the old prototype's Sea Major .glb) dead on the
// seafloor as the salvage target — fine to use as-is here, since dressing
// doesn't depend on knowing its exact forward axis the way the player sub did.
const loader = new GLTFLoader();
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
const camDist = parseFloat(params.get("dist") ?? "14");
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
    .addScaledVector(camDir, -camDist)
    .add(new THREE.Vector3(0, camDist * 0.32 + orbitPitch * 10, 0));
  camera.position.lerp(desired, 1 - Math.exp(-3.5 * dt));
  camera.lookAt(sub.pos.x, sub.pos.y + 1.2, sub.pos.z);

  // --- claw: idle sweep, or reach-and-grab while E is held ---
  const grabbing = keys.has("KeyE");
  const clawTarget = grabbing
    ? new THREE.Vector3(0.25, -1.6, UPPER_LEN + FORE_LEN - 0.5) // reach out
    : new THREE.Vector3(
        Math.sin(t * 0.35) * 0.25,
        -0.85 + Math.sin(t * 0.5) * 0.15,
        0.5 + Math.sin(t * 0.4) * 0.2,
      ); // folded in close under the hull
  solveArm(clawTarget);
  setClaw(grabbing ? 0 : 1);

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
