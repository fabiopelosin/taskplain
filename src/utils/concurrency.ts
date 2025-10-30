export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  handler: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const normalizedLimit = Number.isFinite(limit) ? Math.floor(limit) : 1;
  const poolSize = Math.max(1, Math.min(normalizedLimit > 0 ? normalizedLimit : 1, items.length));
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        break;
      }
      await handler(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: poolSize }, () => worker());
  await Promise.all(workers);
}
