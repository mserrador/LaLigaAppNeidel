const { DateTime } = require('luxon');
const { CALC_TYPES } = require('./rules');

const ACTION_TYPES = new Set(['bid', 'buyout']);
const SCHEDULE_MODES = new Set(['exact', 'before_market_expiry', 'unlock']);

function positiveInteger(value, name, optional = false) {
  if (optional && (value === undefined || value === null)) return null;
  if (!Number.isSafeInteger(value) || value <= 0) throw validationError(`${name} must be a positive integer`);
  return value;
}

function positiveNumber(value, name, optional = false) {
  if (optional && (value === undefined || value === null)) return null;
  if (!Number.isFinite(value) || value <= 0) throw validationError(`${name} must be a positive number`);
  return value;
}

function canonicalDate(value, name = 'scheduledFor') {
  if (typeof value !== 'string') throw validationError(`${name} must be an ISO date`);
  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  let dt = DateTime.fromISO(value, hasExplicitZone ? { setZone: true } : { zone: 'Europe/Madrid' });
  if (!dt.isValid) dt = DateTime.fromFormat(value, 'yyyy-MM-dd HH:mm', { zone: 'Europe/Madrid' });
  if (!dt.isValid) throw validationError(`${name} must be a valid ISO date or Europe/Madrid local time`);
  return dt.toUTC().toISO({ suppressMilliseconds: false });
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'VALIDATION_ERROR';
  return error;
}

function validateRules(input) {
  if (!Array.isArray(input) || input.length !== 4) throw validationError('bid actions require exactly four rules');
  const rules = input.map((raw, position) => {
    const minBids = Number(raw.minBids);
    const maxBids = raw.maxBids == null ? null : Number(raw.maxBids);
    if (!Number.isInteger(minBids) || minBids < 0 ||
        (maxBids != null && (!Number.isInteger(maxBids) || maxBids < minBids))) {
      throw validationError(`rules[${position}] has an invalid bid range`);
    }
    if (!CALC_TYPES.has(raw.calcType)) throw validationError(`rules[${position}] has an invalid calcType`);
    const amountTypes = new Set(['market_value_plus_amount', 'fixed_amount']);
    const amount = amountTypes.has(raw.calcType) ? positiveInteger(raw.amount, `rules[${position}].amount`) : null;
    const percent = raw.calcType === 'market_value_plus_percent'
      ? positiveNumber(raw.percent, `rules[${position}].percent`) : null;
    return { position, minBids, maxBids, calcType: raw.calcType, amount, percent };
  }).sort((a, b) => a.minBids - b.minBids);
  for (let i = 1; i < rules.length; i += 1) {
    if (rules[i - 1].maxBids == null || rules[i].minBids <= rules[i - 1].maxBids) {
      throw validationError('bid rule ranges must not overlap');
    }
  }
  return rules.map((rule, position) => ({ ...rule, position }));
}

function validateAction(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object') throw validationError('action body is required');
  const out = {};
  const required = (key) => {
    if (!partial && (input[key] === undefined || input[key] === null || input[key] === '')) {
      throw validationError(`${key} is required`);
    }
  };
  ['type', 'leagueId', 'playerId', 'scheduleMode', 'scheduledFor', 'maxAmount'].forEach(required);
  if (input.type !== undefined) {
    if (!ACTION_TYPES.has(input.type)) throw validationError('type must be bid or buyout');
    out.type = input.type;
  }
  for (const key of ['leagueId', 'playerId', 'playerTeamId', 'marketId', 'ownerTeamId']) {
    if (input[key] !== undefined) out[key] = input[key] == null ? null : String(input[key]);
  }
  if (input.scheduleMode !== undefined) {
    if (!SCHEDULE_MODES.has(input.scheduleMode)) throw validationError('invalid scheduleMode');
    out.scheduleMode = input.scheduleMode;
  }
  if (input.scheduledFor !== undefined) out.scheduledFor = canonicalDate(input.scheduledFor);
  for (const key of ['maxAmount', 'minimumMarketValue', 'maxOverpriceAmount']) {
    if (input[key] !== undefined) out[key] = positiveInteger(input[key], key, key !== 'maxAmount');
  }
  if (input.maxOverpricePercent !== undefined) {
    out.maxOverpricePercent = positiveNumber(input.maxOverpricePercent, 'maxOverpricePercent', true);
  }
  if (input.offsetSeconds !== undefined && input.offsetSeconds !== null) {
    if (!Number.isSafeInteger(input.offsetSeconds) || input.offsetSeconds < 0) {
      throw validationError('offsetSeconds must be a non-negative integer');
    }
    out.offsetSeconds = input.offsetSeconds;
  }
  if (input.enabled !== undefined) out.enabled = Boolean(input.enabled);
  const type = out.type || input.existingType;
  if (type === 'bid' && input.rules !== undefined) out.rules = validateRules(input.rules);
  if (type === 'bid' && !partial && !input.rules) throw validationError('rules are required for bid actions');
  if (input.version !== undefined) out.version = positiveInteger(input.version, 'version');
  return out;
}

module.exports = { ACTION_TYPES, SCHEDULE_MODES, canonicalDate, validateAction, validateRules, validationError };
