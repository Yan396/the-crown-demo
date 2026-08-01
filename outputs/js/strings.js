export const STRINGS = Object.freeze({
  zh: Object.freeze({
    page: Object.freeze({
      title: "王冠 · 兵戈舆图",
      description: "一款关于佣兵、财富与野心的浏览器沙盒策略原型。"
    }),
    aria: Object.freeze({
      map: "王冠世界地图",
      app: "游戏界面",
      stats: "角色状态",
      legend: "地图图例",
      report: "行军战报",
      town: "城镇招募",
      settings: "游戏设置",
      closeSettings: "关闭设置",
      pause: "暂停世界",
      resume: "继续世界",
      openSettings: "打开设置"
    }),
    brand: Object.freeze({
      title: "王冠",
      subtitle: "沙盒策略原型"
    }),
    hud: Object.freeze({
      gold: "金币",
      troops: "兵力",
      renown: "声望",
      day: "天数",
      pauseGlyph: "Ⅱ",
      resumeGlyph: "▶",
      settingsGlyph: ""
    }),
    hint: Object.freeze({
      move: "轻触或拖动地图前进 · 靠近灰色匪队自动交战",
      battle: "交战中 · 每 {seconds} 秒自动进行一轮",
      paused: "世界已暂停 · 点击继续恢复行军"
    }),
    legend: Object.freeze({
      items: "朱印 我军　旌旗 领主　墨点 匪队",
      seed: "世界种子 {seed}"
    }),
    report: Object.freeze({
      march: "行军战报",
      battle: "交战记录",
      skip: "立即结算"
    }),
    townPanel: Object.freeze({
      entered: "已进入城镇",
      territory: "{faction}领地",
      recruit: "招募民兵 +1",
      recruitCost: "花费 {cost} 金币"
    }),
    settings: Object.freeze({
      title: "设置",
      closeGlyph: "×",
      language: "界面语言",
      chinese: "中文",
      english: "English",
      autosave: "本地存档",
      autosaveOn: "每个游戏日自动保存 · 已保存至第 {day} 日",
      autosaveUnavailable: "浏览器不允许本地存档"
    }),
    toast: Object.freeze({
      goldInsufficient: "金币不足",
      recruited: "民兵加入队伍",
      battleLocked: "战斗中，暂时无法行军",
      paused: "世界已暂停",
      victory: "胜利 · 金币 +{loot}",
      defeat: "落败 · 退回{town}",
      saveFailed: "本地存档失败"
    }),
    log: Object.freeze({
      initialMove: "白色方块是你。拖动地图选择行军目标。",
      initialBattle: "靠近灰色匪队会自动交战，胜利可赢得金币与声望。",
      encounter: "遭遇匪队：我方 {playerCount} 人，敌方 {banditCount} 人。",
      battleRound: "第 {round} 轮：我方击倒 {banditLoss}，折损 {playerLoss}。",
      victory: "胜利：获得 {loot} 金币，声望 +{renown}。",
      defeat: "落败：失去 {lostGold} 金币，残部退回{town}。",
      recruit: "在{town}招募 1 名民兵，花费 {cost} 金币。"
    }),
    map: Object.freeze({
      you: "你",
      bandit: "匪 {count}",
    }),
    factions: Object.freeze({
      north: "北境",
      south: "南盟",
      east: "东部自由城邦"
    }),
    towns: Object.freeze({
      frostGate: "霜门",
      blackPine: "黑松堡",
      riverBend: "河湾城",
      redHarbor: "赤霞港",
      goldenField: "金穗城",
      morningStar: "晨星港"
    }),
    lordNames: Object.freeze([
      "赫连朔", "白砚", "拓跋岑", "闻人策", "陆昭", "谢临川", "顾长风", "沈青崖", "商羽", "裴星野",
      "宁秋灯", "容海歌", "贺兰霜", "苏照夜", "慕容凛", "云无咎", "燕归尘", "江停舟", "霍沉沙", "柳千山",
      "楚怀瑾", "顾玄策", "萧照川", "林雁回", "裴知白", "宋惊鸿", "温长晏", "谢危楼", "秦照野", "陆听澜",
      "楚云岫", "叶寒声", "沈望舒", "傅青冥", "宁折光", "赵临渊", "韩砺", "卫长歌", "罗隐川", "许孤城",
      "黎星河", "周照雪", "唐远岫", "苏慕白", "崔听风", "司马烬", "独孤衡", "公孙曜", "上官离", "夏侯川",
      "欧阳朔", "诸葛澄", "皇甫峥", "令狐远", "长孙翊", "宇文晟", "东方凛", "南宫翎", "西门岳", "北堂岚",
      "秋砚书", "冬临野", "春归鹤", "夏照庭", "风逐月", "雨停云", "雪无痕", "霜落川", "星垂野", "月照关",
      "山见鹿", "海听潮", "江枕石", "河问舟", "云栖鹤", "林渡鸦", "石破军", "铁无锋", "金逐日", "木沉舟",
      "火照城", "水长天", "青玄", "赤霄", "白夜", "墨衡", "紫陌", "苍梧", "丹枫", "白玄策",
      "叶归鸿", "桑晚照", "洛长安", "沐清和", "景行止", "言无尘", "时观澜", "安定远", "乔问天", "纪寒江"
    ])
  }),
  en: Object.freeze({
    page: Object.freeze({
      title: "The Crown · War Atlas",
      description: "A browser sandbox strategy prototype about mercenaries, wealth, and ambition."
    }),
    aria: Object.freeze({
      map: "The Crown world map",
      app: "Game interface",
      stats: "Character status",
      legend: "Map legend",
      report: "Campaign report",
      town: "Town recruitment",
      settings: "Game settings",
      closeSettings: "Close settings",
      pause: "Pause world",
      resume: "Resume world",
      openSettings: "Open settings"
    }),
    brand: Object.freeze({
      title: "The Crown",
      subtitle: "Sandbox strategy prototype"
    }),
    hud: Object.freeze({
      gold: "Gold",
      troops: "Troops",
      renown: "Renown",
      day: "Day",
      pauseGlyph: "Ⅱ",
      resumeGlyph: "▶",
      settingsGlyph: ""
    }),
    hint: Object.freeze({
      move: "Tap or drag to move · Approach a gray bandit party to fight",
      battle: "In battle · One round resolves every {seconds} seconds",
      paused: "World paused · Resume to continue the march"
    }),
    legend: Object.freeze({
      items: "Seal you   Banner lord   Blot bandits",
      seed: "World seed {seed}"
    }),
    report: Object.freeze({
      march: "Campaign Report",
      battle: "Battle Record",
      skip: "Resolve Now"
    }),
    townPanel: Object.freeze({
      entered: "Inside town",
      territory: "{faction} territory",
      recruit: "Recruit Militia +1",
      recruitCost: "Costs {cost} gold"
    }),
    settings: Object.freeze({
      title: "Settings",
      closeGlyph: "×",
      language: "Interface language",
      chinese: "中文",
      english: "English",
      autosave: "Local save",
      autosaveOn: "Autosaves every game-day · Saved through Day {day}",
      autosaveUnavailable: "Local saves are unavailable in this browser"
    }),
    toast: Object.freeze({
      goldInsufficient: "Not enough gold",
      recruited: "Militia joined your party",
      battleLocked: "You cannot march during battle",
      paused: "The world is paused",
      victory: "Victory · Gold +{loot}",
      defeat: "Defeat · Retreated to {town}",
      saveFailed: "Local save failed"
    }),
    log: Object.freeze({
      initialMove: "The white square is you. Drag the map to choose a destination.",
      initialBattle: "Approach a gray bandit party to fight automatically and earn gold and renown.",
      encounter: "Bandits encountered: {playerCount} troops against {banditCount}.",
      battleRound: "Round {round}: you felled {banditLoss} and lost {playerLoss}.",
      victory: "Victory: gained {loot} gold and {renown} renown.",
      defeat: "Defeat: lost {lostGold} gold and retreated to {town}.",
      recruit: "Recruited 1 militia in {town} for {cost} gold."
    }),
    map: Object.freeze({
      you: "You",
      bandit: "B {count}",
    }),
    factions: Object.freeze({
      north: "Northern Realm",
      south: "Southern League",
      east: "Eastern Free Cities"
    }),
    towns: Object.freeze({
      frostGate: "Frostgate",
      blackPine: "Blackpine Hold",
      riverBend: "Riverbend",
      redHarbor: "Red Harbor",
      goldenField: "Goldenfield",
      morningStar: "Morningstar Port"
    }),
    lordNames: Object.freeze([
      "Arlen Frost", "Bryn Quill", "Cael Varyn", "Daria Sol", "Edrin Vale", "Faye Marrow", "Garrick Thorn", "Hela Rowan", "Ivo Kest", "Jorin Ash",
      "Kael Orin", "Lyra Fen", "Marek Dusk", "Nessa Voss", "Orrin Pike", "Petra Dawn", "Quin Alder", "Rhea Sable", "Soren Flint", "Talia Wren",
      "Ulric Snow", "Vela Rune", "Wystan Grey", "Xara Bell", "Yorren Clay", "Zelia Hart", "Alden Mere", "Brina Crow", "Corvin Hale", "Delia Reed",
      "Emric Stone", "Freya Lark", "Galen Moor", "Iris North", "Jasper Rook", "Kara Venn", "Leoric Dane", "Mira West", "Nolan Yew", "Orla Keen",
      "Perrin Fox", "Riven Lake", "Selene Birch", "Torin March", "Una Skye", "Varro Ember", "Willa Crest", "Xander Coil", "Yara Bloom", "Zoren Steel",
      "Aster Glen", "Bram Hollow", "Celia Ward", "Dorian Ray", "Elara Morn", "Finn Barrow", "Greta Snow", "Hadrian Veil", "Isolde Crane", "Jonas Grey",
      "Keira Storm", "Lucan Field", "Maeve River", "Neris Oak", "Osric Wolf", "Pella Rose", "Ronan Ford", "Sabine Low", "Theron High", "Ursa Dawn",
      "Vesper Night", "Warren Pike", "Xenia Vale", "Yves Hart", "Zara Wold", "Alric Bay", "Bea Flint", "Cyrus Dell", "Dena Frost", "Evren Moor",
      "Flora Ash", "Gideon Reed", "Hana Wren", "Idris Stone", "Jessa Mar", "Kellan Snow", "Lina Rook", "Milo Crest", "Nadia Thorn", "Oren Star",
      "Priya Gale", "Quillan North", "Rosa Mere", "Stellan Crow", "Thalia West", "Uriah Fen", "Vanna Sol", "Wes Orin", "Ysolda Dusk", "Zephyr Vale"
    ])
  })
});

function valueAtPath(source, path) {
  return path.split(".").reduce((value, key) => value?.[key], source);
}

export function translate(language, key, parameters = {}) {
  const selected = STRINGS[language] || STRINGS.zh;
  const template = valueAtPath(selected, key) ?? valueAtPath(STRINGS.zh, key) ?? key;
  if (typeof template !== "string") return String(template);
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => String(parameters[name] ?? `{${name}}`));
}

export function lordName(language, index) {
  return STRINGS[language]?.lordNames?.[index] ?? STRINGS.zh.lordNames[index] ?? String(index);
}
