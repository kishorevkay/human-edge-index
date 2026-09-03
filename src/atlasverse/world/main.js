import './style.css'
import * as THREE from 'three'
import { GamepadAdapter } from '../input/GamepadAdapter.js'
import { playRumble } from '../input/haptics.js'

const $ = (selector) => document.querySelector(selector)
const shell = $('#world-shell')
const canvasHost = $('#world-canvas')
const interactionPrompt = $('#interaction-prompt')
const controllerState = $('#controller-state')
const locationModal = $('#location-modal')
const pauseScreen = $('#pause-screen')
const radarHuman = $('#radar-human')
const radarChatgpt = $('#radar-chatgpt')
const radarDistance = $('#radar-distance')
const radarTitle = $('#radar-title')
const objectiveDistance = $('#objective-distance')

const COLORS = {
  paper: 0xede1cf,
  cream: 0xf1e6d7,
  blush: 0xedb9ae,
  coral: 0xe85d4f,
  mauve: 0x897170,
  navy: 0x16294a,
  charcoal: 0x524444,
  amber: 0xd98e2b,
  sage: 0x9aae8f,
  water: 0x7ca7b2,
}

const state = {
  started: false,
  paused: false,
  modalOpen: false,
  activeGamepad: null,
  gamepadMove: { x: 0, y: 0 },
  gamepadCamera: { x: 0, y: 0 },
  gamepadButtons: [],
  keys: new Set(),
  nearLocation: null,
  objectiveId: 'human',
  cameraYaw: 0,
  cameraPitch: -0.06,
  cameraYawTarget: 0,
  cameraPitchTarget: -0.06,
  pointerDown: false,
  pointerX: 0,
  pointerY: 0,
  grounded: true,
  jumpOffset: 0,
  jumpVelocity: 0,
}

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x111934)
scene.fog = new THREE.Fog(0x5c5368, 72, 150)

const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 180)
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(devicePixelRatio, 1))
renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
renderer.shadowMap.enabled = false
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.domElement.tabIndex = 0
canvasHost.appendChild(renderer.domElement)

scene.add(new THREE.HemisphereLight(0x9db9df, 0x553d4d, 2.35))
const sun = new THREE.DirectionalLight(0xffc9a4, 3.25)
sun.position.set(-24, 42, 28)
sun.castShadow = true
sun.shadow.mapSize.set(1024, 1024)
sun.shadow.camera.left = -52
sun.shadow.camera.right = 52
sun.shadow.camera.top = 52
sun.shadow.camera.bottom = -52
sun.shadow.bias = -0.0004
scene.add(sun)

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(155, 32, 18),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x0b1231) },
      horizonColor: { value: new THREE.Color(0xa35f72) },
      groundColor: { value: new THREE.Color(0x302a44) },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPosition;
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 groundColor;
      void main() {
        vec3 direction = normalize(vWorldPosition);
        float h = direction.y;
        vec3 upper = mix(horizonColor, topColor, smoothstep(0.0, 0.72, h));
        vec3 color = mix(groundColor, upper, smoothstep(-0.22, 0.08, h));
        float galaxyDistance = abs(dot(direction, normalize(vec3(0.18, 1.0, -0.28))) - 0.25);
        float galaxyBand = 1.0 - smoothstep(0.07, 0.24, galaxyDistance);
        color += vec3(0.24, 0.13, 0.34) * galaxyBand * 0.72;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  }),
)
scene.add(sky)

let starSeed = 87123
function starRandom() {
  starSeed = (starSeed * 16807) % 2147483647
  return (starSeed - 1) / 2147483646
}

function addStarfield(count, radius, color, size, band = false) {
  const points = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    const longitude = starRandom() * Math.PI * 2
    const latitude = band
      ? (starRandom() - .5) * .28 + Math.sin(longitude * 1.7) * .12
      : .08 + starRandom() * 1.28
    const spreadRadius = radius - starRandom() * 12
    points[index * 3] = Math.cos(longitude) * Math.cos(latitude) * spreadRadius
    points[index * 3 + 1] = Math.sin(latitude) * spreadRadius
    points[index * 3 + 2] = Math.sin(longitude) * Math.cos(latitude) * spreadRadius
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(points, 3))
  const stars = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, opacity: band ? .68 : .92, depthWrite: false }),
  )
  if (band) {
    stars.rotation.x = -.42
    stars.rotation.z = .3
  }
  scene.add(stars)
  return stars
}

const distantStars = addStarfield(520, 132, 0xe9f2ff, .54)
const galaxyStars = addStarfield(420, 126, 0xe2c7ff, .72, true)
const duskMoon = new THREE.Mesh(
  new THREE.SphereGeometry(4.2, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0xffe8d2 }),
)
duskMoon.position.set(-66, 61, -102)
scene.add(duskMoon)

const material = (color, roughness = 0.86, metalness = 0.02) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness })

function mesh(geometry, color, { x = 0, y = 0, z = 0, ry = 0, cast = true, receive = true } = {}) {
  const item = new THREE.Mesh(geometry, material(color))
  item.position.set(x, y, z)
  item.rotation.y = ry
  item.castShadow = cast
  item.receiveShadow = receive
  return item
}

const world = new THREE.Group()
scene.add(world)

const island = mesh(new THREE.CylinderGeometry(51, 55, 4.6, 24), COLORS.charcoal, { y: -2.5, cast: false })
world.add(island)
const islandTop = mesh(new THREE.CylinderGeometry(51.2, 51.2, 0.65, 48), COLORS.cream, { y: 0, cast: false })
world.add(islandTop)

const plaza = mesh(new THREE.CylinderGeometry(17, 17, 0.18, 32), COLORS.paper, { y: 0.42, z: 3, cast: false })
world.add(plaza)
const path = mesh(new THREE.BoxGeometry(9, 0.22, 37), 0xe4c6b3, { y: 0.48, z: 17, cast: false })
world.add(path)
const crossPath = mesh(new THREE.BoxGeometry(31, 0.2, 6.5), 0xe7cfbd, { y: 0.48, z: 3, cast: false })
world.add(crossPath)

const ringRoad = mesh(new THREE.RingGeometry(26, 32, 72), 0x796d6b, { y: .5, cast: false })
ringRoad.rotation.x = -Math.PI / 2
world.add(ringRoad)
const laneMarking = mesh(new THREE.RingGeometry(28.92, 29.08, 96), 0xf3c867, { y: .535, cast: false, receive: false })
laneMarking.rotation.x = -Math.PI / 2
world.add(laneMarking)

for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
  const dash = mesh(new THREE.BoxGeometry(.14, .035, 1.7), 0xf8e6b8, { y: .56, cast: false, receive: false })
  dash.position.x = Math.cos(angle) * 23.7
  dash.position.z = Math.sin(angle) * 23.7
  dash.rotation.y = -angle
  world.add(dash)
}

function addCloud(x, y, z, scale = 1) {
  const cloud = new THREE.Group()
  const cloudMat = material(0xfff9ed, 1, 0)
  ;[[-1.6,0,0,1.3],[0,0.3,0,1.8],[1.8,0,0,1.15],[.6,-.1,.5,1.2]].forEach(([cx,cy,cz,s]) => {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 2), cloudMat)
    puff.position.set(cx,cy,cz)
    cloud.add(puff)
  })
  cloud.position.set(x,y,z)
  cloud.scale.setScalar(scale)
  world.add(cloud)
}
addCloud(-45, -1, -15, 1.8)
addCloud(42, 1, 8, 1.25)
addCloud(16, -3, -43, 1.6)

function addTree(x, z, scale = 1, canopy = COLORS.mauve) {
  const tree = new THREE.Group()
  tree.add(mesh(new THREE.CylinderGeometry(.28, .34, 2.6, 8), 0x8e6d58, { y: 1.3 }))
  const crown = mesh(new THREE.IcosahedronGeometry(1.25, 2), canopy, { y: 3.25 })
  crown.scale.set(.85, 1.35, .85)
  tree.add(crown)
  tree.position.set(x, .4, z)
  tree.scale.setScalar(scale)
  tree.traverse((child) => {
    if (child.isMesh) child.castShadow = false
  })
  world.add(tree)
}

;[
  [-25, 2, 1.2], [-22, -11, .9], [-20, 17, 1], [-11, 16, .8],
  [22, 12, 1.15], [25, -8, .9], [16, 19, .82], [29, 2, .75],
  [-27, 23, .75], [28, 24, .8], [-4, -23, 1], [7, -25, .85],
].forEach(([x,z,s], index) => addTree(x,z,s,index % 3 === 0 ? COLORS.blush : COLORS.mauve))

function addLamp(x, z) {
  const lamp = new THREE.Group()
  lamp.add(mesh(new THREE.CylinderGeometry(.08,.11,2.3,8), COLORS.navy, { y: 1.15 }))
  const glowMat = new THREE.MeshStandardMaterial({ color: COLORS.amber, emissive: COLORS.amber, emissiveIntensity: 1.4, roughness: .4 })
  const glow = new THREE.Mesh(new THREE.SphereGeometry(.27,12,8), glowMat)
  glow.position.y = 2.42
  lamp.add(glow)
  lamp.position.set(x,.5,z)
  lamp.traverse((child) => {
    if (child.isMesh) child.castShadow = false
  })
  world.add(lamp)
}
;[[-5,10],[5,10],[-5,19],[5,19],[-16,7],[17,7],[-16,-4],[17,-4]].forEach(([x,z])=>addLamp(x,z))

const interactables = []
const collisionCircles = []
const movingCars = []
const towerWindowGeometry = new THREE.BoxGeometry(.62, .72, .08)
const towerWindowMaterial = material(0xf6dda5, .5, .02)
const towerWindowMatrix = new THREE.Matrix4()

function addTower({ x, z, width, depth, height, color, accent, rotation = 0 }) {
  const group = new THREE.Group()
  group.position.set(x, .5, z)
  group.rotation.y = rotation
  group.add(mesh(new THREE.BoxGeometry(width, height, depth), color, { y: height / 2 }))

  const crownHeight = Math.max(.7, height * .07)
  group.add(mesh(new THREE.BoxGeometry(width * .84, crownHeight, depth * .84), accent, { y: height + crownHeight / 2 }))

  const floorCount = Math.max(3, Math.floor(height / 3.1))
  const columns = Math.max(2, Math.floor(width / 1.6))
  const windows = new THREE.InstancedMesh(towerWindowGeometry, towerWindowMaterial, floorCount * columns)
  let windowIndex = 0
  for (let floor = 0; floor < floorCount; floor += 1) {
    for (let column = 0; column < columns; column += 1) {
      towerWindowMatrix.makeTranslation(
        (column - (columns - 1) / 2) * 1.18,
        2.1 + floor * 2.6,
        depth / 2 + .045,
      )
      windows.setMatrixAt(windowIndex, towerWindowMatrix)
      windowIndex += 1
    }
  }
  windows.instanceMatrix.needsUpdate = true
  windows.castShadow = false
  windows.receiveShadow = false
  group.add(windows)

  const door = mesh(new THREE.BoxGeometry(1.35, 2.25, .12), COLORS.navy, { y: 1.12, z: depth / 2 + .07 })
  group.add(door)
  group.traverse((child) => {
    if (child.isMesh) child.castShadow = false
  })
  world.add(group)
  collisionCircles.push({ x, z, r: Math.max(width, depth) * .53 })
  return group
}

;[
  { x: -38, z: -18, width: 8, depth: 8, height: 18, color: 0xb79089, accent: COLORS.coral, rotation: .14 },
  { x: -23, z: -39, width: 9, depth: 7, height: 23, color: 0x7f9292, accent: COLORS.amber, rotation: -.16 },
  { x: 22, z: -39, width: 9, depth: 8, height: 26, color: 0x7988a0, accent: COLORS.navy, rotation: .12 },
  { x: 39, z: -17, width: 8, depth: 9, height: 20, color: 0xa68d9a, accent: COLORS.blush, rotation: -.18 },
  { x: 40, z: 16, width: 8, depth: 8, height: 17, color: 0x9eaa8e, accent: COLORS.amber, rotation: .2 },
  { x: 27, z: 37, width: 9, depth: 7, height: 21, color: 0xc29c86, accent: COLORS.coral, rotation: -.12 },
  { x: -27, z: 38, width: 8, depth: 8, height: 16, color: 0x8896aa, accent: COLORS.navy, rotation: .16 },
  { x: -41, z: 13, width: 7, depth: 9, height: 14, color: 0xa7a18e, accent: COLORS.sage, rotation: -.1 },
].forEach(addTower)

function addCar(angle, radius, speed, color) {
  const car = new THREE.Group()
  car.add(mesh(new THREE.BoxGeometry(3.1, .72, 1.55), color, { y: .82 }))
  car.add(mesh(new THREE.BoxGeometry(1.65, .62, 1.32), 0xd7c4b7, { x: -.18, y: 1.47 }))
  const wheelGeometry = new THREE.CylinderGeometry(.31, .31, .24, 10)
  ;[[-.95,-.75],[.95,-.75],[-.95,.75],[.95,.75]].forEach(([x,z]) => {
    const wheel = mesh(wheelGeometry, COLORS.charcoal, { x, y: .45, z })
    wheel.rotation.x = Math.PI / 2
    car.add(wheel)
  })
  car.userData.angle = angle
  car.userData.radius = radius
  car.userData.speed = speed
  car.position.set(Math.cos(angle) * radius, .55, Math.sin(angle) * radius)
  car.traverse((child) => {
    if (child.isMesh) child.castShadow = false
  })
  world.add(car)
  movingCars.push(car)
}

addCar(.25, 27.3, .12, COLORS.coral)
addCar(2.1, 30.4, -.09, COLORS.navy)
addCar(3.9, 27.3, .1, COLORS.amber)
addCar(5.35, 30.4, -.11, COLORS.sage)

function addHumanPavilion() {
  const group = new THREE.Group()
  group.position.set(-12, .5, -2)
  group.add(mesh(new THREE.CylinderGeometry(6.2, 6.6, 3.2, 24), COLORS.paper, { y: 1.6 }))
  const dome = mesh(new THREE.SphereGeometry(6.2, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), COLORS.blush, { y: 3.2 })
  dome.scale.y = .72
  group.add(dome)
  group.add(mesh(new THREE.BoxGeometry(.55, 6.4, 6.5), COLORS.navy, { x: -.28, y: 2.8, z: 0 }))
  group.add(mesh(new THREE.BoxGeometry(.22, 6.45, 6.7), COLORS.coral, { x: .28, y: 2.8, z: 0 }))
  const door = mesh(new THREE.BoxGeometry(2.2, 2.9, .32), COLORS.navy, { y: 1.45, z: 6.15 })
  group.add(door)
  const insight = new THREE.Mesh(new THREE.SphereGeometry(.22, 12, 8), new THREE.MeshStandardMaterial({color:COLORS.amber,emissive:COLORS.amber,emissiveIntensity:1.6}))
  insight.position.set(0, 4.5, 5.05)
  group.add(insight)
  world.add(group)
  interactables.push({ id: 'human', title: 'Enter Human Instincts', position: new THREE.Vector3(-12, 0, 5.4), radius: 4.2, group })
  collisionCircles.push({ x: -12, z: -2, r: 6.2 })
  return group
}

function addChatGPTShop() {
  const group = new THREE.Group()
  group.position.set(12, .5, -3)
  group.add(mesh(new THREE.BoxGeometry(10.5, 6.2, 9), COLORS.sage, { y: 3.1 }))
  const roof = mesh(new THREE.CylinderGeometry(5.45, 5.45, 10.7, 18, 1, false, 0, Math.PI), 0x6c8071, { y: 6.15, ry: Math.PI / 2 })
  roof.rotation.z = Math.PI / 2
  roof.scale.y = .55
  group.add(roof)
  group.add(mesh(new THREE.BoxGeometry(2.15, 3.35, .32), COLORS.charcoal, { y: 1.68, z: 4.52 }))
  const emblem = new THREE.Group()
  for (let i = 0; i < 6; i += 1) {
    const pill = mesh(new THREE.CapsuleGeometry(.16, 1.15, 4, 8), COLORS.cream, { y: 5.1, z: 4.72 })
    pill.rotation.z = (i / 6) * Math.PI * 2
    pill.position.x = Math.cos((i / 6) * Math.PI * 2) * .62
    pill.position.y += Math.sin((i / 6) * Math.PI * 2) * .62
    emblem.add(pill)
  }
  group.add(emblem)
  world.add(group)
  interactables.push({ id: 'chatgpt', title: 'Inspect ChatGPT Skill Shop', position: new THREE.Vector3(12, 0, 4.7), radius: 4.1, group })
  collisionCircles.push({ x: 12, z: -3, r: 6.2 })
  return group
}

function addFutureShop() {
  const group = new THREE.Group()
  group.position.set(0, .5, -23)
  group.add(mesh(new THREE.BoxGeometry(8, 4.6, 6), 0xb8a39a, { y: 2.3 }))
  group.add(mesh(new THREE.ConeGeometry(5.4, 2.7, 6), COLORS.mauve, { y: 6 }))
  group.add(mesh(new THREE.BoxGeometry(1.8, 2.4, .3), COLORS.charcoal, { y: 1.2, z: 3.15 }))
  const lock = mesh(new THREE.TorusGeometry(.52, .15, 8, 18, Math.PI), COLORS.amber, { y: 4.2, z: 3.2 })
  group.add(lock)
  world.add(group)
  collisionCircles.push({ x: 0, z: -23, r: 5.2 })
}

function addWorldWaypoint(position, color = COLORS.coral) {
  const marker = new THREE.Group()
  const markerMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .82, depthWrite: false })
  const beamMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .16, depthWrite: false })
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.17, .34, 4.4, 12, 1, true), beamMaterial)
  beam.position.y = 2.35
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(.58, 0), markerMaterial)
  diamond.position.y = 4.6
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, .08, 8, 28), markerMaterial)
  ring.rotation.x = Math.PI / 2
  ring.position.y = .22
  marker.add(beam, diamond, ring)
  marker.position.copy(position)
  marker.userData.diamond = diamond
  marker.userData.ring = ring
  world.add(marker)
  return marker
}

const humanBuilding = addHumanPavilion()
const chatgptBuilding = addChatGPTShop()
addFutureShop()
const humanWaypoint = addWorldWaypoint(new THREE.Vector3(-12, .5, 5.4))

function makeBlob(color = COLORS.blush, scale = 1, eyes = true) {
  const blob = new THREE.Group()
  const body = mesh(new THREE.SphereGeometry(1, 20, 16), color, { y: 1.55 })
  body.scale.set(1.05, 1.35, .95)
  blob.add(body)
  const footGeo = new THREE.CapsuleGeometry(.28, .45, 5, 10)
  const leftFoot = mesh(footGeo, color, { x: -.48, y: .45, z: -.05 })
  const rightFoot = mesh(footGeo, color, { x: .48, y: .45, z: -.05 })
  blob.add(leftFoot, rightFoot)
  if (eyes) {
    const eyeGeo = new THREE.SphereGeometry(.34, 16, 12)
    const eyeMat = material(0xfffbf3, .65, 0)
    ;[-.38,.38].forEach((x) => {
      const eye = new THREE.Mesh(eyeGeo, eyeMat)
      eye.position.set(x,1.82,-.83)
      eye.scale.set(.9,1.12,.45)
      blob.add(eye)
      const pupil = mesh(new THREE.SphereGeometry(.14,12,8), COLORS.navy, { x, y: 1.8, z: -1.08 })
      blob.add(pupil)
    })
  }
  blob.scale.setScalar(scale)
  blob.traverse((child) => { if (child.isMesh) child.castShadow = true })
  return blob
}

const player = makeBlob(COLORS.navy, 1.05)
player.position.set(0, .5, 24)
world.add(player)

const playerShadow = new THREE.Mesh(
  new THREE.CircleGeometry(1.35, 20),
  new THREE.MeshBasicMaterial({ color: COLORS.navy, transparent: true, opacity: .13, depthWrite: false }),
)
playerShadow.rotation.x = -Math.PI / 2
playerShadow.position.set(player.position.x, .56, player.position.z)
world.add(playerShadow)

const pendant = new THREE.Mesh(new THREE.SphereGeometry(.18, 12, 8), new THREE.MeshStandardMaterial({color:COLORS.amber,emissive:COLORS.amber,emissiveIntensity:1.8}))
pendant.scale.set(.7,1.25,.55)
pendant.position.set(0,1.28,-1.04)
player.add(pendant)

const npcSeeds = [
  [-19, 12, COLORS.coral, .65], [-17, 9, COLORS.blush, .58], [20, 15, COLORS.mauve, .7],
  [17, 12, COLORS.amber, .55], [-3, -14, COLORS.blush, .62], [7, -15, COLORS.coral, .55],
  [-8, 15, COLORS.sage, .52], [9, 18, COLORS.water, .62], [-20, -14, COLORS.amber, .58],
  [20, -15, COLORS.blush, .64], [-8, -23, COLORS.mauve, .54], [10, -22, COLORS.coral, .6],
  [-31, 5, COLORS.water, .56], [31, 6, COLORS.amber, .52], [-29, 26, COLORS.blush, .58],
  [29, 27, COLORS.sage, .64], [-4, 30, COLORS.coral, .52], [5, 33, COLORS.mauve, .57],
]
const npcAgents = npcSeeds.map(([x, z, color, scale], index) => ({
  originX: x,
  originZ: z,
  color,
  scale,
  phase: index * 1.7,
  wanderRadius: .35 + (index % 4) * .22,
  wanderSpeed: .16 + (index % 5) * .025,
}))
const npcBodyInstances = new THREE.InstancedMesh(
  new THREE.SphereGeometry(1, 14, 10),
  material(0xffffff),
  npcAgents.length,
)
const npcFootInstances = new THREE.InstancedMesh(
  new THREE.CapsuleGeometry(.28, .45, 4, 8),
  material(0xffffff),
  npcAgents.length * 2,
)
npcBodyInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
npcFootInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
npcBodyInstances.castShadow = false
npcFootInstances.castShadow = false
npcAgents.forEach((npc, index) => {
  const color = new THREE.Color(npc.color)
  npcBodyInstances.setColorAt(index, color)
  npcFootInstances.setColorAt(index * 2, color)
  npcFootInstances.setColorAt(index * 2 + 1, color)
})
npcBodyInstances.instanceColor.needsUpdate = true
npcFootInstances.instanceColor.needsUpdate = true
world.add(npcBodyInstances, npcFootInstances)
const npcDummy = new THREE.Object3D()

function updateNpcInstances(elapsed) {
  npcAgents.forEach((npc, index) => {
    const angle = elapsed * npc.wanderSpeed + npc.phase
    const x = npc.originX + Math.cos(angle) * npc.wanderRadius
    const y = .5 + Math.sin(elapsed * 1.4 + npc.phase) * .055
    const z = npc.originZ + Math.sin(angle) * npc.wanderRadius
    const yaw = -angle

    npcDummy.position.set(x, y + 1.55 * npc.scale, z)
    npcDummy.rotation.set(0, yaw, 0)
    npcDummy.scale.set(1.05 * npc.scale, 1.35 * npc.scale, .95 * npc.scale)
    npcDummy.updateMatrix()
    npcBodyInstances.setMatrixAt(index, npcDummy.matrix)

    ;[-.48, .48].forEach((footX, footIndex) => {
      const localX = footX * npc.scale
      const localZ = -.05 * npc.scale
      const offsetX = localX * Math.cos(yaw) + localZ * Math.sin(yaw)
      const offsetZ = -localX * Math.sin(yaw) + localZ * Math.cos(yaw)
      npcDummy.position.set(x + offsetX, y + .45 * npc.scale, z + offsetZ)
      npcDummy.rotation.set(0, yaw, 0)
      npcDummy.scale.setScalar(npc.scale)
      npcDummy.updateMatrix()
      npcFootInstances.setMatrixAt(index * 2 + footIndex, npcDummy.matrix)
    })
  })
  npcBodyInstances.instanceMatrix.needsUpdate = true
  npcFootInstances.instanceMatrix.needsUpdate = true
}

const labelAnchors = {
  human: new THREE.Vector3(-12, 9.6, -2),
  chatgpt: new THREE.Vector3(12, 10.4, -3),
}

function updateLabel(id, vector) {
  const node = $(`#label-${id}`)
  const projected = vector.clone().project(camera)
  const visible = projected.z < 1 && Math.abs(projected.x) < 1.15 && Math.abs(projected.y) < 1.15
  node.style.opacity = visible ? '1' : '0'
  node.style.left = `${(projected.x * .5 + .5) * innerWidth}px`
  node.style.top = `${(-projected.y * .5 + .5) * innerHeight}px`
}

function placeRadarMarker(node, target) {
  const dx = target.x - player.position.x
  const dz = target.z - player.position.z
  const cosine = Math.cos(state.cameraYaw)
  const sine = Math.sin(state.cameraYaw)
  let radarX = (dx * cosine - dz * sine) * 2.15
  let radarY = (dx * sine + dz * cosine) * 2.15
  const ellipseDistance = Math.hypot(radarX / 51, radarY / 34)
  if (ellipseDistance > 1) {
    radarX /= ellipseDistance
    radarY /= ellipseDistance
  }
  node.style.left = `${61 + radarX}px`
  node.style.top = `${44 + radarY}px`
}

function updateRadar() {
  const human = interactables.find((entry) => entry.id === 'human')
  const chatgpt = interactables.find((entry) => entry.id === 'chatgpt')
  placeRadarMarker(radarHuman, human.position)
  placeRadarMarker(radarChatgpt, chatgpt.position)
  const objective = state.objectiveId === 'chatgpt' ? chatgpt : human
  const distance = Math.hypot(
    objective.position.x - player.position.x,
    objective.position.z - player.position.z,
  )
  const metres = Math.max(0, Math.round(distance * 5))
  radarTitle.textContent = objective.id === 'human' ? 'HUMAN INSTINCTS' : 'CHATGPT SKILL SHOP'
  radarDistance.textContent = distance < 4.35 ? 'LOCATION REACHED · PRESS E' : `${metres} M · FOLLOW MARKER`
  objectiveDistance.textContent = objective.id === 'human'
    ? (distance < 4.35 ? 'Entrance reached' : `${metres} m away`)
    : 'Playable now'
}

function setPaused(value) {
  state.paused = value
  pauseScreen.classList.toggle('is-visible', value)
  pauseScreen.setAttribute('aria-hidden', String(!value))
}

function openLocation(location) {
  if (!location) return
  state.modalOpen = true
  state.paused = true
  const human = location.id === 'human'
  $('#modal-eyebrow').textContent = human ? 'LOCATION 01 / LIVE' : 'LOCATION 02 / PROTOTYPE'
  $('#modal-title').textContent = human ? 'Human Instincts' : 'ChatGPT Skill Shop'
  $('#modal-copy').textContent = human
    ? 'The first live experience inside AtlasVerse—three visual decisions measuring five human instinct parameters.'
    : 'The next Skill Shop. Its shell proves where continuously updated ChatGPT mini-games will live.'
  $('#modal-status').textContent = human ? 'PLAYABLE BUILD CONNECTED' : 'WORLD SHELL READY'
  $('#modal-primary').textContent = human ? 'OPEN HUMAN INSTINCTS' : 'CLOSE AND KEEP EXPLORING'
  $('#modal-primary').dataset.target = human ? 'human' : 'close'
  locationModal.classList.add('is-visible')
  locationModal.setAttribute('aria-hidden', 'false')
  playRumble(state.activeGamepad, 'success').catch(() => {})
}

function closeLocation() {
  state.modalOpen = false
  state.paused = false
  locationModal.classList.remove('is-visible')
  locationModal.setAttribute('aria-hidden', 'true')
}

function tryInteract() {
  if (state.modalOpen) return
  if (!state.nearLocation) return
  if (state.nearLocation.id === 'human') {
    playRumble(state.activeGamepad, 'success').catch(() => {})
    shell.classList.add('is-entering-location')
    window.setTimeout(() => window.location.assign('/'), 260)
    return
  }
  openLocation(state.nearLocation)
}

function triggerJump() {
  if (!state.started || state.paused || state.modalOpen || !state.grounded) return
  state.grounded = false
  state.jumpVelocity = 8.4
  playRumble(state.activeGamepad, 'select').catch(() => {})
}

function resolveCollision(next) {
  const edge = Math.hypot(next.x, next.z)
  if (edge > 47.2) {
    const scale = 47.2 / edge
    next.x *= scale
    next.z *= scale
  }
  collisionCircles.forEach((circle) => {
    const dx = next.x - circle.x
    const dz = next.z - circle.z
    const distance = Math.hypot(dx, dz)
    const minimum = circle.r + 1.15
    if (distance < minimum) {
      const safe = Math.max(distance, .001)
      next.x = circle.x + (dx / safe) * minimum
      next.z = circle.z + (dz / safe) * minimum
    }
  })
}

const clock = new THREE.Clock()
const cameraTarget = new THREE.Vector3()
const forward = new THREE.Vector3()
const right = new THREE.Vector3()
const desiredMove = new THREE.Vector3()
const nextPosition = new THREE.Vector3()
let fpsFrames = 0
let fpsElapsed = 0

function updatePlayer(dt, elapsed) {
  const keyX = (state.keys.has('KeyD') || state.keys.has('ArrowRight') ? 1 : 0) - (state.keys.has('KeyA') || state.keys.has('ArrowLeft') ? 1 : 0)
  const keyY = (state.keys.has('KeyW') || state.keys.has('ArrowUp') ? 1 : 0) - (state.keys.has('KeyS') || state.keys.has('ArrowDown') ? 1 : 0)
  const inputX = Math.abs(keyX) > 0 ? keyX : state.gamepadMove.x
  const inputY = Math.abs(keyY) > 0 ? keyY : -state.gamepadMove.y
  const magnitude = Math.min(1, Math.hypot(inputX, inputY))

  state.cameraYawTarget -= state.gamepadCamera.x * dt * 2.7
  state.cameraPitchTarget = THREE.MathUtils.clamp(state.cameraPitchTarget + state.gamepadCamera.y * dt * 1.75, -1.08, 1.22)

  forward.set(-Math.sin(state.cameraYaw), 0, -Math.cos(state.cameraYaw))
  right.set(Math.cos(state.cameraYaw), 0, -Math.sin(state.cameraYaw))
  desiredMove.copy(forward).multiplyScalar(inputY).addScaledVector(right, inputX)
  if (desiredMove.lengthSq() > 1) desiredMove.normalize()

  const sprint = state.keys.has('ShiftLeft') || state.keys.has('ShiftRight') || Boolean(state.gamepadButtons[5]?.pressed)
  const speed = sprint ? 10.5 : 6.4
  nextPosition.copy(player.position).addScaledVector(desiredMove, speed * dt)
  resolveCollision(nextPosition)
  player.position.copy(nextPosition)

  if (!state.grounded) {
    state.jumpVelocity -= 22 * dt
    state.jumpOffset += state.jumpVelocity * dt
    if (state.jumpOffset <= 0) {
      state.jumpOffset = 0
      state.jumpVelocity = 0
      state.grounded = true
      playRumble(state.activeGamepad, 'select').catch(() => {})
    }
  }

  let strideBob = 0
  if (magnitude > .06) {
    const targetAngle = Math.atan2(-desiredMove.x, -desiredMove.z)
    let delta = targetAngle - player.rotation.y
    delta = Math.atan2(Math.sin(delta), Math.cos(delta))
    player.rotation.y += delta * Math.min(1, dt * 12)
    strideBob = Math.sin(elapsed * (sprint ? 15 : 11)) * .075
  }
  player.position.y = .5 + state.jumpOffset + strideBob

  state.nearLocation = interactables
    .map((location) => ({ location, distance: player.position.distanceTo(location.position) }))
    .filter(({ distance }) => distance <= 4.35)
    .sort((a,b) => a.distance - b.distance)[0]?.location || null
  interactionPrompt.classList.toggle('is-visible', Boolean(state.nearLocation) && state.started && !state.modalOpen)
  if (state.nearLocation) $('#interaction-title').textContent = state.nearLocation.title
}

function updateCamera(dt) {
  const orbitEase = 1 - Math.exp(-dt * 12)
  const yawDelta = Math.atan2(
    Math.sin(state.cameraYawTarget - state.cameraYaw),
    Math.cos(state.cameraYawTarget - state.cameraYaw),
  )
  state.cameraYaw += yawDelta * orbitEase
  state.cameraPitch = THREE.MathUtils.lerp(state.cameraPitch, state.cameraPitchTarget, orbitEase)
  const distance = 14
  const horizontalDistance = Math.cos(state.cameraPitch) * distance
  const verticalDistance = Math.sin(state.cameraPitch) * distance
  cameraTarget.set(player.position.x, player.position.y + 1.45, player.position.z)
  const desired = new THREE.Vector3(
    cameraTarget.x + Math.sin(state.cameraYaw) * horizontalDistance,
    Math.max(1.2, cameraTarget.y + 2.2 + verticalDistance),
    cameraTarget.z + Math.cos(state.cameraYaw) * horizontalDistance,
  )
  camera.position.lerp(desired, 1 - Math.exp(-dt * 9))
  camera.lookAt(cameraTarget)
}

function animate() {
  requestAnimationFrame(animate)
  const dt = Math.min(clock.getDelta(), .05)
  const elapsed = clock.elapsedTime
  if (state.started && !state.paused) updatePlayer(dt, elapsed)
  updateCamera(dt)

  updateNpcInstances(elapsed)
  movingCars.forEach((car) => {
    car.userData.angle += car.userData.speed * dt
    const angle = car.userData.angle
    car.position.x = Math.cos(angle) * car.userData.radius
    car.position.z = Math.sin(angle) * car.userData.radius
    car.rotation.y = -angle + (car.userData.speed > 0 ? -Math.PI / 2 : Math.PI / 2)
  })
  playerShadow.position.x = player.position.x
  playerShadow.position.z = player.position.z
  const shadowScale = 1 - Math.min(state.jumpOffset / 4, .32)
  playerShadow.scale.setScalar(shadowScale)
  humanBuilding.rotation.y = Math.sin(elapsed * .22) * .006
  chatgptBuilding.rotation.y = Math.sin(elapsed * .19 + 1) * .005
  humanWaypoint.userData.diamond.rotation.y = elapsed * 1.35
  humanWaypoint.userData.diamond.position.y = 4.6 + Math.sin(elapsed * 2.4) * .16
  humanWaypoint.userData.ring.scale.setScalar(1 + Math.sin(elapsed * 2.1) * .08)
  distantStars.rotation.y = elapsed * .003
  galaxyStars.rotation.y = elapsed * .002
  updateLabel('human', labelAnchors.human)
  updateLabel('chatgpt', labelAnchors.chatgpt)
  updateRadar()
  renderer.render(scene, camera)

  fpsFrames += 1
  fpsElapsed += dt
  if (fpsElapsed >= 1) {
    const fps = Math.round(fpsFrames / fpsElapsed)
    $('#performance-pill').textContent = `${fps} FPS · POLYGON PROTOTYPE`
    fpsFrames = 0
    fpsElapsed = 0
  }
}

const adapter = new GamepadAdapter({
  onConnection(gamepad) {
    state.activeGamepad = gamepad
    controllerState.classList.toggle('is-connected', Boolean(gamepad))
    controllerState.querySelector('span').textContent = gamepad ? 'DUALSENSE CONNECTED' : 'KEYBOARD READY'
  },
  onSnapshot(snapshot) {
    state.gamepadMove = snapshot.move
    state.gamepadCamera = snapshot.camera
    state.gamepadButtons = snapshot.buttons
  },
  onAction(event) {
    if (event.index === 0) {
      if (!state.started) $('#enter-world').click()
      else if (state.modalOpen) $('#modal-primary').click()
      else triggerJump()
    }
    if (event.index === 2 && state.started && !state.modalOpen) tryInteract()
    if (event.index === 1 && state.modalOpen) closeLocation()
    if (event.index === 9 && state.started && !state.modalOpen) setPaused(!state.paused)
    if (event.index === 11) {
      state.cameraYaw = 0
      state.cameraPitch = -.06
      state.cameraYawTarget = 0
      state.cameraPitchTarget = -.06
    }
  },
})
adapter.start()

window.addEventListener('keydown', (event) => {
  state.keys.add(event.code)
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code)) event.preventDefault()
  if (event.code === 'Space') triggerJump()
  if (event.code === 'KeyE' || event.code === 'Enter') {
    if (!state.started) $('#enter-world').click()
    else if (state.modalOpen) $('#modal-primary').click()
    else tryInteract()
  }
  if (event.code === 'Escape' && state.modalOpen) closeLocation()
  if (event.code === 'KeyP' && state.started && !state.modalOpen) setPaused(!state.paused)
  if (event.code === 'KeyI') state.cameraPitchTarget = THREE.MathUtils.clamp(state.cameraPitchTarget - .16, -1.08, 1.22)
  if (event.code === 'KeyK') state.cameraPitchTarget = THREE.MathUtils.clamp(state.cameraPitchTarget + .16, -1.08, 1.22)
  if (event.code === 'KeyJ') state.cameraYawTarget += .18
  if (event.code === 'KeyL') state.cameraYawTarget -= .18
  if (event.code === 'KeyF') {
    state.cameraYaw = 0
    state.cameraPitch = -.06
    state.cameraYawTarget = 0
    state.cameraPitchTarget = -.06
  }
})
window.addEventListener('keyup', (event) => state.keys.delete(event.code))

renderer.domElement.addEventListener('pointerdown', (event) => {
  state.pointerDown = true
  state.pointerX = event.clientX
  state.pointerY = event.clientY
  renderer.domElement.setPointerCapture(event.pointerId)
})
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!state.pointerDown || state.paused) return
  state.cameraYawTarget -= (event.clientX - state.pointerX) * .006
  state.cameraPitchTarget = THREE.MathUtils.clamp(state.cameraPitchTarget + (event.clientY - state.pointerY) * .005, -1.08, 1.22)
  state.pointerX = event.clientX
  state.pointerY = event.clientY
})
renderer.domElement.addEventListener('pointerup', () => { state.pointerDown = false })

$('#enter-world').addEventListener('click', () => {
  state.started = true
  $('#entry-screen').classList.add('is-hidden')
  renderer.domElement.focus({ preventScroll: true })
  playRumble(state.activeGamepad, 'success').catch(() => {})
})
$('#modal-close').addEventListener('click', closeLocation)
$('#modal-primary').addEventListener('click', (event) => {
  if (event.currentTarget.dataset.target === 'human') window.location.href = '/'
  else closeLocation()
})

document.querySelectorAll('[data-focus]').forEach((button) => {
  button.addEventListener('click', () => {
    const target = interactables.find((entry) => entry.id === button.dataset.focus)
    if (!target) return
    state.objectiveId = target.id
    document.querySelectorAll('[data-focus]').forEach((item) => item.classList.toggle('is-active', item === button))
    playRumble(state.activeGamepad, 'select').catch(() => {})
  })
})

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1))
  renderer.setSize(innerWidth, innerHeight)
})
window.addEventListener('beforeunload', () => adapter.stop())

updateCamera(1)
animate()
