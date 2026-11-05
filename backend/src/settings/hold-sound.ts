/** What the other party hears while a phone has them on hold: Asterisk music on hold, an uploaded file or nothing. */
export const HOLD_SOUND_VALUES = ['moh', 'audio', 'none'] as const;
export type HoldSound = (typeof HOLD_SOUND_VALUES)[number];

/** What the caller hears while a transferred call rings: a ringback tone, the hold sound or nothing. */
export const TRANSFER_RINGING_SOUND_VALUES = ['ringback', 'hold', 'none'] as const;
export type TransferRingingSound = (typeof TRANSFER_RINGING_SOUND_VALUES)[number];

export const HOLD_DEFAULTS = {
  hold_sound: 'moh' as HoldSound,
  /** Audio file used when hold_sound is audio. */
  hold_audio_file_id: null as number | null,
  transfer_ringing_sound: 'ringback' as TransferRingingSound,
};

/** Returns an error message or null. */
export function validateHoldSound(value: unknown): string | null {
  if (!HOLD_SOUND_VALUES.includes(value as HoldSound)) {
    return `hold_sound must be one of: ${HOLD_SOUND_VALUES.join(', ')}`;
  }
  return null;
}

/** Returns an error message or null. */
export function validateTransferRingingSound(value: unknown): string | null {
  if (!TRANSFER_RINGING_SOUND_VALUES.includes(value as TransferRingingSound)) {
    return `transfer_ringing_sound must be one of: ${TRANSFER_RINGING_SOUND_VALUES.join(', ')}`;
  }
  return null;
}

/** An audio file id is a positive whole number, or null for no file. Returns an error message or null. */
export function validateHoldAudioFileId(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return 'hold_audio_file_id must be a positive integer or null';
  }
  return null;
}
