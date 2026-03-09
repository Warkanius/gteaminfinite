
# Plan: Implementing The Runs Mode

We will build the actual "Runs" gameplay loop, integrating your 4-dice opponent selection, 1-by-1 reveals, gem rewards, and a "Race to 21" 3v3 format.

Here is the step-by-step approach:

## 1. Track Progress (`user_runs` Table)
We'll create a new database table to track every player's progress in a run:
- **`current_wins`**: The player's active streak. Resets to 0 on a loss.
- **`highest_wins`**: The player's all-time best streak.
- **Milestone Checking**: After every win, we'll check this streak against the JSON milestones configured in the Admin panel to grant coins, packs, and **gems**.

## 2. Admin & Rewards Update
We will update the milestone logic to fully support Gem payouts. When creating milestones in the Admin panel, you can specify `"gem_reward": 500` (for example, to match the "Game Over" tier), which the backend will safely deposit into the user's profile upon reaching that win count.

## 3. The Matchmaking & Opponent Reveal
We will create a new pre-game sequence specifically for Runs:
- **4-Dice Probabilities**: When generating the 3 CPU opponents, the system will simulate a literal 4d6 roll (rolling four 6-sided dice) to generate a number between 4 and 24. This exactly mirrors the bell-curve probability of physical dice, mapping directly to your roster indexes.
- **1-by-1 Reveal**: After you pick your 3 players, the game will present three hidden CPU cards and flip them over sequentially to build suspense before the match begins.

## 4. The Runs Game Board (Race to 21)
Because Runs is "21 by 2s and 3s. Win by two", we cannot use the standard 5v5 9-stat loop. We will build a dedicated `RunGameBoard.tsx`:
- It will cycle through your 3 players and the 3 CPU players.
- For each turn, you'll roll a stat to score points (3s, 2s, 1s based on your NBA-style engine).
- The game loop will continue infinitely until one team hits the target score (21) and is ahead by at least 2 points.

## 5. Runs Hub Page
We will build the main `/runs` page (accessible from the dashboard) where players can see their current Win Tier (Nobody I, Hooper III, Legend, etc.), track their streak, and see the next available reward.
