const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const ACTION_STATUSES = new Set([
  'scheduled', 'paused', 'ready', 'executing', 'executed', 'skipped', 'failed',
  'uncertain', 'cancelled', 'expired',
]);
const PENDING_STATUSES = ['scheduled', 'paused', 'ready', 'executing', 'uncertain'];

function json(value, fallback = null) {
  if (value == null) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function createRepository({ databasePath, dataDir, cipher, clock = () => new Date() }) {
  const resolvedPath = databasePath || path.join(dataDir || process.cwd(), 'scheduler.sqlite');
  if (resolvedPath !== ':memory:') fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 3000');
  migrate(db);
  const now = () => clock().toISOString();

  function hydrateAction(row) {
    if (!row) return null;
    const rules = db.prepare(`SELECT position, min_bids minBids, max_bids maxBids,
      calc_type calcType, amount, percent FROM bid_rules WHERE action_id = ? ORDER BY position`).all(row.id);
    return {
      id: row.id, accountId: row.account_id, type: row.type, leagueId: row.league_id,
      playerId: row.player_id, playerTeamId: row.player_team_id, marketId: row.market_id,
      ownerTeamId: row.owner_team_id, status: row.status, scheduleMode: row.schedule_mode,
      scheduledFor: row.scheduled_for, maxAmount: row.max_amount,
      minimumMarketValue: row.minimum_market_value, maxOverpriceAmount: row.max_overprice_amount,
      maxOverpricePercent: row.max_overprice_percent, snapshot: json(row.snapshot_json, {}),
      offsetSeconds: row.offset_seconds,
      result: json(row.result_json), lastError: row.last_error, version: row.version,
      claimedAt: row.claimed_at, createdAt: row.created_at, updatedAt: row.updated_at,
      completedAt: row.completed_at, rules,
    };
  }

  const insertRules = db.prepare(`INSERT INTO bid_rules
    (action_id, position, min_bids, max_bids, calc_type, amount, percent)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);

  const createActionTx = db.transaction((accountId, action) => {
    const id = crypto.randomUUID();
    const timestamp = now();
    db.prepare(`INSERT INTO scheduled_actions
      (id, account_id, type, league_id, player_id, player_team_id, market_id, owner_team_id,
       status, schedule_mode, scheduled_for, offset_seconds, max_amount, minimum_market_value,
       max_overprice_amount, max_overprice_percent, snapshot_json, created_at, updated_at)
      VALUES (@id, @accountId, @type, @leagueId, @playerId, @playerTeamId, @marketId,
        @ownerTeamId, @status, @scheduleMode, @scheduledFor, @offsetSeconds, @maxAmount,
       @minimumMarketValue, @maxOverpriceAmount, @maxOverpricePercent, @snapshot, @timestamp, @timestamp)`)
      .run({ id, accountId, ...action, status: action.enabled === false ? 'paused' : 'scheduled',
        offsetSeconds: action.offsetSeconds ?? null, playerTeamId: action.playerTeamId || null,
        marketId: action.marketId || null, ownerTeamId: action.ownerTeamId || null,
        minimumMarketValue: action.minimumMarketValue || null,
        maxOverpriceAmount: action.maxOverpriceAmount || null,
        maxOverpricePercent: action.maxOverpricePercent || null,
        snapshot: JSON.stringify(action.snapshot || {}), timestamp });
    for (const rule of action.rules || []) {
      insertRules.run(id, rule.position, rule.minBids, rule.maxBids, rule.calcType, rule.amount, rule.percent);
    }
    audit(accountId, id, 'action_created', { action: { ...action, snapshot: action.snapshot } });
    return hydrateAction(db.prepare('SELECT * FROM scheduled_actions WHERE id = ?').get(id));
  });

  const updateActionTx = db.transaction((id, accountId, patch, expectedVersion) => {
    const current = db.prepare('SELECT * FROM scheduled_actions WHERE id = ? AND account_id = ?').get(id, accountId);
    if (!current) return null;
    if (expectedVersion !== current.version) {
      const error = new Error('Action was modified by another request');
      error.status = 409;
      error.code = 'VERSION_CONFLICT';
      throw error;
    }
    if (!['scheduled', 'paused'].includes(current.status)) {
      const error = new Error('Only scheduled or paused actions can be edited');
      error.status = 409;
      throw error;
    }
    const map = {
      leagueId: 'league_id', playerId: 'player_id', playerTeamId: 'player_team_id',
      marketId: 'market_id', ownerTeamId: 'owner_team_id', scheduleMode: 'schedule_mode',
      scheduledFor: 'scheduled_for', offsetSeconds: 'offset_seconds', maxAmount: 'max_amount', minimumMarketValue: 'minimum_market_value',
      maxOverpriceAmount: 'max_overprice_amount', maxOverpricePercent: 'max_overprice_percent',
    };
    const values = { id, accountId, version: expectedVersion, updatedAt: now() };
    const sets = ['version = version + 1', 'updated_at = @updatedAt'];
    for (const [key, column] of Object.entries(map)) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        sets.push(`${column} = @${key}`);
        values[key] = patch[key];
      }
    }
    if (patch.snapshot !== undefined) {
      sets.push('snapshot_json = @snapshot');
      values.snapshot = JSON.stringify(patch.snapshot);
    }
    const result = db.prepare(`UPDATE scheduled_actions SET ${sets.join(', ')}
      WHERE id = @id AND account_id = @accountId AND version = @version`).run(values);
    if (result.changes !== 1) throw new Error('Concurrent action update');
    if (patch.rules) {
      db.prepare('DELETE FROM bid_rules WHERE action_id = ?').run(id);
      for (const rule of patch.rules) insertRules.run(id, rule.position, rule.minBids, rule.maxBids,
        rule.calcType, rule.amount, rule.percent);
    }
    audit(accountId, id, 'action_updated', { fields: Object.keys(patch) });
    return hydrateAction(db.prepare('SELECT * FROM scheduled_actions WHERE id = ?').get(id));
  });

  const claimTx = db.transaction((id, timestamp) => {
    const result = db.prepare(`UPDATE scheduled_actions SET status = 'executing', claimed_at = ?,
      updated_at = ?, version = version + 1 WHERE id = ? AND status IN ('scheduled','ready')
      AND scheduled_for <= ? AND NOT EXISTS (
        SELECT 1 FROM scheduled_actions active
        WHERE active.account_id = scheduled_actions.account_id
          AND active.status = 'executing' AND active.id <> scheduled_actions.id
      )`).run(timestamp, timestamp, id, timestamp);
    if (result.changes !== 1) return null;
    return hydrateAction(db.prepare('SELECT * FROM scheduled_actions WHERE id = ?').get(id));
  });

  function audit(accountId, actionId, event, details) {
    db.prepare(`INSERT INTO audit_events (account_id, action_id, event, details_json, created_at)
      VALUES (?, ?, ?, ?, ?)`).run(accountId || null, actionId || null, event, JSON.stringify(details || {}), now());
  }

  return {
    db,
    databasePath: resolvedPath,
    createAction: createActionTx,
    getAction(id, accountId) {
      return hydrateAction(db.prepare('SELECT * FROM scheduled_actions WHERE id = ? AND account_id = ?').get(id, accountId));
    },
    listActions(accountId, filters = {}) {
      const where = ['account_id = @accountId'];
      const params = { accountId };
      for (const key of ['status', 'type', 'leagueId']) {
        if (filters[key]) {
          const column = key === 'leagueId' ? 'league_id' : key;
          where.push(`${column} = @${key}`);
          params[key] = filters[key];
        }
      }
      return db.prepare(`SELECT * FROM scheduled_actions WHERE ${where.join(' AND ')}
        ORDER BY scheduled_for, created_at`).all(params).map(hydrateAction);
    },
    updateAction: updateActionTx,
    setStatus(id, status, details = {}) {
      if (!ACTION_STATUSES.has(status)) throw new Error(`Invalid action status: ${status}`);
      const timestamp = now();
      const terminal = ['executed', 'skipped', 'failed', 'cancelled', 'expired'].includes(status) ? timestamp : null;
      const result = db.prepare(`UPDATE scheduled_actions SET status = @status, result_json = @result,
        last_error = @lastError, scheduled_for = COALESCE(@scheduledFor, scheduled_for),
        completed_at = @terminal, updated_at = @timestamp, version = version + 1 WHERE id = @id`)
        .run({ id, status, result: details.result == null ? null : JSON.stringify(details.result),
          lastError: details.error || null, scheduledFor: details.scheduledFor || null, terminal, timestamp });
      if (result.changes) audit(null, id, `action_${status}`, details);
      return result.changes ? hydrateAction(db.prepare('SELECT * FROM scheduled_actions WHERE id = ?').get(id)) : null;
    },
    toggle(id, accountId) {
      const row = db.prepare('SELECT status FROM scheduled_actions WHERE id = ? AND account_id = ?').get(id, accountId);
      if (!row || !['scheduled', 'paused'].includes(row.status)) return null;
      return this.setStatus(id, row.status === 'paused' ? 'scheduled' : 'paused');
    },
    cancel(id, accountId) {
      const result = db.prepare(`UPDATE scheduled_actions SET status = 'cancelled', completed_at = ?,
        updated_at = ?, version = version + 1 WHERE id = ? AND account_id = ?
        AND status IN ('scheduled','paused','ready','uncertain')`).run(now(), now(), id, accountId);
      if (result.changes) audit(accountId, id, 'action_cancelled', {});
      return result.changes > 0;
    },
    due(limit = 20, at = now()) {
      return db.prepare(`SELECT id FROM scheduled_actions WHERE status IN ('scheduled','ready')
        AND scheduled_for <= ? ORDER BY scheduled_for LIMIT ?`).all(at, limit).map((row) => row.id);
    },
    claim(id, at = now()) { return claimTx(id, at); },
    executing() {
      return db.prepare("SELECT * FROM scheduled_actions WHERE status = 'executing' ORDER BY claimed_at").all().map(hydrateAction);
    },
    exposure(accountId, leagueId) {
      const placeholders = PENDING_STATUSES.map(() => '?').join(',');
      const row = db.prepare(`SELECT COALESCE(SUM(max_amount), 0) exposure, COUNT(*) count
        FROM scheduled_actions WHERE account_id = ? AND league_id = ? AND status IN (${placeholders})`)
        .get(accountId, String(leagueId), ...PENDING_STATUSES);
      return { exposure: row.exposure, count: row.count };
    },
    createAttempt(actionId, phase, snapshot = {}) {
      const result = db.prepare(`INSERT INTO execution_attempts (action_id, phase, status, snapshot_json, started_at)
        VALUES (?, ?, 'started', ?, ?)`).run(actionId, phase, JSON.stringify(snapshot), now());
      return Number(result.lastInsertRowid);
    },
    finishAttempt(id, status, snapshot = {}, error = null) {
      db.prepare(`UPDATE execution_attempts SET status = ?, snapshot_json = ?, error = ?, finished_at = ?
        WHERE id = ?`).run(status, JSON.stringify(snapshot), error, now(), id);
    },
    getAttempts(actionId) {
      return db.prepare(`SELECT id, phase, status, snapshot_json, error, started_at, finished_at
        FROM execution_attempts WHERE action_id = ? ORDER BY id DESC`).all(actionId).map((row) => ({
        id: row.id,
        phase: row.phase,
        status: row.status,
        snapshot: json(row.snapshot_json, {}),
        error: row.error,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
      }));
    },
    audit,
    getAccount() {
      const row = db.prepare('SELECT * FROM scheduler_accounts WHERE connected = 1 ORDER BY created_at LIMIT 1').get();
      if (!row) return null;
      return { id: row.id, identityId: row.identity_id, displayName: row.display_name,
        tokens: cipher.decrypt(row.token_bundle), createdAt: row.created_at, updatedAt: row.updated_at };
    },
    saveAccount(identity, tokens) {
      const existing = db.prepare('SELECT * FROM scheduler_accounts ORDER BY created_at LIMIT 1').get();
      const identityId = String(identity.id);
      if (existing && String(existing.identity_id) !== identityId) {
        const error = new Error('A different Fantasy identity is already linked');
        error.status = 409;
        throw error;
      }
      const timestamp = now();
      const encrypted = cipher.encrypt(tokens);
      let accountId = existing?.id;
      if (existing) {
        db.prepare(`UPDATE scheduler_accounts SET display_name = ?, token_bundle = ?, connected = 1, updated_at = ? WHERE id = ?`)
          .run(identity.name || identity.nickname || null, encrypted, timestamp, existing.id);
      } else {
        accountId = crypto.randomUUID();
        db.prepare(`INSERT INTO scheduler_accounts (id, identity_id, display_name, token_bundle, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`).run(accountId, identityId,
          identity.name || identity.nickname || null, encrypted, timestamp, timestamp);
      }
      audit(accountId, null, 'account_linked', { identityId });
      return this.getAccount();
    },
    updateTokens(accountId, tokens) {
      db.prepare('UPDATE scheduler_accounts SET token_bundle = ?, updated_at = ? WHERE id = ?')
        .run(cipher.encrypt(tokens), now(), accountId);
    },
    disconnect() {
      const tx = db.transaction(() => {
        db.prepare("UPDATE scheduled_actions SET status = 'paused', updated_at = ?, version = version + 1 WHERE status IN ('scheduled','ready')")
          .run(now());
        db.prepare('UPDATE scheduler_accounts SET token_bundle = ?, connected = 0, updated_at = ?')
          .run(cipher.encrypt({}), now());
        audit(null, null, 'account_disconnected', {});
      });
      tx();
    },
    close() { db.close(); },
  };
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
  `);
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version = 1').get()) {
    db.transaction(() => {
      db.exec(`
      CREATE TABLE scheduler_accounts (
        id TEXT PRIMARY KEY, identity_id TEXT NOT NULL UNIQUE, display_name TEXT,
        token_bundle TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE scheduled_actions (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('bid','buyout')),
        league_id TEXT NOT NULL, player_id TEXT NOT NULL, player_team_id TEXT, market_id TEXT,
         owner_team_id TEXT, status TEXT NOT NULL, schedule_mode TEXT NOT NULL, scheduled_for TEXT NOT NULL,
         offset_seconds INTEGER,
        max_amount INTEGER NOT NULL, minimum_market_value INTEGER, max_overprice_amount INTEGER,
        max_overprice_percent INTEGER, snapshot_json TEXT NOT NULL DEFAULT '{}', result_json TEXT,
        last_error TEXT, version INTEGER NOT NULL DEFAULT 1, claimed_at TEXT, completed_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX scheduled_actions_due ON scheduled_actions(status, scheduled_for);
      CREATE TABLE bid_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT, action_id TEXT NOT NULL REFERENCES scheduled_actions(id) ON DELETE CASCADE,
        position INTEGER NOT NULL, min_bids INTEGER NOT NULL, max_bids INTEGER, calc_type TEXT NOT NULL,
        amount INTEGER, percent INTEGER, UNIQUE(action_id, position)
      );
      CREATE TABLE execution_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, action_id TEXT NOT NULL REFERENCES scheduled_actions(id),
        phase TEXT NOT NULL, status TEXT NOT NULL, snapshot_json TEXT, error TEXT,
        started_at TEXT NOT NULL, finished_at TEXT
      );
      CREATE TABLE audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT, action_id TEXT, event TEXT NOT NULL,
        details_json TEXT, created_at TEXT NOT NULL
      );
      `);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)').run(new Date().toISOString());
    })();
  }
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version = 2').get()) {
    const columns = db.prepare('PRAGMA table_info(scheduled_actions)').all().map((column) => column.name);
    db.transaction(() => {
      if (!columns.includes('offset_seconds')) db.exec('ALTER TABLE scheduled_actions ADD COLUMN offset_seconds INTEGER');
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)').run(new Date().toISOString());
    })();
  }
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version = 3').get()) {
    const columns = db.prepare('PRAGMA table_info(scheduler_accounts)').all().map((column) => column.name);
    db.transaction(() => {
      if (!columns.includes('connected')) {
        db.exec('ALTER TABLE scheduler_accounts ADD COLUMN connected INTEGER NOT NULL DEFAULT 1');
      }
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?)').run(new Date().toISOString());
    })();
  }
}

module.exports = { createRepository, ACTION_STATUSES, PENDING_STATUSES, migrate };
