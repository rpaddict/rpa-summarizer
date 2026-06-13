//@name rpa-summarizer
//@display-name RPA Summarizer
//@api 3.0
//@version 1.2.5
//@update-url https://raw.githubusercontent.com/rpaddict/rpa-summarizer/main/rpa-summarizer.js
//@description Auto-summarize AI responses using a secondary model to save context tokens. Full preset system, advanced API parameters, customizable prompts, lorebook & previous message context.

(async () => {
  const APP_VERSION = '1.2.5';
  const STORAGE_KEY = 'rpa-summarizer:settings';
  const PRESETS_KEY = 'rpa-summarizer:presets';
  const UPDATE_URL = 'https://raw.githubusercontent.com/rpaddict/rpa-summarizer/main/rpa-summarizer.js';

  const SVG_ICON = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
      <path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6zm2-6h2v-2H8v2zm0 3h8v-2H8v2zm0-6h2v-2H8v2zm6 0h2v-2h-2v2z"/>
    </svg>
  `;

  const MARKER_REGEX = /<rpa-orig>[\s\S]*?<\/rpa-orig>/g;

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
    hideFabButton: false,
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

  function parseCustomParams() {
    if (!State.customParams || !State.customParams.trim()) return {};
    try { return JSON.parse(State.customParams); } catch (e) { console.log('[RPA Summarizer] Invalid custom params JSON:', e); return {}; }
  }

  // ───── Storage ─────

  async function loadPresets() {
    try {
      var stored = await risuai.pluginStorage.getItem(PRESETS_KEY);
      if (stored && typeof stored === 'object') {
        Presets = stored;
        if (!Presets.default) Presets.default = cloneDeep(DEFAULT_PRESET);
      }
    } catch (e) { console.log('[RPA Summarizer] Failed to load presets:', e); }
  }

  async function savePresets() {
    try { await risuai.pluginStorage.setItem(PRESETS_KEY, Presets); }
    catch (e) { console.log('[RPA Summarizer] Failed to save presets:', e); }
  }

  async function loadSettings() {
    try {
      var stored = await risuai.pluginStorage.getItem(STORAGE_KEY);
      if (!stored || typeof stored !== 'object') return;
      if (stored.savedAt && State.savedAt > stored.savedAt) {
        console.log('[RPA Summarizer] Ignoring older settings from storage (memory is newer)');
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
      State.hideFabButton = stored.hideFabButton ?? false;
      State.savedAt = stored.savedAt || 0;
      if (stored.systemPrompts && Array.isArray(stored.systemPrompts)) {
        State.systemPrompts = stored.systemPrompts;
      }
    } catch (e) { console.log('[RPA Summarizer] Failed to load settings:', e); }
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
        includeLorebook: State.includeLorebook, prevMessages: State.prevMessages,
        hideFabButton: State.hideFabButton,
        systemPrompts: State.systemPrompts,
        savedAt: State.savedAt
      });
    } catch (e) { console.log('[RPA Summarizer] Failed to save settings:', e); }
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
      includeLorebook: State.includeLorebook, prevMessages: State.prevMessages,
      hideFabButton: State.hideFabButton,
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
      includeLorebook: p.includeLorebook ?? false, prevMessages: p.prevMessages ?? 0,
      hideFabButton: p.hideFabButton ?? false,
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
      console.log('[RPA Summarizer] Lorebook fetch failed:', e);
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
      console.log('[RPA Summarizer] Previous messages fetch failed:', e);
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

    console.log('[RPA Summarizer] Calling ' + State.model + ' for summarization (' + messages.length + ' messages)...');
    var resp = await risuai.nativeFetch(State.apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      var errText = '';
      try { errText = await resp.text(); } catch (_) {}
      console.error('[RPA Summarizer] API error ' + resp.status + ': ' + errText.substring(0, 200));
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
    if (content.indexOf('<rpa-orig>') !== -1 && content.indexOf('</rpa-orig>') !== -1) return content;
    if (content.indexOf('<!-- summary:') !== -1) return content;

    try {
      var summary = await summarize(content);
      if (!summary) return content;
      console.log('[RPA Summarizer] Summarized ' + content.length + ' -> ' + summary.length + ' chars');
      return '<rpa-orig>\n' + content + '\n</rpa-orig>\n<!-- summary: ' + escapeComment(summary) + ' -->';
    } catch (e) {
      console.error('[RPA Summarizer] Summarization failed:', e);
      return content;
    }
  }

  // ───── beforeRequest: strip marker-wrapped content ─────

  async function beforeRequestHandler(messages, type) {
    if (!State.enabled) return messages;

    var cleanMessages = [];
    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      if (typeof msg.content === 'string' && msg.content.indexOf('<rpa-orig>') !== -1) {
        cleanMessages.push(Object.assign({}, msg, {
          content: msg.content.replace(MARKER_REGEX, '')
        }));
      } else {
        cleanMessages.push(msg);
      }
    }
    return cleanMessages;
  }

  // ───── Utilities ─────

  function stripMarkers(content) {
    var text = content || '';
    text = text.replace(/<rpa-orig>[\s\S]*?<\/rpa-orig>/g, '');
    text = text.replace(/<!-- summary:[\s\S]*?-->/g, '');
    return text.trim();
  }

  function extractOriginal(content) {
    var m = (content || '').match(/<rpa-orig>\n?([\s\S]*?)<\/rpa-orig>/);
    return m ? m[1].trim() : null;
  }

  // ───── FAB: manual re-summarize ─────

  async function onFabClick() {
    try {
      var charIndex = await risuai.getCurrentCharacterIndex();
      var chatIndex = await risuai.getCurrentChatIndex();
      var chat = await risuai.getChatFromIndex(charIndex, chatIndex);
      if (!chat?.message || chat.message.length === 0) return;

      var targetIdx = -1;
      for (var i = chat.message.length - 1; i >= 0; i--) {
        var role = chat.message[i].role;
        if (role === 'assistant' || role === 'char') { targetIdx = i; break; }
      }
      if (targetIdx < 0) return;

      var msg = chat.message[targetIdx];
      var textToSummarize = (msg.data || '').replace(MARKER_REGEX, '').trim();
      if (!textToSummarize) return;

      console.log('[RPA Summarizer] FAB: re-summarizing message ' + (targetIdx + 1) + ' (' + textToSummarize.length + ' chars)');
      var summary = await summarize(textToSummarize);
      if (!summary) return;

      chat.message[targetIdx].data = '<rpa-orig>\n' + textToSummarize + '\n</rpa-orig>\n<!-- summary: ' + escapeComment(summary) + ' -->';
      await risuai.setChatToIndex(charIndex, chatIndex, chat);
      console.log('[RPA Summarizer] FAB: re-summarized (' + summary.length + ' chars)');
    } catch (e) {
      console.error('[RPA Summarizer] FAB error:', e);
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
    if (prompts.length === 0) return '<div class="rs-hint">등록된 시스템 프롬프트가 없습니다. "+ 프롬프트 추가"를 클릭해 추가해 주세요.</div>';
    var html = '';
    for (var i = 0; i < prompts.length; i++) {
      var sp = prompts[i];
      html += '<div class="rs-prompt-item" style="margin-bottom:10px;border:1px solid #d0d7de;border-radius:8px;overflow:hidden;">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#f6f8fa;border-bottom:1px solid #d0d7de;">';
      html += '<label class="rs-checkbox-sm" style="margin:0;font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px;cursor:pointer;">';
      html += '<input type="checkbox" class="rs-prompt-enabled" data-idx="' + i + '" ' + (sp.enabled ? 'checked' : '') + '>';
      html += '<span>활성화</span></label>';
      html += '<button class="rs-btn rs-btn-danger rs-prompt-delete" data-idx="' + i + '" style="padding:4px 10px;font-size:12px;">삭제</button>';
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
    try {
      await risuai.requestPluginPermission('db');
    } catch (e) {}
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
      updateBannerHtml = '<div class="rs-update-banner" id="rs-update-banner">UPDATE: v' + escapeHtml(updateInfo.current) + ' -> v' + escapeHtml(updateInfo.version) + ' <button class="rs-btn rs-btn-primary" id="rs-update-now" style="margin-left: 10px; padding: 2px 8px; font-size: 11px; font-weight: bold; cursor: pointer; border-radius: 4px;">지금 업데이트</button> <span class="rs-update-close" id="rs-update-dismiss">x</span></div>';
    }

    document.body.innerHTML = `
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Malgun Gothic", sans-serif; background: rgba(0,0,0,0.4); color: #24292e; font-size: 14px; line-height: 1.5; height: 100vh; display: flex; justify-content: flex-end; overflow: hidden; }
        .rs-container { max-width: 756px; width: 100%; height: 100vh; background: #fff; border: none; border-left: 1px solid #d0d7de; border-radius: 0; box-shadow: -4px 0 12px rgba(0,0,0,0.15); overflow: hidden; display: flex; flex-direction: column; max-height: 100vh; }
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
        .rs-checkbox { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; font-weight: 600; margin-bottom: 4px; }
        .rs-checkbox input { width: 16px; height: 16px; accent-color: #7c3aed; }
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

        .rs-help-btn { width: 24px; height: 24px; border-radius: 50%; background: rgba(255,255,255,0.25); border: 1px solid rgba(255,255,255,0.4); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1; margin-left: 8px; flex-shrink: 0; }
        .rs-help-btn:hover { background: rgba(255,255,255,0.35); }
        .rs-help-modal-overlay { display: none; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 20; align-items: center; justify-content: center; }
        .rs-help-modal-overlay.active { display: flex; }
        .rs-help-modal { background: #fff; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); width: 520px; max-height: 75vh; display: flex; flex-direction: column; overflow: hidden; }
        .rs-help-modal-header { padding: 14px 18px; background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
        .rs-help-modal-header span { font-size: 14px; font-weight: 700; }
        .rs-help-modal-body { flex: 1; overflow-y: auto; padding: 18px; font-size: 13px; line-height: 1.7; color: #24292e; }
        .rs-help-modal-body h3 { font-size: 15px; margin: 14px 0 6px; color: #7c3aed; }
        .rs-help-modal-body h3:first-child { margin-top: 0; }
        .rs-help-modal-body p { margin: 0 0 8px; }
        .rs-help-modal-body ul { margin: 4px 0 10px; padding-left: 20px; }
        .rs-help-modal-body li { margin-bottom: 4px; }
        .dark .rs-help-modal { background: #2d3243; }
        .dark .rs-help-modal-body { color: #e1e4e8; }
        .dark .rs-help-modal-body h3 { color: #a78bfa; }
      </style>

      <div class="rs-container ${themeClass}">
        <div class="rs-header">
          <div style="display: flex; align-items: center;">
            <div class="rs-header-title">RPA Summarizer v${escapeHtml(APP_VERSION)}</div>
            <button class="rs-help-btn" id="rs-help-btn">?</button>
          </div>
          <div class="rs-close" id="rs-close">X 닫기</div>
        </div>

        <div class="rs-scrollable">
          ${updateBannerHtml}
          <!-- Auto toggle -->
          <div class="rs-section">
            <label class="rs-checkbox rs-checkbox-large">
              <input type="checkbox" id="rs-enabled" ${State.enabled ? 'checked' : ''}>
              <span>자동 요약 활성화</span>
            </label>
            <div class="rs-hint" style="padding-left: 30px;">AI의 답변이 완료되면 보조 모델로 요약문을 생성하고 원본 메시지를 감싸서 숨깁니다.</div>
          </div>

          <!-- Preset -->
          <div class="rs-section">
            <div class="rs-preset-row">
              <div>
                <div class="rs-label">프리셋 (선택 시 즉시 적용)</div>
                <select id="rs-preset-select" class="rs-select">
                  ${buildPresetOptions()}
                </select>
              </div>
              <div class="rs-preset-actions-inline">
                <button class="rs-btn" id="rs-preset-save">현재 설정 저장</button>
                <button class="rs-btn" id="rs-preset-new">새 프리셋</button>
                <button class="rs-btn" id="rs-preset-rename">이름 변경</button>
                <button class="rs-btn rs-btn-danger" id="rs-preset-delete" ${State.currentPresetId === 'default' ? 'disabled' : ''}>삭제</button>
              </div>
            </div>
            <div style="margin-top: 8px;">
              <button class="rs-btn" id="rs-import-proofreader">Proofreader API 설정 가져오기</button>
            </div>
            <div class="rs-hint">드롭다운에서 프리셋을 선택하여 바로 적용할 수 있습니다.</div>
          </div>

          <!-- API Config -->
          <div class="rs-section">
            <div class="rs-label">API 설정</div>
            <div style="margin-bottom: 8px;">
              <div class="rs-label">API 주소 (URL)</div>
              <input type="text" id="rs-api-url" class="rs-input" value="${escapeHtml(State.apiUrl)}" placeholder="https://api.openai.com/v1/chat/completions">
            </div>
            <div style="margin-bottom: 8px;">
              <div class="rs-label">API 키 (API Key)</div>
              <input type="text" id="rs-api-key" class="rs-input" value="${escapeHtml(State.apiKey)}" placeholder="sk-...">
            </div>
            <div class="rs-grid-3">
              <div>
                <div class="rs-label">모델명 (Model)</div>
                <input type="text" id="rs-model" class="rs-input" value="${escapeHtml(State.model)}" placeholder="gpt-4o-mini">
              </div>
              <div>
                <div class="rs-label">온도 (Temperature)</div>
                <input type="number" id="rs-temp" class="rs-input" value="${State.temperature}" min="0" max="2" step="0.1">
              </div>
              <div>
                <div class="rs-label">최대 토큰 수 (Max Tokens)</div>
                <input type="number" id="rs-max-tokens" class="rs-input" value="${State.maxTokens}" min="30" max="32000" step="10">
              </div>
            </div>
            <div class="rs-hint">요약 작업에는 가장 저렴한 모델을 사용하는 것을 권장합니다.</div>
          </div>

          <!-- Advanced -->
          <div class="rs-section">
            <div class="rs-label">고급 옵션</div>
            <div class="rs-grid-4" style="margin-bottom: 8px;">
              <div><div class="rs-label">Top P</div><input type="number" id="rs-top-p" class="rs-input" value="${State.topP}" min="0" max="1" step="0.1"></div>
              <div><div class="rs-label">빈도 페널티</div><input type="number" id="rs-freq-penalty" class="rs-input" value="${State.frequencyPenalty}" min="-2" max="2" step="0.1"></div>
              <div><div class="rs-label">존재 페널티</div><input type="number" id="rs-pres-penalty" class="rs-input" value="${State.presencePenalty}" min="-2" max="2" step="0.1"></div>
              <div><div class="rs-label">시드 (Seed)</div><input type="number" id="rs-seed" class="rs-input" value="${escapeHtml(State.seed)}" placeholder="number"></div>
            </div>
            <div class="rs-grid-2" style="margin-bottom: 8px;">
              <div>
                <div class="rs-label">추론 노력도 (Reasoning Effort)</div>
                <select id="rs-reasoning" class="rs-select">
                  <option value="" ${State.reasoningEffort === '' ? 'selected' : ''}>없음</option>
                  <option value="low" ${State.reasoningEffort === 'low' ? 'selected' : ''}>낮음 (Low)</option>
                  <option value="medium" ${State.reasoningEffort === 'medium' ? 'selected' : ''}>보통 (Medium)</option>
                  <option value="high" ${State.reasoningEffort === 'high' ? 'selected' : ''}>높음 (High)</option>
                </select>
              </div>
              <div>
                <div class="rs-label">생각 토큰 버퍼 (Thinking Budget)</div>
                <input type="number" id="rs-thinking-budget" class="rs-input" value="${escapeHtml(State.thinkingBudget)}" placeholder="e.g. 1024">
              </div>
            </div>
            <div class="rs-grid-4" style="margin-bottom: 8px;">
              <label class="rs-checkbox"><input type="checkbox" id="rs-cache" ${State.cacheEnabled ? 'checked' : ''}><span>캐시 활성화</span></label>
              <label class="rs-checkbox"><input type="checkbox" id="rs-json" ${State.jsonMode ? 'checked' : ''}><span>JSON 모드</span></label>
              <label class="rs-checkbox"><input type="checkbox" id="rs-logprobs" ${State.logprobs ? 'checked' : ''}><span>로그 확률값 (Logprobs)</span></label>
              <div><div class="rs-label">상위 로그 확률 개수</div><input type="number" id="rs-top-logprobs" class="rs-input" value="${escapeHtml(State.topLogprobs)}" placeholder="e.g. 5"></div>
            </div>
            <div class="rs-grid-2">
              <div><div class="rs-label">정지 시퀀스 (쉼표로 구분)</div><input type="text" id="rs-stop" class="rs-input" value="${escapeHtml(State.stopSequences)}" placeholder="e.g. END,STOP"></div>
              <div><div class="rs-label">사용자 ID (User ID)</div><input type="text" id="rs-user-id" class="rs-input" value="${escapeHtml(State.userId)}" placeholder="user identifier"></div>
            </div>
          </div>

          <!-- Custom Params -->
          <div class="rs-section">
            <div class="rs-label">사용자 정의 파라미터 (JSON)</div>
            <textarea id="rs-custom-params" class="rs-textarea" style="min-height:60px;" placeholder='e.g. {\n  "provider": {\n    "order": ["Google"],\n    "allow_fallbacks": false\n  }\n}'>${escapeHtml(State.customParams)}</textarea>
            <div class="rs-hint">OpenRouter 제공자 라우팅 설정 등을 직접 입력할 수 있습니다.</div>
          </div>

          <!-- FAB Settings -->
          <div class="rs-section">
            <div class="rs-label">빠른 재요약 플로팅 버튼 (FAB)</div>
            <label class="rs-checkbox" style="margin-bottom: 10px;">
              <input type="checkbox" id="rs-hide-fab" ${State.hideFabButton ? 'checked' : ''}>
              <span>플로팅 버튼 숨기기</span>
            </label>
            <div class="rs-hint" style="padding-left: 26px;">설정 적용을 위해 RisuAI를 다시 시작해 주세요.</div>
          </div>

          <!-- Summarization-specific settings -->
          <div class="rs-section">
            <div class="rs-label">요약 동작 설정</div>
            <div style="margin-bottom: 12px;">
              <div class="rs-label">컨텍스트에 포함할 이전 메시지 개수</div>
              <input type="number" id="rs-prev-msgs" class="rs-input" value="${State.prevMessages}" min="0" max="20" step="1" style="width: 140px;">
              <div class="rs-hint">0 = 현재 메시지만 요약</div>
            </div>
            <label class="rs-checkbox" style="margin-bottom: 6px;">
              <input type="checkbox" id="rs-include-lorebook" ${State.includeLorebook ? 'checked' : ''}>
              <span>세계관 (Lorebook) 활성화 항목 포함</span>
            </label>
            <div class="rs-hint" style="padding-left: 26px;">캐릭터/채널의 세계관 설정을 요약 모델로 전송합니다.</div>
          </div>

          <!-- System Prompts -->
          <div class="rs-section">
            <div class="rs-label">시스템 프롬프트 (요약 모델 전달용)</div>
            <div id="rs-prompt-list">
              ${buildSystemPromptList()}
            </div>
            <div style="display: flex; gap: 8px; margin-top: 10px;">
              <button class="rs-btn" id="rs-prompt-add">+ 프롬프트 추가</button>
              <button class="rs-btn" id="rs-prompt-reset">기본값으로 초기화</button>
            </div>
            <div class="rs-hint">시스템 프롬프트는 요약 모델의 역할을 정의합니다. 활성화된 프롬프트들이 순서대로 전송됩니다.</div>
          </div>

          <!-- Help Modal -->
          <div class="rs-help-modal-overlay" id="rs-help-modal-overlay">
            <div class="rs-help-modal">
              <div class="rs-help-modal-header">
                <span>RPA Summarizer 도움말</span>
                <button class="rs-close" id="rs-help-modal-close">X</button>
              </div>
              <div class="rs-help-modal-body">
                <h3>RPA Summarizer란?</h3>
                <p>RPA Summarizer는 AI의 답변을 <strong>보조 요약 모델</strong>로 자동 요약하여 컨텍스트 토큰을 절약하는 플러그인입니다. 메인 대화 모델과 별개의 저렴한 모델(예: gpt-4o-mini)로 요약을 처리하므로 비용 부담이 적습니다.</p>

                <h3>동작 방식</h3>
                <ul>
                  <li>AI 답변이 완료되면 요약 모델이 해당 답변을 1~3문장으로 요약합니다.</li>
                  <li>원본 메시지는 <code>*-*- ... -*-*</code> 마커로 감싸지고, 요약문이 HTML 주석으로 추가됩니다.</li>
                  <li>다음 메시지 전송 시 마커로 감싼 원본은 자동으로 제거되고 요약문만 남게 됩니다.</li>
                  <li>이렇게 하면 과거 대화의 전체 내용 대신 간결한 요약만 컨텍스트에 포함되어 토큰을 절약합니다.</li>
                </ul>

                <h3>사용 방법</h3>
                <ol>
                  <li><strong>API 설정</strong>: 요약에 사용할 모델의 API 주소와 키를 입력합니다.</li>
                  <li><strong>자동 요약 활성화</strong>: 상단의 체크박스를 켜면 AI 답변마다 자동 요약이 시작됩니다.</li>
                  <li><strong>모델 선택</strong>: 요약에 적합한 모델을 선택합니다. 저렴하고 빠른 모델을 권장합니다.</li>
                  <li><strong>시스템 프롬프트</strong>: 요약 스타일(길이, 언어, 형식 등)을 프롬프트로 세밀하게 지정할 수 있습니다.</li>
                </ol>

                <h3>프리셋</h3>
                <ul>
                  <li>여러 API 설정 조합을 <strong>프리셋</strong>으로 저장하고 드롭다운에서 빠르게 전환할 수 있습니다.</li>
                  <li><strong>Proofreader API 설정 가져오기</strong> 버튼으로 Proofreader 플러그인의 API 설정을 가져올 수 있습니다.</li>
                </ul>

                <h3>빠른 재요약 버튼 (FAB)</h3>
                <p>채팅 화면 우측 하단의 플로팅 버튼을 누르면 가장 최근 AI 메시지를 수동으로 다시 요약할 수 있습니다. 이전에 요약되지 않은 메시지도 처리할 수 있습니다.</p>

                <h3>팁</h3>
                <ul>
                  <li>요약 모델은 <strong>gpt-4o-mini</strong> 같은 저렴한 모델로도 충분합니다.</li>
                  <li>세계관(Lorebook) 포함을 켜면 등장인물이나 설정을 반영한 더 정확한 요약을 얻을 수 있습니다.</li>
                  <li>이전 메시지 개수를 1 이상으로 설정하면 직전 대화 맥락을 포함해 요약 품질을 높일 수 있습니다.</li>
                  <li>시스템 프롬프트를 여러 개 등록하면 순서대로 요약 모델에 전달됩니다.</li>
                </ul>
              </div>
            </div>
          </div>

          <!-- Import Modal -->
          <div class="rs-modal-overlay" id="rs-import-modal">
            <div class="rs-modal">
              <div class="rs-modal-header">
                <span>Proofreader API 설정 가져오기</span>
                <button class="rs-close" id="rs-modal-close">X</button>
              </div>
              <div class="rs-modal-body" id="rs-modal-body">
                <div style="text-align:center;padding:20px;color:#6a737d;">불러오는 중...</div>
              </div>
              <div class="rs-modal-footer">
                <button class="rs-btn" id="rs-modal-cancel">취소</button>
                <button class="rs-btn rs-btn-primary" id="rs-modal-import">선택한 프리셋 가져오기</button>
              </div>
            </div>
          </div>

        </div>

        <div class="rs-footer">
          <div style="display: flex; gap: 8px; justify-content: center; padding-top: 16px;">
            <button class="rs-btn rs-btn-primary" id="rs-save">모든 설정 저장</button>
          </div>
          <div id="rs-status" class="rs-status"></div>
        </div>
      </div>
    `;

    // ───── Event listeners ─────

    document.getElementById('rs-close')?.addEventListener('click', function() { risuai.hideContainer(); });

    // Close settings when clicking on the transparent backdrop
    document.body.addEventListener('click', function(e) {
      if (e.target === document.body) {
        risuai.hideContainer();
      }
    });

    // Help modal
    document.getElementById('rs-help-btn')?.addEventListener('click', function() {
      document.getElementById('rs-help-modal-overlay').classList.add('active');
    });
    document.getElementById('rs-help-modal-close')?.addEventListener('click', function() {
      document.getElementById('rs-help-modal-overlay').classList.remove('active');
    });
    document.getElementById('rs-help-modal-overlay')?.addEventListener('click', function(e) {
      if (e.target === e.currentTarget) {
        e.currentTarget.classList.remove('active');
      }
    });

    document.getElementById('rs-update-dismiss')?.addEventListener('click', async function() {
      await risuai.pluginStorage.removeItem('rpa-summarizer:updateAvailable');
      var banner = document.getElementById('rs-update-banner');
      if (banner) banner.style.display = 'none';
    });

    document.getElementById('rs-update-now')?.addEventListener('click', async function() {
      await performSelfUpdate();
    });

    // Auto toggle
    document.getElementById('rs-enabled')?.addEventListener('change', async function(e) {
      State.enabled = e.target.checked;
      await saveSettings();
      showStatus(State.enabled ? '자동 요약 기능 켜짐' : '자동 요약 기능 꺼짐');
    });

    // Import from Proofreader (modal with preset checkbox list)
    var proofreaderPresets = null;

    document.getElementById('rs-import-proofreader')?.addEventListener('click', async function() {
      showStatus('');
      var raw = await risuai.pluginStorage.getItem('proofreader:presets');
      if (!raw || typeof raw !== 'object' || Object.keys(raw).length === 0) {
        showStatus('Proofreader 프리셋을 찾을 수 없습니다. Proofreader 플러그인이 설치되어 있고 저장된 프리셋이 있는지 확인해 주세요.', true);
        return;
      }
      proofreaderPresets = raw;
      var keys = Object.keys(raw);
      var html = '';
      html += '<label class="rs-checkbox" style="margin-bottom:10px;"><input type="checkbox" id="rs-select-all" checked><span>전체 선택 / 전체 해제</span></label>';
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
      if (cbs.length === 0) { showStatus('선택된 프리셋이 없습니다.', true); return; }

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
          prevMessages: State.prevMessages,
          hideFabButton: false,
          systemPrompts: cloneDeep(State.systemPrompts)
        };
        imported++;
      });

      document.getElementById('rs-import-modal').classList.remove('active');
      await savePresets();
      await renderSettingsUI();
      showStatus('Proofreader에서 ' + imported + '개의 프리셋을 성공적으로 가져왔습니다.');
    });

    // Preset controls
    document.getElementById('rs-preset-select')?.addEventListener('change', async function(e) {
      var presetId = e.target.value;
      if (await loadPreset(presetId)) {
        await renderSettingsUI();
        showStatus('프리셋 "' + Presets[presetId].name + '"이(가) 적용되었습니다.');
      }
    });

    document.getElementById('rs-preset-save')?.addEventListener('click', async function() {
      var presetId = State.currentPresetId;
      if (presetId === 'default') {
        await updatePreset(presetId);
        showStatus('기본 프리셋이 업데이트되었습니다.');
      } else if (Presets[presetId]) {
        await updatePreset(presetId);
        showStatus('프리셋 "' + Presets[presetId].name + '"이(가) 업데이트되었습니다.');
      } else {
        var name = prompt('새 프리셋 이름 입력:', '새 프리셋');
        if (name) {
          var newId = await saveAsPreset(name);
          State.currentPresetId = newId;
          await saveSettings();
          await renderSettingsUI();
          showStatus('프리셋 "' + name + '"이(가) 생성되었습니다.');
        }
      }
    });

    document.getElementById('rs-preset-new')?.addEventListener('click', async function() {
      var name = prompt('새 프리셋 이름 입력:', '새 프리셋');
      if (name) {
        var newId = await saveAsPreset(name);
        State.currentPresetId = newId;
        await saveSettings();
        await renderSettingsUI();
        showStatus('프리셋 "' + name + '"이(가) 생성되었습니다.');
      }
    });

    document.getElementById('rs-preset-delete')?.addEventListener('click', async function() {
      var presetId = State.currentPresetId;
      if (presetId === 'default') { showStatus('기본 프리셋은 삭제할 수 없습니다.', true); return; }
      if (Presets[presetId]) {
        await deletePreset(presetId);
        State.currentPresetId = 'default';
        await loadPreset('default');
        await renderSettingsUI();
        showStatus('프리셋이 삭제되었습니다.');
      }
    });

    document.getElementById('rs-preset-rename')?.addEventListener('click', async function() {
      var presetId = State.currentPresetId;
      if (!Presets[presetId]) return;
      var newName = prompt('프리셋 이름 변경:', Presets[presetId].name);
      if (newName && newName.trim()) {
        Presets[presetId].name = newName.trim();
        await savePresets();
        await renderSettingsUI();
        showStatus('프리셋 이름이 "' + newName.trim() + '"(으)로 변경되었습니다.');
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
      ['rs-prev-msgs', 'prevMessages', 'int']
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

    // System prompt controls
    document.getElementById('rs-prompt-add')?.addEventListener('click', async function() {
      State.systemPrompts.push({ enabled: true, text: '' });
      await saveSettings();
      await renderSettingsUI();
      showStatus('시스템 프롬프트가 추가되었습니다.');
    });

    document.getElementById('rs-prompt-reset')?.addEventListener('click', async function() {
      State.systemPrompts = [{ enabled: true, text: DEFAULT_SYSTEM_PROMPT }];
      await saveSettings();
      await renderSettingsUI();
      showStatus('시스템 프롬프트가 기본값으로 초기화되었습니다.');
    });

    document.querySelectorAll('.rs-prompt-delete').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var idx = parseInt(btn.dataset.idx);
        State.systemPrompts.splice(idx, 1);
        await saveSettings();
        await renderSettingsUI();
        showStatus('시스템 프롬프트가 삭제되었습니다.');
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
      showStatus('모든 설정이 저장되었습니다.');
    });
  }

  // ───── Auto-Update Check ─────

  var updateCheckCooldown = 3600000;

  async function checkForUpdate() {
    if (!UPDATE_URL) return;
    try {
      var lastCheck = await risuai.pluginStorage.getItem('rpa-summarizer:lastUpdateCheck');
      if (lastCheck && APP_VERSION !== '1.2.0' && APP_VERSION !== '1.2.2') {
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
        console.log('[RPA Summarizer] ========================================');
        console.log('[RPA Summarizer] UPDATE AVAILABLE: v' + APP_VERSION + ' -> v' + remoteVersion);
        console.log('[RPA Summarizer] ========================================');
        await risuai.pluginStorage.setItem('rpa-summarizer:updateAvailable', JSON.stringify({
          version: remoteVersion,
          current: APP_VERSION,
          checkedAt: Date.now()
        }));
        showUpdateToast(APP_VERSION, remoteVersion);
      } else {
        await risuai.pluginStorage.removeItem('rpa-summarizer:updateAvailable');
      }

      await risuai.pluginStorage.setItem('rpa-summarizer:lastUpdateCheck', String(Date.now()));
    } catch (e) {
      console.log('[RPA Summarizer] Update check failed:', e.message || e);
    }
  }

  async function getUpdateInfo() {
    try {
      var raw = await risuai.pluginStorage.getItem('rpa-summarizer:updateAvailable');
      if (!raw) return null;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) { return null; }
  }

  function parseHeaders(jsCode) {
    var lines = jsCode.split('\n');
    var name = '';
    var displayName = '';
    var version = '';
    var updateURL = '';
    var description = '';
    var apiVersion = '2.1';
    var args = {};
    var realArg = {};
    var argMeta = {};

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf('//@name') === 0) {
        name = line.slice(7).trim();
      } else if (line.indexOf('//@display-name') === 0) {
        displayName = line.slice(15).trim();
      } else if (line.indexOf('//@version') === 0) {
        version = line.slice(10).trim();
      } else if (line.indexOf('//@update-url') === 0) {
        updateURL = line.slice(13).trim();
      } else if (line.indexOf('//@description') === 0) {
        description = line.slice(14).trim();
      } else if (line.indexOf('//@api') === 0) {
        apiVersion = line.slice(6).trim();
      } else if (line.indexOf('//@arg') === 0 || line.indexOf('//@risu-arg') === 0) {
        var parts = line.split(/\s+/);
        if (parts.length >= 3) {
          var argName = parts[1];
          var argType = parts[2];
          args[argName] = argType;
          if (argType === 'int') {
            realArg[argName] = 0;
          } else {
            realArg[argName] = '';
          }
          if (parts.length > 3) {
            var meta = {};
            var metaStr = parts.slice(3).join(' ').replace(
              /{{(.+?)(::?(.+?))?}}/g,
              function(a, g1, g2, g3) {
                meta[g1] = g3 || '1';
                return '';
              }
            ).trim();
            if (metaStr) {
              meta['description'] = metaStr;
            }
            argMeta[argName] = meta;
          }
        }
      }
    }
    return {
      name: name,
      displayName: displayName,
      versionOfPlugin: version,
      updateURL: updateURL,
      version: apiVersion === '3.0' ? '3.0' : (apiVersion === '2.0' ? 2 : '2.1'),
      arguments: args,
      realArg: realArg,
      argMeta: argMeta
    };
  }

  async function performSelfUpdate() {
    try {
      showStatus('업데이트 다운로드 중...');
      var resp = await risuai.nativeFetch(UPDATE_URL, { method: 'GET' });
      if (!resp.ok) {
        showStatus('업데이트 파일을 다운로드하는 데 실패했습니다.', true);
        return;
      }
      var jsCode = await resp.text();
      var meta = parseHeaders(jsCode);
      if (!meta.name || meta.name !== 'rpa-summarizer') {
        showStatus('업데이트 파일의 내용이 유효하지 않습니다.', true);
        return;
      }

      var db = await risuai.getDatabase();
      if (!db || !db.plugins) {
        showStatus('RPA Summarizer 플러그인 데이터베이스를 가져오지 못했습니다.', true);
        return;
      }

      var index = -1;
      for (var i = 0; i < db.plugins.length; i++) {
        if (db.plugins[i].name === 'rpa-summarizer') {
          index = i;
          break;
        }
      }

      if (index === -1) {
        showStatus('데이터베이스에서 플러그인을 찾지 못했습니다.', true);
        return;
      }

      var oldPlugin = db.plugins[index];
      var newRealArg = Object.assign({}, meta.realArg, oldPlugin.realArg);

      var updatedPlugin = {
        name: meta.name,
        script: jsCode,
        realArg: newRealArg,
        arguments: meta.arguments,
        displayName: meta.displayName || oldPlugin.displayName,
        version: meta.version,
        customLink: oldPlugin.customLink || [],
        argMeta: meta.argMeta,
        versionOfPlugin: meta.versionOfPlugin,
        updateURL: meta.updateURL,
        allowedIPC: oldPlugin.allowedIPC || [],
        enabled: true
      };

      db.plugins[index] = updatedPlugin;
      await risuai.setDatabaseLite(db);
      await risuai.pluginStorage.removeItem('rpa-summarizer:updateAvailable');

      showStatus('업데이트가 완료되었습니다! 플러그인을 재로드합니다...');
      setTimeout(async function() {
        if (typeof risuai.loadPlugins === 'function') {
          await risuai.loadPlugins();
        }
        await renderSettingsUI();
        showStatus('성공적으로 v' + meta.versionOfPlugin + ' 버전으로 업데이트되었습니다.');
      }, 1000);

    } catch (e) {
      console.error('[RPA Summarizer] Self-update failed:', e);
      showStatus('Update failed: ' + (e.message || e), true);
    }
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
        '<div style="font-size:13px;font-weight:600;color:' + accent + '">RPA Summarizer Update Available</div>' +
        '<div style="font-size:11px;color:' + subtext + ';margin-top:2px">' +
        'v' + escapeHtml(currentVersion) + '  <span style="color:' + versionColor + '">v' + escapeHtml(newVersion) + '</span>' +
        '</div>' +
        '<div style="font-size:10px;color:' + subtext + ';margin-top:4px">설정 페이지를 열어 업데이트할 수 있습니다. 이 알림은 12초 후에 사라집니다.</div>' +
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
      console.log('[RPA Summarizer] Toast failed:', e.message || e);
    }
  }

  // ───── Init ─────

  try {
    await loadPresets();
    await loadSettings();

    // Inject CSS style to hide custom tag tags and avoid visual breakdown
    try {
      var rootDoc = await risuai.getRootDocument();
      if (rootDoc && !rootDoc.getElementById('rpa-summarizer-global-style')) {
        var style = rootDoc.createElement('style');
        style.id = 'rpa-summarizer-global-style';
        style.textContent = 'rpa-orig { display: contents; }';
        rootDoc.head.appendChild(style);
      }
    } catch (e) {
      console.log('[RPA Summarizer] Failed to inject custom style:', e);
    }

    await risuai.addRisuReplacer('afterRequest', afterRequestHandler);

    await risuai.registerButton({
      name: 'RPA Summarizer',
      icon: SVG_ICON,
      iconType: 'html',
      location: 'chat'
    }, openSettings);

    await risuai.registerSetting('RPA Summarizer', openSettings, SVG_ICON, 'html');

    if (!State.hideFabButton) {
      await risuai.registerButton({
        name: 'RPA Summarizer-ReSummarize',
        icon: SVG_ICON,
        iconType: 'html',
        location: 'action'
      }, onFabClick);
    }

    await risuai.onUnload(function() {
      console.log('[RPA Summarizer] Unloaded');
    });

    // Request mainDom permission for update toasts (user will be prompted once)
    try { await risuai.requestPluginPermission('mainDom', 'periodically'); } catch (e) {}

    // Auto-update check (delayed, with cooldown)
    setTimeout(function() { checkForUpdate(); }, 5000);

    console.log('[RPA Summarizer] v' + APP_VERSION + ' initialized');
    console.log('[RPA Summarizer] Auto summarization: ' + (State.enabled ? 'ON' : 'OFF'));
    console.log('[RPA Summarizer] Preset: ' + State.currentPresetId + ', Prev msgs: ' + State.prevMessages + ', Lorebook: ' + (State.includeLorebook ? 'ON' : 'OFF'));

  } catch (error) {
    console.log('[RPA Summarizer] Init failed:', error);
  }
})();
