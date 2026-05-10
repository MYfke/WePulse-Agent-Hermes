/**
 * @license
 * Copyright 2026 WePulse
 * SPDX-License-Identifier: Apache-2.0
 */

export type HermesWorkspaceTab =
  | 'profiles'
  | 'providers'
  | 'persona'
  | 'memory'
  | 'skills'
  | 'tools'
  | 'gateway'
  | 'logs';

export type HermesWorkspacePaths = {
  hermesHome: string;
  activeHome: string;
  runtimeRoot: string;
  source: string;
  configPath: string;
};

export type HermesProfileInfo = {
  name: string;
  path: string;
  isDefault: boolean;
  isActive: boolean;
  provider: string;
  model: string;
  hasEnv: boolean;
  hasPersona: boolean;
  skillCount: number;
  gatewayRunning: boolean;
};

export type HermesProfilesState = {
  active: string;
  profiles: HermesProfileInfo[];
};

export type HermesPersonaState = {
  path: string;
  content: string;
  defaultContent: string;
};

export type HermesMemoryFileInfo = {
  name: string;
  path: string;
  size: number;
  updatedAt: number;
};

export type HermesMemoryEntry = {
  index: number;
  content: string;
};

export type HermesMemoryStats = {
  totalSessions: number;
  totalMessages: number;
  memoryChars: number;
  memoryLimit: number;
  userChars: number;
  userLimit: number;
};

export type HermesMemoryProviderInfo = {
  name: string;
  description: string;
  installed: boolean;
  active: boolean;
  envVars: string[];
};

export type HermesMemoryState = {
  memoryPath: string;
  userPath: string;
  memoryContent: string;
  userContent: string;
  entries: HermesMemoryEntry[];
  provider: string;
  providers: HermesMemoryProviderInfo[];
  stats: HermesMemoryStats;
  files: HermesMemoryFileInfo[];
};

export type HermesSkillSource = 'installed' | 'bundled';

export type HermesSkillInfo = {
  id: string;
  name: string;
  description: string;
  category?: string;
  path: string;
  source: HermesSkillSource;
  installed: boolean;
  enabled: boolean;
  content: string;
};

export type HermesSkillsState = {
  installed: HermesSkillInfo[];
  bundled: HermesSkillInfo[];
  disabled: string[];
};

export type HermesToolsetInfo = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  defaultEnabled: boolean;
};

export type HermesToolsState = {
  platform: 'cli';
  toolsets: HermesToolsetInfo[];
  mcpServers: HermesMcpServerInfo[];
};

export type HermesMcpServerInfo = {
  name: string;
  type: 'http' | 'stdio' | 'unknown';
  enabled: boolean;
  detail: string;
};

export type HermesModelConfig = {
  provider: string;
  model: string;
  baseUrl: string;
};

export type HermesCredentialEntry = {
  key: string;
  label: string;
};

export type HermesSavedModel = {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  createdAt: number;
};

export type HermesProvidersState = {
  envPath: string;
  configPath: string;
  authPath: string;
  envKeys: string[];
  env: Record<string, string>;
  model: HermesModelConfig;
  credentialPool: Record<string, HermesCredentialEntry[]>;
  savedModels: HermesSavedModel[];
};

export type HermesGatewayPlatformInfo = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  fields: string[];
};

export type HermesGatewayState = {
  running: boolean;
  pid: number | null;
  platforms: HermesGatewayPlatformInfo[];
};

export type HermesLogsState = {
  selected: string;
  available: string[];
  path: string;
  content: string;
};

export type HermesWorkspaceSnapshot = {
  paths: HermesWorkspacePaths;
  profiles: HermesProfilesState;
  providers: HermesProvidersState;
  persona: HermesPersonaState;
  memory: HermesMemoryState;
  skills: HermesSkillsState;
  tools: HermesToolsState;
  gateway: HermesGatewayState;
  logs: HermesLogsState;
};

export type HermesCreateProfileRequest = {
  name: string;
  cloneActive: boolean;
};

export type HermesDeleteProfileRequest = {
  name: string;
};

export type HermesSetActiveProfileRequest = {
  name: string;
};

export type HermesSavePersonaRequest = {
  content: string;
};

export type HermesSaveMemoryRequest = {
  target: 'memory' | 'user';
  content: string;
};

export type HermesAddMemoryEntryRequest = {
  content: string;
};

export type HermesUpdateMemoryEntryRequest = {
  index: number;
  content: string;
};

export type HermesRemoveMemoryEntryRequest = {
  index: number;
};

export type HermesSetMemoryProviderRequest = {
  provider: string;
};

export type HermesSetSkillEnabledRequest = {
  name: string;
  enabled: boolean;
};

export type HermesInstallBundledSkillRequest = {
  id: string;
};

export type HermesUninstallSkillRequest = {
  name: string;
};

export type HermesSetToolsetEnabledRequest = {
  key: string;
  enabled: boolean;
};

export type HermesSetEnvRequest = {
  key: string;
  value: string;
};

export type HermesSetModelConfigRequest = HermesModelConfig;

export type HermesSetCredentialPoolRequest = {
  provider: string;
  entries: HermesCredentialEntry[];
};

export type HermesSetGatewayPlatformRequest = {
  platform: string;
  enabled: boolean;
};

export type HermesReadLogRequest = {
  file: string;
};
