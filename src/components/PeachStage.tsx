import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { PMREMGenerator, WebGPURenderer } from 'three/webgpu'
import { createPeachLattice } from '../simulation/lattice'
import { PeachSimulationClient } from '../simulation/workerClient'
import type {
  RendererBackend,
  SimulationControls,
  SimulationMetrics,
  Vec3,
  WorkerFrame,
  WorkerMessage,
} from '../simulation/types'
import {
  buildPeachGeometry,
  buildStoneGeometry,
  createGelMaterial,
} from '../scene/geometry'
import { bindMeshToLattice, deformMesh } from '../scene/skin'

interface PeachStageProps extends SimulationControls {
  gridVisible: boolean
  stoneRequest: 'seated' | 'ejected'
  stoneRequestToken: number
  resetToken: number
  onBackend: (backend: RendererBackend) => void
  onMetrics: (metrics: SimulationMetrics) => void
  onReady: (nodeCount: number, tetraCount: number) => void
  onError: (message: string) => void
}

const DEFAULT_METRICS: SimulationMetrics = {
  mass: 7.11,
  volumeRatio: 100,
  gripPercent: 0,
  stoneSeated: true,
  adhesion: 1,
  fps: 60,
}

export function PeachStage({
  paused,
  timeScale,
  stiffness,
  damping,
  gridVisible,
  stoneRequest,
  stoneRequestToken,
  resetToken,
  onBackend,
  onMetrics,
  onReady,
  onError,
}: PeachStageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const clientRef = useRef<PeachSimulationClient | null>(null)
  const controlsRef = useRef({ paused, timeScale, stiffness, damping })
  const gridVisibleRef = useRef(gridVisible)
  const callbacksRef = useRef({ onBackend, onMetrics, onReady, onError })

  useEffect(() => {
    controlsRef.current = { paused, timeScale, stiffness, damping }
  }, [paused, timeScale, stiffness, damping])

  useEffect(() => {
    gridVisibleRef.current = gridVisible
  }, [gridVisible])

  useEffect(() => {
    callbacksRef.current = { onBackend, onMetrics, onReady, onError }
  }, [onBackend, onMetrics, onReady, onError])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    let frameHandle = 0
    let lastMetricsAt = 0
    let renderedFrames = 0
    let fpsWindowStartedAt = performance.now()
    let renderedFps = 60
    let latestFrame: WorkerFrame | null = null
    let currentMetrics = DEFAULT_METRICS
    let renderedBackend: RendererBackend = 'WebGPU'
    let environmentTarget: { texture: THREE.Texture; dispose: () => void } | null = null
    const lattice = createPeachLattice()
    const simulation = new PeachSimulationClient()
    clientRef.current = simulation

    const renderer = new WebGPURenderer({
      antialias: true,
      alpha: false,
      forceWebGL: !('gpu' in navigator),
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.88
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.domElement.className = 'peach-canvas'
    renderer.domElement.setAttribute('aria-label', '可交互的半透明桃子果冻三维场景')
    renderer.domElement.setAttribute('role', 'application')
    renderer.domElement.tabIndex = 0
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#f2f0ec')
    scene.fog = new THREE.Fog('#f2f0ec', 7.5, 12)

    const camera = new THREE.PerspectiveCamera(
      33,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      40,
    )
    camera.position.set(0.15, 1.05, 5.05)
    camera.lookAt(0, -0.08, 0)

    const ambient = new THREE.HemisphereLight('#fffaf0', '#9e8e7b', 1.75)
    scene.add(ambient)

    const keyLight = new THREE.DirectionalLight('#fff8eb', 3.7)
    keyLight.position.set(-3.2, 5.2, 4.3)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(2048, 2048)
    keyLight.shadow.camera.left = -3
    keyLight.shadow.camera.right = 3
    keyLight.shadow.camera.top = 3
    keyLight.shadow.camera.bottom = -3
    keyLight.shadow.bias = -0.001
    keyLight.shadow.radius = 6
    scene.add(keyLight)

    const rimLight = new THREE.DirectionalLight('#ffd5bd', 1.75)
    rimLight.position.set(3.5, 2.3, -2.8)
    scene.add(rimLight)

    const { peachGeometry } = buildPeachGeometry()
    const outerMaterial = createGelMaterial('outer')
    const cutMaterial = createGelMaterial('cut')
    const specimenRoot = new THREE.Group()
    specimenRoot.position.y = 0.1
    specimenRoot.rotation.set(0.42, 0.04, -0.15)
    scene.add(specimenRoot)
    const peachMesh = new THREE.Mesh(peachGeometry, [outerMaterial, cutMaterial])
    peachMesh.name = 'peach-jelly'
    peachMesh.castShadow = true
    peachMesh.receiveShadow = true
    peachMesh.renderOrder = 1
    bindMeshToLattice(peachMesh, lattice.positions, 0.3)
    specimenRoot.add(peachMesh)

    const stoneGeometry = buildStoneGeometry()
    const stoneMaterial = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0,
      clearcoat: 0.08,
      clearcoatRoughness: 0.9,
    })
    const stoneMesh = new THREE.Mesh(stoneGeometry, stoneMaterial)
    stoneMesh.name = 'peach-stone'
    stoneMesh.castShadow = true
    stoneMesh.receiveShadow = true
    stoneMesh.renderOrder = 3
    stoneMesh.position.fromArray([0.08, 0.13, -0.015])
    stoneMesh.rotation.set(0.22, -0.42, -0.08)
    specimenRoot.add(stoneMesh)

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 9),
      new THREE.MeshStandardMaterial({
        color: '#f2f0ec',
        roughness: 1,
        metalness: 0,
      }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.96
    floor.receiveShadow = true
    scene.add(floor)

    const gridPositions = new Float32Array(lattice.edgeCount * 6)
    const gridGeometry = new THREE.BufferGeometry()
    const gridAttribute = new THREE.BufferAttribute(gridPositions, 3)
    gridAttribute.setUsage(THREE.DynamicDrawUsage)
    gridGeometry.setAttribute('position', gridAttribute)
    const gridMaterial = new THREE.LineBasicMaterial({
      color: '#8fbd4a',
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      depthTest: false,
    })
    const gridMesh = new THREE.LineSegments(gridGeometry, gridMaterial)
    gridMesh.renderOrder = 5
    gridMesh.visible = false
    specimenRoot.add(gridMesh)

    const bondNodes: number[] = []
    for (let node = 0; node < lattice.nodeCount && bondNodes.length < 14; node += 1) {
      const x = lattice.positions[node * 3]
      const y = lattice.positions[node * 3 + 1]
      const z = lattice.positions[node * 3 + 2]
      const radius = Math.hypot(x, z)
      if (radius > 0.18 && radius < 0.34 && y > -0.34) bondNodes.push(node)
    }
    const bondPositions = new Float32Array(bondNodes.length * 6)
    const bondAnchors = bondNodes.map((_, index) => {
      const angle = (index / Math.max(1, bondNodes.length)) * Math.PI * 2
      return [Math.cos(angle) * 0.24, -0.09 + Math.sin(angle * 2) * 0.025, Math.sin(angle) * 0.19]
    })
    const bondGeometry = new THREE.BufferGeometry()
    const bondAttribute = new THREE.BufferAttribute(bondPositions, 3)
    bondAttribute.setUsage(THREE.DynamicDrawUsage)
    bondGeometry.setAttribute('position', bondAttribute)
    const bondMaterial = new THREE.LineBasicMaterial({
      color: '#ffb27c',
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      depthTest: false,
    })
    const bondMesh = new THREE.LineSegments(bondGeometry, bondMaterial)
    bondMesh.visible = false
    bondMesh.renderOrder = 6
    specimenRoot.add(bondMesh)

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
    const intersection = new THREE.Vector3()
    let dragging: 'peach' | 'stone' | null = null
    let orbiting = false
    let previousPointer = { x: 0, y: 0 }
    let azimuth = 0.03
    let polar = 0.18
    const horizontalHalfFov = Math.atan(
      Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * Math.max(0.3, camera.aspect),
    )
    let distance = Math.max(4.55, 1.22 / Math.tan(horizontalHalfFov))

    const updateCamera = () => {
      const target = new THREE.Vector3(0, -0.08, 0)
      const horizontal = Math.cos(polar) * distance
      camera.position.set(
        target.x + Math.sin(azimuth) * horizontal,
        target.y + Math.sin(polar) * distance,
        target.z + Math.cos(azimuth) * horizontal,
      )
      camera.lookAt(target)
    }

    const setPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
    }

    const dragPoint = (): Vec3 | null => {
      if (!raycaster.ray.intersectPlane(dragPlane, intersection)) return null
      const localPoint = specimenRoot.worldToLocal(intersection.clone())
      return [localPoint.x, localPoint.y, localPoint.z]
    }

    const onPointerDown = (event: PointerEvent) => {
      setPointer(event)
      previousPointer = { x: event.clientX, y: event.clientY }
      const hits = raycaster.intersectObjects([stoneMesh, peachMesh], false)
      if (hits.length > 0) {
        const target = hits[0].object === stoneMesh ? 'stone' : 'peach'
        dragging = target
        dragPlane.constant = -hits[0].point.z
        renderer.domElement.setPointerCapture(event.pointerId)
        renderer.domElement.style.cursor = 'grabbing'
        const localHit = specimenRoot.worldToLocal(hits[0].point.clone())
        simulation.send({ type: 'drag-start', target, point: [localHit.x, localHit.y, localHit.z] })
      } else {
        orbiting = true
        renderer.domElement.style.cursor = 'move'
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      setPointer(event)
      if (dragging) {
        const point = dragPoint()
        if (point) simulation.send({ type: 'drag-move', point })
        return
      }
      if (orbiting) {
        const dx = event.clientX - previousPointer.x
        const dy = event.clientY - previousPointer.y
        previousPointer = { x: event.clientX, y: event.clientY }
        azimuth -= dx * 0.003
        polar = THREE.MathUtils.clamp(polar + dy * 0.0025, -0.08, 0.62)
        updateCamera()
        return
      }
      const hits = raycaster.intersectObjects([stoneMesh, peachMesh], false)
      renderer.domElement.style.cursor = hits.length > 0 ? 'grab' : 'default'
    }

    const finishDrag = (event: PointerEvent) => {
      if (dragging) {
        setPointer(event)
        const point = dragPoint()
        simulation.send({ type: 'drag-end', point: point ?? [0, 0, 0] })
      }
      dragging = null
      orbiting = false
      renderer.domElement.style.cursor = 'default'
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId)
      }
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      distance = THREE.MathUtils.clamp(distance + event.deltaY * 0.002, 4, 7.2)
      updateCamera()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const orbitStep = 0.08
      if (event.key === 'ArrowLeft') azimuth -= orbitStep
      else if (event.key === 'ArrowRight') azimuth += orbitStep
      else if (event.key === 'ArrowUp') polar = Math.max(-0.08, polar - orbitStep)
      else if (event.key === 'ArrowDown') polar = Math.min(0.62, polar + orbitStep)
      else return
      event.preventDefault()
      updateCamera()
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', finishDrag)
    renderer.domElement.addEventListener('pointercancel', finishDrag)
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false })
    renderer.domElement.addEventListener('keydown', onKeyDown)

    const resizeObserver = new ResizeObserver(() => {
      const width = container.clientWidth
      const height = container.clientHeight
      renderer.setSize(width, height)
      camera.aspect = width / Math.max(1, height)
      camera.updateProjectionMatrix()
    })
    resizeObserver.observe(container)

    const updateGrid = (nodes: Float32Array) => {
      for (let edge = 0; edge < lattice.edgeCount; edge += 1) {
        const a = lattice.edges[edge * 2]
        const b = lattice.edges[edge * 2 + 1]
        const target = edge * 6
        gridPositions[target] = nodes[a * 3]
        gridPositions[target + 1] = nodes[a * 3 + 1]
        gridPositions[target + 2] = nodes[a * 3 + 2]
        gridPositions[target + 3] = nodes[b * 3]
        gridPositions[target + 4] = nodes[b * 3 + 1]
        gridPositions[target + 5] = nodes[b * 3 + 2]
      }
      gridAttribute.needsUpdate = true
    }

    const updateBonds = (frame: WorkerFrame) => {
      bondMesh.visible = !frame.metrics.stoneSeated && frame.metrics.adhesion > 0.02
      if (!bondMesh.visible) return
      for (let bond = 0; bond < bondNodes.length; bond += 1) {
        const node = bondNodes[bond]
        const target = bond * 6
        bondPositions[target] = frame.positions[node * 3]
        bondPositions[target + 1] = frame.positions[node * 3 + 1]
        bondPositions[target + 2] = frame.positions[node * 3 + 2]
        bondPositions[target + 3] = frame.stonePosition[0] + bondAnchors[bond][0]
        bondPositions[target + 4] = frame.stonePosition[1] + bondAnchors[bond][1]
        bondPositions[target + 5] = frame.stonePosition[2] + bondAnchors[bond][2]
      }
      bondAttribute.needsUpdate = true
    }

    const stopListening = simulation.subscribe((message: WorkerMessage) => {
      if (message.type === 'ready') {
        callbacksRef.current.onReady(message.nodeCount, message.tetraCount)
        return
      }
      latestFrame = message
      currentMetrics = message.metrics
      const now = performance.now()
      if (now - lastMetricsAt > 95) {
        lastMetricsAt = now
        callbacksRef.current.onMetrics(currentMetrics)
      }
    })

    let stopped = false
    const animate = (now: number) => {
      if (stopped) return
      frameHandle = requestAnimationFrame(animate)
      renderedFrames += 1
      if (now - fpsWindowStartedAt >= 1000) {
        renderedFps = (renderedFrames * 1000) / (now - fpsWindowStartedAt)
        renderedFrames = 0
        fpsWindowStartedAt = now
      }
      if (latestFrame) {
        deformMesh(peachMesh, latestFrame.positions, lattice.positions)
        gridMesh.visible = gridVisibleRef.current
        if (gridMesh.visible) updateGrid(latestFrame.positions)
        updateBonds(latestFrame)
        stoneMesh.position.fromArray(latestFrame.stonePosition)
        stoneMesh.quaternion.fromArray(latestFrame.stoneQuaternion)
        peachGeometry.computeVertexNormals()
        currentMetrics = { ...currentMetrics, fps: renderedFps }
      }
      renderer.render(scene, camera)
    }

    void renderer
      .init()
      .then(() => {
        if (disposed) return
        renderedBackend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
          ? 'WebGPU'
          : 'WebGL2'
        const environmentGenerator = new PMREMGenerator(renderer)
        const generatedEnvironment = environmentGenerator.fromScene(new RoomEnvironment(), 0.035)
        environmentTarget = generatedEnvironment
        scene.environment = generatedEnvironment.texture
        scene.environmentIntensity = 0.45
        environmentGenerator.dispose()
        callbacksRef.current.onBackend(renderedBackend)
        updateCamera()
        animate(performance.now())
        callbacksRef.current.onMetrics(DEFAULT_METRICS)
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '渲染器初始化失败'
        callbacksRef.current.onError(message)
      })

    return () => {
      disposed = true
      stopped = true
      cancelAnimationFrame(frameHandle)
      resizeObserver.disconnect()
      stopListening()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', finishDrag)
      renderer.domElement.removeEventListener('pointercancel', finishDrag)
      renderer.domElement.removeEventListener('wheel', onWheel)
      renderer.domElement.removeEventListener('keydown', onKeyDown)
      simulation.dispose()
      clientRef.current = null
      peachGeometry.dispose()
      stoneGeometry.dispose()
      gridGeometry.dispose()
      bondGeometry.dispose()
      outerMaterial.dispose()
      cutMaterial.dispose()
      stoneMaterial.dispose()
      gridMaterial.dispose()
      bondMaterial.dispose()
      floor.geometry.dispose()
      if (floor.material instanceof THREE.Material) floor.material.dispose()
      environmentTarget?.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  useEffect(() => {
    clientRef.current?.send({ type: 'pause', paused })
  }, [paused])

  useEffect(() => {
    clientRef.current?.send({ type: 'set-time-scale', value: timeScale })
  }, [timeScale])

  useEffect(() => {
    clientRef.current?.send({ type: 'set-stiffness', value: stiffness })
  }, [stiffness])

  useEffect(() => {
    clientRef.current?.send({ type: 'set-damping', value: damping })
  }, [damping])

  useEffect(() => {
    clientRef.current?.send({ type: stoneRequest === 'ejected' ? 'eject-stone' : 'seat-stone' })
  }, [stoneRequest, stoneRequestToken])

  useEffect(() => {
    if (resetToken > 0) clientRef.current?.send({ type: 'reset' })
  }, [resetToken])

  return <div ref={containerRef} className="peach-stage" data-grid={gridVisible ? 'on' : 'off'} />
}
