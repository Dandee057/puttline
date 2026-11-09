/**
 * The three balls you can play as. They roll exactly the same (so every hole's proof still holds); each has a look
 * and one special power, usable once per hole on top of Toot, Jump and Redo. The powers cover each other's gaps:
 * the samurai deals with things in the way, the frost ball with water and timing, the mecha ball with the finish.
 */

export type BallPower = "slash" | "freeze" | "magnet";

export interface BallDef {
  id: "samurai" | "frost" | "mecha";
  name: string;
  /** One line under the name on the title screen. */
  tagline: string;
  power: BallPower;
  powerName: string;
  /** What the power does, for the title screen and the button's tooltip. */
  powerText: string;
  icon: string;
  /** Keyboard key for the power. */
  key: string;
  /** Can it be used before the putt, as well as while the ball rolls? */
  whileAiming: boolean;
  /** Colours: the ball's main and accent colour, and the trail behind it. */
  colours: { main: string; accent: string; trail: string };
}

export const BALLS: BallDef[] = [
  {
    id: "samurai", name: "Ronin", tagline: "A lacquered samurai ball with a gold crest",
    power: "slash", powerName: "Slash", icon: "⚔️", key: "E", whileAiming: false,
    powerText: "Draws its blade: a dash that cuts straight through blocks, bumpers, moving blocks and the windmill",
    colours: { main: "#b3122a", accent: "#ffc83d", trail: "#ff4d5e" }
  },
  {
    id: "frost", name: "Frostbite", tagline: "A crystal ball with a frozen heart",
    power: "freeze", powerName: "Freeze", icon: "❄️", key: "E", whileAiming: true,
    powerText: "Stops the windmill and moving blocks, and ices over the water or lava so the ball can roll across it. Works before a putt",
    colours: { main: "#bfe9ff", accent: "#5fd3ff", trail: "#8fe3ff" }
  },
  {
    id: "mecha", name: "Mag-9", tagline: "A chrome robot ball with a homing chip",
    power: "magnet", powerName: "Magnet", icon: "🧲", key: "E", whileAiming: false,
    powerText: "Switches on the cup's magnet: a nearby rolling ball is pulled in and steered onto the cup",
    colours: { main: "#c9d2dc", accent: "#3ff2ff", trail: "#3ff2ff" }
  }
];

export const ballById = (id: string | null | undefined): BallDef => BALLS.find((b) => b.id === id) ?? BALLS[0];
