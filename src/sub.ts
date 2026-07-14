/**
 * Rusted Sea — ROV BLACKFIN prototype.
 *
 * The user's reference design (matte stealth-black sub, FABRIK manipulator
 * arm, patrol drone sentinel, diegetic ROV HUD) merged with this project's
 * piloting physics and post stack. Reference targeted three r128; this port
 * runs on r170, so all light intensities are rescaled to physical units.
 *
 * Two control modes, toggled with TAB (keyboard) or Y (gamepad):
 *   PILOT       — W/S thrust, A/D turn, R/F depth. Pad: left stick fly,
 *                 triggers depth. The arm folds in.
 *   MANIPULATOR — the sub coasts; mouse (or left stick) guides the claw,
 *                 click / Space / pad A toggles grip.
 * Drag orbits the camera in both modes; wheel adjusts range.
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// ----------------------------------------------------------------- setup ---
const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const WATER = new THREE.Color("#03121c");
const scene = new THREE.Scene();
scene.background = new THREE.Color("#020a12");
scene.fog = new THREE.FogExp2(WATER, 0.072);

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  300,
);

// ---------------------------------------------------------------- lights ---
scene.add(new THREE.AmbientLight(0x0d2634, params.has("lit") ? 4 : 0.7));
if (params.has("lit")) {
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(5, 8, 6);
  scene.add(key);
}
const moon = new THREE.DirectionalLight(0x3f6f8a, 0.35); // faint surface glow
moon.position.set(4, 30, -6);
scene.add(moon);
const rim = new THREE.PointLight(0x1c4a5e, 14, 40, 1.8);
rim.position.set(-10, 4, -8);
scene.add(rim);

// ------------------------------------------------------------- materials ---
const hullMat = new THREE.MeshStandardMaterial({ color: 0x0b0d0f, roughness: 0.96, metalness: 0.12 });
const panelMat = new THREE.MeshStandardMaterial({ color: 0x121517, roughness: 0.9, metalness: 0.18 });
const trimMat = new THREE.MeshStandardMaterial({ color: 0x1a1e21, roughness: 0.85, metalness: 0.25 });

function addShadow<T extends THREE.Mesh>(m: T): T {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------ player sub ---
// The reference builds the Blackfin nose-toward-+X; our physics convention is
// nose +Z. hullGroup wears the -90° yaw so the reference geometry can be kept
// verbatim while subGroup's +Z stays "forward".
const subGroup = new THREE.Group();
scene.add(subGroup);
const hullGroup = new THREE.Group();
hullGroup.rotation.y = -Math.PI / 2; // reference +X -> our +Z
subGroup.add(hullGroup);

let propGroup: THREE.Group;
let navLight: THREE.Mesh;
{
  // main hull: capsule from cylinder + stretched sphere caps
  const bodyLen = 4.2;
  const R = 0.85;
  const body = addShadow(
    new THREE.Mesh(new THREE.CylinderGeometry(R, R, bodyLen, 28, 1, true), hullMat),
  );
  body.rotation.z = Math.PI / 2;
  hullGroup.add(body);
  const nose = addShadow(new THREE.Mesh(new THREE.SphereGeometry(R, 28, 20), hullMat));
  nose.position.x = bodyLen / 2;
  nose.scale.x = 1.5;
  hullGroup.add(nose);
  const tail = addShadow(new THREE.Mesh(new THREE.SphereGeometry(R, 28, 20), hullMat));
  tail.position.x = -bodyLen / 2;
  tail.scale.x = 1.9;
  hullGroup.add(tail);

  // sail / conning tower — elongated along the hull's long axis (+X here)
  const sail = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.44, 0.9, 18), panelMat));
  sail.scale.x = 2.1;
  sail.position.set(0.5, 1.05, 0);
  hullGroup.add(sail);
  const mast = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), trimMat));
  mast.position.set(0.6, 1.7, 0);
  hullGroup.add(mast);
  navLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x8a1610 }),
  );
  navLight.position.set(0.6, 1.98, 0);
  hullGroup.add(navLight);

  // dive planes + tail fins
  function fin(w: number, h: number, t: number): THREE.Mesh {
    return addShadow(new THREE.Mesh(new THREE.BoxGeometry(w, t, h), trimMat));
  }
  const fp = fin(0.8, 2.6, 0.08);
  fp.position.set(1.3, 0, 0);
  hullGroup.add(fp); // bow planes
  const tp = fin(0.9, 3.0, 0.09);
  tp.position.set(-2.4, 0, 0);
  hullGroup.add(tp); // stern planes
  const tv = addShadow(new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.4, 0.09), trimMat));
  tv.position.set(-2.4, 0, 0);
  hullGroup.add(tv); // rudder

  // shrouded thruster — the stretched tail cap reaches x≈-3.72, so the
  // whole assembly lives aft of that or it's swallowed by the hull
  const PROP_X = -3.95;
  const shaft = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.5, 8), trimMat));
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = -3.65; // bridges tail tip to the shroud
  hullGroup.add(shaft);
  const shroud = addShadow(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.09, 10, 24), trimMat));
  shroud.rotation.y = Math.PI / 2;
  shroud.position.x = PROP_X;
  hullGroup.add(shroud);
  propGroup = new THREE.Group();
  propGroup.position.x = PROP_X;
  // brighter steel so the spinning blades actually read in the dark
  const propMat = new THREE.MeshStandardMaterial({ color: 0x424a52, roughness: 0.5, metalness: 0.55 });
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.14), propMat);
    b.position.y = 0.22;
    const holder = new THREE.Group();
    holder.add(b);
    holder.rotation.x = (i * Math.PI) / 2;
    propGroup.add(holder);
  }
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), propMat);
  propGroup.add(hub);
  hullGroup.add(propGroup);
}

// floodlights + visible beams (r170: spot intensity is candela now).
// Beams are shader cones: brightness fades along the length AND at the
// grazing rim, with a slow shimmer — light scattering through water, not
// crisp geometry.
const beamMats: THREE.ShaderMaterial[] = [];
function makeBeamMaterial(): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
    uniforms: { time: { value: 0 } },
    vertexShader: /* glsl */ `
      varying float vAlong; // 0 at apex -> 1 at far end
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
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        float body = smoothstep(0.0, 0.7, facing);
        float fall = pow(1.0 - vAlong, 1.8);
        // drifting murk inside the beam — light through particulate
        float murk = 0.85 + 0.15 * sin(vAlong * 22.0 - time * 2.2)
                          * sin(vAlong * 9.0 - time * 1.1);
        float a = body * fall * murk * 0.10;
        // warm tungsten, not LED — a 60s bulb pushing through the murk
        gl_FragColor = vec4(vec3(0.95, 0.78, 0.52) * a, a);
      }
    `,
  });
  beamMats.push(mat);
  return mat;
}
function softDiscTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const discTex = softDiscTexture();

function floodlight(y: number, z: number): void {
  // The stretched nose cap reaches x≈3.38 — everything here must sit ON or
  // ahead of that surface (at this y/z the skin is at x≈3.05), or the
  // lights originate inside the hull and get clipped by it.
  const housing = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.2, 12), trimMat));
  housing.rotation.z = Math.PI / 2 - 0.35;
  housing.position.set(3.02, y, z);
  hullGroup.add(housing);
  const lamp = new THREE.SpotLight(0xffd9a0, 2800, 170, 0.48, 0.55, 1.4);
  lamp.position.set(3.14, y, z);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(512, 512);
  const tgt = new THREE.Object3D();
  tgt.position.set(9.4, y - 4.5, z * 2);
  hullGroup.add(tgt);
  lamp.target = tgt;
  hullGroup.add(lamp);

  // the hot bulb itself — a small emissive core the bloom can catch,
  // proud of the housing so it never intersects the nose skin
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.065, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xfff0d0 }),
  );
  bulb.position.set(3.18, y, z);
  hullGroup.add(bulb);

  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.7, 9, 24, 1, true), makeBeamMaterial());
  // apex at the lamp, opening forward-down along the beam direction
  const dir = new THREE.Vector3().subVectors(tgt.position, lamp.position).normalize();
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  cone.position.copy(lamp.position).addScaledVector(dir, 4.5);
  hullGroup.add(cone);

  // scattering halo at the lamp itself — the "glow around a light in murk"
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: discTex,
      color: 0xffd9a4,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  halo.scale.setScalar(1.2);
  (halo.material as THREE.SpriteMaterial).opacity = 0.55;
  halo.position.copy(lamp.position).addScaledVector(dir, 0.25);
  hullGroup.add(halo);
}
floodlight(0.35, 0.45);
floodlight(0.35, -0.45);

// warm hull self-lighting: a soft amber wash from above the sail plus a
// pair of dim red service lamps sitting flush on the hull skin, so the
// hull reads as a 3D machine instead of a silhouette. Red only — quiet.
{
  const hullWarm = new THREE.PointLight(0xffb066, 6, 9, 1.8);
  hullWarm.position.set(0.4, 1.9, 0);
  hullGroup.add(hullWarm);

  // hull radius is .85: y=.32,z=±.78 puts the lamp on the skin, not floating
  for (const z of [0.78, -0.78]) {
    const lampMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff3b2e }),
    );
    lampMesh.position.set(1.35, 0.32, z);
    hullGroup.add(lampMesh);
    const glow = new THREE.PointLight(0xff3b2e, 0.9, 2.0, 1.8);
    glow.position.copy(lampMesh.position);
    hullGroup.add(glow);
  }
}

// arm mount under the bow
const mount = new THREE.Object3D();
mount.position.set(1.9, -0.75, 0);
hullGroup.add(mount);
const shoulderBall = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 14), trimMat));
shoulderBall.position.copy(mount.position);
hullGroup.add(shoulderBall);

// --------------------------------------------------------------- seafloor ---
const floorY = -6.5;
// world-space terrain height (must mirror the displacement below; the plane
// is rotated -90° about X, so world z maps to plane -y)
function floorHeightAt(wx: number, wz: number): number {
  const x = wx;
  const y = -wz;
  return (
    floorY +
    Math.sin(x * 0.22) * Math.cos(y * 0.18) * 0.9 +
    Math.sin(x * 0.05 + y * 0.07) * 1.6 +
    Math.sin(x * 1.3) * Math.sin(y * 1.1) * 0.12
  );
}
{
  const g = new THREE.PlaneGeometry(300, 300, 160, 160);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(
      i,
      Math.sin(x * 0.22) * Math.cos(y * 0.18) * 0.9 +
        Math.sin(x * 0.05 + y * 0.07) * 1.6 +
        Math.sin(x * 1.3) * Math.sin(y * 1.1) * 0.12,
    );
  }
  g.computeVertexNormals();
  const floor = new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({ color: 0x0a1a22, roughness: 1, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY;
  floor.receiveShadow = true;
  scene.add(floor);
}
// caustics: an additive overlay just above the sand — interfering wave
// patterns crawling slowly, faded by distance so the fog stays in charge
const causticsMat = new THREE.ShaderMaterial({
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  uniforms: {
    time: { value: 0 },
    camPos: { value: new THREE.Vector3() },
  },
  vertexShader: /* glsl */ `
    varying vec3 vWorld;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vWorld;
    uniform float time;
    uniform vec3 camPos;
    void main() {
      vec2 p = vWorld.xz;
      float t = time;
      float c1 = sin(p.x * 0.85 + t * 0.55) * sin(p.y * 1.05 - t * 0.47);
      float c2 = sin((p.x + p.y) * 0.6 + t * 0.7) * sin((p.x - p.y) * 0.52 - t * 0.33);
      float c3 = sin(p.x * 1.7 - t * 0.9) * sin(p.y * 1.5 + t * 0.6);
      float ca = pow(abs(c1 * 0.5 + c2 * 0.35 + c3 * 0.15), 3.0);
      float fade = exp(-distance(camPos, vWorld) * 0.055);
      float a = ca * fade * 0.22;
      gl_FragColor = vec4(vec3(0.35, 0.75, 0.72) * a, a);
    }
  `,
});
{
  const overlay = new THREE.Mesh(new THREE.PlaneGeometry(300, 300, 1, 1), causticsMat);
  overlay.rotation.x = -Math.PI / 2;
  overlay.position.y = floorY + 1.9; // rides just above the dune crests
  scene.add(overlay);
}

// rocks
{
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x0c1d26, roughness: 1 });
  for (let i = 0; i < 26; i++) {
    const r = addShadow(
      new THREE.Mesh(new THREE.DodecahedronGeometry(0.4 + Math.random() * 1.6, 0), rockMat),
    );
    const a = Math.random() * Math.PI * 2;
    const d = 6 + Math.random() * 45;
    r.position.set(Math.cos(a) * d, floorY + 0.3 + Math.random() * 0.4, Math.sin(a) * d);
    r.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    r.scale.y = 0.5 + Math.random() * 0.5;
    scene.add(r);
  }
}

// salvage crate with beacon
const crate = new THREE.Group();
let beacon: THREE.Mesh;
let beaconLight: THREE.PointLight;
{
  const box = addShadow(
    new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.9, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x223226, roughness: 0.9, metalness: 0.2 }),
    ),
  );
  crate.add(box);
  beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xe0a458 }),
  );
  beacon.position.set(0.5, 0.52, 0.3);
  crate.add(beacon);
  beaconLight = new THREE.PointLight(0xe0a458, 0, 5, 1.8);
  beaconLight.position.copy(beacon.position);
  crate.add(beaconLight);
  crate.position.set(2.6, floorY + 1.15, 2.2);
  crate.rotation.y = 0.5;
  scene.add(crate);
}

// ------------------------------------------------------------- grab state ---
const GRAB_RANGE = 1.2; // forgiving: claw within this of the crate can grip it
let carried: THREE.Group | null = null;
let crateFalling = false;
let crateVelY = 0;
const crateWorld = new THREE.Vector3();

function clawInGrabRange(): boolean {
  if (carried) return false;
  crate.getWorldPosition(crateWorld);
  return claw.position.distanceTo(crateWorld) < GRAB_RANGE;
}

// distant wreck silhouette (Sea Major glb, half-buried set dressing)
new GLTFLoader().load("assets/models/sea_major.glb", (gltf) => {
  const wreck = gltf.scene;
  const box = new THREE.Box3().setFromObject(wreck);
  const size = box.getSize(new THREE.Vector3());
  if (size.x > size.z) wreck.rotation.y = Math.PI / 2;
  wreck.scale.setScalar(26 / Math.max(size.x, size.z));
  wreck.position.set(26, floorY - 1.5, 42);
  wreck.rotation.z = 0.34;
  wreck.rotation.y = 2.3;
  scene.add(wreck);
});

// -------------------------------------- enemy patrol drone (60s sentinel) ---
const drone = new THREE.Group();
scene.add(drone);
const droneHullMat = new THREE.MeshStandardMaterial({ color: 0x2b2f27, roughness: 0.72, metalness: 0.5 });
const droneDarkMat = new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.55, metalness: 0.6 });
let droneChassis: THREE.Group;
let droneHead: THREE.Group;
let droneEye: THREE.Mesh;
let droneEyeLight: THREE.PointLight;
let scanCone: THREE.Mesh;
let scanLight: THREE.SpotLight;
let antTip: THREE.Mesh;
const tentacles: { arm: THREE.Group; elbow: THREE.Group; s: number }[] = [];
{
  droneChassis = new THREE.Group();
  drone.add(droneChassis);
  const body = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 16), droneHullMat));
  body.scale.y = 1.12;
  droneChassis.add(body);
  for (const [y, r] of [
    [0, 0.565],
    [0.3, 0.47],
    [-0.3, 0.47],
  ] as const) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.022, 8, 30), droneDarkMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    droneChassis.add(ring);
  }
  for (let i = 0; i < 14; i++) {
    const stud = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 6), droneDarkMat);
    const a = (i / 14) * Math.PI * 2;
    stud.position.set(Math.cos(a) * 0.575, 0.15, Math.sin(a) * 0.575);
    droneChassis.add(stud);
  }
  for (const s of [-1, 1]) {
    const pod = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.42, 10), droneDarkMat));
    pod.rotation.x = Math.PI / 2;
    pod.position.set(s * 0.62, 0, -0.05);
    droneChassis.add(pod);
  }
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.7, 6), droneDarkMat);
  ant.position.y = 0.95;
  droneChassis.add(ant);
  antTip = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2418 }),
  );
  antTip.position.y = 1.32;
  droneChassis.add(antTip);

  droneHead = new THREE.Group();
  droneHead.position.y = 0.12;
  droneChassis.add(droneHead);
  const socket = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.26, 14), droneDarkMat));
  socket.rotation.x = Math.PI / 2;
  socket.position.z = 0.5;
  droneHead.add(socket);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.025, 8, 20), droneHullMat);
  bezel.position.z = 0.63;
  droneHead.add(bezel);
  droneEye = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 14, 14),
    new THREE.MeshBasicMaterial({ color: 0xff2418 }),
  );
  droneEye.position.z = 0.64;
  droneHead.add(droneEye);
  droneEyeLight = new THREE.PointLight(0xff2418, 10, 7, 1.8);
  droneEyeLight.position.z = 0.72;
  droneHead.add(droneEyeLight);
  scanCone = new THREE.Mesh(
    new THREE.ConeGeometry(1.5, 8, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xff3020,
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  scanCone.rotation.x = -Math.PI / 2;
  scanCone.position.z = 4.6;
  droneHead.add(scanCone);
  scanLight = new THREE.SpotLight(0xff2418, 60, 22, 0.32, 0.6, 1.6);
  scanLight.position.z = 0.6;
  const scanTgt = new THREE.Object3D();
  scanTgt.position.z = 9;
  droneHead.add(scanTgt);
  scanLight.target = scanTgt;
  droneHead.add(scanLight);

  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.3, -0.55, 0);
    const seg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.024, 0.5, 6), droneDarkMat);
    seg1.position.y = -0.25;
    arm.add(seg1);
    const elbow = new THREE.Group();
    elbow.position.y = -0.5;
    arm.add(elbow);
    const seg2 = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.012, 0.4, 6), droneDarkMat);
    seg2.position.y = -0.2;
    elbow.add(seg2);
    droneChassis.add(arm);
    tentacles.push({ arm, elbow, s });
  }
  drone.position.set(crate.position.x + 4.6, floorY + 3.3, crate.position.z);
}

// -------------------------------------------------------- IK arm (FABRIK) ---
const LENGTHS = [1.35, 1.15, 0.85];
const N = LENGTHS.length;
const TOTAL = LENGTHS.reduce((a, b) => a + b, 0);
const joints: THREE.Vector3[] = [];
for (let i = 0; i <= N; i++) joints.push(new THREE.Vector3(0, -i, 0));

const armMat = new THREE.MeshStandardMaterial({ color: 0x101315, roughness: 0.9, metalness: 0.2 });
const jointMat = new THREE.MeshStandardMaterial({ color: 0x1c2124, roughness: 0.8, metalness: 0.3 });
const segMeshes: THREE.Mesh[] = [];
const jointMeshes: THREE.Mesh[] = [];
for (let i = 0; i < N; i++) {
  const r = 0.1 - i * 0.02;
  const geo = new THREE.CylinderGeometry(r * 0.8, r, LENGTHS[i], 12);
  geo.rotateX(Math.PI / 2); // axis along +Z so lookAt works
  const m = addShadow(new THREE.Mesh(geo, armMat));
  segMeshes.push(m);
  scene.add(m);
}
for (let i = 0; i <= N; i++) {
  const j = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.11 - i * 0.015, 12, 12), jointMat));
  jointMeshes.push(j);
  scene.add(j);
}
// hydraulic-look thin rods
const rodMat = new THREE.MeshStandardMaterial({ color: 0x23292d, roughness: 0.6, metalness: 0.5 });
const rods: THREE.Mesh[] = [];
for (let i = 0; i < N; i++) {
  const g = new THREE.CylinderGeometry(0.02, 0.02, 1, 6);
  g.rotateX(Math.PI / 2);
  const rod = new THREE.Mesh(g, rodMat);
  scene.add(rod);
  rods.push(rod);
}

// claw: three fingers
const claw = new THREE.Group();
scene.add(claw);
const wrist = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.16, 10), jointMat));
wrist.rotation.x = Math.PI / 2;
claw.add(wrist);
const fingers: THREE.Mesh[] = [];
for (let i = 0; i < 3; i++) {
  const pivot = new THREE.Group();
  pivot.rotation.z = i * ((Math.PI * 2) / 3);
  const f1 = addShadow(new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.06, 0.3), armMat));
  f1.position.set(0, 0.1, 0.2);
  f1.rotation.x = -0.5;
  const tip = addShadow(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.2), trimMat));
  tip.position.set(0, 0.02, 0.14);
  tip.rotation.x = 0.8;
  f1.add(tip);
  pivot.add(f1);
  claw.add(pivot);
  fingers.push(f1);
}
let clawClosed = false;
let clawT = 0;

// claw work light: a small warm lamp on the wrist, lighting whatever the
// claw is reaching for — plus the claw cam that feeds the PiP viewport
const clawLamp = new THREE.SpotLight(0xffe2b8, 90, 10, 0.62, 0.6, 1.6);
clawLamp.position.set(0, 0.1, 0.05);
const clawLampTarget = new THREE.Object3D();
clawLampTarget.position.set(0, 0, 3);
claw.add(clawLampTarget);
clawLamp.target = clawLampTarget;
claw.add(clawLamp);
const clawBulb = new THREE.Mesh(
  new THREE.SphereGeometry(0.018, 8, 8),
  new THREE.MeshBasicMaterial({ color: 0xffedd0 }),
);
clawBulb.position.set(0, -0.09, 0.06); // under the wrist, out of the cam's eye
claw.add(clawBulb);
clawLamp.position.set(0, -0.09, 0.05);

// Manip cam: hull-mounted on the bow above the arm's shoulder, angled
// down-and-forward so the feed shows the WHOLE arm working — shoulder,
// elbow, claw, and the seafloor beyond. (Riding on the claw itself was
// too tight to be useful.) Local orientation solved in hull space.
const clawCam = new THREE.PerspectiveCamera(68, 300 / 170, 0.05, 60);
{
  const eye = new THREE.Vector3(3.15, -0.55, 0); // proud of the bow chin skin
  const at = new THREE.Vector3(4.1, -2.5, 0); // typical claw workspace
  clawCam.position.copy(eye);
  const m = new THREE.Matrix4().lookAt(eye, at, new THREE.Vector3(0, 1, 0));
  clawCam.quaternion.setFromRotationMatrix(m);
  hullGroup.add(clawCam);
}

// target reticle
const reticle = new THREE.Group();
{
  const m = new THREE.MeshBasicMaterial({
    color: 0x8fd6c8,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
  });
  reticle.add(new THREE.Mesh(new THREE.RingGeometry(0.14, 0.17, 32), m));
  reticle.add(new THREE.Mesh(new THREE.CircleGeometry(0.02, 10), m.clone()));
  scene.add(reticle);
}
const armTarget = new THREE.Vector3(2.2, -1.4, 1.2);
const smoothedTarget = armTarget.clone();

function solveIK(base: THREE.Vector3): void {
  const t = smoothedTarget.clone();
  const d = t.distanceTo(base);
  if (d > TOTAL * 0.995) {
    t.copy(base).addScaledVector(t.sub(base).normalize(), TOTAL * 0.995);
  }
  for (let it = 0; it < 10; it++) {
    joints[N].copy(t);
    for (let i = N - 1; i >= 0; i--) {
      const dir = joints[i].clone().sub(joints[i + 1]).normalize();
      joints[i].copy(joints[i + 1]).addScaledVector(dir, LENGTHS[i]);
    }
    joints[0].copy(base);
    for (let i = 1; i <= N; i++) {
      const dir = joints[i].clone().sub(joints[i - 1]).normalize();
      joints[i].copy(joints[i - 1]).addScaledVector(dir, LENGTHS[i - 1]);
    }
    if (joints[N].distanceTo(t) < 0.002) break;
  }
}

// ------------------------------------------------------------ marine snow ---
const MOTES = 1600;
const RANGE = 34;
const motePos = new Float32Array(MOTES * 3);
for (let i = 0; i < MOTES * 3; i++) motePos[i] = THREE.MathUtils.randFloatSpread(RANGE * 2);
const moteGeo = new THREE.BufferGeometry();
moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
const motes = new THREE.Points(
  moteGeo,
  new THREE.PointsMaterial({
    color: 0x7fa8b0,
    size: 0.05,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }),
);
scene.add(motes);

// thruster bubbles
const bubbles: THREE.Mesh[] = [];
{
  const bMat = new THREE.MeshBasicMaterial({ color: 0x9fd8cf, transparent: true, opacity: 0.25 });
  for (let i = 0; i < 24; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.03 + Math.random() * 0.04, 6, 6), bMat.clone());
    b.userData = { life: Math.random() };
    scene.add(b);
    bubbles.push(b);
  }
}

// ------------------------------------------------------------------ input ---
type Mode = "PILOT" | "MANIPULATOR";
let mode: Mode = "PILOT";

const keys = new Set<string>();
let tabDownAt = 0;
window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code === "Tab") {
    e.preventDefault();
    if (!e.repeat) tabDownAt = performance.now();
  }
  if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) toggleClaw();
  }
});
window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
  if (e.code === "Tab") {
    // short press: switch mode (arm holds its pose). Long press: stow arm.
    if (performance.now() - tabDownAt >= 500) stowArm();
    else toggleMode();
  }
});

let orbitYaw = parseFloat(params.get("yaw") ?? "0");
let orbitPitch = parseFloat(params.get("pitch") ?? "0.12");
let camDist = parseFloat(params.get("dist") ?? "12");
let dragging = false;
let dragMoved = 0;
const mouse = new THREE.Vector2(0, 0);
const raycaster = new THREE.Raycaster();
const targetPlane = new THREE.Plane();

let pointerDownAt = 0;
renderer.domElement.addEventListener("pointerdown", () => {
  dragging = true;
  dragMoved = 0;
  pointerDownAt = performance.now();
});
window.addEventListener("pointerup", () => {
  // left click = grip toggle, in either mode. Generous discrimination:
  // a short press counts as a click even with a little hand jitter —
  // only a real drag (moved far AND held long) is treated as camera orbit.
  const quick = performance.now() - pointerDownAt < 220;
  if (dragging && (dragMoved < 12 || quick)) toggleClaw();
  dragging = false;
});
let mouseDirty = false; // only steer the arm when the mouse actually moved
window.addEventListener("pointermove", (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  mouseDirty = true;
  if (dragging) {
    dragMoved += Math.abs(e.movementX) + Math.abs(e.movementY);
    orbitYaw -= e.movementX * 0.004;
    orbitPitch = THREE.MathUtils.clamp(orbitPitch + e.movementY * 0.003, -0.5, 0.9);
  }
});
window.addEventListener(
  "wheel",
  (e) => {
    camDist = THREE.MathUtils.clamp(camDist + e.deltaY * 0.01, 5, 28);
  },
  { passive: true },
);

// --- gamepad: standard mapping. Y toggles mode, A grips, sticks fly/guide ---
const DEADZONE = 0.16;
const prevButtons: boolean[] = [];
function dz(v: number): number {
  return Math.abs(v) < DEADZONE ? 0 : v;
}
type PadState = {
  lx: number; ly: number; rx: number; ry: number;
  lt: number; rt: number;
  pressed: (i: number) => boolean; // edge-triggered
  held: (i: number) => boolean; // level-triggered (d-pad etc.)
};
function readPad(): PadState | null {
  const gp = navigator.getGamepads?.()?.[0];
  if (!gp) return null;
  const edges: boolean[] = gp.buttons.map((b, i) => b.pressed && !prevButtons[i]);
  const down: boolean[] = gp.buttons.map((b) => b.pressed);
  gp.buttons.forEach((b, i) => (prevButtons[i] = b.pressed));
  return {
    lx: dz(gp.axes[0] ?? 0),
    ly: dz(gp.axes[1] ?? 0),
    rx: dz(gp.axes[2] ?? 0),
    ry: dz(gp.axes[3] ?? 0),
    lt: gp.buttons[6]?.value ?? 0,
    rt: gp.buttons[7]?.value ?? 0,
    pressed: (i) => edges[i] ?? false,
    held: (i) => down[i] ?? false,
  };
}
// standard mapping d-pad indices
const DPAD_UP = 12;
const DPAD_DOWN = 13;

// ------------------------------------------------------------------- HUD ---
const modeEl = document.getElementById("mode")!;
const clawHud = document.getElementById("clawState")!;
const depthEl = document.getElementById("depth")!;
const headEl = document.getElementById("heading")!;
const contactEl = document.getElementById("contact")!;
const hintPilot = document.getElementById("hintPilot")!;
const hintManip = document.getElementById("hintManip")!;

// The arm holds its pose across mode switches (stored sub-relative so it
// rides along while you fly). Only an explicit long-press stow retracts it.
let armStowed = true; // starts folded
const heldLocal = new THREE.Vector3();

function setMode(m: Mode): void {
  mode = m;
  modeEl.textContent = mode;
  hintPilot.style.display = mode === "PILOT" ? "" : "none";
  hintManip.style.display = mode === "MANIPULATOR" ? "" : "none";
}
function toggleMode(): void {
  if (mode === "MANIPULATOR") {
    // freeze the pose relative to the sub — it rides along in PILOT
    subGroup.updateMatrixWorld();
    heldLocal.copy(subGroup.worldToLocal(armTarget.clone()));
    setMode("PILOT");
  } else {
    if (armStowed) {
      // waking from stow: start at a natural work position at the bow
      forward.set(Math.sin(sub.yaw), 0, Math.cos(sub.yaw));
      armTarget
        .copy(sub.pos)
        .addScaledVector(forward, 2.4)
        .add(new THREE.Vector3(0, -1.6, 0));
      armStowed = false;
    } else {
      // resume exactly where the arm was left, in sub space
      subGroup.updateMatrixWorld();
      armTarget.copy(subGroup.localToWorld(heldLocal.clone()));
    }
    mouseDirty = false;
    setMode("MANIPULATOR");
  }
}
function stowArm(): void {
  armStowed = true;
  if (mode === "MANIPULATOR") setMode("PILOT");
  flashClawHud("ARM STOWED");
}

let clawFlashUntil = 0;
function flashClawHud(msg: string): void {
  clawHud.textContent = msg;
  clawFlashUntil = performance.now() + 1200;
}
function clawText(): string {
  if (carried) return "CLAW CLOSED · PAYLOAD";
  return clawClosed ? "CLAW CLOSED" : "CLAW OPEN";
}
function toggleClaw(): void {
  clawClosed = !clawClosed;
  if (clawClosed && clawInGrabRange()) {
    // grip: the crate becomes part of the claw, world pose preserved
    claw.attach(crate);
    carried = crate;
    crateFalling = false;
    flashClawHud("PAYLOAD SECURED");
  } else if (!clawClosed && carried) {
    // release: back into the world, then gravity takes it
    scene.attach(carried);
    carried = null;
    crateFalling = true;
    crateVelY = 0;
    flashClawHud("PAYLOAD RELEASED");
  } else {
    clawFlashUntil = 0;
    clawHud.textContent = clawText();
  }
  clawHud.classList.toggle("closed", clawClosed);
}

// ---------------------------------------------------------------- physics ---
const sub = {
  pos: new THREE.Vector3(-1.2, 0.4, 0),
  vel: new THREE.Vector3(),
  yaw: 0,
  yawVel: 0,
};
const THRUST = 14;
const VTHRUST = 8;
const TURN = 1.4;
const DRAG = 0.55;
let throttle = 0; // |thrust input|, drives prop spin + wake turbulence
let propSpin = 0;
let padYWas = false; // gamepad Y long-press tracking
let padYTime = 0;

// ------------------------------------------------------------------- post ---
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(
  new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.45, 0.6, 0.8),
);
const underwaterPass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    strength: { value: 0.5 },
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
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform float time;
    void main() {
      // gentle refraction wobble — we are looking THROUGH water
      vec2 uv = vUv + vec2(
        sin(vUv.y * 34.0 + time * 1.15),
        cos(vUv.x * 30.0 + time * 0.95)
      ) * 0.0013;
      vec4 c = texture2D(tDiffuse, uv);
      // water column grade: absorb red; contrast curve keeps the darks DARK
      // (a flat blue lift here was washing the whole frame out)
      float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(c.rgb, c.rgb * vec3(0.82, 1.0, 1.04), 0.4);
      c.rgb += vec3(0.001, 0.004, 0.006) * (1.0 - lum);
      c.rgb = pow(max(c.rgb, 0.0), vec3(1.22)) * 1.16;
      // vignette
      float d = length((vUv - 0.5) * vec2(1.25, 1.0));
      float vig = smoothstep(1.0, 0.5, d);
      c.rgb *= mix(1.0 - strength, 1.0, vig);
      c.rgb = pow(max(c.rgb, 0.0), vec3(1.0 / 2.2));
      gl_FragColor = c;
    }
  `,
});
composer.addPass(underwaterPass);

// ------------------------------------------------------------------- loop ---
const clock = new THREE.Clock();
const forward = new THREE.Vector3();
const baseWorld = new THREE.Vector3();
const camWorldDir = new THREE.Vector3();
const camRight = new THREE.Vector3();
const camUp = new THREE.Vector3();
const lookTmp = new THREE.Vector3();

function animate(): void {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta() || 0.016, 0.05);
  const t = clock.elapsedTime;

  const pad = readPad();
  if (pad) {
    // Y: short press toggles mode, long press (>=0.5s) stows the arm
    const yNow = pad.held(3);
    if (yNow) padYTime += dt;
    else if (padYWas) {
      if (padYTime >= 0.5) stowArm();
      else toggleMode();
      padYTime = 0;
    } else padYTime = 0;
    padYWas = yNow;
    if (pad.pressed(0)) toggleClaw(); // A — grip, in either mode
    orbitYaw -= pad.rx * 2.2 * dt;
    orbitPitch = THREE.MathUtils.clamp(orbitPitch + pad.ry * 1.5 * dt, -0.5, 0.9);
  }

  // --- steer (PILOT mode only; MANIPULATOR coasts on drag) ---
  let turn = 0;
  let thrust = 0;
  let vert = 0;
  if (mode === "PILOT") {
    if (keys.has("KeyA")) turn += 1;
    if (keys.has("KeyD")) turn -= 1;
    if (keys.has("KeyW")) thrust += 1;
    if (keys.has("KeyS")) thrust -= 0.5;
    if (keys.has("KeyR")) vert += 1;
    if (keys.has("KeyF")) vert -= 1;
    if (pad) {
      turn -= pad.lx;
      thrust -= pad.ly; // stick forward = negative axis
      vert += pad.rt - pad.lt;
    }
  }
  throttle = THREE.MathUtils.lerp(throttle, Math.min(1, Math.abs(thrust)), 1 - Math.exp(-5 * dt));
  // a secured payload makes the boat heavy: sluggish thrust, lazy turns
  const heavy = carried ? 0.6 : 1;
  sub.yawVel += turn * TURN * heavy * dt;
  sub.yawVel *= Math.exp(-2.2 * dt);
  sub.yaw += sub.yawVel * dt * 60 * 0.02;

  forward.set(Math.sin(sub.yaw), 0, Math.cos(sub.yaw));
  sub.vel.addScaledVector(forward, thrust * THRUST * heavy * dt);
  sub.vel.y += vert * VTHRUST * (carried ? 0.7 : 1) * dt;
  if (carried) sub.vel.y -= 0.5 * dt; // the payload wants the bottom
  sub.vel.multiplyScalar(Math.exp(-DRAG * dt));
  sub.pos.addScaledVector(sub.vel, dt);
  sub.pos.y = Math.min(sub.pos.y, 8);
  sub.pos.y = Math.max(sub.pos.y, floorY + 2.2);

  // --- pose the sub ---
  subGroup.position.copy(sub.pos);
  subGroup.position.y += Math.sin(t * 0.6) * 0.1; // idle bob
  subGroup.rotation.y = sub.yaw;
  subGroup.rotation.z = THREE.MathUtils.lerp(
    subGroup.rotation.z,
    -sub.yawVel * 0.5 + Math.sin(t * 0.4) * 0.02,
    1 - Math.exp(-4 * dt),
  );
  subGroup.rotation.x = THREE.MathUtils.lerp(
    subGroup.rotation.x,
    THREE.MathUtils.clamp(-sub.vel.y * 0.03, -0.2, 0.2) + Math.sin(t * 0.53 + 1) * 0.012,
    1 - Math.exp(-4 * dt),
  );
  propSpin += dt * (1.5 + throttle * 22 + sub.vel.length() * 1.5);
  propGroup.rotation.x = propSpin;
  (navLight.material as THREE.MeshBasicMaterial).color.setHex(
    t % 1.4 < 0.15 ? 0xff5040 : 0x3a1210, // anticollision beacon, dim red
  );

  // --- beacon: red blink normally; GREEN when the claw is in grab range;
  // steady soft green while carried ---
  const inRange = clawInGrabRange();
  if (carried) {
    (beacon.material as THREE.MeshBasicMaterial).color.setHex(0x1f8a4a);
    beaconLight.color.setHex(0x35ff70);
    beaconLight.intensity = 2.5;
  } else if (inRange) {
    const gblink = t % 0.35 < 0.2; // eager fast green: "you can take it"
    (beacon.material as THREE.MeshBasicMaterial).color.setHex(gblink ? 0x4dff85 : 0x134a26);
    beaconLight.color.setHex(0x35ff70);
    beaconLight.intensity = gblink ? 12 : 2;
  } else {
    const blink = t % 1.1 < 0.12;
    (beacon.material as THREE.MeshBasicMaterial).color.setHex(blink ? 0xff5040 : 0x4a1712);
    beaconLight.color.setHex(0xff4030);
    beaconLight.intensity = blink ? 10 : 0;
  }

  // --- dropped crate sinks and settles into the sand ---
  if (crateFalling) {
    crateVelY = Math.max(crateVelY - 4.5 * dt, -2.4);
    crate.position.y += crateVelY * dt;
    crate.rotation.y += 0.25 * dt;
    crate.rotation.z += 0.12 * dt;
    const rest = floorHeightAt(crate.position.x, crate.position.z) + 0.45;
    if (crate.position.y <= rest) {
      crate.position.y = rest;
      crate.rotation.z = 0;
      crateFalling = false;
      crateVelY = 0;
    }
  }

  // --- patrol drone: uneven searching orbit around the crate ---
  const orbR = 4.6;
  const dAng = t * 0.26 + Math.sin(t * 0.11) * 1.4;
  drone.position.set(
    crate.position.x + Math.cos(dAng) * orbR,
    floorY + 3.3 + Math.sin(t * 0.5) * 0.35,
    crate.position.z + Math.sin(dAng) * orbR * 0.72,
  );
  lookTmp.set(
    crate.position.x + Math.cos(dAng + 0.14) * orbR,
    drone.position.y,
    crate.position.z + Math.sin(dAng + 0.14) * orbR * 0.72,
  );
  drone.lookAt(lookTmp);
  droneChassis.rotation.z = Math.sin(t * 0.35) * 0.06;
  droneHead.rotation.y = Math.sin(t * 0.8) * 0.9;
  droneHead.rotation.x = 0.5 + Math.sin(t * 0.47) * 0.18;

  const range = drone.position.distanceTo(sub.pos);
  const alert = range < 7.5;
  const pulse = alert ? 0.8 + Math.abs(Math.sin(t * 10)) * 0.9 : 0.8 + Math.sin(t * 2.2) * 0.3;
  droneEyeLight.intensity = pulse * 12;
  (droneEye.material as THREE.MeshBasicMaterial).color.setHex(alert ? 0xff5a3c : 0xff2418);
  (scanCone.material as THREE.MeshBasicMaterial).opacity =
    0.045 + (alert ? 0.03 : 0) + Math.sin(t * 9) * 0.006;
  scanLight.intensity = pulse * 60;
  (antTip.material as THREE.MeshBasicMaterial).color.setHex(t % 1.0 < 0.1 ? 0xff8a70 : 0x521410);
  for (const tn of tentacles) {
    tn.arm.rotation.x = Math.sin(t * 1.1 + tn.s) * 0.14;
    tn.arm.rotation.z = tn.s * 0.12 + Math.sin(t * 0.8 + tn.s * 2) * 0.1;
    tn.elbow.rotation.x = Math.sin(t * 1.4 + tn.s) * 0.22;
  }
  contactEl.textContent = alert ? "PATROL DRONE" : range < 14 ? "SIGNAL FAINT" : "NONE";
  contactEl.classList.toggle("alert", alert);

  // --- camera: soft third-person follow with orbit ---
  const camYaw = sub.yaw + orbitYaw;
  const camDirV = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
  const desired = sub.pos
    .clone()
    .addScaledVector(camDirV, -camDist)
    .add(new THREE.Vector3(0, camDist * 0.32 + orbitPitch * 10, 0));
  camera.position.lerp(desired, 1 - Math.exp(-3.5 * dt));
  camera.lookAt(sub.pos.x, sub.pos.y + 0.6, sub.pos.z);

  // --- arm target ---
  if (mode === "MANIPULATOR") {
    // Mouse steers only when it moves — otherwise the per-frame raycast
    // would clobber gamepad input, which is what made the pad unusable.
    if (mouseDirty) {
      mouseDirty = false;
      camera.getWorldDirection(camWorldDir);
      targetPlane.setFromNormalAndCoplanarPoint(
        camWorldDir,
        sub.pos.clone().addScaledVector(forward, 2.2).add(new THREE.Vector3(0, -1, 0)),
      );
      raycaster.setFromCamera(mouse, camera);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(targetPlane, hit)) {
        hit.y = Math.max(hit.y, floorY + 0.55);
        armTarget.copy(hit);
      }
    }
    // Gamepad: sub-relative "work table" — left stick slides the target
    // laterally/fore-aft in the horizontal plane; d-pad up/down (or the
    // triggers) raise and lower it. Lateral sign flipped per playtest.
    if (pad) {
      const rightVec = new THREE.Vector3(Math.cos(sub.yaw), 0, -Math.sin(sub.yaw));
      armTarget.addScaledVector(rightVec, -pad.lx * 3.4 * dt);
      armTarget.addScaledVector(forward, -pad.ly * 3.4 * dt);
      const lift =
        (pad.held(DPAD_UP) ? 1 : 0) - (pad.held(DPAD_DOWN) ? 1 : 0) + (pad.rt - pad.lt);
      armTarget.y += lift * 2.6 * dt;
    }
    // keep the target sane: reachable-ish sphere around the shoulder, above sand
    mount.getWorldPosition(baseWorld);
    const off = armTarget.clone().sub(baseWorld);
    if (off.length() > TOTAL * 1.15) {
      armTarget.copy(baseWorld).addScaledVector(off.normalize(), TOTAL * 1.15);
    }
    armTarget.y = Math.max(armTarget.y, floorY + 0.55);
  } else if (armStowed) {
    // PILOT, stowed: arm folds in under the bow
    mount.getWorldPosition(baseWorld);
    armTarget
      .copy(baseWorld)
      .addScaledVector(forward, 0.7)
      .add(new THREE.Vector3(0, -0.55 + Math.sin(t * 0.5) * 0.06, 0));
  } else {
    // PILOT, pose held: the arm rides along with the sub, exactly where
    // the operator left it
    subGroup.updateMatrixWorld();
    armTarget.copy(subGroup.localToWorld(heldLocal.clone()));
  }
  smoothedTarget.lerp(armTarget, 1 - Math.exp(-8 * dt));

  mount.getWorldPosition(baseWorld);
  solveIK(baseWorld);

  // place arm meshes
  for (let i = 0; i < N; i++) {
    segMeshes[i].position.copy(joints[i]).lerp(joints[i + 1], 0.5);
    segMeshes[i].lookAt(joints[i + 1]);
    const mid = segMeshes[i].position;
    rods[i].position.set(mid.x, mid.y + 0.09, mid.z);
    rods[i].lookAt(joints[i + 1].x, joints[i + 1].y + 0.05, joints[i + 1].z);
    rods[i].scale.z = LENGTHS[i] * 0.7;
  }
  for (let i = 0; i <= N; i++) jointMeshes[i].position.copy(joints[i]);

  // claw pose + grip animation
  claw.position.copy(joints[N]);
  const clawDir = joints[N].clone().sub(joints[N - 1]).normalize();
  claw.lookAt(joints[N].clone().add(clawDir));
  clawT += ((clawClosed ? 1 : 0) - clawT) * Math.min(1, dt * 9);
  for (const f of fingers) f.rotation.x = -0.5 + clawT * 0.62;

  // reticle (manipulator mode only)
  reticle.visible = mode === "MANIPULATOR";
  reticle.position.copy(smoothedTarget);
  reticle.lookAt(camera.position);
  reticle.children[0].rotation.z = t * 1.2;
  const near = joints[N].distanceTo(smoothedTarget) < 0.25;
  ((reticle.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(
    near ? 0xe0a458 : 0x8fd6c8,
  );

  // --- marine snow wraps around the sub ---
  const p = moteGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < MOTES; i++) {
    let x = p.getX(i);
    let y = p.getY(i) - dt * 0.25;
    let z = p.getZ(i);
    if (x - sub.pos.x > RANGE) x -= RANGE * 2;
    if (x - sub.pos.x < -RANGE) x += RANGE * 2;
    if (y - sub.pos.y > RANGE) y -= RANGE * 2;
    if (y - sub.pos.y < -RANGE) y += RANGE * 2;
    if (z - sub.pos.z > RANGE) z -= RANGE * 2;
    if (z - sub.pos.z < -RANGE) z += RANGE * 2;
    p.setXYZ(i, x, y, z);
  }
  p.needsUpdate = true;

  // --- thruster wake: bubbles churned out with the throttle, tumbling in
  // the prop wash before rising ---
  for (let bi = 0; bi < bubbles.length; bi++) {
    const b = bubbles[bi];
    b.userData.life += dt * (0.25 + throttle * 1.3);
    if (b.userData.life > 1) {
      // idle: a lazy seep. Under thrust: a full churn.
      if (throttle > 0.05 || Math.random() < 0.25) {
        b.userData.life = 0;
        b.position
          .copy(sub.pos)
          .addScaledVector(forward, -4.15) // at the prop, aft of the tail tip
          .add(
            new THREE.Vector3(
              (Math.random() - 0.5) * 0.4,
              (Math.random() - 0.5) * 0.4,
              (Math.random() - 0.5) * 0.4,
            ),
          );
      } else {
        b.userData.life = 1; // parked until next tick
        (b.material as THREE.MeshBasicMaterial).opacity = 0;
        continue;
      }
    }
    const life = b.userData.life;
    // pushed aft by the prop wash, swirling, then buoyancy takes over
    b.position.addScaledVector(forward, -dt * throttle * 2.6 * (1 - life));
    b.position.x += Math.sin(t * 9 + bi * 1.7) * dt * (0.15 + throttle * 0.8);
    b.position.z += Math.cos(t * 8 + bi * 2.3) * dt * (0.15 + throttle * 0.8);
    b.position.y += dt * (0.5 + life * (0.6 + throttle * 0.5));
    (b.material as THREE.MeshBasicMaterial).opacity = (0.22 + throttle * 0.15) * (1 - life);
  }

  // beam + caustics + water-wobble animation
  for (const m of beamMats) m.uniforms.time.value = t;
  causticsMat.uniforms.time.value = t;
  causticsMat.uniforms.camPos.value.copy(camera.position);
  underwaterPass.uniforms.time.value = t;

  // restore claw HUD after a transient flash (e.g. "ARM STOWED")
  if (clawFlashUntil && performance.now() > clawFlashUntil) {
    clawFlashUntil = 0;
    clawHud.textContent = clawText();
  }

  // --- HUD readouts (real values from the sim now) ---
  depthEl.textContent = (312.4 - sub.pos.y * 1.8).toFixed(1) + " M";
  const heading = ((((-sub.yaw * 180) / Math.PI) % 360) + 360) % 360;
  headEl.textContent = String(Math.round(heading)).padStart(3, "0") + "°";

  composer.render();

  // --- claw cam PiP: raw second render into a scissored viewport that sits
  // behind the HUD's MANIP CAM frame (bottom-left) ---
  {
    const pw = 300;
    const ph = 170;
    const px = 14;
    const py = 96;
    renderer.setScissorTest(true);
    renderer.setViewport(px, py, pw, ph);
    renderer.setScissor(px, py, pw, ph);
    renderer.render(scene, clawCam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  }
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// dev-only handle for automated verification (scripts/verify_grab.mjs)
(window as unknown as Record<string, unknown>).__dbg = {
  setSubPos: (x: number, y: number, z: number) => {
    sub.pos.set(x, y, z);
    sub.vel.set(0, 0, 0);
  },
  setArmTarget: (x: number, y: number, z: number) => {
    armTarget.set(x, y, z);
  },
  isCarried: () => carried !== null,
  inRange: () => clawInGrabRange(),
};
