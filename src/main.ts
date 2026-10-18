import { Audio } from './audio';
import { Renderer } from './render/renderer';
import { DAY, NIGHT } from './render/theme';
import { portrait, RIVERTON } from './sim/city';
import { World } from './sim/world';
import { Editor } from './ui/editor';
import { Hud } from './ui/hud';

const STEP = 1 / 60;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const audio = new Audio();

const newWorld = () => new World(innerWidth < innerHeight ? portrait(RIVERTON) : RIVERTON, (Math.random() * 2 ** 31) | 0);
let world = newWorld();
let speed: 0 | 1 | 2 = 0;
let started = false;
let night = (() => {
  try {
    return localStorage.getItem('ss-night') === '1';
  } catch {
    return false;
  }
})();
document.body.classList.toggle('night', night);

const editor = new Editor(
  () => world,
  () => 1 / renderer.scale,
);

const hud = new Hud(document.getElementById('hud')!, {
  setSpeed: (s) => (speed = s),
  toggleNight: () => {
    night = !night;
    document.body.classList.toggle('night', night);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', night ? NIGHT.bg : DAY.bg);
    try {
      localStorage.setItem('ss-night', night ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  },
  toggleMute: () => (audio.muted = !audio.muted),
  itemDown: (kind, e) => {
    audio.unlock();
    editor.setPointer(e.pointerType);
    editor.beginItem(kind, renderer.toWorld(e.clientX, e.clientY));
  },
  selectLine: (slot) => (editor.selectedLine = editor.selectedLine === slot ? -1 : slot),
  deleteLine: (slot) => {
    world.deleteLine(slot);
    editor.selectedLine = -1;
  },
  chooseUpgrade: (k) => world.chooseUpgrade(k),
  start: () => {
    audio.unlock();
    // Fresh world on every start so the map orientation matches the screen.
    world = newWorld();
    renderer.resetCamera();
    editor.cancel();
    started = true;
    speed = 1;
  },
});

// ---------- input ----------

canvas.addEventListener('pointerdown', (e) => {
  if (!started || world.over || world.pendingUpgrade) return;
  audio.unlock();
  editor.setPointer(e.pointerType);
  if (editor.down(renderer.toWorld(e.clientX, e.clientY))) canvas.setPointerCapture(e.pointerId);
});
window.addEventListener('pointermove', (e) => {
  if (editor.active) editor.move(renderer.toWorld(e.clientX, e.clientY));
});
const release = (e: PointerEvent) => {
  if (!editor.active) return;
  const preview = editor.preview();
  const before = world.networkVersion;
  editor.up(renderer.toWorld(e.clientX, e.clientY), hud.isOverBar(document.elementFromPoint(e.clientX, e.clientY)));
  if (preview && preview.stops.length >= 2 && !preview.ok) hud.toast('Not enough tunnels for that route');
  if (world.networkVersion !== before) navigator.vibrate?.(8);
};
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', () => editor.cancel());

window.addEventListener('keydown', (e) => {
  if (!started || world.over) return;
  if (e.code === 'Space') {
    e.preventDefault();
    speed = speed === 0 ? 1 : 0;
  } else if (e.key === '1') speed = 1;
  else if (e.key === '2') speed = 2;
  else if (e.key === 'Escape') editor.cancel();
});
window.addEventListener('resize', () => renderer.resize());
// iOS only unlocks Web Audio from touchend/click, not pointerdown.
window.addEventListener('touchend', () => audio.unlock(), { passive: true });
// Phones background tabs often; never let the city overflow while nobody is looking.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && started && !world.over) speed = 0;
});
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// ---------- loop ----------

let last = performance.now();
let acc = 0;
function frame(now: number) {
  const elapsed = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (started) {
    acc += elapsed * speed;
    let steps = 0;
    while (acc >= STEP && steps < 12) {
      world.step(STEP);
      acc -= STEP;
      steps++;
    }
    if (world.over || world.pendingUpgrade) acc = 0;
  }
  for (const ev of world.events) {
    if (ev.type === 'deliver') audio.deliver(ev.line);
    else if (ev.type === 'stationSpawn' && world.time > 0) audio.station();
    else if (ev.type === 'weekEnd') {
      audio.weekEnd();
      navigator.vibrate?.([20, 60, 20]);
    }
    else if (ev.type === 'gameOver') {
      audio.gameOver();
      editor.cancel();
    }
  }
  world.events.length = 0;
  const theme = night ? NIGHT : DAY;
  hud.update({ world, speed, night, muted: audio.muted, selectedLine: editor.selectedLine, lineColors: theme.lines, started });
  renderer.insets = hud.insets();
  renderer.draw(world, editor, theme, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (import.meta.env.DEV) Object.assign(window, { __game: { get world() { return world; }, renderer, editor } });
