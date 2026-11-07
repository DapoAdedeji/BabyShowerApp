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

## Who sees what (sign-in)

Everyone lands on **`/welcome/`** and picks **Guest** or **Admin**, each with
its own password. The Cloudflare Worker (`worker/index.js`) checks every
request on the server, so typing a URL can't get round it:

| | Can open |
|---|---|
| Not signed in | Only the welcome page |
| **Guest** | Guest home (`/guest/`): **Guess That Baby** + a **view-only Leaderboard** (live, refreshes every 10s, no edit or reset) |
| **Admin** | The full app: hub, Jeopardy (+ question editor), Leaderboard with editing, everything |

Passwords are Worker secrets: **`ADMIN_PASSWORD`** and **`GUEST_PASSWORD`**
(Cloudflare dashboard: babyshowerapp, then Settings, then Variables and
Secrets; for branch previews, use `npx wrangler preview base-config secret put
<NAME>`). Sign-in lasts 30 days per device. Changing either password signs
everyone out.

**Teams & scores live on the server.** There is one copy, in Cloudflare
KV. Every admin page (Leaderboard, Jeopardy, Edit Scores, Guess That Baby
host) and every guest phone reads that same copy, so names and scores
always match everywhere. Admin pages send each change as a small action
("add 300 to team t2"), so two admin devices never overwrite each other.
Every page also re-checks every few seconds, so a change on one device
shows up on the others. Each team has a permanent id (`t1`, `t2`, …), and
games refer to teams by id. Renaming a team therefore keeps its Guess That
Baby phone and answers. See `session.js` and `/api/leaderboard` in
`worker/index.js`.

Locally, `npx serve .` has no Worker, so there's no sign-in and no API. Use
`npx wrangler dev` with a `.dev.vars` file (gitignored) containing
`ADMIN_PASSWORD=...` and `GUEST_PASSWORD=...`.

## Guess That Baby (guest phone game)

`/guess-that-baby/`: one phone per team matches every numbered baby photo
to a name.

1. **Needs the Leaderboard.** Until the host has set up teams, the game
   says so and can't start.
2. **Claim your team.** The phone picks its team from the Leaderboard teams.
   Claimed teams disappear from everyone else's list. A refresh brings the
   phone straight back with its answers.
3. **Match the babies.** One photo at a time (tap to zoom, swipe or ‹ › to
   move), with a name dropdown underneath. A name already used on another
   photo is greyed out ("used on #7"), because each name can only be used
   once per team. The **1–30 tracker** pinned at the bottom shows answered
   photos; tap a number to jump to it. Answers save to Cloudflare as you go.
4. **Host closes the round**, which locks every phone. Then **the host
   reveals**: each phone shows its score ("18 / 30 right!") and ✅/❌ with
   the correct name on every photo.

### Host view (`/guess-that-baby/host/`, admin only)

The admin hub's **Guess That Baby** card opens the host view. Admins are
always sent there, even if the same browser once joined a team as a guest,
and guests can't open it.

- **Teams:** each team shows whether its phone has joined and how many
  photos it has answered. **Release phone** frees a team whose phone died
  (answers are kept, and the next phone to pick that team carries on).
- **Round controls:** 🔒 **Close round** (locks every phone), then 🎉
  **Reveal answers** (every phone shows its score at the same moment).
  **↩ Reopen** is there in case you close too early.
- **▶ Reveal show:** full screen for the TV. It goes photo by photo:
  "Baby #n is…", then a press reveals the name and each team's guess with
  ✅/❌. It ends on the final results. Keys: → / Space for next, ← for back,
  Esc to exit.
- **🏆 Add points to Leaderboard:** **300 points per correct answer**
  (`GTB_POINTS` in the Worker), added on the server. It works from any
  admin device and can only be done once per round.
- **↺ Restart game:** releases every phone, clears all answers and starts
  a fresh round. Points already added stay on the Leaderboard.

**Photos & answers** come from a folder of photos, each **named after the
person**. The answer is the filename exactly as spelt (`Temi Coker.JPG`
gives "Temi Coker", and `kAI.JPG` gives "kAI"). To crop a photo (for
example a phone screenshot), add it to `scripts/photo_crops.json` and the
crop is applied on every upload. Load them with:

```bash
python3 scripts/seed_baby_photos.py "/path/to/Baby Photos"            # preview: processes + lists, uploads nothing
python3 scripts/seed_baby_photos.py "/path/to/Baby Photos" --upload   # upload for real
```

For each photo the script:
- turns it upright
- converts it to JPEG (HEIC and PNG work too)
- shrinks it to 1200px (it never enlarges)
- strips hidden metadata such as GPS location
- gives it a random ID, so photo URLs never contain names

It shuffles the numbering, uploads everything to KV in one go, removes the
previous upload's photos, and starts a fresh round. Teams and scores are
untouched. **Re-run it whenever new photos arrive, but before the game
starts**, because the numbering changes each time. It needs macOS and
`npx wrangler login`. Photos are served only to signed-in visitors
(`/api/gtb/photo/<id>`) and are never committed to git.

With nothing uploaded, the game falls back to a **demo set** (30
placeholder images in `guess-that-baby/demo/` and made-up names in
`worker/index.js`).

## How it's structured

```
BabyShowerApp/
├── index.html          # Welcome screen + activity menu (the "hub")
├── style.css            # Shared theme — edit CSS variables here to re-skin everything
├── app.js                # Welcome → menu transition logic
├── session.js              # Shared "who's playing" + scores (localStorage), used by every activity
├── score-editor.js         # Shared "✏️ Edit Scores" popup for settling disputes (Leaderboard + games)
├── worker/index.js         # Cloudflare Worker: serves the site + the Jeopardy question API (KV)
├── wrangler.jsonc          # Cloudflare deploy config
├── serve.json                # Disables `serve`'s clean-URL redirects (they break relative asset paths)
├── jeopardy/                   # ✅ Baby Jeopardy — fully built, see jeopardy/README.md
├── leaderboard/                  # ✅ Team setup + running league table — see below
├── welcome/                # 🔐 Sign-in page: "Guest" or "Admin", each with its own password
├── guest/                  # Guest home (2 cards) + view-only leaderboard (guest/leaderboard/)
├── guess-that-baby/        # 👶 Guess That Baby — the guest phone game (see below)
├── signout.js              # Shared "Sign out" button behaviour
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

Future activities (Karaoke, etc.) should follow the same pattern: `await
ShowerSession.ready`, check `ShowerSession.hasTeams()`, read
`ShowerSession.getTeams()` for the roster, call
`ShowerSession.addPoints(team.id, delta)` to award points, and use
`ShowerSession.onChange(fn)` to stay in step with other devices. To give a game manual score editing, include `../score-editor.js` after
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
- **Guess That Baby / Karaoke** — not built yet. Each is currently a
  one-page "Coming soon" stub matching the app's theme, ready to be replaced
  with the real thing.
