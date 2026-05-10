import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import type { WePulseConfig } from '@/common/config/wepulse';
import { WEPULSE_SUB2API_PROVIDER_ID } from '@/common/config/wepulse';

const storageState = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
}));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(async (key: string) => storageState.data[key]),
    set: vi.fn(async (key: string, value: unknown) => {
      storageState.data[key] = value;
      return value;
    }),
  },
}));

import { WePulseAuthService } from '@/process/services/wepulseAuthService';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('WePulseAuthService', () => {
  beforeEach(() => {
    storageState.data = {};
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('logs in through Sub2api and writes a WePulse model provider', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/api/v1/wepulse/auth/login')) {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toMatchObject({
          phone: '13800138000',
          password: 'secret',
        });
        return jsonResponse({
          code: 0,
          message: 'success',
          data: {
            account_id: 10,
            user_id: 20,
            phone: '13800138000',
            session_id: 'session',
            access_token: 'access',
            refresh_token: 'refresh',
            expires_in: 1800,
          },
        });
      }
      if (url.endsWith('/v1/models')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer access' });
        return jsonResponse({ data: [{ id: 'gpt-test' }, { id: 'claude-test' }] });
      }
      return jsonResponse({ message: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const status = await new WePulseAuthService().login({
      phone: '13800138000',
      password: 'secret',
    });

    expect(status).toMatchObject({
      authenticated: true,
      sub2apiBaseUrl: 'https://agent-dev.wepulse.cn',
      modelCount: 2,
      account: { phone: '13800138000' },
    });

    const config = storageState.data['wepulse.config'] as WePulseConfig;
    expect(config.accessToken).toBe('access');
    expect(config.refreshToken).toBe('refresh');
    expect(config.deviceId).toEqual(expect.any(String));

    const providers = storageState.data['model.config'] as IProvider[];
    expect(providers[0]).toMatchObject({
      id: WEPULSE_SUB2API_PROVIDER_ID,
      baseUrl: 'https://agent-dev.wepulse.cn/v1',
      apiKey: 'access',
      model: ['gpt-test', 'claude-test'],
    });
  });

  it('refreshes an expiring token before exposing status', async () => {
    storageState.data['wepulse.config'] = {
      sub2apiBaseUrl: 'https://agent-dev.wepulse.cn',
      deviceId: 'device',
      sessionId: 'old-session',
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: Date.now() - 1000,
    } satisfies WePulseConfig;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      expect(url).toBe('https://agent-dev.wepulse.cn/api/v1/wepulse/auth/refresh');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        session_id: 'old-session',
        refresh_token: 'old-refresh',
      });
      return jsonResponse({
        code: 0,
        message: 'success',
        data: {
          account_id: 10,
          user_id: 20,
          phone: '13800138000',
          session_id: 'new-session',
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 1800,
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const status = await new WePulseAuthService().status();

    expect(status.authenticated).toBe(true);
    const providers = storageState.data['model.config'] as IProvider[];
    expect(providers[0].apiKey).toBe('new-access');
    expect((storageState.data['wepulse.config'] as WePulseConfig).sessionId).toBe('new-session');
  });

  it('surfaces Sub2api auth envelope errors before parsing session fields', async () => {
    const fetchMock = vi.fn(
      async (): Promise<Response> =>
        jsonResponse({
          code: 401,
          message: 'invalid credentials',
          data: null,
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new WePulseAuthService().login({
        phone: '13800138000',
        password: 'bad-secret',
      })
    ).rejects.toThrow('invalid credentials');
  });
});
