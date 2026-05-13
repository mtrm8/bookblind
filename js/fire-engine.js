/**
 * FIRE ENGINE — Cellular automaton fire simulation + volumetric smoke.
 * Renders on its own canvas overlaid on the hero stage.
 * Produces realistic fire that spreads upward with turbulence,
 * plus dense layered smoke clouds.
 */
(function () {
  'use strict';

  const COLS = 96;
  const ROWS = 64;
  const COOLING = 0.055;      // how fast fire cools (higher = shorter flames)
  const SPREADING = 0.38;     // horizontal spread factor
  const TURBULENCE = 0.22;    // random cooling variation

  let W = 0, H = 0, DPR = 1;
  let intensity = 0;
  let grid = new Float32Array(COLS * ROWS);
  let nextGrid = new Float32Array(COLS * ROWS);
  let smokeParticles = [];
  let t = 0;

  // ── Canvas ────────────────────────────────────────────────────────────────
  const cv = document.createElement('canvas');
  cv.id = 'fire-canvas';
  cv.style.cssText = [
    'position:absolute', 'inset:0', 'width:100%', 'height:100%',
    'pointer-events:none', 'z-index:6', 'opacity:0',
    'mix-blend-mode:screen'
  ].join(';');

  let ctx = null;

  // ── Seeded RNG ────────────────────────────────────────────────────────────
  let _s = 0xFACEB00C;
  function r() { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; }

  // ── Fire color palette ────────────────────────────────────────────────────
  // Maps heat value (0-1) to RGBA
  const PALETTE = (() => {
    const p = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      if (t < 0.25) {
        // Black to deep red
        const f = t / 0.25;
        p[i*4+0] = Math.floor(f * 180);
        p[i*4+1] = 0;
        p[i*4+2] = 0;
        p[i*4+3] = Math.floor(f * 220);
      } else if (t < 0.55) {
        // Deep red to orange
        const f = (t - 0.25) / 0.30;
        p[i*4+0] = Math.floor(180 + f * 75);
        p[i*4+1] = Math.floor(f * 80);
        p[i*4+2] = 0;
        p[i*4+3] = Math.floor(220 + f * 30);
      } else if (t < 0.78) {
        // Orange to bright yellow
        const f = (t - 0.55) / 0.23;
        p[i*4+0] = 255;
        p[i*4+1] = Math.floor(80 + f * 140);
        p[i*4+2] = Math.floor(f * 20);
        p[i*4+3] = 250;
      } else {
        // Yellow-white hot core
        const f = (t - 0.78) / 0.22;
        p[i*4+0] = 255;
        p[i*4+1] = Math.floor(220 + f * 35);
        p[i*4+2] = Math.floor(20 + f * 235);
        p[i*4+3] = 255;
      }
    }
    return p;
  })();

  // ── Smoke particle ────────────────────────────────────────────────────────
  class SmokePuff {
    constructor(cx, cy) {
      const a = r() * Math.PI * 2;
      const spd = 0.4 + r() * 1.8;
      this.x     = cx + (r() - .5) * W * 0.25;
      this.y     = cy * 0.9;
      this.vx    = Math.cos(a) * spd * 0.5 + (r() - .5) * 0.8;
      this.vy    = -(0.6 + r() * 2.2);
      this.size  = 30 + r() * 180;
      this.life  = 1;
      this.decay = 0.003 + r() * 0.008;
      this.shade = 18 + r() * 90;
      this.rot   = r() * Math.PI * 2;
      this.spin  = (r() - .5) * 0.015;
    }

    step() {
      this.vx   *= 0.98;
      this.vy   *= 0.97;
      this.vy   -= 0.02;  // buoyancy
      this.x    += this.vx;
      this.y    += this.vy;
      this.rot  += this.spin;
      this.size += 1.2;
      this.life -= this.decay;
    }

    draw(ctx, intensity) {
      if (this.life <= 0) return;
      const alpha = this.life * intensity * 0.22;
      if (alpha < 0.005) return;
      const lum = Math.floor(this.shade);
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rot);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size);
      g.addColorStop(0,    `rgba(${lum},${lum},${lum},${alpha})`);
      g.addColorStop(0.45, `rgba(${Math.floor(lum*.72)},${Math.floor(lum*.68)},${Math.floor(lum*.60)},${alpha*.42})`);
      g.addColorStop(0.75, `rgba(${Math.floor(lum*.4)},${Math.floor(lum*.35)},${Math.floor(lum*.28)},${alpha*.12})`);
      g.addColorStop(1,    'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.scale(1.55, 0.85);
      ctx.beginPath();
      ctx.arc(0, 0, this.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── Cellular automaton step ────────────────────────────────────────────────
  function stepFire() {
    // Bottom row: heat sources when active
    if (intensity > 0.02) {
      const center = COLS * 0.5;
      const spread = COLS * 0.4 * intensity;
      for (let x = 0; x < COLS; x++) {
        const dx = Math.abs(x - center) / spread;
        const heat = Math.max(0, 1 - dx * dx) * intensity;
        const noise = (r() - .5) * TURBULENCE;
        grid[(ROWS - 1) * COLS + x] = Math.min(1, heat + noise + r() * 0.15 * intensity);
      }
    }

    // Propagate upward with cooling + spreading
    for (let y = 0; y < ROWS - 1; y++) {
      for (let x = 0; x < COLS; x++) {
        const left  = x > 0          ? grid[y * COLS + x - 1] : 0;
        const right = x < COLS - 1   ? grid[y * COLS + x + 1] : 0;
        const below = grid[(y + 1) * COLS + x];
        const spread = left * SPREADING + right * SPREADING + below * (1 - SPREADING * 2);
        const cooling = COOLING * (0.8 + r() * 0.4);
        nextGrid[y * COLS + x] = Math.max(0, Math.min(1, spread - cooling));
      }
    }
    [grid, nextGrid] = [nextGrid, grid];
  }

  // ── Render fire grid to canvas ────────────────────────────────────────────
  function renderFire(cx, cy) {
    if (!ctx || intensity < 0.01) return;
    const cellW = W / COLS;
    const cellH = (H * 0.65) / ROWS;
    const originY = cy;

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const heat = grid[y * COLS + x];
        if (heat < 0.02) continue;
        const pi = Math.min(255, Math.floor(heat * 255)) * 4;
        const px = PALETTE[pi], pg = PALETTE[pi+1], pb = PALETTE[pi+2], pa = PALETTE[pi+3];
        const alpha = (pa / 255) * intensity;
        if (alpha < 0.01) continue;
        const drawX = cx - (COLS * 0.5 * cellW) + x * cellW;
        const drawY = originY - (ROWS - y) * cellH;
        ctx.fillStyle = `rgba(${px},${pg},${pb},${alpha})`;
        ctx.fillRect(drawX, drawY, cellW + 0.5, cellH + 0.5);
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────
  window.FireEngine = {
    attach(heroStageEl) {
      if (!heroStageEl.contains(cv)) heroStageEl.appendChild(cv);
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = heroStageEl.clientWidth;
      H = heroStageEl.clientHeight;
      cv.width  = Math.round(W * DPR);
      cv.height = Math.round(H * DPR);
      cv.style.width  = W + 'px';
      cv.style.height = H + 'px';
      ctx = cv.getContext('2d');
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    },

    setIntensity(v) {
      intensity = Math.max(0, Math.min(1, v));
      cv.style.opacity = String(Math.min(0.95, intensity * 1.2));
    },

    tick(dt, centerX, centerY) {
      if (!ctx || intensity < 0.005) return;
      t += dt;

      stepFire();

      ctx.clearRect(0, 0, W, H);

      // Smoke
      if (intensity > 0.12 && r() < intensity * 0.38) {
        smokeParticles.push(new SmokePuff(centerX, centerY));
      }
      smokeParticles = smokeParticles.filter(p => p.life > 0);
      smokeParticles.forEach(p => { p.step(); p.draw(ctx, intensity); });

      // Fire
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      renderFire(centerX, centerY);
      ctx.restore();

      // Cinematic glow corona
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const corona = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.min(W, H) * 0.42 * intensity);
      corona.addColorStop(0,   `rgba(255,200,80,${intensity * 0.35})`);
      corona.addColorStop(0.3, `rgba(255,90,0,${intensity * 0.18})`);
      corona.addColorStop(0.7, `rgba(200,30,0,${intensity * 0.06})`);
      corona.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = corona;
      ctx.beginPath();
      ctx.arc(centerX, centerY, Math.min(W, H) * 0.42 * intensity, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

})();
