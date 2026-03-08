
# Plan: Streamlining the Admin UI

To make creating and editing Domination games (and the rest of the Admin section) much cleaner without losing any customization, we should shift from "raw database tables" to **context-aware layouts**. 

Here is the approach to overhaul the UI/UX:

## 1. Domination: Grouping by "Road"
Currently, Domination games are dumped into a single table, making it hard to see the sequence. 
- **The Fix:** We will group the Domination tab using an `Accordion` (or distinct sections) based on the `road_name`. 
- **Benefit:** You will see a dedicated section for "Seirin High", "LFO High", etc. Inside each section, the games will be neatly sorted from Order 1 to 6. This makes it visually obvious how a progression path is structured.

## 2. Smarter Form Dialogs
The current `FormDialog` for Domination is a flat grid of 6 inputs. We will organize this into clear, logical sections:
- **Match Setup:** Road Name, Opponent Name, Game Order.
- **Difficulty:** A dedicated slider or star-rating input for `difficulty_stars` instead of a plain number box.
- **Rewards:** Group the Coin Reward and Pack Reward together.
- **Pack Dropdown:** Instead of typing a pack name manually (which is prone to typos), we will fetch from the `packs` table and turn `pack_reward` into a `Select` dropdown.

## 3. "Combobox" for Opponents
While `opponent_name` is technically a free-text field, you almost always want it to match a Team you've created. We can upgrade this input to a "Combobox" (searchable dropdown). It will suggest names from your `teams` list, but still allow you to type a custom name if you want a special one-off boss without creating a full team.

## 4. Global Admin Panel Improvements
We can apply these same UX principles across all 7 Admin pages:
- **Cards & Spacing:** Wrap tables and forms in `Card` components with subtle borders and shadows to separate content from the background.
- **Clearer Typography:** Add subtext descriptions to tabs (e.g., *"Manage the sequential road maps and rewards for the Domination mode"*).
- **Player Admin:** Group the 9 core stats into an isolated "Attributes" grid, keeping them separate from general info (Name, Team, Tier) and Badges.
- **Packs Admin:** Visually separate "Store Pricing" (Coins/Gems) from "Pack Odds & Contents".

## Summary of Next Steps
If you approve, I will first update `src/pages/admin/AdminTeams.tsx` to implement the grouped Domination view, the smart dropdowns for rewards, and the organized form layouts. Once you like the feel of it, we can propagate that clean design pattern to the other admin pages.
