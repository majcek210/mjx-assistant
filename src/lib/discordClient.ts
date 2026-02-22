/**
 * Discord client singleton reference.
 *
 * Set once on the first incoming Discord message; used by the reminder
 * scheduler (and any other background service) to send channel messages
 * without needing a direct reference to the Discord bot instance.
 */

let _client: any = null;

export function setClient(client: any): void {
  if (!_client) _client = client;
}

export function getClient(): any {
  return _client;
}
