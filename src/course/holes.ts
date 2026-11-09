import type { HoleDef } from "./parse.ts";

/**
 * The course. See parse.ts for what each character means; the top of the page is "north", away from the tee.
 * Every hole has a safe way round for par, and a risky shortcut that can be a hole in one: a golden hole (G)
 * or a jump. Miss the shortcut and you're probably in the water.
 */
export const HOLES: HoleDef[] = [
  {
    // Safe: left, between the pines, over the stream and up the wide lane. Risky: straight up the rail-less bridge
    // into the golden hole. The stream pushes the ball left; a slash fells the pines, a freeze stills the stream.
    name: "First Putt", par: 3, theme: "forest", flow: "w", shortcut: "Straight up the bridge",
    map: [
      "...  ",
      ".C. G",
      "... _",
      "Y.Y _",
      "~~~ _",
      "... _",
      "..Y..",
      "....T",
      "....."
    ]
  },
  {
    // Safe: up the lane and round the corner. Risky: jump the water onto the island and find the golden hole.
    name: "Dogleg", par: 3, theme: "autumn", flow: "e", shortcut: "Jump to the island",
    map: [
      "......",
      "..Y.C.",
      "......",
      "... _ ",
      "~~~ _ ",
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
      ".Y.  .",
      ".....T",
      "......"
    ]
  },
  {
    // Safe: anywhere through the bumpers. Risky: the golden hole in the far corner, off the edge if you're long.
    name: "Pinball", par: 3, theme: "arcade", flow: "w", shortcut: "The far corner",
    map: [
      "......G",
      "...C...",
      ".......",
      ".o.o.o.",
      ".......",
      "o..o..o",
      ".......",
      "~~~~~~~",
      "...T...",
      "......."
    ]
  },
  {
    // Safe: the open lane on the left. Risky: through the windmill and over its bridge to the golden hole.
    name: "Windmill", par: 3, theme: "tulips", flow: "w", windmillSpeed: 0.22, shortcut: "Through the windmill",
    map: [
      "..   ",
      ".C G ",
      ".. _ ",
      ".. _ ",
      "..#W#",
      ".....",
      "~~~~~",
      ".Y.T.",
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
      "Y...T",
      "....."
    ],
    sliders: [
      { from: [0, 3], to: [4, 3], period: 3.4 },
      { from: [0, 5], to: [2, 5], period: 2.6, phase: 0.35 }
    ]
  },
  {
    // Safe: round the wall. Risky: a full-strength bank off the right rail into the golden hole tucked in the corner.
    name: "Bank Shot", par: 3, theme: "ice", flow: "w", shortcut: "Bank it off the right rail",
    map: [
      "G....",
      " .C..",
      "~~~~~",
      "##...",
      "...Y.",
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
      "Y....",
      "....T",
      "..Y.."
    ]
  },
  {
    // Safe: up the ramp, past the block, down and through the windmill. Risky: the giant jump straight at the cup.
    name: "Grand Finale", par: 4, theme: "space", flow: "e", windmillSpeed: 0.18, shortcut: "The giant jump",
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
      "~~~~~~~",
      ".T..Y..",
      "......."
    ],
    sliders: [{ from: [4, 7], to: [6, 7], period: 3.6, phase: 0.2 }]
  }
];

export const COURSE_PAR = HOLES.reduce((t, h) => t + h.par, 0);
