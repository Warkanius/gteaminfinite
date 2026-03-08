// Card visual inference system
// Priority: Admin Override → Gem Name Inference → Gem Tier Color → Fallback

interface CardVisuals {
  primary: string;
  secondary: string;
  glow: string;
  animation: string | null;
}

interface CardData {
  gem_name?: string | null;
  card_color_primary?: string | null;
  card_color_secondary?: string | null;
  card_glow_color?: string | null;
  card_animation?: string | null;
}

interface GemTierData {
  color?: string;
  name?: string;
}

// Base gem stone palettes: { primary, secondary, glow } as HSL strings
const GEM_STONES: Record<string, { primary: string; secondary: string; glow: string }> = {
  ruby:       { primary: "0 72% 50%",    secondary: "0 60% 35%",     glow: "0 80% 55%" },
  sapphire:   { primary: "220 75% 50%",  secondary: "220 60% 35%",   glow: "220 85% 60%" },
  emerald:    { primary: "145 55% 45%",  secondary: "145 45% 30%",   glow: "145 65% 55%" },
  diamond:    { primary: "190 80% 80%",  secondary: "200 60% 65%",   glow: "190 90% 85%" },
  amethyst:   { primary: "270 45% 55%",  secondary: "270 35% 40%",   glow: "270 55% 65%" },
  opal:       { primary: "300 40% 75%",  secondary: "180 40% 70%",   glow: "280 50% 80%" },
  pearl:      { primary: "30 20% 88%",   secondary: "30 15% 75%",    glow: "30 30% 90%" },
  garnet:     { primary: "350 65% 40%",  secondary: "350 55% 28%",   glow: "350 75% 50%" },
  onyx:       { primary: "0 0% 15%",     secondary: "0 0% 8%",       glow: "0 0% 30%" },
  topaz:      { primary: "38 85% 55%",   secondary: "38 70% 40%",    glow: "38 95% 60%" },
  tourmaline: { primary: "175 55% 45%",  secondary: "175 45% 30%",   glow: "175 65% 55%" },
  jade:       { primary: "150 40% 45%",  secondary: "150 35% 30%",   glow: "150 50% 55%" },
  moonstone:  { primary: "215 30% 75%",  secondary: "215 25% 60%",   glow: "215 40% 85%" },
  quartz:     { primary: "0 0% 85%",     secondary: "0 0% 70%",      glow: "0 0% 90%" },
  tanzanite:  { primary: "260 55% 50%",  secondary: "260 45% 35%",   glow: "260 65% 60%" },
  platinum:   { primary: "210 10% 75%",  secondary: "210 8% 60%",    glow: "210 15% 85%" },
  gold:       { primary: "51 100% 50%",  secondary: "45 80% 40%",    glow: "51 100% 55%" },
};

// Color modifiers that shift the primary/glow hue or override colors
const COLOR_MODIFIERS: Record<string, { primary: string; glow: string }> = {
  blood:        { primary: "0 80% 35%",     glow: "0 90% 45%" },
  sky:          { primary: "200 75% 65%",   glow: "200 85% 75%" },
  fire:         { primary: "15 90% 50%",    glow: "15 95% 55%" },
  flame:        { primary: "20 85% 50%",    glow: "20 90% 55%" },
  midnight:     { primary: "240 50% 25%",   glow: "240 60% 35%" },
  pink:         { primary: "330 80% 65%",   glow: "330 90% 75%" },
  purple:       { primary: "280 60% 50%",   glow: "280 70% 60%" },
  blue:         { primary: "220 70% 55%",   glow: "220 80% 65%" },
  orange:       { primary: "25 90% 55%",    glow: "25 95% 60%" },
  star:         { primary: "50 90% 60%",    glow: "50 100% 70%" },
  rainbow:      { primary: "300 60% 60%",   glow: "180 70% 65%" },
  white:        { primary: "0 0% 92%",      glow: "0 0% 95%" },
  sunflower:    { primary: "45 95% 55%",    glow: "45 100% 65%" },
  watermelon:   { primary: "350 75% 55%",   glow: "140 60% 50%" },
  iridescent:   { primary: "280 50% 70%",   glow: "180 60% 75%" },
  lemon:        { primary: "55 90% 55%",    glow: "55 95% 65%" },
  turquoise:    { primary: "175 65% 50%",   glow: "175 75% 60%" },
  mutated:      { primary: "100 70% 40%",   glow: "100 80% 50%" },
  cybertronian: { primary: "200 80% 45%",   glow: "200 90% 55%" },
  imperial:     { primary: "270 55% 40%",   glow: "270 65% 50%" },
  ice:          { primary: "195 70% 75%",   glow: "195 80% 85%" },
  dark:         { primary: "260 40% 20%",   glow: "260 50% 30%" },
  shadow:       { primary: "270 30% 18%",   glow: "270 40% 28%" },
  crystal:      { primary: "200 50% 80%",   glow: "200 60% 88%" },
  cosmic:       { primary: "270 70% 45%",   glow: "270 80% 55%" },
  neon:         { primary: "120 90% 50%",   glow: "120 100% 60%" },
  electric:     { primary: "55 100% 50%",   glow: "55 100% 60%" },
  frozen:       { primary: "200 60% 80%",   glow: "200 70% 88%" },
  volcanic:     { primary: "10 85% 40%",    glow: "10 90% 50%" },
  golden:       { primary: "45 90% 50%",    glow: "45 100% 58%" },
  silver:       { primary: "210 10% 70%",   glow: "210 15% 80%" },
  chrome:       { primary: "210 15% 65%",   glow: "210 20% 78%" },
};

const FALLBACK: CardVisuals = {
  primary: "217 33% 17%",
  secondary: "217 33% 12%",
  glow: "217 33% 25%",
  animation: null,
};

function inferFromGemName(gemName: string): Partial<CardVisuals> | null {
  const words = gemName.toLowerCase().split(/\s+/);
  
  let modifier: { primary: string; glow: string } | null = null;
  let stone: { primary: string; secondary: string; glow: string } | null = null;

  for (const word of words) {
    if (!modifier && COLOR_MODIFIERS[word]) {
      modifier = COLOR_MODIFIERS[word];
    }
    if (!stone && GEM_STONES[word]) {
      stone = GEM_STONES[word];
    }
  }

  if (modifier && stone) {
    // Modifier shifts primary/glow, stone provides secondary
    return {
      primary: modifier.primary,
      secondary: stone.secondary,
      glow: modifier.glow,
    };
  }

  if (stone) {
    return { primary: stone.primary, secondary: stone.secondary, glow: stone.glow };
  }

  if (modifier) {
    return { primary: modifier.primary, glow: modifier.glow };
  }

  return null;
}

function parseGemTierColor(color: string): Partial<CardVisuals> | null {
  if (!color) return null;
  // Assume gem_tiers.color is a CSS color string; try to use directly
  // If it looks like an HSL value (e.g. "51 100% 50%"), use it
  const hslMatch = color.match(/^\d+\s+\d+%?\s+\d+%?$/);
  if (hslMatch) {
    return { primary: color, secondary: color, glow: color };
  }
  // If it's a hex or named color, wrap for direct use
  return { primary: color, secondary: color, glow: color };
}

export function resolveCardVisuals(card: CardData, gemTier?: GemTierData | null): CardVisuals {
  const result: CardVisuals = { ...FALLBACK };

  // Layer 1: Gem tier default
  if (gemTier?.color) {
    const tierColors = parseGemTierColor(gemTier.color);
    if (tierColors) Object.assign(result, tierColors);
  }

  // Layer 2: Gem name inference
  if (card.gem_name) {
    const inferred = inferFromGemName(card.gem_name);
    if (inferred) {
      if (inferred.primary) result.primary = inferred.primary;
      if (inferred.secondary) result.secondary = inferred.secondary;
      if (inferred.glow) result.glow = inferred.glow;
    }
  }

  // Layer 3: Admin overrides (highest priority)
  if (card.card_color_primary) result.primary = card.card_color_primary;
  if (card.card_color_secondary) result.secondary = card.card_color_secondary;
  if (card.card_glow_color) result.glow = card.card_glow_color;
  if (card.card_animation) result.animation = card.card_animation;

  return result;
}

export type { CardVisuals, CardData, GemTierData };
