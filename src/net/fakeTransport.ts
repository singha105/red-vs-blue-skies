// In-memory network with configurable delay, jitter and loss, driven by an explicit clock (advance(ms)).
// Used by unit tests, and with zero delay as the host's loopback connection to its own player.
import type { Channel, ClientTransport, HostTransport, Network, Payload } from './transport';

export interface FakeOptions {
  /** One-way delay in ms. */
  delayMs?: number;
  jitterMs?: number;
  /** Chance (0–1) an unreliable packet is dropped. Reliable messages always arrive, in order. */
  loss?: number;
  random?: () => number;
}

interface Packet {
  at: number;
  seq: number;
  deliver: () => void;
}

export interface FakeNetwork extends Network {
  /** Advance the network clock and deliver everything that is due. */
  advance(ms: number): void;
  readonly now: number;
  setOptions(o: FakeOptions): void;
}

export function createFakeNetwork(initial: FakeOptions = {}): FakeNetwork {
  let opts: Required<FakeOptions> = { delayMs: 0, jitterMs: 0, loss: 0, random: Math.random, ...initial };
  let now = 0;
  let order = 0;
  const queue: Packet[] = [];
  const hosts = new Map<string, FakeHost>();
  let nextClient = 1;

  // Reliable channels stay ordered: each link remembers the last scheduled reliable delivery time.
  const schedule = (channel: Channel, lastReliable: { at: number }, deliver: () => void): void => {
    if (channel === 'unreliable' && opts.loss > 0 && opts.random() < opts.loss) return;
    let at = now + opts.delayMs + (opts.jitterMs > 0 ? opts.random() * opts.jitterMs : 0);
    if (channel === 'reliable') {
      at = Math.max(at, lastReliable.at);
      lastReliable.at = at;
    }
    queue.push({ at, seq: order++, deliver });
  };

  class FakeHost implements HostTransport {
    readonly peers = new Map<string, FakeClient>();
    peerCbs: ((id: string) => void)[] = [];
    msgCbs: ((id: string, c: Channel, d: Payload) => void)[] = [];
    leftCbs: ((id: string) => void)[] = [];
    closed = false;
    constructor(readonly roomCode: string) {}
    onPeer(cb: (id: string) => void): void {
      this.peerCbs.push(cb);
    }
    onMessage(cb: (id: string, c: Channel, d: Payload) => void): void {
      this.msgCbs.push(cb);
    }
    onPeerLeft(cb: (id: string) => void): void {
      this.leftCbs.push(cb);
    }
    send(peerId: string, channel: Channel, data: Payload): void {
      const c = this.peers.get(peerId);
      if (!c || this.closed) return;
      const copy = typeof data === 'string' ? data : data.slice(0);
      schedule(channel, c.downReliable, () => {
        if (!c.closed) for (const cb of c.msgCbs) cb(channel, copy);
      });
    }
    kick(peerId: string): void {
      const c = this.peers.get(peerId);
      if (c) c.drop();
    }
    close(): void {
      this.closed = true;
      hosts.delete(this.roomCode);
      for (const c of [...this.peers.values()]) c.drop();
    }
  }

  class FakeClient implements ClientTransport {
    msgCbs: ((c: Channel, d: Payload) => void)[] = [];
    closeCbs: (() => void)[] = [];
    closed = false;
    upReliable = { at: 0 };
    downReliable = { at: 0 };
    constructor(readonly id: string, readonly host: FakeHost) {}
    send(channel: Channel, data: Payload): void {
      if (this.closed) return;
      const copy = typeof data === 'string' ? data : data.slice(0);
      schedule(channel, this.upReliable, () => {
        if (!this.host.closed && this.host.peers.has(this.id)) for (const cb of this.host.msgCbs) cb(this.id, channel, copy);
      });
    }
    onMessage(cb: (c: Channel, d: Payload) => void): void {
      this.msgCbs.push(cb);
    }
    onClose(cb: () => void): void {
      this.closeCbs.push(cb);
    }
    /** Connection lost from the host's side (host closed or kicked us). */
    drop(): void {
      if (this.closed) return;
      this.closed = true;
      this.host.peers.delete(this.id);
      for (const cb of this.closeCbs) cb();
      for (const cb of this.host.leftCbs) cb(this.id);
    }
    close(): void {
      if (this.closed) return;
      this.closed = true;
      this.host.peers.delete(this.id);
      for (const cb of this.host.leftCbs) cb(this.id);
    }
  }

  return {
    get now() {
      return now;
    },
    setOptions(o) {
      opts = { ...opts, ...o };
    },
    async host(code) {
      if (hosts.has(code)) throw new Error('room code taken');
      const h = new FakeHost(code);
      hosts.set(code, h);
      return h;
    },
    async join(code) {
      const h = hosts.get(code);
      if (!h) throw new Error('room not found');
      const c = new FakeClient(`peer-${nextClient++}`, h);
      h.peers.set(c.id, c);
      for (const cb of h.peerCbs) cb(c.id);
      return c;
    },
    advance(ms) {
      now += ms;
      queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
      while (queue.length > 0 && queue[0]!.at <= now) queue.shift()!.deliver();
    },
  };
}
