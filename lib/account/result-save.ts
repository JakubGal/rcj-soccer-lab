/** Deduplicate writes without turning a failed write into a saved result. */
export function createResultSaveTracker() {
  const saved = new Set<string>();
  const pending = new Map<string, Promise<void>>();
  return {
    has: (id: string) => saved.has(id) || pending.has(id),
    isSaved: (id: string) => saved.has(id),
    save(id: string, operation: () => Promise<void> | void): Promise<void> {
      if (saved.has(id)) return Promise.resolve();
      const existing = pending.get(id);
      if (existing) return existing;
      const job = Promise.resolve()
        .then(operation)
        .then(() => {
          saved.add(id);
        })
        .finally(() => {
          pending.delete(id);
        });
      pending.set(id, job);
      return job;
    },
  };
}
