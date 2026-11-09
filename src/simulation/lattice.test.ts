import { describe, expect, it } from 'vitest'
import { createPeachLattice, signedTetraVolume } from './lattice'

describe('procedural peach lattice', () => {
  const lattice = createPeachLattice()

  it('builds an approximately 700-node volumetric specimen', () => {
    expect(lattice.nodeCount).toBeGreaterThanOrEqual(650)
    expect(lattice.nodeCount).toBeLessThanOrEqual(850)
    expect(lattice.tetraCount).toBeGreaterThanOrEqual(2200)
    expect(lattice.tetraCount).toBeLessThanOrEqual(3200)
    expect(lattice.edgeCount).toBeGreaterThan(lattice.nodeCount)
  })

  it('keeps every topology reference valid and every tetrahedron non-degenerate', () => {
    for (const index of lattice.tets) {
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(lattice.nodeCount)
    }
    for (const index of lattice.edges) {
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(lattice.nodeCount)
    }

    for (let tetra = 0; tetra < lattice.tetraCount; tetra += 1) {
      const offset = tetra * 4
      const [a, b, c, d] = Array.from(lattice.tets.slice(offset, offset + 4))
      const positions = [a, b, c, d].flatMap((node) => [
        lattice.positions[node * 3],
        lattice.positions[node * 3 + 1],
        lattice.positions[node * 3 + 2],
      ])
      const volume = signedTetraVolume(...(positions as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ]))
      expect(Number.isFinite(volume)).toBe(true)
      expect(Math.abs(volume)).toBeGreaterThan(1e-7)
    }
  })

  it('produces deterministic geometry for worker and renderer', () => {
    const duplicate = createPeachLattice()
    expect(duplicate.nodeCount).toBe(lattice.nodeCount)
    expect(duplicate.tetraCount).toBe(lattice.tetraCount)
    expect(Array.from(duplicate.positions.slice(0, 90))).toEqual(
      Array.from(lattice.positions.slice(0, 90)),
    )
  })
})
