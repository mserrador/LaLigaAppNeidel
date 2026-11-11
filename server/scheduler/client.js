class FantasyApiError extends Error {
  constructor(message, status, data, code) {
    super(message);
    this.name = 'FantasyApiError';
    this.status = status;
    this.data = sanitizeErrorData(data);
    this.code = code;
  }
}

function sanitizeErrorData(data) {
  if (!data || typeof data !== 'object') return data;
  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    if (/token|authorization|password|secret/i.test(key)) clean[key] = '[REDACTED]';
    else clean[key] = value && typeof value === 'object' ? sanitizeErrorData(value) : value;
  }
  return clean;
}

function extractData(payload) {
  let value = payload;
  while (value && typeof value === 'object' && !Array.isArray(value) &&
         Object.prototype.hasOwnProperty.call(value, 'data')) value = value.data;
  if (value && !Array.isArray(value) && Array.isArray(value.elements)) return value.elements;
  return value;
}

function createFantasyClient(config, repository, { fetchImpl = global.fetch, clock = () => new Date() } = {}) {
  const target = String(config.fantasyTarget || 'https://fantasy-api.llt-services.com').replace(/\/$/, '');
  const competitionId = String(config.competitionId || '1');
  const timeoutMs = Number(config.timeoutMs) || 15000;
  const oauth = config.oauth || {};
  const tokenUrl = config.tokenUrl || config.oauthTokenUrl || oauth.tokenUrl
    || 'https://login.laliga.es/laligadspprob2c.onmicrosoft.com/oauth2/v2.0/token?p=B2C_1A_5ULAIP_PARAMETRIZED_SIGNIN';
  const clientId = config.oauthClientId || config.clientId || oauth.clientId;
  const clientSecret = config.oauthClientSecret || config.clientSecret || oauth.clientSecret;
  let refreshPromise = null;

  async function rawRequest(path, { method = 'GET', bearer, body, headers = {} } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(path.startsWith('http') ? path : `${target}${path}`, {
        method,
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          accept: 'application/json', 'content-type': 'application/json',
          'cache-control': 'no-cache', 'x-app': String(config.xApp || '2'),
          'x-lang': config.language || 'es', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let data = null;
      if (text) { try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 500) }; } }
      if (!response.ok) throw new FantasyApiError(`Fantasy API request failed (${response.status})`, response.status, data);
      return data;
    } catch (error) {
      if (error instanceof FantasyApiError) throw error;
      const code = error.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_NETWORK_ERROR';
      throw new FantasyApiError(code === 'UPSTREAM_TIMEOUT' ? 'Fantasy API request timed out' : 'Fantasy API unavailable', 502, null, code);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function refresh(account) {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      if (!account.tokens.refreshToken || !tokenUrl) throw new FantasyApiError('Stored credentials expired', 401);
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: account.tokens.refreshToken,
        scope: 'openid offline_access',
      });
      params.set('client_id', account.tokens.clientId || clientId || '6457fa17-1224-416a-b21a-ee6ce76e9bc0');
      if (clientSecret) params.set('client_secret', clientSecret);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(tokenUrl, {
          method: 'POST', cache: 'no-store', signal: controller.signal,
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body: params.toString(),
        });
        const payload = await response.json().catch(() => ({}));
        const accessToken = payload.id_token || payload.access_token;
        if (!response.ok || !accessToken) throw new FantasyApiError('Unable to refresh Fantasy credentials', response.status, payload);
        const tokens = {
          accessToken,
          refreshToken: payload.refresh_token || account.tokens.refreshToken,
          clientId: account.tokens.clientId || clientId || null,
          expiresAt: (payload.id_token_expires_in || payload.expires_in)
            ? clock().getTime() + Number(payload.id_token_expires_in || payload.expires_in) * 1000
            : null,
        };
        repository.updateTokens(account.id, tokens);
        return tokens.accessToken;
      } finally { clearTimeout(timeout); }
    })();
    try { return await refreshPromise; } finally { refreshPromise = null; }
  }

  async function storedBearer() {
    const account = repository.getAccount();
    if (!account) throw new FantasyApiError('No Fantasy account linked', 401);
    if (account.tokens.expiresAt && Number(account.tokens.expiresAt) <= clock().getTime() + 30000) return refresh(account);
    return account.tokens.accessToken;
  }

  async function request(path, options = {}) {
    const callerBearer = options.bearer;
    const bearer = callerBearer || await storedBearer();
    try {
      return await rawRequest(path, { ...options, bearer });
    } catch (error) {
      if (!callerBearer && error.status === 401) {
        const account = repository.getAccount();
        return rawRequest(path, { ...options, bearer: await refresh(account) });
      }
      throw error;
    }
  }

  const cmp = `/v1/competition/${competitionId}`;
  return {
    request, extractData,
    getCurrentUser: (bearer) => request('/v4/user/me?x-lang=es', { bearer }).then(extractData),
    getStandings: (leagueId, bearer) => request(`${cmp}/leagues/${leagueId}/standing?x-lang=es`, { bearer }).then(extractData),
    getMarket: (leagueId, bearer) => request(`${cmp}/league/${leagueId}/market?x-lang=es`, { bearer }).then(extractData),
    getTeamData: (leagueId, teamId, bearer) => request(`${cmp}/leagues/${leagueId}/teams/${teamId}?x-lang=es`, { bearer }).then(extractData),
    getTeamMoney: (teamId, bearer) => request(`${cmp}/teams/${teamId}/money?x-lang=es`, { bearer }).then(extractData),
    makeBid: (leagueId, marketId, amount) => request(`${cmp}/league/${leagueId}/market/${marketId}/bid?x-lang=es`,
      { method: 'POST', body: { money: amount } }).then(extractData),
    payBuyout: (leagueId, playerId, amount) => request(`${cmp}/league/${leagueId}/buyout/${playerId}/pay`,
      { method: 'POST', body: { buyoutClauseToPay: amount } }).then(extractData),
  };
}

module.exports = { FantasyApiError, sanitizeErrorData, extractData, createFantasyClient };
