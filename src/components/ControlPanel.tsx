import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Grid3X3,
  Pause,
  Play,
  RotateCcw,
  TimerReset,
} from 'lucide-react'
import type { RendererBackend, SimulationControls, SimulationMetrics } from '../simulation/types'

interface ControlPanelProps {
  controls: SimulationControls
  metrics: SimulationMetrics
  backend: RendererBackend
  gridVisible: boolean
  stoneMode: 'seated' | 'ejected'
  nodeCount: number
  tetraCount: number
  onControls: (next: Partial<SimulationControls>) => void
  onGridVisible: (visible: boolean) => void
  onStoneMode: (mode: 'seated' | 'ejected') => void
  onReset: () => void
}

function ControlButton({
  label,
  active = false,
  onClick,
  children,
  action,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
  action: string
}) {
  return (
    <button
      type="button"
      className="control-button"
      data-action={action}
      data-active={active}
      aria-pressed={active}
      onClick={onClick}
      title={label}
    >
      {children}
      <span>{label}</span>
    </button>
  )
}

function ParameterSlider({
  label,
  value,
  displayValue,
  onChange,
  action,
}: {
  label: string
  value: number
  displayValue: string
  onChange: (value: number) => void
  action: string
}) {
  return (
    <label className="parameter">
      <span className="parameter-label">
        <span>{label}</span>
        <output>{displayValue}</output>
      </span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        data-action={action}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

export function ControlPanel({
  controls,
  metrics,
  backend,
  gridVisible,
  stoneMode,
  nodeCount,
  tetraCount,
  onControls,
  onGridVisible,
  onStoneMode,
  onReset,
}: ControlPanelProps) {
  const paused = controls.paused
  const quarterSpeed = controls.timeScale < 1

  return (
    <aside className="control-panel" aria-label="材质实验控制台">
      <header className="panel-header">
        <div>
          <h2>桃子果冻</h2>
          <p className="panel-intro">拖动桃子或果核，直接观察软体交互。</p>
        </div>
      </header>

      <div className="runtime-status">
        <span className="status-dot" data-backend={backend} />
        <span>{backend}</span>
        <span className="status-divider" />
        <span>{metrics.fps.toFixed(0)} FPS</span>
        <span className="status-divider" />
        <span>XPBD</span>
      </div>

      <section className="panel-section" aria-labelledby="physical-heading">
        <div className="section-heading">
          <h3 id="physical-heading">物理参数</h3>
        </div>
        <ParameterSlider
          label="刚度"
          value={controls.stiffness}
          displayValue={`${Math.round(controls.stiffness * 100)}%`}
          onChange={(value) => onControls({ stiffness: value })}
          action="stiffness"
        />
        <ParameterSlider
          label="阻尼"
          value={controls.damping}
          displayValue={`${Math.round(controls.damping * 100)}%`}
          onChange={(value) => onControls({ damping: value })}
          action="damping"
        />
      </section>

      <section className="panel-section" aria-labelledby="controls-heading">
        <div className="section-heading">
          <h3 id="controls-heading">交互控制</h3>
        </div>
        <div className="button-grid">
          <ControlButton
            label={stoneMode === 'seated' ? '弹出果核' : '放回果核'}
            active={stoneMode === 'ejected'}
            onClick={() => onStoneMode(stoneMode === 'seated' ? 'ejected' : 'seated')}
            action="stone"
          >
            {stoneMode === 'seated' ? <ArrowUpFromLine size={18} /> : <ArrowDownToLine size={18} />}
          </ControlButton>
          <ControlButton
            label={paused ? '继续模拟' : '暂停模拟'}
            active={paused}
            onClick={() => onControls({ paused: !paused })}
            action="pause"
          >
            {paused ? <Play size={18} /> : <Pause size={18} />}
          </ControlButton>
          <ControlButton
            label="1/4 速度"
            active={quarterSpeed}
            onClick={() => onControls({ timeScale: quarterSpeed ? 1 : 0.25 })}
            action="speed"
          >
            <TimerReset size={18} />
          </ControlButton>
          <ControlButton
            label="四面体网格"
            active={gridVisible}
            onClick={() => onGridVisible(!gridVisible)}
            action="grid"
          >
            <Grid3X3 size={18} />
          </ControlButton>
        </div>
        <button type="button" className="reset-button" data-action="reset" onClick={onReset}>
          <RotateCcw size={17} />
          重置样片
        </button>
      </section>

      <div className="model-scale">
        <span>模型规模</span>
        <strong>
          {nodeCount} 粒子 · {tetraCount} 四面体
        </strong>
      </div>
      <p className="panel-note">空白处拖动旋转视角，滚轮缩放。</p>
    </aside>
  )
}
