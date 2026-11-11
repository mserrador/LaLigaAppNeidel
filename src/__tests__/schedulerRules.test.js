const {
  selectBidRule, calculateBidAmount, checkBuyoutLimits, validateAction,
} = require('../../server/scheduler');

const rules = [
  { position: 0, minBids: 0, maxBids: 0, calcType: 'market_value' },
  { position: 1, minBids: 1, maxBids: 1, calcType: 'market_value_plus_amount', amount: 100 },
  { position: 2, minBids: 2, maxBids: 2, calcType: 'market_value_plus_percent', percent: 10 },
  { position: 3, minBids: 3, maxBids: null, calcType: 'fixed_amount', amount: 1800 },
];

describe('scheduler bid rules', () => {
  test.each([[0, 1000], [1, 1100], [2, 1100], [3, 1800], [4, 1800], [10, 1800]])('selects and calculates bucket %s', (bids, expected) => {
    expect(calculateBidAmount(selectBidRule(rules, bids), 1000, 2000)).toBe(expected);
  });

  test('strictly aborts instead of clamping to max', () => {
    expect(() => calculateBidAmount(rules[3], 1000, 1700)).toThrow(/exceeds maximum/);
  });

  test('checks total, absolute overprice and percentage limits', () => {
    expect(checkBuyoutLimits({ buyoutAmount: 1300, marketValue: 1000, maxAmount: 1400,
      maxOverpriceAmount: 400, maxOverpricePercent: 35 }).ok).toBe(true);
    expect(checkBuyoutLimits({ buyoutAmount: 1500, marketValue: 1000, maxAmount: 1400,
      maxOverpriceAmount: 600, maxOverpricePercent: 60 }).reason).toBe('max_amount_exceeded');
    expect(checkBuyoutLimits({ buyoutAmount: 1300, marketValue: 1000, maxAmount: 1400,
      maxOverpriceAmount: 200, maxOverpricePercent: 35 }).reason).toBe('max_overprice_amount_exceeded');
    expect(checkBuyoutLimits({ buyoutAmount: 1300, marketValue: 1000, maxAmount: 1400,
      maxOverpriceAmount: 400, maxOverpricePercent: 20 }).reason).toBe('max_overprice_percent_exceeded');
  });

  test('validates exactly four non-overlapping generic ranges and Madrid local dates', () => {
    const action = validateAction({ type: 'bid', leagueId: 'l', playerId: 'p', marketId: 'm',
      scheduleMode: 'exact', scheduledFor: '2026-10-03 12:00', maxAmount: 2000, rules });
    expect(action.rules).toHaveLength(4);
    expect(action.scheduledFor).toBe('2026-10-03T10:00:00.000Z');
    expect(validateAction({ type: 'buyout', leagueId: 'l', playerId: 'p', scheduleMode: 'unlock',
      scheduledFor: '2026-10-03T10:00:00Z', maxAmount: 1 })).toMatchObject({ maxAmount: 1 });
  });
});
