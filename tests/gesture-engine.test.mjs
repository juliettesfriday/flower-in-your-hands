import test from 'node:test';
import assert from 'node:assert/strict';
import {
  measureOpenness, normalizeHandedness, smoothOpenness, SwipeTracker,
  HandIdentityTracker, FlowerGestureEngine, ButterflyReleaseTracker,
} from '../public/gesture-engine.js';

// Kinematic 21-point fixtures, with four fingers extended or curled into palm.
function handPose(open = 1) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8, z: 0 }));
  points[0] = { x: 0.5, y: 0.9, z: 0 };
  for (const [finger, base] of [5, 9, 13, 17].entries()) {
    const x = 0.32 + finger * 0.12;
    points[base] = { x, y: 0.58, z: 0 };
    points[base + 1] = { x, y: 0.44, z: 0 };
    const pipCurl = (1 - open) * 1.8;
    const dipCurl = (1 - open) * 3.0;
    points[base + 2] = { x, y: 0.44 - 0.12 * Math.cos(pipCurl), z: -0.12 * Math.sin(pipCurl) };
    points[base + 3] = { x,
      y: points[base + 2].y - 0.11 * Math.cos(dipCurl),
      z: points[base + 2].z - 0.11 * Math.sin(dipCurl),
    };
  }
  points[1] = { x: 0.36, y: 0.78, z: 0 };
  points[2] = { x: 0.26, y: 0.70, z: 0 };
  points[3] = { x: 0.17, y: 0.63, z: 0 };
  points[4] = { x: 0.08, y: 0.56, z: 0 };
  return points;
}

test('closed fist and extended fingers reach both control endpoints', () => {
  assert.ok(measureOpenness(handPose(0)) < 0.05);
  assert.ok(measureOpenness(handPose(1)) > 0.97);
  assert.ok(measureOpenness(handPose(0.6)) > measureOpenness(handPose(0.3)));
  assert.ok(measureOpenness(handPose(0.9)) > measureOpenness(handPose(0.6)));
});

test('curl score is unchanged by scale, translation, mirroring, and 3D rotation', () => {
  const pose = handPose(0.65);
  const expected = measureOpenness(pose);
  const theta = 0.91;
  const transformed = pose.map(({ x, y, z }) => ({
    x: 3 + 4 * (x * Math.cos(theta) - z * Math.sin(theta)),
    y: -2 - 4 * y,
    z: 4 * (x * Math.sin(theta) + z * Math.cos(theta)),
  }));
  assert.ok(Math.abs(measureOpenness(transformed) - expected) < 1e-10);
});

test('image aspect correction matches metric world landmarks', () => {
  const world = handPose(0.65);
  const distorted = world.map((p) => ({ ...p, x: p.x / 1.777, z: p.z / 1.777 }));
  assert.ok(Math.abs(measureOpenness(distorted, { aspectRatio: 1.777 }) - measureOpenness(world)) < 1e-10);
  assert.equal(measureOpenness(distorted, { worldLandmarks: world }), measureOpenness(world));
});

test('invalid or collapsed geometry never creates a control signal', () => {
  assert.equal(measureOpenness([]), null);
  assert.equal(measureOpenness(Array(21).fill({ x: 0, y: 0 })), null);
  const invalid = handPose(); invalid[8].x = NaN;
  assert.equal(measureOpenness(invalid), null);
});

test('Tasks anatomical handedness handles source mirror and explicit user override', () => {
  assert.equal(normalizeHandedness('Right'), 'Right');
  assert.equal(normalizeHandedness({ categoryName: 'Left' }), 'Left');
  assert.equal(normalizeHandedness('Right', { inputMirrored: true }), 'Left');
  assert.equal(normalizeHandedness('Right', { swapHands: true }), 'Left');
  assert.equal(normalizeHandedness('Right', { inputMirrored: true, swapHands: true }), 'Right');
  assert.equal(normalizeHandedness('unknown'), null);
});

test('openness smoothing is bounded, frame-rate independent, and ignores bad samples', () => {
  assert.equal(smoothOpenness(null, 0.8, 30), 0.8);
  assert.equal(smoothOpenness(0.4, NaN, 30), 0.4);
  const twoSteps = smoothOpenness(smoothOpenness(0, 1, 50), 1, 50);
  assert.ok(Math.abs(twoSteps - smoothOpenness(0, 1, 100)) < 1e-10);
  assert.ok(smoothOpenness(0, 1, 100) < 1);
});

function sample(tracker, x, time, y = 0.5, openness = 1) {
  return tracker.update({ x, y, openness, time });
}
function arm(tracker, x = 0.3, start = 0) {
  for (let dt = 0; dt <= 200; dt += 50) assert.equal(sample(tracker, x, start + dt), 0);
}

test('left-palm push emits one next action and cannot repeat while held', () => {
  const tracker = new SwipeTracker(); arm(tracker);
  assert.equal(sample(tracker, 0.38, 300), 0);
  assert.equal(sample(tracker, 0.48, 400), 1);
  for (let t = 450; t < 1900; t += 50) assert.equal(sample(tracker, 0.48, t), 0);
});

test('previous action works after cooldown and a still-palm rearm', () => {
  const tracker = new SwipeTracker(); arm(tracker);
  sample(tracker, 0.38, 300);
  assert.equal(sample(tracker, 0.48, 400), 1);
  for (let t = 450; t <= 1600; t += 50) sample(tracker, 0.48, t);
  assert.equal(sample(tracker, 0.40, 1700), 0);
  assert.equal(sample(tracker, 0.30, 1800), -1);
});

test('jitter, vertical movement, and a closed left hand never switch flowers', () => {
  const jitter = new SwipeTracker(); arm(jitter);
  for (let t = 250; t < 2000; t += 50) assert.equal(sample(jitter, 0.30 + Math.sin(t) * 0.009, t), 0);
  const vertical = new SwipeTracker(); arm(vertical);
  for (let t = 250; t < 600; t += 50) assert.equal(sample(vertical, 0.3 + t / 4000, t, t / 700), 0);
  const closed = new SwipeTracker(); arm(closed);
  assert.equal(sample(closed, 0.7, 350, 0.5, 0.2), 0);
});

test('slow drift is not a deliberate push', () => {
  const tracker = new SwipeTracker(); arm(tracker);
  for (let t = 250; t < 4000; t += 50) assert.equal(sample(tracker, 0.3 + (t - 200) * 0.00012, t), 0);
});

test('tracking gaps cannot bridge into phantom swipes', () => {
  const tracker = new SwipeTracker(); arm(tracker);
  assert.equal(sample(tracker, 0.35, 300), 0);
  assert.equal(tracker.update(null, 350), 0);
  assert.equal(sample(tracker, 0.8, 400), 0);
  assert.equal(sample(tracker, 0.1, 2000), 0);
});

test('identity tracker resists transient handedness flips and rejects uncertain new hands', () => {
  const tracker = new HandIdentityTracker();
  const make = (hand, score = 0.95) => ({ hand, score, palm: { x: 0.3, y: 0.5 } });
  assert.deepEqual(tracker.update([make('Right', 0.6)], 0), []);
  assert.equal(tracker.update([make('Right')], 50)[0].hand, 'Right');
  assert.equal(tracker.update([make('Left', 0.6)], 100)[0].hand, 'Right');
  for (let t = 150; t <= 250; t += 50) assert.equal(tracker.update([make('Left')], t)[0].hand, 'Right');
  assert.equal(tracker.update([make('Left')], 300)[0].hand, 'Left');
});

test('right hand controls bloom; loss holds position; explicit swap changes control hand', () => {
  const received = [];
  const engine = new FlowerGestureEngine({
    video: { videoWidth: 640, videoHeight: 480 },
    onOpen: (value, meta) => received.push({ value, ...meta }),
  });
  const result = (hand, open = 1) => ({
    landmarks: [handPose(open)], worldLandmarks: [handPose(open)],
    handedness: [[{ categoryName: hand, score: 0.95 }]],
  });
  engine.processResult(result('Right'), 100);
  assert.ok(received.at(-1).value > 0.97);
  engine.processResult({ landmarks: [] }, 150);
  assert.equal(received.at(-1).tracked, false);
  assert.ok(received.at(-1).value > 0.97);
  engine.setSwapHands(true);
  engine.processResult(result('Left', 0), 300);
  assert.equal(received.at(-1).tracked, true);
  assert.ok(received.at(-1).value < 0.3);
});

function holdFists(tracker, start = 0) {
  for (let t = start; t <= start + 200; t += 50) assert.equal(tracker.update(.08,.1,t), false);
  assert.equal(tracker.phase, 'armed');
}

test('two held fists followed by a quick opening fire once, then require cooldown and a fresh hold', () => {
  const tracker = new ButterflyReleaseTracker(); holdFists(tracker);
  assert.equal(tracker.update(.92,.9,250), false);
  assert.equal(tracker.update(.94,.92,300), true);
  for (let t=350;t<1000;t+=50) assert.equal(tracker.update(.95,.95,t),false);
  for (let t=1000;t<=1200;t+=50) assert.equal(tracker.update(.05,.05,t),false);
  assert.equal(tracker.update(1,1,1250),false);
  assert.equal(tracker.update(1,1,1300),false);
  assert.equal(tracker.update(1,1,7200),false);
  holdFists(tracker,7300);
  assert.equal(tracker.update(.9,.9,7550),false);
  assert.equal(tracker.update(.9,.9,7600),true);
});

test('ordinary open palms, one hand, a brief fist and half-open fingers cannot release butterflies', () => {
  const tracker = new ButterflyReleaseTracker();
  for (let t=0;t<300;t+=50) assert.equal(tracker.update(1,1,t),false);
  for (let t=300;t<600;t+=50) assert.equal(tracker.update(.05,1,t),false);
  assert.equal(tracker.update(.05,.05,600),false);
  assert.equal(tracker.update(1,1,650),false);
  holdFists(tracker,800);
  for (let t=1050;t<1900;t+=50) assert.equal(tracker.update(.65,.65,t),false);
  assert.equal(tracker.update(1,1,1900),false);
  assert.equal(tracker.update(1,1,1950),false);
});

test('slow openings, widely staggered hands and single-frame open glitches do not trigger', () => {
  const slow = new ButterflyReleaseTracker(); holdFists(slow);
  for(let t=250;t<=950;t+=50) assert.equal(slow.update(.4,.4,t),false);
  assert.equal(slow.update(1,1,1000),false);
  assert.equal(slow.update(1,1,1050),false);
  const staggered = new ButterflyReleaseTracker(); holdFists(staggered);
  for(let t=250;t<=550;t+=50) assert.equal(staggered.update(.95,.1,t),false);
  assert.equal(staggered.update(.95,.95,600),false);
  assert.equal(staggered.update(.95,.95,650),false);
  const glitch = new ButterflyReleaseTracker(); holdFists(glitch);
  assert.equal(glitch.update(1,1,250),false);
  assert.equal(glitch.update(.1,.1,280),false);
  assert.equal(glitch.update(1,1,310),false);
});

test('tracking loss, long frame gaps, clock reversal and explicit reset discard the armed gesture', () => {
  for (const interrupt of [t=>t.update(null,.1,250),t=>t.update(1,1,500),t=>t.update(1,1,10),t=>t.reset()]) {
    const tracker=new ButterflyReleaseTracker(); holdFists(tracker); interrupt(tracker);
    assert.equal(tracker.update(1,1,550),false);
    assert.equal(tracker.update(1,1,600),false);
  }
});

test('engine emits a butterfly burst with two palms while preserving bloom and suppressing swipe', () => {
  const bursts=[], blooms=[], switches=[];
  const engine=new FlowerGestureEngine({video:{videoWidth:640,videoHeight:480},
    onButterflies:event=>bursts.push(event),onOpen:value=>blooms.push(value),onSwitch:value=>switches.push(value)});
  const result=(open,shift=0)=>{
    const poses=[-.18,.18+shift].map(dx=>handPose(open).map(p=>({...p,x:p.x*.3+.35+dx,y:p.y*.4+.3,z:p.z*.3})));
    return {landmarks:poses,worldLandmarks:[handPose(open),handPose(open)],
      handedness:[[{categoryName:'Right',score:.99}],[{categoryName:'Left',score:.99}]]};
  };
  for(let t=0;t<=200;t+=50)engine.processResult(result(0),t);
  engine.processResult(result(1,.05),250);
  engine.processResult(result(1,.1),300);
  for(let t=350;t<=650;t+=50)engine.processResult(result(1,.1),t);
  assert.equal(bursts.length,1);
  assert.equal(bursts[0].palms.length,2);
  assert.ok(blooms.at(-1)>.9);
  assert.deepEqual(switches,[]);
  engine.setSwapHands(true);
  assert.equal(engine.butterflies.phase,'idle');
});

test('stop closes every camera track and detector exactly once and clears preview', () => {
  const oldRemove = globalThis.removeEventListener;
  globalThis.removeEventListener = () => {};
  try {
    let tracksStopped = 0; let closed = 0; let paused = 0;
    const video = { srcObject: {}, pause: () => { paused++; } };
    const engine = new FlowerGestureEngine({ video });
    engine.stream = { getTracks: () => [{ stop: () => { tracksStopped++; } }, { stop: () => { tracksStopped++; } }] };
    engine.landmarker = { close: () => { closed++; } };
    engine.running = true;
    engine.stop(); engine.stop();
    assert.equal(tracksStopped, 2);
    assert.equal(closed, 1);
    assert.equal(paused, 2);
    assert.equal(video.srcObject, null);
    assert.equal(engine.running, false);
  } finally { globalThis.removeEventListener = oldRemove; }
});

const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function withBrowserMocks(values, callback) {
  const originals = new Map(Object.keys(values).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  try { return await callback(); }
  finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

function stubVisionUrl(unique) {
  return `data:text/javascript,${encodeURIComponent(`
    // ${unique}
    export const FilesetResolver = { forVisionTasks: async () => ({}) };
    export const HandLandmarker = { createFromOptions: (...args) => globalThis.flowerGestureTestCreate(...args) };
  `)}`;
}

test('cancel during camera permission request shuts down the late stream and model', async () => {
  const permission = deferred(); const requested = deferred();
  let stopped = 0; let closed = 0;
  await withBrowserMocks({
    isSecureContext: true,
    removeEventListener: () => {},
    navigator: { mediaDevices: { getUserMedia: () => { requested.resolve(); return permission.promise; } } },
    flowerGestureTestCreate: async () => ({ close: () => { closed++; } }),
  }, async () => {
    const video = { pause: () => {}, play: async () => {}, srcObject: null };
    const engine = new FlowerGestureEngine({ video, visionModuleUrl: stubVisionUrl('cancel-permission') });
    const starting = engine.start();
    await requested.promise;
    engine.stop();
    permission.resolve({ getTracks: () => [{ stop: () => { stopped++; } }] });
    assert.equal(await starting, false);
    assert.equal(stopped, 1);
    assert.equal(closed, 1);
    assert.equal(video.srcObject, null);
    assert.equal(engine.running, false);
  });
});

test('GPU startup failure falls back to CPU and denied permission still releases model', async () => {
  const delegates = []; const statuses = []; let closed = 0;
  const permissionError = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  await withBrowserMocks({
    isSecureContext: true,
    removeEventListener: () => {},
    navigator: { mediaDevices: { getUserMedia: async () => { throw permissionError; } } },
    flowerGestureTestCreate: async (_fileset, options) => {
      delegates.push(options.baseOptions.delegate);
      if (options.baseOptions.delegate === 'GPU') throw new Error('GPU unavailable');
      return { close: () => { closed++; } };
    },
  }, async () => {
    const engine = new FlowerGestureEngine({ video: { pause: () => {} },
      visionModuleUrl: stubVisionUrl('gpu-permission'), onStatus: (status) => statuses.push(status) });
    await assert.rejects(engine.start(), { name: 'NotAllowedError' });
    assert.deepEqual(delegates, ['GPU', 'CPU']);
    assert.equal(closed, 1);
    assert.equal(engine.running, false);
    assert.equal(statuses.at(-1).state, 'error');
    assert.match(statuses.at(-1).message, /权限/);
  });
});
