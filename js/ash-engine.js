/**
 * ASH ENGINE v2 — Hyper-realistic post-explosion atmosphere.
 *
 * Three systems on one canvas:
 *  1. SMOKE LAYER  — large dark moving volumetric clouds covering ~70% screen
 *  2. ASH FLAKES   — visible gray/white tumbling flakes, 2-5px
 *  3. EMBERS       — tiny hot sparks with physics trails, NOT bokeh circles
 *
 * No sparkles. No stars. Only smoke, ash, and fire embers.
 */
(function () {
  'use strict';

  const SMOKE_COUNT  = 55;
  const ASH_COUNT    = 420;
  const EMBER_COUNT  = 180;
  const SOOT_COUNT   = 600;

  // ── Canvas ──────────────────────────────────────────────────────────────
  const cv = document.createElement('canvas');
  cv.id = 'ash-canvas';
  cv.style.cssText = [
    'position:fixed', 'inset:0', 'width:100%', 'height:100%',
    'pointer-events:none', 'z-index:41', 'opacity:0',
    'transition:opacity 1.8s ease'
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
    buildSmoke();
  }
  resize();
  window.addEventListener('resize', resize);

  // ── Seeded RNG ────────────────────────────────────────────────────────────
  let _s = 0x7F3A8D21;
  function rng()        { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; }
  function rr(a, b)     { return a + rng() * (b - a); }
  function rsign()      { return rng() > .5 ? 1 : -1; }

  // ── Wind turbulence ────────────────────────────────────────────────────────
  // 5-layer fake Perlin
  const wLayers = Array.from({ length: 5 }, (_, i) => ({
    fx: 0.00055 + i * 0.00028,
    fy: 0.00042 + i * 0.00022,
    amp: 0.22 / (i + 1),
    ph: rng() * Math.PI * 2,
    dir: rng() * Math.PI * 2
  }));
  function wind(x, y, t) {
    let wx = 0, wy = 0;
    wLayers.forEach(l => {
      wx += Math.cos(l.dir) * Math.sin(x * l.fx + t * 0.08 + l.ph) * l.amp;
      wy += Math.sin(l.dir) * Math.cos(y * l.fy + t * 0.06 + l.ph * 1.4) * l.amp;
    });
    return { wx, wy };
  }

  // ── SMOKE PUFFS ─────────────────────────────────────────────────────────
  // Large soft dark gray clouds that move slowly across screen
  let smokePuffs = [];
  function buildSmoke() {
    smokePuffs = Array.from({ length: SMOKE_COUNT }, () => ({
      x:     rr(-0.1, 1.1) * W,
      y:     rr(-0.2, 1.2) * H,
      vx:    rr(-0.18, 0.18),
      vy:    rr(-0.12, -0.05), // slow upward drift
      r:     rr(80, 280),      // big clouds
      alpha: rr(0.06, 0.20),
      shade: rr(12, 52),       // very dark gray
      phase: rng() * Math.PI * 2,
      scaleX: rr(1.3, 2.4),
      scaleY: rr(0.55, 1.0),
      rot:   rng() * Math.PI * 2,
      spin:  rsign() * rr(0.0005, 0.003)
    }));
  }

  function stepSmoke(t) {
    smokePuffs.forEach(s => {
      const { wx, wy } = wind(s.x, s.y, t);
      s.vx += wx * 0.04;
      s.vy += wy * 0.02 - 0.008; // buoyancy
      s.vx  = s.vx * 0.98;
      s.vy  = s.vy * 0.98;
      s.x  += s.vx;
      s.y  += s.vy;
      s.r  += 0.08;  // slowly expand
      s.rot += s.spin;
      // Wrap around screen
      if (s.x < -s.r * 2.5) s.x = W + s.r;
      if (s.x > W + s.r * 2.5) s.x = -s.r;
      if (s.y < -s.r * 2)  { s.y = H + s.r * 0.5; s.r = rr(80, 240); }
      if (s.y > H + s.r * 2) s.y = -s.r;
    });
  }

  function drawSmoke(intensity) {
    ctx.save();
    smokePuffs.forEach(s => {
      const alpha = s.alpha * intensity * 0.9;
      if (alpha < 0.004) return;
      const lum = Math.floor(s.shade);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s.r);
      g.addColorStop(0,   `rgba(${lum},${lum},${lum},${alpha})`);
      g.addColorStop(0.40,`rgba(${Math.floor(lum*.68)},${Math.floor(lum*.62)},${Math.floor(lum*.55)},${alpha*.42})`);
      g.addColorStop(0.72,`rgba(${Math.floor(lum*.35)},${Math.floor(lum*.30)},${Math.floor(lum*.25)},${alpha*.14})`);
      g.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.scale(s.scaleX, s.scaleY);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, s.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    ctx.restore();
  }

  // ── ASH FLAKES ─────────────────────────────────────────────────────────
  // Visible tumbling gray/white flakes — clearly ash, not stars
  class AshFlake {
    constructor(init) {
      this.reset(init === true);
    }
    reset(init) {
      this.x    = rr(0, W);
      this.y    = init ? rr(0, H) : rr(-30, -5);
      this.vx   = rr(-0.35, 0.35);
      this.vy   = rr(0.12, 0.55);
      this.rot  = rng() * Math.PI * 2;
      this.spin = rsign() * rr(0.005, 0.06);
      // Flat irregular shape: width and height are different (realistic ash is flat)
      this.w    = rr(1.5, 4.2);
      this.h    = this.w * rr(0.20, 0.55);
      this.alpha= rr(0.35, 0.75);
      this.shade= rng() > 0.72 ? rr(160, 240) : rr(18, 70);  // some bright white, mostly dark
      this.life = 1;
      this.decay= rr(0.0003, 0.0012);
      this.wobble     = rng() * Math.PI * 2;
      this.wobbleFreq = rr(0.03, 0.11);
      // Irregular polygon (4-6 vertices)
      const n = 4 + Math.floor(rng() * 3);
      this.verts = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + rr(-0.5, 0.5);
        const r = rr(0.45, 1.0);
        return [Math.cos(a) * r, Math.sin(a) * r];
      });
    }
    step(t) {
      this.wobble += this.wobbleFreq;
      const { wx, wy } = wind(this.x, this.y, t);
      this.vx += wx * 0.07 + Math.sin(this.wobble) * 0.008;
      this.vy += 0.006 + wy * 0.04;
      this.vx *= 0.988;
      this.vy *= 0.990;
      this.x  += this.vx;
      this.y  += this.vy;
      this.rot += this.spin;
      this.life -= this.decay;
      if (this.life <= 0 || this.y > H + 25) this.reset(false);
      if (this.x < -20) this.x = W + 18;
      if (this.x > W + 20) this.x = -18;
    }
    draw(intensity) {
      const alpha = this.alpha * this.life * intensity;
      if (alpha < 0.02) return;
      const s = Math.floor(this.shade);
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rot);
      ctx.scale(this.w, this.h);
      ctx.fillStyle = `rgba(${s},${s},${s},${alpha})`;
      ctx.beginPath();
      this.verts.forEach(([vx, vy], i) => {
        if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
      });
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // ── EMBERS ────────────────────────────────────────────────────────────────
  // Tiny glowing sparks with physics trails — 1px core, no big corona
  class Ember {
    constructor(init) { this.reset(init === true); }
    reset(init) {
      this.x      = rr(0, W);
      this.y      = init ? rr(0, H) : H + rr(5, 20);
      this.vx     = rr(-0.4, 0.4);
      this.vy     = rr(-0.8, -0.18);  // embers rise
      this.r      = rr(0.4, 1.2);
      this.hot    = rng() > 0.30;
      this.life   = 1;
      this.decay  = rr(0.004, 0.012);
      this.flick  = rng() * Math.PI * 2;
      this.trail  = [];
      this.trailMax = 6 + Math.floor(rng() * 10);
    }
    step(t) {
      this.flick += rr(0.12, 0.25);
      const { wx, wy } = wind(this.x, this.y, t);
      this.vx += wx * 0.10 + (rng() - .5) * 0.018;
      this.vy += wy * 0.06 - 0.012;   // updraft
      this.vx *= 0.982;
      this.vy *= 0.985;
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > this.trailMax) this.trail.shift();
      this.x  += this.vx;
      this.y  += this.vy;
      this.life -= this.decay;
      if (this.life <= 0 || this.y < -30 || this.y > H + 20) this.reset(false);
      if (this.x < -10) this.x = W + 8;
      if (this.x > W + 10) this.x = -8;
    }
    draw(intensity) {
      if (this.life <= 0) return;
      const flicker = 0.65 + Math.sin(this.flick) * 0.35;
      const alpha   = this.life * intensity * flicker;
      if (alpha < 0.025) return;

      // Trail — thin line, NOT glowing corona
      if (this.trail.length > 1) {
        ctx.save();
        ctx.lineCap = 'round';
        for (let i = 1; i < this.trail.length; i++) {
          const tf = (i / this.trail.length) * alpha * (this.hot ? 0.55 : 0.22);
          if (tf < 0.01) continue;
          ctx.strokeStyle = this.hot
            ? `rgba(255,130,20,${tf})`
            : `rgba(180,80,10,${tf * 0.6})`;
          ctx.lineWidth = this.r * 0.8;
          ctx.beginPath();
          ctx.moveTo(this.trail[i-1].x, this.trail[i-1].y);
          ctx.lineTo(this.trail[i].x,   this.trail[i].y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Core — tiny bright point only, max 1.5px radius
      const coreR = this.r * (0.5 + flicker * 0.5);
      ctx.save();
      if (this.hot) {
        ctx.fillStyle = `rgba(255,240,180,${alpha * 0.95})`;
      } else {
        ctx.fillStyle = `rgba(220,100,20,${alpha * 0.75})`;
      }
      ctx.beginPath();
      ctx.arc(this.x, this.y, coreR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── SOOT SPECKS ───────────────────────────────────────────────────────────
  // Sub-pixel dark dots — almost invisible, add depth/texture
  class Soot {
    constructor() { this.reset(true); }
    reset(init) {
      this.x    = rr(0, W);
      this.y    = init ? rr(0, H) : rr(-10, -2);
      this.vx   = rr(-0.12, 0.12);
      this.vy   = rr(0.06, 0.28);
      this.r    = rr(0.2, 0.65);
      this.a    = rr(0.06, 0.22);
      this.life = 1;
      this.decay= rr(0.0002, 0.0007);
    }
    step(t) {
      const { wx } = wind(this.x, this.y, t);
      this.vx += wx * 0.02;
      this.vx *= 0.996;
      this.vy += 0.002;
      this.x  += this.vx;
      this.y  += this.vy;
      this.life -= this.decay;
      if (this.life <= 0 || this.y > H + 8) this.reset(false);
      if (this.x < 0) this.x = W;
      if (this.x > W) this.x = 0;
    }
    draw(intensity) {
      const a = this.a * this.life * intensity * 0.65;
      if (a < 0.005) return;
      ctx.fillStyle = `rgba(3,2,1,${a})`;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Particle pools ─────────────────────────────────────────────────────────
  const flakes = Array.from({ length: ASH_COUNT   }, () => new AshFlake(true));
  const embers = Array.from({ length: EMBER_COUNT  }, () => new Ember(true));
  const soots  = Array.from({ length: SOOT_COUNT   }, () => new Soot());

  // ── Public API ─────────────────────────────────────────────────────────────
  let intensity = 0;

  window.AshEngine = {
    setIntensity(v) {
      intensity = Math.max(0, Math.min(1, v));
      cv.style.opacity = String(Math.min(0.97, intensity * 1.05));
    },

    tick(t) {
      if (intensity < 0.005) return;

      ctx.clearRect(0, 0, W, H);

      // 1. Smoke (behind everything)
      stepSmoke(t);
      drawSmoke(intensity);

      // 2. Soot (micro specks)
      soots.forEach(p => { p.step(t); p.draw(intensity); });

      // 3. Ash flakes (main visible layer)
      flakes.forEach(f => { f.step(t); f.draw(intensity); });

      // 4. Embers (on top, rising)
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      embers.forEach(e => { e.step(t); e.draw(intensity); });
      ctx.restore();
    }
  };

})();
