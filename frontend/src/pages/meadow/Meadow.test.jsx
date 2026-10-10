import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import { act, renderWithProviders, screen, waitFor } from '../../test/render';
import { buildParent, buildUser } from '../../test/factories';
import { server } from '../../test/server';
import { spyHandler } from '../../test/spy';
import Meadow from './index';
import * as meadowApi from '../../api';

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion');
  return { ...actual, AnimatePresence: ({ children }) => children };
});

const emptyMeadow = () => ({ schema_version: 1, keepsake_count: 0, journal_xp_awarded: 0, keepsakes: [] });
const bloom = (id = 42) => ({ receipt_id: `journal:${id}`, type: 'memory_bloom', title: 'Memory bloom', earned_at: '2026-10-10T18:00:00Z' });
const collected = (id = 42) => ({ schema_version: 1, keepsake_count: 1, journal_xp_awarded: 20, keepsakes: [bloom(id)] });

beforeEach(() => {
  server.use(http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())));
});

async function openCapture(user) {
  await user.click(await screen.findByRole('button', { name: /keep a memory/i }));
  await user.type(screen.getByLabelText(/what.s on your mind/i), 'A small moment I want to remember.');
}

function LocationProbe() {
  return <p data-testid="location-probe">{useLocation().pathname}</p>;
}

describe('Memory Meadow', () => {
  it('shows durable keepsakes and same-origin links without displaying journal text', async () => {
    server.use(http.get('*/api/chronicle/meadow/', () => HttpResponse.json({
      ...collected(), private_summary: 'A secret which does not belong on a bloom',
    })));
    renderWithProviders(<Meadow />);
    expect(await screen.findByText('1 bloom')).toBeInTheDocument();
    expect(screen.getByText('Memory bloom')).toBeInTheDocument();
    expect(screen.queryByText(/a secret which/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /explore in play/i })).toHaveAttribute('href', '/play/');
    expect(screen.getByRole('link', { name: /my journal/i })).toHaveAttribute('href', '/chronicle?tab=journal');
  });

  it('does not request child meadow data for a parent', async () => {
    const request = spyHandler('get', '*/api/chronicle/meadow/', emptyMeadow());
    server.use(request.handler, http.get('*/api/auth/me/', () => HttpResponse.json(buildParent())));
    renderWithProviders(<><Meadow /><LocationProbe /></>, { route: '/meadow' });
    await waitFor(() => expect(screen.getByTestId('location-probe')).toHaveTextContent(/^\/$/));
    expect(request.calls).toHaveLength(0);
  });

  it('saves a private journal through the existing form and celebrates only its confirmed new server receipt', async () => {
    let saved = false;
    const post = spyHandler('post', '*/api/chronicle/journal/', () => {
      saved = true;
      return { id: 42, is_private: true, reward_receipt: { status: 'awarded', xp_awarded: 20 } };
    });
    server.use(post.handler, http.get('*/api/chronicle/meadow/', () => HttpResponse.json(saved ? collected() : emptyMeadow())));
    const { user } = renderWithProviders(<Meadow />);
    await screen.findByText(/your first memory bloom/i);
    await openCapture(user);
    expect(screen.getByLabelText(/share with my family/i)).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Save entry' }));
    await screen.findByRole('dialog', { name: 'Memory saved' });
    expect(screen.queryByText(/a memory bloom joined your collection/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('A memory bloom joined your collection')).toBeInTheDocument();
    expect(screen.getByText('1 bloom')).toBeInTheDocument();
    expect(post.calls).toHaveLength(1);
    expect(post.calls[0].url).toMatch(/\/api\/chronicle\/journal\/$/);
    expect(post.calls[0].body).toEqual({ title: '', summary: 'A small moment I want to remember.', is_private: true, client_entry_id: expect.any(String) });
    expect(post.calls[0].body.client_entry_id).not.toBe('');
  });

  it('does not replay a known receipt when a recovered draft confirms an earlier save', async () => {
    server.use(
      http.get('*/api/chronicle/meadow/', () => HttpResponse.json(collected())),
      http.post('*/api/chronicle/journal/', () => HttpResponse.json({ id: 42, is_private: true, reward_receipt: { status: 'awarded', xp_awarded: 20 } })),
    );
    const { user } = renderWithProviders(<Meadow />);
    await screen.findByText('1 bloom');
    await openCapture(user);
    await user.click(screen.getByRole('button', { name: 'Save entry' }));
    await screen.findByRole('dialog', { name: 'Memory saved' });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('A memory bloom joined your collection')).not.toBeInTheDocument();
  });

  it('a late initial collection read cannot overwrite the collection confirmed after a save', async () => {
    const get = vi.spyOn(meadowApi, 'getMeadow');
    let releaseInitial;
    let reads = 0;
    server.use(
      http.get('*/api/chronicle/meadow/', async () => {
        reads += 1;
        if (reads > 1) return HttpResponse.json(collected());
        await new Promise((resolve) => { releaseInitial = resolve; });
        return HttpResponse.json(emptyMeadow());
      }),
      http.post('*/api/chronicle/journal/', () => HttpResponse.json({ id: 42, is_private: true })),
    );
    const { user } = renderWithProviders(<Meadow />);
    await openCapture(user);
    await user.click(screen.getByRole('button', { name: 'Save entry' }));
    await screen.findByRole('dialog', { name: 'Memory saved' });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('1 bloom')).toBeInTheDocument();
    await act(async () => { releaseInitial(); await get.mock.results[0].value; });
    await waitFor(() => expect(screen.getByText('1 bloom')).toBeInTheDocument());
    expect(screen.queryByText('0 blooms')).not.toBeInTheDocument();
    get.mockRestore();
  });

  it('edits today’s entry without celebrating an existing keepsake', async () => {
    const today = new Date().toLocaleDateString('en-CA');
    const patch = spyHandler('patch', '*/api/chronicle/42/journal/', { id: 42, is_private: true });
    server.use(patch.handler,
      http.get('*/api/chronicle/meadow/', () => HttpResponse.json(collected())),
      http.get('*/api/chronicle/journal/today/', () => HttpResponse.json({ id: 42, title: 'Today', summary: 'My first thought.', is_private: true, occurred_on: today })),
    );
    const { user } = renderWithProviders(<Meadow />);
    await user.click(await screen.findByRole('button', { name: /add to today.s entry/i }));
    await user.type(screen.getByLabelText(/what.s on your mind/i), ' Another thought.');
    await user.click(screen.getByRole('button', { name: 'Update entry' }));
    await screen.findByRole('dialog', { name: 'Entry updated' });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('A memory bloom joined your collection')).not.toBeInTheDocument();
    expect(screen.getByText('1 bloom')).toBeInTheDocument();
    expect(patch.calls).toHaveLength(1);
    expect(patch.calls[0].body).toEqual({ title: 'Today', summary: 'My first thought. Another thought.', is_private: true });
  });

  it('a duplicate create recovered as an edit cannot celebrate an existing receipt absent from the stale collection', async () => {
    let patched = false;
    const existing = { id: 42, title: 'Earlier', summary: 'Earlier memory.', is_private: true, occurred_on: new Date().toLocaleDateString('en-CA') };
    const post = spyHandler('post', '*/api/chronicle/journal/', HttpResponse.json({ existing }, { status: 409 }));
    const patch = spyHandler('patch', '*/api/chronicle/42/journal/', () => {
      patched = true;
      return { ...existing, reward_receipt: { status: 'awarded', xp_awarded: 20 } };
    });
    server.use(post.handler, patch.handler,
      http.get('*/api/chronicle/meadow/', () => HttpResponse.json(patched ? collected() : emptyMeadow())),
    );
    const { user } = renderWithProviders(<Meadow />);
    await screen.findByText('0 blooms');
    await openCapture(user);
    await user.click(screen.getByRole('button', { name: 'Save entry' }));
    await screen.findByText(/you already wrote today/i);
    await user.click(screen.getByRole('button', { name: 'Update entry' }));
    await screen.findByRole('dialog', { name: 'Entry updated' });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('1 bloom')).toBeInTheDocument();
    expect(screen.queryByText('A memory bloom joined your collection')).not.toBeInTheDocument();
    expect(post.calls).toHaveLength(1);
    expect(patch.calls).toHaveLength(1);
    expect(patch.calls[0].body).toEqual({ title: 'Earlier', summary: 'Earlier memory.\n\nA small moment I want to remember.', is_private: true });
  });

  it('keeps an uncertain save open and does not invent a bloom', async () => {
    const get = spyHandler('get', '*/api/chronicle/meadow/', emptyMeadow());
    const post = spyHandler('post', '*/api/chronicle/journal/', new HttpResponse(null, { status: 503 }));
    server.use(get.handler, post.handler);
    const { user } = renderWithProviders(<Meadow />);
    await openCapture(user);
    await user.click(screen.getByRole('button', { name: 'Save entry' }));
    expect(await screen.findByText(/we could not confirm the save/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/what.s on your mind/i)).toHaveValue('A small moment I want to remember.');
    expect(screen.queryByText('A memory bloom joined your collection')).not.toBeInTheDocument();
    expect(get.calls).toHaveLength(1);
    expect(post.calls).toHaveLength(1);
  });

  it('does not treat an unavailable reward as a keepsake', async () => {
    server.use(http.post('*/api/chronicle/journal/', () => HttpResponse.json({
      id: 42, is_private: true, reward_receipt: { status: 'unavailable' },
    })));
    const { user } = renderWithProviders(<Meadow />);
    await openCapture(user);
    await user.click(screen.getByRole('button', { name: 'Save entry' }));
    await screen.findByRole('dialog', { name: 'Memory saved' });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('A memory bloom joined your collection')).not.toBeInTheDocument();
    expect(screen.getByText('0 blooms')).toBeInTheDocument();
  });

  it('preserves the confirmed journal outcome when collection refresh fails', async () => {
    let saved = false;
    server.use(
      http.post('*/api/chronicle/journal/', () => { saved = true; return HttpResponse.json({ id: 42, is_private: true }); }),
      http.get('*/api/chronicle/meadow/', () => saved ? HttpResponse.json({ detail: 'Try later.' }, { status: 503 }) : HttpResponse.json(emptyMeadow())),
    );
    const { user } = renderWithProviders(<Meadow />);
    await openCapture(user);
    await user.click(screen.getByRole('button', { name: 'Save entry' }));
    await screen.findByRole('dialog', { name: 'Memory saved' });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText(/your entry is saved. we could not refresh/i)).toBeInTheDocument();
    expect(screen.queryByText('A memory bloom joined your collection')).not.toBeInTheDocument();
  });

  it('saying hello changes the companion response without making a reward request', async () => {
    const get = spyHandler('get', '*/api/chronicle/meadow/', emptyMeadow());
    const post = spyHandler('post', '*/api/chronicle/journal/', {});
    server.use(get.handler, post.handler);
    const { user } = renderWithProviders(<Meadow />);
    await screen.findByText('0 blooms');
    await user.click(screen.getByRole('button', { name: 'Say hello' }));
    expect(screen.getByText(/i.m happy you.re here/i)).toBeInTheDocument();
    expect(get.calls).toHaveLength(1);
    expect(post.calls).toHaveLength(0);
  });

  it('waits for today’s entry to be checked and offers retry instead of starting a duplicate capture', async () => {
    let broken = true;
    server.use(http.get('*/api/chronicle/journal/today/', () => broken
      ? HttpResponse.json({ detail: 'Today could not be checked.' }, { status: 503 })
      : new HttpResponse(null, { status: 204 })));
    const { user } = renderWithProviders(<Meadow />);
    await screen.findByText('Today could not be checked.');
    expect(screen.getByRole('button', { name: 'Keep a memory' })).toBeDisabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    broken = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Keep a memory' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Keep a memory' }));
    expect(screen.getByRole('dialog', { name: 'Write in your journal' })).toBeInTheDocument();
  });
});
