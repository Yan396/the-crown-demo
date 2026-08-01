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
      toggleReport: "展开或收起边闻",
      roadEvent: "路遇抉择",
      town: "城镇招募",
      settings: "游戏设置",
      onboarding: "试玩引导",
      promise: "关于够了的承诺",
      ending: "试玩结果",
      tooltip: "提示",
      closeSettings: "关闭设置",
      pause: "暂停世界",
      resume: "继续世界",
      openSettings: "打开设置",
      newSeed: "使用新种子开始",
      share: "分享试玩结果",
      replay: "使用新种子再玩一局",
      tavern: "接受酒馆合同",
      retreat: "尝试撤退"
    }),
    brand: Object.freeze({
      title: "王冠",
      subtitle: "朋友试玩版"
    }),
    story: Object.freeze({
      opening: "边军解散,你带着最后 5 个弟兄流落河湾。传闻:乱世将至,王座虚悬。"
    }),
    hud: Object.freeze({
      gold: "金币",
      troops: "兵力",
      renown: "声望",
      day: "天数",
      wages: "-{wage}/日",
      wageGrace: "第3天起发军饷",
      renownGateAct1: "声望 {renown}/50 → 自由队长",
      renownGateAct2: "声望 {renown}/100 → 试玩终点",
      promiseCompact: "你说 {goal}",
      troopOvershoot: "兵力 {actual} ▸ 你说 {goal}",
      goldOvershoot: "金币 {actual} ▸ 你说 {goal}",
      pauseGlyph: "Ⅱ",
      resumeGlyph: "▶"
    }),
    hint: Object.freeze({
      move: "荒野与战争正在自行运转",
      battle: "交战中 · 双方正在交锋",
      paused: "世界已暂停 · 点击继续恢复行军"
    }),
    legend: Object.freeze({
      items: "朱印 我军　旌旗 领主　墨点 匪队",
      seed: "世界种子 {seed}"
    }),
    report: Object.freeze({
      march: "行军战报",
      battle: "交战记录",
      quiet: "路上暂且无事",
      verdictSureWin: "稳赢",
      verdictEven: "势均力敌",
      verdictOutmatched: "打不过",
      skip: "进攻",
      retreat: "撤退"
    }),
    townPanel: Object.freeze({
      entered: "已进入城镇",
      territory: "{faction}领地",
      recruit: "招募民兵",
      recruitCost: "花费 {cost} 金币",
      recruitCapped: "兵力已达本幕上限 {cap}",
      tavern: "酒馆合同",
      contractOffer: "为{faction}而战 · 每胜 +{reward}",
      contractActive: "受雇于{faction} · 每胜 +{reward}"
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
      saveFailed: "本地存档失败",
      contractAccepted: "已接受{faction}的雇佣合同",
      contractPaid: "合同酬金 +{reward}",
      retreatSuccess: "你甩开了匪队",
      retreatFailed: "撤退失败",
      copied: "已复制,粘贴给 Ja 就行",
      copyFailed: "复制失败，请长按下方代码",
      newSeed: "新世界种子 {seed}"
    }),
    log: Object.freeze({
      initialMove: "白色方块是你。拖动地图选择行军目标。",
      initialBattle: "靠近灰色匪队会自动交战，胜利可赢得金币与声望。",
      encounter: "遭遇匪队：我方 {playerCount} 人，敌方 {banditCount} 人。",
      battleRound: "第 {round} 轮：我方击倒 {banditLoss}，折损 {playerLoss}。",
      victory: "胜利：获得 {loot} 金币，声望 +{renown}。",
      defeat: "落败：失去 {lostGold} 金币，残部退回{town}。",
      recruit: "在{town}招募 1 名民兵，花费 {cost} 金币。",
      recruitCapped: "本幕兵力上限是 {cap}。",
      wages: "发放军饷 {wage} 金币。",
      wagesShort: "军饷不足，只发出了 {paid} 金币。",
      jackpot: "意外发现一只沉重钱箱：额外 {bonus} 金币。",
      eliteVictory: "击溃精锐匪队，战利品按三倍结算。",
      eliteSpawned: "一支精锐匪队在{town}附近现身。",
      act2: "声望传遍酒馆：你成为了自由队长。",
      contractAccepted: "在{town}接受{faction}的雇佣合同。",
      contractPaid: "履行{faction}合同，获得 {reward} 金币。",
      contractEnded: "{faction}覆亡，雇佣合同随之终止。",
      retreatSuccess: "成功撤离战场。",
      retreatFailed: "撤退失败，匪队追了上来。",
      lordRecruited: "{lord}在{town}补充了 {count} 名士兵。",
      warDeclared: "{first}向{second}宣战。",
      peaceDeclared: "{first}与{second}停战，边界保持不变。",
      siegeStarted: "{attackerLord}率{attackerFaction}军围攻{town}。",
      siegeLifted: "{town}之围解除，{attackerLord}已经退去。",
      townCaptured: "{lord}为{faction}夺取了{town}。",
      factionFallen: "{faction}失去了最后一座城镇，诸领主各奔东西。",
      lordDefected: "{lord}转投{faction}。",
      lordBattle: "{winner}击退了{loser}。",
      roadEvent: "路上遇到一桩小事，队伍停下来商量。",
      roadEventResolved: "这桩路边小事有了结果。",
      largeBanditNearby: "附近出现大股匪帮",
      banditParty: "匪队"
    }),
    map: Object.freeze({
      you: "你",
      bandit: "匪 {count}",
      eliteBandit: "精锐 {count}",
      playerSeal: "帥",
      victorySeal: "大捷",
      defeatSeal: "败退",
      act2Seal: "自由队长"
    }),
    onboarding: Object.freeze({
      seal: "王",
      title: "王冠",
      step: "{current} / 3",
      step1: "①拖动地图,你的队伍会前进",
      step2: "②灰点是匪队——打赢拿钱和声望",
      step3: "③金币每天在减少。去打猎吧",
      tap: "轻触继续",
      newSeed: "换一个世界种子"
    }),
    promise: Object.freeze({
      act1Kicker: "第一幕 · 流浪佣兵",
      act2Kicker: "第二幕 · 自由队长",
      act1Fiction: "河湾的炊烟在身后散去,五双眼睛等你拿主意。",
      act2Fiction: "你的名字先于你进了酒馆,柜台后的眼睛开始重新估价。",
      troopsQuestion: "多少兵力会让你觉得安全?",
      goldQuestion: "上一幕你说 {said} 就够,你招到了 {actual}。这一幕,多少金币才够?",
      confirm: "我记住了"
    }),
    tooltip: Object.freeze({
      town: "在这里招兵",
      lowGold: "军饷快发不出了",
      act2: "酒馆里有雇佣合同"
    }),
    roadEvent: Object.freeze({
      kicker: "路上 · 一桩小事"
    }),
    fx: Object.freeze({
      renown: "+{renown} 声望"
    }),
    ending: Object.freeze({
      seal: "试玩终",
      title: "这一程，到这里",
      mirrorTitle: "你说 / 你做",
      troops: "兵力",
      gold: "金币",
      said: "你说 {value}",
      did: "你做 {value}",
      statsTitle: "这一局",
      days: "生存天数",
      battles: "战斗",
      winRate: "胜率",
      peakTroops: "最高兵力",
      peakGold: "最高金币",
      line: "你两次上调了'够了'。完整版会问你第三次。",
      share: "把结果发给 Ja",
      replay: "再玩一局(新种子)",
      shareTitle: "《王冠》试玩结果",
      shareMessage: "我的《王冠》试玩结果:crown1.{payload}"
    }),
    decode: Object.freeze({
      seal: "C1",
      title: "《王冠》试玩结果解码器",
      description: "粘贴完整消息或 crown1. 开头的代码。数据只在当前浏览器中解码。",
      placeholder: "我的《王冠》试玩结果:crown1.…",
      button: "解码",
      invalid: "无法读取这段代码，请检查是否完整。",
      empty: "请先粘贴试玩代码。",
      sectionRun: "试玩概况",
      sectionTelemetry: "遥测明细",
      sectionStats: "结局统计",
      field: "字段",
      value: "值"
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
      toggleReport: "Expand or collapse the road ticker",
      roadEvent: "Roadside choice",
      town: "Town recruitment",
      settings: "Game settings",
      onboarding: "Demo onboarding",
      promise: "Enough promise",
      ending: "Demo result",
      tooltip: "Tip",
      closeSettings: "Close settings",
      pause: "Pause world",
      resume: "Resume world",
      openSettings: "Open settings",
      newSeed: "Start with a new seed",
      share: "Share demo result",
      replay: "Replay with a new seed",
      tavern: "Accept tavern contract",
      retreat: "Attempt to retreat"
    }),
    brand: Object.freeze({
      title: "The Crown",
      subtitle: "Friend-test demo"
    }),
    story: Object.freeze({
      opening: "The border army is disbanded. You drift into Riverbend with your last five companions. War is coming, and the throne stands empty."
    }),
    hud: Object.freeze({
      gold: "Gold",
      troops: "Troops",
      renown: "Renown",
      day: "Day",
      wages: "-{wage}/day",
      wageGrace: "Wages begin on Day 3",
      renownGateAct1: "Renown {renown}/50 → Free Captain",
      renownGateAct2: "Renown {renown}/100 → Demo End",
      promiseCompact: "You said {goal}",
      troopOvershoot: "Troops {actual} ▸ you said {goal}",
      goldOvershoot: "Gold {actual} ▸ you said {goal}",
      pauseGlyph: "Ⅱ",
      resumeGlyph: "▶"
    }),
    hint: Object.freeze({
      move: "The wilds and their wars keep moving",
      battle: "In battle · the lines are clashing",
      paused: "World paused · Resume to continue the march"
    }),
    legend: Object.freeze({
      items: "Seal you   Banner lord   Blot bandits",
      seed: "World seed {seed}"
    }),
    report: Object.freeze({
      march: "Campaign Report",
      battle: "Battle Record",
      quiet: "The road is quiet for now",
      verdictSureWin: "Easy win",
      verdictEven: "Even match",
      verdictOutmatched: "Outmatched",
      skip: "Attack",
      retreat: "Retreat"
    }),
    townPanel: Object.freeze({
      entered: "Inside town",
      territory: "{faction} territory",
      recruit: "Recruit Militia",
      recruitCost: "Costs {cost} gold",
      recruitCapped: "Act troop cap reached: {cap}",
      tavern: "Tavern Contract",
      contractOffer: "Fight for {faction} · +{reward} per win",
      contractActive: "Hired by {faction} · +{reward} per win"
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
      saveFailed: "Local save failed",
      contractAccepted: "Accepted a mercenary contract from {faction}",
      contractPaid: "Contract pay +{reward}",
      retreatSuccess: "You slipped away from the bandits",
      retreatFailed: "Retreat failed",
      copied: "Copied — paste it to Ja",
      copyFailed: "Copy failed; press and hold the code below",
      newSeed: "New world seed {seed}"
    }),
    log: Object.freeze({
      initialMove: "The white square is you. Drag the map to choose a destination.",
      initialBattle: "Approach a gray bandit party to fight automatically and earn gold and renown.",
      encounter: "Bandits encountered: {playerCount} troops against {banditCount}.",
      battleRound: "Round {round}: you felled {banditLoss} and lost {playerLoss}.",
      victory: "Victory: gained {loot} gold and {renown} renown.",
      defeat: "Defeat: lost {lostGold} gold and retreated to {town}.",
      recruit: "Recruited 1 militia in {town} for {cost} gold.",
      recruitCapped: "The troop cap for this act is {cap}.",
      wages: "Paid {wage} gold in troop wages.",
      wagesShort: "The purse was short; only {paid} gold could be paid.",
      jackpot: "A heavy coin chest yielded {bonus} bonus gold.",
      eliteVictory: "The elite bandit pack fell; loot was tripled.",
      eliteSpawned: "An elite bandit pack appeared near {town}.",
      act2: "Your name reached the taverns: you are now a Free Captain.",
      contractAccepted: "Accepted a {faction} mercenary contract in {town}.",
      contractPaid: "The {faction} contract paid {reward} gold.",
      contractEnded: "The fall of {faction} ended the mercenary contract.",
      retreatSuccess: "You withdrew from the field.",
      retreatFailed: "The retreat failed; the bandits caught up.",
      lordRecruited: "{lord} recruited {count} troops in {town}.",
      warDeclared: "{first} declared war on {second}.",
      peaceDeclared: "{first} and {second} made peace; the borders remain.",
      siegeStarted: "{attackerLord} of {attackerFaction} began the siege of {town}.",
      siegeLifted: "The siege of {town} was lifted as {attackerLord} withdrew.",
      townCaptured: "{lord} captured {town} for {faction}.",
      factionFallen: "{faction} lost its final town; its lords scattered.",
      lordDefected: "{lord} defected to {faction}.",
      lordBattle: "{winner} drove back {loser}.",
      roadEvent: "A small roadside matter brought the company to a halt.",
      roadEventResolved: "The roadside matter was settled.",
      largeBanditNearby: "A large bandit pack has appeared nearby.",
      banditParty: "bandits"
    }),
    map: Object.freeze({
      you: "You",
      bandit: "B {count}",
      eliteBandit: "Elite {count}",
      playerSeal: "P",
      victorySeal: "大捷",
      defeatSeal: "败退",
      act2Seal: "CAPT"
    }),
    onboarding: Object.freeze({
      seal: "C",
      title: "The Crown",
      step: "{current} / 3",
      step1: "①Drag the map and your party will move",
      step2: "②Gray dots are bandits—win gold and renown",
      step3: "③Your gold shrinks every day. Go hunting.",
      tap: "Tap to continue",
      newSeed: "Choose another world seed"
    }),
    promise: Object.freeze({
      act1Kicker: "Act I · Wandering Mercenary",
      act2Kicker: "Act II · Free Captain",
      act1Fiction: "Riverbend's smoke fades behind you; five pairs of eyes wait for your decision.",
      act2Fiction: "Your name reaches the tavern before you do, and the room quietly revises your price.",
      troopsQuestion: "How many troops would make you feel safe?",
      goldQuestion: "Last act you said {said} was enough, then recruited {actual}. How much gold is enough this time?",
      confirm: "Remember this"
    }),
    tooltip: Object.freeze({
      town: "Recruit troops here",
      lowGold: "Your troop wages are running out",
      act2: "Mercenary contracts wait in taverns"
    }),
    roadEvent: Object.freeze({
      kicker: "On the road · A small matter"
    }),
    fx: Object.freeze({
      renown: "+{renown} renown"
    }),
    ending: Object.freeze({
      seal: "DEMO END",
      title: "This road ends here",
      mirrorTitle: "You said / You did",
      troops: "Troops",
      gold: "Gold",
      said: "You said {value}",
      did: "You did {value}",
      statsTitle: "This run",
      days: "Days survived",
      battles: "Battles",
      winRate: "Win rate",
      peakTroops: "Peak troops",
      peakGold: "Peak gold",
      line: "Twice, you moved the line called 'enough.' The full game will ask a third time.",
      share: "Send my result to Ja",
      replay: "Play again (new seed)",
      shareTitle: "The Crown demo result",
      shareMessage: "我的《王冠》试玩结果:crown1.{payload}"
    }),
    decode: Object.freeze({
      seal: "C1",
      title: "The Crown Playtest Decoder",
      description: "Paste the full message or a crown1. code. It is decoded only in this browser.",
      placeholder: "My Crown result: crown1.…",
      button: "Decode",
      invalid: "That code could not be read. Check that it is complete.",
      empty: "Paste a playtest code first.",
      sectionRun: "Run overview",
      sectionTelemetry: "Telemetry details",
      sectionStats: "Ending stats",
      field: "Field",
      value: "Value"
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
