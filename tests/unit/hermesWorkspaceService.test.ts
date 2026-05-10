/**
 * @license
 * Copyright 2026 WePulse
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  paths: {
    root: '',
    python: '',
    source: '',
    sourceTmp: '',
    venv: '',
    bin: '',
    binary: '',
    hermesHome: '',
    state: '',
  },
}));

vi.mock('@process/agent/hermes', () => ({
  getHermesRuntimePaths: () => mocks.paths,
  getManagedHermesEnv: (extra?: Record<string, string>) => ({
    ...extra,
    HERMES_HOME: mocks.paths.hermesHome,
  }),
}));

import {
  addHermesMemoryEntry,
  createHermesProfile,
  deleteHermesProfile,
  getHermesWorkspaceSnapshot,
  installBundledHermesSkill,
  readHermesLog,
  removeHermesMemoryEntry,
  saveHermesMemory,
  saveHermesPersona,
  setActiveHermesProfile,
  setHermesCredentialPool,
  setHermesEnv,
  setHermesGatewayPlatform,
  setHermesMemoryProvider,
  setHermesModelConfig,
  setHermesSkillEnabled,
  setHermesToolsetEnabled,
  uninstallHermesSkill,
  updateHermesMemoryEntry,
} from '@/process/services/hermesWorkspaceService';

const writeSkill = async (filePath: string, name: string, description: string) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    ['---', `name: ${name}`, `description: ${description}`, '---', '', `# ${name}`, ''].join('\n'),
    'utf-8'
  );
};

describe('hermesWorkspaceService', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'wepulse-hermes-workspace-'));
    mocks.paths = {
      root: path.join(tempDir, 'runtime'),
      python: path.join(tempDir, 'runtime', 'python'),
      source: path.join(tempDir, 'source'),
      sourceTmp: path.join(tempDir, 'source.tmp'),
      venv: path.join(tempDir, 'runtime', 'venv'),
      bin: path.join(tempDir, 'runtime', 'bin'),
      binary: path.join(tempDir, 'runtime', 'bin', 'hermes'),
      hermesHome: path.join(tempDir, 'home'),
      state: path.join(tempDir, 'runtime', 'install-state.json'),
    };

    await mkdir(path.join(mocks.paths.source, 'docker'), { recursive: true });
    await mkdir(path.join(mocks.paths.source, 'plugins', 'memory', 'honcho'), { recursive: true });
    await mkdir(path.join(mocks.paths.hermesHome, 'logs'), { recursive: true });
    await writeFile(path.join(mocks.paths.source, 'docker', 'SOUL.md'), '# Default Soul\n', 'utf-8');
    await writeFile(path.join(mocks.paths.source, 'plugins', 'memory', 'honcho', '__init__.py'), '', 'utf-8');
    await writeSkill(
      path.join(mocks.paths.source, 'skills', 'bundled-demo', 'SKILL.md'),
      'bundled-demo',
      'Bundled skill'
    );
    await writeSkill(
      path.join(mocks.paths.hermesHome, 'skills', 'custom-demo', 'SKILL.md'),
      'custom-demo',
      'Custom skill'
    );
    await mkdir(path.join(mocks.paths.hermesHome, 'memories'), { recursive: true });
    await writeFile(
      path.join(mocks.paths.hermesHome, 'memories', 'MEMORY.md'),
      'project facts\n§\nteam facts\n',
      'utf-8'
    );
    await writeFile(path.join(mocks.paths.hermesHome, 'memories', 'USER.md'), 'direct answers\n', 'utf-8');
    await writeFile(
      path.join(mocks.paths.hermesHome, '.env'),
      'OPENAI_API_KEY=sk-test\nTELEGRAM_BOT_TOKEN=tg\n',
      'utf-8'
    );
    await writeFile(
      path.join(mocks.paths.hermesHome, 'auth.json'),
      JSON.stringify({ credential_pool: { openai: [{ key: 'sk-a', label: 'primary' }] } }, null, 2),
      'utf-8'
    );
    await writeFile(
      path.join(mocks.paths.hermesHome, 'models.json'),
      JSON.stringify([{ id: 'm1', name: 'GPT', provider: 'openai', model: 'gpt-4.1', baseUrl: '', createdAt: 1 }]),
      'utf-8'
    );
    await writeFile(path.join(mocks.paths.hermesHome, 'logs', 'agent.log'), 'agent ready\n', 'utf-8');
    await writeFile(
      path.join(mocks.paths.hermesHome, 'config.yaml'),
      [
        'provider: "openrouter"',
        'default: "anthropic/claude-sonnet"',
        'base_url: "https://openrouter.ai/api/v1"',
        'memory:',
        '  provider: honcho',
        'skills:',
        '  disabled:',
        '    - custom-demo',
        'platform_toolsets:',
        '  cli:',
        '    - web',
        '    - memory',
        'platforms:',
        '  telegram:',
        '    enabled: true',
        'mcp_servers:',
        '  search:',
        '    url: "http://localhost:3333/mcp"',
        '',
      ].join('\n'),
      'utf-8'
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads profile-aware Hermes workspace state from the isolated runtime', async () => {
    const snapshot = await getHermesWorkspaceSnapshot();

    expect(snapshot.paths.activeHome).toBe(mocks.paths.hermesHome);
    expect(snapshot.profiles.active).toBe('default');
    expect(snapshot.providers.env.OPENAI_API_KEY).toBe('sk-test');
    expect(snapshot.providers.model).toMatchObject({ provider: 'openrouter', model: 'anthropic/claude-sonnet' });
    expect(snapshot.providers.credentialPool.openai[0]).toMatchObject({ label: 'primary', key: 'sk-a' });
    expect(snapshot.providers.savedModels[0]).toMatchObject({ name: 'GPT' });
    expect(snapshot.persona.content).toBe('# Default Soul\n');
    expect(snapshot.memory.entries).toHaveLength(2);
    expect(snapshot.memory.providers.find((provider) => provider.name === 'honcho')).toMatchObject({
      installed: true,
      active: true,
    });
    expect(snapshot.skills.installed[0]).toMatchObject({ name: 'custom-demo', enabled: false });
    expect(snapshot.skills.bundled[0]).toMatchObject({ name: 'bundled-demo', installed: false });
    expect(snapshot.tools.toolsets.find((toolset) => toolset.key === 'web')?.enabled).toBe(true);
    expect(snapshot.tools.toolsets.find((toolset) => toolset.key === 'terminal')?.enabled).toBe(false);
    expect(snapshot.tools.mcpServers[0]).toMatchObject({ name: 'search', type: 'http', enabled: true });
    expect(snapshot.gateway.platforms.find((platform) => platform.key === 'telegram')?.enabled).toBe(true);
    expect(snapshot.logs.content).toContain('agent ready');
  });

  it('creates, activates, and deletes isolated Hermes profiles', async () => {
    await createHermesProfile({ name: 'work', cloneActive: true });
    expect(existsSync(path.join(mocks.paths.hermesHome, 'profiles', 'work', 'SOUL.md'))).toBe(true);

    const active = await setActiveHermesProfile({ name: 'work' });
    expect(active.profiles.active).toBe('work');
    expect(active.paths.activeHome).toBe(path.join(mocks.paths.hermesHome, 'profiles', 'work'));

    await saveHermesPersona({ content: '# Work Soul' });
    await expect(readFile(path.join(mocks.paths.hermesHome, 'profiles', 'work', 'SOUL.md'), 'utf-8')).resolves.toBe(
      '# Work Soul\n'
    );

    const deleted = await deleteHermesProfile({ name: 'work' });
    expect(deleted.profiles.active).toBe('default');
    expect(existsSync(path.join(mocks.paths.hermesHome, 'profiles', 'work'))).toBe(false);
  });

  it('persists provider env, model config, credential pool, and gateway platform config', async () => {
    await setHermesEnv({ key: 'OPENAI_API_KEY', value: 'sk-next' });
    await setHermesModelConfig({ provider: 'openai', model: 'gpt-4.1', baseUrl: 'https://api.openai.com/v1' });
    await setHermesCredentialPool({ provider: 'openai', entries: [{ key: 'sk-next', label: 'next' }] });
    await setHermesGatewayPlatform({ platform: 'discord', enabled: true });

    await expect(readFile(path.join(mocks.paths.hermesHome, '.env'), 'utf-8')).resolves.toContain(
      'OPENAI_API_KEY=sk-next'
    );
    const config = await readFile(path.join(mocks.paths.hermesHome, 'config.yaml'), 'utf-8');
    expect(config).toContain('provider: "openai"');
    expect(config).toContain('default: "gpt-4.1"');
    expect(config).toContain('discord:');
    expect(config).toContain('enabled: true');
    await expect(readFile(path.join(mocks.paths.hermesHome, 'auth.json'), 'utf-8')).resolves.toContain(
      '"label": "next"'
    );
  });

  it('updates memory entries, memory provider, persona, and raw memory files', async () => {
    await addHermesMemoryEntry({ content: 'new fact' });
    await updateHermesMemoryEntry({ index: 0, content: 'updated fact' });
    await removeHermesMemoryEntry({ index: 1 });
    await setHermesMemoryProvider({ provider: 'mem0' });
    await saveHermesMemory({ target: 'user', content: 'prefers direct answers' });

    const snapshot = await getHermesWorkspaceSnapshot();
    expect(snapshot.memory.entries.map((entry) => entry.content)).toEqual(['updated fact', 'new fact']);
    expect(snapshot.memory.provider).toBe('mem0');
    await expect(readFile(path.join(mocks.paths.hermesHome, 'memories', 'USER.md'), 'utf-8')).resolves.toBe(
      'prefers direct answers\n'
    );
  });

  it('installs, disables, and uninstalls Hermes skills without parallel legacy state', async () => {
    await setHermesSkillEnabled({ name: 'custom-demo', enabled: true });
    await setHermesToolsetEnabled({ key: 'terminal', enabled: true });
    const installed = await installBundledHermesSkill({ id: 'bundled:skills/bundled-demo' });
    expect(installed.skills.installed.some((skill) => skill.name === 'bundled-demo')).toBe(true);

    const uninstalled = await uninstallHermesSkill({ name: 'custom-demo' });
    expect(uninstalled.skills.installed.some((skill) => skill.name === 'custom-demo')).toBe(false);
    const config = await readFile(path.join(mocks.paths.hermesHome, 'config.yaml'), 'utf-8');
    expect(config).toContain('- terminal');
  });

  it('rejects invalid inputs and reads selected logs safely', async () => {
    await expect(setHermesToolsetEnabled({ key: 'unknown', enabled: true })).rejects.toThrow('Unknown Hermes toolset');
    await expect(createHermesProfile({ name: '../bad', cloneActive: false })).rejects.toThrow('Profile name');

    const snapshot = await readHermesLog({ file: 'errors.log' });
    expect(snapshot.logs.selected).toBe('errors.log');
    expect(snapshot.logs.path).toBe(path.join(mocks.paths.hermesHome, 'logs', 'errors.log'));
  });
});
