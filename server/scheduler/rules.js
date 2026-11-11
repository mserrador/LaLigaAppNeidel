const CALC_TYPES = new Set([
  'market_value', 'market_value_plus_amount', 'market_value_plus_percent', 'fixed_amount',
]);

function selectBidRule(rules, numberOfBids) {
  if (!Number.isFinite(numberOfBids)) return null;
  return [...(rules || [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .find((rule) => numberOfBids >= rule.minBids &&
      (rule.maxBids == null || numberOfBids <= rule.maxBids)) || null;
}

function calculateBidAmount(rule, marketValue, maxAmount) {
  if (!rule || !CALC_TYPES.has(rule.calcType)) throw new Error('No valid bid rule applies');
  if (!Number.isInteger(marketValue) || marketValue <= 0) throw new Error('Invalid market value');
  let amount;
  if (rule.calcType === 'market_value') amount = marketValue;
  if (rule.calcType === 'market_value_plus_amount') amount = marketValue + rule.amount;
  if (rule.calcType === 'market_value_plus_percent') amount = Math.ceil(marketValue * (1 + rule.percent / 100));
  if (rule.calcType === 'fixed_amount') amount = rule.amount;
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Calculated bid is invalid');
  if (!Number.isSafeInteger(maxAmount) || amount > maxAmount) {
    const error = new Error('Calculated bid exceeds maximum');
    error.code = 'MAX_AMOUNT_EXCEEDED';
    throw error;
  }
  return amount;
}

function checkBuyoutLimits({ buyoutAmount, marketValue, maxAmount, maxOverpriceAmount, maxOverpricePercent }) {
  if (!Number.isSafeInteger(buyoutAmount) || buyoutAmount <= 0 ||
      !Number.isSafeInteger(marketValue) || marketValue <= 0) {
    return { ok: false, reason: 'invalid_live_values' };
  }
  if (buyoutAmount > maxAmount) return { ok: false, reason: 'max_amount_exceeded' };
  const overprice = buyoutAmount - marketValue;
  if (maxOverpriceAmount != null && overprice > maxOverpriceAmount) {
    return { ok: false, reason: 'max_overprice_amount_exceeded' };
  }
  const overpricePercent = (overprice / marketValue) * 100;
  if (maxOverpricePercent != null && overpricePercent > maxOverpricePercent) {
    return { ok: false, reason: 'max_overprice_percent_exceeded' };
  }
  return { ok: true, overprice, overpricePercent };
}

module.exports = { CALC_TYPES, selectBidRule, calculateBidAmount, checkBuyoutLimits };
