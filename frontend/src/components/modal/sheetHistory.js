// One coordinator owns sheet sentinels so a cleanup back event cannot dismiss
// a replacement sheet or the parent of a sheet that just closed.
const sheets = [];
const retiredIds = new Set();
let listening = false;
let cleanupBackPending = false;

function topSheet() {
  for (let index = sheets.length - 1; index >= 0; index -= 1) {
    if (sheets[index].active) return sheets[index];
  }
  return null;
}

function arm(sheet) {
  if (!sheet || cleanupBackPending) return;
  const currentId = window.history.state?.abbySheet;
  if (currentId === sheet.id) return;
  const currentSheet = sheets.find((candidate) => candidate.id === currentId);
  const state = { ...window.history.state, abbySheet: sheet.id };
  // Replacing one sheet with another during the same React commit should
  // reuse the retiring sentinel rather than leaving it behind in history.
  if (retiredIds.has(currentId) || (currentSheet && !currentSheet.active)) {
    window.history.replaceState(state, '');
  } else {
    window.history.pushState(state, '');
  }
}

function stopListeningIfIdle() {
  if (sheets.length || cleanupBackPending || !listening) return;
  window.removeEventListener('popstate', handlePop);
  listening = false;
}

function handlePop() {
  if (cleanupBackPending) {
    // history.back() completes asynchronously. Consume its event before
    // arming a sheet that opened while cleanup was still in flight.
    cleanupBackPending = false;
    const currentId = window.history.state?.abbySheet;
    if (retiredIds.has(currentId)) {
      cleanupBackPending = true;
      window.history.back();
      return;
    }
    arm(topSheet());
    stopListeningIfIdle();
    return;
  }
  const sheet = topSheet();
  if (!sheet) return;
  // Re-arm before dismissal, since the dirty or busy guard may keep it open.
  arm(sheet);
  sheet.dismiss();
}

export function registerSheetHistory(id, dismiss) {
  let sheet = sheets.find((candidate) => candidate.id === id);
  if (!sheet) {
    sheet = { id, dismiss, active: true };
    sheets.push(sheet);
  } else {
    sheet.active = true;
    sheet.dismiss = dismiss;
  }
  retiredIds.delete(id);
  if (!listening) {
    window.addEventListener('popstate', handlePop);
    listening = true;
  }
  arm(sheet);

  return () => {
    sheet.active = false;
    queueMicrotask(() => {
      // StrictMode immediately repeats setup after cleanup. Its new setup
      // reactivates this same record and keeps the single sentinel intact.
      if (sheet.active) return;
      const index = sheets.indexOf(sheet);
      if (index < 0) return;
      sheets.splice(index, 1);
      retiredIds.add(id);
      // If a row navigated to a route, leave that route's history alone.
      if (!cleanupBackPending && window.history.state?.abbySheet === id) {
        cleanupBackPending = true;
        window.history.back();
      }
      stopListeningIfIdle();
    });
  };
}
