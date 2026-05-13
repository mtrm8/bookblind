/**
 * SHATTER ENGINE — Voronoi-based wall/background fragment physics.
 * When triggered, breaks the hero stage into ~100 polygon shards that
 * fly outward with impulse physics, spin, and gravity.
 */
(function () {
  'use strict';

  // ── Canvas ──────────────────────────────────────────────────────────────
  const cv = document.createElement('canvas');
  cv.id = 'shatter-canvas';
  cv.style.cssText = [
    'position:absolute', 'inset:0', 'width:100%', 'height:100%',
    'pointer-events:none', 'z-index:8',
  ].join(';');

  let W = 0, H = 0, DPR = 1;
  let ctx = null;
  let active = false;
  let fragments = [];
  let blastX = 0, blastY = 0;
  let t = 0;

  // ── Seeded RNG ────────────────────────────────────────────────────────────
  let _s = 0xDEADBEEF;
  function r() { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; }
  function rr(a, b) { return a + r() * (b - a); }

  // ── Voronoi via Fortune-ish approximation (Lloyd relaxed points) ─────────
  function generateVoronoi(w, h, count) {
    // Generate seed points
    let pts = Array.from({ length: count }, () => ({ x: rr(0, w), y: rr(0, h) }));

    // 2 rounds of Lloyd relaxation for more organic look
    for (let pass = 0; pass < 2; pass++) {
      const cells = pts.map(() => ({ sx: 0, sy: 0, cnt: 0 }));
      const step = 8;
      for (let py = 0; py < h; py += step) {
        for (let px = 0; px < w; px += step) {
          let best = 0, bestD = Infinity;
          for (let i = 0; i < pts.length; i++) {
            const dx = pts[i].x - px, dy = pts[i].y - py;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = i; }
          }
          cells[best].sx  += px;
          cells[best].sy  += py;
          cells[best].cnt += 1;
        }
      }
      pts = pts.map((p, i) =>
        cells[i].cnt > 0
          ? { x: cells[i].sx / cells[i].cnt, y: cells[i].sy / cells[i].cnt }
          : p
      );
    }

    // Build polygon for each cell by collecting edge midpoints
    const polys = pts.map(seed => {
      const verts = [];
      const angles = Array.from({ length: 24 }, (_, i) => i / 24 * Math.PI * 2);
      angles.forEach(a => {
        const rayLen = Math.max(w, h);
        const ex = seed.x + Math.cos(a) * rayLen;
        const ey = seed.y + Math.sin(a) * rayLen;
        // Walk ray until we find a pixel closer to another seed
        let best = { x: ex, y: ey };
        const steps = 80;
        for (let s = 1; s <= steps; s++) {
          const f = s / steps;
          const px = seed.x + (ex - seed.x) * f;
          const py = seed.y + (ey - seed.y) * f;
          if (px < -20 || px > w + 20 || py < -20 || py > h + 20) {
            best = { x: px, y: py }; break;
          }
          let myD = (px - seed.x) ** 2 + (py - seed.y) ** 2;
          let otherD = Infinity;
          for (const op of pts) {
            if (op === seed) continue;
            const d = (px - op.x) ** 2 + (py - op.y) ** 2;
            if (d < otherD) otherD = d;
          }
          if (otherD <= myD) { best = { x: px, y: py }; break; }
        }
        verts.push(best);
      });
      return { seed, verts };
    });

    return polys;
  }

  // ── Fragment class ─────────────────────────────────────────────────────────
  class Fragment {
    constructor(poly, color, bx, by) {
      this.verts = poly.verts;
      this.cx = poly.seed.x;
      this.cy = poly.seed.y;
      this.color = color;
      this.rot = 0;
      const dx = this.cx - bx, dy = this.cy - by;
      const dist = Math.sqrt(dx * dx + dy * dy) + 1;
      const force = 2200 / (dist + 80);
      this.vx = (dx / dist) * force * (0.8 + r() * 0.6);
      this.vy = (dy / dist) * force * (0.5 + r() * 0.8) - force * 0.3;
      this.spin = (r() - .5) * 0.22;
      this.opacity = 1;
      this.scale = 1;
    }

    step(dt) {
      this.vx *= 0.92;
      this.vy  = this.vy * 0.92 + 0.35; // gravity
      this.cx += this.vx * dt;
      this.cy += this.vy * dt;
      this.rot += this.spin * dt;
      this.opacity -= 0.006 * dt;
      this.scale   -= 0.001 * dt;
    }

    draw(ctx) {
      if (this.opacity <= 0 || this.verts.length < 3) return;
      ctx.save();
      ctx.translate(this.cx, this.cy);
      ctx.rotate(this.rot);
      ctx.scale(this.scale, this.scale);
      ctx.translate(-this.cx, -this.cy);
      ctx.globalAlpha = Math.max(0, this.opacity);
      // Fill with original background color (orange)
      ctx.fillStyle = this.color;
      ctx.beginPath();
      this.verts.forEach((v, i) => {
        if (i === 0) ctx.moveTo(v.x, v.y);
        else ctx.lineTo(v.x, v.y);
      });
      ctx.closePath();
      ctx.fill();
      // Dark char edge
      ctx.strokeStyle = 'rgba(4,2,1,0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Fire glow on edge
      ctx.strokeStyle = `rgba(255,90,0,${this.opacity * 0.45})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────
  window.ShatterEngine = {
    attach(heroStageEl) {
      if (!heroStageEl.contains(cv)) {
        heroStageEl.appendChild(cv);
      }
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

    trigger(heroStageEl, blastCX, blastCY) {
      if (active) return;
      this.attach(heroStageEl);
      blastX = blastCX;
      blastY = blastCY;
      const polys = generateVoronoi(W, H, 88);
      fragments = polys.map(p => new Fragment(p, '#E85D04', blastX, blastY));
      active = true;
      t = 0;
    },

    tick(dt) {
      if (!active || !ctx) return;
      t += dt;
      ctx.clearRect(0, 0, W, H);
      let alive = 0;
      fragments.forEach(f => {
        f.step(dt);
        f.draw(ctx);
        if (f.opacity > 0) alive++;
      });
      if (alive === 0) { active = false; ctx.clearRect(0, 0, W, H); }
    },

    isActive() { return active; },
    reset() {
      active = false;
      fragments = [];
      if (ctx) ctx.clearRect(0, 0, W, H);
    }
  };

})();
