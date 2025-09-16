<!-- assistant.js -->
<script>
/* ============ Karmyog Assistant (Śrī Krishna vibe) ============

What this adds:
- Floating button “Guide”
- Slide-up panel with:
  - Insights (areas to improve) from your data
  - Daily reflection questions
  - “Ask Krishna” free text box (local heuristic replies)
  - Optional: LLM replies if user pastes an API key (stays in localStorage)
- Gentle end-of-day check-in prompt

This file relies on globals from index.html:
  auth, db, state, saveState, localDateISO, showMessage

================================================================ */

(function initAssistant(){
  // Build UI (late so DOM is ready)
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = './assistant.css';
  document.head.appendChild(css);

  const fab = document.createElement('button');
  fab.className = 'assistant-fab';
  fab.id = 'assistant-fab';
  fab.textContent = 'Guide';
  fab.title = 'Open your guide';
  document.body.appendChild(fab);

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
        <p class="assistant-note">Tip: pure on-device advice. For AI-generated replies, paste an API key below (optional).</p>
      </div>
      <div class="mb-2">
        <input id="assistant-api-key" class="w-full bg-slate-800 text-slate-200 rounded p-2" type="password" placeholder="Optional OpenAI API Key (stored locally)">
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

  const els = {
    fab, panel,
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

  // Panel show/hide
  fab.addEventListener('click', () => { panel.style.display = 'block'; renderAll(); });
  els.close.addEventListener('click', () => panel.style.display = 'none');
  els.refresh.addEventListener('click', () => renderAll());

  // Load stored API key (optional)
  try { els.apiKey.value = localStorage.getItem('karmyog:openaiKey') || ''; } catch(e){}

  els.saveKey.addEventListener('click', () => {
    try { localStorage.setItem('karmyog:openaiKey', els.apiKey.value.trim()); showMessage('API key saved locally.', 'success'); } catch(e){}
  });
  els.clearKey.addEventListener('click', () => {
    try { localStorage.removeItem('karmyog:openaiKey'); els.apiKey.value = ''; showMessage('API key removed.', 'info'); } catch(e){}
  });

  // Ask handler
  els.ask.addEventListener('click', async () => {
    const text = (els.input.value || '').trim();
    if (!text) return;
    els.input.value = '';
    appendReply('you', text);

    // 1) Always store as a journal note
    await saveJournal({ type: 'note', text });

    // 2) Try LLM if key exists; else heuristic reply
    const key = getKey();
    let reply;
    if (key) {
      reply = await llmReply(text).catch(()=>null);
    }
    if (!reply) {
      reply = localGuideReply(text);
    }
    appendReply('krishna', reply);
  });

  // Helpers
  function appendReply(who, text){
    const div = document.createElement('div');
    div.className = who === 'krishna'
      ? 'p-2 rounded bg-slate-800 border border-slate-700 krishna'
      : 'p-2 rounded bg-slate-700 border border-slate-600';
    div.textContent = text;
    els.replies.appendChild(div);
    els.replies.scrollTop = els.replies.scrollHeight;
  }
  function getKey(){ try { return localStorage.getItem('karmyog:openaiKey') || ''; } catch(e){ return ''; } }

  async function saveJournal(entry){
    try{
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      const d = new Date();
      const dateISO = localDateISO(d);
      const payload = { ...entry, dateISO, ts: d.toISOString() };
      await db.collection('users').doc(uid).set({
        journal: firebase.firestore.FieldValue.arrayUnion(payload)
      }, { merge: true });
    }catch(e){ /* ignore */ }
  }

  // Auto end-of-day reflection ask (gentle)
  // Shows once after endDayTime + 5 minutes, per day.
  setInterval(async () => {
    try{
      const s = state.settings || {};
      const edt = parseHM2(s.endDayTime || '22:30');
      if (!edt) return;
      const now = new Date();
      const shownKey = 'karmyog:reflection:'+localDateISO(now);
      const already = localStorage.getItem(shownKey);
      if (already) return;

      const trigger = new Date(edt.getTime() + 5*60*1000);
      if (now >= trigger) {
        localStorage.setItem(shownKey,'1');
        panel.style.display = 'block';
        renderReflectionBlock(true);
        showMessage('How was your practice today?', 'info');
      }
    }catch(e){}
  }, 30*1000);

  function parseHM2(hm){
    if (!hm) return null;
    const [h,m] = hm.split(':').map(Number);
    const d = new Date();
    d.setHours(h||0, m||0, 0, 0);
    return d;
  }

  // ---------- Insights from your data ----------
  function makeInsights(){
    const g = (state.goals || []);
    const metrics = [];
    g.forEach(goal => {
      metrics.push({
        name: goal.name,
        sat: goal.satatya||0,
        karma: goal.totalPracticeKarma||0,
        had: !!goal.hadTasksToday,
        done: !!goal.completedOneToday
      });
    });

    // Areas lacking = low satatya OR repeated had-but-not-done
    const lacking = metrics
      .filter(x => (x.sat < 3) || (x.had && !x.done))
      .sort((a,b) => (a.sat - b.sat) || (a.karma - b.karma))
      .slice(0,3);

    const positives = metrics
      .filter(x => x.sat >= 3 && x.done)
      .sort((a,b) => b.sat - a.sat)
      .slice(0,3);

    return {metrics, lacking, positives};
  }

  function renderInsights(){
    const {lacking, positives} = makeInsights();
    let html = '';

    if (positives.length){
      html += `<div class="mb-1"><strong class="text-emerald-400">Strengths</strong></div>`;
      positives.forEach(p => {
        html += `<div class="mb-1">• ${esc(p.name)} — Sātatya ${p.sat}, Karma ${p.karma}</div>`;
      });
    }
    if (lacking.length){
      html += `<div class="mt-2 mb-1"><strong class="text-amber-300">Needs Care</strong></div>`;
      lacking.forEach(l => {
        html += `<div class="mb-1">• ${esc(l.name)} — Sātatya ${l.sat}${l.had&&!l.done ? ', missed today' : ''}</div>`;
      });
      html += `<div class="mt-2 krishna">“Steady practice, little by little. Choose one small action you can surely complete tomorrow.”</div>`;
    }
    if (!html){
      html = `<div class="krishna">“You’re steady today. Keep walking the path.”</div>`;
    }
    els.insights.innerHTML = html;
  }

  // ---------- Reflection questions ----------
  function renderReflectionBlock(focus = false){
    const q = [
      'What did you complete today? Why did it work?',
      'What slipped? What obstacle appeared?',
      'What is one tiny action you will surely do tomorrow?'
    ];
    let html = q.map((qq,i) => `
      <div class="mb-2">
        <div class="text-slate-300 mb-1">${esc(qq)}</div>
        <textarea data-ref-q="${i}" class="w-full bg-slate-800 text-slate-100 rounded p-2" rows="2"></textarea>
      </div>`).join('');

    html += `<button id="assistant-save-reflection" class="mt-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-2 px-3 rounded">Save reflection</button>`;
    els.reflection.innerHTML = html;

    const saveBtn = document.getElementById('assistant-save-reflection');
    saveBtn.addEventListener('click', async () => {
      const answers = [...els.reflection.querySelectorAll('textarea')].map(t => t.value.trim());
      const entry = {
        type: 'reflection',
        answers
      };
      await saveJournal(entry);
      showMessage('Reflection saved.', 'success');
    }, { once: true });

    if (focus) {
      const first = els.reflection.querySelector('textarea');
      first && first.focus();
    }
  }

  // ---------- Local “Krishna” guidance (no API) ----------
  function localGuideReply(text){
    const lower = text.toLowerCase();
    if (/procrastinat|delay|later/.test(lower)) {
      return 'Act without overthinking. Choose a 2-minute version of the task and begin now. Attachment to results makes the mind heavy.';
    }
    if (/overwhelm|too much|stress|anxiety/.test(lower)) {
      return 'Reduce the field. Three pebbles only: pick 1 important, 1 quick, 1 energizing action. Complete, breathe, then repeat.';
    }
    if (/miss(ed)?|fail(ed)?|slip|couldn\'?t/.test(lower)) {
      return 'Misses are teachers. Name the obstacle, make it smaller, and pre-decide a cue for tomorrow. The doer is the habit you design.';
    }
    if (/sleep|tired|energy|rest/.test(lower)) {
      return 'Honor the instrument. Protect a fixed wind-down time and a screen-free last hour. Small rituals, steady power.';
    }
    if (/discipline|consisten|habit/.test(lower)) {
      return 'Sātatya grows with vows that are tiny and daily. Let the vow be laughably small; the soul delights in keeping it.';
    }
    return 'Walk with steadiness. Name one smallest action you will do in the next hour. Then return and tell me.';
  }

  // ---------- Optional LLM (OpenAI) ----------
  async function llmReply(userText){
    const apiKey = getKey();
    if (!apiKey) throw new Error('no key');
    const system = "Speak concisely, warmly, like Sri Krishna guiding Arjuna. Give 1-3 actionable, tiny steps. Prefer habit design.";
    const body = {
      model: "gpt-4o-mini", // change if you prefer
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText }
      ]
    };
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('bad response');
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '…';
  }

  // ---------- Render all sections ----------
  function renderAll(){
    try {
      renderInsights();
      renderReflectionBlock(false);
      els.replies.innerHTML = '';
    } catch(e){}
  }

  // Safe escape
  function esc(s){
    return String(s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
      .replace(/'/g,"&#39;");
  }

})();
</script>
