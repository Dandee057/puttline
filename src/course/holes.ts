import type { HoleDef } from "./parse.ts";

/** The course. See parse.ts for what each character means; the top of the page is "north", away from the tee. */
export const HOLES: HoleDef[] = [
  {
    name: "First Putt", par: 2,
    map: [
      "...",
      ".C.",
      "...",
      "...",
      "...",
      "...",
      ".T.",
      "..."
    ]
  },
  {
    name: "Dogleg", par: 3,
    map: [
      ".....",
      "...C.",
      ".....",
      "...",
      "...",
      "...",
      ".T.",
      "..."
    ]
  },
  {
    name: "Step Up", par: 3,
    map: [
      ":::",
      ":c:",
      ":::",
      "^^^",
      "...",
      "...",
      ".T.",
      "..."
    ]
  },
  {
    name: "Pinball", par: 3,
    map: [
      ".....",
      "..C..",
      ".....",
      ".o.o.",
      ".....",
      "o...o",
      "..o..",
      ".....",
      "..T..",
      "....."
    ]
  },
  {
    name: "Windmill", par: 3, windmillSpeed: 0.22,
    map: [
      "...",
      ".C.",
      "...",
      "...",
      "#W#",
      "...",
      "...",
      ".T.",
      "..."
    ]
  },
  {
    name: "Rush Hour", par: 3,
    map: [
      "...",
      ".C.",
      "...",
      "...",
      "...",
      "...",
      "...",
      ".T.",
      "..."
    ],
    sliders: [
      { from: [0, 3], to: [2, 3], period: 3.2 },
      { from: [2, 5], to: [0, 5], period: 2.6, phase: 0.35 }
    ]
  },
  {
    name: "Bank Shot", par: 3,
    map: [
      ".......",
      ".C.....",
      ".......",
      "###....",
      ".......",
      ".......",
      ".T.....",
      "......."
    ]
  },
  {
    name: "The Bridge", par: 3,
    map: [
      "...",
      ".C.",
      "...",
      " _ ",
      " _ ",
      " _ ",
      "...",
      ".T.",
      "..."
    ]
  },
  {
    name: "Grand Finale", par: 4, windmillSpeed: 0.18,
    map: [
      ".C...",
      ".....",
      "##W##",
      ".....",
      "vvvvv",
      ":::::",
      ":::::",
      "^^^^^",
      ".....",
      "...T.",
      "....."
    ],
    sliders: [{ from: [0, 5], to: [4, 5], period: 4.5, phase: 0.2 }]
  }
];

export const COURSE_PAR = HOLES.reduce((t, h) => t + h.par, 0);
