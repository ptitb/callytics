import { Language } from './config';
import { toReadableNumber } from './phone';
import { formatDateTime, formatDuration } from './time';

export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

interface CallDetails {
  callerNumber: string;
  occurredAt: Date;
  timezone: string;
  nodeId: string;
  flowId: string;
}

export interface VoicemailDetails extends CallDetails {
  durationSeconds: number;
  attachmentName: string;
  /** False when the MP3 conversion failed and the original WAV is attached instead. */
  converted: boolean;
}

interface Labels {
  unknownNumber: string;
  missedSubject: (number: string) => string;
  missedIntro: string;
  voicemailSubject: (number: string, duration: string) => string;
  voicemailIntro: string;
  number: string;
  original: string;
  time: string;
  duration: string;
  attachment: string;
  node: string;
  flow: string;
  fallbackNote: string;
}

const LABELS: Record<Language, Labels> = {
  nl: {
    unknownNumber: 'onbekend nummer',
    missedSubject: (number) => `Gemiste oproep van ${number}`,
    missedIntro: 'Er is een oproep gemist.',
    voicemailSubject: (number, duration) => `Nieuwe voicemail van ${number} (${duration})`,
    voicemailIntro: 'Er is een nieuwe voicemail achtergelaten.',
    number: 'Nummer',
    original: 'oorspronkelijk',
    time: 'Tijd',
    duration: 'Duur',
    attachment: 'Bijlage',
    node: 'Node',
    flow: 'Flow',
    fallbackNote:
      'De omzetting naar MP3 is mislukt. De opname is als WAV-bestand bijgevoegd.',
  },
  en: {
    unknownNumber: 'unknown number',
    missedSubject: (number) => `Missed call from ${number}`,
    missedIntro: 'A call was missed.',
    voicemailSubject: (number, duration) => `New voicemail from ${number} (${duration})`,
    voicemailIntro: 'A new voicemail was left.',
    number: 'Number',
    original: 'original',
    time: 'Time',
    duration: 'Duration',
    attachment: 'Attachment',
    node: 'Node',
    flow: 'Flow',
    fallbackNote:
      'Conversion to MP3 failed. The recording is attached as a WAV file.',
  },
};

function describeNumber(labels: Labels, rawNumber: string): { short: string; long: string } {
  if (!rawNumber) return { short: labels.unknownNumber, long: labels.unknownNumber };
  const readable = toReadableNumber(rawNumber);
  const long = readable === rawNumber ? readable : `${readable} (${labels.original}: ${rawNumber})`;
  return { short: readable, long };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render(intro: string, rows: Array<[string, string]>, note?: string): { text: string; html: string } {
  const text = [intro, '', ...rows.map(([label, value]) => `${label}: ${value}`), ...(note ? ['', note] : [])].join('\n');
  const htmlRows = rows
    .map(([label, value]) => `<tr><td><strong>${escapeHtml(label)}</strong></td><td>${escapeHtml(value)}</td></tr>`)
    .join('');
  const htmlNote = note ? `<p>${escapeHtml(note)}</p>` : '';
  const html = `<p>${escapeHtml(intro)}</p><table cellpadding="4">${htmlRows}</table>${htmlNote}`;
  return { text, html };
}

function commonRows(labels: Labels, details: CallDetails): Array<[string, string]> {
  const number = describeNumber(labels, details.callerNumber);
  const rows: Array<[string, string]> = [
    [labels.number, number.long],
    [labels.time, formatDateTime(details.occurredAt, details.timezone)],
  ];
  return rows;
}

function routingRows(labels: Labels, details: CallDetails): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (details.nodeId) rows.push([labels.node, details.nodeId]);
  if (details.flowId) rows.push([labels.flow, details.flowId]);
  return rows;
}

export function buildMissedCallMail(language: Language, details: CallDetails): MailContent {
  const labels = LABELS[language];
  const number = describeNumber(labels, details.callerNumber);
  const rows = [...commonRows(labels, details), ...routingRows(labels, details)];
  return {
    subject: labels.missedSubject(number.short),
    ...render(labels.missedIntro, rows),
  };
}

export function buildVoicemailMail(language: Language, details: VoicemailDetails): MailContent {
  const labels = LABELS[language];
  const number = describeNumber(labels, details.callerNumber);
  const rows: Array<[string, string]> = [
    ...commonRows(labels, details),
    [labels.duration, formatDuration(details.durationSeconds)],
    [labels.attachment, details.attachmentName],
    ...routingRows(labels, details),
  ];
  return {
    subject: labels.voicemailSubject(number.short, formatDuration(details.durationSeconds)),
    ...render(labels.voicemailIntro, rows, details.converted ? undefined : labels.fallbackNote),
  };
}
