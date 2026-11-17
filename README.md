# gta6-twitch-ccu-forecast-01

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/BagusIndra111/gta6-twitch-ccu-forecast-01/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/BagusIndra111/gta6-twitch-ccu-forecast-01/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Forecast how many people watch Grand Theft Auto VI live on Twitch in each hour of its release day (2026-11-19 UTC), as five quantiles per hour. The model learns the shape of a big launch day from the case's own comparables: every past launch's release-day hourly curve, divided by its first hour, weighted toward console-only, rolling-midnight releases with no early access — the launches that unlock the way GTA VI does. The forecast anchors on the case's hour-1 print and takes the weighted median log-ratio per hour, with a spread from the weighted interquartile range of the same ratios.

## Forecast summary

The shape is the same across the four practice cases (the anchor carries the scale, the ratios carry the shape):

| hour | median vs hour 1 |
| --- | --- |
| 2 | 0.87x |
| 4 | 0.73x (night dip) |
| 19–20 | 2.55–2.64x (peak) |
| 24 | 2.09x |

Practice forecasts (median peak, from each case's hour-1 print):

| case | hour 1 | peak median | peak hour |
| --- | --- | --- | --- |
| Marvel's Wolverine | 23,357 | 59,452 | 19 |
| Red Dead Redemption 2 | 116,550 | 308,081 | 20 |
| God of War Ragnarök | 269,517 | 686,018 | 19 |
| Marvel's Spider-Man 2 | 119,087 | 303,119 | 19 |

For the final, the forecast scales with GTA VI's actual hour-1 print: the peak lands at hours 19–20 at about 2.6x hour 1, so an hour 1 of 500,000 viewers implies a peak median near 1.3 million.

Validation (leave-one-out over the 37 past launches with a complete release day in each practice case's comparables, scored by mean pinball loss on the log scale): model 0.81 vs the house baseline 0.93; on the rolling-console launches most like GTA VI, 0.24 vs 0.30.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Reads every `<id>.in` in the input directory and writes one `<id>.out` per case (`{"hours":[{"hour":2,"q":[q05,q25,q50,q75,q95]}, ...]}`, hours 2–24). Node 22, standard library only, no network. Deterministic: two runs write identical bytes, in about 0.4 s for four cases.

## License

MIT — see [LICENSE](LICENSE).

---

<sub>Entered on [make.fun](https://make.fun/?ref=pqve0qe3&utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
