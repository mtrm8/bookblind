/**
 * BOOK FIRE ENGINE — performance-optimised
 * - Smaller grid (28×18), stepped every 2 RAF frames
 * - Rect cache refreshed every 30 frames
 * - Smoke capped at 6 puffs / embers at 8 per book
 * - Max 8 active books at once (closest to viewport centre)
 * - ImageData pixel batch for the fire grid (avoids 500+ fillRect/frame)
 */
(function () {
  'use strict';

  const COLS    = 28;
  const ROWS    = 18;
  const MAX_BOOKS = 8;

  // ── Canvas ────────────────────────────────────────────────────────────────
  const cv  = document.createElement('canvas');
  cv.id = 'book-fire-canvas';
  cv.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:52;mix-blend-mode:screen;width:100%;height:100%';
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
  }
  resize();
  window.addEventListener('resize', resize);

  // ── Fire colour palette ───────────────────────────────────────────────────
  // Pre-baked RGBA for heat 0-255
  const PAL = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let r, g, b, a;
    if      (t < 0.22) { const f=t/.22; r=Math.round(f*140); g=0; b=0; a=Math.round(f*200); }
    else if (t < 0.46) { const f=(t-.22)/.24; r=Math.round(140+f*115); g=Math.round(f*30); b=0; a=Math.round(200+f*40); }
    else if (t < 0.68) { const f=(t-.46)/.22; r=255; g=Math.round(30+f*110); b=0; a=240; }
    else if (t < 0.85) { const f=(t-.68)/.17; r=255; g=Math.round(140+f*100); b=Math.round(f*30); a=252; }
    else               { const f=(t-.85)/.15; r=255; g=Math.round(240+f*15); b=Math.round(30+f*225); a=255; }
    PAL[i*4]=r; PAL[i*4+1]=g; PAL[i*4+2]=b; PAL[i*4+3]=a;
  }

  // ── Smoke puff (lightweight) ──────────────────────────────────────────────
  function makePuff(x, y) {
    return { x, y, vx:(Math.random()-.5)*.5, vy:-(0.3+Math.random()*.6),
             r:5+Math.random()*14, a:0.07+Math.random()*.11,
             life:1, decay:0.014+Math.random()*.018 };
  }

  // ── Ember spark ───────────────────────────────────────────────────────────
  function makeEmber(x, y) {
    return { x, y, vx:(Math.random()-.5)*1.8, vy:-(0.8+Math.random()*2.2),
             r:0.5+Math.random()*.9, life:1, decay:0.022+Math.random()*.03,
             trail:[], hot:Math.random()>.35 };
  }

  // ── Per-book state ────────────────────────────────────────────────────────
  const states = new Map();   // element → state

  function getState(el) {
    if (!states.has(el)) {
      states.set(el, {
        grid : new Float32Array(COLS * ROWS),
        next : new Float32Array(COLS * ROWS),
        smoke: [],
        embers:[],
        rect : null,        // cached BoundingClientRect
        phase: Math.random() * Math.PI * 2,
        age  : 0
      });
    }
    return states.get(el);
  }

  // ── Fire step (single grid update) ───────────────────────────────────────
  function stepGrid(s) {
    const { grid, next } = s;
    // Seed bottom row — smooth heat with mild noise
    const w = (Math.random() - .5) * 0.12;   // single wind value per step
    for (let x = 0; x < COLS; x++) {
      const edge = Math.min(x, COLS-1-x) / 4;
      const base = 0.75 + Math.random() * 0.25 + Math.max(0, 0.18 - edge * 0.06);
      grid[(ROWS-1)*COLS + x] = Math.min(1, base);
    }
    for (let y = 0; y < ROWS-1; y++) {
      for (let x = 0; x < COLS; x++) {
        const l = x > 0       ? grid[y*COLS+x-1] : 0;
        const r = x < COLS-1  ? grid[y*COLS+x+1] : 0;
        const b = grid[(y+1)*COLS+x];
        const spread = l*(0.20+w) + r*(0.20-w) + b*0.60;
        const cool   = 0.042 + Math.random()*0.038 + Math.max(0,(ROWS*.55-y)/(ROWS*.55))*.018;
        next[y*COLS+x] = Math.max(0, spread - cool);
      }
    }
    const tmp = s.grid; s.grid = s.next; s.next = tmp;
    s.age++;
  }

  // ── Render fire to canvas via pixel batch ────────────────────────────────
  function renderGrid(s, rect) {
    const fW = Math.max(1, Math.round(rect.width  * 1.06));
    const fH = Math.max(1, Math.round(rect.height * 0.62));
    const ox  = Math.round(rect.left + (rect.width - fW) * .5);
    const oy  = Math.round(rect.bottom - fH);
    if (fW <= 0 || fH <= 0) return;

    // Build ImageData
    const img = ctx.createImageData(fW, fH);
    const px  = img.data;
    const cW  = fW / COLS;
    const cH  = fH / ROWS;

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const heat = s.grid[y*COLS+x];
        if (heat < 0.03) continue;
        const pi = Math.min(255, heat * 255 | 0) * 4;
        const pr=PAL[pi], pg=PAL[pi+1], pb=PAL[pi+2], pa=PAL[pi+3];
        if (pa < 8) continue;

        const px0 = Math.round(x * cW), px1 = Math.min(fW, Math.round((x+1)*cW)+1);
        const py0 = Math.round(y * cH), py1 = Math.min(fH, Math.round((y+1)*cH)+1);
        for (let iy = py0; iy < py1; iy++) {
          for (let ix = px0; ix < px1; ix++) {
            const idx = (iy*fW+ix)*4;
            // Additive blend in software — max each channel
            if (px[idx+3] < pa) {
              px[idx]   = pr; px[idx+1] = pg;
              px[idx+2] = pb; px[idx+3] = pa;
            }
          }
        }
      }
    }
    ctx.putImageData(img, ox + (0|0), oy + (0|0));
  }

  // ── Base glow ────────────────────────────────────────────────────────────
  function renderGlow(s, rect) {
    const cx = rect.left + rect.width * .5;
    const cy = rect.bottom;
    const rx = rect.width * .68;
    const ry = rx * .36;
    const fl = .72 + Math.sin(s.age * .16 + s.phase) * .28;
    const g  = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
    g.addColorStop(0,    `rgba(255,170,30,${fl*.52})`);
    g.addColorStop(0.3,  `rgba(255,80,0,${fl*.22})`);
    g.addColorStop(0.65, `rgba(140,20,0,${fl*.07})`);
    g.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  // ── Smoke step + draw ─────────────────────────────────────────────────────
  function tickSmoke(s, rect) {
    // Spawn (capped at 6)
    if (s.smoke.length < 6 && Math.random() < .22) {
      s.smoke.push(makePuff(
        rect.left + Math.random()*rect.width,
        rect.top  + rect.height*.15
      ));
    }
    ctx.save();
    s.smoke = s.smoke.filter(p => {
      p.vx*=.97; p.vy=p.vy*.96-.016; p.x+=p.vx; p.y+=p.vy;
      p.r+=.45;  p.life-=p.decay;
      if (p.life <= 0) return false;
      const alpha = p.a * p.life * .7;
      if (alpha < .004) return false;
      const lum = 20 + Math.floor(p.life * 35);
      const g = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r);
      g.addColorStop(0, `rgba(${lum},${lum},${lum},${alpha})`);
      g.addColorStop(.5,`rgba(${lum>>1},${lum>>1},${lum>>1},${alpha*.3})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
      return true;
    });
    ctx.restore();
  }

  // ── Embers step + draw ────────────────────────────────────────────────────
  function tickEmbers(s, rect) {
    if (s.embers.length < 8 && Math.random() < .12) {
      s.embers.push(makeEmber(
        rect.left + Math.random()*rect.width,
        rect.bottom - rect.height*(0.08 + Math.random()*.35)
      ));
    }
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    s.embers = s.embers.filter(e => {
      e.vx*=.972; e.vy=e.vy*.972+.04;
      e.trail.push({x:e.x,y:e.y});
      if (e.trail.length > 6) e.trail.shift();
      e.x+=e.vx; e.y+=e.vy; e.life-=e.decay;
      if (e.life <= 0) return false;
      const alpha = e.life * .9;
      // Trail
      for (let i=1; i<e.trail.length; i++) {
        const tf = (i/e.trail.length)*alpha*.4;
        if (tf < .01) continue;
        ctx.strokeStyle = e.hot ? `rgba(255,130,20,${tf})` : `rgba(200,60,0,${tf})`;
        ctx.lineWidth = e.r*.7;
        ctx.beginPath();
        ctx.moveTo(e.trail[i-1].x,e.trail[i-1].y);
        ctx.lineTo(e.trail[i].x,  e.trail[i].y);
        ctx.stroke();
      }
      // Core
      ctx.fillStyle = e.hot ? `rgba(255,245,200,${alpha})` : `rgba(255,140,30,${alpha*.75})`;
      ctx.beginPath(); ctx.arc(e.x,e.y,e.r,0,Math.PI*2); ctx.fill();
      return true;
    });
    ctx.restore();
  }

  // ── Main loop ─────────────────────────────────────────────────────────────
  let frame = 0;
  let rectCache = null;      // [{ el, cover, rect }]
  let rectFrame = 0;

  function tick() {
    requestAnimationFrame(tick);
    frame++;

    // Refresh rect cache every 30 frames (not every frame)
    if (frame - rectFrame > 30 || !rectCache) {
      rectFrame = frame;
      const all = Array.from(document.querySelectorAll('.bk.scorched'));
      if (!all.length) { ctx.clearRect(0,0,W,H); return; }

      // Sort by distance from viewport centre, take closest MAX_BOOKS
      const cy = H * .5;
      rectCache = all
        .map(el => {
          const cover = el.querySelector('.bk-cover');
          const rect  = cover ? cover.getBoundingClientRect() : null;
          return { el, cover, rect };
        })
        .filter(o => o.rect && o.rect.bottom > -100 && o.rect.top < H + 100)
        .sort((a, b) => Math.abs(a.rect.top + a.rect.height*.5 - cy) -
                        Math.abs(b.rect.top + b.rect.height*.5 - cy))
        .slice(0, MAX_BOOKS);
    }

    if (!rectCache || rectCache.length === 0) return;

    ctx.clearRect(0, 0, W, H);

    rectCache.forEach(({ el, rect }) => {
      if (!rect) return;
      const s = getState(el);

      // Step fire grid every 2nd frame for perf
      if (frame % 2 === 0) stepGrid(s);

      renderGlow(s, rect);

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      renderGrid(s, rect);
      ctx.restore();

      tickSmoke(s, rect);
      tickEmbers(s, rect);
    });
  }

  tick();
})();
