/**
 * Kiro OAuth Device Code Flow (AWS Builder ID / IAM Identity Center).
 *
 * Implements the full 3-step flow:
 *   1. Register OIDC client → clientId + clientSecret
 *   2. Start device authorization → userCode + verificationUri
 *   3. Poll token → accessToken + refreshToken
 *
 * Adapted from the 9router reference (MIT).
 */
import { proxyAwareFetch } from '../../transport/proxy-fetch.js';
import type { TransportConfig } from '../../transport/types.js';
import { KIRO_DEFAULT_REGION } from './constants.js';

const KIRO_CLIENT_NAME = 'kelola-router-oauth';
const KIRO_CLIENT_TYPE = 'public';
const KIRO_SCOPES = [
  'codewhisperer:completions',
  'codewhisperer:analysis',
  'codewhisperer:conversations',
];
const KIRO_GRANT_TYPES = ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'];
const KIRO_ISSUER_URL = 'https://identitycenter.amazonaws.com/ssoins-722374e8c3c8e6c6';
const KIRO_BUILDER_ID_START_URL = 'https://view.awsapps.com/start';

export interface DeviceCodeStartInput {
  authMethod: 'builder-id' | 'idc';
  region?: string;
  startUrl?: string;
}

export interface DeviceCodeStartResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
  clientId: string;
  clientSecret: string;
  region: string;
  authMethod: 'builder-id' | 'idc';
  startUrl: string;
}

export interface DevicePollInput {
  deviceCode: string;
  clientId: string;
  clientSecret: string;
  region?: string;
}

export interface DevicePollResult {
  status: 'pending' | 'success' | 'error';
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  error?: string;
}

function oidcEndpoint(region: string, path: string): string {
  return `https://oidc.${region}.amazonaws.com${path}`;
}

/**
 * Register OIDC client + start device authorization in one call.
 */
export async function startDeviceCodeFlow(
  input: DeviceCodeStartInput,
  transport: TransportConfig | null = null
): Promise<DeviceCodeStartResult> {
  const region = input.region?.trim() || KIRO_DEFAULT_REGION;
  const startUrl =
    input.startUrl?.trim() || (input.authMethod === 'idc' ? '' : KIRO_BUILDER_ID_START_URL);
  if (input.authMethod === 'idc' && !startUrl) {
    throw new Error('IAM Identity Center requires a startUrl');
  }

  // Step 1: Register client
  const regResp = await proxyAwareFetch(
    oidcEndpoint(region, '/client/register'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        clientName: KIRO_CLIENT_NAME,
        clientType: KIRO_CLIENT_TYPE,
        scopes: KIRO_SCOPES,
        grantTypes: KIRO_GRANT_TYPES,
        issuerUrl: KIRO_ISSUER_URL,
      }),
    },
    transport
  );
  if (!regResp.ok) {
    const text = await regResp.text();
    throw new Error(`Client registration failed (${regResp.status}): ${text}`);
  }
  const client = (await regResp.json()) as { clientId: string; clientSecret: string };

  // Step 2: Device authorization
  const devResp = await proxyAwareFetch(
    oidcEndpoint(region, '/device_authorization'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        startUrl,
      }),
    },
    transport
  );
  if (!devResp.ok) {
    const text = await devResp.text();
    throw new Error(`Device authorization failed (${devResp.status}): ${text}`);
  }
  const dev = (await devResp.json()) as {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    expiresIn: number;
    interval?: number;
  };

  return {
    deviceCode: dev.deviceCode,
    userCode: dev.userCode,
    verificationUri: dev.verificationUri,
    verificationUriComplete: dev.verificationUriComplete,
    expiresIn: dev.expiresIn,
    interval: dev.interval || 5,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    region,
    authMethod: input.authMethod,
    startUrl,
  };
}

/**
 * Poll AWS SSO OIDC for a device code token grant.
 */
export async function pollDeviceToken(
  input: DevicePollInput,
  transport: TransportConfig | null = null
): Promise<DevicePollResult> {
  const region = input.region?.trim() || KIRO_DEFAULT_REGION;
  const resp = await proxyAwareFetch(
    oidcEndpoint(region, '/token'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        deviceCode: input.deviceCode,
        grantType: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    },
    transport
  );

  const data = (await resp.json()) as {
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    error?: string;
    error_description?: string;
  };

  if (data.accessToken) {
    return {
      status: 'success',
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn,
    };
  }

  if (data.error === 'authorization_pending' || data.error === 'slow_down') {
    return { status: 'pending' };
  }

  return {
    status: 'error',
    error: data.error_description || data.error || 'Unknown error',
  };
}
