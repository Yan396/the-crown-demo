export const TOKENS = Object.freeze({
  paper: "#E8DCC3",
  paperShadow: "#C9B892",
  ink: "#2B2620",
  inkFaint: "#6B6152",
  cinnabar: "#B03A2E",
  factionNorth: "#7A2E2A",
  factionSouth: "#31465C",
  factionEast: "#8A6D2F",
  lacquer: "#1C1916",
  greenInk: "#4A6B45",
  fontDisplay: "Songti SC, Noto Serif CJK SC, STSong, serif",
  fontBody: "PingFang SC, Noto Sans CJK SC, -apple-system, sans-serif"
});

export const CONFIG = Object.freeze({
  SAVE_VERSION: 1,
  SAVE_KEY: "the-crown.phase1.world-state",
  WORLD_SIZE: 2000,
  SEED: 0x00c0ffee,
  LOGIC_MS: 500,
  TICKS_PER_DAY: 60,
  MAX_CATCHUP_TICKS: 4,
  PLAYER_SPEED: 46,
  LORD_SPEED: 24,
  BANDIT_SPEED: 14,
  ARRIVAL_RADIUS: 7,
  ENCOUNTER_RADIUS: 42,
  TOWN_RADIUS: 52,
  TOWN_INTERACTION_RADIUS: 64,
  BANDIT_SPAWN_MIN: 125,
  BANDIT_SPAWN_MAX: 220,
  BANDIT_ROAM_MIN: 180,
  BANDIT_ROAM_MAX: 420,
  BANDIT_STRENGTH_MIN: 0.5,
  BANDIT_STRENGTH_MAX: 1.3,
  INITIAL_BANDITS: 3,
  MAX_BANDITS: 8,
  BANDIT_GOLD_PER_TROOP: 30,
  BATTLE_ROUND_TICKS: 6,
  BATTLE_DAMAGE_MIN: 0.8,
  BATTLE_DAMAGE_MAX: 1.2,
  FIELD_TERRAIN: 1,
  ROUT_THRESHOLD: 0.3,
  LOOT_SHARE: 0.5,
  PLAYER_GOLD_RETAINED_ON_LOSS: 0.5,
  SURVIVOR_XP_PER_WIN: 1,
  RENOWN_PER_ENEMY_CASUALTY: 1,
  RECRUIT_COST: 10,
  EVENT_LOG_LIMIT: 50,
  VISIBLE_LOG_ENTRIES: 6,
  RESPAWN_GRACE_TICKS: 2,
  MAX_BATTLE_ROUNDS: 100,
  STARTING_GOLD: 100,
  STARTING_MILITIA: 5,
  LORD_STARTING_GOLD: 300,
  LORD_STARTING_MILITIA: 12,
  TOWN_START_PROSPERITY: 50,
  TOWN_START_RECRUIT_POOL: 10,
  ZOOM_MOBILE: 0.72,
  ZOOM_DESKTOP: 0.88,
  DPR_CAP: 2,
  MOBILE_BREAKPOINT: 650,
  START_TOWN_ID: "river_bend"
});

export const TROOP_TYPES = Object.freeze({
  militia: Object.freeze({ atk: 2, def: 3, cost: 10, wage: 1 }),
  veteran: Object.freeze({ atk: 5, def: 6, cost: 0, wage: 3 }),
  bandit: Object.freeze({ atk: 3, def: 2, cost: 0, wage: 0 })
});

export const FACTION_DATA = Object.freeze([
  Object.freeze({ id: "north", nameKey: "factions.north", color: TOKENS.factionNorth, rulerNameIndex: 0, aggression: 0.68 }),
  Object.freeze({ id: "south", nameKey: "factions.south", color: TOKENS.factionSouth, rulerNameIndex: 4, aggression: 0.48 }),
  Object.freeze({ id: "east", nameKey: "factions.east", color: TOKENS.factionEast, rulerNameIndex: 8, aggression: 0.34 })
]);

export const TOWN_DATA = Object.freeze([
  Object.freeze({ id: "frost_gate", nameKey: "towns.frostGate", factionId: "north", x: 390, y: 350 }),
  Object.freeze({ id: "black_pine", nameKey: "towns.blackPine", factionId: "north", x: 1080, y: 275 }),
  Object.freeze({ id: "river_bend", nameKey: "towns.riverBend", factionId: "south", x: 430, y: 1490 }),
  Object.freeze({ id: "red_harbor", nameKey: "towns.redHarbor", factionId: "south", x: 1200, y: 1650 }),
  Object.freeze({ id: "golden_field", nameKey: "towns.goldenField", factionId: "east", x: 1615, y: 620 }),
  Object.freeze({ id: "morning_star", nameKey: "towns.morningStar", factionId: "east", x: 1575, y: 1265 })
]);

export const LORD_DATA = Object.freeze({
  north: Object.freeze([
    Object.freeze({ nameIndex: 0, personality: 0.22 }),
    Object.freeze({ nameIndex: 1, personality: 0.74 }),
    Object.freeze({ nameIndex: 2, personality: 0.48 }),
    Object.freeze({ nameIndex: 3, personality: 0.9 })
  ]),
  south: Object.freeze([
    Object.freeze({ nameIndex: 4, personality: 0.38 }),
    Object.freeze({ nameIndex: 5, personality: 0.62 }),
    Object.freeze({ nameIndex: 6, personality: 0.82 }),
    Object.freeze({ nameIndex: 7, personality: 0.16 })
  ]),
  east: Object.freeze([
    Object.freeze({ nameIndex: 8, personality: 0.3 }),
    Object.freeze({ nameIndex: 9, personality: 0.7 }),
    Object.freeze({ nameIndex: 10, personality: 0.54 }),
    Object.freeze({ nameIndex: 11, personality: 0.94 })
  ])
});

export const LORD_START_FRACTIONS = Object.freeze([0.15, 0.36, 0.64, 0.85]);
export const SUPPORTED_LANGUAGES = Object.freeze(["zh", "en"]);
