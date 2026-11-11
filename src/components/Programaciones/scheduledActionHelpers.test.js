import { buildRulesSummary, validateBidForm, validateBuyoutForm } from './scheduledActionHelpers';

const rules = [
  { calculationType: 'market_value', value: '' },
  { calculationType: 'market_value_plus', value: '500000' },
  { calculationType: 'fixed', value: '3000000' },
  { calculationType: 'market_value_percent', value: '12' },
];

describe('scheduled action form helpers', () => {
  test('creates a readable four-rule summary', () => {
    expect(buildRulesSummary(rules)).toBe('0 pujas: valor de mercado · 1 pujas: VM + 500.000€ · 2 pujas: 3.000.000€ · 3+ pujas: VM + 12%');
  });

  test('validates strict bid identifiers, future schedule and absolute maximum', () => {
    const result = validateBidForm({
      timingMode: 'exact', scheduledLocal: '2026-10-03T14:00', maxAmount: '8000000', rules,
    }, { playerMasterId: 'p', marketId: 'm', playerTeamId: 'pt' }, Date.parse('2026-10-03T10:00:00Z'));
    expect(result.valid).toBe(true);
    expect(result.scheduledAt).toBe('2026-10-03T12:00:00.000Z');
    expect(validateBidForm({ timingMode: 'exact', scheduledLocal: '', maxAmount: '', rules: [] }, {}, 0).valid).toBe(false);
  });

  test('rejects manual buyout before the observed lock end', () => {
    const result = validateBuyoutForm({
      timingMode: 'manual', scheduledLocal: '2026-10-03T13:00', maxAmount: '10000000',
    }, {
      playerMasterId: 'p', playerTeamId: 'pt', ownerTeamId: 't', lockEnd: '2026-10-03T12:00:00Z',
    }, Date.parse('2026-10-03T09:00:00Z'));
    expect(result.valid).toBe(false);
    expect(result.errors.schedule).toContain('desbloqueo');
  });
});
