module.exports =
/******/ (function(modules, runtime) { // webpackBootstrap
/******/ 	"use strict";
/******/ 	// The module cache
/******/ 	var installedModules = {};
/******/
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/
/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId]) {
/******/ 			return installedModules[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			i: moduleId,
/******/ 			l: false,
/******/ 			exports: {}
/******/ 		};
/******/
/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/
/******/ 		// Flag the module as loaded
/******/ 		module.l = true;
/******/
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/
/******/
/******/ 	__webpack_require__.ab = __dirname + "/";
/******/
/******/ 	// the startup function
/******/ 	function startup() {
/******/ 		// Load entry module and return exports
/******/ 		return __webpack_require__(104);
/******/ 	};
/******/
/******/ 	// run startup
/******/ 	return startup();
/******/ })
/************************************************************************/
/******/ ({

/***/ 10:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";


const { randomFillSync } = __webpack_require__(417);

const PerMessageDeflate = __webpack_require__(301);
const { EMPTY_BUFFER } = __webpack_require__(799);
const { isValidStatusCode } = __webpack_require__(562);
const { mask: applyMask, toBuffer } = __webpack_require__(349);

const mask = Buffer.alloc(4);

/**
 * HyBi Sender implementation.
 */
class Sender {
  /**
   * Creates a Sender instance.
   *
   * @param {net.Socket} socket The connection socket
   * @param {Object} extensions An object containing the negotiated extensions
   */
  constructor(socket, extensions) {
    this._extensions = extensions || {};
    this._socket = socket;

    this._firstFragment = true;
    this._compress = false;

    this._bufferedBytes = 0;
    this._deflating = false;
    this._queue = [];
  }

  /**
   * Frames a piece of data according to the HyBi WebSocket protocol.
   *
   * @param {Buffer} data The data to frame
   * @param {Object} options Options object
   * @param {Number} options.opcode The opcode
   * @param {Boolean} options.readOnly Specifies whether `data` can be modified
   * @param {Boolean} options.fin Specifies whether or not to set the FIN bit
   * @param {Boolean} options.mask Specifies whether or not to mask `data`
   * @param {Boolean} options.rsv1 Specifies whether or not to set the RSV1 bit
   * @return {Buffer[]} The framed data as a list of `Buffer` instances
   * @public
   */
  static frame(data, options) {
    const merge = options.mask && options.readOnly;
    let offset = options.mask ? 6 : 2;
    let payloadLength = data.length;

    if (data.length >= 65536) {
      offset += 8;
      payloadLength = 127;
    } else if (data.length > 125) {
      offset += 2;
      payloadLength = 126;
    }

    const target = Buffer.allocUnsafe(merge ? data.length + offset : offset);

    target[0] = options.fin ? options.opcode | 0x80 : options.opcode;
    if (options.rsv1) target[0] |= 0x40;

    target[1] = payloadLength;

    if (payloadLength === 126) {
      target.writeUInt16BE(data.length, 2);
    } else if (payloadLength === 127) {
      target.writeUInt32BE(0, 2);
      target.writeUInt32BE(data.length, 6);
    }

    if (!options.mask) return [target, data];

    randomFillSync(mask, 0, 4);

    target[1] |= 0x80;
    target[offset - 4] = mask[0];
    target[offset - 3] = mask[1];
    target[offset - 2] = mask[2];
    target[offset - 1] = mask[3];

    if (merge) {
      applyMask(data, mask, target, offset, data.length);
      return [target];
    }

    applyMask(data, mask, data, 0, data.length);
    return [target, data];
  }

  /**
   * Sends a close message to the other peer.
   *
   * @param {(Number|undefined)} code The status code component of the body
   * @param {String} data The message component of the body
   * @param {Boolean} mask Specifies whether or not to mask the message
   * @param {Function} cb Callback
   * @public
   */
  close(code, data, mask, cb) {
    let buf;

    if (code === undefined) {
      buf = EMPTY_BUFFER;
    } else if (typeof code !== 'number' || !isValidStatusCode(code)) {
      throw new TypeError('First argument must be a valid error code number');
    } else if (data === undefined || data === '') {
      buf = Buffer.allocUnsafe(2);
      buf.writeUInt16BE(code, 0);
    } else {
      const length = Buffer.byteLength(data);

      if (length > 123) {
        throw new RangeError('The message must not be greater than 123 bytes');
      }

      buf = Buffer.allocUnsafe(2 + length);
      buf.writeUInt16BE(code, 0);
      buf.write(data, 2);
    }

    if (this._deflating) {
      this.enqueue([this.doClose, buf, mask, cb]);
    } else {
      this.doClose(buf, mask, cb);
    }
  }

  /**
   * Frames and sends a close message.
   *
   * @param {Buffer} data The message to send
   * @param {Boolean} mask Specifies whether or not to mask `data`
   * @param {Function} cb Callback
   * @private
   */
  doClose(data, mask, cb) {
    this.sendFrame(
      Sender.frame(data, {
        fin: true,
        rsv1: false,
        opcode: 0x08,
        mask,
        readOnly: false
      }),
      cb
    );
  }

  /**
   * Sends a ping message to the other peer.
   *
   * @param {*} data The message to send
   * @param {Boolean} mask Specifies whether or not to mask `data`
   * @param {Function} cb Callback
   * @public
   */
  ping(data, mask, cb) {
    const buf = toBuffer(data);

    if (buf.length > 125) {
      throw new RangeError('The data size must not be greater than 125 bytes');
    }

    if (this._deflating) {
      this.enqueue([this.doPing, buf, mask, toBuffer.readOnly, cb]);
    } else {
      this.doPing(buf, mask, toBuffer.readOnly, cb);
    }
  }

  /**
   * Frames and sends a ping message.
   *
   * @param {*} data The message to send
   * @param {Boolean} mask Specifies whether or not to mask `data`
   * @param {Boolean} readOnly Specifies whether `data` can be modified
   * @param {Function} cb Callback
   * @private
   */
  doPing(data, mask, readOnly, cb) {
    this.sendFrame(
      Sender.frame(data, {
        fin: true,
        rsv1: false,
        opcode: 0x09,
        mask,
        readOnly
      }),
      cb
    );
  }

  /**
   * Sends a pong message to the other peer.
   *
   * @param {*} data The message to send
   * @param {Boolean} mask Specifies whether or not to mask `data`
   * @param {Function} cb Callback
   * @public
   */
  pong(data, mask, cb) {
    const buf = toBuffer(data);

    if (buf.length > 125) {
      throw new RangeError('The data size must not be greater than 125 bytes');
    }

    if (this._deflating) {
      this.enqueue([this.doPong, buf, mask, toBuffer.readOnly, cb]);
    } else {
      this.doPong(buf, mask, toBuffer.readOnly, cb);
    }
  }

  /**
   * Frames and sends a pong message.
   *
   * @param {*} data The message to send
   * @param {Boolean} mask Specifies whether or not to mask `data`
   * @param {Boolean} readOnly Specifies whether `data` can be modified
   * @param {Function} cb Callback
   * @private
   */
  doPong(data, mask, readOnly, cb) {
    this.sendFrame(
      Sender.frame(data, {
        fin: true,
        rsv1: false,
        opcode: 0x0a,
        mask,
        readOnly
      }),
      cb
    );
  }

  /**
   * Sends a data message to the other peer.
   *
   * @param {*} data The message to send
   * @param {Object} options Options object
   * @param {Boolean} options.compress Specifies whether or not to compress `data`
   * @param {Boolean} options.binary Specifies whether `data` is binary or text
   * @param {Boolean} options.fin Specifies whether the fragment is the last one
   * @param {Boolean} options.mask Specifies whether or not to mask `data`
   * @param {Function} cb Callback
   * @public
   */
  send(data, options, cb) {
    const buf = toBuffer(data);
    const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
    let opcode = options.binary ? 2 : 1;
    let rsv1 = options.compress;

    if (this._firstFragment) {
      this._firstFragment = false;
      if (rsv1 && perMessageDeflate) {
        rsv1 = buf.length >= perMessageDeflate._threshold;
      }
      this._compress = rsv1;
    } else {
      rsv1 = false;
      opcode = 0;
    }

    if (options.fin) this._firstFragment = true;

    if (perMessageDeflate) {
      const opts = {
        fin: options.fin,
        rsv1,
        opcode,
        mask: options.mask,
        readOnly: toBuffer.readOnly
      };

      if (this._deflating) {
        this.enqueue([this.dispatch, buf, this._compress, opts, cb]);
      } else {
        this.dispatch(buf, this._compress, opts, cb);
      }
    } else {
      this.sendFrame(
        Sender.frame(buf, {
          fin: options.fin,
          rsv1: false,
          opcode,
          mask: options.mask,
          readOnly: toBuffer.readOnly
        }),
        cb
      );
    }
  }

  /**
   * Dispatches a data message.
   *
   * @param {Buffer} data The message to send
   * @param {Boolean} compress Specifies whether or not to compress `data`
   * @param {Object} options Options object
   * @param {Number} options.opcode The opcode
   * @param {Boolean} options.readOnly Specifies whether `data` can be modified
   * @param {Boolean} options.fin Specifies whether or not to set the FIN bit
   * @param {Boolean} options.mask Specifies whether or not to mask `data`
   * @param {Boolean} options.rsv1 Specifies whether or not to set the RSV1 bit
   * @param {Function} cb Callback
   * @private
   */
  dispatch(data, compress, options, cb) {
    if (!compress) {
      this.sendFrame(Sender.frame(data, options), cb);
      return;
    }

    const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];

    this._deflating = true;
    perMessageDeflate.compress(data, options.fin, (_, buf) => {
      if (this._socket.destroyed) {
        const err = new Error(
          'The socket was closed while data was being compressed'
        );

        if (typeof cb === 'function') cb(err);

        for (let i = 0; i < this._queue.length; i++) {
          const callback = this._queue[i][4];

          if (typeof callback === 'function') callback(err);
        }

        return;
      }

      this._deflating = false;
      options.readOnly = false;
      this.sendFrame(Sender.frame(buf, options), cb);
      this.dequeue();
    });
  }

  /**
   * Executes queued send operations.
   *
   * @private
   */
  dequeue() {
    while (!this._deflating && this._queue.length) {
      const params = this._queue.shift();

      this._bufferedBytes -= params[1].length;
      Reflect.apply(params[0], this, params.slice(1));
    }
  }

  /**
   * Enqueues a send operation.
   *
   * @param {Array} params Send operation parameters.
   * @private
   */
  enqueue(params) {
    this._bufferedBytes += params[1].length;
    this._queue.push(params);
  }

  /**
   * Sends a frame.
   *
   * @param {Buffer[]} list The frame to send
   * @param {Function} cb Callback
   * @private
   */
  sendFrame(list, cb) {
    if (list.length === 2) {
      this._socket.cork();
      this._socket.write(list[0]);
      this._socket.write(list[1], cb);
      this._socket.uncork();
    } else {
      this._socket.write(list[0], cb);
    }
  }
}

module.exports = Sender;


/***/ }),

/***/ 16:
/***/ (function(module) {

module.exports = require("tls");

/***/ }),

/***/ 21:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";


const EventEmitter = __webpack_require__(614);
const https = __webpack_require__(211);
const http = __webpack_require__(605);
const net = __webpack_require__(631);
const tls = __webpack_require__(16);
const { randomBytes, createHash } = __webpack_require__(417);
const { URL } = __webpack_require__(835);

const PerMessageDeflate = __webpack_require__(301);
const Receiver = __webpack_require__(312);
const Sender = __webpack_require__(10);
const {
  BINARY_TYPES,
  EMPTY_BUFFER,
  GUID,
  kStatusCode,
  kWebSocket,
  NOOP
} = __webpack_require__(799);
const { addEventListener, removeEventListener } = __webpack_require__(646);
const { format, parse } = __webpack_require__(330);
const { toBuffer } = __webpack_require__(349);

const readyStates = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
const protocolVersions = [8, 13];
const closeTimeout = 30 * 1000;

/**
 * Class representing a WebSocket.
 *
 * @extends EventEmitter
 */
class WebSocket extends EventEmitter {
  /**
   * Create a new `WebSocket`.
   *
   * @param {(String|url.URL)} address The URL to which to connect
   * @param {(String|String[])} protocols The subprotocols
   * @param {Object} options Connection options
   */
  constructor(address, protocols, options) {
    super();

    this.readyState = WebSocket.CONNECTING;
    this.protocol = '';

    this._binaryType = BINARY_TYPES[0];
    this._closeFrameReceived = false;
    this._closeFrameSent = false;
    this._closeMessage = '';
    this._closeTimer = null;
    this._closeCode = 1006;
    this._extensions = {};
    this._receiver = null;
    this._sender = null;
    this._socket = null;

    if (address !== null) {
      this._bufferedAmount = 0;
      this._isServer = false;
      this._redirects = 0;

      if (Array.isArray(protocols)) {
        protocols = protocols.join(', ');
      } else if (typeof protocols === 'object' && protocols !== null) {
        options = protocols;
        protocols = undefined;
      }

      initAsClient(this, address, protocols, options);
    } else {
      this._isServer = true;
    }
  }

  get CONNECTING() {
    return WebSocket.CONNECTING;
  }
  get CLOSING() {
    return WebSocket.CLOSING;
  }
  get CLOSED() {
    return WebSocket.CLOSED;
  }
  get OPEN() {
    return WebSocket.OPEN;
  }

  /**
   * This deviates from the WHATWG interface since ws doesn't support the
   * required default "blob" type (instead we define a custom "nodebuffer"
   * type).
   *
   * @type {String}
   */
  get binaryType() {
    return this._binaryType;
  }

  set binaryType(type) {
    if (!BINARY_TYPES.includes(type)) return;

    this._binaryType = type;

    //
    // Allow to change `binaryType` on the fly.
    //
    if (this._receiver) this._receiver._binaryType = type;
  }

  /**
   * @type {Number}
   */
  get bufferedAmount() {
    if (!this._socket) return this._bufferedAmount;

    //
    // `socket.bufferSize` is `undefined` if the socket is closed.
    //
    return (this._socket.bufferSize || 0) + this._sender._bufferedBytes;
  }

  /**
   * @type {String}
   */
  get extensions() {
    return Object.keys(this._extensions).join();
  }

  /**
   * Set up the socket and the internal resources.
   *
   * @param {net.Socket} socket The network socket between the server and client
   * @param {Buffer} head The first packet of the upgraded stream
   * @param {Number} maxPayload The maximum allowed message size
   * @private
   */
  setSocket(socket, head, maxPayload) {
    const receiver = new Receiver(
      this._binaryType,
      this._extensions,
      this._isServer,
      maxPayload
    );

    this._sender = new Sender(socket, this._extensions);
    this._receiver = receiver;
    this._socket = socket;

    receiver[kWebSocket] = this;
    socket[kWebSocket] = this;

    receiver.on('conclude', receiverOnConclude);
    receiver.on('drain', receiverOnDrain);
    receiver.on('error', receiverOnError);
    receiver.on('message', receiverOnMessage);
    receiver.on('ping', receiverOnPing);
    receiver.on('pong', receiverOnPong);

    socket.setTimeout(0);
    socket.setNoDelay();

    if (head.length > 0) socket.unshift(head);

    socket.on('close', socketOnClose);
    socket.on('data', socketOnData);
    socket.on('end', socketOnEnd);
    socket.on('error', socketOnError);

    this.readyState = WebSocket.OPEN;
    this.emit('open');
  }

  /**
   * Emit the `'close'` event.
   *
   * @private
   */
  emitClose() {
    if (!this._socket) {
      this.readyState = WebSocket.CLOSED;
      this.emit('close', this._closeCode, this._closeMessage);
      return;
    }

    if (this._extensions[PerMessageDeflate.extensionName]) {
      this._extensions[PerMessageDeflate.extensionName].cleanup();
    }

    this._receiver.removeAllListeners();
    this.readyState = WebSocket.CLOSED;
    this.emit('close', this._closeCode, this._closeMessage);
  }

  /**
   * Start a closing handshake.
   *
   *          +----------+   +-----------+   +----------+
   *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
   *    |     +----------+   +-----------+   +----------+     |
   *          +----------+   +-----------+         |
   * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
   *          +----------+   +-----------+   |
   *    |           |                        |   +---+        |
   *                +------------------------+-->|fin| - - - -
   *    |         +---+                      |   +---+
   *     - - - - -|fin|<---------------------+
   *              +---+
   *
   * @param {Number} code Status code explaining why the connection is closing
   * @param {String} data A string explaining why the connection is closing
   * @public
   */
  close(code, data) {
    if (this.readyState === WebSocket.CLOSED) return;
    if (this.readyState === WebSocket.CONNECTING) {
      const msg = 'WebSocket was closed before the connection was established';
      return abortHandshake(this, this._req, msg);
    }

    if (this.readyState === WebSocket.CLOSING) {
      if (this._closeFrameSent && this._closeFrameReceived) this._socket.end();
      return;
    }

    this.readyState = WebSocket.CLOSING;
    this._sender.close(code, data, !this._isServer, (err) => {
      //
      // This error is handled by the `'error'` listener on the socket. We only
      // want to know if the close frame has been sent here.
      //
      if (err) return;

      this._closeFrameSent = true;
      if (this._closeFrameReceived) this._socket.end();
    });

    //
    // Specify a timeout for the closing handshake to complete.
    //
    this._closeTimer = setTimeout(
      this._socket.destroy.bind(this._socket),
      closeTimeout
    );
  }

  /**
   * Send a ping.
   *
   * @param {*} data The data to send
   * @param {Boolean} mask Indicates whether or not to mask `data`
   * @param {Function} cb Callback which is executed when the ping is sent
   * @public
   */
  ping(data, mask, cb) {
    if (this.readyState === WebSocket.CONNECTING) {
      throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
    }

    if (typeof data === 'function') {
      cb = data;
      data = mask = undefined;
    } else if (typeof mask === 'function') {
      cb = mask;
      mask = undefined;
    }

    if (typeof data === 'number') data = data.toString();

    if (this.readyState !== WebSocket.OPEN) {
      sendAfterClose(this, data, cb);
      return;
    }

    if (mask === undefined) mask = !this._isServer;
    this._sender.ping(data || EMPTY_BUFFER, mask, cb);
  }

  /**
   * Send a pong.
   *
   * @param {*} data The data to send
   * @param {Boolean} mask Indicates whether or not to mask `data`
   * @param {Function} cb Callback which is executed when the pong is sent
   * @public
   */
  pong(data, mask, cb) {
    if (this.readyState === WebSocket.CONNECTING) {
      throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
    }

    if (typeof data === 'function') {
      cb = data;
      data = mask = undefined;
    } else if (typeof mask === 'function') {
      cb = mask;
      mask = undefined;
    }

    if (typeof data === 'number') data = data.toString();

    if (this.readyState !== WebSocket.OPEN) {
      sendAfterClose(this, data, cb);
      return;
    }

    if (mask === undefined) mask = !this._isServer;
    this._sender.pong(data || EMPTY_BUFFER, mask, cb);
  }

  /**
   * Send a data message.
   *
   * @param {*} data The message to send
   * @param {Object} options Options object
   * @param {Boolean} options.compress Specifies whether or not to compress
   *     `data`
   * @param {Boolean} options.binary Specifies whether `data` is binary or text
   * @param {Boolean} options.fin Specifies whether the fragment is the last one
   * @param {Boolean} options.mask Specifies whether or not to mask `data`
   * @param {Function} cb Callback which is executed when data is written out
   * @public
   */
  send(data, options, cb) {
    if (this.readyState === WebSocket.CONNECTING) {
      throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
    }

    if (typeof options === 'function') {
      cb = options;
      options = {};
    }

    if (typeof data === 'number') data = data.toString();

    if (this.readyState !== WebSocket.OPEN) {
      sendAfterClose(this, data, cb);
      return;
    }

    const opts = {
      binary: typeof data !== 'string',
      mask: !this._isServer,
      compress: true,
      fin: true,
      ...options
    };

    if (!this._extensions[PerMessageDeflate.extensionName]) {
      opts.compress = false;
    }

    this._sender.send(data || EMPTY_BUFFER, opts, cb);
  }

  /**
   * Forcibly close the connection.
   *
   * @public
   */
  terminate() {
    if (this.readyState === WebSocket.CLOSED) return;
    if (this.readyState === WebSocket.CONNECTING) {
      const msg = 'WebSocket was closed before the connection was established';
      return abortHandshake(this, this._req, msg);
    }

    if (this._socket) {
      this.readyState = WebSocket.CLOSING;
      this._socket.destroy();
    }
  }
}

readyStates.forEach((readyState, i) => {
  WebSocket[readyState] = i;
});

//
// Add the `onopen`, `onerror`, `onclose`, and `onmessage` attributes.
// See https://html.spec.whatwg.org/multipage/comms.html#the-websocket-interface
//
['open', 'error', 'close', 'message'].forEach((method) => {
  Object.defineProperty(WebSocket.prototype, `on${method}`, {
    /**
     * Return the listener of the event.
     *
     * @return {(Function|undefined)} The event listener or `undefined`
     * @public
     */
    get() {
      const listeners = this.listeners(method);
      for (let i = 0; i < listeners.length; i++) {
        if (listeners[i]._listener) return listeners[i]._listener;
      }

      return undefined;
    },
    /**
     * Add a listener for the event.
     *
     * @param {Function} listener The listener to add
     * @public
     */
    set(listener) {
      const listeners = this.listeners(method);
      for (let i = 0; i < listeners.length; i++) {
        //
        // Remove only the listeners added via `addEventListener`.
        //
        if (listeners[i]._listener) this.removeListener(method, listeners[i]);
      }
      this.addEventListener(method, listener);
    }
  });
});

WebSocket.prototype.addEventListener = addEventListener;
WebSocket.prototype.removeEventListener = removeEventListener;

module.exports = WebSocket;

/**
 * Initialize a WebSocket client.
 *
 * @param {WebSocket} websocket The client to initialize
 * @param {(String|url.URL)} address The URL to which to connect
 * @param {String} protocols The subprotocols
 * @param {Object} options Connection options
 * @param {(Boolean|Object)} options.perMessageDeflate Enable/disable
 *     permessage-deflate
 * @param {Number} options.handshakeTimeout Timeout in milliseconds for the
 *     handshake request
 * @param {Number} options.protocolVersion Value of the `Sec-WebSocket-Version`
 *     header
 * @param {String} options.origin Value of the `Origin` or
 *     `Sec-WebSocket-Origin` header
 * @param {Number} options.maxPayload The maximum allowed message size
 * @param {Boolean} options.followRedirects Whether or not to follow redirects
 * @param {Number} options.maxRedirects The maximum number of redirects allowed
 * @private
 */
function initAsClient(websocket, address, protocols, options) {
  const opts = {
    protocolVersion: protocolVersions[1],
    maxPayload: 100 * 1024 * 1024,
    perMessageDeflate: true,
    followRedirects: false,
    maxRedirects: 10,
    ...options,
    createConnection: undefined,
    socketPath: undefined,
    hostname: undefined,
    protocol: undefined,
    timeout: undefined,
    method: undefined,
    host: undefined,
    path: undefined,
    port: undefined
  };

  if (!protocolVersions.includes(opts.protocolVersion)) {
    throw new RangeError(
      `Unsupported protocol version: ${opts.protocolVersion} ` +
        `(supported versions: ${protocolVersions.join(', ')})`
    );
  }

  let parsedUrl;

  if (address instanceof URL) {
    parsedUrl = address;
    websocket.url = address.href;
  } else {
    parsedUrl = new URL(address);
    websocket.url = address;
  }

  const isUnixSocket = parsedUrl.protocol === 'ws+unix:';

  if (!parsedUrl.host && (!isUnixSocket || !parsedUrl.pathname)) {
    throw new Error(`Invalid URL: ${websocket.url}`);
  }

  const isSecure =
    parsedUrl.protocol === 'wss:' || parsedUrl.protocol === 'https:';
  const defaultPort = isSecure ? 443 : 80;
  const key = randomBytes(16).toString('base64');
  const get = isSecure ? https.get : http.get;
  let perMessageDeflate;

  opts.createConnection = isSecure ? tlsConnect : netConnect;
  opts.defaultPort = opts.defaultPort || defaultPort;
  opts.port = parsedUrl.port || defaultPort;
  opts.host = parsedUrl.hostname.startsWith('[')
    ? parsedUrl.hostname.slice(1, -1)
    : parsedUrl.hostname;
  opts.headers = {
    'Sec-WebSocket-Version': opts.protocolVersion,
    'Sec-WebSocket-Key': key,
    Connection: 'Upgrade',
    Upgrade: 'websocket',
    ...opts.headers
  };
  opts.path = parsedUrl.pathname + parsedUrl.search;
  opts.timeout = opts.handshakeTimeout;

  if (opts.perMessageDeflate) {
    perMessageDeflate = new PerMessageDeflate(
      opts.perMessageDeflate !== true ? opts.perMessageDeflate : {},
      false,
      opts.maxPayload
    );
    opts.headers['Sec-WebSocket-Extensions'] = format({
      [PerMessageDeflate.extensionName]: perMessageDeflate.offer()
    });
  }
  if (protocols) {
    opts.headers['Sec-WebSocket-Protocol'] = protocols;
  }
  if (opts.origin) {
    if (opts.protocolVersion < 13) {
      opts.headers['Sec-WebSocket-Origin'] = opts.origin;
    } else {
      opts.headers.Origin = opts.origin;
    }
  }
  if (parsedUrl.username || parsedUrl.password) {
    opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
  }

  if (isUnixSocket) {
    const parts = opts.path.split(':');

    opts.socketPath = parts[0];
    opts.path = parts[1];
  }

  let req = (websocket._req = get(opts));

  if (opts.timeout) {
    req.on('timeout', () => {
      abortHandshake(websocket, req, 'Opening handshake has timed out');
    });
  }

  req.on('error', (err) => {
    if (websocket._req.aborted) return;

    req = websocket._req = null;
    websocket.readyState = WebSocket.CLOSING;
    websocket.emit('error', err);
    websocket.emitClose();
  });

  req.on('response', (res) => {
    const location = res.headers.location;
    const statusCode = res.statusCode;

    if (
      location &&
      opts.followRedirects &&
      statusCode >= 300 &&
      statusCode < 400
    ) {
      if (++websocket._redirects > opts.maxRedirects) {
        abortHandshake(websocket, req, 'Maximum redirects exceeded');
        return;
      }

      req.abort();

      const addr = new URL(location, address);

      initAsClient(websocket, addr, protocols, options);
    } else if (!websocket.emit('unexpected-response', req, res)) {
      abortHandshake(
        websocket,
        req,
        `Unexpected server response: ${res.statusCode}`
      );
    }
  });

  req.on('upgrade', (res, socket, head) => {
    websocket.emit('upgrade', res);

    //
    // The user may have closed the connection from a listener of the `upgrade`
    // event.
    //
    if (websocket.readyState !== WebSocket.CONNECTING) return;

    req = websocket._req = null;

    const digest = createHash('sha1')
      .update(key + GUID)
      .digest('base64');

    if (res.headers['sec-websocket-accept'] !== digest) {
      abortHandshake(websocket, socket, 'Invalid Sec-WebSocket-Accept header');
      return;
    }

    const serverProt = res.headers['sec-websocket-protocol'];
    const protList = (protocols || '').split(/, */);
    let protError;

    if (!protocols && serverProt) {
      protError = 'Server sent a subprotocol but none was requested';
    } else if (protocols && !serverProt) {
      protError = 'Server sent no subprotocol';
    } else if (serverProt && !protList.includes(serverProt)) {
      protError = 'Server sent an invalid subprotocol';
    }

    if (protError) {
      abortHandshake(websocket, socket, protError);
      return;
    }

    if (serverProt) websocket.protocol = serverProt;

    if (perMessageDeflate) {
      try {
        const extensions = parse(res.headers['sec-websocket-extensions']);

        if (extensions[PerMessageDeflate.extensionName]) {
          perMessageDeflate.accept(extensions[PerMessageDeflate.extensionName]);
          websocket._extensions[
            PerMessageDeflate.extensionName
          ] = perMessageDeflate;
        }
      } catch (err) {
        abortHandshake(
          websocket,
          socket,
          'Invalid Sec-WebSocket-Extensions header'
        );
        return;
      }
    }

    websocket.setSocket(socket, head, opts.maxPayload);
  });
}

/**
 * Create a `net.Socket` and initiate a connection.
 *
 * @param {Object} options Connection options
 * @return {net.Socket} The newly created socket used to start the connection
 * @private
 */
function netConnect(options) {
  options.path = options.socketPath;
  return net.connect(options);
}

/**
 * Create a `tls.TLSSocket` and initiate a connection.
 *
 * @param {Object} options Connection options
 * @return {tls.TLSSocket} The newly created socket used to start the connection
 * @private
 */
function tlsConnect(options) {
  options.path = undefined;

  if (!options.servername && options.servername !== '') {
    options.servername = options.host;
  }

  return tls.connect(options);
}

/**
 * Abort the handshake and emit an error.
 *
 * @param {WebSocket} websocket The WebSocket instance
 * @param {(http.ClientRequest|net.Socket)} stream The request to abort or the
 *     socket to destroy
 * @param {String} message The error message
 * @private
 */
function abortHandshake(websocket, stream, message) {
  websocket.readyState = WebSocket.CLOSING;

  const err = new Error(message);
  Error.captureStackTrace(err, abortHandshake);

  if (stream.setHeader) {
    stream.abort();
    stream.once('abort', websocket.emitClose.bind(websocket));
    websocket.emit('error', err);
  } else {
    stream.destroy(err);
    stream.once('error', websocket.emit.bind(websocket, 'error'));
    stream.once('close', websocket.emitClose.bind(websocket));
  }
}

/**
 * Handle cases where the `ping()`, `pong()`, or `send()` methods are called
 * when the `readyState` attribute is `CLOSING` or `CLOSED`.
 *
 * @param {WebSocket} websocket The WebSocket instance
 * @param {*} data The data to send
 * @param {Function} cb Callback
 * @private
 */
function sendAfterClose(websocket, data, cb) {
  if (data) {
    const length = toBuffer(data).length;

    //
    // The `_bufferedAmount` property is used only when the peer is a client and
    // the opening handshake fails. Under these circumstances, in fact, the
    // `setSocket()` method is not called, so the `_socket` and `_sender`
    // properties are set to `null`.
    //
    if (websocket._socket) websocket._sender._bufferedBytes += length;
    else websocket._bufferedAmount += length;
  }

  if (cb) {
    const err = new Error(
      `WebSocket is not open: readyState ${websocket.readyState} ` +
        `(${readyStates[websocket.readyState]})`
    );
    cb(err);
  }
}

/**
 * The listener of the `Receiver` `'conclude'` event.
 *
 * @param {Number} code The status code
 * @param {String} reason The reason for closing
 * @private
 */
function receiverOnConclude(code, reason) {
  const websocket = this[kWebSocket];

  websocket._socket.removeListener('data', socketOnData);
  websocket._socket.resume();

  websocket._closeFrameReceived = true;
  websocket._closeMessage = reason;
  websocket._closeCode = code;

  if (code === 1005) websocket.close();
  else websocket.close(code, reason);
}

/**
 * The listener of the `Receiver` `'drain'` event.
 *
 * @private
 */
function receiverOnDrain() {
  this[kWebSocket]._socket.resume();
}

/**
 * The listener of the `Receiver` `'error'` event.
 *
 * @param {(RangeError|Error)} err The emitted error
 * @private
 */
function receiverOnError(err) {
  const websocket = this[kWebSocket];

  websocket._socket.removeListener('data', socketOnData);

  websocket.readyState = WebSocket.CLOSING;
  websocket._closeCode = err[kStatusCode];
  websocket.emit('error', err);
  websocket._socket.destroy();
}

/**
 * The listener of the `Receiver` `'finish'` event.
 *
 * @private
 */
function receiverOnFinish() {
  this[kWebSocket].emitClose();
}

/**
 * The listener of the `Receiver` `'message'` event.
 *
 * @param {(String|Buffer|ArrayBuffer|Buffer[])} data The message
 * @private
 */
function receiverOnMessage(data) {
  this[kWebSocket].emit('message', data);
}

/**
 * The listener of the `Receiver` `'ping'` event.
 *
 * @param {Buffer} data The data included in the ping frame
 * @private
 */
function receiverOnPing(data) {
  const websocket = this[kWebSocket];

  websocket.pong(data, !websocket._isServer, NOOP);
  websocket.emit('ping', data);
}

/**
 * The listener of the `Receiver` `'pong'` event.
 *
 * @param {Buffer} data The data included in the pong frame
 * @private
 */
function receiverOnPong(data) {
  this[kWebSocket].emit('pong', data);
}

/**
 * The listener of the `net.Socket` `'close'` event.
 *
 * @private
 */
function socketOnClose() {
  const websocket = this[kWebSocket];

  this.removeListener('close', socketOnClose);
  this.removeListener('end', socketOnEnd);

  websocket.readyState = WebSocket.CLOSING;

  //
  // The close frame might not have been received or the `'end'` event emitted,
  // for example, if the socket was destroyed due to an error. Ensure that the
  // `receiver` stream is closed after writing any remaining buffered data to
  // it. If the readable side of the socket is in flowing mode then there is no
  // buffered data as everything has been already written and `readable.read()`
  // will return `null`. If instead, the socket is paused, any possible buffered
  // data will be read as a single chunk and emitted synchronously in a single
  // `'data'` event.
  //
  websocket._socket.read();
  websocket._receiver.end();

  this.removeListener('data', socketOnData);
  this[kWebSocket] = undefined;

  clearTimeout(websocket._closeTimer);

  if (
    websocket._receiver._writableState.finished ||
    websocket._receiver._writableState.errorEmitted
  ) {
    websocket.emitClose();
  } else {
    websocket._receiver.on('error', receiverOnFinish);
    websocket._receiver.on('finish', receiverOnFinish);
  }
}

/**
 * The listener of the `net.Socket` `'data'` event.
 *
 * @param {Buffer} chunk A chunk of data
 * @private
 */
function socketOnData(chunk) {
  if (!this[kWebSocket]._receiver.write(chunk)) {
    this.pause();
  }
}

/**
 * The listener of the `net.Socket` `'end'` event.
 *
 * @private
 */
function socketOnEnd() {
  const websocket = this[kWebSocket];

  websocket.readyState = WebSocket.CLOSING;
  websocket._receiver.end();
  this.end();
}

/**
 * The listener of the `net.Socket` `'error'` event.
 *
 * @private
 */
function socketOnError() {
  const websocket = this[kWebSocket];

  this.removeListener('error', socketOnError);
  this.on('error', NOOP);

  if (websocket) {
    websocket.readyState = WebSocket.CLOSING;
    this.destroy();
  }
}


/***/ }),

/***/ 24:
/***/ (function() {

eval("require")("bufferutil");


/***/ }),

/***/ 87:
/***/ (function(module) {

module.exports = require("os");

/***/ }),

/***/ 104:
/***/ (function(__unusedmodule, __unusedexports, __webpack_require__) {

const core = __webpack_require__(470);
const OSC = __webpack_require__(234);

async function run() {
  let osc
  try {
    const endpoint = core.getInput('endpoint', { required: true })
    const host = core.getInput('host', { required: true })
    const port = core.getInput('port', { required: true })
    const separator = core.getInput('separator')
    const message = core.getInput('message', { required: true })

    osc = new OSC({ plugin: new OSC.DatagramPlugin({ send: { host: host, port: port } }) })
    osc.open()  

    let msg = [message]
    if (separator != '') {
      msg = message.split(separator)
    }

    let oscMsg = new OSC.Message(endpoint)
    for (const part of msg) {  
      oscMsg.add(part)
    }

    osc.send(oscMsg)

    console.log("sent", oscMsg)
  } catch (error) {
    core.setFailed(error.message)
  } finally {
    try {
      osc.close()
    } catch (error) {
      core.setFailed(error.message)
    }
  }

}

run()


/***/ }),

/***/ 200:
/***/ (function(module) {

module.exports = require("dgram");

/***/ }),

/***/ 211:
/***/ (function(module) {

module.exports = require("https");

/***/ }),

/***/ 234:
/***/ (function(module, __unusedexports, __webpack_require__) {

(function (global, factory) {
   true ? module.exports = factory() :
  undefined;
}(this, (function () { 'use strict';

  function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  }

  function _defineProperties(target, props) {
    for (var i = 0; i < props.length; i++) {
      var descriptor = props[i];
      descriptor.enumerable = descriptor.enumerable || false;
      descriptor.configurable = true;
      if ("value" in descriptor) descriptor.writable = true;
      Object.defineProperty(target, descriptor.key, descriptor);
    }
  }

  function _createClass(Constructor, protoProps, staticProps) {
    if (protoProps) _defineProperties(Constructor.prototype, protoProps);
    if (staticProps) _defineProperties(Constructor, staticProps);
    return Constructor;
  }

  function _defineProperty(obj, key, value) {
    if (key in obj) {
      Object.defineProperty(obj, key, {
        value: value,
        enumerable: true,
        configurable: true,
        writable: true
      });
    } else {
      obj[key] = value;
    }

    return obj;
  }

  function ownKeys(object, enumerableOnly) {
    var keys = Object.keys(object);

    if (Object.getOwnPropertySymbols) {
      var symbols = Object.getOwnPropertySymbols(object);
      if (enumerableOnly) symbols = symbols.filter(function (sym) {
        return Object.getOwnPropertyDescriptor(object, sym).enumerable;
      });
      keys.push.apply(keys, symbols);
    }

    return keys;
  }

  function _objectSpread2(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i] != null ? arguments[i] : {};

      if (i % 2) {
        ownKeys(Object(source), true).forEach(function (key) {
          _defineProperty(target, key, source[key]);
        });
      } else if (Object.getOwnPropertyDescriptors) {
        Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
      } else {
        ownKeys(Object(source)).forEach(function (key) {
          Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
        });
      }
    }

    return target;
  }

  function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
      throw new TypeError("Super expression must either be null or a function");
    }

    subClass.prototype = Object.create(superClass && superClass.prototype, {
      constructor: {
        value: subClass,
        writable: true,
        configurable: true
      }
    });
    if (superClass) _setPrototypeOf(subClass, superClass);
  }

  function _getPrototypeOf(o) {
    _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) {
      return o.__proto__ || Object.getPrototypeOf(o);
    };
    return _getPrototypeOf(o);
  }

  function _setPrototypeOf(o, p) {
    _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) {
      o.__proto__ = p;
      return o;
    };

    return _setPrototypeOf(o, p);
  }

  function _assertThisInitialized(self) {
    if (self === void 0) {
      throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }

    return self;
  }

  function _possibleConstructorReturn(self, call) {
    if (call && (typeof call === "object" || typeof call === "function")) {
      return call;
    }

    return _assertThisInitialized(self);
  }

  function _superPropBase(object, property) {
    while (!Object.prototype.hasOwnProperty.call(object, property)) {
      object = _getPrototypeOf(object);
      if (object === null) break;
    }

    return object;
  }

  function _get(target, property, receiver) {
    if (typeof Reflect !== "undefined" && Reflect.get) {
      _get = Reflect.get;
    } else {
      _get = function _get(target, property, receiver) {
        var base = _superPropBase(target, property);

        if (!base) return;
        var desc = Object.getOwnPropertyDescriptor(base, property);

        if (desc.get) {
          return desc.get.call(receiver);
        }

        return desc.value;
      };
    }

    return _get(target, property, receiver || target);
  }

  function isInt(n) {
    return Number(n) === n && n % 1 === 0;
  }
  function isFloat(n) {
    return Number(n) === n && n % 1 !== 0;
  }
  function isString(n) {
    return typeof n === 'string';
  }
  function isArray(n) {
    return Object.prototype.toString.call(n) === '[object Array]';
  }
  function isObject(n) {
    return Object.prototype.toString.call(n) === '[object Object]';
  }
  function isFunction(n) {
    return typeof n === 'function';
  }
  function isBlob(n) {
    return n instanceof Uint8Array;
  }
  function isDate(n) {
    return n instanceof Date;
  }
  function isUndefined(n) {
    return typeof n === 'undefined';
  }
  function pad(n) {
    return n + 3 & ~0x03;
  }
  function hasProperty(name) {
    return Object.prototype.hasOwnProperty.call(typeof global !== 'undefined' ? global : window,
    name);
  }
  function dataView(obj) {
    if (obj.buffer) {
      return new DataView(obj.buffer);
    } else if (obj instanceof ArrayBuffer) {
      return new DataView(obj);
    }
    return new DataView(new Uint8Array(obj));
  }

  function typeTag(item) {
    if (isInt(item)) {
      return 'i';
    } else if (isFloat(item)) {
      return 'f';
    } else if (isString(item)) {
      return 's';
    } else if (isBlob(item)) {
      return 'b';
    }
    throw new Error('OSC typeTag() found unknown value type');
  }
  function prepareAddress(obj) {
    var address = '';
    if (isArray(obj)) {
      return "/".concat(obj.join('/'));
    } else if (isString(obj)) {
      address = obj;
      if (address.length > 1 && address[address.length - 1] === '/') {
        address = address.slice(0, address.length - 1);
      }
      if (address.length > 1 && address[0] !== '/') {
        address = "/".concat(address);
      }
      return address;
    }
    throw new Error('OSC prepareAddress() needs addresses of type array or string');
  }
  function prepareRegExPattern(str) {
    var pattern;
    if (!isString(str)) {
      throw new Error('OSC prepareRegExPattern() needs strings');
    }
    pattern = str.replace(/\./g, '\\.');
    pattern = pattern.replace(/\(/g, '\\(');
    pattern = pattern.replace(/\)/g, '\\)');
    pattern = pattern.replace(/\{/g, '(');
    pattern = pattern.replace(/\}/g, ')');
    pattern = pattern.replace(/,/g, '|');
    pattern = pattern.replace(/\[!/g, '[^');
    pattern = pattern.replace(/\?/g, '.');
    pattern = pattern.replace(/\*/g, '.*');
    return pattern;
  }
  var EncodeHelper =
  function () {
    function EncodeHelper() {
      _classCallCheck(this, EncodeHelper);
      this.data = [];
      this.byteLength = 0;
    }
    _createClass(EncodeHelper, [{
      key: "add",
      value: function add(item) {
        var buffer = item.pack();
        this.byteLength += buffer.byteLength;
        this.data.push(buffer);
        return this;
      }
    }, {
      key: "merge",
      value: function merge() {
        var result = new Uint8Array(this.byteLength);
        var offset = 0;
        this.data.forEach(function (data) {
          result.set(data, offset);
          offset += data.byteLength;
        });
        return result;
      }
    }]);
    return EncodeHelper;
  }();

  var Atomic =
  function () {
    function Atomic(value) {
      _classCallCheck(this, Atomic);
      this.value = value;
      this.offset = 0;
    }
    _createClass(Atomic, [{
      key: "pack",
      value: function pack(method, byteLength) {
        if (!(method && byteLength)) {
          throw new Error('OSC Atomic cant\'t be packed without given method or byteLength');
        }
        var data = new Uint8Array(byteLength);
        var dataView = new DataView(data.buffer);
        if (isUndefined(this.value)) {
          throw new Error('OSC Atomic cant\'t be encoded with empty value');
        }
        dataView[method](this.offset, this.value, false);
        return data;
      }
    }, {
      key: "unpack",
      value: function unpack(dataView, method, byteLength) {
        var initialOffset = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 0;
        if (!(dataView && method && byteLength)) {
          throw new Error('OSC Atomic cant\'t be unpacked without given dataView, method or byteLength');
        }
        if (!(dataView instanceof DataView)) {
          throw new Error('OSC Atomic expects an instance of type DataView');
        }
        this.value = dataView[method](initialOffset, false);
        this.offset = initialOffset + byteLength;
        return this.offset;
      }
    }]);
    return Atomic;
  }();

  var AtomicInt32 =
  function (_Atomic) {
    _inherits(AtomicInt32, _Atomic);
    function AtomicInt32(value) {
      _classCallCheck(this, AtomicInt32);
      if (value && !isInt(value)) {
        throw new Error('OSC AtomicInt32 constructor expects value of type number');
      }
      return _possibleConstructorReturn(this, _getPrototypeOf(AtomicInt32).call(this, value));
    }
    _createClass(AtomicInt32, [{
      key: "pack",
      value: function pack() {
        return _get(_getPrototypeOf(AtomicInt32.prototype), "pack", this).call(this, 'setInt32', 4);
      }
    }, {
      key: "unpack",
      value: function unpack(dataView) {
        var initialOffset = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
        return _get(_getPrototypeOf(AtomicInt32.prototype), "unpack", this).call(this, dataView, 'getInt32', 4, initialOffset);
      }
    }]);
    return AtomicInt32;
  }(Atomic);

  var STR_SLICE_SIZE = 65537;
  var STR_ENCODING = 'utf-8';
  function charCodesToString(charCodes) {
    if (hasProperty('Buffer')) {
      return Buffer.from(charCodes).toString(STR_ENCODING);
    } else if (hasProperty('TextDecoder')) {
      return new TextDecoder(STR_ENCODING)
      .decode(new Int8Array(charCodes));
    }
    var str = '';
    for (var i = 0; i < charCodes.length; i += STR_SLICE_SIZE) {
      str += String.fromCharCode.apply(null, charCodes.slice(i, i + STR_SLICE_SIZE));
    }
    return str;
  }
  var AtomicString =
  function (_Atomic) {
    _inherits(AtomicString, _Atomic);
    function AtomicString(value) {
      _classCallCheck(this, AtomicString);
      if (value && !isString(value)) {
        throw new Error('OSC AtomicString constructor expects value of type string');
      }
      return _possibleConstructorReturn(this, _getPrototypeOf(AtomicString).call(this, value));
    }
    _createClass(AtomicString, [{
      key: "pack",
      value: function pack() {
        if (isUndefined(this.value)) {
          throw new Error('OSC AtomicString can not be encoded with empty value');
        }
        var terminated = "".concat(this.value, "\0");
        var byteLength = pad(terminated.length);
        var buffer = new Uint8Array(byteLength);
        for (var i = 0; i < terminated.length; i += 1) {
          buffer[i] = terminated.charCodeAt(i);
        }
        return buffer;
      }
    }, {
      key: "unpack",
      value: function unpack(dataView) {
        var initialOffset = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
        if (!(dataView instanceof DataView)) {
          throw new Error('OSC AtomicString expects an instance of type DataView');
        }
        var offset = initialOffset;
        var charcode;
        var charCodes = [];
        for (; offset < dataView.byteLength; offset += 1) {
          charcode = dataView.getUint8(offset);
          if (charcode !== 0) {
            charCodes.push(charcode);
          } else {
            offset += 1;
            break;
          }
        }
        if (offset === dataView.length) {
          throw new Error('OSC AtomicString found a malformed OSC string');
        }
        this.offset = pad(offset);
        this.value = charCodesToString(charCodes);
        return this.offset;
      }
    }]);
    return AtomicString;
  }(Atomic);

  var SECONDS_70_YEARS = 2208988800;
  var TWO_POWER_32 = 4294967296;
  var Timetag =
  function () {
    function Timetag() {
      var seconds = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
      var fractions = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
      _classCallCheck(this, Timetag);
      if (!(isInt(seconds) && isInt(fractions))) {
        throw new Error('OSC Timetag constructor expects values of type integer number');
      }
      this.seconds = seconds;
      this.fractions = fractions;
    }
    _createClass(Timetag, [{
      key: "timestamp",
      value: function timestamp(milliseconds) {
        var seconds;
        if (typeof milliseconds === 'number') {
          seconds = milliseconds / 1000;
          var rounded = Math.floor(seconds);
          this.seconds = rounded + SECONDS_70_YEARS;
          this.fractions = Math.round(TWO_POWER_32 * (seconds - rounded));
          return milliseconds;
        }
        seconds = this.seconds - SECONDS_70_YEARS;
        return (seconds + Math.round(this.fractions / TWO_POWER_32)) * 1000;
      }
    }]);
    return Timetag;
  }();
  var AtomicTimetag =
  function (_Atomic) {
    _inherits(AtomicTimetag, _Atomic);
    function AtomicTimetag() {
      var value = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : Date.now();
      _classCallCheck(this, AtomicTimetag);
      var timetag = new Timetag();
      if (value instanceof Timetag) {
        timetag = value;
      } else if (isInt(value)) {
        timetag.timestamp(value);
      } else if (isDate(value)) {
        timetag.timestamp(value.getTime());
      }
      return _possibleConstructorReturn(this, _getPrototypeOf(AtomicTimetag).call(this, timetag));
    }
    _createClass(AtomicTimetag, [{
      key: "pack",
      value: function pack() {
        if (isUndefined(this.value)) {
          throw new Error('OSC AtomicTimetag can not be encoded with empty value');
        }
        var _this$value = this.value,
            seconds = _this$value.seconds,
            fractions = _this$value.fractions;
        var data = new Uint8Array(8);
        var dataView = new DataView(data.buffer);
        dataView.setInt32(0, seconds, false);
        dataView.setInt32(4, fractions, false);
        return data;
      }
    }, {
      key: "unpack",
      value: function unpack(dataView) {
        var initialOffset = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
        if (!(dataView instanceof DataView)) {
          throw new Error('OSC AtomicTimetag expects an instance of type DataView');
        }
        var seconds = dataView.getUint32(initialOffset, false);
        var fractions = dataView.getUint32(initialOffset + 4, false);
        this.value = new Timetag(seconds, fractions);
        this.offset = initialOffset + 8;
        return this.offset;
      }
    }]);
    return AtomicTimetag;
  }(Atomic);

  var AtomicBlob =
  function (_Atomic) {
    _inherits(AtomicBlob, _Atomic);
    function AtomicBlob(value) {
      _classCallCheck(this, AtomicBlob);
      if (value && !isBlob(value)) {
        throw new Error('OSC AtomicBlob constructor expects value of type Uint8Array');
      }
      return _possibleConstructorReturn(this, _getPrototypeOf(AtomicBlob).call(this, value));
    }
    _createClass(AtomicBlob, [{
      key: "pack",
      value: function pack() {
        if (isUndefined(this.value)) {
          throw new Error('OSC AtomicBlob can not be encoded with empty value');
        }
        var byteLength = pad(this.value.byteLength);
        var data = new Uint8Array(byteLength + 4);
        var dataView = new DataView(data.buffer);
        dataView.setInt32(0, this.value.byteLength, false);
        data.set(this.value, 4);
        return data;
      }
    }, {
      key: "unpack",
      value: function unpack(dataView) {
        var initialOffset = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
        if (!(dataView instanceof DataView)) {
          throw new Error('OSC AtomicBlob expects an instance of type DataView');
        }
        var byteLength = dataView.getInt32(initialOffset, false);
        this.value = new Uint8Array(dataView.buffer, initialOffset + 4, byteLength);
        this.offset = pad(initialOffset + 4 + byteLength);
        return this.offset;
      }
    }]);
    return AtomicBlob;
  }(Atomic);

  var AtomicFloat32 =
  function (_Atomic) {
    _inherits(AtomicFloat32, _Atomic);
    function AtomicFloat32(value) {
      _classCallCheck(this, AtomicFloat32);
      if (value && !isFloat(value)) {
        throw new Error('OSC AtomicFloat32 constructor expects value of type float');
      }
      return _possibleConstructorReturn(this, _getPrototypeOf(AtomicFloat32).call(this, value));
    }
    _createClass(AtomicFloat32, [{
      key: "pack",
      value: function pack() {
        return _get(_getPrototypeOf(AtomicFloat32.prototype), "pack", this).call(this, 'setFloat32', 4);
      }
    }, {
      key: "unpack",
      value: function unpack(dataView) {
        var initialOffset = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
        return _get(_getPrototypeOf(AtomicFloat32.prototype), "unpack", this).call(this, dataView, 'getFloat32', 4, initialOffset);
      }
    }]);
    return AtomicFloat32;
  }(Atomic);

  var Message =
  function () {
    function Message() {
      _classCallCheck(this, Message);
      this.offset = 0;
      this.address = '';
      this.types = '';
      this.args = [];
      for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }
      if (args.length > 0) {
        if (!(isString(args[0]) || isArray(args[0]))) {
          throw new Error('OSC Message constructor first argument (address) must be a string or array');
        }
        this.address = prepareAddress(args.shift());
        this.types = args.map(function (item) {
          return typeTag(item);
        }).join('');
        this.args = args;
      }
    }
    _createClass(Message, [{
      key: "add",
      value: function add(item) {
        if (isUndefined(item)) {
          throw new Error('OSC Message needs a valid OSC Atomic Data Type');
        }
        this.args.push(item);
        this.types += typeTag(item);
      }
    }, {
      key: "pack",
      value: function pack() {
        if (this.address.length === 0 || this.address[0] !== '/') {
          throw new Error('OSC Message has an invalid address');
        }
        var encoder = new EncodeHelper();
        encoder.add(new AtomicString(this.address));
        encoder.add(new AtomicString(",".concat(this.types)));
        if (this.args.length > 0) {
          var argument;
          this.args.forEach(function (value) {
            if (isInt(value)) {
              argument = new AtomicInt32(value);
            } else if (isFloat(value)) {
              argument = new AtomicFloat32(value);
            } else if (isString(value)) {
              argument = new AtomicString(value);
            } else if (isBlob(value)) {
              argument = new AtomicBlob(value);
            } else {
              throw new Error('OSC Message found unknown argument type');
            }
            encoder.add(argument);
          });
        }
        return encoder.merge();
      }
    }, {
      key: "unpack",
      value: function unpack(dataView) {
        var initialOffset = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
        if (!(dataView instanceof DataView)) {
          throw new Error('OSC Message expects an instance of type DataView.');
        }
        var address = new AtomicString();
        address.unpack(dataView, initialOffset);
        var types = new AtomicString();
        types.unpack(dataView, address.offset);
        if (address.value.length === 0 || address.value[0] !== '/') {
          throw new Error('OSC Message found malformed or missing address string');
        }
        if (types.value.length === 0 && types.value[0] !== ',') {
          throw new Error('OSC Message found malformed or missing type string');
        }
        var offset = types.offset;
        var next;
        var type;
        var args = [];
        for (var i = 1; i < types.value.length; i += 1) {
          type = types.value[i];
          if (type === 'i') {
            next = new AtomicInt32();
          } else if (type === 'f') {
            next = new AtomicFloat32();
          } else if (type === 's') {
            next = new AtomicString();
          } else if (type === 'b') {
            next = new AtomicBlob();
          } else {
            throw new Error('OSC Message found non-standard argument type');
          }
          offset = next.unpack(dataView, offset);
          args.push(next.value);
        }
        this.offset = offset;
        this.address = address.value;
        this.types = types.value;
        this.args = args;
        return this.offset;
      }
    }]);
    return Message;
  }();

  var BUNDLE_TAG = '#bundle';
  var Bundle =
  function () {
    function Bundle() {
      var _this = this;
      _classCallCheck(this, Bundle);
      this.offset = 0;
      this.timetag = new AtomicTimetag();
      this.bundleElements = [];
      for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }
      if (args.length > 0) {
        if (args[0] instanceof Date || isInt(args[0])) {
          this.timetag = new AtomicTimetag(args[0]);
        } else if (isArray(args[0])) {
          args[0].forEach(function (item) {
            _this.add(item);
          });
          if (args.length > 1 && (args[1] instanceof Date || isInt(args[0]))) {
            this.timetag = new AtomicTimetag(args[1]);
          }
        } else {
          args.forEach(function (item) {
            _this.add(item);
          });
        }
      }
    }
    _createClass(Bundle, [{
      key: "timestamp",
      value: function timestamp(ms) {
        if (!isInt(ms)) {
          throw new Error('OSC Bundle needs an integer for setting the timestamp');
        }
        this.timetag = new AtomicTimetag(ms);
      }
    }, {
      key: "add",
      value: function add(item) {
        if (!(item instanceof Message || item instanceof Bundle)) {
          throw new Error('OSC Bundle contains only Messages and Bundles');
        }
        this.bundleElements.push(item);
      }
    }, {
      key: "pack",
      value: function pack() {
        var encoder = new EncodeHelper();
        encoder.add(new AtomicString(BUNDLE_TAG));
        if (!this.timetag) {
          this.timetag = new AtomicTimetag();
        }
        encoder.add(this.timetag);
        this.bundleElements.forEach(function (item) {
          encoder.add(new AtomicInt32(item.pack().byteLength));
          encoder.add(item);
        });
        return encoder.merge();
      }
    }, {
      key: "unpack",
      value: function unpack(dataView) {
        var initialOffset = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
        if (!(dataView instanceof DataView)) {
          throw new Error('OSC Bundle expects an instance of type DataView');
        }
        var parentHead = new AtomicString();
        parentHead.unpack(dataView, initialOffset);
        if (parentHead.value !== BUNDLE_TAG) {
          throw new Error('OSC Bundle does not contain a valid #bundle head');
        }
        var timetag = new AtomicTimetag();
        var offset = timetag.unpack(dataView, parentHead.offset);
        this.bundleElements = [];
        while (offset < dataView.byteLength) {
          var head = new AtomicString();
          var size = new AtomicInt32();
          offset = size.unpack(dataView, offset);
          var item = void 0;
          head.unpack(dataView, offset);
          if (head.value === BUNDLE_TAG) {
            item = new Bundle();
          } else {
            item = new Message();
          }
          offset = item.unpack(dataView, offset);
          this.bundleElements.push(item);
        }
        this.offset = offset;
        this.timetag = timetag;
        return this.offset;
      }
    }]);
    return Bundle;
  }();

  var Packet =
  function () {
    function Packet(value) {
      _classCallCheck(this, Packet);
      if (value && !(value instanceof Message || value instanceof Bundle)) {
        throw new Error('OSC Packet value has to be Message or Bundle');
      }
      this.value = value;
      this.offset = 0;
    }
    _createClass(Packet, [{
      key: "pack",
      value: function pack() {
        if (!this.value) {
          throw new Error('OSC Packet can not be encoded with empty body');
        }
        return this.value.pack();
      }
    }, {
      key: "unpack",
      value: function unpack(dataView) {
        var initialOffset = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
        if (!(dataView instanceof DataView)) {
          throw new Error('OSC Packet expects an instance of type DataView');
        }
        if (dataView.byteLength % 4 !== 0) {
          throw new Error('OSC Packet byteLength has to be a multiple of four');
        }
        var head = new AtomicString();
        head.unpack(dataView, initialOffset);
        var item;
        if (head.value === BUNDLE_TAG) {
          item = new Bundle();
        } else {
          item = new Message();
        }
        item.unpack(dataView, initialOffset);
        this.offset = item.offset;
        this.value = item;
        return this.offset;
      }
    }]);
    return Packet;
  }();

  var defaultOptions = {
    discardLateMessages: false
  };
  var EventHandler =
  function () {
    function EventHandler(options) {
      _classCallCheck(this, EventHandler);
      this.options = _objectSpread2({}, defaultOptions, {}, options);
      this.addressHandlers = [];
      this.eventHandlers = {
        open: [],
        error: [],
        close: []
      };
      this.uuid = 0;
    }
    _createClass(EventHandler, [{
      key: "dispatch",
      value: function dispatch(packet, rinfo) {
        var _this = this;
        if (!(packet instanceof Packet)) {
          throw new Error('OSC EventHander dispatch() accepts only arguments of type Packet');
        }
        if (!packet.value) {
          throw new Error('OSC EventHander dispatch() can\'t read empty Packets');
        }
        if (packet.value instanceof Bundle) {
          var bundle = packet.value;
          return bundle.bundleElements.forEach(function (bundleItem) {
            if (bundleItem instanceof Bundle) {
              if (bundle.timetag.value.timestamp() < bundleItem.timetag.value.timestamp()) {
                throw new Error('OSC Bundle timestamp is older than the timestamp of enclosed Bundles');
              }
              return _this.dispatch(bundleItem);
            } else if (bundleItem instanceof Message) {
              var message = bundleItem;
              return _this.notify(message.address, message, bundle.timetag.value.timestamp(), rinfo);
            }
            throw new Error('OSC EventHander dispatch() can\'t dispatch unknown Packet value');
          });
        } else if (packet.value instanceof Message) {
          var message = packet.value;
          return this.notify(message.address, message, 0, rinfo);
        }
        throw new Error('OSC EventHander dispatch() can\'t dispatch unknown Packet value');
      }
    }, {
      key: "call",
      value: function call(name, data, rinfo) {
        var success = false;
        if (isString(name) && name in this.eventHandlers) {
          this.eventHandlers[name].forEach(function (handler) {
            handler.callback(data, rinfo);
            success = true;
          });
          return success;
        }
        var handlerKeys = Object.keys(this.addressHandlers);
        var handlers = this.addressHandlers;
        handlerKeys.forEach(function (key) {
          var foundMatch = false;
          var regex = new RegExp(prepareRegExPattern(prepareAddress(name)), 'g');
          var test = regex.test(key);
          if (test && key.length === regex.lastIndex) {
            foundMatch = true;
          }
          if (!foundMatch) {
            var reverseRegex = new RegExp(prepareRegExPattern(prepareAddress(key)), 'g');
            var reverseTest = reverseRegex.test(name);
            if (reverseTest && name.length === reverseRegex.lastIndex) {
              foundMatch = true;
            }
          }
          if (foundMatch) {
            handlers[key].forEach(function (handler) {
              handler.callback(data, rinfo);
              success = true;
            });
          }
        });
        return success;
      }
    }, {
      key: "notify",
      value: function notify() {
        for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
          args[_key] = arguments[_key];
        }
        if (args.length === 0) {
          throw new Error('OSC EventHandler can not be called without any argument');
        }
        if (args[0] instanceof Packet) {
          return this.dispatch(args[0], args[1]);
        } else if (args[0] instanceof Bundle || args[0] instanceof Message) {
          return this.dispatch(new Packet(args[0]), args[1]);
        } else if (!isString(args[0])) {
          var packet = new Packet();
          packet.unpack(dataView(args[0]));
          return this.dispatch(packet, args[1]);
        }
        var name = args[0];
        var data = null;
        if (args.length > 1) {
          data = args[1];
        }
        var timestamp = null;
        if (args.length > 2) {
          if (isInt(args[2])) {
            timestamp = args[2];
          } else if (args[2] instanceof Date) {
            timestamp = args[2].getTime();
          } else {
            throw new Error('OSC EventHandler timestamp has to be a number or Date');
          }
        }
        var rinfo = null;
        if (args.length >= 3) {
          rinfo = args[3];
        }
        if (timestamp) {
          var now = Date.now();
          if (now > timestamp) {
            if (!this.options.discardLateMessages) {
              return this.call(name, data, rinfo);
            }
          }
          var that = this;
          setTimeout(function () {
            that.call(name, data, rinfo);
          }, timestamp - now);
          return true;
        }
        return this.call(name, data, rinfo);
      }
    }, {
      key: "on",
      value: function on(name, callback) {
        if (!(isString(name) || isArray(name))) {
          throw new Error('OSC EventHandler accepts only strings or arrays for address patterns');
        }
        if (!isFunction(callback)) {
          throw new Error('OSC EventHandler callback has to be a function');
        }
        this.uuid += 1;
        var handler = {
          id: this.uuid,
          callback: callback
        };
        if (isString(name) && name in this.eventHandlers) {
          this.eventHandlers[name].push(handler);
          return this.uuid;
        }
        var address = prepareAddress(name);
        if (!(address in this.addressHandlers)) {
          this.addressHandlers[address] = [];
        }
        this.addressHandlers[address].push(handler);
        return this.uuid;
      }
    }, {
      key: "off",
      value: function off(name, subscriptionId) {
        if (!(isString(name) || isArray(name))) {
          throw new Error('OSC EventHandler accepts only strings or arrays for address patterns');
        }
        if (!isInt(subscriptionId)) {
          throw new Error('OSC EventHandler subscription id has to be a number');
        }
        var key;
        var haystack;
        if (isString(name) && name in this.eventHandlers) {
          key = name;
          haystack = this.eventHandlers;
        } else {
          key = prepareAddress(name);
          haystack = this.addressHandlers;
        }
        if (key in haystack) {
          return haystack[key].some(function (item, index) {
            if (item.id === subscriptionId) {
              haystack[key].splice(index, 1);
              return true;
            }
            return false;
          });
        }
        return false;
      }
    }]);
    return EventHandler;
  }();

  var dgram = typeof __dirname !== 'undefined' ? __webpack_require__(200) : undefined;
  var STATUS = {
    IS_NOT_INITIALIZED: -1,
    IS_CONNECTING: 0,
    IS_OPEN: 1,
    IS_CLOSING: 2,
    IS_CLOSED: 3
  };
  var defaultOpenOptions = {
    host: 'localhost',
    port: 41234,
    exclusive: false
  };
  var defaultSendOptions = {
    host: 'localhost',
    port: 41235
  };
  var defaultOptions$1 = {
    type: 'udp4',
    open: defaultOpenOptions,
    send: defaultSendOptions
  };
  function mergeOptions(base, custom) {
    return _objectSpread2({}, defaultOptions$1, {}, base, {}, custom, {
      open: _objectSpread2({}, defaultOptions$1.open, {}, base.open, {}, custom.open),
      send: _objectSpread2({}, defaultOptions$1.send, {}, base.send, {}, custom.send)
    });
  }
  var DatagramPlugin =
  function () {
    function DatagramPlugin() {
      var _this = this;
      var customOptions = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
      _classCallCheck(this, DatagramPlugin);
      if (!dgram) {
        throw new Error('DatagramPlugin can not be used in browser context');
      }
      this.options = mergeOptions({}, customOptions);
      this.socket = dgram.createSocket(this.options.type);
      this.socketStatus = STATUS.IS_NOT_INITIALIZED;
      this.socket.on('message', function (message, rinfo) {
        _this.notify(message, rinfo);
      });
      this.socket.on('error', function (error) {
        _this.notify('error', error);
      });
      this.notify = function () {};
    }
    _createClass(DatagramPlugin, [{
      key: "registerNotify",
      value: function registerNotify(fn) {
        this.notify = fn;
      }
    }, {
      key: "status",
      value: function status() {
        return this.socketStatus;
      }
    }, {
      key: "open",
      value: function open() {
        var _this2 = this;
        var customOptions = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
        var options = _objectSpread2({}, this.options.open, {}, customOptions);
        var port = options.port,
            exclusive = options.exclusive;
        this.socketStatus = STATUS.IS_CONNECTING;
        this.socket.bind({
          address: options.host,
          port: port,
          exclusive: exclusive
        }, function () {
          _this2.socketStatus = STATUS.IS_OPEN;
          _this2.notify('open');
        });
      }
    }, {
      key: "close",
      value: function close() {
        var _this3 = this;
        this.socketStatus = STATUS.IS_CLOSING;
        this.socket.close(function () {
          _this3.socketStatus = STATUS.IS_CLOSED;
          _this3.notify('close');
        });
      }
    }, {
      key: "send",
      value: function send(binary) {
        var customOptions = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
        var options = _objectSpread2({}, this.options.send, {}, customOptions);
        var port = options.port,
            host = options.host;
        this.socket.send(Buffer.from(binary), 0, binary.byteLength, port, host);
      }
    }]);
    return DatagramPlugin;
  }();

  var dgram$1 = typeof __dirname !== 'undefined' ? __webpack_require__(200) : undefined;
  var WebSocketServer = typeof __dirname !== 'undefined' ? __webpack_require__(723).Server : undefined;
  var STATUS$1 = {
    IS_NOT_INITIALIZED: -1,
    IS_CONNECTING: 0,
    IS_OPEN: 1,
    IS_CLOSING: 2,
    IS_CLOSED: 3
  };
  var defaultOptions$2 = {
    udpServer: {
      host: 'localhost',
      port: 41234,
      exclusive: false
    },
    udpClient: {
      host: 'localhost',
      port: 41235
    },
    wsServer: {
      host: 'localhost',
      port: 8080
    },
    receiver: 'ws'
  };
  function mergeOptions$1(base, custom) {
    return _objectSpread2({}, defaultOptions$2, {}, base, {}, custom, {
      udpServer: _objectSpread2({}, defaultOptions$2.udpServer, {}, base.udpServer, {}, custom.udpServer),
      udpClient: _objectSpread2({}, defaultOptions$2.udpClient, {}, base.udpClient, {}, custom.udpClient),
      wsServer: _objectSpread2({}, defaultOptions$2.wsServer, {}, base.wsServer, {}, custom.wsServer)
    });
  }
  var BridgePlugin =
  function () {
    function BridgePlugin() {
      var _this = this;
      var customOptions = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
      _classCallCheck(this, BridgePlugin);
      if (!dgram$1 || !WebSocketServer) {
        throw new Error('BridgePlugin can not be used in browser context');
      }
      this.options = mergeOptions$1({}, customOptions);
      this.websocket = null;
      this.socket = dgram$1.createSocket('udp4');
      this.socketStatus = STATUS$1.IS_NOT_INITIALIZED;
      this.socket.on('message', function (message) {
        _this.send(message, {
          receiver: 'ws'
        });
        _this.notify(message.buffer);
      });
      this.socket.on('error', function (error) {
        _this.notify('error', error);
      });
      this.notify = function () {};
    }
    _createClass(BridgePlugin, [{
      key: "registerNotify",
      value: function registerNotify(fn) {
        this.notify = fn;
      }
    }, {
      key: "status",
      value: function status() {
        return this.socketStatus;
      }
    }, {
      key: "open",
      value: function open() {
        var _this2 = this;
        var customOptions = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
        var options = mergeOptions$1(this.options, customOptions);
        this.socketStatus = STATUS$1.IS_CONNECTING;
        this.socket.bind({
          address: options.udpServer.host,
          port: options.udpServer.port,
          exclusive: options.udpServer.exclusive
        }, function () {
          _this2.websocket = new WebSocketServer({
            host: options.wsServer.host,
            port: options.wsServer.port
          });
          _this2.websocket.binaryType = 'arraybuffer';
          _this2.websocket.on('listening', function () {
            _this2.socketStatus = STATUS$1.IS_OPEN;
            _this2.notify('open');
          });
          _this2.websocket.on('error', function (error) {
            _this2.notify('error', error);
          });
          _this2.websocket.on('connection', function (client) {
            client.on('message', function (message, rinfo) {
              _this2.send(message, {
                receiver: 'udp'
              });
              _this2.notify(new Uint8Array(message), rinfo);
            });
          });
        });
      }
    }, {
      key: "close",
      value: function close() {
        var _this3 = this;
        this.socketStatus = STATUS$1.IS_CLOSING;
        this.socket.close(function () {
          _this3.websocket.close(function () {
            _this3.socketStatus = STATUS$1.IS_CLOSED;
            _this3.notify('close');
          });
        });
      }
    }, {
      key: "send",
      value: function send(binary) {
        var customOptions = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
        var options = mergeOptions$1(this.options, customOptions);
        var receiver = options.receiver;
        if (receiver === 'udp') {
          var data = binary instanceof Buffer ? binary : Buffer.from(binary);
          this.socket.send(data, 0, data.byteLength, options.udpClient.port, options.udpClient.host);
        } else if (receiver === 'ws') {
          this.websocket.clients.forEach(function (client) {
            client.send(binary, {
              binary: true
            });
          });
        } else {
          throw new Error('BridgePlugin can not send message to unknown receiver');
        }
      }
    }]);
    return BridgePlugin;
  }();

  var scope = typeof global === 'undefined' ? window : global;
  var WebSocket = typeof __dirname === 'undefined' ? scope.WebSocket : __webpack_require__(723);
  var STATUS$2 = {
    IS_NOT_INITIALIZED: -1,
    IS_CONNECTING: 0,
    IS_OPEN: 1,
    IS_CLOSING: 2,
    IS_CLOSED: 3
  };
  var defaultOptions$3 = {
    host: 'localhost',
    port: 8080,
    secure: false
  };
  var WebsocketClientPlugin =
  function () {
    function WebsocketClientPlugin(customOptions) {
      _classCallCheck(this, WebsocketClientPlugin);
      if (!WebSocket) {
        throw new Error('WebsocketClientPlugin can\'t find a WebSocket class');
      }
      this.options = _objectSpread2({}, defaultOptions$3, {}, customOptions);
      this.socket = null;
      this.socketStatus = STATUS$2.IS_NOT_INITIALIZED;
      this.notify = function () {};
    }
    _createClass(WebsocketClientPlugin, [{
      key: "registerNotify",
      value: function registerNotify(fn) {
        this.notify = fn;
      }
    }, {
      key: "status",
      value: function status() {
        return this.socketStatus;
      }
    }, {
      key: "open",
      value: function open() {
        var _this = this;
        var customOptions = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
        var options = _objectSpread2({}, this.options, {}, customOptions);
        var port = options.port,
            host = options.host,
            secure = options.secure;
        if (this.socket) {
          this.close();
        }
        var protocol = secure ? 'wss' : 'ws';
        var rinfo = {
          address: host,
          family: protocol,
          port: port,
          size: 0
        };
        this.socket = new WebSocket("".concat(protocol, "://").concat(host, ":").concat(port));
        this.socket.binaryType = 'arraybuffer';
        this.socketStatus = STATUS$2.IS_CONNECTING;
        this.socket.onopen = function () {
          _this.socketStatus = STATUS$2.IS_OPEN;
          _this.notify('open');
        };
        this.socket.onclose = function () {
          _this.socketStatus = STATUS$2.IS_CLOSED;
          _this.notify('close');
        };
        this.socket.onerror = function (error) {
          _this.notify('error', error);
        };
        this.socket.onmessage = function (message) {
          _this.notify(message.data, rinfo);
        };
      }
    }, {
      key: "close",
      value: function close() {
        this.socketStatus = STATUS$2.IS_CLOSING;
        this.socket.close();
      }
    }, {
      key: "send",
      value: function send(binary) {
        this.socket.send(binary);
      }
    }]);
    return WebsocketClientPlugin;
  }();

  var WebSocketServer$1 = typeof __dirname !== 'undefined' ? __webpack_require__(723).Server : undefined;
  var STATUS$3 = {
    IS_NOT_INITIALIZED: -1,
    IS_CONNECTING: 0,
    IS_OPEN: 1,
    IS_CLOSING: 2,
    IS_CLOSED: 3
  };
  var defaultOptions$4 = {
    host: 'localhost',
    port: 8080
  };
  var WebsocketServerPlugin =
  function () {
    function WebsocketServerPlugin(customOptions) {
      _classCallCheck(this, WebsocketServerPlugin);
      if (!WebSocketServer$1) {
        throw new Error('WebsocketServerPlugin can not be used in browser context');
      }
      this.options = _objectSpread2({}, defaultOptions$4, {}, customOptions);
      this.socket = null;
      this.socketStatus = STATUS$3.IS_NOT_INITIALIZED;
      this.notify = function () {};
    }
    _createClass(WebsocketServerPlugin, [{
      key: "registerNotify",
      value: function registerNotify(fn) {
        this.notify = fn;
      }
    }, {
      key: "status",
      value: function status() {
        return this.socketStatus;
      }
    }, {
      key: "open",
      value: function open() {
        var _this = this;
        var customOptions = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
        var options = _objectSpread2({}, this.options, {}, customOptions);
        var port = options.port,
            host = options.host;
        var rinfo = {
          address: host,
          family: 'wsserver',
          port: port,
          size: 0
        };
        if (this.socket) {
          this.close();
        }
        this.socket = new WebSocketServer$1({
          host: host,
          port: port
        });
        this.socket.binaryType = 'arraybuffer';
        this.socketStatus = STATUS$3.IS_CONNECTING;
        this.socket.on('listening', function () {
          _this.socketStatus = STATUS$3.IS_OPEN;
          _this.notify('open');
        });
        this.socket.on('error', function (error) {
          _this.notify('error', error);
        });
        this.socket.on('connection', function (client) {
          client.on('message', function (message) {
            _this.notify(new Uint8Array(message), rinfo);
          });
        });
      }
    }, {
      key: "close",
      value: function close() {
        var _this2 = this;
        this.socketStatus = STATUS$3.IS_CLOSING;
        this.socket.close(function () {
          _this2.socketStatus = STATUS$3.IS_CLOSED;
          _this2.notify('close');
        });
      }
    }, {
      key: "send",
      value: function send(binary) {
        this.socket.clients.forEach(function (client) {
          client.send(binary, {
            binary: true
          });
        });
      }
    }]);
    return WebsocketServerPlugin;
  }();

  var defaultOptions$5 = {
    discardLateMessages: false,
    plugin: new WebsocketClientPlugin()
  };
  var STATUS$4 = {
    IS_NOT_INITIALIZED: -1,
    IS_CONNECTING: 0,
    IS_OPEN: 1,
    IS_CLOSING: 2,
    IS_CLOSED: 3
  };
  var OSC =
  function () {
    function OSC(options) {
      _classCallCheck(this, OSC);
      if (options && !isObject(options)) {
        throw new Error('OSC options argument has to be an object.');
      }
      this.options = _objectSpread2({}, defaultOptions$5, {}, options);
      this.eventHandler = new EventHandler({
        discardLateMessages: this.options.discardLateMessages
      });
      var eventHandler = this.eventHandler;
      if (this.options.plugin && this.options.plugin.registerNotify) {
        this.options.plugin.registerNotify(function () {
          return eventHandler.notify.apply(eventHandler, arguments);
        });
      }
    }
    _createClass(OSC, [{
      key: "on",
      value: function on(eventName, callback) {
        if (!(isString(eventName) && isFunction(callback))) {
          throw new Error('OSC on() needs event- or address string and callback function');
        }
        return this.eventHandler.on(eventName, callback);
      }
    }, {
      key: "off",
      value: function off(eventName, subscriptionId) {
        if (!(isString(eventName) && isInt(subscriptionId))) {
          throw new Error('OSC off() needs string and number (subscriptionId) to unsubscribe');
        }
        return this.eventHandler.off(eventName, subscriptionId);
      }
    }, {
      key: "open",
      value: function open(options) {
        if (options && !isObject(options)) {
          throw new Error('OSC open() options argument needs to be an object');
        }
        if (!(this.options.plugin && isFunction(this.options.plugin.open))) {
          throw new Error('OSC Plugin API #open is not implemented!');
        }
        return this.options.plugin.open(options);
      }
    }, {
      key: "status",
      value: function status() {
        if (!(this.options.plugin && isFunction(this.options.plugin.status))) {
          throw new Error('OSC Plugin API #status is not implemented!');
        }
        return this.options.plugin.status();
      }
    }, {
      key: "close",
      value: function close() {
        if (!(this.options.plugin && isFunction(this.options.plugin.close))) {
          throw new Error('OSC Plugin API #close is not implemented!');
        }
        return this.options.plugin.close();
      }
    }, {
      key: "send",
      value: function send(packet, options) {
        if (!(this.options.plugin && isFunction(this.options.plugin.send))) {
          throw new Error('OSC Plugin API #send is not implemented!');
        }
        if (!(packet instanceof Message || packet instanceof Bundle || packet instanceof Packet)) {
          throw new Error('OSC send() needs Messages, Bundles or Packets');
        }
        if (options && !isObject(options)) {
          throw new Error('OSC send() options argument has to be an object');
        }
        return this.options.plugin.send(packet.pack(), options);
      }
    }]);
    return OSC;
  }();
  OSC.STATUS = STATUS$4;
  OSC.Packet = Packet;
  OSC.Bundle = Bundle;
  OSC.Message = Message;
  OSC.DatagramPlugin = DatagramPlugin;
  OSC.WebsocketClientPlugin = WebsocketClientPlugin;
  OSC.WebsocketServerPlugin = WebsocketServerPlugin;
  OSC.BridgePlugin = BridgePlugin;

  return OSC;

})));


/***/ }),

/***/ 235:
/***/ (function() {

eval("require")("utf-8-validate");


/***/ }),

/***/ 237:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";


const WebSocket = __webpack_require__(21);

WebSocket.createWebSocketStream = __webpack_require__(948);
WebSocket.Server = __webpack_require__(613);
WebSocket.Receiver = __webpack_require__(312);
WebSocket.Sender = __webpack_require__(10);

module.exports = WebSocket;


/***/ }),

/***/ 301:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";


const zlib = __webpack_require__(761);

const bufferUtil = __webpack_require__(349);
const Limiter = __webpack_require__(664);
const { kStatusCode, NOOP } = __webpack_require__(799);

const TRAILER = Buffer.from([0x00, 0x00, 0xff, 0xff]);
const kPerMessageDeflate = Symbol('permessage-deflate');
const kTotalLength = Symbol('total-length');
const kCallback = Symbol('callback');
const kBuffers = Symbol('buffers');
const kError = Symbol('error');

//
// We limit zlib concurrency, which prevents severe memory fragmentation
// as documented in https://github.com/nodejs/node/issues/8871#issuecomment-250915913
// and https://github.com/websockets/ws/issues/1202
//
// Intentionally global; it's the global thread pool that's an issue.
//
let zlibLimiter;

/**
 * permessage-deflate implementation.
 */
class PerMessageDeflate {
  /**
   * Creates a PerMessageDeflate instance.
   *
   * @param {Object} options Configuration options
   * @param {Boolean} options.serverNoContextTakeover Request/accept disabling
   *     of server context takeover
   * @param {Boolean} options.clientNoContextTakeover Advertise/acknowledge
   *     disabling of client context takeover
   * @param {(Boolean|Number)} options.serverMaxWindowBits Request/confirm the
   *     use of a custom server window size
   * @param {(Boolean|Number)} options.clientMaxWindowBits Advertise support
   *     for, or request, a custom client window size
   * @param {Object} options.zlibDeflateOptions Options to pass to zlib on deflate
   * @param {Object} options.zlibInflateOptions Options to pass to zlib on inflate
   * @param {Number} options.threshold Size (in bytes) below which messages
   *     should not be compressed
   * @param {Number} options.concurrencyLimit The number of concurrent calls to
   *     zlib
   * @param {Boolean} isServer Create the instance in either server or client
   *     mode
   * @param {Number} maxPayload The maximum allowed message length
   */
  constructor(options, isServer, maxPayload) {
    this._maxPayload = maxPayload | 0;
    this._options = options || {};
    this._threshold =
      this._options.threshold !== undefined ? this._options.threshold : 1024;
    this._isServer = !!isServer;
    this._deflate = null;
    this._inflate = null;

    this.params = null;

    if (!zlibLimiter) {
      const concurrency =
        this._options.concurrencyLimit !== undefined
          ? this._options.concurrencyLimit
          : 10;
      zlibLimiter = new Limiter(concurrency);
    }
  }

  /**
   * @type {String}
   */
  static get extensionName() {
    return 'permessage-deflate';
  }

  /**
   * Create an extension negotiation offer.
   *
   * @return {Object} Extension parameters
   * @public
   */
  offer() {
    const params = {};

    if (this._options.serverNoContextTakeover) {
      params.server_no_context_takeover = true;
    }
    if (this._options.clientNoContextTakeover) {
      params.client_no_context_takeover = true;
    }
    if (this._options.serverMaxWindowBits) {
      params.server_max_window_bits = this._options.serverMaxWindowBits;
    }
    if (this._options.clientMaxWindowBits) {
      params.client_max_window_bits = this._options.clientMaxWindowBits;
    } else if (this._options.clientMaxWindowBits == null) {
      params.client_max_window_bits = true;
    }

    return params;
  }

  /**
   * Accept an extension negotiation offer/response.
   *
   * @param {Array} configurations The extension negotiation offers/reponse
   * @return {Object} Accepted configuration
   * @public
   */
  accept(configurations) {
    configurations = this.normalizeParams(configurations);

    this.params = this._isServer
      ? this.acceptAsServer(configurations)
      : this.acceptAsClient(configurations);

    return this.params;
  }

  /**
   * Releases all resources used by the extension.
   *
   * @public
   */
  cleanup() {
    if (this._inflate) {
      this._inflate.close();
      this._inflate = null;
    }

    if (this._deflate) {
      const callback = this._deflate[kCallback];

      this._deflate.close();
      this._deflate = null;

      if (callback) {
        callback(
          new Error(
            'The deflate stream was closed while data was being processed'
          )
        );
      }
    }
  }

  /**
   *  Accept an extension negotiation offer.
   *
   * @param {Array} offers The extension negotiation offers
   * @return {Object} Accepted configuration
   * @private
   */
  acceptAsServer(offers) {
    const opts = this._options;
    const accepted = offers.find((params) => {
      if (
        (opts.serverNoContextTakeover === false &&
          params.server_no_context_takeover) ||
        (params.server_max_window_bits &&
          (opts.serverMaxWindowBits === false ||
            (typeof opts.serverMaxWindowBits === 'number' &&
              opts.serverMaxWindowBits > params.server_max_window_bits))) ||
        (typeof opts.clientMaxWindowBits === 'number' &&
          !params.client_max_window_bits)
      ) {
        return false;
      }

      return true;
    });

    if (!accepted) {
      throw new Error('None of the extension offers can be accepted');
    }

    if (opts.serverNoContextTakeover) {
      accepted.server_no_context_takeover = true;
    }
    if (opts.clientNoContextTakeover) {
      accepted.client_no_context_takeover = true;
    }
    if (typeof opts.serverMaxWindowBits === 'number') {
      accepted.server_max_window_bits = opts.serverMaxWindowBits;
    }
    if (typeof opts.clientMaxWindowBits === 'number') {
      accepted.client_max_window_bits = opts.clientMaxWindowBits;
    } else if (
      accepted.client_max_window_bits === true ||
      opts.clientMaxWindowBits === false
    ) {
      delete accepted.client_max_window_bits;
    }

    return accepted;
  }

  /**
   * Accept the extension negotiation response.
   *
   * @param {Array} response The extension negotiation response
   * @return {Object} Accepted configuration
   * @private
   */
  acceptAsClient(response) {
    const params = response[0];

    if (
      this._options.clientNoContextTakeover === false &&
      params.client_no_context_takeover
    ) {
      throw new Error('Unexpected parameter "client_no_context_takeover"');
    }

    if (!params.client_max_window_bits) {
      if (typeof this._options.clientMaxWindowBits === 'number') {
        params.client_max_window_bits = this._options.clientMaxWindowBits;
      }
    } else if (
      this._options.clientMaxWindowBits === false ||
      (typeof this._options.clientMaxWindowBits === 'number' &&
        params.client_max_window_bits > this._options.clientMaxWindowBits)
    ) {
      throw new Error(
        'Unexpected or invalid parameter "client_max_window_bits"'
      );
    }

    return params;
  }

  /**
   * Normalize parameters.
   *
   * @param {Array} configurations The extension negotiation offers/reponse
   * @return {Array} The offers/response with normalized parameters
   * @private
   */
  normalizeParams(configurations) {
    configurations.forEach((params) => {
      Object.keys(params).forEach((key) => {
        let value = params[key];

        if (value.length > 1) {
          throw new Error(`Parameter "${key}" must have only a single value`);
        }

        value = value[0];

        if (key === 'client_max_window_bits') {
          if (value !== true) {
            const num = +value;
            if (!Number.isInteger(num) || num < 8 || num > 15) {
              throw new TypeError(
                `Invalid value for parameter "${key}": ${value}`
              );
            }
            value = num;
          } else if (!this._isServer) {
            throw new TypeError(
              `Invalid value for parameter "${key}": ${value}`
            );
          }
        } else if (key === 'server_max_window_bits') {
          const num = +value;
          if (!Number.isInteger(num) || num < 8 || num > 15) {
            throw new TypeError(
              `Invalid value for parameter "${key}": ${value}`
            );
          }
          value = num;
        } else if (
          key === 'client_no_context_takeover' ||
          key === 'server_no_context_takeover'
        ) {
          if (value !== true) {
            throw new TypeError(
              `Invalid value for parameter "${key}": ${value}`
            );
          }
        } else {
          throw new Error(`Unknown parameter "${key}"`);
        }

        params[key] = value;
      });
    });

    return configurations;
  }

  /**
   * Decompress data. Concurrency limited.
   *
   * @param {Buffer} data Compressed data
   * @param {Boolean} fin Specifies whether or not this is the last fragment
   * @param {Function} callback Callback
   * @public
   */
  decompress(data, fin, callback) {
    zlibLimiter.add((done) => {
      this._decompress(data, fin, (err, result) => {
        done();
        callback(err, result);
      });
    });
  }

  /**
   * Compress data. Concurrency limited.
   *
   * @param {Buffer} data Data to compress
   * @param {Boolean} fin Specifies whether or not this is the last fragment
   * @param {Function} callback Callback
   * @public
   */
  compress(data, fin, callback) {
    zlibLimiter.add((done) => {
      this._compress(data, fin, (err, result) => {
        done();
        callback(err, result);
      });
    });
  }

  /**
   * Decompress data.
   *
   * @param {Buffer} data Compressed data
   * @param {Boolean} fin Specifies whether or not this is the last fragment
   * @param {Function} callback Callback
   * @private
   */
  _decompress(data, fin, callback) {
    const endpoint = this._isServer ? 'client' : 'server';

    if (!this._inflate) {
      const key = `${endpoint}_max_window_bits`;
      const windowBits =
        typeof this.params[key] !== 'number'
          ? zlib.Z_DEFAULT_WINDOWBITS
          : this.params[key];

      this._inflate = zlib.createInflateRaw({
        ...this._options.zlibInflateOptions,
        windowBits
      });
      this._inflate[kPerMessageDeflate] = this;
      this._inflate[kTotalLength] = 0;
      this._inflate[kBuffers] = [];
      this._inflate.on('error', inflateOnError);
      this._inflate.on('data', inflateOnData);
    }

    this._inflate[kCallback] = callback;

    this._inflate.write(data);
    if (fin) this._inflate.write(TRAILER);

    this._inflate.flush(() => {
      const err = this._inflate[kError];

      if (err) {
        this._inflate.close();
        this._inflate = null;
        callback(err);
        return;
      }

      const data = bufferUtil.concat(
        this._inflate[kBuffers],
        this._inflate[kTotalLength]
      );

      if (fin && this.params[`${endpoint}_no_context_takeover`]) {
        this._inflate.close();
        this._inflate = null;
      } else {
        this._inflate[kTotalLength] = 0;
        this._inflate[kBuffers] = [];
      }

      callback(null, data);
    });
  }

  /**
   * Compress data.
   *
   * @param {Buffer} data Data to compress
   * @param {Boolean} fin Specifies whether or not this is the last fragment
   * @param {Function} callback Callback
   * @private
   */
  _compress(data, fin, callback) {
    const endpoint = this._isServer ? 'server' : 'client';

    if (!this._deflate) {
      const key = `${endpoint}_max_window_bits`;
      const windowBits =
        typeof this.params[key] !== 'number'
          ? zlib.Z_DEFAULT_WINDOWBITS
          : this.params[key];

      this._deflate = zlib.createDeflateRaw({
        ...this._options.zlibDeflateOptions,
        windowBits
      });

      this._deflate[kTotalLength] = 0;
      this._deflate[kBuffers] = [];

      //
      // An `'error'` event is emitted, only on Node.js < 10.0.0, if the
      // `zlib.DeflateRaw` instance is closed while data is being processed.
      // This can happen if `PerMessageDeflate#cleanup()` is called at the wrong
      // time due to an abnormal WebSocket closure.
      //
      this._deflate.on('error', NOOP);
      this._deflate.on('data', deflateOnData);
    }

    this._deflate[kCallback] = callback;

    this._deflate.write(data);
    this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
      if (!this._deflate) {
        //
        // The deflate stream was closed while data was being processed.
        //
        return;
      }

      let data = bufferUtil.concat(
        this._deflate[kBuffers],
        this._deflate[kTotalLength]
      );

      if (fin) data = data.slice(0, data.length - 4);

      //
      // Ensure that the callback will not be called again in
      // `PerMessageDeflate#cleanup()`.
      //
      this._deflate[kCallback] = null;

      if (fin && this.params[`${endpoint}_no_context_takeover`]) {
        this._deflate.close();
        this._deflate = null;
      } else {
        this._deflate[kTotalLength] = 0;
        this._deflate[kBuffers] = [];
      }

      callback(null, data);
    });
  }
}

module.exports = PerMessageDeflate;

/**
 * The listener of the `zlib.DeflateRaw` stream `'data'` event.
 *
 * @param {Buffer} chunk A chunk of data
 * @private
 */
function deflateOnData(chunk) {
  this[kBuffers].push(chunk);
  this[kTotalLength] += chunk.length;
}

/**
 * The listener of the `zlib.InflateRaw` stream `'data'` event.
 *
 * @param {Buffer} chunk A chunk of data
 * @private
 */
function inflateOnData(chunk) {
  this[kTotalLength] += chunk.length;

  if (
    this[kPerMessageDeflate]._maxPayload < 1 ||
    this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload
  ) {
    this[kBuffers].push(chunk);
    return;
  }

  this[kError] = new RangeError('Max payload size exceeded');
  this[kError][kStatusCode] = 1009;
  this.removeListener('data', inflateOnData);
  this.reset();
}

/**
 * The listener of the `zlib.InflateRaw` stream `'error'` event.
 *
 * @param {Error} err The emitted error
 * @private
 */
function inflateOnError(err) {
  //
  // There is no need to call `Zlib#close()` as the handle is automatically
  // closed when an error is emitted.
  //
  this[kPerMessageDeflate]._inflate = null;
  err[kStatusCode] = 1007;
  this[kCallback](err);
}


/***/ }),

/***/ 312:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";


const { Writable } = __webpack_require__(413);

const PerMessageDeflate = __webpack_require__(301);
const {
  BINARY_TYPES,
  EMPTY_BUFFER,
  kStatusCode,
  kWebSocket
} = __webpack_require__(799);
const { concat, toArrayBuffer, unmask } = __webpack_require__(349);
const { isValidStatusCode, isValidUTF8 } = __webpack_require__(562);

const GET_INFO = 0;
const GET_PAYLOAD_LENGTH_16 = 1;
const GET_PAYLOAD_LENGTH_64 = 2;
const GET_MASK = 3;
const GET_DATA = 4;
const INFLATING = 5;

/**
 * HyBi Receiver implementation.
 *
 * @extends stream.Writable
 */
class Receiver extends Writable {
  /**
   * Creates a Receiver instance.
   *
   * @param {String} binaryType The type for binary data
   * @param {Object} extensions An object containing the negotiated extensions
   * @param {Boolean} isServer Specifies whether to operate in client or server
   *     mode
   * @param {Number} maxPayload The maximum allowed message length
   */
  constructor(binaryType, extensions, isServer, maxPayload) {
    super();

    this._binaryType = binaryType || BINARY_TYPES[0];
    this[kWebSocket] = undefined;
    this._extensions = extensions || {};
    this._isServer = !!isServer;
    this._maxPayload = maxPayload | 0;

    this._bufferedBytes = 0;
    this._buffers = [];

    this._compressed = false;
    this._payloadLength = 0;
    this._mask = undefined;
    this._fragmented = 0;
    this._masked = false;
    this._fin = false;
    this._opcode = 0;

    this._totalPayloadLength = 0;
    this._messageLength = 0;
    this._fragments = [];

    this._state = GET_INFO;
    this._loop = false;
  }

  /**
   * Implements `Writable.prototype._write()`.
   *
   * @param {Buffer} chunk The chunk of data to write
   * @param {String} encoding The character encoding of `chunk`
   * @param {Function} cb Callback
   */
  _write(chunk, encoding, cb) {
    if (this._opcode === 0x08 && this._state == GET_INFO) return cb();

    this._bufferedBytes += chunk.length;
    this._buffers.push(chunk);
    this.startLoop(cb);
  }

  /**
   * Consumes `n` bytes from the buffered data.
   *
   * @param {Number} n The number of bytes to consume
   * @return {Buffer} The consumed bytes
   * @private
   */
  consume(n) {
    this._bufferedBytes -= n;

    if (n === this._buffers[0].length) return this._buffers.shift();

    if (n < this._buffers[0].length) {
      const buf = this._buffers[0];
      this._buffers[0] = buf.slice(n);
      return buf.slice(0, n);
    }

    const dst = Buffer.allocUnsafe(n);

    do {
      const buf = this._buffers[0];
      const offset = dst.length - n;

      if (n >= buf.length) {
        dst.set(this._buffers.shift(), offset);
      } else {
        dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
        this._buffers[0] = buf.slice(n);
      }

      n -= buf.length;
    } while (n > 0);

    return dst;
  }

  /**
   * Starts the parsing loop.
   *
   * @param {Function} cb Callback
   * @private
   */
  startLoop(cb) {
    let err;
    this._loop = true;

    do {
      switch (this._state) {
        case GET_INFO:
          err = this.getInfo();
          break;
        case GET_PAYLOAD_LENGTH_16:
          err = this.getPayloadLength16();
          break;
        case GET_PAYLOAD_LENGTH_64:
          err = this.getPayloadLength64();
          break;
        case GET_MASK:
          this.getMask();
          break;
        case GET_DATA:
          err = this.getData(cb);
          break;
        default:
          // `INFLATING`
          this._loop = false;
          return;
      }
    } while (this._loop);

    cb(err);
  }

  /**
   * Reads the first two bytes of a frame.
   *
   * @return {(RangeError|undefined)} A possible error
   * @private
   */
  getInfo() {
    if (this._bufferedBytes < 2) {
      this._loop = false;
      return;
    }

    const buf = this.consume(2);

    if ((buf[0] & 0x30) !== 0x00) {
      this._loop = false;
      return error(RangeError, 'RSV2 and RSV3 must be clear', true, 1002);
    }

    const compressed = (buf[0] & 0x40) === 0x40;

    if (compressed && !this._extensions[PerMessageDeflate.extensionName]) {
      this._loop = false;
      return error(RangeError, 'RSV1 must be clear', true, 1002);
    }

    this._fin = (buf[0] & 0x80) === 0x80;
    this._opcode = buf[0] & 0x0f;
    this._payloadLength = buf[1] & 0x7f;

    if (this._opcode === 0x00) {
      if (compressed) {
        this._loop = false;
        return error(RangeError, 'RSV1 must be clear', true, 1002);
      }

      if (!this._fragmented) {
        this._loop = false;
        return error(RangeError, 'invalid opcode 0', true, 1002);
      }

      this._opcode = this._fragmented;
    } else if (this._opcode === 0x01 || this._opcode === 0x02) {
      if (this._fragmented) {
        this._loop = false;
        return error(RangeError, `invalid opcode ${this._opcode}`, true, 1002);
      }

      this._compressed = compressed;
    } else if (this._opcode > 0x07 && this._opcode < 0x0b) {
      if (!this._fin) {
        this._loop = false;
        return error(RangeError, 'FIN must be set', true, 1002);
      }

      if (compressed) {
        this._loop = false;
        return error(RangeError, 'RSV1 must be clear', true, 1002);
      }

      if (this._payloadLength > 0x7d) {
        this._loop = false;
        return error(
          RangeError,
          `invalid payload length ${this._payloadLength}`,
          true,
          1002
        );
      }
    } else {
      this._loop = false;
      return error(RangeError, `invalid opcode ${this._opcode}`, true, 1002);
    }

    if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
    this._masked = (buf[1] & 0x80) === 0x80;

    if (this._isServer) {
      if (!this._masked) {
        this._loop = false;
        return error(RangeError, 'MASK must be set', true, 1002);
      }
    } else if (this._masked) {
      this._loop = false;
      return error(RangeError, 'MASK must be clear', true, 1002);
    }

    if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
    else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
    else return this.haveLength();
  }

  /**
   * Gets extended payload length (7+16).
   *
   * @return {(RangeError|undefined)} A possible error
   * @private
   */
  getPayloadLength16() {
    if (this._bufferedBytes < 2) {
      this._loop = false;
      return;
    }

    this._payloadLength = this.consume(2).readUInt16BE(0);
    return this.haveLength();
  }

  /**
   * Gets extended payload length (7+64).
   *
   * @return {(RangeError|undefined)} A possible error
   * @private
   */
  getPayloadLength64() {
    if (this._bufferedBytes < 8) {
      this._loop = false;
      return;
    }

    const buf = this.consume(8);
    const num = buf.readUInt32BE(0);

    //
    // The maximum safe integer in JavaScript is 2^53 - 1. An error is returned
    // if payload length is greater than this number.
    //
    if (num > Math.pow(2, 53 - 32) - 1) {
      this._loop = false;
      return error(
        RangeError,
        'Unsupported WebSocket frame: payload length > 2^53 - 1',
        false,
        1009
      );
    }

    this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
    return this.haveLength();
  }

  /**
   * Payload length has been read.
   *
   * @return {(RangeError|undefined)} A possible error
   * @private
   */
  haveLength() {
    if (this._payloadLength && this._opcode < 0x08) {
      this._totalPayloadLength += this._payloadLength;
      if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
        this._loop = false;
        return error(RangeError, 'Max payload size exceeded', false, 1009);
      }
    }

    if (this._masked) this._state = GET_MASK;
    else this._state = GET_DATA;
  }

  /**
   * Reads mask bytes.
   *
   * @private
   */
  getMask() {
    if (this._bufferedBytes < 4) {
      this._loop = false;
      return;
    }

    this._mask = this.consume(4);
    this._state = GET_DATA;
  }

  /**
   * Reads data bytes.
   *
   * @param {Function} cb Callback
   * @return {(Error|RangeError|undefined)} A possible error
   * @private
   */
  getData(cb) {
    let data = EMPTY_BUFFER;

    if (this._payloadLength) {
      if (this._bufferedBytes < this._payloadLength) {
        this._loop = false;
        return;
      }

      data = this.consume(this._payloadLength);
      if (this._masked) unmask(data, this._mask);
    }

    if (this._opcode > 0x07) return this.controlMessage(data);

    if (this._compressed) {
      this._state = INFLATING;
      this.decompress(data, cb);
      return;
    }

    if (data.length) {
      //
      // This message is not compressed so its lenght is the sum of the payload
      // length of all fragments.
      //
      this._messageLength = this._totalPayloadLength;
      this._fragments.push(data);
    }

    return this.dataMessage();
  }

  /**
   * Decompresses data.
   *
   * @param {Buffer} data Compressed data
   * @param {Function} cb Callback
   * @private
   */
  decompress(data, cb) {
    const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];

    perMessageDeflate.decompress(data, this._fin, (err, buf) => {
      if (err) return cb(err);

      if (buf.length) {
        this._messageLength += buf.length;
        if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
          return cb(
            error(RangeError, 'Max payload size exceeded', false, 1009)
          );
        }

        this._fragments.push(buf);
      }

      const er = this.dataMessage();
      if (er) return cb(er);

      this.startLoop(cb);
    });
  }

  /**
   * Handles a data message.
   *
   * @return {(Error|undefined)} A possible error
   * @private
   */
  dataMessage() {
    if (this._fin) {
      const messageLength = this._messageLength;
      const fragments = this._fragments;

      this._totalPayloadLength = 0;
      this._messageLength = 0;
      this._fragmented = 0;
      this._fragments = [];

      if (this._opcode === 2) {
        let data;

        if (this._binaryType === 'nodebuffer') {
          data = concat(fragments, messageLength);
        } else if (this._binaryType === 'arraybuffer') {
          data = toArrayBuffer(concat(fragments, messageLength));
        } else {
          data = fragments;
        }

        this.emit('message', data);
      } else {
        const buf = concat(fragments, messageLength);

        if (!isValidUTF8(buf)) {
          this._loop = false;
          return error(Error, 'invalid UTF-8 sequence', true, 1007);
        }

        this.emit('message', buf.toString());
      }
    }

    this._state = GET_INFO;
  }

  /**
   * Handles a control message.
   *
   * @param {Buffer} data Data to handle
   * @return {(Error|RangeError|undefined)} A possible error
   * @private
   */
  controlMessage(data) {
    if (this._opcode === 0x08) {
      this._loop = false;

      if (data.length === 0) {
        this.emit('conclude', 1005, '');
        this.end();
      } else if (data.length === 1) {
        return error(RangeError, 'invalid payload length 1', true, 1002);
      } else {
        const code = data.readUInt16BE(0);

        if (!isValidStatusCode(code)) {
          return error(RangeError, `invalid status code ${code}`, true, 1002);
        }

        const buf = data.slice(2);

        if (!isValidUTF8(buf)) {
          return error(Error, 'invalid UTF-8 sequence', true, 1007);
        }

        this.emit('conclude', code, buf.toString());
        this.end();
      }
    } else if (this._opcode === 0x09) {
      this.emit('ping', data);
    } else {
      this.emit('pong', data);
    }

    this._state = GET_INFO;
  }
}

module.exports = Receiver;

/**
 * Builds an error object.
 *
 * @param {(Error|RangeError)} ErrorCtor The error constructor
 * @param {String} message The error message
 * @param {Boolean} prefix Specifies whether or not to add a default prefix to
 *     `message`
 * @param {Number} statusCode The status code
 * @return {(Error|RangeError)} The error
 * @private
 */
function error(ErrorCtor, message, prefix, statusCode) {
  const err = new ErrorCtor(
    prefix ? `Invalid WebSocket frame: ${message}` : message
  );

  Error.captureStackTrace(err, error);
  err[kStatusCode] = statusCode;
  return err;
}


/***/ }),

/***/ 330:
/***/ (function(module) {

"use strict";


//
// Allowed token characters:
//
// '!', '#', '$', '%', '&', ''', '*', '+', '-',
// '.', 0-9, A-Z, '^', '_', '`', a-z, '|', '~'
//
// tokenChars[32] === 0 // ' '
// tokenChars[33] === 1 // '!'
// tokenChars[34] === 0 // '"'
// ...
//
// prettier-ignore
const tokenChars = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 0 - 15
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 16 - 31
  0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, // 32 - 47
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, // 48 - 63
  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 64 - 79
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, // 80 - 95
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 96 - 111
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0 // 112 - 127
];

/**
 * Adds an offer to the map of extension offers or a parameter to the map of
 * parameters.
 *
 * @param {Object} dest The map of extension offers or parameters
 * @param {String} name The extension or parameter name
 * @param {(Object|Boolean|String)} elem The extension parameters or the
 *     parameter value
 * @private
 */
function push(dest, name, elem) {
  if (dest[name] === undefined) dest[name] = [elem];
  else dest[name].push(elem);
}

/**
 * Parses the `Sec-WebSocket-Extensions` header into an object.
 *
 * @param {String} header The field value of the header
 * @return {Object} The parsed object
 * @public
 */
function parse(header) {
  const offers = Object.create(null);

  if (header === undefined || header === '') return offers;

  let params = Object.create(null);
  let mustUnescape = false;
  let isEscaping = false;
  let inQuotes = false;
  let extensionName;
  let paramName;
  let start = -1;
  let end = -1;
  let i = 0;

  for (; i < header.length; i++) {
    const code = header.charCodeAt(i);

    if (extensionName === undefined) {
      if (end === -1 && tokenChars[code] === 1) {
        if (start === -1) start = i;
      } else if (code === 0x20 /* ' ' */ || code === 0x09 /* '\t' */) {
        if (end === -1 && start !== -1) end = i;
      } else if (code === 0x3b /* ';' */ || code === 0x2c /* ',' */) {
        if (start === -1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }

        if (end === -1) end = i;
        const name = header.slice(start, end);
        if (code === 0x2c) {
          push(offers, name, params);
          params = Object.create(null);
        } else {
          extensionName = name;
        }

        start = end = -1;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
    } else if (paramName === undefined) {
      if (end === -1 && tokenChars[code] === 1) {
        if (start === -1) start = i;
      } else if (code === 0x20 || code === 0x09) {
        if (end === -1 && start !== -1) end = i;
      } else if (code === 0x3b || code === 0x2c) {
        if (start === -1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }

        if (end === -1) end = i;
        push(params, header.slice(start, end), true);
        if (code === 0x2c) {
          push(offers, extensionName, params);
          params = Object.create(null);
          extensionName = undefined;
        }

        start = end = -1;
      } else if (code === 0x3d /* '=' */ && start !== -1 && end === -1) {
        paramName = header.slice(start, i);
        start = end = -1;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
    } else {
      //
      // The value of a quoted-string after unescaping must conform to the
      // token ABNF, so only token characters are valid.
      // Ref: https://tools.ietf.org/html/rfc6455#section-9.1
      //
      if (isEscaping) {
        if (tokenChars[code] !== 1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
        if (start === -1) start = i;
        else if (!mustUnescape) mustUnescape = true;
        isEscaping = false;
      } else if (inQuotes) {
        if (tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (code === 0x22 /* '"' */ && start !== -1) {
          inQuotes = false;
          end = i;
        } else if (code === 0x5c /* '\' */) {
          isEscaping = true;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      } else if (code === 0x22 && header.charCodeAt(i - 1) === 0x3d) {
        inQuotes = true;
      } else if (end === -1 && tokenChars[code] === 1) {
        if (start === -1) start = i;
      } else if (start !== -1 && (code === 0x20 || code === 0x09)) {
        if (end === -1) end = i;
      } else if (code === 0x3b || code === 0x2c) {
        if (start === -1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }

        if (end === -1) end = i;
        let value = header.slice(start, end);
        if (mustUnescape) {
          value = value.replace(/\\/g, '');
          mustUnescape = false;
        }
        push(params, paramName, value);
        if (code === 0x2c) {
          push(offers, extensionName, params);
          params = Object.create(null);
          extensionName = undefined;
        }

        paramName = undefined;
        start = end = -1;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
    }
  }

  if (start === -1 || inQuotes) {
    throw new SyntaxError('Unexpected end of input');
  }

  if (end === -1) end = i;
  const token = header.slice(start, end);
  if (extensionName === undefined) {
    push(offers, token, params);
  } else {
    if (paramName === undefined) {
      push(params, token, true);
    } else if (mustUnescape) {
      push(params, paramName, token.replace(/\\/g, ''));
    } else {
      push(params, paramName, token);
    }
    push(offers, extensionName, params);
  }

  return offers;
}

/**
 * Builds the `Sec-WebSocket-Extensions` header field value.
 *
 * @param {Object} extensions The map of extensions and parameters to format
 * @return {String} A string representing the given object
 * @public
 */
function format(extensions) {
  return Object.keys(extensions)
    .map((extension) => {
      let configurations = extensions[extension];
      if (!Array.isArray(configurations)) configurations = [configurations];
      return configurations
        .map((params) => {
          return [extension]
            .concat(
              Object.keys(params).map((k) => {
                let values = params[k];
                if (!Array.isArray(values)) values = [values];
                return values
                  .map((v) => (v === true ? k : `${k}=${v}`))
                  .join('; ');
              })
            )
            .join('; ');
        })
        .join(', ');
    })
    .join(', ');
}

module.exports = { format, parse };


/***/ }),

/***/ 349:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";


const { EMPTY_BUFFER } = __webpack_require__(799);

/**
 * Merges an array of buffers into a new buffer.
 *
 * @param {Buffer[]} list The array of buffers to concat
 * @param {Number} totalLength The total length of buffers in the list
 * @return {Buffer} The resulting buffer
 * @public
 */
function concat(list, totalLength) {
  if (list.length === 0) return EMPTY_BUFFER;
  if (list.length === 1) return list[0];

  const target = Buffer.allocUnsafe(totalLength);
  let offset = 0;

  for (let i = 0; i < list.length; i++) {
    const buf = list[i];
    target.set(buf, offset);
    offset += buf.length;
  }

  if (offset < totalLength) return target.slice(0, offset);

  return target;
}

/**
 * Masks a buffer using the given mask.
 *
 * @param {Buffer} source The buffer to mask
 * @param {Buffer} mask The mask to use
 * @param {Buffer} output The buffer where to store the result
 * @param {Number} offset The offset at which to start writing
 * @param {Number} length The number of bytes to mask.
 * @public
 */
function _mask(source, mask, output, offset, length) {
  for (let i = 0; i < length; i++) {
    output[offset + i] = source[i] ^ mask[i & 3];
  }
}

/**
 * Unmasks a buffer using the given mask.
 *
 * @param {Buffer} buffer The buffer to unmask
 * @param {Buffer} mask The mask to use
 * @public
 */
function _unmask(buffer, mask) {
  // Required until https://github.com/nodejs/node/issues/9006 is resolved.
  const length = buffer.length;
  for (let i = 0; i < length; i++) {
    buffer[i] ^= mask[i & 3];
  }
}

/**
 * Converts a buffer to an `ArrayBuffer`.
 *
 * @param {Buffer} buf The buffer to convert
 * @return {ArrayBuffer} Converted buffer
 * @public
 */
function toArrayBuffer(buf) {
  if (buf.byteLength === buf.buffer.byteLength) {
    return buf.buffer;
  }

  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/**
 * Converts `data` to a `Buffer`.
 *
 * @param {*} data The data to convert
 * @return {Buffer} The buffer
 * @throws {TypeError}
 * @public
 */
function toBuffer(data) {
  toBuffer.readOnly = true;

  if (Buffer.isBuffer(data)) return data;

  let buf;

  if (data instanceof ArrayBuffer) {
    buf = Buffer.from(data);
  } else if (ArrayBuffer.isView(data)) {
    buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  } else {
    buf = Buffer.from(data);
    toBuffer.readOnly = false;
  }

  return buf;
}

try {
  const bufferUtil = __webpack_require__(24);
  const bu = bufferUtil.BufferUtil || bufferUtil;

  module.exports = {
    concat,
    mask(source, mask, output, offset, length) {
      if (length < 48) _mask(source, mask, output, offset, length);
      else bu.mask(source, mask, output, offset, length);
    },
    toArrayBuffer,
    toBuffer,
    unmask(buffer, mask) {
      if (buffer.length < 32) _unmask(buffer, mask);
      else bu.unmask(buffer, mask);
    }
  };
} catch (e) /* istanbul ignore next */ {
  module.exports = {
    concat,
    mask: _mask,
    toArrayBuffer,
    toBuffer,
    unmask: _unmask
  };
}


/***/ }),

/***/ 413:
/***/ (function(module) {

module.exports = require("stream");

/***/ }),

/***/ 417:
/***/ (function(module) {

module.exports = require("crypto");

/***/ }),

/***/ 431:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const os = __webpack_require__(87);
/**
 * Commands
 *
 * Command Format:
 *   ##[name key=value;key=value]message
 *
 * Examples:
 *   ##[warning]This is the user warning message
 *   ##[set-secret name=mypassword]definitelyNotAPassword!
 */
function issueCommand(command, properties, message) {
    const cmd = new Command(command, properties, message);
    process.stdout.write(cmd.toString() + os.EOL);
}
exports.issueCommand = issueCommand;
function issue(name, message = '') {
    issueCommand(name, {}, message);
}
exports.issue = issue;
const CMD_STRING = '::';
class Command {
    constructor(command, properties, message) {
        if (!command) {
            command = 'missing.command';
        }
        this.command = command;
        this.properties = properties;
        this.message = message;
    }
    toString() {
        let cmdStr = CMD_STRING + this.command;
        if (this.properties && Object.keys(this.properties).length > 0) {
            cmdStr += ' ';
            for (const key in this.properties) {
                if (this.properties.hasOwnProperty(key)) {
                    const val = this.properties[key];
                    if (val) {
                        // safely append the val - avoid blowing up when attempting to
                        // call .replace() if message is not a string for some reason
                        cmdStr += `${key}=${escape(`${val || ''}`)},`;
                    }
                }
            }
        }
        cmdStr += CMD_STRING;
        // safely append the message - avoid blowing up when attempting to
        // call .replace() if message is not a string for some reason
        const message = `${this.message || ''}`;
        cmdStr += escapeData(message);
        return cmdStr;
    }
}
function escapeData(s) {
    return s.replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
function escape(s) {
    return s
        .replace(/\r/g, '%0D')
        .replace(/\n/g, '%0A')
        .replace(/]/g, '%5D')
        .replace(/;/g, '%3B');
}
//# sourceMappingURL=command.js.map

/***/ }),

/***/ 470:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";

var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const command_1 = __webpack_require__(431);
const os = __webpack_require__(87);
const path = __webpack_require__(622);
/**
 * The code to exit an action
 */
var ExitCode;
(function (ExitCode) {
    /**
     * A code indicating that the action was successful
     */
    ExitCode[ExitCode["Success"] = 0] = "Success";
    /**
     * A code indicating that the action was a failure
     */
    ExitCode[ExitCode["Failure"] = 1] = "Failure";
})(ExitCode = exports.ExitCode || (exports.ExitCode = {}));
//-----------------------------------------------------------------------
// Variables
//-----------------------------------------------------------------------
/**
 * sets env variable for this action and future actions in the job
 * @param name the name of the variable to set
 * @param val the value of the variable
 */
function exportVariable(name, val) {
    process.env[name] = val;
    command_1.issueCommand('set-env', { name }, val);
}
exports.exportVariable = exportVariable;
/**
 * exports the variable and registers a secret which will get masked from logs
 * @param name the name of the variable to set
 * @param val value of the secret
 */
function exportSecret(name, val) {
    exportVariable(name, val);
    // the runner will error with not implemented
    // leaving the function but raising the error earlier
    command_1.issueCommand('set-secret', {}, val);
    throw new Error('Not implemented.');
}
exports.exportSecret = exportSecret;
/**
 * Prepends inputPath to the PATH (for this action and future actions)
 * @param inputPath
 */
function addPath(inputPath) {
    command_1.issueCommand('add-path', {}, inputPath);
    process.env['PATH'] = `${inputPath}${path.delimiter}${process.env['PATH']}`;
}
exports.addPath = addPath;
/**
 * Gets the value of an input.  The value is also trimmed.
 *
 * @param     name     name of the input to get
 * @param     options  optional. See InputOptions.
 * @returns   string
 */
function getInput(name, options) {
    const val = process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] || '';
    if (options && options.required && !val) {
        throw new Error(`Input required and not supplied: ${name}`);
    }
    return val.trim();
}
exports.getInput = getInput;
/**
 * Sets the value of an output.
 *
 * @param     name     name of the output to set
 * @param     value    value to store
 */
function setOutput(name, value) {
    command_1.issueCommand('set-output', { name }, value);
}
exports.setOutput = setOutput;
//-----------------------------------------------------------------------
// Results
//-----------------------------------------------------------------------
/**
 * Sets the action status to failed.
 * When the action exits it will be with an exit code of 1
 * @param message add error issue message
 */
function setFailed(message) {
    process.exitCode = ExitCode.Failure;
    error(message);
}
exports.setFailed = setFailed;
//-----------------------------------------------------------------------
// Logging Commands
//-----------------------------------------------------------------------
/**
 * Writes debug message to user log
 * @param message debug message
 */
function debug(message) {
    command_1.issueCommand('debug', {}, message);
}
exports.debug = debug;
/**
 * Adds an error issue
 * @param message error issue message
 */
function error(message) {
    command_1.issue('error', message);
}
exports.error = error;
/**
 * Adds an warning issue
 * @param message warning issue message
 */
function warning(message) {
    command_1.issue('warning', message);
}
exports.warning = warning;
/**
 * Writes info to log with console.log.
 * @param message info message
 */
function info(message) {
    process.stdout.write(message + os.EOL);
}
exports.info = info;
/**
 * Begin an output group.
 *
 * Output until the next `groupEnd` will be foldable in this group
 *
 * @param name The name of the output group
 */
function startGroup(name) {
    command_1.issue('group', name);
}
exports.startGroup = startGroup;
/**
 * End an output group.
 */
function endGroup() {
    command_1.issue('endgroup');
}
exports.endGroup = endGroup;
/**
 * Wrap an asynchronous function call in a group.
 *
 * Returns the same type as the function itself.
 *
 * @param name The name of the group
 * @param fn The function to wrap in the group
 */
function group(name, fn) {
    return __awaiter(this, void 0, void 0, function* () {
        startGroup(name);
        let result;
        try {
            result = yield fn();
        }
        finally {
            endGroup();
        }
        return result;
    });
}
exports.group = group;
//# sourceMappingURL=core.js.map

/***/ }),

/***/ 562:
/***/ (function(__unusedmodule, exports, __webpack_require__) {

"use strict";


try {
  const isValidUTF8 = __webpack_require__(235);

  exports.isValidUTF8 =
    typeof isValidUTF8 === 'object'
      ? isValidUTF8.Validation.isValidUTF8 // utf-8-validate@<3.0.0
      : isValidUTF8;
} catch (e) /* istanbul ignore next */ {
  exports.isValidUTF8 = () => true;
}

/**
 * Checks if a status code is allowed in a close frame.
 *
 * @param {Number} code The status code
 * @return {Boolean} `true` if the status code is valid, else `false`
 * @public
 */
exports.isValidStatusCode = (code) => {
  return (
    (code >= 1000 &&
      code <= 1014 &&
      code !== 1004 &&
      code !== 1005 &&
      code !== 1006) ||
    (code >= 3000 && code <= 4999)
  );
};


/***/ }),

/***/ 605:
/***/ (function(module) {

module.exports = require("http");

/***/ }),

/***/ 613:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";


const EventEmitter = __webpack_require__(614);
const { createHash } = __webpack_require__(417);
const { createServer, STATUS_CODES } = __webpack_require__(605);

const PerMessageDeflate = __webpack_require__(301);
const WebSocket = __webpack_require__(21);
const { format, parse } = __webpack_require__(330);
const { GUID, kWebSocket } = __webpack_require__(799);

const keyRegex = /^[+/0-9A-Za-z]{22}==$/;

/**
 * Class representing a WebSocket server.
 *
 * @extends EventEmitter
 */
class WebSocketServer extends EventEmitter {
  /**
   * Create a `WebSocketServer` instance.
   *
   * @param {Object} options Configuration options
   * @param {Number} options.backlog The maximum length of the queue of pending
   *     connections
   * @param {Boolean} options.clientTracking Specifies whether or not to track
   *     clients
   * @param {Function} options.handleProtocols A hook to handle protocols
   * @param {String} options.host The hostname where to bind the server
   * @param {Number} options.maxPayload The maximum allowed message size
   * @param {Boolean} options.noServer Enable no server mode
   * @param {String} options.path Accept only connections matching this path
   * @param {(Boolean|Object)} options.perMessageDeflate Enable/disable
   *     permessage-deflate
   * @param {Number} options.port The port where to bind the server
   * @param {http.Server} options.server A pre-created HTTP/S server to use
   * @param {Function} options.verifyClient A hook to reject connections
   * @param {Function} callback A listener for the `listening` event
   */
  constructor(options, callback) {
    super();

    options = {
      maxPayload: 100 * 1024 * 1024,
      perMessageDeflate: false,
      handleProtocols: null,
      clientTracking: true,
      verifyClient: null,
      noServer: false,
      backlog: null, // use default (511 as implemented in net.js)
      server: null,
      host: null,
      path: null,
      port: null,
      ...options
    };

    if (options.port == null && !options.server && !options.noServer) {
      throw new TypeError(
        'One of the "port", "server", or "noServer" options must be specified'
      );
    }

    if (options.port != null) {
      this._server = createServer((req, res) => {
        const body = STATUS_CODES[426];

        res.writeHead(426, {
          'Content-Length': body.length,
          'Content-Type': 'text/plain'
        });
        res.end(body);
      });
      this._server.listen(
        options.port,
        options.host,
        options.backlog,
        callback
      );
    } else if (options.server) {
      this._server = options.server;
    }

    if (this._server) {
      this._removeListeners = addListeners(this._server, {
        listening: this.emit.bind(this, 'listening'),
        error: this.emit.bind(this, 'error'),
        upgrade: (req, socket, head) => {
          this.handleUpgrade(req, socket, head, (ws) => {
            this.emit('connection', ws, req);
          });
        }
      });
    }

    if (options.perMessageDeflate === true) options.perMessageDeflate = {};
    if (options.clientTracking) this.clients = new Set();
    this.options = options;
  }

  /**
   * Returns the bound address, the address family name, and port of the server
   * as reported by the operating system if listening on an IP socket.
   * If the server is listening on a pipe or UNIX domain socket, the name is
   * returned as a string.
   *
   * @return {(Object|String|null)} The address of the server
   * @public
   */
  address() {
    if (this.options.noServer) {
      throw new Error('The server is operating in "noServer" mode');
    }

    if (!this._server) return null;
    return this._server.address();
  }

  /**
   * Close the server.
   *
   * @param {Function} cb Callback
   * @public
   */
  close(cb) {
    if (cb) this.once('close', cb);

    //
    // Terminate all associated clients.
    //
    if (this.clients) {
      for (const client of this.clients) client.terminate();
    }

    const server = this._server;

    if (server) {
      this._removeListeners();
      this._removeListeners = this._server = null;

      //
      // Close the http server if it was internally created.
      //
      if (this.options.port != null) {
        server.close(() => this.emit('close'));
        return;
      }
    }

    process.nextTick(emitClose, this);
  }

  /**
   * See if a given request should be handled by this server instance.
   *
   * @param {http.IncomingMessage} req Request object to inspect
   * @return {Boolean} `true` if the request is valid, else `false`
   * @public
   */
  shouldHandle(req) {
    if (this.options.path) {
      const index = req.url.indexOf('?');
      const pathname = index !== -1 ? req.url.slice(0, index) : req.url;

      if (pathname !== this.options.path) return false;
    }

    return true;
  }

  /**
   * Handle a HTTP Upgrade request.
   *
   * @param {http.IncomingMessage} req The request object
   * @param {net.Socket} socket The network socket between the server and client
   * @param {Buffer} head The first packet of the upgraded stream
   * @param {Function} cb Callback
   * @public
   */
  handleUpgrade(req, socket, head, cb) {
    socket.on('error', socketOnError);

    const key =
      req.headers['sec-websocket-key'] !== undefined
        ? req.headers['sec-websocket-key'].trim()
        : false;
    const version = +req.headers['sec-websocket-version'];
    const extensions = {};

    if (
      req.method !== 'GET' ||
      req.headers.upgrade.toLowerCase() !== 'websocket' ||
      !key ||
      !keyRegex.test(key) ||
      (version !== 8 && version !== 13) ||
      !this.shouldHandle(req)
    ) {
      return abortHandshake(socket, 400);
    }

    if (this.options.perMessageDeflate) {
      const perMessageDeflate = new PerMessageDeflate(
        this.options.perMessageDeflate,
        true,
        this.options.maxPayload
      );

      try {
        const offers = parse(req.headers['sec-websocket-extensions']);

        if (offers[PerMessageDeflate.extensionName]) {
          perMessageDeflate.accept(offers[PerMessageDeflate.extensionName]);
          extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
        }
      } catch (err) {
        return abortHandshake(socket, 400);
      }
    }

    //
    // Optionally call external client verification handler.
    //
    if (this.options.verifyClient) {
      const info = {
        origin:
          req.headers[`${version === 8 ? 'sec-websocket-origin' : 'origin'}`],
        secure: !!(req.connection.authorized || req.connection.encrypted),
        req
      };

      if (this.options.verifyClient.length === 2) {
        this.options.verifyClient(info, (verified, code, message, headers) => {
          if (!verified) {
            return abortHandshake(socket, code || 401, message, headers);
          }

          this.completeUpgrade(key, extensions, req, socket, head, cb);
        });
        return;
      }

      if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
    }

    this.completeUpgrade(key, extensions, req, socket, head, cb);
  }

  /**
   * Upgrade the connection to WebSocket.
   *
   * @param {String} key The value of the `Sec-WebSocket-Key` header
   * @param {Object} extensions The accepted extensions
   * @param {http.IncomingMessage} req The request object
   * @param {net.Socket} socket The network socket between the server and client
   * @param {Buffer} head The first packet of the upgraded stream
   * @param {Function} cb Callback
   * @throws {Error} If called more than once with the same socket
   * @private
   */
  completeUpgrade(key, extensions, req, socket, head, cb) {
    //
    // Destroy the socket if the client has already sent a FIN packet.
    //
    if (!socket.readable || !socket.writable) return socket.destroy();

    if (socket[kWebSocket]) {
      throw new Error(
        'server.handleUpgrade() was called more than once with the same ' +
          'socket, possibly due to a misconfiguration'
      );
    }

    const digest = createHash('sha1')
      .update(key + GUID)
      .digest('base64');

    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${digest}`
    ];

    const ws = new WebSocket(null);
    let protocol = req.headers['sec-websocket-protocol'];

    if (protocol) {
      protocol = protocol.trim().split(/ *, */);

      //
      // Optionally call external protocol selection handler.
      //
      if (this.options.handleProtocols) {
        protocol = this.options.handleProtocols(protocol, req);
      } else {
        protocol = protocol[0];
      }

      if (protocol) {
        headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
        ws.protocol = protocol;
      }
    }

    if (extensions[PerMessageDeflate.extensionName]) {
      const params = extensions[PerMessageDeflate.extensionName].params;
      const value = format({
        [PerMessageDeflate.extensionName]: [params]
      });
      headers.push(`Sec-WebSocket-Extensions: ${value}`);
      ws._extensions = extensions;
    }

    //
    // Allow external modification/inspection of handshake headers.
    //
    this.emit('headers', headers, req);

    socket.write(headers.concat('\r\n').join('\r\n'));
    socket.removeListener('error', socketOnError);

    ws.setSocket(socket, head, this.options.maxPayload);

    if (this.clients) {
      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
    }

    cb(ws);
  }
}

module.exports = WebSocketServer;

/**
 * Add event listeners on an `EventEmitter` using a map of <event, listener>
 * pairs.
 *
 * @param {EventEmitter} server The event emitter
 * @param {Object.<String, Function>} map The listeners to add
 * @return {Function} A function that will remove the added listeners when called
 * @private
 */
function addListeners(server, map) {
  for (const event of Object.keys(map)) server.on(event, map[event]);

  return function removeListeners() {
    for (const event of Object.keys(map)) {
      server.removeListener(event, map[event]);
    }
  };
}

/**
 * Emit a `'close'` event on an `EventEmitter`.
 *
 * @param {EventEmitter} server The event emitter
 * @private
 */
function emitClose(server) {
  server.emit('close');
}

/**
 * Handle premature socket errors.
 *
 * @private
 */
function socketOnError() {
  this.destroy();
}

/**
 * Close the connection when preconditions are not fulfilled.
 *
 * @param {net.Socket} socket The socket of the upgrade request
 * @param {Number} code The HTTP response status code
 * @param {String} [message] The HTTP response body
 * @param {Object} [headers] Additional HTTP response headers
 * @private
 */
function abortHandshake(socket, code, message, headers) {
  if (socket.writable) {
    message = message || STATUS_CODES[code];
    headers = {
      Connection: 'close',
      'Content-Type': 'text/html',
      'Content-Length': Buffer.byteLength(message),
      ...headers
    };

    socket.write(
      `HTTP/1.1 ${code} ${STATUS_CODES[code]}\r\n` +
        Object.keys(headers)
          .map((h) => `${h}: ${headers[h]}`)
          .join('\r\n') +
        '\r\n\r\n' +
        message
    );
  }

  socket.removeListener('error', socketOnError);
  socket.destroy();
}


/***/ }),

/***/ 614:
/***/ (function(module) {

module.exports = require("events");

/***/ }),

/***/ 622:
/***/ (function(module) {

module.exports = require("path");

/***/ }),

/***/ 631:
/***/ (function(module) {

module.exports = require("net");

/***/ }),

/***/ 646:
/***/ (function(module) {

"use strict";


/**
 * Class representing an event.
 *
 * @private
 */
class Event {
  /**
   * Create a new `Event`.
   *
   * @param {String} type The name of the event
   * @param {Object} target A reference to the target to which the event was dispatched
   */
  constructor(type, target) {
    this.target = target;
    this.type = type;
  }
}

/**
 * Class representing a message event.
 *
 * @extends Event
 * @private
 */
class MessageEvent extends Event {
  /**
   * Create a new `MessageEvent`.
   *
   * @param {(String|Buffer|ArrayBuffer|Buffer[])} data The received data
   * @param {WebSocket} target A reference to the target to which the event was dispatched
   */
  constructor(data, target) {
    super('message', target);

    this.data = data;
  }
}

/**
 * Class representing a close event.
 *
 * @extends Event
 * @private
 */
class CloseEvent extends Event {
  /**
   * Create a new `CloseEvent`.
   *
   * @param {Number} code The status code explaining why the connection is being closed
   * @param {String} reason A human-readable string explaining why the connection is closing
   * @param {WebSocket} target A reference to the target to which the event was dispatched
   */
  constructor(code, reason, target) {
    super('close', target);

    this.wasClean = target._closeFrameReceived && target._closeFrameSent;
    this.reason = reason;
    this.code = code;
  }
}

/**
 * Class representing an open event.
 *
 * @extends Event
 * @private
 */
class OpenEvent extends Event {
  /**
   * Create a new `OpenEvent`.
   *
   * @param {WebSocket} target A reference to the target to which the event was dispatched
   */
  constructor(target) {
    super('open', target);
  }
}

/**
 * Class representing an error event.
 *
 * @extends Event
 * @private
 */
class ErrorEvent extends Event {
  /**
   * Create a new `ErrorEvent`.
   *
   * @param {Object} error The error that generated this event
   * @param {WebSocket} target A reference to the target to which the event was dispatched
   */
  constructor(error, target) {
    super('error', target);

    this.message = error.message;
    this.error = error;
  }
}

/**
 * This provides methods for emulating the `EventTarget` interface. It's not
 * meant to be used directly.
 *
 * @mixin
 */
const EventTarget = {
  /**
   * Register an event listener.
   *
   * @param {String} type A string representing the event type to listen for
   * @param {Function} listener The listener to add
   * @param {Object} options An options object specifies characteristics about
   *     the event listener
   * @param {Boolean} options.once A `Boolean`` indicating that the listener
   *     should be invoked at most once after being added. If `true`, the
   *     listener would be automatically removed when invoked.
   * @public
   */
  addEventListener(type, listener, options) {
    if (typeof listener !== 'function') return;

    function onMessage(data) {
      listener.call(this, new MessageEvent(data, this));
    }

    function onClose(code, message) {
      listener.call(this, new CloseEvent(code, message, this));
    }

    function onError(error) {
      listener.call(this, new ErrorEvent(error, this));
    }

    function onOpen() {
      listener.call(this, new OpenEvent(this));
    }

    const method = options && options.once ? 'once' : 'on';

    if (type === 'message') {
      onMessage._listener = listener;
      this[method](type, onMessage);
    } else if (type === 'close') {
      onClose._listener = listener;
      this[method](type, onClose);
    } else if (type === 'error') {
      onError._listener = listener;
      this[method](type, onError);
    } else if (type === 'open') {
      onOpen._listener = listener;
      this[method](type, onOpen);
    } else {
      this[method](type, listener);
    }
  },

  /**
   * Remove an event listener.
   *
   * @param {String} type A string representing the event type to remove
   * @param {Function} listener The listener to remove
   * @public
   */
  removeEventListener(type, listener) {
    const listeners = this.listeners(type);

    for (let i = 0; i < listeners.length; i++) {
      if (listeners[i] === listener || listeners[i]._listener === listener) {
        this.removeListener(type, listeners[i]);
      }
    }
  }
};

module.exports = EventTarget;


/***/ }),

/***/ 664:
/***/ (function(module) {

"use strict";


const kDone = Symbol('kDone');
const kRun = Symbol('kRun');

/**
 * A very simple job queue with adjustable concurrency. Adapted from
 * https://github.com/STRML/async-limiter
 */
class Limiter {
  /**
   * Creates a new `Limiter`.
   *
   * @param {Number} concurrency The maximum number of jobs allowed to run
   *     concurrently
   */
  constructor(concurrency) {
    this[kDone] = () => {
      this.pending--;
      this[kRun]();
    };
    this.concurrency = concurrency || Infinity;
    this.jobs = [];
    this.pending = 0;
  }

  /**
   * Adds a job to the queue.
   *
   * @public
   */
  add(job) {
    this.jobs.push(job);
    this[kRun]();
  }

  /**
   * Removes a job from the queue and runs it if possible.
   *
   * @private
   */
  [kRun]() {
    if (this.pending === this.concurrency) return;

    if (this.jobs.length) {
      const job = this.jobs.shift();

      this.pending++;
      job(this[kDone]);
    }
  }
}

module.exports = Limiter;


/***/ }),

/***/ 723:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";


module.exports = __webpack_require__(237);

/***/ }),

/***/ 761:
/***/ (function(module) {

module.exports = require("zlib");

/***/ }),

/***/ 799:
/***/ (function(module) {

"use strict";


module.exports = {
  BINARY_TYPES: ['nodebuffer', 'arraybuffer', 'fragments'],
  GUID: '258EAFA5-E914-47DA-95CA-C5AB0DC85B11',
  kStatusCode: Symbol('status-code'),
  kWebSocket: Symbol('websocket'),
  EMPTY_BUFFER: Buffer.alloc(0),
  NOOP: () => {}
};


/***/ }),

/***/ 835:
/***/ (function(module) {

module.exports = require("url");

/***/ }),

/***/ 948:
/***/ (function(module, __unusedexports, __webpack_require__) {

"use strict";


const { Duplex } = __webpack_require__(413);

/**
 * Emits the `'close'` event on a stream.
 *
 * @param {stream.Duplex} The stream.
 * @private
 */
function emitClose(stream) {
  stream.emit('close');
}

/**
 * The listener of the `'end'` event.
 *
 * @private
 */
function duplexOnEnd() {
  if (!this.destroyed && this._writableState.finished) {
    this.destroy();
  }
}

/**
 * The listener of the `'error'` event.
 *
 * @private
 */
function duplexOnError(err) {
  this.removeListener('error', duplexOnError);
  this.destroy();
  if (this.listenerCount('error') === 0) {
    // Do not suppress the throwing behavior.
    this.emit('error', err);
  }
}

/**
 * Wraps a `WebSocket` in a duplex stream.
 *
 * @param {WebSocket} ws The `WebSocket` to wrap
 * @param {Object} options The options for the `Duplex` constructor
 * @return {stream.Duplex} The duplex stream
 * @public
 */
function createWebSocketStream(ws, options) {
  let resumeOnReceiverDrain = true;

  function receiverOnDrain() {
    if (resumeOnReceiverDrain) ws._socket.resume();
  }

  if (ws.readyState === ws.CONNECTING) {
    ws.once('open', function open() {
      ws._receiver.removeAllListeners('drain');
      ws._receiver.on('drain', receiverOnDrain);
    });
  } else {
    ws._receiver.removeAllListeners('drain');
    ws._receiver.on('drain', receiverOnDrain);
  }

  const duplex = new Duplex({
    ...options,
    autoDestroy: false,
    emitClose: false,
    objectMode: false,
    writableObjectMode: false
  });

  ws.on('message', function message(msg) {
    if (!duplex.push(msg)) {
      resumeOnReceiverDrain = false;
      ws._socket.pause();
    }
  });

  ws.once('error', function error(err) {
    if (duplex.destroyed) return;

    duplex.destroy(err);
  });

  ws.once('close', function close() {
    if (duplex.destroyed) return;

    duplex.push(null);
  });

  duplex._destroy = function(err, callback) {
    if (ws.readyState === ws.CLOSED) {
      callback(err);
      process.nextTick(emitClose, duplex);
      return;
    }

    let called = false;

    ws.once('error', function error(err) {
      called = true;
      callback(err);
    });

    ws.once('close', function close() {
      if (!called) callback(err);
      process.nextTick(emitClose, duplex);
    });
    ws.terminate();
  };

  duplex._final = function(callback) {
    if (ws.readyState === ws.CONNECTING) {
      ws.once('open', function open() {
        duplex._final(callback);
      });
      return;
    }

    // If the value of the `_socket` property is `null` it means that `ws` is a
    // client websocket and the handshake failed. In fact, when this happens, a
    // socket is never assigned to the websocket. Wait for the `'error'` event
    // that will be emitted by the websocket.
    if (ws._socket === null) return;

    if (ws._socket._writableState.finished) {
      callback();
      if (duplex._readableState.endEmitted) duplex.destroy();
    } else {
      ws._socket.once('finish', function finish() {
        // `duplex` is not destroyed here because the `'end'` event will be
        // emitted on `duplex` after this `'finish'` event. The EOF signaling
        // `null` chunk is, in fact, pushed when the websocket emits `'close'`.
        callback();
      });
      ws.close();
    }
  };

  duplex._read = function() {
    if (ws.readyState === ws.OPEN && !resumeOnReceiverDrain) {
      resumeOnReceiverDrain = true;
      if (!ws._receiver._writableState.needDrain) ws._socket.resume();
    }
  };

  duplex._write = function(chunk, encoding, callback) {
    if (ws.readyState === ws.CONNECTING) {
      ws.once('open', function open() {
        duplex._write(chunk, encoding, callback);
      });
      return;
    }

    ws.send(chunk, callback);
  };

  duplex.on('end', duplexOnEnd);
  duplex.on('error', duplexOnError);
  return duplex;
}

module.exports = createWebSocketStream;


/***/ })

/******/ });