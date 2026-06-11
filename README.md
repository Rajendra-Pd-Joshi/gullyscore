# 🏏 GullyScore — Pocket Cricket Scorer

An offline-first, installable (PWA) cricket scoring app. No backend, no build step, no
dependencies — pure HTML/CSS/JS with everything stored on the device in `localStorage`.

**Live app:** https://rajendra-pd-joshi.github.io/gullyscore/

Open the link on your phone → *Add to Home Screen* → it works fully offline from then on.

## Features

- **Ball-by-ball scoring** with real cricket rules: wides, no-balls, byes, leg-byes,
  six dismissal types (incl. run-outs with completed runs and either batter out),
  automatic strike rotation, bowler quotas, maidens, live CRR/RRR chase bar
- **Unlimited undo** — the engine is event-sourced (each innings is a log of deliveries
  replayed into state), so undo simply drops the last ball
- **Partnerships** — live current stand plus partnership-by-wicket on every scorecard
- **Graphs** — worm chart comparing both innings and a Manhattan (runs per over with
  wicket markers) per innings
- **Full scorecards** — batting with dismissal text, extras breakdown, fall of wickets,
  bowling figures, copy-as-text sharing
- **Saved teams** — squads are saved automatically from match setup and reusable
- **Rename players mid-match** — updates the whole scorebook and stats
- **Match history** — every finished match archived with result & Player of the Match
- **Career stats** — runs, HS, average, SR, 50s, wickets, best figures, economy,
  aggregated across all matches, plus record cards
- **Backup/restore** — export everything as JSON, import on a new phone
- **Configurable rules** — overs, players per side (2–11), runs per wide/no-ball
- **Light & dark themes**, autosave/resume, and a demo-match simulator

## Architecture

| File | Role |
|---|---|
| `index.html` | App shell (screens render into it) |
| `app.js` | Event-sourced scoring engine + all UI renderers |
| `styles.css` | Dark/light themes, mobile-first layout |
| `sw.js` | Service worker (network-first, offline fallback) |
| `manifest.webmanifest` | PWA install metadata |

The core idea: an innings is **a list of events** (`openers`, `newBowler`, `newBatter`,
`ball`). Every number on screen — score, batter/bowler figures, partnerships, charts,
fall of wickets — is derived by replaying that log, which makes undo trivial and the
state impossible to corrupt.

## Run locally

Any static server works:

```bash
npx serve .
```

---

Built with [Claude Code](https://claude.com/claude-code).
