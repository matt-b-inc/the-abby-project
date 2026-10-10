import presentation from '../../storybook/presentation.json';

// Vite hashes every image URL. Filenames come from the shared presentation
// contract; they never act as collection keys or economic identities.
const assets = import.meta.glob('../../storybook/assets/*.png', { eager: true, query: '?url', import: 'default' });
const art = (name) => assets[`../../storybook/assets/${name}`];

export const MEADOW_COMPANION = {
  id: presentation.companion.id,
  name: presentation.companion.label,
  portrait: art(presentation.companion.portrait),
  happyPortrait: art(presentation.companion.happy_portrait),
};

export const MEADOW_ART = {
  memoryBloom: art(presentation.keepsakes.find((item) => item.type === 'memory_bloom')?.image),
};

export const MEADOW_TOKENS = {
  '--meadow-font': '"Abby Nunito", "Trebuchet MS", "Segoe UI", system-ui, sans-serif',
  '--meadow-paper': presentation.palette.paper,
  '--meadow-ink': presentation.palette.ink,
  '--meadow-muted': presentation.palette.muted_ink,
  '--meadow-lavender': presentation.palette.lavender,
  '--meadow-lilac': presentation.palette.primary,
  '--meadow-leaf': presentation.palette.mint,
  '--meadow-grass': presentation.palette.grass,
  '--meadow-sky': presentation.palette.sky,
  '--meadow-peach': presentation.palette.accent,
  '--meadow-gold': presentation.palette.gold,
};

// The existing capture form portals to document.body. Apply its meadow
// presentation on the sheet itself rather than changing the global cover.
export const MEADOW_SHEET_TOKENS = {
  ...MEADOW_TOKENS,
  '--font-display': MEADOW_TOKENS['--meadow-font'],
  '--font-script': MEADOW_TOKENS['--meadow-font'],
  '--font-body': MEADOW_TOKENS['--meadow-font'],
  '--color-ink-page': presentation.palette.paper,
  '--color-ink-page-aged': presentation.palette.paper,
  '--color-ink-page-shadow': presentation.palette.lavender,
  '--color-ink-primary': presentation.palette.ink,
  '--color-ink-secondary': presentation.palette.muted_ink,
  '--color-ink-whisper': presentation.palette.muted_ink,
  '--color-sheikah-teal': presentation.palette.primary,
  '--color-sheikah-teal-deep': presentation.palette.primary,
  '--color-ember': presentation.palette.accent,
  '--color-ember-deep': presentation.palette.ink,
};

export function keepsakeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Saved memory' : date.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}
