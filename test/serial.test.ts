import { describe, expect, it } from 'vitest';
import { serial } from '../src/shared/serial';

describe('serial', () => {
  it('runs one task at a time, in order, even after a failure', async () => {
    const queue = serial();
    const log: string[] = [];
    const task =
      (name: string, fail = false) =>
      async () => {
        log.push(`${name} start`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        log.push(`${name} end`);
        if (fail) throw new Error(name);
        return name;
      };
    const results = await Promise.allSettled([queue(task('a')), queue(task('b', true)), queue(task('c'))]);
    expect(log).toEqual(['a start', 'a end', 'b start', 'b end', 'c start', 'c end']);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });
});
