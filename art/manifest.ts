import type { CharacterId } from "./style";

export type Asset = {
  id: string;
  /** A = anchor model sheets (generate); B/C/D = everything else (edit with the anchors as references). */
  phase: "A" | "B" | "C" | "D";
  size: `${number}x${number}`;
  /** Request a transparent background (falls back to opaque #0E0D14 if the model rejects it). */
  transparent?: boolean;
  /** Characters described in the prompt; their approved anchor sheets are passed as references. */
  characters: CharacterId[];
  scene: string;
  /** Where it's used in the app (documentation only). */
  usedIn: string;
};

const SHEET = (who: string) =>
  `Character model turnaround sheet of ${who}: four views side by side (front, three-quarter, side, back) in a neutral \
standing pose, evenly spaced on warm gray paper with thin ink callout lines and small blank label boxes. Flat even studio \
lighting so armor colors read accurately. Full body visible in every view, nothing cropped.`;

const BUST = (state: string) =>
  `Head-and-shoulders portrait of JC-316 in three-quarter view facing left, consistent framing: chin at lower third, shoulder \
armor visible, generous space above the antenna. Isolated character, no background scenery. ${state}`;

export const ASSETS: Asset[] = [
  // ---- Phase A: anchors -----------------------------------------------------------------
  { id: "jc316-sheet", phase: "A", size: "1536x1024", characters: ["jc316"], scene: SHEET("JC-316"), usedIn: "anchor" },
  { id: "vanguard-sheet", phase: "A", size: "1536x1024", characters: ["vanguard"], scene: SHEET("UNIT-01 Vanguard"), usedIn: "anchor" },
  { id: "recoil-sheet", phase: "A", size: "1536x1024", characters: ["recoil"], scene: SHEET("UNIT-02 Recoil"), usedIn: "anchor" },
  { id: "bastion-sheet", phase: "A", size: "1536x1024", characters: ["bastion"], scene: SHEET("UNIT-00 Bastion"), usedIn: "anchor" },

  // ---- Phase B: characters ------------------------------------------------------------------
  {
    id: "jc316-keyart",
    phase: "B",
    size: "1024x1536",
    characters: ["jc316"],
    scene: `Heroic full-body key art of JC-316 from a low angle, railgun rifle lowered, shield on the left arm, standing in a \
hazy hangar lit by warm amber work lights with cool blue rim light, faint steam at its feet.`,
    usedIn: "Bridge hero",
  },
  ...(
    [
      ["standby", "Optics dimmed to a soft amber, head lowered slightly, light frost on the armor edges, systems idling."],
      ["active", "Optics bright sync green and sharp, head level, a faint scan line across the visor, alert and ready."],
      ["alert", "Optics narrowed and glowing amber, head snapped toward the viewer, small warning lamps lit on the collar."],
      ["victory", "Optics flaring bright green, head raised proudly, shoulder vents venting white steam."],
      ["damaged", "Cracked visor, one optic flickering red, sparks from the neck joint, scorch marks and dented shoulder armor."],
      ["thinking", "Optics cycling soft cyan, head tilted slightly, faint thin HUD rings orbiting near the head."],
      ["launch", "Optics blazing green, thrusters glowing behind the shoulders, launch harness clamps releasing beside it."],
      ["greeting", "Right hand raised to the side of the head in a crisp salute, optics warm green, relaxed confident posture."],
    ] as const
  ).map(
    ([state, desc]): Asset => ({
      id: `jc316-bust-${state}`,
      phase: "B",
      size: "1024x1024",
      transparent: true,
      characters: ["jc316"],
      scene: BUST(desc),
      usedIn: `copilot companion (${state})`,
    }),
  ),
  {
    id: "vanguard-keyart",
    phase: "B",
    size: "1024x1536",
    characters: ["vanguard"],
    scene: `Dynamic full-body key art of Vanguard dashing forward, beam lance thrust ahead, leg boosters firing violet-white \
exhaust, speed lines, hangar haze behind.`,
    usedIn: "Hangar",
  },
  {
    id: "vanguard-bust",
    phase: "B",
    size: "1024x1024",
    transparent: true,
    characters: ["vanguard"],
    scene: `Head-and-shoulders portrait of Vanguard in three-quarter view facing right, horn crest prominent, green optics \
sharp. Isolated character, no background scenery.`,
    usedIn: "Hangar unit card",
  },
  {
    id: "recoil-keyart",
    phase: "B",
    size: "1024x1536",
    characters: ["recoil"],
    scene: `Full-body key art of Recoil braced low in a firing stance, twin shoulder counter-cannons recoiling with muzzle \
flash, arm dampers compressed, dust kicked up, hangar haze behind.`,
    usedIn: "Hangar",
  },
  {
    id: "recoil-bust",
    phase: "B",
    size: "1024x1024",
    transparent: true,
    characters: ["recoil"],
    scene: `Head-and-shoulders portrait of Recoil in three-quarter view facing right, quad optics glowing amber-green, head \
fins swept back. Isolated character, no background scenery.`,
    usedIn: "Hangar unit card",
  },
  {
    id: "bastion-keyart",
    phase: "B",
    size: "1024x1536",
    characters: ["bastion"],
    scene: `Full-body key art of Bastion planted in a defensive stance at the hangar mouth, shoulder shields folded forward \
into a tower shield, heel anchor spikes driven into the deck, rotary cannon held low, steady green visor bar, cool blue rim \
light and drifting haze behind.`,
    usedIn: "Hangar, briefing panel",
  },
  {
    id: "bastion-bust",
    phase: "B",
    size: "1024x1024",
    transparent: true,
    characters: ["bastion"],
    scene: `Head-and-shoulders portrait of Bastion in three-quarter view facing right, squared helmet and single green visor \
bar, massive shoulder armor framing the head. Isolated character, no background scenery.`,
    usedIn: "Hangar unit card",
  },

  // ---- Phase C: scenes ----------------------------------------------------------------------
  {
    id: "scene-hangar",
    phase: "C",
    size: "1920x1088",
    characters: ["jc316", "vanguard", "recoil"],
    scene: `Wide painted background of a mech hangar bay: JC-316 standing in the center maintenance gantry, Vanguard in the \
left gantry and Recoil in the right, overhead crane rails, welding sparks, amber hazard stripes on the floor, warm sodium \
lights and cool haze. Leave the lower third darker and calmer so UI can sit on top.`,
    usedIn: "Hangar backdrop",
  },
  {
    id: "scene-bridge",
    phase: "C",
    size: "1920x1088",
    characters: ["jc316"],
    scene: `Wide painted background of a command deck: a curved tactical window, consoles with glowing abstract charts and \
graphs (no readable text or numbers), a holo-table in the foreground, and JC-316 visible standing outside beyond the glass. \
Moody blue and amber lighting. Leave the center darker so UI can sit on top.`,
    usedIn: "Bridge backdrop",
  },
  {
    id: "scene-simdeck",
    phase: "C",
    size: "1920x1088",
    characters: ["jc316"],
    scene: `Wide painted background of a simulation chamber: glowing green wireframe grid floor and walls, JC-316 standing in \
a training harness in the middle distance, translucent wireframe target silhouettes. Leave the edges dark.`,
    usedIn: "Simulator header",
  },
  {
    id: "scene-launch",
    phase: "C",
    size: "1920x1088",
    characters: ["jc316"],
    scene: `Dramatic linear catapult launch tunnel in one-point perspective: JC-316 crouched on the catapult sled in launch \
pose, guide rails glowing amber, deck crew silhouettes with signal wands, steam venting, light at the end of the tunnel.`,
    usedIn: "Launch intro",
  },

  // ---- Phase D: events & empty states ---------------------------------------------------------
  {
    id: "event-victory",
    phase: "D",
    size: "1536x1024",
    characters: ["jc316", "vanguard", "recoil"],
    scene: `JC-316 in the center flanked by Vanguard and Recoil, silhouetted against a dawn horizon with smoke trails and \
drifting embers, triumphant and calm.`,
    usedIn: "Target neutralized banner",
  },
  {
    id: "event-damage",
    phase: "D",
    size: "1536x1024",
    characters: ["jc316"],
    scene: `JC-316 kneeling on one knee in the rain, shield dented, red emergency lights, sparks from damaged armor, still \
resolute.`,
    usedIn: "Red-day banner",
  },
  {
    id: "empty-nocontact",
    phase: "D",
    size: "1024x1024",
    characters: [],
    scene: `Painted illustration of a quiet, empty mech hangar bay at night with a rotating radar dish sweeping a faint green \
arc, amber floor stripes, no mechs present.`,
    usedIn: "Empty state: no contact",
  },
  {
    id: "empty-cold",
    phase: "D",
    size: "1024x1024",
    characters: ["jc316"],
    scene: `JC-316 powered down in its gantry, partly covered by a maintenance tarp, optics dark, light frost, quiet blue \
night lighting.`,
    usedIn: "Empty state: systems cold",
  },
  {
    id: "empty-awaiting",
    phase: "D",
    size: "1024x1024",
    characters: ["jc316"],
    scene: `Silhouette of JC-316 seen from behind, facing a large terminal wall streaming abstract green data (no readable \
text), waiting.`,
    usedIn: "Empty state: awaiting data",
  },
];
