export type Vec3 = [number, number, number]

export type RendererBackend = 'WebGPU' | 'WebGL2'

export interface SimulationControls {
  paused: boolean
  timeScale: number
  stiffness: number
  damping: number
}

export interface SimulationMetrics {
  mass: number
  volumeRatio: number
  gripPercent: number
  stoneSeated: boolean
  adhesion: number
  fps: number
}

export type WorkerCommand =
  | { type: 'reset' }
  | { type: 'drag-start'; target: 'peach' | 'stone'; point: Vec3 }
  | { type: 'drag-move'; point: Vec3 }
  | { type: 'drag-end'; point: Vec3 }
  | { type: 'eject-stone' }
  | { type: 'seat-stone' }
  | { type: 'pause'; paused: boolean }
  | { type: 'set-time-scale'; value: number }
  | { type: 'set-stiffness'; value: number }
  | { type: 'set-damping'; value: number }

export interface WorkerFrame {
  type: 'frame'
  positions: Float32Array
  stonePosition: Vec3
  stoneVelocity: Vec3
  stoneQuaternion: [number, number, number, number]
  metrics: SimulationMetrics
}

export type WorkerMessage = WorkerFrame | { type: 'ready'; nodeCount: number; tetraCount: number }

export interface PeachLattice {
  positions: Float32Array
  tets: Uint32Array
  edges: Uint32Array
  nodeCount: number
  tetraCount: number
  edgeCount: number
}

export interface MeshBinding {
  indices: Uint16Array
  weights: Float32Array
  influenceCount: number
}
