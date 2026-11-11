function createPollingScheduler({ repository, executor, pollIntervalMs = 1000, clock = () => new Date(), logger }) {
  let timer = null;
  let running = false;
  let cyclePromise = null;
  let lastPollAt = null;
  let lastError = null;

  async function claimWithRetry(id) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return repository.claim(id, clock().toISOString()); }
      catch (error) {
        if (!/busy|locked/i.test(error.message) || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
    return null;
  }

  async function cycle() {
    if (cyclePromise) return cyclePromise;
    cyclePromise = (async () => {
      lastPollAt = clock().toISOString();
      for (const id of repository.due(20, lastPollAt)) {
        const action = await claimWithRetry(id);
        if (!action) continue;
        logger?.info?.('action_claimed', { actionId: action.id, type: action.type, scheduledFor: action.scheduledFor });
        const overdueMs = clock().getTime() - new Date(action.scheduledFor).getTime();
        const graceMs = action.type === 'bid' ? 3000 : 10000;
        if (overdueMs > graceMs) {
          repository.setStatus(action.id, 'expired', { result: { reason: 'execution_window_missed', overdueMs } });
          logger?.warn?.('execution_window_missed', { actionId: action.id, overdueMs });
          continue;
        }
        // Deliberately serial: every action re-reads upstream balance after the previous mutation.
        await executor.execute(action);
      }
      lastError = null;
    })().catch((error) => {
      lastError = String(error.message || error).slice(0, 500);
      logger?.error?.('poll_failed', { error: lastError });
    }).finally(() => { cyclePromise = null; });
    return cyclePromise;
  }

  async function start() {
    if (running) return;
    running = true;
    logger?.info?.('worker_started', { pollIntervalMs: Math.max(250, Number(pollIntervalMs) || 1000) });
    await executor.recoverExecuting();
    await cycle();
    if (running) timer = setInterval(cycle, Math.max(250, Number(pollIntervalMs) || 1000));
    timer?.unref?.();
  }

  async function stop() {
    running = false;
    if (timer) clearInterval(timer);
    timer = null;
    if (cyclePromise) await cyclePromise;
    logger?.info?.('worker_stopped');
  }

  return {
    start, stop, runOnce: cycle,
    status: () => ({ running, pollIntervalMs: Math.max(250, Number(pollIntervalMs) || 1000), lastPollAt, lastError }),
  };
}

module.exports = { createPollingScheduler };
