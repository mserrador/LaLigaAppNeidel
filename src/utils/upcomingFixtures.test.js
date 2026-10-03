import {
  buildUpcomingFixtures,
  extractMatches,
  getUpcomingFixturesForTeam,
  isMatchdayBeyondWindow,
  loadUpcomingFixtures,
} from './upcomingFixtures';

const madrid = { id: 1, name: 'Real Madrid', badgeColor: 'madrid.png' };
const sevilla = { id: 2, name: 'Sevilla FC' };
const valencia = { id: 3, name: 'Valencia CF' };
const betis = { id: 4, name: 'Real Betis' };
const now = new Date('2030-10-01T12:00:00Z').getTime();

describe('upcomingFixtures', () => {
  test('extracts nested calendar responses', () => {
    const matches = [{ id: 1 }];
    expect(extractMatches({ data: { elements: matches } })).toBe(matches);
  });

  test('returns every league match inside the next 14 days in date order', () => {
    const schedule = buildUpcomingFixtures([
      {
        week: 8,
        matches: [{ local: madrid, visitor: sevilla, matchDate: '2030-10-04T18:00:00Z' }],
      },
      {
        week: 9,
        matches: [{ local: valencia, visitor: madrid, matchDate: '2030-10-11T18:00:00Z' }],
      },
      {
        week: 10,
        matches: [{ local: madrid, visitor: betis, matchDate: '2030-10-18T18:00:00Z' }],
      },
    ], now);

    expect(getUpcomingFixturesForTeam(schedule, { id: '1' })).toEqual([
      expect.objectContaining({ opponent: sevilla, isHome: true, week: 8 }),
      expect.objectContaining({ opponent: valencia, isHome: false, week: 9 }),
    ]);
  });

  test('skips finished matches even when their date is inside the window', () => {
    const schedule = buildUpcomingFixtures([{
      week: 8,
      matches: [{
        local: madrid,
        visitor: sevilla,
        matchState: 7,
        matchDate: '2030-10-02T18:00:00Z',
      }],
    }], now);

    expect(getUpcomingFixturesForTeam(schedule, madrid)).toEqual([]);
  });

  test('falls back to normalized team names when IDs are unavailable', () => {
    const schedule = buildUpcomingFixtures([{
      week: 8,
      matches: [{ homeTeam: madrid, awayTeam: sevilla, matchDate: '2030-10-04T18:00:00Z' }],
    }], now);

    expect(getUpcomingFixturesForTeam(schedule, { name: 'Madrid' })[0].opponent).toBe(sevilla);
    expect(getUpcomingFixturesForTeam(schedule, { name: 'Sevilla' })[0].opponent).toBe(madrid);
  });

  test('detects when a complete matchday starts beyond the 14-day window', () => {
    const matches = [
      { matchDate: '2030-10-16T18:00:00Z' },
      { matchDate: '2030-10-17T18:00:00Z' },
    ];
    expect(isMatchdayBeyondWindow(matches, now)).toBe(true);
  });

  test('loads matchdays only until the 14-day window has been covered', async () => {
    const fetchMatchday = jest.fn((week) => Promise.resolve([{
      local: madrid,
      visitor: sevilla,
      matchDate: week === 8 ? '2030-10-04T18:00:00Z' : '2030-10-16T18:00:00Z',
    }]));

    const result = await loadUpcomingFixtures({ weekNumber: 8, fetchMatchday, now });

    expect(fetchMatchday).toHaveBeenCalledTimes(2);
    expect(result.matchdays.map(({ week }) => week)).toEqual([8, 9]);
    expect(getUpcomingFixturesForTeam(result.fixtures, madrid)).toHaveLength(1);
    expect(result.windowStart).toBe('2030-10-01T12:00:00.000Z');
    expect(result.windowEnd).toBe('2030-10-15T12:00:00.000Z');
  });
});
