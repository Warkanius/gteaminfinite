

# Gem Market Data Cleanup

## Current State
All 7 gem tiers exist with correct prices. All ~70 players from your spreadsheet are already in the database with correct `gem_tier_id` and `gem_name` values. However, there are many extra cards in each tier (e.g., 37 in Gold instead of 10, 32 in Emerald instead of 10).

## What Needs to Happen
Set `gem_tier_id = NULL` for every player card **not** on your spreadsheet, so only the intended 70 cards appear in the Gem Market. No code changes needed — the GemMarket page and buy-gem-card edge function are already built and will work correctly once the data is cleaned up.

## Execution
A single batch UPDATE using the database insert tool to null out `gem_tier_id` for cards not in the approved list. The approved list (by name) across all tiers:

- **Gold (10)**: Willard Clayton, Luigi Micheaux, Gabe Monroe, Kyle Whitehead, Vince Knight, Bill Jefferson, Jeremy Terry, Dwight Buycks II, Wade McCoy, Leslie Matthews
- **Emerald (10)**: Randall Galloway, Harry Little, Dan Hanson, NF, Francis Chukwudubelu, Kevin Pangos, Mitchell Montgomery, Xavier Ware, Dee Strickland, Dexter Wingate
- **Amethyst (10)**: Damien Doyle, Dlo Nam, Richard Henderson, Lincoln Kom Trikru, Kelly Jackson, Millard Evans, Du Venevoo, Du Vueledoo, Reed Augmon, Harold Tam
- **Diamond (10)**: Watende Umaka, Donald Carrington, Jed Ledon, Jerry Hailey, Bailey Gerald, Dan Bacon, Neal Bridges, Chris Smoove, Merlin Simon, Oscar Green
- **Pink Diamond (10)**: Ictherius Tyteritrix, Bar Stanon, Shrive M'Live, Arthur Strawberry, Jermaine Washington, Mr. Money, Harrison Doyle, Rogerald Russell, TooToo McHoodie, Mumboahaohoh Jumbo
- **Actolytrene (10)**: DeWayne Watkins (Iridescent Onyx), Ultra Magnus, Mr. Gasy, Emeka Udoka, Warkanian Tranian, Bootie Mchoodie, Icandi Ghysniff, Marc Odonagadoo, Uba Wright, Semaj Pride
- **Game Over (2+)**: Anthony Watkins, Melvin Tobar Jr. (plus the "?????" entries stay as-is since they're unrevealed)

## Technical Detail
One SQL statement: `UPDATE player_cards SET gem_tier_id = NULL WHERE name NOT IN (...)` covering all 70+ approved names. The DeWayne Watkins in Game Over tier (Fire Onyx gem_name) will be preserved separately by matching on both name and gem_name.

## Files Changed
None — this is purely a data operation.

