export default async function setupAuth(page: any): Promise<any> {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!email || !password) {
    return { cookies: [], origins: [] };
  }

  await page.goto('/auth');
  await page.fill('#signin-email', email);
  await page.fill('#signin-password', password);
  // Submit button only -- the "Sign in" tab trigger also matches has-text (see base.ts signIn).
  await page.click('button[type="submit"]:has-text("Sign in")');

  try {
    await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 15_000 });
  } catch {
    return { cookies: [], origins: [] };
  }

  return page.context().storageState();
}
