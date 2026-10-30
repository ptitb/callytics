import { useEffect, useRef, useState } from 'react';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Loading } from '../components/common/Loading';
import { PageLayout } from '../components/common/PageLayout';
import { DesktopRequired } from '../components/DesktopRequired/DesktopRequired';
import { useWindowWidth } from '../hooks/useWindowWidth';
import { getSettings, updateSettings } from '../lib/api';
import { getApiError } from '../lib/apiError';
import {
  validateOutboundCountryCode,
  validateOutboundInternationalPrefix,
  validateRtpRange,
} from '../lib/validation';
import type { OutboundWaitAudio } from '../types';
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
  const [dialWithoutHash, setDialWithoutHash] = useState(true);
  const [normalizeE164, setNormalizeE164] = useState(true);
  const [countryCode, setCountryCode] = useState('31');
  const [internationalPrefix, setInternationalPrefix] = useState('00');
  const [waitAudio, setWaitAudio] = useState<OutboundWaitAudio>('ringback');
  const [outboundSaveState, setOutboundSaveState] = useState<SaveState>('idle');
  const [outboundError, setOutboundError] = useState<string | null>(null);
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
        setDialWithoutHash(settings.outbound_dial_without_hash ?? true);
        setNormalizeE164(settings.outbound_normalize_e164 ?? true);
        setCountryCode(String(settings.outbound_country_code ?? '31'));
        setInternationalPrefix(String(settings.outbound_international_prefix ?? '00'));
        setWaitAudio(settings.outbound_wait_audio ?? 'ringback');
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

  const handleSaveOutbound = async () => {
    setOutboundError(null);
    const message = validateOutboundCountryCode(countryCode) ?? validateOutboundInternationalPrefix(internationalPrefix);
    if (message) {
      setOutboundSaveState('failed');
      setOutboundError(message);
      return;
    }

    setOutboundSaveState('saving');
    try {
      const settings = await updateSettings({
        outbound_dial_without_hash: dialWithoutHash,
        outbound_normalize_e164: normalizeE164,
        outbound_country_code: countryCode,
        outbound_international_prefix: internationalPrefix,
        outbound_wait_audio: waitAudio,
      });
      setDialWithoutHash(settings.outbound_dial_without_hash ?? dialWithoutHash);
      setNormalizeE164(settings.outbound_normalize_e164 ?? normalizeE164);
      setCountryCode(String(settings.outbound_country_code ?? countryCode));
      setInternationalPrefix(String(settings.outbound_international_prefix ?? internationalPrefix));
      setWaitAudio(settings.outbound_wait_audio ?? waitAudio);
      setOutboundSaveState('saved');
      window.setTimeout(() => setOutboundSaveState('idle'), 2000);
    } catch (error) {
      setOutboundSaveState('failed');
      setOutboundError(getApiError(error, 'failed to save outbound dialing settings'));
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
            <h2 className={styles.cardTitle}>Outbound dialing</h2>
          </div>
          <div className={styles.formField}>
            <label className={styles.checkboxRow} htmlFor="outbound-dial-without-hash">
              <input
                checked={dialWithoutHash}
                id="outbound-dial-without-hash"
                onChange={(event) => setDialWithoutHash(event.target.checked)}
                type="checkbox"
              />
              Dial external numbers without #
            </label>
            <p className={styles.note}>
              Extensions can dial external numbers directly. Extension numbers and inbound DIDs keep working, and #number always dials out.
              Saving reloads the dialplan in Asterisk without a restart.
            </p>
            <label className={styles.checkboxRow} htmlFor="outbound-normalize-e164">
              <input
                checked={normalizeE164}
                id="outbound-normalize-e164"
                onChange={(event) => setNormalizeE164(event.target.checked)}
                type="checkbox"
              />
              Convert dialed numbers to E.164
            </label>
            <label className={styles.label} htmlFor="outbound-country-code">Country code</label>
            <input
              className={styles.input}
              disabled={!normalizeE164}
              id="outbound-country-code"
              inputMode="numeric"
              maxLength={3}
              onChange={(event) => setCountryCode(event.target.value)}
              type="text"
              value={countryCode}
            />
            <label className={styles.label} htmlFor="outbound-international-prefix">International prefix</label>
            <input
              className={styles.input}
              disabled={!normalizeE164}
              id="outbound-international-prefix"
              inputMode="numeric"
              maxLength={4}
              onChange={(event) => setInternationalPrefix(event.target.value)}
              type="text"
              value={internationalPrefix}
            />
            <p className={styles.note}>
              Spaces, dashes, dots and parentheses are removed. A number starting with 0 gets the country code, a number starting with the
              international prefix gets a +. With the defaults: 0612345678 becomes +31612345678, 0044... becomes +44..., +44... stays
              unchanged and short numbers like 112 stay unchanged. With conversion off, the number is sent as dialed.
            </p>
            <label className={styles.label} htmlFor="outbound-wait-audio">Waiting audio while dialing out</label>
            <select
              className={styles.input}
              id="outbound-wait-audio"
              onChange={(event) => setWaitAudio(event.target.value as OutboundWaitAudio)}
              value={waitAudio}
            >
              <option value="ringback">Ringback tone</option>
              <option value="moh">Hold music</option>
            </select>
            <p className={styles.note}>
              What the extension hears until the other side answers. A ringback tone is played by the phone itself, hold music is
              played by Asterisk.
            </p>
            {outboundError ? <p className={styles.note} role="alert">{outboundError}</p> : null}
          </div>
          <div className={styles.actionRow}>
            <button
              className={`${styles.primaryButton} ${outboundSaveState === 'failed' ? styles.failedButton : ''} btn-press`}
              disabled={outboundSaveState === 'saving'}
              onClick={() => void handleSaveOutbound()}
              type="button"
            >
              {outboundSaveState === 'saving' ? 'saving…' : outboundSaveState === 'saved' ? 'saved ✓' : outboundSaveState === 'failed' ? 'failed' : 'save'}
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
