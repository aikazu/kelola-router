import { describe, expect, it } from 'vitest';
import { buildKiroAccountFields } from './accountImport.js';

function pd(fields: { provider_data: string }): Record<string, string> {
  return JSON.parse(fields.provider_data);
}

describe('buildKiroAccountFields', () => {
  it('imports a raw refresh token as social auth', () => {
    const f = buildKiroAccountFields({ label: 'k', refreshToken: 'rt', method: 'social' });
    expect(f.api_key).toBe('rt');
    expect(pd(f).authMethod).toBe('social');
    expect(pd(f).clientId).toBeUndefined();
  });

  it('imports IAM Identity Center (idc) with clientId/secret/region', () => {
    const f = buildKiroAccountFields({
      label: 'corp',
      method: 'idc',
      refreshToken: 'rt',
      clientId: 'cid',
      clientSecret: 'sec',
      region: 'eu-central-1',
    });
    const d = pd(f);
    expect(d.authMethod).toBe('idc');
    expect(d.clientId).toBe('cid');
    expect(d.region).toBe('eu-central-1');
  });

  it('rejects idc without clientId/secret', () => {
    expect(() => buildKiroAccountFields({ method: 'idc', refreshToken: 'rt' })).toThrow();
  });

  it('imports AWS Builder ID with OIDC creds', () => {
    const f = buildKiroAccountFields({
      method: 'builder-id',
      refreshToken: 'rt',
      clientId: 'cid',
      clientSecret: 'sec',
    });
    expect(pd(f).authMethod).toBe('builder-id');
  });

  it('builder-id without OIDC creds falls back to social', () => {
    const f = buildKiroAccountFields({ method: 'builder-id', refreshToken: 'rt' });
    expect(pd(f).authMethod).toBe('social');
  });

  it('parses a pasted Kiro IDE credential JSON', () => {
    const f = buildKiroAccountFields({
      label: 'ide',
      method: 'token',
      credentialJson: JSON.stringify({
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: '2099-01-01T00:00:00.000Z',
        profileArn: 'arn:aws:codewhisperer:us-east-1:1:profile/A',
      }),
    });
    expect(f.api_key).toBe('rt');
    expect(f.access_token).toBe('at');
    expect(f.token_expires_at).toBe('2099-01-01T00:00:00.000Z');
    expect(pd(f).authMethod).toBe('social');
    expect(pd(f).profileArn).toBe('arn:aws:codewhisperer:us-east-1:1:profile/A');
  });

  it('parses an AWS SSO cache JSON (clientId/secret) as OIDC', () => {
    const f = buildKiroAccountFields({
      method: 'token',
      credentialJson: {
        accessToken: 'at',
        refreshToken: 'rt',
        region: 'us-east-1',
        clientId: 'cid',
        clientSecret: 'sec',
      },
    });
    // us-east-1 + OIDC creds infers builder-id (oidc.us-east-1)
    expect(pd(f).authMethod).toBe('builder-id');
    expect(pd(f).clientId).toBe('cid');
  });

  it('infers idc for a non-us-east-1 SSO cache JSON', () => {
    const f = buildKiroAccountFields({
      method: 'token',
      credentialJson: {
        refreshToken: 'rt',
        region: 'eu-central-1',
        clientId: 'cid',
        clientSecret: 'sec',
      },
    });
    expect(pd(f).authMethod).toBe('idc');
    expect(pd(f).region).toBe('eu-central-1');
  });

  it('throws when no refresh token is present', () => {
    expect(() => buildKiroAccountFields({ label: 'x', credentialJson: '{}' })).toThrow();
  });

  it('throws on invalid credential JSON', () => {
    expect(() => buildKiroAccountFields({ credentialJson: 'not json' })).toThrow();
  });
});
