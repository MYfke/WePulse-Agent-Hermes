/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: vi.fn(() => {
      const handlerMap = new Map<string, Function>();
      return {
        provider: vi.fn((handler: Function) => {
          handlerMap.set('handler', handler);
          return vi.fn();
        }),
        invoke: vi.fn(),
        _getHandler: () => handlerMap.get('handler'),
      };
    }),
    buildEmitter: vi.fn(() => ({
      emit: vi.fn(),
      on: vi.fn(),
    })),
  },
  storage: {
    buildStorage: () => ({
      getSync: () => undefined,
      setSync: () => {},
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(),
    }),
  },
}));

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/test/path'),
    isPackaged: true,
  },
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    logger: null,
    autoDownload: false,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    allowDowngrade: false,
    on: vi.fn(),
    removeListener: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    checkForUpdatesAndNotify: vi.fn(),
  },
}));

vi.mock('electron-log', () => ({
  default: {
    transports: { file: { level: 'info' } },
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const makeGitHubReleaseResponse = () => [
  {
    tag_name: 'v1.9.22',
    name: 'v1.9.22',
    body: 'release notes',
    html_url: 'https://github.com/MYfke/WePulse-Agent-Hermes/releases/tag/v1.9.22',
    published_at: '2026-04-29T00:00:00Z',
    prerelease: false,
    draft: false,
    assets: [
      {
        name: 'WePulse-Agent-Hermes-1.9.22-mac-arm64.dmg',
        browser_download_url:
          'https://github.com/MYfke/WePulse-Agent-Hermes/releases/download/v1.9.22/WePulse-Agent-Hermes-1.9.22-mac-arm64.dmg',
        size: 123,
        content_type: 'application/x-apple-diskimage',
      },
      {
        name: 'WePulse-Agent-Hermes-1.9.22-win-x64.exe',
        browser_download_url:
          'https://github.com/MYfke/WePulse-Agent-Hermes/releases/download/v1.9.22/WePulse-Agent-Hermes-1.9.22-win-x64.exe',
        size: 456,
        content_type: 'application/vnd.microsoft.portable-executable',
      },
      {
        name: 'WePulse-Agent-Hermes-1.9.22-linux-amd64.deb',
        browser_download_url:
          'https://github.com/MYfke/WePulse-Agent-Hermes/releases/download/v1.9.22/WePulse-Agent-Hermes-1.9.22-linux-amd64.deb',
        size: 789,
      },
    ],
  },
];

const getCheckHandler = async () => {
  vi.resetModules();
  const { initUpdateBridge } = await import('@process/bridge/updateBridge');
  const { ipcBridge } = await import('@/common');

  initUpdateBridge();

  const provider = vi.mocked(ipcBridge.update.check.provider);
  const lastCall = provider.mock.calls.at(-1);
  if (!lastCall) throw new Error('update.check handler not registered');
  return lastCall[0];
};

describe('updateBridge GitHub release URL mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the GitHub release asset URL directly', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeGitHubReleaseResponse(),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const handler = await getCheckHandler();
      const result = await handler({ repo: 'MYfke/WePulse-Agent-Hermes' });

      expect(result.success).toBe(true);
      const assets = result.data?.latest?.assets ?? [];
      expect(assets.length).toBe(3);

      const macAsset = assets.find((a: { name: string }) => a.name === 'WePulse-Agent-Hermes-1.9.22-mac-arm64.dmg');
      expect(macAsset).toBeDefined();
      expect(macAsset?.url).toBe(
        'https://github.com/MYfke/WePulse-Agent-Hermes/releases/download/v1.9.22/WePulse-Agent-Hermes-1.9.22-mac-arm64.dmg'
      );
      expect(macAsset?.fallbackUrl).toBeUndefined();

      const linuxAsset = assets.find((a: { name: string }) => a.name === 'WePulse-Agent-Hermes-1.9.22-linux-amd64.deb');
      expect(linuxAsset?.url).toBe(
        'https://github.com/MYfke/WePulse-Agent-Hermes/releases/download/v1.9.22/WePulse-Agent-Hermes-1.9.22-linux-amd64.deb'
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the original release asset tag path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeGitHubReleaseResponse(),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const handler = await getCheckHandler();
      const result = await handler({ repo: 'MYfke/WePulse-Agent-Hermes' });
      const asset = result.data?.latest?.assets?.[0];
      expect(asset?.url).toMatch(
        /^https:\/\/github\.com\/MYfke\/WePulse-Agent-Hermes\/releases\/download\/v1\.9\.22\//
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('updateBridge download allowlist', () => {
  it('accepts GitHub release URLs for download', async () => {
    vi.resetModules();
    vi.clearAllMocks();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '0' }),
      body: {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined }),
        }),
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const { initUpdateBridge } = await import('@process/bridge/updateBridge');
      const { ipcBridge } = await import('@/common');

      initUpdateBridge();

      const provider = vi.mocked(ipcBridge.update.download.provider);
      const lastCall = provider.mock.calls.at(-1);
      if (!lastCall) throw new Error('update.download handler not registered');
      const handler = lastCall[0];

      const result = await handler({
        url: 'https://github.com/MYfke/WePulse-Agent-Hermes/releases/download/v1.9.22/WePulse-Agent-Hermes-1.9.22-mac-arm64.dmg',
        fileName: 'WePulse-Agent-Hermes-1.9.22-mac-arm64.dmg',
      });

      expect(result.success).toBe(true);
      expect(result.data?.downloadId).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects non-allowlisted hosts', async () => {
    vi.resetModules();
    vi.clearAllMocks();

    const { initUpdateBridge } = await import('@process/bridge/updateBridge');
    const { ipcBridge } = await import('@/common');

    initUpdateBridge();

    const provider = vi.mocked(ipcBridge.update.download.provider);
    const lastCall = provider.mock.calls.at(-1);
    if (!lastCall) throw new Error('update.download handler not registered');
    const handler = lastCall[0];

    const result = await handler({
      url: 'https://evil.example.com/fake.dmg',
      fileName: 'fake.dmg',
    });

    // Download is refused before any network I/O; exact error text comes from i18n and isn't asserted here.
    expect(result.success).toBe(false);
  });
});
