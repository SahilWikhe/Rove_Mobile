/** Close the disposable PostgreSQL instance before Playwright signals the server process group. */
export default async function teardown() {
  const result = await fetch('http://localhost:4085/__e2e/shutdown', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
  });
  if (!result.ok) throw new Error('The synthetic database did not shut down cleanly.');
}
