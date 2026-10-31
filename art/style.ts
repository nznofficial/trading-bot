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
  bastion: `UNIT-00 "Bastion", the core defense mech: a towering, broad fortress frame noticeably taller and heavier than the \
other units. Massive layered pauldrons that can fold forward and lock into a full-body tower shield, thick armored legs \
with deployable anchor spikes at the heels, a squared helmet with a single steady horizontal visor bar glowing sync green. \
Steel blue #38BDF8 and slate armor with amber #FFA41B accents over a gunmetal frame. Weapon: a heavy rotary cannon held \
low. Stencil "U-00" on the shoulder. Patient, immovable, guardian bearing.`,
  herald: `UNIT-03 "Herald", a recon and signals-intercept mech: a light, slender, long-legged frame, visibly leaner than the \
other units. Two tall telescoping antenna masts rising from the back of the shoulders (not from the forehead), a compact \
dorsal radome pack, round dish-shaped ear sensor pods on both sides of a rounded helmet, and one wide horizontal sensor visor \
glowing sync green. Slim forearm data-link pods with folding receiver fins. Signal amber #F5C542 armor with warm off-white \
#F2EEE3 panels over a gunmetal frame. Weapon: a long-range marksman rifle carried low. Stencil "U-03" on the shoulder. \
Alert, listening, quick-reaction scout bearing.`,
} as const;

export type CharacterId = keyof typeof CHARACTERS;
