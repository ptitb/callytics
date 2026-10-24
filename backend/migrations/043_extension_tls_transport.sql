-- Allow SIP over TLS (with SRTP) as extension transport type.
-- Migration 018 and the stasis migrate step carry the same constraint, so replays keep it consistent.
ALTER TABLE sip_extensions
DROP CONSTRAINT IF EXISTS sip_extensions_transport_type_check;

ALTER TABLE sip_extensions
ADD CONSTRAINT sip_extensions_transport_type_check
CHECK (transport_type IN ('sip', 'webrtc', 'tls'));
