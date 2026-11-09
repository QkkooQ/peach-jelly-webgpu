import * as THREE from 'three'

const COLOR = {
  peachLight: new THREE.Color('#f0ad54'),
  peachWarm: new THREE.Color('#e76d47'),
  peachRed: new THREE.Color('#c53530'),
  peachDeep: new THREE.Color('#8f2423'),
  flesh: new THREE.Color('#d8782c'),
  fleshLight: new THREE.Color('#f0a23c'),
  fleshRed: new THREE.Color('#98231f'),
  cavity: new THREE.Color('#7c211e'),
  cavityDeep: new THREE.Color('#4a1717'),
  stone: new THREE.Color('#76513b'),
  stoneDark: new THREE.Color('#3e2d22'),
  stoneLight: new THREE.Color('#a37755'),
}

const normalTextureCache = new Map<'outer' | 'cut', THREE.CanvasTexture>()

const createSurfaceNormalTexture = (layer: 'outer' | 'cut') => {
  const cached = normalTextureCache.get(layer)
  if (cached) return cached

  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return new THREE.CanvasTexture(canvas)
  const image = context.createImageData(size, size)
  const hash = (x: number, y: number) => {
    const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
    return value - Math.floor(value)
  }
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const valueNoise = (x: number, y: number, scale: number) => {
    const sx = x / scale
    const sy = y / scale
    const ix = Math.floor(sx)
    const iy = Math.floor(sy)
    const fx = smooth(sx - ix)
    const fy = smooth(sy - iy)
    const top = THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), fx)
    const bottom = THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx)
    return THREE.MathUtils.lerp(top, bottom, fy)
  }
  const heightAt = (x: number, y: number) =>
    valueNoise(((x % size) + size) % size, ((y % size) + size) % size, 23) * 0.56 +
    valueNoise(((x % size) + size) % size, ((y % size) + size) % size, 8) * 0.29 +
    valueNoise(((x % size) + size) % size, ((y % size) + size) % size, 2.5) * 0.15

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4
      const dx = heightAt(x + 1, y) - heightAt(x - 1, y)
      const dy = heightAt(x, y + 1) - heightAt(x, y - 1)
      image.data[index] = 128 - dx * 190
      image.data[index + 1] = 128 - dy * 190
      image.data[index + 2] = 235
      image.data[index + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(layer === 'outer' ? 3.5 : 2.2, layer === 'outer' ? 2.8 : 2)
  texture.colorSpace = THREE.NoColorSpace
  normalTextureCache.set(layer, texture)
  return texture
}

const pushVertex = (
  positions: number[],
  colors: number[],
  x: number,
  y: number,
  z: number,
  color: THREE.Color,
) => {
  positions.push(x, y, z)
  colors.push(color.r, color.g, color.b)
}

const ellipseRadius = (angle: number, radiusX: number, radiusZ: number) => ({
  x: Math.cos(angle) * radiusX,
  z: Math.sin(angle) * radiusZ,
})

export const buildPeachGeometry = () => {
  const ringCount = 54
  const segmentCount = 144
  const positions: number[] = []
  const colors: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const color = new THREE.Color()

  for (let ring = 0; ring < ringCount; ring += 1) {
    const v = ring / (ringCount - 1)
    const phi = 0.012 + v * (Math.PI / 2 - 0.012)
    const y = -0.91 * Math.cos(phi)
    const radius = Math.sin(phi)

    for (let segment = 0; segment < segmentCount; segment += 1) {
      const angle = (segment / segmentCount) * Math.PI * 2
      const cleft = 1 + 0.052 * Math.cos(angle * 2 + 0.4) + 0.022 * Math.cos(angle * 5)
      const seamAngle = Math.PI / 2 + 0.08
      const seamDelta = Math.atan2(Math.sin(angle - seamAngle), Math.cos(angle - seamAngle))
      const seamGroove = Math.exp(-((seamDelta / 0.05) ** 2)) * 0.022 * radius
      const organic =
        1 +
        0.009 * Math.sin(angle * 7 + v * 13) +
        0.004 * Math.sin(angle * 13 - v * 9)
      const x = Math.cos(angle) * (0.94 * radius * cleft - seamGroove) * organic
      const z = Math.sin(angle) * (0.81 * radius - seamGroove) * organic
      const organicY = y + 0.005 * Math.sin(angle * 3 + v * 11) * radius

      const blush = THREE.MathUtils.clamp(
        0.45 +
          0.23 * Math.sin(angle * 1.8 + 1.1) +
          0.18 * Math.sin(angle * 4.5 + v * 6.5) +
          0.14 * v,
        0,
        1,
      )
      color.copy(COLOR.peachLight).lerp(COLOR.peachRed, THREE.MathUtils.smoothstep(blush, 0.28, 0.88))
      color.lerp(COLOR.peachWarm, 0.2)
      if (v < 0.14) color.lerp(COLOR.peachDeep, 0.2)
      const fineMottle =
        (Math.sin(angle * 17 + v * 31) + Math.sin(angle * 31 - v * 23) + 2) * 0.25
      color.lerp(COLOR.peachLight, fineMottle * 0.12)
      if (fineMottle > 0.82) color.lerp(COLOR.peachRed, (fineMottle - 0.82) * 0.55)
      const seamDistance = Math.abs(seamDelta)
      if (seamDistance < 0.055) color.lerp(COLOR.peachDeep, (1 - seamDistance / 0.055) * 0.32)
      pushVertex(positions, colors, x, organicY, z, color)
      uvs.push((segment / segmentCount) * 2.4, v * 1.8)
    }
  }

  for (let ring = 0; ring < ringCount - 1; ring += 1) {
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const next = (segment + 1) % segmentCount
      const a = ring * segmentCount + segment
      const b = ring * segmentCount + next
      const c = (ring + 1) * segmentCount + segment
      const d = (ring + 1) * segmentCount + next
      indices.push(a, c, b, b, c, d)
    }
  }

  const outerIndexCount = indices.length
  const topRingStart = (ringCount - 1) * segmentCount
  const annulusRings = 22
  const cavityRings = 30
  const segmentColor = new THREE.Color()
  const annulusStarts: number[] = []

  for (let ring = 0; ring < annulusRings; ring += 1) {
    const t = ring / (annulusRings - 1)
    const outerX = THREE.MathUtils.lerp(0.94, 0.405, Math.pow(t, 1.25))
    const outerZ = THREE.MathUtils.lerp(0.81, 0.3, Math.pow(t, 1.25))
    const y = -0.052 * Math.pow(t, 1.45)
    color.copy(COLOR.flesh).lerp(COLOR.fleshLight, 0.35 + 0.2 * Math.cos(t * Math.PI))
    if (t > 0.72) color.lerp(COLOR.fleshRed, (t - 0.72) * 2.4)

    // The first cut ring reuses the exterior rim vertices, so the peel and
    // flesh remain welded while the soft-body mesh deforms.
    if (ring === 0) {
      annulusStarts.push(topRingStart)
      continue
    }

    annulusStarts.push(positions.length / 3)
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const angle = (segment / segmentCount) * Math.PI * 2
      const lobeScale = 1 + 0.026 * Math.cos(angle * 2 + 0.7) * (1 - t * 0.45)
      const point = ellipseRadius(angle, outerX * lobeScale, outerZ * lobeScale)
      const fiber = 0.018 * Math.sin(angle * 13 + t * 9) * (1 - t)
      const cutSeam = Math.exp(-((point.x / 0.025) ** 2)) * (1 - t)
      const fiberTone = 0.5 + 0.5 * Math.sin(angle * 41 + t * 17)
      segmentColor.copy(color).lerp(COLOR.fleshLight, fiberTone * 0.11)
      const vein = Math.max(0, Math.sin(angle * 23 + t * 12) - 0.83) / 0.17
      segmentColor.lerp(COLOR.fleshRed, vein * 0.16)
      segmentColor.lerp(COLOR.fleshRed, cutSeam * 0.2)
      pushVertex(positions, colors, point.x, y + fiber, point.z, segmentColor)
      const vertexIndex = positions.length / 3 - 1
      positions[vertexIndex * 3 + 1] -= cutSeam * 0.009
      uvs.push(0.5 + point.x * 0.7, 0.5 + point.z * 0.7)
    }
  }

  for (let ring = 0; ring < annulusRings - 1; ring += 1) {
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const next = (segment + 1) % segmentCount
      const a = annulusStarts[ring] + segment
      const b = annulusStarts[ring] + next
      const c = annulusStarts[ring + 1] + segment
      const d = annulusStarts[ring + 1] + next
      indices.push(a, b, c, b, d, c)
    }
  }

  const cavityStarts: number[] = [annulusStarts[annulusStarts.length - 1]]
  for (let ring = 1; ring < cavityRings; ring += 1) {
    const t = ring / (cavityRings - 1)
    const bowl = Math.sin((t * Math.PI) / 2)
    const radiusX = 0.405 * Math.pow(1 - t, 0.72)
    const radiusZ = 0.3 * Math.pow(1 - t, 0.72)
    const y = -0.035 - 0.275 * bowl
    color.copy(COLOR.fleshRed).lerp(COLOR.cavity, 0.25 + t * 0.7)
    if (t > 0.9) color.lerp(COLOR.cavityDeep, 0.3)

    cavityStarts.push(positions.length / 3)
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const angle = (segment / segmentCount) * Math.PI * 2
      const point = ellipseRadius(angle, radiusX, radiusZ)
      const ripples = 0.008 * Math.sin(angle * 8 + t * 16) * (1 - t)
      const ringTone = 0.5 + 0.5 * Math.sin(angle * 19 - t * 22)
      segmentColor.copy(color).lerp(COLOR.cavityDeep, ringTone * 0.08)
      pushVertex(
        positions,
        colors,
        point.x,
        y + ripples,
        point.z - 0.025 * t,
        segmentColor,
      )
      uvs.push(0.5 + point.x * 1.2, 0.5 + point.z * 1.2)
    }
  }

  for (let ring = 0; ring < cavityRings - 1; ring += 1) {
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const next = (segment + 1) % segmentCount
      const a = cavityStarts[ring] + segment
      const b = cavityStarts[ring] + next
      const c = cavityStarts[ring + 1] + segment
      const d = cavityStarts[ring + 1] + next
      indices.push(a, b, c, b, d, c)
    }
  }

  const peachGeometry = new THREE.BufferGeometry()
  peachGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  peachGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  peachGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  peachGeometry.setIndex(indices)
  peachGeometry.addGroup(0, outerIndexCount, 0)
  peachGeometry.addGroup(outerIndexCount, indices.length - outerIndexCount, 1)
  peachGeometry.computeVertexNormals()

  return { peachGeometry }
}

export const createGelMaterial = (layer: 'outer' | 'cut') =>
  new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    color: 0xffffff,
    roughness: layer === 'outer' ? 0.16 : 0.42,
    metalness: 0,
    transmission: layer === 'outer' ? 0.88 : 0.03,
    thickness: layer === 'outer' ? 0.7 : 0.35,
    attenuationColor: new THREE.Color('#ff7438'),
    attenuationDistance: layer === 'outer' ? 0.42 : 0.5,
    ior: 1.37,
    clearcoat: layer === 'outer' ? 0.95 : 0.42,
    clearcoatRoughness: layer === 'outer' ? 0.12 : 0.32,
    sheen: layer === 'outer' ? 0.52 : 0.18,
    sheenColor: new THREE.Color('#ff9f83'),
    sheenRoughness: 0.42,
    normalMap: createSurfaceNormalTexture(layer),
    normalScale: new THREE.Vector2(layer === 'outer' ? 0.07 : 0.035, layer === 'outer' ? 0.07 : 0.035),
    transparent: true,
    opacity: layer === 'outer' ? 0.95 : 1,
    side: THREE.DoubleSide,
  })

export const buildStoneGeometry = () => {
  const geometry = new THREE.SphereGeometry(0.33, 88, 56)
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute
  const colors: number[] = []
  const color = new THREE.Color()

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index)
    const y = positions.getY(index)
    const z = positions.getZ(index)
    const direction = new THREE.Vector3(x, y, z).normalize()
    const ridges =
      Math.sin(direction.x * 13 + direction.z * 17) *
      Math.sin(direction.y * 23 - direction.z * 7)
    const grain = Math.sin(direction.x * 31 + direction.y * 19 + direction.z * 27) * 0.38
    const pits = Math.sin(direction.x * 47 - direction.y * 39) * 0.008
    const displacement = 1 + ridges * 0.026 + grain * 0.009 + pits
    positions.setXYZ(index, x * displacement, y * displacement, z * displacement)

    const variation = THREE.MathUtils.clamp(0.45 + ridges * 0.17 + grain * 0.08 + y * 0.31, 0, 1)
    color.copy(COLOR.stoneDark).lerp(COLOR.stone, 0.52 + variation * 0.32)
    if (variation > 0.62) color.lerp(COLOR.stoneLight, (variation - 0.62) * 0.85)
    colors.push(color.r, color.g, color.b)
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.scale(0.98, 0.58, 0.72)
  geometry.computeVertexNormals()
  return geometry
}

