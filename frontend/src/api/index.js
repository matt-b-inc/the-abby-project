import { api, setToken, getBlob } from './client';

// Auth
export const login = async (username, password) => {
  const data = await api.post('/auth/', { action: 'login', username, password });
  if (data && data.token) setToken(data.token);
  return data;
};
export const signup = async ({ username, password, display_name, family_name }) => {
  const data = await api.post('/auth/signup/', {
    username, password, display_name, family_name,
  });
  if (data && data.token) setToken(data.token);
  return data;
};
export const logout = async () => {
  try {
    await api.post('/auth/', { action: 'logout' });
  } finally {
    setToken(null);
  }
};
export const getMe = () => api.get('/auth/me/');
export const updateMe = (data) => api.patch('/auth/me/', data);

// Dashboard
export const getDashboard = () => api.get('/dashboard/');
// One heartbeat for every background poller — see PulseProvider.
export const getPulse = () => api.get('/pulse/');

// Lorebook — shared mechanics explainer for parents and kids
export const getLorebook = () => api.get('/lorebook/');

// Projects
export const getProjects = () => api.get('/projects/');
export const getProject = (id) => api.get(`/projects/${id}/`);
export const createProject = (data) => api.post('/projects/', data);
export const updateProject = (id, data) => api.patch(`/projects/${id}/`, data);
export const activateProject = (id) => api.post(`/projects/${id}/activate/`);
export const submitProject = (id) => api.post(`/projects/${id}/submit/`);
export const approveProject = (id) => api.post(`/projects/${id}/approve/`);
export const requestChanges = (id, notes) =>
  api.post(`/projects/${id}/request-changes/`, { notes });

// Milestones
export const getMilestones = (projectId) =>
  api.get(`/projects/${projectId}/milestones/`);
export const createMilestone = (projectId, data) =>
  api.post(`/projects/${projectId}/milestones/`, data);
export const updateMilestone = (projectId, id, data) =>
  api.patch(`/projects/${projectId}/milestones/${id}/`, data);
export const deleteMilestone = (projectId, id) =>
  api.delete(`/projects/${projectId}/milestones/${id}/`);
export const completeMilestone = (projectId, id) =>
  api.post(`/projects/${projectId}/milestones/${id}/complete/`);

// Steps (walkthrough instructions — no XP, no coins, no ledger)
export const getSteps = (projectId) =>
  api.get(`/projects/${projectId}/steps/`);
export const createStep = (projectId, data) =>
  api.post(`/projects/${projectId}/steps/`, data);
export const updateStep = (projectId, id, data) =>
  api.patch(`/projects/${projectId}/steps/${id}/`, data);
export const deleteStep = (projectId, id) =>
  api.delete(`/projects/${projectId}/steps/${id}/`);
export const completeStep = (projectId, id) =>
  api.post(`/projects/${projectId}/steps/${id}/complete/`);
export const uncompleteStep = (projectId, id) =>
  api.post(`/projects/${projectId}/steps/${id}/uncomplete/`);
export const reorderSteps = (projectId, order) =>
  api.post(`/projects/${projectId}/steps/reorder/`, { order });

// Resources (reference links — project-level or attached to a step)
export const getResources = (projectId, stepId) => {
  const qs = stepId === undefined ? '' : `?step=${stepId === null ? 'null' : stepId}`;
  return api.get(`/projects/${projectId}/resources/${qs}`);
};
export const createResource = (projectId, data) =>
  api.post(`/projects/${projectId}/resources/`, data);
export const updateResource = (projectId, id, data) =>
  api.patch(`/projects/${projectId}/resources/${id}/`, data);
export const deleteResource = (projectId, id) =>
  api.delete(`/projects/${projectId}/resources/${id}/`);

// Materials
export const getMaterials = (projectId) =>
  api.get(`/projects/${projectId}/materials/`);
export const createMaterial = (projectId, data) =>
  api.post(`/projects/${projectId}/materials/`, data);
export const updateMaterial = (projectId, id, data) =>
  api.patch(`/projects/${projectId}/materials/${id}/`, data);
export const deleteMaterial = (projectId, id) =>
  api.delete(`/projects/${projectId}/materials/${id}/`);
export const markPurchased = (projectId, id, actual_cost) =>
  api.post(`/projects/${projectId}/materials/${id}/mark-purchased/`, { actual_cost });

// Project Ingestion (auto-pull milestones/materials from a source)
export const startIngest = ({ source_type, source_url, source_file }) => {
  if (source_type === 'pdf' && source_file) {
    const fd = new FormData();
    fd.append('source_type', 'pdf');
    fd.append('source_file', source_file);
    return api.upload('/projects/ingest/', fd);
  }
  return api.post('/projects/ingest/', { source_type, source_url });
};
export const getIngestJob = (id) => api.get(`/projects/ingest/${id}/`);
export const updateIngestJob = (id, data) =>
  api.patch(`/projects/ingest/${id}/`, data);
export const commitIngestJob = (id, overrides) =>
  api.post(`/projects/ingest/${id}/commit/`, overrides);
export const discardIngestJob = (id) => api.delete(`/projects/ingest/${id}/`);

// Clock
export const getClockStatus = () => api.get('/clock/');
export const clockIn = (project_id) =>
  api.post('/clock/', { action: 'in', project_id });
export const clockOut = (notes) =>
  api.post('/clock/', { action: 'out', notes });

// Time Entries
export const getTimeEntries = () => api.get('/time-entries/');
export const voidTimeEntry = (id) => api.post(`/time-entries/${id}/void/`);

// Timecards
export const getTimecards = () => api.get('/timecards/');
export const getTimecard = (id) => api.get(`/timecards/${id}/`);
export const approveTimecard = (id, notes) =>
  api.post(`/timecards/${id}/approve/`, { notes });
export const disputeTimecard = (id) => api.post(`/timecards/${id}/dispute/`);
export const markTimecardPaid = (id, amount) =>
  api.post(`/timecards/${id}/mark-paid/`, { amount });
export const downloadTimecardsCsv = () => getBlob('/export/timecards/');

// Payments
export const getBalance = () => api.get('/balance/');
export const getPayments = () => api.get('/payments/');
// Filtered ledger fetch — accepts { entry_type, start_date, end_date, user_id }.
// entry_type may be a comma-joined string for multi-select; everything else is
// scalar. Empty / null values are dropped so the URL stays clean. Used by the
// Payments page filter UI below the breakdown.
export const getPaymentLedger = (filters = {}) => {
  const qs = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.append(k, v);
  });
  const query = qs.toString();
  return api.get(`/payments/${query ? `?${query}` : ''}`);
};
export const getPaymentSummaryByDay = ({ days = 30, user_id } = {}) => {
  const qs = new URLSearchParams({ days });
  if (user_id) qs.set('user_id', user_id);
  return api.get(`/payments/summary-by-day/?${qs}`);
};
// Parent-only CSV export URL — opened directly via <a href> rather than fetch'd
// because the browser handles the download dialog for free that way. Includes
// the bearer token via querystring? — no, the export endpoint sits on the
// authenticated API so the helper just builds the URL string and the page
// adds the token via a `<form method="get">` submit-with-Authorization-header
// pattern. For now we expose it as a function that returns the relative URL
// with the same filter shape; the page uses fetch+blob to keep the auth
// header in the request.
export const buildPaymentLedgerExportUrl = (filters = {}) => {
  const qs = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.append(k, v);
  });
  return `/payments/export/${qs.toString() ? `?${qs}` : ''}`;
};
export const downloadPaymentLedgerCsv = (filters = {}) =>
  getBlob(buildPaymentLedgerExportUrl(filters));
export const recordPayout = (user_id, amount) =>
  api.post('/payments/payout/', { user_id, amount });
export const adjustPayment = (user_id, amount, description = '') =>
  api.post('/payments/adjust/', { user_id, amount, description });

// RPG Codex — parent-only catalog of YAML-authored content
export const getItemCatalog = () => api.get('/items/catalog/');
export const getPetSpeciesCatalog = () => api.get('/pets/species/catalog/');
export const getQuestCatalog = () => api.get('/quests/catalog/');

// Achievements
export const getBadges = () => api.get('/badges/');
export const createBadge = (data) => api.post('/badges/', data);
export const updateBadge = (id, data) => api.patch(`/badges/${id}/`, data);
export const deleteBadge = (id) => api.delete(`/badges/${id}/`);
export const getEarnedBadges = () => api.get('/badges/earned/');
export const getSubjects = () => api.get('/subjects/');
export const createSubject = (data) => api.post('/subjects/', data);
export const updateSubject = (id, data) => api.patch(`/subjects/${id}/`, data);
export const deleteSubject = (id) => api.delete(`/subjects/${id}/`);
export const getSkills = () => api.get('/skills/');
export const createSkill = (data) => api.post('/skills/', data);
export const updateSkill = (id, data) => api.patch(`/skills/${id}/`, data);
export const deleteSkill = (id) => api.delete(`/skills/${id}/`);
export const getSkillTree = (categoryId) => api.get(`/skills/tree/${categoryId}/`);
export const getSkillProgress = () => api.get('/skill-progress/');
export const getAchievementsSummary = () => api.get('/achievements/summary/');

// Rewards / Coins
export const getRewards = () => api.get('/rewards/');
export const createReward = (formData) => api.upload('/rewards/', formData);
export const updateReward = (id, formData) =>
  api.patch(`/rewards/${id}/`, formData);
export const deleteReward = (id) => api.delete(`/rewards/${id}/`);
export const redeemReward = (id) => api.post(`/rewards/${id}/redeem/`, {});
export const getRedemptions = () => api.get('/redemptions/');
export const approveRedemption = (id, notes = '') =>
  api.post(`/redemptions/${id}/approve/`, { notes });
export const rejectRedemption = (id, notes = '') =>
  api.post(`/redemptions/${id}/reject/`, { notes });
export const getCoinBalance = () => api.get('/coins/');
export const getCoinSummaryByDay = (days = 30) =>
  api.get(`/coins/summary-by-day/?days=${days}`);
export const adjustCoins = (user_id, amount, description = '') =>
  api.post('/coins/adjust/', { user_id, amount, description });

// Coin Exchange
export const getExchangeRate = () => api.get('/coins/exchange/rate/');
export const requestExchange = (dollar_amount) =>
  api.post('/coins/exchange/', { dollar_amount });
export const getExchangeRequests = () => api.get('/coins/exchange/list/');
export const approveExchange = (id, notes = '') =>
  api.post(`/coins/exchange/${id}/approve/`, { notes });
export const rejectExchange = (id, notes = '') =>
  api.post(`/coins/exchange/${id}/reject/`, { notes });

// Portfolio
export const getPortfolio = () => api.get('/portfolio/');
export const getPhotos = () => api.get('/photos/');
export const uploadPhoto = (projectId, file, caption = '') => {
  const fd = new FormData();
  fd.append('project', projectId);
  fd.append('image', file);
  if (caption) fd.append('caption', caption);
  return api.upload('/photos/', fd);
};
export const deletePhoto = (id) => api.delete(`/photos/${id}/`);
export const deleteHomeworkProof = (id) => api.delete(`/homework-proofs/${id}/`);

// Avatar
export const uploadAvatar = (file) => {
  const fd = new FormData();
  fd.append('avatar', file);
  return api.patch('/auth/me/', fd);
};
export const removeAvatar = () => api.patch('/auth/me/', { avatar: '' });

// Categories
export const getCategories = () => api.get('/categories/');
export const createCategory = (data) => api.post('/categories/', data);
export const updateCategory = (id, data) => api.patch(`/categories/${id}/`, data);
export const deleteCategory = (id) => api.delete(`/categories/${id}/`);

// Notifications
export const getNotifications = () => api.get('/notifications/');
export const getUnreadCount = () => api.get('/notifications/unread_count/');
// Web Push — the VAPID public key + whether the server can send at all.
export const getPushConfig = () => api.get('/push/config/');
export const subscribeToPush = (subscription) => api.post('/push/subscribe/', subscription);
export const unsubscribeFromPush = (endpoint) => api.post('/push/unsubscribe/', { endpoint });
export const markAllRead = () => api.post('/notifications/mark_all_read/');
export const markNotificationRead = (id) => api.post(`/notifications/${id}/mark_read/`);
export const getPendingCelebrationNotification = () =>
  api.get('/notifications/pending-celebration/');

// Instructables
export const getInstructablesPreview = (url) =>
  api.get(`/instructables/preview/?url=${encodeURIComponent(url)}`);

// Project Templates
export const getTemplates = () => api.get('/templates/');
export const getTemplate = (id) => api.get(`/templates/${id}/`);
export const updateTemplate = (id, data) => api.patch(`/templates/${id}/`, data);
export const deleteTemplate = (id) => api.delete(`/templates/${id}/`);
export const createProjectFromTemplate = (id, assigned_to_id) =>
  api.post(`/templates/${id}/create-project/`, { assigned_to_id });
export const saveProjectAsTemplate = (project_id, is_public = false) =>
  api.post('/templates/from-project/', { project_id, is_public });

// Savings Goals ("Hoards")
// ``current_amount`` is computed by the backend from the live payment
// balance — the client never writes it. Completion is handled server-side
// (auto-fires on any ledger write that crosses a goal's target and on each
// list fetch as a belt-and-suspenders backstop).
export const getSavingsGoals = () => api.get('/savings-goals/');
export const createSavingsGoal = (data) => api.post('/savings-goals/', data);
export const updateSavingsGoal = (id, data) => api.patch(`/savings-goals/${id}/`, data);
export const deleteSavingsGoal = (id) => api.delete(`/savings-goals/${id}/`);

// AI Suggestions
export const getProjectSuggestions = () => api.get('/projects/suggestions/');

// QR Code
export const getProjectQR = (id) => getBlob(`/projects/${id}/qr/`);

// Collaborators
export const getCollaborators = (projectId) => api.get(`/projects/${projectId}/collaborators/`);
export const addCollaborator = (projectId, user_id, pay_split_percent) =>
  api.post(`/projects/${projectId}/collaborators/`, { user_id, pay_split_percent });

// Children (parent-only)
export const getChildren = () => api.get('/children/');
export const createChild = (data) => api.post('/children/', data);
export const updateChild = (id, data) => api.patch(`/children/${id}/`, data);
export const deleteChild = (id) => api.delete(`/children/${id}/`);
export const resetChildPassword = (id, password) =>
  api.post(`/children/${id}/reset-password/`, { password });
export const deactivateChild = (id) => api.post(`/children/${id}/deactivate/`);
export const reactivateChild = (id) => api.post(`/children/${id}/reactivate/`);

// Parents / co-parents (parent-only — same family)
export const getParents = () => api.get('/parents/');
export const createParent = (data) => api.post('/parents/', data);
export const updateParent = (id, data) => api.patch(`/parents/${id}/`, data);
export const deleteParent = (id) => api.delete(`/parents/${id}/`);
export const resetParentPassword = (id, password) =>
  api.post(`/parents/${id}/reset-password/`, { password });
export const deactivateParent = (id) => api.post(`/parents/${id}/deactivate/`);
export const reactivateParent = (id) => api.post(`/parents/${id}/reactivate/`);

// Admin — staff-only (gates the Admin tab visibility on /manage)
export const adminPing = () => api.get('/admin/families/');
export const adminCreateFamily = (data) => api.post('/admin/families/', data);

// Admin → OAuth Clients (staff-parent-only)
export const listOAuthApplications = () => api.get('/admin/oauth/applications/');
export const revokeOAuthApplication = (clientId) =>
  api.delete(`/admin/oauth/applications/${clientId}/tokens/`);
export const listOAuthTokens = () => api.get('/admin/oauth/tokens/');
export const revokeOAuthToken = (tokenId) =>
  api.delete(`/admin/oauth/tokens/${tokenId}/`);

// Chores
export const getChores = () => api.get('/chores/');
export const getChore = (id) => api.get(`/chores/${id}/`);
export const createChore = (data) => api.post('/chores/', data);
export const updateChore = (id, data) => api.patch(`/chores/${id}/`, data);
export const deleteChore = (id) => api.delete(`/chores/${id}/`);
export const completeChore = (id, notes = '') =>
  api.post(`/chores/${id}/complete/`, { notes });
export const getChoreCompletions = (status) => {
  const qs = status ? `?status=${status}` : '';
  return api.get(`/chore-completions/${qs}`);
};
export const approveChoreCompletion = (id) =>
  api.post(`/chore-completions/${id}/approve/`);
export const rejectChoreCompletion = (id, notes = '') =>
  api.post(`/chore-completions/${id}/reject/`, { notes });
export const withdrawChoreCompletion = (id) =>
  api.post(`/chore-completions/${id}/withdraw/`);
// Chore proposals (child-authored, parent-gated rewards).
export const listPendingChoreProposals = () =>
  api.get('/chores/?pending=true');
export const listMyChoreProposals = () =>
  api.get('/chores/?pending=true');
export const approveChoreProposal = (id, payload) =>
  api.post(`/chores/${id}/approve/`, payload);

// Greenlight Import
export const importGreenlight = (user_id, csv_data) =>
  api.post('/greenlight/import/', { user_id, csv_data });

// Google OAuth
export const getGoogleAuthUrl = (forUserId) => {
  const qs = forUserId ? `?for_user=${forUserId}` : '';
  return api.get(`/auth/google/${qs}`);
};
export const getGoogleLoginUrl = () => api.get('/auth/google/login/');
export const getGoogleAccount = (forUserId) => {
  const qs = forUserId ? `?for_user=${forUserId}` : '';
  return api.get(`/auth/google/account/${qs}`);
};
export const unlinkGoogleAccount = (forUserId) => {
  const qs = forUserId ? `?for_user=${forUserId}` : '';
  return api.delete(`/auth/google/account/${qs}`);
};

// Google Calendar
export const getCalendarSettings = () => api.get('/auth/google/calendar/');
export const updateCalendarSettings = (data) => api.patch('/auth/google/calendar/', data);
export const triggerCalendarSync = () => api.post('/auth/google/calendar/sync/');

// Homework
export const getHomeworkDashboard = () => api.get('/homework/dashboard/');
export const getHomework = () => api.get('/homework/');
export const getHomeworkDetail = (id) => api.get(`/homework/${id}/`);
export const createHomework = (data) => api.post('/homework/', data);
export const updateHomework = (id, data) => api.patch(`/homework/${id}/`, data);
export const deleteHomework = (id) => api.delete(`/homework/${id}/`);
export const submitHomework = (id, formData) =>
  api.upload(`/homework/${id}/submit/`, formData);
export const saveHomeworkTemplate = (id) =>
  api.post(`/homework/${id}/save-template/`);
export const planHomework = (id) =>
  api.post(`/homework/${id}/plan/`);
export const getHomeworkSubmissions = (status) => {
  const qs = status ? `?status=${status}` : '';
  return api.get(`/homework-submissions/${qs}`);
};
export const approveHomeworkSubmission = (id) =>
  api.post(`/homework-submissions/${id}/approve/`);
export const rejectHomeworkSubmission = (id, notes = '') =>
  api.post(`/homework-submissions/${id}/reject/`, { notes });
export const withdrawHomeworkSubmission = (id) =>
  api.post(`/homework-submissions/${id}/withdraw/`);
export const getHomeworkTemplates = () => api.get('/homework-templates/');
export const createHomeworkTemplate = (data) => api.post('/homework-templates/', data);
export const deleteHomeworkTemplate = (id) => api.delete(`/homework-templates/${id}/`);
export const createAssignmentFromTemplate = (templateId, data) =>
  api.post(`/homework-templates/${templateId}/create-assignment/`, data);

// Movement — self-reported physical-activity sessions.
export const listMovementTypes = () => api.get('/movement-types/');
export const createMovementType = (data) => api.post('/movement-types/', data);
export const deleteMovementType = (id) => api.delete(`/movement-types/${id}/`);
export const listMovementSessions = () => api.get('/movement-sessions/');
export const logMovementSession = (data) => api.post('/movement-sessions/', data);
export const deleteMovementSession = (id) =>
  api.delete(`/movement-sessions/${id}/`);

// Creations — child-authored "I made a thing" entry type.
export const listCreations = () => api.get('/creations/');
export const getCreationTodayStatus = () => api.get('/creations/today_status/');
export const createCreation = (formData) => api.upload('/creations/', formData);
export const deleteCreation = (id) => api.delete(`/creations/${id}/`);
export const submitCreation = (id) => api.post(`/creations/${id}/submit/`);
export const withdrawCreation = (id) => api.post(`/creations/${id}/withdraw/`);
export const approveCreation = (id, payload = {}) =>
  api.post(`/creations/${id}/approve/`, payload);
export const rejectCreation = (id, notes = '') =>
  api.post(`/creations/${id}/reject/`, { notes });
export const listPendingCreations = () => api.get('/creations/pending/');

// RPG
export const getCharacterProfile = () => api.get('/character/');
export const getStreaks = () => api.get('/streaks/');
export const getHabits = () => api.get('/habits/');
export const getHabitHistory = (days = 14) =>
  api.get(`/habits/history/?days=${days}`);
export const createHabit = (data) => api.post('/habits/', data);
export const updateHabit = (id, data) => api.patch(`/habits/${id}/`, data);
export const deleteHabit = (id) => api.delete(`/habits/${id}/`);
export const logHabitTap = (id, direction) =>
  api.post(`/habits/${id}/log/`, { direction });
// Habit proposals (child-authored, parent-gated rewards).
export const listPendingHabitProposals = () =>
  api.get('/habits/?pending=true');
export const listMyHabitProposals = () =>
  api.get('/habits/?pending=true');
export const approveHabitProposal = (id, payload) =>
  api.post(`/habits/${id}/approve/`, payload);
// Reward wishlist — child taps "notify me" on an out-of-stock or
// any reward; parent restock fans out a notification.
export const addRewardToWishlist = (rewardId) =>
  api.post(`/rewards/${rewardId}/wishlist/`);
export const removeRewardFromWishlist = (rewardId) =>
  api.delete(`/rewards/${rewardId}/wishlist/`);
export const getMyRewardWishlist = () => api.get('/rewards/my-wishlist/');

export const getInventory = () => api.get('/inventory/');
export const consumeInventoryItem = (itemId, quantity = 1) =>
  api.post(`/inventory/${itemId}/use/`, { quantity });
export const openCoinPouch = (itemId) =>
  api.post(`/inventory/${itemId}/open/`);
export const getRecentDrops = () => api.get('/drops/recent/');

// Pets
export const getStable = () => api.get('/pets/stable/');
export const getPetCodex = () => api.get('/pets/codex/');
export const hatchPet = (eggItemId, potionItemId) =>
  api.post('/pets/hatch/', { egg_item_id: eggItemId, potion_item_id: potionItemId });
export const feedPet = (petId, foodItemId) =>
  api.post(`/pets/${petId}/feed/`, { food_item_id: foodItemId });
export const activatePet = (petId) => api.post(`/pets/${petId}/activate/`);
export const getMounts = () => api.get('/mounts/');
export const activateMount = (mountId) => api.post(`/mounts/${mountId}/activate/`);
export const breedMounts = (mountAId, mountBId) =>
  api.post('/mounts/breed/', { mount_a_id: mountAId, mount_b_id: mountBId });
export const getRecentCompanionGrowth = () => api.get('/pets/companion-growth/recent/');
export const markCompanionGrowthSeen = () => api.post('/pets/companion-growth/seen/');

// Mount expeditions — Finch-inspired offline play loop. Tier is one of
// 'short' | 'standard' | 'long'. The list endpoint accepts ?ready=true
// to return only active expeditions whose returns_at has passed.
export const startExpedition = (mountId, tier) =>
  api.post(`/mounts/${mountId}/expedition/`, { tier });
export const listExpeditions = (readyOnly = false) =>
  api.get(`/expeditions/${readyOnly ? '?ready=true' : ''}`);
export const claimExpedition = (expeditionId) =>
  api.post(`/expeditions/${expeditionId}/claim/`);

// Wellbeing — daily affirmation + gratitude card on the Sigil Frontispiece
export const getWellbeingToday = () => api.get('/wellbeing/today/');
export const submitGratitude = (lines) =>
  api.post('/wellbeing/today/gratitude/', { lines });

// Trophy shelf
export const setTrophyBadge = (badgeId) =>
  api.post('/character/trophy/', { badge_id: badgeId });

// Daily challenges
export const getDailyChallenge = () => api.get('/challenges/daily/');
export const claimDailyChallenge = () => api.post('/challenges/daily/claim/');

// Cosmetics
export const getCosmetics = () => api.get('/cosmetics/');
export const getCosmeticCatalog = () => api.get('/cosmetics/catalog/');
export const equipCosmetic = (itemId) => api.post('/character/equip/', { item_id: itemId });
export const unequipCosmetic = (slot) => api.post('/character/unequip/', { slot });

// Quests
export const getActiveQuest = () => api.get('/quests/active/');
export const getAvailableQuests = () => api.get('/quests/available/');
export const startQuest = (definitionId, scrollItemId) =>
  api.post('/quests/start/', { definition_id: definitionId, scroll_item_id: scrollItemId });
export const getQuestHistory = () => api.get('/quests/history/');
export const createQuest = (data) => api.post('/quests/', data);
export const assignQuest = (definitionId, userId) =>
  api.post(`/quests/${definitionId}/assign/`, { user_id: userId });
export const getFamilyQuests = () => api.get('/quests/family/');

// Sprites
/**
 * Fetches the runtime sprite catalog. No auth; endpoint is public.
 * Supports ETag revalidation via the optional `etag` argument — pass
 * the etag from a previous response and get 304 Not Modified back
 * (returned as { notModified: true }) if nothing changed.
 */
export async function fetchSpriteCatalog(etag = null, { signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (etag) headers['If-None-Match'] = `"${etag}"`;
  const resp = await fetch('/api/sprites/catalog/', { headers, signal });
  if (resp.status === 304) return { notModified: true };
  if (!resp.ok) throw new Error(`sprite catalog fetch failed: ${resp.status}`);
  return resp.json();
}

// Parent-only sprite admin surface (powers the /manage → Codex → Sprites panel).
export const fetchSpriteAdminList = (pack) =>
  api.get(`/sprites/admin/${pack ? `?pack=${encodeURIComponent(pack)}` : ''}`);
export const generateSprite = (body) => api.post('/sprites/admin/generate/', body);
export const rerollSprite = (slug, opts = {}) =>
  api.post(`/sprites/admin/${encodeURIComponent(slug)}/reroll/`, opts);
export const updateSpriteMeta = (slug, body) =>
  api.patch(`/sprites/admin/${encodeURIComponent(slug)}/`, body);
export const deleteSprite = (slug) =>
  api.delete(`/sprites/admin/${encodeURIComponent(slug)}/`);

// Chronicle / Yearbook
export const getChronicleEntries = (params = {}) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return api.get(`/chronicle/${qs ? `?${qs}` : ''}`);
};
export const getChronicleSummary = (userId) =>
  api.get(`/chronicle/summary/${userId ? `?user_id=${encodeURIComponent(userId)}` : ''}`);
export const getPendingCelebration = () => api.get('/chronicle/pending-celebration/');
export const markChronicleViewed = (id) => api.post(`/chronicle/${id}/mark-viewed/`);
export const createManualChronicleEntry = (data) => api.post('/chronicle/manual/', data);
export const updateManualChronicleEntry = (id, data) => api.patch(`/chronicle/${id}/`, data);
export const deleteChronicleEntry = (id) => api.delete(`/chronicle/${id}/`);
export const getChronicleComments = (id) => api.get(`/chronicle/entries/${id}/comments/`);
export const addChronicleComment = (id, payload) =>
  api.post(`/chronicle/entries/${id}/comments/`, payload);
// Child-authored journal entries. POST self-scopes to request.user and
// is one-per-local-day — a second POST returns 409 with the existing
// entry in the `existing` key of the response body. PATCH is restricted
// to same-local-day edits by the backend.
export const writeJournal = ({ title, summary, is_private, client_entry_id }) =>
  api.post('/chronicle/journal/', { title, summary, is_private, client_entry_id });
export const updateJournalEntry = (id, { title, summary, is_private }) =>
  api.patch(`/chronicle/${id}/journal/`, { title, summary, is_private });
// Fetch today's journal entry for request.user; returns null when the
// child hasn't written yet (the backend 204s and api.get resolves to null).
export const getTodayJournal = () => api.get('/chronicle/journal/today/');

// Grade memories retain their original marking format. Recognition is
// returned by the server and is independent of the recorded mark.
export const getGrades = (params = {}) => {
  const qs = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return api.get(`/chronicle/grades/${qs ? `?${qs}` : ''}`);
};
export const writeGrade = (payload) => api.post('/chronicle/grades/', payload);
export const updateGradeEntry = (id, payload) => api.patch(`/chronicle/${id}/grade/`, payload);

// Forge — 3D print requests
// A request may carry an uploaded model file, so `createPrintRequest` takes
// either a plain object (link submissions — JSON) or a FormData (uploads —
// multipart via api.upload). The backend viewset accepts both parsers.
const forgeQuery = (params = {}) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return qs ? `?${qs}` : '';
};

export const listPrintRequests = (params = {}) =>
  api.get(`/print-requests/${forgeQuery(params)}`);
export const createPrintRequest = (data) =>
  (data instanceof FormData
    ? api.upload('/print-requests/', data)
    : api.post('/print-requests/', data));
export const updatePrintRequest = (id, data) => api.patch(`/print-requests/${id}/`, data);
export const deletePrintRequest = (id) => api.delete(`/print-requests/${id}/`);
export const approvePrintRequest = (id, data) =>
  api.post(`/print-requests/${id}/approve/`, data);
export const rejectPrintRequest = (id, notes = '') =>
  api.post(`/print-requests/${id}/reject/`, { notes });
export const cancelPrintRequest = (id) => api.post(`/print-requests/${id}/cancel/`);
export const previewPrintLink = (url) => api.post('/print-requests/preview/', { url });

export const listPrintJobs = (params = {}) => api.get(`/print-jobs/${forgeQuery(params)}`);
export const linkPrintJob = (jobId, requestId) =>
  api.post(`/print-jobs/${jobId}/link/`, { request_id: requestId });
export const unlinkPrintJob = (jobId) => api.post(`/print-jobs/${jobId}/unlink/`);
// Housekeeping on prints nobody claimed. dismiss is the reversible one —
// restore is what makes it worth having over delete.
export const dismissPrintJob = (jobId) => api.post(`/print-jobs/${jobId}/dismiss/`);
export const restorePrintJob = (jobId) => api.post(`/print-jobs/${jobId}/restore/`);
export const deletePrintJob = (jobId) => api.delete(`/print-jobs/${jobId}/`);

export const listPrintBudgets = () => api.get('/print-budgets/');
export const updatePrintBudget = (id, data) => api.patch(`/print-budgets/${id}/`, data);
export const adjustPrintBudget = (id, data) => api.post(`/print-budgets/${id}/adjust/`, data);
export const getPrintBudgetLedger = (id) => api.get(`/print-budgets/${id}/ledger/`);

export const listPrinters = () => api.get('/printers/');
export const createPrinter = (data) => api.post('/printers/', data);
export const updatePrinter = (id, data) => api.patch(`/printers/${id}/`, data);
export const deletePrinter = (id) => api.delete(`/printers/${id}/`);
export const getPrinterStatus = (id) => api.get(`/printers/${id}/status/`);

// Activity log (parent-only)
export const listActivity = (params = {}) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return api.get(`/activity/${qs ? `?${qs}` : ''}`);
};
// Cursor pagination returns absolute next/previous URLs — call them as-is
// minus the /api prefix the client auto-adds.
export const fetchActivityUrl = (url) => {
  if (!url) return Promise.resolve({ results: [], next: null, previous: null });
  const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '');
  return api.get(path);
};

// Dev tools — parent + DEBUG/DEV_TOOLS_ENABLED only. Drives the
// /manage → Test tab. ping returns 403 in production so the tab
// hides itself; the per-endpoint permission catches the rest.
export const devToolsPing = () => api.get('/dev/ping/');
export const devToolsChildren = () => api.get('/dev/children/');
export const devToolsRewards = () => api.get('/dev/rewards/');
export const devToolsItems = (rarity) =>
  api.get(`/dev/items/${rarity ? `?rarity=${encodeURIComponent(rarity)}` : ''}`);
export const devToolsPetSpecies = () => api.get('/dev/pet-species/');
export const devToolsPotionTypes = () => api.get('/dev/potion-types/');
export const devToolsChecklist = () => api.get('/dev/checklist/');
export const devForceDrop = (body) => api.post('/dev/force-drop/', body);
export const devForceCelebration = (body) => api.post('/dev/force-celebration/', body);
export const devSetStreak = (body) => api.post('/dev/set-streak/', body);
export const devSetRewardStock = (body) => api.post('/dev/set-reward-stock/', body);
export const devExpireJournal = (body) => api.post('/dev/expire-journal/', body);
export const devTickPerfectDay = () => api.post('/dev/tick-perfect-day/', {});
export const devSetPetHappiness = (body) => api.post('/dev/set-pet-happiness/', body);
export const devResetDayCounters = (body) => api.post('/dev/reset-day-counters/', body);
// Toast & ceremony coverage (2026-05-11)
export const devForceApprovalNotification = (body) =>
  api.post('/dev/force-approval-notification/', body);
export const devForceQuestProgress = (body) =>
  api.post('/dev/force-quest-progress/', body);
export const devMarkDailyChallengeReady = (body) =>
  api.post('/dev/mark-daily-challenge-ready/', body);
export const devSetPetGrowth = (body) => api.post('/dev/set-pet-growth/', body);
export const devGrantHatchIngredients = (body) =>
  api.post('/dev/grant-hatch-ingredients/', body);
export const devClearBreedCooldowns = (body) =>
  api.post('/dev/clear-breed-cooldowns/', body);
export const devSeedCompanionGrowth = (body) =>
  api.post('/dev/seed-companion-growth/', body);
export const devMarkExpeditionReady = (body) =>
  api.post('/dev/mark-expedition-ready/', body);
