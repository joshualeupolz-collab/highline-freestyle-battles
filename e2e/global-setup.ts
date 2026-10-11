import { expect, request } from '@playwright/test';
import { ADMIN, API, SETUP_TOKEN, signUp } from './helpers';

/** The first account becomes the admin who approves the athletes of every test. */
export default async function globalSetup() {
  const ctx = await request.newContext(API);
  const res = await ctx.post('/api/auth/register', {
    data: signUp(ADMIN, { setupToken: SETUP_TOKEN }),
  });
  expect(res.status(), await res.text()).toBe(201);
  await ctx.dispose();
}
