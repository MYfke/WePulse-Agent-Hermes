/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ipcBridge } from '@/common';
import type { WePulseStatus } from '@/common/config/wepulse';
import type { HermesAgentUpdateStatus } from '@/common/update/updateTypes';
import { Alert, Button, Card, Form, Input, Message, Space, Tag, Typography } from '@arco-design/web-react';
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
  const [checkingHermes, setCheckingHermes] = useState(false);
  const [updatingHermes, setUpdatingHermes] = useState(false);
  const [hermesUpdateOutput, setHermesUpdateOutput] = useState('');

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
    async (showSuccess = false) => {
      setCheckingHermes(true);
      try {
        const result = await ipcBridge.hermesAgent.checkUpdate.invoke();
        if (!result.success || !result.data) {
          message.error(result.msg || t('settings.wepulse.hermesAgent.checkFailed', { error: '' }));
          return;
        }
        setHermesStatus(result.data);
        if (showSuccess) {
          message.success(t('settings.wepulse.hermesAgent.checkSuccess'));
        }
      } catch (error) {
        console.error('Failed to check Hermes Agent update:', error);
        message.error(t('settings.wepulse.hermesAgent.checkFailed', { error: String(error) }));
      } finally {
        setCheckingHermes(false);
      }
    },
    [message, t]
  );

  useEffect(() => {
    void loadStatus();
    void loadHermesStatus();
  }, [loadHermesStatus, loadStatus]);

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

  const hermesTag = useMemo(() => {
    if (!hermesStatus) {
      return { color: 'gray' as const, text: t('settings.wepulse.hermesAgent.notChecked') };
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
            {hermesStatus?.path && (
              <Typography.Text type='secondary' className='text-12px break-all'>
                {t('settings.wepulse.hermesAgent.path')}: {hermesStatus.path}
              </Typography.Text>
            )}

            {hermesStatus?.checkError && (
              <Alert
                type={hermesStatus.installed ? 'warning' : 'error'}
                content={
                  hermesStatus.installed
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
                disabled={!hermesStatus?.installed || checkingHermes}
                onClick={() => void handleUpdateHermes()}
              >
                {t('settings.wepulse.hermesAgent.updateNow')}
              </Button>
            </Space>

            {hermesOutput && (
              <div className='rounded-10px bg-fill-2 p-12px'>
                <Typography.Text className='mb-6px block text-12px font-medium text-t-secondary'>
                  {hermesUpdateOutput
                    ? t('settings.wepulse.hermesAgent.updateOutput')
                    : t('settings.wepulse.hermesAgent.checkOutput')}
                </Typography.Text>
                <Typography.Paragraph className='!mb-0 whitespace-pre-wrap break-words text-12px'>
                  {hermesOutput}
                </Typography.Paragraph>
              </div>
            )}
          </div>
        </Card>
      </div>
    </SettingsPageWrapper>
  );
};

export default WePulseSettings;
