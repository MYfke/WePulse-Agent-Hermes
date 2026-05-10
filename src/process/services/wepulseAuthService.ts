/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type { IProvider } from '@/common/config/storage';
import {
  WEPULSE_AUTH_LOGIN_PATH,
  WEPULSE_AUTH_REFRESH_PATH,
  WEPULSE_HERMES_CLIENT_TITLE,
  WEPULSE_MODELS_PATH,
  WEPULSE_SUB2API_PROVIDER_ID,
  buildWePulseAuthUrl,
  normalizeWePulseSub2apiRoot,
  removeWePulseSub2apiProvider,
  upsertWePulseSub2apiProvider,
  type WePulseAccount,
  type WePulseConfig,
  type WePulseLoginRequest,
  type WePulseStatus,
} from '@/common/config/wepulse';
import { ProcessConfig } from '@process/utils/initStorage';

const REFRESH_MARGIN_MS = 60_000;
const DEFAULT_EXPIRES_IN_SECONDS = 3600;

type LoginEnvelope = {
  account_id?: number;
  accountId?: number;
  user_id?: number;
  userId?: number;
  phone?: string;
  session_id?: string;
  sessionId?: string;
  access_token?: string;
  accessToken?: string;
  refresh_token?: string;
  refreshToken?: string;
  expires_in?: number;
  expiresIn?: number;
};

type SyncOptions = {
  fetchModels?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readErrorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;

  const message = readString(payload.message);
  if (message) return message;

  const error = payload.error;
  if (typeof error === 'string' && error) return error;
  if (isRecord(error)) {
    const nested = readString(error.message);
    if (nested) return nested;
  }

  const detail = payload.detail;
  if (typeof detail === 'string' && detail) return detail;

  return fallback;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': WEPULSE_HERMES_CLIENT_TITLE,
    },
    body: JSON.stringify(body),
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(readErrorMessage(payload, `HTTP ${response.status}: ${response.statusText}`));
  }

  return payload as T;
}

function parseLoginEnvelope(payload: LoginEnvelope): {
  account: WePulseAccount;
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
} {
  const accountId = payload.account_id ?? payload.accountId ?? 0;
  const userId = payload.user_id ?? payload.userId ?? 0;
  const phone = payload.phone ?? '';
  const sessionId = payload.session_id ?? payload.sessionId ?? '';
  const accessToken = payload.access_token ?? payload.accessToken ?? '';
  const refreshToken = payload.refresh_token ?? payload.refreshToken ?? '';
  const expiresIn = payload.expires_in ?? payload.expiresIn ?? DEFAULT_EXPIRES_IN_SECONDS;

  if (!sessionId || !accessToken || !refreshToken) {
    throw new Error('Sub2api returned an incomplete WePulse auth session.');
  }

  return {
    account: {
      accountId,
      userId,
      phone,
    },
    sessionId,
    accessToken,
    refreshToken,
    expiresAt: Date.now() + Math.max(expiresIn, 1) * 1000,
  };
}

function hasSession(config: WePulseConfig): boolean {
  return Boolean(config.accessToken && config.sessionId && config.refreshToken);
}

function toStatus(config: WePulseConfig, providers: IProvider[]): WePulseStatus {
  const provider = providers.find((item) => item.id === WEPULSE_SUB2API_PROVIDER_ID);
  return {
    authenticated: hasSession(config),
    sub2apiBaseUrl: config.sub2apiBaseUrl,
    account: config.account,
    expiresAt: config.expiresAt,
    providerId: WEPULSE_SUB2API_PROVIDER_ID,
    modelCount: provider?.model?.length ?? 0,
    lastModelSyncAt: config.lastModelSyncAt,
    lastModelSyncError: config.lastModelSyncError,
  };
}

export class WePulseAuthService {
  async login(request: WePulseLoginRequest): Promise<WePulseStatus> {
    const phone = request.phone.trim();
    if (!phone || !request.password) {
      throw new Error('Phone and password are required.');
    }

    const current = await this.loadConfig();
    const sub2apiBaseUrl = normalizeWePulseSub2apiRoot(request.sub2apiBaseUrl || current.sub2apiBaseUrl);
    const response = await postJson<LoginEnvelope>(buildWePulseAuthUrl(sub2apiBaseUrl, WEPULSE_AUTH_LOGIN_PATH), {
      phone,
      password: request.password,
      device_id: current.deviceId,
    });
    const session = parseLoginEnvelope(response);
    const nextConfig: WePulseConfig = {
      ...current,
      ...session,
      sub2apiBaseUrl,
      updatedAt: Date.now(),
      lastModelSyncError: undefined,
    };

    await this.saveConfig(nextConfig);
    const syncedConfig = await this.syncProvider(nextConfig, { fetchModels: true });
    return this.getStatusFromConfig(syncedConfig);
  }

  async logout(): Promise<WePulseStatus> {
    const current = await this.loadConfig();
    const nextConfig: WePulseConfig = {
      sub2apiBaseUrl: current.sub2apiBaseUrl,
      deviceId: current.deviceId,
      updatedAt: Date.now(),
    };

    await this.saveConfig(nextConfig);
    await this.removeProvider();
    return this.getStatusFromConfig(nextConfig);
  }

  async updateConfig(sub2apiBaseUrl: string): Promise<WePulseStatus> {
    const current = await this.loadConfig();
    let nextConfig: WePulseConfig = {
      ...current,
      sub2apiBaseUrl: normalizeWePulseSub2apiRoot(sub2apiBaseUrl),
      updatedAt: Date.now(),
      lastModelSyncError: undefined,
    };
    await this.saveConfig(nextConfig);

    if (hasSession(nextConfig)) {
      nextConfig = await this.syncProvider(nextConfig, { fetchModels: true });
    }

    return this.getStatusFromConfig(nextConfig);
  }

  async status(): Promise<WePulseStatus> {
    const config = await this.ensureFreshSession({ fetchModels: false });
    return this.getStatusFromConfig(config);
  }

  async syncModels(): Promise<WePulseStatus> {
    const config = await this.ensureFreshSession({ fetchModels: false });
    if (!hasSession(config)) {
      throw new Error('Please sign in with your WePulse account first.');
    }
    const syncedConfig = await this.syncProvider(config, { fetchModels: true });
    return this.getStatusFromConfig(syncedConfig);
  }

  async ensureProviderSession(): Promise<void> {
    const config = await this.ensureFreshSession({ fetchModels: false });
    if (hasSession(config)) {
      await this.writeProvider(config);
    }
  }

  private async ensureFreshSession(options: SyncOptions): Promise<WePulseConfig> {
    const config = await this.loadConfig();
    if (!hasSession(config)) return config;

    const shouldRefresh = !config.expiresAt || config.expiresAt <= Date.now() + REFRESH_MARGIN_MS;
    if (!shouldRefresh) {
      await this.writeProvider(config);
      return config;
    }

    try {
      const refreshed = await this.refreshSession(config);
      return options.fetchModels ? this.syncProvider(refreshed, options) : refreshed;
    } catch (error) {
      console.warn('[WePulse] Refresh failed, clearing local session:', error);
      await this.logout();
      return this.loadConfig();
    }
  }

  private async refreshSession(config: WePulseConfig): Promise<WePulseConfig> {
    if (!config.sessionId || !config.refreshToken) {
      throw new Error('Missing WePulse refresh credentials.');
    }

    const response = await postJson<LoginEnvelope>(
      buildWePulseAuthUrl(config.sub2apiBaseUrl, WEPULSE_AUTH_REFRESH_PATH),
      {
        session_id: config.sessionId,
        refresh_token: config.refreshToken,
      }
    );
    const session = parseLoginEnvelope(response);
    const nextConfig: WePulseConfig = {
      ...config,
      ...session,
      updatedAt: Date.now(),
      lastModelSyncError: undefined,
    };
    await this.saveConfig(nextConfig);
    await this.writeProvider(nextConfig);
    return nextConfig;
  }

  private async syncProvider(config: WePulseConfig, options: SyncOptions): Promise<WePulseConfig> {
    let models: string[] | undefined;
    let lastModelSyncError: string | undefined;
    let lastModelSyncAt = config.lastModelSyncAt;

    if (options.fetchModels !== false) {
      try {
        models = await this.fetchModelIds(config);
        lastModelSyncAt = Date.now();
      } catch (error) {
        lastModelSyncError = error instanceof Error ? error.message : String(error);
        console.warn('[WePulse] Failed to sync Sub2api models:', error);
      }
    }

    await this.writeProvider(config, models);
    const nextConfig: WePulseConfig = {
      ...config,
      lastModelSyncAt,
      lastModelSyncError,
      updatedAt: Date.now(),
    };
    await this.saveConfig(nextConfig);
    return nextConfig;
  }

  private async fetchModelIds(config: WePulseConfig): Promise<string[]> {
    if (!config.accessToken) {
      throw new Error('Missing WePulse access token.');
    }

    const response = await fetch(buildWePulseAuthUrl(config.sub2apiBaseUrl, WEPULSE_MODELS_PATH), {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'User-Agent': WEPULSE_HERMES_CLIENT_TITLE,
      },
    });
    const payload = await readJson(response);

    if (!response.ok) {
      throw new Error(readErrorMessage(payload, `HTTP ${response.status}: ${response.statusText}`));
    }

    if (!isRecord(payload) || !Array.isArray(payload.data)) {
      throw new Error('Sub2api returned an invalid model list.');
    }

    return payload.data
      .map((item) => {
        if (typeof item === 'string') return item;
        if (isRecord(item)) return readString(item.id);
        return '';
      })
      .filter((id) => id.length > 0);
  }

  private async writeProvider(config: WePulseConfig, models?: string[]): Promise<void> {
    if (!config.accessToken) return;
    const providers = await this.loadProviders();
    const nextProviders = upsertWePulseSub2apiProvider(providers, config, models);
    await ProcessConfig.set('model.config', nextProviders);
  }

  private async removeProvider(): Promise<void> {
    const providers = await this.loadProviders();
    await ProcessConfig.set('model.config', removeWePulseSub2apiProvider(providers));
  }

  private async getStatusFromConfig(config: WePulseConfig): Promise<WePulseStatus> {
    return toStatus(config, await this.loadProviders());
  }

  private async loadProviders(): Promise<IProvider[]> {
    const providers = await ProcessConfig.get('model.config').catch((): IProvider[] => []);
    return Array.isArray(providers) ? providers : [];
  }

  private async loadConfig(): Promise<WePulseConfig> {
    const stored = await ProcessConfig.get('wepulse.config').catch((): WePulseConfig | undefined => undefined);
    const envBaseUrl = process.env.WEPULSE_SUB2API_BASE_URL || process.env.WEPULSE_HERMES_SUB2API_BASE_URL;
    const nextConfig: WePulseConfig = {
      ...stored,
      sub2apiBaseUrl: normalizeWePulseSub2apiRoot(stored?.sub2apiBaseUrl || envBaseUrl),
      deviceId: stored?.deviceId || randomUUID(),
    };

    if (stored?.sub2apiBaseUrl !== nextConfig.sub2apiBaseUrl || stored?.deviceId !== nextConfig.deviceId) {
      await this.saveConfig(nextConfig);
    }

    return nextConfig;
  }

  private async saveConfig(config: WePulseConfig): Promise<void> {
    await ProcessConfig.set('wepulse.config', config);
  }
}

export const wePulseAuthService = new WePulseAuthService();

export async function ensureWePulseProviderSession(): Promise<void> {
  await wePulseAuthService.ensureProviderSession();
}
