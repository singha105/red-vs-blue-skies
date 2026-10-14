// Networking boundary (Day 5). Game code talks to this interface only, so PeerJS can be swapped out later.

export type Channel = 'unreliable' | 'reliable';

export interface Transport {
  readonly id: string;
  send(peerId: string, channel: Channel, data: ArrayBuffer | string): void;
  broadcast(channel: Channel, data: ArrayBuffer | string): void;
  onMessage(handler: (peerId: string, channel: Channel, data: ArrayBuffer | string) => void): void;
  onPeer(handler: (peerId: string, connected: boolean) => void): void;
  close(): void;
}
