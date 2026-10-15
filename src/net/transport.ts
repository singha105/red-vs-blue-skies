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
