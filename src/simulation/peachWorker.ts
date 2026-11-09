/// <reference lib="webworker" />

import { createPeachLattice } from './lattice'
import type { SimulationMetrics, Vec3, WorkerCommand, WorkerMessage } from './types'

const lattice = createPeachLattice()
const restPositions = Float32Array.from(lattice.positions)
const positions = Float32Array.from(lattice.positions)
const previousPositions = Float32Array.from(lattice.positions)
const nodeCount = lattice.nodeCount
const massPerNode = 7.11 / nodeCount
const fixedDt = 1 / 60
const substeps = 10
const floorY = -0.95
const seedStonePosition: Vec3 = [0.08, 0.13, -0.015]

const restCenter = new Float32Array(3)
const restCavityCenter = new Float32Array(3)
const cavityNodeIndices: number[] = []
const restTetraVolumes = new Float32Array(lattice.tetraCount)
const edgeRestLengths = new Float32Array(lattice.edgeCount)

let stiffness = 0.72
let damping = 0.38
let timeScale = 1
let paused = false
let dragTarget: Vec3 | null = null
let dragMode: 'peach' | 'stone' | null = null
let draggedNodes: number[] = []
let draggedOffsets: Float32Array = new Float32Array(0)
let stonePosition: Vec3 = [...seedStonePosition]
let stoneVelocity: Vec3 = [0, 0, 0]
let stoneQuaternion: [number, number, number, number] = [-0.08, 0.12, -0.04, 0.99]
let stoneAngularVelocity: Vec3 = [0, 0, 0]
let stoneSeated = true
let adhesion = 1
let lastFrameAt = performance.now()
let smoothedFps = 60
let lastSolverTick = performance.now()
let solverAccumulator = 0

for (let node = 0; node < nodeCount; node += 1) {
  restCenter[0] += restPositions[node * 3]
  restCenter[1] += restPositions[node * 3 + 1]
  restCenter[2] += restPositions[node * 3 + 2]
}
restCenter[0] /= nodeCount
restCenter[1] /= nodeCount
restCenter[2] /= nodeCount

for (let node = 0; node < nodeCount; node += 1) {
  const x = restPositions[node * 3]
  const y = restPositions[node * 3 + 1]
  const z = restPositions[node * 3 + 2]
  if (x * x + z * z < 0.2 && y > -0.52) {
    cavityNodeIndices.push(node)
    restCavityCenter[0] += x
    restCavityCenter[1] += y
    restCavityCenter[2] += z
  }
}
restCavityCenter[0] /= Math.max(1, cavityNodeIndices.length)
restCavityCenter[1] /= Math.max(1, cavityNodeIndices.length)
restCavityCenter[2] /= Math.max(1, cavityNodeIndices.length)

const seatOffset: Vec3 = [
  seedStonePosition[0] - restCavityCenter[0],
  seedStonePosition[1] - restCavityCenter[1],
  seedStonePosition[2] - restCavityCenter[2],
]

for (let edge = 0; edge < lattice.edgeCount; edge += 1) {
  const a = lattice.edges[edge * 2]
  const b = lattice.edges[edge * 2 + 1]
  const dx = restPositions[a * 3] - restPositions[b * 3]
  const dy = restPositions[a * 3 + 1] - restPositions[b * 3 + 1]
  const dz = restPositions[a * 3 + 2] - restPositions[b * 3 + 2]
  edgeRestLengths[edge] = Math.sqrt(dx * dx + dy * dy + dz * dz)
}

const tetraVolume = (tetra: number) => {
  const offset = tetra * 4
  const a = lattice.tets[offset]
  const b = lattice.tets[offset + 1]
  const c = lattice.tets[offset + 2]
  const d = lattice.tets[offset + 3]
  const ax = positions[a * 3]
  const ay = positions[a * 3 + 1]
  const az = positions[a * 3 + 2]
  const ux = positions[b * 3] - ax
  const uy = positions[b * 3 + 1] - ay
  const uz = positions[b * 3 + 2] - az
  const vx = positions[c * 3] - ax
  const vy = positions[c * 3 + 1] - ay
  const vz = positions[c * 3 + 2] - az
  const wx = positions[d * 3] - ax
  const wy = positions[d * 3 + 1] - ay
  const wz = positions[d * 3 + 2] - az
  return (wx * (uy * vz - uz * vy) + wy * (uz * vx - ux * vz) + wz * (ux * vy - uy * vx)) / 6
}

for (let tetra = 0; tetra < lattice.tetraCount; tetra += 1) {
  restTetraVolumes[tetra] = tetraVolume(tetra)
}

const correctDistance = (a: number, b: number, restLength: number, compliance: number) => {
  const ax = positions[a * 3]
  const ay = positions[a * 3 + 1]
  const az = positions[a * 3 + 2]
  const bx = positions[b * 3]
  const by = positions[b * 3 + 1]
  const bz = positions[b * 3 + 2]
  const dx = ax - bx
  const dy = ay - by
  const dz = az - bz
  const length = Math.hypot(dx, dy, dz)
  if (length < 1e-8) return
  const nx = dx / length
  const ny = dy / length
  const nz = dz / length
  const gradientWeight = 1 / massPerNode + 1 / massPerNode
  const lambda = -(length - restLength) / (gradientWeight + compliance)
  const correctionA = THREE_CLAMP(lambda / massPerNode, -0.018, 0.018)
  positions[a * 3] += nx * correctionA
  positions[a * 3 + 1] += ny * correctionA
  positions[a * 3 + 2] += nz * correctionA
  positions[b * 3] -= nx * correctionA
  positions[b * 3 + 1] -= ny * correctionA
  positions[b * 3 + 2] -= nz * correctionA
}

const correctTetraVolume = (tetra: number, compliance: number) => {
  const offset = tetra * 4
  const ia = lattice.tets[offset]
  const ib = lattice.tets[offset + 1]
  const ic = lattice.tets[offset + 2]
  const id = lattice.tets[offset + 3]
  const ax = positions[ia * 3]
  const ay = positions[ia * 3 + 1]
  const az = positions[ia * 3 + 2]
  const bx = positions[ib * 3]
  const by = positions[ib * 3 + 1]
  const bz = positions[ib * 3 + 2]
  const cx = positions[ic * 3]
  const cy = positions[ic * 3 + 1]
  const cz = positions[ic * 3 + 2]
  const dx = positions[id * 3]
  const dy = positions[id * 3 + 1]
  const dz = positions[id * 3 + 2]

  const ux = bx - ax
  const uy = by - ay
  const uz = bz - az
  const vx = cx - ax
  const vy = cy - ay
  const vz = cz - az
  const wx = dx - ax
  const wy = dy - ay
  const wz = dz - az

  const gdx = (uy * vz - uz * vy) / 6
  const gdy = (uz * vx - ux * vz) / 6
  const gdz = (ux * vy - uy * vx) / 6
  const gbx = (vy * wz - vz * wy) / 6
  const gby = (vz * wx - vx * wz) / 6
  const gbz = (vx * wy - vy * wx) / 6
  const gcx = (wy * uz - wz * uy) / 6
  const gcy = (wz * ux - wx * uz) / 6
  const gcz = (wx * uy - wy * ux) / 6
  const gax = -(gdx + gbx + gcx)
  const gay = -(gdy + gby + gcy)
  const gaz = -(gdz + gbz + gcz)
  const gradientWeight =
    (gax * gax + gay * gay + gaz * gaz) / massPerNode +
    (gbx * gbx + gby * gby + gbz * gbz) / massPerNode +
    (gcx * gcx + gcy * gcy + gcz * gcz) / massPerNode +
    (gdx * gdx + gdy * gdy + gdz * gdz) / massPerNode
  if (gradientWeight < 1e-12 || gradientWeight > 1e4) return

  const volume = tetraVolume(tetra)
  const target = restTetraVolumes[tetra]
  const lambda = -(volume - target) / (gradientWeight + compliance)
  const correction = THREE_CLAMP(lambda / massPerNode, -0.012, 0.012)
  positions[ia * 3] += gax * correction
  positions[ia * 3 + 1] += gay * correction
  positions[ia * 3 + 2] += gaz * correction
  positions[ib * 3] += gbx * correction
  positions[ib * 3 + 1] += gby * correction
  positions[ib * 3 + 2] += gbz * correction
  positions[ic * 3] += gcx * correction
  positions[ic * 3 + 1] += gcy * correction
  positions[ic * 3 + 2] += gcz * correction
  positions[id * 3] += gdx * correction
  positions[id * 3 + 1] += gdy * correction
  positions[id * 3 + 2] += gdz * correction
}

const applyShapeMatching = (strength: number) => {
  let centerX = 0
  let centerY = 0
  let centerZ = 0

  for (let node = 0; node < nodeCount; node += 1) {
    centerX += positions[node * 3]
    centerY += positions[node * 3 + 1]
    centerZ += positions[node * 3 + 2]
  }
  centerX /= nodeCount
  centerY /= nodeCount
  centerZ /= nodeCount

  const weak = strength * (1 - damping * 0.2)
  const translateX = (restCenter[0] - centerX) * Math.min(0.28, strength * 6)
  const translateY = (restCenter[1] - centerY) * Math.min(0.18, strength * 4)
  const translateZ = (restCenter[2] - centerZ) * Math.min(0.28, strength * 6)
  for (let node = 0; node < nodeCount; node += 1) {
    const base = node * 3
    const targetX = restPositions[base] + translateX
    const targetY = restPositions[base + 1] + translateY
    const targetZ = restPositions[base + 2] + translateZ
    positions[base] += (targetX - positions[base]) * weak
    positions[base + 1] += (targetY - positions[base + 1]) * weak
    positions[base + 2] += (targetZ - positions[base + 2]) * weak
  }
}

const stabilizeTranslation = () => {
  let meanVx = 0
  let meanVy = 0
  let meanVz = 0
  for (let node = 0; node < nodeCount; node += 1) {
    const base = node * 3
    meanVx += positions[base] - previousPositions[base]
    meanVy += positions[base + 1] - previousPositions[base + 1]
    meanVz += positions[base + 2] - previousPositions[base + 2]
  }
  meanVx /= nodeCount
  meanVy /= nodeCount
  meanVz /= nodeCount
  for (let node = 0; node < nodeCount; node += 1) {
    const base = node * 3
    previousPositions[base] += meanVx * 0.94
    previousPositions[base + 1] += meanVy * 0.94
    previousPositions[base + 2] += meanVz * 0.94
  }
}

const applyPeachDrag = (stepDt: number) => {
  if (dragMode !== 'peach' || !dragTarget) return
  const pull = Math.min(0.2, (0.12 + stiffness * 0.12) * stepDt * 60)
  for (let selected = 0; selected < draggedNodes.length; selected += 1) {
    const node = draggedNodes[selected]
    const targetX = dragTarget[0] + draggedOffsets[selected * 3]
    const targetY = dragTarget[1] + draggedOffsets[selected * 3 + 1]
    const targetZ = dragTarget[2] + draggedOffsets[selected * 3 + 2]
    positions[node * 3] += (targetX - positions[node * 3]) * pull
    positions[node * 3 + 1] += (targetY - positions[node * 3 + 1]) * pull
    positions[node * 3 + 2] += (targetZ - positions[node * 3 + 2]) * pull
    previousPositions[node * 3] = THREE_LERP(previousPositions[node * 3], positions[node * 3], 0.34)
    previousPositions[node * 3 + 1] = THREE_LERP(
      previousPositions[node * 3 + 1],
      positions[node * 3 + 1],
      0.34,
    )
    previousPositions[node * 3 + 2] = THREE_LERP(
      previousPositions[node * 3 + 2],
      positions[node * 3 + 2],
      0.34,
    )
  }
}

const currentCavityTarget = (): Vec3 => {
  let x = 0
  let y = 0
  let z = 0
  for (const node of cavityNodeIndices) {
    x += positions[node * 3]
    y += positions[node * 3 + 1]
    z += positions[node * 3 + 2]
  }
  const inverse = 1 / Math.max(1, cavityNodeIndices.length)
  return [x * inverse + seatOffset[0], y * inverse + seatOffset[1], z * inverse + seatOffset[2]]
}

const applyStoneFleshCoupling = (stepDt: number) => {
  if (stoneSeated) return
  const radiusX = 0.39
  const radiusY = 0.25
  const radiusZ = 0.29
  for (let node = 0; node < nodeCount; node += 1) {
    const base = node * 3
    const dx = (positions[base] - stonePosition[0]) / radiusX
    const dy = (positions[base + 1] - stonePosition[1]) / radiusY
    const dz = (positions[base + 2] - stonePosition[2]) / radiusZ
    const distance = Math.hypot(dx, dy, dz)
    if (distance >= 1 || distance < 1e-5) continue
    const penetration = 1 - distance
    const worldX = (positions[base] - stonePosition[0]) / Math.max(0.01, distance)
    const worldY = (positions[base + 1] - stonePosition[1]) / Math.max(0.01, distance)
    const worldZ = (positions[base + 2] - stonePosition[2]) / Math.max(0.01, distance)
    const push = penetration * Math.min(0.006, stepDt * 1.1)
    positions[base] += worldX * push
    positions[base + 1] += worldY * push
    positions[base + 2] += worldZ * push
    stonePosition[0] -= worldX * push * 0.24
    stonePosition[1] -= worldY * push * 0.24
    stonePosition[2] -= worldZ * push * 0.24
    stoneVelocity[0] -= worldX * push * 1.25
    stoneVelocity[1] -= worldY * push * 1.25
    stoneVelocity[2] -= worldZ * push * 1.25
  }
}

const updateStone = (stepDt: number) => {
  const cavityTarget = currentCavityTarget()
  if (dragMode === 'stone' && dragTarget) {
    const nx = THREE_LERP(stonePosition[0], dragTarget[0], Math.min(1, stepDt * 34))
    const ny = THREE_LERP(stonePosition[1], dragTarget[1], Math.min(1, stepDt * 34))
    const nz = THREE_LERP(stonePosition[2], dragTarget[2], Math.min(1, stepDt * 34))
    stoneVelocity = [(nx - stonePosition[0]) / stepDt, (ny - stonePosition[1]) / stepDt, (nz - stonePosition[2]) / stepDt]
    stoneAngularVelocity = [
      stoneVelocity[1] * 1.8,
      stoneVelocity[0] * 1.4,
      -stoneVelocity[2] * 1.6,
    ]
    stonePosition = [nx, ny, nz]
    stoneSeated = false
    adhesion = Math.max(0, adhesion - stepDt * 2.8)
    const pullX = (dragTarget[0] - cavityTarget[0]) * stepDt * 1.6
    const pullY = (dragTarget[1] - cavityTarget[1]) * stepDt * 1.6
    const pullZ = (dragTarget[2] - cavityTarget[2]) * stepDt * 1.6
    for (const node of cavityNodeIndices) {
      positions[node * 3] += pullX * 0.08
      positions[node * 3 + 1] += pullY * 0.08
      positions[node * 3 + 2] += pullZ * 0.08
    }
    return
  }

  if (stoneSeated) {
    const follow = Math.min(1, stepDt * 12)
    const nx = THREE_LERP(stonePosition[0], cavityTarget[0], follow)
    const ny = THREE_LERP(stonePosition[1], cavityTarget[1], follow)
    const nz = THREE_LERP(stonePosition[2], cavityTarget[2], follow)
    stoneVelocity = [
      (nx - stonePosition[0]) / stepDt,
      (ny - stonePosition[1]) / stepDt,
      (nz - stonePosition[2]) / stepDt,
    ]
    stonePosition = [nx, ny, nz]
    stoneAngularVelocity = [0, 0, 0]
    adhesion = Math.min(1, adhesion + stepDt * 1.4)
    return
  }

  const gravity = -7.8 * stepDt
  stoneVelocity[1] += gravity
  adhesion = Math.max(0, adhesion - stepDt * 0.22)
  stoneVelocity[0] *= 1 - damping * 0.006
  stoneVelocity[1] *= 1 - damping * 0.002
  stoneVelocity[2] *= 1 - damping * 0.006
  stoneAngularVelocity[0] *= 1 - damping * 0.004
  stoneAngularVelocity[1] *= 1 - damping * 0.004
  stoneAngularVelocity[2] *= 1 - damping * 0.004
  stonePosition = [
    stonePosition[0] + stoneVelocity[0] * stepDt,
    stonePosition[1] + stoneVelocity[1] * stepDt,
    stonePosition[2] + stoneVelocity[2] * stepDt,
  ]

  if (stonePosition[1] < -0.69) {
    stonePosition[1] = -0.69
    if (stoneVelocity[1] < 0) stoneVelocity[1] *= -0.24
    stoneVelocity[0] *= 0.78
    stoneVelocity[2] *= 0.78
    stoneAngularVelocity[0] *= 0.72
    stoneAngularVelocity[1] *= 0.72
    stoneAngularVelocity[2] *= 0.72
  }
  if (Math.abs(stonePosition[0]) > 1.85) {
    stonePosition[0] = Math.sign(stonePosition[0]) * 1.85
    stoneVelocity[0] *= -0.35
  }
  if (Math.abs(stonePosition[2]) > 1.5) {
    stonePosition[2] = Math.sign(stonePosition[2]) * 1.5
    stoneVelocity[2] *= -0.35
  }
  integrateStoneRotation(stepDt)
  applyStoneFleshCoupling(stepDt)
}

function THREE_LERP(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function THREE_CLAMP(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function integrateStoneRotation(stepDt: number) {
  const [x, y, z, w] = stoneQuaternion
  const [ax, ay, az] = stoneAngularVelocity
  stoneQuaternion = [
    x + 0.5 * stepDt * (ax * w + ay * z - az * y),
    y + 0.5 * stepDt * (ay * w + az * x - ax * z),
    z + 0.5 * stepDt * (az * w + ax * y - ay * x),
    w + 0.5 * stepDt * (-ax * x - ay * y - az * z),
  ]
  const length = Math.hypot(...stoneQuaternion) || 1
  stoneQuaternion = [
    stoneQuaternion[0] / length,
    stoneQuaternion[1] / length,
    stoneQuaternion[2] / length,
    stoneQuaternion[3] / length,
  ]
}

const simulate = () => {
  if (paused) return
  const scaledDt = fixedDt * timeScale
  const stepDt = scaledDt / substeps
  const edgeCompliance = 0.00035 + (1 - stiffness) * 0.003
  const volumeCompliance = 0.002 + (1 - stiffness) * 0.012
  const velocityRetention = 1 - damping * 0.005

  for (let substep = 0; substep < substeps; substep += 1) {
    for (let node = 0; node < nodeCount; node += 1) {
      const base = node * 3
      const vx = (positions[base] - previousPositions[base]) * velocityRetention
      const vy = (positions[base + 1] - previousPositions[base + 1]) * velocityRetention
      const vz = (positions[base + 2] - previousPositions[base + 2]) * velocityRetention
      previousPositions[base] = positions[base]
      previousPositions[base + 1] = positions[base + 1]
      previousPositions[base + 2] = positions[base + 2]
      positions[base] += vx
      positions[base + 1] += vy - 2.8 * stepDt * stepDt
      positions[base + 2] += vz
    }
    applyPeachDrag(stepDt)
    for (let iteration = 0; iteration < 1; iteration += 1) {
      for (let edge = 0; edge < lattice.edgeCount; edge += 1) {
        correctDistance(
          lattice.edges[edge * 2],
          lattice.edges[edge * 2 + 1],
          edgeRestLengths[edge],
          edgeCompliance,
        )
      }
      for (let tetra = 0; tetra < lattice.tetraCount; tetra += 1) {
        correctTetraVolume(tetra, volumeCompliance)
      }
    }
    for (let node = 0; node < nodeCount; node += 1) {
      const base = node * 3
      if (positions[base + 1] < floorY) {
        positions[base + 1] = floorY
        previousPositions[base + 1] = floorY
        previousPositions[base] = THREE_LERP(previousPositions[base], positions[base], 0.08)
        previousPositions[base + 2] = THREE_LERP(previousPositions[base + 2], positions[base + 2], 0.08)
      }
    }
    updateStone(stepDt)
  }
  stabilizeTranslation()
  applyShapeMatching(0.0025 + stiffness * 0.002)
}

const calculateMetrics = (): SimulationMetrics => {
  let currentVolume = 0
  let restVolume = 0
  for (let tetra = 0; tetra < lattice.tetraCount; tetra += 1) {
    currentVolume += Math.abs(tetraVolume(tetra))
    restVolume += Math.abs(restTetraVolumes[tetra])
  }
  return {
    mass: massPerNode * nodeCount,
    volumeRatio: restVolume > 0 ? (currentVolume / restVolume) * 100 : 100,
    gripPercent: (draggedNodes.length / nodeCount) * 100,
    stoneSeated,
    adhesion,
    fps: smoothedFps,
  }
}

const postFrame = () => {
  const now = performance.now()
  const frameMs = now - lastFrameAt
  lastFrameAt = now
  smoothedFps = smoothedFps * 0.94 + (1000 / Math.max(1, frameMs)) * 0.06
  const transferable = Float32Array.from(positions)
  const message: WorkerMessage = {
    type: 'frame',
    positions: transferable,
    stonePosition: [...stonePosition],
    stoneVelocity: [...stoneVelocity],
    stoneQuaternion: [...stoneQuaternion],
    metrics: calculateMetrics(),
  }
  self.postMessage(message, [transferable.buffer])
}

self.onmessage = (event: MessageEvent<WorkerCommand>) => {
  const command = event.data
  switch (command.type) {
    case 'reset':
      positions.set(restPositions)
      previousPositions.set(restPositions)
      stonePosition = [...seedStonePosition]
      stoneVelocity = [0, 0, 0]
      stoneQuaternion = [-0.08, 0.12, -0.04, 0.99]
      stoneAngularVelocity = [0, 0, 0]
      stoneSeated = true
      adhesion = 1
      dragTarget = null
      dragMode = null
      draggedNodes = []
      draggedOffsets = new Float32Array(0)
      break
    case 'drag-start': {
      dragMode = command.target
      dragTarget = [...command.point]
      if (command.target === 'peach') {
        const candidates: Array<{ node: number; distance: number }> = []
        const radius = 0.43 + stiffness * 0.08
        for (let node = 0; node < nodeCount; node += 1) {
          const dx = positions[node * 3] - command.point[0]
          const dy = positions[node * 3 + 1] - command.point[1]
          const dz = positions[node * 3 + 2] - command.point[2]
          const distance = dx * dx + dy * dy + dz * dz
          if (distance < radius * radius) candidates.push({ node, distance })
        }
        candidates.sort((a, b) => a.distance - b.distance)
        draggedNodes = candidates.slice(0, Math.max(8, Math.round(nodeCount * 0.12))).map(({ node }) => node)
        draggedOffsets = new Float32Array(draggedNodes.length * 3)
        for (let index = 0; index < draggedNodes.length; index += 1) {
          const node = draggedNodes[index]
          draggedOffsets[index * 3] = positions[node * 3] - command.point[0]
          draggedOffsets[index * 3 + 1] = positions[node * 3 + 1] - command.point[1]
          draggedOffsets[index * 3 + 2] = positions[node * 3 + 2] - command.point[2]
        }
      }
      break
    }
    case 'drag-move':
      dragTarget = [...command.point]
      break
    case 'drag-end':
      for (let node = 0; node < nodeCount; node += 1) {
        const base = node * 3
        previousPositions[base] = positions[base] - (positions[base] - previousPositions[base]) * 0.26
        previousPositions[base + 1] =
          positions[base + 1] - (positions[base + 1] - previousPositions[base + 1]) * 0.26
        previousPositions[base + 2] =
          positions[base + 2] - (positions[base + 2] - previousPositions[base + 2]) * 0.26
      }
      dragTarget = null
      dragMode = null
      draggedNodes = []
      draggedOffsets = new Float32Array(0)
      break
    case 'eject-stone':
      stoneSeated = false
      adhesion = 0.12
      stoneVelocity = [0.95, 3.45, 0.36]
      stoneAngularVelocity = [4.2, -2.4, 1.8]
      for (let node = 0; node < nodeCount; node += 1) {
        const dx = positions[node * 3]
        const dz = positions[node * 3 + 2]
        const distance = Math.hypot(dx, dz)
        if (distance < 0.42) {
          positions[node * 3] += dx * 0.08
          positions[node * 3 + 1] += 0.035
          positions[node * 3 + 2] += dz * 0.08
        }
      }
      break
    case 'seat-stone':
      stoneSeated = true
      break
    case 'pause':
      paused = command.paused
      break
    case 'set-time-scale':
      timeScale = command.value
      break
    case 'set-stiffness':
      stiffness = command.value
      break
    case 'set-damping':
      damping = command.value
      break
  }
}

self.postMessage({
  type: 'ready',
  nodeCount: lattice.nodeCount,
  tetraCount: lattice.tetraCount,
} satisfies WorkerMessage)

setInterval(() => {
  const now = performance.now()
  solverAccumulator += Math.min(0.1, (now - lastSolverTick) / 1000)
  lastSolverTick = now
  let simulationSteps = 0
  while (solverAccumulator >= fixedDt && simulationSteps < 3) {
    simulate()
    solverAccumulator -= fixedDt
    simulationSteps += 1
  }
  if (paused) solverAccumulator = 0
  postFrame()
}, 1000 / 60)
