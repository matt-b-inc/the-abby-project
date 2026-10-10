import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { server } from '../../test/server';
import { buildParent, buildUser } from '../../test/factories';
import { useRole } from '../../hooks/useRole';
import JournalConversation from './JournalConversation';
import * as chronicleApi from '../../api';

const sharedEntry = { id: 23, user: 1, kind: 'journal', is_private: false };
const response = {
  id: 9, entry: 23, author: 99, author_name: 'Dad', author_role: 'parent',
  body: 'I loved hearing about your day.', created_at: '2026-10-09T15:00:00Z',
};

function deferred() {
  let resolve;
  const promise = new Promise((finish) => { resolve = finish; });
  return { promise, resolve };
}

function AuthStatus() {
  const { user } = useRole();
  return <span>{user ? 'Signed in' : 'Signing in'}</span>;
}

function mount(entry = sharedEntry, userFixture = buildParent(), defaultOpen = true) {
  server.use(http.get('*/api/auth/me/', () => HttpResponse.json(userFixture)));
  return renderWithProviders(<><AuthStatus /><JournalConversation entry={entry} defaultOpen={defaultOpen} /></>);
}

describe('JournalConversation', () => {
  it('keeps a pending reply through collapse/reopen and merges a late read without losing it', async () => {
    const post = deferred();
    const read = deferred();
    const earlier = { ...response, id: 8, body: 'An earlier family response', created_at: '2026-10-08T15:00:00Z' };
    const spy = vi.spyOn(chronicleApi, 'addChronicleComment').mockReturnValue(post.promise);
    let reads = 0;
    server.use(http.get('*/api/chronicle/entries/23/comments/', async () => {
      reads += 1;
      if (reads === 1) return HttpResponse.json([]);
      await read.promise;
      return HttpResponse.json([earlier]);
    }));
    try {
      const { user } = mount();
      await user.type(await screen.findByRole('textbox'), response.body);
      await user.click(screen.getByRole('button', { name: 'Send response' }));
      await user.click(screen.getByRole('button', { name: /Family responses/i }));
      expect(screen.queryByRole('textbox')).toBeNull();
      await user.click(screen.getByRole('button', { name: /Family responses/i }));
      await waitFor(() => expect(reads).toBe(2));
      expect(screen.getByRole('textbox')).toBeDisabled();
      await act(async () => { post.resolve(response); await post.promise; });
      await screen.findByText('Response saved with this memory.');
      expect(screen.getByText(response.body)).toBeInTheDocument();
      await act(async () => { read.resolve(); await read.promise; });
      await screen.findByText(earlier.body);
      expect(screen.getAllByText(response.body)).toHaveLength(1);
      const items = within(screen.getByRole('list', { name: 'Responses to this memory' })).getAllByRole('listitem');
      expect(items[0]).toHaveTextContent(earlier.body);
      expect(items[1]).toHaveTextContent(response.body);
    } finally {
      post.resolve(response);
      read.resolve();
      spy.mockRestore();
    }
  });

  it('turns a stalled response into a safe check using the original UUID and body', async () => {
    const spy = vi.spyOn(chronicleApi, 'addChronicleComment')
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(response);
    const realTimeout = window.setTimeout.bind(window);
    let deadline;
    const timerSpy = vi.spyOn(window, 'setTimeout').mockImplementation((callback, delay, ...args) => {
      if (delay === 20000) { deadline = callback; return -1; }
      return realTimeout(callback, delay, ...args);
    });
    try {
      const { user } = mount();
      await user.type(await screen.findByRole('textbox'), `  ${response.body}  `);
      await user.click(screen.getByRole('button', { name: 'Send response' }));
      const original = spy.mock.calls[0][1];
      expect(screen.getByRole('textbox')).toBeDisabled();
      await act(async () => { deadline(); });
      expect(screen.getByRole('alert')).toHaveTextContent(/could not confirm/i);
      expect(screen.getByRole('button', { name: 'Check response' })).toBeEnabled();
      expect(JSON.parse(localStorage.getItem('abby:journal-response:99:23')).pending).toEqual(original);
      await user.click(screen.getByRole('button', { name: 'Check response' }));
      await screen.findByText('Response saved with this memory.');
      expect(spy.mock.calls[1][1]).toEqual(original);
      expect(original.body).toBe(response.body);
      expect(original.client_comment_id).toMatch(/^[\da-f-]{36}$/i);
      expect(screen.getAllByText(response.body)).toHaveLength(1);
    } finally {
      spy.mockRestore();
      timerSpy.mockRestore();
    }
  });

  it.each(['new draft', 'different ID', 'different pending body', 'newer text'])('preserves %s from another tab when an older unmounted save completes', async (change) => {
    const post = deferred();
    const spy = vi.spyOn(chronicleApi, 'addChronicleComment').mockReturnValue(post.promise);
    try {
      const view = mount();
      await view.user.type(await screen.findByRole('textbox'), response.body);
      await view.user.click(screen.getByRole('button', { name: 'Send response' }));
      const pending = spy.mock.calls[0][1];
      const newer = { body: pending.body, pending: { ...pending } };
      if (change === 'new draft') { newer.body = 'Another response draft'; newer.pending = null; }
      if (change === 'different ID') newer.pending.client_comment_id = '30b43a3e-bce2-484b-9146-21c3d207cf73';
      if (change === 'different pending body') newer.pending.body = 'A different pending response';
      if (change === 'newer text') newer.body = 'Additional words from the other tab';
      localStorage.setItem('abby:journal-response:99:23', JSON.stringify(newer));
      view.unmount();
      await act(async () => { post.resolve(response); await post.promise; });
      expect(JSON.parse(localStorage.getItem('abby:journal-response:99:23'))).toEqual(newer);
    } finally {
      post.resolve(response);
      spy.mockRestore();
    }
  });

  it.each(['journal', 'grade'])('never fetches or offers responses for a private %s', async (kind) => {
    let reads = 0;
    server.use(http.get('*/api/chronicle/entries/:id/comments/', () => {
      reads += 1;
      return HttpResponse.json([]);
    }));
    mount({ ...sharedEntry, kind, is_private: true }, buildUser());
    await screen.findByText('Signed in');
    expect(reads).toBe(0);
    expect(screen.queryByRole('region', { name: 'Family responses' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('loads a shared conversation only when opened and shows the author', async () => {
    let reads = 0;
    server.use(http.get('*/api/chronicle/entries/23/comments/', () => {
      reads += 1;
      return HttpResponse.json([response]);
    }));
    const { user } = mount(sharedEntry, buildParent(), false);
    const toggle = await screen.findByRole('button', { name: 'Family responses' });
    expect(reads).toBe(0);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(await screen.findByText(response.body)).toBeInTheDocument();
    expect(screen.getByText('Dad (you)')).toBeInTheDocument();
    expect(reads).toBe(1);
  });

  it('allows a family response on a shared grade using its own memory ID', async () => {
    let submitted;
    server.use(
      http.get('*/api/chronicle/entries/31/comments/', () => HttpResponse.json([])),
      http.post('*/api/chronicle/entries/31/comments/', async ({ request }) => {
        submitted = await request.json();
        return HttpResponse.json({ ...response, entry: 31, body: submitted.body }, { status: 201 });
      }),
    );
    const { user } = mount({ ...sharedEntry, id: 31, kind: 'grade' });
    await user.type(await screen.findByRole('textbox'), 'How did studying feel this time?');
    await user.click(screen.getByRole('button', { name: 'Send response' }));
    expect(await screen.findByText('Response saved with this memory.')).toBeInTheDocument();
    expect(screen.getByText('How did studying feel this time?')).toBeInTheDocument();
    expect(submitted.body).toBe('How did studying feel this time?');
  });

  it('saves a family response with its memory and a stable request identity', async () => {
    let submitted;
    server.use(
      http.get('*/api/chronicle/entries/23/comments/', () => HttpResponse.json([])),
      http.post('*/api/chronicle/entries/23/comments/', async ({ request }) => {
        submitted = await request.json();
        return HttpResponse.json({ ...response, body: submitted.body }, { status: 201 });
      }),
    );
    const { user } = mount();
    const textbox = await screen.findByRole('textbox', { name: 'Your family response' });
    await user.type(textbox, '  I am glad you told me.  ');
    await user.click(screen.getByRole('button', { name: 'Send response' }));
    expect(await screen.findByText('Response saved with this memory.')).toBeInTheDocument();
    expect(submitted.body).toBe('I am glad you told me.');
    expect(submitted.client_comment_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(textbox).toHaveValue('');
    expect(localStorage.getItem('abby:journal-response:99:23')).toBeNull();
    expect(screen.getByText('I am glad you told me.')).toBeInTheDocument();
  });

  it('restores an ambiguous save and retries its original body and ID without duplicating the response', async () => {
    const payloads = [];
    server.use(
      http.get('*/api/chronicle/entries/23/comments/', () => HttpResponse.json(payloads.length ? [response] : [])),
      http.post('*/api/chronicle/entries/23/comments/', async ({ request }) => {
        payloads.push(await request.json());
        return payloads.length === 1
          ? HttpResponse.json({ error: 'connection interrupted' }, { status: 503 })
          : HttpResponse.json(response);
      }),
    );
    const first = mount();
    await first.user.type(await screen.findByRole('textbox'), response.body);
    await first.user.click(screen.getByRole('button', { name: 'Send response' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not confirm');
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('textbox')).toHaveValue(response.body);
    first.unmount();
    const second = mount();
    expect(await screen.findByRole('textbox')).toHaveValue(response.body);
    await second.user.click(screen.getByRole('button', { name: 'Check response' }));
    await screen.findByText('Response saved with this memory.');
    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toEqual(payloads[0]);
    expect(screen.getAllByText(response.body)).toHaveLength(1);
  });

  it('keeps pending response text scoped to its entry when switching memories', async () => {
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildParent())),
      http.get('*/api/chronicle/entries/:id/comments/', () => HttpResponse.json([])),
      http.post('*/api/chronicle/entries/23/comments/', () => HttpResponse.json({ error: 'unavailable' }, { status: 503 })),
    );
    function Switcher() {
      const [entry, setEntry] = useState(sharedEntry);
      return <><button onClick={() => setEntry({ ...sharedEntry, id: 24 })}>Next memory</button><JournalConversation entry={entry} defaultOpen /></>;
    }
    const { user } = renderWithProviders(<Switcher />);
    await user.type(await screen.findByRole('textbox'), 'For the first memory');
    await user.click(screen.getByRole('button', { name: 'Send response' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Next memory' }));
    expect(await screen.findByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(localStorage.getItem('abby:journal-response:99:23')).toContain('For the first memory');
    expect(localStorage.getItem('abby:journal-response:99:24')).toBeNull();
  });

  it('shows a load error with retry rather than claiming the conversation is empty', async () => {
    let reads = 0;
    server.use(http.get('*/api/chronicle/entries/23/comments/', () => {
      reads += 1;
      return reads === 1
        ? HttpResponse.json({ error: 'Could not reach your memories.' }, { status: 503 })
        : HttpResponse.json([response]);
    }));
    const { user } = mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach your memories.');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(/No responses yet/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(response.body)).toBeInTheDocument();
  });

  it('shows a validation error beside the retained, editable response', async () => {
    server.use(
      http.get('*/api/chronicle/entries/23/comments/', () => HttpResponse.json([])),
      http.post('*/api/chronicle/entries/23/comments/', () => HttpResponse.json({ body: ['This response is too long.'] }, { status: 400 })),
    );
    const { user } = mount();
    await user.type(await screen.findByRole('textbox'), 'A response');
    await user.click(screen.getByRole('button', { name: 'Send response' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This response is too long.');
    expect(screen.getByRole('textbox')).toHaveValue('A response');
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send response' })).toBeEnabled());
  });
});
