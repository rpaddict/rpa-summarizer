//@name risusummary
//@display-name RisuSummary
//@api 3.0
//@version 1.2.2
//@update-url https://raw.githubusercontent.com/rpaddict/ezSumMari/main/risusummary.js
//@description Auto-summarize AI responses using a secondary model to save context tokens. Full preset system, advanced API parameters, customizable prompts, lorebook & previous message context.

(async () => {
  const APP_VERSION = '1.2.2';
  const STORAGE_KEY = 'risusummary:settings';
  const PRESETS_KEY = 'risusummary:presets';
  const UPDATE_URL = 'https://raw.githubusercontent.com/rpaddict/ezSumMari/main/risusummary.js';

  const SVG_ICON = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
      <path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6zm2-6h2v-2H8v2zm0 3h8v-2H8v2zm0-6h2v-2H8v2zm6 0h2v-2h-2v2z"/>
    </svg>
  `;

  const MARKER_REGEX = /\*-\*-\n?[\s\S]*?-\*-\*\n?/g;

  const DEFAULT_SYSTEM_PROMPT = 'You are a precise text summarizer. Summarize the given text in 1-3 concise sentences, in the same language as the original. Focus on key events, actions, decisions, and important dialogue. Do not add commentary, explanations, or meta-remarks. Output only the summary.';

  const DEFAULT_PRESET = {
    name: 'Default',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: 0.3,
    maxTokens: 150,
    topP: 1.0,
    frequencyPenalty: 0,
    presencePenalty: 0,
    reasoningEffort: '',
    thinkingBudget: '',
    cacheEnabled: false,
    jsonMode: false,
    logprobs: false,
    topLogprobs: '',
    stopSequences: '',
    userId: '',
    seed: '',
    customParams: '',
    includeLorebook: false,
    prevMessages: 0,
    minLength: 100,
    hideFabButton: false,
    manualOffset: 0,
    systemPrompts: [{ enabled: true, text: DEFAULT_SYSTEM_PROMPT }]
  };

  var State = {
    enabled: false,
    currentPresetId: 'default',
    savedAt: 0,
    ...cloneDeep(DEFAULT_PRESET)
  };

  var Presets = { default: cloneDeep(DEFAULT_PRESET) };

  // ───── Utilities ─────

  function escapeHtml(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escapeComment(text) {
    return (text || '').replace(/-->/g, '-- >');
  }

  function cloneDeep(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function compareVersions(a, b) {
    var pa = (a || '0.0.0').replace(/[^0-9.]/g, '').split('.').map(Number);
    var pb = (b || '0.0.0').replace(/[^0-9.]/g, '').split('.').map(Number);
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var na = pa[i] || 0;
      var nb = pb[i] || 0;
      if (nb > na) return -1;
      if (na > nb) return 1;
    }
    return 0;
  }

  function stripMarkers(content) {
    var text = content || '';
    text = text.replace(/\*-\*-\n?[\s\S]*?-\*-\*\n?/g, '');
    text = text.replace(/<!-- summary:[\s\S]*?-->/g, '');
    return text.trim();
  }

  function extractOriginal(content) {
    var m = (content || '').match(/\*-\*-\n?([\s\S]*?)-\*-\*/);
    return m ? m[1].trim() : null;
  }

  function parseCustomParams() {
    if (!State.customParams || !State.customParams.trim()) return {};
    try { return JSON.parse(State.customParams); } catch (e) { console.log('[RisuSummary] Invalid custom params JSON:', e); return {}; }
  }

  // ───── Storage ─────

  async function loadPresets() {
    try {
      var stored = await risuai.pluginStorage.getItem(PRESETS_KEY);
      if (stored && typeof stored === 'object') {
        Presets = stored;
        if (!Presets.default) Presets.default = cloneDeep(DEFAULT_PRESET);
      }
    } catch (e) { console.log('[RisuSummary] Failed to load presets:', e); }
  }

  async function savePresets() {
    try { await risuai.pluginStorage.setItem(PRESETS_KEY, Presets); }
    catch (e) { console.log('[RisuSummary] Failed to save presets:', e); }
  }

  async function loadSettings() {
    try {
      var stored = await risuai.pluginStorage.getItem(STORAGE_KEY);
      if (!stored || typeof stored !== 'object') return;
      if (stored.savedAt && State.savedAt > stored.savedAt) {
        console.log('[RisuSummary] Ignoring older settings from storage (memory is newer)');
        return;
      }
      State.enabled = stored.enabled ?? false;
      State.currentPresetId = stored.currentPresetId ?? 'default';
      State.apiUrl = stored.apiUrl ?? DEFAULT_PRESET.apiUrl;
      State.apiKey = stored.apiKey ?? '';
      State.model = stored.model ?? DEFAULT_PRESET.model;
      State.temperature = stored.temperature ?? 0.3;
      State.maxTokens = stored.maxTokens ?? 150;
      State.topP = stored.topP ?? 1.0;
      State.frequencyPenalty = stored.frequencyPenalty ?? 0;
      State.presencePenalty = stored.presencePenalty ?? 0;
      State.reasoningEffort = stored.reasoningEffort ?? '';
      State.thinkingBudget = stored.thinkingBudget ?? '';
      State.cacheEnabled = stored.cacheEnabled ?? false;
      State.jsonMode = stored.jsonMode ?? false;
      State.logprobs = stored.logprobs ?? false;
      State.topLogprobs = stored.topLogprobs ?? '';
      State.stopSequences = stored.stopSequences ?? '';
      State.userId = stored.userId ?? '';
      State.seed = stored.seed ?? '';
      State.customParams = stored.customParams ?? '';
      State.includeLorebook = stored.includeLorebook ?? false;
      State.prevMessages = stored.prevMessages ?? 0;
      State.minLength = stored.minLength ?? 100;
      State.hideFabButton = stored.hideFabButton ?? false;
      State.manualOffset = stored.manualOffset ?? 0;
      State.savedAt = stored.savedAt || 0;
      if (stored.systemPrompts && Array.isArray(stored.systemPrompts)) {
        State.systemPrompts = stored.systemPrompts;
      }
    } catch (e) { console.log('[RisuSummary] Failed to load settings:', e); }
  }

  async function saveSettings() {
    try {
      State.savedAt = Date.now();
      await risuai.pluginStorage.setItem(STORAGE_KEY, {
        enabled: State.enabled,
        currentPresetId: State.currentPresetId,
        apiUrl: State.apiUrl, apiKey: State.apiKey, model: State.model,
        temperature: State.temperature, maxTokens: State.maxTokens,
        topP: State.topP, frequencyPenalty: State.frequencyPenalty, presencePenalty: State.presencePenalty,
        reasoningEffort: State.reasoningEffort, thinkingBudget: State.thinkingBudget,
        cacheEnabled: State.cacheEnabled, jsonMode: State.jsonMode, logprobs: State.logprobs,
        topLogprobs: State.topLogprobs, stopSequences: State.stopSequences, userId: State.userId,
        seed: State.seed, customParams: State.customParams,
        includeLorebook: State.includeLorebook, prevMessages: State.prevMessages, minLength: State.minLength,
        hideFabButton: State.hideFabButton, manualOffset: State.manualOffset,
        systemPrompts: State.systemPrompts,
        savedAt: State.savedAt
      });
    } catch (e) { console.log('[RisuSummary] Failed to save settings:', e); }
  }

  // ───── Presets ─────

  function buildPresetData(name) {
    return {
      name: name,
      apiUrl: State.apiUrl, apiKey: State.apiKey, model: State.model,
      temperature: State.temperature, maxTokens: State.maxTokens,
      topP: State.topP, frequencyPenalty: State.frequencyPenalty, presencePenalty: State.presencePenalty,
      reasoningEffort: State.reasoningEffort, thinkingBudget: State.thinkingBudget,
      cacheEnabled: State.cacheEnabled, jsonMode: State.jsonMode, logprobs: State.logprobs,
      topLogprobs: State.topLogprobs, stopSequences: State.stopSequences, userId: State.userId,
      seed: State.seed, customParams: State.customParams,
      includeLorebook: State.includeLorebook, prevMessages: State.prevMessages, minLength: State.minLength,
      hideFabButton: State.hideFabButton, manualOffset: State.manualOffset,
      systemPrompts: cloneDeep(State.systemPrompts)
    };
  }

  async function saveAsPreset(name) {
    var id = 'preset_' + Date.now();
    Presets[id] = buildPresetData(name || 'New Preset');
    await savePresets();
    return id;
  }

  async function loadPreset(presetId) {
    if (!Presets[presetId]) return false;
    var p = Presets[presetId];
    State.currentPresetId = presetId;
    Object.assign(State, {
      apiUrl: p.apiUrl ?? DEFAULT_PRESET.apiUrl, apiKey: p.apiKey ?? '', model: p.model ?? DEFAULT_PRESET.model,
      temperature: p.temperature ?? 0.3, maxTokens: p.maxTokens ?? 150,
      topP: p.topP ?? 1.0, frequencyPenalty: p.frequencyPenalty ?? 0, presencePenalty: p.presencePenalty ?? 0,
      reasoningEffort: p.reasoningEffort ?? '', thinkingBudget: p.thinkingBudget ?? '',
      cacheEnabled: p.cacheEnabled ?? false, jsonMode: p.jsonMode ?? false, logprobs: p.logprobs ?? false,
      topLogprobs: p.topLogprobs ?? '', stopSequences: p.stopSequences ?? '', userId: p.userId ?? '',
      seed: p.seed ?? '', customParams: p.customParams ?? '',
      includeLorebook: p.includeLorebook ?? false, prevMessages: p.prevMessages ?? 0, minLength: p.minLength ?? 100,
      hideFabButton: p.hideFabButton ?? false, manualOffset: p.manualOffset ?? 0,
      systemPrompts: p.systemPrompts ? cloneDeep(p.systemPrompts) : [{ enabled: true, text: DEFAULT_SYSTEM_PROMPT }]
    });
    await saveSettings();
    return true;
  }

  async function deletePreset(presetId) {
    if (presetId === 'default') return false;
    delete Presets[presetId];
    await savePresets();
    return true;
  }

  async function updatePreset(presetId) {
    if (!Presets[presetId]) return false;
    Presets[presetId] = buildPresetData(Presets[presetId].name);
    await savePresets();
    return true;
  }

  // ───── Lorebook ─────

  async function getLorebookContent() {
    try {
      var charIndex = await risuai.getCurrentCharacterIndex();
      var chatIndex = await risuai.getCurrentChatIndex();
      var char = await risuai.getCharacterFromIndex(charIndex);
      var chat = await risuai.getChatFromIndex(charIndex, chatIndex);

      var entries = [];
      if (char?.globalLore) entries = entries.concat(char.globalLore);
      if (chat?.localLore) entries = entries.concat(chat.localLore);

      var filtered = entries.filter(function(l) {
        return l.mode !== 'folder' && !l.disabled && (l.content || l.value || l.text);
      });

      if (filtered.length === 0) return '';
      return filtered.map(function(l) { return l.content || l.value || l.text || ''; }).join('\n\n---\n\n');
    } catch (e) {
      console.log('[RisuSummary] Lorebook fetch failed:', e);
      return '';
    }
  }

  // ───── Previous Messages Context ─────

  async function getPreviousMessages(count) {
    if (count <= 0) return '';
    try {
      var charIndex = await risuai.getCurrentCharacterIndex();
      var chatIndex = await risuai.getCurrentChatIndex();
      var chat = await risuai.getChatFromIndex(charIndex, chatIndex);
      if (!chat?.message || chat.message.length === 0) return '';

      var msgs = [];
      var remaining = count;
      for (var i = chat.message.length - 1; i >= 0 && remaining > 0; i--) {
        var msg = chat.message[i];
        if (msg.disabled || msg.isComment) continue;
        if (!msg.data || !msg.data.trim()) continue;
        msgs.unshift(msg);
        remaining--;
      }

      if (msgs.length === 0) return '';

      return msgs.map(function(m) {
        var roleLabel = (m.role === 'user' || m.role === 'char' || m.role === 'assistant') ? m.role : 'unknown';
        var text = (m.data || '').replace(MARKER_REGEX, '').trim();
        return '[' + roleLabel + ']: ' + text;
      }).join('\n\n');
    } catch (e) {
      console.log('[RisuSummary] Previous messages fetch failed:', e);
      return '';
    }
  }

  // ───── Summarization ─────

  async function summarize(text) {
    if (!State.apiUrl || !State.model) return null;

    var messages = [];

    if (State.includeLorebook) {
      var loreContent = await getLorebookContent();
      if (loreContent) {
        messages.push({ role: 'system', content: 'Current world context (lorebook):\n\n' + loreContent });
      }
    }

    for (var i = 0; i < (State.systemPrompts || []).length; i++) {
      var sp = State.systemPrompts[i];
      if (sp.enabled && sp.text && sp.text.trim()) {
        messages.push({ role: 'system', content: sp.text.trim() });
      }
    }

    var prevContext = await getPreviousMessages(State.prevMessages);
    var userContent = '';
    if (prevContext) {
      userContent += 'Previous conversation:\n' + prevContext + '\n\n';
    }
    userContent += 'Summarize this AI response:\n---\n' + text + '\n---';

    messages.push({ role: 'user', content: userContent });

    var body = {
      model: State.model, messages: messages, temperature: State.temperature, max_tokens: State.maxTokens, stream: false,
      ...(State.topP !== 1.0 && { top_p: State.topP }),
      ...(State.frequencyPenalty !== 0 && { frequency_penalty: State.frequencyPenalty }),
      ...(State.presencePenalty !== 0 && { presence_penalty: State.presencePenalty }),
      ...(State.reasoningEffort && { reasoning_effort: State.reasoningEffort }),
      ...(State.thinkingBudget && { thinking: { budget_tokens: parseInt(State.thinkingBudget) } }),
      ...(State.cacheEnabled && { cache_enabled: true }),
      ...(State.jsonMode && { response_format: { type: 'json_object' } }),
      ...(State.logprobs && { logprobs: true }),
      ...(State.logprobs && State.topLogprobs && { top_logprobs: parseInt(State.topLogprobs) }),
      ...(State.stopSequences && { stop: State.stopSequences.split(',').map(function(s) { return s.trim(); }).filter(Boolean) }),
      ...(State.userId && { user: State.userId }),
      ...(State.seed && { seed: parseInt(State.seed) }),
      ...parseCustomParams()
    };

    var headers = { 'Content-Type': 'application/json' };
    if (State.apiKey) headers['Authorization'] = 'Bearer ' + State.apiKey;

    console.log('[RisuSummary] Calling ' + State.model + ' for summarization (' + messages.length + ' messages)...');
    var resp = await risuai.nativeFetch(State.apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      var errText = '';
      try { errText = await resp.text(); } catch (_) {}
      console.error('[RisuSummary] API error ' + resp.status + ': ' + errText.substring(0, 200));
      return null;
    }

    var data = await resp.json();
    var result = null;
    if (data.choices && data.choices[0]) {
      result = data.choices[0].message?.content || data.choices[0].text || '';
    } else if (data.content && Array.isArray(data.content)) {
      result = data.content.map(function(c) { return c.text || ''; }).join('');
    } else if (typeof data.result === 'string') {
      result = data.result;
    } else if (typeof data.response === 'string') {
      result = data.response;
    }
    return (result || '').trim() || null;
  }

  // ───── afterRequest: auto-summarize ─────

  async function afterRequestHandler(content, type) {
    if (type !== 'model') return content;
    if (!State.enabled) return content;
    if (!State.apiUrl || !State.apiKey || !State.model) return content;
    if (!content || content.length < State.minLength) return content;
    if (content.indexOf('*-*-') !== -1 && content.indexOf('-*-*') !== -1) return content;
    if (content.indexOf('<!-- summary:') !== -1) return content;

    try {
      var summary = await summarize(content);
      if (!summary) return content;
      console.log('[RisuSummary] Summarized ' + content.length + ' -> ' + summary.length + ' chars');
      return '*-*-\n' + content + '\n-*-*\n<!-- summary: ' + escapeComment(summary) + ' -->';
    } catch (e) {
      console.error('[RisuSummary] Summarization failed:', e);
      return content;
    }
  }

  // ───── beforeRequest: strip marker-wrapped content ─────

  async function beforeRequestHandler(messages, type) {
    if (!State.enabled) return messages;

    var cleanMessages = [];
    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      if (typeof msg.content === 'string' && msg.content.indexOf('*-*-') !== -1) {
        cleanMessages.push(Object.assign({}, msg, {
          content: msg.content.replace(MARKER_REGEX, '')
        }));
      } else {
        cleanMessages.push(msg);
      }
    }
    return cleanMessages;
  }

  // ───── FAB: manual re-summarize ─────

  async function onFabClick() {
    try {
      var charIndex = await risuai.getCurrentCharacterIndex();
      var chatIndex = await risuai.getCurrentChatIndex();
      var chat = await risuai.getChatFromIndex(charIndex, chatIndex);
      if (!chat?.message || chat.message.length === 0) return;

      var offset = State.manualOffset || 0;
      var found = 0;
      var targetIdx = -1;
      for (var i = chat.message.length - 1; i >= 0; i--) {
        var role = chat.message[i].role;
        if (role === 'assistant' || role === 'char') {
          if (found === offset) { targetIdx = i; break; }
          found++;
        }
      }
      if (targetIdx < 0) return;

      var msg = chat.message[targetIdx];
      var original = extractOriginal(msg.data);
      var textToSummarize = original || stripMarkers(msg.data);
      if (!textToSummarize) return;

      if (textToSummarize.length < State.minLength) return;

      console.log('[RisuSummary] FAB: re-summarizing message ' + (targetIdx + 1) + ' (' + textToSummarize.length + ' chars)');
      var summary = await summarize(textToSummarize);
      if (!summary) return;

      chat.message[targetIdx].data = '*-*-\n' + textToSummarize + '\n-*-*\n<!-- summary: ' + escapeComment(summary) + ' -->';
      await risuai.setChatToIndex(charIndex, chatIndex, chat);
      console.log('[RisuSummary] FAB: re-summarized (' + summary.length + ' chars)');
    } catch (e) {
      console.error('[RisuSummary] FAB error:', e);
    }
  }

  // ───── Settings UI ─────

  function buildPresetOptions() {
    var keys = Object.keys(Presets);
    var html = '';
    for (var i = 0; i < keys.length; i++) {
      var id = keys[i];
      var p = Presets[id];
      var selected = id === State.currentPresetId ? ' selected' : '';
      html += '<option value="' + escapeHtml(id) + '"' + selected + '>' + escapeHtml(p.name) + '</option>';
    }
    return html;
  }

  function buildSystemPromptList() {
    var prompts = State.systemPrompts || [];
    if (prompts.length === 0) return '<div class="rs-hint">No system prompts. Click "+ Add Prompt" to create one.</div>';
    var html = '';
    for (var i = 0; i < prompts.length; i++) {
      var sp = prompts[i];
      html += '<div class="rs-prompt-item" style="margin-bottom:10px;border:1px solid #d0d7de;border-radius:8px;overflow:hidden;">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#f6f8fa;border-bottom:1px solid #d0d7de;">';
      html += '<label class="rs-checkbox-sm" style="margin:0;font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px;cursor:pointer;">';
      html += '<input type="checkbox" class="rs-prompt-enabled" data-idx="' + i + '" ' + (sp.enabled ? 'checked' : '') + '>';
      html += '<span>Enabled</span></label>';
      html += '<button class="rs-btn rs-btn-danger rs-prompt-delete" data-idx="' + i + '" style="padding:4px 10px;font-size:12px;">Delete</button>';
      html += '</div>';
      html += '<textarea class="rs-textarea rs-prompt-text" data-idx="' + i + '" style="border:none;border-radius:0;min-height:80px;resize:vertical;">' + escapeHtml(sp.text || '') + '</textarea>';
      html += '</div>';
    }
    return html;
  }

  function showStatus(msg, isError) {
    var el = document.getElementById('rs-status');
    if (el) {
      el.textContent = msg;
      el.style.display = 'block';
      el.className = 'rs-status' + (isError ? ' error' : ' success');
    }
  }

  async function openSettings() {
    await risuai.showContainer('fullscreen');
    await renderSettingsUI();
  }

  async function renderSettingsUI() {
    var colorScheme = 'light';
    try { colorScheme = await risuai.getColorScheme(); } catch(_) {}
    var darkSchemes = ['dark', 'cherry', 'galaxy', 'realblack', 'monokai-black'];
    var isDark = darkSchemes.indexOf(colorScheme) !== -1;
    var themeClass = isDark ? 'dark' : '';

    var updateInfo = await getUpdateInfo();
    var updateBannerHtml = '';
    if (updateInfo) {
      updateBannerHtml = '<div class="rs-update-banner" id="rs-update-banner">UPDATE: v' + escapeHtml(updateInfo.current) + ' -> v' + escapeHtml(updateInfo.version) + ' <span class="rs-update-close" id="rs-update-dismiss">x</span></div>';
    }

    document.body.innerHTML = `
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Malgun Gothic", sans-serif; background: transparent; color: #24292e; font-size: 14px; line-height: 1.5; height: 100vh; display: flex; justify-content: center; overflow: hidden; }
        .rs-container { max-width: 680px; width: 100%; margin: 0 auto; background: #fff; border: 1px solid #d0d7de; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); overflow: hidden; display: flex; flex-direction: column; max-height: calc(100vh - 40px); }
        .rs-header { background: linear-gradient(135deg, #8b5cf6, #7c3aed); padding: 16px 20px; color: #fff; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
        .rs-header-title { font-size: 18px; font-weight: 700; }
        .rs-close { cursor: pointer; padding: 4px 10px; background: rgba(255,255,255,0.2); border-radius: 6px; font-size: 12px; }
        .rs-close:hover { background: rgba(255,255,255,0.3); }
        .rs-scrollable { flex: 1; overflow-y: auto; padding: 20px; }
        .rs-section { margin-bottom: 18px; padding-bottom: 16px; border-bottom: 1px solid #e1e4e8; }
        .rs-section:last-child { border-bottom: none; margin-bottom: 0; }
        .rs-label { display: block; font-size: 12px; font-weight: 600; color: #24292e; margin-bottom: 6px; }
        .rs-input { width: 100%; padding: 8px 10px; border: 1px solid #d0d7de; border-radius: 6px; font-size: 13px; background: #f6f8fa; color: #24292e; font-family: inherit; }
        .rs-select { width: 100%; padding: 8px 10px; border: 1px solid #d0d7de; border-radius: 6px; font-size: 13px; background: #f6f8fa; color: #24292e; font-family: inherit; }
        .rs-textarea { width: 100%; padding: 10px; border: 1px solid #d0d7de; border-radius: 6px; font-size: 12px; font-family: "SF Mono", Monaco, Consolas, monospace; line-height: 1.5; background: #f6f8fa; color: #24292e; resize: vertical; }
        .rs-checkbox { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 15px; font-weight: 600; margin-bottom: 4px; }
        .rs-checkbox input { width: 18px; height: 18px; accent-color: #7c3aed; }
        .rs-checkbox-large { font-size: 15px; font-weight: 700; gap: 10px; }
        .rs-checkbox-large input { width: 20px; height: 20px; accent-color: #7c3aed; }
        .rs-checkbox-sm { font-size: 12px !important; }
        .rs-checkbox-sm input { width: 14px; height: 14px; }
        .rs-hint { font-size: 11px; color: #6a737d; margin-top: 4px; }
        .rs-btn { padding: 8px 14px; border: 1px solid #d0d7de; border-radius: 6px; background: #f6f8fa; color: #24292e; font-size: 13px; cursor: pointer; font-weight: 500; }
        .rs-btn:hover { background: #e8eaed; }
        .rs-btn-primary { background: #7c3aed; border-color: #7c3aed; color: #fff; }
        .rs-btn-primary:hover { background: #6d28d9; }
        .rs-btn-danger { background: #cf222e; border-color: #cf222e; color: #fff; }
        .rs-btn-danger:hover { background: #a40e26; }
        .rs-footer { flex-shrink: 0; padding: 0 20px 20px; border-top: 1px solid #e1e4e8; }
        .rs-status { margin-top: 10px; padding: 8px 12px; border-radius: 6px; font-size: 12px; text-align: center; display: none; }
        .rs-status.success { background: #dafbe1; color: #1a7f37; }
        .rs-status.error { background: #ffebe9; color: #cf222e; }
        .rs-preset-row { display: flex; gap: 8px; align-items: flex-end; }
        .rs-preset-row .rs-select { width: 220px; flex: none; }
        .rs-preset-actions-inline { display: flex; gap: 6px; }
        .rs-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .rs-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
        .rs-grid-4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; }

        .dark .rs-container { background: #2d3243; border-color: #4a5160; }
        .dark .rs-section { border-color: #4a5160; }
        .dark .rs-label { color: #e1e4e8; }
        .dark .rs-input, .dark .rs-select, .dark .rs-textarea { background: #1e212b; border-color: #505564; color: #e1e4e8; }
        .dark .rs-hint { color: #959da5; }
        .dark .rs-btn { background: #2d3243; border-color: #505564; color: #e1e4e8; }
        .dark .rs-btn-primary { background: #6d28d9; border-color: #8b5cf6; }
        .dark .rs-btn-danger { background: #8b2b2b; border-color: #cf222e; }
        .dark .rs-footer { border-color: #4a5160; }
        .dark .rs-status.success { background: #1c4a2a; color: #3fb950; }
        .dark .rs-status.error { background: #4a1c1c; color: #f85149; }
        .dark .rs-prompt-item > div:first-child { background: #1e212b !important; border-color: #505564 !important; }

        .rs-modal-overlay { display: none; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10; align-items: center; justify-content: center; }
        .rs-modal-overlay.active { display: flex; }
        .rs-modal { background: #fff; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); width: 500px; max-height: 70vh; display: flex; flex-direction: column; overflow: hidden; }
        .rs-modal-header { padding: 14px 18px; background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
        .rs-modal-header span { font-size: 14px; font-weight: 700; }
        .rs-modal-body { flex: 1; overflow-y: auto; padding: 16px; }
        .rs-modal-footer { flex-shrink: 0; padding: 12px 16px; border-top: 1px solid #e1e4e8; display: flex; gap: 8px; justify-content: flex-end; }
        .rs-import-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid #d0d7de; border-radius: 6px; margin-bottom: 6px; cursor: pointer; }
        .rs-import-item:hover { background: #f6f8fa; }
        .rs-import-item input[type="checkbox"] { width: 16px; height: 16px; accent-color: #7c3aed; flex-shrink: 0; }
        .rs-import-item-name { font-size: 13px; font-weight: 600; }
        .rs-import-item-meta { font-size: 11px; color: #6a737d; }

        .dark .rs-modal { background: #2d3243; }
        .dark .rs-modal-footer { border-color: #4a5160; }
        .dark .rs-import-item { border-color: #505564; }
        .dark .rs-import-item:hover { background: #1e212b; }
        .dark .rs-import-item-name { color: #e1e4e8; }
        .dark .rs-import-item-meta { color: #959da5; }

        .rs-update-banner { margin: 12px 20px 0; padding: 10px 14px; background: #fef3c7; border: 1px solid #f59e0b; border-left: 3px solid #f59e0b; border-radius: 8px; font-size: 13px; font-weight: 600; color: #92400e; display: flex; align-items: center; gap: 8px; }
        .rs-update-banner .rs-update-close { margin-left: auto; cursor: pointer; padding: 2px 6px; opacity: 0.6; }
        .rs-update-banner .rs-update-close:hover { opacity: 1; }
        .dark .rs-update-banner { background: #422006; border-color: #d97706; color: #fde68a; }
      </style>

      <div class="rs-container ${themeClass}">
        <div class="rs-header">
          <div class="rs-header-title">RisuSummary v${escapeHtml(APP_VERSION)}</div>
          <div class="rs-close" id="rs-close">X Close</div>
        </div>

        <div class="rs-scrollable">
          ${updateBannerHtml}
          <!-- Auto toggle -->
          <div class="rs-section">
            <label class="rs-checkbox rs-checkbox-large">
              <input type="checkbox" id="rs-enabled" ${State.enabled ? 'checked' : ''}>
              <span>Auto Summarization</span>
            </label>
            <div class="rs-hint" style="padding-left: 30px;">When AI finishes responding, summarize with a secondary model and wrap the original</div>
          </div>

          <!-- Preset -->
          <div class="rs-section">
            <div class="rs-preset-row">
              <div>
                <div class="rs-label">Preset (select to apply immediately)</div>
                <select id="rs-preset-select" class="rs-select">
                  ${buildPresetOptions()}
                </select>
              </div>
              <div class="rs-preset-actions-inline">
                <button class="rs-btn" id="rs-preset-save">Save Current</button>
                <button class="rs-btn" id="rs-preset-new">New</button>
                <button class="rs-btn" id="rs-preset-rename">Rename</button>
                <button class="rs-btn rs-btn-danger" id="rs-preset-delete" ${State.currentPresetId === 'default' ? 'disabled' : ''}>Delete</button>
              </div>
            </div>
            <div style="margin-top: 8px;">
              <button class="rs-btn" id="rs-import-proofreader">Import Presets from Proofreader</button>
            </div>
            <div class="rs-hint">Select a preset from the dropdown to apply it immediately</div>
          </div>

          <!-- API Config -->
          <div class="rs-section">
            <div class="rs-label">API Configuration</div>
            <div style="margin-bottom: 8px;">
              <div class="rs-label">API URL</div>
              <input type="text" id="rs-api-url" class="rs-input" value="${escapeHtml(State.apiUrl)}" placeholder="https://api.openai.com/v1/chat/completions">
            </div>
            <div style="margin-bottom: 8px;">
              <div class="rs-label">API Key</div>
              <input type="text" id="rs-api-key" class="rs-input" value="${escapeHtml(State.apiKey)}" placeholder="sk-...">
            </div>
            <div class="rs-grid-3">
              <div>
                <div class="rs-label">Model</div>
                <input type="text" id="rs-model" class="rs-input" value="${escapeHtml(State.model)}" placeholder="gpt-4o-mini">
              </div>
              <div>
                <div class="rs-label">Temperature</div>
                <input type="number" id="rs-temp" class="rs-input" value="${State.temperature}" min="0" max="2" step="0.1">
              </div>
              <div>
                <div class="rs-label">Max Tokens</div>
                <input type="number" id="rs-max-tokens" class="rs-input" value="${State.maxTokens}" min="30" max="32000" step="10">
              </div>
            </div>
            <div class="rs-hint">Use the cheapest model available for summarization</div>
          </div>

          <!-- Advanced -->
          <div class="rs-section">
            <div class="rs-label">Advanced Options</div>
            <div class="rs-grid-4" style="margin-bottom: 8px;">
              <div><div class="rs-label">Top P</div><input type="number" id="rs-top-p" class="rs-input" value="${State.topP}" min="0" max="1" step="0.1"></div>
              <div><div class="rs-label">Freq Penalty</div><input type="number" id="rs-freq-penalty" class="rs-input" value="${State.frequencyPenalty}" min="-2" max="2" step="0.1"></div>
              <div><div class="rs-label">Presence Penalty</div><input type="number" id="rs-pres-penalty" class="rs-input" value="${State.presencePenalty}" min="-2" max="2" step="0.1"></div>
              <div><div class="rs-label">Seed</div><input type="number" id="rs-seed" class="rs-input" value="${escapeHtml(State.seed)}" placeholder="number"></div>
            </div>
            <div class="rs-grid-2" style="margin-bottom: 8px;">
              <div>
                <div class="rs-label">Reasoning Effort</div>
                <select id="rs-reasoning" class="rs-select">
                  <option value="" ${State.reasoningEffort === '' ? 'selected' : ''}>None</option>
                  <option value="low" ${State.reasoningEffort === 'low' ? 'selected' : ''}>Low</option>
                  <option value="medium" ${State.reasoningEffort === 'medium' ? 'selected' : ''}>Medium</option>
                  <option value="high" ${State.reasoningEffort === 'high' ? 'selected' : ''}>High</option>
                </select>
              </div>
              <div>
                <div class="rs-label">Thinking Budget</div>
                <input type="number" id="rs-thinking-budget" class="rs-input" value="${escapeHtml(State.thinkingBudget)}" placeholder="e.g. 1024">
              </div>
            </div>
            <div class="rs-grid-4" style="margin-bottom: 8px;">
              <label class="rs-checkbox"><input type="checkbox" id="rs-cache" ${State.cacheEnabled ? 'checked' : ''}><span>Cache</span></label>
              <label class="rs-checkbox"><input type="checkbox" id="rs-json" ${State.jsonMode ? 'checked' : ''}><span>JSON Mode</span></label>
              <label class="rs-checkbox"><input type="checkbox" id="rs-logprobs" ${State.logprobs ? 'checked' : ''}><span>Logprobs</span></label>
              <div><div class="rs-label">Top Logprobs</div><input type="number" id="rs-top-logprobs" class="rs-input" value="${escapeHtml(State.topLogprobs)}" placeholder="e.g. 5"></div>
            </div>
            <div class="rs-grid-2">
              <div><div class="rs-label">Stop Sequences (comma separated)</div><input type="text" id="rs-stop" class="rs-input" value="${escapeHtml(State.stopSequences)}" placeholder="e.g. END,STOP"></div>
              <div><div class="rs-label">User ID</div><input type="text" id="rs-user-id" class="rs-input" value="${escapeHtml(State.userId)}" placeholder="user identifier"></div>
            </div>
          </div>

          <!-- Custom Params -->
          <div class="rs-section">
            <div class="rs-label">Custom Parameters (JSON)</div>
            <textarea id="rs-custom-params" class="rs-textarea" style="min-height:60px;" placeholder='e.g. {\n  "provider": {\n    "order": ["Google"],\n    "allow_fallbacks": false\n  }\n}'>${escapeHtml(State.customParams)}</textarea>
            <div class="rs-hint">OpenRouter provider routing, etc.</div>
          </div>

          <!-- Summarization-specific settings -->
          <div class="rs-section">
            <div class="rs-label">Summarization Settings</div>
            <div class="rs-grid-2" style="margin-bottom: 12px;">
              <div>
                <div class="rs-label">Min Message Length (chars)</div>
                <input type="number" id="rs-min-len" class="rs-input" value="${State.minLength}" min="0" max="5000" step="10">
              </div>
              <div>
                <div class="rs-label">Prev Messages Context</div>
                <input type="number" id="rs-prev-msgs" class="rs-input" value="${State.prevMessages}" min="0" max="20" step="1">
                <div class="rs-hint">0 = current message only</div>
              </div>
            </div>
            <label class="rs-checkbox" style="margin-bottom: 6px;">
              <input type="checkbox" id="rs-include-lorebook" ${State.includeLorebook ? 'checked' : ''}>
              <span>Include active lorebook entries</span>
            </label>
            <div class="rs-hint" style="padding-left: 26px;">Send character/channel lorebook context to summarization model</div>
          </div>

          <!-- FAB Settings -->
          <div class="rs-section">
            <div class="rs-label">Quick Re-Summarize Button (FAB)</div>
            <label class="rs-checkbox" style="margin-bottom: 10px;">
              <input type="checkbox" id="rs-hide-fab" ${State.hideFabButton ? 'checked' : ''}>
              <span>Hide FAB button</span>
            </label>
            <div class="rs-hint" style="padding-left: 26px;">Restart RisuAI for change to take effect</div>
            <div style="margin-top: 10px;">
              <div class="rs-label">Message offset (0 = most recent, 1 = one before, etc.)</div>
              <input type="number" id="rs-manual-offset" class="rs-input" value="${State.manualOffset ?? 0}" min="0" max="20" step="1" style="width: 140px;">
              <div class="rs-hint">Which AI message to re-summarize when FAB is clicked</div>
            </div>
          </div>

          <!-- System Prompts -->
          <div class="rs-section">
            <div class="rs-label">System Prompts (sent to summarization model)</div>
            <div id="rs-prompt-list">
              ${buildSystemPromptList()}
            </div>
            <div style="display: flex; gap: 8px; margin-top: 10px;">
              <button class="rs-btn" id="rs-prompt-add">+ Add Prompt</button>
              <button class="rs-btn" id="rs-prompt-reset">Reset to Default</button>
            </div>
            <div class="rs-hint">System prompts define how the summarizer behaves. Enabled prompts are sent in order.</div>
          </div>

          <!-- Import Modal -->
          <div class="rs-modal-overlay" id="rs-import-modal">
            <div class="rs-modal">
              <div class="rs-modal-header">
                <span>Import Presets from Proofreader</span>
                <button class="rs-close" id="rs-modal-close">X</button>
              </div>
              <div class="rs-modal-body" id="rs-modal-body">
                <div style="text-align:center;padding:20px;color:#6a737d;">Loading...</div>
              </div>
              <div class="rs-modal-footer">
                <button class="rs-btn" id="rs-modal-cancel">Cancel</button>
                <button class="rs-btn rs-btn-primary" id="rs-modal-import">Import Selected</button>
              </div>
            </div>
          </div>

        </div>

        <div class="rs-footer">
          <div style="display: flex; gap: 8px; justify-content: center; padding-top: 16px;">
            <button class="rs-btn rs-btn-primary" id="rs-save">Save All Settings</button>
          </div>
          <div id="rs-status" class="rs-status"></div>
        </div>
      </div>
    `;

    // ───── Event listeners ─────

    document.getElementById('rs-close')?.addEventListener('click', function() { risuai.hideContainer(); });

    document.getElementById('rs-update-dismiss')?.addEventListener('click', async function() {
      await risuai.pluginStorage.removeItem('risusummary:updateAvailable');
      var banner = document.getElementById('rs-update-banner');
      if (banner) banner.style.display = 'none';
    });

    // Auto toggle
    document.getElementById('rs-enabled')?.addEventListener('change', async function(e) {
      State.enabled = e.target.checked;
      await saveSettings();
      showStatus(State.enabled ? 'Auto summarization ON' : 'Auto summarization OFF');
    });

    // Import from Proofreader (modal with preset checkbox list)
    var proofreaderPresets = null;

    document.getElementById('rs-import-proofreader')?.addEventListener('click', async function() {
      showStatus('');
      var raw = await risuai.pluginStorage.getItem('proofreader:presets');
      if (!raw || typeof raw !== 'object' || Object.keys(raw).length === 0) {
        showStatus('No proofreader presets found. Make sure proofreader plugin is installed and has saved presets.', true);
        return;
      }
      proofreaderPresets = raw;
      var keys = Object.keys(raw);
      var html = '';
      html += '<label class="rs-checkbox" style="margin-bottom:10px;"><input type="checkbox" id="rs-select-all" checked><span>Select All / Deselect All</span></label>';
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var p = raw[k];
        html += '<label class="rs-import-item"><input type="checkbox" class="rs-import-preset-cb" data-preset-id="' + escapeHtml(k) + '" checked><div><div class="rs-import-item-name">' + escapeHtml(p.name || k) + '</div><div class="rs-import-item-meta">' + escapeHtml(p.model || 'no model') + '</div></div></label>';
      }
      document.getElementById('rs-modal-body').innerHTML = html;

      document.getElementById('rs-select-all')?.addEventListener('change', function(e) {
        document.querySelectorAll('.rs-import-preset-cb').forEach(function(cb) { cb.checked = e.target.checked; });
      });

      document.getElementById('rs-import-modal').classList.add('active');
    });

    document.getElementById('rs-modal-close')?.addEventListener('click', function() {
      document.getElementById('rs-import-modal').classList.remove('active');
    });

    document.getElementById('rs-modal-cancel')?.addEventListener('click', function() {
      document.getElementById('rs-import-modal').classList.remove('active');
    });

    document.getElementById('rs-modal-import')?.addEventListener('click', async function() {
      var cbs = document.querySelectorAll('.rs-import-preset-cb:checked');
      if (cbs.length === 0) { showStatus('No presets selected', true); return; }

      var imported = 0;
      cbs.forEach(function(cb) {
        var pid = cb.dataset.presetId;
        var p = proofreaderPresets[pid];
        if (!p) return;
        var newId = 'preset_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        Presets[newId] = {
          name: (p.name || 'Imported') + ' (from proofreader)',
          apiUrl: p.apiUrl ?? '', apiKey: p.apiKey ?? '', model: p.model ?? '',
          temperature: p.temperature ?? 0.3, maxTokens: Math.min(p.maxTokens ?? 8000, 1000),
          topP: p.topP ?? 1.0, frequencyPenalty: p.frequencyPenalty ?? 0, presencePenalty: p.presencePenalty ?? 0,
          reasoningEffort: p.reasoningEffort ?? '', thinkingBudget: p.thinkingBudget ?? '',
          cacheEnabled: p.cacheEnabled ?? false, jsonMode: p.jsonMode ?? false, logprobs: p.logprobs ?? false,
          topLogprobs: p.topLogprobs ?? '', stopSequences: p.stopSequences ?? '', userId: p.userId ?? '',
          seed: p.seed ?? '', customParams: p.customParams ?? '',
          includeLorebook: p.includeLorebook ?? false,
          prevMessages: State.prevMessages, minLength: State.minLength,
          hideFabButton: false, manualOffset: 0,
          systemPrompts: cloneDeep(State.systemPrompts)
        };
        imported++;
      });

      document.getElementById('rs-import-modal').classList.remove('active');
      await savePresets();
      await renderSettingsUI();
      showStatus('Imported ' + imported + ' preset(s) from proofreader');
    });

    // Preset controls
    document.getElementById('rs-preset-select')?.addEventListener('change', async function(e) {
      var presetId = e.target.value;
      if (await loadPreset(presetId)) {
        await renderSettingsUI();
        showStatus('Preset "' + Presets[presetId].name + '" applied');
      }
    });

    document.getElementById('rs-preset-save')?.addEventListener('click', async function() {
      var presetId = State.currentPresetId;
      if (presetId === 'default') {
        await updatePreset(presetId);
        showStatus('Default preset updated');
      } else if (Presets[presetId]) {
        await updatePreset(presetId);
        showStatus('Preset "' + Presets[presetId].name + '" updated');
      } else {
        var name = prompt('New preset name:', 'New Preset');
        if (name) {
          var newId = await saveAsPreset(name);
          State.currentPresetId = newId;
          await saveSettings();
          await renderSettingsUI();
          showStatus('Preset "' + name + '" created');
        }
      }
    });

    document.getElementById('rs-preset-new')?.addEventListener('click', async function() {
      var name = prompt('New preset name:', 'New Preset');
      if (name) {
        var newId = await saveAsPreset(name);
        State.currentPresetId = newId;
        await saveSettings();
        await renderSettingsUI();
        showStatus('Preset "' + name + '" created');
      }
    });

    document.getElementById('rs-preset-delete')?.addEventListener('click', async function() {
      var presetId = State.currentPresetId;
      if (presetId === 'default') { showStatus('Cannot delete default preset', true); return; }
      if (Presets[presetId]) {
        await deletePreset(presetId);
        State.currentPresetId = 'default';
        await loadPreset('default');
        await renderSettingsUI();
        showStatus('Preset deleted');
      }
    });

    document.getElementById('rs-preset-rename')?.addEventListener('click', async function() {
      var presetId = State.currentPresetId;
      if (!Presets[presetId]) return;
      var newName = prompt('Rename preset:', Presets[presetId].name);
      if (newName && newName.trim()) {
        Presets[presetId].name = newName.trim();
        await savePresets();
        await renderSettingsUI();
        showStatus('Preset renamed to "' + newName.trim() + '"');
      }
    });

    // Form fields — auto-save on blur
    var fields = [
      ['rs-api-url', 'apiUrl', 'trim'], ['rs-api-key', 'apiKey', 'trim'], ['rs-model', 'model', 'trim'],
      ['rs-temp', 'temperature', 'float'], ['rs-max-tokens', 'maxTokens', 'int'],
      ['rs-top-p', 'topP', 'float'], ['rs-freq-penalty', 'frequencyPenalty', 'float'], ['rs-pres-penalty', 'presencePenalty', 'float'],
      ['rs-thinking-budget', 'thinkingBudget', 'trim'], ['rs-seed', 'seed', 'trim'],
      ['rs-top-logprobs', 'topLogprobs', 'trim'], ['rs-stop', 'stopSequences', 'trim'], ['rs-user-id', 'userId', 'trim'],
      ['rs-custom-params', 'customParams', 'trim'],
      ['rs-min-len', 'minLength', 'int'], ['rs-prev-msgs', 'prevMessages', 'int']
    ];
    fields.forEach(function(item) {
      var id = item[0], key = item[1], type = item[2];
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('blur', async function() {
          var value = el.value;
          if (type === 'float') value = parseFloat(value) || 0;
          if (type === 'int') value = parseInt(value) || 0;
          State[key] = value;
          await saveSettings();
        });
      }
    });

    document.getElementById('rs-reasoning')?.addEventListener('change', async function(e) { State.reasoningEffort = e.target.value; await saveSettings(); });
    document.getElementById('rs-cache')?.addEventListener('change', async function(e) { State.cacheEnabled = e.target.checked; await saveSettings(); });
    document.getElementById('rs-json')?.addEventListener('change', async function(e) { State.jsonMode = e.target.checked; await saveSettings(); });
    document.getElementById('rs-logprobs')?.addEventListener('change', async function(e) { State.logprobs = e.target.checked; await saveSettings(); });
    document.getElementById('rs-include-lorebook')?.addEventListener('change', async function(e) { State.includeLorebook = e.target.checked; await saveSettings(); });
    document.getElementById('rs-hide-fab')?.addEventListener('change', async function(e) { State.hideFabButton = e.target.checked; await saveSettings(); });
    var offsetTimer = null;
    document.getElementById('rs-manual-offset')?.addEventListener('input', function(e) {
      if (offsetTimer) clearTimeout(offsetTimer);
      var el = e.target;
      offsetTimer = setTimeout(async function() {
        var newVal = Math.max(0, parseInt(el.value) || 0);
        State.manualOffset = newVal;
        await saveSettings();
      }, 300);
    });

    // System prompt controls
    document.getElementById('rs-prompt-add')?.addEventListener('click', async function() {
      State.systemPrompts.push({ enabled: true, text: '' });
      await saveSettings();
      await renderSettingsUI();
      showStatus('System prompt added');
    });

    document.getElementById('rs-prompt-reset')?.addEventListener('click', async function() {
      State.systemPrompts = [{ enabled: true, text: DEFAULT_SYSTEM_PROMPT }];
      await saveSettings();
      await renderSettingsUI();
      showStatus('System prompts reset to default');
    });

    document.querySelectorAll('.rs-prompt-delete').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var idx = parseInt(btn.dataset.idx);
        State.systemPrompts.splice(idx, 1);
        await saveSettings();
        await renderSettingsUI();
        showStatus('System prompt deleted');
      });
    });

    document.querySelectorAll('.rs-prompt-enabled').forEach(function(cb) {
      cb.addEventListener('change', async function() {
        var idx = parseInt(cb.dataset.idx);
        if (State.systemPrompts[idx]) {
          State.systemPrompts[idx].enabled = cb.checked;
          await saveSettings();
        }
      });
    });

    document.querySelectorAll('.rs-prompt-text').forEach(function(ta) {
      ta.addEventListener('blur', async function() {
        var idx = parseInt(ta.dataset.idx);
        if (State.systemPrompts[idx]) {
          State.systemPrompts[idx].text = ta.value;
          await saveSettings();
        }
      });
    });

    // Save all button
    document.getElementById('rs-save')?.addEventListener('click', async function() {
      // Sync textarea values
      document.querySelectorAll('.rs-prompt-text').forEach(function(ta) {
        var idx = parseInt(ta.dataset.idx);
        if (State.systemPrompts[idx]) {
          State.systemPrompts[idx].text = ta.value;
        }
      });
      await saveSettings();
      showStatus('All settings saved');
    });
  }

  // ───── Auto-Update Check ─────

  var updateCheckCooldown = 3600000;

  async function checkForUpdate() {
    if (!UPDATE_URL) return;
    try {
      var lastCheck = await risuai.pluginStorage.getItem('risusummary:lastUpdateCheck');
      if (lastCheck) {
        var elapsed = Date.now() - parseInt(lastCheck, 10);
        if (elapsed < updateCheckCooldown) return;
      }

      var resp = await risuai.nativeFetch(UPDATE_URL, {
        method: 'GET',
        headers: { 'Range': 'bytes=0-512' }
      });

      if (!resp.ok) return;
      var text = await resp.text();
      var match = text.match(/\/\/@version\s+([^\r\n]+)/);
      if (!match) return;
      var remoteVersion = match[1].trim();

      if (compareVersions(APP_VERSION, remoteVersion) < 0) {
        console.log('[RisuSummary] ========================================');
        console.log('[RisuSummary] UPDATE AVAILABLE: v' + APP_VERSION + ' -> v' + remoteVersion);
        console.log('[RisuSummary] ========================================');
        await risuai.pluginStorage.setItem('risusummary:updateAvailable', JSON.stringify({
          version: remoteVersion,
          current: APP_VERSION,
          checkedAt: Date.now()
        }));
        showUpdateToast(APP_VERSION, remoteVersion);
      } else {
        await risuai.pluginStorage.removeItem('risusummary:updateAvailable');
      }

      await risuai.pluginStorage.setItem('risusummary:lastUpdateCheck', String(Date.now()));
    } catch (e) {
      console.log('[RisuSummary] Update check failed:', e.message || e);
    }
  }

  async function getUpdateInfo() {
    try {
      var raw = await risuai.pluginStorage.getItem('risusummary:updateAvailable');
      if (!raw) return null;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) { return null; }
  }

  // ───── Update Toast (on main page) ─────

  async function showUpdateToast(currentVersion, newVersion) {
    try {
      var rootDoc = await risuai.getRootDocument();
      if (!rootDoc) return;

      var existing = await rootDoc.querySelector('[x-rs-update-toast]');
      if (existing) try { await existing.remove(); } catch (e) {}

      var body = await rootDoc.querySelector('body');
      if (!body) return;

      var colorScheme = 'light';
      try { colorScheme = await risuai.getColorScheme(); } catch (_) {}
      var darkSchemes = ['dark', 'cherry', 'galaxy', 'realblack', 'monokai-black'];
      var isDark = darkSchemes.indexOf(colorScheme) !== -1;

      var bg = isDark ? '#1f2937' : '#ffffff';
      var border = isDark ? '#374151' : '#d0d7de';
      var accent = '#f59e0b';
      var text = isDark ? '#e5e7eb' : '#24292e';
      var subtext = isDark ? '#9ca3af' : '#6a737d';
      var versionColor = isDark ? '#6ee7b7' : '#15803d';
      var shadow = 'rgba(0,0,0,0.4)';

      var div = await rootDoc.createElement('div');
      await div.setAttribute('x-rs-update-toast', '1');

      var styles = {
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: '99999',
        background: bg,
        border: '1px solid ' + border,
        borderLeft: '3px solid ' + accent,
        borderRadius: '10px',
        padding: '12px 14px',
        maxWidth: '360px',
        minWidth: '260px',
        boxShadow: '0 8px 24px ' + shadow,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        pointerEvents: 'auto',
        opacity: '0',
        transform: 'translateY(12px)',
        transition: 'opacity 0.3s ease, transform 0.3s ease'
      };
      for (var key in styles) {
        try { await div.setStyle(key, styles[key]); } catch (e) {}
      }

      await div.setInnerHTML(
        '<div style="display:flex;align-items:flex-start;gap:10px">' +
        '<div style="font-size:18px;line-height:1;flex-shrink:0">@</div>' +
        '<div style="flex:1;min-width:0">' +
        '<div style="font-size:13px;font-weight:600;color:' + accent + '">RisuSummary Update Available</div>' +
        '<div style="font-size:11px;color:' + subtext + ';margin-top:2px">' +
        'v' + escapeHtml(currentVersion) + '  <span style="color:' + versionColor + '">v' + escapeHtml(newVersion) + '</span>' +
        '</div>' +
        '<div style="font-size:10px;color:' + subtext + ';margin-top:4px">Open Plugin Settings to update. This toast will disappear in 12s.</div>' +
        '</div></div>'
      );

      await body.appendChild(div);

      setTimeout(async function() {
        try {
          await div.setStyle('opacity', '1');
          await div.setStyle('transform', 'translateY(0)');
        } catch (e) {}
      }, 50);

      setTimeout(async function() {
        try {
          await div.setStyle('opacity', '0');
          await div.setStyle('transform', 'translateY(12px)');
          setTimeout(async function() {
            try { await div.remove(); } catch (e) {}
          }, 350);
        } catch (e) {}
      }, 12000);

    } catch (e) {
      console.log('[RisuSummary] Toast failed:', e.message || e);
    }
  }

  // ───── Init ─────

  try {
    await loadPresets();
    await loadSettings();

    await risuai.addRisuReplacer('afterRequest', afterRequestHandler);
    await risuai.addRisuReplacer('beforeRequest', beforeRequestHandler);

    await risuai.registerButton({
      name: 'RisuSummary',
      icon: SVG_ICON,
      iconType: 'html',
      location: 'chat'
    }, openSettings);

    await risuai.registerSetting('RisuSummary', openSettings, SVG_ICON, 'html');

    if (!State.hideFabButton) {
      await risuai.registerButton({
        name: 'RisuSummary-ReSummarize',
        icon: SVG_ICON,
        iconType: 'html',
        location: 'action'
      }, onFabClick);
    }

    await risuai.onUnload(function() {
      console.log('[RisuSummary] Unloaded');
    });

    // Request mainDom permission for update toasts (user will be prompted once)
    try { await risuai.requestPluginPermission('mainDom', 'periodically'); } catch (e) {}

    // Auto-update check (delayed, with cooldown)
    setTimeout(function() { checkForUpdate(); }, 5000);

    console.log('[RisuSummary] v' + APP_VERSION + ' initialized');
    console.log('[RisuSummary] Auto summarization: ' + (State.enabled ? 'ON' : 'OFF'));
    console.log('[RisuSummary] Preset: ' + State.currentPresetId + ', Prev msgs: ' + State.prevMessages + ', Lorebook: ' + (State.includeLorebook ? 'ON' : 'OFF'));

  } catch (error) {
    console.log('[RisuSummary] Init failed:', error);
  }
})();
