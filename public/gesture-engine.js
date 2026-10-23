/**
 * Local camera → MediaPipe Tasks → flower controls.
 * The model sees unmirrored pixels. Only the preview and swipe X are mirrored.
 * Tasks >= 0.10.5 uses anatomical handedness for an unmirrored source, unlike
 * legacy MediaPipe Hands. `swapHands` is an explicit camera/user override.
 * No image is uploaded, stored, or sent through a network API by this module.
 */

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15],
  [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
const validPoints = (points) => Array.isArray(points) && points.length === 21 &&
  points.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y) &&
    (p.z === undefined || Number.isFinite(p.z)));

/** 0 = closed fist, 1 = extended fingers. Rotation and hand-size independent. */
export function measureOpenness(landmarks, { worldLandmarks, aspectRatio = 1 } = {}) {
  if (!validPoints(landmarks)) return null;
  const points = validPoints(worldLandmarks) ? worldLandmarks : landmarks.map((p) => ({
    x: p.x * aspectRatio, y: p.y, z: (p.z || 0) * aspectRatio,
  }));
  const palmLength = distance(points[0], points[9]);
  if (palmLength < 1e-6) return null;
  // Four finger chains provide a continuous signal; thumb posture is deliberately
  // excluded because an open palm with a tucked thumb should still fully bloom.
  const extensions = [5, 9, 13, 17].map((base) => {
    const [mcp, pip, dip, tip] = points.slice(base, base + 4);
    const path = distance(mcp, pip) + distance(pip, dip) + distance(dip, tip);
    if (path < 1e-6) return 0;
    const straightness = clamp((distance(mcp, tip) / path - 0.42) / 0.53);
    const baseReach = distance(points[0], mcp);
    const reach = clamp((distance(points[0], tip) - baseReach) / (path * 0.82));
    return 0.48 * straightness + 0.52 * reach;
  });
  const raw = extensions.reduce((sum, value) => sum + value, 0) / extensions.length;
  return clamp((raw - 0.08) / 0.86);
}

export function getPalmCenter(landmarks) {
  if (!validPoints(landmarks)) return null;
  const ids = [0, 5, 9, 13, 17];
  return ids.reduce((p, id) => ({
    x: p.x + landmarks[id].x / ids.length,
    y: p.y + landmarks[id].y / ids.length,
  }), { x: 0, y: 0 });
}

export function normalizeHandedness(category, { inputMirrored = false, swapHands = false } = {}) {
  const value = typeof category === 'string' ? category : category?.categoryName || category?.displayName;
  let hand = value?.toLowerCase() === 'right' ? 'Right' : value?.toLowerCase() === 'left' ? 'Left' : null;
  if (hand && Boolean(inputMirrored) !== Boolean(swapHands)) hand = hand === 'Right' ? 'Left' : 'Right';
  return hand;
}

export function smoothOpenness(previous, target, elapsedMs, timeConstantMs = 95) {
  if (!Number.isFinite(target)) return previous;
  if (!Number.isFinite(previous)) return clamp(target);
  const alpha = 1 - Math.exp(-clamp(elapsedMs, 0, 150) / timeConstantMs);
  return clamp(previous + (target - previous) * alpha);
}

/**
 * A deliberate open-palm sideways stroke. Coordinates are preview/screen space.
 * A short still hold arms a stroke. Each stroke fires once, then requires both
 * cooldown and a fresh still hold. Disappearing hands never bridge a stroke.
 */
export class SwipeTracker {
  constructor(options = {}) {
    this.options = {
      minOpen: 0.60, holdMs: 170, cooldownMs: 950, historyMs: 550,
      minTravel: 0.14, minSpeed: 0.32, stillRadius: 0.024, ...options,
    };
    this.reset();
  }

  reset() {
    this.history = [];
    this.anchor = null;
    this.armed = false;
    this.lastTrigger = -Infinity;
    this.lastSampleTime = -Infinity;
  }

  update(sample, now = sample?.time) {
    const o = this.options;
    if (!sample || !Number.isFinite(sample.x) || !Number.isFinite(sample.y) ||
        !Number.isFinite(now) || !Number.isFinite(sample.openness) || sample.openness < o.minOpen) {
      this.history = [];
      this.anchor = null;
      this.armed = false;
      return 0;
    }
    if (now - this.lastSampleTime > 220 || now < this.lastSampleTime) {
      this.history = [];
      this.anchor = null;
      this.armed = false;
    }
    this.lastSampleTime = now;
    const point = { x: sample.x, y: sample.y, time: now };
    if (!this.armed) {
      if (now - this.lastTrigger < o.cooldownMs) {
        this.anchor = null;
        return 0;
      }
      if (!this.anchor || Math.hypot(point.x - this.anchor.x, point.y - this.anchor.y) > o.stillRadius) {
        this.anchor = point;
      }
      if (now - this.anchor.time >= o.holdMs) {
        this.armed = true;
        this.history = [point];
      }
      return 0;
    }
    this.history.push(point);
    this.history = this.history.filter((p) => now - p.time <= o.historyMs);
    const first = this.history[0];
    const dt = (now - first.time) / 1000;
    const dx = point.x - first.x;
    const dy = point.y - first.y;
    if (dt >= 0.07 && Math.abs(dx) >= o.minTravel && Math.abs(dx) > Math.abs(dy) * 1.8 &&
        Math.abs(dx) / dt >= o.minSpeed) {
      this.lastTrigger = now;
      this.armed = false;
      this.anchor = null;
      this.history = [];
      return Math.sign(dx);
    }
    return 0;
  }
}

/** Two held fists followed by a quick, coordinated opening; never bridge tracking loss. */
export class ButterflyReleaseTracker {
  constructor(options = {}) {
    this.options = { closed: 0.22, release: 0.35, open: 0.78, holdMs: 150,
      releaseMs: 650, togetherMs: 250, confirmMs: 40, gapMs: 220, cooldownMs: 6800, ...options };
    this.reset();
  }

  reset() {
    this.lastTrigger = -Infinity;
    this.lastTime = null;
    this.clearAttempt();
  }

  clearAttempt() {
    this.phase = 'idle';
    this.closedSince = this.releaseSince = this.firstOpen = this.bothOpenSince = null;
  }

  blocksSwipe(now) { return this.phase !== 'idle' || now - this.lastTrigger < 600; }

  update(right, left, now) {
    const o = this.options;
    if (!Number.isFinite(now) || !Number.isFinite(right) || !Number.isFinite(left)) {
      this.clearAttempt(); this.lastTime = null; return false;
    }
    if (this.lastTime !== null && (now - this.lastTime > o.gapMs || now < this.lastTime)) this.clearAttempt();
    this.lastTime = now;
    if (now - this.lastTrigger < o.cooldownMs) { this.clearAttempt(); return false; }
    const closed = right <= o.closed && left <= o.closed;
    if (this.phase === 'idle' || this.phase === 'holding') {
      if (!closed) { this.clearAttempt(); return false; }
      if (this.closedSince === null) this.closedSince = now;
      this.phase = now - this.closedSince >= o.holdMs ? 'armed' : 'holding';
      return false;
    }
    if (this.phase === 'armed') {
      if (Math.max(right, left) <= o.release) return false;
      this.phase = 'releasing'; this.releaseSince = now;
    }
    if (closed || now - this.releaseSince > o.releaseMs) { this.clearAttempt(); return false; }
    if (Math.max(right, left) >= o.open && this.firstOpen === null) this.firstOpen = now;
    if (this.firstOpen !== null && now - this.firstOpen > o.togetherMs && this.bothOpenSince === null) {
      this.clearAttempt(); return false;
    }
    if (right < o.open || left < o.open) { this.bothOpenSince = null; return false; }
    if (this.bothOpenSince === null) this.bothOpenSince = now;
    if (now - this.bothOpenSince < o.confirmMs) return false;
    this.lastTrigger = now;
    this.clearAttempt();
    return true;
  }
}

/** Stabilize brief handedness ambiguity by matching palm positions across frames. */
export class HandIdentityTracker {
  constructor() { this.tracks = []; }
  reset() { this.tracks = []; }
  update(hands, now) {
    this.tracks = this.tracks.filter((track) => now - track.time < 350);
    const available = new Set(this.tracks);
    const next = [];
    for (const hand of [...hands].sort((a, b) => b.score - a.score)) {
      let track = [...available].sort((a, b) =>
        Math.hypot(a.palm.x - hand.palm.x, a.palm.y - hand.palm.y) -
        Math.hypot(b.palm.x - hand.palm.x, b.palm.y - hand.palm.y))[0];
      if (track && Math.hypot(track.palm.x - hand.palm.x, track.palm.y - hand.palm.y) < 0.20) {
        available.delete(track);
        if (track.hand !== hand.hand) {
          track.disagreement = (track.disagreement || 0) + 1;
          if (track.disagreement >= 5 && hand.score >= 0.8) track.hand = hand.hand;
        } else track.disagreement = 0;
      } else {
        // Low handedness confidence cannot introduce an entirely new control hand.
        if (hand.score < 0.70) continue;
        track = { hand: hand.hand, disagreement: 0 };
      }
      Object.assign(track, { palm: hand.palm, time: now });
      next.push(track);
      hand.hand = track.hand;
    }
    this.tracks = [...next, ...available];
    return hands.filter((hand) => next.some((track) => track.palm === hand.palm));
  }
}

const noop = () => {};
const closedDetectors = new WeakSet();
function closeDetector(detector) {
  if (!detector || closedDetectors.has(detector)) return;
  closedDetectors.add(detector);
  detector.close();
}
const cameraMessage = (error) => {
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') return '摄像头权限尚未开启，请在浏览器地址栏允许摄像头后重试。';
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') return '没有找到摄像头，可以先用滑杆体验。';
  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') return '摄像头可能正被其他应用占用，请关闭占用后重试。';
  return error?.message || '手势识别未能启动，可以先用滑杆体验。';
};

/**
 * onOpen(value, {raw, tracked, hand:'Right'})
 * onSwitch(+1|-1)
 * onButterflies({palms:[rightPalm,leftPalm]}) — raw camera coordinates
 * onLandmarks([{hand, score, landmarks, openness, palm}]) — raw camera coordinates
 * onStatus({state:'loading'|'permission'|'tracking'|'stopped'|'error', message,
 *           rightVisible?, leftVisible?, delegate?})
 */
export class FlowerGestureEngine {
  constructor({ video, visionModuleUrl = '/vendor/mediapipe/vision_bundle.mjs',
    wasmRoot = '/vendor/mediapipe/wasm', modelUrl = '/models/hand_landmarker.task',
    onOpen = noop, onSwitch = noop, onButterflies = noop, onStatus = noop, onLandmarks = noop,
    swapHands = false, inputMirrored = false, previewMirrored = true, maxFps = 24,
  } = {}) {
    if (!video) throw new Error('FlowerGestureEngine requires a video element.');
    Object.assign(this, { video, visionModuleUrl, wasmRoot, modelUrl, onOpen, onSwitch, onButterflies,
      onStatus, onLandmarks, swapHands, inputMirrored, previewMirrored, maxFps });
    this.swipe = new SwipeTracker();
    this.butterflies = new ButterflyReleaseTracker();
    this.identities = new HandIdentityTracker();
    this.stream = null;
    this.landmarker = null;
    this.running = false;
    this.generation = 0;
    this.frameId = null;
    this.startPromise = null;
    this.smoothed = null;
    this.lastOpenTime = 0;
    this.missingSince = null;
    this.lastStatus = '';
    this.pageHide = () => this.stop();
  }

  emitStatus(state, message, extra = {}) {
    const status = { state, message, ...extra };
    const key = JSON.stringify(status);
    if (key !== this.lastStatus) { this.lastStatus = key; this.onStatus(status); }
  }

  setSwapHands(value) {
    this.swapHands = Boolean(value);
    this.identities.reset();
    this.swipe.reset();
    this.butterflies.reset();
  }

  async start() {
    if (this.running) return true;
    if (this.startPromise) return this.startPromise;
    const generation = ++this.generation;
    const promise = this.startSession(generation);
    this.startPromise = promise;
    try { return await promise; }
    finally { if (this.startPromise === promise) this.startPromise = null; }
  }

  async startSession(generation) {
    let detector = null;
    let stream = null;
    try {
      if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('请通过 localhost 或 HTTPS 打开页面，浏览器才能使用摄像头。');
      }
      this.emitStatus('loading', '正在准备本地手势识别…');
      const { HandLandmarker, FilesetResolver } = await import(this.visionModuleUrl);
      if (generation !== this.generation) return false;
      const fileset = await FilesetResolver.forVisionTasks(this.wasmRoot);
      if (generation !== this.generation) return false;
      const options = {
        baseOptions: { modelAssetPath: this.modelUrl, delegate: 'GPU' },
        runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.55,
      };
      let delegate = 'GPU';
      try { detector = await HandLandmarker.createFromOptions(fileset, options); }
      catch {
        if (generation !== this.generation) return false;
        delegate = 'CPU';
        options.baseOptions.delegate = 'CPU';
        detector = await HandLandmarker.createFromOptions(fileset, options);
      }
      if (generation !== this.generation) { closeDetector(detector); return false; }
      this.emitStatus('permission', '请允许使用摄像头，画面只在本机处理。');
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 } },
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop()); closeDetector(detector); return false;
      }
      this.stream = stream;
      this.landmarker = detector;
      this.video.srcObject = stream;
      this.video.muted = true;
      this.video.playsInline = true;
      await this.video.play();
      if (generation !== this.generation) return false;
      this.running = true;
      this.delegate = delegate;
      this.lastFrameTime = -Infinity;
      this.lastVideoTime = -1;
      this.lastOpenTime = performance.now();
      this.missingSince = null;
      this.identities.reset();
      this.swipe.reset();
      this.butterflies.reset();
      globalThis.addEventListener('pagehide', this.pageHide);
      stream.getVideoTracks().forEach((track) => track.addEventListener('ended', () => {
        if (this.running && generation === this.generation) {
          this.stop(); this.emitStatus('error', '摄像头连接已断开，请重新开启。');
        }
      }, { once: true }));
      this.emitStatus('tracking', '右手控制开合，左手停稳后向旁边推。', { rightVisible: false, leftVisible: false, delegate });
      this.frameId = requestAnimationFrame((now) => this.tick(now, generation));
      return true;
    } catch (error) {
      // Close resources from this session only; a newer start may already exist.
      stream?.getTracks().forEach((track) => track.stop());
      if (detector && detector !== this.landmarker) closeDetector(detector);
      if (generation === this.generation) {
        this.stop();
        this.emitStatus('error', cameraMessage(error));
        throw error;
      }
      return false;
    }
  }

  tick(now, generation) {
    if (!this.running || generation !== this.generation) return;
    if (!document.hidden && this.video.readyState >= 2 &&
        this.video.currentTime !== this.lastVideoTime && now - this.lastFrameTime >= 1000 / this.maxFps) {
      this.lastFrameTime = now;
      this.lastVideoTime = this.video.currentTime;
      try {
        this.processResult(this.landmarker.detectForVideo(this.video, now), now);
      } catch (error) {
        this.stop();
        this.emitStatus('error', '手势识别中断，请重新开启摄像头。');
        console.error('Local hand tracking failed:', error);
        return;
      }
    }
    this.frameId = requestAnimationFrame((time) => this.tick(time, generation));
  }

  processResult(result, now) {
    const categories = result.handedness || result.handednesses || [];
    const candidates = (result.landmarks || []).map((landmarks, index) => {
      const category = categories[index]?.[0];
      const hand = normalizeHandedness(category, this);
      const score = category?.score ?? 0;
      const palm = getPalmCenter(landmarks);
      const openness = measureOpenness(landmarks, {
        worldLandmarks: result.worldLandmarks?.[index],
        aspectRatio: this.video.videoWidth / (this.video.videoHeight || 1),
      });
      return { hand, score, palm, landmarks, openness };
    }).filter((hand) => hand.hand && hand.score >= 0.55 && hand.palm && hand.openness !== null);
    const hands = this.identities.update(candidates, now);
    const best = (name) => hands.filter((hand) => hand.hand === name).sort((a, b) => b.score - a.score)[0];
    const right = best('Right');
    const left = best('Left');
    if (right) {
      this.smoothed = smoothOpenness(this.smoothed, right.openness, now - this.lastOpenTime);
      this.lastOpenTime = now;
      this.missingSince = null;
      this.onOpen(this.smoothed, { raw: right.openness, tracked: true, hand: 'Right' });
    } else if (this.missingSince === null) {
      this.missingSince = now;
      // Hold the flower at its last position when the right hand leaves the frame.
      if (this.smoothed !== null) this.onOpen(this.smoothed, { tracked: false, hand: 'Right' });
    }
    const released = this.butterflies.update(right?.openness, left?.openness, now);
    if (released) this.onButterflies({ palms: [right.palm, left.palm] });
    const direction = this.swipe.update(left && !this.butterflies.blocksSwipe(now) ? {
      x: this.previewMirrored ? 1 - left.palm.x : left.palm.x,
      y: left.palm.y, openness: left.openness, time: now,
    } : null, now);
    if (direction) this.onSwitch(direction);
    this.onLandmarks(hands);
    const butterflyReady = ['armed', 'releasing'].includes(this.butterflies.phase);
    const message = butterflyReady ? '双手已握紧 · 快速张开，唤起蝴蝶' : right ? (left ? '双手握紧再张开，唤起蝴蝶' : '右手已识别 · 张开或握拢手指') :
      left ? '左手已识别 · 请举起右手控制花朵开合' : '把手举到镜头前，掌心朝向摄像头';
    this.emitStatus('tracking', message, { rightVisible: Boolean(right), leftVisible: Boolean(left), butterflyReady, delegate: this.delegate });
  }

  stop() {
    ++this.generation;
    this.running = false;
    this.startPromise = null;
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    closeDetector(this.landmarker);
    this.landmarker = null;
    this.identities.reset();
    this.swipe.reset();
    this.butterflies.reset();
    globalThis.removeEventListener('pagehide', this.pageHide);
    this.onLandmarks([]);
    this.emitStatus('stopped', '摄像头已关闭，可以用滑杆继续体验。');
  }
}
