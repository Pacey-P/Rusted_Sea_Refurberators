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
scene.fog = new THREE.FogExp2(WATER, 0.03);

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  300,
);

// ---------------------------------------------------------------- lights ---
const ambient = new THREE.AmbientLight(0x0d2634, params.has("lit") ? 4 : 0.7);
scene.add(ambient);
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
const FLOOD_BASE = 520; // candela at 100% floods
let floodLevel = 1; // player-set floods: 0..1 in 25% steps (bumpers)
const beamMats: THREE.ShaderMaterial[] = [];
const floodLamps: THREE.SpotLight[] = [];
const floodHalos: THREE.SpriteMaterial[] = [];
const floodBulbs: THREE.MeshBasicMaterial[] = [];
function makeBeamMaterial(): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
    uniforms: { time: { value: 0 }, uScale: { value: 1 } },
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
      uniform float uScale;
      void main() {
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        float body = smoothstep(0.0, 0.7, facing);
        float fall = pow(1.0 - vAlong, 1.8);
        // drifting murk inside the beam — light through particulate
        float murk = 0.85 + 0.15 * sin(vAlong * 22.0 - time * 2.2)
                          * sin(vAlong * 9.0 - time * 1.1);
        float a = body * fall * murk * 0.13 * uScale;
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
  // decay 0.85 + lower intensity = flatter falloff: the near-field ground
  // pool drops ~50% while 30u+ throw actually increases. Width unchanged.
  const lamp = new THREE.SpotLight(0xffd9a0, FLOOD_BASE, 170, 0.48, 0.55, 0.85);
  lamp.position.set(3.14, y, z);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(512, 512);
  const tgt = new THREE.Object3D();
  tgt.position.set(9.4, y - 4.5, z * 2);
  hullGroup.add(tgt);
  lamp.target = tgt;
  hullGroup.add(lamp);
  floodLamps.push(lamp);

  // the hot bulb itself — a small emissive core the bloom can catch,
  // proud of the housing so it never intersects the nose skin
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff0d0 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 10), bulbMat);
  bulb.position.set(3.18, y, z);
  hullGroup.add(bulb);
  floodBulbs.push(bulbMat);

  // apex at the lamp, opening forward-down along the beam direction.
  // Long enough to visually bridge the lamp to its pool on the seafloor.
  const dir = new THREE.Vector3().subVectors(tgt.position, lamp.position).normalize();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(5.2, 26, 24, 1, true), makeBeamMaterial());
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  cone.position.copy(lamp.position).addScaledVector(dir, 13);
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
  floodHalos.push(halo.material as THREE.SpriteMaterial);
}
floodlight(0.35, 0.45);
floodlight(0.35, -0.45);

// landing skids — helicopter-style: two rails joined by cross-tubes that
// run under the belly, with central struts rooted INSIDE the hull skin so
// every member visibly connects (overlap, not tangency). Aft of the arm.
{
  for (const side of [-1, 1]) {
    const rail = addShadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 3.2, 4, 8), trimMat));
    rail.rotation.z = Math.PI / 2; // capsule axis onto X
    rail.position.set(-0.4, -1.32, side * 0.72);
    hullGroup.add(rail);
  }
  for (const sx of [-1.7, 0.9]) {
    // cross-tube: spans rail to rail at rail height
    const tube = addShadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.66, 8), trimMat),
    );
    tube.rotation.x = Math.PI / 2; // axis onto Z
    tube.position.set(sx, -1.3, 0);
    hullGroup.add(tube);
    // central strut: top buried in the hull (bottom of hull is y=-.85 here),
    // bottom overlapping the cross-tube
    const strut = addShadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.66, 8), trimMat),
    );
    strut.position.set(sx, -0.99, 0);
    hullGroup.add(strut);
  }
}

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

// ------------------------------------------------- infinite ocean terrain ---
// One world-space height function, written twice (TS + GLSL, identical):
// a tanh'd low-frequency field carves shallow sunlit banks (~-5) and deep
// trenches (~-45) with steep, short transitions; ridges and dunes detail it.
const SURFACE_Y = 8;
function floorHeightAt(x: number, z: number): number {
  const v =
    Math.sin(x * 0.016 + 1.7) * Math.sin(z * 0.013 + 0.4) +
    0.6 * Math.sin(x * 0.007 - z * 0.009 + 3.0);
  const band = Math.tanh(v * 2.2);
  const zone = -44 + (band + 1) * 0.5 * (44 - 4.5); // mix(-44, -4.5)
  const r =
    Math.sin(x * 0.06 + z * 0.045) * 2.2 + Math.sin(x * 0.11 - z * 0.08 + 2.0) * 1.2;
  const d =
    Math.sin(x * 0.22) * Math.cos(z * 0.18) * 0.9 +
    Math.sin(x * 1.3) * Math.sin(z * 1.1) * 0.12;
  return zone + r + d;
}
const TERRAIN_GLSL = /* glsl */ `
  float terrainH(vec2 p) {
    float v = sin(p.x * 0.016 + 1.7) * sin(p.y * 0.013 + 0.4)
            + 0.6 * sin(p.x * 0.007 - p.y * 0.009 + 3.0);
    float band = tanh(v * 2.2);
    float zone = mix(-44.0, -4.5, (band + 1.0) * 0.5);
    float r = sin(p.x * 0.06 + p.y * 0.045) * 2.2
            + sin(p.x * 0.11 - p.y * 0.08 + 2.0) * 1.2;
    float d = sin(p.x * 0.22) * cos(p.y * 0.18) * 0.9
            + sin(p.x * 1.3) * sin(p.y * 1.1) * 0.12;
    return zone + r + d;
  }
`;

// The floor is a big plane that FOLLOWS the sub; vertices are displaced in
// the vertex shader by the world-space height, so the terrain flows under a
// fixed grid — effectively infinite, no chunks, no popping.
const floorUniforms = { uOffset: { value: new THREE.Vector2() } };
let floorMesh: THREE.Mesh;
{
  const g = new THREE.PlaneGeometry(520, 520, 210, 210);
  g.rotateX(-Math.PI / 2); // bake orientation so local == world axes
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOffset = floorUniforms.uOffset;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nuniform vec2 uOffset;\nvarying float vH;\n${TERRAIN_GLSL}`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        /* glsl */ `
        vec2 wxz = position.xz + uOffset;
        float e = 1.2;
        float hC = terrainH(wxz);
        float hX = terrainH(wxz + vec2(e, 0.0)) - terrainH(wxz - vec2(e, 0.0));
        float hZ = terrainH(wxz + vec2(0.0, e)) - terrainH(wxz - vec2(0.0, e));
        vec3 objectNormal = normalize(vec3(-hX / (2.0 * e), 1.0, -hZ / (2.0 * e)));
        `,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        vec3 transformed = vec3(position.x, hC, position.z);
        vH = hC;
        `,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vH;")
      .replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        // sunlit sand on the banks, cold mud in the deep
        vec3 mud = vec3(0.039, 0.10, 0.13);
        vec3 sand = vec3(0.45, 0.40, 0.28);
        diffuseColor.rgb *= mix(mud, sand, smoothstep(-26.0, -6.0, vH));
        `,
      );
  };
  floorMesh = new THREE.Mesh(g, mat);
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);
}

// water surface, seen from below: a bright rippling sheet that only reads
// when you're up in the shallows
const surfaceMat = new THREE.ShaderMaterial({
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
  uniforms: {
    time: { value: 0 },
    uFade: { value: 0 },
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
    uniform float uFade;
    uniform vec3 camPos;
    void main() {
      vec2 p = vWorld.xz;
      float c1 = sin(p.x * 0.5 + time * 0.9) * sin(p.y * 0.55 - time * 0.7);
      float c2 = sin((p.x + p.y) * 0.32 + time * 1.1) * sin((p.x - p.y) * 0.3 - time * 0.5);
      float shimmer = pow(abs(c1 * 0.6 + c2 * 0.4), 2.0);
      float fade = exp(-distance(camPos, vWorld) * 0.02);
      float a = shimmer * fade * uFade * 0.35;
      gl_FragColor = vec4(vec3(0.55, 0.85, 0.9) * a, a);
    }
  `,
});
const surfaceMesh = new THREE.Mesh(new THREE.PlaneGeometry(700, 700, 1, 1), surfaceMat);
surfaceMesh.rotation.x = -Math.PI / 2;
surfaceMesh.position.y = SURFACE_Y + 1.5;
scene.add(surfaceMesh);
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
    ${TERRAIN_GLSL}
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      w.y = terrainH(w.xz) + 0.25; // drape the caustic sheet over the terrain
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
      float fade = exp(-distance(camPos, vWorld) * 0.045);
      // sunlight only reaches the banks: caustics die with depth
      float sun = smoothstep(-26.0, -8.0, vWorld.y);
      float a = ca * fade * sun * 0.34;
      gl_FragColor = vec4(vec3(0.4, 0.8, 0.75) * a, a);
    }
  `,
});
const causticsMesh = new THREE.Mesh(new THREE.PlaneGeometry(520, 520, 96, 96), causticsMat);
causticsMesh.rotation.x = -Math.PI / 2;
scene.add(causticsMesh);

// rocks — pushable: the claw (and the hull) can nudge them around
type Rock = { m: THREE.Mesh; r: number; rest: number; vel: THREE.Vector3 };
const rocks: Rock[] = [];
{
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x0c1d26, roughness: 1 });
  for (let i = 0; i < 26; i++) {
    const geoR = 0.4 + Math.random() * 1.6;
    const r = addShadow(new THREE.Mesh(new THREE.DodecahedronGeometry(geoR, 0), rockMat));
    const a = Math.random() * Math.PI * 2;
    const d = 6 + Math.random() * 45;
    const rx = Math.cos(a) * d;
    const rz = Math.sin(a) * d;
    const rest = geoR * 0.2;
    r.position.set(rx, floorHeightAt(rx, rz) + rest, rz);
    r.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    r.scale.y = 0.5 + Math.random() * 0.5;
    scene.add(r);
    rocks.push({ m: r, r: geoR * 0.85, rest, vel: new THREE.Vector3() });
  }
}

// ------------------------------------------- payloads: nuclear-era bombs ---
// Old-school Fat-Man-style bombs, lost on the seafloor. Grab one, haul it
// to the recovery pad, get paid. Each carries a locator beacon that
// telegraphs the grab exactly like the crate used to.
const nukeBody = new THREE.MeshStandardMaterial({ color: 0x4a4f38, roughness: 0.65, metalness: 0.45 });
const nukeDark = new THREE.MeshStandardMaterial({ color: 0x22251c, roughness: 0.7, metalness: 0.4 });
const nukeBand = new THREE.MeshStandardMaterial({ color: 0x9a8420, roughness: 0.6, metalness: 0.3 });

type Payload = {
  g: THREE.Group;
  beacon: THREE.Mesh;
  light: THREE.PointLight;
  velH: THREE.Vector3;
  velY: number;
  falling: boolean;
};
const PAYLOAD_R = 0.75;
const payloads: Payload[] = [];

function makeNuke(x: number, z: number): Payload {
  const g = new THREE.Group();
  // fat ellipsoid body
  const body = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.52, 18, 14), nukeBody));
  body.scale.set(1.35, 1, 1);
  g.add(body);
  // hazard band
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.505, 0.035, 8, 24), nukeBand);
  band.rotation.y = Math.PI / 2;
  band.position.x = 0.18;
  g.add(band);
  // tail cone + ring + fins
  const tail = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.5, 12), nukeDark));
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -0.82;
  g.add(tail);
  const ring = addShadow(new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.045, 8, 20), nukeDark));
  ring.rotation.y = Math.PI / 2;
  ring.position.x = -1.08;
  g.add(ring);
  for (let i = 0; i < 4; i++) {
    const fin = addShadow(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.34), nukeDark));
    const holder = new THREE.Group();
    fin.position.set(-0.92, 0.24, 0);
    holder.add(fin);
    holder.rotation.x = (i * Math.PI) / 2;
    g.add(holder);
  }
  // locator beacon
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff5040 }),
  );
  beacon.position.set(0.25, 0.5, 0);
  g.add(beacon);
  const light = new THREE.PointLight(0xff4030, 0, 5, 1.8);
  light.position.copy(beacon.position);
  g.add(light);

  g.position.set(x, floorHeightAt(x, z) + 0.5, z);
  g.rotation.y = Math.random() * Math.PI * 2;
  scene.add(g);
  const p: Payload = { g, beacon, light, velH: new THREE.Vector3(), velY: 0, falling: false };
  payloads.push(p);
  return p;
}
const siteCenter = new THREE.Vector2(2.6, 2.2);
makeNuke(2.6, 2.2);
makeNuke(9.5, -4.0);
makeNuke(-6.0, 9.0);
makeNuke(14.0, 10.5);

// the op site's local ground level anchors the drone's patrol altitude
const siteGroundY = floorHeightAt(siteCenter.x, siteCenter.y);

// ------------------------------------------------------- recovery drop-off ---
// A lit pad with a beacon column. Release a bomb over it: +100 CR.
const PAD_POS = new THREE.Vector3(-34, 0, -18);
PAD_POS.y = floorHeightAt(PAD_POS.x, PAD_POS.z);
const PAD_R = 3.6;
{
  const padMat = new THREE.MeshStandardMaterial({ color: 0x1c2429, roughness: 0.8, metalness: 0.4 });
  const pad = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(PAD_R, PAD_R + 0.4, 0.5, 24), padMat));
  pad.position.copy(PAD_POS).y += 0.25;
  scene.add(pad);
  const ringGlow = new THREE.Mesh(
    new THREE.TorusGeometry(PAD_R - 0.25, 0.06, 8, 40),
    new THREE.MeshBasicMaterial({ color: 0x37ff7a }),
  );
  ringGlow.rotation.x = Math.PI / 2;
  ringGlow.position.copy(PAD_POS).y += 0.52;
  scene.add(ringGlow);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const post = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.6, 8), padMat));
    post.position.set(
      PAD_POS.x + Math.cos(a) * (PAD_R - 0.1),
      PAD_POS.y + 0.8,
      PAD_POS.z + Math.sin(a) * (PAD_R - 0.1),
    );
    scene.add(post);
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x37ff7a }),
    );
    tip.position.copy(post.position).y += 0.85;
    scene.add(tip);
  }
  const padLight = new THREE.PointLight(0x37ff7a, 20, 14, 1.6);
  padLight.position.copy(PAD_POS).y += 2.2;
  scene.add(padLight);
  // faint light column so the pad is findable at range
  const col = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 1.4, 34, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x37ff7a,
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  col.position.copy(PAD_POS).y += 17;
  scene.add(col);
}

// ----------------------------------------------------- credits & torpedoes ---
let credits = 0;
function updateCreditsHud(): void {
  document.getElementById("credits")!.textContent = `${credits} CR`;
}
type Torp = { m: THREE.Group; vel: THREE.Vector3; life: number };
const torps: Torp[] = [];
const torpMat = new THREE.MeshStandardMaterial({ color: 0x3c444c, roughness: 0.5, metalness: 0.6 });

// transient explosion/flash effects
type Fx = { s: THREE.Sprite; l: THREE.PointLight; age: number; grow: number };
const fxs: Fx[] = [];
function spawnFx(pos: THREE.Vector3, color: number, size: number, grow: number): void {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: discTex,
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  s.scale.setScalar(size);
  s.position.copy(pos);
  const l = new THREE.PointLight(color, 120, 30, 1.6);
  l.position.copy(pos);
  scene.add(s, l);
  fxs.push({ s, l, age: 0, grow });
}

// ------------------------------------------------------------- grab state ---
const GRAB_RANGE = 1.45; // forgiving: claw within this of a bomb can grip it
const CLAW_R = 0.34; // claw collision sphere
let carried: Payload | null = null;
const payloadWorld = new THREE.Vector3();

function nearestPayloadInRange(): Payload | null {
  if (carried) return null;
  let best: Payload | null = null;
  let bestD = GRAB_RANGE;
  for (const p of payloads) {
    p.g.getWorldPosition(payloadWorld);
    const d = claw.position.distanceTo(payloadWorld);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
function clawInGrabRange(): boolean {
  return nearestPayloadInRange() !== null;
}

// ---------------------------------------------------------- enemy base ---
// A sentinel nest down in the trench. Three torpedoes crack it: +300 CR.
const basePos = new THREE.Vector3(0, 0, -148);
basePos.y = floorHeightAt(basePos.x, basePos.z);
const baseGroup = new THREE.Group();
let baseHp = 3;
let baseEye: THREE.PointLight;
{
  const baseHullMat = new THREE.MeshStandardMaterial({ color: 0x2b2f27, roughness: 0.72, metalness: 0.5 });
  const baseDarkMat = new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.55, metalness: 0.6 });
  const dome = addShadow(
    new THREE.Mesh(
      new THREE.SphereGeometry(3.2, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      baseHullMat,
    ),
  );
  baseGroup.add(dome);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 2.6, 6), baseDarkMat);
    ant.position.set(Math.cos(a) * 1.6, 2.6, Math.sin(a) * 1.6);
    baseGroup.add(ant);
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff2418 }),
    );
    tip.position.copy(ant.position).y += 1.4;
    baseGroup.add(tip);
  }
  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 14, 14),
    new THREE.MeshBasicMaterial({ color: 0xff2418 }),
  );
  eye.position.y = 2.9;
  baseGroup.add(eye);
  baseEye = new THREE.PointLight(0xff2418, 30, 24, 1.6);
  baseEye.position.y = 3.2;
  baseGroup.add(baseEye);
  baseGroup.position.copy(basePos);
  scene.add(baseGroup);
}
function hitBase(at: THREE.Vector3): void {
  baseHp -= 1;
  spawnFx(at, 0xffc060, 4, 14);
  if (baseHp <= 0) {
    spawnFx(baseGroup.position.clone().add(new THREE.Vector3(0, 2, 0)), 0xffd9a0, 10, 40);
    baseGroup.visible = false;
    credits += 300;
    updateCreditsHud();
    flashClawHud("BASE DESTROYED +300 CR");
  } else {
    flashClawHud(`BASE HIT · ${baseHp} TO GO`);
  }
}

// distant wreck silhouette (Sea Major glb, half-buried set dressing)
new GLTFLoader().load("assets/models/sea_major.glb", (gltf) => {
  const wreck = gltf.scene;
  const box = new THREE.Box3().setFromObject(wreck);
  const size = box.getSize(new THREE.Vector3());
  if (size.x > size.z) wreck.rotation.y = Math.PI / 2;
  wreck.scale.setScalar(26 / Math.max(size.x, size.z));
  wreck.position.set(26, floorHeightAt(26, 42) - 1.5, 42);
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
  drone.position.set(siteCenter.x + 4.6, siteGroundY + 3.3, siteCenter.y);
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
    // compute the direction BEFORE t.copy(base) — chaining t.sub(base) as
    // the argument evaluated after the copy, yielding a zero direction: the
    // clamped target became the shoulder itself and the arm folded back
    // through the hull at full extension
    const dir = t.clone().sub(base).normalize();
    t.copy(base).addScaledVector(dir, TOTAL * 0.995);
  }
  // degenerate-direction guard: normalize(0,0,0) is NaN, and one NaN joint
  // makes the whole arm vanish
  const safeDir = (v: THREE.Vector3): THREE.Vector3 =>
    v.lengthSq() < 1e-10 ? v.set(0, -1, 0) : v.normalize();
  for (let it = 0; it < 10; it++) {
    joints[N].copy(t);
    for (let i = N - 1; i >= 0; i--) {
      const dir = safeDir(joints[i].clone().sub(joints[i + 1]));
      joints[i].copy(joints[i + 1]).addScaledVector(dir, LENGTHS[i]);
    }
    joints[0].copy(base);
    for (let i = 1; i <= N; i++) {
      const dir = safeDir(joints[i].clone().sub(joints[i - 1]));
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
// Marine snow that LIGHTS UP inside the floodlight cones — the particulate
// is what makes the water in the beam path read as illuminated.
const moteMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTex: { value: softDiscTexture() },
    uLampPos: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    uLampDir: { value: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1)] },
    uCosOuter: { value: Math.cos(0.48) },
    uBeam: { value: 1 }, // flood level x depth scale
  },
  vertexShader: /* glsl */ `
    uniform vec3 uLampPos[2];
    uniform vec3 uLampDir[2];
    uniform float uCosOuter;
    uniform float uBeam;
    varying float vBoost;
    void main() {
      // how strongly this mote sits inside either beam
      float boost = 0.0;
      for (int i = 0; i < 2; i++) {
        vec3 v = position - uLampPos[i];
        float d = length(v);
        float ca = dot(v / max(d, 0.001), uLampDir[i]);
        float cone = smoothstep(uCosOuter, uCosOuter + 0.06, ca);
        boost += cone * exp(-d * 0.10);
      }
      vBoost = min(boost, 1.0) * uBeam;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      float size = 0.05 * (1.0 + vBoost * 2.2);
      gl_PointSize = size * (420.0 / -mv.z);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D uTex;
    varying float vBoost;
    void main() {
      float tex = texture2D(uTex, gl_PointCoord).r;
      vec3 cool = vec3(0.50, 0.66, 0.69);
      vec3 warm = vec3(1.0, 0.85, 0.63); // tungsten catch
      vec3 col = mix(cool, warm, vBoost);
      float a = tex * (0.30 + vBoost * 0.85);
      gl_FragColor = vec4(col * a, a);
    }
  `,
});
const motes = new THREE.Points(moteGeo, moteMat);
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

const STOW_HOLD_MS = 500;
const keys = new Set<string>();
let tabDownAt = 0;
let tabHeld = false;
let tabConsumed = false; // stow already fired for this hold
window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code === "Tab") {
    e.preventDefault();
    if (!e.repeat) {
      tabDownAt = performance.now();
      tabHeld = true;
      tabConsumed = false;
    }
  }
  if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) toggleClaw();
  }
  if (e.code === "KeyT" && !e.repeat) fireTorpedo();
});
window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
  if (e.code === "Tab") {
    tabHeld = false;
    // released before the stow bar filled: it's a mode switch
    if (!tabConsumed && performance.now() - tabDownAt < STOW_HOLD_MS) toggleMode();
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
const stowEl = document.getElementById("stow")!;
const stowFill = document.getElementById("stowFill")!;
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
  const grabbable = clawClosed ? nearestPayloadInRange() : null;
  if (grabbable) {
    // grip: the bomb becomes part of the claw, world pose preserved
    claw.attach(grabbable.g);
    carried = grabbable;
    grabbable.falling = false;
    flashClawHud("PAYLOAD SECURED");
  } else if (!clawClosed && carried) {
    // release: back into the world, then gravity takes it
    scene.attach(carried.g);
    carried.falling = true;
    carried.velY = 0;
    carried = null;
    flashClawHud("PAYLOAD RELEASED");
  } else {
    clawFlashUntil = 0;
    clawHud.textContent = clawText();
  }
  clawHud.classList.toggle("closed", clawClosed);
}

function fireTorpedo(): void {
  if (credits < 50) {
    flashClawHud("TORPEDO: NEED 50 CR");
    return;
  }
  credits -= 50;
  updateCreditsHud();
  const m = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.7, 10), torpMat);
  body.rotation.x = Math.PI / 2;
  m.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 10), torpMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 0.46;
  m.add(nose);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: discTex,
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  glow.scale.setScalar(0.5);
  glow.position.z = -0.4;
  m.add(glow);
  forward.set(Math.sin(sub.yaw), 0, Math.cos(sub.yaw));
  m.position.copy(sub.pos).addScaledVector(forward, 3.6).add(new THREE.Vector3(0, -0.25, 0));
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), forward);
  scene.add(m);
  torps.push({ m, vel: forward.clone().multiplyScalar(26), life: 7 });
  flashClawHud("TORPEDO AWAY −50 CR");
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
let padYConsumed = false;

// ------------------------------------------------------------------- post ---
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.45,
  0.6,
  0.8,
);
composer.addPass(bloom);
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
    // Y: short press toggles mode; holding fills the stow bar, which fires
    // the moment it completes (release early = mode switch)
    const yNow = pad.held(3);
    if (yNow) {
      padYTime += dt;
      if (padYTime >= STOW_HOLD_MS / 1000 && !padYConsumed) {
        stowArm();
        padYConsumed = true;
      }
    } else {
      if (padYWas && !padYConsumed) toggleMode();
      padYTime = 0;
      padYConsumed = false;
    }
    padYWas = yNow;
    if (pad.pressed(0)) toggleClaw(); // A — grip, in either mode
    if (pad.pressed(2)) fireTorpedo(); // X — torpedo
    // bumpers step the floods in 25% notches: LB dims, RB brightens
    if (pad.pressed(4)) {
      floodLevel = Math.max(0, floodLevel - 0.25);
      flashClawHud(`FLOODS ${Math.round(floodLevel * 100)}%`);
    }
    if (pad.pressed(5)) {
      floodLevel = Math.min(1, floodLevel + 0.25);
      flashClawHud(`FLOODS ${Math.round(floodLevel * 100)}%`);
    }
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
  // set down on the skids: minimum altitude follows the actual terrain
  const ground = floorHeightAt(sub.pos.x, sub.pos.z) + 1.45;
  if (sub.pos.y <= ground) {
    sub.pos.y = ground;
    sub.vel.y = Math.max(sub.vel.y, 0);
  }

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

  // --- beacons: red blink normally; GREEN on the bomb the claw can take;
  // steady soft green on the one being carried ---
  const inRangeP = nearestPayloadInRange();
  for (const p of payloads) {
    const mat = p.beacon.material as THREE.MeshBasicMaterial;
    if (p === carried) {
      mat.color.setHex(0x1f8a4a);
      p.light.color.setHex(0x35ff70);
      p.light.intensity = 2.5;
    } else if (p === inRangeP) {
      const gblink = t % 0.35 < 0.2; // eager fast green: "you can take it"
      mat.color.setHex(gblink ? 0x4dff85 : 0x134a26);
      p.light.color.setHex(0x35ff70);
      p.light.intensity = gblink ? 12 : 2;
    } else {
      const blink = (t + p.g.id * 0.13) % 1.1 < 0.12;
      mat.color.setHex(blink ? 0xff5040 : 0x4a1712);
      p.light.color.setHex(0xff4030);
      p.light.intensity = blink ? 10 : 0;
    }
  }

  // --- pushable rocks: hull contact shoves them; claw contact is handled
  // by the collision constraint in the arm section ---
  for (const rock of rocks) {
    const dh = rock.m.position.distanceTo(sub.pos);
    const minH = rock.r + 1.7;
    if (dh < minH) {
      const dir = rock.m.position.clone().sub(sub.pos);
      dir.y = 0;
      if (dir.lengthSq() > 1e-6) {
        dir.normalize();
        rock.vel.addScaledVector(dir, (minH - dh) * 6 * dt * 60 * 0.15);
        // pushing mass slows the boat a touch
        sub.vel.multiplyScalar(1 - 0.4 * dt);
      }
    }
    // integrate: friction slide, tumble with speed, hug the terrain
    if (rock.vel.lengthSq() > 1e-6) {
      rock.vel.multiplyScalar(Math.exp(-2.4 * dt));
      rock.m.position.addScaledVector(rock.vel, dt);
      rock.m.position.y = floorHeightAt(rock.m.position.x, rock.m.position.z) + rock.rest;
      const spd = rock.vel.length();
      rock.m.rotation.y += spd * 0.3 * dt;
      rock.m.rotation.x += spd * 0.5 * dt;
    }
  }

  // --- free bombs: hull shoves, friction slide, sink after release; a bomb
  // settling on the recovery pad is a delivery ---
  for (const p of payloads) {
    if (p === carried) continue;
    const pos = p.g.position;
    const dhc = pos.distanceTo(sub.pos);
    const minHC = PAYLOAD_R + 1.7;
    if (dhc < minHC) {
      const dir = pos.clone().sub(sub.pos);
      dir.y = 0;
      if (dir.lengthSq() > 1e-6) {
        dir.normalize();
        p.velH.addScaledVector(dir, (minHC - dhc) * 6 * dt * 60 * 0.15);
      }
    }
    if (p.velH.lengthSq() > 1e-6) {
      p.velH.multiplyScalar(Math.exp(-2.4 * dt));
      pos.x += p.velH.x * dt;
      pos.z += p.velH.z * dt;
      p.g.rotation.y += p.velH.length() * 0.12 * dt;
      if (!p.falling) pos.y = floorHeightAt(pos.x, pos.z) + 0.5;
    }
    if (p.falling) {
      p.velY = Math.max(p.velY - 4.5 * dt, -2.4);
      pos.y += p.velY * dt;
      p.g.rotation.y += 0.25 * dt;
      // anything that comes to rest inside the pad footprint is delivered —
      // the pad surface catches it even where the surrounding sand is higher
      const inPadXZ = Math.hypot(pos.x - PAD_POS.x, pos.z - PAD_POS.z) < PAD_R;
      const padTop = PAD_POS.y + 0.95;
      const rest = inPadXZ
        ? Math.max(floorHeightAt(pos.x, pos.z) + 0.5, padTop)
        : floorHeightAt(pos.x, pos.z) + 0.5;
      if (pos.y <= rest) {
        p.falling = false;
        p.velY = 0;
        if (inPadXZ) {
          // recovered: pay out, respawn the bomb somewhere new around the site
          credits += 100;
          updateCreditsHud();
          flashClawHud("PAYLOAD RECOVERED +100 CR");
          spawnFx(pos.clone(), 0x37ff7a, 3, 8);
          const a = Math.random() * Math.PI * 2;
          const d = 18 + Math.random() * 28;
          const nx = siteCenter.x + Math.cos(a) * d;
          const nz = siteCenter.y + Math.sin(a) * d;
          pos.set(nx, floorHeightAt(nx, nz) + 0.5, nz);
          p.velH.set(0, 0, 0);
        } else {
          pos.y = rest;
        }
      }
    }
  }

  // --- torpedoes fly, hit terrain or the base ---
  for (let i = torps.length - 1; i >= 0; i--) {
    const tp = torps[i];
    tp.m.position.addScaledVector(tp.vel, dt);
    tp.life -= dt;
    const hitGround = tp.m.position.y <= floorHeightAt(tp.m.position.x, tp.m.position.z) + 0.2;
    const nearBase =
      baseHp > 0 && tp.m.position.distanceTo(baseGroup.position.clone().add(new THREE.Vector3(0, 1.5, 0))) < 4.4;
    if (nearBase) hitBase(tp.m.position.clone());
    if (hitGround && !nearBase) spawnFx(tp.m.position.clone(), 0x9fb4bc, 1.6, 5);
    if (hitGround || nearBase || tp.life <= 0) {
      scene.remove(tp.m);
      torps.splice(i, 1);
    }
  }

  // --- transient fx ---
  for (let i = fxs.length - 1; i >= 0; i--) {
    const fx = fxs[i];
    fx.age += dt;
    fx.s.scale.addScalar(fx.grow * dt);
    (fx.s.material as THREE.SpriteMaterial).opacity = Math.max(0, 0.9 - fx.age * 1.4);
    fx.l.intensity = Math.max(0, 120 * (1 - fx.age * 1.6));
    if (fx.age > 0.9) {
      scene.remove(fx.s, fx.l);
      fxs.splice(i, 1);
    }
  }

  // base eye pulses while it lives
  if (baseHp > 0) baseEye.intensity = 20 + Math.abs(Math.sin(t * 1.7)) * 25;

  // --- patrol drone: uneven searching orbit around the bomb site ---
  const orbR = 4.6;
  const dAng = t * 0.26 + Math.sin(t * 0.11) * 1.4;
  drone.position.set(
    siteCenter.x + Math.cos(dAng) * orbR,
    siteGroundY + 3.3 + Math.sin(t * 0.5) * 0.35,
    siteCenter.y + Math.sin(dAng) * orbR * 0.72,
  );
  lookTmp.set(
    siteCenter.x + Math.cos(dAng + 0.14) * orbR,
    drone.position.y,
    siteCenter.y + Math.sin(dAng + 0.14) * orbR * 0.72,
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
  // sit lower and look THROUGH the sub toward the horizon — forward-angled
  // chase cam rather than a top-down inspection view
  const desired = sub.pos
    .clone()
    .addScaledVector(camDirV, -camDist)
    .add(new THREE.Vector3(0, camDist * 0.16 + orbitPitch * 10, 0));
  camera.position.lerp(desired, 1 - Math.exp(-3.5 * dt));
  const lookAhead = sub.pos.clone().addScaledVector(camDirV, 2.4);
  camera.lookAt(lookAhead.x, sub.pos.y + 0.9, lookAhead.z);

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
        hit.y = Math.max(hit.y, floorHeightAt(hit.x, hit.z) + 0.35);
        armTarget.copy(hit);
      }
    }
    // Keyboard: W/S raise and lower the arm — the axis the mouse plane
    // can't reach comfortably
    const kbLift = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    armTarget.y += kbLift * 2.6 * dt;

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
    armTarget.y = Math.max(armTarget.y, floorHeightAt(armTarget.x, armTarget.z) + 0.35);
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

  // --- claw collision: the claw cannot push INTO rocks or the crate from
  // the side. Cylinder constraint (not sphere): the goal is projected out
  // horizontally, which both prevents the "surf up over the pole and point
  // at the sky" failure and makes the shove direction naturally lateral.
  // Approaching from above stays free so top-grabs work. ---
  const shove = (center: THREE.Vector3, radius: number, top: number, outVel: THREE.Vector3): void => {
    if (smoothedTarget.y > center.y + top) return; // above it: no contact
    const minR = radius + CLAW_R;
    const dx = smoothedTarget.x - center.x;
    const dz = smoothedTarget.z - center.z;
    const horiz = Math.hypot(dx, dz);
    if (horiz >= minR) return;
    // degenerate (directly inside the axis): push toward the sub — stable
    let nx: number;
    let nz: number;
    if (horiz < 1e-4) {
      const toSub = sub.pos.clone().sub(center);
      const l = Math.hypot(toSub.x, toSub.z) || 1;
      nx = toSub.x / l;
      nz = toSub.z / l;
    } else {
      nx = dx / horiz;
      nz = dz / horiz;
    }
    const pen = minR - horiz;
    smoothedTarget.x = center.x + nx * minR; // claw rides the flank
    smoothedTarget.z = center.z + nz * minR;
    outVel.x += -nx * pen * 38 * dt;
    outVel.z += -nz * pen * 38 * dt;
  };
  for (const rock of rocks) shove(rock.m.position, rock.r, rock.r * 0.7, rock.vel);
  for (const p of payloads) {
    if (p !== carried) shove(p.g.position, PAYLOAD_R, 0.55, p.velH);
  }

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

  // --- the ocean follows the sub: terrain flows under a fixed grid ---
  floorMesh.position.set(sub.pos.x, 0, sub.pos.z);
  floorUniforms.uOffset.value.set(sub.pos.x, sub.pos.z);
  causticsMesh.position.set(sub.pos.x, 0, sub.pos.z);
  surfaceMesh.position.set(sub.pos.x, SURFACE_Y + 1.5, sub.pos.z);

  // --- depth-driven atmosphere: sunlit turquoise banks, black trenches ---
  if (!params.has("lit")) {
    const df = THREE.MathUtils.clamp((SURFACE_Y - sub.pos.y) / 42, 0, 1); // 0 surface -> 1 deep
    const shallow = 1 - df;
    ambient.intensity = 0.14 + shallow * 1.35;
    moon.intensity = 0.25 + shallow * 1.9;
    const fog = scene.fog as THREE.FogExp2;
    fog.color.setRGB(
      0.008 + shallow * 0.055,
      0.045 + shallow * 0.24,
      0.065 + shallow * 0.3,
    );
    fog.density = 0.012 + df * 0.023; // clear water; the dark does the hiding
    (scene.background as THREE.Color).copy(fog.color);
    surfaceMat.uniforms.uFade.value = shallow * shallow;

    // headlights: player floods setting × daylight auto-dim (nobody runs
    // floods at noon) — keeps additive halos/bulbs/beams from blowing out
    // the sunlit shallows while leaving the deep-water look untouched
    const lightScale = floodLevel * (0.12 + df * 0.88);
    for (const l of floodLamps) l.intensity = FLOOD_BASE * lightScale;
    for (const h of floodHalos) h.opacity = 0.55 * lightScale;
    for (const b of floodBulbs) b.color.setScalar(0.3 + 0.7 * lightScale);
    // visible beams keep a floor so the shaft reads even in brighter water
    const beamScale = floodLevel * (0.3 + 0.7 * df);
    for (const m of beamMats) m.uniforms.uScale.value = beamScale;
    moteMat.uniforms.uBeam.value = beamScale;
    bloom.strength = 0.14 + 0.31 * df;
  }
  surfaceMat.uniforms.time.value = t;
  surfaceMat.uniforms.camPos.value.copy(camera.position);

  // --- infinite props: rocks that fall too far behind respawn ahead ---
  for (const rock of rocks) {
    const dx = rock.m.position.x - sub.pos.x;
    const dz = rock.m.position.z - sub.pos.z;
    if (dx * dx + dz * dz > 70 * 70) {
      const a = Math.random() * Math.PI * 2;
      const d = 30 + Math.random() * 32;
      const rx = sub.pos.x + Math.cos(a) * d;
      const rz = sub.pos.z + Math.sin(a) * d;
      rock.m.position.set(rx, floorHeightAt(rx, rz) + rock.rest, rz);
      rock.m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      rock.vel.set(0, 0, 0);
    }
  }

  // feed the mote shader the beams' world-space geometry
  for (let i = 0; i < floodLamps.length && i < 2; i++) {
    const lamp = floodLamps[i];
    const lp = moteMat.uniforms.uLampPos.value[i] as THREE.Vector3;
    const ld = moteMat.uniforms.uLampDir.value[i] as THREE.Vector3;
    lamp.getWorldPosition(lp);
    lamp.target.getWorldPosition(ld);
    ld.sub(lp).normalize();
  }

  // beam + caustics + water-wobble animation
  for (const m of beamMats) m.uniforms.time.value = t;
  causticsMat.uniforms.time.value = t;
  causticsMat.uniforms.camPos.value.copy(camera.position);
  underwaterPass.uniforms.time.value = t;

  // --- stow progress bar: fills while Tab / pad Y is held; stow fires the
  // moment it completes ---
  let stowP = 0;
  if (tabHeld && !tabConsumed) {
    stowP = (performance.now() - tabDownAt) / STOW_HOLD_MS;
    if (stowP >= 1) {
      stowArm();
      tabConsumed = true;
      stowP = 0;
    }
  }
  if (padYWas && !padYConsumed) {
    stowP = Math.max(stowP, padYTime / (STOW_HOLD_MS / 1000));
  }
  stowEl.style.display = stowP > 0.12 ? "block" : "none";
  stowFill.style.width = `${Math.min(stowP, 1) * 100}%`;

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
  cratePos: () => payloads[0].g.position.toArray(),
  clawToCrate: () => claw.position.distanceTo(payloads[0].g.position),
  credits: () => credits,
  baseHp: () => baseHp,
  fire: () => fireTorpedo(),
  giveCredits: (n: number) => {
    credits += n;
    updateCreditsHud();
  },
  clawPos: () => claw.position.toArray(),
};
