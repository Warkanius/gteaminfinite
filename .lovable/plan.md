
# Plan: Applying Clean Admin UI to Players & Packs

We will continue rolling out the streamlined Admin UI pattern to the **Player Cards** and **Packs & Odds** pages. 

Here is the approach for both pages:

## 1. Player Cards Admin (`AdminPlayers.tsx`)
- **Global Layout:** Wrap the main `DataTable` inside a `Card` component with a clear `CardHeader` and `CardDescription` ("Manage the roster of players, their attributes, badges, and card visuals").
- **Organized Form Editor:** Break the single long form into distinct, bordered sections (`bg-muted/30 p-4 rounded-lg border`):
  - **General Info:** Name, Gem Tier, Positions, Team.
  - **Archetype Generator:** Keep it at the top or near stats for quick access.
  - **Isolated Attributes:** Group the 9 core stats into their own highlighted grid section to separate them from the basic info and visual settings.
  - **Card Appearance:** Visually segment the HSL color pickers and preview.
  - **Badges & Traits:** Keep them in their own dedicated sections at the bottom.

## 2. Packs & Odds Admin (`AdminPacks.tsx`)
- **Global Layout:** Wrap the main `DataTable` inside a `Card` component with a description ("Manage pack pricing, odds, and player contents for the pack market").
- **Organized Form Editor (Pack Settings):** Currently, the Add/Edit pack form is a flat grid. We will divide it into:
  - **Basic Details:** Pack Name, Pack Type.
  - **Store Pricing:** Cost (Coins/Gems), 10-Box Cost. 
- **Detailed Management UI:** Add better spacing and sectioning when managing the "Pack Players" and "Odds Table" inside the detailed view.

This will bring consistency to the Admin panel, making it much easier to digest and manage data without feeling like you are looking at raw database tables.
