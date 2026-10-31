import { dedupeKey, OncePerWindow } from './dedupe';

describe('dedupeKey', () => {
  it('is stable and depends on every part', () => {
    expect(dedupeKey('a', 'b')).toBe(dedupeKey('a', 'b'));
    expect(dedupeKey('a', 'b')).not.toBe(dedupeKey('a', 'c'));
    expect(dedupeKey('missed-call', '1')).not.toBe(dedupeKey('voicemail', '1'));
  });
});

describe('OncePerWindow', () => {
  it('runs once within the window and again after it', async () => {
    let now = 0;
    const once = new OncePerWindow(1000, () => now);
    const action = jest.fn().mockResolvedValue('ok');

    expect(await once.run('k', action)).toEqual({ duplicate: false, value: 'ok' });
    expect(await once.run('k', action)).toEqual({ duplicate: true });
    expect(action).toHaveBeenCalledTimes(1);

    now = 1001;
    expect((await once.run('k', action)).duplicate).toBe(false);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('does not remember a failed attempt', async () => {
    const once = new OncePerWindow(1000);
    const action = jest.fn().mockRejectedValueOnce(new Error('smtp down')).mockResolvedValue('ok');

    await expect(once.run('k', action)).rejects.toThrow('smtp down');
    expect((await once.run('k', action)).duplicate).toBe(false);
  });

  it('lets a concurrent retry wait for the first attempt', async () => {
    const once = new OncePerWindow(1000);
    let release!: () => void;
    const action = jest.fn(() => new Promise<string>((resolve) => { release = () => resolve('ok'); }));

    const first = once.run('k', action);
    const second = once.run('k', action);
    release();

    expect(await first).toEqual({ duplicate: false, value: 'ok' });
    expect(await second).toEqual({ duplicate: true });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('fails the concurrent retry too when the first attempt fails', async () => {
    const once = new OncePerWindow(1000);
    let fail!: () => void;
    const action = () => new Promise<string>((_resolve, reject) => { fail = () => reject(new Error('boom')); });

    const first = once.run('k', action);
    const second = once.run('k', action);
    fail();

    await expect(first).rejects.toThrow('boom');
    await expect(second).rejects.toThrow('boom');
  });
});
