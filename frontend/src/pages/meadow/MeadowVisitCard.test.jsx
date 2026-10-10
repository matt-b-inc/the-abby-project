import { describe, expect, it } from 'vitest';
import { renderWithProviders, screen } from '../../test/render';
import MeadowVisitCard from './MeadowVisitCard';

describe('Meadow visit card', () => {
  it('offers a child-dashboard entry point to the shared world', () => {
    renderWithProviders(<MeadowVisitCard />, { withAuth: false });
    expect(screen.getByRole('link', { name: /visit your meadow/i })).toHaveAttribute('href', '/meadow');
  });
});
