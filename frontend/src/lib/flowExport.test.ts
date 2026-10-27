import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFlowExportFilename, downloadFlowExport } from './flowExport';
import * as api from './api';

vi.mock('./api', () => ({
  exportFlowDocument: vi.fn(),
}));

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('buildFlowExportFilename', () => {
  it.each([
    ['my-flow', 'my-flow.json'],
    ['Main Flow (v2)', 'main-flow-v2.json'],
    ['  Café IVR  ', 'caf-ivr.json'],
    ['!!!', 'flow.json'],
    ['', 'flow.json'],
  ])('turns %j into %j', (input, expected) => {
    expect(buildFlowExportFilename(input)).toBe(expected);
  });
});

describe('downloadFlowExport', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:flow');
    revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  it('downloads the export document as pretty printed JSON named after the slug', async () => {
    const document = { format: 'callytics-flow', version: 1, exportedAt: '2026-01-01T00:00:00.000Z', name: 'Main', nodes: [], edges: [] };
    vi.mocked(api.exportFlowDocument).mockResolvedValue(document as never);
    let downloadName = '';
    clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download;
    });

    await downloadFlowExport(5, 'main-flow');

    expect(api.exportFlowDocument).toHaveBeenCalledWith(5);
    expect(downloadName).toBe('main-flow.json');
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/json');
    expect(await readBlob(blob)).toBe(JSON.stringify(document, null, 2));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:flow');
  });

  it('does not download anything when the export request fails', async () => {
    vi.mocked(api.exportFlowDocument).mockRejectedValue(new Error('boom'));

    await expect(downloadFlowExport(5, 'x')).rejects.toThrow('boom');

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
