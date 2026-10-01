export type ReadinessStatus = 'ok' | 'unavailable' | 'not_configured';

export async function checkReadiness(
  configured: Record<string, boolean>,
  probes: Record<string, () => Promise<void>>,
) {
  const checks: Record<string, ReadinessStatus> = {};
  await Promise.all(
    Object.entries(configured).map(async ([name, present]) => {
      if (!present) {
        checks[name] = 'not_configured';
        return;
      }
      const probe = probes[name];
      if (!probe) {
        checks[name] = 'ok';
        return;
      }
      try {
        await probe();
        checks[name] = 'ok';
      } catch {
        // A public health response must never include connection errors or credentials.
        checks[name] = 'unavailable';
      }
    }),
  );
  return {
    status: Object.values(checks).every((value) => value === 'ok') ? 'ready' : 'unavailable',
    checks,
  };
}
