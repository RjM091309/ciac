import React, { useEffect, useState } from 'react';
import { cn } from '../../lib/utils';
import { avatarUrl, initialsOf } from '../../lib/myProfile';

/** A user's photo — the signed-in user's unless `url` says whose — or their initials when there's none (or it
 * fails to load). Size, background and text styling come from the caller so
 * it can sit in the header pill, the mobile account card or My Profile. */
export function UserAvatar({
  version,
  name,
  url,
  className,
  style,
}: {
  version: string | null | undefined;
  name: string | null | undefined;
  /** Someone else's photo (e.g. /api/users/:id/avatar); default: the signed-in user's. */
  url?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const src = url && version ? `${url}?v=${encodeURIComponent(version)}` : avatarUrl(version);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  return (
    <div
      className={cn('rounded-full flex items-center justify-center shrink-0 overflow-hidden uppercase', className)}
      style={style}
    >
      {src && !failed ? (
        <img src={src} alt="" className="h-full w-full object-cover" draggable={false} onError={() => setFailed(true)} />
      ) : (
        initialsOf(name) || '?'
      )}
    </div>
  );
}
