import { fantasyAPI } from './api';
import { extractArray, readTeamMoney } from '../utils/helpers';
import { extractTeamPlayers, fetchAllTeamsData } from '../utils/fetchAllTeamsData';

export const INITIAL_CASH = 100000000;

const STORAGE_PREFIX = 'laliga-finance-v1';
const MAX_ACTIVITY_PAGES = 100;
const PAGE_DELAY_MS = 300;
const MAX_SNAPSHOTS = 32;
const SNAPSHOT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CLAUSE_CALCULATION_VERSION = 2;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const finiteAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.abs(amount) : null;
};
const getTeamId = (entry) => entry?.id || entry?.team?.id || entry?.teamId || null;
const getManagerId = (entry) => entry?.userId || entry?.managerId || entry?.team?.manager?.id || entry?.team?.userId || null;
const getManagerName = (entry) => (
  (typeof entry?.manager === 'string' && entry.manager)
  || entry?.managerName
  || entry?.team?.manager?.managerName
  || entry?.team?.manager?.name
  || null
);
const getCurrentUserId = (user) => user?.userId || user?.id || user?.sub || user?.oid || null;
const getPlayerId = (item) => item?.playerMasterId ?? item?.playerId ?? item?.playerMaster?.id ?? item?.player?.id ?? null;

const storageKey = (leagueId) => `${STORAGE_PREFIX}:${leagueId}`;
const emptyState = () => ({
  activities: [],
  historyComplete: false,
  snapshots: [],
  clauseEvents: [],
  seenPlayerTeamIds: [],
  clauseCalculationVersion: CLAUSE_CALCULATION_VERSION,
});

export const loadFinanceState = (leagueId) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(leagueId)) || 'null');
    if (!parsed || typeof parsed !== 'object') return emptyState();
    return {
      ...emptyState(),
      ...parsed,
      clauseCalculationVersion: parsed.clauseCalculationVersion ?? 1,
    };
  } catch (_error) {
    return emptyState();
  }
};

const saveFinanceState = (leagueId, state) => {
  try {
    localStorage.setItem(storageKey(leagueId), JSON.stringify(state));
  } catch (_error) {
    // Calculations remain available in-memory when storage is unavailable.
  }
};

const activityKey = (item) => String(item?.id || [
  item?.activityTypeId,
  item?.createdAt || item?.timestamp,
  item?.user1Id,
  item?.user2Id,
  getPlayerId(item),
  item?.amount,
].join(':'));

const compactActivity = (item) => ({
  id: item?.id ?? null,
  activityTypeId: item?.activityTypeId ?? null,
  amount: item?.amount ?? null,
  createdAt: item?.createdAt || item?.timestamp || null,
  user1Id: item?.user1Id ?? null,
  user1Name: item?.user1Name ?? null,
  user2Id: item?.user2Id ?? null,
  user2Name: item?.user2Name ?? null,
  playerId: getPlayerId(item),
  playerName: item?.playerName || item?.playerMaster?.nickname || item?.playerMaster?.name || null,
  description: item?.description ?? null,
});

const extractActivityItems = (response) => {
  const direct = extractArray(response);
  return direct.length > 0 ? direct : extractArray(response?.data);
};

export const fetchCompleteActivity = async (leagueId, queryClient) => {
  const activities = [];
  const seen = new Set();
  let historyComplete = false;
  let pagesLoaded = 0;

  for (let page = 0; page < MAX_ACTIVITY_PAGES; page += 1) {
    if (page > 0) await sleep(PAGE_DELAY_MS);
    let response;
    try {
      response = await queryClient.fetchQuery({
        queryKey: ['leagueFinanceActivity', leagueId, page],
        queryFn: () => fantasyAPI.getLeagueActivity(leagueId, page),
        staleTime: 60 * 1000,
        gcTime: 15 * 60 * 1000,
      });
    } catch (_error) {
      break;
    }
    const pageItems = extractActivityItems(response);
    pagesLoaded += 1;
    if (pageItems.length === 0) {
      historyComplete = true;
      break;
    }

    let newItems = 0;
    pageItems.forEach((item) => {
      const key = activityKey(item);
      if (seen.has(key)) return;
      seen.add(key);
      activities.push(compactActivity(item));
      newItems += 1;
    });
    if (newItems === 0) break;
  }

  return { activities, historyComplete, pagesLoaded };
};

const createSnapshot = (teamsData, capturedAt) => ({
  capturedAt,
  players: Array.from(teamsData.entries()).flatMap(([teamId, { teamData }]) => (
    extractTeamPlayers(teamData).flatMap((playerTeam) => {
      const player = playerTeam?.playerMaster;
      const playerTeamId = playerTeam?.playerTeamId || playerTeam?.id;
      if (!player || !playerTeamId || !playerTeam.buyoutClause) return [];
      return [{
        playerTeamId: String(playerTeamId),
        playerId: player.id ?? null,
        playerName: player.nickname || player.name || null,
        ownerTeamId: String(teamId),
        buyoutClause: Number(playerTeam.buyoutClause) || 0,
        marketValue: Number(player.marketValue) || 0,
        purchasePrice: Number(playerTeam.purchasePrice) || 0,
      }];
    })
  )),
});

const rebuildObservedClauseEvents = (state) => {
  const canPreserveObservedHistory = state.clauseCalculationVersion === CLAUSE_CALCULATION_VERSION;
  const exactEvents = state.clauseEvents.filter((event) => event.source === 'exact');
  const firstSnapshotAt = state.snapshots[0]?.capturedAt;
  const observedEvents = canPreserveObservedHistory && firstSnapshotAt
    ? state.clauseEvents.filter((event) => (
      event.source === 'snapshot'
      && new Date(event.recordedAt).getTime() <= new Date(firstSnapshotAt).getTime()
    ))
    : [];

  for (let index = 1; index < state.snapshots.length; index += 1) {
    const previous = state.snapshots[index - 1];
    const current = state.snapshots[index];
    const previousByPlayerTeam = new Map(
      (previous.players || []).map((player) => [player.playerTeamId, player])
    );
    const previousAt = new Date(previous.capturedAt).getTime();
    const currentAt = new Date(current.capturedAt).getTime();

    (current.players || []).forEach((player) => {
      const before = previousByPlayerTeam.get(player.playerTeamId);
      if (!before || before.ownerTeamId !== player.ownerTeamId) return;

      const clauseIncrease = Math.max(0, player.buyoutClause - before.buyoutClause);
      if (!clauseIncrease) return;

      const exactIncrease = exactEvents.reduce((sum, event) => {
        if (event.playerTeamId !== player.playerTeamId || event.ownerTeamId !== player.ownerTeamId) return sum;
        const recordedAt = new Date(event.recordedAt).getTime();
        if (!Number.isFinite(recordedAt) || recordedAt <= previousAt || recordedAt > currentAt) return sum;
        return sum + (finiteAmount(event.clauseIncrease) || (finiteAmount(event.amount) || 0) * 2);
      }, 0);
      const unexplainedIncrease = Math.max(0, clauseIncrease - exactIncrease);
      if (!unexplainedIncrease) return;

      observedEvents.push({
        id: `snapshot:${player.playerTeamId}:${current.capturedAt}`,
        source: 'snapshot',
        confidence: 'observed',
        playerTeamId: player.playerTeamId,
        playerId: player.playerId,
        playerName: player.playerName,
        ownerTeamId: player.ownerTeamId,
        amount: Math.round(unexplainedIncrease / 2),
        clauseIncrease: unexplainedIncrease,
        recordedAt: current.capturedAt,
      });
    });
  }

  state.clauseEvents = [...exactEvents, ...observedEvents]
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
  state.clauseCalculationVersion = CLAUSE_CALCULATION_VERSION;
};

export const captureClauseSnapshot = (leagueId, teamsData, now = Date.now()) => {
  const state = loadFinanceState(leagueId);
  const needsMigration = state.clauseCalculationVersion !== CLAUSE_CALCULATION_VERSION;
  if (needsMigration) rebuildObservedClauseEvents(state);
  const previous = state.snapshots[state.snapshots.length - 1] || null;
  if (previous && now - new Date(previous.capturedAt).getTime() < SNAPSHOT_INTERVAL_MS) {
    if (needsMigration) saveFinanceState(leagueId, state);
    return state;
  }

  const current = createSnapshot(teamsData, new Date(now).toISOString());
  const everSeen = new Set([
    ...state.seenPlayerTeamIds,
    ...state.snapshots.flatMap((snapshot) => snapshot.players.map((player) => player.playerTeamId)),
  ]);

  state.snapshots = [...state.snapshots, current].slice(-MAX_SNAPSHOTS);
  rebuildObservedClauseEvents(state);
  current.players.forEach((player) => everSeen.add(player.playerTeamId));
  state.seenPlayerTeamIds = Array.from(everSeen);
  saveFinanceState(leagueId, state);
  return state;
};

export const recordExactClauseInvestment = ({
  leagueId,
  teamId,
  playerTeamId,
  playerId,
  playerName,
  amount,
}) => {
  const value = finiteAmount(amount);
  if (!leagueId || !teamId || !playerTeamId || !value) return;
  const state = loadFinanceState(leagueId);
  const recordedAt = new Date().toISOString();
  state.clauseEvents.push({
    id: `exact:${playerTeamId}:${recordedAt}`,
    source: 'exact',
    confidence: 'exact',
    playerTeamId: String(playerTeamId),
    playerId: playerId ?? null,
    playerName: playerName || null,
    ownerTeamId: String(teamId),
    amount: value,
    clauseIncrease: value * 2,
    recordedAt,
  });
  saveFinanceState(leagueId, state);
};

const mergeActivities = (leagueId, state, fetched) => {
  const merged = new Map(state.activities.map((item) => [activityKey(item), item]));
  fetched.activities.forEach((item) => merged.set(activityKey(item), item));
  state.activities = Array.from(merged.values()).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  state.historyComplete = state.historyComplete || fetched.historyComplete;
  saveFinanceState(leagueId, state);
  return state;
};

const buildManagerLookups = (standings) => {
  const byId = new Map();
  const byName = new Map();
  extractArray(standings).forEach((entry) => {
    const teamId = getTeamId(entry);
    const managerId = getManagerId(entry);
    const managerName = getManagerName(entry);
    if (teamId == null) return;
    if (managerId != null) byId.set(String(managerId), String(teamId));
    if (managerName) byName.set(managerName.trim().toLowerCase(), String(teamId));
  });
  return { byId, byName };
};

const resolveParticipantTeam = (item, participant, lookups) => {
  const id = item?.[`user${participant}Id`];
  const name = item?.[`user${participant}Name`];
  if (id != null && lookups.byId.has(String(id))) return lookups.byId.get(String(id));
  return name ? lookups.byName.get(name.trim().toLowerCase()) || null : null;
};

const isDuplicateSale = (activity, activities) => {
  if (activity.activityTypeId !== 33) return false;
  const activityTime = new Date(activity.createdAt).getTime();
  return activities.some((candidate) => {
    if (![1, 31, 32].includes(candidate.activityTypeId)) return false;
    if (String(candidate.playerId) !== String(activity.playerId)) return false;
    if (finiteAmount(candidate.amount) !== finiteAmount(activity.amount)) return false;
    const candidateTime = new Date(candidate.createdAt).getTime();
    return Number.isFinite(activityTime) && Number.isFinite(candidateTime)
      && Math.abs(candidateTime - activityTime) <= 5 * 60 * 1000;
  });
};

const emptyBreakdown = () => ({
  initialCash: INITIAL_CASH,
  earnings: 0,
  sales: 0,
  purchases: 0,
  buyoutsPaid: 0,
  buyoutsReceived: 0,
  clauseInvestmentsExact: 0,
  clauseInvestmentsObserved: 0,
  clauseInvestmentsEstimated: 0,
  unknownMovements: 0,
  unexplainedAdjustment: 0,
});

const applyDelta = (finances, teamId, field, amount, sign) => {
  if (!teamId || !finances.has(String(teamId)) || !amount) return;
  const finance = finances.get(String(teamId));
  finance.breakdown[field] += amount;
  finance.calculatedCash += sign * amount;
};

export const calculateLeagueFinances = ({ standings, activities, clauseEvents, historyComplete, officialBalances = new Map() }) => {
  const lookups = buildManagerLookups(standings);
  const finances = new Map(extractArray(standings).flatMap((entry) => {
    const rawTeamId = getTeamId(entry);
    if (rawTeamId == null) return [];
    const teamId = String(rawTeamId);
    return [[teamId, {
      teamId,
      managerId: getManagerId(entry),
      managerName: getManagerName(entry),
      calculatedCash: INITIAL_CASH,
      cash: INITIAL_CASH,
      minimumCash: null,
      maximumCash: null,
      knownDeviation: null,
      cashSource: 'calculated',
      confidence: 'incomplete',
      breakdown: emptyBreakdown(),
    }]];
  }));

  const uniqueActivities = Array.from(new Map(activities.map((item) => [activityKey(item), item])).values());
  uniqueActivities.forEach((item) => {
    const amount = finiteAmount(item.amount);
    if (!amount || isDuplicateSale(item, uniqueActivities)) return;
    const user1Team = resolveParticipantTeam(item, 1, lookups);
    const user2Team = resolveParticipantTeam(item, 2, lookups);
    const type = item.activityTypeId;

    if (type === 6 || (!item.playerId && !item.playerName)) {
      applyDelta(finances, user1Team, 'earnings', amount, 1);
    } else if ([1, 31].includes(type)) {
      applyDelta(finances, user1Team, 'purchases', amount, -1);
      applyDelta(finances, user2Team, 'sales', amount, 1);
    } else if (type === 32) {
      applyDelta(finances, user1Team, 'buyoutsPaid', amount, -1);
      applyDelta(finances, user2Team, 'buyoutsReceived', amount, 1);
    } else if (type === 33) {
      applyDelta(finances, user1Team, 'sales', amount, 1);
    } else if (![4, 7, 9].includes(type)) {
      const teamId = user1Team || user2Team;
      if (teamId && finances.has(teamId)) finances.get(teamId).breakdown.unknownMovements += amount;
    }
  });

  clauseEvents.forEach((event) => {
    const amount = finiteAmount(event.amount);
    const teamId = event.ownerTeamId != null ? String(event.ownerTeamId) : null;
    if (!amount || !teamId || !finances.has(teamId)) return;
    const exact = event.source === 'exact';
    const observed = event.confidence === 'observed';
    const field = exact
      ? 'clauseInvestmentsExact'
      : (observed ? 'clauseInvestmentsObserved' : 'clauseInvestmentsEstimated');
    applyDelta(finances, teamId, field, amount, -1);
  });

  finances.forEach((finance, teamId) => {
    const uncertainty = finance.breakdown.clauseInvestmentsEstimated + finance.breakdown.unknownMovements;
    const officialCash = officialBalances.get(teamId);

    if (typeof officialCash === 'number') {
      finance.cash = officialCash;
      finance.cashSource = 'official';
      finance.confidence = 'official';
      finance.minimumCash = officialCash;
      finance.maximumCash = officialCash;
      finance.knownDeviation = Math.abs(officialCash - finance.calculatedCash);
      finance.breakdown.unexplainedAdjustment = officialCash - finance.calculatedCash;
      return;
    }

    finance.cash = finance.calculatedCash;
    finance.knownDeviation = historyComplete ? uncertainty : null;
    if (historyComplete) {
      finance.minimumCash = finance.calculatedCash - uncertainty;
      finance.maximumCash = finance.calculatedCash + uncertainty;
      const ratio = uncertainty / INITIAL_CASH;
      finance.confidence = ratio <= 0.01 ? 'high' : (ratio <= 0.05 ? 'medium' : 'low');
    }
  });

  return finances;
};

const fetchOfficialBalances = async (standings, user) => {
  const entries = extractArray(standings);
  const currentUserId = getCurrentUserId(user);
  const currentEntry = entries.find((entry) => String(getManagerId(entry)) === String(currentUserId));
  const currentTeamId = getTeamId(currentEntry);
  const balances = new Map();

  if (currentTeamId) {
    try {
      const response = await fantasyAPI.getTeamMoney(currentTeamId, { suppressErrorToast: true });
      const money = readTeamMoney(response);
      if (typeof money === 'number') balances.set(String(currentTeamId), money);
    } catch (_error) {
      // The calculated ledger remains available when the official endpoint fails.
    }
  }

  const rivals = entries.filter((entry) => String(getTeamId(entry)) !== String(currentTeamId));
  if (rivals.length === 0) return balances;

  const readRival = async (entry) => {
    const teamId = getTeamId(entry);
    const response = await fantasyAPI.getTeamMoney(teamId, { suppressErrorToast: true });
    const money = readTeamMoney(response);
    if (typeof money === 'number') balances.set(String(teamId), money);
  };

  try {
    await readRival(rivals[0]);
  } catch (error) {
    if (error.response?.status === 403 || error.response?.status === 404) return balances;
  }

  for (let index = 1; index < rivals.length; index += 2) {
    await Promise.allSettled(rivals.slice(index, index + 2).map(readRival));
  }
  return balances;
};

export const loadLeagueFinances = async ({ leagueId, standings, user, queryClient }) => {
  const [activityResult, teamsData, officialBalances] = await Promise.all([
    fetchCompleteActivity(leagueId, queryClient),
    fetchAllTeamsData(queryClient, leagueId, standings, { staleTime: 5 * 60 * 1000 }),
    fetchOfficialBalances(standings, user),
  ]);

  const state = loadFinanceState(leagueId);
  mergeActivities(leagueId, state, activityResult);
  const snapshotState = captureClauseSnapshot(leagueId, teamsData);
  const finances = calculateLeagueFinances({
    standings,
    activities: snapshotState.activities,
    clauseEvents: snapshotState.clauseEvents,
    snapshots: snapshotState.snapshots,
    historyComplete: snapshotState.historyComplete,
    officialBalances,
  });

  return {
    finances,
    activities: snapshotState.activities,
    clauseEvents: snapshotState.clauseEvents,
    snapshots: snapshotState.snapshots,
    historyComplete: snapshotState.historyComplete,
    pagesLoaded: activityResult.pagesLoaded,
    snapshotCount: snapshotState.snapshots.length,
    officialBalancesAvailable: officialBalances.size,
  };
};
