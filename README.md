# Small Subway

An original browser game inspired by the subway-design genre: draw lines between stations, keep passengers moving, and survive as the city grows. Built in TypeScript with Canvas 2D and no runtime dependencies.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # headless simulation tests
npm run build    # static build in dist/ (any static host: Vercel, Netlify, GitHub Pages)
npm run build:single  # dist/small-subway.html, everything inlined in one file
```

On phones the game can be added to the home screen (web app manifest) and keeps working offline after the first visit (service worker, static hosts only).

## How to play

- Drag from one station to another to draw a line (each new line takes a locomotive if one is free).
- Drag a line's end bar to extend or shorten it. Drag it back to the line's first station to close a loop.
- Drag the middle of a segment over a station to insert it; drag it over one of that segment's own stops to remove the stop.
- Drag locomotives, carriages and interchanges from the bottom bar onto a line, a train or a station.
- Drag a train to another line, or drop it off the network to store it.
- Click a line swatch, then the ✕, to delete a line.
- Space pauses (editing works while paused). `1` / `2` set speed.
- The game ends when a station stays overcrowded for 45 s (plus a 2 s grace).

## Architecture

```
src/sim/      deterministic simulation, no DOM
  world.ts    clock, spawning, trains, overcrowding, upgrades, network edits
  router.ts   passenger routing (backward Dijkstra per destination shape)
  city.ts     map data (water polygons, city areas, schedules, tuning)
  geom.ts     octilinear routing, offsets, polygon tests
  rng.ts      seeded PRNG (mulberry32)
src/render/   Canvas renderer, glyphs, day/night palettes
src/ui/       line editor (gestures -> proposed stop lists) and DOM HUD
src/audio.ts  Web Audio tones quantised to a 72 BPM pulse
tests/        headless tests and a greedy bot used for difficulty curves
```

The simulation runs at a fixed 60 Hz step and every random choice goes through one seeded generator, so a seed plus the same actions replays exactly (tested).

### Routing

The network is a graph of platform nodes and "aboard line L at stop i, departing in direction d" nodes. One backward Dijkstra per destination shape gives a cost-to-go from every node. Passengers then decide locally: board a specific train (origin wait projected from real train positions), stay aboard, or alight to transfer (transfer wait = half the line headway + a 4 s penalty). Trains stop only when a rider wants to get off or a waiting passenger wants that train.

### Tuning status

Confirmed-from-source values: capacities (6 / 18 / 6 per car), trains per line (11 − max lines), the 45 s + 2 s overcrowd timer and its 2 s floor after upgrades, weekly locomotive plus a choice of two upgrades, 50 % replacement chance for wedge/star/cross specials, triangles never asking for squares.

Estimated and meant to be tuned by playtesting (all in `src/sim/city.ts`): train speed and acceleration, passenger spawn interval curve, demand weights, camera growth, station spacing. The greedy test bot currently loses around days 11 to 22; a thoughtful human should last several weeks.
