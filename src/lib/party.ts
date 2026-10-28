import { createContext, useContext } from 'react';

/** Who's on the other side of an application: a "proponent" while a new
 * application is with the BDO; a "locator" once it's the Account Officer's
 * (approved, and its renewals). */
export type Party = { p: string; P: string };

export function partyFor(isRenewal: unknown): Party {
  return Number(isRenewal) ? { p: 'locator', P: 'Locator' } : { p: 'proponent', P: 'Proponent' };
}

/** Set by the application drawers (evaluation, For Approval) for their tabs. */
export const PartyContext = createContext<Party>(partyFor(false));
export const useParty = () => useContext(PartyContext);
