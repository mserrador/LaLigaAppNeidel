import { buildLoginPayload, parseManualTokenInput } from './authService';

const jwt = (payload = {}) => {
  const encode = (value) => btoa(JSON.stringify(value))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payload
  })}.signature`;
};

describe('parseManualTokenInput', () => {
  it('accepts a raw JWT', () => {
    const token = jwt();
    expect(parseManualTokenInput(token)).toBe(token);
  });

  it('removes a case-insensitive Bearer prefix', () => {
    const token = jwt();
    expect(parseManualTokenInput(`bearer ${token}`)).toBe(token);
  });

  it('accepts OAuth JSON without requiring a refresh token', () => {
    const token = jwt();
    expect(parseManualTokenInput(JSON.stringify({ id_token: token }))).toEqual({ id_token: token });
  });

  it('rejects expired tokens', () => {
    const token = jwt({ exp: Math.floor(Date.now() / 1000) - 1 });
    expect(() => parseManualTokenInput(token)).toThrow('ha caducado');
  });

  it('rejects values that are not JWTs', () => {
    expect(() => parseManualTokenInput('not-a-token')).toThrow('formato JWT válido');
  });
});

describe('buildLoginPayload', () => {
  it('uses the id token as the Fantasy bearer when both tokens are present', () => {
    const accessToken = jwt({ aud: 'another-api' });
    const idToken = jwt({ aud: 'fantasy' });

    const { tokens } = buildLoginPayload({
      access_token: accessToken,
      id_token: idToken,
      refresh_token: 'refresh'
    });

    expect(tokens.access_token).toBe(idToken);
    expect(tokens.id_token).toBe(idToken);
  });
});
