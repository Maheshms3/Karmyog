/* Karmyog Assistant (robust loader) */
/* Shows a "Guide" button and panel; works even without API key or auth. */
/* Waits until your app globals (dom/auth/db/state) exist before attaching UI */

(function () {
  // Wait until document + Karmyog globals are ready
  function whenReady(check, then, tries = 120, delay = 250) {
    const t = setInterval(() => {
      try {
        if (check()) {
          clearInterval(t);
          then();
        } else if (--tries <= 0) {
          clearInterval(t);
          console.warn('[Assistant] Timed out waiting for app to be ready.');
        }
      } catch (e) {
        clearInterval(t);
        console.error('[Assistant] init error:', e);
      }
    }, delay);
  }

  window.addEventListener('load', () => {
    whenReady(
      // Check: body exists and at least dom or taskList render target exists
      () => document.body && (window.dom || document.getElementById('task-list')),
      initAssistant
    );
  });

  function initAssistant() {
    // Grab globals if present (guard each usage)
    const auth = window.auth || null;
    const db = window.db || null;
    const esc = (s) =>
      String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    // Inject FAB
    const fab = document.createElement('button');
    fab.className = 'assistant-fab';
    fab.id = 'assistant-fab';
    fab.textContent = 'Guide';
    fab.title = 'Open your guide';
    document.body.appendChild(fab);

    // Inject panel
    const panel = document.createElement('div');
    panel.className = 'assistant-panel dark';
    panel.id = 'assistant-panel';
    panel.innerHTML = `
      <header>
        <strong>Śrī Krishna • Your Guide</strong>
        <div class="flex items-center gap-2">
          <button id="assistant-refresh" class="text-xs bg-slate-700 hover:bg-slate-600 rounded px-2 py-1">Refresh</button>
          <button id="assistant-close" class="text-xs bg-slate-700 hover:bg-slate-600 rounded px-2 py-1">✕</button>
        </div>
      </header>
      <div class="assistant-body text-sm" id="assistant-body">
        <div class="mb-3">
          <div class="text-xs uppercase text-slate-400">Insights</div>
          <div id="assistant-insights" class="mt-1"></div>
        </div>
        <div class="mb-3">
          <div class="text-xs uppercase text-slate-400">Reflection</div>
          <div id="assistant-reflection" class="mt-1"></div>
        </div>
        <div class="mb-1">
          <div class="text-xs uppercase text-slate-400">Ask Krishna</div>
          <textarea id="assistant-input" class="w-full mt-1 bg-slate-800 text-slate-100 rounded p-2" rows="3" placeholder="Share your experience, doubt, or struggle..."></textarea>
          <button id="assistant-ask" class="mt-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold py-2 px-3 rounded">Ask</button>
          <p class="assistant-note">Tip: works without an API key. For richer AI replies, paste your OpenAI key below (stored locally).</p>
        </div>
        <div class="mb-2">
          <input id="assistant-api-key" class="w-full bg-slate-800 text-slate-200 rounded p-2" type="password" placeholder="Optional OpenAI API Key">
          <div class="mt-2 flex gap-2">
            <button id="assistant-save-key" class="bg-slate-700 hover:bg-slate-600 text-xs rounded px-2 py-1">Save key</button>
            <button id="assistant-clear-key" class="bg-slate-700 hover:bg-slate-600 text-xs rounded px-2 py-1">Remove key</button>
          </div>
        </div>
        <div id="assistant-replies" class="mt-2 space-y-2"></div>
      </div>
      <div class="assistant-footer text-xs text-slate-400">
        “You have a right to perform your prescribed duties, but not to the fruits.” — Gītā 2.47
      </div>
    `;
    document.body.appendChild(panel);

    // Cache elements
    const els = {
      fab,
      panel,
      close: panel.querySelector('#assistant-close'),
      refresh: panel.querySelector('#assistant-refresh'),
      insights: panel.querySelector('#assistant-insights'),
      reflection: panel.querySelector('#assistant-reflection'),
      input: panel.querySelector('#assistant-input'),
      ask: panel.querySelector('#assistant-ask'),
      replies: panel.querySelector('#assistant-replies'),
      apiKey: panel.querySelector('#assistant-api-key'),
      saveKey: panel.querySelector('#assistant-save-key'),
      clearKey: panel.querySelector('#assistant-clear-key'),
    };

    // Load saved key (optional)
    try {
      els.apiKey.value = localStorage.getItem('karmyog:openaiKey') || '';
    } catch (e) {}

    // Events
    els.fab.addEventListener('click', () => {
      panel.style.display = 'block';
      renderAll();
    });
    els.close.addEventListener('click', () => (panel.style.display = 'none'));
    els.refresh.addEventListener('click', () => renderAll());

    els.saveKey.addEventListener('click', () => {
      try {
        localStorage.setItem('karmyog:openaiKey', els.apiKey.value.trim());
        toast('API key saved locally.', 'success');
      } catch (e) {}
    });
    els.clearKey.addEventListener('click', () => {
      try {
        localStorage.removeItem('karmyog:openaiKey');
        els.apiKey.value = '';
        toast('API key removed.', 'info');
      } catch (e) {}
    });

    els.ask.addEventListener('click', async () => {
      const text = (els.input.value || '').trim();
      if (!text) return;
      els.input.value = '';
      appendReply('you', text);

      // Always store as journal note (if Firestore + auth available)
      await saveJournal({ type: 'note', text }).catch(() => {});

      // Try LLM if key; else local guidance
      let reply = null;
      const key = getKey();
      if (key) {
        reply = await llmReply(text, key).catch(() => null);
      }
      if (!reply) reply = localGuideReply(text);
      appendReply('krishna', reply);
    });

    // -------- Renderers --------
    function renderAll() {
      try {
        renderInsights();
        renderReflection();
        els.replies.innerHTML = '';
      } catch (e) {
        console.warn('[Assistant] render error', e);
      }
    }

    function makeInsights() {
      const s = window.state || {};
      const goals = s.goals || [];
      const list = goals.map((g) => ({
        name: g.name,
        sat: g.satatya || 0,
        karma: g.totalPracticeKarma || 0,
        had: !!g.hadTasksToday,
        done: !!g.completedOneToday,
      }));

      const lacking = list
        .filter((x) => x.sat < 3 || (x.had && !x.done))
        .sort((a, b) => (a.sat - b.sat) || (a.karma - b.karma))
        .slice(0, 3);

      const positives = list
        .filter((x) => x.sat >= 3 && x.done)
        .sort((a, b) => b.sat - a.sat)
        .slice(0, 3);

      return { lacking, positives };
    }

    function renderInsights() {
      const { lacking, positives } = makeInsights();
      let html = '';
      if (positives.length) {
        html += `<div class="mb-1"><strong class="text-emerald-400">Strengths</strong></div>`;
        positives.forEach((p) => {
          html += `<div class="mb-1">• ${esc(p.name)} — Sātatya ${p.sat}, Karma ${p.karma}</div>`;
        });
      }
      if (lacking.length) {
        html += `<div class="mt-2 mb-1"><strong class="text-amber-300">Needs Care</strong></div>`;
        lacking.forEach((l) => {
          html += `<div class="mb-1">• ${esc(l.name)} — Sātatya ${l.sat}${l.had && !l.done ? ', missed today' : ''}</div>`;
        });
        html += `<div class="mt-2 krishna">“Steady practice, little by little. Choose one small action you can surely complete tomorrow.”</div>`;
      }
      if (!html) {
        html = `<div class="krishna">“You’re steady today. Keep walking the path.”</div>`;
      }
      els.insights.innerHTML = html;
    }

    function renderReflection() {
      const qs = [
        'What did you complete today? Why did it work?',
        'What slipped? What obstacle appeared?',
        'What one tiny action will you surely do tomorrow?',
      ];
      let html = qs
        .map(
          (q, i) => `
          <div class="mb-2">
            <div class="text-slate-300 mb-1">${esc(q)}</div>
            <textarea data-ref-q="${i}" class="w-full bg-slate-800 text-slate-100 rounded p-2" rows="2"></textarea>
          </div>`
        )
        .join('');
      html += `<button id="assistant-save-reflection" class="mt-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-2 px-3 rounded">Save reflection</button>`;
      els.reflection.innerHTML = html;

      const btn = document.getElementById('assistant-save-reflection');
      btn.addEventListener(
        'click',
        async () => {
          const answers = [...els.reflection.querySelectorAll('textarea')].map((t) => t.value.trim());
          await saveJournal({ type: 'reflection', answers }).catch(() => {});
          toast('Reflection saved.', 'success');
        },
        { once: true }
      );
    }

    // -------- Replies --------
    function localGuideReply(text) {
      const lower = (text || '').toLowerCase();
      if (/procrastinat|delay|later/.test(lower)) {
        return 'Act without overthinking. Make a 2-minute version of the task and begin now. Attachment to results makes the mind heavy.';
      }
      if (/overwhelm|too much|stress|anxiety/.test(lower)) {
        return 'Narrow the field: pick 1 important, 1 quick, 1 energizing action. Complete, breathe, repeat.';
      }
      if (/miss(ed)?|fail(ed)?|slip|couldn'?t/.test(lower)) {
        return 'Misses are teachers. Name the obstacle, make it smaller, pre-decide a cue for tomorrow. The doer is the habit you design.';
      }
      if (/sleep|tired|energy|rest/.test(lower)) {
        return 'Protect the instrument. Fix a wind-down time and keep the last hour screen-free. Small rituals, steady power.';
      }
      if (/discipline|consisten|habit/.test(lower)) {
        return 'Sātatya grows with tiny vows. Let your vow be laughably small; the joy is in keeping it daily.';
      }
      return 'Walk with steadiness. Name one smallest action you will do in the next hour—then return and tell me.';
    }

    function getKey() {
      try {
        return localStorage.getItem('karmyog:openaiKey') || '';
      } catch (e) {
        return '';
      }
    }

    async function llmReply(userText, apiKey) {
      const body = {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Speak concisely, warmly, like Sri Krishna guiding Arjuna. Give 1–3 tiny, actionable steps. Prefer habit design.' },
          { role: 'user', content: userText },
        ],
      };
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('LLM error');
      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() || '…';
    }

    function appendReply(who, text) {
      const div = document.createElement('div');
      div.className =
        who === 'krishna'
          ? 'p-2 rounded bg-slate-800 border border-slate-700 krishna'
          : 'p-2 rounded bg-slate-700 border border-slate-600';
      div.textContent = text;
      els.replies.appendChild(div);
      els.replies.scrollTop = els.replies.scrollHeight;
    }

    // -------- Journal storage (safe if auth/db missing) --------
    async function saveJournal(entry) {
      try {
        if (!db || !auth || !auth.currentUser) return; // silently skip if not signed in
        const d = new Date();
        const dateISO = new Date().toLocaleDateString('en-CA');
        const payload = { ...entry, dateISO, ts: d.toISOString() };
        await db
          .collection('users')
          .doc(auth.currentUser.uid)
          .set({ journal: firebase.firestore.FieldValue.arrayUnion(payload) }, { merge: true });
      } catch (e) {
        // ignore
      }
    }

    // -------- Toast helper (uses your showMessage if present) --------
    function toast(msg, type) {
      if (typeof window.showMessage === 'function') {
        try {
          window.showMessage(msg, type);
          return;
        } catch (e) {}
      }
      console.log('[Assistant]', type || 'info', msg);
    }
  }
})();
