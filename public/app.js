import { FlowerGestureEngine } from './gesture-engine.js';
import { ButterflySwarm } from './butterflies.js';

const $ = id => document.getElementById(id);
const canvas = $('flower-canvas');
const ctx = canvas.getContext('2d', {alpha:true});
const video = $('camera-video');
const overlay = $('camera-overlay');
const overlayCtx = overlay.getContext('2d');
const butterflies = new ButterflySwarm($('butterfly-canvas'));
const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let flowers = [], active = 1, target = 1, openness = 1, lastTime = 0;
let demo = false, demoStart = 0, cameraState = 'off', switchingAt = 0;
let selectionVersion = 0, lastRendered = '', toastTimer;
const bitmaps = new Map(), pending = new Map();
const missing = new Set();
const MAX_BITMAPS = 110;
let previousImage = null, lastCameraError = '', cameraAttempt = 0;

function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  $('toast').classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ $('toast').classList.remove('is-visible'); $('toast').hidden = true; },4200);
}

function framePath(flower,index) { return `/media/${flower.id}/${String(index).padStart(3,'0')}.webp`; }
function remember(key,image) {
  bitmaps.set(key,image);
  while (bitmaps.size > MAX_BITMAPS) {
    const entry = [...bitmaps.keys()].find(k=> !k.startsWith(flowers[active]?.id + ':')) || bitmaps.keys().next().value;
    if (bitmaps.get(entry) !== previousImage) bitmaps.get(entry).close?.();
    bitmaps.delete(entry);
  }
}
async function getFrame(flower,index) {
  const key = `${flower.id}:${index}`;
  if (bitmaps.has(key)) return bitmaps.get(key);
  if (pending.has(key)) return pending.get(key);
  const promise = (async()=>{
    const response = await fetch(framePath(flower,index));
    if (!response.ok) throw new Error(`花朵帧读取失败 ${response.status}`);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    remember(key,bitmap);
    missing.delete(key);
    return bitmap;
  })().catch(error=>{missing.add(key);throw error;}).finally(()=>pending.delete(key));
  pending.set(key,promise);
  return promise;
}
function nearestFrame(flower,index) {
  let best = null, distance = Infinity;
  for (const [key,img] of bitmaps) {
    if (!key.startsWith(flower.id + ':')) continue;
    const d = Math.abs(Number(key.split(':')[1])-index);
    if(d < distance) {distance = d;best = img;}
  }
  return best;
}
async function preload(flower,version) {
  const n = flower.frameCount;
  const requested = Math.round(openness*(n-1));
  const order = [...new Set([requested,0,n-1,...Array.from({length:Math.ceil(n/4)},(_,i)=>i*4).filter(i=>i<n),...Array.from({length:n},(_,i)=>i)])];
  let done = 0, next = 0, failed = 0;
  await Promise.all(Array.from({length:4},async()=>{
    while(next<order.length && version === selectionVersion) {
      const i = order[next++];
      try { await getFrame(flower,i); } catch { failed++; }
      done++;
      if(version === selectionVersion) $('loading-progress').value = done / order.length;
    }
  }));
  if(version === selectionVersion && failed) toast('部分花朵画面加载失败，刷新页面可重试。');
}

function setDemo(enabled) {
  demo = enabled;
  demoStart = performance.now() - Math.acos(1 - 2 * target) / (Math.PI*2) * 7200;
  $('demo-button').textContent = demo ? '暂停演示' : '自动绽放';
  $('demo-button').setAttribute('aria-pressed', String(demo));
  if(cameraState === 'off') $('status-text').textContent = demo ? '正在自动演示 · 也可以拖动下方滑杆' : '打开摄像头，让花随你的手绽放';
}

function selectFlower(index, announce=true) {
  if(!flowers.length) return;
  if(previousImage && ![...bitmaps.values()].includes(previousImage))previousImage.close?.();
  previousImage = nearestFrame(flowers[active],Math.round(openness*(flowers[active].frameCount-1)));
  active = (index + flowers.length) % flowers.length;
  const flower = flowers[active];
  selectionVersion++;
  switchingAt = performance.now();
  lastRendered = '';
  $('flower-title').textContent = flower.title;
  $('flower-subtitle').textContent = ['FRAGRANCE / No. 022','LILY / No. 012','FLOWER FLOWING'][active] || '';
  $('media-note').textContent = flower.note || '';
  $('media-note').title = flower.note || '';
  document.querySelectorAll('#flower-list [data-flower]').forEach(button=>{
    const selected=Number(button.dataset.flower)===active;
    button.classList.toggle('is-active',selected);
    button.setAttribute('aria-pressed',String(selected));
  });
  document.querySelector('.bloom-label').textContent=flower.capability==='petal-motion'?'舒展':'绽放';
  document.querySelector('.instruction-label').textContent=flower.capability==='petal-motion'?'右手 · 控制舒展':'右手 · 控制绽放';
  document.querySelector('.instruction-copy').textContent=flower.capability==='petal-motion'?'原片为舒展动效，尚无闭合花苞。':'张开，盛放。合拢，收起。';
  preload(flower,selectionVersion);
  if(announce) toast(flower.title);
}

function draw(now) {
  requestAnimationFrame(draw);
  if(!flowers.length || document.hidden) { lastTime=now; return; }
  const dt = Math.min(60,now-(lastTime||now)); lastTime=now;
  if(demo) target = (1 - Math.cos((now-demoStart)/7200*Math.PI*2))/2;
  // The hand engine already smooths its estimate; this also softens mouse changes.
  openness += (target-openness)*(1-Math.exp(-dt/65));
  if(Math.abs(openness-target)<0.0003) openness=target;
  const flower=flowers[active],index=Math.round(openness*(flower.frameCount-1));
  const key=`${flower.id}:${index}`;
  const image=bitmaps.get(key)||nearestFrame(flower,index);
  if(!bitmaps.has(key) && !missing.has(key)) getFrame(flower,index).catch(()=>{});
  const fade=prefersReducedMotion?1:Math.min(1,(now-switchingAt)/340);
  const stamp=`${key}:${image===bitmaps.get(key)}:${fade.toFixed(2)}:${canvas.width}`;
  if(image && (stamp!==lastRendered || fade<1)) {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(previousImage && fade<1) {ctx.globalAlpha=1-fade;ctx.drawImage(previousImage,0,0,canvas.width,canvas.height);}
    ctx.globalAlpha=fade;ctx.drawImage(image,0,0,canvas.width,canvas.height);ctx.globalAlpha=1;
    lastRendered=stamp;
    $('loading-screen').hidden=true;
  }
  if(fade===1 && previousImage) {if(![...bitmaps.values()].includes(previousImage))previousImage.close?.();previousImage=null;}
  const percent=Math.round(openness*100);
  $('bloom-slider').value=String(openness);
  $('bloom-slider').style.setProperty('--bloom',`${percent}%`);
  $('bloom-value').textContent=`${percent}%`;
  canvas.dataset.flower=flower.id;
  canvas.dataset.frame=String(index);
  canvas.setAttribute('aria-label',`${flower.title}，${flower.capability==='petal-motion'?'舒展':'绽放'}进度 ${percent}%`);
}

function syncCameraDimensions() {
  if (!video.videoWidth || !video.videoHeight) return;
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  document.querySelector('.camera-feed').style.setProperty('--camera-aspect', `${video.videoWidth} / ${video.videoHeight}`);
}
video.addEventListener('loadedmetadata', syncCameraDimensions);
video.addEventListener('resize', syncCameraDimensions);

const connections=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
function drawHands(hands) {
  overlayCtx.clearRect(0,0,overlay.width,overlay.height);
  const list=Array.isArray(hands)?hands:(hands?.hands||[]);
  for(const hand of list) {
    const points=hand.landmarks || hand.points;
    if(!points)continue;
    const right=String(hand.hand||hand.handedness||hand.label||hand.side).toLowerCase()==='right';
    overlayCtx.strokeStyle=right?'#b9d4bd':'#c6b5dd';overlayCtx.fillStyle=overlayCtx.strokeStyle;overlayCtx.lineWidth=Math.max(1.2,overlay.width/320);
    for(const [a,b]of connections){overlayCtx.beginPath();overlayCtx.moveTo(points[a].x*overlay.width,points[a].y*overlay.height);overlayCtx.lineTo(points[b].x*overlay.width,points[b].y*overlay.height);overlayCtx.stroke();}
    for(const p of points){overlayCtx.beginPath();overlayCtx.arc(p.x*overlay.width,p.y*overlay.height,Math.max(1.7,overlay.width/240),0,Math.PI*2);overlayCtx.fill();}
  }
}
function updatePresence(meta={}) {
  const right=meta.rightVisible??meta.rightPresent??meta.rightDetected??false,left=meta.leftVisible??meta.leftPresent??meta.leftDetected??false;
  $('right-status').textContent=right?'右手 · 已识别':'右手 · 待识别';
  $('left-status').textContent=left?'左手 · 已识别':'左手 · 待识别';
  $('right-status').classList.toggle('is-tracking',right);
  $('left-status').classList.toggle('is-tracking',left);
}
function cameraOff() {
  butterflies.clear();
  cameraAttempt++;
  cameraState='off';$('camera-button').disabled=false;
  $('camera-button').classList.remove('is-on');$('camera-button').setAttribute('aria-pressed','false');
  $('camera-label').textContent='开启摄像头';$('camera-panel').hidden=true;
  document.body.classList.remove('camera-active');
  $('butterfly-hint').classList.remove('is-ready');
  $('butterfly-hint').textContent='双手握紧，再张开 · 唤起蝴蝶';
  $('status-text').textContent='打开摄像头，让花随你的手绽放';updatePresence();drawHands([]);
}
function releaseButterflies(palms) {
  if (!palms?.length || !video.videoWidth) { butterflies.burst(); return; }
  const frame = document.querySelector('.capture-frame').getBoundingClientRect();
  const feed = document.querySelector('.camera-feed').getBoundingClientRect();
  // Match the mirrored, object-fit:cover camera and landmark canvas exactly.
  const scale = Math.max(feed.width/video.videoWidth, feed.height/video.videoHeight);
  const cropX = (video.videoWidth*scale-feed.width)/2;
  const cropY = (video.videoHeight*scale-feed.height)/2;
  const clamp = value => Math.max(0,Math.min(1,value));
  butterflies.burst(palms.map(p => ({
    x:clamp((feed.left-frame.left+feed.width-(p.x*video.videoWidth*scale-cropX))/frame.width),
    y:clamp((feed.top-frame.top+p.y*video.videoHeight*scale-cropY)/frame.height),
  })));
}
const engine=new FlowerGestureEngine({
  video,
  visionModuleUrl:'/vendor/mediapipe/vision_bundle.mjs',wasmRoot:'/vendor/mediapipe/wasm',modelUrl:'/models/hand_landmarker.task',
  onOpen(value){if(cameraState==='on'){target=value;if(demo)setDemo(false);}},
  onSwitch(direction){selectFlower(active+direction);},
  onButterflies({palms}){if(cameraState==='on')releaseButterflies(palms);},
  onStatus(status){
    if(status.message)$('status-text').textContent=status.message;
    updatePresence(status);
    $('butterfly-hint').classList.toggle('is-ready',Boolean(status.butterflyReady));
    $('butterfly-hint').textContent=status.butterflyReady?'现在张开双手 · 让蝴蝶飞起来':'双手握紧，再张开 · 唤起蝴蝶';
    if(status.state==='error'){lastCameraError=status.message||'摄像头未能启动，请检查权限后重试。';cameraOff();$('status-text').textContent=lastCameraError;toast(lastCameraError);}
  },
  onLandmarks(hands){drawHands(hands);const list=Array.isArray(hands)?hands:(hands?.hands||[]);if(list.length||cameraState==='on')updatePresence({rightPresent:list.some(h=>h.hand==='Right'),leftPresent:list.some(h=>h.hand==='Left')});}
});

$('camera-button').addEventListener('click',async()=>{
  if(cameraState==='on'){engine.stop();cameraOff();return;}
  if(cameraState==='starting')return;
  const attempt=++cameraAttempt;
  setDemo(false);lastCameraError='';cameraState='starting';$('camera-button').disabled=true;$('camera-label').textContent='正在准备…';
  try {
    const started=await engine.start();if(attempt!==cameraAttempt)return;if(!started){cameraOff();return;}cameraState='on';$('camera-button').disabled=false;
    $('camera-label').textContent='关闭摄像头';$('camera-button').classList.add('is-on');$('camera-button').setAttribute('aria-pressed','true');
    syncCameraDimensions();
    $('camera-panel').hidden=false;
    document.body.classList.add('camera-active');
    toast('右手开合 · 左手切花 · 双手握紧再张开，唤起蝴蝶');
  } catch(error){if(attempt!==cameraAttempt)return;cameraOff();const message=lastCameraError||error.message||'摄像头启动失败。请允许摄像头权限后重试。';$('status-text').textContent=message;toast(message);}
});
$('butterfly-button').addEventListener('click',()=>{
  document.querySelector('.settings').open=false;
  releaseButterflies();
});
$('bloom-slider').addEventListener('input',e=>{setDemo(false);target=Number(e.target.value);});
$('demo-button').addEventListener('click',()=>{
  if(cameraState!=='off'){engine.stop();cameraOff();}
  setDemo(!demo);
});
$('previous-button').addEventListener('click',()=>selectFlower(active-1));
$('next-button').addEventListener('click',()=>selectFlower(active+1));
$('flower-list').addEventListener('click',e=>{const button=e.target.closest('[data-flower]');if(button)selectFlower(Number(button.dataset.flower));});
$('swap-hands').addEventListener('change',e=>{engine.setSwapHands(e.target.checked);toast(e.target.checked?'已交换左右手识别':'已恢复默认左右手识别');});
$('fullscreen-button').addEventListener('click',async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('当前浏览器不支持全屏，可在 Chrome 中打开。');}
});
document.addEventListener('keydown',e=>{
  if(['INPUT','TEXTAREA','SELECT','BUTTON'].includes(e.target.tagName))return;
  if(e.key==='ArrowLeft'){e.preventDefault();selectFlower(active-1);}
  if(e.key==='ArrowRight'){e.preventDefault();selectFlower(active+1);}
  if(e.code==='Space'){e.preventDefault();$('demo-button').click();}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden && cameraState!=='off'){engine.stop();cameraOff();}});
window.addEventListener('pagehide',()=>engine.stop());

async function init(){
  try {
    const response=await fetch('/media/manifest.json',{cache:'no-store'});
    if(!response.ok)throw new Error('花朵素材未能加载，请刷新重试。');
    const manifest=await response.json();flowers=manifest.flowers;
    canvas.width=manifest.width||640;canvas.height=manifest.height||640;
    flowers.forEach((flower,i)=>{const img=document.querySelector(`[data-thumb="${i}"]`);if(img)img.src=flower.poster||`/media/${flower.id}/poster.webp`;});
    selectFlower(1,false);
  }catch(error){$('loading-screen').hidden=true;$('status-text').textContent=error.message;toast(error.message);}
}
requestAnimationFrame(draw);
init();
