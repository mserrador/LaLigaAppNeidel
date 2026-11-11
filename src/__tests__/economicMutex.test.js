const { createEconomicMutex } = require('../../server/economicMutex');

describe('economic mutex', () => {
  test('serializes operations and releases the queue after failures', async () => {
    const mutex = createEconomicMutex();
    const events = [];
    let releaseFirst;
    let markFirstStarted;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });

    const first = mutex.runExclusive(async () => {
      events.push('first:start');
      markFirstStarted();
      await firstGate;
      events.push('first:end');
    });
    const second = mutex.runExclusive(async () => {
      events.push('second:start');
      throw new Error('expected');
    }).catch((error) => error);
    const third = mutex.runExclusive(async () => {
      events.push('third:start');
    });

    await firstStarted;
    expect(events).toEqual(['first:start']);
    releaseFirst();
    await first;
    expect(await second).toEqual(expect.objectContaining({ message: 'expected' }));
    await third;
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'third:start']);
  });
});
