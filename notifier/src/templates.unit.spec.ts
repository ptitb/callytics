import { buildMissedCallMail, buildVoicemailMail } from './templates';

const call = {
  callerNumber: '31612345678',
  occurredAt: new Date('2026-11-03T09:01:05Z'),
  timezone: 'Europe/Amsterdam',
  nodeId: 'no_answer_monday',
  flowId: '7',
};

const voicemail = {
  ...call,
  durationSeconds: 18,
  attachmentName: 'voicemail-2026-11-03-1001-0612345678.mp3',
  converted: true,
};

describe('missed call mail', () => {
  it('is written in Dutch', () => {
    const mail = buildMissedCallMail('nl', call);
    expect(mail.subject).toBe('Gemiste oproep van 0612345678');
    expect(mail.text).toContain('Nummer: 0612345678 (oorspronkelijk: 31612345678)');
    expect(mail.text).toContain('Tijd: 03-11-2026 10:01:05');
    expect(mail.text).toContain('Node: no_answer_monday');
    expect(mail.html).toContain('<td>03-11-2026 10:01:05</td>');
  });

  it('is written in English', () => {
    const mail = buildMissedCallMail('en', call);
    expect(mail.subject).toBe('Missed call from 0612345678');
    expect(mail.text).toContain('Number: 0612345678 (original: 31612345678)');
    expect(mail.text).toContain('Time: 03-11-2026 10:01:05');
  });

  it('does not repeat the number when it is already national', () => {
    const mail = buildMissedCallMail('nl', { ...call, callerNumber: '0612345678' });
    expect(mail.text).toContain('Nummer: 0612345678\n');
  });

  it('handles an unknown caller', () => {
    expect(buildMissedCallMail('nl', { ...call, callerNumber: '' }).subject).toBe('Gemiste oproep van onbekend nummer');
    expect(buildMissedCallMail('en', { ...call, callerNumber: '' }).subject).toBe('Missed call from unknown number');
  });

  it('escapes HTML in values', () => {
    const mail = buildMissedCallMail('nl', { ...call, nodeId: '<script>x</script>' });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });
});

describe('voicemail mail', () => {
  it('is written in Dutch', () => {
    const mail = buildVoicemailMail('nl', voicemail);
    expect(mail.subject).toBe('Nieuwe voicemail van 0612345678 (18 s)');
    expect(mail.text).toContain('Duur: 18 s');
    expect(mail.text).toContain('Bijlage: voicemail-2026-11-03-1001-0612345678.mp3');
    expect(mail.text).not.toContain('mislukt');
  });

  it('is written in English', () => {
    const mail = buildVoicemailMail('en', voicemail);
    expect(mail.subject).toBe('New voicemail from 0612345678 (18 s)');
    expect(mail.text).toContain('Duration: 18 s');
    expect(mail.text).toContain('Attachment: ');
  });

  it('says so when the WAV fallback is attached', () => {
    const nl = buildVoicemailMail('nl', { ...voicemail, converted: false, attachmentName: 'x.wav' });
    expect(nl.text).toContain('De omzetting naar MP3 is mislukt');
    expect(nl.html).toContain('De omzetting naar MP3 is mislukt');
    expect(buildVoicemailMail('en', { ...voicemail, converted: false }).text).toContain('Conversion to MP3 failed');
  });

  it('contains no em-dashes', () => {
    for (const language of ['nl', 'en'] as const) {
      const all = [
        buildMissedCallMail(language, call),
        buildVoicemailMail(language, voicemail),
        buildVoicemailMail(language, { ...voicemail, converted: false }),
      ];
      for (const mail of all) {
        expect(`${mail.subject}${mail.text}${mail.html}`).not.toMatch(/\u2014|\u2013/);
      }
    }
  });
});
