import { fantasyAPI } from '../services/api';
import {
  buildLeagueExport,
  createLeagueExportFilename,
} from './exportLeagueData';

jest.mock('../services/api', () => ({
  fantasyAPI: {
    getLeagueRanking: jest.fn(),
    getMarket: jest.fn(),
    getLeagues: jest.fn(),
    getCurrentWeek: jest.fn(),
    getMatchday: jest.fn(),
    getTeamData: jest.fn(),
    getTeamMoney: jest.fn(),
    getCurrentLineup: jest.fn(),
    getPlayerOffer: jest.fn(),
    getLeagueActivity: jest.fn(),
  },
}));

jest.mock('../services/marketTrendsService', () => ({
  __esModule: true,
  default: {
    initialize: jest.fn(),
    resolveTrendForPlayer: jest.fn(),
  },
}));

const queryClient = {
  fetchQuery: ({ queryFn }) => queryFn(),
};

const standings = [
  {
    id: 'team-1',
    position: 1,
    manager: 'Mi manager',
    userId: 'user-1',
    teamValue: 1000000,
    team: { id: 'team-1', manager: { id: 'user-1', managerName: 'Mi manager' } },
  },
  {
    id: 'team-2',
    position: 2,
    manager: 'Otro manager',
    team: { id: 'team-2', manager: { id: 'user-2', managerName: 'Otro manager' } },
  },
];

const market = [{
  id: 'market-1',
  discr: 'marketPlayerTeam',
  numberOfOffers: 1,
  salePrice: 123,
  sellerTeam: { id: 'team-1' },
  playerTeam: { playerTeamId: 'player-team-1' },
  playerMaster: { id: 'player-1', nickname: 'Jugador', marketValue: 100, team: { id: 'club-1' } },
}];

describe('buildLeagueExport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    fantasyAPI.getLeagueRanking.mockResolvedValue({ data: standings, config: { headers: { Authorization: 'Bearer secret' } } });
    fantasyAPI.getMarket.mockResolvedValue({ data: market });
    fantasyAPI.getLeagues.mockResolvedValue({ data: [{
      id: 'league-1',
      leagueApiId: 12345,
      name: 'Mi liga',
      token: 'private-league-token',
    }] });
    fantasyAPI.getCurrentWeek.mockResolvedValue({ data: { weekNumber: 5 } });
    fantasyAPI.getMatchday.mockImplementation((week) => {
      const daysAhead = week === 5 ? 3 : (week === 6 ? 10 : 17);
      return Promise.resolve({ data: [{
        local: { id: 'club-1', name: 'Club Uno' },
        visitor: { id: 'club-2', name: 'Club Dos' },
        matchDate: new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString(),
      }] });
    });
    fantasyAPI.getTeamMoney.mockResolvedValue({ data: { teamMoney: 5000000 } });
    fantasyAPI.getCurrentLineup.mockResolvedValue({ data: {
      formation: {
        tacticalFormation: [4, 5, 1],
        goalkeeper: [{ playerMaster: { id: 'player-1', nickname: 'Jugador' } }],
        defender: [], midfield: [], striker: [],
      },
    } });
    fantasyAPI.getPlayerOffer.mockResolvedValue({ data: [{
      id: 'offer-1', money: 120, status: 'pending', expirationDate: '2026-09-17T12:00:00Z', bidderTeam: { id: 'team-2' },
    }] });
    fantasyAPI.getLeagueActivity.mockResolvedValue({ data: [] });
    fantasyAPI.getTeamData.mockImplementation((_leagueId, teamId) => Promise.resolve({
      data: {
        id: teamId,
        players: [{
          playerTeamId: `pt-${teamId}`,
          buyoutClause: 200,
          playerMaster: {
            id: `player-${teamId}`,
            nickname: `Jugador ${teamId}`,
            positionId: 3,
            marketValue: 100,
            team: { id: teamId === 'team-1' ? 'club-1' : 'club-2' },
            lastStats: [{ weekNumber: 5, totalPoints: 4 }],
          },
        }],
      },
      config: { headers: { Authorization: 'Bearer secret' } },
    }));
  });

  test('exporta cuerpos completos bajo raw, datos normalizados y excluye secretos', async () => {
    const result = await buildLeagueExport({
      leagueId: 'league-1',
      leagueName: 'Mi liga',
      user: { userId: 'user-1', managerName: 'Mi manager' },
      queryClient,
    });

    expect(result.raw.league).toEqual({ id: 'league-1', leagueApiId: 12345, name: 'Mi liga' });
    expect(result.raw.standings).toEqual(standings);
    expect(result.raw.teams).toHaveLength(2);
    expect(result.analysisData.me).toMatchObject({ teamId: 'team-1', cash: 5000000, playersCount: 1 });
    expect(result.analysisData.receivedOffers).toContainEqual(expect.objectContaining({
      offerAmount: 120,
      playerId: 'player-1',
      playerTeamId: 'player-team-1',
    }));
    expect(result.analysisData.lineup).toMatchObject({ formation: '4-5-1' });
    expect(result.analysisData.fixtureWindow).toMatchObject({ competition: 'LaLiga', days: 14 });
    expect(result.analysisData.financeInfo).toMatchObject({
      initialCash: 100000000,
      historyComplete: true,
    });
    expect(result.analysisData.managers[0]).toMatchObject({
      cash: 5000000,
      cashSource: 'official',
      cashConfidence: 'official',
    });
    expect(result.analysisData.managers[0].financeBreakdown).toEqual(expect.objectContaining({
      initialCash: 100000000,
    }));
    expect(result.analysisData.players.find((player) => player.ownerTeamId === 'team-1').upcomingFixtures)
      .toHaveLength(2);
    expect(result.analysisData.market[0].upcomingFixtures).toHaveLength(2);
    expect(result.raw.calendar.map(({ week }) => week)).toEqual([5, 6, 7]);
    expect(result.exportInfo.leagueApiId).toBe(12345);
    expect(JSON.stringify(result)).not.toContain('Bearer secret');
    expect(JSON.stringify(result)).not.toContain('private-league-token');
  });

  test('registra los equipos fallidos y mantiene los que sí se pudieron obtener', async () => {
    fantasyAPI.getTeamData.mockImplementation((_leagueId, teamId) => {
      if (teamId === 'team-2') return Promise.reject(new Error('No autorizado para el equipo'));
      return Promise.resolve({ data: { id: teamId, players: [] } });
    });

    const result = await buildLeagueExport({
      leagueId: 'league-1',
      user: { userId: 'user-1' },
      queryClient,
    });

    expect(result.raw.teams).toEqual([expect.objectContaining({ teamId: 'team-1' })]);
    expect(result.errors).toContainEqual(expect.objectContaining({
      type: 'team', teamId: 'team-2', managerName: 'Otro manager', error: 'No autorizado para el equipo',
    }));
  });
});

describe('createLeagueExportFilename', () => {
  test('usa el formato de fecha solicitado', () => {
    expect(createLeagueExportFilename(8523556, new Date(2026, 8, 16, 15, 30)))
      .toBe('laliga-fantasy-8523556-2026-09-16_15-30.json');
  });
});
