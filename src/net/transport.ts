// Networking boundary. Game code talks to these interfaces only, so PeerJS (peerTransport.ts) can be swapped
// for anything else, and tests use the in-memory fake (fakeTransport.ts).
//
// Two channels per peer:
//   unreliable: unordered, for inputs, snapshots and pings (a late packet never blocks a newer one)
//   reliable:   ordered, for events (join, leave, chat, kills, match state)

export type Channel = 'unreliable' | 'reliable';
export type Payload = ArrayBuffer | string;

export interface HostTransport {
  readonly roomCode: string;
  onPeer(cb: (peerId: string) => void): void;
  onMessage(cb: (peerId: string, channel: Channel, data: Payload) => void): void;
  onPeerLeft(cb: (peerId: string) => void): void;
  send(peerId: string, channel: Channel, data: Payload): void;
  /** Drop one peer (e.g. wrong build version). */
  kick(peerId: string): void;
  close(): void;
}

export interface ClientTransport {
  /** The id the host sees for this client, when the transport knows it (the in-memory loopback does). */
  readonly id?: string;
  send(channel: Channel, data: Payload): void;
  onMessage(cb: (channel: Channel, data: Payload) => void): void;
  /** The host went away (closed, crashed, or the connection dropped). */
  onClose(cb: () => void): void;
  close(): void;
}

export interface Network {
  host(roomCode: string): Promise<HostTransport>;
  join(roomCode: string): Promise<ClientTransport>;
}

export const payloadBytes = (data: Payload): number => (typeof data === 'string' ? data.length : data.byteLength);

/** One host fed by several transports (PeerJS for friends + the in-memory loopback for the host's own player). */
export function combineHosts(roomCode: string, parts: HostTransport[]): HostTransport {
  const owner = new Map<string, HostTransport>();
  const peerCbs: ((id: string) => void)[] = [];
  const msgCbs: ((id: string, c: Channel, d: Payload) => void)[] = [];
  const leftCbs: ((id: string) => void)[] = [];
  for (const t of parts) {
    t.onPeer((id) => {
      owner.set(id, t);
      for (const cb of peerCbs) cb(id);
    });
    t.onMessage((id, c, d) => {
      for (const cb of msgCbs) cb(id, c, d);
    });
    t.onPeerLeft((id) => {
      owner.delete(id);
      for (const cb of leftCbs) cb(id);
    });
  }
  return {
    roomCode,
    onPeer: (cb) => peerCbs.push(cb),
    onMessage: (cb) => msgCbs.push(cb),
    onPeerLeft: (cb) => leftCbs.push(cb),
    send: (id, c, d) => owner.get(id)?.send(id, c, d),
    kick: (id) => owner.get(id)?.kick(id),
    close: () => parts.forEach((t) => t.close()),
  };
}
