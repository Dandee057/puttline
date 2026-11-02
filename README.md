# Puttline

Nine holes of mini golf in your browser, with real ball physics and nine themed arenas, from a sunny meadow to a neon arcade, a volcano and outer space. Every hole has a safe way round and a risky shortcut that can be a hole in one, or land you in the water.

**[Play it →](https://dandee057.github.io/puttline/)**

Built with **Three.js**, the **Rapier** physics engine (WebAssembly) and **TypeScript**, with no game engine. Works with a mouse or on a phone.

<!-- Add a screenshot or GIF, e.g. docs/puttline.gif:
![Puttline](docs/puttline.gif) -->

## Playing

- **Putt:** drag anywhere and pull back like a slingshot. The further you pull, the harder the putt. Let go to hit.
- **Look around:** ⟲ ⟳ or A / D, right-drag, or two fingers. Scroll or pinch to zoom. ◎ or O shows the whole hole.
- **Rules:** a ball off the course costs a stroke and goes back where it was. After four over par the ball is picked up, so nobody gets stuck.
- **Scorecard:** your score against par as you go, with your best scores kept in the browser. At the end, *Copy my score* gives you a shareable line of coloured squares.
- **Shortcuts:** every hole has a high-risk, high-reward route. Sink the ball in a **golden hole** and it drops straight into the cup for a hole in one; clear a **jump** over the water and you can land right by the cup. Miss, and it's a penalty stroke. Holes in one get a ★ on the scorecard.
- **Practice a hole:** add `?hole=5` to the address to start on hole 5.

## How it works

**Holes are text maps.** Each hole is a few lines of characters: `.` is green, `:` is a raised level, `^ v < >` are ramps, `o` a bumper, `#` a block, `_` a bridge, `W` the windmill, `G` a golden hole, `T` and `C` the tee and cup. A ramp that runs out over the water is a jump. Moving blocks are listed beside the map. Here is the windmill hole:

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

**Sound without files.** Putts, rail knocks, bumpers, the cup's rattle and the splash are synthesised with the Web Audio API ([`src/audio.ts`](src/audio.ts)).

## Running it

```bash
npm install
npm run dev           # http://localhost:5173
npm test              # unit tests, physics included (Node's built-in test runner)
npm run check-holes   # after changing a hole: find a way round it, save it for the tests
npm run build         # type-checks, then builds to dist/
```

**Adding a hole:** add a map to [`src/course/holes.ts`](src/course/holes.ts), run `npm run check-holes`, and open it with `?hole=10`.

**Deploying:** in the repository, go to *Settings → Pages* and set *Source* to **GitHub Actions**. Every push to `main` then tests, builds and deploys through [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

## Project structure

```
src/
  main.ts              the game: holes, strokes, aiming, camera, screens
  course/parse.ts      reading a hole's text map
  course/build.ts      map → green, cup, steps, rails, blocks, windmill
  course/holes.ts      the nine holes
  game/physics.ts      the ball and everything it hits (Rapier)
  game/rules.ts        score names, stroke limit, totals
  game/route.ts        walking distance to the cup (camera direction, hole checker)
  game/solver.ts       the search that proves each hole can be finished
  render/stage.ts      renderer, bloom, sky, water or lava, particles, camera rig
  render/world.ts      a hole drawn in Three.js: ball, waving flag, golden hole, neon trim, windmill, trail, confetti
  render/themes.ts     the nine arenas: sky, light, colours, scenery, particles
  audio.ts             synthesised sound effects
scripts/check-holes.ts finds and saves a way round every hole
tests/                 course building, physics, rules, and a replay of every hole
```

## Licence

MIT. See [LICENSE](LICENSE).
