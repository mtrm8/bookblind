/**
 * CRACK ENGINE — Stress-based crack propagation with glow, heat, and branching.
 * Renders photorealistic glass/wall cracks that grow slowly as scroll progresses.
 * Uses Lindenmayer-style crack paths with fractal sub-branches.
 */
(function () {
  'use strict';

  let W = 0, H = 0, DPR = 1;
  let ctx = null;
  let cv = null;

  // ── RNG ────────────────────────────────────────────────────────────────────
  let _s = 0xCAFEBABE;
  function r()           { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; }
  function rr(a, b)      { return a + r() * (b - a); }
  function rSign()       { return r() > .5 ? 1 : -1; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ── Crack node ─────────────────────────────────────────────────────────────
  class CrackNode {
    constructor(x, y, angle, width, depth, delay) {
      this.x      = x;
      this.y      = y;
      this.angle  = angle;
      this.width  = width;
      this.depth  = depth;
      this.delay  = delay;
      this.length = rr(0.04, 0.14) * Math.min(W, H);
      this.segments = [];
      this.children = [];
      this._built   = false;
    }

    build() {
      if (this._built) return;
      this._built = true;
      let x = this.x, y = this.y;
      let a = this.angle;
      const steps = 8 + Math.floor(r() * 12);
      const stepLen = this.length / steps;
      this.segments.push({ x, y });
      for (let i = 0; i < steps; i++) {
        a += (r() - .5) * 0.55;
        x += Math.cos(a) * stepLen;
        y += Math.sin(a) * stepLen;
        this.segments.push({ x, y });

        if (this.depth < 4 && r() > 0.60) {
          const branchAngle = a + rSign() * rr(0.4, 1.3);
          const branchW     = this.width * rr(0.35, 0.65);
          const branchDelay = this.delay + rr(0.05, 0.18);
          if (branchW > 0.15) {
            this.children.push(new CrackNode(x, y, branchAngle, branchW, this.depth + 1, branchDelay));
          }
        }
      }
      this.children.forEach(c => c.build());
    }

    draw(ctx, progress, fireIntensity) {
      if (!this._built) return;
      const local = clamp((progress - this.delay) / 0.55, 0, 1);
      if (local <= 0) return;
      const pts  = this.segments;
      const upto = Math.max(1, Math.floor((pts.length - 1) * local));

      ctx.save();
      ctx.lineCap  = 'round';
      ctx.lineJoin = 'round';

      // Orange glow when fire is near
      if (fireIntensity > 0.05) {
        ctx.shadowColor = `rgba(255,80,0,${fireIntensity * 0.6})`;
        ctx.shadowBlur  = 8 + fireIntensity * 28;
      }

      // Main crack line — dark with slight inner variation
      const alpha = Math.min(1, local * 2.2) * (this.depth === 0 ? 0.92 : 0.65);
      ctx.strokeStyle = `rgba(6,3,1,${alpha})`;
      ctx.lineWidth   = (this.width + fireIntensity * 1.8) * (1 - this.depth * 0.12);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i <= upto; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (upto < pts.length - 1) {
        const f  = ((pts.length - 1) * local) % 1;
        const pa = pts[upto], pb = pts[upto + 1];
        ctx.lineTo(lerp(pa.x, pb.x, f), lerp(pa.y, pb.y, f));
      }
      ctx.stroke();

      // Fire glow inside crack
      if (fireIntensity > 0.12) {
        ctx.strokeStyle = `rgba(255,120,0,${fireIntensity * 0.35 * alpha})`;
        ctx.lineWidth   = Math.max(0.5, (this.width - 0.5) * 0.35);
        ctx.shadowBlur  = 0;
        ctx.stroke();
      }

      // Bright highlight on edge (gives 3D depth)
      ctx.strokeStyle = `rgba(255,220,160,${fireIntensity * 0.18 * alpha})`;
      ctx.lineWidth   = 0.4;
      ctx.shadowBlur  = 0;
      ctx.stroke();

      ctx.restore();

      this.children.forEach(c => c.draw(ctx, progress, fireIntensity));
    }
  }

  // ── Main crack network ────────────────────────────────────────────────────
  let roots = [];

  function buildNetwork() {
    roots = [];
    if (W === 0 || H === 0) return;

    const cx = W * 0.5, cy = H * 0.49;

    // 14 primary radial cracks from blast center
    const angleStep = (Math.PI * 2) / 14;
    for (let i = 0; i < 14; i++) {
      const baseAngle = i * angleStep + rr(-0.2, 0.2);
      const node = new CrackNode(cx, cy, baseAngle, rr(2.4, 5.2), 0, i * 0.038);
      node.build();
      roots.push(node);
    }

    // 6 secondary cracks from random ring points
    for (let i = 0; i < 6; i++) {
      const a   = r() * Math.PI * 2;
      const rad = rr(0.08, 0.22) * Math.min(W, H);
      const sx  = cx + Math.cos(a) * rad;
      const sy  = cy + Math.sin(a) * rad;
      const node = new CrackNode(sx, sy, a + rr(-0.8, 0.8), rr(1.2, 3.2), 1, 0.18 + i * 0.055);
      node.build();
      roots.push(node);
    }

    // 4 long diagonal full-screen cracks
    const corners = [
      [0, 0, 0.78], [W, 0, 2.36], [0, H, -0.38], [W, H, 3.52]
    ];
    corners.forEach(([ex, ey, a], idx) => {
      const midX = lerp(cx, ex, 0.35);
      const midY = lerp(cy, ey, 0.35);
      const dir  = Math.atan2(ey - cy, ex - cx) + rr(-0.25, 0.25);
      const node = new CrackNode(midX, midY, dir, rr(1.8, 3.8), 0, 0.28 + idx * 0.06);
      node.build();
      roots.push(node);
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  window.CrackEngine = {
    attach(heroStageEl) {
      if (!cv) {
        cv = document.createElement('canvas');
        cv.id = 'crack-canvas';
        cv.style.cssText = [
          'position:absolute', 'inset:0', 'width:100%', 'height:100%',
          'pointer-events:none', 'z-index:7'
        ].join(';');
      }
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
      buildNetwork();
    },

    rebuild() { buildNetwork(); },

    draw(progress, fireIntensity) {
      if (!ctx || !cv) return;
      ctx.clearRect(0, 0, W, H);
      if (progress < 0.005) return;
      roots.forEach(node => node.draw(ctx, progress, fireIntensity));
    }
  };

})();
