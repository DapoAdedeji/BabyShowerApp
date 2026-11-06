# Dapo & Desola's Baby Shower 🍼

The event hub app — meant to stay up on a TV/laptop screen throughout the
whole shower. Welcome screen → activity menu → each activity opens in place.

## How to run it

```bash
cd "BabyShowerApp"
npx serve .
```

Open the printed `http://localhost:...` address on the screen you're
projecting/casting with. (Double-clicking `index.html` also works, but
`serve` avoids a couple of `file://` browser quirks.)

## How it's structured

```
BabyShowerApp/
├── index.html          # Welcome screen + activity menu (the "hub")
├── style.css            # Shared theme — edit CSS variables here to re-skin everything
├── app.js                # Welcome → menu transition logic
├── session.js              # Shared "who's playing" + scores (localStorage), used by every activity
├── score-editor.js         # Shared "✏️ Edit Scores" popup for settling disputes (Leaderboard + games)
├── serve.json                # Disables `serve`'s clean-URL redirects (they break relative asset paths)
├── jeopardy/                   # ✅ Baby Jeopardy — fully built, see jeopardy/README.md
├── leaderboard/                  # ✅ Team setup + running league table — see below
├── slideshow/                      # 🚧 placeholder — "Coming soon"
└── karaoke/                          # 🚧 placeholder — "Coming soon"
```

Every activity is **self-contained in its own folder** with its own
`index.html` — the hub just links to them (`jeopardy/index.html`, etc). This
means:
- Building out a new activity never risks breaking the others.
- Each activity's "← Back to Menu" link returns straight to the activity
  grid (not the welcome screen) via `../index.html#menu`, so the host can
  hop between games all day without re-clicking through the welcome screen
  every time.

## Shared team roster & scoring

Teams are registered **once**, on the Leaderboard, and every activity reads
that same roster:

1. First time anyone opens **Leaderboard**, it shows a setup screen — enter
   2–6 team names, hit **Start Session**. This is saved to `localStorage`
   (`session.js`), so it persists across page loads/reloads and is visible
   to every activity on this origin.
2. **Baby Jeopardy** checks for this roster before doing anything else. No
   teams yet → it shows a "head to the Leaderboard first" screen with a
   link there, instead of the game. Teams already registered → it uses that
   exact lineup (no separate team-entry step) and **writes points straight
   back into the shared session**, so the Leaderboard reflects live scores
   during/after a game.
3. The Leaderboard's buttons:
   - **✏️ Edit Scores** — adjust any team's score by hand (±100 buttons or
     type a number) to settle disputes. Nothing saves until **Save Scores**.
     Jeopardy has the same popup: tap any score chip in the top left.
   - **🔄 Reset Scores** — every score back to 0, same teams.
   - **👥 Edit Teams** — fix a typo or change the lineup. Resets scores to 0,
     since it's meant for between games, not mid-round.
   - **🗑️ Reset Everything** — deletes teams and scores; back to setup.

Future activities (Karaoke, etc.) should follow the same pattern: check
`ShowerSession.hasTeams()` before anything else, read `ShowerSession.getTeams()`
for the roster, and call `ShowerSession.updateScore(index, delta)` to award
points. To give a game manual score editing, include `../score-editor.js` after
`session.js` and call `ScoreEditor.open({ onSave })`. See `session.js` for the
full API.

## Customizing

- **Names / welcome copy** — edit the `<h1 class="welcome-title">` in
  `index.html`.
- **Color theme (whole app)** — edit the CSS variables at the top of
  `style.css`. The `jeopardy/` folder has its own copy of the same
  variables in `jeopardy/style.css` (kept self-contained on purpose) — update
  both if you want a palette change to apply everywhere.
- **Baby Jeopardy content** — see `jeopardy/README.md`, edit `jeopardy/questions.js`.
- **Slideshow / Leaderboard / Karaoke** — not built yet. Each is currently a
  one-page "Coming soon" stub matching the app's theme, ready to be replaced
  with the real thing.
