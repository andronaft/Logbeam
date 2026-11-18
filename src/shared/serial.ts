/**
 * Runs async tasks one after another. Registering a content script is "is it there? then add it",
 * and the context menu is "remove all, then add each": two of those at once (a permission granted
 * while the startup sync runs, two settings saved in a row) fail with "duplicate id".
 */
export function serial(): <T>(task: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = last.then(task, task);
    last = run.catch(() => undefined);
    return run;
  };
}
