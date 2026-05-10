import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WePulseConfig } from '@/common/config/wepulse';

const mocks = vi.hoisted(() => ({
  loadFullShellEnvironment: vi.fn(),
  getEnhancedEnv: vi.fn(),
  processConfigGet: vi.fn(),
  ensureWePulseProviderSession: vi.fn(),
}));

vi.mock('@process/utils/shellEnv', () => ({
  loadFullShellEnvironment: mocks.loadFullShellEnvironment,
  getEnhancedEnv: mocks.getEnhancedEnv,
}));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: mocks.processConfigGet,
  },
}));

vi.mock('@process/services/wepulseAuthService', () => ({
  ensureWePulseProviderSession: mocks.ensureWePulseProviderSession,
}));

import { loadAuthCredentials } from '@process/acp/compat/typeBridge';

describe('loadAuthCredentials for Hermes Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadFullShellEnvironment.mockResolvedValue({});
    mocks.getEnhancedEnv.mockReturnValue({});
    mocks.ensureWePulseProviderSession.mockResolvedValue(undefined);
    mocks.processConfigGet.mockResolvedValue(undefined);
  });

  it('injects the active WePulse Sub2api session into Hermes ACP env credentials', async () => {
    mocks.processConfigGet.mockResolvedValue({
      sub2apiBaseUrl: 'https://agent-dev.wepulse.cn',
      deviceId: 'device',
      accessToken: 'wepulse-access-token',
    } satisfies WePulseConfig);

    await expect(loadAuthCredentials('hermes')).resolves.toEqual({
      HERMES_INFERENCE_PROVIDER: 'custom',
      OPENAI_API_KEY: 'wepulse-access-token',
      OPENAI_BASE_URL: 'https://agent-dev.wepulse.cn/v1',
      CUSTOM_BASE_URL: 'https://agent-dev.wepulse.cn/v1',
    });
    expect(mocks.ensureWePulseProviderSession).toHaveBeenCalledOnce();
    expect(mocks.processConfigGet).toHaveBeenCalledWith('wepulse.config');
  });

  it('lets WePulse credentials override stale shell OpenAI credentials', async () => {
    mocks.loadFullShellEnvironment.mockResolvedValue({
      OPENAI_API_KEY: 'stale-shell-key',
      OPENAI_BASE_URL: 'https://stale.example/v1',
    });
    mocks.processConfigGet.mockResolvedValue({
      sub2apiBaseUrl: 'https://agent-dev.wepulse.cn',
      deviceId: 'device',
      accessToken: 'fresh-wepulse-token',
    } satisfies WePulseConfig);

    const credentials = await loadAuthCredentials('hermes');

    expect(credentials?.OPENAI_API_KEY).toBe('fresh-wepulse-token');
    expect(credentials?.OPENAI_BASE_URL).toBe('https://agent-dev.wepulse.cn/v1');
  });
});
