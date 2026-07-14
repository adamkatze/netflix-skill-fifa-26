This template has the following screens:

Holding screen
Instruction screen
Gameplay
Game Over Score screen

flow through the screens is already set up and all helper functions are included

--- Packaging (Windows exe) ---

npm run build:exe   -> dist/FIFA26SkillGame.exe + index.html + assets/

- Ship the whole dist/ folder. Double-click the exe; it prints the LAN URL
  (port 3001) and serves the game wall / control panels / analytics pages.
- assets/ and index.html are external: front-end files can be edited next to
  the exe without a rebuild.
- db/database.db is created next to the exe on first launch (fresh tables);
  delete the db/ folder to reset analytics between event days.
- Dev requires Node >= 22.5 (node:sqlite). Run with: npm run dev
