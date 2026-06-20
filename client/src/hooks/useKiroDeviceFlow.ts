import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useToast } from '../components/ToastProvider';
import { apiFetch } from '../lib/api';
import type { DeviceCodeData } from '../lib/types';

interface UseKiroDeviceFlowParams {
  kiroMethod: 'builder-id' | 'idc' | 'token' | 'auto-import';
  region: string;
  startUrl: string;
  label: string;
  onSuccess: () => void;
}

export function useKiroDeviceFlow({
  kiroMethod,
  region,
  startUrl,
  label,
  onSuccess,
}: UseKiroDeviceFlowParams) {
  const qc = useQueryClient();
  const toast = useToast();
  const [deviceStep, setDeviceStep] = useState<
    'idle' | 'loading' | 'code' | 'polling' | 'success' | 'error'
  >('idle');
  const [deviceData, setDeviceData] = useState<DeviceCodeData | null>(null);
  const [deviceError, setDeviceError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef(false);

  // Cleanup polling on unmount
  useEffect(
    () => () => {
      abortRef.current = true;
      if (pollRef.current) clearInterval(pollRef.current);
    },
    []
  );

  const startDeviceCode = useCallback(async () => {
    setDeviceStep('loading');
    setDeviceError('');
    abortRef.current = false;
    try {
      const data = await apiFetch<DeviceCodeData>('/api/admin/accounts/kiro/device-code', {
        method: 'POST',
        json: {
          authMethod: kiroMethod,
          region: region || undefined,
          startUrl: startUrl || undefined,
        },
      });
      setDeviceData(data);
      setDeviceStep('code');
    } catch (e) {
      setDeviceError(e instanceof Error ? e.message : 'Failed to start device code flow');
      setDeviceStep('error');
    }
  }, [kiroMethod, region, startUrl]);

  const startPolling = useCallback(() => {
    if (!deviceData) return;
    setDeviceStep('polling');
    abortRef.current = false;
    const interval = (deviceData.interval || 5) * 1000;
    const deadline = Date.now() + (deviceData.expiresIn || 300) * 1000;

    pollRef.current = setInterval(async () => {
      if (abortRef.current || Date.now() > deadline) {
        if (pollRef.current) clearInterval(pollRef.current);
        if (!abortRef.current) {
          setDeviceError('Device code expired. Please try again.');
          setDeviceStep('error');
        }
        return;
      }
      try {
        const res = await apiFetch<{ status: string; label?: string; error?: string }>(
          '/api/admin/accounts/kiro/poll',
          {
            method: 'POST',
            json: {
              deviceCode: deviceData.deviceCode,
              clientId: deviceData.clientId,
              clientSecret: deviceData.clientSecret,
              region: deviceData.region,
              authMethod: deviceData.authMethod,
              startUrl: deviceData.startUrl,
              label: label || undefined,
            },
          }
        );
        if (res.status === 'success') {
          if (pollRef.current) clearInterval(pollRef.current);
          setDeviceStep('success');
          qc.invalidateQueries({ queryKey: ['accounts'] });
          qc.invalidateQueries({ queryKey: ['models'] });
          toast.success(`Kiro account "${res.label}" added`);
          setTimeout(() => {
            onSuccess();
          }, 1500);
        } else if (res.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          setDeviceError(res.error || 'Authorization failed');
          setDeviceStep('error');
        }
        // status === 'pending' → keep polling
      } catch {
        // Network errors → keep polling (transient)
      }
    }, interval);
  }, [deviceData, label, qc, toast, onSuccess]);

  const reset = useCallback(() => {
    setDeviceStep('idle');
    setDeviceData(null);
    setDeviceError('');
    abortRef.current = true;
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  return {
    deviceStep,
    deviceData,
    deviceError,
    startDeviceCode,
    startPolling,
    reset,
  };
}
