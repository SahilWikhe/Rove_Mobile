import { pathToFileURL } from 'node:url';
export async function checkCandidateHealth(url, bypass, request = fetch) {
  if (!/^https:\/\/[A-Za-z0-9-]+\.vercel\.app$/.test(url ?? '')) throw new Error('Invalid candidate URL');
  const response = await request(`${url}/health/ready`, {
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: bypass ? { 'x-vercel-protection-bypass': bypass } : {},
  });
  if (!response.ok || (await response.json()).status !== 'ready') throw new Error('Candidate health failed');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await checkCandidateHealth(process.env.DEPLOYMENT_URL, process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
    console.log('Candidate API database readiness passed. Full release acceptance is still required.');
  } catch {
    console.error('Candidate API database readiness failed. No promotion performed.');
    process.exitCode = 1;
  }
}
