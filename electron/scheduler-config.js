const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const KEY_FILE = 'scheduler-key.json';

function loadOrCreateKey(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const keyPath = path.join(dataDir, KEY_FILE);

    if (fs.existsSync(keyPath)) {
        const stored = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
        if (stored.encrypted) {
            if (!safeStorage.isEncryptionAvailable()) {
                throw new Error('Windows credential protection is unavailable');
            }
            return safeStorage.decryptString(Buffer.from(stored.value, 'base64'));
        }
        return stored.value;
    }

    const key = crypto.randomBytes(32).toString('base64');
    const encrypted = safeStorage.isEncryptionAvailable();
    const value = encrypted
        ? safeStorage.encryptString(key).toString('base64')
        : key;
    const temporaryPath = `${keyPath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify({ encrypted, value }), { mode: 0o600 });
    fs.renameSync(temporaryPath, keyPath);
    return key;
}

function getElectronSchedulerConfig() {
    const dataDir = path.join(app.getPath('userData'), 'scheduler');
    return {
        enabled: true,
        dataDir,
        encryptionKey: loadOrCreateKey(dataDir),
    };
}

module.exports = { getElectronSchedulerConfig, loadOrCreateKey };
