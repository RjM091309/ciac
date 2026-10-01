import React, { forwardRef } from 'react';

// A password box the browser's password manager leaves alone — for every place
// a signed-in user retypes a password to confirm a change (Portal Settings,
// My Profile, Change Password's "current password") and for passwords that
// aren't the user's own (another account's, the SMTP server's, the Maps key).
//
// Why not just autocomplete="off": browsers ignore it on password fields.
// Their password managers only act on <input type="password">, so where the
// browser can mask an ordinary text field (-webkit-text-security: Chrome, Edge,
// Safari) and the device has a mouse/trackpad, this is a masked text field:
// nothing is offered, filled, or "saved" afterwards. Otherwise (no masking
// support, or a touchscreen, where an on-screen keyboard could learn a plain
// text field's contents) it stays a real password field with the strongest
// "don't fill" hints. Either way the third-party managers' ignore markers are
// set. Pasting is never blocked.
//
// The point is security, not convenience: a "confirm it's you" prompt that
// fills itself in with one click proves nothing about who is at the keyboard.

const IGNORE_MARKERS = {
  'data-lpignore': 'true', // LastPass
  'data-1p-ignore': 'true', // 1Password
  'data-bwignore': 'true', // Bitwarden
  'data-form-type': 'other', // Dashlane
} as const;

const canMaskTextField =
  typeof window !== 'undefined' &&
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('-webkit-text-security', 'disc') &&
  Boolean(window.matchMedia?.('(pointer: fine)').matches);

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'autoComplete'> & {
  /** Show the characters (an eye toggle). */
  revealed?: boolean;
};

export const NoAutofillPasswordInput = forwardRef<HTMLInputElement, Props>(function NoAutofillPasswordInput(
  { revealed = false, style, onCopy, onCut, ...rest },
  ref
) {
  if (canMaskTextField) {
    // Masked text can still be copied out of a text field — block that while
    // masked, as a real password field does.
    const blockWhileMasked = (handler?: React.ClipboardEventHandler<HTMLInputElement>) => (e: React.ClipboardEvent<HTMLInputElement>) => {
      if (!revealed) e.preventDefault();
      handler?.(e);
    };
    return (
      <input
        ref={ref}
        {...rest}
        {...IGNORE_MARKERS}
        type="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        style={{ ...style, WebkitTextSecurity: revealed ? 'none' : 'disc' } as React.CSSProperties}
        onCopy={blockWhileMasked(onCopy)}
        onCut={blockWhileMasked(onCut)}
      />
    );
  }
  return (
    <input
      ref={ref}
      {...rest}
      {...IGNORE_MARKERS}
      type={revealed ? 'text' : 'password'}
      autoComplete="new-password"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      style={style}
      onCopy={onCopy}
      onCut={onCut}
    />
  );
});
