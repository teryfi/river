// Waterflow Simulation Engine
// Cell-based hydraulic erosion simulation with improved physics

export interface SimConfig {
  width: number;
  height: number;
  waterLevel: number; // 0-1
  flowSpeed: number; // 0.1-3
  erosionStrength: number; // 0-1
  sedimentCapacity: number; // 0-1
}

export interface SimulationState {
  terrain: Float32Array;
  water: Float32Array;
  sediment: Float32Array;
  velocity: Float32Array;
  flowX: Float32Array;
  flowY: Float32Array;
  obstacles: Uint8Array;
  config: SimConfig;
}

export function createSimulation(config: SimConfig): SimulationState {
  const size = config.width * config.height;
  const terrain = new Float32Array(size);
  const water = new Float32Array(size);
  const sediment = new Float32Array(size);
  const velocity = new Float32Array(size);
  const flowX = new Float32Array(size);
  const flowY = new Float32Array(size);
  const obstacles = new Uint8Array(size);

  initTerrain(terrain, config);

  return { terrain, water, sediment, velocity, flowX, flowY, obstacles, config };
}

function initTerrain(terrain: Float32Array, config: SimConfig) {
  const { width, height } = config;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const nx = x / width;
      const ny = y / height;
      
      // Base height - slightly bowl-shaped with slope
      let h = 0.25;
      
      // Side banks (higher at edges)
      const edgeDist = Math.min(nx, 1 - nx) * 2;
      h += Math.max(0, (0.4 - edgeDist) * 0.5);
      
      // Gentle downward slope
      h += (1 - ny) * 0.12;
      
      // Natural noise layers
      h += fbmNoise(x * 0.04, y * 0.04) * 0.08;
      h += fbmNoise(x * 0.08, y * 0.08) * 0.04;
      h += fbmNoise(x * 0.15, y * 0.15) * 0.02;
      
      terrain[idx] = Math.max(0.05, h);
    }
  }
}

// Simple hash-based noise
function hash(x: number, y: number): number {
  let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function noise2D(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  
  // Smoothstep
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbmNoise(x: number, y: number): number {
  return noise2D(x, y) * 2 - 1;
}

export function addWater(state: SimulationState, amount: number) {
  const { config } = state;
  const sourceWidth = Math.floor(config.width * 0.3);
  const startX = Math.floor((config.width - sourceWidth) / 2);
  
  for (let x = startX; x < startX + sourceWidth; x++) {
    for (let y = 0; y < 3; y++) {
      const idx = y * config.width + x;
      state.water[idx] += amount * 0.01;
    }
  }
}

export function stepSimulation(state: SimulationState, dt: number) {
  const { config, terrain, water, sediment, velocity, flowX, flowY, obstacles } = state;
  const { width, height, flowSpeed, erosionStrength, sedimentCapacity } = config;
  const size = width * height;
  
  // Temporary arrays for flow computation
  const outFlow = new Float32Array(size * 4); // flow in 4 directions per cell
  
  // Add water from source at top
  const sourceRate = config.waterLevel * 0.003 * flowSpeed;
  const sourceWidth = Math.floor(width * 0.3);
  const startX = Math.floor((width - sourceWidth) / 2);
  
  for (let x = startX; x < startX + sourceWidth; x++) {
    for (let y = 0; y < 3; y++) {
      const idx = y * width + x;
      if (!obstacles[idx]) {
        water[idx] += sourceRate * dt;
      }
    }
  }
  
  // Compute water flow using pipe model
  const gravity = 0.8 * flowSpeed;
  const crossSection = 0.4;
  
  // Direction offsets: right, left, down, up
  const dx = [1, -1, 0, 0];
  const dy = [0, 0, 1, -1];
  
  // Compute outflow for each cell
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      
      if (obstacles[idx] || water[idx] <= 0) continue;
      
      const totalHeight = terrain[idx] + water[idx];
      let totalOutFlow = 0;
      
      for (let d = 0; d < 4; d++) {
        const nx = x + dx[d];
        const ny = y + dy[d];
        
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          // Boundary - allow outflow
          const outF = Math.max(0, (totalHeight - terrain[idx] * 0.5) * gravity * crossSection);
          outFlow[idx * 4 + d] = Math.min(water[idx] * 0.25, outF);
          totalOutFlow += outFlow[idx * 4 + d];
          continue;
        }
        
        const nIdx = ny * width + nx;
        
        if (obstacles[nIdx]) {
          outFlow[idx * 4 + d] = 0;
          continue;
        }
        
        const nTotalHeight = terrain[nIdx] + water[nIdx];
        const heightDiff = totalHeight - nTotalHeight;
        
        if (heightDiff > 0) {
          const flow = heightDiff * gravity * crossSection * dt;
          outFlow[idx * 4 + d] = Math.min(water[idx] * 0.25, flow);
          totalOutFlow += outFlow[idx * 4 + d];
        } else {
          outFlow[idx * 4 + d] = 0;
        }
      }
      
      // Scale down if total outflow exceeds available water
      if (totalOutFlow > water[idx]) {
        const scale = water[idx] / totalOutFlow;
        for (let d = 0; d < 4; d++) {
          outFlow[idx * 4 + d] *= scale;
        }
      }
    }
  }
  
  // Apply flows and compute velocity
  const newWater = new Float32Array(size);
  const newFlowX = new Float32Array(size);
  const newFlowY = new Float32Array(size);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      
      if (obstacles[idx]) continue;
      
      let netFlow = 0;
      
      // Outflow
      for (let d = 0; d < 4; d++) {
        netFlow -= outFlow[idx * 4 + d];
        
        const nx = x + dx[d];
        const ny = y + dy[d];
        
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nIdx = ny * width + nx;
          if (!obstacles[nIdx]) {
            newWater[nIdx] += outFlow[idx * 4 + d];
            newFlowX[nIdx] += dx[d] * outFlow[idx * 4 + d];
            newFlowY[nIdx] += dy[d] * outFlow[idx * 4 + d];
          }
        }
      }
      
      newWater[idx] += water[idx] + netFlow;
      if (newWater[idx] < 0) newWater[idx] = 0;
    }
  }
  
  // Copy water and compute velocity
  for (let i = 0; i < size; i++) {
    water[i] = newWater[i];
    flowX[i] = newFlowX[i] * 0.5 + flowX[i] * 0.5; // smooth
    flowY[i] = newFlowY[i] * 0.5 + flowY[i] * 0.5;
    
    const fx = flowX[i];
    const fy = flowY[i];
    velocity[i] = water[i] > 0.001 ? Math.sqrt(fx * fx + fy * fy) / water[i] : 0;
  }
  
  // Sediment transport
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      
      if (obstacles[idx] || water[idx] < 0.002) continue;
      
      const vel = velocity[idx];
      
      // Erosion: fast water picks up sediment
      const maxSediment = sedimentCapacity * vel * water[idx] * 1.2;
      const erosionRate = erosionStrength * vel * vel * 0.008 * dt;
      
      if (sediment[idx] < maxSediment && terrain[idx] > 0.06) {
        const erode = Math.min(erosionRate, (terrain[idx] - 0.06) * 0.15);
        terrain[idx] -= erode;
        sediment[idx] += erode;
      }
      
      // Deposition: slow water drops sediment
      if (vel < 0.02 && sediment[idx] > 0) {
        const deposit = sediment[idx] * 0.02 * dt;
        sediment[idx] -= deposit;
        terrain[idx] += deposit * 0.7;
      }
      
      // Transport sediment with flow
      const fx = flowX[idx];
      const fy = flowY[idx];
      const sedTransport = sediment[idx] * 0.05 * dt;
      
      if (sedTransport > 0 && water[idx] > 0.001) {
        const nx = x + Math.sign(fx);
        const ny = y + Math.sign(fy);
        
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nIdx = ny * width + nx;
          if (!obstacles[nIdx]) {
            const transfer = Math.min(sedTransport, sediment[idx] * 0.3);
            sediment[nIdx] += transfer;
            sediment[idx] -= transfer;
          }
        }
      }
    }
  }
  
  // Slow evaporation
  for (let i = 0; i < size; i++) {
    water[i] *= (1 - 0.0002 * dt);
    if (water[i] < 0.0005) {
      water[i] = 0;
      sediment[i] *= 0.95;
    }
  }
  
  // Drain at bottom
  for (let x = 0; x < width; x++) {
    const idx = (height - 1) * width + x;
    water[idx] *= 0.85;
    sediment[idx] *= 0.85;
  }
  
  // Also drain at sides
  for (let y = 0; y < height; y++) {
    water[y * width] *= 0.9;
    water[y * width + width - 1] *= 0.9;
  }
}

export function modifyTerrain(state: SimulationState, cx: number, cy: number, radius: number, amount: number) {
  const { terrain, config } = state;
  const { width, height } = config;
  
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;
      
      const falloff = 1 - (dist / radius) * (dist / radius); // quadratic falloff
      const idx = y * width + x;
      terrain[idx] += amount * falloff * 0.015;
      terrain[idx] = Math.max(0.01, terrain[idx]);
    }
  }
}

export function smoothTerrain(state: SimulationState, cx: number, cy: number, radius: number) {
  const { terrain, config } = state;
  const { width, height } = config;
  
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 1 || x >= width - 1 || y < 1 || y >= height - 1) continue;
      
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;
      
      const idx = y * width + x;
      const avg = (
        terrain[idx - 1] + terrain[idx + 1] +
        terrain[idx - width] + terrain[idx + width] +
        terrain[idx - width - 1] + terrain[idx - width + 1] +
        terrain[idx + width - 1] + terrain[idx + width + 1]
      ) * 0.125;
      
      const falloff = 1 - dist / radius;
      terrain[idx] = terrain[idx] * (1 - falloff * 0.4) + avg * falloff * 0.4;
    }
  }
}

export function setObstacle(state: SimulationState, cx: number, cy: number, radius: number, value: boolean) {
  const { obstacles, config } = state;
  const { width, height } = config;
  
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;
      
      const idx = y * width + x;
      obstacles[idx] = value ? 1 : 0;
    }
  }
}

export function drawLine(state: SimulationState, x0: number, y0: number, x1: number, y1: number, radius: number, value: boolean) {
  const dist = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
  const steps = Math.max(1, Math.ceil(dist / Math.max(0.5, radius * 0.5)));
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    setObstacle(state, x, y, radius, value);
  }
}

export function resetWater(state: SimulationState) {
  const size = state.config.width * state.config.height;
  state.water.fill(0);
  state.sediment.fill(0);
  state.velocity.fill(0);
  state.flowX.fill(0);
  state.flowY.fill(0);
}

export function resetAll(state: SimulationState) {
  resetWater(state);
  state.obstacles.fill(0);
  initTerrain(state.terrain, state.config);
}
