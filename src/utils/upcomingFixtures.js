import { normalizeTeamName } from './playerNameMatcher';

export const FIXTURE_WINDOW_DAYS = 14;

const LIVE_MATCH_STATES = new Set([2, 4]);
const FINISHED_MATCH_STATE = 7;
const MATCH_TIME_BUFFER_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const extractMatches = (response) => {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.data?.elements)) return response.data.elements;
  if (Array.isArray(response?.elements)) return response.elements;
  if (Array.isArray(response?.matches)) return response.matches;
  return [];
};

const getMatchTeam = (match, side) => {
  const isHome = side === 'home';
  const team = isHome
    ? (match.homeTeam || match.local)
    : (match.awayTeam || match.visitor);
  const fallbackId = isHome ? match.localId : match.visitorId;

  if (team) return team;
  return fallbackId == null ? null : { id: fallbackId };
};

const getTeamId = (team) => team?.id ?? team?.teamId ?? null;
const getTeamName = (team) => team?.name || team?.shortName || team?.teamName || null;

const getMatchTime = (match) => {
  const value = match.matchDate || match.date || match.kickoff;
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

const isMatchInWindow = (match, now, cutoff) => {
  if (match.matchState === FINISHED_MATCH_STATE) return false;
  if (LIVE_MATCH_STATES.has(match.matchState)) return true;

  const time = getMatchTime(match);
  if (time == null) return true;
  return time >= now - MATCH_TIME_BUFFER_MS && time <= cutoff;
};

const fixtureSortValue = (fixture) => {
  const time = fixture.date ? new Date(fixture.date).getTime() : Number.NaN;
  return Number.isNaN(time) ? fixture.week * DAY_MS : time;
};

const addFixture = (schedule, team, fixture) => {
  const id = getTeamId(team);
  const normalizedName = normalizeTeamName(getTeamName(team));
  const addTo = (lookup, key) => {
    if (!key) return;
    if (!lookup[key]) lookup[key] = [];
    lookup[key].push(fixture);
  };

  if (id != null) addTo(schedule.byId, String(id));
  if (normalizedName) addTo(schedule.byName, normalizedName);
};

export const buildUpcomingFixtures = (
  matchdays,
  now = Date.now(),
  windowDays = FIXTURE_WINDOW_DAYS
) => {
  const schedule = { byId: {}, byName: {} };
  const cutoff = now + windowDays * DAY_MS;

  [...matchdays]
    .sort((a, b) => a.week - b.week)
    .forEach(({ week, matches }) => {
      extractMatches(matches)
        .filter((match) => isMatchInWindow(match, now, cutoff))
        .forEach((match) => {
          const homeTeam = getMatchTeam(match, 'home');
          const awayTeam = getMatchTeam(match, 'away');
          if (!homeTeam || !awayTeam) return;

          const date = match.matchDate || match.date || match.kickoff || null;
          addFixture(schedule, homeTeam, { opponent: awayTeam, isHome: true, week, date });
          addFixture(schedule, awayTeam, { opponent: homeTeam, isHome: false, week, date });
        });
    });

  [...Object.values(schedule.byId), ...Object.values(schedule.byName)]
    .forEach((fixtures) => fixtures.sort((a, b) => fixtureSortValue(a) - fixtureSortValue(b)));

  return schedule;
};

export const getUpcomingFixturesForTeam = (schedule, team) => {
  if (!schedule || !team) return [];

  const id = getTeamId(team);
  if (id != null && schedule.byId?.[String(id)]) return schedule.byId[String(id)];

  const normalizedName = normalizeTeamName(getTeamName(team));
  return normalizedName ? schedule.byName?.[normalizedName] || [] : [];
};

export const isMatchdayBeyondWindow = (
  matches,
  now = Date.now(),
  windowDays = FIXTURE_WINDOW_DAYS
) => {
  const times = extractMatches(matches)
    .map(getMatchTime)
    .filter((time) => time != null);

  return times.length > 0 && times.every((time) => time > now + windowDays * DAY_MS);
};

export const loadUpcomingFixtures = async ({
  weekNumber,
  fetchMatchday,
  now = Date.now(),
  windowDays = FIXTURE_WINDOW_DAYS,
  maxWeeks = 6,
  lastWeek = 38,
  onError,
}) => {
  const matchdays = [];
  if (!weekNumber || typeof fetchMatchday !== 'function') {
    return {
      fixtures: buildUpcomingFixtures(matchdays, now, windowDays),
      matchdays,
      windowStart: new Date(now).toISOString(),
      windowEnd: new Date(now + windowDays * DAY_MS).toISOString(),
    };
  }

  const finalWeek = Math.min(weekNumber + maxWeeks - 1, lastWeek);
  for (let week = weekNumber; week <= finalWeek; week += 1) {
    try {
      const matches = await fetchMatchday(week);
      matchdays.push({ week, matches });
      if (isMatchdayBeyondWindow(matches, now, windowDays)) break;
    } catch (error) {
      onError?.(error, week);
    }
  }

  return {
    fixtures: buildUpcomingFixtures(matchdays, now, windowDays),
    matchdays,
    windowStart: new Date(now).toISOString(),
    windowEnd: new Date(now + windowDays * DAY_MS).toISOString(),
  };
};
