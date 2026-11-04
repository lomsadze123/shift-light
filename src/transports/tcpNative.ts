// React Native only: needs the native module from react-native-tcp-socket (a dev build,
// not Expo Go). The Node counterpart for scripts is tcpNode.ts.
import TcpSocket from 'react-native-tcp-socket';

import type { SocketFactory, SocketLike } from './tcp';

type SocketEvent = 'connect' | 'data' | 'error' | 'close';

export const createNativeSocket: SocketFactory = (host, port) => {
  // TcpTransport listens for 'connect' itself, so the callback has nothing to do.
  const socket = TcpSocket.createConnection({ host, port }, () => {});
  // Disable Nagle's algorithm: send each short command immediately (see tcpNode.ts).
  socket.setNoDelay(true);

  const adapter: SocketLike = {
    write: (data) => {
      socket.write(data);
    },
    destroy: () => {
      socket.destroy();
    },
    on: (event: SocketEvent, listener: (...args: never[]) => void) => {
      // SocketLike's overloads already pin each event to its listener type; the library's
      // `on` can't see that through a union, so widen here. 'data' delivers a Buffer, which
      // is a Uint8Array.
      socket.on(event, listener as (...args: unknown[]) => void);
    },
  };
  return adapter;
};
