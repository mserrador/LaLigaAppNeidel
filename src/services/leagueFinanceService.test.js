import {
  calculateLeagueFinances,
  captureClauseSnapshot,
  loadFinanceState,
  recordExactClauseInvestment,
} from './leagueFinanceService';

const standings = [
  { id: 'team-1', userId: 'user-1', manager: 'Manager 1' },
  { id: 'team-2', userId: 'user-2', manager: 'Manager 2' },
];

describe('calculateLeagueFinances', () => {
  test('applies earnings, transfers, buyouts, sales and inferred clause costs', () => {
    const activities = [
      { id: 'earn', activityTypeId: 6, amount: 5000000, user1Id: 'user-1' },
      { id: 'buy', activityTypeId: 31, amount: 20000000, user1Id: 'user-1', user2Id: 'user-2', playerId: 'p1', createdAt: '2030-01-01T10:00:00Z' },
      { id: 'duplicate-sale', activityTypeId: 33, amount: 20000000, user1Id: 'user-2', playerId: 'p1', createdAt: '2030-01-01T10:02:00Z' },
      { id: 'clause', activityTypeId: 32, amount: 10000000, user1Id: 'user-2', user2Id: 'user-1', playerId: 'p2' },
      { id: 'league-sale', activityTypeId: 33, amount: 3000000, user1Id: 'user-1', playerId: 'p3' },
    ];
    const clauseEvents = [{ source: 'snapshot', ownerTeamId: 'team-1', amount: 2000000 }];

    const finances = calculateLeagueFinances({
      standings,
      activities,
      clauseEvents,
      historyComplete: true,
    });

    expect(finances.get('team-1')).toMatchObject({
      cash: 96000000,
      minimumCash: 94000000,
      maximumCash: 98000000,
      confidence: 'medium',
    });
    expect(finances.get('team-1').breakdown).toMatchObject({
      earnings: 5000000,
      sales: 3000000,
      purchases: 20000000,
      buyoutsReceived: 10000000,
      clauseInvestmentsEstimated: 2000000,
    });
    expect(finances.get('team-2').cash).toBe(110000000);
  });

  test('prefers an official balance and reports reconciliation deviation', () => {
    const officialBalances = new Map([['team-1', 99000000]]);
    const finances = calculateLeagueFinances({
      standings,
      activities: [{ activityTypeId: 6, amount: 5000000, user1Id: 'user-1' }],
      clauseEvents: [],
      historyComplete: true,
      officialBalances,
    });

    expect(finances.get('team-1')).toMatchObject({
      cash: 99000000,
      calculatedCash: 105000000,
      cashSource: 'official',
      confidence: 'official',
      knownDeviation: 6000000,
    });
  });

  test('does not add observed clause increases to the uncertainty margin', () => {
    const finances = calculateLeagueFinances({
      standings,
      activities: [],
      clauseEvents: [{
        source: 'snapshot', confidence: 'observed', ownerTeamId: 'team-1', amount: 3000000,
      }],
      historyComplete: true,
    });

    expect(finances.get('team-1')).toMatchObject({
      cash: 97000000,
      minimumCash: 97000000,
      maximumCash: 97000000,
      knownDeviation: 0,
      confidence: 'high',
    });
    expect(finances.get('team-1').breakdown).toMatchObject({
      clauseInvestmentsObserved: 3000000,
      clauseInvestmentsEstimated: 0,
    });
  });

  test('does not invent a finite range when activity history is incomplete', () => {
    const finances = calculateLeagueFinances({
      standings,
      activities: [],
      clauseEvents: [],
      historyComplete: false,
    });
    expect(finances.get('team-1')).toMatchObject({
      confidence: 'incomplete',
      minimumCash: null,
      maximumCash: null,
      knownDeviation: null,
    });
  });
});

describe('clause finance snapshots', () => {
  beforeEach(() => localStorage.clear());

  const teamsData = (buyoutClause, marketValue, ownerTeamId = 'team-1') => new Map([[ownerTeamId, {
    teamData: { data: { players: [{
      playerTeamId: 'pt-1',
      purchasePrice: 10000000,
      buyoutClause,
      playerMaster: { id: 'p1', nickname: 'Jugador', marketValue },
    }] } },
  }]]);

  test('treats the initial clause as a free baseline and ignores market value changes', () => {
    const start = 1000000000000;
    captureClauseSnapshot('league-1', teamsData(20000000, 11000000), start);
    captureClauseSnapshot('league-1', teamsData(20000000, 9000000), start + 7 * 60 * 60 * 1000);

    expect(loadFinanceState('league-1').clauseEvents).toEqual([]);
  });

  test('infers investments only from observed clause increases', () => {
    const start = 1000000000000;
    captureClauseSnapshot('league-1', teamsData(20000000, 11000000), start);
    captureClauseSnapshot('league-1', teamsData(26000000, 15000000), start + 7 * 60 * 60 * 1000);

    expect(loadFinanceState('league-1').clauseEvents).toEqual([
      expect.objectContaining({ source: 'snapshot', confidence: 'observed', amount: 3000000 }),
    ]);
  });

  test('records exact app investments and avoids duplicating them from snapshots', () => {
    const start = Date.now() - 8 * 60 * 60 * 1000;
    captureClauseSnapshot('league-1', teamsData(10000000, 10000000), start);
    recordExactClauseInvestment({
      leagueId: 'league-1',
      teamId: 'team-1',
      playerTeamId: 'pt-1',
      playerId: 'p1',
      playerName: 'Jugador',
      amount: 3000000,
    });
    captureClauseSnapshot('league-1', teamsData(16000000, 10000000), Date.now() + 1000);

    const state = loadFinanceState('league-1');
    expect(state.clauseEvents).toHaveLength(1);
    expect(state.clauseEvents[0]).toMatchObject({ source: 'exact', amount: 3000000 });
  });

  test('uses a new baseline when a player changes owner', () => {
    const start = 1000000000000;
    captureClauseSnapshot('league-1', teamsData(20000000, 11000000), start);
    captureClauseSnapshot('league-1', teamsData(30000000, 11000000, 'team-2'), start + 7 * 60 * 60 * 1000);

    expect(loadFinanceState('league-1').clauseEvents).toEqual([]);
  });

  test('migrates old estimates while preserving exact investments', () => {
    const start = 1000000000000;
    localStorage.setItem('laliga-finance-v1:league-1', JSON.stringify({
      snapshots: [
        { capturedAt: new Date(start).toISOString(), players: [{
          playerTeamId: 'pt-1', ownerTeamId: 'team-1', buyoutClause: 20000000,
          marketValue: 11000000, purchasePrice: 10000000,
        }] },
        { capturedAt: new Date(start + 7 * 60 * 60 * 1000).toISOString(), players: [{
          playerTeamId: 'pt-1', ownerTeamId: 'team-1', buyoutClause: 20000000,
          marketValue: 9000000, purchasePrice: 10000000,
        }] },
      ],
      clauseEvents: [
        { id: 'baseline:pt-1', source: 'historical_estimate', playerTeamId: 'pt-1', ownerTeamId: 'team-1', amount: 5000000, recordedAt: new Date(start).toISOString() },
        { id: 'snapshot:old', source: 'snapshot', playerTeamId: 'pt-1', ownerTeamId: 'team-1', amount: 1000000, recordedAt: new Date(start + 7 * 60 * 60 * 1000).toISOString() },
        { id: 'exact:other', source: 'exact', playerTeamId: 'pt-2', ownerTeamId: 'team-1', amount: 2000000, clauseIncrease: 4000000, recordedAt: new Date(start).toISOString() },
      ],
    }));

    captureClauseSnapshot('league-1', teamsData(20000000, 9000000), start + 8 * 60 * 60 * 1000);

    expect(loadFinanceState('league-1').clauseEvents).toEqual([
      expect.objectContaining({ id: 'exact:other', source: 'exact', amount: 2000000 }),
    ]);
  });
});
