import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Loader2, MessageCircle, Send, Trash2, X } from 'lucide-react';
import { api, errorMessage } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';

const SUGGESTIONS = {
  admin: ['How many active employees do we have?', 'What is this month\'s attendance rate?', 'Show the payroll summary for the latest month', 'Who is on leave today?'],
  hr: ['Who came late most often this month?', 'Who is on leave today?', 'What is this month\'s attendance rate?', 'How many active employees are in each department?'],
  employee: ['How many sick leaves do I have left this year?', 'What was my attendance this month?', 'When am I counted as late?', 'Show my latest payslip'],
};

const STORAGE_KEY = 'hcm_chat';

function loadHistory(userId) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    return saved?.userId === userId ? saved.messages : [];
  } catch {
    return [];
  }
}

/**
 * AI assistant chat panel (brief, Section 4). The browser only talks to our
 * API (POST /ai/chat); the server calls the AI provider with this user's access.
 */
export default function AiChatPanel() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(() => loadHistory(user.id));
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ userId: user.id, messages: messages.slice(-30) }));
    } catch {
      /* storage unavailable */
    }
  }, [messages, user.id]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const send = useCallback(
    async (text) => {
      const question = text.trim();
      if (!question || sending) return;
      const history = messages.filter((m) => !m.error).slice(-10).map(({ role, content }) => ({ role, content }));
      setMessages((m) => [...m, { role: 'user', content: question }]);
      setInput('');
      setSending(true);
      try {
        const { data } = await api.post('/ai/chat', { message: question, history }, { timeout: 30000 });
        setMessages((m) => [...m, { role: 'assistant', content: data.answer, label: data.label, tools: data.toolsUsed }]);
      } catch (err) {
        setMessages((m) => [...m, { role: 'assistant', content: errorMessage(err, 'The assistant could not answer right now.'), error: true }]);
      } finally {
        setSending(false);
      }
    },
    [messages, sending],
  );

  // Other parts of the app can open the panel with a question: window.dispatchEvent(new CustomEvent('assistant:open', { detail: { question } }))
  useEffect(() => {
    const onOpen = (e) => {
      setOpen(true);
      if (e.detail?.question) setInput(e.detail.question);
    };
    window.addEventListener('assistant:open', onOpen);
    return () => window.removeEventListener('assistant:open', onOpen);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-brand-700 px-4 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          aria-label="Open AI assistant"
        >
          <MessageCircle className="size-5" />
          <span className="hidden sm:inline">Ask AI</span>
        </button>
      )}

      {open && (
        <section
          className="fixed inset-0 z-50 flex flex-col bg-white shadow-2xl sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[600px] sm:max-h-[calc(100vh-2.5rem)] sm:w-[400px] sm:rounded-2xl sm:border sm:border-slate-200"
          aria-label="AI assistant"
        >
          <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-brand-50 text-brand-700">
              <Bot className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">HR assistant</p>
              <p className="truncate text-xs text-slate-500">Answers from {user.role === 'employee' ? 'your own records' : user.role === 'hr' ? 'HR data' : 'all company data'} and company rules</p>
            </div>
            {messages.length > 0 && (
              <button onClick={() => setMessages([])} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Clear conversation" title="Clear conversation">
                <Trash2 className="size-4" />
              </button>
            )}
            <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close assistant">
              <X className="size-5" />
            </button>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">Hi {user.name.split(' ')[0]}! Ask me about attendance, leave, payroll or company rules. You can also write in Roman Urdu.</p>
                <div className="flex flex-col gap-2">
                  {(SUGGESTIONS[user.role] ?? []).map((s) => (
                    <button key={s} onClick={() => send(s)} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 transition hover:border-brand-200 hover:bg-brand-50/50">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand-700 px-3.5 py-2 text-sm text-white">{m.content}</p>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  <div className={`max-w-[90%] rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm ${m.error ? 'bg-red-50 text-red-800' : 'bg-slate-100 text-slate-800'}`}>
                    <FormattedAnswer text={m.content} />
                    {m.label && <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-brand-700">{m.label}</p>}
                  </div>
                </div>
              ),
            )}
            {sending && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="size-4 animate-spin" /> Checking the records...
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-end gap-2 border-t border-slate-100 p-3"
          >
            <label htmlFor="ai-input" className="sr-only">
              Ask a question
            </label>
            <textarea
              id="ai-input"
              ref={inputRef}
              rows={1}
              value={input}
              maxLength={1000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Ask a question..."
              className="max-h-28 min-h-10 flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Send"
            >
              <Send className="size-4" />
            </button>
          </form>
        </section>
      )}
    </>
  );
}

/** Renders the model's light markdown (bold and bullet lists) safely as text. */
function FormattedAnswer({ text }) {
  const lines = String(text).split('\n');
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const bullet = /^\s*[-*•]\s+/.test(line);
        const content = line.replace(/^\s*[-*•]\s+/, '');
        const parts = content.split(/(\*\*[^*]+\*\*)/g).map((p, j) => (p.startsWith('**') && p.endsWith('**') ? <strong key={j}>{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>));
        if (!line.trim()) return null;
        return bullet ? (
          <p key={i} className="flex gap-1.5">
            <span aria-hidden>•</span>
            <span>{parts}</span>
          </p>
        ) : (
          <p key={i}>{parts}</p>
        );
      })}
    </div>
  );
}
