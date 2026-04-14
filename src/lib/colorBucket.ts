/**
 * Map a card_color_primary HSL string to a broad color bucket.
 * Accepts formats like "hsl(210, 80%, 50%)" or "210 80% 50%".
 */

const BUCKETS = [
  { name: "red", min: 345, max: 15 },
  { name: "orange", min: 15, max: 45 },
  { name: "gold", min: 45, max: 65 },
  { name: "yellow", min: 65, max: 80 },
  { name: "green", min: 80, max: 160 },
  { name: "teal", min: 160, max: 200 },
  { name: "blue", min: 200, max: 260 },
  { name: "purple", min: 260, max: 300 },
  { name: "pink", min: 300, max: 345 },
] as const;

export const COLOR_BUCKET_NAMES = ["red", "orange", "gold", "yellow", "green", "teal", "blue", "purple", "pink", "white", "black"] as const;
export type ColorBucket = (typeof COLOR_BUCKET_NAMES)[number];

export function hslToColorBucket(hslString: string | null | undefined): ColorBucket | null {
  if (!hslString) return null;

  // Extract numbers from the string
  const nums = hslString.match(/[\d.]+/g);
  if (!nums || nums.length < 3) return null;

  const h = parseFloat(nums[0]);
  const s = parseFloat(nums[1]);
  const l = parseFloat(nums[2]);

  // Low saturation = white or black
  if (s < 15) {
    return l > 60 ? "white" : "black";
  }

  // Very dark
  if (l < 15) return "black";
  // Very light
  if (l > 90) return "white";

  // Hue-based bucketing
  for (const bucket of BUCKETS) {
    if (bucket.min > bucket.max) {
      // wraps around (red: 345-15)
      if (h >= bucket.min || h < bucket.max) return bucket.name;
    } else {
      if (h >= bucket.min && h < bucket.max) return bucket.name;
    }
  }

  return "red"; // fallback
}
