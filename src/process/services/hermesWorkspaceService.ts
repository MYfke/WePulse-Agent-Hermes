/**
 * @license
 * Copyright 2026 WePulse
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  HermesAddMemoryEntryRequest,
  HermesCreateProfileRequest,
  HermesCredentialEntry,
  HermesDeleteProfileRequest,
  HermesGatewayPlatformInfo,
  HermesInstallBundledSkillRequest,
  HermesMemoryEntry,
  HermesMemoryFileInfo,
  HermesMemoryProviderInfo,
  HermesMcpServerInfo,
  HermesModelConfig,
  HermesProfileInfo,
  HermesReadLogRequest,
  HermesRemoveMemoryEntryRequest,
  HermesSaveMemoryRequest,
  HermesSavePersonaRequest,
  HermesSavedModel,
  HermesSetActiveProfileRequest,
  HermesSetCredentialPoolRequest,
  HermesSetEnvRequest,
  HermesSetGatewayPlatformRequest,
  HermesSetMemoryProviderRequest,
  HermesSetModelConfigRequest,
  HermesSetSkillEnabledRequest,
  HermesSetToolsetEnabledRequest,
  HermesSkillInfo,
  HermesSkillsState,
  HermesToolsetInfo,
  HermesToolsState,
  HermesUninstallSkillRequest,
  HermesUpdateMemoryEntryRequest,
  HermesWorkspaceSnapshot,
} from '@/common/types/hermesWorkspace';
import { getHermesRuntimePaths, getManagedHermesEnv } from '@process/agent/hermes';

const DEFAULT_SOUL_MD = [
  '# Hermes Persona',
  '',
  'You are Hermes, the WePulse desktop agent. Be direct, practical, and careful with local tools.',
  '',
].join('\n');

const YAML_LIST_INDENT = '    ';
const MEMORY_ENTRY_DELIMITER = '\n§\n';
const MEMORY_CHAR_LIMIT = 2200;
const USER_CHAR_LIMIT = 1375;
const LOG_FILES = ['agent.log', 'errors.log', 'gateway.log'] as const;
const CONFIGURABLE_TOOLSETS: Array<Omit<HermesToolsetInfo, 'enabled'>> = [
  {
    key: 'web',
    label: 'Web Search & Scraping',
    description: 'web_search, web_extract',
    defaultEnabled: true,
  },
  {
    key: 'browser',
    label: 'Browser Automation',
    description: 'navigate, click, type, scroll',
    defaultEnabled: true,
  },
  {
    key: 'terminal',
    label: 'Terminal & Processes',
    description: 'terminal, process',
    defaultEnabled: true,
  },
  {
    key: 'file',
    label: 'File Operations',
    description: 'read, write, patch, search',
    defaultEnabled: true,
  },
  {
    key: 'code_execution',
    label: 'Code Execution',
    description: 'execute_code',
    defaultEnabled: true,
  },
  {
    key: 'vision',
    label: 'Vision / Image Analysis',
    description: 'vision_analyze',
    defaultEnabled: true,
  },
  {
    key: 'video',
    label: 'Video Analysis',
    description: 'video_analyze',
    defaultEnabled: false,
  },
  {
    key: 'image_gen',
    label: 'Image Generation',
    description: 'image_generate',
    defaultEnabled: true,
  },
  {
    key: 'moa',
    label: 'Mixture of Agents',
    description: 'mixture_of_agents',
    defaultEnabled: false,
  },
  {
    key: 'tts',
    label: 'Text-to-Speech',
    description: 'text_to_speech',
    defaultEnabled: true,
  },
  {
    key: 'skills',
    label: 'Skills',
    description: 'list, view, manage',
    defaultEnabled: true,
  },
  {
    key: 'todo',
    label: 'Task Planning',
    description: 'todo',
    defaultEnabled: true,
  },
  {
    key: 'memory',
    label: 'Memory',
    description: 'persistent memory across sessions',
    defaultEnabled: true,
  },
  {
    key: 'session_search',
    label: 'Session Search',
    description: 'search past conversations',
    defaultEnabled: true,
  },
  {
    key: 'clarify',
    label: 'Clarifying Questions',
    description: 'clarify',
    defaultEnabled: true,
  },
  {
    key: 'delegation',
    label: 'Task Delegation',
    description: 'delegate_task',
    defaultEnabled: true,
  },
  {
    key: 'cronjob',
    label: 'Cron Jobs',
    description: 'create/list/update/pause/resume/run',
    defaultEnabled: true,
  },
  {
    key: 'messaging',
    label: 'Cross-Platform Messaging',
    description: 'send_message',
    defaultEnabled: true,
  },
  {
    key: 'rl',
    label: 'RL Training',
    description: 'Tinker-Atropos training tools',
    defaultEnabled: false,
  },
  {
    key: 'homeassistant',
    label: 'Home Assistant',
    description: 'smart home device control',
    defaultEnabled: false,
  },
  {
    key: 'spotify',
    label: 'Spotify',
    description: 'playback, search, playlists, library',
    defaultEnabled: false,
  },
  {
    key: 'discord',
    label: 'Discord',
    description: 'fetch messages, search members, create thread',
    defaultEnabled: false,
  },
  {
    key: 'discord_admin',
    label: 'Discord Server Admin',
    description: 'list channels/roles, pin, assign roles',
    defaultEnabled: false,
  },
  {
    key: 'yuanbao',
    label: 'Yuanbao',
    description: 'group info, member queries, DM',
    defaultEnabled: true,
  },
  {
    key: 'computer_use',
    label: 'Computer Use (macOS)',
    description: 'background desktop control via cua-driver',
    defaultEnabled: process.platform === 'darwin',
  },
];

const PROVIDER_ENV_KEYS = [
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'XAI_API_KEY',
  'GROQ_API_KEY',
  'QWEN_API_KEY',
  'MINIMAX_API_KEY',
  'HF_TOKEN',
  'DEEPSEEK_API_KEY',
  'TOGETHER_API_KEY',
  'FIREWORKS_API_KEY',
  'CEREBRAS_API_KEY',
  'MISTRAL_API_KEY',
  'CUSTOM_API_KEY',
  'EXA_API_KEY',
  'PARALLEL_API_KEY',
  'TAVILY_API_KEY',
  'FIRECRAWL_API_KEY',
  'FAL_KEY',
  'HONCHO_API_KEY',
  'BROWSERBASE_API_KEY',
  'BROWSERBASE_PROJECT_ID',
  'VOICE_TOOLS_OPENAI_KEY',
  'TINKER_API_KEY',
  'WANDB_API_KEY',
];

const GATEWAY_PLATFORMS: Array<Omit<HermesGatewayPlatformInfo, 'enabled'>> = [
  {
    key: 'telegram',
    label: 'Telegram',
    description: 'Telegram Bot gateway',
    fields: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_USERS'],
  },
  {
    key: 'discord',
    label: 'Discord',
    description: 'Discord Bot gateway',
    fields: ['DISCORD_BOT_TOKEN', 'DISCORD_ALLOWED_CHANNELS'],
  },
  {
    key: 'slack',
    label: 'Slack',
    description: 'Slack gateway',
    fields: ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'],
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    description: 'WhatsApp gateway',
    fields: ['WHATSAPP_API_URL', 'WHATSAPP_API_TOKEN'],
  },
  {
    key: 'signal',
    label: 'Signal',
    description: 'Signal gateway',
    fields: ['SIGNAL_PHONE_NUMBER'],
  },
  {
    key: 'matrix',
    label: 'Matrix',
    description: 'Matrix gateway',
    fields: ['MATRIX_HOMESERVER', 'MATRIX_USER_ID', 'MATRIX_ACCESS_TOKEN'],
  },
  {
    key: 'mattermost',
    label: 'Mattermost',
    description: 'Mattermost gateway',
    fields: ['MATTERMOST_URL', 'MATTERMOST_TOKEN'],
  },
  {
    key: 'email',
    label: 'Email',
    description: 'IMAP/SMTP gateway',
    fields: ['EMAIL_IMAP_SERVER', 'EMAIL_SMTP_SERVER', 'EMAIL_ADDRESS', 'EMAIL_PASSWORD'],
  },
  {
    key: 'sms',
    label: 'SMS',
    description: 'SMS gateway',
    fields: ['SMS_PROVIDER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'],
  },
  {
    key: 'bluebubbles',
    label: 'iMessage',
    description: 'BlueBubbles iMessage gateway',
    fields: ['BLUEBUBBLES_URL', 'BLUEBUBBLES_PASSWORD'],
  },
  {
    key: 'dingtalk',
    label: 'DingTalk',
    description: 'DingTalk gateway',
    fields: ['DINGTALK_APP_KEY', 'DINGTALK_APP_SECRET'],
  },
  {
    key: 'feishu',
    label: 'Feishu / Lark',
    description: 'Feishu or Lark gateway',
    fields: ['FEISHU_APP_ID', 'FEISHU_APP_SECRET'],
  },
  {
    key: 'wecom',
    label: 'WeCom',
    description: 'Enterprise WeChat gateway',
    fields: ['WECOM_CORP_ID', 'WECOM_AGENT_ID', 'WECOM_SECRET'],
  },
  {
    key: 'weixin',
    label: 'WeChat',
    description: 'WeChat gateway',
    fields: ['WEIXIN_BOT_TOKEN'],
  },
  {
    key: 'webhooks',
    label: 'Webhooks',
    description: 'Webhook gateway',
    fields: ['WEBHOOK_SECRET'],
  },
  {
    key: 'homeassistant',
    label: 'Home Assistant',
    description: 'Home Assistant gateway',
    fields: ['HA_URL', 'HA_TOKEN'],
  },
  {
    key: 'yuanbao',
    label: 'Yuanbao',
    description: 'Tencent Yuanbao gateway',
    fields: ['YUANBAO_APP_ID', 'YUANBAO_APP_SECRET', 'YUANBAO_BOT_ID'],
  },
];

const KNOWN_MEMORY_PROVIDERS: Record<string, { description: string; envVars: string[] }> = {
  honcho: { description: 'Honcho memory provider', envVars: ['HONCHO_API_KEY'] },
  hindsight: { description: 'Hindsight memory provider', envVars: ['HINDSIGHT_API_KEY'] },
  mem0: { description: 'Mem0 memory provider', envVars: ['MEM0_API_KEY'] },
  retaindb: { description: 'RetainDB memory provider', envVars: ['RETAINDB_API_KEY'] },
  supermemory: { description: 'Supermemory memory provider', envVars: ['SUPERMEMORY_API_KEY'] },
  byterover: { description: 'ByteRover memory provider', envVars: ['BYTEROVER_API_KEY'] },
};

const PROVIDER_AND_GATEWAY_ENV_KEYS = [
  ...new Set([...PROVIDER_ENV_KEYS, ...GATEWAY_PLATFORMS.flatMap((platform) => platform.fields)]),
].sort();

type HermesRuntimeWorkspacePaths = ReturnType<typeof getHermesRuntimePaths> & {
  configPath: string;
  envPath: string;
  authPath: string;
  modelsPath: string;
  profilesDir: string;
  activeProfilePath: string;
  memoriesDir: string;
  skillsDir: string;
  personaPath: string;
  defaultPersonaPath: string;
};

let gatewayProcess: ChildProcess | null = null;

type ParsedSkill = {
  name: string;
  description: string;
  category?: string;
  content: string;
};

function getActiveProfileName(paths = getHermesRuntimePaths()): string {
  const activeProfilePath = path.join(paths.hermesHome, 'active_profile');
  try {
    const name = readFileSync(activeProfilePath, 'utf-8').trim();
    return name || 'default';
  } catch {
    return 'default';
  }
}

function sanitizeProfileName(name: string): string {
  const normalized = name.trim();
  if (!normalized || normalized === 'default') return 'default';
  if (!/^[A-Za-z0-9_.-]+$/.test(normalized) || normalized.includes('..')) {
    throw new Error('Profile name can only contain letters, numbers, dot, underscore, and dash.');
  }
  return normalized;
}

function profileHome(root: string, profile = getActiveProfileName()): string {
  const name = sanitizeProfileName(profile);
  return name === 'default' ? root : path.join(root, 'profiles', name);
}

function getWorkspacePaths(profile = getActiveProfileName()): HermesRuntimeWorkspacePaths {
  const paths = getHermesRuntimePaths();
  const activeHome = profileHome(paths.hermesHome, profile);
  return {
    ...paths,
    configPath: path.join(activeHome, 'config.yaml'),
    envPath: path.join(activeHome, '.env'),
    authPath: path.join(paths.hermesHome, 'auth.json'),
    modelsPath: path.join(paths.hermesHome, 'models.json'),
    profilesDir: path.join(paths.hermesHome, 'profiles'),
    activeProfilePath: path.join(paths.hermesHome, 'active_profile'),
    memoriesDir: path.join(activeHome, 'memories'),
    skillsDir: path.join(activeHome, 'skills'),
    personaPath: path.join(activeHome, 'SOUL.md'),
    defaultPersonaPath: path.join(paths.source, 'docker', 'SOUL.md'),
  };
}

async function readText(filePath: string, fallback = ''): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return fallback;
  }
}

async function ensureWorkspaceDirs(paths = getWorkspacePaths()): Promise<void> {
  await mkdir(paths.hermesHome, { recursive: true });
  await mkdir(path.dirname(paths.configPath), { recursive: true });
  await mkdir(paths.profilesDir, { recursive: true });
  await mkdir(paths.memoriesDir, { recursive: true });
  await mkdir(paths.skillsDir, { recursive: true });
  await mkdir(path.join(path.dirname(paths.configPath), 'cron'), { recursive: true });
  await mkdir(path.join(path.dirname(paths.configPath), 'sessions'), { recursive: true });
  await mkdir(path.join(paths.hermesHome, 'logs'), { recursive: true });
}

async function ensurePersonaFile(paths = getWorkspacePaths()): Promise<string> {
  const defaultContent = await readText(paths.defaultPersonaPath, DEFAULT_SOUL_MD);
  if (!existsSync(paths.personaPath)) {
    await writeFile(paths.personaPath, defaultContent, 'utf-8');
  }
  return defaultContent;
}

function stripYamlComment(value: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "'" && !inDouble) inSingle = !inSingle;
    if (char === '"' && !inSingle && value[i - 1] !== '\\') inDouble = !inDouble;
    if (char === '#' && !inSingle && !inDouble) {
      return value.slice(0, i).trim();
    }
  }
  return value.trim();
}

function normalizeYamlScalar(value: string): string {
  const trimmed = stripYamlComment(value).trim().replace(/,$/, '').trim();
  if (!trimmed) return '';
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineYamlList(value: string): string[] | null {
  const trimmed = stripYamlComment(value);
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const body = trimmed.slice(1, -1).trim();
  if (!body) return [];
  return body
    .split(',')
    .map((item) => normalizeYamlScalar(item))
    .filter(Boolean);
}

function findTopLevelSection(lines: string[], section: string): { start: number; end: number } | null {
  const sectionPattern = new RegExp(`^${section}:\\s*(?:#.*)?$`);
  const start = lines.findIndex((line) => sectionPattern.test(line));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[A-Za-z0-9_.-]+:\s*/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function parseYamlList(content: string, section: string, key: string): string[] | null {
  const lines = content.split(/\r?\n/);
  const range = findTopLevelSection(lines, section);
  if (!range) return null;

  const keyPattern = new RegExp(`^(\\s*)${key}:\\s*(.*)$`);
  for (let i = range.start + 1; i < range.end; i++) {
    const match = lines[i].match(keyPattern);
    if (!match) continue;

    const inline = parseInlineYamlList(match[2]);
    if (inline) return inline;

    const keyIndent = match[1].length;
    const values: string[] = [];
    for (let j = i + 1; j < range.end; j++) {
      const line = lines[j];
      if (!line.trim()) continue;
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= keyIndent) break;
      const item = line.match(/^\s*-\s+(.+)$/);
      if (item) {
        const value = normalizeYamlScalar(item[1]);
        if (value) values.push(value);
      }
    }
    return values;
  }

  return null;
}

function parseYamlScalar(content: string, section: string, key: string): string {
  const lines = content.split(/\r?\n/);
  const range = findTopLevelSection(lines, section);
  if (!range) return '';
  const keyPattern = new RegExp(`^\\s*${key}:\\s*(.*)$`);
  for (let i = range.start + 1; i < range.end; i++) {
    const match = lines[i].match(keyPattern);
    if (match) return normalizeYamlScalar(match[1]);
  }
  return '';
}

function parseNestedYamlScalar(content: string, section: string, parentKey: string, childKey: string): string {
  const lines = content.split(/\r?\n/);
  const range = findTopLevelSection(lines, section);
  if (!range) return '';

  const parentPattern = new RegExp(`^\\s{2}${escapeRegex(parentKey)}:\\s*(?:#.*)?$`);
  for (let i = range.start + 1; i < range.end; i++) {
    if (!parentPattern.test(lines[i])) continue;

    const childPattern = new RegExp(`^\\s{4}${escapeRegex(childKey)}:\\s*(.*)$`);
    for (let j = i + 1; j < range.end; j++) {
      const line = lines[j];
      if (!line.trim()) continue;
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= 2) break;
      const match = line.match(childPattern);
      if (match) return normalizeYamlScalar(match[1]);
    }
  }

  return '';
}

function formatYamlListKey(key: string, values: string[]): string[] {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  if (!unique.length) return [`  ${key}: []`];
  return [`  ${key}:`, ...unique.map((value) => `${YAML_LIST_INDENT}- ${value}`)];
}

function writeYamlList(content: string, section: string, key: string, values: string[]): string {
  const lines = content.trimEnd() ? content.trimEnd().split(/\r?\n/) : [];
  const nextBlock = formatYamlListKey(key, values);
  const range = findTopLevelSection(lines, section);

  if (!range) {
    const prefix = lines.length ? [...lines, ''] : [];
    return [...prefix, `${section}:`, ...nextBlock, ''].join('\n');
  }

  const keyPattern = new RegExp(`^(\\s*)${key}:\\s*`);
  for (let i = range.start + 1; i < range.end; i++) {
    const match = lines[i].match(keyPattern);
    if (!match) continue;

    const keyIndent = match[1].length;
    let blockEnd = i + 1;
    while (blockEnd < range.end) {
      const line = lines[blockEnd];
      if (!line.trim()) {
        blockEnd += 1;
        continue;
      }
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= keyIndent) break;
      blockEnd += 1;
    }

    lines.splice(i, blockEnd - i, ...nextBlock);
    return `${lines.join('\n')}\n`;
  }

  lines.splice(range.start + 1, 0, ...nextBlock);
  return `${lines.join('\n')}\n`;
}

async function readConfig(paths = getWorkspacePaths()): Promise<string> {
  return readText(paths.configPath, '');
}

async function updateConfigList(
  section: string,
  key: string,
  fallback: string[],
  mutate: (current: string[]) => string[],
  paths = getWorkspacePaths()
): Promise<void> {
  await ensureWorkspaceDirs(paths);
  const content = await readConfig(paths);
  const current = parseYamlList(content, section, key) ?? fallback;
  const next = mutate(current);
  await writeFile(paths.configPath, writeYamlList(content, section, key, next), 'utf-8');
}

function readEnvContent(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key) env[key] = value;
  }
  return env;
}

async function readEnv(paths = getWorkspacePaths()): Promise<Record<string, string>> {
  const parsed = readEnvContent(await readText(paths.envPath));
  const result: Record<string, string> = {};
  for (const key of PROVIDER_AND_GATEWAY_ENV_KEYS) {
    if (parsed[key]) result[key] = parsed[key];
  }
  return result;
}

async function setEnvValue(input: HermesSetEnvRequest, paths = getWorkspacePaths()): Promise<void> {
  const key = input.key.trim();
  if (!/^[A-Z0-9_]+$/.test(key)) {
    throw new Error('Environment key must be uppercase snake case.');
  }

  await ensureWorkspaceDirs(paths);
  const content = await readText(paths.envPath);
  const lines = content.trimEnd() ? content.trimEnd().split(/\r?\n/) : [];
  const value = input.value.trim();
  const nextLine = `${key}=${value}`;
  const index = lines.findIndex((line) => line.trim().startsWith(`${key}=`));

  if (index >= 0) {
    if (value) {
      lines[index] = nextLine;
    } else {
      lines.splice(index, 1);
    }
  } else if (value) {
    lines.push(nextLine);
  }

  await writeFile(paths.envPath, lines.length ? `${lines.join('\n')}\n` : '', 'utf-8');
}

function parseTopLevelScalar(content: string, key: string): string {
  const match = content.match(new RegExp(`^\\s*${key}:\\s*([^\\n#]*)`, 'm'));
  return match ? normalizeYamlScalar(match[1]) : '';
}

function writeTopLevelScalar(content: string, key: string, value: string): string {
  const line = `${key}: "${value.replace(/"/g, '\\"')}"`;
  const regex = new RegExp(`^\\s*${key}:\\s*[^\\n#]*(?:#.*)?$`, 'm');
  if (regex.test(content)) return `${content.replace(regex, line).trimEnd()}\n`;
  return `${content.trimEnd()}\n${line}\n`;
}

function writeNestedScalar(content: string, section: string, key: string, value: string): string {
  const lines = content.trimEnd() ? content.trimEnd().split(/\r?\n/) : [];
  const range = findTopLevelSection(lines, section);
  const line = `  ${key}: "${value.replace(/"/g, '\\"')}"`;

  if (!range) {
    return [...lines, lines.length ? '' : '', `${section}:`, line, '']
      .filter((item, index) => item || index > 0)
      .join('\n');
  }

  const keyPattern = new RegExp(`^\\s*${key}:\\s*`);
  for (let i = range.start + 1; i < range.end; i++) {
    if (keyPattern.test(lines[i])) {
      lines[i] = line;
      return `${lines.join('\n')}\n`;
    }
  }

  lines.splice(range.start + 1, 0, line);
  return `${lines.join('\n')}\n`;
}

function writeNestedObjectScalar(
  content: string,
  section: string,
  parentKey: string,
  childKey: string,
  value: string
): string {
  const lines = content.trimEnd() ? content.trimEnd().split(/\r?\n/) : [];
  let range = findTopLevelSection(lines, section);
  const parentLine = `  ${parentKey}:`;
  const childLine = `    ${childKey}: ${value}`;

  if (!range) {
    const prefix = lines.length ? [...lines, ''] : [];
    return [...prefix, `${section}:`, parentLine, childLine, ''].join('\n');
  }

  const parentPattern = new RegExp(`^\\s{2}${escapeRegex(parentKey)}:\\s*(?:#.*)?$`);
  for (let i = range.start + 1; i < range.end; i++) {
    if (!parentPattern.test(lines[i])) continue;

    const childPattern = new RegExp(`^\\s{4}${escapeRegex(childKey)}:\\s*`);
    let blockEnd = i + 1;
    for (; blockEnd < range.end; blockEnd++) {
      const line = lines[blockEnd];
      if (!line.trim()) continue;
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= 2) break;
      if (childPattern.test(line)) {
        lines[blockEnd] = childLine;
        return `${lines.join('\n')}\n`;
      }
    }

    lines.splice(i + 1, 0, childLine);
    return `${lines.join('\n')}\n`;
  }

  lines.splice(range.end, 0, parentLine, childLine);
  return `${lines.join('\n')}\n`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function setConfigValue(fullKey: string, value: string, paths = getWorkspacePaths()): Promise<void> {
  await ensureWorkspaceDirs(paths);
  const content = await readConfig(paths);
  if (fullKey.includes('.')) {
    const [section, key] = fullKey.split('.', 2);
    await writeFile(paths.configPath, writeNestedScalar(content, section, key, value.trim()), 'utf-8');
    return;
  }
  await writeFile(paths.configPath, writeTopLevelScalar(content, fullKey, value.trim()), 'utf-8');
}

async function setGatewayPlatformEnabled(
  input: HermesSetGatewayPlatformRequest,
  paths = getWorkspacePaths()
): Promise<void> {
  const platform = input.platform.trim();
  if (!GATEWAY_PLATFORMS.some((item) => item.key === platform)) {
    throw new Error(`Unknown Hermes gateway platform: ${platform}`);
  }

  await ensureWorkspaceDirs(paths);
  const content = await readConfig(paths);
  await writeFile(
    paths.configPath,
    writeNestedObjectScalar(content, 'platforms', platform, 'enabled', input.enabled ? 'true' : 'false'),
    'utf-8'
  );
}

function readModelConfig(config: string): HermesModelConfig {
  return {
    provider: parseTopLevelScalar(config, 'provider') || 'auto',
    model: parseTopLevelScalar(config, 'default'),
    baseUrl: parseTopLevelScalar(config, 'base_url'),
  };
}

async function setModelConfig(input: HermesSetModelConfigRequest, paths = getWorkspacePaths()): Promise<void> {
  await ensureWorkspaceDirs(paths);
  const existing = await readConfig(paths);
  const withProvider = writeTopLevelScalar(existing, 'provider', input.provider.trim() || 'auto');
  const withModel = writeTopLevelScalar(withProvider, 'default', input.model.trim());
  const withBaseUrl = writeTopLevelScalar(withModel, 'base_url', input.baseUrl.trim());
  await writeFile(paths.configPath, withBaseUrl, 'utf-8');
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf-8');
}

function readCredentialPool(paths = getWorkspacePaths()): Record<string, HermesCredentialEntry[]> {
  const store = readJsonFile<Record<string, unknown>>(paths.authPath, {});
  const pool = store.credential_pool;
  return pool && typeof pool === 'object' ? (pool as Record<string, HermesCredentialEntry[]>) : {};
}

async function setCredentialPool(input: HermesSetCredentialPoolRequest, paths = getWorkspacePaths()): Promise<void> {
  const provider = input.provider.trim();
  if (!provider) throw new Error('Provider is required.');
  const store = readJsonFile<Record<string, unknown>>(paths.authPath, {});
  const pool =
    store.credential_pool && typeof store.credential_pool === 'object'
      ? (store.credential_pool as Record<string, HermesCredentialEntry[]>)
      : {};
  pool[provider] = input.entries
    .map((entry) => ({ key: entry.key.trim(), label: entry.label.trim() }))
    .filter((entry) => entry.key);
  store.credential_pool = pool;
  await writeJsonFile(paths.authPath, store);
}

function readSavedModels(paths = getWorkspacePaths()): HermesSavedModel[] {
  const value = readJsonFile<unknown>(paths.modelsPath, []);
  return Array.isArray(value) ? (value as HermesSavedModel[]) : [];
}

function parseFrontmatter(content: string): { metadata: Record<string, string>; body: string } {
  if (!content.startsWith('---')) return { metadata: {}, body: content };
  const end = content.indexOf('\n---', 3);
  if (end < 0) return { metadata: {}, body: content };

  const raw = content.slice(3, end).trim();
  const metadata: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_.-]+):\s*(.+)$/);
    if (!match) continue;
    metadata[match[1]] = normalizeYamlScalar(match[2]);
  }
  return { metadata, body: content.slice(end + 4) };
}

function parseSkillContent(content: string, skillDir: string, rootDir: string): ParsedSkill {
  const { metadata, body } = parseFrontmatter(content);
  const rel = path.relative(rootDir, skillDir).split(path.sep).filter(Boolean);
  const fallbackName = path.basename(skillDir);
  const firstBodyLine = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'));
  return {
    name: (metadata.name || fallbackName).slice(0, 64),
    description: (metadata.description || firstBodyLine || '').slice(0, 1024),
    category: rel.length > 1 ? rel[0] : undefined,
    content,
  };
}

async function findSkillFiles(rootDir: string, maxDepth = 4): Promise<string[]> {
  if (!existsSync(rootDir)) return [];

  const results: string[] = [];
  const ignored = new Set(['.git', '.github', 'node_modules', '__pycache__', '.venv', 'venv']);

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    const entries = await readdir(dir, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')) {
      results.push(path.join(dir, 'SKILL.md'));
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || ignored.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), depth + 1);
    }
  };

  await walk(rootDir, 0);
  return results.sort();
}

function createSkillId(source: 'installed' | 'bundled', relativeDir: string): string {
  return `${source}:${relativeDir.split(path.sep).join('/')}`;
}

async function readSkills(paths = getWorkspacePaths()): Promise<HermesSkillsState> {
  const config = await readConfig(paths);
  const disabled = parseYamlList(config, 'skills', 'disabled') ?? [];
  const disabledSet = new Set(disabled);

  const installedFiles = await findSkillFiles(paths.skillsDir);
  const installed: HermesSkillInfo[] = [];
  const installedNames = new Set<string>();

  for (const filePath of installedFiles) {
    const skillDir = path.dirname(filePath);
    const content = await readText(filePath);
    const parsed = parseSkillContent(content, skillDir, paths.skillsDir);
    installedNames.add(parsed.name);
    installed.push({
      id: createSkillId('installed', path.relative(paths.skillsDir, skillDir)),
      name: parsed.name,
      description: parsed.description,
      category: parsed.category,
      path: filePath,
      source: 'installed',
      installed: true,
      enabled: !disabledSet.has(parsed.name),
      content: parsed.content,
    });
  }

  const bundledRoots = [
    { root: path.join(paths.source, 'skills'), prefix: 'skills' },
    { root: path.join(paths.source, 'plugins'), prefix: 'plugins' },
  ];
  const bundled: HermesSkillInfo[] = [];
  const bundledIds = new Set<string>();

  for (const bundledRoot of bundledRoots) {
    const files = await findSkillFiles(bundledRoot.root);
    for (const filePath of files) {
      const skillDir = path.dirname(filePath);
      const content = await readText(filePath);
      const parsed = parseSkillContent(content, skillDir, bundledRoot.root);
      const relativeDir = path.join(bundledRoot.prefix, path.relative(bundledRoot.root, skillDir));
      const id = createSkillId('bundled', relativeDir);
      if (bundledIds.has(id)) continue;
      bundledIds.add(id);
      bundled.push({
        id,
        name: parsed.name,
        description: parsed.description,
        category: parsed.category,
        path: filePath,
        source: 'bundled',
        installed: installedNames.has(parsed.name),
        enabled: !disabledSet.has(parsed.name),
        content: parsed.content,
      });
    }
  }

  return {
    installed: installed.sort((a, b) => a.name.localeCompare(b.name)),
    bundled: bundled.sort((a, b) => a.name.localeCompare(b.name)),
    disabled,
  };
}

function getDefaultToolsetKeys(): string[] {
  return CONFIGURABLE_TOOLSETS.filter((toolset) => toolset.defaultEnabled).map((toolset) => toolset.key);
}

async function readTools(paths = getWorkspacePaths()): Promise<HermesToolsState> {
  const config = await readConfig(paths);
  const explicit = parseYamlList(config, 'platform_toolsets', 'cli');
  const enabledKeys = new Set(explicit ?? getDefaultToolsetKeys());
  const toolsets = CONFIGURABLE_TOOLSETS.map((toolset) => ({
    ...toolset,
    enabled: enabledKeys.has(toolset.key),
  }));
  return { platform: 'cli', toolsets, mcpServers: parseMcpServers(config) };
}

async function readMemoryFiles(paths = getWorkspacePaths()): Promise<HermesMemoryFileInfo[]> {
  if (!existsSync(paths.memoriesDir)) return [];
  const entries = await readdir(paths.memoriesDir, { withFileTypes: true });
  const files: HermesMemoryFileInfo[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.endsWith('.lock')) continue;
    const filePath = path.join(paths.memoriesDir, entry.name);
    const info = await stat(filePath);
    files.push({
      name: entry.name,
      path: filePath,
      size: info.size,
      updatedAt: info.mtimeMs,
    });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

function parseMemoryEntries(content: string): HermesMemoryEntry[] {
  return content
    .split(MEMORY_ENTRY_DELIMITER)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((content, index) => ({ index, content }));
}

function serializeMemoryEntries(entries: string[]): string {
  const normalized = entries.map((entry) => entry.trim()).filter(Boolean);
  return normalized.length ? `${normalized.join(MEMORY_ENTRY_DELIMITER)}\n` : '';
}

async function readSessionStats(
  paths = getWorkspacePaths()
): Promise<{ totalSessions: number; totalMessages: number }> {
  const dbPath = path.join(path.dirname(paths.configPath), 'state.db');
  if (!existsSync(dbPath)) return { totalSessions: 0, totalMessages: 0 };
  return { totalSessions: 0, totalMessages: 0 };
}

async function discoverMemoryProviders(
  activeProvider: string,
  paths = getWorkspacePaths()
): Promise<HermesMemoryProviderInfo[]> {
  const providerRoot = path.join(paths.source, 'plugins', 'memory');
  const discovered = new Set(Object.keys(KNOWN_MEMORY_PROVIDERS));

  try {
    const entries = await readdir(providerRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) discovered.add(entry.name);
    }
  } catch {
    // The Hermes checkout may not have optional memory plugins yet.
  }

  return [...discovered].sort().map((name) => {
    const known = KNOWN_MEMORY_PROVIDERS[name];
    return {
      name,
      description: known?.description ?? `${name} memory provider`,
      installed: existsSync(path.join(providerRoot, name, '__init__.py')),
      active: name === activeProvider,
      envVars: known?.envVars ?? [],
    };
  });
}

async function countSkills(skillsDir: string): Promise<number> {
  const files = await findSkillFiles(skillsDir);
  return files.length;
}

function getGatewayPidPaths(paths = getWorkspacePaths()): string[] {
  return [
    ...new Set([path.join(path.dirname(paths.configPath), 'gateway.pid'), path.join(paths.hermesHome, 'gateway.pid')]),
  ];
}

function readGatewayPid(paths = getWorkspacePaths()): number | null {
  for (const pidPath of getGatewayPidPaths(paths)) {
    if (!existsSync(pidPath)) continue;
    try {
      const raw = readFileSync(pidPath, 'utf-8').trim();
      const parsed = raw.startsWith('{') ? (JSON.parse(raw) as { pid?: unknown }).pid : Number(raw);
      if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed;
    } catch {
      // Try the next known gateway PID location.
    }
  }
  return null;
}

function isProcessRunning(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readProfiles(paths = getWorkspacePaths()): Promise<HermesWorkspaceSnapshot['profiles']> {
  await ensureWorkspaceDirs(paths);
  const active = getActiveProfileName(paths);
  const root = getHermesRuntimePaths().hermesHome;
  const profiles: HermesProfileInfo[] = [];

  const buildProfile = async (name: string): Promise<HermesProfileInfo> => {
    const home = profileHome(root, name);
    const config = await readText(path.join(home, 'config.yaml'));
    return {
      name,
      path: home,
      isDefault: name === 'default',
      isActive: name === active,
      provider: readModelConfig(config).provider,
      model: readModelConfig(config).model,
      hasEnv: existsSync(path.join(home, '.env')),
      hasPersona: existsSync(path.join(home, 'SOUL.md')),
      skillCount: await countSkills(path.join(home, 'skills')),
      gatewayRunning: isProcessRunning(readGatewayPid(getWorkspacePaths(name))),
    };
  };

  profiles.push(await buildProfile('default'));
  try {
    const entries = await readdir(paths.profilesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      profiles.push(await buildProfile(entry.name));
    }
  } catch {
    // Missing profiles dir means default-only.
  }

  return {
    active,
    profiles: profiles.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)),
  };
}

async function readProviders(paths = getWorkspacePaths()): Promise<HermesWorkspaceSnapshot['providers']> {
  const config = await readConfig(paths);
  return {
    envPath: paths.envPath,
    configPath: paths.configPath,
    authPath: paths.authPath,
    envKeys: PROVIDER_AND_GATEWAY_ENV_KEYS,
    env: await readEnv(paths),
    model: readModelConfig(config),
    credentialPool: readCredentialPool(paths),
    savedModels: readSavedModels(paths),
  };
}

function parseMcpServers(config: string): HermesMcpServerInfo[] {
  const match = config.match(/^mcp_servers:\s*\n((?:[ \t]+.+\n?)*)/m);
  if (!match) return [];
  const block = match[1];
  const servers: HermesMcpServerInfo[] = [];
  const namePattern = /^[ ]{2}([A-Za-z0-9_.-]+):\s*$/gm;
  const matches = [...block.matchAll(namePattern)];

  for (let i = 0; i < matches.length; i++) {
    const name = matches[i][1];
    const start = (matches[i].index ?? 0) + matches[i][0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? block.length) : block.length;
    const serverBlock = block.slice(start, end);
    const urlMatch = serverBlock.match(/url:\s*["']?([^\s"']+)/);
    const cmdMatch = serverBlock.match(/command:\s*["']?([^\s"']+)/);
    const enabledMatch = serverBlock.match(/enabled:\s*(true|false)/i);
    servers.push({
      name,
      type: urlMatch ? 'http' : cmdMatch ? 'stdio' : 'unknown',
      enabled: enabledMatch ? enabledMatch[1].toLowerCase() === 'true' : true,
      detail: urlMatch?.[1] ?? cmdMatch?.[1] ?? '',
    });
  }

  return servers;
}

async function readGateway(paths = getWorkspacePaths()): Promise<HermesWorkspaceSnapshot['gateway']> {
  const config = await readConfig(paths);
  const pid = readGatewayPid(paths);
  const platforms = GATEWAY_PLATFORMS.map((platform) => ({
    ...platform,
    enabled: parseNestedYamlScalar(config, 'platforms', platform.key, 'enabled') === 'true',
  }));
  return { running: Boolean(gatewayProcess && !gatewayProcess.killed) || isProcessRunning(pid), pid, platforms };
}

async function readLogs(file: string, paths = getWorkspacePaths()): Promise<HermesWorkspaceSnapshot['logs']> {
  const selected = LOG_FILES.includes(file as (typeof LOG_FILES)[number]) ? file : 'agent.log';
  const logPath = path.join(paths.hermesHome, 'logs', selected);
  const content = await readText(logPath);
  const lines = content.split(/\r?\n/);
  return {
    selected,
    available: [...LOG_FILES],
    path: logPath,
    content: lines.slice(-300).join('\n'),
  };
}

export async function getHermesWorkspaceSnapshot(): Promise<HermesWorkspaceSnapshot> {
  const activeProfile = getActiveProfileName();
  const paths = getWorkspacePaths(activeProfile);
  await ensureWorkspaceDirs(paths);
  const defaultContent = await ensurePersonaFile(paths);
  const config = await readConfig(paths);
  const memoryPath = path.join(paths.memoriesDir, 'MEMORY.md');
  const userPath = path.join(paths.memoriesDir, 'USER.md');
  const memoryContent = await readText(memoryPath);
  const userContent = await readText(userPath);
  const memoryProvider = parseYamlScalar(config, 'memory', 'provider') || 'files';

  return {
    paths: {
      hermesHome: paths.hermesHome,
      activeHome: path.dirname(paths.configPath),
      runtimeRoot: paths.root,
      source: paths.source,
      configPath: paths.configPath,
    },
    profiles: await readProfiles(paths),
    providers: await readProviders(paths),
    persona: {
      path: paths.personaPath,
      content: await readText(paths.personaPath),
      defaultContent,
    },
    memory: {
      memoryPath,
      userPath,
      memoryContent,
      userContent,
      entries: parseMemoryEntries(memoryContent),
      provider: memoryProvider,
      providers: await discoverMemoryProviders(memoryProvider, paths),
      stats: {
        ...(await readSessionStats(paths)),
        memoryChars: memoryContent.length,
        memoryLimit: MEMORY_CHAR_LIMIT,
        userChars: userContent.length,
        userLimit: USER_CHAR_LIMIT,
      },
      files: await readMemoryFiles(paths),
    },
    skills: await readSkills(paths),
    tools: await readTools(paths),
    gateway: await readGateway(paths),
    logs: await readLogs('agent.log', paths),
  };
}

export async function saveHermesPersona(input: HermesSavePersonaRequest): Promise<HermesWorkspaceSnapshot> {
  const paths = getWorkspacePaths();
  await ensureWorkspaceDirs(paths);
  await writeFile(paths.personaPath, input.content.trimEnd() + '\n', 'utf-8');
  return getHermesWorkspaceSnapshot();
}

export async function resetHermesPersona(): Promise<HermesWorkspaceSnapshot> {
  const paths = getWorkspacePaths();
  await ensureWorkspaceDirs(paths);
  const defaultContent = await readText(paths.defaultPersonaPath, DEFAULT_SOUL_MD);
  await writeFile(paths.personaPath, defaultContent.trimEnd() + '\n', 'utf-8');
  return getHermesWorkspaceSnapshot();
}

async function copyProfileEntry(sourceHome: string, targetHome: string, entry: string): Promise<void> {
  const sourcePath = path.join(sourceHome, entry);
  if (!existsSync(sourcePath)) return;
  await cp(sourcePath, path.join(targetHome, entry), { recursive: true, force: true });
}

export async function createHermesProfile(input: HermesCreateProfileRequest): Promise<HermesWorkspaceSnapshot> {
  const name = sanitizeProfileName(input.name);
  if (name === 'default') throw new Error('Profile name is required.');

  const targetPaths = getWorkspacePaths(name);
  if (existsSync(path.dirname(targetPaths.configPath))) {
    throw new Error(`Hermes profile already exists: ${name}`);
  }

  await ensureWorkspaceDirs(targetPaths);
  if (input.cloneActive) {
    const sourcePaths = getWorkspacePaths();
    await ensureWorkspaceDirs(sourcePaths);
    await ensurePersonaFile(sourcePaths);
    const sourceHome = path.dirname(sourcePaths.configPath);
    const targetHome = path.dirname(targetPaths.configPath);
    for (const entry of ['config.yaml', '.env', 'SOUL.md', 'memories', 'skills']) {
      await copyProfileEntry(sourceHome, targetHome, entry);
    }
  } else {
    await ensurePersonaFile(targetPaths);
  }

  return getHermesWorkspaceSnapshot();
}

export async function deleteHermesProfile(input: HermesDeleteProfileRequest): Promise<HermesWorkspaceSnapshot> {
  const name = sanitizeProfileName(input.name);
  if (name === 'default') throw new Error('The default Hermes profile cannot be deleted.');

  const targetPaths = getWorkspacePaths(name);
  await rm(path.dirname(targetPaths.configPath), { recursive: true, force: true });
  if (getActiveProfileName() === name) {
    await writeFile(targetPaths.activeProfilePath, 'default\n', 'utf-8');
  }
  return getHermesWorkspaceSnapshot();
}

export async function setActiveHermesProfile(input: HermesSetActiveProfileRequest): Promise<HermesWorkspaceSnapshot> {
  const name = sanitizeProfileName(input.name);
  const paths = getWorkspacePaths(name);
  if (name !== 'default' && !existsSync(path.dirname(paths.configPath))) {
    throw new Error(`Hermes profile was not found: ${name}`);
  }
  await ensureWorkspaceDirs(paths);
  await writeFile(paths.activeProfilePath, `${name}\n`, 'utf-8');
  return getHermesWorkspaceSnapshot();
}

export async function saveHermesMemory(input: HermesSaveMemoryRequest): Promise<HermesWorkspaceSnapshot> {
  const paths = getWorkspacePaths();
  await ensureWorkspaceDirs(paths);
  const targetPath =
    input.target === 'user' ? path.join(paths.memoriesDir, 'USER.md') : path.join(paths.memoriesDir, 'MEMORY.md');
  await writeFile(targetPath, input.content.trimEnd() ? `${input.content.trimEnd()}\n` : '', 'utf-8');
  return getHermesWorkspaceSnapshot();
}

export async function addHermesMemoryEntry(input: HermesAddMemoryEntryRequest): Promise<HermesWorkspaceSnapshot> {
  const content = input.content.trim();
  if (!content) throw new Error('Memory entry content is required.');
  const paths = getWorkspacePaths();
  await ensureWorkspaceDirs(paths);
  const memoryPath = path.join(paths.memoriesDir, 'MEMORY.md');
  const entries = parseMemoryEntries(await readText(memoryPath)).map((entry) => entry.content);
  entries.push(content);
  await writeFile(memoryPath, serializeMemoryEntries(entries), 'utf-8');
  return getHermesWorkspaceSnapshot();
}

export async function updateHermesMemoryEntry(input: HermesUpdateMemoryEntryRequest): Promise<HermesWorkspaceSnapshot> {
  const paths = getWorkspacePaths();
  await ensureWorkspaceDirs(paths);
  const memoryPath = path.join(paths.memoriesDir, 'MEMORY.md');
  const entries = parseMemoryEntries(await readText(memoryPath)).map((entry) => entry.content);
  if (input.index < 0 || input.index >= entries.length) throw new Error('Memory entry was not found.');
  entries[input.index] = input.content.trim();
  await writeFile(memoryPath, serializeMemoryEntries(entries), 'utf-8');
  return getHermesWorkspaceSnapshot();
}

export async function removeHermesMemoryEntry(input: HermesRemoveMemoryEntryRequest): Promise<HermesWorkspaceSnapshot> {
  const paths = getWorkspacePaths();
  await ensureWorkspaceDirs(paths);
  const memoryPath = path.join(paths.memoriesDir, 'MEMORY.md');
  const entries = parseMemoryEntries(await readText(memoryPath)).map((entry) => entry.content);
  if (input.index < 0 || input.index >= entries.length) throw new Error('Memory entry was not found.');
  entries.splice(input.index, 1);
  await writeFile(memoryPath, serializeMemoryEntries(entries), 'utf-8');
  return getHermesWorkspaceSnapshot();
}

export async function setHermesMemoryProvider(input: HermesSetMemoryProviderRequest): Promise<HermesWorkspaceSnapshot> {
  const provider = input.provider.trim();
  if (!provider) throw new Error('Memory provider is required.');
  await setConfigValue('memory.provider', provider);
  return getHermesWorkspaceSnapshot();
}

export async function setHermesSkillEnabled(input: HermesSetSkillEnabledRequest): Promise<HermesWorkspaceSnapshot> {
  const skillName = input.name.trim();
  if (!skillName) throw new Error('Skill name is required.');
  await updateConfigList('skills', 'disabled', [], (current) => {
    const disabled = new Set(current);
    if (input.enabled) {
      disabled.delete(skillName);
    } else {
      disabled.add(skillName);
    }
    return [...disabled];
  });
  return getHermesWorkspaceSnapshot();
}

export async function installBundledHermesSkill(
  input: HermesInstallBundledSkillRequest
): Promise<HermesWorkspaceSnapshot> {
  const paths = getWorkspacePaths();
  await ensureWorkspaceDirs(paths);
  const skills = await readSkills(paths);
  const skill = skills.bundled.find((item) => item.id === input.id);
  if (!skill) throw new Error('Bundled skill was not found.');
  if (skill.installed) return getHermesWorkspaceSnapshot();

  const idPath = input.id.replace(/^bundled:/, '');
  const relative = idPath.startsWith('skills/')
    ? idPath.slice('skills/'.length)
    : path.basename(path.dirname(skill.path));
  const targetDir = path.join(paths.skillsDir, relative);
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(path.dirname(skill.path), targetDir, { recursive: true, errorOnExist: false, force: false });
  return getHermesWorkspaceSnapshot();
}

export async function uninstallHermesSkill(input: HermesUninstallSkillRequest): Promise<HermesWorkspaceSnapshot> {
  const skillName = input.name.trim();
  if (!skillName) throw new Error('Skill name is required.');

  const paths = getWorkspacePaths();
  const skills = await readSkills(paths);
  const skill = skills.installed.find((item) => item.name === skillName);
  if (!skill) throw new Error(`Installed Hermes skill was not found: ${skillName}`);
  await rm(path.dirname(skill.path), { recursive: true, force: true });
  await setHermesSkillEnabled({ name: skillName, enabled: true });
  return getHermesWorkspaceSnapshot();
}

export async function setHermesToolsetEnabled(input: HermesSetToolsetEnabledRequest): Promise<HermesWorkspaceSnapshot> {
  const toolsetKey = input.key.trim();
  if (!CONFIGURABLE_TOOLSETS.some((toolset) => toolset.key === toolsetKey)) {
    throw new Error(`Unknown Hermes toolset: ${toolsetKey}`);
  }

  await updateConfigList('platform_toolsets', 'cli', getDefaultToolsetKeys(), (current) => {
    const enabled = new Set(current);
    if (input.enabled) {
      enabled.add(toolsetKey);
    } else {
      enabled.delete(toolsetKey);
    }
    return [...enabled];
  });

  return getHermesWorkspaceSnapshot();
}

export async function setHermesEnv(input: HermesSetEnvRequest): Promise<HermesWorkspaceSnapshot> {
  await setEnvValue(input);
  return getHermesWorkspaceSnapshot();
}

export async function setHermesModelConfig(input: HermesSetModelConfigRequest): Promise<HermesWorkspaceSnapshot> {
  await setModelConfig(input);
  return getHermesWorkspaceSnapshot();
}

export async function setHermesCredentialPool(input: HermesSetCredentialPoolRequest): Promise<HermesWorkspaceSnapshot> {
  await setCredentialPool(input);
  return getHermesWorkspaceSnapshot();
}

export async function setHermesGatewayPlatform(
  input: HermesSetGatewayPlatformRequest
): Promise<HermesWorkspaceSnapshot> {
  await setGatewayPlatformEnabled(input);
  return getHermesWorkspaceSnapshot();
}

export async function startHermesGateway(): Promise<HermesWorkspaceSnapshot> {
  const paths = getWorkspacePaths();
  await ensureWorkspaceDirs(paths);
  if (!existsSync(paths.binary)) {
    throw new Error('Managed Hermes binary is not installed.');
  }
  if (gatewayProcess && !gatewayProcess.killed) return getHermesWorkspaceSnapshot();

  const profileEnv = readEnvContent(await readText(paths.envPath));
  gatewayProcess = spawn(paths.binary, ['gateway'], {
    cwd: paths.source,
    env: getManagedHermesEnv({ ...profileEnv, API_SERVER_ENABLED: 'true' }),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  gatewayProcess.unref();
  gatewayProcess.on('close', () => {
    gatewayProcess = null;
  });

  return getHermesWorkspaceSnapshot();
}

export async function stopHermesGateway(): Promise<HermesWorkspaceSnapshot> {
  const paths = getWorkspacePaths();
  if (gatewayProcess && !gatewayProcess.killed) {
    gatewayProcess.kill('SIGTERM');
    gatewayProcess = null;
  }

  const pid = readGatewayPid(paths);
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // The gateway may already have exited.
    }
  }

  await Promise.all(getGatewayPidPaths(paths).map((pidPath) => rm(pidPath, { force: true })));
  return getHermesWorkspaceSnapshot();
}

export async function readHermesLog(input: HermesReadLogRequest): Promise<HermesWorkspaceSnapshot> {
  const snapshot = await getHermesWorkspaceSnapshot();
  return {
    ...snapshot,
    logs: await readLogs(input.file, getWorkspacePaths()),
  };
}
