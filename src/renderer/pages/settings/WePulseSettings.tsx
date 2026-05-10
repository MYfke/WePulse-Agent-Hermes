/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ipcBridge } from '@/common';
import type { WePulseStatus } from '@/common/config/wepulse';
import type { HermesAgentRuntimeConfig, HermesAgentUpdateStatus } from '@/common/update/updateTypes';
import { Alert, Button, Card, Form, Input, Message, Space, Switch, Tag, Typography } from '@arco-design/web-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import SettingsPageWrapper from './components/SettingsPageWrapper';

type WePulseFormValues = {
  sub2apiBaseUrl: string;
};

const formatTime = (timestamp?: number): string => {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
};

const getHermesInstallStageText = (stage: HermesAgentUpdateStatus['installStage'], t: TFunction): string => {
  switch (stage) {
    case 'checking':
      return t('settings.wepulse.hermesAgent.stageChecking');
    case 'downloading':
      return t('settings.wepulse.hermesAgent.stageDownloading');
    case 'python':
      return t('settings.wepulse.hermesAgent.stagePython');
    case 'venv':
      return t('settings.wepulse.hermesAgent.stageVenv');
    case 'dependencies':
      return t('settings.wepulse.hermesAgent.stageDependencies');
    case 'wrapper':
      return t('settings.wepulse.hermesAgent.stageWrapper');
    case 'verifying':
      return t('settings.wepulse.hermesAgent.stageVerifying');
    case 'complete':
      return t('settings.wepulse.hermesAgent.stageComplete');
    default:
      return t('settings.wepulse.hermesAgent.installing');
  }
};

const parseHermesVersionOutput = (output?: string): { releaseDate?: string; python?: string; openaiSdk?: string } => {
  if (!output) return {};
  return {
    releaseDate: output.match(/\(([\d.]+)\)/)?.[1],
    python: output.match(/Python:\s*([\d.]+)/i)?.[1],
    openaiSdk: output.match(/OpenAI SDK:\s*([\d.]+)/i)?.[1],
  };
};

const WePulseSettings: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const auth = useAuth();
  const [form] = Form.useForm<WePulseFormValues>();
  const [message, messageContext] = Message.useMessage();
  const [status, setStatus] = useState<WePulseStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [hermesStatus, setHermesStatus] = useState<HermesAgentUpdateStatus | null>(null);
  const [hermesConfig, setHermesConfig] = useState<HermesAgentRuntimeConfig | null>(null);
  const [checkingHermes, setCheckingHermes] = useState(false);
  const [updatingHermes, setUpdatingHermes] = useState(false);
  const [savingHermesConfig, setSavingHermesConfig] = useState(false);
  const [doctorRunning, setDoctorRunning] = useState(false);
  const [dumpRunning, setDumpRunning] = useState(false);
  const [backupRunning, setBackupRunning] = useState(false);
  const [importRunning, setImportRunning] = useState(false);
  const [hermesUpdateOutput, setHermesUpdateOutput] = useState('');
  const [hermesDiagnosticOutput, setHermesDiagnosticOutput] = useState('');
  const [hermesDiagnosticTitle, setHermesDiagnosticTitle] = useState('');
  const [hermesDataResult, setHermesDataResult] = useState('');

  const accountLabel = useMemo(() => {
    if (!status?.account) return t('settings.wepulse.notSignedIn');
    return status.account.phone || String(status.account.userId || status.account.accountId);
  }, [status?.account, t]);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const result = await ipcBridge.wepulseAuth.status.invoke();
      if (!result.success || !result.data) {
        message.error(result.msg || t('settings.wepulse.loadFailed'));
        return;
      }
      setStatus(result.data);
      form.setFieldsValue({ sub2apiBaseUrl: result.data.sub2apiBaseUrl });
    } catch (error) {
      console.error('Failed to load WePulse status:', error);
      message.error(t('settings.wepulse.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [form, message, t]);

  const loadHermesStatus = useCallback(
    async (showSuccess = false, silent = false) => {
      if (!silent) setCheckingHermes(true);
      try {
        const result = await ipcBridge.hermesAgent.checkUpdate.invoke();
        if (!result.success || !result.data) {
          if (!silent) message.error(result.msg || t('settings.wepulse.hermesAgent.checkFailed', { error: '' }));
          return;
        }
        setHermesStatus(result.data);
        if (showSuccess && !silent) {
          message.success(t('settings.wepulse.hermesAgent.checkSuccess'));
        }
      } catch (error) {
        console.error('Failed to check Hermes Agent update:', error);
        if (!silent) message.error(t('settings.wepulse.hermesAgent.checkFailed', { error: String(error) }));
      } finally {
        if (!silent) setCheckingHermes(false);
      }
    },
    [message, t]
  );

  const loadHermesConfig = useCallback(async () => {
    try {
      const result = await ipcBridge.hermesAgent.getConfig.invoke();
      if (result.success && result.data) {
        setHermesConfig(result.data);
      }
    } catch (error) {
      console.error('Failed to load Hermes config:', error);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadHermesStatus();
    void loadHermesConfig();
  }, [loadHermesConfig, loadHermesStatus, loadStatus]);

  useEffect(() => {
    if (hermesStatus?.installStatus !== 'installing') return;
    const timer = window.setInterval(() => {
      void loadHermesStatus(false, true);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [hermesStatus?.installStatus, loadHermesStatus]);

  const handleSave = useCallback(async () => {
    const values = await form.validate();
    setLoading(true);
    try {
      const result = await ipcBridge.wepulseAuth.updateConfig.invoke({
        sub2apiBaseUrl: values.sub2apiBaseUrl,
      });
      if (!result.success || !result.data) {
        message.error(result.msg || t('settings.wepulse.saveFailed'));
        return;
      }
      setStatus(result.data);
      form.setFieldsValue({ sub2apiBaseUrl: result.data.sub2apiBaseUrl });
      message.success(t('settings.wepulse.saveSuccess'));
    } catch (error) {
      console.error('Failed to save WePulse config:', error);
      message.error(t('settings.wepulse.saveFailed'));
    } finally {
      setLoading(false);
    }
  }, [form, message, t]);

  const handleSyncModels = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await ipcBridge.wepulseAuth.syncModels.invoke();
      if (!result.success || !result.data) {
        message.error(result.msg || t('settings.wepulse.syncFailed'));
        return;
      }
      setStatus(result.data);
      message.success(t('settings.wepulse.syncSuccess'));
    } catch (error) {
      console.error('Failed to sync WePulse models:', error);
      message.error(t('settings.wepulse.syncFailed'));
    } finally {
      setSyncing(false);
    }
  }, [message, t]);

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await auth.logout();
      message.success(t('settings.wepulse.logoutSuccess'));
      void navigate('/login', { replace: true });
    } catch (error) {
      console.error('Failed to logout WePulse:', error);
      message.error(t('settings.wepulse.logoutFailed'));
    } finally {
      setLoggingOut(false);
    }
  }, [auth, message, navigate, t]);

  const handleUpdateHermes = useCallback(async () => {
    setUpdatingHermes(true);
    setHermesUpdateOutput('');
    setHermesStatus((current) => ({
      installed: current?.installed ?? false,
      updateAvailable: current?.updateAvailable ?? null,
      ...current,
      installStatus: 'installing',
    }));
    try {
      const result = await ipcBridge.hermesAgent.update.invoke();
      if (!result.success || !result.data) {
        message.error(result.msg || t('settings.wepulse.hermesAgent.updateFailed'));
        return;
      }
      setHermesStatus(result.data);
      setHermesUpdateOutput(result.data.updateOutput);
      message.success(t('settings.wepulse.hermesAgent.updateSuccess'));
    } catch (error) {
      console.error('Failed to update Hermes Agent:', error);
      message.error(t('settings.wepulse.hermesAgent.updateFailed'));
    } finally {
      setUpdatingHermes(false);
    }
  }, [message, t]);

  const saveHermesConfig = useCallback(
    async (nextConfig: Pick<HermesAgentRuntimeConfig, 'forceIpv4' | 'proxy'>) => {
      setSavingHermesConfig(true);
      try {
        const result = await ipcBridge.hermesAgent.updateConfig.invoke(nextConfig);
        if (!result.success || !result.data) {
          message.error(result.msg || t('settings.wepulse.hermesAgent.configSaveFailed'));
          return;
        }
        setHermesConfig(result.data);
        message.success(t('settings.wepulse.hermesAgent.configSaved'));
      } catch (error) {
        console.error('Failed to save Hermes config:', error);
        message.error(t('settings.wepulse.hermesAgent.configSaveFailed'));
      } finally {
        setSavingHermesConfig(false);
      }
    },
    [message, t]
  );

  const handleForceIpv4Change = useCallback(
    (checked: boolean) => {
      const nextConfig = {
        forceIpv4: checked,
        proxy: hermesConfig?.proxy || '',
      };
      setHermesConfig((current) => ({
        forceIpv4: checked,
        proxy: current?.proxy || '',
        configPath: current?.configPath || '',
        exists: current?.exists ?? false,
      }));
      void saveHermesConfig(nextConfig);
    },
    [hermesConfig?.proxy, saveHermesConfig]
  );

  const handleProxyChange = useCallback((value: string) => {
    setHermesConfig((current) => ({
      forceIpv4: current?.forceIpv4 ?? false,
      proxy: value,
      configPath: current?.configPath || '',
      exists: current?.exists ?? false,
    }));
  }, []);

  const handleSaveProxy = useCallback(() => {
    void saveHermesConfig({
      forceIpv4: hermesConfig?.forceIpv4 ?? false,
      proxy: hermesConfig?.proxy || '',
    });
  }, [hermesConfig?.forceIpv4, hermesConfig?.proxy, saveHermesConfig]);

  const handleHermesDoctor = useCallback(async () => {
    setDoctorRunning(true);
    setHermesDiagnosticTitle(t('settings.wepulse.hermesAgent.doctorOutput'));
    setHermesDiagnosticOutput('');
    try {
      const result = await ipcBridge.hermesAgent.doctor.invoke();
      if (!result.success || !result.data) {
        message.error(result.msg || t('settings.wepulse.hermesAgent.doctorFailed'));
        return;
      }
      setHermesDiagnosticOutput(result.data.success ? result.data.output : result.data.error || '');
      if (!result.data.success) {
        message.error(result.data.error || t('settings.wepulse.hermesAgent.doctorFailed'));
      }
    } catch (error) {
      console.error('Failed to run Hermes doctor:', error);
      message.error(t('settings.wepulse.hermesAgent.doctorFailed'));
    } finally {
      setDoctorRunning(false);
    }
  }, [message, t]);

  const handleHermesDump = useCallback(async () => {
    setDumpRunning(true);
    setHermesDiagnosticTitle(t('settings.wepulse.hermesAgent.dumpOutput'));
    setHermesDiagnosticOutput('');
    try {
      const result = await ipcBridge.hermesAgent.dump.invoke();
      if (!result.success || !result.data) {
        message.error(result.msg || t('settings.wepulse.hermesAgent.dumpFailed'));
        return;
      }
      setHermesDiagnosticOutput(result.data.success ? result.data.output : result.data.error || '');
      if (!result.data.success) {
        message.error(result.data.error || t('settings.wepulse.hermesAgent.dumpFailed'));
      }
    } catch (error) {
      console.error('Failed to run Hermes dump:', error);
      message.error(t('settings.wepulse.hermesAgent.dumpFailed'));
    } finally {
      setDumpRunning(false);
    }
  }, [message, t]);

  const handleHermesBackup = useCallback(async () => {
    setBackupRunning(true);
    setHermesDataResult('');
    try {
      const result = await ipcBridge.hermesAgent.backup.invoke();
      if (!result.success || !result.data) {
        message.error(result.msg || t('settings.wepulse.hermesAgent.backupFailed'));
        return;
      }
      if (!result.data.success) {
        const error = result.data.error || t('settings.wepulse.hermesAgent.backupFailed');
        setHermesDataResult(error);
        message.error(error);
        return;
      }
      const output = result.data.filePath
        ? t('settings.wepulse.hermesAgent.backupSuccess', { path: result.data.filePath })
        : result.data.output;
      setHermesDataResult(output);
      message.success(t('settings.wepulse.hermesAgent.backupComplete'));
    } catch (error) {
      console.error('Failed to backup Hermes data:', error);
      message.error(t('settings.wepulse.hermesAgent.backupFailed'));
    } finally {
      setBackupRunning(false);
    }
  }, [message, t]);

  const handleHermesImport = useCallback(async () => {
    try {
      const files = await ipcBridge.dialog.showOpen.invoke({
        properties: ['openFile'],
        filters: [{ name: t('settings.wepulse.hermesAgent.backupFileFilter'), extensions: ['tar.gz', 'tgz', 'zip'] }],
      });
      const archivePath = files?.[0];
      if (!archivePath) return;

      setImportRunning(true);
      setHermesDataResult('');
      const result = await ipcBridge.hermesAgent.importBackup.invoke({ archivePath });
      if (!result.success || !result.data) {
        message.error(result.msg || t('settings.wepulse.hermesAgent.importFailed'));
        return;
      }
      if (!result.data.success) {
        const error = result.data.error || t('settings.wepulse.hermesAgent.importFailed');
        setHermesDataResult(error);
        message.error(error);
        return;
      }
      setHermesDataResult(result.data.output || t('settings.wepulse.hermesAgent.importSuccess'));
      message.success(t('settings.wepulse.hermesAgent.importSuccess'));
    } catch (error) {
      console.error('Failed to import Hermes data:', error);
      message.error(t('settings.wepulse.hermesAgent.importFailed'));
    } finally {
      setImportRunning(false);
    }
  }, [message, t]);

  const hermesTag = useMemo(() => {
    if (!hermesStatus) {
      return { color: 'gray' as const, text: t('settings.wepulse.hermesAgent.notChecked') };
    }
    if (hermesStatus.installStatus === 'installing') {
      return { color: 'blue' as const, text: t('settings.wepulse.hermesAgent.installing') };
    }
    if (hermesStatus.installStatus === 'failed') {
      return { color: 'red' as const, text: t('settings.wepulse.hermesAgent.installFailed') };
    }
    if (!hermesStatus.installed) {
      return { color: 'red' as const, text: t('settings.wepulse.hermesAgent.notInstalled') };
    }
    if (hermesStatus.updateAvailable === true) {
      return { color: 'orange' as const, text: t('settings.wepulse.hermesAgent.updateAvailable') };
    }
    if (hermesStatus.updateAvailable === false) {
      return { color: 'green' as const, text: t('settings.wepulse.hermesAgent.upToDate') };
    }
    return { color: 'blue' as const, text: t('settings.wepulse.hermesAgent.installed') };
  }, [hermesStatus, t]);

  const hermesInstallProgressText = useMemo(() => {
    if (!hermesStatus || hermesStatus.installStatus !== 'installing') return '';
    const stage = getHermesInstallStageText(hermesStatus.installStage, t);
    const step = hermesStatus.installStep || 1;
    const total = hermesStatus.installTotalSteps || 7;
    return t('settings.wepulse.hermesAgent.installProgress', { step, total, stage });
  }, [hermesStatus, t]);

  const hermesVersionDetails = useMemo(() => {
    return parseHermesVersionOutput(hermesStatus?.versionOutput);
  }, [hermesStatus?.versionOutput]);

  const hermesOutput = hermesUpdateOutput || hermesStatus?.checkOutput || hermesStatus?.checkError || '';

  return (
    <SettingsPageWrapper>
      {messageContext}
      <div className='flex flex-col gap-16px'>
        <div className='flex flex-col gap-6px'>
          <Typography.Title heading={5} className='!mb-0'>
            {t('settings.wepulse.title')}
          </Typography.Title>
          <Typography.Text type='secondary' className='text-13px'>
            {t('settings.wepulse.description')}
          </Typography.Text>
        </div>

        <Card bordered={false} className='rd-12px bg-aou-1'>
          <div className='flex flex-col gap-12px'>
            <div className='flex items-center gap-8px flex-wrap'>
              <Typography.Text className='text-14px font-medium'>{t('common.status')}</Typography.Text>
              <Tag color={status?.authenticated ? 'green' : 'red'} size='small'>
                {status?.authenticated ? t('settings.wepulse.signedIn') : t('settings.wepulse.notSignedIn')}
              </Tag>
            </div>
            <Typography.Text type='secondary' className='text-12px break-all'>
              {t('settings.wepulse.account')}: {accountLabel}
            </Typography.Text>
            <Typography.Text type='secondary' className='text-12px'>
              {t('settings.wepulse.modelCount')}: {status?.modelCount ?? 0}
            </Typography.Text>
            <Typography.Text type='secondary' className='text-12px'>
              {t('settings.wepulse.tokenExpiresAt')}: {formatTime(status?.expiresAt)}
            </Typography.Text>
            <Typography.Text type='secondary' className='text-12px'>
              {t('settings.wepulse.lastModelSyncAt')}: {formatTime(status?.lastModelSyncAt)}
            </Typography.Text>
          </div>
        </Card>

        {status?.lastModelSyncError && (
          <Alert
            type='warning'
            content={t('settings.wepulse.lastModelSyncError', { error: status.lastModelSyncError })}
          />
        )}

        <Card bordered={false} className='rd-12px'>
          <Form form={form} layout='vertical'>
            <Form.Item
              label={t('settings.wepulse.sub2apiBaseUrl')}
              field='sub2apiBaseUrl'
              required
              rules={[{ required: true, message: t('settings.wepulse.sub2apiBaseUrlRequired') }]}
              extra={t('settings.wepulse.sub2apiBaseUrlHint')}
            >
              <Input placeholder='https://agent-dev.wepulse.cn' />
            </Form.Item>
          </Form>

          <Space wrap>
            <Button type='primary' loading={loading} onClick={handleSave}>
              {t('common.save')}
            </Button>
            <Button loading={syncing} disabled={!status?.authenticated} onClick={handleSyncModels}>
              {t('settings.wepulse.syncModels')}
            </Button>
            <Button status='danger' loading={loggingOut} disabled={!status?.authenticated} onClick={handleLogout}>
              {t('settings.wepulse.logout')}
            </Button>
          </Space>
        </Card>

        <Card bordered={false} className='rd-12px'>
          <div className='flex flex-col gap-12px'>
            <div className='flex flex-col gap-6px'>
              <Typography.Title heading={6} className='!mb-0'>
                {t('settings.wepulse.hermesAgent.title')}
              </Typography.Title>
              <Typography.Text type='secondary' className='text-12px'>
                {t('settings.wepulse.hermesAgent.description')}
              </Typography.Text>
            </div>

            <div className='flex items-center gap-8px flex-wrap'>
              <Typography.Text className='text-14px font-medium'>{t('common.status')}</Typography.Text>
              <Tag color={hermesTag.color} size='small'>
                {hermesTag.text}
              </Tag>
            </div>

            {hermesStatus?.version && (
              <Typography.Text type='secondary' className='text-12px'>
                {t('settings.wepulse.hermesAgent.version')}: {hermesStatus.version}
              </Typography.Text>
            )}
            {hermesVersionDetails.releaseDate && (
              <Typography.Text type='secondary' className='text-12px'>
                {t('settings.wepulse.hermesAgent.releaseDate')}: {hermesVersionDetails.releaseDate}
              </Typography.Text>
            )}
            {hermesVersionDetails.python && (
              <Typography.Text type='secondary' className='text-12px'>
                {t('settings.wepulse.hermesAgent.pythonRuntime')}: {hermesVersionDetails.python}
              </Typography.Text>
            )}
            {hermesVersionDetails.openaiSdk && (
              <Typography.Text type='secondary' className='text-12px'>
                {t('settings.wepulse.hermesAgent.openaiSdk')}: {hermesVersionDetails.openaiSdk}
              </Typography.Text>
            )}
            {hermesStatus?.path && (
              <Typography.Text type='secondary' className='text-12px break-all'>
                {t('settings.wepulse.hermesAgent.path')}: {hermesStatus.path}
              </Typography.Text>
            )}
            {hermesStatus?.hermesHome && (
              <Typography.Text type='secondary' className='text-12px break-all'>
                {t('settings.wepulse.hermesAgent.hermesHome')}: {hermesStatus.hermesHome}
              </Typography.Text>
            )}
            {hermesInstallProgressText && (
              <Typography.Text type='secondary' className='text-12px break-all'>
                {hermesInstallProgressText}
                {hermesStatus?.installDetail ? ` - ${hermesStatus.installDetail}` : ''}
              </Typography.Text>
            )}
            {hermesStatus?.warning && (
              <Alert
                type='warning'
                content={t('settings.wepulse.hermesAgent.installWarning', { warning: hermesStatus.warning })}
              />
            )}

            {hermesStatus?.checkError && (
              <Alert
                type={hermesStatus.installed ? 'warning' : 'error'}
                content={
                  hermesStatus.installed || hermesStatus.installStatus === 'failed'
                    ? t('settings.wepulse.hermesAgent.checkFailed', { error: hermesStatus.checkError })
                    : t('settings.wepulse.hermesAgent.installHint')
                }
              />
            )}

            <Space wrap>
              <Button loading={checkingHermes} disabled={updatingHermes} onClick={() => void loadHermesStatus(true)}>
                {t('settings.wepulse.hermesAgent.checkUpdate')}
              </Button>
              <Button
                type='primary'
                loading={updatingHermes}
                disabled={checkingHermes || hermesStatus?.installStatus === 'installing'}
                onClick={() => void handleUpdateHermes()}
              >
                {hermesStatus?.installed
                  ? t('settings.wepulse.hermesAgent.updateNow')
                  : t('settings.wepulse.hermesAgent.installNow')}
              </Button>
            </Space>

            {hermesOutput && (
              <div className='rounded-10px bg-fill-2 p-12px'>
                <Typography.Text className='mb-6px block text-12px font-medium text-t-secondary'>
                  {hermesUpdateOutput
                    ? t('settings.wepulse.hermesAgent.updateOutput')
                    : hermesStatus?.installStatus === 'installing'
                      ? t('settings.wepulse.hermesAgent.installOutput')
                      : t('settings.wepulse.hermesAgent.checkOutput')}
                </Typography.Text>
                <Typography.Paragraph className='!mb-0 whitespace-pre-wrap break-words text-12px'>
                  {hermesOutput}
                </Typography.Paragraph>
              </div>
            )}

            <div className='rounded-10px bg-fill-1 p-12px'>
              <Typography.Text className='mb-8px block text-13px font-medium'>
                {t('settings.wepulse.hermesAgent.networkTitle')}
              </Typography.Text>
              <div className='flex flex-col gap-10px'>
                <div className='flex items-center justify-between gap-12px'>
                  <div className='flex flex-col gap-2px'>
                    <Typography.Text className='text-12px'>
                      {t('settings.wepulse.hermesAgent.forceIpv4')}
                    </Typography.Text>
                    <Typography.Text type='secondary' className='text-11px'>
                      {t('settings.wepulse.hermesAgent.forceIpv4Hint')}
                    </Typography.Text>
                  </div>
                  <Switch
                    checked={hermesConfig?.forceIpv4 ?? false}
                    loading={savingHermesConfig}
                    onChange={handleForceIpv4Change}
                  />
                </div>
                <div className='flex flex-col gap-6px'>
                  <Typography.Text className='text-12px'>{t('settings.wepulse.hermesAgent.proxy')}</Typography.Text>
                  <Input
                    value={hermesConfig?.proxy || ''}
                    placeholder={t('settings.wepulse.hermesAgent.proxyPlaceholder')}
                    disabled={savingHermesConfig}
                    onChange={handleProxyChange}
                    onBlur={handleSaveProxy}
                  />
                  <Typography.Text type='secondary' className='text-11px break-all'>
                    {t('settings.wepulse.hermesAgent.proxyHint')}
                    {hermesConfig?.configPath
                      ? ` ${t('settings.wepulse.hermesAgent.configPath')}: ${hermesConfig.configPath}`
                      : ''}
                  </Typography.Text>
                </div>
              </div>
            </div>

            <div className='rounded-10px bg-fill-1 p-12px'>
              <Typography.Text className='mb-8px block text-13px font-medium'>
                {t('settings.wepulse.hermesAgent.diagnosticsTitle')}
              </Typography.Text>
              <Space wrap>
                <Button loading={doctorRunning} disabled={!hermesStatus?.installed} onClick={handleHermesDoctor}>
                  {doctorRunning
                    ? t('settings.wepulse.hermesAgent.runningDoctor')
                    : t('settings.wepulse.hermesAgent.runDoctor')}
                </Button>
                <Button loading={dumpRunning} disabled={!hermesStatus?.installed} onClick={handleHermesDump}>
                  {dumpRunning
                    ? t('settings.wepulse.hermesAgent.runningDump')
                    : t('settings.wepulse.hermesAgent.debugDump')}
                </Button>
              </Space>
              {hermesDiagnosticOutput && (
                <div className='mt-10px rounded-10px bg-fill-2 p-12px'>
                  <Typography.Text className='mb-6px block text-12px font-medium text-t-secondary'>
                    {hermesDiagnosticTitle}
                  </Typography.Text>
                  <Typography.Paragraph className='!mb-0 whitespace-pre-wrap break-words text-12px'>
                    {hermesDiagnosticOutput}
                  </Typography.Paragraph>
                </div>
              )}
            </div>

            <div className='rounded-10px bg-fill-1 p-12px'>
              <Typography.Text className='mb-4px block text-13px font-medium'>
                {t('settings.wepulse.hermesAgent.dataTitle')}
              </Typography.Text>
              <Typography.Text type='secondary' className='mb-10px block text-11px'>
                {t('settings.wepulse.hermesAgent.dataHint')}
              </Typography.Text>
              <Space wrap>
                <Button loading={backupRunning} disabled={!hermesStatus?.installed} onClick={handleHermesBackup}>
                  {backupRunning
                    ? t('settings.wepulse.hermesAgent.backingUp')
                    : t('settings.wepulse.hermesAgent.exportBackup')}
                </Button>
                <Button loading={importRunning} disabled={!hermesStatus?.installed} onClick={handleHermesImport}>
                  {importRunning
                    ? t('settings.wepulse.hermesAgent.importing')
                    : t('settings.wepulse.hermesAgent.importBackup')}
                </Button>
              </Space>
              {hermesDataResult && <Alert className='mt-10px' type='info' content={hermesDataResult} />}
            </div>
          </div>
        </Card>
      </div>
    </SettingsPageWrapper>
  );
};

export default WePulseSettings;
