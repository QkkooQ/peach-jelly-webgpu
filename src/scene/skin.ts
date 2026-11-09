import * as THREE from 'three'
import type { MeshBinding } from '../simulation/types'

const MAX_INFLUENCES = 8

export const bindMeshToLattice = (
  mesh: THREE.Mesh,
  nodes: Float32Array,
  smoothingStrength = 0.18,
): MeshBinding => {
  const positions = mesh.geometry.getAttribute('position')
  const vertexCount = positions.count
  const nodeCount = nodes.length / 3
  const bestDistance = new Float32Array(MAX_INFLUENCES)
  const bestIndex = new Int32Array(MAX_INFLUENCES)
  const indices = new Uint16Array(vertexCount * MAX_INFLUENCES)
  const weights = new Float32Array(vertexCount * MAX_INFLUENCES)

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    bestDistance.fill(Number.POSITIVE_INFINITY)
    bestIndex.fill(0)
    const vx = positions.getX(vertex)
    const vy = positions.getY(vertex)
    const vz = positions.getZ(vertex)

    for (let node = 0; node < nodeCount; node += 1) {
      const dx = vx - nodes[node * 3]
      const dy = vy - nodes[node * 3 + 1]
      const dz = vz - nodes[node * 3 + 2]
      const distance = dx * dx + dy * dy + dz * dz
      let slot = MAX_INFLUENCES - 1
      if (distance >= bestDistance[slot]) continue
      while (slot > 0 && distance < bestDistance[slot - 1]) {
        bestDistance[slot] = bestDistance[slot - 1]
        bestIndex[slot] = bestIndex[slot - 1]
        slot -= 1
      }
      bestDistance[slot] = distance
      bestIndex[slot] = node
    }

    let totalWeight = 0
    for (let influence = 0; influence < MAX_INFLUENCES; influence += 1) {
      const weight = 1 / Math.max(0.0004, Math.sqrt(bestDistance[influence]))
      weights[vertex * MAX_INFLUENCES + influence] = weight
      indices[vertex * MAX_INFLUENCES + influence] = bestIndex[influence]
      totalWeight += weight
    }
    for (let influence = 0; influence < MAX_INFLUENCES; influence += 1) {
      weights[vertex * MAX_INFLUENCES + influence] /= totalWeight
    }
  }

  mesh.userData.restPositions = Float32Array.from(positions.array as ArrayLike<number>)
  const geometryIndex = mesh.geometry.getIndex()
  const neighborSets = Array.from({ length: vertexCount }, () => new Set<number>())
  if (geometryIndex) {
    for (let triangle = 0; triangle < geometryIndex.count; triangle += 3) {
      const a = geometryIndex.getX(triangle)
      const b = geometryIndex.getX(triangle + 1)
      const c = geometryIndex.getX(triangle + 2)
      neighborSets[a].add(b).add(c)
      neighborSets[b].add(a).add(c)
      neighborSets[c].add(a).add(b)
    }
  }
  const maxNeighbors = 8
  const neighborOffsets = new Uint32Array((vertexCount + 1) * 1)
  const neighborList: number[] = []
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const neighbors = Array.from(neighborSets[vertex]).slice(0, maxNeighbors)
    neighborOffsets[vertex] = neighborList.length
    neighborList.push(...neighbors)
  }
  neighborOffsets[vertexCount] = neighborList.length
  mesh.userData.neighbors = new Uint16Array(neighborList)
  mesh.userData.neighborOffsets = neighborOffsets
  mesh.userData.smoothedPositions = new Float32Array(vertexCount * 3)
  mesh.userData.smoothingStrength = smoothingStrength
  mesh.userData.binding = {
    indices,
    weights,
    influenceCount: MAX_INFLUENCES,
  } satisfies MeshBinding

  return mesh.userData.binding as MeshBinding
}

export const deformMesh = (
  mesh: THREE.Mesh,
  nodes: Float32Array,
  restNodes: Float32Array,
): void => {
  const binding = mesh.userData.binding as MeshBinding | undefined
  const restPositions = mesh.userData.restPositions as Float32Array | undefined
  if (!binding || !restPositions) return

  const positionAttribute = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
  const output = positionAttribute.array as Float32Array
  for (let vertex = 0; vertex < positionAttribute.count; vertex += 1) {
    let offsetX = 0
    let offsetY = 0
    let offsetZ = 0
    for (let influence = 0; influence < binding.influenceCount; influence += 1) {
      const slot = vertex * binding.influenceCount + influence
      const node = binding.indices[slot]
      const weight = binding.weights[slot]
      offsetX += (nodes[node * 3] - restNodes[node * 3]) * weight
      offsetY += (nodes[node * 3 + 1] - restNodes[node * 3 + 1]) * weight
      offsetZ += (nodes[node * 3 + 2] - restNodes[node * 3 + 2]) * weight
    }
    output[vertex * 3] = restPositions[vertex * 3] + offsetX
    output[vertex * 3 + 1] = restPositions[vertex * 3 + 1] + offsetY
    output[vertex * 3 + 2] = restPositions[vertex * 3 + 2] + offsetZ
  }
  const neighbors = mesh.userData.neighbors as Uint16Array | undefined
  const offsets = mesh.userData.neighborOffsets as Uint32Array | undefined
  const smoothed = mesh.userData.smoothedPositions as Float32Array | undefined
  const smoothing = (mesh.userData.smoothingStrength as number | undefined) ?? 0
  if (neighbors && offsets && smoothed && smoothing > 0) {
    smoothed.set(output)
    for (let vertex = 0; vertex < positionAttribute.count; vertex += 1) {
      const start = offsets[vertex]
      const end = offsets[vertex + 1]
      if (end <= start) continue
      let averageX = 0
      let averageY = 0
      let averageZ = 0
      for (let neighbor = start; neighbor < end; neighbor += 1) {
        const other = neighbors[neighbor]
        averageX += smoothed[other * 3]
        averageY += smoothed[other * 3 + 1]
        averageZ += smoothed[other * 3 + 2]
      }
      const inverse = 1 / (end - start)
      output[vertex * 3] = THREE_LERP(output[vertex * 3], averageX * inverse, smoothing)
      output[vertex * 3 + 1] = THREE_LERP(output[vertex * 3 + 1], averageY * inverse, smoothing)
      output[vertex * 3 + 2] = THREE_LERP(output[vertex * 3 + 2], averageZ * inverse, smoothing)
    }
  }
  positionAttribute.needsUpdate = true
}

const THREE_LERP = (a: number, b: number, t: number) => a + (b - a) * t
