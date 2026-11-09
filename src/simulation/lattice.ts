import type { PeachLattice } from './types'

interface GridNode {
  index: number
  x: number
  y: number
  z: number
}

const keyOf = (x: number, y: number, z: number) => `${x},${y},${z}`

const isInsidePeachVolume = (x: number, y: number, z: number) => {
  if (y > -0.005 || y < -0.94) return false

  const vertical = (y + 0.02) / 0.94
  const ellipse = (x * x) / (0.96 * 0.96) + (z * z) / (0.81 * 0.81)
  const inner = ellipse + vertical * vertical
  if (inner > 0.985) return false

  const pitX = x / 0.39
  const pitY = (y + 0.055) / 0.27
  const pitZ = (z + 0.02) / 0.27
  return pitX * pitX + pitY * pitY + pitZ * pitZ > 1
}

export const signedTetraVolume = (
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  dx: number,
  dy: number,
  dz: number,
) => {
  const ux = bx - ax
  const uy = by - ay
  const uz = bz - az
  const vx = cx - ax
  const vy = cy - ay
  const vz = cz - az
  const wx = dx - ax
  const wy = dy - ay
  const wz = dz - az
  return (
    (wx * (uy * vz - uz * vy) +
      wy * (uz * vx - ux * vz) +
      wz * (ux * vy - uy * vx)) /
    6
  )
}

const cubeTetrahedra = [
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
  [0, 5, 1, 6],
] as const

const cubeCorners = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
] as const

export const createPeachLattice = (): PeachLattice => {
  const nx = 14
  const ny = 8
  const nz = 12
  const minX = -0.86
  const maxX = 0.86
  const minY = -0.86
  const maxY = -0.03
  const minZ = -0.72
  const maxZ = 0.72
  const nodes: GridNode[] = []
  const lookup = new Map<string, number>()
  let volumeNodeCount = 0

  for (let iy = 0; iy < ny; iy += 1) {
    for (let iz = 0; iz < nz; iz += 1) {
      for (let ix = 0; ix < nx; ix += 1) {
        const x = minX + (ix / (nx - 1)) * (maxX - minX)
        const y = minY + (iy / (ny - 1)) * (maxY - minY)
        const z = minZ + (iz / (nz - 1)) * (maxZ - minZ)
        if (!isInsidePeachVolume(x, y, z)) continue

        const index = nodes.length
        nodes.push({ index, x, y, z })
        lookup.set(keyOf(ix, iy, iz), index)
      }
    }
  }
  volumeNodeCount = nodes.length

  // Add a small set of rim particles so the flat cut and lower edge keep their shape.
  const rimSegments = 20
  for (let i = 0; i < rimSegments; i += 1) {
    const angle = (i / rimSegments) * Math.PI * 2
    const x = Math.cos(angle) * 0.885
    const z = Math.sin(angle) * 0.745
    if (nodes.some((node) => (node.x - x) ** 2 + (node.z - z) ** 2 < 0.0025)) continue
    nodes.push({ index: nodes.length, x, y: -0.035, z })
  }

  const positions = new Float32Array(nodes.length * 3)
  for (const node of nodes) {
    positions[node.index * 3] = node.x
    positions[node.index * 3 + 1] = node.y
    positions[node.index * 3 + 2] = node.z
  }

  const tets: number[] = []
  const edgeSet = new Set<string>()
  const edges: number[] = []
  const addEdge = (a: number, b: number) => {
    const low = Math.min(a, b)
    const high = Math.max(a, b)
    const key = `${low}:${high}`
    if (edgeSet.has(key)) return
    edgeSet.add(key)
    edges.push(low, high)
  }

  for (let iy = 0; iy < ny - 1; iy += 1) {
    for (let iz = 0; iz < nz - 1; iz += 1) {
      for (let ix = 0; ix < nx - 1; ix += 1) {
        const indices = cubeCorners.map(([dx, dy, dz]) => lookup.get(keyOf(ix + dx, iy + dy, iz + dz)))
        if (indices.some((index) => index === undefined)) continue
        const cell = indices as number[]

        for (const tet of cubeTetrahedra) {
          const a = cell[tet[0]]
          const b = cell[tet[1]]
          const c = cell[tet[2]]
          const d = cell[tet[3]]
          const ax = positions[a * 3]
          const ay = positions[a * 3 + 1]
          const az = positions[a * 3 + 2]
          const bx = positions[b * 3]
          const by = positions[b * 3 + 1]
          const bz = positions[b * 3 + 2]
          const cx = positions[c * 3]
          const cy = positions[c * 3 + 1]
          const cz = positions[c * 3 + 2]
          const dx = positions[d * 3]
          const dy = positions[d * 3 + 1]
          const dz = positions[d * 3 + 2]
          if (Math.abs(signedTetraVolume(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz)) < 1e-7) continue
          tets.push(a, b, c, d)
          addEdge(a, b)
          addEdge(a, c)
          addEdge(a, d)
          addEdge(b, c)
          addEdge(b, d)
          addEdge(c, d)
        }
      }
    }
  }

  // Rim particles are kept in the solve through the nearest volume links.
  for (let rim = volumeNodeCount; rim < nodes.length; rim += 1) {
    const nearest = nodes
      .slice(0, volumeNodeCount)
      .map((node) => ({
        index: node.index,
        distance:
          (node.x - nodes[rim].x) ** 2 +
          (node.y - nodes[rim].y) ** 2 +
          (node.z - nodes[rim].z) ** 2,
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5)
    for (const neighbor of nearest) addEdge(rim, neighbor.index)
  }

  return {
    positions,
    tets: new Uint32Array(tets),
    edges: new Uint32Array(edges),
    nodeCount: nodes.length,
    tetraCount: tets.length / 4,
    edgeCount: edges.length / 2,
  }
}
