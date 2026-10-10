import { describe, expect, it } from 'vitest';
import presentation from '../../storybook/presentation.json';
import { contrastRatio } from '../../utils/contrast';
import { keepsakeDate } from './meadow.constants';

describe('Meadow presentation readability', () => {
  for (const surface of ['paper', 'lavender', 'mint', 'accent', 'sky', 'grass']) {
    it(`keeps main text readable on ${surface}`, () => {
      expect(contrastRatio(presentation.palette.ink, presentation.palette[surface])).toBeGreaterThanOrEqual(4.5);
    });
  }
  for (const ink of ['muted_ink', 'primary']) {
    it(`keeps ${ink} text and actions readable on paper`, () => {
      expect(contrastRatio(presentation.palette[ink], presentation.palette.paper)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('shows a generic memory date for a malformed timestamp', () => {
    expect(keepsakeDate('not-a-date')).toBe('Saved memory');
  });
});
