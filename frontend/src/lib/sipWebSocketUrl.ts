/**
 * WebSocket URL of the Asterisk SIP endpoint used by the browser softphone.
 * It is always same-origin: the web proxy forwards /ws to Asterisk, so the page
 * works over HTTPS (wss) and Asterisk does not need to be reachable from the browser.
 */
export function getSipWebSocketUrl(location: Pick<Location, 'protocol' | 'host'> = window.location): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws`;
}
