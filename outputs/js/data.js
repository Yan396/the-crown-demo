export const DEMO = false;

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
  DEMO,
  BUILD_VERSION: "2d5cb2d",
  V11_BUILD_LABEL: "v1.1",
  SAVE_VERSION: 2,
  SAVE_KEY: "the-crown.phase1.world-state",
  V11_SAVE_KEY: "the-crown.demo-v1.1.world-state",
  WORLD_SIZE: 2000,
  SEED: 0x00c0ffee,
  LOGIC_MS: 500,
  TICKS_PER_DAY: 60,
  MAX_CATCHUP_TICKS: 4,
  PLAYER_SPEED: 44,
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
  ELITE_BANDIT_STRENGTH_MIN: 1.5,
  ELITE_BANDIT_STRENGTH_MAX: 2,
  ELITE_RESPAWN_COOLDOWN_DAYS: 2,
  INITIAL_BANDITS: 3,
  MAX_BANDITS: 8,
  WAR_ZONE_MAX_BANDITS: 12,
  BANDIT_GOLD_PER_TROOP: 30,
  BANDIT_SPAWN_ATTEMPTS: 12,
  BANDIT_WORLD_MARGIN: 18,
  BANDIT_PLAYER_SAFE_RADIUS_MULTIPLIER: 2.4,
  STARTER_BANDIT_ENABLED: true,
  NORMAL_MARKER_SIZE_MULTIPLIER: 1,
  ELITE_MARKER_SIZE_MULTIPLIER: 1.65,
  ELITE_BANDIT_LOOT_MULTIPLIER: 3,
  LOOT_RANDOM_MIN: 0.8,
  LOOT_RANDOM_MAX: 1.25,
  LOOT_JACKPOT_CHANCE: 0.1,
  LOOT_JACKPOT_MIN: 200,
  LOOT_JACKPOT_BONUS_MAX: 120,
  BATTLE_ROUND_TICKS: 6,
  BATTLE_DAMAGE_MIN: 0.8,
  BATTLE_DAMAGE_MAX: 1.2,
  FIELD_TERRAIN: 1,
  TOWN_DEFENDER_TERRAIN: 1.5,
  ROUT_THRESHOLD: 0.3,
  LOOT_SHARE: 0.5,
  PLAYER_GOLD_RETAINED_ON_LOSS: 0.5,
  SURVIVOR_XP_PER_WIN: 1,
  RENOWN_PER_ENEMY_CASUALTY: 1,
  RECRUIT_COST: 10,
  EVENT_LOG_LIMIT: 50,
  VISIBLE_LOG_ENTRIES: 6,
  RESPAWN_GRACE_TICKS: 2,
  PLAYER_FLEE_SUCCESS_CHANCE: 0.7,
  PLAYER_FLEE_DISTANCE_MULTIPLIER: 2.5,
  MAX_BATTLE_ROUNDS: 100,
  ACT1_TROOP_CAP: 20,
  ACT2_TROOP_CAP: 60,
  ACT2_RENOWN: 50,
  DEMO_END_RENOWN: 100,
  ACT3_TROOP_CAP: 100,
  ACT3_RENOWN: 200,
  ACT3_RELATION: 50,
  PROMISE_TROOPS_MIN: 10,
  PROMISE_TROOPS_MAX: 200,
  PROMISE_TROOPS_STEP: 5,
  PROMISE_TROOPS_DEFAULT: 60,
  PROMISE_GOLD_MIN: 100,
  PROMISE_GOLD_MAX: 2000,
  PROMISE_GOLD_STEP: 100,
  PROMISE_GOLD_DEFAULT: 500,
  PROMISE_FIEFS_OPTIONS: Object.freeze([1, 2, 3, 5, "all"]),
  PROMISE_FIEFS_DEFAULT: 2,
  LOW_GOLD_WAGE_DAYS: 3,
  WAGE_GRACE_DAYS: 2,
  ROAD_DAILY_EVENT_CHANCE: 0.25,
  MAX_DAILY_EVENTS: 1,
  FIRST_EVENT_MAX_SECONDS: 180,
  ROAD_FIRST_EVENT_TARGET_SECONDS: 180,
  ROAD_FIRST_EVENT_PITY_DAY: 3,
  ROAD_EVENT_HISTORY_LIMIT: 20,
  ROAD_EVENT_RELATION_MIN: -100,
  ROAD_EVENT_RELATION_MAX: 100,
  ROAD_EVENT_MIN_PLAYER_TROOPS: 1,
  ROAD_EVENT_GOLD_TINY: 2,
  ROAD_EVENT_GOLD_SMALL: 3,
  ROAD_EVENT_GOLD_MEDIUM: 4,
  ROAD_EVENT_GOLD_LARGE: 5,
  ROAD_EVENT_GOLD_BIG: 6,
  ROAD_EVENT_GOLD_HUGE: 7,
  ROAD_EVENT_GOLD_WINDFALL: 8,
  ROAD_EVENT_TROOPS_SMALL: 1,
  ROAD_EVENT_TROOPS_MEDIUM: 2,
  ROAD_EVENT_RENOWN_SMALL: 1,
  ROAD_EVENT_RENOWN_MEDIUM: 2,
  ROAD_EVENT_RELATION_SMALL: 1,
  ROAD_EVENT_RELATION_MEDIUM: 2,
  ROAD_EVENT_RELATION_LARGE: 3,
  ROAD_EVENT_ESCORT_REWARD: 40,
  ROAD_EVENT_DRINK_COST: 15,
  ROAD_EVENT_NEXT_BATTLE_ATTACK_BONUS: 0.2,
  ROAD_EVENT_DESERTION_CHANCE: 0.05,
  ROAD_EVENT_DESERTER_COUNT: 1,
  AUTOPLAY_ROAD_EVENT_CHOICE_INDEX: 0,
  STARTER_BATTLE_COUNT: 2,
  STARTER_BATTLE_STRENGTH_MIN: 0.4,
  STARTER_BATTLE_STRENGTH_MAX: 0.6,
  STARTER_BATTLE_LOOT_MULTIPLIER: 2,
  LOSS_STREAK_TRIGGER: 2,
  LOSS_STREAK_SPAWN_COUNT: 2,
  LOSS_STREAK_SPAWN_MAX_RATIO: 0.7,
  WIN_STREAK_TRIGGER: 4,
  WIN_STREAK_BIG_SPAWN_RATIO: 1.4,
  ENCOUNTER_SURE_WIN_RATIO: 1.25,
  ENCOUNTER_OUTMATCHED_RATIO: 0.8,
  TITLE_TRIPLE_TAP_WINDOW_MS: 650,
  MAX_VISIBLE_NUMBERS: 6,
  ACT_TRANSITION_PAUSE_MS: 1000,
  MERCENARY_PAY_PER_BATTLE: 40,
  MERCENARY_RELATION_PER_WIN: 2,
  VETERAN_REPLENISH_COST: 20,
  TAVERN_ATTACK_BUFF_COST: 30,
  TAVERN_ATTACK_BUFF_BONUS: 0.2,
  HOSTILE_TOWN_RECRUIT_PRICE_MULTIPLIER: 1.5,
  WAR_ZONE_RECRUIT_PRICE_MULTIPLIER: 1.5,
  CONTRACT_ESCORT_REWARD: 60,
  CONTRACT_ESCORT_DAYS: 3,
  CONTRACT_RISKY_REWARD: 90,
  CONTRACT_RISKY_ENEMY_STRENGTH_MULTIPLIER: 1.3,
  CONTRACT_RISKY_FAILURE_RENOWN: 15,
  CONTRACT_WAR_REWARD: 130,
  CONTRACT_WAR_RENOWN: 12,
  CONTRACT_WAR_RELATION_PENALTY: 30,
  HOSTILE_LORD_PLAYER_SCAN_RADIUS: 260,
  LORD_PLAYER_PURSUIT_COOLDOWN_TICKS: 120,
  DESERTER_BANDIT_DAILY_CHANCE: 0.5,
  PLAYER_TOWN_TAX_RATE: 0.4,
  FIEF_MIN_FIELD_TROOPS: 1,
  FIEF_LOSS_RENOWN: 30,
  FIEF_LOSS_RELATION: 20,
  FIEF_REINFORCE_TARGET: 8,
  FIEF_REINFORCE_REWARD: 100,
  FIEF_PATROL_REQUIRED_TICKS: 120,
  FIEF_PATROL_RADIUS: 260,
  FIEF_PATROL_REWARD: 90,
  FIEF_CONTRACT_RELATION: 5,
  FIEF_WAR_RELATION_MULTIPLIER: 1.5,
  FIEF_HOSTILITY_ROLL: 1,
  FIEF_WAR_RELATION_TRIGGER: 25,
  FIEF_THREAT_LORD_MIN_TROOPS: 60,
  ACT4_RENOWN: 500,
  ACT4_TOWN_COUNT: 3,
  ACT3_RENOWN_GAIN_MULTIPLIER: 0.0735,
  ACT3_SECOND_FIEF_RENOWN: 350,
  ACT3_EXPANSION_LORD_MIN_TROOPS: 90,
  FOUNDING_REOFFER_DAYS: 5,
  KINGDOM_DECISION_INTERVAL_DAYS: 30,
  KINGDOM_COALITION_WAVE_DAYS: 5,
  KINGDOM_COALITION_REINFORCEMENTS: 18,
  KINGDOM_WAR_RELATION: -100,
  KINGDOM_PLAYER_AGGRESSION: 1,
  KINGDOM_REBELLION_INTERVAL_DAYS: 10,
  KINGDOM_REBELLION_WARNING_DAYS: 1,
  KINGDOM_REBELLION_GARRISON_MIN: 10,
  KINGDOM_REBELLION_ESCALATION_PER_EDICT: 2,
  KINGDOM_CHRONICLE_MIN_LINES: 8,
  KINGDOM_CHRONICLE_MAX_LINES: 12,
  KINGDOM_CHRONICLE_EVENT_LIMIT: 40,
  AUTOPLAY_F2_MIN_ACTIVE_SECONDS: 9000,
  AUTOPLAY_F2_MAX_ACTIVE_SECONDS: 14400,
  AUTOPLAY_F2_HARD_LIMIT_SECONDS: 16200,
  AUTOPLAY_F2_ORIGIN: "border",
  ORIGIN_BONUSES: Object.freeze({
    hunter: Object.freeze({ gold: 25, renown: 0, roadSpeed: 1 }),
    border: Object.freeze({ gold: 0, renown: 5, roadSpeed: 1 }),
    wanderer: Object.freeze({ gold: 0, renown: 0, roadSpeed: 1.05 })
  }),
  F3_ARM_MATRIX: Object.freeze({
    spear: Object.freeze({ spear: 0, archer: -0.2, cavalry: 0.2 }),
    archer: Object.freeze({ spear: 0.2, archer: 0, cavalry: -0.2 }),
    cavalry: Object.freeze({ spear: -0.2, archer: 0.2, cavalry: 0 })
  }),
  F3_REGION_RECRUIT_MIX: Object.freeze({
    north: Object.freeze({ spear: 0.2, archer: 0.25, cavalry: 0.55 }),
    south: Object.freeze({ spear: 0.55, archer: 0.25, cavalry: 0.2 }),
    east: Object.freeze({ spear: 0.2, archer: 0.55, cavalry: 0.25 })
  }),
  F3_ORIGIN_ARM: Object.freeze({ hunter: "archer", border: "spear", wanderer: "cavalry" }),
  F3_FORMATION_SYNERGY: 0.1,
  F3_ARCHER_VOLLEY_SHARE: 0.3,
  F3_ARCHER_VOLLEY_ARROWS_PER_TOKEN: 2,
  F3_COMMANDS: Object.freeze({
    charge: Object.freeze({ attack: 1.1, defense: 0.9 }),
    hold: Object.freeze({ attack: 1, defense: 1.1 }),
    focus: Object.freeze({ attack: 1.05, defense: 1 })
  }),
  F3_AUTOPLAY_COMMAND: "hold",
  F3_BALANCE_MAX_WIN_SPREAD: 0.15,
  F4_LIEUTENANT_SLOTS: 2,
  F4_LIEUTENANT_UNPAID_LEAVE_DAYS: 3,
  F4_LIEUTENANT_COST: 150,
  F4_CHEN_ATTACK_BONUS: 0.3,
  F4_SHEN_DEFENSE_BONUS: 0.2,
  F4_JIA_INCOME_BONUS: 0.15,
  STARTING_GOLD: 100,
  STARTING_MILITIA: 5,
  PLAYER_RECOVERY_RECRUIT_FLOOR: 5,
  LORD_STARTING_GOLD: 300,
  LORD_STARTING_MILITIA: 12,
  LORD_TROOP_CAP: 25,
  LORD_RECRUIT_THRESHOLD_RATIO: 0.5,
  LORD_RECRUIT_MIN_GOLD: 200,
  LORD_RECRUIT_GOLD_RESERVE: 200,
  LORD_ATTACK_RATIO_BASE: 1.2,
  LORD_ATTACK_PERSONALITY_SCALE: 0.6,
  LORD_FLEE_RATIO: 0.7,
  LORD_ENEMY_SCAN_RADIUS: 140,
  LORD_DAILY_INCOME: 34,
  LORD_DEFEAT_GRACE_TICKS: 20,
  LORD_MIN_RESPAWN_TROOPS: 1,
  AI_REEVALUATE_TICKS: 20,
  AI_PARTY_ENCOUNTER_RADIUS: 42,
  TOWN_START_PROSPERITY: 50,
  TOWN_START_RECRUIT_POOL: 10,
  PLAYER_TOWN_RECRUIT_RESERVE: 3,
  TOWN_START_GARRISON: 2,
  TOWN_CAPTURE_GARRISON: 2,
  TOWN_CAPTURE_PROSPERITY_LOSS: 10,
  TOWN_MIN_PROSPERITY: 0,
  TOWN_MAX_PROSPERITY: 100,
  TOWN_PEACE_PROSPERITY_DELTA: 1,
  TOWN_SIEGE_PROSPERITY_DELTA: -2,
  TOWN_RECRUIT_GAIN: 5,
  TOWN_RECRUIT_REGEN_DAYS: 3,
  TOWN_RECRUIT_POOL_CAP: 20,
  RECRUIT_POOL_GAIN: 5,
  RECRUIT_POOL_REGEN_DAYS: 3,
  RECRUIT_POOL_CAP: 20,
  SIEGE_STRENGTH_RATIO: 2,
  SIEGE_REQUIRED_DAYS: 2,
  SIEGE_REQUIRED_TICKS: 120,
  SIEGE_DAYS: 2,
  SIEGE_ADJACENCY_RADIUS: 90,
  DIPLOMACY_INTERVAL_TICKS: 600,
  DIPLOMACY_RELATION_DRIFT: 5,
  DIPLOMACY_TICKS: 600,
  RELATION_DRIFT: 5,
  DIPLOMACY_START_RELATION: 0,
  WAR_RELATION_THRESHOLD: -50,
  WAR_DECLARATION_CHANCE: 0.2,
  PEACE_MIN_WAR_DAYS: 30,
  PEACE_TOWN_LOSS_THRESHOLD: 2,
  PEACE_CHANCE: 0.5,
  DEMO_INITIAL_WAR_RELATION: -60,
  DEMO_INITIAL_WAR_FACTIONS: Object.freeze(["north", "south"]),
  DEMO_MAX_ACT: 2,
  AUTOPLAY_MULTIPLIER: 20,
  AUTOPLAY_REEVALUATE_TICKS: 2,
  AUTOPLAY_ACT1_RECOVERY_TICKS: 90,
  AUTOPLAY_ACT2_RECOVERY_TICKS: 1100,
  AUTOPLAY_CATCHUP_START_SECONDS: 1500,
  AUTOPLAY_CATCHUP_RECOVERY_TICKS: 60,
  AUTOPLAY_GOLD_RESERVE: 0,
  AUTOPLAY_RETREAT_TROOP_RATIO: 0.35,
  AUTOPLAY_MAX_TARGET_STRENGTH_RATIO: 1.3,
  AUTOPLAY_V1_TARGET_STRENGTH_RATIO: 0.95,
  AUTOPLAY_TROOP_PROMISE: 20,
  AUTOPLAY_GOLD_PROMISE: 500,
  AUTOPLAY_FIEF_PROMISE: 2,
  AUTOPLAY_MAX_ACTIVE_SECONDS: 1800,
  AUTOPLAY_FULL_MAX_ACTIVE_SECONDS: 3600,
  AUTOPLAY_FIRST_BATTLE_TARGET_SECONDS: 90,
  AUTOPLAY_ACT2_TARGET_MIN_SECONDS: 600,
  AUTOPLAY_ACT2_TARGET_MAX_SECONDS: 720,
  AUTOPLAY_END_TARGET_MIN_SECONDS: 1200,
  AUTOPLAY_END_TARGET_MAX_SECONDS: 1800,
  AUTOPLAY_ACT3_TARGET_MIN_SECONDS: 2100,
  AUTOPLAY_ACT3_TARGET_MAX_SECONDS: 2700,
  AUTOPLAY_FIEF_THREAT_MAX_SECONDS: 900,
  // v1.1 engagement branch. Every knob stays dormant unless state.features.v11
  // is true, so the default v1.0 URL keeps its save, RNG stream, and balance.
  V11_FORMATION_MIN_SIDE_TROOPS: 4,
  V11_FORMATION_SCOUT_ACCURACY: 0.8,
  V11_FORMATION_ATTACK_ADVANTAGE: 1.15,
  V11_FORMATION_DEFENSE_ADVANTAGE: 1.15,
  V11_FORMATION_ATTACK_DISADVANTAGE: 1,
  V11_FORMATION_DEFENSE_DISADVANTAGE: 1,
  V11_LORD_FORMATION_CAUTIOUS_MAX: 0.34,
  V11_LORD_FORMATION_BOLD_MIN: 0.67,
  V11_LORD_FORMATION_WEIGHTS: Object.freeze({
    cautious: Object.freeze([0.18, 0.27, 0.55]),
    balanced: Object.freeze([0.28, 0.44, 0.28]),
    bold: Object.freeze([0.55, 0.27, 0.18])
  }),
  V11_LIEUTENANT_COST: 150,
  V11_LIEUTENANT_PURSUIT_GOLD: 80,
  V11_LIEUTENANT_PURSUIT_TROOPS: 3,
  // Road movement. ROAD_MOVEMENT gates the whole feature so it can be turned
  // off in one place if pacing regresses; the multipliers are never surfaced in
  // the UI, so players feel the difference without being told about it.
  ROAD_MOVEMENT: true,
  ROAD_SPEED_MULTIPLIER: 1.2,
  OFF_ROAD_SPEED_MULTIPLIER: 0.85,

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

export const ARM_IDS = Object.freeze(["spear", "archer", "cavalry"]);

export const LIEUTENANT_ROSTER = Object.freeze([
  Object.freeze({ id: "chen_mang", passive: "attack", bonus: CONFIG.F4_CHEN_ATTACK_BONUS }),
  Object.freeze({ id: "shen_wen", passive: "defense", bonus: CONFIG.F4_SHEN_DEFENSE_BONUS }),
  Object.freeze({ id: "jia_duojin", passive: "income", bonus: CONFIG.F4_JIA_INCOME_BONUS })
]);

export const FORMATION_IDS = Object.freeze(["wedge", "line", "circle"]);

export const ROAD_EVENT_TOPICS = Object.freeze([
  "animal",
  "traveler",
  "trade",
  "village",
  "camp",
  "omen"
]);

const ROAD_EVENT_TOPIC_BY_ID = Object.freeze({
  goat_checkpoint: "animal",
  deserter_cook: "traveler",
  dry_ink_toll: "trade",
  runaway_pies: "village",
  wishing_well: "omen",
  backward_helmet: "traveler",
  noble_dog: "animal",
  proud_scales: "trade",
  bridge_children: "village",
  wet_socks: "camp",
  merchant_escort: "trade",
  wrong_wedding_band: "village",
  bandit_resume: "traveler",
  goose_seal: "animal",
  bards_rhyme: "omen",
  flour_ghost: "village",
  chicken_deserter: "animal",
  tax_cart_wheel: "trade",
  banner_laundry: "traveler",
  camp_drinks: "camp",
  chen_mang_pursuit: "traveler",
  chen_mang_banner: "omen",
  chen_mang_wager: "camp",
  shen_wen_watch: "camp",
  shen_wen_bridge: "village",
  shen_wen_letter: "traveler",
  jia_duojin_ledger: "trade",
  jia_duojin_mule: "animal",
  jia_duojin_coin: "omen"
});

function casualEvent(id, prompt, choices) {
  const localizedPrompt = Object.freeze(prompt);
  return Object.freeze({
    id,
    topic: ROAD_EVENT_TOPIC_BY_ID[id],
    prompt: localizedPrompt,
    text: localizedPrompt,
    choices: Object.freeze(choices.map((choice) => {
      const label = Object.freeze(choice.label);
      return Object.freeze({
        label,
        text: label,
        effects: Object.freeze({ ...choice.effects }),
        ...(choice.result ? { result: Object.freeze(choice.result) } : {})
      });
    }))
  });
}

// Small road stories are data, not rules: the resolver in casual.js applies
// their four shared effect types against the event's nearby faction.
export const CASUAL_EVENTS = Object.freeze([
  casualEvent("goat_checkpoint", {
    zh: "一只山羊横在路中央，农夫坚称它正在执行‘非官方关卡检查’。山羊对此不置可否。",
    en: "A goat blocks the road while its farmer insists it is conducting an ‘unofficial checkpoint inspection.’ The goat declines to comment."
  }, [
    { label: { zh: "用胡萝卜缴通行费", en: "Pay the carrot toll" }, effects: { gold: -CONFIG.ROAD_EVENT_GOLD_MEDIUM, relation: CONFIG.ROAD_EVENT_RELATION_SMALL } },
    { label: { zh: "封它为道路骑士", en: "Knight it for road service" }, effects: { gold: -CONFIG.ROAD_EVENT_GOLD_TINY, renown: CONFIG.ROAD_EVENT_RENOWN_MEDIUM } }
  ]),
  casualEvent("deserter_cook", {
    zh: "一个逃兵想入伙,他说他会做饭。",
    en: "A deserter wants to join up. He says he can cook."
  }, [
    { label: { zh: "收下", en: "Take him in" }, effects: { troops: CONFIG.ROAD_EVENT_TROOPS_SMALL, gold: 0 } },
    { label: { zh: "赶走", en: "Send him away" }, effects: { renown: CONFIG.ROAD_EVENT_RENOWN_MEDIUM }, result: { zh: "军纪严明。", en: "Discipline is strict." } }
  ]),
  casualEvent("dry_ink_toll", {
    zh: "关卡小吏的印泥干了，却拒绝放行。他暗示一杯热茶或许能恢复行政效率。",
    en: "The toll clerk's ink pad has dried out, but he refuses passage. He hints that hot tea may restore administrative efficiency."
  }, [
    { label: { zh: "请他喝茶", en: "Buy him tea" }, effects: { gold: -CONFIG.ROAD_EVENT_GOLD_SMALL, relation: CONFIG.ROAD_EVENT_RELATION_MEDIUM } },
    { label: { zh: "用土豆刻个新章", en: "Carve a potato stamp" }, effects: { renown: CONFIG.ROAD_EVENT_RENOWN_SMALL, relation: -CONFIG.ROAD_EVENT_RELATION_SMALL } }
  ]),
  casualEvent("runaway_pies", {
    zh: "一辆馅饼车正飞速冲下山坡，车主在后面追得上气不接下气。馅饼似乎对自由充满向往。",
    en: "A pie cart races downhill while its breathless owner follows. The pies appear deeply committed to freedom."
  }, [
    { label: { zh: "派人拦住馅饼", en: "Send troops after the pies" }, effects: { troops: -CONFIG.ROAD_EVENT_TROOPS_SMALL, relation: CONFIG.ROAD_EVENT_RELATION_LARGE } },
    { label: { zh: "卖掉幸存的馅饼", en: "Sell the surviving pies" }, effects: { gold: CONFIG.ROAD_EVENT_GOLD_WINDFALL, relation: -CONFIG.ROAD_EVENT_RELATION_MEDIUM } }
  ]),
  casualEvent("wishing_well", {
    zh: "村民说井里的硬币能实现愿望。孩子补充说，至少能实现‘井里有更多硬币’这个愿望。",
    en: "Villagers say the coins in their well grant wishes. A child adds that they reliably grant the wish of ‘more coins in the well.’"
  }, [
    { label: { zh: "郑重投两枚硬币", en: "Make a solemn contribution" }, effects: { gold: -CONFIG.ROAD_EVENT_GOLD_TINY, renown: CONFIG.ROAD_EVENT_RENOWN_SMALL, relation: CONFIG.ROAD_EVENT_RELATION_SMALL } },
    { label: { zh: "把愿望捞出来", en: "Fish out the wishes" }, effects: { gold: CONFIG.ROAD_EVENT_GOLD_BIG, renown: -CONFIG.ROAD_EVENT_RENOWN_MEDIUM, relation: -CONFIG.ROAD_EVENT_RELATION_SMALL } }
  ]),
  casualEvent("backward_helmet", {
    zh: "一个新兵把头盔戴反了，还说这样敌人就无法直视他的眼睛。这套理论目前无懈可击。",
    en: "A recruit wears his helmet backward, claiming the enemy therefore cannot look him in the eye. His theory remains technically undefeated."
  }, [
    { label: { zh: "替他调好绑带", en: "Fix the helmet straps" }, effects: { gold: -CONFIG.ROAD_EVENT_GOLD_SMALL, troops: CONFIG.ROAD_EVENT_TROOPS_SMALL } },
    { label: { zh: "任命他为后卫", en: "Appoint him rear guard" }, effects: { troops: CONFIG.ROAD_EVENT_TROOPS_MEDIUM, renown: -CONFIG.ROAD_EVENT_RENOWN_SMALL } }
  ]),
  casualEvent("noble_dog", {
    zh: "一只穿丝绸背心的小狗偷走了军粮香肠。它的贵族主人正在悬赏寻找这位逃犯。",
    en: "A tiny dog in a silk waistcoat steals a ration sausage. Its noble owner is offering a reward for the fugitive."
  }, [
    { label: { zh: "归还香肠大盗", en: "Return the sausage thief" }, effects: { gold: CONFIG.ROAD_EVENT_GOLD_BIG, relation: CONFIG.ROAD_EVENT_RELATION_MEDIUM } },
    { label: { zh: "留下当军队吉祥物", en: "Keep it as the army mascot" }, effects: { troops: CONFIG.ROAD_EVENT_TROOPS_SMALL, relation: -CONFIG.ROAD_EVENT_RELATION_MEDIUM } }
  ]),
  casualEvent("proud_scales", {
    zh: "商人的秤总是刚好偏向商人那边，而且看起来对此颇为自豪。商人称这是市场经验。",
    en: "A merchant's scales always lean in the merchant's favor and seem rather proud of it. The merchant calls this market experience."
  }, [
    { label: { zh: "照价购买补给", en: "Buy supplies anyway" }, effects: { gold: -CONFIG.ROAD_EVENT_GOLD_WINDFALL, troops: CONFIG.ROAD_EVENT_TROOPS_MEDIUM, relation: CONFIG.ROAD_EVENT_RELATION_SMALL } },
    { label: { zh: "用掰手腕重新定价", en: "Renegotiate by arm wrestling" }, effects: { gold: CONFIG.ROAD_EVENT_GOLD_MEDIUM, renown: CONFIG.ROAD_EVENT_RENOWN_SMALL, relation: -CONFIG.ROAD_EVENT_RELATION_SMALL } }
  ]),
  casualEvent("bridge_children", {
    zh: "两个孩子守着桥，挥舞木勺索要‘皇家过桥费’。他们的账本是一片写满歪字的树叶。",
    en: "Two children guard a bridge with wooden spoons and demand a ‘royal crossing fee.’ Their ledger is a leaf covered in crooked writing."
  }, [
    { label: { zh: "老实缴费", en: "Pay the toll properly" }, effects: { gold: -CONFIG.ROAD_EVENT_GOLD_TINY, relation: CONFIG.ROAD_EVENT_RELATION_MEDIUM } },
    { label: { zh: "任命他们为桥梁监察员", en: "Appoint them bridge inspectors" }, effects: { gold: -CONFIG.ROAD_EVENT_GOLD_MEDIUM, renown: CONFIG.ROAD_EVENT_RENOWN_MEDIUM, relation: CONFIG.ROAD_EVENT_RELATION_SMALL } }
  ]),
  casualEvent("wet_socks", {
    zh: "连夜大雨淋湿了全营的袜子。士兵们认为这是王国目前最严重的危机。",
    en: "An overnight downpour soaks every sock in camp. The troops consider this the kingdom's gravest present crisis."
  }, [
    { label: { zh: "买柴火烘袜子", en: "Buy firewood for the socks" }, effects: { gold: -CONFIG.ROAD_EVENT_GOLD_LARGE, troops: CONFIG.ROAD_EVENT_TROOPS_SMALL } },
    { label: { zh: "穿着湿袜继续行军", en: "March in wet socks" }, effects: { troops: -CONFIG.ROAD_EVENT_TROOPS_SMALL, renown: CONFIG.ROAD_EVENT_RENOWN_SMALL } }
  ]),
  casualEvent("merchant_escort", {
    zh: "商队愿意出钱请你护送一段。",
    en: "A merchant caravan offers to pay you for an escort along the road."
  }, [
    { label: { zh: "接", en: "Accept" }, effects: { gold: CONFIG.ROAD_EVENT_ESCORT_REWARD, blockBanditBattlesToday: true } },
    { label: { zh: "拒", en: "Refuse" }, effects: {} }
  ]),
  casualEvent("wrong_wedding_band", {
    zh: "一个村庄误把你的队伍当成婚礼乐队。新娘点了三首歌，没人敢承认你们只会军歌。",
    en: "A village mistakes your company for the wedding band. The bride requests three songs, and nobody admits you only know marching tunes."
  }, [
    { label: { zh: "硬着头皮演奏", en: "Play something confidently" }, effects: { gold: CONFIG.ROAD_EVENT_GOLD_LARGE, renown: CONFIG.ROAD_EVENT_RENOWN_SMALL, relation: CONFIG.ROAD_EVENT_RELATION_MEDIUM } },
    { label: { zh: "带宾客唱军歌", en: "Teach the guests a war chant" }, effects: { troops: CONFIG.ROAD_EVENT_TROOPS_SMALL, relation: -CONFIG.ROAD_EVENT_RELATION_SMALL } }
  ]),
  casualEvent("bandit_resume", {
    zh: "一个衣着整洁的强盗递来求职信，特长栏写着‘准时伏击’和‘团队合作’。他的字比你的书记官漂亮。",
    en: "A neatly dressed bandit submits a résumé listing ‘punctual ambushes’ and ‘teamwork.’ His handwriting is better than your clerk's."
  }, [
    { label: { zh: "试用一个月", en: "Hire him on probation" }, effects: { gold: -CONFIG.ROAD_EVENT_GOLD_LARGE, troops: CONFIG.ROAD_EVENT_TROOPS_SMALL, relation: -CONFIG.ROAD_EVENT_RELATION_SMALL } },
    { label: { zh: "推荐他去种田", en: "Recommend farming" }, effects: { renown: CONFIG.ROAD_EVENT_RENOWN_SMALL, relation: CONFIG.ROAD_EVENT_RELATION_SMALL } }
  ]),
  casualEvent("goose_seal", {
    zh: "一只鹅叼走了领主的印章，随后游到池塘中央。它现在看起来拥有完整的行政权。",
    en: "A goose steals a lord's seal and swims to the middle of a pond. It now appears to hold full administrative authority."
  }, [
    { label: { zh: "派人下水追捕", en: "Send someone into the pond" }, effects: { troops: -CONFIG.ROAD_EVENT_TROOPS_SMALL, relation: CONFIG.ROAD_EVENT_RELATION_LARGE } },
    { label: { zh: "再刻一枚土豆印章", en: "Make another potato seal" }, effects: { gold: -CONFIG.ROAD_EVENT_GOLD_SMALL, renown: CONFIG.ROAD_EVENT_RENOWN_SMALL, relation: -CONFIG.ROAD_EVENT_RELATION_SMALL } }
  ]),
  casualEvent("bards_rhyme", {
    zh: "游吟诗人献上一首赞歌，其中‘王冠’与‘摔翻’押了七次韵。他坚持这是大胆的艺术选择。",
    en: "A bard presents a tribute in which ‘crown’ rhymes with ‘falling down’ seven times. He insists this is a bold artistic choice."
  }, [
    { label: { zh: "委托他重写", en: "Commission a rewrite" }, effects: { gold: -CONFIG.ROAD_EVENT_GOLD_HUGE, renown: CONFIG.ROAD_EVENT_RENOWN_MEDIUM, relation: CONFIG.ROAD_EVENT_RELATION_SMALL } },
    { label: { zh: "让观众自己评判", en: "Let the crowd decide" }, effects: { gold: CONFIG.ROAD_EVENT_GOLD_MEDIUM, renown: -CONFIG.ROAD_EVENT_RENOWN_SMALL, relation: CONFIG.ROAD_EVENT_RELATION_SMALL } }
  ]),
  casualEvent("flour_ghost", {
    zh: "磨坊主打了个喷嚏，整间屋顿时像闹鬼一样白。围观者已经开始争论这算不算神迹。",
    en: "The miller sneezes and turns the room ghostly white with flour. Onlookers are already debating whether it counts as a miracle."
  }, [
    { label: { zh: "帮忙清扫磨坊", en: "Help clean the mill" }, effects: { troops: -CONFIG.ROAD_EVENT_TROOPS_SMALL, gold: CONFIG.ROAD_EVENT_GOLD_MEDIUM, relation: CONFIG.ROAD_EVENT_RELATION_MEDIUM } },
    { label: { zh: "正式宣布这是神迹", en: "Declare an official miracle" }, effects: { gold: CONFIG.ROAD_EVENT_GOLD_SMALL, renown: CONFIG.ROAD_EVENT_RENOWN_MEDIUM, relation: -CONFIG.ROAD_EVENT_RELATION_MEDIUM } }
  ]),
  casualEvent("chicken_deserter", {
    zh: "一个落单士兵坚称自己不是逃兵，只是在追一只‘快得不合常理’的鸡。鸡没有留下口供。",
    en: "A lone soldier insists he is not a deserter, merely pursuing an ‘unreasonably fast’ chicken. The chicken provides no statement."
  }, [
    { label: { zh: "护送他回原部队", en: "Escort him back" }, effects: { gold: -CONFIG.ROAD_EVENT_GOLD_SMALL, relation: CONFIG.ROAD_EVENT_RELATION_MEDIUM } },
    { label: { zh: "抓到鸡就录用", en: "Hire him if he catches it" }, effects: { troops: CONFIG.ROAD_EVENT_TROOPS_SMALL, renown: -CONFIG.ROAD_EVENT_RENOWN_SMALL, relation: -CONFIG.ROAD_EVENT_RELATION_SMALL } }
  ]),
  casualEvent("tax_cart_wheel", {
    zh: "运税车的轮子断了，几个税吏盯着它，仿佛遭到了私人背叛。钱箱倒是毫发无损。",
    en: "A tax cart loses a wheel, and its collectors stare as if personally betrayed. The coin chest remains perfectly healthy."
  }, [
    { label: { zh: "出钱修好车轮", en: "Pay for repairs" }, effects: { gold: -CONFIG.ROAD_EVENT_GOLD_LARGE, relation: CONFIG.ROAD_EVENT_RELATION_MEDIUM } },
    { label: { zh: "收取紧急运输费", en: "Charge an emergency transport fee" }, effects: { gold: CONFIG.ROAD_EVENT_GOLD_WINDFALL, relation: -CONFIG.ROAD_EVENT_RELATION_MEDIUM } }
  ]),
  casualEvent("banner_laundry", {
    zh: "敌对领主的旗帜被晾在河边，旁边还挂着一排很不威严的内衣。守卫正在午睡。",
    en: "A rival lord's banners hang drying beside a deeply undignified row of underwear. The guards are napping."
  }, [
    { label: { zh: "原样放回去", en: "Leave everything untouched" }, effects: { renown: CONFIG.ROAD_EVENT_RENOWN_SMALL, relation: CONFIG.ROAD_EVENT_RELATION_MEDIUM } },
    { label: { zh: "把旗帜换成床单", en: "Replace the banner with a bedsheet" }, effects: { renown: CONFIG.ROAD_EVENT_RENOWN_MEDIUM, relation: -CONFIG.ROAD_EVENT_RELATION_LARGE } }
  ]),
  casualEvent("camp_drinks", {
    zh: "弟兄们想喝一顿。",
    en: "The company wants a proper night of drinking."
  }, [
    { label: { zh: "请", en: "Buy the drinks" }, effects: { gold: -CONFIG.ROAD_EVENT_DRINK_COST, nextBattleAttackBonus: CONFIG.ROAD_EVENT_NEXT_BATTLE_ATTACK_BONUS } },
    { label: { zh: "不请", en: "No drinks" }, effects: { desertionChance: CONFIG.ROAD_EVENT_DESERTION_CHANCE } }
  ])
]);

// Kept outside the base 20-card deck: these cards are appended only in the
// v1.1 variant while Chen Mang is currently in the company.
export const LIEUTENANT_EVENTS = Object.freeze([
  casualEvent("chen_mang_pursuit", {
    zh: "陈莽看见一队逃匪，没等号令便追了出去。半个时辰后，他带回一袋钱，也少带回了几个人。",
    en: "Chen Mang spots fleeing bandits and charges off without orders. Half an hour later he returns with a purse and fewer soldiers."
  }, [
    {
      label: { zh: "由他追到底", en: "Let him finish the chase" },
      effects: { gold: CONFIG.V11_LIEUTENANT_PURSUIT_GOLD, troops: -CONFIG.V11_LIEUTENANT_PURSUIT_TROOPS }
    },
    {
      label: { zh: "鸣金把他叫回来", en: "Sound the recall" },
      effects: { renown: CONFIG.ROAD_EVENT_RENOWN_MEDIUM }
    }
  ]),
  casualEvent("chen_mang_banner", {
    zh: "陈莽把背旗插在一辆粮车上壮声势。粮车走了，旗也跟着投奔了远方。",
    en: "Chen Mang plants his back-banner on a grain cart for effect. The cart leaves, and the banner defects with it."
  }, [
    {
      label: { zh: "出钱把旗赎回来", en: "Pay to recover the banner" },
      effects: { gold: -CONFIG.ROAD_EVENT_GOLD_BIG, relation: CONFIG.ROAD_EVENT_RELATION_MEDIUM }
    },
    {
      label: { zh: "宣称这是诱敌之计", en: "Call it a feint" },
      effects: { renown: CONFIG.ROAD_EVENT_RENOWN_MEDIUM, relation: -CONFIG.ROAD_EVENT_RELATION_SMALL }
    }
  ]),
  casualEvent("chen_mang_wager", {
    zh: "陈莽和店主打赌能一口喝完一坛酒。他赢了赌，输给了桌子。",
    en: "Chen Mang wagers he can drain a wine jar in one go. He beats the wager and loses to the table."
  }, [
    {
      label: { zh: "替他付酒钱", en: "Pay his wine bill" },
      effects: { gold: -CONFIG.ROAD_EVENT_DRINK_COST, nextBattleAttackBonus: CONFIG.ROAD_EVENT_NEXT_BATTLE_ATTACK_BONUS }
    },
    {
      label: { zh: "让他留下刷碗", en: "Leave him to wash dishes" },
      effects: { relation: CONFIG.ROAD_EVENT_RELATION_MEDIUM, renown: CONFIG.ROAD_EVENT_RENOWN_SMALL }
    }
  ])
]);

export const F4_LIEUTENANT_EVENTS = Object.freeze([
  ...LIEUTENANT_EVENTS,
  casualEvent("shen_wen_watch", {
    zh: "沈稳查夜时发现哨兵都醒着——因为他每隔一刻钟就回来一次。弟兄们开始怀疑他根本不睡。",
    en: "Shen Wen finds every guard awake—because he returns every quarter hour. The company suspects he never sleeps."
  }, [
    { label: { zh: "让他继续巡", en: "Let him keep patrolling" }, effects: { renown: CONFIG.ROAD_EVENT_RENOWN_SMALL, troops: -CONFIG.ROAD_EVENT_TROOPS_SMALL } },
    { label: { zh: "替他守一更", en: "Take one watch for him" }, effects: { gold: -CONFIG.ROAD_EVENT_GOLD_SMALL, relation: CONFIG.ROAD_EVENT_RELATION_MEDIUM } }
  ]),
  casualEvent("shen_wen_bridge", {
    zh: "一座小桥吱呀作响。沈稳说一次过一个人，陈莽不在场，所以这个主意居然被听见了。",
    en: "A narrow bridge groans. Shen Wen suggests crossing one at a time; Chen Mang is absent, so the idea is actually heard."
  }, [
    { label: { zh: "按他说的过", en: "Cross as he says" }, effects: { relation: CONFIG.ROAD_EVENT_RELATION_SMALL, renown: CONFIG.ROAD_EVENT_RENOWN_SMALL } },
    { label: { zh: "出钱加固桥", en: "Pay to brace the bridge" }, effects: { gold: -CONFIG.ROAD_EVENT_GOLD_LARGE, relation: CONFIG.ROAD_EVENT_RELATION_LARGE } }
  ]),
  casualEvent("shen_wen_letter", {
    zh: "沈稳写了一封只有三行的军报，书记官读完感动得落泪：终于没有人把军报写成自传。",
    en: "Shen Wen writes a three-line dispatch. The clerk weeps with joy: at last, a report that is not an autobiography."
  }, [
    { label: { zh: "照原样发出", en: "Send it unchanged" }, effects: { renown: CONFIG.ROAD_EVENT_RENOWN_MEDIUM } },
    { label: { zh: "添两句威风话", en: "Add two grand lines" }, effects: { gold: -CONFIG.ROAD_EVENT_GOLD_TINY, relation: CONFIG.ROAD_EVENT_RELATION_MEDIUM } }
  ]),
  casualEvent("jia_duojin_ledger", {
    zh: "贾多金发现账上少了三枚铜钱。他审了半天，最后逮住了昨天的自己。",
    en: "Jia Duojin finds three coins missing from the ledger. After an inquiry, he arrests yesterday's version of himself."
  }, [
    { label: { zh: "罚他补上", en: "Make him repay it" }, effects: { gold: CONFIG.ROAD_EVENT_GOLD_SMALL, renown: CONFIG.ROAD_EVENT_RENOWN_SMALL } },
    { label: { zh: "把账抹平", en: "Balance the books" }, effects: { relation: CONFIG.ROAD_EVENT_RELATION_MEDIUM } }
  ]),
  casualEvent("jia_duojin_mule", {
    zh: "贾多金买下一头‘识路骡’，骡子径直走回原主人家。原主人称这正说明货真价实。",
    en: "Jia Duojin buys a ‘homing mule.’ It walks straight back to its former owner, who calls that proof of quality."
  }, [
    { label: { zh: "再买一次", en: "Buy it again" }, effects: { gold: -CONFIG.ROAD_EVENT_GOLD_BIG, relation: CONFIG.ROAD_EVENT_RELATION_MEDIUM } },
    { label: { zh: "改收租金", en: "Charge it rent" }, effects: { gold: CONFIG.ROAD_EVENT_GOLD_MEDIUM, renown: -CONFIG.ROAD_EVENT_RENOWN_SMALL } }
  ]),
  casualEvent("jia_duojin_coin", {
    zh: "贾多金抛铜钱决定走哪条路，铜钱掉进沟里。他立刻宣布第三条路最吉利。",
    en: "Jia Duojin flips a coin to choose the road; it falls into a ditch. He immediately declares a third road most auspicious."
  }, [
    { label: { zh: "把铜钱捞回来", en: "Recover the coin" }, effects: { troops: -CONFIG.ROAD_EVENT_TROOPS_SMALL, gold: CONFIG.ROAD_EVENT_GOLD_BIG } },
    { label: { zh: "尊重天意", en: "Respect the omen" }, effects: { renown: CONFIG.ROAD_EVENT_RENOWN_MEDIUM, relation: -CONFIG.ROAD_EVENT_RELATION_SMALL } }
  ])
]);

export const MICRO_EVENTS = CASUAL_EVENTS;
export const ROAD_EVENTS = CASUAL_EVENTS;

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

/*
 * v1.1 lieutenant combat profile.
 *
 * Deliberately its own frozen object rather than more V11_ keys on CONFIG:
 * these are the only numbers that change how a battle resolves under
 * ?v=1.1, so they are kept where they cannot be reached by a v1.0 code path.
 *
 * The engine has no HP pool -- troops are lost by count, and incoming damage
 * is divided by the defending party's defence. So the hitpoint and defence
 * bonuses combine into the one lever that exists: a resistance divisor of
 * (1 + HP) * (1 + DEF) applied to what the player takes.
 */
export const CONFIG_V11 = Object.freeze({
  LIEUTENANT_ATTACK_BONUS: 0.3,
  LIEUTENANT_HP_BONUS: 0.2,
  LIEUTENANT_DEFENSE_BONUS: 0.1,

  /*
   * Per-soldier hitpoints (v1.1 only).
   *
   * v1.0 kills a whole soldier per unit of resolved damage, which is why a
   * health bar there can only be full or empty. Under ?v=1.1 a soldier absorbs
   * HP first and only dies when his pool is spent, so a token can be struck
   * several times and the bar visibly steps down.
   *
   * Scaled against TROOP_TYPES.def (3/6/2) so toughness ordering is unchanged:
   * a veteran outlasts a militiaman, a bandit is the most brittle.
   */
  HP_PER_SOLDIER: Object.freeze({
    militia: 10,
    veteran: 20,
    bandit: 12
  }),
  HP_PER_SOLDIER_DEFAULT: 10,
  // 陈莽 soaks several rounds on his own, so his bar is the one you watch.
  LIEUTENANT_HP: 200,
  // Resolved casualties are converted to HP damage at this rate. 1 means a
  // round that would have killed one soldier in v1.0 instead spends exactly
  // one soldier's worth of hitpoints, keeping v1.1 pacing close to v1.0.
  HP_DAMAGE_PER_CASUALTY: 1.15,
  // Glancing blows are sized at this fraction of a soldier's pool, so a
  // soldier's worth of damage arrives as roughly two visible hits rather than
  // one. This is what puts a step in the bar in a small fight.
  HP_GLANCING_BLOW_FRACTION: 0.55
});
