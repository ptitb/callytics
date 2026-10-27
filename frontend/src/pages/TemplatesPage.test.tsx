import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import axios from 'axios';
import { TemplatesPage } from './TemplatesPage';
import * as api from '../lib/api';
import { renderWithRouter } from '../test/renderWithRouter';

vi.mock('../lib/api', () => ({
  listTemplates: vi.fn(),
  getFlow: vi.fn(),
  importFlowDocument: vi.fn(),
}));

const MINIMAL_FLOW = {
  name: 'My Flow',
  nodes: [
    { nodeKey: 'start', type: 'start', label: 'Start', config: {}, positionX: 100, positionY: 100 },
    { nodeKey: 'play_audio-1', type: 'play_audio', label: 'Welcome', config: { audio_file_id: '1' }, positionX: 100, positionY: 250 },
  ],
  edges: [{ sourceNodeKey: 'start', targetNodeKey: 'play_audio-1', branchKey: 'default' }],
};

function renderPage() {
  return renderWithRouter(
    <Routes>
      <Route path="/" element={<TemplatesPage />} />
      <Route path="/flows/:id" element={<div>editor for flow</div>} />
    </Routes>,
  );
}

async function openImportPanel() {
  fireEvent.click(await screen.findByRole('button', { name: 'Import JSON' }));
  return screen.getByPlaceholderText(/paste exported flow json/i);
}

function apiValidationError(message: string) {
  return new axios.AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 400,
    statusText: 'Bad Request',
    headers: {},
    config: {} as never,
    data: { statusCode: 400, message },
  });
}

describe('TemplatesPage JSON import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 });
    vi.mocked(api.listTemplates).mockResolvedValue({ data: [], total: 0 } as never);
  });

  it('posts pasted JSON to the import endpoint and opens the new flow', async () => {
    vi.mocked(api.importFlowDocument).mockResolvedValue({ data: { id: 12, name: 'My Flow', warnings: [] } });
    renderPage();

    const textarea = await openImportPanel();
    fireEvent.change(textarea, { target: { value: JSON.stringify(MINIMAL_FLOW) } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(api.importFlowDocument).toHaveBeenCalledWith(MINIMAL_FLOW));
    expect(await screen.findByText('editor for flow')).toBeInTheDocument();
  });

  it('loads a chosen .json file into the textarea and imports it', async () => {
    vi.mocked(api.importFlowDocument).mockResolvedValue({ data: { id: 3, name: 'My Flow', warnings: [] } });
    renderPage();

    const textarea = await openImportPanel();
    const file = new File([JSON.stringify(MINIMAL_FLOW)], 'my-flow.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Choose JSON file'), { target: { files: [file] } });

    await waitFor(() => expect((textarea as HTMLTextAreaElement).value).toBe(JSON.stringify(MINIMAL_FLOW)));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(api.importFlowDocument).toHaveBeenCalledWith(MINIMAL_FLOW));
    expect(await screen.findByText('editor for flow')).toBeInTheDocument();
  });

  it('loads a dropped file into the textarea', async () => {
    renderPage();

    const textarea = await openImportPanel();
    const file = new File([JSON.stringify(MINIMAL_FLOW)], 'dropped.json', { type: 'application/json' });
    fireEvent.drop(textarea, { dataTransfer: { files: [file] } });

    await waitFor(() => expect((textarea as HTMLTextAreaElement).value).toBe(JSON.stringify(MINIMAL_FLOW)));
  });

  it('keeps the page open and lists the warnings when references are missing', async () => {
    vi.mocked(api.importFlowDocument).mockResolvedValue({
      data: {
        id: 12,
        name: 'My Flow',
        warnings: ['My Flow, node "play_audio-1": audio file 1 (audio_file_id) does not exist on this installation'],
      },
    });
    renderPage();

    const textarea = await openImportPanel();
    fireEvent.change(textarea, { target: { value: JSON.stringify(MINIMAL_FLOW) } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByText(/with 1 warning/)).toBeInTheDocument();
    expect(screen.getByText(/audio file 1 \(audio_file_id\) does not exist/)).toBeInTheDocument();
    expect(screen.queryByText('editor for flow')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open flow' }));
    expect(await screen.findByText('editor for flow')).toBeInTheDocument();
  });

  it('shows the backend validation message instead of a generic text', async () => {
    vi.mocked(api.importFlowDocument).mockRejectedValue(
      apiValidationError('Invalid flow document: nodes[0] (a): type must be one of the following values: start'),
    );
    renderPage();

    const textarea = await openImportPanel();
    fireEvent.change(textarea, { target: { value: JSON.stringify(MINIMAL_FLOW) } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByText(/Invalid flow document: nodes\[0\] \(a\): type must be one of/)).toBeInTheDocument();
    expect(screen.queryByText('editor for flow')).not.toBeInTheDocument();
  });

  it('reports text that is not JSON without calling the API', async () => {
    renderPage();

    const textarea = await openImportPanel();
    fireEvent.change(textarea, { target: { value: '{ not json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByText(/^Invalid JSON:/)).toBeInTheDocument();
    expect(api.importFlowDocument).not.toHaveBeenCalled();
  });
});
