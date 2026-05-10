/**
 * @license
 * Copyright 2026 WePulse
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type {
  HermesCredentialEntry,
  HermesModelConfig,
  HermesSkillInfo,
  HermesWorkspaceSnapshot,
  HermesWorkspaceTab,
} from '@/common/types/hermesWorkspace';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Message,
  Modal,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from '@arco-design/web-react';
import SettingsPageWrapper from '../components/SettingsPageWrapper';

const formatTime = (timestamp: number): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));

const EMPTY_MODEL_CONFIG: HermesModelConfig = {
  provider: 'auto',
  model: '',
  baseUrl: '',
};

const getActiveSection = (pathname: string): HermesWorkspaceTab => {
  if (pathname.includes('/settings/hermes-profiles')) return 'profiles';
  if (pathname.includes('/settings/hermes-providers')) return 'providers';
  if (pathname.includes('/settings/hermes-memory')) return 'memory';
  if (pathname.includes('/settings/hermes-skills')) return 'skills';
  if (pathname.includes('/settings/hermes-tools')) return 'tools';
  if (pathname.includes('/settings/hermes-gateway')) return 'gateway';
  if (pathname.includes('/settings/hermes-logs')) return 'logs';
  return 'persona';
};

const getSectionTitleKey = (section: HermesWorkspaceTab): string => {
  switch (section) {
    case 'profiles':
      return 'settings.hermesSettings.profiles';
    case 'providers':
      return 'settings.hermesSettings.providers';
    case 'memory':
      return 'settings.hermesSettings.memory';
    case 'skills':
      return 'settings.hermesSettings.skills';
    case 'tools':
      return 'settings.hermesSettings.tools';
    case 'gateway':
      return 'settings.hermesSettings.gateway';
    case 'logs':
      return 'settings.hermesSettings.logs';
    case 'persona':
    default:
      return 'settings.hermesSettings.persona';
  }
};

const formatCredentialEntries = (entries: HermesCredentialEntry[] = []): string =>
  entries.map((entry) => `${entry.label || entry.key}=${entry.key}`).join('\n');

const parseCredentialEntries = (content: string): HermesCredentialEntry[] =>
  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('=');
      if (separator < 0) return { label: line, key: line };
      return {
        label: line.slice(0, separator).trim(),
        key: line.slice(separator + 1).trim(),
      };
    })
    .filter((entry) => entry.key);

const SkillCard: React.FC<{
  skill: HermesSkillInfo;
  actionLoading: boolean;
  onPreview: (skill: HermesSkillInfo) => void;
  onInstall?: (skill: HermesSkillInfo) => void;
  onToggle?: (skill: HermesSkillInfo, enabled: boolean) => void;
  onUninstall?: (skill: HermesSkillInfo) => void;
}> = ({ skill, actionLoading, onPreview, onInstall, onToggle, onUninstall }) => {
  const { t } = useTranslation();

  return (
    <Card className='h-full' bordered>
      <div className='flex flex-col gap-12px h-full'>
        <div className='flex items-start justify-between gap-12px'>
          <div className='min-w-0'>
            <Typography.Text className='block text-15px font-medium'>{skill.name}</Typography.Text>
            {skill.category && <Tag size='small'>{skill.category}</Tag>}
          </div>
          {skill.source === 'installed' ? (
            <Space size='mini'>
              <Switch
                size='small'
                checked={skill.enabled}
                loading={actionLoading}
                onChange={(enabled) => onToggle?.(skill, enabled)}
              />
              <Button size='mini' status='danger' loading={actionLoading} onClick={() => onUninstall?.(skill)}>
                {t('settings.hermesSettings.uninstall')}
              </Button>
            </Space>
          ) : skill.installed ? (
            <Tag color='green'>{t('settings.hermesSettings.installed')}</Tag>
          ) : (
            <Button size='mini' type='primary' loading={actionLoading} onClick={() => onInstall?.(skill)}>
              {t('settings.hermesSettings.install')}
            </Button>
          )}
        </div>
        <Typography.Paragraph className='m-0 text-13px text-t-secondary line-clamp-3'>
          {skill.description || t('settings.hermesSettings.noDescription')}
        </Typography.Paragraph>
        <div className='mt-auto flex items-center justify-between gap-8px'>
          <Typography.Text className='text-12px text-t-tertiary truncate'>{skill.path}</Typography.Text>
          <Button size='mini' onClick={() => onPreview(skill)}>
            {t('settings.hermesSettings.view')}
          </Button>
        </div>
      </div>
    </Card>
  );
};

const HermesSettings: React.FC = () => {
  const { t } = useTranslation();
  const [message, messageContext] = Message.useMessage();
  const { pathname } = useLocation();
  const activeSection = getActiveSection(pathname);
  const [snapshot, setSnapshot] = useState<HermesWorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionKey, setActionKey] = useState('');
  const [personaDraft, setPersonaDraft] = useState('');
  const [memoryDraft, setMemoryDraft] = useState('');
  const [userDraft, setUserDraft] = useState('');
  const [memoryEntryDraft, setMemoryEntryDraft] = useState('');
  const [memoryEntryEdits, setMemoryEntryEdits] = useState<Record<number, string>>({});
  const [profileName, setProfileName] = useState('');
  const [cloneProfile, setCloneProfile] = useState(true);
  const [envDrafts, setEnvDrafts] = useState<Record<string, string>>({});
  const [modelDraft, setModelDraft] = useState<HermesModelConfig>(EMPTY_MODEL_CONFIG);
  const [credentialProvider, setCredentialProvider] = useState('');
  const [credentialEntriesText, setCredentialEntriesText] = useState('');
  const [selectedLogFile, setSelectedLogFile] = useState('agent.log');
  const [previewSkill, setPreviewSkill] = useState<HermesSkillInfo | null>(null);

  const syncDrafts = useCallback(
    (next: HermesWorkspaceSnapshot) => {
      setSnapshot(next);
      setPersonaDraft(next.persona.content);
      setMemoryDraft(next.memory.memoryContent);
      setUserDraft(next.memory.userContent);
      setMemoryEntryEdits(
        Object.fromEntries(next.memory.entries.map((entry) => [entry.index, entry.content])) as Record<number, string>
      );
      setEnvDrafts({ ...next.providers.env });
      setModelDraft(next.providers.model);
      const provider =
        credentialProvider ||
        next.providers.model.provider ||
        Object.keys(next.providers.credentialPool)[0] ||
        EMPTY_MODEL_CONFIG.provider;
      setCredentialProvider(provider);
      setCredentialEntriesText(formatCredentialEntries(next.providers.credentialPool[provider]));
      setSelectedLogFile(next.logs.selected);
    },
    [credentialProvider]
  );

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    try {
      const result = await ipcBridge.hermesWorkspace.getSnapshot.invoke();
      if (!result.success || !result.data) {
        message.error(result.msg || t('settings.hermesSettings.loadFailed'));
        return;
      }
      syncDrafts(result.data);
    } catch (error) {
      console.error('Failed to load Hermes workspace:', error);
      message.error(t('settings.hermesSettings.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [message, syncDrafts, t]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const runAction = useCallback(
    async (key: string, action: () => Promise<HermesWorkspaceSnapshot | null>, successKey: string) => {
      setActionKey(key);
      try {
        const next = await action();
        if (next) {
          syncDrafts(next);
          message.success(t(successKey));
        }
      } catch (error) {
        console.error('Hermes settings action failed:', error);
        message.error(error instanceof Error ? error.message : t('settings.hermesSettings.actionFailed'));
      } finally {
        setActionKey('');
      }
    },
    [message, syncDrafts, t]
  );

  const savePersona = useCallback(() => {
    void runAction(
      'persona.save',
      async () => {
        const result = await ipcBridge.hermesWorkspace.savePersona.invoke({ content: personaDraft });
        if (!result.success || !result.data) throw new Error(result.msg || t('settings.hermesSettings.saveFailed'));
        return result.data;
      },
      'settings.hermesSettings.saved'
    );
  }, [personaDraft, runAction, t]);

  const resetPersona = useCallback(() => {
    void runAction(
      'persona.reset',
      async () => {
        const result = await ipcBridge.hermesWorkspace.resetPersona.invoke();
        if (!result.success || !result.data) throw new Error(result.msg || t('settings.hermesSettings.resetFailed'));
        return result.data;
      },
      'settings.hermesSettings.resetDone'
    );
  }, [runAction, t]);

  const createProfile = useCallback(() => {
    void runAction(
      'profile.create',
      async () => {
        const result = await ipcBridge.hermesWorkspace.createProfile.invoke({
          name: profileName,
          cloneActive: cloneProfile,
        });
        if (!result.success || !result.data) throw new Error(result.msg || t('settings.hermesSettings.saveFailed'));
        setProfileName('');
        return result.data;
      },
      'settings.hermesSettings.profileCreated'
    );
  }, [cloneProfile, profileName, runAction, t]);

  const setActiveProfile = useCallback(
    (name: string) => {
      void runAction(
        `profile.active.${name}`,
        async () => {
          const result = await ipcBridge.hermesWorkspace.setActiveProfile.invoke({ name });
          if (!result.success || !result.data) throw new Error(result.msg || t('settings.hermesSettings.saveFailed'));
          return result.data;
        },
        'settings.hermesSettings.profileActivated'
      );
    },
    [runAction, t]
  );

  const deleteProfile = useCallback(
    (name: string) => {
      Modal.confirm({
        title: t('settings.hermesSettings.deleteProfileTitle'),
        content: t('settings.hermesSettings.deleteProfileConfirm', { name }),
        okButtonProps: { status: 'danger' },
        onOk: () => {
          void runAction(
            `profile.delete.${name}`,
            async () => {
              const result = await ipcBridge.hermesWorkspace.deleteProfile.invoke({ name });
              if (!result.success || !result.data)
                throw new Error(result.msg || t('settings.hermesSettings.saveFailed'));
              return result.data;
            },
            'settings.hermesSettings.profileDeleted'
          );
        },
      });
    },
    [runAction, t]
  );

  const saveModelConfig = useCallback(() => {
    void runAction(
      'providers.model',
      async () => {
        const result = await ipcBridge.hermesWorkspace.setModelConfig.invoke(modelDraft);
        if (!result.success || !result.data) throw new Error(result.msg || t('settings.hermesSettings.saveFailed'));
        return result.data;
      },
      'settings.hermesSettings.saved'
    );
  }, [modelDraft, runAction, t]);

  const saveEnv = useCallback(
    (key: string) => {
      void runAction(
        `providers.env.${key}`,
        async () => {
          const result = await ipcBridge.hermesWorkspace.setEnv.invoke({ key, value: envDrafts[key] ?? '' });
          if (!result.success || !result.data) throw new Error(result.msg || t('settings.hermesSettings.saveFailed'));
          return result.data;
        },
        'settings.hermesSettings.saved'
      );
    },
    [envDrafts, runAction, t]
  );

  const saveCredentialPool = useCallback(() => {
    void runAction(
      'providers.credentials',
      async () => {
        const result = await ipcBridge.hermesWorkspace.setCredentialPool.invoke({
          provider: credentialProvider,
          entries: parseCredentialEntries(credentialEntriesText),
        });
        if (!result.success || !result.data) throw new Error(result.msg || t('settings.hermesSettings.saveFailed'));
        return result.data;
      },
      'settings.hermesSettings.saved'
    );
  }, [credentialEntriesText, credentialProvider, runAction, t]);

  const saveMemory = useCallback(
    (target: 'memory' | 'user') => {
      const content = target === 'memory' ? memoryDraft : userDraft;
      void runAction(
        `memory.${target}`,
        async () => {
          const result = await ipcBridge.hermesWorkspace.saveMemory.invoke({ target, content });
          if (!result.success || !result.data) throw new Error(result.msg || t('settings.hermesSettings.saveFailed'));
          return result.data;
        },
        'settings.hermesSettings.saved'
      );
    },
    [memoryDraft, runAction, t, userDraft]
  );

  const addMemoryEntry = useCallback(() => {
    void runAction(
      'memory.entry.add',
      async () => {
        const result = await ipcBridge.hermesWorkspace.addMemoryEntry.invoke({ content: memoryEntryDraft });
        if (!result.success || !result.data) throw new Error(result.msg || t('settings.hermesSettings.saveFailed'));
        setMemoryEntryDraft('');
        return result.data;
      },
      'settings.hermesSettings.saved'
    );
  }, [memoryEntryDraft, runAction, t]);

  const updateMemoryEntry = useCallback(
    (index: number) => {
      void runAction(
        `memory.entry.update.${index}`,
        async () => {
          const result = await ipcBridge.hermesWorkspace.updateMemoryEntry.invoke({
            index,
            content: memoryEntryEdits[index] ?? '',
          });
          if (!result.success || !result.data) throw new Error(result.msg || t('settings.hermesSettings.saveFailed'));
          return result.data;
        },
        'settings.hermesSettings.saved'
      );
    },
    [memoryEntryEdits, runAction, t]
  );

  const removeMemoryEntry = useCallback(
    (index: number) => {
      void runAction(
        `memory.entry.remove.${index}`,
        async () => {
          const result = await ipcBridge.hermesWorkspace.removeMemoryEntry.invoke({ index });
          if (!result.success || !result.data) throw new Error(result.msg || t('settings.hermesSettings.saveFailed'));
          return result.data;
        },
        'settings.hermesSettings.removed'
      );
    },
    [runAction, t]
  );

  const setMemoryProvider = useCallback(
    (provider: string) => {
      void runAction(
        `memory.provider.${provider}`,
        async () => {
          const result = await ipcBridge.hermesWorkspace.setMemoryProvider.invoke({ provider });
          if (!result.success || !result.data) throw new Error(result.msg || t('settings.hermesSettings.saveFailed'));
          return result.data;
        },
        'settings.hermesSettings.saved'
      );
    },
    [runAction, t]
  );

  const installSkill = useCallback(
    (skill: HermesSkillInfo) => {
      void runAction(
        `skill.install.${skill.id}`,
        async () => {
          const result = await ipcBridge.hermesWorkspace.installBundledSkill.invoke({ id: skill.id });
          if (!result.success || !result.data)
            throw new Error(result.msg || t('settings.hermesSettings.installFailed'));
          return result.data;
        },
        'settings.hermesSettings.installDone'
      );
    },
    [runAction, t]
  );

  const uninstallSkill = useCallback(
    (skill: HermesSkillInfo) => {
      Modal.confirm({
        title: t('settings.hermesSettings.uninstallSkillTitle'),
        content: t('settings.hermesSettings.uninstallSkillConfirm', { name: skill.name }),
        okButtonProps: { status: 'danger' },
        onOk: () => {
          void runAction(
            `skill.uninstall.${skill.name}`,
            async () => {
              const result = await ipcBridge.hermesWorkspace.uninstallSkill.invoke({ name: skill.name });
              if (!result.success || !result.data)
                throw new Error(result.msg || t('settings.hermesSettings.saveFailed'));
              return result.data;
            },
            'settings.hermesSettings.uninstallDone'
          );
        },
      });
    },
    [runAction, t]
  );

  const toggleSkill = useCallback(
    (skill: HermesSkillInfo, enabled: boolean) => {
      void runAction(
        `skill.toggle.${skill.name}`,
        async () => {
          const result = await ipcBridge.hermesWorkspace.setSkillEnabled.invoke({ name: skill.name, enabled });
          if (!result.success || !result.data) throw new Error(result.msg || t('settings.hermesSettings.saveFailed'));
          return result.data;
        },
        enabled ? 'settings.hermesSettings.enabled' : 'settings.hermesSettings.disabled'
      );
    },
    [runAction, t]
  );

  const toggleToolset = useCallback(
    (key: string, enabled: boolean) => {
      void runAction(
        `toolset.${key}`,
        async () => {
          const result = await ipcBridge.hermesWorkspace.setToolsetEnabled.invoke({ key, enabled });
          if (!result.success || !result.data) throw new Error(result.msg || t('settings.hermesSettings.saveFailed'));
          return result.data;
        },
        enabled ? 'settings.hermesSettings.enabled' : 'settings.hermesSettings.disabled'
      );
    },
    [runAction, t]
  );

  const toggleGatewayPlatform = useCallback(
    (platform: string, enabled: boolean) => {
      void runAction(
        `gateway.platform.${platform}`,
        async () => {
          const result = await ipcBridge.hermesWorkspace.setGatewayPlatform.invoke({ platform, enabled });
          if (!result.success || !result.data) throw new Error(result.msg || t('settings.hermesSettings.saveFailed'));
          return result.data;
        },
        enabled ? 'settings.hermesSettings.enabled' : 'settings.hermesSettings.disabled'
      );
    },
    [runAction, t]
  );

  const setGatewayRunning = useCallback(
    (running: boolean) => {
      void runAction(
        running ? 'gateway.start' : 'gateway.stop',
        async () => {
          const result = running
            ? await ipcBridge.hermesWorkspace.startGateway.invoke()
            : await ipcBridge.hermesWorkspace.stopGateway.invoke();
          if (!result.success || !result.data) throw new Error(result.msg || t('settings.hermesSettings.saveFailed'));
          return result.data;
        },
        running ? 'settings.hermesSettings.gatewayStarted' : 'settings.hermesSettings.gatewayStopped'
      );
    },
    [runAction, t]
  );

  const readLog = useCallback(
    (file: string) => {
      setSelectedLogFile(file);
      void runAction(
        `logs.${file}`,
        async () => {
          const result = await ipcBridge.hermesWorkspace.readLog.invoke({ file });
          if (!result.success || !result.data) throw new Error(result.msg || t('settings.hermesSettings.loadFailed'));
          return result.data;
        },
        'settings.hermesSettings.logLoaded'
      );
    },
    [runAction, t]
  );

  const installedSkillCount = snapshot?.skills.installed.length ?? 0;
  const bundledSkillCount = snapshot?.skills.bundled.length ?? 0;
  const enabledToolsetCount = useMemo(
    () => snapshot?.tools.toolsets.filter((toolset) => toolset.enabled).length ?? 0,
    [snapshot?.tools.toolsets]
  );

  const sectionContent = (() => {
    switch (activeSection) {
      case 'profiles':
        return (
          <div className='flex flex-col gap-16px'>
            <Card title={t('settings.hermesSettings.createProfile')} bordered>
              <div className='flex flex-col md:flex-row md:items-center gap-12px'>
                <Input
                  value={profileName}
                  onChange={setProfileName}
                  placeholder={t('settings.hermesSettings.profileNamePlaceholder')}
                />
                <Space>
                  <Typography.Text>{t('settings.hermesSettings.cloneActiveProfile')}</Typography.Text>
                  <Switch checked={cloneProfile} onChange={setCloneProfile} />
                </Space>
                <Button type='primary' loading={actionKey === 'profile.create'} onClick={createProfile}>
                  {t('settings.hermesSettings.create')}
                </Button>
              </div>
            </Card>
            <Card title={t('settings.hermesSettings.profileList')} bordered>
              <div className='grid grid-cols-1 lg:grid-cols-2 gap-12px'>
                {snapshot?.profiles.profiles.map((profile) => (
                  <div key={profile.name} className='p-14px rd-10px bg-fill-2 flex flex-col gap-10px'>
                    <div className='flex items-start justify-between gap-12px'>
                      <div className='min-w-0'>
                        <div className='flex items-center gap-8px'>
                          <Typography.Text className='font-medium'>{profile.name}</Typography.Text>
                          {profile.isActive && <Tag color='green'>{t('settings.hermesSettings.active')}</Tag>}
                          {profile.isDefault && <Tag>{t('settings.hermesSettings.defaultProfile')}</Tag>}
                        </div>
                        <Typography.Text className='block text-12px text-t-tertiary truncate'>
                          {profile.path}
                        </Typography.Text>
                      </div>
                      <Space size='mini'>
                        {!profile.isActive && (
                          <Button
                            size='mini'
                            loading={actionKey === `profile.active.${profile.name}`}
                            onClick={() => setActiveProfile(profile.name)}
                          >
                            {t('settings.hermesSettings.use')}
                          </Button>
                        )}
                        {!profile.isDefault && (
                          <Button
                            size='mini'
                            status='danger'
                            loading={actionKey === `profile.delete.${profile.name}`}
                            onClick={() => deleteProfile(profile.name)}
                          >
                            {t('settings.hermesSettings.delete')}
                          </Button>
                        )}
                      </Space>
                    </div>
                    <Space wrap size='mini'>
                      <Tag>{t('settings.hermesSettings.providerMeta', { provider: profile.provider || '-' })}</Tag>
                      <Tag>{t('settings.hermesSettings.modelMeta', { model: profile.model || '-' })}</Tag>
                      <Tag>{t('settings.hermesSettings.skillMeta', { count: profile.skillCount })}</Tag>
                      {profile.hasEnv && <Tag>{t('settings.hermesSettings.envConfigured')}</Tag>}
                      {profile.hasPersona && <Tag>{t('settings.hermesSettings.personaConfigured')}</Tag>}
                      {profile.gatewayRunning && <Tag color='green'>{t('settings.hermesSettings.gatewayRunning')}</Tag>}
                    </Space>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        );
      case 'providers':
        return (
          <div className='flex flex-col gap-16px'>
            <Card title={t('settings.hermesSettings.modelConfig')} bordered>
              <div className='grid grid-cols-1 md:grid-cols-3 gap-12px'>
                <Input
                  value={modelDraft.provider}
                  onChange={(provider) => setModelDraft((current) => ({ ...current, provider }))}
                  placeholder={t('settings.hermesSettings.providerPlaceholder')}
                />
                <Input
                  value={modelDraft.model}
                  onChange={(model) => setModelDraft((current) => ({ ...current, model }))}
                  placeholder={t('settings.hermesSettings.modelPlaceholder')}
                />
                <Input
                  value={modelDraft.baseUrl}
                  onChange={(baseUrl) => setModelDraft((current) => ({ ...current, baseUrl }))}
                  placeholder={t('settings.hermesSettings.baseUrlPlaceholder')}
                />
              </div>
              <div className='mt-12px'>
                <Button type='primary' loading={actionKey === 'providers.model'} onClick={saveModelConfig}>
                  {t('settings.hermesSettings.save')}
                </Button>
              </div>
            </Card>
            <Card title={t('settings.hermesSettings.envVars')} bordered>
              <Typography.Text className='block text-12px text-t-tertiary mb-10px'>
                {snapshot?.providers.envPath}
              </Typography.Text>
              <div className='grid grid-cols-1 lg:grid-cols-2 gap-10px'>
                {snapshot?.providers.envKeys.map((key) => (
                  <div key={key} className='p-10px rd-8px bg-fill-2 flex flex-col gap-8px'>
                    <Typography.Text className='text-12px font-medium'>{key}</Typography.Text>
                    <div className='flex gap-8px'>
                      <Input.Password
                        value={envDrafts[key] ?? ''}
                        visibilityToggle
                        placeholder={t('settings.hermesSettings.envValuePlaceholder')}
                        onChange={(value) => setEnvDrafts((current) => ({ ...current, [key]: value }))}
                      />
                      <Button loading={actionKey === `providers.env.${key}`} onClick={() => saveEnv(key)}>
                        {t('settings.hermesSettings.save')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card title={t('settings.hermesSettings.credentialPool')} bordered>
              <div className='flex flex-col gap-10px'>
                <Typography.Text className='text-12px text-t-tertiary'>{snapshot?.providers.authPath}</Typography.Text>
                <Input
                  value={credentialProvider}
                  onChange={(provider) => {
                    setCredentialProvider(provider);
                    setCredentialEntriesText(formatCredentialEntries(snapshot?.providers.credentialPool[provider]));
                  }}
                  placeholder={t('settings.hermesSettings.credentialProviderPlaceholder')}
                />
                <Input.TextArea
                  value={credentialEntriesText}
                  onChange={setCredentialEntriesText}
                  autoSize={{ minRows: 6, maxRows: 12 }}
                  placeholder={t('settings.hermesSettings.credentialPoolPlaceholder')}
                />
                <Button type='primary' loading={actionKey === 'providers.credentials'} onClick={saveCredentialPool}>
                  {t('settings.hermesSettings.save')}
                </Button>
              </div>
            </Card>
            <Card title={t('settings.hermesSettings.savedModels')} bordered>
              {snapshot?.providers.savedModels.length ? (
                <div className='grid grid-cols-1 md:grid-cols-2 gap-8px'>
                  {snapshot.providers.savedModels.map((model) => (
                    <div key={model.id} className='p-10px rd-8px bg-fill-2 flex flex-col gap-4px'>
                      <Typography.Text className='font-medium'>{model.name}</Typography.Text>
                      <Typography.Text className='text-12px text-t-secondary'>
                        {model.provider} / {model.model}
                      </Typography.Text>
                      <Typography.Text className='text-12px text-t-tertiary'>{model.baseUrl}</Typography.Text>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty description={t('settings.hermesSettings.noSavedModels')} />
              )}
            </Card>
          </div>
        );
      case 'memory':
        return (
          <div className='flex flex-col gap-16px'>
            <Card title={t('settings.hermesSettings.memoryProviderTitle')} bordered>
              <div className='grid grid-cols-1 lg:grid-cols-2 gap-12px'>
                <div className='flex flex-col gap-8px'>
                  <Typography.Text className='text-13px text-t-secondary'>
                    {t('settings.hermesSettings.memoryProvider', {
                      provider: snapshot?.memory.provider || t('settings.hermesSettings.builtinOnly'),
                    })}
                  </Typography.Text>
                  <Select
                    value={snapshot?.memory.provider}
                    onChange={(value) => setMemoryProvider(String(value))}
                    placeholder={t('settings.hermesSettings.memoryProviderPlaceholder')}
                  >
                    {snapshot?.memory.providers.map((provider) => (
                      <Select.Option key={provider.name} value={provider.name}>
                        {provider.name}
                      </Select.Option>
                    ))}
                  </Select>
                </div>
                <Space wrap>
                  <Tag>
                    {t('settings.hermesSettings.memoryChars', { count: snapshot?.memory.stats.memoryChars ?? 0 })}
                  </Tag>
                  <Tag>{t('settings.hermesSettings.userChars', { count: snapshot?.memory.stats.userChars ?? 0 })}</Tag>
                  <Tag>
                    {t('settings.hermesSettings.sessionCount', { count: snapshot?.memory.stats.totalSessions ?? 0 })}
                  </Tag>
                  <Tag>
                    {t('settings.hermesSettings.messageCount', { count: snapshot?.memory.stats.totalMessages ?? 0 })}
                  </Tag>
                </Space>
              </div>
            </Card>
            <Card title={t('settings.hermesSettings.memoryEntries')} bordered>
              <div className='flex flex-col gap-12px'>
                <Input.TextArea
                  value={memoryEntryDraft}
                  onChange={setMemoryEntryDraft}
                  autoSize={{ minRows: 3, maxRows: 8 }}
                  placeholder={t('settings.hermesSettings.memoryEntryPlaceholder')}
                />
                <Button type='primary' loading={actionKey === 'memory.entry.add'} onClick={addMemoryEntry}>
                  {t('settings.hermesSettings.addMemoryEntry')}
                </Button>
                {snapshot?.memory.entries.length ? (
                  snapshot.memory.entries.map((entry) => (
                    <div key={entry.index} className='p-10px rd-8px bg-fill-2 flex flex-col gap-8px'>
                      <Input.TextArea
                        value={memoryEntryEdits[entry.index] ?? entry.content}
                        onChange={(content) =>
                          setMemoryEntryEdits((current) => ({ ...current, [entry.index]: content }))
                        }
                        autoSize={{ minRows: 3, maxRows: 8 }}
                      />
                      <Space>
                        <Button
                          size='small'
                          loading={actionKey === `memory.entry.update.${entry.index}`}
                          onClick={() => updateMemoryEntry(entry.index)}
                        >
                          {t('settings.hermesSettings.save')}
                        </Button>
                        <Button
                          size='small'
                          status='danger'
                          loading={actionKey === `memory.entry.remove.${entry.index}`}
                          onClick={() => removeMemoryEntry(entry.index)}
                        >
                          {t('settings.hermesSettings.delete')}
                        </Button>
                      </Space>
                    </div>
                  ))
                ) : (
                  <Empty description={t('settings.hermesSettings.noMemoryEntries')} />
                )}
              </div>
            </Card>
            <div className='grid grid-cols-1 xl:grid-cols-2 gap-16px'>
              <Card title={t('settings.hermesSettings.agentMemory')} bordered>
                <div className='flex flex-col gap-10px'>
                  <Typography.Text className='text-12px text-t-tertiary'>{snapshot?.memory.memoryPath}</Typography.Text>
                  <Input.TextArea
                    value={memoryDraft}
                    onChange={setMemoryDraft}
                    autoSize={{ minRows: 12, maxRows: 20 }}
                    placeholder={t('settings.hermesSettings.agentMemoryPlaceholder')}
                  />
                  <Button type='primary' loading={actionKey === 'memory.memory'} onClick={() => saveMemory('memory')}>
                    {t('settings.hermesSettings.save')}
                  </Button>
                </div>
              </Card>
              <Card title={t('settings.hermesSettings.userMemory')} bordered>
                <div className='flex flex-col gap-10px'>
                  <Typography.Text className='text-12px text-t-tertiary'>{snapshot?.memory.userPath}</Typography.Text>
                  <Input.TextArea
                    value={userDraft}
                    onChange={setUserDraft}
                    autoSize={{ minRows: 12, maxRows: 20 }}
                    placeholder={t('settings.hermesSettings.userMemoryPlaceholder')}
                  />
                  <Button type='primary' loading={actionKey === 'memory.user'} onClick={() => saveMemory('user')}>
                    {t('settings.hermesSettings.save')}
                  </Button>
                </div>
              </Card>
              <Card title={t('settings.hermesSettings.memoryFiles')} bordered className='xl:col-span-2'>
                {snapshot?.memory.files.length ? (
                  <div className='grid grid-cols-1 md:grid-cols-2 gap-8px'>
                    {snapshot.memory.files.map((file) => (
                      <div key={file.path} className='p-10px rd-8px bg-fill-2 flex flex-col gap-4px'>
                        <Typography.Text className='font-medium'>{file.name}</Typography.Text>
                        <Typography.Text className='text-12px text-t-secondary'>
                          {t('settings.hermesSettings.fileMeta', {
                            size: file.size,
                            time: formatTime(file.updatedAt),
                          })}
                        </Typography.Text>
                        <Typography.Text className='text-12px text-t-tertiary truncate'>{file.path}</Typography.Text>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty description={t('settings.hermesSettings.noMemoryFiles')} />
                )}
              </Card>
            </div>
          </div>
        );
      case 'skills':
        return (
          <div className='flex flex-col gap-16px'>
            <Alert type='info' content={t('settings.hermesSettings.skillsHint')} />
            <Card title={t('settings.hermesSettings.installedSkillList')} bordered>
              {snapshot?.skills.installed.length ? (
                <div className='grid grid-cols-1 lg:grid-cols-2 gap-12px'>
                  {snapshot.skills.installed.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      actionLoading={
                        actionKey === `skill.toggle.${skill.name}` || actionKey === `skill.uninstall.${skill.name}`
                      }
                      onPreview={setPreviewSkill}
                      onToggle={toggleSkill}
                      onUninstall={uninstallSkill}
                    />
                  ))}
                </div>
              ) : (
                <Empty description={t('settings.hermesSettings.noInstalledSkills')} />
              )}
            </Card>
            <Card title={t('settings.hermesSettings.bundledSkillList')} bordered>
              {snapshot?.skills.bundled.length ? (
                <div className='grid grid-cols-1 lg:grid-cols-2 gap-12px'>
                  {snapshot.skills.bundled.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      actionLoading={actionKey === `skill.install.${skill.id}`}
                      onPreview={setPreviewSkill}
                      onInstall={installSkill}
                    />
                  ))}
                </div>
              ) : (
                <Empty description={t('settings.hermesSettings.noBundledSkills')} />
              )}
            </Card>
          </div>
        );
      case 'tools':
        return (
          <div className='flex flex-col gap-16px'>
            <Alert type='warning' content={t('settings.hermesSettings.toolsHint')} />
            <Card title={t('settings.hermesSettings.toolsets')} bordered>
              <div className='grid grid-cols-1 lg:grid-cols-2 gap-12px'>
                {snapshot?.tools.toolsets.map((toolset) => (
                  <div key={toolset.key} className='p-14px rd-10px bg-fill-2 flex items-start justify-between gap-12px'>
                    <div className='min-w-0'>
                      <div className='flex items-center gap-8px'>
                        <Typography.Text className='font-medium'>{toolset.label}</Typography.Text>
                        <Tag size='small'>{toolset.key}</Tag>
                      </div>
                      <Typography.Paragraph className='m-0 mt-4px text-13px text-t-secondary'>
                        {toolset.description}
                      </Typography.Paragraph>
                    </div>
                    <Switch
                      checked={toolset.enabled}
                      loading={actionKey === `toolset.${toolset.key}`}
                      onChange={(enabled) => toggleToolset(toolset.key, enabled)}
                    />
                  </div>
                ))}
              </div>
            </Card>
            <Card title={t('settings.hermesSettings.mcpServers')} bordered>
              {snapshot?.tools.mcpServers.length ? (
                <div className='grid grid-cols-1 lg:grid-cols-2 gap-10px'>
                  {snapshot.tools.mcpServers.map((server) => (
                    <div key={server.name} className='p-10px rd-8px bg-fill-2 flex flex-col gap-4px'>
                      <Space>
                        <Typography.Text className='font-medium'>{server.name}</Typography.Text>
                        <Tag>{server.type}</Tag>
                        <Tag color={server.enabled ? 'green' : 'gray'}>
                          {server.enabled
                            ? t('settings.hermesSettings.enabled')
                            : t('settings.hermesSettings.disabled')}
                        </Tag>
                      </Space>
                      <Typography.Text className='text-12px text-t-tertiary truncate'>{server.detail}</Typography.Text>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty description={t('settings.hermesSettings.noMcpServers')} />
              )}
            </Card>
          </div>
        );
      case 'gateway':
        return (
          <div className='flex flex-col gap-16px'>
            <Card title={t('settings.hermesSettings.gatewayStatus')} bordered>
              <div className='flex items-center justify-between gap-12px'>
                <Space wrap>
                  <Tag color={snapshot?.gateway.running ? 'green' : 'gray'}>
                    {snapshot?.gateway.running
                      ? t('settings.hermesSettings.gatewayRunning')
                      : t('settings.hermesSettings.gatewayStoppedState')}
                  </Tag>
                  {snapshot?.gateway.pid && (
                    <Tag>{t('settings.hermesSettings.pidMeta', { pid: snapshot.gateway.pid })}</Tag>
                  )}
                </Space>
                <Button
                  type={snapshot?.gateway.running ? 'secondary' : 'primary'}
                  status={snapshot?.gateway.running ? 'danger' : undefined}
                  loading={actionKey === 'gateway.start' || actionKey === 'gateway.stop'}
                  onClick={() => setGatewayRunning(!snapshot?.gateway.running)}
                >
                  {snapshot?.gateway.running
                    ? t('settings.hermesSettings.stopGateway')
                    : t('settings.hermesSettings.startGateway')}
                </Button>
              </div>
              <Typography.Paragraph className='m-0 mt-10px text-13px text-t-secondary'>
                {t('settings.hermesSettings.gatewayHint')}
              </Typography.Paragraph>
            </Card>
            <Card title={t('settings.hermesSettings.gatewayPlatforms')} bordered>
              <div className='grid grid-cols-1 lg:grid-cols-2 gap-12px'>
                {snapshot?.gateway.platforms.map((platform) => (
                  <div
                    key={platform.key}
                    className='p-14px rd-10px bg-fill-2 flex items-start justify-between gap-12px'
                  >
                    <div className='min-w-0'>
                      <div className='flex items-center gap-8px'>
                        <Typography.Text className='font-medium'>{platform.label}</Typography.Text>
                        <Tag size='small'>{platform.key}</Tag>
                      </div>
                      <Typography.Paragraph className='m-0 mt-4px text-13px text-t-secondary'>
                        {platform.description}
                      </Typography.Paragraph>
                      <Typography.Text className='block mt-4px text-12px text-t-tertiary'>
                        {t('settings.hermesSettings.requiredEnv', { fields: platform.fields.join(', ') })}
                      </Typography.Text>
                    </div>
                    <Switch
                      checked={platform.enabled}
                      loading={actionKey === `gateway.platform.${platform.key}`}
                      onChange={(enabled) => toggleGatewayPlatform(platform.key, enabled)}
                    />
                  </div>
                ))}
              </div>
            </Card>
          </div>
        );
      case 'logs':
        return (
          <Card title={t('settings.hermesSettings.logViewer')} bordered>
            <div className='flex flex-col gap-12px'>
              <Space>
                <Select value={selectedLogFile} onChange={(value) => readLog(String(value))} style={{ width: 220 }}>
                  {snapshot?.logs.available.map((file) => (
                    <Select.Option key={file} value={file}>
                      {file}
                    </Select.Option>
                  ))}
                </Select>
                <Button loading={actionKey === `logs.${selectedLogFile}`} onClick={() => readLog(selectedLogFile)}>
                  {t('settings.hermesSettings.refresh')}
                </Button>
              </Space>
              <Typography.Text className='text-12px text-t-tertiary'>{snapshot?.logs.path}</Typography.Text>
              {snapshot?.logs.content ? (
                <pre className='m-0 p-12px rd-8px bg-fill-2 text-12px overflow-auto max-h-70vh whitespace-pre-wrap'>
                  {snapshot.logs.content}
                </pre>
              ) : (
                <Empty description={t('settings.hermesSettings.noLogs')} />
              )}
            </div>
          </Card>
        );
      case 'persona':
      default:
        return (
          <Card bordered>
            <div className='flex flex-col gap-12px'>
              <Alert type='info' content={t('settings.hermesSettings.personaHint')} />
              <Typography.Text className='text-12px text-t-tertiary'>{snapshot?.persona.path}</Typography.Text>
              <Input.TextArea
                value={personaDraft}
                onChange={setPersonaDraft}
                autoSize={{ minRows: 14, maxRows: 24 }}
                placeholder={t('settings.hermesSettings.personaPlaceholder')}
              />
              <Space>
                <Button type='primary' loading={actionKey === 'persona.save'} onClick={savePersona}>
                  {t('settings.hermesSettings.save')}
                </Button>
                <Button loading={actionKey === 'persona.reset'} onClick={resetPersona}>
                  {t('settings.hermesSettings.resetDefault')}
                </Button>
              </Space>
            </div>
          </Card>
        );
    }
  })();

  return (
    <SettingsPageWrapper contentClassName='max-w-1200px'>
      {messageContext}
      <Spin loading={loading && !snapshot} className='w-full'>
        <div className='flex flex-col gap-16px'>
          <div className='flex items-start justify-between gap-16px'>
            <div>
              <Typography.Title heading={4} className='m-0'>
                {t(getSectionTitleKey(activeSection))}
              </Typography.Title>
              <Typography.Paragraph className='m-0 mt-6px text-t-secondary'>
                {t('settings.hermesSettings.description')}
              </Typography.Paragraph>
            </div>
            <Button loading={loading} onClick={() => void loadSnapshot()}>
              {t('settings.hermesSettings.refresh')}
            </Button>
          </div>

          {snapshot && (
            <Alert
              type='info'
              content={
                <Space wrap>
                  <Tag>{snapshot.paths.hermesHome}</Tag>
                  <Tag>{snapshot.paths.activeHome}</Tag>
                  <Tag>{t('settings.hermesSettings.activeProfileMeta', { name: snapshot.profiles.active })}</Tag>
                  <Tag>{t('settings.hermesSettings.installedSkills', { count: installedSkillCount })}</Tag>
                  <Tag>{t('settings.hermesSettings.bundledSkills', { count: bundledSkillCount })}</Tag>
                  <Tag>{t('settings.hermesSettings.enabledToolsets', { count: enabledToolsetCount })}</Tag>
                </Space>
              }
            />
          )}

          {sectionContent}
        </div>
      </Spin>

      <Modal
        title={previewSkill?.name}
        visible={Boolean(previewSkill)}
        footer={null}
        onCancel={() => setPreviewSkill(null)}
        style={{ width: 'min(900px, 92vw)' }}
      >
        <Typography.Paragraph className='whitespace-pre-wrap max-h-70vh overflow-auto'>
          {previewSkill?.content}
        </Typography.Paragraph>
      </Modal>
    </SettingsPageWrapper>
  );
};

export default HermesSettings;
