const express = require('express');
const { createTokenCipher } = require('./crypto');
const { createRepository } = require('./repository');
const { createFantasyClient } = require('./client');
const { createExecutor } = require('./executor');
const { createPollingScheduler } = require('./scheduler');
const { createRouter } = require('./router');
const { createLogger } = require('./logger');

function createSchedulerSubsystem(config = {}, dependencies = {}) {
  const logger = dependencies.logger || createLogger(config.logger);
  const disabled = (reason) => {
    const router = express.Router();
    router.get('/status', (req, res) => res.json({ enabled: false, running: false, reason }));
    router.use((req, res) => res.status(503).json({ error: 'SCHEDULER_DISABLED', message: reason }));
    return {
      router,
      start: async () => {}, stop: async () => {}, close: () => {},
      status: () => ({ enabled: false, running: false, reason }),
      repository: null, executor: null,
    };
  };

  if (config.enabled === false) return disabled('Scheduler is disabled');
  try {
    const clock = dependencies.clock || (() => new Date());
    const cipher = createTokenCipher(config.encryptionKey);
    const repository = dependencies.repository || createRepository({
      databasePath: config.databasePath, dataDir: config.dataDir, cipher, clock,
    });
    const client = dependencies.client || createFantasyClient(config, repository, {
      fetchImpl: dependencies.fetch, clock,
    });
    const executor = createExecutor({ repository, client, clock, logger,
      economicMutex: dependencies.economicMutex });
    const scheduler = createPollingScheduler({ repository, executor,
      pollIntervalMs: config.pollIntervalMs, clock, logger });
    const status = () => ({ enabled: true, ...scheduler.status() });
    const router = createRouter({ repository, client, executor, getStatus: status });
    let closed = false;
    return { router, start: scheduler.start, stop: scheduler.stop,
      close: () => { if (!closed) { closed = true; repository.close(); } }, status, repository, executor, client,
      runOnce: scheduler.runOnce };
  } catch (error) {
    logger.error('initialization_failed', { error: error.message });
    return disabled(`Scheduler unavailable: ${error.message}`);
  }
}

module.exports = {
  createSchedulerSubsystem,
  ...require('./rules'),
  ...require('./validation'),
  ...require('./crypto'),
  ...require('./repository'),
  ...require('./client'),
  ...require('./executor'),
  ...require('./scheduler'),
};
