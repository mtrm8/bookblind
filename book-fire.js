/**
 * BOOK FIRE ENGINE
 * Per-book cellular automaton fire simulation.
 * One fixed canvas over the entire viewport, mix-blend-mode: screen.
 * Each scorched book gets its own fire grid that steps every frame.
 *
 * Fire colors: black → deep red → orange → bright yellow → white-hot
 * Extras: smoke puffs rising above flames, flying embers/sparks.
 */
(function () {
  'use strict';

  // ── Grid dimensions per book ──────────────────────────────────────────────
  const COLS = 48;
  const ROWS = 36;
  // How tall the fire area is as a fraction of the book cover height
  const FIRE_HEIGHT_FRAC = 0.68;
  // How wide (can be wider than the book for edge overflow)
  const FIRE_WIDTH_FRAC  = 1.08;

  // ── Fire physics constants ────────────────────────────────────────────────
  const BASE_COOLING   = 0.038;   // base cooling per row step
  const TURB_COOLING   = 0.048;   // max extra random cooling
  const SPREAD_L       = 0.20;    // heat spreading left
  const SPREAD_R       = 0.20;    // heat spreading right
  const SPREAD_DOWN    = 0.60;    // heat coming from below
  // Edge boost: left/right columns get extra seeding (fire burns edges more)
  const EDGE_BOOST     = 0.22;

  // ── Fire color lookup table (heat 0-1 → RGBA) ─────────────────────────────
  const PALETTE = new Uint8Array(256 * 4);
  (function buildPalette() {
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let r, g, b, a;
      if (t < 0.18) {
        // Black to very deep red — barely visible
        const f = t / 0.18;
        r = Math.floor(f * 120);
        g = 0; b = 0;
        a = Math.floor(f * 180);
      } else if (t < 0.38) {
        // Deep red to bright red
        const f = (t - 0.18) / 0.20;
        r = Math.floor(120 + f * 135);
        g = Math.floor(f * 15);
        b = 0;
        a = Math.floor(180 + f * 45);
      } else if (t < 0.58) {
        // Red to orange
        const f = (t - 0.38) / 0.20;
        r = 255;
        g = Math.floor(15 + f * 100);
        b = 0;
        a = Math.floor(225 + f * 20);
      } else if (t < 0.78) {
        // Orange to bright yellow
        const f = (t - 0.58) / 0.20;
        r = 255;
        g = Math.floor(115 + f * 120);
        b = Math.floor(f * 25);
        a = 248;
      } else {
        // Yellow to white-hot core
        const f = (t - 0.78) / 0.22;
        r = 255;
        g = Math.floor(235 + f * 20);
        b = Math.floor(25 + f * 230);
        a = 255;
      }
      PALETTE[i*4]   = r;
      PALETTE[i*4+1] = g;
      PALETTE[i*4+2] = b;
      PALETTE[i*4+3] = a;
    }
  })();

  // ── Canvas setup ──────────────────────────────────────────────────────────
  const cv  = document.createElement('canvas');
  cv.id = 'book-fire-canvas';
  cv.style.cssText = [
    'position:fixed', 'inset:0', 'pointer-events:none',
    'z-index:52', 'mix-blend-mode:screen',
    'width:100%', 'height:100%'
  ].join(';');
  document.body.appendChild(cv);

  const ctx = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    cv.width  = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
    cv.style.width  = W + 'px';
    cv.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  // ── Per-book fire state ────────────────────────────────────────────────────
  const bookFires = new Map();

  function getFireState(el) {
    if (!bookFires.has(el)) {
      bookFires.set(el, {
        grid  : new Float32Array(COLS * ROWS),
        next  : new Float32Array(COLS * ROWS),
        phase : Math.random() * Math.PI * 2,
        smoke : [],   // active smoke puffs
        embers: [],   // flying embers
        age   : 0
      });
    }
    return bookFires.get(el);
  }

  // ── Step fire grid ─────────────────────────────────────────────────────────
  function stepFireGrid(state) {
    const { grid, next } = state;
    state.age++;

    // ── Seed bottom row with randomised heat + edge boost
    for (let x = 0; x < COLS; x++) {
      const edgeFactor = Math.min(1, Math.min(x, COLS - 1 - x) / 4);
      const edgeBoost  = (1 - edgeFactor) * EDGE_BOOST;
      const base       = 0.72 + Math.random() * 0.28 + edgeBoost;
      grid[(ROWS - 1) * COLS + x] = Math.min(1, base);
    }

    // ── Propagate rows upward
    for (let y = 0; y < ROWS - 1; y++) {
      for (let x = 0; x < COLS; x++) {
        const left  = x > 0          ? grid[y * COLS + (x - 1)] : 0;
        const right = x < COLS - 1   ? grid[y * COLS + (x + 1)] : 0;
        const below = grid[(y + 1) * COLS + x];

        // Wind turbulence: slight random lean
        const wind   = (Math.random() - 0.42) * 0.08;
        const spread = left * (SPREAD_L + wind) + right * (SPREAD_R - wind) + below * SPREAD_DOWN;
        const cool   = BASE_COOLING + Math.random() * TURB_COOLING;

        // Extra cooling near the top for sharp flame tips
        const topExtra = Math.max(0, 1 - y / (ROWS * 0.6)) * 0.02;
        next[y * COLS + x] = Math.max(0, spread - cool - topExtra);
      }
    }

    // Swap buffers
    const tmp  = state.grid;
    state.grid = state.next;
    state.next = tmp;
  }

  // ── Render fire grid to canvas ─────────────────────────────────────────────
  function renderFireGrid(state, rect) {
    const { grid } = state;

    const fW = rect.width  * FIRE_WIDTH_FRAC;
    const fH = rect.height * FIRE_HEIGHT_FRAC;
    const ox  = rect.left  + (rect.width - fW)  * 0.5;   // center the wider fire
    const oy  = rect.bottom - fH;                          // anchored to bottom

    const cellW = fW / COLS;
    const cellH = fH / ROWS;

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const heat = grid[y * COLS + x];
        if (heat < 0.025) continue;
        const pi = Math.min(255, Math.floor(heat * 255)) * 4;
        const pr = PALETTE[pi], pg = PALETTE[pi+1], pb = PALETTE[pi+2], pa = PALETTE[pi+3];
        if (pa < 5) continue;
        ctx.fillStyle = `rgba(${pr},${pg},${pb},${pa/255})`;
        ctx.fillRect(ox + x * cellW, oy + y * cellH, cellW + 0.8, cellH + 0.8);
      }
    }
  }

  // ── Smoke puffs rising from fire ──────────────────────────────────────────
  function spawnSmoke(state, rect) {
    if (Math.random() > 0.28) return;
    const x = rect.left + Math.random() * rect.width;
    const y = rect.top  + rect.height * 0.12;
    state.smoke.push({
      x, y,
      vx: (Math.random() - .5) * 0.55,
      vy: -(0.35 + Math.random() * 0.75),
      r : 6 + Math.random() * 18,
      alpha: 0.08 + Math.random() * 0.14,
      life : 1,
      decay: 0.012 + Math.random() * 0.018,
      shade: 18 + Math.random() * 55
    });
  }

  function stepSmoke(state) {
    state.smoke = state.smoke.filter(s => {
      s.vx  *= 0.97; s.vy  *= 0.96; s.vy -= 0.018;
      s.x   += s.vx; s.y   += s.vy;
      s.r   += 0.55; s.life -= s.decay;
      return s.life > 0;
    });
  }

  function drawSmoke(state) {
    state.smoke.forEach(s => {
      const alpha = s.alpha * s.life * 0.75;
      if (alpha < 0.005) return;
      const lum = s.shade;
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
      g.addColorStop(0,   `rgba(${lum},${lum},${lum},${alpha})`);
      g.addColorStop(.5,  `rgba(${Math.floor(lum*.65)},${Math.floor(lum*.60)},${Math.floor(lum*.52)},${alpha*.35})`);
      g.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  // ── Flying embers/sparks ──────────────────────────────────────────────────
  function spawnEmbers(state, rect) {
    if (Math.random() > 0.18) return;
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const x = rect.left + Math.random() * rect.width;
      const y = rect.bottom - rect.height * (0.1 + Math.random() * 0.4);
      state.embers.push({
        x, y,
        vx: (Math.random() - .5) * 2.2,
        vy: -(1.2 + Math.random() * 2.8),
        r : 0.5 + Math.random() * 1.2,
        hot : Math.random() > 0.35,
        life : 1,
        decay: 0.018 + Math.random() * 0.032,
        trail: [],
        trailMax: 4 + Math.floor(Math.random() * 8)
      });
    }
  }

  function stepEmbers(state) {
    state.embers = state.embers.filter(e => {
      e.vx *= 0.972; e.vy  = e.vy * 0.972 + 0.04; // gravity
      e.trail.push({ x: e.x, y: e.y });
      if (e.trail.length > e.trailMax) e.trail.shift();
      e.x += e.vx; e.y += e.vy;
      e.life -= e.decay;
      return e.life > 0;
    });
  }

  function drawEmbers(state) {
    state.embers.forEach(e => {
      if (e.life <= 0) return;
      const alpha = e.life * 0.92;

      // Trail
      if (e.trail.length > 1) {
        ctx.lineCap = 'round';
        for (let i = 1; i < e.trail.length; i++) {
          const tf = (i / e.trail.length) * alpha * 0.45;
          if (tf < 0.01) continue;
          ctx.strokeStyle = e.hot
            ? `rgba(255,140,20,${tf})`
            : `rgba(200,60,0,${tf})`;
          ctx.lineWidth = e.r * 0.7;
          ctx.beginPath();
          ctx.moveTo(e.trail[i-1].x, e.trail[i-1].y);
          ctx.lineTo(e.trail[i].x,   e.trail[i].y);
          ctx.stroke();
        }
      }

      // Core — tiny bright point
      ctx.fillStyle = e.hot
        ? `rgba(255,245,200,${alpha})`
        : `rgba(255,150,30,${alpha * .75})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r * (0.5 + e.life * 0.5), 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // ── Glow corona at the base of fire ──────────────────────────────────────
  function drawBaseGlow(rect, state) {
    const cx  = rect.left + rect.width  * 0.5;
    const cy  = rect.bottom;
    const r   = rect.width * 0.72;
    const flicker = 0.78 + Math.sin(state.age * 0.18 + state.phase) * 0.22;

    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0,    `rgba(255,180,40,${flicker * 0.55})`);
    g.addColorStop(0.25, `rgba(255,90,0,${flicker * 0.28})`);
    g.addColorStop(0.55, `rgba(180,30,0,${flicker * 0.10})`);
    g.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Main render loop ──────────────────────────────────────────────────────
  let active = false;

  function tick() {
    requestAnimationFrame(tick);

    const scorched = document.querySelectorAll('.bk.scorched');
    if (scorched.length === 0) return;

    ctx.clearRect(0, 0, W, H);

    scorched.forEach(el => {
      const cover = el.querySelector('.bk-cover');
      if (!cover) return;
      const rect = cover.getBoundingClientRect();
      if (rect.bottom < -50 || rect.top > H + 50) return; // off-screen skip

      const state = getFireState(el);

      stepFireGrid(state);
      spawnSmoke(state, rect);
      stepSmoke(state);
      spawnEmbers(state, rect);
      stepEmbers(state);

      // Draw in order: glow → fire → smoke → embers
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      drawBaseGlow(rect, state);
      renderFireGrid(state, rect);
      drawEmbers(state);
      ctx.restore();

      // Smoke uses source-over (inside drawSmoke)
      drawSmoke(state);
    });
  }

  // Start once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tick);
  } else {
    tick();
  }

})();
