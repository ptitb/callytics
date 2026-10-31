-- Store the external party's number and the internal party who handled the call on each recording.
-- Nullable: older rows fall back to call_logs.caller_number for the number and have no operator.
-- ensureSchema in RecordingsService and the stasis migrate step carry the same columns.
ALTER TABLE call_recordings
ADD COLUMN IF NOT EXISTS remote_number TEXT,
ADD COLUMN IF NOT EXISTS operator_label TEXT;
