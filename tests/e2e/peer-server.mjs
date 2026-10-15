// Local PeerJS signaling server for the multiplayer browser test, so it never touches the public one.
import { PeerServer } from 'peer';

const port = Number(process.env['PEER_PORT'] ?? 9187);
PeerServer({ port, path: '/' }, () => console.log(`PeerJS signaling on http://localhost:${port}/`));
