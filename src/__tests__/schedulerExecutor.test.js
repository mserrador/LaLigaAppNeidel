const { createExecutor } = require('../../server/scheduler/executor');

const NOW = new Date('2026-10-03T08:19:55.000Z');

const bidRules = [
  { position: 0, minBids: 0, maxBids: 0, calcType: 'market_value' },
  { position: 1, minBids: 1, maxBids: 1, calcType: 'market_value_plus_amount', amount: 300117 },
  { position: 2, minBids: 2, maxBids: 2, calcType: 'market_value_plus_amount', amount: 700331 },
  { position: 3, minBids: 3, maxBids: null, calcType: 'fixed_amount', amount: 20100117 },
];

const bidAction = (overrides = {}) => ({
  id: 'action-1', type: 'bid', leagueId: 'league-1', playerId: 'player-1',
  marketId: 'market-1', playerTeamId: null, ownerTeamId: null,
  scheduleMode: 'exact', scheduledFor: NOW.toISOString(), maxAmount: 20500000,
  rules: bidRules, ...overrides,
});

const buyoutAction = (overrides = {}) => ({
  id: 'action-2', type: 'buyout', leagueId: 'league-1', playerId: 'player-2',
  playerTeamId: 'pt-2', ownerTeamId: 'rival-team', scheduleMode: 'unlock',
  scheduledFor: NOW.toISOString(), maxAmount: 70000000,
  maxOverpriceAmount: 4000000, maxOverpricePercent: null, rules: [], ...overrides,
});

const marketListing = (overrides = {}) => ({
  id: 'market-1', numberOfBids: 2, expirationDate: '2026-10-03T09:00:00.000Z',
  playerMaster: { id: 'player-1', nickname: 'Bellerín', marketValue: 19350000 },
  ...overrides,
});

const rivalPlayer = (overrides = {}) => ({
  playerTeamId: 'pt-2', buyoutClause: 68000000,
  buyoutClauseLockedEndTime: '2026-10-03T08:19:54.000Z',
  playerMaster: { id: 'player-2', nickname: 'Grimaldo', marketValue: 66800000 },
  ...overrides,
});

const createHarness = ({ market = [marketListing()], rivalPlayers = [rivalPlayer()], money = 80000000,
  teamValue = 100000000, makeBid, payBuyout } = {}) => {
  const attempts = [];
  const statuses = [];
  const repository = {
    createAttempt: jest.fn(() => attempts.push({}) - 1),
    finishAttempt: jest.fn(),
    setStatus: jest.fn((id, status, details = {}) => {
      const result = { id, status, ...details };
      statuses.push(result);
      return result;
    }),
    executing: jest.fn(() => []),
  };
  const client = {
    getCurrentUser: jest.fn(async () => ({ id: 'user-1' })),
    getStandings: jest.fn(async () => [
      { id: 'own-team', userId: 'user-1', teamValue },
      { id: 'rival-team', userId: 'user-2', name: 'Rival' },
    ]),
    getMarket: jest.fn(async () => market),
    getTeamData: jest.fn(async (leagueId, teamId) => ({
      players: teamId === 'rival-team' ? rivalPlayers : [],
    })),
    getTeamMoney: jest.fn(async () => ({ teamMoney: money })),
    makeBid: makeBid || jest.fn(async () => ({ id: 'bid-1' })),
    payBuyout: payBuyout || jest.fn(async () => ({ success: true })),
  };
  return {
    client, repository, statuses,
    executor: createExecutor({ repository, client, clock: () => new Date(NOW), logger: { warn: jest.fn() } }),
  };
};

describe('scheduled action executor', () => {
  test('uses the live market value and live bid count', async () => {
    const harness = createHarness();
    const result = await harness.executor.execute(bidAction());
    expect(result.status).toBe('executed');
    expect(harness.client.makeBid).toHaveBeenCalledWith('league-1', 'market-1', 20050331);
    expect(result.snapshot).toMatchObject({ marketValue: 19350000, numberOfBids: 2, amount: 20050331 });
  });

  test('does not bid when calculated amount exceeds the authorized maximum', async () => {
    const harness = createHarness({ market: [marketListing({ numberOfBids: 3 })] });
    const result = await harness.executor.execute(bidAction({ maxAmount: 20000000 }));
    expect(result).toMatchObject({ status: 'skipped' });
    expect(harness.client.makeBid).not.toHaveBeenCalled();
  });

  test.each([
    ['insufficient capacity', { money: 1000000, teamValue: 0 }, 'insufficient_capacity'],
    ['listing disappeared', { market: [] }, 'listing_not_found'],
    ['listing expired', { market: [marketListing({ expirationDate: '2026-10-03T08:00:00.000Z' })] }, 'listing_expired'],
    ['own bid exists', { market: [marketListing({ bid: { id: 'mine', money: 19000000, status: 'pending' } })] }, 'own_bid_exists'],
  ])('safely skips when %s', async (label, options, reason) => {
    const harness = createHarness(options);
    const result = await harness.executor.execute(bidAction());
    expect(result.status).toBe('skipped');
    expect(result.result.reason).toBe(reason);
    expect(harness.client.makeBid).not.toHaveBeenCalled();
  });

  test('never retries an ambiguous bid mutation', async () => {
    const timeout = Object.assign(new Error('timeout'), { code: 'UPSTREAM_TIMEOUT', status: 502 });
    const makeBid = jest.fn(async () => { throw timeout; });
    const harness = createHarness({ makeBid });
    const result = await harness.executor.execute(bidAction());
    expect(result.status).toBe('uncertain');
    expect(makeBid).toHaveBeenCalledTimes(1);
  });

  test('reschedules while the buyout lock is still active', async () => {
    const harness = createHarness({ rivalPlayers: [rivalPlayer({
      buyoutClauseLockedEndTime: '2026-10-03T09:00:00.000Z',
    })] });
    const result = await harness.executor.execute(buyoutAction());
    expect(result).toMatchObject({ status: 'scheduled', result: { reason: 'lock_moved' } });
    expect(harness.client.payBuyout).not.toHaveBeenCalled();
  });

  test('uses the live clause and market value when limits allow the buyout', async () => {
    const harness = createHarness();
    const result = await harness.executor.execute(buyoutAction());
    expect(result.status).toBe('executed');
    expect(harness.client.payBuyout).toHaveBeenCalledWith('league-1', 'pt-2', 68000000);
    expect(result.snapshot).toMatchObject({ buyoutAmount: 68000000, marketValue: 66800000, overprice: 1200000 });
  });

  test.each([
    ['absolute maximum', buyoutAction({ maxAmount: 67000000 }), 'max_amount_exceeded'],
    ['overprice maximum', buyoutAction({ maxOverpriceAmount: 1000000 }), 'max_overprice_amount_exceeded'],
  ])('rejects a buyout over the %s', async (label, action, reason) => {
    const harness = createHarness();
    const result = await harness.executor.execute(action);
    expect(result.status).toBe('skipped');
    expect(result.result.reason).toBe(reason);
    expect(harness.client.payBuyout).not.toHaveBeenCalled();
  });

  test('does not execute after an ownership change', async () => {
    const harness = createHarness();
    harness.client.getStandings.mockResolvedValue([
      { id: 'own-team', userId: 'user-1', teamValue: 100000000 },
      { id: 'new-rival', userId: 'user-3', name: 'Nuevo rival' },
    ]);
    harness.client.getTeamData.mockImplementation(async (leagueId, teamId) => ({
      players: teamId === 'new-rival' ? [rivalPlayer()] : [],
    }));
    const result = await harness.executor.execute(buyoutAction());
    expect(result.status).toBe('skipped');
    expect(result.result.reason).toBe('ownership_changed');
  });

  test('does not execute a buyout with insufficient cash', async () => {
    const harness = createHarness({ money: 50000000 });
    const result = await harness.executor.execute(buyoutAction());
    expect(result.status).toBe('skipped');
    expect(result.result.reason).toBe('insufficient_cash');
  });

  test('reconciles a buyout timeout without sending a second payment', async () => {
    let mutationStarted = false;
    const timeout = Object.assign(new Error('timeout'), { code: 'UPSTREAM_TIMEOUT', status: 502 });
    const payBuyout = jest.fn(async () => { mutationStarted = true; throw timeout; });
    const harness = createHarness({ payBuyout });
    harness.client.getTeamData.mockImplementation(async (leagueId, teamId) => ({
      players: mutationStarted
        ? (teamId === 'own-team' ? [rivalPlayer()] : [])
        : (teamId === 'rival-team' ? [rivalPlayer()] : []),
    }));

    const result = await harness.executor.execute(buyoutAction());
    expect(result.status).toBe('executed');
    expect(result.result).toMatchObject({ executed: true, evidence: 'player_in_own_roster' });
    expect(payBuyout).toHaveBeenCalledTimes(1);
  });
});
