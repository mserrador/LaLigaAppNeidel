const crypto = require('crypto');

function parseEncryptionKey(value) {
  if (Buffer.isBuffer(value) && value.length === 32) return Buffer.from(value);
  if (typeof value !== 'string') throw new Error('scheduler encryptionKey is required');
  const text = value.trim();
  const key = /^[a-f\d]{64}$/i.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64');
  if (key.length !== 32) throw new Error('scheduler encryptionKey must decode to exactly 32 bytes');
  return key;
}

function createTokenCipher(keyValue) {
  const key = parseEncryptionKey(keyValue);
  return {
    encrypt(value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return JSON.stringify({
        v: 1,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: ciphertext.toString('base64'),
      });
    },
    decrypt(payload) {
      const envelope = JSON.parse(payload);
      if (envelope.v !== 1) throw new Error('Unsupported credential envelope');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      return JSON.parse(Buffer.concat([
        decipher.update(Buffer.from(envelope.data, 'base64')),
        decipher.final(),
      ]).toString('utf8'));
    },
  };
}

module.exports = { parseEncryptionKey, createTokenCipher };
