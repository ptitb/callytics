import { useEffect, useRef, useState } from 'react';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Loading } from '../components/common/Loading';
import { PageLayout } from '../components/common/PageLayout';
import { DesktopRequired } from '../components/DesktopRequired/DesktopRequired';
import { useWindowWidth } from '../hooks/useWindowWidth';
import { getSettings, updateSettings } from '../lib/api';
import { getApiError } from '../lib/apiError';
import { validateRtpRange } from '../lib/validation';
import { useToast } from '../context/ToastContext';
import styles from './SettingsPage.module.css';

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export function SettingsPage() {
  const windowWidth = useWindowWidth();
  const { showToast } = useToast();
  const saveTimerRef = useRef<number | null>(null);
  const [retentionDays, setRetentionDays] = useState('0');
  const [rtpStart, setRtpStart] = useState('10000');
  const [rtpEnd, setRtpEnd] = useState('20000');
  const [rtpSaveState, setRtpSaveState] = useState<SaveState>('idle');
  const [rtpError, setRtpError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  useEffect(() => {
    const loadSettings = async () => {
      setLoadError(null);
      try {
        const settings = await getSettings();
        setRetentionDays(String(settings.recording_retention_days ?? 0));
        setRtpStart(String(settings.rtp_port_start ?? 10000));
        setRtpEnd(String(settings.rtp_port_end ?? 20000));
      } catch (error) {
        setLoadError(getApiError(error, 'failed to load settings'));
      } finally {
        setInitialLoading(false);
      }
    };

    void loadSettings();

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const handleSave = async () => {
    const parsedValue = Number(retentionDays);
    if (!Number.isInteger(parsedValue) || parsedValue < 0) {
      setSaveState('failed');
      showToast('retention days must be a non-negative whole number', 'error');
      return;
    }

    setSaveState('saving');

    try {
      const settings = await updateSettings({ recording_retention_days: parsedValue });
      setRetentionDays(String(settings.recording_retention_days ?? parsedValue));
      setSaveState('saved');
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => setSaveState('idle'), 2000);
    } catch (error) {
      setSaveState('failed');
      showToast(getApiError(error, 'failed to save settings'), 'error');
    }
  };

  const handleSaveRtp = async () => {
    setRtpError(null);
    const start = Number(rtpStart);
    const end = Number(rtpEnd);
    const message = validateRtpRange(start, end);
    if (message) {
      setRtpSaveState('failed');
      setRtpError(message);
      return;
    }

    setRtpSaveState('saving');
    try {
      const settings = await updateSettings({ rtp_port_start: start, rtp_port_end: end });
      setRtpStart(String(settings.rtp_port_start ?? start));
      setRtpEnd(String(settings.rtp_port_end ?? end));
      setRtpSaveState('saved');
      window.setTimeout(() => setRtpSaveState('idle'), 2000);
    } catch (error) {
      setRtpSaveState('failed');
      setRtpError(getApiError(error, 'failed to save RTP range'));
    }
  };

  if (windowWidth < 768) {
    return <DesktopRequired />;
  }

  if (initialLoading) {
    return (
      <PageLayout title="Settings" subtitle="system">
        <Loading message="Loading settings..." />
      </PageLayout>
    );
  }

  if (loadError) {
    return (
      <PageLayout title="Settings" subtitle="system">
        <ErrorMessage message={loadError} />
      </PageLayout>
    );
  }

  const saveLabel = saveState === 'saving'
    ? 'saving…'
    : saveState === 'saved'
      ? 'saved ✓'
      : saveState === 'failed'
        ? 'failed'
        : 'save';

  return (
    <PageLayout title="Settings" subtitle="system">
      <div className={styles.page}>
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Recordings</h2>
          </div>
          <div className={styles.formField}>
            <label className={styles.label} htmlFor="recording-retention-days">
              Delete recordings older than (days)
            </label>
            <input
              className={styles.input}
              id="recording-retention-days"
              min="0"
              onChange={(event) => setRetentionDays(event.target.value)}
              type="number"
              value={retentionDays}
            />
            <p className={styles.note}>Set to 0 to keep recordings indefinitely.</p>
          </div>
          <div className={styles.actionRow}>
            <button
              className={`${styles.primaryButton} ${saveState === 'failed' ? styles.failedButton : ''} btn-press`}
              disabled={saveState === 'saving'}
              onClick={() => void handleSave()}
              type="button"
            >
              {saveLabel}
            </button>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Media (RTP)</h2>
          </div>
          <div className={styles.formField}>
            <label className={styles.label} htmlFor="rtp-port-start">RTP port range</label>
            <div className={styles.actionRow}>
              <input
                className={styles.input}
                id="rtp-port-start"
                onChange={(event) => setRtpStart(event.target.value)}
                type="number"
                value={rtpStart}
              />
              <input
                aria-label="RTP end port"
                className={styles.input}
                id="rtp-port-end"
                onChange={(event) => setRtpEnd(event.target.value)}
                type="number"
                value={rtpEnd}
              />
            </div>
            <p className={styles.note}>
              Start port must be even and the range needs at least 20 ports. Saving reloads rtp.conf in Asterisk without a restart.
              Active calls keep their ports, new calls use the new range. Open the range in your firewall (UDP) and make sure it does not overlap other PBX software on this host.
            </p>
            {rtpError ? <p className={styles.note} role="alert">{rtpError}</p> : null}
          </div>
          <div className={styles.actionRow}>
            <button
              className={`${styles.primaryButton} ${rtpSaveState === 'failed' ? styles.failedButton : ''} btn-press`}
              disabled={rtpSaveState === 'saving'}
              onClick={() => void handleSaveRtp()}
              type="button"
            >
              {rtpSaveState === 'saving' ? 'saving…' : rtpSaveState === 'saved' ? 'saved ✓' : rtpSaveState === 'failed' ? 'failed' : 'save'}
            </button>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Security</h2>
          </div>
          <p className={styles.bodyText}>
            TLS and security hardening options coming soon.
          </p>
        </section>
      </div>
    </PageLayout>
  );
}
