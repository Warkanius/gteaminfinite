/**
 * Team & Run templates for autofilling opponent rosters.
 * Each slot defines an archetype, optional secondary + blend ratio, and star range.
 */

export interface TemplateSlot {
  archetype: string;
  secondaryArchetype?: string;
  blendRatio?: number;
  modifiers?: string[];
  starRange: [number, number]; // [min, max] inclusive
}

export interface TeamTemplate {
  name: string;
  description: string;
  slots: TemplateSlot[]; // 5 for domination teams
}

export interface RunTemplate {
  name: string;
  description: string;
  slots: TemplateSlot[]; // 3 for runs
}

// ── Name Generator ───────────────────────────────────────

const FIRST_NAMES = [
  "Marcus", "Jaylen", "DeShawn", "Tyler", "Isaiah", "Malik", "Andre", "Darius",
  "Jamal", "Cameron", "Terrence", "Kendrick", "Xavier", "Dominic", "Aaron",
  "Brandon", "Caleb", "Devon", "Elijah", "Franklin", "Garrett", "Hassan",
  "Ivan", "Jalen", "Kobe", "Lamar", "Miles", "Nate", "Omar", "Preston",
  "Quincy", "Rashad", "Shawn", "Trey", "Victor", "Wesley", "Zion", "Aiden",
  "Blake", "Chris", "Dante", "Eric", "Felix", "Grant", "Hector", "Jace",
];

const LAST_NAMES = [
  "Williams", "Johnson", "Thompson", "Davis", "Jackson", "Robinson", "Carter",
  "Mitchell", "Anderson", "Thomas", "Harris", "Walker", "Allen", "Young",
  "King", "Wright", "Scott", "Green", "Baker", "Adams", "Nelson", "Hill",
  "Moore", "Clark", "Lewis", "Lee", "Parker", "Turner", "Evans", "Collins",
  "Stewart", "Morris", "Rogers", "Reed", "Cook", "Bell", "Murphy", "Bailey",
  "Rivera", "Cooper", "Richardson", "Cox", "Howard", "Ward", "Torres", "Gray",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateRandomName(): string {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

// ── 15 Team Templates (5 players each) ──────────────────

export const TEAM_TEMPLATES: TeamTemplate[] = [
  {
    name: "Streetball Legends",
    description: "Flashy guards with handles and flair",
    slots: [
      { archetype: "Streetballer", modifiers: ["athletic"], starRange: [3, 4] },
      { archetype: "Ankle Breaker", starRange: [3, 4] },
      { archetype: "Showtime", modifiers: ["athletic"], starRange: [3, 4] },
      { archetype: "Sniper Elite", starRange: [2, 3] },
      { archetype: "Finesse Scorer", starRange: [3, 4] },
    ],
  },
  {
    name: "Twin Towers",
    description: "Two dominant bigs with supporting guards",
    slots: [
      { archetype: "Tower", modifiers: ["athletic"], starRange: [4, 5] },
      { archetype: "Enforcer", starRange: [4, 5] },
      { archetype: "Stretch Big", starRange: [3, 4] },
      { archetype: "Floor General", starRange: [3, 3] },
      { archetype: "Combo Guard", starRange: [3, 3] },
    ],
  },
  {
    name: "Splash Zone",
    description: "Long-range bombardment from every position",
    slots: [
      { archetype: "Sharpshooter", modifiers: ["elite shooter"], starRange: [3, 4] },
      { archetype: "Sniper Elite", starRange: [3, 4] },
      { archetype: "Stretch Big", starRange: [3, 4] },
      { archetype: "Two-Way", starRange: [3, 4] },
      { archetype: "Combo Guard", modifiers: ["elite shooting"], starRange: [3, 4] },
    ],
  },
  {
    name: "Lockdown Unit",
    description: "Suffocating defense at every position",
    slots: [
      { archetype: "Lockdown Defender", modifiers: ["elite defense"], starRange: [3, 4] },
      { archetype: "Hustle Player", starRange: [3, 4] },
      { archetype: "Two-Way", starRange: [3, 4] },
      { archetype: "Rim Protector", modifiers: ["athletic"], starRange: [3, 4] },
      { archetype: "Floor General", modifiers: ["elite defense"], starRange: [3, 4] },
    ],
  },
  {
    name: "Fast Break Frenzy",
    description: "All-out pace and transition scoring",
    slots: [
      { archetype: "Speedster", modifiers: ["athletic"], starRange: [3, 4] },
      { archetype: "Showtime", starRange: [3, 4] },
      { archetype: "Slasher", modifiers: ["athletic"], starRange: [3, 4] },
      { archetype: "Streetballer", starRange: [2, 3] },
      { archetype: "Hustle Player", starRange: [2, 3] },
    ],
  },
  {
    name: "Old School Bruisers",
    description: "Physical, paint-dominant, grind-it-out",
    slots: [
      { archetype: "Paint Beast", modifiers: ["athletic"], starRange: [3, 5] },
      { archetype: "Enforcer", starRange: [3, 4] },
      { archetype: "Post Scorer", modifiers: ["high iq"], starRange: [3, 4] },
      { archetype: "Brick Wall", starRange: [3, 4] },
      { archetype: "Glass Cleaner", starRange: [3, 4] },
    ],
  },
  {
    name: "Balanced Squad",
    description: "A well-rounded team with no weaknesses",
    slots: [
      { archetype: "Floor General", modifiers: ["balanced"], starRange: [3, 4] },
      { archetype: "Two-Way", starRange: [3, 4] },
      { archetype: "Inside-Out", starRange: [3, 4] },
      { archetype: "Point Forward", starRange: [3, 4] },
      { archetype: "Stretch Big", starRange: [3, 4] },
    ],
  },
  {
    name: "Microwave Bench Mob",
    description: "Instant offense spark plugs",
    slots: [
      { archetype: "Microwave", modifiers: ["athletic"], starRange: [3, 4] },
      { archetype: "Clutch Scorer", starRange: [3, 4] },
      { archetype: "Ankle Breaker", starRange: [2, 3] },
      { archetype: "Sniper Elite", starRange: [2, 3] },
      { archetype: "Finesse Scorer", starRange: [3, 4] },
    ],
  },
  {
    name: "Unicorn Factory",
    description: "Oversized players who handle and shoot",
    slots: [
      { archetype: "Point Forward", modifiers: ["elite shooting"], starRange: [4, 5] },
      { archetype: "Stretch Big", modifiers: ["athletic"], starRange: [3, 4] },
      { archetype: "Inside-Out", secondaryArchetype: "Playmaker", blendRatio: 0.3, starRange: [3, 4] },
      { archetype: "Two-Way", secondaryArchetype: "Stretch Big", blendRatio: 0.4, starRange: [3, 4] },
      { archetype: "Tower", secondaryArchetype: "Sharpshooter", blendRatio: 0.25, starRange: [3, 4] },
    ],
  },
  {
    name: "Clutch City",
    description: "Built for late-game situations",
    slots: [
      { archetype: "Clutch Scorer", modifiers: ["high iq"], starRange: [4, 5] },
      { archetype: "Floor General", starRange: [3, 4] },
      { archetype: "Two-Way", starRange: [3, 4] },
      { archetype: "Lockdown Defender", starRange: [3, 4] },
      { archetype: "Rim Protector", starRange: [3, 4] },
    ],
  },
  {
    name: "ISO Heavy",
    description: "One-on-one scorers who create their own shot",
    slots: [
      { archetype: "Inside-Out", modifiers: ["elite finishing"], starRange: [4, 5] },
      { archetype: "Slasher", modifiers: ["athletic"], starRange: [3, 4] },
      { archetype: "Finesse Scorer", starRange: [3, 4] },
      { archetype: "Combo Guard", starRange: [3, 4] },
      { archetype: "Stretch Big", starRange: [2, 3] },
    ],
  },
  {
    name: "Development Squad",
    description: "Raw talent with high upside",
    slots: [
      { archetype: "Slasher", modifiers: ["raw", "athletic"], starRange: [1, 2] },
      { archetype: "Sharpshooter", modifiers: ["raw"], starRange: [1, 2] },
      { archetype: "Glass Cleaner", modifiers: ["raw", "athletic"], starRange: [1, 2] },
      { archetype: "Combo Guard", modifiers: ["raw"], starRange: [1, 2] },
      { archetype: "Two-Way", modifiers: ["raw"], starRange: [1, 2] },
    ],
  },
  {
    name: "Superstar Trio",
    description: "Three elite players with role fillers",
    slots: [
      { archetype: "Gauntlet Boss", starRange: [5, 5] },
      { archetype: "Inside-Out", modifiers: ["elite shooting"], starRange: [4, 5] },
      { archetype: "Floor General", modifiers: ["elite playmaker"], starRange: [4, 5] },
      { archetype: "Two-Way", starRange: [2, 3] },
      { archetype: "Hustle Player", starRange: [2, 3] },
    ],
  },
  {
    name: "Brick House Defense",
    description: "Wall-to-wall rim protection and rebounds",
    slots: [
      { archetype: "Brick Wall", starRange: [3, 4] },
      { archetype: "Rim Protector", modifiers: ["athletic"], starRange: [3, 4] },
      { archetype: "Enforcer", starRange: [3, 4] },
      { archetype: "Hustle Player", modifiers: ["elite defense"], starRange: [3, 4] },
      { archetype: "Lockdown Defender", starRange: [3, 4] },
    ],
  },
  {
    name: "Gauntlet Bosses",
    description: "Elite opponents for the hardest games",
    slots: [
      { archetype: "Gauntlet Boss", starRange: [5, 5] },
      { archetype: "Gauntlet Boss", starRange: [5, 5] },
      { archetype: "Gauntlet Boss", starRange: [4, 5] },
      { archetype: "Gauntlet Boss", starRange: [4, 5] },
      { archetype: "Gauntlet Boss", starRange: [4, 5] },
    ],
  },
];

// ── 10 Run Templates (3 players each) ───────────────────

export const RUN_TEMPLATES: RunTemplate[] = [
  {
    name: "Park Legends",
    description: "Streetball-style 3v3",
    slots: [
      { archetype: "Streetballer", modifiers: ["athletic"], starRange: [3, 4] },
      { archetype: "Sniper Elite", starRange: [3, 4] },
      { archetype: "Enforcer", starRange: [3, 4] },
    ],
  },
  {
    name: "Small Ball",
    description: "Three guards running circles",
    slots: [
      { archetype: "Speedster", modifiers: ["athletic"], starRange: [3, 4] },
      { archetype: "Ankle Breaker", starRange: [3, 4] },
      { archetype: "Microwave", starRange: [3, 4] },
    ],
  },
  {
    name: "Big Ball",
    description: "Three bigs dominating the paint",
    slots: [
      { archetype: "Tower", modifiers: ["athletic"], starRange: [3, 5] },
      { archetype: "Paint Beast", starRange: [3, 4] },
      { archetype: "Stretch Big", starRange: [3, 4] },
    ],
  },
  {
    name: "3-and-D",
    description: "Shoot and defend, nothing else",
    slots: [
      { archetype: "Two-Way", modifiers: ["elite shooter"], starRange: [3, 4] },
      { archetype: "Lockdown Defender", starRange: [3, 4] },
      { archetype: "Sniper Elite", modifiers: ["elite defense"], starRange: [3, 4] },
    ],
  },
  {
    name: "Point Forward Show",
    description: "Big playmakers running the show",
    slots: [
      { archetype: "Point Forward", modifiers: ["high iq"], starRange: [3, 5] },
      { archetype: "Inside-Out", starRange: [3, 4] },
      { archetype: "Hustle Player", starRange: [3, 4] },
    ],
  },
  {
    name: "Slasher Gang",
    description: "Aggressive drivers attacking the rim",
    slots: [
      { archetype: "Slasher", modifiers: ["athletic", "elite finisher"], starRange: [3, 4] },
      { archetype: "Showtime", starRange: [3, 4] },
      { archetype: "Finesse Scorer", starRange: [3, 4] },
    ],
  },
  {
    name: "Floor Spacing",
    description: "Maximum shooting from everywhere",
    slots: [
      { archetype: "Sharpshooter", modifiers: ["elite shooter"], starRange: [3, 4] },
      { archetype: "Stretch Big", modifiers: ["elite shooting"], starRange: [3, 4] },
      { archetype: "Combo Guard", starRange: [3, 4] },
    ],
  },
  {
    name: "Grit and Grind",
    description: "Physical, defense-first basketball",
    slots: [
      { archetype: "Enforcer", modifiers: ["elite defense"], starRange: [3, 4] },
      { archetype: "Brick Wall", starRange: [3, 4] },
      { archetype: "Hustle Player", starRange: [3, 4] },
    ],
  },
  {
    name: "Rookie Challenge",
    description: "Easy early run opponents",
    slots: [
      { archetype: "Combo Guard", modifiers: ["raw"], starRange: [1, 2] },
      { archetype: "Slasher", modifiers: ["raw"], starRange: [1, 2] },
      { archetype: "Glass Cleaner", modifiers: ["raw"], starRange: [1, 2] },
    ],
  },
  {
    name: "Final Gauntlet",
    description: "The ultimate 3v3 challenge",
    slots: [
      { archetype: "Gauntlet Boss", starRange: [5, 5] },
      { archetype: "Gauntlet Boss", starRange: [4, 5] },
      { archetype: "Gauntlet Boss", starRange: [4, 5] },
    ],
  },
];
