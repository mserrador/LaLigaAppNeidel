const SECRET_KEYS = /authorization|token|password|secret|cookie/i;

function redact(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, SECRET_KEYS.test(key) ? '[REDACTED]' : redact(item, seen),
  ]));
}

function createLogger(base = console) {
  const write = (level, event, details = {}) => {
    const method = typeof base[level] === 'function' ? level : 'log';
    base[method](JSON.stringify({ time: new Date().toISOString(), component: 'scheduler', event, ...redact(details) }));
  };
  return {
    info: (event, details) => write('info', event, details),
    warn: (event, details) => write('warn', event, details),
    error: (event, details) => write('error', event, details),
  };
}

module.exports = { createLogger, redact };
