import { getSiteSettings } from './siteSettings';

// Locators can't create their own business profile: staff (Assessment
// Officer) set it up for them. Shown wherever the portal needs a profile the
// account doesn't have yet.
export function noLocatorProfileMessage(): string {
  const { org_short_name, support_email, support_phone } = getSiteSettings().branding;
  const contact = [support_email, support_phone].filter(Boolean).join(' / ');
  return `Your business profile hasn't been set up yet. ${org_short_name} will set it up for you${
    contact ? ` — for questions, contact ${contact}` : ''
  }.`;
}
