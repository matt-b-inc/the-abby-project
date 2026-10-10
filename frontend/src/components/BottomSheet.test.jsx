import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BottomSheet from './BottomSheet.jsx';

let historyEntries;
let historyIndex;

beforeEach(() => {
  historyEntries = [{ key: 'route', idx: 7 }];
  historyIndex = 0;
  vi.spyOn(window.history, 'state', 'get').mockImplementation(() => historyEntries[historyIndex]);
  vi.spyOn(window.history, 'pushState').mockImplementation((state) => {
    historyEntries.splice(historyIndex + 1);
    historyEntries.push(state);
    historyIndex += 1;
  });
  vi.spyOn(window.history, 'replaceState').mockImplementation((state) => {
    historyEntries[historyIndex] = state;
  });
  // Real browser history.back() delivers popstate asynchronously. A sync
  // dispatch misses the StrictMode cleanup → remount → old popstate bug.
  vi.spyOn(window.history, 'back').mockImplementation(() => {
    setTimeout(() => {
      if (historyIndex === 0) return;
      historyIndex -= 1;
      window.dispatchEvent(new PopStateEvent('popstate', { state: historyEntries[historyIndex] }));
    }, 0);
  });
});

async function settleHistory() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

afterEach(async () => {
  await settleHistory();
  vi.restoreAllMocks();
});

function renderDesktop(props = {}) {
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches: q.includes('min-width'),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  }));
  return render(
    <BottomSheet title="Title" onClose={() => {}} {...props}>
      <div>child</div>
    </BottomSheet>,
  );
}

function renderMobile(props = {}) {
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches: false,
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  }));
  return render(
    <BottomSheet title="Title" onClose={() => {}} {...props}>
      <div>child</div>
    </BottomSheet>,
  );
}

describe('BottomSheet', () => {
  it.each([
    ['desktop', renderDesktop],
    ['mobile', renderMobile],
  ])('keeps an opt-in page presentation on the %s portal surface', (_name, renderSheet) => {
    renderSheet({ title: 'Meadow journal', surfaceClassName: 'meadow-sheet', surfaceStyle: { '--meadow-paper': '#FFF8EE' } });
    const dialog = screen.getByRole('dialog', { name: 'Meadow journal' });
    expect(dialog).toHaveClass('meadow-sheet');
    expect(dialog.style.getPropertyValue('--meadow-paper')).toBe('#FFF8EE');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });
  it('renders title + children on desktop', () => {
    renderDesktop();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('child')).toBeInTheDocument();
  });

  it('renders title + children on mobile', () => {
    renderMobile();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('child')).toBeInTheDocument();
  });

  it('calls onClose when the seal button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderDesktop({ onClose });
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('disables the close button when disabled', () => {
    renderDesktop({ disabled: true });
    expect(screen.getByRole('button', { name: /close/i })).toBeDisabled();
  });

  it('reacts to matchMedia change events on mobile→desktop', () => {
    const handlers = {};
    window.matchMedia = vi.fn().mockImplementation((q) => ({
      matches: false,
      media: q,
      addEventListener: (_event, cb) => { handlers.cb = cb; },
      removeEventListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }));
    render(
      <BottomSheet title="Flex" onClose={() => {}}>
        <div>child</div>
      </BottomSheet>,
    );
    // Trigger the mql.addEventListener('change', ...) callback.
    handlers.cb?.({ matches: true });
    // No throw; component should re-render without crashing.
    expect(screen.getByText('Flex')).toBeInTheDocument();
  });

  it('exposes role=dialog with aria-modal and a labeled title on desktop', () => {
    renderDesktop({ title: 'Edit reward' });
    const dialog = screen.getByRole('dialog', { name: 'Edit reward' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('exposes role=dialog with aria-modal and a labeled title on mobile', () => {
    renderMobile({ title: 'Add chore' });
    const dialog = screen.getByRole('dialog', { name: 'Add chore' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  describe('back-gesture handling', () => {
    it('pushes a sentinel history entry on open and closes on popstate', async () => {
      const onClose = vi.fn();
      const pushSpy = vi.spyOn(window.history, 'pushState');
      renderMobile({ onClose });

      // Opening arms the sentinel so a back press has something to pop.
      expect(pushSpy).toHaveBeenCalledWith(
        expect.objectContaining({ abbySheet: expect.anything() }),
        '',
      );

      await act(async () => {
        window.history.back();
      });
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it('keeps a dirty sheet open on back and re-arms the sentinel for the next press', async () => {
      const onClose = vi.fn();
      renderMobile({ onClose, dirty: true });
      const pushSpy = vi.spyOn(window.history, 'pushState');

      await act(async () => {
        window.history.back();
      });

      // Dirty sheets route through the discard guard rather than closing…
      expect(onClose).not.toHaveBeenCalled();
      expect(await screen.findByRole('alertdialog', { name: /discard changes/i })).toBeInTheDocument();
      // …and back stays trapped for the next press.
      expect(pushSpy).toHaveBeenCalledWith(
        expect.objectContaining({ abbySheet: expect.anything() }),
        '',
      );
      expect(historyIndex).toBe(1);
      expect(pushSpy).toHaveBeenCalledTimes(2);
    });

    // Every other dismiss affordance checked `disabled`; the popstate handler
    // didn't, so Android back closed a sheet mid-save.
    it('leaves a saving sheet open on back', async () => {
      const onClose = vi.fn();
      renderMobile({ onClose, disabled: true });

      await act(async () => {
        window.dispatchEvent(new PopStateEvent('popstate'));
      });

      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'Title' })).toBeInTheDocument();
    });

    // Busy consumers pass `onClose={busy ? undefined : onClose}`; back during a
    // submit used to call it and throw inside the popstate listener.
    it('does not throw when a busy sheet has no onClose handler', async () => {
      renderMobile({ onClose: undefined, disabled: true });

      await expect(act(async () => {
        window.dispatchEvent(new PopStateEvent('popstate'));
      })).resolves.not.toThrow();

      expect(screen.getByRole('dialog', { name: 'Title' })).toBeInTheDocument();
    });
  });

  describe('history lifecycle', () => {
    it('keeps a newly opened StrictMode sheet open and consumes one sentinel on real unmount', async () => {
      const onClose = vi.fn();
      const view = render(
        <StrictMode>
          <BottomSheet title="Write in your journal" onClose={onClose}><textarea aria-label="Journal text" /></BottomSheet>
        </StrictMode>,
      );
      await settleHistory();
      expect(screen.getByRole('dialog', { name: 'Write in your journal' })).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      expect(window.history.pushState).toHaveBeenCalledTimes(1);
      expect(window.history.back).not.toHaveBeenCalled();
      expect(window.history.state).toMatchObject({ key: 'route', idx: 7, abbySheet: expect.any(String) });
      view.unmount();
      await settleHistory();
      expect(window.history.back).toHaveBeenCalledTimes(1);
      expect(window.history.state).toEqual({ key: 'route', idx: 7 });
    });

    it('dismisses only the inner sheet on back and leaves its parent open after sentinel cleanup', async () => {
      const parentClose = vi.fn();
      const innerClose = vi.fn();
      function NestedSheets() {
        const [inner, setInner] = useState(false);
        return (
          <BottomSheet title="Parent memory" onClose={parentClose}>
            <button onClick={() => setInner(true)}>Open sharing</button>
            {inner && <BottomSheet title="Sharing" onClose={() => { innerClose(); setInner(false); }}>Who can read this?</BottomSheet>}
          </BottomSheet>
        );
      }
      const user = userEvent.setup();
      render(<StrictMode><NestedSheets /></StrictMode>);
      await user.click(screen.getByRole('button', { name: 'Open sharing' }));
      expect(screen.getByRole('dialog', { name: 'Sharing' })).toBeInTheDocument();
      await act(async () => { window.history.back(); });
      await waitFor(() => expect(innerClose).toHaveBeenCalledTimes(1));
      await settleHistory();
      expect(parentClose).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'Parent memory' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: 'Sharing' })).toBeNull();
      expect(historyIndex).toBe(1);
    });

    it('reuses a retiring sheet sentinel when replacing detail with its editor', async () => {
      const editorClose = vi.fn();
      function ReplaceSheet() {
        const [editing, setEditing] = useState(false);
        return editing
          ? <BottomSheet key="editor" title="Edit entry" onClose={editorClose}>Your words</BottomSheet>
          : <BottomSheet key="detail" title="Memory" onClose={() => {}}><button onClick={() => setEditing(true)}>Edit</button></BottomSheet>;
      }
      const user = userEvent.setup();
      const view = render(<StrictMode><ReplaceSheet /></StrictMode>);
      await user.click(within(screen.getByRole('dialog', { name: 'Memory' })).getByRole('button', { name: 'Edit' }));
      await settleHistory();
      expect(screen.getByRole('dialog', { name: 'Edit entry' })).toBeInTheDocument();
      expect(editorClose).not.toHaveBeenCalled();
      expect(historyIndex).toBe(1);
      view.unmount();
      await settleHistory();
      expect(historyIndex).toBe(0);
    });

    it('does not undo a route navigation when its sheet unmounts', async () => {
      const view = renderMobile();
      window.history.pushState({ key: 'next-route', idx: 8 }, '', '/next');
      view.unmount();
      await settleHistory();
      expect(window.history.back).not.toHaveBeenCalled();
      expect(window.history.state).toEqual({ key: 'next-route', idx: 8 });
    });
  });

  describe('discard guard stacking', () => {
    it('does not discard when the close affordance is tapped a second time', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      renderMobile({ onClose, dirty: true });

      const seal = screen.getByRole('button', { name: /close/i });
      await user.click(seal);
      expect(screen.getByRole('alertdialog', { name: /discard changes/i })).toBeInTheDocument();

      // The repeat gesture belongs to the guard on top, not to the sheet
      // underneath — it used to fall straight through to onClose().
      await user.click(seal);
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.queryByRole('alertdialog', { name: /discard changes/i })).not.toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Title' })).toBeInTheDocument();
    });

    it('renders the guard backdrop over the sheet surface and makes the sheet inert', async () => {
      const user = userEvent.setup();
      renderMobile({ onClose: vi.fn(), dirty: true });

      // With only the sheet up, its own wash sits below the z-50 surface.
      expect(document.querySelector('.modal-ink-wash.z-50')).toBeNull();

      await user.click(screen.getByRole('button', { name: /close/i }));

      // The guard's wash has to clear the sheet's own z-50 surface, otherwise
      // the sheet stays undimmed and fully tappable behind an "alertdialog".
      expect(document.querySelector('.modal-ink-wash.z-50')).not.toBeNull();
      expect(screen.getByRole('dialog', { name: 'Title' }).className)
        .toContain('pointer-events-none');
    });

    it('confirming the guard closes the sheet', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      renderMobile({ onClose, dirty: true });

      await user.click(screen.getByRole('button', { name: /close/i }));
      await user.click(screen.getByRole('button', { name: 'Discard' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('sticky footer + on-screen keyboard', () => {
    it('renders the footer slot outside the scrolling body', () => {
      renderMobile({ footer: <button type="button">Save it</button> });
      expect(screen.getByRole('button', { name: 'Save it' })).toBeInTheDocument();
    });

    // dvh doesn't shrink for the keyboard, so a bottom-anchored sheet keeps
    // its full height and the keyboard covers the action row.
    it('lifts the mobile sheet above the on-screen keyboard', async () => {
      const listeners = {};
      window.visualViewport = {
        height: 800,
        offsetTop: 0,
        addEventListener: (event, cb) => { listeners[event] = cb; },
        removeEventListener: vi.fn(),
      };
      window.innerHeight = 800;

      renderMobile();
      const dialog = screen.getByRole('dialog', { name: 'Title' });
      expect(dialog.style.bottom).toBe('');

      // Keyboard up: the visual viewport shrinks, the layout viewport doesn't.
      window.visualViewport.height = 460;
      await act(async () => { listeners.resize?.(); });

      expect(dialog.style.bottom).toBe('340px');
      expect(dialog.style.maxHeight).toBe('calc(90dvh - 340px)');

      delete window.visualViewport;
    });
  });
});
