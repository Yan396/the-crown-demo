# CODEX MASTER PROMPT — "The Crown" (working title) 2D Sandbox Strategy Game

> 用法:整份文档就是给 Codex 的 prompt。分阶段投喂:先只给「PHASE 0」+「GLOBAL SPEC」,验收通过后再逐个 Phase 投喂。不要一次性让它生成整个项目。

---

## GLOBAL SPEC (include this section in EVERY Codex session)

You are building a 2D top-down sandbox strategy game inspired by Mount & Blade: the player starts as a wandering mercenary and can eventually become king. It runs entirely in the browser. Follow this spec exactly. Do not add features not listed here.

### Hard constraints
- Vanilla JavaScript (ES Modules), HTML5 Canvas for the map, plain HTML/CSS overlays for all UI. NO frameworks, NO build tools, NO external dependencies, NO backend, NO localStorage alternatives other than localStorage itself.
- Must run by opening index.html via any static server (`npx serve`). Must run at 60fps on a mid-range phone. Total assets < 2MB (Phase 0–4 use colored shapes + emoji only, no image files).
- Mobile-first controls: tap/drag on map = set move target; all panels are bottom-sheet style.
- All user-facing strings live in one `strings.js` dict with `zh` and `en` keys; default zh, toggle in settings. Code identifiers and comments in English.
- Deterministic RNG: single seeded PRNG (mulberry32), seed stored in state. Same seed = same world.

### File structure (after Phase 1 refactor; Phase 0 is a single file)
```
index.html  css/ui.css
js/main.js      — boot, requestAnimationFrame render loop, fixed 500ms logic tick (pausable)
js/state.js     — World State object, save/load (JSON ⇄ localStorage, autosave each game-day)
js/sim.js       — world tick: movement, encounters, economy, faction diplomacy
js/battle.js    — auto-resolve battle system + minimal visualization
js/ai.js        — lord state machine
js/map.js       — canvas rendering of map, towns, parties
js js/ui.js     — HUD, town menu, encounter popup, battle screen, event log, ending screens
js/data.js      — static config: factions, towns, troop types, name tables, balance numbers
js/strings.js   — zh/en UI strings
```

### Data model (state.js)
```js
state = {
  seed, tick, paused,
  player: { pos:{x,y}, moveTarget, gold:100, renown:0, act:1,
            troops:[{type:'militia',count:5,xp:0}],
            factionId:null, relations:{}, fiefs:[],
            promises:[] },            // {act, statedGoal, actualAtActEnd} — see Mirror System
  factions: [{id,name,color,rulerName,atWarWith:[],aggression:0..1}],
  towns:    [{id,name,pos,factionId,prosperity:50,garrison:[],recruitPool:10}],
  lords:    [{id,name,factionId,pos,moveTarget,troops,gold,
              aiState:'patrol'|'recruit'|'attack'|'defend'|'flee',
              targetId:null, personality:0..1}],
  bandits:  [{id,pos,moveTarget,troops}],
  eventLog: [],                        // last 50 world events, newest first
  stats: { days:0, battles:0, kills:0, goldEarned:0 }
}
```

### World tick (sim.js, every 500ms logic tick, pausable)
1. Move every party (player, lords, bandits) toward its moveTarget at fixed speed (straight line; no pathfinding).
2. Encounter check: two hostile parties within radius R → queue battle.
3. Every 20 ticks: each lord re-evaluates its AI state (see AI section).
4. Every 60 ticks = 1 game-day: economy step (taxes, wages, recruitPool +5 every 3 days cap 20, prosperity drift: besieged −2/day else +1/day cap 100), bandit spawn (1/day near random town, max 8 alive, strength = playerStrength × rand(0.5,1.3)), autosave, stats.days++.
5. Every 600 ticks: faction diplomacy roll — each faction pair relation drifts ±5; relation < −50 → 20% declare war; war > 30 game-days AND one side lost ≥2 towns → 50% peace (captured towns kept); faction with 0 towns dies, its lords defect to random faction.
The world must keep evolving when the player idles or is far away. AI lords capture towns from each other WITHOUT player involvement.

### Battle system (battle.js — auto-resolve, round-based)
- partyStrength = Σ(troop.atk × count). Each round (3s, skippable): damage = Σ(atk×count) × rand(0.8,1.2) × terrain; casualties = floor(damage / avgDef of defender), min 1. Terrain: defender in town = 1.5, field = 1.0.
- A side routs below 30% of starting troops. Winner: +50% of loser's gold, +1 renown per enemy casualty, survivors +1 xp. Player loss: never game over — lose troops & 50% gold, respawn at nearest friendly town.
- Troop types: militia(atk2 def3 cost10g wage1g/day; 3 battle-wins → veteran), veteran(atk5 def6 wage3g), bandit(atk3 def2).
- Visualization: two rows of colored squares, red flash on hit, fade on death. Nothing fancier.

### Lord AI (ai.js — state machine, re-evaluated every 20 ticks)
```
troops < 50% cap AND gold > 200        → recruit (go to nearest own town, buy troops)
enemy party near AND myStr/theirStr > 1.2 + personality×0.6 → attack
myStr/theirStr < 0.7                   → flee (to nearest own town)
own town under siege                   → defend (move there)
else                                   → patrol (between two own towns)
```
Lords with ≥2× a town's garrison strength who stay adjacent 2 game-days capture it (siege).

### Act progression (renown-gated; on each act transition show an act-intro modal — see Mirror System)
| Act | Identity | Gate | Unlocks | Target play time |
|---|---|---|---|---|
| 1 | Wandering mercenary | start | fight bandits, recruit (cap 20 troops) | 15 min |
| 2 | Free captain | renown ≥ 50 | mercenary contracts in tavern (fight for a faction, paid per battle), cap 60 | 30 min |
| 3 | Landed lord | renown ≥ 200 AND relation ≥ 50 with a faction | granted 1 town: collect its taxes, defend it, join faction wars | 60 min |
| 4 | King | renown ≥ 500 AND own ≥ 3 towns | found own faction; ALL other factions declare war; survive 30 game-days | 60 min |

### Mirror System (the game's message — implement exactly)
1. At each act-intro modal, ask the player ONE question with a numeric slider or choice, phrased as "How much is enough?" — e.g. Act1: "How many troops would make you feel safe?" Act2: "How much gold is enough?" Act3: "How many towns would be enough?" Store answer in player.promises.
2. Silently record the actual value when that act ends.
3. Ending: after surviving 30 days as king, show a final choice: 「继续征服 / Keep conquering」 vs 「就此止步 / Stop here」.
   - Keep conquering: game continues forever, renown freezes, no victory screen ever, escalating rebellions (1 random own town rebels per 10 days).
   - Stop here: THE ONLY victory screen. Stats page shows days/battles/kills AND the mirror table: each act's stated "enough" vs actual behavior (e.g. "You said 60 troops would be enough. You recruited 143."). Closing line: 「王冠不是终点,是你决定停下的那一刻。/ The crown was never the finish line. Stopping was.」 + share/screenshot button.

### Map & world content (data.js)
- One 2000×2000 world, 3 factions (北境/南盟/东部自由城邦 — red/blue/yellow), 2 towns each = 6 towns, 4 lords per faction = 12 lords. 100-entry name table for lords (generate plausible zh+en fantasy names).
- Towns = large circles with faction color ring; lords = triangles; bandits = gray dots; player = white square. Emoji labels allowed (🏰 ⚔️).

### UI list (ui.js — HTML overlays, not canvas)
1. Top HUD: gold | troops | renown | day | act | pause. 2. Town panel: recruit ×N, rest (heal = re-buy casualties at half price), tavern (Act2+ contracts). 3. Encounter popup: strength bars + [Attack / Retreat(70% success)]. 4. Battle screen (§battle). 5. Event log side drawer: world events feed — this drawer sells the "living world", keep it prominent. 6. Act-intro modals + ending screens (§mirror).

### Coding conventions
- One module per file, no circular imports; sim/battle/ai are pure functions of (state) where possible.
- Every balance number lives in data.js CONFIG object — never hardcode in logic.
- No classes required; plain objects + functions preferred. Comment each system with 2–3 lines max.

---

## PHASE 0 — PoC (single file, ~2–4h human time)
**Prompt to Codex:** Using GLOBAL SPEC above, build a SINGLE self-contained index.html (inline JS/CSS) containing ONLY: canvas map with 6 towns + 12 AI lords patrolling + bandits spawning; player square moved by tap/drag; 500ms world tick; encounter → auto-resolve battle with the round formula (text log output is fine, no battle screen); gold/renown/troops HUD; recruit button when inside a town (10g/militia). No saves, no acts, no factions warring, no strings.js — hardcode zh strings. Deterministic seed. Mobile-friendly.
**验收:** 手机浏览器打开,能拖着白方块跑、打劫匪、赢钱、进城招兵;放着不动 5 分钟,能看到领主们在地图上自己移动。
**Kill gate:** 玩 20 分钟,如果"打→钱→兵→打更大的"这个循环没有让你想再玩一局,停下重想核心循环,不要进入 Phase 1。

## PHASE 1 — refactor + save (Week 1)
Refactor Phase 0 into the file structure in GLOBAL SPEC. Add state.js save/load + autosave, strings.js zh/en, seeded PRNG module, pause. 验收: 关掉浏览器重开,进度还在;切换 en 界面全部生效。

## PHASE 2 — living world (Week 2)
Full lord AI state machine, sieges, faction diplomacy/wars, event log drawer, lord recruit/economy. 验收: 挂机 10 分钟,事件栏里出现「X 向 Y 宣战」「Z 城易主」且属实。

## PHASE 3 — Acts 1–2 (Week 3)
Act system + renown gates, act-intro modals + Mirror question #1–2, tavern mercenary contracts, veteran upgrades, battle screen visualization. 验收: 从开局打到 Act 2 接第一份合同,全程无 console error。

## PHASE 4 — Acts 3–4 + endings (Week 4)
Fief grant, taxes, town defense, founding own faction, 30-day survival, both endings + full Mirror table + stats/share screen. 验收: 能通关,结局页正确显示每一幕的「你说 vs 你做」。

## PHASE 5 — balance & ship (Week 5–6)
Playtest ≥5 full runs, tune CONFIG only (never formulas), mobile perf pass, deploy GitHub Pages, send link to 3 people. 验收: 至少 1 个非你本人的玩家自愿玩满 30 分钟。

### SPEC ERRATA (supersedes conflicting lines above)
- Art: full 「兵戈舆图」 direction is implemented (paper/ink/cinnabar
  tokens, no emoji). The "colored shapes + emoji" line is obsolete.
- Battle: presentation v2 is implemented (ink figure formations, lunge,
  casualty stains, floating damage, retreat poses). "Two rows of squares"
  is obsolete. Formulas and troop types are UNCHANGED and stay unchanged.
- Map: a town-to-town road network exists for rendering, on-road detection,
  road events, and movement-speed modifiers. Parties currently move directly
  toward targets; there is no road pathfinding.
- RULE: the codebase is the source of truth. Where this spec conflicts
  with existing code, keep the code. NEVER simplify or regress existing
  visuals/features to match older spec text. Ask before deleting anything.
