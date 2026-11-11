const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTokenCipher, createRepository } = require('../../server/scheduler');

const key = Buffer.alloc(32, 7).toString('base64');
const baseAction = {
  type: 'bid', leagueId: 'league', playerId: 'player', playerTeamId: 'pt', marketId: 'market',
  scheduleMode: 'exact', scheduledFor: '2026-10-03T10:00:00.000Z', maxAmount: 2000,
  minimumMarketValue: null, maxOverpriceAmount: null, maxOverpricePercent: null, snapshot: { name: 'Player' },
  rules: [
    { position: 0, minBids: 0, maxBids: 0, calcType: 'market_value', amount: null, percent: null },
    { position: 1, minBids: 1, maxBids: 2, calcType: 'market_value_plus_amount', amount: 10, percent: null },
    { position: 2, minBids: 3, maxBids: 4, calcType: 'market_value_plus_percent', amount: null, percent: 10 },
    { position: 3, minBids: 5, maxBids: null, calcType: 'fixed_amount', amount: 1500, percent: null },
  ],
};

describe('scheduler repository', () => {
  let dir;
  let databasePath;
  let repository;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-test-'));
    databasePath = path.join(dir, 'scheduler.sqlite');
    repository = createRepository({ databasePath, cipher: createTokenCipher(key),
      clock: () => new Date('2026-10-03T10:00:01.000Z') });
  });
  afterEach(() => {
    try { repository.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('claims a due action transactionally and only once', () => {
    repository.saveAccount({ id: 'user-1', name: 'Manager' }, { accessToken: 'secret-access', refreshToken: 'secret-refresh' });
    const account = repository.getAccount();
    const action = repository.createAction(account.id, baseAction);
    expect(repository.claim(action.id)).toMatchObject({ id: action.id, status: 'executing' });
    expect(repository.claim(action.id)).toBeNull();
  });

  test('serializes different economic actions for the same account', () => {
    repository.saveAccount({ id: 'user-1', name: 'Manager' }, { accessToken: 'secret-access' });
    const account = repository.getAccount();
    const first = repository.createAction(account.id, baseAction);
    const second = repository.createAction(account.id, { ...baseAction, marketId: 'market-2', playerId: 'player-2' });

    expect(repository.claim(first.id)).toMatchObject({ status: 'executing' });
    expect(repository.claim(second.id)).toBeNull();
    repository.setStatus(first.id, 'executed');
    expect(repository.claim(second.id)).toMatchObject({ status: 'executing' });
  });

  test('persists actions across restart and encrypts credentials at rest', () => {
    repository.saveAccount({ id: 'user-1' }, { accessToken: 'secret-access', refreshToken: 'secret-refresh' });
    const account = repository.getAccount();
    const action = repository.createAction(account.id, baseAction);
    const raw = fs.readFileSync(databasePath);
    expect(raw.includes(Buffer.from('secret-access'))).toBe(false);
    repository.close();
    repository = createRepository({ databasePath, cipher: createTokenCipher(key),
      clock: () => new Date('2026-10-03T10:00:02.000Z') });
    expect(repository.getAccount().tokens.accessToken).toBe('secret-access');
    expect(repository.getAction(action.id, account.id)).toMatchObject({ marketId: 'market', version: 1 });
  });

  test('enforces optimistic versions', () => {
    repository.saveAccount({ id: 'user-1' }, { accessToken: 'x' });
    const account = repository.getAccount();
    const action = repository.createAction(account.id, baseAction);
    expect(repository.updateAction(action.id, account.id, { maxAmount: 3000 }, 1).version).toBe(2);
    expect(() => repository.updateAction(action.id, account.id, { maxAmount: 4000 }, 1)).toThrow(/modified/);
  });

  test('removes credentials but preserves the account and paused actions for reconnection', () => {
    repository.saveAccount({ id: 'user-1' }, { accessToken: 'secret-access', refreshToken: 'secret-refresh' });
    const account = repository.getAccount();
    const action = repository.createAction(account.id, baseAction);

    repository.disconnect();

    expect(repository.getAccount()).toBeNull();
    expect(repository.getAction(action.id, account.id)).toMatchObject({ status: 'paused' });
    const raw = fs.readFileSync(databasePath);
    expect(raw.includes(Buffer.from('secret-access'))).toBe(false);
    expect(raw.includes(Buffer.from('secret-refresh'))).toBe(false);

    const reconnected = repository.saveAccount({ id: 'user-1' }, { accessToken: 'new-access' });
    expect(reconnected.id).toBe(account.id);
    expect(repository.getAction(action.id, reconnected.id)).toMatchObject({ status: 'paused' });
  });
});
