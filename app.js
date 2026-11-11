/**
 * Lacrosse Practice & Training Planner - Client Logic
 * Handles GitHub REST API sync, multi-athlete profiles, interactive checklists,
 * countdown timers, and in-browser schedule editing with duration validation.
 */

class LaxPlannerApp {
    constructor() {
        this.data = null;
        this.activeProfileId = 'attack-x';
        this.activeDayIndex = 0;
        this.githubConfig = {
            owner: '',
            repo: '',
            branch: 'main',
            path: 'data.json',
            token: ''
        };
        this.timers = {}; // active countdown intervals
        this.init();
    }

    async init() {
        this.loadGitHubConfig();
        this.parseURLParams();
        await this.loadData();
        this.initEventListeners();
        this.render();
        this.updateSyncStatusIndicator();
    }

    loadGitHubConfig() {
        const saved = localStorage.getItem('lax_github_config');
        if (saved) {
            try {
                this.githubConfig = JSON.parse(saved);
            } catch (e) {
                console.error("Failed to parse GitHub config", e);
            }
        }
    }

    saveGitHubConfig() {
        localStorage.setItem('lax_github_config', JSON.stringify(this.githubConfig));
    }

    parseURLParams() {
        const params = new URLSearchParams(window.location.search);
        const profileParam = params.get('profile');
        if (profileParam) {
            this.activeProfileId = profileParam;
        }
    }

    async loadData() {
        // Try local storage first for offline / unsaved edits
        const cached = localStorage.getItem('lax_plan_data_' + this.activeProfileId);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                this.data = parsed;
                this.checkAuthVisibility();
                return;
            } catch (e) {
                console.error("Failed to load cached profile data", e);
            }
        }

        // Otherwise fetch data.json with cache-busting
        try {
            const res = await fetch('data.json?t=' + Date.now());
            if (!res.ok) throw new Error("Failed to fetch data.json");
            const json = await res.json();
            this.data = json;
            // Cache locally
            localStorage.setItem('lax_plan_data_store', JSON.stringify(json));
        } catch (err) {
            console.warn("Could not fetch data.json, falling back to embedded default data", err);
            // Fallback default structure
            this.data = { profiles: [] };
        }
        this.checkAuthVisibility();
    }

    getActiveProfile() {
        if (!this.data || !this.data.profiles) return null;
        let p = this.data.profiles.find(item => item.id === this.activeProfileId);
        if (!p && this.data.profiles.length > 0) {
            p = this.data.profiles[0];
            this.activeProfileId = p.id;
        }
        return p;
    }

    checkAuthVisibility() {
        const hasToken = !!this.githubConfig.token && this.githubConfig.token.trim() !== '';
        const adminElements = document.querySelectorAll('.admin-only');
        adminElements.forEach(el => {
            if (hasToken) {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        });
    }

    initEventListeners() {
        // Profile Switcher change
        document.getElementById('profile-select').addEventListener('change', (e) => {
            this.activeProfileId = e.target.value;
            this.activeDayIndex = 0;
            this.render();
        });

        // SMS Share (Windows optimized)
        document.getElementById('btn-share-sms').addEventListener('click', () => {
            const payload = `${window.location.origin}${window.location.pathname}?profile=${this.activeProfileId}`;
            const textBody = `Updated Plan: ${payload}`;
            const smsUrl = `sms:?&body=${encodeURIComponent(textBody)}`;
            window.location.href = smsUrl;
        });

        // Copy Link
        document.getElementById('btn-copy-link').addEventListener('click', () => {
            const payload = `${window.location.origin}${window.location.pathname}?profile=${this.activeProfileId}`;
            navigator.clipboard.writeText(payload).then(() => {
                alert("Shareable link copied to clipboard!");
            }).catch(err => {
                console.error("Failed to copy link", err);
            });
        });

        // Modal Sync Open/Close
        document.getElementById('btn-open-sync').addEventListener('click', () => {
            this.populateSyncModalFields();
            document.getElementById('modal-sync').classList.remove('hidden');
        });
        document.getElementById('btn-close-sync').addEventListener('click', () => {
            document.getElementById('modal-sync').classList.add('hidden');
        });

        // Sync Actions
        document.getElementById('btn-save-auth').addEventListener('click', () => this.saveSyncSettingsFromModal());
        document.getElementById('btn-test-auth').addEventListener('click', () => this.testGitHubConnection());
        document.getElementById('btn-clear-auth').addEventListener('click', () => this.clearGitHubAuth());

        // Editor Modal Open/Close
        document.getElementById('btn-open-editor').addEventListener('click', () => {
            this.openEditorModal();
        });
        document.getElementById('btn-close-editor').addEventListener('click', () => {
            document.getElementById('modal-editor').classList.add('hidden');
        });
        document.getElementById('btn-cancel-editor').addEventListener('click', () => {
            document.getElementById('modal-editor').classList.add('hidden');
        });

        // Editor Day Switch
        document.getElementById('editor-day-select').addEventListener('change', (e) => {
            this.renderEditorFormForDay(parseInt(e.target.value));
        });

        // Publish to GitHub
        document.getElementById('btn-publish-github').addEventListener('click', () => {
            this.publishToGitHub();
        });
    }

    render() {
        this.renderProfileSelector();
        this.renderDayTabs();
        this.renderActiveDayView();
    }

    renderProfileSelector() {
        const select = document.getElementById('profile-select');
        select.innerHTML = '';
        if (!this.data || !this.data.profiles) return;

        this.data.profiles.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.name} (${p.athlete})`;
            if (p.id === this.activeProfileId) opt.selected = true;
            select.appendChild(opt);
        });

        const profileBadge = document.getElementById('active-profile-badge');
        const profile = this.getActiveProfile();
        if (profile) {
            profileBadge.textContent = `${profile.athlete} | Cap: ${profile.targetCapMins}m`;
        }
    }

    renderDayTabs() {
        const container = document.getElementById('day-tabs');
        container.innerHTML = '';
        const profile = this.getActiveProfile();
        if (!profile || !profile.schedule) return;

        profile.schedule.forEach((dayObj, index) => {
            const btn = document.createElement('button');
            const isActive = index === this.activeDayIndex;
            btn.className = `px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer flex items-center gap-2 ${
                isActive 
                ? 'bg-blue-600 text-white shadow-md shadow-blue-900/40' 
                : 'bg-cardBg hover:bg-slate-800 text-slate-300 border border-cardBorder'
            }`;
            
            let badgeHtml = '';
            if (dayObj.badge) {
                badgeHtml = `<span class="text-[10px] px-1.5 py-0.5 rounded font-semibold ${dayObj.isLowImpact ? 'bg-amber-900/60 text-amber-300 border border-amber-700/50' : 'bg-purple-900/60 text-purple-300 border border-purple-700/50'}">${dayObj.badge}</span>`;
            }

            btn.innerHTML = `<span>${dayObj.day}</span> ${badgeHtml}`;
            btn.addEventListener('click', () => {
                this.activeDayIndex = index;
                this.render();
            });
            container.appendChild(btn);
        });
    }

    renderActiveDayView() {
        const container = document.getElementById('day-view-container');
        container.innerHTML = '';
        const profile = this.getActiveProfile();
        if (!profile || !profile.schedule) return;

        const day = profile.schedule[this.activeDayIndex];
        if (!day) return;

        // Calculate total duration across phases
        const totalMins = day.phases.reduce((sum, p) => sum + (parseInt(p.durationMins) || 0), 0);
        const isOverCap = totalMins > profile.targetCapMins;

        let html = `
            <div class="bg-cardBg border border-cardBorder rounded-2xl p-6 shadow-xl space-y-6">
                <!-- Day Header -->
                <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-cardBorder pb-5">
                    <div>
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-xs uppercase tracking-wider font-bold text-blue-400">${day.day} Training Schedule</span>
                            ${day.badge ? `<span class="text-xs px-2 py-0.5 rounded-full font-semibold ${day.isLowImpact ? 'bg-amber-900/60 text-amber-300 border border-amber-700/50' : 'bg-purple-900/60 text-purple-300 border border-purple-700/50'}">${day.badge}</span>` : ''}
                        </div>
                        <h2 class="text-2xl font-black text-white">${day.title}</h2>
                        <p class="text-sm text-slate-400 mt-0.5">Focus: <span class="text-slate-200 font-medium">${day.focus}</span></p>
                    </div>

                    <div class="flex items-center gap-3 bg-slate-900/80 px-4 py-2.5 rounded-xl border border-cardBorder">
                        <div class="text-right">
                            <div class="text-xs text-slate-400 font-medium">Daily Time Cap</div>
                            <div class="text-sm font-bold ${isOverCap ? 'text-red-400' : 'text-emerald-400'}">${totalMins} / ${profile.targetCapMins} Mins</div>
                        </div>
                        ${isOverCap ? `<span class="text-xs bg-red-950 text-red-300 border border-red-800 px-2 py-1 rounded font-semibold">Exceeds Cap</span>` : ''}
                    </div>
                </div>

                <!-- Phases Grid -->
                <div class="space-y-6" id="phases-list">
        `;

        day.phases.forEach((phase, pIdx) => {
            html += `
                <div class="bg-slate-900/60 border border-cardBorder rounded-xl p-5 space-y-4">
                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-800 pb-3">
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center font-bold text-sm">
                                ${phase.phaseNumber}
                            </div>
                            <div>
                                <h3 class="font-bold text-slate-100 text-base">Phase ${phase.phaseNumber}: ${phase.title}</h3>
                                <p class="text-xs text-slate-400">Duration: <span class="text-slate-200 font-semibold">${phase.durationMins} Minutes</span></p>
                            </div>
                        </div>

                        <!-- Phase Timer Controller -->
                        <div class="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
                            <span class="text-xs font-mono font-bold text-blue-400 timer-display" data-timer-id="timer-${this.activeDayIndex}-${pIdx}">${phase.durationMins}:00</span>
                            <button class="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-semibold px-2.5 py-1 rounded transition btn-start-timer" data-day="${this.activeDayIndex}" data-phase="${pIdx}" data-mins="${phase.durationMins}">Start Timer</button>
                            <button class="bg-slate-700 hover:bg-slate-600 text-slate-300 text-[10px] font-semibold px-2 py-1 rounded transition btn-reset-timer" data-day="${this.activeDayIndex}" data-phase="${pIdx}" data-mins="${phase.durationMins}">Reset</button>
                        </div>
                    </div>

                    <!-- Drills Table / List -->
                    <div class="space-y-3">
            `;

            phase.drills.forEach((drill, dIdx) => {
                const checkId = `check-${this.activeDayIndex}-${pIdx}-${dIdx}`;
                const isChecked = localStorage.getItem(checkId) === 'true';

                html += `
                    <div class="bg-cardBg/80 border border-cardBorder/60 rounded-xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition hover:border-slate-600">
                        <div class="flex items-start gap-3.5">
                            <input type="checkbox" id="${checkId}" ${isChecked ? 'checked' : ''} class="mt-1 w-4 h-4 rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-blue-500 cursor-pointer drill-checkbox" data-check-id="${checkId}">
                            <div>
                                <h4 class="font-semibold text-slate-200 text-sm ${isChecked ? 'line-through text-slate-400' : ''}">${drill.title}</h4>
                                <p class="text-xs text-slate-400 mt-1">Cues: <span class="text-slate-300">${drill.cues}</span></p>
                            </div>
                        </div>

                        <div class="flex flex-wrap items-center gap-3 w-full md:w-auto justify-between md:justify-end">
                            <div class="text-left md:text-right">
                                <div class="text-[10px] uppercase font-bold text-slate-400">Target</div>
                                <div class="text-xs font-bold text-blue-300 bg-blue-950/60 border border-blue-900/60 px-2.5 py-1 rounded-lg">${drill.reps}</div>
                            </div>
                            <div class="text-left md:text-right">
                                <div class="text-[10px] uppercase font-bold text-slate-400">Rest Interval</div>
                                <div class="text-xs font-bold text-amber-300 bg-amber-950/60 border border-amber-900/60 px-2.5 py-1 rounded-lg">${drill.rest}</div>
                            </div>
                        </div>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;

        container.innerHTML = html;
        this.bindDynamicInteractiveElements();
    }

    bindDynamicInteractiveElements() {
        // Checkboxes state save
        const checkboxes = document.querySelectorAll('.drill-checkbox');
        checkboxes.forEach(cb => {
            cb.addEventListener('change', (e) => {
                const checkId = e.target.getAttribute('data-check-id');
                localStorage.setItem(checkId, e.target.checked);
                const titleEl = e.target.closest('div').querySelector('h4');
                if (e.target.checked) {
                    titleEl.classList.add('line-through', 'text-slate-400');
                } else {
                    titleEl.classList.remove('line-through', 'text-slate-400');
                }
            });
        });

        // Timer buttons
        const startBtns = document.querySelectorAll('.btn-start-timer');
        startBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const dayIdx = e.target.getAttribute('data-day');
                const phaseIdx = e.target.getAttribute('data-phase');
                const mins = parseInt(e.target.getAttribute('data-mins'));
                this.startTimer(dayIdx, phaseIdx, mins);
            });
        });

        const resetBtns = document.querySelectorAll('.btn-reset-timer');
        resetBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const dayIdx = e.target.getAttribute('data-day');
                const phaseIdx = e.target.getAttribute('data-phase');
                const mins = parseInt(e.target.getAttribute('data-mins'));
                this.resetTimer(dayIdx, phaseIdx, mins);
            });
        });
    }

    startTimer(dayIdx, phaseIdx, totalMins) {
        const timerKey = `${dayIdx}-${phaseIdx}`;
        if (this.timers[timerKey]) {
            clearInterval(this.timers[timerKey]);
        }

        let totalSeconds = totalMins * 60;
        const displayEl = document.querySelector(`[data-timer-id="timer-${timerKey}"]`);
        if (!displayEl) return;

        this.timers[timerKey] = setInterval(() => {
            if (totalSeconds <= 0) {
                clearInterval(this.timers[timerKey]);
                displayEl.textContent = "00:00";
                displayEl.classList.remove('text-amber-400', 'animate-pulse');
                displayEl.classList.add('text-emerald-400');
                return;
            }

            totalSeconds--;
            const m = Math.floor(totalSeconds / 60);
            const s = totalSeconds % 60;
            displayEl.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

            // Visual flashing indicator when final countdown seconds (e.g. <= 10 seconds)
            if (totalSeconds <= 10) {
                displayEl.classList.add('text-red-400', 'animate-pulse');
            } else if (totalSeconds <= 30) {
                displayEl.classList.add('text-amber-400');
            }
        }, 1000);
    }

    resetTimer(dayIdx, phaseIdx, totalMins) {
        const timerKey = `${dayIdx}-${phaseIdx}`;
        if (this.timers[timerKey]) {
            clearInterval(this.timers[timerKey]);
        }
        const displayEl = document.querySelector(`[data-timer-id="timer-${timerKey}"]`);
        if (displayEl) {
            displayEl.textContent = `${totalMins}:00`;
            displayEl.classList.remove('text-red-400', 'animate-pulse', 'text-amber-400', 'text-emerald-400');
            displayEl.classList.add('text-blue-400');
        }
    }

    // GitHub Sync Settings & Modal
    populateSyncModalFields() {
        document.getElementById('sync-owner').value = this.githubConfig.owner || '';
        document.getElementById('sync-repo').value = this.githubConfig.repo || '';
        document.getElementById('sync-branch').value = this.githubConfig.branch || 'main';
        document.getElementById('sync-path').value = this.githubConfig.path || 'data.json';
        document.getElementById('sync-token').value = this.githubConfig.token || '';
    }

    saveSyncSettingsFromModal() {
        this.githubConfig.owner = document.getElementById('sync-owner').value.trim();
        this.githubConfig.repo = document.getElementById('sync-repo').value.trim();
        this.githubConfig.branch = document.getElementById('sync-branch').value.trim() || 'main';
        this.githubConfig.path = document.getElementById('sync-path').value.trim() || 'data.json';
        this.githubConfig.token = document.getElementById('sync-token').value.trim();

        this.saveGitHubConfig();
        this.checkAuthVisibility();
        this.updateSyncStatusIndicator();

        const msg = document.getElementById('sync-msg');
        msg.textContent = "GitHub settings saved successfully!";
        msg.className = "text-xs font-medium text-center text-emerald-400";
        msg.classList.remove('hidden');

        setTimeout(() => {
            msg.classList.add('hidden');
            document.getElementById('modal-sync').classList.add('hidden');
        }, 1500);
    }

    clearGitHubAuth() {
        if (confirm("Are you sure you want to clear your GitHub credentials? Admin edit controls will be locked.")) {
            this.githubConfig.token = '';
            this.saveGitHubConfig();
            this.checkAuthVisibility();
            this.updateSyncStatusIndicator();
            document.getElementById('sync-token').value = '';
            document.getElementById('modal-sync').classList.add('hidden');
            alert("Credentials cleared. Edit mode locked.");
        }
    }

    async testGitHubConnection() {
        const owner = document.getElementById('sync-owner').value.trim();
        const repo = document.getElementById('sync-repo').value.trim();
        const token = document.getElementById('sync-token').value.trim();
        const path = document.getElementById('sync-path').value.trim() || 'data.json';
        const branch = document.getElementById('sync-branch').value.trim() || 'main';

        const msg = document.getElementById('sync-msg');
        msg.textContent = "Testing connection to GitHub...";
        msg.className = "text-xs font-medium text-center text-blue-400";
        msg.classList.remove('hidden');

        try {
            const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
            const res = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!res.ok) {
                throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
            }

            msg.textContent = "Connection successful! Repository and file verified.";
            msg.className = "text-xs font-medium text-center text-emerald-400";
        } catch (err) {
            console.error(err);
            msg.textContent = `Connection failed: ${err.message}`;
            msg.className = "text-xs font-medium text-center text-red-400";
        }
    }

    updateSyncStatusIndicator() {
        const indicator = document.getElementById('sync-status-indicator');
        if (this.githubConfig.token && this.githubConfig.token.trim() !== '') {
            indicator.className = "w-2 h-2 rounded-full bg-emerald-500 inline-block ml-1 shadow-sm shadow-emerald-500";
        } else {
            indicator.className = "w-2 h-2 rounded-full bg-slate-500 inline-block ml-1";
        }
    }

    // In-Browser Schedule & Drill Editor
    openEditorModal() {
        const select = document.getElementById('editor-day-select');
        select.innerHTML = '';
        const profile = this.getActiveProfile();
        if (!profile || !profile.schedule) return;

        profile.schedule.forEach((day, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = `${day.day} - ${day.title}`;
            select.appendChild(opt);
        });

        this.renderEditorFormForDay(0);
        document.getElementById('modal-editor').classList.remove('hidden');
    }

    renderEditorFormForDay(dayIndex) {
        const container = document.getElementById('editor-body-container');
        container.innerHTML = '';
        const profile = this.getActiveProfile();
        if (!profile || !profile.schedule) return;

        const day = profile.schedule[dayIndex];
        if (!day) return;

        let html = `
            <div class="space-y-4">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-semibold text-slate-300 mb-1">Day Title</label>
                        <input type="text" id="edit-day-title" value="${day.title}" class="w-full bg-slate-900 border border-cardBorder rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-slate-300 mb-1">Focus Area</label>
                        <input type="text" id="edit-day-focus" value="${day.focus}" class="w-full bg-slate-900 border border-cardBorder rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500">
                    </div>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-semibold text-slate-300 mb-1">Badge Text</label>
                        <input type="text" id="edit-day-badge" value="${day.badge || ''}" class="w-full bg-slate-900 border border-cardBorder rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500">
                    </div>
                    <div class="flex items-center pt-6">
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" id="edit-day-lowimpact" ${day.isLowImpact ? 'checked' : ''} class="w-4 h-4 rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-blue-500">
                            <span class="text-xs font-semibold text-slate-300">Is Low-Impact / Basketball Night</span>
                        </label>
                    </div>
                </div>

                <div class="border-t border-slate-800 pt-4 space-y-4">
                    <h4 class="font-bold text-sm text-slate-200">Daily Phases & Drills</h4>
        `;

        day.phases.forEach((phase, pIdx) => {
            html += `
                <div class="bg-slate-900/80 border border-cardBorder rounded-xl p-4 space-y-3 phase-editor-card" data-phase-index="${pIdx}">
                    <div class="flex justify-between items-center">
                        <span class="text-xs font-bold text-blue-400">Phase ${phase.phaseNumber}</span>
                        <div class="flex items-center gap-2">
                            <label class="text-xs text-slate-400">Duration (Mins):</label>
                            <input type="number" class="phase-duration-input w-20 bg-slate-800 border border-cardBorder rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-blue-500" value="${phase.durationMins}" data-p-idx="${pIdx}">
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-slate-300 mb-1">Phase Title</label>
                        <input type="text" class="phase-title-input w-full bg-slate-800 border border-cardBorder rounded px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500" value="${phase.title}" data-p-idx="${pIdx}">
                    </div>

                    <div class="space-y-2 pt-2">
                        <div class="text-[11px] font-bold text-slate-400 uppercase">Drills</div>
            `;

            phase.drills.forEach((drill, dIdx) => {
                html += `
                    <div class="bg-cardBg border border-cardBorder/60 rounded-lg p-3 space-y-2 drill-item-row" data-d-idx="${dIdx}">
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <div class="sm:col-span-2">
                                <label class="block text-[10px] text-slate-400">Drill Title</label>
                                <input type="text" class="drill-title-input w-full bg-slate-900 border border-cardBorder rounded px-2.5 py-1 text-xs text-slate-100 focus:outline-none focus:border-blue-500" value="${drill.title}">
                            </div>
                            <div>
                                <label class="block text-[10px] text-slate-400">Reps / Target</label>
                                <input type="text" class="drill-reps-input w-full bg-slate-900 border border-cardBorder rounded px-2.5 py-1 text-xs text-slate-100 focus:outline-none focus:border-blue-500" value="${drill.reps}">
                            </div>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                                <label class="block text-[10px] text-slate-400">Rest Interval</label>
                                <input type="text" class="drill-rest-input w-full bg-slate-900 border border-cardBorder rounded px-2.5 py-1 text-xs text-slate-100 focus:outline-none focus:border-blue-500" value="${drill.rest}">
                            </div>
                            <div>
                                <label class="block text-[10px] text-slate-400">Coaching Cues</label>
                                <input type="text" class="drill-cues-input w-full bg-slate-900 border border-cardBorder rounded px-2.5 py-1 text-xs text-slate-100 focus:outline-none focus:border-blue-500" value="${drill.cues}">
                            </div>
                        </div>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;

        container.innerHTML = html;
        this.updateEditorValidationBadge();

        // Listen for input changes to validate live duration totals
        container.querySelectorAll('.phase-duration-input').forEach(input => {
            input.addEventListener('input', () => this.updateEditorValidationBadge());
        });
    }

    updateEditorValidationBadge() {
        const profile = this.getActiveProfile();
        const durationInputs = document.querySelectorAll('.phase-duration-input');
        let total = 0;
        durationInputs.forEach(inp => {
            total += parseInt(inp.value) || 0;
        });

        const badge = document.getElementById('editor-validation-badge');
        if (total > profile.targetCapMins) {
            badge.textContent = `Total Duration: ${total} Mins (Exceeds ${profile.targetCapMins}m Cap!)`;
            badge.className = "text-xs px-3 py-1.5 rounded-lg font-medium bg-red-950 text-red-300 border border-red-800";
        } else {
            badge.textContent = `Total Duration: ${total} / ${profile.targetCapMins} Mins (Valid)`;
            badge.className = "text-xs px-3 py-1.5 rounded-lg font-medium bg-emerald-950 text-emerald-300 border border-emerald-800";
        }
    }

    collectEditorFormData() {
        const dayIndex = parseInt(document.getElementById('editor-day-select').value);
        const profile = this.getActiveProfile();
        if (!profile || !profile.schedule) return;

        const day = profile.schedule[dayIndex];
        day.title = document.getElementById('edit-day-title').value.trim();
        day.focus = document.getElementById('edit-day-focus').value.trim();
        day.badge = document.getElementById('edit-day-badge').value.trim();
        day.isLowImpact = document.getElementById('edit-day-lowimpact').checked;

        const phaseCards = document.querySelectorAll('.phase-editor-card');
        phaseCards.forEach(card => {
            const pIdx = parseInt(card.getAttribute('data-phase-index'));
            const phase = day.phases[pIdx];
            phase.durationMins = parseInt(card.querySelector('.phase-duration-input').value) || 0;
            phase.title = card.querySelector('.phase-title-input').value.trim();

            const drillRows = card.querySelectorAll('.drill-item-row');
            drillRows.forEach(row => {
                const dIdx = parseInt(row.getAttribute('data-d-idx'));
                const drill = phase.drills[dIdx];
                drill.title = row.querySelector('.drill-title-input').value.trim();
                drill.reps = row.querySelector('.drill-reps-input').value.trim();
                drill.rest = row.querySelector('.drill-rest-input').value.trim();
                drill.cues = row.querySelector('.drill-cues-input').value.trim();
            });
        });

        // Save locally immediately
        localStorage.setItem('lax_plan_data_' + this.activeProfileId, JSON.stringify(this.data));
    }

    async publishToGitHub() {
        this.collectEditorFormData();

        if (!this.githubConfig.token || !this.githubConfig.owner || !this.githubConfig.repo) {
            alert("GitHub credentials are missing or incomplete. Please configure them in the Admin Sync Settings first.");
            document.getElementById('modal-editor').classList.add('hidden');
            document.getElementById('modal-sync').classList.remove('hidden');
            return;
        }

        const publishBtn = document.getElementById('btn-publish-github');
        const originalText = publishBtn.innerHTML;
        publishBtn.innerHTML = `Publishing...`;
        publishBtn.disabled = true;

        try {
            const { owner, repo, branch, path, token } = this.githubConfig;
            const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

            // 1. Get current file SHA
            const getRes = await fetch(`${apiUrl}?ref=${branch}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!getRes.ok) {
                throw new Error(`Failed to retrieve file SHA from GitHub: ${getRes.status}`);
            }

            const fileData = await getRes.json();
            const sha = fileData.sha;

            // 2. UTF-8 Safe Base64 Encoding
            const updatedJsonString = JSON.stringify(this.data, null, 2);
            const base64Content = btoa(unescape(encodeURIComponent(updatedJsonString)));

            // 3. PUT Request to overwrite data.json
            const putRes = await fetch(apiUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: `Update schedule & drills via browser admin editor (${new Date().toISOString()})`,
                    content: base64Content,
                    sha: sha,
                    branch: branch
                })
            });

            if (!putRes.ok) {
                const errJson = await putRes.json();
                throw new Error(`GitHub commit failed: ${errJson.message || putRes.statusText}`);
            }

            alert("Successfully published updated schedule & drills directly to GitHub repository data.json!");
            document.getElementById('modal-editor').classList.add('hidden');
            this.render();

        } catch (err) {
            console.error(err);
            alert(`Publishing failed: ${err.message}`);
        } finally {
            publishBtn.innerHTML = originalText;
            publishBtn.disabled = false;
        }
    }
}

// Initialize application on DOM content load
document.addEventListener('DOMContentLoaded', () => {
    window.laxApp = new LaxPlannerApp();
});
