import { describe, expect, it } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import {
  WEPULSE_DEFAULT_SUB2API_BASE_URL,
  WEPULSE_SUB2API_PLATFORM_ID,
  WEPULSE_SUB2API_PROVIDER_ID,
  buildWePulseGatewayBaseUrl,
  normalizeWePulseSub2apiRoot,
  removeWePulseSub2apiProvider,
  upsertWePulseSub2apiProvider,
} from '@/common/config/wepulse';

describe('wepulse config helpers', () => {
  it('normalizes Sub2api root URLs for auth endpoints', () => {
    expect(normalizeWePulseSub2apiRoot('https://agent-dev.wepulse.cn/v1/')).toBe('https://agent-dev.wepulse.cn');
    expect(normalizeWePulseSub2apiRoot('https://agent-dev.wepulse.cn/api/v1')).toBe('https://agent-dev.wepulse.cn');
    expect(normalizeWePulseSub2apiRoot('')).toBe(WEPULSE_DEFAULT_SUB2API_BASE_URL);
  });

  it('builds OpenAI-compatible gateway base URL', () => {
    expect(buildWePulseGatewayBaseUrl('https://agent-dev.wepulse.cn')).toBe('https://agent-dev.wepulse.cn/v1');
  });

  it('upserts one stable WePulse provider while preserving other providers', () => {
    const existingWePulse: IProvider = {
      id: 'legacy-wepulse',
      platform: WEPULSE_SUB2API_PLATFORM_ID,
      name: 'Old WePulse',
      baseUrl: 'https://old.example.com/v1',
      apiKey: 'old-token',
      model: ['old-model'],
      modelEnabled: { 'old-model': true },
    };
    const custom: IProvider = {
      id: 'custom',
      platform: 'custom',
      name: 'Custom',
      baseUrl: 'https://example.com/v1',
      apiKey: 'key',
      model: ['model'],
    };

    const providers = upsertWePulseSub2apiProvider(
      [custom, existingWePulse],
      { sub2apiBaseUrl: 'https://agent-dev.wepulse.cn', accessToken: 'new-token' },
      ['gpt-test']
    );

    expect(providers).toHaveLength(2);
    expect(providers[0]).toMatchObject({
      id: WEPULSE_SUB2API_PROVIDER_ID,
      platform: WEPULSE_SUB2API_PLATFORM_ID,
      baseUrl: 'https://agent-dev.wepulse.cn/v1',
      apiKey: 'new-token',
      model: ['gpt-test'],
      modelEnabled: { 'old-model': true },
    });
    expect(providers[1]).toBe(custom);
  });

  it('removes WePulse providers by stable id or platform', () => {
    const providers = removeWePulseSub2apiProvider([
      {
        id: WEPULSE_SUB2API_PROVIDER_ID,
        platform: 'custom',
        name: 'WePulse',
        baseUrl: '',
        apiKey: '',
        model: [],
      },
      {
        id: 'other',
        platform: 'custom',
        name: 'Other',
        baseUrl: '',
        apiKey: '',
        model: [],
      },
    ]);

    expect(providers.map((provider) => provider.id)).toEqual(['other']);
  });
});
