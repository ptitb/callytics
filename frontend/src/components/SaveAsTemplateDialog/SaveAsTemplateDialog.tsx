import { useEffect, useId, useState, type FormEvent } from 'react';
import { createTemplate } from '../../lib/api';
import { getApiError } from '../../lib/apiError';
import styles from './SaveAsTemplateDialog.module.css';

// Keep in sync with backend/src/templates/dto/create-template.dto.ts.
const NAME_MAX_LENGTH = 120;
const CATEGORY_MAX_LENGTH = 60;
const DESCRIPTION_MAX_LENGTH = 500;

interface SaveAsTemplateDialogProps {
  open: boolean;
  flowId: number;
  flowName: string;
  onClose: () => void;
  /** Called with the name of the created template after it was saved. */
  onSaved: (templateName: string) => void;
}

export function SaveAsTemplateDialog({ open, flowId, flowName, onClose, onSaved }: SaveAsTemplateDialogProps) {
  const idPrefix = useId();
  const [name, setName] = useState(flowName);
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start with a fresh form every time the dialog opens.
  useEffect(() => {
    if (open) {
      setName(flowName);
      setCategory('');
      setDescription('');
      setError(null);
    }
  }, [open, flowId, flowName]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose, open]);

  if (!open) return null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await createTemplate({
        flowId,
        name: name.trim() || undefined,
        category: category.trim() || undefined,
        description: description.trim() || undefined,
      });
      onSaved(response.data.name);
    } catch (saveError) {
      setError(getApiError(saveError, 'Failed to save template'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.overlay} role="presentation">
      <form
        aria-labelledby={`${idPrefix}-title`}
        aria-modal="true"
        className={styles.dialog}
        onSubmit={(event) => void handleSubmit(event)}
        role="dialog"
      >
        <div className={styles.content}>
          <h2 className={styles.title} id={`${idPrefix}-title`}>Save as template</h2>
          <p className={styles.message}>
            Saves a snapshot of the current version, including submenus, on the Templates page. The flow itself is not changed.
          </p>
        </div>

        <label className={styles.field} htmlFor={`${idPrefix}-name`}>
          <span className={styles.label}>Name</span>
          <input
            className={styles.input}
            id={`${idPrefix}-name`}
            maxLength={NAME_MAX_LENGTH}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>

        <label className={styles.field} htmlFor={`${idPrefix}-category`}>
          <span className={styles.label}>Category (optional)</span>
          <input
            className={styles.input}
            id={`${idPrefix}-category`}
            maxLength={CATEGORY_MAX_LENGTH}
            onChange={(event) => setCategory(event.target.value)}
            placeholder="e.g. clinic"
            value={category}
          />
        </label>

        <label className={styles.field} htmlFor={`${idPrefix}-description`}>
          <span className={styles.label}>Description (optional)</span>
          <textarea
            className={styles.textarea}
            id={`${idPrefix}-description`}
            maxLength={DESCRIPTION_MAX_LENGTH}
            onChange={(event) => setDescription(event.target.value)}
            value={description}
          />
        </label>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}

        <div className={styles.actions}>
          <button className={styles.cancelButton} disabled={busy} onClick={onClose} type="button">
            Cancel
          </button>
          <button className={styles.confirmButton} disabled={busy} type="submit">
            {busy ? 'Saving...' : 'Save template'}
          </button>
        </div>
      </form>
    </div>
  );
}
