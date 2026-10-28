// Same rules as server/lib/staffName.js: staff show as "AO - Jane_IP"
// (role short name, first name, middle + surname initials); their formal
// name is "Jane I. Pineda".

export type NameParts = { first: string; middle?: string | null; last?: string | null };

const initial = (s?: string | null) => String(s || '').trim().charAt(0).toUpperCase();

/** "ACCOUNT OFFICER" → "AO", "BDO" → "BDO". */
export function roleAbbrev(roleName?: string | null) {
  const words = String(roleName || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  return words.length > 1 ? words.map((w) => w[0]).join('') : words[0] || '';
}

/** "Jane I. Pineda" */
export function formalName({ first, middle, last }: NameParts) {
  return [first.trim(), initial(middle) ? `${initial(middle)}.` : '', String(last || '').trim()].filter(Boolean).join(' ');
}

/** "AO - Jane_IP" */
export function staffLabel({ first, middle, last }: NameParts, roleName?: string | null) {
  const initials = `${initial(middle)}${initial(last)}`;
  const name = initials ? `${first.trim()}_${initials}` : first.trim();
  const abbr = roleAbbrev(roleName);
  return abbr ? `${abbr} - ${name}` : name;
}
