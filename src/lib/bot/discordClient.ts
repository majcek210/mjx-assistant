/**
 * Discord client singleton reference.
 * Set once on the first incoming message; used by services that need
 * the client outside of event handlers (e.g. reminderScheduler).
 */

let _client: any = null;

export function setClient(client: any): void {
  if (!_client) _client = client;
}

export function getClient(): any {
  return _client;
}
