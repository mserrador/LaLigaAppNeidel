import { fantasyAPI } from '../services/api';
import marketTrendsService from '../services/marketTrendsService';
import { extractArray, getPositionName, readTeamMoney } from './helpers';
import { fetchAllTeamsDataDetailed } from './fetchAllTeamsData';
import { flattenPositionKeyedPlayers } from './formationUtils';

const ACTIVITY_PAGE_COUNT = 5;
const TEAM_CONCURRENCY = 3;
const SNAPSHOT_KEY_PREFIX = 'laliga_league_export_analysis';

const getResponseData = (response) => response?.data;
const getTeamId = (entry) => entry?.id || entry?.team?.id || entry?.teamId || null;
const getManagerId = (entry) => entry?.managerId || entry?.userId || entry?.team?.manager?.id || entry?.team?.userId || null;
const getManagerName = (entry) => (
  (typeof entry?.manager === 'string' && entry.manager)
  || entry?.managerName
  || entry?.team?.manager?.managerName
  || entry?.team?.manager?.name
  || null
);
const getCurrentUserId = (user) => user?.userId || user?.id || user?.sub || user?.oid || null;
const getErrorMessage = (error) => error?.response?.data?.message || error?.message || String(error);
const getPlayerId = (player) => player?.playerMaster?.id || player?.playerMasterId || player?.playerId || player?.id || null;
const getPlayerTeamId = (player) => player?.playerTeamId || player?.playerTeam?.playerTeamId || player?.id || null;
const getPlayerMaster = (player) => player?.playerMaster || player?.player || player || null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const finiteOrNull = (value, label) => {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  console.warn(`League export ignored invalid ${label}:`, value);
  return null;
};

const createError = (type, error, details = {}) => ({ type, ...details, error: getErrorMessage(error) });

const recordError = (errors, type, error, details) => {
  const exportError = createError(type, error, details);
  errors.push(exportError);
  console.error(`Error exporting ${type}:`, exportError);
};

const getTeamPlayers = (teamData) => {
  if (Array.isArray(teamData?.players)) return teamData.players;
  if (Array.isArray(teamData?.data?.players)) return teamData.data.players;
  return [];
};

const sanitizeLeague = (league) => {
  if (!league || typeof league !== 'object') return league;
  const { token: _token, ...safeLeague } = league;
  return safeLeague;
};

const getMarketLeagueApiId = (market) => {
  const payload = getResponseData(market);
  const values = [payload?.leagueId, ...extractArray(market).map((item) => item?.leagueId)]
    .map((value) => finiteOrNull(value, 'market leagueId'))
    .filter((value) => value != null);
  const unique = [...new Set(values)];
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) console.warn('League export found multiple market league IDs:', unique);
  return null;
};

const formatFormation = (formation) => {
  if (Array.isArray(formation)) return formation.join('-');
  if (typeof formation === 'string') return formation.replaceAll(',', '-');
  return null;
};

const getStatAmount = (stat, key, legacyKey = key) => {
  const value = stat?.stats?.[key] ?? stat?.[legacyKey];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const summarizeLastMatches = (lastStats) => {
  if (!Array.isArray(lastStats)) return [];
  const byWeek = new Map();

  lastStats.forEach((stat, index) => {
    const week = stat?.weekNumber ?? stat?.week ?? null;
    const minutes = getStatAmount(stat, 'mins_played', 'minutes');
    const goals = getStatAmount(stat, 'goals');
    const assists = getStatAmount(stat, 'goal_assist', 'assists');
    const points = stat?.totalPoints ?? stat?.points ?? null;
    const infoCount = [minutes, goals, assists, points].filter((value) => value != null).length;
    if (infoCount === 0) return;

    const candidate = {
      week,
      minutes: minutes ?? 0,
      points,
      goals: goals ?? 0,
      assists: assists ?? 0,
      _minutes: Number(minutes) || 0,
      _infoCount: infoCount,
    };
    const key = week == null ? `unknown:${index}` : String(week);
    const existing = byWeek.get(key);
    if (!existing || candidate._minutes > existing._minutes || (
      candidate._minutes === existing._minutes && candidate._infoCount > existing._infoCount
    )) {
      byWeek.set(key, candidate);
    }
  });

  return Array.from(byWeek.values()).map(({ _minutes, _infoCount, ...match }) => match);
};

const activityType = (item) => ({
  1: 'purchase',
  4: 'shield',
  6: 'matchday_earnings',
  7: 'invalid_lineup',
  9: 'league_join',
  31: 'market_purchase',
  32: 'buyout',
  33: 'sale',
}[item?.activityTypeId] || null);

const getActivityParticipant = (item, userKey, managersById) => {
  const id = item?.[`${userKey}Id`] ?? null;
  const manager = id != null ? managersById.get(String(id)) : null;
  return {
    teamId: manager?.teamId ?? null,
    managerName: item?.[`${userKey}Name`] ?? manager?.managerName ?? null,
    hasExplicitData: id != null || item?.[`${userKey}Name`] != null,
  };
};

const interpretTransactionParticipants = (item, managersById) => {
  const user1 = getActivityParticipant(item, 'user1', managersById);
  const user2 = getActivityParticipant(item, 'user2', managersById);

  switch (item?.activityTypeId) {
    case 1:
    case 31:
    case 32:
      return { buyer: user1, seller: user2 };
    case 33:
      // A type 33 event means user1 sold to LaLiga unless a real counterparty exists.
      return {
        buyer: user2.hasExplicitData ? user2 : { teamId: null, managerName: null },
        seller: user1,
      };
    default:
      return {
        buyer: { teamId: null, managerName: null },
        seller: { teamId: null, managerName: null },
      };
  }
};

const offerKey = (offer) => String(offer?.id || `${offer?.playerTeamId || ''}:${offer?.offerAmount || ''}:${offer?.expirationDate || ''}`);

export const findCurrentTeam = (standings, user) => {
  const currentUserId = getCurrentUserId(user);
  if (!currentUserId) return null;
  return extractArray(standings).find((entry) => {
    const managerId = getManagerId(entry);
    return managerId != null && String(managerId) === String(currentUserId);
  }) || null;
};

export const extractWeekNumber = (currentWeek) => currentWeek?.weekNumber ?? currentWeek?.week ?? null;

const fetchReceivedOffers = async ({ leagueId, currentTeamId, market, errors }) => {
  const marketItems = extractArray(market);
  const candidates = marketItems.filter((item) => (
    item?.discr === 'marketPlayerTeam'
    && Number(item.numberOfOffers) > 0
    && item.sellerTeam?.id != null
    && String(item.sellerTeam.id) === String(currentTeamId)
  ));
  const results = [];

  for (let start = 0; start < candidates.length; start += TEAM_CONCURRENCY) {
    const batch = candidates.slice(start, start + TEAM_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((marketItem) => {
      const playerTeamId = getPlayerTeamId(marketItem);
      if (!playerTeamId) return Promise.reject(new Error('El registro de mercado no incluye playerTeamId'));
      return fantasyAPI.getPlayerOffer(leagueId, playerTeamId);
    }));

    settled.forEach((result, index) => {
      const marketItem = batch[index];
      const playerTeamId = getPlayerTeamId(marketItem);
      if (result.status === 'rejected') {
        recordError(errors, 'receivedOffer', result.reason, {
          playerId: getPlayerId(marketItem),
          playerTeamId,
        });
        return;
      }
      results.push({ marketItem, offers: getResponseData(result.value) });
    });
  }
  return results;
};

const fetchActivity = async ({ leagueId, queryClient, errors }) => {
  const requests = Array.from({ length: ACTIVITY_PAGE_COUNT }, (_, index) => (
    (async () => {
      if (index > 0) await sleep(index * 300);
      return queryClient.fetchQuery({
        queryKey: ['leagueExportActivity', leagueId, index],
        queryFn: () => fantasyAPI.getLeagueActivity(leagueId, index),
        staleTime: 0,
      });
    })()
  ));
  const settled = await Promise.allSettled(requests);
  const pages = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') pages.push(getResponseData(result.value));
    else recordError(errors, 'activity', result.reason, { page: index });
  });
  return pages;
};

const buildReceivedOffersAnalysis = (receivedOffers) => receivedOffers.flatMap(({ marketItem, offers }) => {
  const player = getPlayerMaster(marketItem);
  const offerList = extractArray(offers);
  return offerList.map((offer) => ({
    playerId: getPlayerId(marketItem),
    playerTeamId: getPlayerTeamId(marketItem),
    playerName: player?.nickname || player?.name || null,
    marketValue: player?.marketValue ?? null,
    salePrice: marketItem?.salePrice ?? null,
    offerAmount: offer?.money ?? offer?.amount ?? null,
    status: offer?.status ?? null,
    expirationDate: offer?.expirationDate ?? null,
    offerType: offer?.offerType ?? offer?.type ?? offer?.discr ?? null,
    manager: offer?.bidderTeam || offer?.manager || null,
  }));
});

const buildLineupAnalysis = (lineup) => {
  const formation = lineup?.formation;
  if (!formation || typeof formation !== 'object') return null;
  const invalidEntries = [];
  const players = flattenPositionKeyedPlayers(formation)
    .filter((entry) => {
      const isPlayer = getPlayerId(entry) != null || getPlayerTeamId(entry) != null;
      if (!isPlayer) invalidEntries.push(entry?.originalPosition || 'unknown');
      return isPlayer;
    })
    .map((entry, index) => {
      const player = getPlayerMaster(entry);
      return {
        playerId: getPlayerId(entry),
        playerTeamId: getPlayerTeamId(entry),
        name: player?.nickname || player?.name || null,
        position: getPositionName(entry.positionId),
        slot: `${entry.originalPosition}:${index}`,
        starter: true,
      };
    });

  if (invalidEntries.length) console.warn('League export ignored invalid lineup entries:', invalidEntries);
  if (players.length > 11) console.warn('League export lineup has more than 11 starters:', players.length);

  return {
    formation: formatFormation(formation.tacticalFormation || lineup.tacticalFormation),
    players,
  };
};

const buildTransactions = (activityPages, managersById, playersById) => activityPages
  .flatMap((page) => extractArray(page))
  .map((item) => {
    const { buyer, seller } = interpretTransactionParticipants(item, managersById);
    const playerId = item.playerMasterId ?? item.playerId ?? item.playerMaster?.id ?? item.player?.id ?? null;
    const player = item.playerMaster || item.player || playersById.get(String(playerId));
    return {
      date: item.createdAt ?? item.timestamp ?? null,
      type: activityType(item),
      activityTypeId: item.activityTypeId ?? null,
      playerId,
      playerName: item.playerName || player?.nickname || player?.name || null,
      buyerTeamId: buyer.teamId,
      buyerManager: buyer.managerName,
      sellerTeamId: seller.teamId,
      sellerManager: seller.managerName,
      amount: item.amount ?? null,
    };
  });

const getPreviousSnapshot = (leagueApiId) => {
  try {
    const value = localStorage.getItem(`${SNAPSHOT_KEY_PREFIX}:${leagueApiId}`);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.warn('Unable to read previous league export snapshot:', error);
    return null;
  }
};

const buildChanges = (previous, analysisData) => {
  if (!previous) return null;
  const previousPlayers = new Map((previous.players || []).map((player) => [String(player.playerId), player]));
  const playerOwnerChanges = analysisData.players.flatMap((player) => {
    const before = previousPlayers.get(String(player.playerId));
    if (!before || before.ownerTeamId === player.ownerTeamId) return [];
    return [{ playerId: player.playerId, name: player.name, fromTeamId: before.ownerTeamId, toTeamId: player.ownerTeamId }];
  });
  const marketValueChanges = analysisData.players.flatMap((player) => {
    const before = previousPlayers.get(String(player.playerId));
    if (!before || before.marketValue === player.marketValue) return [];
    return [{ playerId: player.playerId, name: player.name, previous: before.marketValue, current: player.marketValue }];
  });
  const oldOffers = new Set((previous.receivedOffers || []).map(offerKey));
  const newReceivedOffers = analysisData.receivedOffers.filter((offer) => !oldOffers.has(offerKey(offer)));
  return {
    previousExportAt: previous.generatedAt || null,
    playerOwnerChanges,
    marketValueChanges,
    newReceivedOffers,
    cashChange: typeof previous.me?.cash === 'number' && typeof analysisData.me?.cash === 'number'
      ? analysisData.me.cash - previous.me.cash
      : null,
  };
};

const saveSnapshot = (leagueApiId, analysisData) => {
  try {
    localStorage.setItem(`${SNAPSHOT_KEY_PREFIX}:${leagueApiId}`, JSON.stringify(analysisData));
  } catch (error) {
    console.warn('Unable to save league export snapshot:', error);
  }
};

/**
 * Recopila los cuerpos de las respuestas Fantasy. Nunca exporta el objeto de
 * respuesta interno del cliente porque incluye la configuración con Authorization.
 */
export const buildLeagueExport = async ({ leagueId, leagueName, user, queryClient }) => {
  if (!leagueId) throw new Error('No hay una liga seleccionada para exportar');

  const [standingsResult, marketResult, leaguesResult, weekResult] = await Promise.allSettled([
    queryClient.fetchQuery({ queryKey: ['standings', leagueId], queryFn: () => fantasyAPI.getLeagueRanking(leagueId), staleTime: 0 }),
    queryClient.fetchQuery({ queryKey: ['market', leagueId], queryFn: () => fantasyAPI.getMarket(leagueId), staleTime: 0 }),
    fantasyAPI.getLeagues(),
    queryClient.fetchQuery({ queryKey: ['currentWeek'], queryFn: () => fantasyAPI.getCurrentWeek(), staleTime: 0 }),
  ]);

  const errors = [];
  const results = { standings: standingsResult, market: marketResult, league: leaguesResult, currentWeek: weekResult };
  Object.entries(results).forEach(([type, result]) => {
    if (result.status === 'rejected') recordError(errors, type, result.reason);
  });

  const standings = standingsResult.status === 'fulfilled' ? standingsResult.value : null;
  const market = marketResult.status === 'fulfilled' ? marketResult.value : null;
  const leagues = leaguesResult.status === 'fulfilled' ? leaguesResult.value : null;
  const currentWeek = weekResult.status === 'fulfilled' ? weekResult.value : null;
  const standingsEntries = extractArray(standings);
  const currentTeam = findCurrentTeam(standings, user);
  const currentTeamId = getTeamId(currentTeam);

  if (standingsEntries.length && getCurrentUserId(user) && !currentTeam) {
    recordError(errors, 'currentTeam', new Error('No se pudo identificar el equipo del usuario actual en la clasificación'));
  }

  let teams = [];
  if (standingsEntries.length) {
    const collected = await fetchAllTeamsDataDetailed(queryClient, leagueId, standings, { concurrency: TEAM_CONCURRENCY });
    teams = Array.from(collected.results.entries()).map(([teamId, { teamData, entry }]) => ({
      teamId,
      managerId: getManagerId(entry),
      managerName: getManagerName(entry),
      data: getResponseData(teamData),
    }));
    collected.errors.forEach(({ teamId, entry, error }) => recordError(errors, 'team', error, { teamId, managerName: getManagerName(entry) }));
  }

  const optionalRequests = await Promise.allSettled([
    currentTeamId
      ? queryClient.fetchQuery({ queryKey: ['teamMoney', currentTeamId], queryFn: () => fantasyAPI.getTeamMoney(currentTeamId), staleTime: 0 })
      : Promise.resolve(null),
    currentTeamId
      ? queryClient.fetchQuery({ queryKey: ['currentLineup', currentTeamId], queryFn: () => fantasyAPI.getCurrentLineup(currentTeamId), staleTime: 0 })
      : Promise.resolve(null),
    currentTeamId ? fetchReceivedOffers({ leagueId, currentTeamId, market, errors }) : Promise.resolve([]),
    fetchActivity({ leagueId, queryClient, errors }),
    marketTrendsService.initialize(),
  ]);

  const [moneyResult, lineupResult, offersResult, activityResult, trendsResult] = optionalRequests;
  if (moneyResult.status === 'rejected') recordError(errors, 'myTeamMoney', moneyResult.reason, { teamId: currentTeamId });
  if (lineupResult.status === 'rejected') recordError(errors, 'lineup', lineupResult.reason, { teamId: currentTeamId });
  if (offersResult.status === 'rejected') recordError(errors, 'receivedOffers', offersResult.reason, { teamId: currentTeamId });
  if (activityResult.status === 'rejected') recordError(errors, 'activity', activityResult.reason);
  if (trendsResult.status === 'rejected') recordError(errors, 'marketTrends', trendsResult.reason);

  const currentTeamMoney = moneyResult.status === 'fulfilled' ? getResponseData(moneyResult.value) : null;
  const lineup = lineupResult.status === 'fulfilled' ? getResponseData(lineupResult.value) : null;
  const receivedOffersRaw = offersResult.status === 'fulfilled' ? offersResult.value : [];
  const activityPages = activityResult.status === 'fulfilled' ? activityResult.value : [];
  const league = sanitizeLeague(extractArray(leagues).find((item) => String(item?.id) === String(leagueId)) || null);
  const managersById = new Map(standingsEntries.map((entry) => [String(getManagerId(entry)), {
    teamId: getTeamId(entry), managerName: getManagerName(entry),
  }]));
  const playersById = new Map();
  extractArray(market).forEach((item) => {
    const playerId = getPlayerId(item);
    if (playerId != null) playersById.set(String(playerId), getPlayerMaster(item));
  });
  const analysisPlayers = teams.flatMap((team) => getTeamPlayers(team.data).map((player) => {
    const master = getPlayerMaster(player);
    const playerId = getPlayerId(player);
    if (playerId != null) playersById.set(String(playerId), master);
    const trend = master ? marketTrendsService.resolveTrendForPlayer(master) : null;
    const marketItem = extractArray(market).find((item) => String(getPlayerId(item)) === String(playerId));
    return {
      playerId,
      playerTeamId: getPlayerTeamId(player),
      name: master?.nickname || master?.name || null,
      ownerTeamId: team.teamId,
      ownerManager: team.managerName,
      position: getPositionName(master?.positionId ?? player?.positionId),
      marketValue: finiteOrNull(master?.marketValue ?? player?.marketValue, 'player marketValue'),
      marketValueChange24h: finiteOrNull(trend?.diferencia1, 'player market value change'),
      marketValueChangePercent24h: finiteOrNull(trend?.porcentaje, 'player market value percentage'),
      points: master?.points ?? player?.points ?? null,
      averagePoints: master?.averagePoints ?? player?.averagePoints ?? null,
      status: master?.playerStatus ?? player?.playerStatus ?? null,
      buyoutClause: player?.buyoutClause ?? null,
      onSale: Boolean(marketItem),
      salePrice: marketItem?.salePrice ?? null,
      offers: [],
      lastMatches: summarizeLastMatches(master?.lastStats || player?.lastStats),
    };
  }));
  const receivedOffers = buildReceivedOffersAnalysis(receivedOffersRaw);
  const offersByPlayerTeamId = new Map();
  receivedOffers.forEach((offer) => {
    const key = String(offer.playerTeamId);
    offersByPlayerTeamId.set(key, [...(offersByPlayerTeamId.get(key) || []), offer]);
  });
  analysisPlayers.forEach((player) => { player.offers = offersByPlayerTeamId.get(String(player.playerTeamId)) || []; });
  const seenBids = extractArray(market).filter((item) => item?.bid?.money != null);
  const analysisData = {
    generatedAt: new Date().toISOString(),
    me: {
      teamId: currentTeamId,
      managerName: getManagerName(currentTeam) || user?.managerName || user?.displayName || user?.name || null,
      cash: readTeamMoney({ data: currentTeamMoney }) ?? null,
      committedMoney: seenBids.length ? seenBids.reduce((sum, item) => sum + Number(item.bid.money || 0), 0) : null,
      teamValue: currentTeam?.teamValue ?? currentTeam?.team?.teamValue ?? null,
      playersCount: analysisPlayers.filter((player) => String(player.ownerTeamId) === String(currentTeamId)).length,
    },
    managers: standingsEntries.map((entry) => {
      const teamId = getTeamId(entry);
      return {
        teamId,
        managerId: getManagerId(entry),
        managerName: getManagerName(entry),
        teamValue: entry?.teamValue ?? entry?.team?.teamValue ?? null,
        cash: String(teamId) === String(currentTeamId) ? readTeamMoney({ data: currentTeamMoney }) ?? null : null,
        playersCount: analysisPlayers.filter((player) => String(player.ownerTeamId) === String(teamId)).length,
      };
    }),
    players: analysisPlayers,
    market: extractArray(market).map((item) => {
      const player = getPlayerMaster(item);
      const trend = player ? marketTrendsService.resolveTrendForPlayer(player) : null;
      const marketValue = finiteOrNull(player?.marketValue, 'market player marketValue');
      if (marketValue == null) console.warn('League export market player has no marketValue:', getPlayerId(item));
      const bid = item?.bid;
      return {
        marketId: item?.id ?? null,
        playerId: getPlayerId(item),
        playerTeamId: getPlayerTeamId(item),
        name: player?.nickname || player?.name || null,
        position: getPositionName(player?.positionId ?? item?.positionId),
        status: player?.playerStatus ?? item?.playerStatus ?? null,
        marketType: item?.discr === 'marketPlayerTeam' || item?.sellerTeam ? 'manager' : 'league',
        salePrice: item?.salePrice ?? null,
        marketValue,
        marketValueChange24h: finiteOrNull(trend?.diferencia1, 'market value change'),
        marketValueChangePercent24h: finiteOrNull(trend?.porcentaje, 'market value percentage'),
        points: player?.points ?? item?.points ?? null,
        averagePoints: player?.averagePoints ?? item?.averagePoints ?? null,
        expirationDate: item?.expirationDate ?? null,
        numberOfBids: item?.numberOfBids ?? null,
        numberOfOffers: item?.numberOfOffers ?? null,
        myBid: bid ? {
          id: bid.id ?? null,
          amount: bid.money ?? bid.amount ?? null,
          status: bid.status ?? null,
          createdAt: bid.createdAt ?? null,
          updatedAt: bid.updatedAt ?? null,
        } : null,
        sellerTeam: item?.sellerTeam ?? null,
      };
    }),
    receivedOffers,
    lineup: buildLineupAnalysis(lineup),
    transactions: buildTransactions(activityPages, managersById, playersById),
  };
  const leagueRouteId = leagueId ?? league?.routeId ?? league?.leagueRouteId ?? null;
  const leagueApiId = getMarketLeagueApiId(market) ?? finiteOrNull(league?.leagueApiId ?? league?.apiId, 'league API ID');
  if (leagueApiId == null) console.warn('League export could not determine a numeric leagueApiId from the API payload');
  const snapshotId = leagueApiId ?? leagueRouteId;
  const changesSincePreviousExport = buildChanges(getPreviousSnapshot(snapshotId), analysisData);
  saveSnapshot(snapshotId, analysisData);

  return {
    exportInfo: {
      generatedAt: analysisData.generatedAt,
      leagueApiId,
      leagueRouteId,
      leagueName: leagueName || league?.name || null,
      currentTeamId,
      currentManager: analysisData.me.managerName,
      currentWeek: extractWeekNumber(getResponseData(currentWeek)),
    },
    analysisData,
    changesSincePreviousExport,
    raw: {
      league,
      standings: getResponseData(standings),
      market: getResponseData(market),
      teams,
      currentTeamMoney,
      receivedOffers: receivedOffersRaw,
      lineup,
      activity: activityPages,
    },
    errors,
  };
};

const pad = (value) => String(value).padStart(2, '0');

export const createLeagueExportFilename = (leagueId, date = new Date()) => {
  const timestamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
  return `laliga-fantasy-${leagueId}-${timestamp}.json`;
};

export const downloadLeagueExport = (data, filename = createLeagueExportFilename(
  data.exportInfo.leagueApiId ?? data.exportInfo.leagueRouteId
)) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
