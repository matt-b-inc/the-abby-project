// Asserts each endpoint function in src/api/index.js hits the right path with
// the right method. Uses a simple fetch spy rather than MSW so every case can
// be tested uniformly (query strings, FormData uploads, etc.).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './index.js';
import { setToken } from './client.js';

let fetchSpy;

function okJson(body = {}) {
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    blob: () => Promise.resolve(new Blob(['x'])),
  });
}

beforeEach(() => {
  setToken('tok');
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => okJson());
});

function lastCall() {
  const [url, init] = fetchSpy.mock.calls.at(-1);
  return { url, method: init?.method || 'GET', body: init?.body };
}

describe('auth endpoints', () => {
  it('login posts credentials', async () => {
    fetchSpy.mockImplementationOnce(() => okJson({ token: 'x', user: { id: 1 } }));
    await api.login('a', 'b');
    const { url, method, body } = lastCall();
    expect(url).toMatch(/\/api\/auth\/$/);
    expect(method).toBe('POST');
    expect(JSON.parse(body)).toEqual({ action: 'login', username: 'a', password: 'b' });
  });

  it('login stores token from response', async () => {
    setToken(null);
    fetchSpy.mockImplementationOnce(() => okJson({ token: 'abc' }));
    await api.login('a', 'b');
    expect(localStorage.getItem('abby_auth_token')).toBe('abc');
  });

  it('login skips setToken when response has no token', async () => {
    setToken(null);
    fetchSpy.mockImplementationOnce(() => okJson({}));
    await api.login('a', 'b');
    expect(localStorage.getItem('abby_auth_token')).toBeNull();
  });

  it('logout posts action + clears token', async () => {
    setToken('tok');
    await api.logout();
    expect(lastCall().method).toBe('POST');
    expect(localStorage.getItem('abby_auth_token')).toBeNull();
  });

  it('logout still clears token when server errors', async () => {
    setToken('tok');
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, status: 500, statusText: 'oops', json: () => Promise.resolve({ error: 'x' }) }),
    );
    // `finally` clears the token even as the error propagates.
    await expect(api.logout()).rejects.toThrow();
    expect(localStorage.getItem('abby_auth_token')).toBeNull();
  });

  it('getMe calls /auth/me/', async () => {
    await api.getMe();
    expect(lastCall().url).toMatch(/\/api\/auth\/me\/$/);
  });

  it('updateMe patches', async () => {
    await api.updateMe({ first_name: 'x' });
    expect(lastCall().method).toBe('PATCH');
  });
});

describe('grade memories', () => {
  it('requests a selected child and subsequent history page from the grade endpoint', async () => {
    await api.getGrades({ user_id: 23, page: 2, search: 'Art & design', unused: undefined });
    expect(lastCall().url).toMatch(/\/api\/chronicle\/grades\/\?user_id=23&page=2&search=Art%20%26%20design$/);
    expect(lastCall().method).toBe('GET');
  });

  it('preserves exact marking values and retry identity on capture', async () => {
    const payload = {
      subject: 'Math', assessment: 'Fractions quiz', grade_format: 'points',
      score: '0', possible: '20', reflection: 'I know what to practice next.',
      occurred_on: '2026-10-09', is_private: true,
      client_entry_id: '03b7faae-51b7-47c9-a6cb-56caa9460081',
    };
    await api.writeGrade(payload);
    expect(lastCall().url).toMatch(/\/api\/chronicle\/grades\/$/);
    expect(lastCall().method).toBe('POST');
    expect(JSON.parse(lastCall().body)).toEqual(payload);
  });

  it('sends sharing-only corrections without adding grade fields', async () => {
    await api.updateGradeEntry(23, { is_private: false });
    expect(lastCall().url).toMatch(/\/api\/chronicle\/23\/grade\/$/);
    expect(lastCall().method).toBe('PATCH');
    expect(JSON.parse(lastCall().body)).toEqual({ is_private: false });
  });
});

describe('journal family responses', () => {
  it('reads responses attached to one memory', async () => {
    await api.getChronicleComments(23);
    expect(lastCall().url).toMatch(/\/api\/chronicle\/entries\/23\/comments\/$/);
    expect(lastCall().method).toBe('GET');
  });

  it('posts the response and its retry identity to the same memory', async () => {
    const payload = { body: 'Tell me more!', client_comment_id: '03b7faae-51b7-47c9-a6cb-56caa9460081' };
    await api.addChronicleComment(23, payload);
    expect(lastCall().url).toMatch(/\/api\/chronicle\/entries\/23\/comments\/$/);
    expect(lastCall().method).toBe('POST');
    expect(JSON.parse(lastCall().body)).toEqual(payload);
  });
});

const CASES = [
  // [fn name, args, expected URL regex, expected method, optional body]
  ['getDashboard', [], /\/api\/dashboard\/$/, 'GET'],
  ['getProjects', [], /\/api\/projects\/$/, 'GET'],
  ['getProject', [5], /\/api\/projects\/5\/$/, 'GET'],
  ['createProject', [{ title: 'x' }], /\/api\/projects\/$/, 'POST'],
  ['updateProject', [5, { title: 'y' }], /\/api\/projects\/5\/$/, 'PATCH'],
  ['activateProject', [5], /\/api\/projects\/5\/activate\/$/, 'POST'],
  ['submitProject', [5], /\/api\/projects\/5\/submit\/$/, 'POST'],
  ['approveProject', [5], /\/api\/projects\/5\/approve\/$/, 'POST'],
  ['requestChanges', [5, 'redo'], /\/api\/projects\/5\/request-changes\/$/, 'POST'],

  ['getMilestones', [5], /\/api\/projects\/5\/milestones\/$/, 'GET'],
  ['createMilestone', [5, { title: 'x' }], /\/api\/projects\/5\/milestones\/$/, 'POST'],
  ['updateMilestone', [5, 3, { title: 'y' }], /\/api\/projects\/5\/milestones\/3\/$/, 'PATCH'],
  ['deleteMilestone', [5, 3], /\/api\/projects\/5\/milestones\/3\/$/, 'DELETE'],
  ['completeMilestone', [5, 3], /\/api\/projects\/5\/milestones\/3\/complete\/$/, 'POST'],

  ['getSteps', [5], /\/api\/projects\/5\/steps\/$/, 'GET'],
  ['createStep', [5, { title: 'x' }], /\/api\/projects\/5\/steps\/$/, 'POST'],
  ['updateStep', [5, 3, { title: 'y' }], /\/api\/projects\/5\/steps\/3\/$/, 'PATCH'],
  ['deleteStep', [5, 3], /\/api\/projects\/5\/steps\/3\/$/, 'DELETE'],
  ['completeStep', [5, 3], /\/api\/projects\/5\/steps\/3\/complete\/$/, 'POST'],
  ['uncompleteStep', [5, 3], /\/api\/projects\/5\/steps\/3\/uncomplete\/$/, 'POST'],
  ['reorderSteps', [5, [1, 2]], /\/api\/projects\/5\/steps\/reorder\/$/, 'POST'],

  ['createResource', [5, { url: 'u' }], /\/api\/projects\/5\/resources\/$/, 'POST'],
  ['updateResource', [5, 3, { url: 'u' }], /\/api\/projects\/5\/resources\/3\/$/, 'PATCH'],
  ['deleteResource', [5, 3], /\/api\/projects\/5\/resources\/3\/$/, 'DELETE'],

  ['getMaterials', [5], /\/api\/projects\/5\/materials\/$/, 'GET'],
  ['createMaterial', [5, { name: 'x' }], /\/api\/projects\/5\/materials\/$/, 'POST'],
  ['updateMaterial', [5, 3, { name: 'y' }], /\/api\/projects\/5\/materials\/3\/$/, 'PATCH'],
  ['deleteMaterial', [5, 3], /\/api\/projects\/5\/materials\/3\/$/, 'DELETE'],
  ['markPurchased', [5, 3, 9.99], /\/api\/projects\/5\/materials\/3\/mark-purchased\/$/, 'POST'],

  ['getIngestJob', ['a-b'], /\/api\/projects\/ingest\/a-b\/$/, 'GET'],
  ['updateIngestJob', ['a-b', {}], /\/api\/projects\/ingest\/a-b\/$/, 'PATCH'],
  ['commitIngestJob', ['a-b', { title: 't' }], /\/api\/projects\/ingest\/a-b\/commit\/$/, 'POST'],
  ['discardIngestJob', ['a-b'], /\/api\/projects\/ingest\/a-b\/$/, 'DELETE'],

  ['getClockStatus', [], /\/api\/clock\/$/, 'GET'],
  ['clockIn', [5], /\/api\/clock\/$/, 'POST'],
  ['clockOut', ['notes'], /\/api\/clock\/$/, 'POST'],

  ['getTimeEntries', [], /\/api\/time-entries\/$/, 'GET'],
  ['voidTimeEntry', [5], /\/api\/time-entries\/5\/void\/$/, 'POST'],
  ['getTimecards', [], /\/api\/timecards\/$/, 'GET'],
  ['getTimecard', [5], /\/api\/timecards\/5\/$/, 'GET'],
  ['approveTimecard', [5, 'ok'], /\/api\/timecards\/5\/approve\/$/, 'POST'],
  ['disputeTimecard', [5], /\/api\/timecards\/5\/dispute\/$/, 'POST'],
  ['markTimecardPaid', [5, 10], /\/api\/timecards\/5\/mark-paid\/$/, 'POST'],

  ['getBalance', [], /\/api\/balance\/$/, 'GET'],
  ['getPayments', [], /\/api\/payments\/$/, 'GET'],
  ['recordPayout', [1, 10], /\/api\/payments\/payout\/$/, 'POST'],
  ['adjustPayment', [1, 10, 'd'], /\/api\/payments\/adjust\/$/, 'POST'],
  ['adjustPayment', [1, 10], /\/api\/payments\/adjust\/$/, 'POST'], // default description

  ['getItemCatalog', [], /\/api\/items\/catalog\/$/, 'GET'],
  ['getPetSpeciesCatalog', [], /\/api\/pets\/species\/catalog\/$/, 'GET'],
  ['getQuestCatalog', [], /\/api\/quests\/catalog\/$/, 'GET'],

  ['getBadges', [], /\/api\/badges\/$/, 'GET'],
  ['createBadge', [{}], /\/api\/badges\/$/, 'POST'],
  ['updateBadge', [5, {}], /\/api\/badges\/5\/$/, 'PATCH'],
  ['deleteBadge', [5], /\/api\/badges\/5\/$/, 'DELETE'],
  ['getEarnedBadges', [], /\/api\/badges\/earned\/$/, 'GET'],
  ['getSubjects', [], /\/api\/subjects\/$/, 'GET'],
  ['createSubject', [{}], /\/api\/subjects\/$/, 'POST'],
  ['updateSubject', [5, {}], /\/api\/subjects\/5\/$/, 'PATCH'],
  ['deleteSubject', [5], /\/api\/subjects\/5\/$/, 'DELETE'],
  ['getSkills', [], /\/api\/skills\/$/, 'GET'],
  ['createSkill', [{}], /\/api\/skills\/$/, 'POST'],
  ['updateSkill', [5, {}], /\/api\/skills\/5\/$/, 'PATCH'],
  ['deleteSkill', [5], /\/api\/skills\/5\/$/, 'DELETE'],
  ['getSkillTree', [7], /\/api\/skills\/tree\/7\/$/, 'GET'],
  ['getSkillProgress', [], /\/api\/skill-progress\/$/, 'GET'],
  ['getAchievementsSummary', [], /\/api\/achievements\/summary\/$/, 'GET'],

  ['getRewards', [], /\/api\/rewards\/$/, 'GET'],
  ['deleteReward', [5], /\/api\/rewards\/5\/$/, 'DELETE'],
  ['redeemReward', [5], /\/api\/rewards\/5\/redeem\/$/, 'POST'],
  ['getRedemptions', [], /\/api\/redemptions\/$/, 'GET'],
  ['approveRedemption', [5, 'ok'], /\/api\/redemptions\/5\/approve\/$/, 'POST'],
  ['approveRedemption', [5], /\/api\/redemptions\/5\/approve\/$/, 'POST'],
  ['rejectRedemption', [5, 'nope'], /\/api\/redemptions\/5\/reject\/$/, 'POST'],
  ['rejectRedemption', [5], /\/api\/redemptions\/5\/reject\/$/, 'POST'],
  ['getCoinBalance', [], /\/api\/coins\/$/, 'GET'],
  ['adjustCoins', [1, 5, 'd'], /\/api\/coins\/adjust\/$/, 'POST'],
  ['adjustCoins', [1, 5], /\/api\/coins\/adjust\/$/, 'POST'],

  ['getExchangeRate', [], /\/api\/coins\/exchange\/rate\/$/, 'GET'],
  ['requestExchange', [5], /\/api\/coins\/exchange\/$/, 'POST'],
  ['getExchangeRequests', [], /\/api\/coins\/exchange\/list\/$/, 'GET'],
  ['approveExchange', [5, 'ok'], /\/api\/coins\/exchange\/5\/approve\/$/, 'POST'],
  ['approveExchange', [5], /\/api\/coins\/exchange\/5\/approve\/$/, 'POST'],
  ['rejectExchange', [5, 'no'], /\/api\/coins\/exchange\/5\/reject\/$/, 'POST'],
  ['rejectExchange', [5], /\/api\/coins\/exchange\/5\/reject\/$/, 'POST'],

  ['getPortfolio', [], /\/api\/portfolio\/$/, 'GET'],
  ['getPhotos', [], /\/api\/photos\/$/, 'GET'],
  ['deletePhoto', [42], /\/api\/photos\/42\/$/, 'DELETE'],
  ['deleteHomeworkProof', [7], /\/api\/homework-proofs\/7\/$/, 'DELETE'],

  ['getCategories', [], /\/api\/categories\/$/, 'GET'],
  ['createCategory', [{}], /\/api\/categories\/$/, 'POST'],
  ['updateCategory', [5, {}], /\/api\/categories\/5\/$/, 'PATCH'],
  ['deleteCategory', [5], /\/api\/categories\/5\/$/, 'DELETE'],

  ['getNotifications', [], /\/api\/notifications\/$/, 'GET'],
  ['getUnreadCount', [], /\/api\/notifications\/unread_count\/$/, 'GET'],
  ['markAllRead', [], /\/api\/notifications\/mark_all_read\/$/, 'POST'],
  ['markNotificationRead', [5], /\/api\/notifications\/5\/mark_read\/$/, 'POST'],

  ['getTemplates', [], /\/api\/templates\/$/, 'GET'],
  ['getTemplate', [5], /\/api\/templates\/5\/$/, 'GET'],
  ['updateTemplate', [5, {}], /\/api\/templates\/5\/$/, 'PATCH'],
  ['deleteTemplate', [5], /\/api\/templates\/5\/$/, 'DELETE'],
  ['createProjectFromTemplate', [5, 2], /\/api\/templates\/5\/create-project\/$/, 'POST'],
  ['saveProjectAsTemplate', [5], /\/api\/templates\/from-project\/$/, 'POST'],
  ['saveProjectAsTemplate', [5, true], /\/api\/templates\/from-project\/$/, 'POST'],

  ['getSavingsGoals', [], /\/api\/savings-goals\/$/, 'GET'],
  ['createSavingsGoal', [{}], /\/api\/savings-goals\/$/, 'POST'],
  ['updateSavingsGoal', [5, {}], /\/api\/savings-goals\/5\/$/, 'PATCH'],
  ['deleteSavingsGoal', [5], /\/api\/savings-goals\/5\/$/, 'DELETE'],

  ['getProjectSuggestions', [], /\/api\/projects\/suggestions\/$/, 'GET'],

  ['getCollaborators', [5], /\/api\/projects\/5\/collaborators\/$/, 'GET'],
  ['addCollaborator', [5, 2, 40], /\/api\/projects\/5\/collaborators\/$/, 'POST'],

  ['getChildren', [], /\/api\/children\/$/, 'GET'],
  ['updateChild', [5, {}], /\/api\/children\/5\/$/, 'PATCH'],

  ['getChores', [], /\/api\/chores\/$/, 'GET'],
  ['getChore', [5], /\/api\/chores\/5\/$/, 'GET'],
  ['createChore', [{}], /\/api\/chores\/$/, 'POST'],
  ['updateChore', [5, {}], /\/api\/chores\/5\/$/, 'PATCH'],
  ['deleteChore', [5], /\/api\/chores\/5\/$/, 'DELETE'],
  ['completeChore', [5, 'n'], /\/api\/chores\/5\/complete\/$/, 'POST'],
  ['completeChore', [5], /\/api\/chores\/5\/complete\/$/, 'POST'],
  ['approveChoreCompletion', [5], /\/api\/chore-completions\/5\/approve\/$/, 'POST'],
  ['rejectChoreCompletion', [5], /\/api\/chore-completions\/5\/reject\/$/, 'POST'],

  ['importGreenlight', [1, 'csv'], /\/api\/greenlight\/import\/$/, 'POST'],

  ['getHomeworkDashboard', [], /\/api\/homework\/dashboard\/$/, 'GET'],
  ['getHomework', [], /\/api\/homework\/$/, 'GET'],
  ['getHomeworkDetail', [5], /\/api\/homework\/5\/$/, 'GET'],
  ['createHomework', [{}], /\/api\/homework\/$/, 'POST'],
  ['updateHomework', [5, {}], /\/api\/homework\/5\/$/, 'PATCH'],
  ['deleteHomework', [5], /\/api\/homework\/5\/$/, 'DELETE'],
  ['saveHomeworkTemplate', [5], /\/api\/homework\/5\/save-template\/$/, 'POST'],
  ['planHomework', [5], /\/api\/homework\/5\/plan\/$/, 'POST'],
  ['approveHomeworkSubmission', [5], /\/api\/homework-submissions\/5\/approve\/$/, 'POST'],
  ['rejectHomeworkSubmission', [5], /\/api\/homework-submissions\/5\/reject\/$/, 'POST'],
  ['getHomeworkTemplates', [], /\/api\/homework-templates\/$/, 'GET'],
  ['createHomeworkTemplate', [{}], /\/api\/homework-templates\/$/, 'POST'],
  ['deleteHomeworkTemplate', [5], /\/api\/homework-templates\/5\/$/, 'DELETE'],
  ['createAssignmentFromTemplate', [5, {}], /\/api\/homework-templates\/5\/create-assignment\/$/, 'POST'],

  ['getCharacterProfile', [], /\/api\/character\/$/, 'GET'],
  ['getStreaks', [], /\/api\/streaks\/$/, 'GET'],
  ['getHabits', [], /\/api\/habits\/$/, 'GET'],
  ['createHabit', [{}], /\/api\/habits\/$/, 'POST'],
  ['updateHabit', [5, {}], /\/api\/habits\/5\/$/, 'PATCH'],
  ['deleteHabit', [5], /\/api\/habits\/5\/$/, 'DELETE'],
  ['logHabitTap', [5, 1], /\/api\/habits\/5\/log\/$/, 'POST'],
  ['getInventory', [], /\/api\/inventory\/$/, 'GET'],
  ['getRecentDrops', [], /\/api\/drops\/recent\/$/, 'GET'],

  ['getStable', [], /\/api\/pets\/stable\/$/, 'GET'],
  ['hatchPet', [1, 2], /\/api\/pets\/hatch\/$/, 'POST'],
  ['feedPet', [1, 2], /\/api\/pets\/1\/feed\/$/, 'POST'],
  ['activatePet', [1], /\/api\/pets\/1\/activate\/$/, 'POST'],
  ['getMounts', [], /\/api\/mounts\/$/, 'GET'],
  ['activateMount', [1], /\/api\/mounts\/1\/activate\/$/, 'POST'],

  ['getCosmetics', [], /\/api\/cosmetics\/$/, 'GET'],
  ['equipCosmetic', [1], /\/api\/character\/equip\/$/, 'POST'],
  ['unequipCosmetic', ['frame'], /\/api\/character\/unequip\/$/, 'POST'],

  ['getActiveQuest', [], /\/api\/quests\/active\/$/, 'GET'],
  ['getAvailableQuests', [], /\/api\/quests\/available\/$/, 'GET'],
  ['startQuest', [1, 2], /\/api\/quests\/start\/$/, 'POST'],
  ['getQuestHistory', [], /\/api\/quests\/history\/$/, 'GET'],
  ['createQuest', [{}], /\/api\/quests\/$/, 'POST'],
  ['assignQuest', [1, 2], /\/api\/quests\/1\/assign\/$/, 'POST'],
  ['getFamilyQuests', [], /\/api\/quests\/family\/$/, 'GET'],
];

describe.each(CASES)('%s', (name, args, urlPattern, method) => {
  it(`hits ${method} ${urlPattern}`, async () => {
    await api[name](...args);
    const call = lastCall();
    expect(call.url).toMatch(urlPattern);
    expect(call.method).toBe(method);
  });
});

describe('resources with optional step query', () => {
  it('getResources without stepId omits the filter', async () => {
    await api.getResources(5);
    expect(lastCall().url).toMatch(/\/api\/projects\/5\/resources\/$/);
  });

  it('getResources with null queries step=null (project-level)', async () => {
    await api.getResources(5, null);
    expect(lastCall().url).toMatch(/\/api\/projects\/5\/resources\/\?step=null$/);
  });

  it('getResources with a numeric step filters by that step', async () => {
    await api.getResources(5, 9);
    expect(lastCall().url).toMatch(/\/api\/projects\/5\/resources\/\?step=9$/);
  });
});

describe('chore completion list with optional status', () => {
  it('omits the filter by default', async () => {
    await api.getChoreCompletions();
    expect(lastCall().url).toMatch(/\/api\/chore-completions\/$/);
  });

  it('passes ?status= when set', async () => {
    await api.getChoreCompletions('pending');
    expect(lastCall().url).toMatch(/\/api\/chore-completions\/\?status=pending$/);
  });
});

describe('homework submissions with optional status', () => {
  it('omits the filter by default', async () => {
    await api.getHomeworkSubmissions();
    expect(lastCall().url).toMatch(/\/api\/homework-submissions\/$/);
  });

  it('passes ?status= when set', async () => {
    await api.getHomeworkSubmissions('pending');
    expect(lastCall().url).toMatch(/\/api\/homework-submissions\/\?status=pending$/);
  });
});

describe('FormData uploads', () => {
  it('createReward POSTs multipart', async () => {
    const fd = new FormData();
    fd.append('name', 'x');
    await api.createReward(fd);
    expect(lastCall().url).toMatch(/\/api\/rewards\/$/);
    expect(lastCall().method).toBe('POST');
    expect(lastCall().body).toBeInstanceOf(FormData);
  });

  it('updateReward PATCHes multipart', async () => {
    const fd = new FormData();
    await api.updateReward(5, fd);
    expect(lastCall().url).toMatch(/\/api\/rewards\/5\/$/);
    expect(lastCall().method).toBe('PATCH');
  });

  it('uploadPhoto attaches project, image, and optional caption', async () => {
    const file = new Blob(['x']);
    await api.uploadPhoto(5, file, 'hello');
    expect(lastCall().url).toMatch(/\/api\/photos\/$/);
    expect(lastCall().body).toBeInstanceOf(FormData);
    expect(lastCall().body.get('project')).toBe('5');
    expect(lastCall().body.get('caption')).toBe('hello');
    expect(lastCall().body.get('image')).toBeInstanceOf(Blob);
  });

  it('uploadPhoto omits caption when empty', async () => {
    const file = new Blob(['x']);
    await api.uploadPhoto(5, file);
    expect(lastCall().body.get('caption')).toBeNull();
  });

  it('submitHomework uploads FormData', async () => {
    const fd = new FormData();
    await api.submitHomework(5, fd);
    expect(lastCall().url).toMatch(/\/api\/homework\/5\/submit\/$/);
    expect(lastCall().method).toBe('POST');
    expect(lastCall().body).toBeInstanceOf(FormData);
  });

  it('uploadAvatar PATCHes /auth/me/ with multipart FormData', async () => {
    const file = new File(['bytes'], 'me.png', { type: 'image/png' });
    await api.uploadAvatar(file);
    expect(lastCall().url).toMatch(/\/api\/auth\/me\/$/);
    expect(lastCall().method).toBe('PATCH');
    expect(lastCall().body).toBeInstanceOf(FormData);
    expect(lastCall().body.get('avatar')).toBeInstanceOf(File);
  });

  it('removeAvatar PATCHes /auth/me/ with avatar="" sentinel', async () => {
    await api.removeAvatar();
    expect(lastCall().url).toMatch(/\/api\/auth\/me\/$/);
    expect(lastCall().method).toBe('PATCH');
    expect(JSON.parse(lastCall().body)).toEqual({ avatar: '' });
  });
});

describe('startIngest branches', () => {
  it('PDF variant uploads FormData with the file', async () => {
    const file = new File(['%PDF'], 'x.pdf', { type: 'application/pdf' });
    await api.startIngest({ source_type: 'pdf', source_file: file });
    expect(lastCall().url).toMatch(/\/api\/projects\/ingest\/$/);
    expect(lastCall().body).toBeInstanceOf(FormData);
    expect(lastCall().body.get('source_type')).toBe('pdf');
  });

  it('URL variant posts JSON', async () => {
    await api.startIngest({ source_type: 'url', source_url: 'https://x' });
    expect(lastCall().url).toMatch(/\/api\/projects\/ingest\/$/);
    expect(JSON.parse(lastCall().body)).toEqual({
      source_type: 'url',
      source_url: 'https://x',
    });
  });

  it('PDF variant with no file falls back to JSON', async () => {
    await api.startIngest({ source_type: 'pdf' });
    expect(JSON.parse(lastCall().body)).toEqual({ source_type: 'pdf' });
  });
});

describe('getInstructablesPreview', () => {
  it('encodes the URL into the query string', async () => {
    await api.getInstructablesPreview('https://example.com/a b?c=d');
    expect(lastCall().url).toMatch(/\/api\/instructables\/preview\/\?url=/);
    expect(lastCall().url).toContain(encodeURIComponent('https://example.com/a b?c=d'));
  });
});

describe('google oauth endpoints', () => {
  it('getGoogleAuthUrl without id', async () => {
    await api.getGoogleAuthUrl();
    expect(lastCall().url).toMatch(/\/api\/auth\/google\/$/);
  });

  it('getGoogleAuthUrl with id', async () => {
    await api.getGoogleAuthUrl(7);
    expect(lastCall().url).toMatch(/\/api\/auth\/google\/\?for_user=7$/);
  });

  it('getGoogleLoginUrl', async () => {
    await api.getGoogleLoginUrl();
    expect(lastCall().url).toMatch(/\/api\/auth\/google\/login\/$/);
  });

  it('getGoogleAccount without id', async () => {
    await api.getGoogleAccount();
    expect(lastCall().url).toMatch(/\/api\/auth\/google\/account\/$/);
  });

  it('getGoogleAccount with id', async () => {
    await api.getGoogleAccount(7);
    expect(lastCall().url).toMatch(/\/api\/auth\/google\/account\/\?for_user=7$/);
  });

  it('unlinkGoogleAccount without id', async () => {
    await api.unlinkGoogleAccount();
    expect(lastCall().method).toBe('DELETE');
    expect(lastCall().url).toMatch(/\/api\/auth\/google\/account\/$/);
  });

  it('unlinkGoogleAccount with id', async () => {
    await api.unlinkGoogleAccount(7);
    expect(lastCall().url).toMatch(/\/api\/auth\/google\/account\/\?for_user=7$/);
  });
});

describe('calendar settings', () => {
  it('getCalendarSettings GETs', async () => {
    await api.getCalendarSettings();
    expect(lastCall().url).toMatch(/\/api\/auth\/google\/calendar\/$/);
  });
  it('updateCalendarSettings PATCHes', async () => {
    await api.updateCalendarSettings({ enabled: true });
    expect(lastCall().method).toBe('PATCH');
  });
  it('triggerCalendarSync POSTs', async () => {
    await api.triggerCalendarSync();
    expect(lastCall().url).toMatch(/\/api\/auth\/google\/calendar\/sync\/$/);
    expect(lastCall().method).toBe('POST');
  });
});

describe('getProjectQR uses getBlob', () => {
  it('requests /qr/ and returns the blob result', async () => {
    await api.getProjectQR(5);
    expect(lastCall().url).toMatch(/\/api\/projects\/5\/qr\/$/);
  });
});
