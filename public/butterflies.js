/** A local canvas overlay. No camera pixels are copied into the animation. */
export class ButterflySwarm {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.frame = null;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.sprites = [
      ['#f9e9ff', '#ba8dd9', '#674481'],
      ['#e7f9ff', '#94cadf', '#416d96'],
      ['#fff1d6', '#e4bd77', '#8d623f'],
      ['#ffe8ea', '#dd9cae', '#965f81'],
      ['#e4fff0', '#9acdb5', '#527d77'],
    ].map(colors => this.makeSprite(colors));
    this.tick = this.tick.bind(this);
  }

  makeSprite(colors) {
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 128;
    const c = sprite.getContext('2d');
    c.translate(64, 64);
    for (const side of [-1, 1]) {
      c.save(); c.scale(side, 1);
      const fill = c.createLinearGradient(3, 0, 55, -30);
      fill.addColorStop(0, colors[2]); fill.addColorStop(.48, colors[1]); fill.addColorStop(1, colors[0]);
      c.fillStyle = fill;
      c.beginPath(); c.moveTo(0, 5);
      c.bezierCurveTo(10, -29, 37, -60, 53, -49);
      c.bezierCurveTo(66, -34, 49, -2, 26, 9);
      c.bezierCurveTo(51, 15, 45, 45, 29, 48);
      c.bezierCurveTo(13, 47, 5, 26, 0, 5); c.fill();
      c.strokeStyle = colors[2]; c.lineWidth = 1; c.globalAlpha = .5;
      for (const [x, y] of [[46,-43],[49,-25],[36,-9],[34,30],[24,41]]) {
        c.beginPath(); c.moveTo(2, 4); c.quadraticCurveTo(x * .6, y * .5, x, y); c.stroke();
      }
      c.globalAlpha = .8; c.fillStyle = colors[0];
      for (const [x, y, r] of [[43,-39,3],[49,-28,2],[40,-15,2.5],[32,31,3],[23,39,2]]) {
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      }
      c.restore();
    }
    return sprite;
  }

  burst(origins = [{x:.36,y:.73}, {x:.64,y:.73}]) {
    this.clear();
    if (!origins.length) origins = [{x:.5,y:.7}];
    const count = this.reduced ? 24 : 96;
    this.started = performance.now();
    this.lastDraw = -Infinity;
    this.particles = Array.from({length:count}, (_, i) => ({
      origin: origins[i % origins.length],
      x: ((i % 12) + Math.random()) / 12,
      y: (Math.floor(i / 12) + Math.random()) / Math.ceil(count / 12),
      size: .025 + Math.random() ** 2 * .052,
      phase: Math.random() * Math.PI * 2,
      speed: 8 + Math.random() * 7,
      tilt: (Math.random() - .5) * 1.3,
      delay: this.reduced ? 0 : Math.random() * .38,
      life: this.reduced ? 1.8 : 5 + Math.random() * 1.5,
      sprite: this.sprites[i % this.sprites.length],
    }));
    this.canvas.dataset.active = 'true';
    this.canvas.dataset.count = String(count);
    this.frame = requestAnimationFrame(this.tick);
  }

  tick(now) {
    if (document.hidden) { this.clear(); return; }
    if (now - this.lastDraw < 1000 / 45) { this.frame = requestAnimationFrame(this.tick); return; }
    this.lastDraw = now;
    const {width, height} = this.canvas.getBoundingClientRect();
    if (!width || !height) { this.clear(); return; }
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(width*dpr) || this.canvas.height !== Math.round(height*dpr)) {
      this.canvas.width = Math.round(width*dpr); this.canvas.height = Math.round(height*dpr);
    }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, width, height);
    const elapsed = (now - this.started) / 1000;
    this.particles = this.particles.filter(p => elapsed - p.delay < p.life);
    for (const p of this.particles) {
      const t = elapsed - p.delay;
      if (t < 0) continue;
      const spread = this.reduced ? 1 : 1 - Math.exp(-t * 1.6);
      const drift = this.reduced ? 0 : Math.sin(t * 1.7 + p.phase) * .035 * spread;
      const x = (p.origin.x + (p.x - p.origin.x) * spread + drift) * width;
      const y = (p.origin.y + (p.y - p.origin.y) * spread - (this.reduced ? 0 : Math.max(0,t-2)*.045)) * height;
      const size = p.size * width;
      const flap = this.reduced ? .85 : .18 + .82 * Math.abs(Math.sin(t*p.speed+p.phase));
      c.save(); c.translate(x, y); c.rotate(p.tilt + (this.reduced ? 0 : Math.sin(t*2+p.phase)*.25));
      c.globalAlpha = Math.min(1,t/.2) * Math.min(1,(p.life-t)/.9) * .95;
      c.save(); c.scale(flap, 1); c.drawImage(p.sprite, -size/2, -size/2, size, size); c.restore();
      c.fillStyle = '#e8ddc6'; c.beginPath(); c.ellipse(0,0,Math.max(.65,size*.018),size*.16,0,0,Math.PI*2); c.fill();
      c.strokeStyle = '#f2e4c9'; c.lineWidth = Math.max(.5,size*.012);
      for (const sign of [-1,1]) { c.beginPath(); c.moveTo(0,-size*.12); c.quadraticCurveTo(sign*size*.03,-size*.27,sign*size*.09,-size*.25); c.stroke(); }
      c.restore();
    }
    if (this.particles.length) this.frame = requestAnimationFrame(this.tick);
    else this.clear();
  }

  clear() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null; this.particles = [];
    this.ctx.setTransform(1,0,0,1,0,0);
    this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    this.canvas.dataset.active = 'false'; this.canvas.dataset.count = '0';
  }
}
