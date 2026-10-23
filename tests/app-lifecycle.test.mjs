import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const appSource = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

/** Execute the real UI listeners without opening a browser or requesting a camera. */
function createAppHarness() {
  const elements = new Map();
  const documentEvents = new Map();
  function makeElement(id) {
    const attributes = new Map();
    return {
      textContent: '', hidden: id === 'camera-panel', disabled: false, value: '', dataset: {},
      style: { setProperty() {} },
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute(name, value) { attributes.set(name, value); },
      getAttribute(name) { return attributes.get(name); },
      getContext() { return { clearRect() {} }; },
      addEventListener(type, handler) { this[type] = handler; },
    };
  }
  const document = {
    hidden: false,
    body: makeElement('body'),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    addEventListener(type, handler) { documentEvents.set(type, handler); },
  };
  // Match the engine's generation-based cancellation: late model/permission
  // completions resolve false, and never turn an obsolete session back on.
  class FakeEngine {
    constructor() { this.requests = []; this.running = false; this.generation = 0; }
    start() {
      const generation = ++this.generation;
      return new Promise((resolve) => this.requests.push({
        settle: () => {
          const started = generation === this.generation;
          if (started) this.running = true;
          resolve(started);
        },
      }));
    }
    stop() { this.generation++; this.running = false; }
  }
  const context = vm.createContext({
    document, FlowerGestureEngine: FakeEngine, ButterflySwarm: class { clear() {} burst() {} },
    matchMedia: () => ({ matches: false }), performance: { now: () => 100 },
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame() {},
    // Media initialization stays pending; these tests exercise only camera UI.
    fetch: () => new Promise(() => {}), window: { addEventListener() {} }, console,
  });
  const source = appSource.replace(/^import \{ (?:FlowerGestureEngine|ButterflySwarm) \} from '\.\/(?:gesture-engine|butterflies)\.js';\s*/gm, '');
  assert.notEqual(source, appSource, 'The test should replace the browser module imports.');
  vm.runInContext(`${source}\nglobalThis.inspectApp = () => ({ cameraState, demo, engine });`, context);
  return {
    element: (id) => document.getElementById(id),
    state: () => context.inspectApp(),
    hide() { document.hidden = true; documentEvents.get('visibilitychange')(); },
    show() { document.hidden = false; documentEvents.get('visibilitychange')(); },
  };
}

test('a cancelled startup cannot hide or disable a newer active camera session', async () => {
  const app = createAppHarness();
  const oldStartup = app.element('camera-button').click();
  app.hide();
  assert.equal(app.state().cameraState, 'off');
  app.show();
  const newStartup = app.element('camera-button').click();
  app.state().engine.requests[1].settle();
  await newStartup;
  assert.equal(app.state().cameraState, 'on');
  app.state().engine.requests[0].settle();
  await oldStartup;
  assert.equal(app.state().cameraState, 'on');
  assert.equal(app.state().engine.running, true);
  assert.equal(app.element('camera-panel').hidden, false);
  assert.equal(app.element('camera-button').disabled, false);
  assert.equal(app.element('camera-button').getAttribute('aria-pressed'), 'true');
  assert.equal(app.element('camera-label').textContent, '关闭摄像头');
});

test('automatic demo cancels a pending camera startup and stays on when it settles', async () => {
  const app = createAppHarness();
  const starting = app.element('camera-button').click();
  assert.equal(app.state().cameraState, 'starting');
  app.element('demo-button').click();
  assert.equal(app.state().cameraState, 'off');
  assert.equal(app.state().demo, true);
  app.state().engine.requests[0].settle();
  await starting;
  assert.equal(app.state().cameraState, 'off');
  assert.equal(app.state().engine.running, false);
  assert.equal(app.state().demo, true);
  assert.equal(app.element('camera-panel').hidden, true);
  assert.equal(app.element('camera-button').disabled, false);
  assert.equal(app.element('camera-label').textContent, '开启摄像头');
  assert.equal(app.element('demo-button').textContent, '暂停演示');
  assert.equal(app.element('status-text').textContent, '正在自动演示 · 也可以拖动下方滑杆');
});
