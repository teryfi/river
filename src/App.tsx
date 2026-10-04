import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createSimulation,
  stepSimulation,
  modifyTerrain,
  smoothTerrain,
  setObstacle,
  drawLine,
  resetWater,
  resetAll,
  SimulationState,
} from './simulation/engine';
import { renderSimulation, clearParticles, ViewMode } from './simulation/renderer';

type Tool = 'raise' | 'lower' | 'smooth' | 'hill' | 'valley' | 'wall' | 'draw_wall' | 'erase_wall';
type Scenario = 'free' | 'first_river' | 'dam' | 'escape' | 'split' | 'flood' | 'natural';

const GRID_W = 150;
const GRID_H = 110;

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<SimulationState | null>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const mouseRef = useRef<{ down: boolean; x: number; y: number; lastX: number; lastY: number }>({
    down: false, x: 0, y: 0, lastX: 0, lastY: 0
  });

  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [waterLevel, setWaterLevel] = useState(45);
  const [flowSpeed, setFlowSpeed] = useState(1.2);
  const [erosion, setErosion] = useState(55);
  const [sediment, setSediment] = useState(50);
  const [tool, setTool] = useState<Tool>('raise');
  const [brushSize, setBrushSize] = useState(5);
  const [viewMode, setViewMode] = useState<ViewMode>('normal');
  const [observing, setObserving] = useState(false);
  const [scenario, setScenario] = useState<Scenario>('free');
  const [showHint, setShowHint] = useState(true);

  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  const viewModeRef = useRef(viewMode);
  const toolRef = useRef(tool);
  const brushSizeRef = useRef(brushSize);

  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { brushSizeRef.current = brushSize; }, [brushSize]);

  useEffect(() => {
    if (stateRef.current) {
      stateRef.current.config.waterLevel = waterLevel / 100;
      stateRef.current.config.flowSpeed = flowSpeed;
      stateRef.current.config.erosionStrength = erosion / 100;
      stateRef.current.config.sedimentCapacity = sediment / 100;
    }
  }, [waterLevel, flowSpeed, erosion, sediment]);

  // Initialize
  useEffect(() => {
    const sim = createSimulation({
      width: GRID_W,
      height: GRID_H,
      waterLevel: waterLevel / 100,
      flowSpeed: flowSpeed,
      erosionStrength: erosion / 100,
      sedimentCapacity: sediment / 100,
    });
    stateRef.current = sim;
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p); }
      if (e.key === 'r' || e.key === 'R') handleReset();
      if (e.key === 'o' || e.key === 'O') setObserving(o => !o);
      if (e.key === '1') setSpeed(1);
      if (e.key === '2') setSpeed(2);
      if (e.key === '3') setSpeed(5);
      if (e.key === '4') setSpeed(10);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const resize = () => {
      const container = canvas.parentElement;
      if (!container) return;
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    let lastTime = 0;
    const loop = (timestamp: number) => {
      if (!stateRef.current || !ctx) return;
      
      const delta = timestamp - lastTime;
      lastTime = timestamp;

      if (playingRef.current && delta < 100) {
        const steps = Math.max(1, Math.min(6, Math.floor(speedRef.current * 2)));
        for (let i = 0; i < steps; i++) {
          stepSimulation(stateRef.current, 1);
        }
        timeRef.current += 0.016 * speedRef.current;
      }
      
      renderSimulation(ctx, stateRef.current, canvas, {
        viewMode: viewModeRef.current,
        showParticles: true,
        time: timeRef.current,
      });

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const getGridPos = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * GRID_W);
    const y = Math.floor(((clientY - rect.top) / rect.height) * GRID_H);
    return { x: Math.max(0, Math.min(GRID_W - 1, x)), y: Math.max(0, Math.min(GRID_H - 1, y)) };
  }, []);

  const applyTool = useCallback((x0: number, y0: number, x1: number, y1: number) => {
    const state = stateRef.current;
    if (!state) return;
    const r = brushSizeRef.current;
    const t = toolRef.current;

    switch (t) {
      case 'raise':
        modifyTerrain(state, x1, y1, r, 3);
        break;
      case 'lower':
        modifyTerrain(state, x1, y1, r, -3);
        break;
      case 'smooth':
        smoothTerrain(state, x1, y1, r);
        break;
      case 'hill':
        modifyTerrain(state, x1, y1, r * 1.5, 6);
        break;
      case 'valley':
        modifyTerrain(state, x1, y1, r * 1.5, -6);
        break;
      case 'wall':
        setObstacle(state, x1, y1, r, true);
        break;
      case 'draw_wall':
        drawLine(state, x0, y0, x1, y1, Math.max(1, r * 0.4), true);
        break;
      case 'erase_wall':
        setObstacle(state, x1, y1, r, false);
        break;
    }
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    mouseRef.current.down = true;
    const { x, y } = getGridPos(e.clientX, e.clientY);
    mouseRef.current.x = x;
    mouseRef.current.y = y;
    mouseRef.current.lastX = x;
    mouseRef.current.lastY = y;
    applyTool(x, y, x, y);
    if (showHint) setShowHint(false);
  }, [getGridPos, applyTool, showHint]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!mouseRef.current.down) return;
    const { x, y } = getGridPos(e.clientX, e.clientY);
    mouseRef.current.lastX = mouseRef.current.x;
    mouseRef.current.lastY = mouseRef.current.y;
    mouseRef.current.x = x;
    mouseRef.current.y = y;
    applyTool(mouseRef.current.lastX, mouseRef.current.lastY, x, y);
  }, [getGridPos, applyTool]);

  const handlePointerUp = useCallback(() => {
    mouseRef.current.down = false;
  }, []);

  const handleReset = () => {
    if (stateRef.current) {
      resetAll(stateRef.current);
      clearParticles();
    }
  };

  const handleResetWater = () => {
    if (stateRef.current) {
      resetWater(stateRef.current);
      clearParticles();
    }
  };

  const applyScenario = useCallback((s: Scenario, state: SimulationState) => {
    resetAll(state);
    const { width, height } = state.config;

    switch (s) {
      case 'dam': {
        for (let x = 15; x < width - 15; x++) {
          setObstacle(state, x, Math.floor(height * 0.45), 2, true);
        }
        // Gap in the dam
        for (let x = Math.floor(width * 0.62); x < Math.floor(width * 0.62) + 10; x++) {
          setObstacle(state, x, Math.floor(height * 0.45), 2, false);
        }
        break;
      }
      case 'escape': {
        const cx = width / 2;
        const cy = height * 0.45;
        const r = 22;
        for (let angle = 0; angle < Math.PI * 2; angle += 0.04) {
          const x = Math.floor(cx + Math.cos(angle) * r);
          const y = Math.floor(cy + Math.sin(angle) * r);
          setObstacle(state, x, y, 2, true);
        }
        // Opening on the right
        for (let y2 = Math.floor(cy) - 3; y2 < Math.floor(cy) + 3; y2++) {
          setObstacle(state, Math.floor(cx + r), y2, 2, false);
        }
        break;
      }
      case 'split': {
        const midX = Math.floor(width / 2);
        const midY = Math.floor(height * 0.35);
        drawLine(state, midX, midY, midX - 22, midY + 25, 2, true);
        drawLine(state, midX, midY, midX + 22, midY + 25, 2, true);
        break;
      }
      case 'flood': {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            state.terrain[idx] = 0.18 + Math.sin(x * 0.05) * 0.02;
          }
        }
        break;
      }
      case 'natural': {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const nx = x / width;
            const ny = y / height;
            state.terrain[idx] = 0.12 + Math.sin(nx * 6 + ny * 2) * 0.04 + (1 - ny) * 0.08;
          }
        }
        break;
      }
      case 'first_river': {
        // Flat with slight depression in center
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const nx = (x - width / 2) / width;
            state.terrain[idx] = 0.2 + Math.abs(nx) * 0.3;
          }
        }
        break;
      }
    }
  }, []);

  const handleScenarioChange = useCallback((s: Scenario) => {
    setScenario(s);
    if (stateRef.current) {
      applyScenario(s, stateRef.current);
      clearParticles();
    }
  }, [applyScenario]);

  const tools: { id: Tool; label: string; icon: string }[] = [
    { id: 'raise', label: 'Поднять', icon: '△' },
    { id: 'lower', label: 'Опустить', icon: '▽' },
    { id: 'smooth', label: 'Сгладить', icon: '○' },
    { id: 'hill', label: 'Холм', icon: '⏶' },
    { id: 'valley', label: 'Впадина', icon: '⏷' },
    { id: 'wall', label: 'Камень', icon: '●' },
    { id: 'draw_wall', label: 'Стена', icon: '╱' },
    { id: 'erase_wall', label: 'Ластик', icon: '✕' },
  ];

  const scenarios: { id: Scenario; label: string; num: string }[] = [
    { id: 'free', label: 'Свободный', num: '∞' },
    { id: 'first_river', label: 'Первая река', num: '01' },
    { id: 'dam', label: 'Плотина', num: '02' },
    { id: 'escape', label: 'Побег', num: '03' },
    { id: 'split', label: 'Разделение', num: '04' },
    { id: 'flood', label: 'Потоп', num: '05' },
    { id: 'natural', label: 'Природная', num: '06' },
  ];

  const viewModes: { id: ViewMode; label: string }[] = [
    { id: 'normal', label: 'Обычный' },
    { id: 'velocity', label: 'Скорость' },
    { id: 'erosion', label: 'Эрозия' },
    { id: 'sediment', label: 'Осадки' },
    { id: 'depth', label: 'Глубина' },
  ];

  return (
    <div className="w-full h-full bg-[#080810] text-white overflow-hidden relative select-none" style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* Canvas */}
      <div className="absolute inset-0 z-0">
        <canvas
          ref={canvasRef}
          className="w-full h-full cursor-crosshair"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </div>

      {/* Top Bar */}
      <div className={`absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-5 py-3 transition-all duration-700 ${observing ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-400/60 animate-pulse" />
            <h1 className="text-[13px] font-light tracking-[0.2em] text-white/80 uppercase">Waterflow</h1>
            <span className="text-[13px] font-extralight text-white/30">Lab</span>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPlaying(!playing)}
            className="group flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.15] text-[11px] tracking-wide transition-all duration-300"
          >
            <span className="text-[14px]">{playing ? '⏸' : '▶'}</span>
            <span className="text-white/60 group-hover:text-white/90 transition-colors">{playing ? 'Пауза' : 'Старт'}</span>
          </button>
          
          <div className="flex items-center gap-0.5 bg-white/[0.04] rounded-lg border border-white/[0.08] p-1">
            {[1, 2, 5, 10].map(s => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-medium tracking-wide transition-all duration-200 ${
                  speed === s 
                    ? 'bg-blue-500/20 text-blue-300 shadow-sm shadow-blue-500/10' 
                    : 'text-white/40 hover:text-white/70'
                }`}
              >
                ×{s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Left Panel - Tools */}
      <div className={`absolute left-4 top-16 bottom-16 z-20 flex flex-col transition-all duration-700 ${observing ? 'opacity-0 pointer-events-none -translate-x-8' : 'opacity-100'}`}>
        <div className="bg-black/30 backdrop-blur-xl border border-white/[0.06] rounded-xl p-3 flex flex-col gap-1">
          <div className="text-[8px] uppercase tracking-[0.2em] text-white/25 mb-2 px-1">Инструменты</div>
          {tools.map(t => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[11px] transition-all duration-200 ${
                tool === t.id
                  ? 'bg-blue-500/15 border border-blue-400/20 text-blue-200 shadow-sm shadow-blue-500/5'
                  : 'border border-transparent text-white/50 hover:bg-white/[0.04] hover:text-white/80'
              }`}
            >
              <span className="w-5 text-center text-[13px]">{t.icon}</span>
              <span className="tracking-wide">{t.label}</span>
            </button>
          ))}
          
          <div className="mt-3 pt-3 border-t border-white/[0.06]">
            <div className="text-[8px] uppercase tracking-[0.2em] text-white/25 mb-2 px-1">Размер кисти</div>
            <input
              type="range"
              min="1"
              max="15"
              value={brushSize}
              onChange={e => setBrushSize(Number(e.target.value))}
              className="w-full accent-blue-400/70"
            />
            <div className="text-[9px] text-white/30 text-center mt-1">{brushSize} px</div>
          </div>
        </div>
      </div>

      {/* Right Panel */}
      <div className={`absolute right-4 top-16 z-20 w-[180px] flex flex-col gap-3 transition-all duration-700 ${observing ? 'opacity-0 pointer-events-none translate-x-8' : 'opacity-100'}`}>
        {/* Simulation Controls */}
        <div className="bg-black/30 backdrop-blur-xl border border-white/[0.06] rounded-xl p-3.5">
          <div className="text-[8px] uppercase tracking-[0.2em] text-white/25 mb-3">Симуляция</div>
          
          <div className="space-y-3.5">
            <SliderControl label="Уровень воды" value={waterLevel} max={100} unit="%" color="blue" onChange={setWaterLevel} />
            <SliderControl label="Скорость потока" value={flowSpeed} max={3} step={0.1} unit="" color="cyan" onChange={setFlowSpeed} displayValue={flowSpeed.toFixed(1)} />
            <SliderControl label="Эрозия" value={erosion} max={100} unit="%" color="amber" onChange={setErosion} />
            <SliderControl label="Осадки" value={sediment} max={100} unit="%" color="orange" onChange={setSediment} />
          </div>
        </div>

        {/* View Modes */}
        <div className="bg-black/30 backdrop-blur-xl border border-white/[0.06] rounded-xl p-3.5">
          <div className="text-[8px] uppercase tracking-[0.2em] text-white/25 mb-2.5">Визуализация</div>
          <div className="flex flex-wrap gap-1">
            {viewModes.map(m => (
              <button
                key={m.id}
                onClick={() => setViewMode(m.id)}
                className={`px-2 py-1 rounded-md text-[10px] tracking-wide transition-all duration-200 ${
                  viewMode === m.id 
                    ? 'bg-blue-500/15 text-blue-200 border border-blue-400/15' 
                    : 'text-white/35 hover:text-white/60 hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Panel */}
      <div className={`absolute bottom-0 left-0 right-0 z-20 transition-all duration-700 ${observing ? 'opacity-0 pointer-events-none translate-y-4' : 'opacity-100'}`}>
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            <button 
              onClick={handleReset}
              className="px-3.5 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.15] text-[11px] text-white/60 hover:text-white/90 tracking-wide transition-all duration-200"
            >
              ↺ Сброс
            </button>
            <button 
              onClick={handleResetWater}
              className="px-3.5 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.15] text-[11px] text-white/60 hover:text-white/90 tracking-wide transition-all duration-200"
            >
              💧 Сброс воды
            </button>
            <button
              onClick={() => setObserving(!observing)}
              className={`px-3.5 py-2 rounded-lg border text-[11px] tracking-wide transition-all duration-300 ${
                observing 
                  ? 'bg-blue-500/15 border-blue-400/20 text-blue-200' 
                  : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.08] hover:border-white/[0.15] text-white/60 hover:text-white/90'
              }`}
            >
              👁 Наблюдение
            </button>
          </div>

          {/* Scenarios */}
          <div className="flex items-center gap-1.5 bg-black/30 backdrop-blur-xl border border-white/[0.06] rounded-xl px-3 py-2">
            <span className="text-[8px] uppercase tracking-[0.2em] text-white/20 mr-1">Сценарий</span>
            {scenarios.map(s => (
              <button
                key={s.id}
                onClick={() => handleScenarioChange(s.id)}
                className={`px-2 py-1 rounded-md text-[10px] tracking-wide transition-all duration-200 ${
                  scenario === s.id 
                    ? 'bg-blue-500/15 text-blue-200' 
                    : 'text-white/35 hover:text-white/65 hover:bg-white/[0.04]'
                }`}
              >
                <span className="text-white/20 mr-0.5">{s.num}</span>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Observe mode exit */}
      {observing && (
        <div
          className="absolute top-4 right-4 z-30 opacity-20 hover:opacity-100 transition-all duration-300 cursor-pointer group"
          onClick={() => setObserving(false)}
        >
          <div className="px-4 py-2 rounded-lg bg-black/40 backdrop-blur-sm border border-white/10 text-[11px] text-white/60 group-hover:text-white/90 tracking-wide">
            ✕ Выйти из наблюдения
          </div>
        </div>
      )}

      {/* Hint */}
      {showHint && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-black/70 backdrop-blur-xl border border-white/[0.08] rounded-2xl px-8 py-6 text-center max-w-md animate-fade-in">
            <div className="text-2xl mb-3">🌊</div>
            <div className="text-sm font-light text-white/80 mb-2 tracking-wide">Waterflow Lab</div>
            <div className="text-[11px] text-white/40 leading-relaxed">
              Выберите инструмент и рисуйте рельеф мышью.<br/>
              Размещайте препятствия, настраивайте параметры.<br/>
              Наблюдайте, как вода формирует русло реки.
            </div>
            <div className="mt-4 text-[10px] text-white/20">
              Нажмите в любом месте, чтобы начать
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Slider component
function SliderControl({ label, value, max, step = 1, unit, color, onChange, displayValue }: {
  label: string;
  value: number;
  max: number;
  step?: number;
  unit: string;
  color: string;
  onChange: (v: number) => void;
  displayValue?: string;
}) {
  const colorClasses: Record<string, string> = {
    blue: 'accent-blue-400',
    cyan: 'accent-cyan-400',
    amber: 'accent-amber-400',
    orange: 'accent-orange-400',
  };

  return (
    <div>
      <div className="flex justify-between text-[10px] text-white/40 mb-1.5">
        <span className="tracking-wide">{label}</span>
        <span className="font-mono text-white/50">{displayValue ?? value}{unit}</span>
      </div>
      <input
        type="range"
        min="0"
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className={`w-full ${colorClasses[color] || 'accent-blue-400'}`}
      />
    </div>
  );
}

export default App;
