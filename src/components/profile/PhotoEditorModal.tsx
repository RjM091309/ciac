import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ImagePlus, Minus, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { UserAvatar } from '../ui/UserAvatar';
import { patchMyProfile, type MyProfile } from '../../lib/myProfile';

// My Profile's photo editor — opened from the pencil on the avatar. Choose a
// photo, drag it to position it inside the circle and zoom, then save; or
// remove the current photo. The crop is rendered in the browser, so only a
// small 256px square is uploaded.

const OUTPUT_SIZE = 256;
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_ZOOM = 3;

type Picked = { url: string; img: HTMLImageElement };
/** Top-left of the image inside the crop box, in on-screen pixels. */
type Offset = { x: number; y: number };

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file couldn't be read as an image."));
    img.src = url;
  });
}

export function PhotoEditorModal({
  open,
  profile,
  onClose,
}: {
  open: boolean;
  profile: MyProfile;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [box, setBox] = useState(240);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);

  // Start clean each time it opens; free the picked file's object URL on the way out.
  useEffect(() => {
    if (open) return;
    setPicked((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    setZoom(1);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  // The crop box is square and fills the modal's width up to 240px.
  useEffect(() => {
    if (!picked || !boxRef.current) return;
    const measure = () => boxRef.current && setBox(boxRef.current.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, [picked]);

  // Scale at zoom 1 = the image just covers the box (shorter side fits).
  const baseScale = picked ? box / Math.min(picked.img.naturalWidth, picked.img.naturalHeight) : 1;
  const scale = baseScale * zoom;
  const dispW = picked ? picked.img.naturalWidth * scale : 0;
  const dispH = picked ? picked.img.naturalHeight * scale : 0;

  // Never let the image leave a gap inside the box.
  const clamp = (o: Offset, w = dispW, h = dispH): Offset => ({
    x: Math.min(0, Math.max(box - w, o.x)),
    y: Math.min(0, Math.max(box - h, o.y)),
  });

  // Center the image whenever a new one is picked or the box resizes.
  useEffect(() => {
    if (!picked) return;
    const s = (box / Math.min(picked.img.naturalWidth, picked.img.naturalHeight)) * zoom;
    setOffset({ x: (box - picked.img.naturalWidth * s) / 2, y: (box - picked.img.naturalHeight * s) / 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, box]);

  function changeZoom(next: number) {
    if (!picked) return;
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    const newScale = baseScale * z;
    // Keep whatever is at the center of the circle at the center.
    const cx = (box / 2 - offset.x) / scale;
    const cy = (box / 2 - offset.y) / scale;
    const w = picked.img.naturalWidth * newScale;
    const h = picked.img.naturalHeight * newScale;
    setZoom(z);
    setOffset(clamp({ x: box / 2 - cx * newScale, y: box / 2 - cy * newScale }, w, h));
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast.error('Choose a JPG, PNG or WebP image.');
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      toast.error('That photo is too large (max 15 MB).');
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      setPicked((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { url, img };
      });
      setZoom(1);
    } catch (err: any) {
      URL.revokeObjectURL(url);
      toast.error(err?.message || "That file couldn't be read as an image.");
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    setOffset(clamp({ x: d.ox + e.clientX - d.px, y: d.oy + e.clientY - d.py }));
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  async function save() {
    if (!picked) return;
    setBusy('save');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Your browser could not process the photo.');
      // JPEG has no transparency — give transparent PNGs a white backdrop instead of black.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      ctx.imageSmoothingQuality = 'high';
      const side = box / scale;
      ctx.drawImage(picked.img, -offset.x / scale, -offset.y / scale, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Your browser could not process the photo.'))), 'image/jpeg', 0.9)
      );
      const body = new FormData();
      body.append('avatar', blob, 'avatar.jpg');
      const res = await fetch('/api/profile/avatar', { method: 'POST', credentials: 'include', body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Failed to upload photo.');
      patchMyProfile({ avatar_version: json.data?.avatar_version ?? null });
      toast.success('Profile photo updated.');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to upload photo.');
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('remove');
    try {
      const res = await fetch('/api/profile/avatar', { method: 'DELETE', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Failed to remove photo.');
      patchMyProfile({ avatar_version: null });
      toast.success('Profile photo removed.');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to remove photo.');
    } finally {
      setBusy(null);
    }
  }

  const displayName = profile.full_name || profile.username;
  const outlineBtn =
    'inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-semibold cursor-pointer transition-colors hover:bg-[var(--hover-bg)] disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <AnimatePresence>
      {open ? (
        // Above the side panel (z-60), same layer as ChangePasswordModal.
        <div className="fixed inset-0 z-[130] flex items-center justify-center px-3">
          <motion.div
            className="absolute inset-0"
            style={{ backgroundColor: 'rgba(0,0,0,.45)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={() => !busy && onClose()}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Profile photo"
            className="w-full max-w-sm rounded-2xl border p-4 sm:p-5 relative z-10"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <h3 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text)' }}>
              Profile photo
            </h3>
            <p className="text-[11px] text-secondary mt-1">
              {picked ? 'Drag to reposition and use the slider to zoom.' : 'JPG, PNG or WebP, up to 15 MB.'}
            </p>

            <div className="mt-4 flex flex-col items-center gap-4">
              {picked ? (
                <>
                  <div
                    ref={boxRef}
                    className="relative w-full max-w-[240px] aspect-square overflow-hidden rounded-xl cursor-grab active:cursor-grabbing select-none"
                    style={{ touchAction: 'none', backgroundColor: 'var(--control-bg)' }}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onWheel={(e) => changeZoom(zoom - e.deltaY * 0.0015)}
                  >
                    <img
                      src={picked.url}
                      alt=""
                      draggable={false}
                      className="absolute max-w-none pointer-events-none"
                      style={{ left: offset.x, top: offset.y, width: dispW, height: dispH }}
                    />
                    {/* Dims everything outside the circle that becomes the photo. */}
                    <div
                      className="absolute inset-0 rounded-full pointer-events-none"
                      style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,.55)', border: '2px solid rgba(255,255,255,.85)' }}
                    />
                  </div>
                  <div className="flex w-full max-w-[240px] items-center gap-2">
                    <button
                      type="button"
                      aria-label="Zoom out"
                      onClick={() => changeZoom(zoom - 0.2)}
                      className="text-secondary hover:text-[var(--text)] cursor-pointer"
                    >
                      <Minus size={14} />
                    </button>
                    <input
                      type="range"
                      min={1}
                      max={MAX_ZOOM}
                      step={0.01}
                      value={zoom}
                      onChange={(e) => changeZoom(Number(e.target.value))}
                      aria-label="Zoom"
                      className="flex-1 cursor-pointer accent-[var(--text)]"
                    />
                    <button
                      type="button"
                      aria-label="Zoom in"
                      onClick={() => changeZoom(zoom + 0.2)}
                      className="text-secondary hover:text-[var(--text)] cursor-pointer"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </>
              ) : (
                <UserAvatar
                  version={profile.avatar_version}
                  name={displayName}
                  className="h-36 w-36 text-4xl font-bold"
                  style={{ backgroundColor: 'var(--control-bg)', color: 'var(--text)' }}
                />
              )}

              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy !== null}
                  className={outlineBtn}
                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
                >
                  {picked ? <ImagePlus size={13} /> : <Upload size={13} />}
                  {picked ? 'Choose another' : profile.avatar_version ? 'Upload new photo' : 'Upload photo'}
                </button>
                {!picked && profile.avatar_version ? (
                  <button
                    type="button"
                    onClick={remove}
                    disabled={busy !== null}
                    className={outlineBtn}
                    style={{ borderColor: 'var(--border-subtle)', color: '#ef4444' }}
                  >
                    <Trash2 size={13} />
                    {busy === 'remove' ? 'Removing…' : 'Remove photo'}
                  </button>
                ) : null}
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPick} />
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                className={`rounded-lg px-3 py-2 text-sm font-semibold border ${
                  busy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-[var(--hover-bg)]'
                }`}
                style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
                onClick={onClose}
                disabled={busy !== null}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                  busy || !picked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:opacity-90'
                }`}
                style={{ backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }}
                onClick={save}
                disabled={busy !== null || !picked}
              >
                {busy === 'save' ? 'Saving…' : 'Save photo'}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
