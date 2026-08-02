# Steam screenshot shot list

All six images must be uncropped 16:9 gameplay captures with no marketing
frames, debug labels, autoplay URL, cursor over text, or externally added copy.
Use one deterministic seed and the shipped zh-CN UI for the primary set; an
English set can be recaptured from the same seed.

| File | Required frame | Acceptance cue |
|---|---|---|
| `01-formation-pick.jpg` | Formation modal over a readable field encounter | Enemy rough composition and all three formations visible |
| `02-melee-peak.jpg` | Full battle stage at the densest strike beat | Cavalry, archers/volley, spear line, ink casualties all readable |
| `03-fief-siege.jpg` | Defense of a player-held town | Town terrain, defender formations, and threatened-fief context visible |
| `04-mirror-hud.jpg` | World map immediately after promise crossing | Persistent cinnabar “兵力 … ▸ 你说 …” is the visual anchor |
| `05-ending-mirror.jpg` | Ending edict at mirror table / chronicle fold | Three promise rows and at least one real chronicle line visible |
| `06-map-at-war.jpg` | Campaign map with multiple moving lord armies | Road network, ownership colors, ticker, and player title visible |

`store/screenshots/` is the checked-in output location. The list is complete,
but the PNGs are not considered complete until captured from a green native or
browser build and visually inspected at full size.
