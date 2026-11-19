// LLM 提供方抽象：OpenAI 兼容 API + 离线 Mock（多文件/调试/上下文聊天）
const FAMILIES = require('./families');
let ai; // lazy to avoid circular require with lifecycle
const getAi = () => { if (!ai) ai = require('./ai'); return ai; };

class OpenAICompatProvider {
  constructor({ baseUrl, apiKey, model, temperature }) {
    Object.assign(this, {
      baseUrl: baseUrl.replace(/\/$/, ''),
      apiKey,
      model,
      temperature: temperature == null ? 0.2 : Number(temperature)
    });
    this.name = 'openai-compatible';
  }
  async chat(messages) {
    const r = await fetch(this.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.apiKey },
      body: JSON.stringify({ model: this.model, messages, temperature: this.temperature })
    });
    if (!r.ok) throw new Error('LLM HTTP ' + r.status + ': ' + (await r.text()).slice(0, 300));
    return (await r.json()).choices[0].message.content;
  }
}

// 离线 Mock：基于规则 + 模板，保证无密钥也能跑通全流程与测试
class MockProvider {
  constructor() { this.name = 'mock'; }
  async chat(messages, meta = {}) {
    const sys = messages[0]?.content || '';
    const last = messages[messages.length - 1].content;
    if (sys.includes('[TASK:ADAPTER]')) return '```json\n' + JSON.stringify(mockAdapter(last), null, 2) + '\n```';
    if (sys.includes('[TASK:DEBUG]')) {
      const { reply } = getAi().mockDebugStructured(last);
      return reply;
    }
    if (sys.includes('[TASK:DEV]')) {
      // meta 由 lifecycle 传入；若无 meta，尽量从 prompt 解析
      if (meta && meta.adapter) {
        const r = getAi().mockMultiFileDev(meta);
        return r.reply;
      }
      return legacyMockDev(last);
    }
    if (sys.includes('[TASK:CHAT]') || meta.chatContext) {
      const ctx = meta.chatContext || {};
      return getAi().mockChatContextual({ message: last, ...ctx }).reply;
    }
    // 无特殊任务：若有 chatContext 走上下文，否则通用
    if (meta.chatContext) return getAi().mockChatContextual({ message: last, ...meta.chatContext }).reply;
    return `【Mock AI】已收到：「${last.slice(0, 200)}」。当前为离线 Mock 提供方；在设置中配置 OpenAI 兼容 API (PLUGIN_IDE_LLM_BASE_URL / _API_KEY / _MODEL) 即可启用真实模型。亦可使用 DeepSeek、本地 Ollama（见 README）。`;
  }
}

function mockAdapter(desc) {
  const m = desc.match(/[「"“']([^」"”']{2,40})[」"”']/) || desc.match(/([A-Z][A-Za-z0-9.+]*(?: [A-Z0-9][A-Za-z0-9.+]*)*)/) || desc.match(/(?:为|给|支持|叫|名为)\s*([\u4e00-\u9fa5A-Za-z0-9]{2,20}?)(?:开发|写|的|插件|，|。|$)/);
  const name = (m ? m[1] : 'Custom Host').trim();
  const lower = desc.toLowerCase();
  let family = 'generic';
  if (/python|py\b|blender|maya/.test(lower)) family = 'python-dcc';
  else if (/mcp|agent|智能体|llm/.test(lower)) family = 'ai-agent';
  else if (/browser|浏览器|webextension/.test(lower)) family = 'browser-ext';
  else if (/php/.test(lower)) family = 'cms-plugin';
  else if (/webhook|oauth|saas|bot|机器人/.test(lower)) family = 'saas-app';
  const f = FAMILIES[family];
  const cat = (desc.match(/类别[:：]\s*([^\s,，。]+)/) || [])[1] || '自定义/AI 扩展';
  return { id: require('./registry').slug(name), name, company: (desc.match(/(?:公司|厂商|company)[:：]\s*([^\s,，。]+)/i) || [])[1] || name, category: cat, family, docs: (desc.match(/https?:\/\/\S+/) || [''])[0], overrides: { manifest: f.manifest, language: f.language, packageFormat: f.packageFormat, publishTarget: f.publishTarget }, description: desc };
}

function legacyMockDev(req) {
  const m = req.match(/当前文件\s*([^\n]+)\n([\s\S]*?)\n需求[:：]\s*([\s\S]*)$/);
  if (!m) return '【Mock AI】请提供文件与需求。';
  const [, file, code, ask] = m;
  const content = getAi().refineSingleFile(file, code, ask);
  return `【Mock AI】已根据需求在 ${file} 末尾追加实现骨架：\n### FILE: ${file}\n\`\`\`\n${content.replace(/\n$/, '')}\n\`\`\`\n`;
}

function getProvider(settings = {}) {
  const baseUrl = settings.baseUrl || process.env.PLUGIN_IDE_LLM_BASE_URL;
  const apiKey = settings.apiKey || process.env.PLUGIN_IDE_LLM_API_KEY;
  const model = settings.model || process.env.PLUGIN_IDE_LLM_MODEL || 'gpt-4o-mini';
  const temperature = settings.temperature != null ? settings.temperature
    : (process.env.PLUGIN_IDE_LLM_TEMPERATURE != null ? Number(process.env.PLUGIN_IDE_LLM_TEMPERATURE) : 0.2);
  const providerName = settings.provider || process.env.PLUGIN_IDE_LLM_PROVIDER;
  if (providerName !== 'mock' && baseUrl && apiKey) {
    return new OpenAICompatProvider({ baseUrl, apiKey, model, temperature });
  }
  return new MockProvider();
}

const extractCode = (t) => { const m = t && t.match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/); return m ? m[1] : null; };

module.exports = { getProvider, MockProvider, OpenAICompatProvider, extractCode };
