/**
 * Who runs the app. Used by the legal notice, the privacy policy and the terms of use
 * (`apps/web/src/legal/`). Change it here only; the texts read it from this file.
 *
 * A legal notice ("Impressum", § 5 DDG) needs a full postal address where the operator can be
 * served legal documents, and a way to make fast electronic contact (e-mail).
 */
export const OPERATOR = {
  name: 'Joshua Leupolz',
  street: 'Im Mesnergarten 1',
  city: '79299 Wittnau',
  country: { en: 'Germany', de: 'Deutschland' },
  // To be replaced by a separate address for the app.
  email: 'joshualeupolz@gmail.com',
} as const;

/** Source code of the app, linked from the legal notice. */
export const REPOSITORY_URL = 'https://github.com/joshualeupolz-collab/highline-freestyle-battles';

/** Date shown on the privacy policy; change it whenever the policy changes. */
export const PRIVACY_UPDATED = '2026-10-12';
