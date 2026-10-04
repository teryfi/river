import { SimulationState } from './engine';

export type ViewMode = 'normal' | 'velocity' | 'erosion' | 'sediment' | 'depth';

export interface RenderOptions {
  viewMode: ViewMode;
  showParticles: boolean;
  time: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  type: 'sand' | 'bubble' | 'splash';
  size: number;
}

let particles: Particle[] = [];
const MAX_PARTICLES = 1200;

// Offscreen canvas for terrain
let offCanvas: HTMLCanvasElement | null = null;
let offCtx: CanvasRenderingContext2D | null = null;
let lastGridW = 0;
let lastGridH = 0;

function getOffscreen(w: number, h: number) {
  if (!offCanvas || lastGridW !== w || lastGridH !== h) {
    offCanvas = document.createElement('canvas');
    offCanvas.width = w;
    offCanvas.height = h;
    offCtx = offCanvas.getContext('2d');
    lastGridW = w;
    lastGridH = h;
  }
  return { canvas: offCanvas!, ctx: offCtx! };
}

export function renderSimulation(
  ctx: CanvasRenderingContext2D,
  state: SimulationState,
  canvas: HTMLCanvasElement,
  options: RenderOptions
) {
  const { width, height } = state.config;
  const cw = canvas.width;
  const ch = canvas.height;
  
  if (cw === 0 || ch === 0) return;
  
  const { canvas: offCvs, ctx: offCtxLocal } = getOffscreen(width, height);
  
  // Render terrain to offscreen canvas at grid resolution
  const imageData = offCtxLocal.createImageData(width, height);
  const data = imageData.data;
  
  const { terrain, water, sediment, velocity, obstacles } = state;
  const time = options.time;
  const mode = options.viewMode;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const pidx = idx * 4;
      
      const terrainH = terrain[idx];
      const waterH = water[idx];
      const obstacle = obstacles[idx];
      const vel = velocity[idx];
      const sed = sediment[idx];
      
      let r = 0, g = 0, b = 0;
      
      if (obstacle) {
        const stoneVar = Math.sin(x * 0.7 + y * 0.5) * 6 + Math.cos(x * 0.3 - y * 0.8) * 4;
        r = 36 + stoneVar;
        g = 38 + stoneVar;
        b = 44 + stoneVar;
      } else if (mode === 'normal') {
        // Terrain base - sandy earth tones
        const tNorm = Math.min(1, terrainH * 1.6);
        r = 52 + tNorm * 105;
        g = 38 + tNorm * 70;
        b = 20 + tNorm * 25;
        
        // Natural texture
        const tex = Math.sin(x * 0.5 + y * 0.7) * 6 + Math.cos(x * 0.8 - y * 0.4) * 4;
        r += tex;
        g += tex * 0.5;
        
        // Vegetation hint on high terrain
        if (terrainH > 0.55) {
          const veg = (terrainH - 0.55) * 40;
          g += veg;
          r -= veg * 0.3;
        }
        
        // Water overlay
        if (waterH > 0.003) {
          const waterDepth = Math.min(1, waterH * 3.5);
          const waterAlpha = Math.min(0.88, waterDepth * 0.55 + 0.22);
          
          // Animated waves
          const wave1 = Math.sin(x * 0.18 + time * 1.6) * Math.cos(y * 0.14 + time * 1.1);
          const wave2 = Math.sin(x * 0.09 - time * 0.7 + y * 0.12) * 0.5;
          const wave3 = Math.cos(x * 0.25 + y * 0.2 + time * 2.2) * 0.3;
          
          const wR = 12 + (1 - waterDepth) * 22 + wave1 * 7 + wave3 * 3;
          const wG = 45 + (1 - waterDepth) * 30 + wave1 * 10 + wave2 * 5;
          const wB = 105 + waterDepth * 65 + wave1 * 4;
          
          // Foam/whitecaps at high velocity
          const foam = vel > 0.05 && waterH < 0.03 ? Math.min(1, vel * 10) * 0.4 : 0;
          
          r = Math.floor(r * (1 - waterAlpha) + (wR + foam * 120) * waterAlpha);
          g = Math.floor(g * (1 - waterAlpha) + (wG + foam * 120) * waterAlpha);
          b = Math.floor(b * (1 - waterAlpha) + (wB + foam * 80) * waterAlpha);
        }
      } else if (mode === 'velocity') {
        const vNorm = Math.min(1, vel * 12);
        r = Math.floor(15 + vNorm * 240);
        g = Math.floor(15 + (1 - vNorm * 0.6) * 70);
        b = Math.floor(15 + (1 - vNorm) * 240);
        if (waterH < 0.001) { r = 22; g = 22; b = 28; }
      } else if (mode === 'erosion') {
        const eNorm = Math.min(1, vel * terrainH * 20);
        r = Math.floor(25 + eNorm * 230);
        g = Math.floor(25 + eNorm * 70);
        b = 18;
        if (waterH < 0.001) { r = 22; g = 22; b = 22; }
      } else if (mode === 'sediment') {
        const sNorm = Math.min(1, sed * 35);
        r = Math.floor(150 + sNorm * 105);
        g = Math.floor(100 + sNorm * 95);
        b = Math.floor(25 + sNorm * 35);
        if (waterH < 0.001) { r = 22; g = 22; b = 22; }
      } else if (mode === 'depth') {
        const dNorm = Math.min(1, waterH * 2);
        r = Math.floor(12 + (1 - dNorm) * 50);
        g = Math.floor(25 + (1 - dNorm) * 70 + dNorm * 25);
        b = Math.floor(50 + dNorm * 205);
        if (waterH < 0.001) { r = 30; g = 35; b = 30; }
      }
      
      data[pidx] = Math.max(0, Math.min(255, r));
      data[pidx + 1] = Math.max(0, Math.min(255, g));
      data[pidx + 2] = Math.max(0, Math.min(255, b));
      data[pidx + 3] = 255;
    }
  }
  
  offCtxLocal.putImageData(imageData, 0, 0);
  
  // Clear main canvas
  ctx.fillStyle = '#080810';
  ctx.fillRect(0, 0, cw, ch);
  
  // Draw terrain scaled up
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(offCvs, 0, 0, cw, ch);
  
  // Flow lines overlay
  if (mode === 'normal') {
    drawFlowLines(ctx, state, cw / width, ch / height, time);
  }
  
  // Particles
  if (options.showParticles) {
    updateAndDrawParticles(ctx, state, cw / width, ch / height, time);
  }
  
  // Vignette
  drawVignette(ctx, cw, ch);
  
  // Subtle border glow
  ctx.strokeStyle = 'rgba(100, 150, 255, 0.03)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, cw - 2, ch - 2);
}

function drawFlowLines(
  ctx: CanvasRenderingContext2D,
  state: SimulationState,
  cellW: number,
  cellH: number,
  time: number
) {
  const { width, height } = state.config;
  const { water, flowX, flowY, obstacles } = state;
  
  const step = 5;
  ctx.lineWidth = 0.7;
  
  for (let y = 2; y < height - 2; y += step) {
    for (let x = 2; x < width - 2; x += step) {
      const idx = y * width + x;
      if (water[idx] < 0.02 || obstacles[idx]) continue;
      
      const fx = flowX[idx];
      const fy = flowY[idx];
      const mag = Math.sqrt(fx * fx + fy * fy);
      
      if (mag < 0.002) continue;
      
      const px = (x + 0.5) * cellW;
      const py = (y + 0.5) * cellH;
      
      const len = Math.min(mag * 70, cellW * step * 0.6);
      const nx = fx / mag;
      const ny = fy / mag;
      
      const alpha = Math.min(0.18, mag * 2.5);
      ctx.strokeStyle = `rgba(130, 190, 255, ${alpha})`;
      
      const offset = (time * 2 + x * 0.07 + y * 0.05) % 1;
      
      ctx.beginPath();
      ctx.moveTo(px - nx * len * offset, py - ny * len * offset);
      ctx.lineTo(px + nx * len * (1 - offset), py + ny * len * (1 - offset));
      ctx.stroke();
    }
  }
}

function drawVignette(ctx: CanvasRenderingContext2D, cw: number, ch: number) {
  const gradient = ctx.createRadialGradient(cw / 2, ch / 2, cw * 0.25, cw / 2, ch / 2, cw * 0.65);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, cw, ch);
}

function updateAndDrawParticles(
  ctx: CanvasRenderingContext2D,
  state: SimulationState,
  cellW: number,
  cellH: number,
  _time: number
) {
  const { width, height } = state.config;
  const { water, velocity, flowX, flowY, obstacles } = state;
  
  // Spawn particles
  const spawnCount = particles.length < MAX_PARTICLES * 0.5 ? 8 : 2;
  for (let i = 0; i < spawnCount; i++) {
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    const idx = y * width + x;
    
    if (water[idx] > 0.025 && !obstacles[idx]) {
      const vel = velocity[idx];
      if (vel > 0.004 || Math.random() < 0.15) {
        particles.push({
          x: (x + Math.random()) * cellW,
          y: (y + Math.random()) * cellH,
          vx: flowX[idx] * 35 + (Math.random() - 0.5) * 1.5,
          vy: flowY[idx] * 35 + (Math.random() - 0.5) * 1.5,
          life: 0.7 + Math.random() * 0.3,
          type: Math.random() < 0.2 ? 'bubble' : (Math.random() < 0.55 ? 'sand' : 'splash'),
          size: Math.random() * 1.5 + 0.5,
        });
      }
    }
  }
  
  // Update and draw
  ctx.globalAlpha = 1;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    
    const gx = Math.floor(p.x / cellW);
    const gy = Math.floor(p.y / cellH);
    
    if (gx >= 0 && gx < width && gy >= 0 && gy < height) {
      const idx = gy * width + gx;
      
      if (water[idx] > 0.005 && !obstacles[idx]) {
        p.vx += (flowX[idx] * 20 - p.vx) * 0.06;
        p.vy += (flowY[idx] * 20 - p.vy) * 0.06;
        p.life -= 0.003;
      } else {
        p.vy += 0.08;
        p.life -= 0.03;
      }
    } else {
      p.life -= 0.06;
    }
    
    p.x += p.vx * 0.35;
    p.y += p.vy * 0.35;
    
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    
    // Draw
    const alpha = p.life * 0.45;
    switch (p.type) {
      case 'sand':
        ctx.fillStyle = `rgba(200, 170, 100, ${alpha})`;
        break;
      case 'bubble':
        ctx.fillStyle = `rgba(170, 210, 255, ${alpha * 0.6})`;
        break;
      case 'splash':
        ctx.fillStyle = `rgba(190, 220, 255, ${alpha * 0.4})`;
        break;
    }
    
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function clearParticles() {
  particles = [];
}
