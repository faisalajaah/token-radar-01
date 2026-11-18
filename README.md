# token-radar-01
[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/faisalajaah/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/faisalajaah/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Description: a token launch radar ranking 200 pre-token DeFi protocols by expected launch value, with per-protocol detail and farm plans.

## What it is

A token launch radar over a sealed DefiLlama snapshot (2026-11-14, 758 protocols, 40 on the watchlist). The board ranks pre-token protocols by expected launch value — FDV implied by TVL, seven-day growth, age and chain count, times a launch probability — and gives every row a seven-step farm plan with costs and times. Protocols whose token already trades are kept apart in a Live-token view, never mixed into the ranking. The dashboard is a static page (no network, no framework) with a board, a detail view per protocol, and search, category, chain and scope filters.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22, standard library only — no install, no build step. `main.ts` reads the snapshot, writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory. Two runs on the same snapshot write identical bytes.

<sub>Entered on [make.fun](https://make.fun/?ref=9eqj58cc&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
