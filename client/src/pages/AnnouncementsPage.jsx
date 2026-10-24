import { useState } from 'react';
import { Megaphone, Pin, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '../lib/api.js';
import { useApi } from '../lib/useApi.js';
import { formatDateTime } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../components/toast.jsx';
import Modal, { ConfirmDialog } from '../components/Modal.jsx';
import { Badge, PageHeader } from '../components/data.jsx';
import { Alert, Button, Card, EmptyState, Input, Spinner, Textarea } from '../components/ui.jsx';
import { ROLE_LABELS } from '../config/navigation.js';

/** Announcements (brief #23): Admin and HR post, everyone reads. */
export default function AnnouncementsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const canPost = user.role === 'admin' || user.role === 'hr';
  const { data, loading, error, reload } = useApi('/announcements', { params: { limit: 50 } });
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', pinned: false });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    if (form.title.trim().length < 3) er.title = 'Title is required';
    if (form.body.trim().length < 3) er.body = 'Write the announcement';
    setErrors(er);
    if (Object.keys(er).length) return;
    setSaving(true);
    try {
      await api.post('/announcements', { title: form.title.trim(), body: form.body.trim(), pinned: form.pinned });
      toast.success('Announcement posted. Everyone has been notified.');
      setComposing(false);
      setForm({ title: '', body: '', pinned: false });
      reload();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/announcements/${deleting.id}`);
      toast.success('Announcement removed.');
      setDeleting(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Announcements"
        description="Company news shown on every dashboard."
        actions={
          canPost && (
            <Button onClick={() => setComposing(true)}>
              <Plus className="size-4" /> New announcement
            </Button>
          )
        }
      />
      {error && <Alert type="error">{error}</Alert>}
      {loading && !data && (
        <div className="flex items-center gap-2 py-10 text-sm text-slate-500">
          <Spinner /> Loading...
        </div>
      )}
      {data && data.length === 0 && (
        <Card>
          <EmptyState icon={Megaphone} title="No announcements yet" action={canPost && <Button onClick={() => setComposing(true)}>Post the first one</Button>}>
            {canPost ? 'Share news, policy updates or holiday notices with everyone.' : 'News from HR and management will appear here.'}
          </EmptyState>
        </Card>
      )}
      <div className="space-y-3">
        {(data ?? []).map((a) => (
          <Card key={a.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {a.pinned && (
                    <Badge color="brand">
                      <Pin className="mr-1 size-3" /> Pinned
                    </Badge>
                  )}
                  <h2 className="text-base font-semibold text-slate-900">{a.title}</h2>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {a.authorName} ({ROLE_LABELS[a.authorRole] ?? a.authorRole}) · {formatDateTime(a.createdAt)}
                </p>
              </div>
              {(user.role === 'admin' || a.createdBy === user.id) && (
                <Button variant="ghost" className="px-2 py-1.5 text-red-600 hover:bg-red-50" onClick={() => setDeleting(a)} aria-label={`Remove ${a.title}`}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{a.body}</p>
          </Card>
        ))}
      </div>

      {composing && (
        <Modal
          open
          onClose={() => setComposing(false)}
          title="New announcement"
          description="Everyone gets an in-app notification."
          footer={
            <>
              <Button variant="secondary" onClick={() => setComposing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" form="announcement-form" loading={saving}>
                Post
              </Button>
            </>
          }
        >
          <form id="announcement-form" onSubmit={submit} className="space-y-4" noValidate>
            <Input label="Title" value={form.title} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} error={errors.title} />
            <Textarea label="Message" rows={6} maxLength={3000} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} error={errors.body} />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.pinned} onChange={(e) => setForm((f) => ({ ...f, pinned: e.target.checked }))} className="size-4 rounded border-slate-300 accent-brand-700" />
              Pin to the top
            </label>
          </form>
        </Modal>
      )}
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={remove} loading={busy} danger title="Remove this announcement?" confirmLabel="Remove">
        {deleting && <>“{deleting.title}” will be removed for everyone.</>}
      </ConfirmDialog>
    </div>
  );
}
