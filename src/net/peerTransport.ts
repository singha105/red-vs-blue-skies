// PeerJS implementation of the transport. PeerJS's free public signaling server introduces the peers;
// after that, traffic goes browser to browser over WebRTC (via the TURN relay only when NAT forces it).
//
// Each client opens two DataConnections to the host: "r" (reliable, ordered) and "u" (unordered; PeerJS
// can't turn retransmits off, but nothing waits behind a late packet).
import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import { peerIdFor } from './roomCode';
import type { Channel, ClientTransport, HostTransport, Network, Payload } from './transport';

export interface PeerNetOptions {
  iceServers: RTCIceServer[];
  /** Local signaling server for tests (?signal=localhost:9000). Defaults to PeerJS's public server. */
  signal?: { host: string; port: number; secure: boolean };
}

const JOIN_TIMEOUT_MS = 15_000;

function peerOptions(o: PeerNetOptions): PeerOptions {
  const base: PeerOptions = { config: { iceServers: o.iceServers }, debug: 1 };
  return o.signal ? { ...base, host: o.signal.host, port: o.signal.port, path: '/', secure: o.signal.secure } : base;
}

/** DataChannels deliver ArrayBuffer, typed-array views, or strings depending on browser; normalise. */
function toPayload(d: unknown): Payload | null {
  if (typeof d === 'string') return d;
  if (d instanceof ArrayBuffer) return d;
  if (ArrayBuffer.isView(d)) return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer;
  return null;
}

export class RoomTakenError extends Error {}
export class RoomNotFoundError extends Error {}

export function createPeerNetwork(o: PeerNetOptions): Network {
  return {
    host(code) {
      return new Promise<HostTransport>((resolve, reject) => {
        const peer = new Peer(peerIdFor(code), peerOptions(o));
        const links = new Map<string, { r?: DataConnection; u?: DataConnection; open: boolean }>();
        const peerCbs: ((id: string) => void)[] = [];
        const msgCbs: ((id: string, c: Channel, d: Payload) => void)[] = [];
        const leftCbs: ((id: string) => void)[] = [];
        let closed = false;

        const left = (id: string): void => {
          const l = links.get(id);
          if (!l) return;
          links.delete(id);
          l.r?.close();
          l.u?.close();
          if (l.open) for (const cb of leftCbs) cb(id);
        };

        peer.on('connection', (conn) => {
          const id = conn.peer;
          const link = links.get(id) ?? { open: false };
          links.set(id, link);
          if (conn.label === 'r') link.r = conn;
          else link.u = conn;
          conn.on('open', () => {
            if (!link.open && link.r?.open && link.u?.open) {
              link.open = true;
              for (const cb of peerCbs) cb(id);
            }
          });
          conn.on('data', (d) => {
            const p = toPayload(d);
            if (p !== null && link.open) for (const cb of msgCbs) cb(id, conn.label === 'r' ? 'reliable' : 'unreliable', p);
          });
          conn.on('close', () => left(id));
          conn.on('error', () => left(id));
        });

        const transport: HostTransport = {
          roomCode: code,
          onPeer: (cb) => peerCbs.push(cb),
          onMessage: (cb) => msgCbs.push(cb),
          onPeerLeft: (cb) => leftCbs.push(cb),
          send(id, channel, data) {
            const l = links.get(id);
            const conn = channel === 'reliable' ? l?.r : l?.u;
            if (!conn?.open) return;
            try {
              void conn.send(data);
            } catch {
              // Channel closing; the close handler will clean up.
            }
          },
          kick: (id) => left(id),
          close() {
            closed = true;
            for (const id of [...links.keys()]) left(id);
            peer.destroy();
          },
        };

        peer.on('open', () => resolve(transport));
        // Keep the room reachable for new joiners if the signaling socket drops.
        peer.on('disconnected', () => {
          if (!closed && !peer.destroyed) peer.reconnect();
        });
        peer.on('error', (err) => {
          const type = (err as { type?: string }).type;
          if (type === 'unavailable-id') {
            peer.destroy();
            reject(new RoomTakenError(code));
          } else if (!peer.open) {
            peer.destroy();
            reject(err);
          }
        });
      });
    },

    join(code) {
      return new Promise<ClientTransport>((resolve, reject) => {
        const peer = new Peer(peerOptions(o));
        const msgCbs: ((c: Channel, d: Payload) => void)[] = [];
        const closeCbs: (() => void)[] = [];
        let r: DataConnection | null = null;
        let u: DataConnection | null = null;
        let settled = false;
        let closed = false;

        const fail = (e: Error): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          peer.destroy();
          reject(e);
        };
        const closeAll = (): void => {
          if (closed) return;
          closed = true;
          r?.close();
          u?.close();
          peer.destroy();
          for (const cb of closeCbs) cb();
        };
        const timer = setTimeout(() => fail(new RoomNotFoundError(code)), JOIN_TIMEOUT_MS);

        const transport: ClientTransport = {
          send(channel, data) {
            const conn = channel === 'reliable' ? r : u;
            if (!conn?.open) return;
            try {
              void conn.send(data);
            } catch {
              // closing
            }
          },
          onMessage: (cb) => msgCbs.push(cb),
          onClose: (cb) => closeCbs.push(cb),
          close() {
            closeCbs.length = 0;
            closeAll();
          },
        };

        peer.on('open', () => {
          const host = peerIdFor(code);
          r = peer.connect(host, { label: 'r', reliable: true, serialization: 'raw' });
          u = peer.connect(host, { label: 'u', reliable: false, serialization: 'raw' });
          for (const conn of [r, u]) {
            conn.on('open', () => {
              if (!settled && r?.open && u?.open) {
                settled = true;
                clearTimeout(timer);
                resolve(transport);
              }
            });
            conn.on('data', (d) => {
              const p = toPayload(d);
              if (p !== null) for (const cb of msgCbs) cb(conn === r ? 'reliable' : 'unreliable', p);
            });
            conn.on('close', () => (settled ? closeAll() : fail(new Error('Connection closed'))));
            conn.on('error', () => (settled ? closeAll() : fail(new Error('Connection failed'))));
          }
        });
        peer.on('error', (err) => {
          const type = (err as { type?: string }).type;
          if (!settled) fail(type === 'peer-unavailable' ? new RoomNotFoundError(code) : err);
          else if (type === 'network' || type === 'disconnected') {
            // Signaling lost after connecting is fine: the data channels are peer to peer.
          }
        });
      });
    },
  };
}
