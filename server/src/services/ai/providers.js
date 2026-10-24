import { env } from '../../config/env.js';

/**
 * Two hosted LLM providers behind one interface. Gemini is tried first; on a
 * quota/rate limit, server error, timeout or missing model, the same request
 * goes to Groq. Keys stay on the server (brief, Section 4 guardrails).
 *
 * Conversation format used by the rest of the code:
 *   { role: 'user', content }
 *   { role: 'assistant', content, toolCalls: [{ id, name, args }], raw }
 *   { role: 'tool', toolCallId, name, content }
 */

// Ordered by speed and quality (measured Oct 2026): 3.5 Flash ~1.5 s, Flash-Lite ~0.7 s.
const GEMINI_MODELS = () => unique([env.GEMINI_MODEL, 'gemini-3.5-flash', 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite']);
const GEMINI_CALL_TIMEOUT_MS = 7000;
const GROQ_MODELS = () => unique([env.GROQ_MODEL, 'openai/gpt-oss-120b', 'openai/gpt-oss-20b']);

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

export class ProviderError extends Error {
  constructor(message, { status, retryable = true, code } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
    this.code = code;
  }
}

async function postJson(url, body, headers, signal) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') throw new ProviderError('Timed out', { code: 'TIMEOUT' });
    throw new ProviderError(`Network error: ${err.message}`, { code: 'NETWORK' });
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const message = json?.error?.message || text.slice(0, 200) || `HTTP ${res.status}`;
    throw new ProviderError(message, { status: res.status, code: res.status === 404 ? 'MODEL_NOT_FOUND' : res.status === 429 ? 'RATE_LIMITED' : res.status === 503 ? 'OVERLOADED' : 'HTTP_ERROR' });
  }
  return json;
}

// ---------- Gemini (generateContent with function calling) ----------

function toGeminiContents(messages) {
  const contents = [];
  for (const m of messages) {
    if (m.role === 'user') contents.push({ role: 'user', parts: [{ text: m.content }] });
    else if (m.role === 'assistant') {
      // Re-send Gemini's own content unchanged when we have it (keeps thought signatures).
      if (m.raw?.provider === 'gemini') contents.push(m.raw.content);
      else {
        const parts = [];
        if (m.content) parts.push({ text: m.content });
        for (const c of m.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: c.args } });
        contents.push({ role: 'model', parts });
      }
    } else if (m.role === 'tool') {
      // Gemini 3 matches responses to calls by id when the model supplied one.
      const id = m.toolCallId && !m.toolCallId.startsWith('gemini_call_') ? { id: m.toolCallId } : {};
      const part = { functionResponse: { ...id, name: m.name, response: { result: safeParse(m.content) } } };
      const last = contents[contents.length - 1];
      if (last?.role === 'user' && last.parts.every((p) => p.functionResponse)) last.parts.push(part);
      else contents.push({ role: 'user', parts: [part] });
    }
  }
  return contents;
}

async function callGemini({ system, messages, tools, json, signal }) {
  if (!env.GEMINI_API_KEY) throw new ProviderError('Gemini is not configured', { code: 'NOT_CONFIGURED' });
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: toGeminiContents(messages),
    ...(tools?.length ? { tools: [{ functionDeclarations: tools }] } : {}),
  };
  let lastError;
  for (const model of GEMINI_MODELS()) {
    if (signal?.aborted) break;
    // Gemini 3 family: low thinking keeps answers fast enough for the 15 s budget.
    const thinking = /^gemini-(3|flash|pro)/.test(model) ? { thinkingConfig: { thinkingLevel: 'low' } } : {};
    body.generationConfig = { temperature: 0.2, ...thinking, ...(json ? { responseMimeType: 'application/json' } : {}) };
    try {
      const data = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        body,
        { 'x-goog-api-key': env.GEMINI_API_KEY },
        // Each Gemini call gets its own cap so a slow model leaves time for the next one.
        AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(GEMINI_CALL_TIMEOUT_MS)]),
      );
      const content = data?.candidates?.[0]?.content;
      if (!content) {
        const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || 'empty response';
        throw new ProviderError(`Gemini returned no content (${reason})`, { code: 'EMPTY' });
      }
      const parts = content.parts ?? [];
      const toolCalls = parts
        .filter((p) => p.functionCall)
        .map((p, i) => ({ id: p.functionCall.id ?? `gemini_call_${i}`, name: p.functionCall.name, args: p.functionCall.args ?? {} }));
      const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
      return { provider: 'gemini', model, text, toolCalls, raw: { provider: 'gemini', content } };
    } catch (err) {
      lastError = err;
      // Free-tier limits and overload are per model, so try the next Gemini model first.
      if (!['MODEL_NOT_FOUND', 'RATE_LIMITED', 'OVERLOADED', 'TIMEOUT'].includes(err.code) || signal?.aborted) throw err;
    }
  }
  throw lastError;
}

// ---------- Groq (OpenAI-compatible chat completions) ----------

function toOpenAiMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })) }
          : {}),
      });
    } else if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
  }
  return out;
}

async function callGroq({ system, messages, tools, json, signal }) {
  if (!env.GROQ_API_KEY) throw new ProviderError('Groq is not configured', { code: 'NOT_CONFIGURED' });
  let lastError;
  for (const model of GROQ_MODELS()) {
    try {
      const data = await postJson(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model,
          temperature: 0.2,
          messages: toOpenAiMessages(system, messages),
          ...(tools?.length ? { tools: tools.map((t) => ({ type: 'function', function: { ...t, parameters: allowNullOptionals(t.parameters) } })), tool_choice: 'auto' } : {}),
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        },
        { Authorization: `Bearer ${env.GROQ_API_KEY}` },
        signal,
      );
      const msg = data?.choices?.[0]?.message;
      if (!msg) throw new ProviderError('Groq returned no message', { code: 'EMPTY' });
      const toolCalls = (msg.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, args: safeParse(c.function.arguments) ?? {} }));
      return { provider: 'groq', model, text: (msg.content ?? '').trim(), toolCalls, raw: { provider: 'groq' } };
    } catch (err) {
      lastError = err;
      if (err.code !== 'MODEL_NOT_FOUND') throw err;
    }
  }
  throw lastError;
}

/** Lets optional properties be null (Groq rejects null for a plain string type). */
function allowNullOptionals(schema) {
  if (!schema?.properties) return schema;
  const required = new Set(schema.required ?? []);
  const properties = Object.fromEntries(
    Object.entries(schema.properties).map(([k, v]) => [k, required.has(k) ? v : { ...v, type: [v.type, 'null'] }]),
  );
  return { ...schema, properties };
}

function safeParse(s) {
  if (typeof s !== 'string') return s;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// ---------- Public API ----------

const PROVIDERS = { gemini: callGemini, groq: callGroq };
let override = null;

/** Test-only: replace the providers with a fake ({ gemini?, groq? }). */
export function setProviderOverride(fake) {
  if (env.isProd) throw new Error('Provider override is not allowed in production');
  override = fake;
}

export function configuredProviders() {
  if (override) return Object.keys(override).filter((k) => k !== 'vision');
  return ['gemini', 'groq'].filter((p) => (p === 'gemini' ? env.GEMINI_API_KEY : env.GROQ_API_KEY));
}

/** One model call on a specific provider. */
export function callProvider(name, args) {
  const fn = override?.[name] ?? PROVIDERS[name];
  if (!fn) throw new ProviderError(`Unknown provider ${name}`, { code: 'NOT_CONFIGURED', retryable: false });
  return fn(args);
}

// ---------- Vision (face verification) ----------

// Groq models that accept images; the list is checked in order.
const GROQ_VISION_MODELS = () => unique([env.GROQ_VISION_MODEL, 'meta-llama/llama-4-scout-17b-16e-instruct', 'qwen/qwen3.8-27b']);
const VISION_CALL_TIMEOUT_MS = 12000;

async function visionGemini({ prompt, images, signal }) {
  if (!env.GEMINI_API_KEY) throw new ProviderError('Gemini is not configured', { code: 'NOT_CONFIGURED' });
  const parts = [{ text: prompt }];
  images.forEach((img, i) => parts.push({ text: `Image ${i + 1} (${img.label}):` }, { inlineData: { mimeType: img.mimeType, data: img.base64 } }));
  let lastError;
  for (const model of GEMINI_MODELS()) {
    if (signal?.aborted) break;
    const thinking = /^gemini-(3|flash|pro)/.test(model) ? { thinkingConfig: { thinkingLevel: 'low' } } : {};
    try {
      const data = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0, responseMimeType: 'application/json', ...thinking } },
        { 'x-goog-api-key': env.GEMINI_API_KEY },
        AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(VISION_CALL_TIMEOUT_MS)]),
      );
      const text = (data?.candidates?.[0]?.content?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
      if (!text) throw new ProviderError('Gemini returned no content', { code: 'EMPTY' });
      return { provider: 'gemini', model, text };
    } catch (err) {
      lastError = err;
      if (!['MODEL_NOT_FOUND', 'RATE_LIMITED', 'OVERLOADED', 'TIMEOUT', 'EMPTY'].includes(err.code) || signal?.aborted) throw err;
    }
  }
  throw lastError;
}

async function visionGroq({ prompt, images, signal }) {
  if (!env.GROQ_API_KEY) throw new ProviderError('Groq is not configured', { code: 'NOT_CONFIGURED' });
  const content = [{ type: 'text', text: prompt }];
  images.forEach((img, i) => content.push({ type: 'text', text: `Image ${i + 1} (${img.label}):` }, { type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` } }));
  let lastError;
  for (const model of GROQ_VISION_MODELS()) {
    if (signal?.aborted) break;
    try {
      const data = await postJson(
        'https://api.groq.com/openai/v1/chat/completions',
        { model, temperature: 0, messages: [{ role: 'user', content }] },
        { Authorization: `Bearer ${env.GROQ_API_KEY}` },
        AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(VISION_CALL_TIMEOUT_MS)]),
      );
      const text = (data?.choices?.[0]?.message?.content ?? '').trim();
      if (!text) throw new ProviderError('Groq returned no content', { code: 'EMPTY' });
      return { provider: 'groq', model, text };
    } catch (err) {
      lastError = err;
      // A model that is gone or does not take images: try the next one.
      if (!['MODEL_NOT_FOUND', 'HTTP_ERROR', 'RATE_LIMITED', 'EMPTY'].includes(err.code) || signal?.aborted) throw err;
    }
  }
  throw lastError;
}

const VISION = { gemini: visionGemini, groq: visionGroq };

/** One image-understanding call on a specific provider ({ prompt, images: [{ label, mimeType, base64 }] }). */
export function callVision(name, args) {
  const fn = override?.vision?.[name] ?? VISION[name];
  if (!fn) throw new ProviderError(`Unknown provider ${name}`, { code: 'NOT_CONFIGURED', retryable: false });
  return fn(args);
}

export function configuredVisionProviders() {
  if (override?.vision) return Object.keys(override.vision);
  return configuredProviders();
}
