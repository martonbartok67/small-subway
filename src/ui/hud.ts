import type { UpgradeKind } from '../sim/types';
import type { World } from '../sim/world';
import type { ItemKind } from './editor';

const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const ICON = {
  pause: '<svg viewBox="0 0 16 16"><rect x="3" y="2" width="3.5" height="12"/><rect x="9.5" y="2" width="3.5" height="12"/></svg>',
  play: '<svg viewBox="0 0 16 16"><path d="M4 2l10 6-10 6z"/></svg>',
  fast: '<svg viewBox="0 0 16 16"><path d="M1 3l7 5-7 5zM8 3l7 5-7 5z"/></svg>',
  moon: '<svg viewBox="0 0 16 16"><path d="M10 1a7 7 0 1 0 5 11A6 6 0 0 1 10 1z"/></svg>',
  sound: '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3v10L5 10H2z"/><path d="M11 5c1.5 1.5 1.5 4.5 0 6" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>',
  mute: '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3v10L5 10H2z"/><path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" stroke-width="1.6"/></svg>',
};

const ITEM_SVG: Record<ItemKind | 'tunnel' | 'line', string> = {
  loco: '<svg viewBox="0 0 26 18"><rect x="1" y="3" width="24" height="12" rx="3" fill="currentColor"/></svg>',
  carriage:
    '<svg viewBox="0 0 26 18"><rect x="1" y="3" width="24" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>',
  interchange:
    '<svg viewBox="0 0 26 18"><circle cx="13" cy="9" r="7.5" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="13" cy="9" r="3" fill="currentColor"/></svg>',
  tunnel: '<svg viewBox="0 0 26 18"><path d="M2 16V9a11 7 0 0 1 22 0v7h-5V10a6 4 0 0 0-12 0v6z" fill="currentColor"/></svg>',
  line: '<svg viewBox="0 0 26 18"><circle cx="13" cy="9" r="7" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
};

const UPGRADE_LABEL: Record<UpgradeKind, [string, keyof typeof ITEM_SVG]> = {
  line: ['New line', 'line'],
  carriage: ['Carriage', 'carriage'],
  crossings: ['2 Tunnels', 'tunnel'],
  interchange: ['Interchange', 'interchange'],
};

export interface HudCallbacks {
  setSpeed(s: 0 | 1 | 2): void;
  toggleNight(): void;
  toggleMute(): void;
  itemDown(kind: ItemKind, e: PointerEvent): void;
  selectLine(slot: number): void;
  deleteLine(slot: number): void;
  chooseUpgrade(k: UpgradeKind): void;
  start(): void;
}

export interface HudState {
  world: World;
  speed: 0 | 1 | 2;
  night: boolean;
  muted: boolean;
  selectedLine: number;
  lineColors: string[];
  started: boolean;
}

/** DOM overlay. Re-renders a region only when its content key changes. */
export class Hud {
  private keys = new Map<string, string>();
  private top: HTMLElement;
  private bar: HTMLElement;
  private overlay: HTMLElement;
  private toastEl: HTMLElement;
  private toastTimer = 0;

  constructor(
    root: HTMLElement,
    private cb: HudCallbacks,
  ) {
    root.innerHTML = '<div class="top"></div><div class="bar"></div><div class="overlay-slot"></div><div class="toast" style="opacity:0"></div>';
    this.top = root.querySelector('.top')!;
    this.bar = root.querySelector('.bar')!;
    this.overlay = root.querySelector('.overlay-slot')!;
    this.toastEl = root.querySelector('.toast')!;
    // Act on pointerdown: instant on touch, and immune to the element being re-rendered before a click lands.
    root.addEventListener('pointerdown', (e) => {
      if (this.onAct(e)) return;
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-item]');
      if (item && !item.classList.contains('empty')) {
        e.preventDefault();
        this.cb.itemDown(item.dataset.item as ItemKind, e);
      }
    });
  }

  /** Screen-space band the HUD covers, so the map is laid out between them. */
  insets(): { top: number; bottom: number } {
    return { top: this.top.getBoundingClientRect().bottom + 8, bottom: window.innerHeight - this.bar.getBoundingClientRect().top + 8 };
  }

  isOverBar(target: EventTarget | null): boolean {
    return target instanceof Node && this.bar.contains(target);
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.style.opacity = '1';
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.style.opacity = '0'), 1800);
  }

  private onAct(e: PointerEvent): boolean {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return false;
    e.preventDefault();
    const [act, arg] = el.dataset.act!.split(':');
    if (act === 'speed') this.cb.setSpeed(Number(arg) as 0 | 1 | 2);
    else if (act === 'night') this.cb.toggleNight();
    else if (act === 'mute') this.cb.toggleMute();
    else if (act === 'select') this.cb.selectLine(Number(arg));
    else if (act === 'delete') {
      e.stopPropagation();
      this.cb.deleteLine(Number(arg));
    } else if (act === 'upgrade') this.cb.chooseUpgrade(arg as UpgradeKind);
    else if (act === 'start') this.cb.start();
    return true;
  }

  private set(el: HTMLElement, key: string, html: () => string): void {
    const id = el.className;
    if (this.keys.get(id) === key) return;
    this.keys.set(id, key);
    el.innerHTML = html();
  }

  update(s: HudState): void {
    const w = s.world;
    const day = Math.floor(w.day);
    const topKey = [day, s.speed, s.night, s.muted].join('|');
    this.set(this.top, topKey, () => {
      const btn = (act: string, icon: string, on: boolean, label: string) =>
        `<button class="icon-btn${on ? ' on' : ''}" data-act="${act}" aria-label="${label}">${icon}</button>`;
      return `
        <div class="score"><span class="score-n"></span> <small>passengers</small></div>
        <div class="clock">
          <div class="day">${DAYS[day % 7]}<small>Week ${Math.floor(day / 7) + 1}</small></div>
          ${btn('speed:0', ICON.pause, s.speed === 0, 'Pause')}
          ${btn('speed:1', ICON.play, s.speed === 1, 'Play')}
          ${btn('speed:2', ICON.fast, s.speed === 2, 'Fast forward')}
          ${btn('night', ICON.moon, s.night, 'Night mode')}
          ${btn('mute', s.muted ? ICON.mute : ICON.sound, false, 'Sound')}
        </div>`;
    });
    const scoreEl = this.top.querySelector('.score-n')!;
    if (scoreEl.textContent !== String(w.score)) scoreEl.textContent = String(w.score);

    const inv = w.inv;
    const lineKey = w.lines.map((l) => (l ? 1 : 0)).join('');
    const barKey = [lineKey, inv.linesUnlocked, inv.locomotives, inv.carriages, inv.interchanges, w.crossingsFree, s.selectedLine, s.lineColors.join()].join('|');
    this.set(this.bar, barKey, () => {
      let sw = '';
      for (let i = 0; i < inv.linesUnlocked; i++) {
        const used = !!w.lines[i];
        const del = used && s.selectedLine === i ? `<button class="del" data-act="delete:${i}" aria-label="Delete line">✕</button>` : '';
        sw += `<button class="swatch${used ? ' used' : ''}" style="color:${s.lineColors[i]}" data-act="select:${i}" aria-label="Line ${i + 1}">${del}</button>`;
      }
      const item = (kind: ItemKind | 'tunnel', n: number, title: string) =>
        `<div class="item${n <= 0 ? ' empty' : ''}" ${kind !== 'tunnel' ? `data-item="${kind}"` : ''} title="${title}">${ITEM_SVG[kind]}${n}</div>`;
      return `<div class="swatches">${sw}</div><div class="items">
        ${item('loco', inv.locomotives, 'Locomotive: drag onto a line')}
        ${item('carriage', inv.carriages, 'Carriage: drag onto a train')}
        ${item('interchange', inv.interchanges, 'Interchange: drag onto a station')}
        ${item('tunnel', w.crossingsFree, 'Tunnels left (used automatically)')}
      </div>`;
    });

    let ovKey = 'none';
    if (!s.started) ovKey = 'start';
    else if (w.over) ovKey = `over:${w.score}`;
    else if (w.pendingUpgrade) ovKey = `up:${w.pendingUpgrade.join()}:${w.week}`;
    this.set(this.overlay, ovKey, () => {
      if (ovKey === 'start')
        return `<div class="overlay"><div class="card">
          <h1>Small Subway</h1>
          <p>Design a subway for a growing city. Keep every station moving.</p>
          <ul>
            <li>Drag from a station to another to draw a line.</li>
            <li>Drag a line's end bar to extend or shorten it; drag back to the start to make a loop.</li>
            <li>Drag the middle of a line over a station to add it, or over its own stop to remove it.</li>
            <li>Drag trains between lines; drop one off a line to store it.</li>
            <li>${COARSE ? 'Tap ⏸ to pause.' : 'Space pauses.'} You can edit while paused.</li>
          </ul>
          <button class="primary" data-act="start">Start</button>
        </div></div>`;
      if (w.over)
        return `<div class="overlay"><div class="card">
          <h2>Station overcrowded</h2>
          <p>${w.score} passengers delivered over ${Math.floor(w.over.day) + 1} days.</p>
          <button class="primary" data-act="start">Play again</button>
        </div></div>`;
      if (w.pendingUpgrade)
        return `<div class="overlay"><div class="card">
          <h2>Week ${w.week} complete</h2>
          <p>You received a locomotive. Choose one more:</p>
          <div class="choices">${w.pendingUpgrade
            .map((k) => `<button class="choice" data-act="upgrade:${k}">${ITEM_SVG[UPGRADE_LABEL[k][1]]}${UPGRADE_LABEL[k][0]}</button>`)
            .join('')}</div>
        </div></div>`;
      return '';
    });
  }
}
