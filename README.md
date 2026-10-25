# MULTIHERO

80s-arcade multiplication game for the kids. Static site: HTML, CSS and ES modules, no build step,
no dependencies, no asset files beyond one pixel font. Music and sound effects are synthesised
with Web Audio.

## Run

Any static file server works (ES modules will not load from `file://`):

```
python3 -m http.server 8890 --directory /Users/admin/Projects/multihero
```

## Modes

- **Arcade**: tables up to 10x10, 3 lives, a level every 8 correct answers. The time limit per
  question shrinks each level. Levels 1-3 ease in with the 2, 5 and 10 tables
  before bringing in the rest. From level 4 there are no x1 or x10 questions, and from level 6
  no x2 either. Extra life at levels 4, 7, 10 (max 5). Three speeds that share one
  board and are tagged E/N/H on it:

  | Speed  | Start | Floor | Points |
  |--------|-------|-------|--------|
  | Easy   | 14s   | 5s    | x0.5   |
  | Normal | 9s    | 2.6s  | x1     |
  | Hard   | 4.5s  | 1.8s  | x1.5   |

- **Hardcore**: up to 12x12, 7s down to 2.2s, 1.5x score. Same x1/x10/x2 removal as arcade.
- **Practice**: one table, every fact once each way round, the square only once (19 facts for
  tables 1-10, 23 for 11 and 12), shuffled. No lives, no timer. A missed fact comes back a few questions later, and the run
  ends when all of them are answered right. Stars count first-try accuracy only: 1 at 70%, 2 at
  90%, 3 with no misses.

## Scoring

Per correct answer: `(100 + 400 x time left fraction) x combo x level factor x mode factor`.
The combo multiplier goes up by 1 every 5 in a row (max x8), and any miss resets it.
At the end, accuracy bonus = `score x 0.5 x accuracy²`.

## Data

Everything is stored per device in `localStorage` under `times-turbo.v1` (the game's original name): players (3-letter
initials), score lists for arcade and hardcore, practice bests/stars, and per-fact learning stats.
The fact stats are moving averages of error rate and answer time. Arcade and hardcore pick
questions weighted towards slow or missed facts, and the MY STATS grid shows them.

## Files

- `js/main.js`: screens, game loop, input, results
- `js/audio.js`: synth arrangements of three classical themes, sequencer and SFX
- `js/fx.js`: synthwave background, particles, flashes
- `js/storage.js`: localStorage model
