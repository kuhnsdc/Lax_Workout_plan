/**
 * Lacrosse Practice & Training Planner
 * Serverless GitHub Pages + GitHub REST API Live Sync Engine
 */

const STORAGE_KEYS = {
  GH_CONFIG: 'lax_planner_gh_config',
  LOCAL_DRAFT: 'lax_planner_local_draft'
};

// Application State
let appData = null;
let activeProfileId = null;
let activeDayId = 'mon';
let hasUnsavedChanges = false;

// Default GitHub Config (pre-populated for convenience, token stays blank for public viewers)
const DEFAULT_GH_CONFIG = {
  owner: 'kuhnsdc',
  repo: 'Lax_Workout_plan',
  branch: 'main',
  path: 'data.json',
  token: ''
};

// ============================================================================
// 1. INITIALIZATION & DATA LOADING
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  applyRoleVisibility();
  bindEvents();
  await loadInitialData();
});

function getGhConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.GH_CONFIG) || 'null');
    return { ...DEFAULT_GH_CONFIG, ...(saved || {}) };
  } catch {
    return { ...DEFAULT_GH_CONFIG };
  }
}

function isAdminAuthenticated() {
  const cfg = getGhConfig();
  return Boolean(cfg.token && cfg.token.trim().length > 0);
}

function applyRoleVisibility() {
  if (isAdminAuthenticated()) {
    document.body.classList.add('is-admin');
  } else {
    document.body.classList.remove('is-admin');
  }
}

async function loadInitialData() {
  // 1. Fetch live data.json with cache-busting timestamp so updates appear immediately
  try {
    const cacheBuster = `t=${Date.now()}`;
    const response = await fetch(`data.json?${cacheBuster}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    appData = await response.json();
  } catch (err) {
    console.error('Failed to fetch live data.json:', err);
    showToast('Error loading data.json. Check repository file.', true);
    return;
  }

  // 2. Determine active profile from URL query parameter (?profile=...)
  const urlParams = new URLSearchParams(window.location.search);
  const requestedProfile = urlParams.get('profile');

  if (requestedProfile && appData.profiles.some(p => p.id === requestedProfile)) {
    activeProfileId = requestedProfile;
  } else if (appData.profiles.length > 0) {
    activeProfileId = appData.profiles[0].id;
  }

  // 3. Auto-select current day of week (Monday-Sunday)
  const dayIds = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const todayId = dayIds[new Date().getDay()];
  const profile = getActiveProfile();
  if (profile && profile.days.some(d => d.id === todayId)) {
    activeDayId = todayId;
  }

  renderAll();
}

// ============================================================================
// 2. STATE HELPERS & LIVE DURATION VALIDATION
// ============================================================================

function getActiveProfile() {
  if (!appData || !appData.profiles) return null;
  return appData.profiles.find(p => p.id === activeProfileId) || appData.profiles[0];
}

function getActiveDay() {
  const profile = getActiveProfile();
  if (!profile) return null;
  return profile.days.find(d => d.id === activeDayId) || profile.days[0];
}

function calculatePhaseMinutes(phase, isLowImpactDay) {
  // Phase 2 (Joint-Safe Plyometrics) dynamically scales to 0 mins on low-impact/cross-training days
  if (isLowImpactDay && phase.phaseNumber === 2) {
    return 0;
  }
  return (phase.drills || []).reduce((sum, drill) => sum + (Number(drill.duration) || 0), 0);
}

function calculateDayMinutes(day) {
  if (!day || !day.phases) return 0;
  return day.phases.reduce((sum, phase) => sum + calculatePhaseMinutes(phase, day.isLowImpact), 0);
}

function markUnsaved() {
  hasUnsavedChanges = true;
  const badge = document.getElementById('unsaved-badge');
  if (badge) badge.classList.remove('hidden');
}

function syncUrlQueryParam() {
  const url = new URL(window.location.href);
  url.searchParams.set('profile', activeProfileId);
  window.history.replaceState({}, '', url.toString());
}

// ============================================================================
// 3. UI RENDERING
// ============================================================================

function renderAll() {
  const profile = getActiveProfile();
  if (!profile) return;

  syncUrlQueryParam();
  renderProfileSelector();
  renderProfileHeader(profile);
  renderDayTabs(profile);
  renderActiveDay(profile);
}

function renderProfileSelector() {
  const selector = document.getElementById('profile-selector');
  selector.innerHTML = appData.profiles
    .map(p => `<option value="${escapeHtml(p.id)}" ${p.id === activeProfileId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`)
    .join('');
}

function renderProfileHeader(profile) {
  document.getElementById('profile-title').textContent = profile.name;
  document.getElementById('profile-position-badge').textContent = profile.position;
  document.getElementById('profile-focus').textContent = profile.focus;
  document.getElementById('profile-cap-display').textContent = `≤ ${profile.dailyCapMins} Mins`;
}

function renderDayTabs(profile) {
  const container = document.getElementById('day-tabs');
  container.innerHTML = profile.days.map(day => {
    const isActive = day.id === activeDayId;
    const totalMins = calculateDayMinutes(day);
    const isOverCap = totalMins > profile.dailyCapMins;

    const activeClasses = isActive
      ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100';

    return `
      <button type="button" data-day-id="${day.id}"
        class="day-tab-btn shrink-0 px-3.5 py-2 rounded-xl border text-left transition flex flex-col min-w-[92px] ${activeClasses}">
        <div class="flex items-center justify-between w-full gap-1">
          <span class="text-xs font-bold uppercase tracking-wide">${day.name.slice(0, 3)}</span>
          ${day.isLowImpact ? '<span title="Low-Impact Day" class="text-[11px]">🛡️</span>' : ''}
        </div>
        <span class="text-[11px] mt-0.5 ${isOverCap ? 'text-rose-400 font-bold' : (isActive ? 'text-emerald-400' : 'text-slate-500')}">
          ${totalMins}m
        </span>
      </button>
    `;
  }).join('');

  container.querySelectorAll('.day-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeDayId = btn.dataset.dayId;
      renderAll();
    });
  });
}

function renderActiveDay(profile) {
  const day = getActiveDay();
  if (!day) return;

  const totalMins = calculateDayMinutes(day);
  const capMins = Number(profile.dailyCapMins) || 45;
  const isOverCap = totalMins > capMins;

  document.getElementById('day-heading').textContent = `${day.name}: ${day.dailyFocus}`;
  document.getElementById('day-focus-note').textContent = day.notes || '';
  document.getElementById('day-total-mins').textContent = totalMins;
  document.getElementById('day-cap-mins').textContent = capMins;

  // Low-impact badge
  const lowImpactBadge = document.getElementById('low-impact-badge');
  if (day.isLowImpact) {
    lowImpactBadge.classList.remove('hidden');
  } else {
    lowImpactBadge.classList.add('hidden');
  }

  // Duration pill styling & cap warning
  const durationPill = document.getElementById('duration-pill');
  const warningBanner = document.getElementById('cap-warning-banner');
  if (isOverCap) {
    durationPill.className = 'px-3.5 py-2 rounded-lg border text-sm font-bold flex items-center gap-2 bg-rose-50 border-rose-300 text-rose-800';
    warningBanner.classList.remove('hidden');
  } else {
    durationPill.className = 'px-3.5 py-2 rounded-lg border text-sm font-bold flex items-center gap-2 bg-emerald-50 border-emerald-200 text-emerald-800';
    warningBanner.classList.add('hidden');
  }

  // Render 4 Timed Phases
  const phasesContainer = document.getElementById('phases-container');
  phasesContainer.innerHTML = day.phases.map((phase, pIdx) => {
    const isZeroedPlyo = day.isLowImpact && phase.phaseNumber === 2;
    const phaseMins = calculatePhaseMinutes(phase, day.isLowImpact);

    const drillsHtml = isZeroedPlyo
      ? `<div class="p-4 text-xs text-blue-800 bg-blue-50/70 rounded-b-xl">
           <strong>Joint-Safety Protection Active:</strong> Phase 2 plyometrics are automatically scaled to <strong>0 mins</strong> on low-impact / cross-training days. Toggle off Low-Impact Day in the admin bar to restore plyometrics.
         </div>`
      : (phase.drills.length === 0
          ? `<div class="p-4 text-xs text-slate-400 italic">No drills scheduled in this phase.</div>`
          : `<ul class="divide-y divide-slate-100">
              ${phase.drills.map((drill, dIdx) => `
                <li class="p-4 hover:bg-slate-50/80 transition flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div class="space-y-1 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="font-bold text-sm text-slate-900">${escapeHtml(drill.title)}</span>
                      <span class="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                        ${Number(drill.duration)} min
                      </span>
                      <span class="text-xs font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                        ${escapeHtml(drill.reps)}
                      </span>
                      ${drill.rest ? `<span class="text-xs text-slate-500">• ${escapeHtml(drill.rest)}</span>` : ''}
                    </div>
                    <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">${escapeHtml(drill.cues)}</p>
                  </div>

                  <!-- Admin Controls: Edit & Delete Drill -->
                  <div class="admin-only flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                    <button type="button" data-action="edit-drill" data-phase="${pIdx}" data-drill="${dIdx}"
                      class="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-md transition">
                      Edit
                    </button>
                    <button type="button" data-action="delete-drill" data-phase="${pIdx}" data-drill="${dIdx}"
                      class="px-2.5 py-1 text-xs font-semibold text-rose-600 bg-white hover:bg-rose-50 border border-rose-200 rounded-md transition">
                      Delete
                    </button>
                  </div>
                </li>
              `).join('')}
            </ul>`
        );

    return `
      <article class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="bg-slate-100/80 px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <h4 class="font-bold text-sm sm:text-base text-slate-800">${escapeHtml(phase.name)}</h4>
            <span class="text-xs font-bold px-2.5 py-0.5 rounded-full ${isZeroedPlyo ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-800'}">
              ${phaseMins} mins
            </span>
          </div>
          ${!isZeroedPlyo ? `
            <button type="button" data-action="add-drill" data-phase="${pIdx}"
              class="admin-only text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white px-2.5 py-1 rounded-lg transition">
              + Add Drill
            </button>
          ` : ''}
        </div>
        ${drillsHtml}
      </article>
    `;
  }).join('');

  // Bind phase/drill action buttons
  phasesContainer.querySelectorAll('[data-action="add-drill"]').forEach(btn => {
    btn.addEventListener('click', () => openDrillModal(Number(btn.dataset.phase), null));
  });
  phasesContainer.querySelectorAll('[data-action="edit-drill"]').forEach(btn => {
    btn.addEventListener('click', () => openDrillModal(Number(btn.dataset.phase), Number(btn.dataset.drill)));
  });
  phasesContainer.querySelectorAll('[data-action="delete-drill"]').forEach(btn => {
    btn.addEventListener('click', () => deleteDrill(Number(btn.dataset.phase), Number(btn.dataset.drill)));
  });
}

// ============================================================================
// 4. IN-BROWSER SCHEDULE & DRILL EDITOR
// ============================================================================

function openDrillModal(phaseIndex, drillIndex) {
  const day = getActiveDay();
  const phase = day.phases[phaseIndex];
  const isEdit = drillIndex !== null;

  document.getElementById('drill-modal-title').textContent = isEdit
    ? `Edit Drill — ${phase.name}`
    : `Add Drill — ${phase.name}`;

  document.getElementById('drill-phase-index').value = phaseIndex;
  document.getElementById('drill-index').value = isEdit ? drillIndex : '';

  if (isEdit) {
    const drill = phase.drills[drillIndex];
    document.getElementById('drill-title').value = drill.title;
    document.getElementById('drill-duration').value = drill.duration;
    document.getElementById('drill-reps').value = drill.reps;
    document.getElementById('drill-rest').value = drill.rest || '';
    document.getElementById('drill-cues').value = drill.cues;
  } else {
    document.getElementById('drill-form').reset();
    document.getElementById('drill-duration').value = 5;
  }

  document.getElementById('drill-modal').classList.remove('hidden');
}

function closeDrillModal() {
  document.getElementById('drill-modal').classList.add('hidden');
}

function handleSaveDrill(e) {
  e.preventDefault();
  const phaseIndex = Number(document.getElementById('drill-phase-index').value);
  const drillIndexRaw = document.getElementById('drill-index').value;

  const drillObj = {
    title: document.getElementById('drill-title').value.trim(),
    duration: Number(document.getElementById('drill-duration').value) || 0,
    reps: document.getElementById('drill-reps').value.trim(),
    rest: document.getElementById('drill-rest').value.trim(),
    cues: document.getElementById('drill-cues').value.trim()
  };

  const day = getActiveDay();
  if (drillIndexRaw !== '') {
    day.phases[phaseIndex].drills[Number(drillIndexRaw)] = drillObj;
  } else {
    day.phases[phaseIndex].drills.push(drillObj);
  }

  closeDrillModal();
  markUnsaved();
  renderAll();
  showToast('Drill updated locally. Click "Save & Publish to GitHub" to push live.');
}

function deleteDrill(phaseIndex, drillIndex) {
  const day = getActiveDay();
  const drill = day.phases[phaseIndex].drills[drillIndex];
  if (!confirm(`Remove "${drill.title}" from ${day.name}?`)) return;

  day.phases[phaseIndex].drills.splice(drillIndex, 1);
  markUnsaved();
  renderAll();
  showToast('Drill removed locally.');
}

function toggleLowImpactDay() {
  const day = getActiveDay();
  if (!day) return;
  day.isLowImpact = !day.isLowImpact;
  markUnsaved();
  renderAll();
  showToast(day.isLowImpact
    ? `${day.name} set to Low-Impact Mode (Phase 2 = 0 mins).`
    : `${day.name} restored to Standard Impact Mode.`);
}

// ============================================================================
// 5. MULTI-ATHLETE PROFILE CREATION
// ============================================================================

function handleCreateProfile(e) {
  e.preventDefault();
  const name = document.getElementById('new-profile-name').value.trim();
  const position = document.getElementById('new-profile-position').value.trim();
  const dailyCapMins = Number(document.getElementById('new-profile-cap').value) || 45;
  const focus = document.getElementById('new-profile-focus').value.trim();

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now().toString().slice(-4);

  const dayNames = [
    { id: 'mon', name: 'Monday' },
    { id: 'tue', name: 'Tuesday' },
    { id: 'wed', name: 'Wednesday' },
    { id: 'thu', name: 'Thursday' },
    { id: 'fri', name: 'Friday' },
    { id: 'sat', name: 'Saturday' },
    { id: 'sun', name: 'Sunday' }
  ];

  const newProfile = {
    id: slug,
    name,
    position,
    focus,
    dailyCapMins,
    days: dayNames.map(d => ({
      id: d.id,
      name: d.name,
      dailyFocus: `${position} Skill & Conditioning`,
      isLowImpact: d.id === 'sun',
      notes: '',
      phases: [
        { phaseNumber: 1, name: 'Phase 1: Knee-Care Warm-Up & Mobility', drills: [] },
        { phaseNumber: 2, name: 'Phase 2: Joint-Safe Plyometrics', drills: [] },
        { phaseNumber: 3, name: 'Phase 3: Stick Work & Shooting', drills: [] },
        { phaseNumber: 4, name: 'Phase 4: Cool-Down & Tactical IQ', drills: [] }
      ]
    }))
  };

  appData.profiles.push(newProfile);
  activeProfileId = newProfile.id;
  document.getElementById('profile-modal').classList.add('hidden');
  document.getElementById('profile-form').reset();

  markUnsaved();
  renderAll();
  showToast(`Profile "${name}" created.`);
}

// ============================================================================
// 6. GITHUB REST API LIVE SYNC (READ / WRITE)
// ============================================================================

/**
 * UTF-8 Safe Base64 Encoder (prevents InvalidCharacterError on emojis/accents)
 */
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function publishToGitHub() {
  const cfg = getGhConfig();
  if (!cfg.token || !cfg.owner || !cfg.repo || !cfg.path) {
    showToast('Missing GitHub credentials. Configure Admin Sync in footer.', true);
    return;
  }

  const publishBtn = document.getElementById('btn-publish-github');
  const originalText = publishBtn.textContent;
  publishBtn.disabled = true;
  publishBtn.textContent = 'Publishing...';

  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${cfg.path}`;
  const headers = {
    'Authorization': `Bearer ${cfg.token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };

  try {
    // Step 1: Fetch current blob SHA via GET /repos/{owner}/{repo}/contents/{path}
    let currentSha = null;
    const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(cfg.branch)}&t=${Date.now()}`, { headers });

    if (getRes.ok) {
      const fileMeta = await getRes.json();
      currentSha = fileMeta.sha;
    } else if (getRes.status !== 404) {
      const errData = await getRes.json().catch(() => ({}));
      throw new Error(errData.message || `GET failed (${getRes.status})`);
    }

    // Step 2: Update timestamp & encode payload safely in UTF-8 Base64
    appData.lastUpdated = new Date().toISOString().split('T')[0];
    const jsonString = JSON.stringify(appData, null, 2);
    const base64Content = utf8ToBase64(jsonString);

    // Step 3: Commit overwrite via PUT /repos/{owner}/{repo}/contents/{path}
    const putBody = {
      message: `Update lacrosse training plan (${appData.lastUpdated})`,
      content: base64Content,
      branch: cfg.branch
    };
    if (currentSha) {
      putBody.sha = currentSha;
    }

    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify(putBody)
    });

    if (!putRes.ok) {
      const errData = await putRes.json().catch(() => ({}));
      throw new Error(errData.message || `PUT failed (${putRes.status})`);
    }

    hasUnsavedChanges = false;
    document.getElementById('unsaved-badge').classList.add('hidden');
    showToast('✅ Published directly to GitHub! Live site updates within ~30–60s.');
  } catch (err) {
    console.error('GitHub Publish Error:', err);
    showToast(`GitHub Sync Failed: ${err.message}`, true);
  } finally {
    publishBtn.disabled = false;
    publishBtn.textContent = originalText;
  }
}

// ============================================================================
// 7. WINDOWS-OPTIMIZED SMS LINK LAUNCHER & CLIPBOARD FALLBACK
// ============================================================================

function getDeepLinkUrl() {
  return `${window.location.origin}${window.location.pathname}?profile=${encodeURIComponent(activeProfileId)}`;
}

function launchSmsUpdate() {
  const livePlanUrl = getDeepLinkUrl();
  const payload = `Updated Plan: ${livePlanUrl}`;
  window.location.href = 'sms:?&body=' + encodeURIComponent(payload);
}

async function copyDeepLink() {
  const livePlanUrl = getDeepLinkUrl();
  try {
    await navigator.clipboard.writeText(livePlanUrl);
    showToast('Direct profile link copied to clipboard!');
  } catch {
    prompt('Copy this direct plan link:', livePlanUrl);
  }
}

// ============================================================================
// 8. EVENT BINDINGS & UTILITIES
// ============================================================================

function bindEvents() {
  // Profile switching
  document.getElementById('profile-selector').addEventListener('change', (e) => {
    activeProfileId = e.target.value;
    renderAll();
  });

  // SMS & Copy Link buttons
  document.getElementById('btn-send-sms').addEventListener('click', launchSmsUpdate);
  document.getElementById('btn-copy-link').addEventListener('click', copyDeepLink);

  // Admin Bar actions
  document.getElementById('btn-toggle-impact').addEventListener('click', toggleLowImpactDay);
  document.getElementById('btn-publish-github').addEventListener('click', publishToGitHub);

  // Drill Modal
  document.getElementById('drill-form').addEventListener('submit', handleSaveDrill);
  document.getElementById('btn-close-drill-modal').addEventListener('click', closeDrillModal);
  document.getElementById('btn-cancel-drill').addEventListener('click', closeDrillModal);

  // Profile Modal
  document.getElementById('btn-new-profile').addEventListener('click', () => {
    document.getElementById('profile-modal').classList.remove('hidden');
  });
  document.getElementById('profile-form').addEventListener('submit', handleCreateProfile);
  document.getElementById('btn-close-profile-modal').addEventListener('click', () => {
    document.getElementById('profile-modal').classList.add('hidden');
  });
  document.getElementById('btn-cancel-profile').addEventListener('click', () => {
    document.getElementById('profile-modal').classList.add('hidden');
  });

  // GitHub Settings Modal
  document.getElementById('btn-open-github-modal').addEventListener('click', () => {
    const cfg = getGhConfig();
    document.getElementById('gh-owner').value = cfg.owner;
    document.getElementById('gh-repo').value = cfg.repo;
    document.getElementById('gh-branch').value = cfg.branch;
    document.getElementById('gh-path').value = cfg.path;
    document.getElementById('gh-token').value = cfg.token;
    document.getElementById('github-modal').classList.remove('hidden');
  });

  document.getElementById('github-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const cfg = {
      owner: document.getElementById('gh-owner').value.trim(),
      repo: document.getElementById('gh-repo').value.trim(),
      branch: document.getElementById('gh-branch').value.trim() || 'main',
      path: document.getElementById('gh-path').value.trim() || 'data.json',
      token: document.getElementById('gh-token').value.trim()
    };
    localStorage.setItem(STORAGE_KEYS.GH_CONFIG, JSON.stringify(cfg));
    applyRoleVisibility();
    document.getElementById('github-modal').classList.add('hidden');
    showToast(cfg.token ? 'Admin credentials saved locally.' : 'Saved without token (Public View Mode).');
  });

  document.getElementById('btn-logout-github').addEventListener('click', () => {
    const cfg = getGhConfig();
    cfg.token = '';
    localStorage.setItem(STORAGE_KEYS.GH_CONFIG, JSON.stringify(cfg));
    document.getElementById('gh-token').value = '';
    applyRoleVisibility();
    document.getElementById('github-modal').classList.add('hidden');
    showToast('Token cleared. Switched to Public Read-Only Mode.');
  });

  document.getElementById('btn-close-github-modal').addEventListener('click', () => {
    document.getElementById('github-modal').classList.add('hidden');
  });
  document.getElementById('btn-cancel-github').addEventListener('click', () => {
    document.getElementById('github-modal').classList.add('hidden');
  });
}

let toastTimeout = null;
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `fixed bottom-5 right-5 z-50 text-sm font-medium px-4 py-3 rounded-xl shadow-lg border transition-opacity ${
    isError
      ? 'bg-rose-950 text-rose-100 border-rose-700'
      : 'bg-slate-900 text-white border-slate-700'
  }`;
  toast.classList.remove('hidden');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 4200);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}