import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog/ConfirmDialog';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Loading } from '../components/common/Loading';
import { PageLayout } from '../components/common/PageLayout';
import { DesktopRequired } from '../components/DesktopRequired/DesktopRequired';
import { getApiError } from '../lib/apiError';
import { getFlow, importFlowDocument, listTemplates } from '../lib/api';
import { useWindowWidth } from '../hooks/useWindowWidth';
import type { TemplateItem } from '../types';
import styles from './TemplatesPage.module.css';

const TEMPLATE_PREVIEWS: Record<string, string> = {
  'Medical Clinic IVR Template':
    'Start → Business Hours → Menu → Transfer → Play Audio → Transfer → Play Audio → Hangup',
  'Restaurant IVR Template':
    'Start → Play Audio → Menu → Transfer → Play Audio → Transfer → Hangup',
  'Dispatch Hotline Template': 'Start → Menu → Transfer → Transfer → Voicemail → Hangup',
  'After Hours IVR': 'Start → Business Hours → Play Audio → Transfer | Play Audio → Voicemail',
  'Sales Callback': 'Start → Play Audio → Get Digits → Menu → Callback | Hangup',
  'Appointment Reminder':
    'Start → Play Audio → Webhook → Get Digits → Menu → Play Audio → Hangup | Play Audio → Hangup',
  'Simple Queue': 'Start → Play Audio → Queue → Hangup',
};

export function TemplatesPage() {
  const windowWidth = useWindowWidth();
  const navigate = useNavigate();
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingImportId, setPendingImportId] = useState<number | null>(null);
  const [importJsonOpen, setImportJsonOpen] = useState(false);
  const [importJsonBusy, setImportJsonBusy] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [importJsonError, setImportJsonError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ id: number; name: string; warnings: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [openGuideStep, setOpenGuideStep] = useState<number | null>(null);
  const [showExpectedFormat, setShowExpectedFormat] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setErrorText(null);
      setLoadError(null);
      setLoading(true);
      try {
        const response = await listTemplates();
        if (!active) return;
        setItems(response.data);
      } catch (error) {
        if (!active) return;
        setLoadError(getApiError(error, 'failed to load templates'));
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const handleImport = async (id: number) => {
    setBusyId(id);
    setErrorText(null);
    try {
      const response = await getFlow(String(id));
      navigate('/flows/new', {
        state: {
          prefillTemplate: {
            name: response.data.name,
            nodes: response.data.nodes,
            edges: response.data.edges,
          },
        },
      });
    } catch (error) {
      setErrorText(getApiError(error, 'failed to import template'));
    } finally {
      setBusyId(null);
    }
  };

  const closeImportJsonPanel = () => {
    if (importJsonBusy) return;
    setImportJsonOpen(false);
    setImportJsonError(null);
    setImportJsonText('');
  };

  const readJsonFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setImportJsonText(typeof reader.result === 'string' ? reader.result : '');
      setImportJsonError(null);
    };
    reader.onerror = () => setImportJsonError('Could not read the selected file');
    reader.readAsText(file);
  };

  const handleFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) readJsonFile(file);
    // Allow selecting the same file again after an edit.
    event.target.value = '';
  };

  const handleFileDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) readJsonFile(file);
  };

  const handleImportJson = async () => {
    setImportJsonError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importJsonText);
    } catch (error) {
      setImportJsonError(`Invalid JSON: ${error instanceof Error ? error.message : 'could not parse the text'}`);
      return;
    }

    setImportJsonBusy(true);
    try {
      const response = await importFlowDocument(parsed);
      const { id, name, warnings } = response.data;
      if (warnings.length === 0) {
        closeImportJsonPanel();
        navigate(`/flows/${id}`);
        return;
      }
      // Keep the page open so the warnings stay visible until the user continues.
      setImportJsonOpen(false);
      setImportJsonText('');
      setImportResult({ id, name, warnings });
    } catch (error) {
      setImportJsonError(getApiError(error, 'Failed to import flow'));
    } finally {
      setImportJsonBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      {windowWidth < 768 ? <DesktopRequired /> : null}
      <div className={styles.pageHeader}>
        <PageLayout title="IVR Templates" subtitle="configure" />

        {!loading && loadError ? <ErrorMessage message={loadError} /> : null}

        {!loading && !loadError ? (
          <button
            className={styles.importJsonHeaderButton}
            onClick={() => {
              setImportResult(null);
              setImportJsonOpen(true);
            }}
            type="button"
          >
            Import JSON
          </button>
        ) : null}
      </div>

      {loading ? (
        <Loading message="Loading templates..." />
      ) : null}

      {!loading && !loadError ? (
        <div className={styles.contentFadeIn}>
        <>
          {importJsonOpen ? (
            <section className={styles.importJsonPanel} onDragOver={(event) => event.preventDefault()} onDrop={handleFileDrop}>
              <button
                aria-label="Close import panel"
                className={styles.panelCloseButton}
                onClick={closeImportJsonPanel}
                type="button"
              >
                ×
              </button>

              <h2 className={styles.panelTitle}>Import flow from JSON</h2>

              <div className={styles.fileRow}>
                <input
                  accept=".json,application/json"
                  aria-label="Choose JSON file"
                  className={styles.fileInput}
                  onChange={handleFileSelected}
                  ref={fileInputRef}
                  type="file"
                />
                <button
                  className={styles.modalCancelButton}
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  Choose .json file
                </button>
                <span className={styles.fileHint}>or drop a file here, or paste the JSON below</span>
              </div>

              <textarea
                className={styles.jsonTextarea}
                onChange={(event) => setImportJsonText(event.target.value)}
                placeholder="Paste exported flow JSON here..."
                value={importJsonText}
              />

              {importJsonError ? <div className={styles.inlineError}>{importJsonError}</div> : null}

              <button
                className={styles.formatToggle}
                onClick={() => setShowExpectedFormat((current) => !current)}
                type="button"
              >
                <span
                  className={`${styles.formatToggleIcon} ${
                    showExpectedFormat ? styles.formatToggleIconOpen : ''
                  }`}
                >
                  ▶
                </span>
                <span>Show expected format</span>
              </button>

              {showExpectedFormat ? (
                <pre className={styles.formatCodeBlock}>{`{
  "name": "My Flow",
  "nodes": [
    { "nodeKey": "start", "type": "start", "label": "Start", "config": {}, "positionX": 100, "positionY": 100 },
    { "nodeKey": "play_audio-1", "type": "play_audio", "label": "Welcome", "config": { "audio_file_id": "1" }, "positionX": 100, "positionY": 250 }
  ],
  "edges": [
    { "sourceNodeKey": "start", "targetNodeKey": "play_audio-1", "branchKey": "default" }
  ]
}`}</pre>
              ) : null}
              {showExpectedFormat ? (
                <p className={styles.fileHint}>
                  Files downloaded with &quot;export json&quot; (format <code>callytics-flow</code>) also
                  contain submenus and are imported as a whole.
                </p>
              ) : null}

              <div className={styles.panelActions}>
                <button
                  className={styles.modalCancelButton}
                  onClick={closeImportJsonPanel}
                  type="button"
                >
                  Cancel
                </button>

                <button
                  className={styles.modalImportButton}
                  disabled={importJsonBusy}
                  onClick={() => void handleImportJson()}
                  type="button"
                >
                  {importJsonBusy ? 'Importing...' : 'Import'}
                </button>
              </div>
            </section>
          ) : null}

          {importResult ? (
            <section className={styles.importResult} role="status">
              <h2 className={styles.panelTitle}>
                Imported &quot;{importResult.name}&quot; with {importResult.warnings.length}{' '}
                {importResult.warnings.length === 1 ? 'warning' : 'warnings'}
              </h2>
              <p className={styles.importResultText}>
                The flow was created. These references do not exist on this installation. Open the
                flow and select the right audio files, trunks or queues.
              </p>
              <ul className={styles.warningList}>
                {importResult.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              <div className={styles.panelActions}>
                <button
                  className={styles.modalCancelButton}
                  onClick={() => setImportResult(null)}
                  type="button"
                >
                  Dismiss
                </button>
                <button
                  className={styles.modalImportButton}
                  onClick={() => navigate(`/flows/${importResult.id}`)}
                  type="button"
                >
                  Open flow
                </button>
              </div>
            </section>
          ) : null}

          <ErrorMessage message={errorText} />

          <div className={styles.tableCard}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>name</th>
                    <th>description</th>
                    <th className={styles.actionsHeader}>actions</th>
                  </tr>
                </thead>

                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={3} className={styles.emptyState}>
                        No templates available.
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div>{item.name}</div>
                          <div className={styles.nameSubtitle}>
                            {item.templateCategory || 'general'} · {item.nodeCount} nodes
                          </div>
                        </td>

                        <td className={styles.descriptionCell}>
                          <div>{item.templateDescription || item.description || '—'}</div>
                          <div className={styles.previewText}>
                            {TEMPLATE_PREVIEWS[item.name] || 'Start → ...'}
                          </div>
                        </td>

                        <td className={styles.actionsCell}>
                          <button
                            className={`${styles.secondaryButton} ${styles.importButton}`}
                            disabled={busyId === item.id}
                            onClick={() => setPendingImportId(item.id)}
                            type="button"
                          >
                            {busyId === item.id ? 'Importing...' : 'Import'}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

          <ConfirmDialog
            cancelLabel="Cancel"
            confirmLabel="Import"
            message="This will create a new flow from the template. You can edit it in the flow builder."
            onCancel={() => setPendingImportId(null)}
            onConfirm={() => {
              if (pendingImportId !== null) {
                void handleImport(pendingImportId);
              }
              setPendingImportId(null);
            }}
            open={pendingImportId !== null}
            title="Import Template"
          />

          <section className={styles.guideSection}>
            <button
              className={styles.guideToggle}
              onClick={() => setShowGuide((current) => !current)}
              type="button"
            >
              <span className={`${styles.guideIcon} ${showGuide ? styles.guideIconExpanded : ''}`}>
                ▶
              </span>
              <span>How to create a template</span>
            </button>

            {showGuide ? (
              <div className={styles.guideSteps}>
                <div
                  className={`${styles.accordionItem} ${
                    openGuideStep === 1 ? styles.accordionItemOpen : ''
                  }`}
                >
                  <button
                    className={styles.accordionHeader}
                    onClick={() => setOpenGuideStep((current) => (current === 1 ? null : 1))}
                    type="button"
                  >
                    <span>1</span>
                    <strong>Build your flow</strong>
                    <em>{openGuideStep === 1 ? '⌄' : '›'}</em>
                  </button>

                  {openGuideStep === 1 ? (
                    <div className={styles.accordionBody}>
                      <p>
                        Build your flow in the Flow Builder. Add nodes, configure them, wire the
                        connections, and give the flow a meaningful name. When ready, save the flow
                        using the Save button in the top bar.
                      </p>
                    </div>
                  ) : null}
                </div>

                <div
                  className={`${styles.accordionItem} ${
                    openGuideStep === 2 ? styles.accordionItemOpen : ''
                  }`}
                >
                  <button
                    className={styles.accordionHeader}
                    onClick={() => setOpenGuideStep((current) => (current === 2 ? null : 2))}
                    type="button"
                  >
                    <span>2</span>
                    <strong>Export as JSON</strong>
                    <em>{openGuideStep === 2 ? '⌄' : '›'}</em>
                  </button>

                  {openGuideStep === 2 ? (
                    <div className={styles.accordionBody}>
                      <p>
                        Open the saved flow in the Flow Builder. Use the export option in the top
                        bar to download the flow as a JSON file. The exported file contains all
                        nodes, edges, positions, and configuration.
                      </p>
                    </div>
                  ) : null}
                </div>

                <div
                  className={`${styles.accordionItem} ${
                    openGuideStep === 3 ? styles.accordionItemOpen : ''
                  }`}
                >
                  <button
                    className={styles.accordionHeader}
                    onClick={() => setOpenGuideStep((current) => (current === 3 ? null : 3))}
                    type="button"
                  >
                    <span>3</span>
                    <strong>Import and share</strong>
                    <em>{openGuideStep === 3 ? '⌄' : '›'}</em>
                  </button>

                  {openGuideStep === 3 ? (
                    <div className={styles.accordionBody}>
                      <p>
                        Choose the exported file or paste its JSON in the Import JSON panel on
                        this page. The JSON must contain a <code>nodes</code> array at the minimum.
                        Audio files, trunks and queues are referenced by id; the import warns about
                        ids that do not exist on this installation.
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>
        </>
        </div>
      ) : null}
    </div>
  );
}
