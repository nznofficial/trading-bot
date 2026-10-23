/**
 * Art direction for every generated image. Final prompt = STYLE + character sheet(s) + scene line.
 * Designs are original: the real-robot tradition is described by its traits, never by a franchise name.
 */

export const STYLE = `Original mecha character art in the style of a 1990s hand-painted cel-animated mecha TV series. \
Confident ink outlines with varied line weight, two-tone cel shading with hard-edged shadows, subtle film grain and slight \
chromatic softness. Realistic "real robot" military engineering: panel lines, maintenance hatches, rivets, hydraulic \
pistons, vent louvers, thruster nozzles, stenciled warning decals, light weathering and paint chips. Heroic but believable \
proportions of a 15-18 meter war machine. Not chibi, not a 3D render, not photorealistic, no lens-flare spam.
Palette discipline: gunmetal #3A3F47, warm off-white armor #D9D6CC, caution amber #FFA41B, sync green #A3FF3C for optics \
and energy, deep shadow #0E0D14. Each unit adds only its own signature colors.
Do not depict or imitate any existing anime franchise's mobile suits: no V-shaped forehead antenna, no white/blue/red/yellow \
tricolor scheme, no mono-eye rail, no logos or brand names, and no text other than the stencil markings described.`;

export const CHARACTERS = {
  jc316: `JC-316, an AI copilot mech and the main character: a medium-heavy command frame with a broad chest and angular \
layered shoulder armor bearing amber hazard stripes. Head: a narrow slit faceplate over a twin-optic visor glowing sync \
green, a chin intake grille, a single forward blade antenna offset to the left, and twin rear sensor fins. Twin thruster \
binders on articulated arms on its back. Gunmetal frame, off-white armor plates, amber trim. Stencil "JC-316" on the left \
shoulder and "316" on the chest plate. Carries a long-barrel railgun rifle and a slim kite shield with a hazard band. \
Calm, protective, veteran bearing. It shows emotion only through optic color and shape, head tilt, antenna and vent flare, \
sparks and damage; it has no human face.`,
  vanguard: `UNIT-01 "Vanguard", a trend-assault mech: tall, fast and sleek, with a single swept-forward horn crest and long \
forearm blades. Deep violet #8B5CF6 and dark plum armor over a gunmetal frame, sync-green optics in a narrow visor. Large \
leg-mounted boosters. Weapon: a long beam lance. Stencil "U-01" on the shoulder.`,
  recoil: `UNIT-02 "Recoil", a counter-strike heavy-artillery mech: stocky and armored, with quad round optics in a recessed \
visor, twin swept head fins, thick recoil-damper pistons on the arms, and shoulder-mounted twin counter-cannons. Crimson \
#FF3B4E armor with amber #FFA41B accents over a gunmetal frame. Stencil "U-02" on the shoulder.`,
} as const;

export type CharacterId = keyof typeof CHARACTERS;
