const { selectBidRule, calculateBidAmount, checkBuyoutLimits } = require('./rules');

const asArray = (value) => Array.isArray(value) ? value
  : Array.isArray(value?.elements) ? value.elements
    : Array.isArray(value?.data) ? value.data : Array.isArray(value?.data?.elements) ? value.data.elements : [];
const idOfTeam = (entry) => entry?.team?.id ?? entry?.teamId ?? entry?.id;
const managerId = (entry) => entry?.managerId ?? entry?.userId ?? entry?.team?.manager?.id ?? entry?.team?.userId;
const userId = (user) => user?.userId ?? user?.id ?? user?.sub ?? user?.oid;
const playersOf = (team) => asArray(team?.players || team?.data?.players);
const playerIdOf = (item) => item?.playerMaster?.id ?? item?.player?.id ?? item?.playerId;
const playerTeamIdOf = (item) => item?.playerTeamId ?? item?.id;
const marketPlayerTeamIdOf = (item) => item?.playerTeam?.playerTeamId ?? item?.playerTeam?.id ?? item?.playerTeamId ?? null;
const marketIdOf = (item) => item?.marketId ?? item?.id;
const marketValueOf = (item) => Number(item?.playerMaster?.marketValue ?? item?.player?.marketValue ?? item?.marketValue);
const moneyOf = (value) => Number(typeof value === 'number' ? value : value?.teamMoney ?? value?.money ?? value?.amount);
const masterOf = (item) => item?.playerMaster || item?.player || {};
const imageOf = (player) => player?.images?.transparent?.['256x256'] || player?.image || null;
const ownerNameOf = (entry) => entry?.name || entry?.team?.name
  || entry?.team?.manager?.managerName || (typeof entry?.manager === 'string' ? entry.manager : null) || null;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ownTeam(standings, user) {
  return asArray(standings).find((entry) => String(managerId(entry)) === String(userId(user))) || null;
}

function same(value, expected) {
  return expected != null && value != null && String(value) === String(expected);
}

function activeBidCommitments(market) {
  return asArray(market).reduce((sum, item) => {
    const bid = item?.bid;
    if (!bid || (bid.status && !['pending', 'active'].includes(bid.status))) return sum;
    const amount = Number(bid.money ?? bid.amount);
    return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
  }, 0);
}

function safeSnapshot(value) {
  return JSON.parse(JSON.stringify(value, (key, item) =>
    /authorization|token|password|secret/i.test(key) ? '[REDACTED]' : item));
}

function createExecutor({ repository, client, clock = () => new Date(), logger, economicMutex }) {
  async function commonState(action) {
    const [user, standings, market] = await Promise.all([
      client.getCurrentUser(), client.getStandings(action.leagueId), client.getMarket(action.leagueId),
    ]);
    const team = ownTeam(standings, user);
    if (!team) throw precondition('Current user has no team in this league', 'team_not_found');
    const teamId = idOfTeam(team);
    const [teamData, moneyData] = await Promise.all([
      client.getTeamData(action.leagueId, teamId), client.getTeamMoney(teamId),
    ]);
    const money = moneyOf(moneyData);
    if (!Number.isFinite(money)) throw precondition('Unable to determine team money', 'invalid_balance');
    return { user, standings: asArray(standings), market: asArray(market), team, teamId, teamData, money };
  }

  async function findBuyout(action, state) {
    for (const standing of state.standings) {
      const teamId = idOfTeam(standing);
      if (same(teamId, state.teamId)) continue;
      const data = await client.getTeamData(action.leagueId, teamId);
      const player = playersOf(data).find((item) => same(playerIdOf(item), action.playerId));
      if (player) return { player, ownerTeamId: teamId, owner: standing };
    }
    return null;
  }

  async function inspect(action) {
    const state = await commonState(action);
    if (action.type === 'bid') {
      const listing = state.market.find((item) => same(marketIdOf(item), action.marketId) &&
        same(playerIdOf(item), action.playerId) &&
        (action.playerTeamId == null || same(marketPlayerTeamIdOf(item), action.playerTeamId)));
      return { state, listing, owned: playersOf(state.teamData).some((item) => same(playerIdOf(item), action.playerId)) };
    }
    const owned = playersOf(state.teamData).find((item) => same(playerIdOf(item), action.playerId));
    return { state, owned, target: owned ? null : await findBuyout(action, state) };
  }

  async function authoritativeSnapshot(action) {
    const current = await inspect(action);
    if (action.type === 'bid') {
      if (!current.listing) throw precondition('Market listing not found', 'listing_not_found');
      const player = masterOf(current.listing);
      return safeSnapshot({ observedAt: clock().toISOString(), marketId: marketIdOf(current.listing), playerId: playerIdOf(current.listing),
        playerTeamId: marketPlayerTeamIdOf(current.listing), name: player.nickname || player.name || null,
        image: imageOf(player), positionId: player.positionId ?? null, teamName: player.team?.name || null,
        marketValue: marketValueOf(current.listing), balance: current.state.money,
        expirationDate: current.listing.expirationDate || current.listing.endDate || null,
        numberOfBids: current.listing.numberOfBids ?? 0 });
    }
    if (!current.target) throw precondition('Player is not in a rival roster', 'target_not_found');
    const player = current.target.player;
    const master = masterOf(player);
    return safeSnapshot({ observedAt: clock().toISOString(), playerId: playerIdOf(player), playerTeamId: playerTeamIdOf(player),
      name: master.nickname || master.name || null, image: imageOf(master),
      positionId: master.positionId ?? null, teamName: master.team?.name || null,
      ownerName: ownerNameOf(current.target.owner), ownerTeamId: current.target.ownerTeamId,
      marketValue: marketValueOf(player), balance: current.state.money,
      buyoutClause: Number(player.buyoutClause),
      buyoutClauseLockedEndTime: player.buyoutClauseLockedEndTime || null });
  }

  async function executeUnlocked(action) {
    const attemptId = repository.createAttempt(action.id, 'execute', { scheduledFor: action.scheduledFor });
    let mutationStarted = false;
    try {
      const current = await inspect(action);
      logger?.info?.('live_state_refreshed', { actionId: action.id, type: action.type });
      let result;
      if (action.type === 'bid') result = await executeBid(action, current, () => { mutationStarted = true; });
      else result = await executeBuyout(action, current, () => { mutationStarted = true; });
      repository.finishAttempt(attemptId, result.status, result.snapshot || {}, null);
      return repository.setStatus(action.id, result.status, result);
    } catch (error) {
      const errorMessage = String(error.message || 'Execution failed').slice(0, 500);
      if (error.code === 'RESCHEDULE') {
        repository.finishAttempt(attemptId, 'rescheduled', { scheduledFor: error.scheduledFor });
        return repository.setStatus(action.id, 'scheduled', { scheduledFor: error.scheduledFor, result: { reason: error.reason } });
      }
      if (error.code === 'SKIP') {
        repository.finishAttempt(attemptId, 'skipped', error.snapshot || {}, errorMessage);
        return repository.setStatus(action.id, 'skipped', { error: errorMessage, result: { reason: error.reason } });
      }
      if (mutationStarted && (error.code === 'UPSTREAM_TIMEOUT' || error.code === 'UPSTREAM_NETWORK_ERROR' || error.status >= 500)) {
        const reconciled = await reconcile(action).catch(() => null);
        if (reconciled?.executed) {
          repository.finishAttempt(attemptId, 'reconciled', reconciled, errorMessage);
          return repository.setStatus(action.id, 'executed', { result: reconciled });
        }
        repository.finishAttempt(attemptId, 'uncertain', reconciled || {}, errorMessage);
        return repository.setStatus(action.id, 'uncertain', { error: errorMessage, result: reconciled });
      }
      repository.finishAttempt(attemptId, 'failed', {}, errorMessage);
      logger?.warn?.('action_failed', { actionId: action.id, code: error.code, status: error.status });
      return repository.setStatus(action.id, 'failed', { error: errorMessage });
    }
  }

  const execute = (action) => economicMutex
    ? economicMutex.runExclusive(() => executeUnlocked(action))
    : executeUnlocked(action);

  async function executeBid(action, current, onMutation) {
    const { listing, state } = current;
    if (!listing) throw skip('The exact market listing no longer exists', 'listing_not_found');
    const expiry = listing.expirationDate || listing.endDate;
    if (expiry && new Date(expiry).getTime() <= clock().getTime()) throw skip('Market listing expired', 'listing_expired');
    if (action.scheduleMode === 'before_market_expiry' && expiry) {
      const desiredTime = new Date(expiry).getTime() - (action.offsetSeconds || 0) * 1000;
      if (desiredTime > clock().getTime() + 250) {
        const error = new Error('Market expiration moved into the future');
        error.code = 'RESCHEDULE';
        error.reason = 'market_expiration_moved';
        error.scheduledFor = new Date(desiredTime).toISOString();
        throw error;
      }
    }
    if (listing.bid) throw skip('An own bid already exists', 'own_bid_exists');
    const marketValue = marketValueOf(listing);
    const numberOfBids = Number(listing.numberOfBids);
    if (!Number.isSafeInteger(marketValue) || marketValue <= 0 || !Number.isFinite(numberOfBids)) {
      throw skip('Invalid live market values', 'invalid_live_values');
    }
    if (action.minimumMarketValue && marketValue < action.minimumMarketValue) {
      throw skip('Market value is below the configured minimum', 'minimum_market_value');
    }
    const rule = selectBidRule(action.rules, numberOfBids);
    if (!rule) throw skip('No bid rule applies', 'no_rule');
    let amount;
    try { amount = calculateBidAmount(rule, marketValue, action.maxAmount); }
    catch (error) { throw skip(error.message, error.code || 'invalid_amount'); }
    const teamValue = Number(state.team.teamValue ?? state.team.team?.teamValue);
    if (!Number.isFinite(teamValue)) throw skip('Unable to determine team value', 'invalid_team_value');
    const commitments = activeBidCommitments(state.market);
    const capacity = state.money + Math.floor(teamValue * 0.2) - commitments;
    if (amount > capacity) throw skip('Insufficient bid capacity', 'insufficient_capacity', { amount, capacity, commitments });
    logger?.info?.('bid_validated', { actionId: action.id, numberOfBids, marketValue, amount, capacity });
    onMutation();
    const response = await client.makeBid(action.leagueId, action.marketId, amount);
    const balanceAfter = await client.getTeamMoney(state.teamId).then(moneyOf).catch(() => null);
    return { status: 'executed', result: { amount }, snapshot: safeSnapshot({
      attemptedAt: clock().toISOString(), amount, marketValue, numberOfBids,
      selectedRule: rule, balanceBefore: state.money, balanceAfter, capacity, commitments, response,
    }) };
  }

  async function executeBuyout(action, current, onMutation) {
    let refreshed = current;
    for (let retry = 0; retry < 5; retry += 1) {
      const lock = refreshed.target?.player?.buyoutClauseLockedEndTime;
      const remaining = lock ? new Date(lock).getTime() - clock().getTime() : 0;
      if (!(remaining > 0 && remaining <= 10000)) break;
      await wait(Math.min(remaining + 150, 2000));
      logger?.info?.('buyout_lock_retry', { actionId: action.id, retry: retry + 1, remainingMs: remaining });
      refreshed = await inspect(action);
    }
    current = refreshed;
    if (current.owned) throw skip('Player is already owned by the linked team', 'already_owned');
    if (!current.target) throw skip('Player is no longer in the expected rival roster', 'target_not_found');
    if (!same(current.target.ownerTeamId, action.ownerTeamId) ||
        (action.playerTeamId && !same(playerTeamIdOf(current.target.player), action.playerTeamId))) {
      throw skip('Player ownership changed', 'ownership_changed');
    }
    const player = current.target.player;
    const lock = player.buyoutClauseLockedEndTime;
    if (lock && new Date(lock).getTime() > clock().getTime()) {
      if (action.scheduleMode === 'unlock') {
        const error = new Error('Buyout lock moved into the future');
        error.code = 'RESCHEDULE'; error.reason = 'lock_moved'; error.scheduledFor = new Date(lock).toISOString();
        throw error;
      }
      throw skip('Buyout clause is locked', 'clause_locked');
    }
    const buyoutAmount = Number(player.buyoutClause);
    const marketValue = marketValueOf(player);
    const limits = checkBuyoutLimits({ buyoutAmount, marketValue, maxAmount: action.maxAmount,
      maxOverpriceAmount: action.maxOverpriceAmount, maxOverpricePercent: action.maxOverpricePercent });
    if (!limits.ok) throw skip('Buyout safety limit rejected the live clause', limits.reason,
      { buyoutAmount, marketValue });
    const commitments = activeBidCommitments(current.state.market);
    if (buyoutAmount > current.state.money - commitments) {
      throw skip('Insufficient cash after active bid commitments', 'insufficient_cash', { buyoutAmount, commitments });
    }
    logger?.info?.('buyout_validated', { actionId: action.id, buyoutAmount, marketValue,
      overprice: limits.overprice, availableCash: current.state.money - commitments });
    onMutation();
    const response = await client.payBuyout(action.leagueId, action.playerTeamId, buyoutAmount);
    const balanceAfter = await client.getTeamMoney(current.state.teamId).then(moneyOf).catch(() => null);
    return { status: 'executed', result: { amount: buyoutAmount },
      snapshot: safeSnapshot({ attemptedAt: clock().toISOString(), buyoutAmount, marketValue,
        overprice: limits.overprice, overpricePercent: limits.overpricePercent,
        balanceBefore: current.state.money, balanceAfter, commitments, limits, response }) };
  }

  async function reconcile(action) {
    const current = await inspect(action);
    if (action.type === 'bid') {
      if (current.listing?.bid) return { executed: true, evidence: 'own_bid_present', bid: safeSnapshot(current.listing.bid) };
      return { executed: false, evidence: current.listing ? 'listing_without_own_bid' : 'listing_absent' };
    }
    if (current.owned) return { executed: true, evidence: 'player_in_own_roster' };
    return { executed: false, evidence: current.target ? 'player_in_rival_roster' : 'ownership_unknown' };
  }

  async function recoverExecuting() {
    const recovered = [];
    for (const action of repository.executing()) {
      try {
        const result = await reconcile(action);
        recovered.push(repository.setStatus(action.id, result.executed ? 'executed' : 'uncertain', { result }));
      } catch (error) {
        recovered.push(repository.setStatus(action.id, 'uncertain', { error: String(error.message).slice(0, 500) }));
      }
    }
    return recovered;
  }

  return { execute, reconcile, recoverExecuting, inspect, authoritativeSnapshot };
}

function precondition(message, reason) {
  const error = new Error(message); error.code = 'PRECONDITION'; error.reason = reason; error.status = 409; return error;
}
function skip(message, reason, snapshot) {
  const error = new Error(message); error.code = 'SKIP'; error.reason = reason; error.snapshot = snapshot; return error;
}

module.exports = {
  createExecutor, activeBidCommitments, ownTeam, marketValueOf, playerIdOf,
  playerTeamIdOf, marketPlayerTeamIdOf, marketIdOf,
};
