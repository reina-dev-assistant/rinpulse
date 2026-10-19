import { describe, expect, it } from 'bun:test';

import { createForegroundScheduler, type AppStateSource } from './foreground';

function fake(initial: string) {
  let state = initial;
  const listeners = new Set<(state: string) => void>();
  const source: AppStateSource = {
    current: () => state,
    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    source,
    listeners,
    set(next: string) {
      state = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
}

describe('createForegroundScheduler', () => {
  it('runs a job at once while the app is active', () => {
    const app = fake('active');
    const scheduler = createForegroundScheduler(app.source);
    let ran = 0;
    scheduler.run('repair', () => ran++);
    expect(ran).toBe(1);
    expect(scheduler.isActive()).toBe(true);
  });

  it('holds a job back in the background and while inactive, and runs it once when the app comes forward', () => {
    for (const initial of ['background', 'inactive', 'unknown']) {
      const app = fake(initial);
      const scheduler = createForegroundScheduler(app.source);
      let ran = 0;
      scheduler.run('repair', () => ran++);
      scheduler.run('repair', () => ran++);
      expect(ran).toBe(0);
      app.set('inactive');
      expect(ran).toBe(0);
      app.set('active');
      expect(ran).toBe(1);
      app.set('background');
      app.set('active');
      expect(ran).toBe(1);
      expect(app.listeners.size).toBe(0);
    }
  });

  it('keeps one job per key', () => {
    const app = fake('background');
    const scheduler = createForegroundScheduler(app.source);
    const ran: string[] = [];
    scheduler.run('a', () => ran.push('a'));
    scheduler.run('b', () => ran.push('b'));
    app.set('active');
    expect(ran.sort()).toEqual(['a', 'b']);
  });
});
