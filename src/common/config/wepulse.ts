/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider } from './storage';

export const WEPULSE_SUB2API_PLATFORM_ID = 'wepulse-sub2api';
export const WEPULSE_SUB2API_PROVIDER_ID = 'wepulse-sub2api';
export const WEPULSE_SUB2API_PROVIDER_NAME = 'WePulse Sub2api';
export const WEPULSE_HERMES_CLIENT_TITLE = 'WePulse Hermes';
export const WEPULSE_DEFAULT_SUB2API_BASE_URL = 'https://agent-dev.wepulse.cn';
export const WEPULSE_AUTH_LOGIN_PATH = '/api/v1/wepulse/auth/login';
export const WEPULSE_AUTH_REFRESH_PATH = '/api/v1/wepulse/auth/refresh';
export const WEPULSE_MODELS_PATH = '/v1/models';

export type WePulseAccount = {
  accountId: number;
  userId: number;
  phone: string;
};

export type WePulseConfig = {
  sub2apiBaseUrl: string;
  deviceId: string;
  sessionId?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  account?: WePulseAccount;
  lastModelSyncAt?: number;
  lastModelSyncError?: string;
  updatedAt?: number;
};

export type WePulseLoginRequest = {
  phone: string;
  password: string;
  sub2apiBaseUrl?: string;
};

export type WePulseConfigUpdateRequest = {
  sub2apiBaseUrl: string;
};

export type WePulseStatus = {
  authenticated: boolean;
  sub2apiBaseUrl: string;
  account?: WePulseAccount;
  expiresAt?: number;
  providerId: string;
  modelCount: number;
  lastModelSyncAt?: number;
  lastModelSyncError?: string;
};

export const isWePulseSub2apiPlatform = (platform: string | undefined): boolean => {
  return platform === WEPULSE_SUB2API_PLATFORM_ID;
};

export const isWePulseSub2apiProvider = (provider: Pick<IProvider, 'id' | 'platform'>): boolean => {
  return provider.id === WEPULSE_SUB2API_PROVIDER_ID || isWePulseSub2apiPlatform(provider.platform);
};

export function normalizeWePulseSub2apiRoot(rawBaseUrl?: string): string {
  const fallback = WEPULSE_DEFAULT_SUB2API_BASE_URL;
  const trimmed = (rawBaseUrl || fallback).trim();
  if (!trimmed) return fallback;

  return trimmed
    .replace(/\/+$/, '')
    .replace(/\/api\/v1$/i, '')
    .replace(/\/v1$/i, '');
}

export function buildWePulseAuthUrl(baseUrl: string, path: string): string {
  return `${normalizeWePulseSub2apiRoot(baseUrl)}${path}`;
}

export function buildWePulseGatewayBaseUrl(baseUrl: string): string {
  return `${normalizeWePulseSub2apiRoot(baseUrl)}/v1`;
}

export function upsertWePulseSub2apiProvider(
  providers: IProvider[] | undefined,
  config: Pick<WePulseConfig, 'sub2apiBaseUrl' | 'accessToken'>,
  models?: string[]
): IProvider[] {
  const sourceProviders = Array.isArray(providers) ? providers : [];
  const existing = sourceProviders.find(isWePulseSub2apiProvider);
  const nextModels = models ?? existing?.model ?? [];

  const nextProvider: IProvider = {
    ...existing,
    id: WEPULSE_SUB2API_PROVIDER_ID,
    platform: WEPULSE_SUB2API_PLATFORM_ID,
    name: WEPULSE_SUB2API_PROVIDER_NAME,
    baseUrl: buildWePulseGatewayBaseUrl(config.sub2apiBaseUrl),
    apiKey: config.accessToken || '',
    model: nextModels,
    enabled: true,
  };

  const withoutWePulse = sourceProviders.filter((provider) => !isWePulseSub2apiProvider(provider));
  return [nextProvider, ...withoutWePulse];
}

export function removeWePulseSub2apiProvider(providers: IProvider[] | undefined): IProvider[] {
  if (!Array.isArray(providers)) return [];
  return providers.filter((provider) => !isWePulseSub2apiProvider(provider));
}
