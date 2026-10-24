UPDATE inbound_routes AS route
SET did = regexp_replace(route.did, '[[:space:]()./-]', '', 'g')
WHERE route.did !~ '^_'
  AND route.did ~ '[[:space:]()./-]'
  AND NOT EXISTS (
    SELECT 1
    FROM inbound_routes AS other
    WHERE other.did = regexp_replace(route.did, '[[:space:]()./-]', '', 'g')
  );
