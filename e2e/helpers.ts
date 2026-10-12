import { type Browser, expect, type Page, request } from '@playwright/test';

export const BASE_URL = 'http://localhost:8790';
export const PASSWORD = 'e2e-test-password';
export const ADMIN = 'e2e_admin';
export const SETUP_TOKEN = 'e2e-setup-token';

export interface TestUser {
  id: string;
  username: string;
  displayName: string;
}

/** Sign-up body accepted by every version of the API (unknown fields are ignored). */
export function signUp(username: string, extra: Record<string, unknown> = {}) {
  return {
    username,
    displayName: username,
    password: PASSWORD,
    ageConfirmed: true,
    termsAccepted: true,
    ...extra,
  };
}

/** API calls from the tests look like calls from the app itself (CSRF check). */
export const API = { baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL } };

let counter = 0;

/** A new approved athlete with a unique name, created through the API (not the UI). */
export async function createAthlete(prefix: string): Promise<TestUser> {
  counter++;
  const username = `${prefix}_${Date.now().toString(36)}${counter}`.slice(0, 30);
  const ctx = await request.newContext(API);
  const res = await ctx.post('/api/auth/register', { data: signUp(username) });
  expect(res.status(), await res.text()).toBe(201);
  const { user } = (await res.json()) as { user: TestUser };
  await ctx.dispose();

  const admin = await request.newContext(API);
  const login = await admin.post('/api/auth/login', {
    data: { username: ADMIN, password: PASSWORD },
  });
  expect(login.ok(), await login.text()).toBe(true);
  const approve = await admin.post(`/api/users/${user.id}/approve`);
  expect(approve.ok(), await approve.text()).toBe(true);
  await admin.dispose();
  return { id: user.id, username, displayName: username };
}

/** A phone (own browser context with camera access) on which `user` is logged in. */
export async function phoneOf(browser: Browser, user: TestUser): Promise<Page> {
  const context = await browser.newContext();
  const res = await context.request.post('/api/auth/login', {
    data: { username: user.username, password: PASSWORD },
    headers: { origin: BASE_URL },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const page = await context.newPage();
  // Every confirmation dialog ("this is binding …") is answered with OK.
  page.on('dialog', (dialog) => void dialog.accept());
  return page;
}

/** A phone on which the admin from global-setup.ts is logged in. */
export function adminPhone(browser: Browser): Promise<Page> {
  return phoneOf(browser, { id: '', username: ADMIN, displayName: ADMIN });
}
