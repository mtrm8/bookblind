/**
 * ASH ENGINE — lightweight post-explosion atmosphere.
 * Smoke wisps + falling ash flakes + rising embers. No soot layer.
 * Designed for smooth 60fps.
 */
(function () {
  'use strict';

  const SMOKE_COUNT = 18;
  const ASH_COUNT   = 120;
  const EMBER_COUNT = 55;

  // ── Canvas ────────────────────────────────────────────────────────────────
  const cv = document.createElement('canvas');
  cv.id = 'ash-canvas';
  cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:41;opacity:0;transition:opacity 1.8s ease';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width  = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildSmoke();
  }
  resize();
  window.addEventListener('resize', resize);

  // ── Minimal RNG ───────────────────────────────────────────────────────────
  function rr(a, b) { return a + Math.random() * (b - a); }

  // ── Simple wind (single sine, cheap) ─────────────────────────────────────
  function windX(x, t) { return Math.sin(x * 0.0008 + t * 0.09) * 0.18; }
  function windY(y, t) { return Math.cos(y * 0.0007 + t * 0.07) * 0.10; }

  // ── SMOKE PUFFS ───────────────────────────────────────────────────────────
  let smokePuffs = [];
  function buildSmoke() {
    smokePuffs = Array.from({ length: SMOKE_COUNT }, () => ({
      x: rr(0, W), y: rr(0, H),
      vx: rr(-0.15, 0.15), vy: rr(-0.10, -0.04),
      r: rr(60, 200), alpha: rr(0.05, 0.16),
      shade: rr(10, 45), scaleX: rr(1.2, 2.0), scaleY: rr(0.5, 0.9),
      rot: Math.random() * Math.PI * 2, spin: (Math.random() - .5) * 0.002,
      phase: Math.random() * Math.PI * 2
    }));
  }

  function tickSmoke(t, intensity) {
    ctx.save();
    smokePuffs.forEach(s => {
      s.vx += windX(s.x, t) * 0.03;
      s.vy += windY(s.y, t) * 0.02 - 0.006;
      s.vx *= 0.985; s.vy *= 0.985;
      s.x  += s.vx;  s.y  += s.vy;
      s.r  += 0.06;  s.rot += s.spin;
      if (s.x < -s.r * 2) s.x = W + s.r;
      if (s.x > W + s.r * 2) s.x = -s.r;
      if (s.y < -s.r * 2)   { s.y = H + s.r * .5; s.r = rr(60, 180); }
      if (s.y > H + s.r * 2) s.y = -s.r;

      const alpha = s.alpha * intensity;
      if (alpha < 0.004) return;
      const lum = Math.floor(s.shade);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s.r);
      g.addColorStop(0,   `rgba(${lum},${lum},${lum},${alpha})`);
      g.addColorStop(.45, `rgba(${lum>>1},${lum>>1},${lum>>1},${alpha*.3})`);
      g.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.scale(s.scaleX, s.scaleY);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, s.r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
    ctx.restore();
  }

  // ── ASH FLAKES ────────────────────────────────────────────────────────────
  class Flake {
    constructor(init) { this.reset(init); }
    reset(init) {
      this.x    = rr(0, W);
      this.y    = init ? rr(0, H) : rr(-20, -4);
      this.vx   = rr(-0.3, 0.3);
      this.vy   = rr(0.10, 0.45);
      this.rot  = Math.random() * Math.PI * 2;
      this.spin = (Math.random() - .5) * 0.04;
      this.w    = rr(1.4, 3.8);
      this.h    = this.w * rr(0.2, 0.5);
      this.alpha = rr(0.3, 0.68);
      this.shade = Math.random() > 0.65 ? rr(140, 220) : rr(15, 55);
      this.life  = 1; this.decay = rr(0.0004, 0.0010);
      this.wob   = Math.random() * Math.PI * 2;
    }
    tick(t, intensity) {
      this.wob += 0.07;
      this.vx  += windX(this.x, t) * 0.06 + Math.sin(this.wob) * 0.007;
      this.vy  += 0.005 + windY(this.y, t) * 0.03;
      this.vx  *= 0.990; this.vy *= 0.991;
      this.x   += this.vx; this.y += this.vy; this.rot += this.spin;
      this.life -= this.decay;
      if (this.life <= 0 || this.y > H + 20) this.reset(false);
      if (this.x < -10) this.x = W + 8;
      if (this.x > W + 10) this.x = -8;

      const alpha = this.alpha * this.life * intensity;
      if (alpha < 0.02) return;
      const s = Math.floor(this.shade);
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rot);
      ctx.scale(this.w, this.h);
      ctx.fillStyle = `rgba(${s},${s},${s},${alpha})`;
      ctx.fillRect(-0.5, -0.5, 1, 1);
      ctx.restore();
    }
  }

  // ── EMBERS ────────────────────────────────────────────────────────────────
  class Ember {
    constructor(init) { this.reset(init); }
    reset(init) {
      this.x    = rr(0, W);
      this.y    = init ? rr(0, H) : H + rr(5, 15);
      this.vx   = rr(-0.35, 0.35);
      this.vy   = rr(-0.7, -0.15);
      this.r    = rr(0.4, 1.1);
      this.hot  = Math.random() > 0.35;
      this.life = 1; this.decay = rr(0.005, 0.013);
      this.flick = Math.random() * Math.PI * 2;
      this.tx = this.x; this.ty = this.y; // prev position for trail
    }
    tick(t, intensity) {
      this.flick += 0.18;
      this.vx += windX(this.x, t) * 0.08;
      this.vy += windY(this.y, t) * 0.05 - 0.010;
      this.vx *= 0.983; this.vy *= 0.985;
      const px = this.x, py = this.y;
      this.x  += this.vx; this.y += this.vy;
      this.life -= this.decay;
      if (this.life <= 0 || this.y < -25 || this.y > H + 15) this.reset(false);
      if (this.x < -8) this.x = W + 6;
      if (this.x > W + 8) this.x = -6;

      const fl = 0.65 + Math.sin(this.flick) * 0.35;
      const alpha = this.life * intensity * fl;
      if (alpha < 0.03) return;
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      // Short trail
      ctx.strokeStyle = this.hot ? `rgba(255,120,15,${alpha*.45})` : `rgba(190,55,0,${alpha*.3})`;
      ctx.lineWidth = this.r * 0.7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(this.x, this.y); ctx.stroke();
      // Core point
      ctx.fillStyle = this.hot ? `rgba(255,245,190,${alpha*.95})` : `rgba(220,100,20,${alpha*.7})`;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r * (0.5 + fl * 0.5), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // ── Pools ─────────────────────────────────────────────────────────────────
  const flakes = Array.from({ length: ASH_COUNT  }, () => new Flake(true));
  const embers = Array.from({ length: EMBER_COUNT }, () => new Ember(true));

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
      tickSmoke(t, intensity);
      flakes.forEach(f => f.tick(t, intensity));
      embers.forEach(e => e.tick(t, intensity));
    }
  };

})();
