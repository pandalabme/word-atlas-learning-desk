import assert from "node:assert/strict";
import test from "node:test";
import { LabelBluetooth, encodeLabelDeck, type BluetoothProvider } from "./labelBluetooth";

const UART_SERVICE = "00001f10-0000-1000-8000-00805f9b34fb";
const EPD_SERVICE = "13187b10-eba9-a3ba-044e-83d3217d9a38";

test("encodes the same WCDK v1 bytes as the verified Python encoder", () => {
  const payload = encodeLabelDeck(
    ["library", "thursday"],
    new Date("2026-10-29T04:00:00.000Z"),
    "Asia/Shanghai",
  );
  assert.equal(
    Buffer.from(payload).toString("hex"),
    "5743444b01203900000013510000e001e001a0052c0102000200000017e884d20100076c696272617279020008746875727364617900000100",
  );
});

test("rejects words that the firmware cannot display", () => {
  assert.throws(() => encodeLabelDeck([], new Date(), "Asia/Shanghai"), /1 到 64/);
  assert.throws(() => encodeLabelDeck(["hello", "hello"], new Date(), "Asia/Shanghai"), /不能重复/);
  assert.throws(() => encodeLabelDeck(["not a word"], new Date(), "Asia/Shanghai"), /英文单词/);
});

test("pairs first, then transfers and commits a verified word package", async () => {
  const uart = new FakeCharacteristic(false);
  const epd = new FakeCharacteristic(true);
  const server = {
    connected: true,
    getPrimaryService: async (uuid: string) => ({
      getCharacteristic: async () => uuid === UART_SERVICE ? uart : epd,
    }),
  };
  let disconnected = false;
  const device = Object.assign(new EventTarget(), {
    id: "device-redacted",
    name: "BLE_TEST",
    gatt: {
      connected: true,
      connect: async () => server,
      disconnect: () => { disconnected = true; device.gatt.connected = false; server.connected = false; },
    },
  });
  let requestOptions: unknown;
  const provider: BluetoothProvider = {
    requestDevice: async (options) => { requestOptions = options; return device; },
  };
  const adapter = new LabelBluetooth(provider, "Asia/Shanghai");
  const connection = await adapter.connect();
  assert.deepEqual(connection, { deviceName: "BLE_TEST", deviceId: "device-redacted" });
  assert.deepEqual(requestOptions, {
    acceptAllDevices: true,
    optionalServices: [UART_SERVICE, EPD_SERVICE],
  });

  const progress: string[] = [];
  await adapter.syncWords(
    ["library", "thursday"],
    (event) => progress.push(event.phase),
    new Date("2026-10-29T04:00:00.000Z"),
  );

  assert.equal(uart.writes.length, 1);
  assert.equal(uart.writes[0]?.[0], 0xdd);
  assert.deepEqual(epd.writes.map((write) => write[0]), [0x10, 0x14, 0x11, 0x12, 0x13]);
  assert.deepEqual(progress, ["preparing", "transferring", "committing", "done"]);
  assert.equal(adapter.isConnected(), true);
  adapter.disconnect();
  assert.equal(disconnected, true);
});

class FakeCharacteristic extends EventTarget {
  readonly properties = { write: true, notify: true };
  value: DataView | null = null;
  readonly writes: Uint8Array[] = [];
  private totalLength = 0;
  private deckDay = 0;
  private packageCrc = 0;

  constructor(private readonly responds: boolean) {
    super();
  }

  async startNotifications(): Promise<this> {
    return this;
  }

  async writeValueWithResponse(value: BufferSource): Promise<void> {
    const source = value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const request = source.slice();
    this.writes.push(request);
    if (!this.responds) return;
    const command = request[0] ?? 0;
    let status = 0;
    let value0 = 0;
    let value1 = 0;
    if (command === 0x10) {
      value0 = 2_568;
      value1 = (1 << 24) | (1 << 16) | 240;
    } else if (command === 0x11) {
      const view = new DataView(request.buffer, request.byteOffset, request.byteLength);
      this.totalLength = view.getUint16(1, true);
      this.deckDay = view.getUint32(3, true);
      this.packageCrc = view.getUint32(7, true);
      value1 = this.totalLength;
    } else if (command === 0x12) {
      const view = new DataView(request.buffer, request.byteOffset, request.byteLength);
      value0 = view.getUint16(1, true) + request.length - 3;
      value1 = this.totalLength;
    } else if (command === 0x13) {
      value0 = this.deckDay;
      value1 = this.packageCrc;
    }
    const response = new Uint8Array(12);
    const responseView = new DataView(response.buffer);
    response.set([0x57, 0x43, command, status], 0);
    responseView.setUint32(4, value0, true);
    responseView.setUint32(8, value1, true);
    queueMicrotask(() => {
      this.value = new DataView(response.buffer);
      this.dispatchEvent(new Event("characteristicvaluechanged"));
    });
  }
}
