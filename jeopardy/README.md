# Baby Shower Jeopardy 🍼

A cute, host-driven Jeopardy rebuild for a baby shower. Runs entirely in the
browser — no build step, no server required, no account needed.

This is one activity inside the larger `BabyShowerApp` event hub — see
`../README.md` for the whole app.

**Teams are no longer set up here.** They're registered once on the
**Leaderboard** page and shared across every activity via `../session.js`
(localStorage). If no teams are registered yet, this page shows a "head to
the Leaderboard first" screen instead of the game. Opening this folder
standalone (without `../session.js` available) will always show that gate.

## How to run it

**Simplest:** double-click `index.html` to open it in your browser.

**Recommended for the actual event** (avoids a couple of browser quirks with
`file://` paths and lets you open it from a phone/tablet on the same wifi too):

```bash
cd "BabyShowerApp"
npx serve .
```

Then open `http://localhost:.../jeopardy/` on the laptop you're
projecting/casting to the TV — or just click **Baby Jeopardy** from the
hub's menu screen.

## How to play

0. **First time only:** register teams on the **Leaderboard** page (see
   `../leaderboard/`). Jeopardy reads that same roster — no separate setup here.
1. **Start screen** — shows the registered teams, hit **Start the Game**.
2. **Board** — click any tile to open that clue.
3. In the clue popup, read the clue aloud. Hit **▶ Start timer** if you want
   a countdown, then **Reveal Answer** (which pauses the timer).

   **Timer:** the **⏱** control in the board's header sets the default length
   for every question (5s–5m, remembered on this device), and 🔔/🔕 turns
   the time's-up chime on or off. Inside a question, **−5 / +5** changes the
   time for that question only, even while it's running. **↺** resets it. In
   the last 5 seconds the countdown turns red and pulses, and at zero you get
   a big **⏰ TIME'S UP!** with a flashing card and a chime.
4. Tap whichever team shouted the correct answer first to award them the
   points — or **No one got it** if nobody gets it. The tile is marked off
   either way. Points are saved straight to the shared Leaderboard.
5. The scoreboard at the top updates live; the leading team gets a gold
   highlight. **Disputed a point?** Tap any score (or **✏️ Edit Scores**) to
   adjust scores by hand — changes save straight to the shared Leaderboard.
6. When all clues are used (or you hit **End Game** early), you get a final
   ranked scoreboard with confetti for the winner. **Play Again** clears the
   board for another round — it does **not** reset scores, since those are
   the shared, cumulative leaderboard for the whole event.

## Editing questions on the fly (admin screen)

On the live Cloudflare site, the Jeopardy start screen has a small
**🔒 Edit questions** link (`jeopardy/admin.html`). Enter the admin password
to edit the title, categories, clues, answers and point values from any
device, including a phone. You can add, delete and reorder categories and
clues. Hit **Save** (or Ctrl/⌘+S) and the game uses the new set the next time
it's loaded.

- Saved questions live in Cloudflare KV and take priority over `questions.js`.
- **Reset to built-in questions** deletes the saved set, so the game goes back
  to `questions.js`.
- The password is the `ADMIN_PASSWORD` secret on the Worker (Cloudflare
  dashboard: babyshowerapp, then Settings, then Variables and Secrets). It's
  checked on the server and never appears in the code.
- Running locally: `npx serve .` has no API, so the game uses `questions.js`
  and the editor says it's unavailable. Use `npx wrangler dev` instead, with a
  `.dev.vars` file containing `ADMIN_PASSWORD=whatever` (gitignored).

## How to customize it — this is the whole point!

The built-in questions live in **`questions.js`**. They're used whenever
nothing has been saved from the admin screen. Open it in any text
editor. You can change:

- `title` / `subtitle` — shown on the start screen and browser tab.
- `currencyLabel` — small label next to scores (not shown on tiles currently,
  reserved for future use / easy to wire into the UI if you want it).
- `categories` — an array of `{ title, clues: [...] }`. Each category needs
  **exactly 5 clues** to match the classic Jeopardy column layout (the board
  will still render with more/fewer, but 5 is the traditional shape). Each
  clue is:
  ```js
  { value: 200, clue: "The thing you read aloud first", answer: "What's revealed after" }
  ```
- Add or remove whole categories freely — the board grid auto-adjusts to
  however many categories you include (classic Jeopardy uses 6).

No other file needs to be touched for day-to-day customization. `game.js`
and `style.css` are the engine/skin — edit those only if you want to change
*how* the game behaves or looks (see below).

## Making it match your shower's color scheme

Open `style.css` and edit the CSS variables at the very top:

```css
:root {
  --pink: #ffd6e8;
  --pink-deep: #ff9ecf;
  --blue: #cdeffd;
  --blue-deep: #8fd9f7;
  --mint: #d8f5e3;
  --butter: #fff6cf;
  ...
}
```

Swap in your palette (e.g. gender-neutral sage/terracotta, or a jungle/space
theme) and the whole UI re-themes — backgrounds, tiles, buttons, chips all
pull from these variables.

## Things that are intentionally simple (v1)

- **No buzzers / no real-time multiplayer** — this is designed for one host
  screen with everyone physically in the room shouting answers, like a living
  room game show. If you later want phones-as-buzzers, that's a bigger build
  (needs a backend for real-time sync) — just ask and we can scope it.
- **No Double Jeopardy / Final Jeopardy rounds** — single board only, by
  design, to keep party setup fast. Easy to add later as a second `questions.js`
  round if you want more game.
- **No wrong-answer penalty** — correct answers award points; incorrect ones
  just don't. Keeps things light for a party crowd rather than punishing.

## File structure

```
jeopardy/
├── index.html      # structure/markup for all 3 screens + clue modal
├── style.css        # all visual styling — theme variables at the top
├── game.js          # game logic/state — rendering, scoring, screens
├── questions.js      # ← Built-in content (fallback when nothing's saved in the admin screen)
├── admin.html/.js/.css  # 🔒 Password-protected question editor
└── README.md
```
