import { useCallback, useMemo, useState } from 'react'
import { ControlPanel } from './components/ControlPanel'
import { PeachStage } from './components/PeachStage'
import type { RendererBackend, SimulationControls, SimulationMetrics } from './simulation/types'

const INITIAL_CONTROLS: SimulationControls = {
  paused: false,
  timeScale: 1,
  stiffness: 0.72,
  damping: 0.38,
}

const INITIAL_METRICS: SimulationMetrics = {
  mass: 7.11,
  volumeRatio: 100,
  gripPercent: 0,
  stoneSeated: true,
  adhesion: 1,
  fps: 60,
}

function App() {
  const [controls, setControls] = useState(INITIAL_CONTROLS)
  const [metrics, setMetrics] = useState(INITIAL_METRICS)
  const [backend, setBackend] = useState<RendererBackend>('WebGPU')
  const [gridVisible, setGridVisible] = useState(false)
  const [stoneMode, setStoneMode] = useState<'seated' | 'ejected'>('seated')
  const [stoneRequestToken, setStoneRequestToken] = useState(0)
  const [resetToken, setResetToken] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [counts, setCounts] = useState({ nodes: 0, tetrahedra: 0 })

  const updateControls = useCallback((next: Partial<SimulationControls>) => {
    setControls((current) => ({ ...current, ...next }))
  }, [])

  const reset = useCallback(() => {
    setControls(INITIAL_CONTROLS)
    setStoneMode('seated')
    setGridVisible(false)
    setResetToken((value) => value + 1)
  }, [])

  const handleReady = useCallback((nodes: number, tetrahedra: number) => {
    setCounts({ nodes, tetrahedra })
    setReady(true)
  }, [])

  const handleMetrics = useCallback((next: SimulationMetrics) => {
    setMetrics(next)
  }, [])

  const handleStoneMode = useCallback((mode: 'seated' | 'ejected') => {
    setStoneMode(mode)
    setStoneRequestToken((value) => value + 1)
  }, [])

  const stage = useMemo(
    () => (
      <PeachStage
        {...controls}
        gridVisible={gridVisible}
        stoneRequest={stoneMode}
        stoneRequestToken={stoneRequestToken}
        resetToken={resetToken}
        onBackend={setBackend}
        onMetrics={handleMetrics}
        onReady={handleReady}
        onError={setError}
      />
    ),
    [controls, gridVisible, handleMetrics, handleReady, resetToken, stoneMode, stoneRequestToken],
  )

  return (
    <main className="app-shell">
      <section className="stage-shell" aria-label="桃子果冻材料实验">
        {stage}

        <header className="identity">
          <h1>
            Peach
            <br />
            Jelly<span>.</span>
          </h1>
          <p className="identity-caption">交互式软体材料实验</p>
        </header>

        <section className="live-metrics" aria-label="实时模拟数据">
          <div>
            <span>模拟质量</span>
            <strong>{metrics.mass.toFixed(2)} g</strong>
          </div>
          <div>
            <span>体积保持</span>
            <strong>{metrics.volumeRatio.toFixed(1)}%</strong>
          </div>
          <div>
            <span>抓取区域</span>
            <strong>{metrics.gripPercent.toFixed(1)}%</strong>
          </div>
        </section>

        {!ready && !error && (
          <div className="loading-screen" role="status" aria-live="polite">
            <span className="loading-mark" />
            <p>正在求解软质体</p>
            <small>正在生成桃子、果肉与物理网格</small>
          </div>
        )}

        {error && (
          <div className="error-screen" role="alert">
            <p>当前浏览器无法启动图形实验。</p>
            <small>{error}</small>
          </div>
        )}
      </section>

      <ControlPanel
        controls={controls}
        metrics={metrics}
        backend={backend}
        gridVisible={gridVisible}
        stoneMode={metrics.stoneSeated ? 'seated' : 'ejected'}
        nodeCount={counts.nodes}
        tetraCount={counts.tetrahedra}
        onControls={updateControls}
        onGridVisible={setGridVisible}
        onStoneMode={handleStoneMode}
        onReset={reset}
      />
    </main>
  )
}

export default App
