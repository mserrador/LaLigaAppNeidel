const express = require('express');
const { validateAction, validationError } = require('./validation');

const bearerFrom = (req) => {
  const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
  return match?.[1] || null;
};

function publicAccount(account) {
  return account ? { id: account.id, identityId: account.identityId, displayName: account.displayName,
    createdAt: account.createdAt, updatedAt: account.updatedAt } : null;
}

function createRouter({ repository, client, executor, getStatus }) {
  const router = express.Router();

  router.get('/status', (req, res) => {
    let account = null;
    try { account = publicAccount(repository.getAccount()); } catch { /* reported as unlinked */ }
    res.json({ ...getStatus(), connected: Boolean(account), account });
  });

  router.post('/connect', asyncRoute(async (req, res) => {
    const bearer = bearerFrom(req);
    if (!bearer) throw httpError(401, 'Bearer token is required');
    const identity = await client.getCurrentUser(bearer);
    if (!identity?.id && !identity?.userId && !identity?.sub) throw httpError(502, 'Fantasy identity response is invalid');
    const expiresAt = req.body?.expiresAt == null ? null : new Date(req.body.expiresAt).getTime();
    if (expiresAt != null && !Number.isFinite(expiresAt)) throw validationError('expiresAt must be a valid date');
    const account = repository.saveAccount({ ...identity, id: identity.id || identity.userId || identity.sub }, {
      accessToken: bearer, refreshToken: req.body?.refreshToken || null, expiresAt,
      clientId: req.body?.clientId || null,
    });
    res.status(201).json({ account: publicAccount(account) });
  }));

  router.use(asyncRoute(async (req, res, next) => {
    const bearer = bearerFrom(req);
    if (!bearer) throw httpError(401, 'Bearer token is required');
    const account = repository.getAccount();
    if (!account) throw httpError(401, 'No Fantasy account linked');
    const identity = await client.getCurrentUser(bearer);
    const id = identity?.id || identity?.userId || identity?.sub;
    if (String(id) !== String(account.identityId)) throw httpError(403, 'Bearer identity does not match linked account');
    req.schedulerAccount = account;
    req.schedulerBearer = bearer;
    next();
  }));

  router.delete('/connect', (req, res) => {
    repository.disconnect();
    res.status(204).end();
  });

  router.get('/actions', (req, res) => {
    res.json({ actions: repository.listActions(req.schedulerAccount.id, req.query) });
  });

  router.post('/actions', asyncRoute(async (req, res) => {
    const action = validateAction(req.body);
    const draft = { ...action, accountId: req.schedulerAccount.id };
    const snapshot = await executor.authoritativeSnapshot(draft);
    if (action.type === 'bid') {
      draft.marketId = draft.marketId || snapshot.marketId;
      draft.playerTeamId = draft.playerTeamId || snapshot.playerTeamId;
    } else {
      draft.ownerTeamId = snapshot.ownerTeamId;
      draft.playerTeamId = snapshot.playerTeamId;
    }
    if (draft.scheduleMode === 'before_market_expiry') {
      const expiration = new Date(snapshot.expirationDate).getTime();
      if (!Number.isFinite(expiration)) throw validationError('Market expiration is unavailable');
      draft.scheduledFor = new Date(expiration - (draft.offsetSeconds || 0) * 1000).toISOString();
    }
    if (draft.scheduleMode === 'unlock') {
      if (!snapshot.buyoutClauseLockedEndTime) throw validationError('Buyout lock end is unavailable');
      draft.scheduledFor = new Date(snapshot.buyoutClauseLockedEndTime).toISOString();
    }
    if (new Date(draft.scheduledFor).getTime() <= Date.now()) {
      throw validationError('scheduledFor must be in the future');
    }
    draft.snapshot = snapshot;
    res.status(201).json({ action: repository.createAction(req.schedulerAccount.id, draft) });
  }));

  router.get('/actions/:id', actionRoute(repository, (req, res, action) => res.json({
    action: { ...action, attempts: repository.getAttempts(action.id), executionAttempt: repository.getAttempts(action.id)[0] || null },
  })));

  router.put('/actions/:id', asyncRoute(async (req, res) => {
    const current = requireAction(repository, req);
    if (!Number.isSafeInteger(req.body?.version)) throw validationError('version is required');
    const merged = { ...current, ...req.body, existingType: current.type };
    const validated = validateAction(merged);
    delete validated.type;
    const snapshot = await executor.authoritativeSnapshot({ ...current, ...validated });
    validated.snapshot = snapshot;
    if (validated.scheduleMode === 'before_market_expiry') {
      const expiration = new Date(snapshot.expirationDate).getTime();
      if (!Number.isFinite(expiration)) throw validationError('Market expiration is unavailable');
      validated.scheduledFor = new Date(expiration - (validated.offsetSeconds || 0) * 1000).toISOString();
    }
    if (validated.scheduleMode === 'unlock') {
      if (!snapshot.buyoutClauseLockedEndTime) throw validationError('Buyout lock end is unavailable');
      validated.scheduledFor = new Date(snapshot.buyoutClauseLockedEndTime).toISOString();
    }
    if (new Date(validated.scheduledFor).getTime() <= Date.now()) {
      throw validationError('scheduledFor must be in the future');
    }
    const action = repository.updateAction(current.id, req.schedulerAccount.id, validated, req.body.version);
    res.json({ action });
  }));

  router.post('/actions/:id/toggle', actionRoute(repository, (req, res) => {
    const action = repository.toggle(req.params.id, req.schedulerAccount.id);
    if (!action) throw httpError(409, 'Action cannot be toggled');
    res.json({ action });
  }));

  router.delete('/actions/:id', actionRoute(repository, (req, res) => {
    if (!repository.cancel(req.params.id, req.schedulerAccount.id)) throw httpError(409, 'Action cannot be cancelled');
    res.status(204).end();
  }));

  router.get('/actions/:id/current-state', asyncRoute(async (req, res) => {
    const action = requireAction(repository, req);
    const snapshot = await executor.authoritativeSnapshot(action);
    res.json({ snapshot });
  }));

  router.get('/exposure', (req, res) => {
    if (!req.query.leagueId) throw validationError('leagueId is required');
    res.json(repository.exposure(req.schedulerAccount.id, req.query.leagueId));
  });

  router.use((error, req, res, _next) => {
    const status = Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 500;
    res.status(status).json({ error: error.code || 'SCHEDULER_ERROR', message: status === 500 ? 'Scheduler request failed' : error.message,
      ...(error.data && status < 500 ? { data: error.data } : {}) });
  });
  return router;
}

function requireAction(repository, req) {
  const action = repository.getAction(req.params.id, req.schedulerAccount.id);
  if (!action) throw httpError(404, 'Action not found');
  return action;
}
function actionRoute(repository, handler) {
  return asyncRoute(async (req, res) => handler(req, res, requireAction(repository, req)));
}
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve().then(() => handler(req, res, next)).catch(next);
}
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }

module.exports = { createRouter, bearerFrom, publicAccount };
