import type { HoleDef } from "./parse.ts";

/**
 * The course. See parse.ts for what each character means; the top of the page is "north", away from the tee.
 * Every hole has a safe way round for par, and a risky shortcut that can be a hole in one: a golden hole (G)
 * or a jump. Miss the shortcut and you're probably in the water.
 */
export const HOLES: HoleDef[] = [
  {
    // Safe: left and up the wide lane. Risky: straight up the rail-less bridge into the golden hole.
    name: "First Putt", par: 3, theme: "meadow", shortcut: "Straight up the bridge",
    map: [
      "...  ",
      ".C. G",
      "... _",
      "... _",
      "... _",
      "... _",
      ".....",
      "....T",
      "....."
    ]
  },
  {
    // Safe: up the lane and round the corner. Risky: jump the water onto the island and find the golden hole.
    name: "Dogleg", par: 3, theme: "autumn", shortcut: "Jump to the island",
    map: [
      "......",
      "....C.",
      "......",
      "... _ ",
      "... _ ",
      "... ..",
      "T.> .G",
      "... .."
    ]
  },
  {
    // Safe: up the wide ramp to the mesa. Risky: up the narrow spur to the golden hole on its pillar; too hard and it's gone.
    name: "Step Up", par: 3, theme: "desert", shortcut: "The pillar",
    map: [
      ":::  g",
      ":c:  ^",
      ":::  .",
      "^^^  .",
      "...  .",
      "...  .",
      ".....T",
      "......"
    ]
  },
  {
    // Safe: anywhere through the bumpers. Risky: the golden hole in the far corner, off the edge if you're long.
    name: "Pinball", par: 3, theme: "arcade", shortcut: "The far corner",
    map: [
      "......G",
      "...C...",
      ".......",
      ".o.o.o.",
      ".......",
      "o..o..o",
      ".......",
      ".......",
      "...T...",
      "......."
    ]
  },
  {
    // Safe: the open lane on the left. Risky: through the windmill and over its bridge to the golden hole.
    name: "Windmill", par: 3, theme: "tulips", windmillSpeed: 0.22, shortcut: "Through the windmill",
    map: [
      "..   ",
      ".C G ",
      ".. _ ",
      ".. _ ",
      "..#W#",
      ".....",
      ".....",
      "...T.",
      "....."
    ]
  },
  {
    // Safe: the main road on the left. Risky: the express lane, crossed by a block that pushes you into the water.
    name: "Rush Hour", par: 3, theme: "city", shortcut: "The express lane",
    map: [
      "... G",
      ".C. _",
      "... _",
      ".....",
      "... _",
      "... _",
      "... _",
      "....T",
      "....."
    ],
    sliders: [
      { from: [0, 3], to: [4, 3], period: 3.4 },
      { from: [0, 5], to: [2, 5], period: 2.6, phase: 0.35 }
    ]
  },
  {
    // Safe: round the wall. Risky: a full-strength bank off the right rail into the golden hole tucked in the corner.
    name: "Bank Shot", par: 3, theme: "ice", shortcut: "Bank it off the right rail",
    map: [
      "G....",
      " .C..",
      ".....",
      "##...",
      ".....",
      ".T...",
      "....."
    ]
  },
  {
    // Safe: the narrow bridge over the lava. Risky: the big jump to the golden hole on the far island.
    name: "The Bridge", par: 3, theme: "volcano", shortcut: "Jump the lava",
    map: [
      "...  ",
      ".C. G",
      ".....",
      " _   ",
      " _   ",
      " _  ^",
      ".....",
      "....T",
      "....."
    ]
  },
  {
    // Safe: up the ramp, past the block, down and through the windmill. Risky: the giant jump straight at the cup.
    name: "Grand Finale", par: 4, theme: "space", windmillSpeed: 0.18, shortcut: "The giant jump",
    map: [
      ".......",
      ".C.....",
      ".......",
      "    #W#",
      "    ...",
      "^^^ vvv",
      "... :::",
      "... :::",
      "... ^^^",
      ".......",
      ".T.....",
      "......."
    ],
    sliders: [{ from: [4, 7], to: [6, 7], period: 3.6, phase: 0.2 }]
  }
];

export const COURSE_PAR = HOLES.reduce((t, h) => t + h.par, 0);
