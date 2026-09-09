import React, { useState } from 'react';
import { FilePlus2 } from 'lucide-react';
import { toast } from 'sonner';
import { SidePanel } from '../ui/SidePanel';

/** Self-service filing (BRM-01/02): lets a logged-in proponent file a new
 * application or renewal for their own business. The server ignores/derives
 * proponent_id from the caller's own linked record — this form never sends one. */
export function FileApplicationPanel({ onFiled }: { onFiled: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applicationType, setApplicationType] = useState('DIRECT_LEASE');
  const [isRenewal, setIsRenewal] = useState(false);
  const [saveAsDraft, setSaveAsDraft] = useState(false);

  function reset() {
    setApplicationType('DIRECT_LEASE');
    setIsRenewal(false);
    setSaveAsDraft(false);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          application_type: applicationType.trim() || 'DIRECT_LEASE',
          is_renewal: isRenewal ? 1 : 0,
          save_as_draft: saveAsDraft,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'Failed to file application');
      toast.success(
        saveAsDraft
          ? `Draft saved as ${json?.data?.application_no}`
          : `Application ${json?.data?.application_no} submitted`
      );
      setOpen(false);
      reset();
      onFiled();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to file application');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold shadow-sm cursor-pointer"
        style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
        onClick={() => setOpen(true)}
      >
        <FilePlus2 size={13} />
        File New Application
      </button>

      <SidePanel
        open={open}
        title="File New Application"
        subtitle="Filed under your business — a reference number is issued automatically."
        onClose={() => (saving ? null : setOpen(false))}
        onSave={save}
        saving={saving}
        saveLabel={saveAsDraft ? 'Save Draft' : 'Submit Application'}
        widthClassName="max-w-[28rem]"
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-secondary uppercase tracking-widest">Application type</div>
            <input
              className="w-full rounded-md px-3 py-2 text-sm border focus:outline-none focus:border-[var(--nav-active-bg)]"
              style={{ borderColor: 'var(--input-border)', color: 'var(--text)', backgroundColor: 'var(--input-bg)' }}
              value={applicationType}
              onChange={(e) => setApplicationType(e.target.value)}
              placeholder="DIRECT_LEASE"
            />
          </div>

          <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer" style={{ borderColor: 'var(--input-border)' }}>
            <input type="checkbox" className="cursor-pointer" checked={isRenewal} onChange={(e) => setIsRenewal(e.target.checked)} />
            <span style={{ color: 'var(--text)' }}>This is a renewal of an existing lease</span>
          </label>

          <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer" style={{ borderColor: 'var(--input-border)' }}>
            <input type="checkbox" className="cursor-pointer" checked={saveAsDraft} onChange={(e) => setSaveAsDraft(e.target.checked)} />
            <span style={{ color: 'var(--text)' }}>Save as draft — finish and submit later</span>
          </label>

          <p className="text-[11px] text-secondary">
            After filing, open the application from "My Applications" to upload the required documents for your requirement checklist.
          </p>
        </div>
      </SidePanel>
    </>
  );
}
