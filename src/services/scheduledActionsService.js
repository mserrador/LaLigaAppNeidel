import api from './api';

const unwrap = (response) => response?.data ?? response;

const TO_BACKEND_CALC = {
  market_value: 'market_value',
  market_value_plus: 'market_value_plus_amount',
  fixed: 'fixed_amount',
  market_value_percent: 'market_value_plus_percent',
};
const FROM_BACKEND_CALC = Object.fromEntries(Object.entries(TO_BACKEND_CALC).map(([key, value]) => [value, key]));

const normalizeRules = (rules = []) => rules.map((rule) => ({
  calculationType: FROM_BACKEND_CALC[rule.calcType] || rule.calculationType || 'market_value',
  value: rule.calcType === 'market_value_plus_percent' ? rule.percent : (rule.amount ?? rule.value ?? 0),
}));

const normalizeAction = (action) => {
  if (!action) return action;
  const snapshot = action.playerSnapshot || action.snapshot || {};
  const scheduledAt = action.scheduledAt ?? action.scheduledFor;
  const expirationDate = snapshot.expirationDate;
  const inferredOffsetSeconds = action.scheduleMode === 'before_market_expiry' && expirationDate && scheduledAt
    ? Math.max(0, Math.round((new Date(expirationDate).getTime() - new Date(scheduledAt).getTime()) / 1000))
    : null;
  return {
    ...action,
    playerMasterId: action.playerMasterId ?? action.playerId,
    scheduledAt,
    enabled: action.enabled ?? action.status !== 'paused',
    playerSnapshot: {
      ...snapshot,
      playerMasterId: snapshot.playerMasterId ?? snapshot.playerId ?? action.playerId,
      clause: snapshot.clause ?? snapshot.buyoutClause,
      lockEnd: snapshot.lockEnd ?? snapshot.buyoutClauseLockedEndTime,
    },
    config: {
      ...(action.config || {}),
      timingMode: action.config?.timingMode || (action.scheduleMode === 'before_market_expiry'
        ? 'offset'
        : action.type === 'buyout' && action.scheduleMode === 'exact' ? 'manual' : action.scheduleMode),
      offsetAmount: action.config?.offsetAmount ?? action.offsetSeconds ?? inferredOffsetSeconds,
      offsetUnit: action.config?.offsetUnit || (inferredOffsetSeconds != null ? 'seconds' : undefined),
      rules: normalizeRules(action.rules || action.config?.rules),
      maxOverpriceEuros: action.maxOverpriceAmount ?? action.config?.maxOverpriceEuros,
      maxOverpricePercent: action.maxOverpricePercent ?? action.config?.maxOverpricePercent,
    },
    executionAttempt: action.executionAttempt ? {
      ...action.executionAttempt,
      attemptedAt: action.executionAttempt.startedAt,
      executedAt: action.executionAttempt.finishedAt,
      result: action.executionAttempt.status,
      amount: action.executionAttempt.snapshot?.amount ?? action.executionAttempt.snapshot?.buyoutAmount,
      reason: action.executionAttempt.snapshot?.reason || action.executionAttempt.error,
    } : (action.result || action.lastError ? {
      executedAt: action.completedAt,
      result: action.status,
      amount: action.result?.amount,
      reason: action.result?.reason || action.lastError,
    } : null),
  };
};

const backendRules = (rules = []) => rules.map((rule, index) => ({
  minBids: index,
  maxBids: index === 3 ? null : index,
  calcType: TO_BACKEND_CALC[rule.calculationType],
  amount: ['market_value_plus', 'fixed'].includes(rule.calculationType) ? Number(rule.value) : null,
  percent: rule.calculationType === 'market_value_percent' ? Number(rule.value) : null,
}));

const toBackendAction = (action) => ({
  type: action.type,
  leagueId: action.leagueId,
  playerId: action.playerMasterId,
  playerTeamId: action.playerTeamId,
  marketId: action.marketId,
  ownerTeamId: action.ownerTeamId,
  scheduleMode: action.type === 'bid' && action.config?.timingMode === 'offset'
    ? 'before_market_expiry'
    : action.type === 'buyout' && action.config?.timingMode === 'unlock' ? 'unlock' : 'exact',
  scheduledFor: action.scheduledAt,
  offsetSeconds: action.type === 'bid' && action.config?.timingMode === 'offset'
    ? Number(action.config.offsetAmount || 0) * (action.config.offsetUnit === 'minutes' ? 60 : 1)
    : null,
  maxAmount: action.maxAmount,
  enabled: action.enabled !== false,
  ...(action.type === 'bid' ? { rules: backendRules(action.config?.rules) } : {
    maxOverpriceAmount: action.config?.maxOverpriceEuros || undefined,
    maxOverpricePercent: action.config?.maxOverpricePercent || undefined,
  }),
  ...(action.version ? { version: action.version } : {}),
});

const scheduledActionsService = {
  status: () => api.get('/scheduler/status', { suppressErrorToast: true }).then(unwrap),
  connect: (tokens) => api.post('/scheduler/connect', {
    refreshToken: tokens.refresh_token || null,
    clientId: tokens.client_id || null,
    expiresAt: tokens.expires_on ? new Date(Number(tokens.expires_on) * 1000).toISOString() : null,
  }).then(unwrap),
  disconnect: () => api.delete('/scheduler/connect').then(unwrap),
  list: async (params = {}) => {
    const { scope, ...requestParams } = params;
    // Scope includes several statuses and is therefore filtered client-side.
    if (scope) delete requestParams.status;
    const data = unwrap(await api.get('/scheduler/actions', { params: requestParams, suppressErrorToast: true }));
    let actions = (data?.actions || []).map(normalizeAction);
    if (params.status && params.status !== 'all') actions = actions.filter((action) => action.status === params.status);
    if (scope === 'active') actions = actions.filter((action) => ['scheduled', 'paused', 'ready', 'executing', 'uncertain'].includes(action.status));
    if (scope === 'history') actions = actions.filter((action) => ['executed', 'skipped', 'failed', 'cancelled', 'expired'].includes(action.status));
    return { ...data, actions };
  },
  create: async (action) => {
    const data = unwrap(await api.post('/scheduler/actions', toBackendAction(action)));
    return normalizeAction(data?.action || data);
  },
  get: (actionId) => api.get(`/scheduler/actions/${actionId}`).then(unwrap).then((data) => normalizeAction(data?.action || data)),
  update: async (actionId, action) => {
    const data = unwrap(await api.put(`/scheduler/actions/${actionId}`, toBackendAction(action)));
    let updated = normalizeAction(data?.action || data);
    if (updated && action.enabled !== updated.enabled) {
      const toggled = unwrap(await api.post(`/scheduler/actions/${actionId}/toggle`));
      updated = normalizeAction(toggled?.action || toggled);
    }
    return updated;
  },
  toggle: (actionId) => api.post(`/scheduler/actions/${actionId}/toggle`).then(unwrap).then((data) => normalizeAction(data?.action || data)),
  cancel: (actionId) => api.delete(`/scheduler/actions/${actionId}`).then(unwrap),
  currentState: (actionId) => api.get(`/scheduler/actions/${actionId}/current-state`).then(unwrap).then((data) => {
    const snapshot = data?.snapshot || data;
    return { ...snapshot, clause: snapshot?.buyoutClause, lockEnd: snapshot?.buyoutClauseLockedEndTime };
  }),
  exposure: (leagueId) => api.get('/scheduler/exposure', { params: { leagueId }, suppressErrorToast: true }).then(unwrap),
};

export default scheduledActionsService;
