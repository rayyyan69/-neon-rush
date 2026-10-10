# NEON RUSH: DUEL RACERS

A two-player, one-keyboard, one-screen arcade racer built with HTML5 Canvas and vanilla JavaScript.

**100% offline.** There are no frameworks, no CDNs, no web fonts, no remote images and no audio files.
All graphics are drawn on the canvas and all sound and music are generated with the Web Audio API.
After you download the files you can play with the network disabled.

## How to run offline

1. Download or clone this repository.
2. Double-click `index.html` (or drag it into Chrome, Edge, Firefox or Safari).
3. Click once or press any key so the browser allows audio, then race.

No install step, no build step and no server are needed.

### Running in VS Code
- Open the `neon-rush` folder (`File > Open Folder`) and open `index.html`.
- Either right-click `index.html` and choose **Reveal in Finder / File Explorer**, then double-click it,
  or use the optional **Live Server** extension (`Go Live`). Live Server is only a convenience; the game does not need it.
- Alternative with Python installed: `python3 -m http.server 8000` in this folder, then open `http://localhost:8000`.
  This serves local files only and is not required.

## Controls

| | Player 1 | Player 2 |
|---|---|---|
| Accelerate | W | Up arrow |
| Brake / reverse | S | Down arrow |
| Steer | A / D | Left / Right arrow |
| Nitro | Left Shift | Right Shift |
| Back on track | Q | / |

Game keys: **Esc** pause, resume or go back · **R** restart (pause menu or results screen) · **M** mute · **Enter** confirm · arrow keys or WASD move through menus.

## Modes and features

- **Quick Race**, **Grand Prix** (3 tracks, 10 / 6 points, champion at the end), **Time Trial** (cars pass through each other; gold, silver and bronze lap times) and **Practice** (endless laps).
- Laps: 1, 3, 5 or 10. Tracks: Neon City, Desert Storm, Forest Speedway.
- Garage: 6 car bodies, 9 colours and 8 bonus points to spend on acceleration, top speed, handling and nitro. Every body has the same total rating and both players get the same budget.
- Drifting, tyre smoke, skid marks, nitro flames, collisions with sparks and screen shake, pause menu, settings (music and effects volume, mute, shake, particle quality, FPS counter, fullscreen).

## Rules worth knowing

- Laps are counted by distance travelled along the track, so reversing, spinning or cutting across the infield can never add a lap.
- When one player finishes, the other has 12 seconds to cross the line or is marked DNF.
- Stuck cars are put back on the track automatically after about 3 seconds, or on demand with Q or `/`.
- Settings, garage choices and best laps are saved in the browser (`localStorage`). The game still works if storage is blocked.
- Some keyboards cannot register every key combination at once ("ghosting"). If a car stops responding when both players hold several keys, that is a hardware limit.

## Project structure

```
neon-rush/
├── index.html      page shell and all menu screens
├── css/
│   └── style.css   menus and overlays
├── js/
│   ├── tracks.js   track geometry, bridges, scenery generation
│   ├── audio.js    procedural sound effects, engines and music
│   ├── cars.js     car designs, stat model, sprite rendering
│   ├── game.js     input, physics, race logic, camera, rendering, HUD
│   └── ui.js       menus, garage, settings, results, Grand Prix
├── README.md
└── .gitignore
```

Scripts load in the order shown in `index.html`; they communicate through a few globals (`NRTracks`, `NRAudio`, `NRCars`, `NR`).

## Publishing to GitHub

Run these inside the `neon-rush` folder:

```bash
git init
git add .
git commit -m "NEON RUSH: Duel Racers"
git branch -M main
git remote add origin https://github.com/<your-username>/neon-rush.git
git push -u origin main
```

Create the empty repository on github.com first (no README or .gitignore, since this project already has them).
To play elsewhere: `git clone https://github.com/<your-username>/neon-rush.git`, then open `index.html`.
Optional: enable GitHub Pages (Settings > Pages) to also play it online, but that is not needed for offline play.
