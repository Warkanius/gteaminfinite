

# Make App Icon Logo Bigger with 3D Black Gradient Background

## Current State
The app icons (`icon-192.png`, `icon-512.png`, `favicon.ico`) contain a purple "GT" monogram on a transparent background. The logo only occupies ~22% height and ~40% width of the 512×512 canvas — quite small.

## Changes

### Regenerate all three icon files using Python/Pillow:

1. **Extract the GT logo** from the current `icon-512.png` by cropping the non-transparent content area
2. **Scale the logo up** to fill ~70-75% of the canvas (roughly 3× larger than current)
3. **Create a 3D black gradient background**:
   - Radial gradient from dark gray center (~#1a1a2e) to pure black edges
   - Subtle highlight/light spot in the upper-left area to create a 3D sphere/dome effect
   - This replaces the transparent background
4. **Composite the enlarged logo** centered on the gradient background
5. **Export** at three sizes:
   - `icon-512.png` (512×512)
   - `icon-192.png` (192×192)
   - `favicon.ico` (256×256)

### Files Modified
| File | Change |
|------|--------|
| `public/icon-512.png` | Regenerated with bigger logo + 3D gradient bg |
| `public/icon-192.png` | Regenerated (downscaled from 512) |
| `public/favicon.ico` | Regenerated (downscaled from 512) |

No code file changes needed — manifest.json and index.html already reference these paths.

