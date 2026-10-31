import { downloadRecording } from './recordingDownload';

const url = new URL('http://127.0.0.1:3001/recordings/1/download');

function fetchReturning(response: Response): typeof fetch {
  return jest.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

describe('downloadRecording', () => {
  it('returns the body and does not follow redirects', async () => {
    const fetchFn = fetchReturning(new Response(Buffer.from('wav-bytes')));
    const result = await downloadRecording(url, { fetchFn });
    expect(result.toString()).toBe('wav-bytes');
    expect(fetchFn).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'manual' }));
  });

  it('fails with 502 on a non-2xx status (including a redirect)', async () => {
    await expect(
      downloadRecording(url, { fetchFn: fetchReturning(new Response('', { status: 404 })) }),
    ).rejects.toMatchObject({ status: 502 });
    await expect(
      downloadRecording(url, { fetchFn: fetchReturning(new Response(null, { status: 302, headers: { location: 'http://evil.example.com' } })) }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it('fails with 502 when the request itself fails', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    await expect(downloadRecording(url, { fetchFn })).rejects.toMatchObject({ status: 502 });
  });

  it('refuses a recording that is too large', async () => {
    await expect(
      downloadRecording(url, { fetchFn: fetchReturning(new Response(Buffer.alloc(100))), maxBytes: 50 }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it('refuses an empty recording', async () => {
    await expect(
      downloadRecording(url, { fetchFn: fetchReturning(new Response(Buffer.alloc(0))) }),
    ).rejects.toMatchObject({ status: 502 });
  });
});
