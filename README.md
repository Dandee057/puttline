# Puttline

Nine holes of mini golf in your browser, with real ball physics and nine themed arenas, from a pine forest to a neon arcade, a volcano and outer space. Pick one of three golf balls, each with its own special power. Every hole has a safe way round and a risky shortcut that can be a hole in one, or land you in the water.

**[Play it →](https://dandee057.github.io/puttline/)**

Built with **Three.js**, the **Rapier** physics engine (WebAssembly) and **TypeScript**, with no game engine. Works with a mouse or on a phone.

<!-- Add a screenshot or GIF, e.g. docs/puttline.gif:
![Puttline](docs/puttline.gif) -->

## Playing

- **Pick your ball.** Three golf balls, each with its own look and one special power (E), usable once per hole:
  - ⚔️ **Ronin**, a lacquered samurai ball in a headband, **Slashes**: a big dash forward that cuts trees down for good and slices straight through blocks, bumpers, moving blocks and the windmill's blades.
  - ❄️ **Frostbite**, a crystal ball with an ice crown, **Freezes** the hole for six seconds: rivers stop and turn to fast ice, the windmill and moving blocks stand still, and the water or lava ices over so the ball can roll across it. Frost is the only power you can use before the putt. When the ice melts, a ball still out on it drops in.
  - 🧲 **Mag-9**, a chrome robot ball with a blinking aerial, switches on the cup's **Magnet** for a 1.5-second burst: a rolling ball inside the ring round the cup is pulled towards it. It doesn't brake the ball, so it rescues near misses, not bad putts, and switched on too early it runs out before the ball arrives.

  A ring round the ball counts down while a power is on. The powers fill each other's gaps: Ronin handles trees and things in the way, Frostbite handles rivers, water and timing, Mag-9 handles the finish. All three roll exactly the same, so every hole's proof still holds.
- **Trees and rivers:** every arena has its own kind of tree to roll round (pines, autumn oaks, cacti, topiary, neon trees, street lamps, burnt trees, crystals), and most holes have a river whose current gently nudges a rolling ball off line.
- **Putt:** drag anywhere and pull back like a slingshot. The further you pull, the harder the putt. Let go to hit.
- **Look around:** ⟲ ⟳ or A / D, right-drag, or two fingers. Scroll or pinch to zoom. ◎ or O shows the whole hole.
- **Rules:** a ball off the course costs a stroke and goes back where it was. After four over par the ball is picked up, so nobody gets stuck.
- **Scorecard:** your score against par as you go, with your best scores kept in the browser. At the end, *Copy my score* gives you a shareable line of coloured squares.
- **Shortcuts:** every hole has a high-risk, high-reward route. Sink the ball in a **golden hole** and it drops straight into the cup for a hole in one; clear a **jump** over the water and you can land right by the cup. Miss, and it's a penalty stroke. Holes in one get a ★ on the scorecard.
- **Power-ups, once per hole each:** 💨 **Toot** (T) gives a rolling ball a push along its way, with a puff of fart cloud. 🦘 **Jump** (J) pops a rolling ball into the air, over a block, a gap or the windmill's blades, or off the course if you misjudge it. ↺ **Redo** (R) takes your last shot again: the ball goes back, and the stroke and any penalty are taken off.
- **Pause:** ❚❚ (top left), Esc or P freezes everything and opens a menu: resume, restart the hole, see the scorecard, turn the sound off, or go back to the main menu to pick a different ball. Switching away from the tab pauses too.
- **Practice a hole:** add `?hole=5` to the address to start on hole 5.

## How it works

**Holes are text maps.** Each hole is a few lines of characters: `.` is green, `:` is a raised level, `^ v < >` are ramps, `o` a bumper, `#` a block, `Y` a tree, `~` a river (flowing the hole's `flow` way), `_` a bridge, `W` the windmill, `G` a golden hole, `T` and `C` the tee and cup. A ramp that runs out over the water is a jump. Moving blocks are listed beside the map. Here is the windmill hole:

```
...
.C.
...
...
#W#
...
...
.T.
...
```

[`src/course/build.ts`](src/course/build.ts) turns a map into geometry: the green's triangles, steps between levels, the sides of ramps, rails around open edges (lengthened to close outside corners), blocks and the windmill building. **The same triangles are drawn and used as the physics collider**, so what you see is exactly what the ball rolls on.

**Nine arenas.** Each hole has a theme ([`src/render/themes.ts`](src/render/themes.ts)): sky, light, colours, scenery round the course and particles in the air (pollen, falling leaves, desert dust, neon squares, tulip petals, city rain, snow, lava embers, stars). A bloom pass makes anything emissive glow: neon trim along every rail, the cup's beacon, the golden hole, bumpers, lava and city windows. If the frame rate drops, the game turns bloom off and lowers the resolution by itself.

**A real cup.** The cup is a round hole cut into the green, with a wall and a bottom. A ball going the right speed drops in; a fast one skips over the hole or hops off the far rim, the way it would on a real green. A ball that stops on the lip and then tips in still counts.

**Ball physics.** Rapier simulates the ball at a fixed 120 steps a second, rolling with friction and spin. On top of that ([`src/game/physics.ts`](src/game/physics.ts)):

- a steady **rolling resistance** slows the ball, as grass does;
- a putt starts the ball **rolling, not skidding**;
- after hitting a rail the ball leaves **rolling in its new direction**, so bank shots keep their pace (otherwise the spin it arrived with brakes it hard);
- over flat green the ball can only **hop a little**, so clipping the cup's rim at speed can't throw it over the rails;
- bumpers kick the ball away; the windmill blades and moving blocks are kinematic bodies on a timer.

**Every hole is proven playable, both ways.** [`src/game/solver.ts`](src/game/solver.ts) does two searches per hole:

- **The safe way round, within par**, without the golden hole: a small beam search that tries a spread of shots (direction, strength, and how long to wait for the windmill or moving blocks), keeps the ones that end closest to the cup by *walking* distance (round walls, up ramps), and searches on until the ball drops.
- **A hole in one by the risky route**: thousands of single shots from the tee, half of them aimed roughly at the shortcut, until one goes through the golden hole (or, on the jump holes, lands and drops).

`npm run check-holes` runs both and saves the winning shots. The tests replay them in Node, using the same physics as the browser, and fail if a change makes either route impossible. A test also checks there are no dead ends: every square, including the far side of every jump, has a way back to the cup.

**Small first download.** The physics engine is most of the download, so it's loaded in its own chunk while the title screen shows. The title needs about 160 KB.

**Three balls, one physics.** The balls ([`src/game/balls.ts`](src/game/balls.ts)) differ only in looks and power. Their skins are painted on canvases at load time, with no image files ([`src/render/balls.ts`](src/render/balls.ts)), and each wears a "topper" (headband and ribbons, ice crown, aerial and visor) that stays upright and faces the way the ball rolls. The powers live in the simulation, so they're tested like everything else:

- **Slash** gives the ball a dash and switches its Rapier collision groups so it passes through obstacles (but never the rails), finding what it cut with a shape query each step; a tree it cuts has its collider removed for the rest of the hole;
- **Freeze** stops the clock that drives the windmill and moving blocks, switches off river currents and makes rivers slippery, and adds a temporary sheet of ice as a collider over the water;
- **Magnet** pulls a ball near the cup towards it and gently damps its sideways drift, for 1.5 seconds.

A **river** pushes a rolling ball the way it flows, more gently than the grass slows it, so the ball always comes to rest.

**Sound without files.** Putts, rail knocks, bumpers, the cup's rattle and the splash are synthesised with the Web Audio API ([`src/audio.ts`](src/audio.ts)).

**Also a console cartridge.** The same game plays on the handheld consoles on [dandeegames.com](https://dandeegames.com/) and on an arcade cabinet in [Three Lab](https://github.com/dandee057/dandee-three-lab), with a d-pad and two buttons instead of the mouse: ◀ ▶ pick a ball on the title, then ◀ ▶ aim, ▲ ▼ power, A putt, B overview, and while the ball rolls A jump, B toot, ▲ or ▼ the ball's power, START redo. [`src/cartridge.ts`](src/cartridge.ts) speaks those sites' small cartridge API (`update`, `drawScreen`, `hold`, `press`…), renders the scene off-screen at the console screen's exact size and draws the HUD on top. `npm run build:cartridge` builds it as one script, with three.js and Rapier inside, plus [`cartridge/puttline.js`](cartridge/puttline.js), a 4 kB loader the sites include, which only fetches the game when the cartridge goes in.

## Running it

```bash
npm install
npm run dev           # http://localhost:5173
npm test              # unit tests, physics included (Node's built-in test runner)
npm run check-holes   # after changing a hole: find a way round it, save it for the tests
npm run build         # type-checks, then builds to dist/
npm run build:cartridge  # the console cartridge, to dist-cartridge/ (copy it to games/puttline/)
```

**Adding a hole:** add a map to [`src/course/holes.ts`](src/course/holes.ts), run `npm run check-holes`, and open it with `?hole=10`.

**Deploying:** in the repository, go to *Settings → Pages* and set *Source* to **GitHub Actions**. Every push to `main` then tests, builds and deploys through [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

## Project structure

```
src/
  main.ts              the game: holes, strokes, aiming, camera, screens
  cartridge.ts         the same game as a console cartridge: d-pad controls, HUD drawn on a 2D canvas
  course/parse.ts      reading a hole's text map
  course/build.ts      map → green, cup, steps, rails, blocks, windmill
  course/holes.ts      the nine holes
  game/physics.ts      the ball and everything it hits (Rapier), and the balls' powers
  game/balls.ts        the three balls: name, power, colours
  game/rules.ts        score names, stroke limit, totals
  game/route.ts        walking distance to the cup, and which way to face (camera, hole checker)
  game/solver.ts       the search that proves each hole can be finished
  render/stage.ts      renderer, bloom, sky, water or lava, particles, camera rig
  render/world.ts      a hole drawn in Three.js: ball, waving flag, golden hole, neon trim, windmill, trail, confetti
  render/themes.ts     the nine arenas: sky, light, colours, scenery, particles
  render/balls.ts      the balls' painted skins, toppers and title-screen pictures
  audio.ts             synthesised sound effects
cartridge/puttline.js  the cartridge loader, and its cover
scripts/check-holes.ts finds and saves a way round every hole
tests/                 course building, physics, rules, the balls' powers, and a replay of every hole
```

## Licence

MIT. See [LICENSE](LICENSE).
