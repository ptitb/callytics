import { exportFlowDocument } from './api';

/** Turns a flow slug or name into a safe download filename such as `my-flow.json`. */
export function buildFlowExportFilename(slugOrName: string): string {
  const base = slugOrName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `${base || 'flow'}.json`;
}

/** Downloads the flow as a pretty printed JSON file using the export endpoint. */
export async function downloadFlowExport(flowId: number | string, slugOrName: string): Promise<void> {
  const document = await exportFlowDocument(flowId);
  const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = buildFlowExportFilename(slugOrName);
  window.document.body.appendChild(link);
  link.click();
  window.document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
