const UART_SERVICE_UUID = "00001f10-0000-1000-8000-00805f9b34fb";
const UART_CHARACTERISTIC_UUID = "00001f1f-0000-1000-8000-00805f9b34fb";
const EPD_SERVICE_UUID = "13187b10-eba9-a3ba-044e-83d3217d9a38";
const EPD_CHARACTERISTIC_UUID = "4b646063-6264-f3a7-8941-e65356ea82fe";

const HEADER_BYTES = 32;
const MAX_CARDS = 64;
const MAX_PACKAGE_BYTES = 2_568;
const MAX_CHUNK_BYTES = 240;
const ACTIVE_START_MINUTE = 8 * 60;
const ACTIVE_END_MINUTE = 24 * 60;
const SLOT_SECONDS = 5 * 60;
const WORD = /^[a-z]+(?:[-'][a-z]+)*$/;

const enum WordCommand {
  Capabilities = 0x10,
  Begin = 0x11,
  Data = 0x12,
  Commit = 0x13,
  Status = 0x14,
}

const enum WordStatus {
  Ok = 0,
  Busy = 3,
  BadOffset = 5,
  AlreadyActive = 10,
}

interface GattCharacteristic extends EventTarget {
  value?: DataView | null;
  properties: { write: boolean; notify: boolean };
  startNotifications(): Promise<GattCharacteristic>;
  writeValueWithResponse?(value: BufferSource): Promise<void>;
}

interface GattService {
  getCharacteristic(uuid: string): Promise<GattCharacteristic>;
}

interface GattServer {
  connected: boolean;
  getPrimaryService(uuid: string): Promise<GattService>;
}

interface BluetoothDeviceLike extends EventTarget {
  id: string;
  name?: string;
  gatt?: { connected: boolean; connect(): Promise<GattServer>; disconnect(): void };
}

export interface BluetoothProvider {
  requestDevice(options: unknown): Promise<BluetoothDeviceLike>;
}

export interface LabelConnection {
  deviceName: string;
  deviceId: string;
}

export interface LabelTransferProgress {
  phase: "preparing" | "transferring" | "committing" | "done";
  confirmedBytes: number;
  totalBytes: number;
}

interface WordResponse {
  command: WordCommand;
  status: number;
  value0: number;
  value1: number;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
}

/** Encode the frozen WCDK v1 package used by the installed word-carousel firmware. */
export function encodeLabelDeck(
  words: readonly string[],
  now = new Date(),
  timeZone = "Asia/Shanghai",
): Uint8Array {
  if (words.length < 1 || words.length > MAX_CARDS) {
    throw new Error("价签单词数量必须为 1 到 64 个。");
  }
  const normalized = words.map((word) => word.toLocaleLowerCase("en-US"));
  if (new Set(normalized).size !== normalized.length) throw new Error("价签单词不能重复。");
  const encoder = new TextEncoder();
  const encoded = normalized.map((word) => {
    const bytes = encoder.encode(word);
    if (!WORD.test(word) || bytes.length < 1 || bytes.length > 31) {
      throw new Error("价签仅支持不超过 31 个字符的英文单词。");
    }
    return bytes;
  });

  const totalLength = HEADER_BYTES
    + encoded.reduce((total, bytes) => total + 3 + bytes.length, 0)
    + words.length * 2;
  if (totalLength > MAX_PACKAGE_BYTES) throw new Error("价签单词包超过固件容量。");

  const parts = zonedParts(now, timeZone);
  const epochDay = Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
  const offsetMinutes = offsetAtLocalNoon(parts, timeZone);
  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);
  output.set([0x57, 0x43, 0x44, 0x4b], 0); // WCDK
  view.setUint8(4, 1);
  view.setUint8(5, HEADER_BYTES);
  view.setUint32(6, totalLength, true);
  view.setUint32(10, epochDay, true);
  view.setInt16(14, offsetMinutes, true);
  view.setUint16(16, ACTIVE_START_MINUTE, true);
  view.setUint16(18, ACTIVE_END_MINUTE, true);
  view.setUint16(20, SLOT_SECONDS, true);
  view.setUint16(22, words.length, true);
  view.setUint16(24, words.length, true);
  view.setUint16(26, 0, true);

  let position = HEADER_BYTES;
  encoded.forEach((bytes, index) => {
    view.setUint16(position, index + 1, true);
    view.setUint8(position + 2, bytes.length);
    output.set(bytes, position + 3);
    position += 3 + bytes.length;
  });
  encoded.forEach((_bytes, index) => {
    view.setUint16(position, index, true);
    position += 2;
  });
  const checksumInput = new Uint8Array(28 + totalLength - HEADER_BYTES);
  checksumInput.set(output.subarray(0, 28), 0);
  checksumInput.set(output.subarray(HEADER_BYTES), 28);
  view.setUint32(28, crc32(checksumInput), true);
  return output;
}

export class LabelBluetooth {
  private readonly bluetooth: BluetoothProvider | undefined;
  private readonly timeZone: string;
  private device: BluetoothDeviceLike | null = null;
  private server: GattServer | null = null;
  private uart: GattCharacteristic | null = null;
  private epd: GattCharacteristic | null = null;
  private notifications: Uint8Array[] = [];
  private waiters: Array<{
    resolve: (value: Uint8Array) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof globalThis.setTimeout>;
  }> = [];
  private disconnected: (() => void) | undefined;

  constructor(bluetooth?: BluetoothProvider, timeZone = "Asia/Shanghai") {
    this.bluetooth = bluetooth ?? (typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { bluetooth?: BluetoothProvider }).bluetooth);
    this.timeZone = timeZone;
  }

  isConnected(): boolean {
    return !!this.server?.connected && !!this.uart && !!this.epd;
  }

  async connect(onDisconnected?: () => void): Promise<LabelConnection> {
    if (!this.bluetooth) {
      throw new Error("当前浏览器不支持 Web Bluetooth；请使用桌面版或 Android 版 Chrome 的 HTTPS 页面。");
    }
    this.disconnect();
    this.disconnected = onDisconnected;
    const selected = await this.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [UART_SERVICE_UUID, EPD_SERVICE_UUID],
    });
    try {
      if (!selected.gatt) throw new Error("所选设备没有可用的 GATT 服务。");
      this.device = selected;
      selected.addEventListener("gattserverdisconnected", this.onGattDisconnected);
      this.server = await selected.gatt.connect();
      const uartService = await this.server.getPrimaryService(UART_SERVICE_UUID);
      this.uart = await uartService.getCharacteristic(UART_CHARACTERISTIC_UUID);
      const epdService = await this.server.getPrimaryService(EPD_SERVICE_UUID);
      this.epd = await epdService.getCharacteristic(EPD_CHARACTERISTIC_UUID);
      if (!this.uart.properties.write || typeof this.uart.writeValueWithResponse !== "function") {
        throw new Error("价签 UART 特征不支持 WRITE_REQUEST。");
      }
      if (!this.epd.properties.write || !this.epd.properties.notify
        || typeof this.epd.writeValueWithResponse !== "function") {
        throw new Error("价签 EPD 特征缺少 WRITE_REQUEST 或通知能力。");
      }
      this.epd.addEventListener("characteristicvaluechanged", this.onNotification);
      await this.epd.startNotifications();
      return { deviceName: selected.name ?? "XM3YN", deviceId: selected.id };
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }

  disconnect(): void {
    const selected = this.device;
    this.epd?.removeEventListener("characteristicvaluechanged", this.onNotification);
    selected?.removeEventListener("gattserverdisconnected", this.onGattDisconnected);
    this.reset();
    if (selected?.gatt?.connected) selected.gatt.disconnect();
  }

  async syncWords(
    words: readonly string[],
    onProgress?: (progress: LabelTransferProgress) => void,
    now = new Date(),
  ): Promise<void> {
    if (!this.isConnected() || !this.uart || !this.epd) throw new Error("请先连接价签。");
    const payload = encodeLabelDeck(words, now, this.timeZone);
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const totalLength = view.getUint32(6, true);
    const deckDay = view.getUint32(10, true);
    const packageCrc = view.getUint32(28, true);
    onProgress?.({ phase: "preparing", confirmedBytes: 0, totalBytes: totalLength });
    await this.write(this.uart, timePacket(now, this.timeZone), 10_000);

    const capabilities = await this.exchange(Uint8Array.of(WordCommand.Capabilities), WordCommand.Capabilities);
    if (capabilities.status !== WordStatus.Ok) throw new Error(`CAPABILITIES 返回状态 ${capabilities.status}。`);
    const maxPackage = capabilities.value0;
    const maxChunk = capabilities.value1 & 0xffff;
    const schema = (capabilities.value1 >>> 16) & 0xff;
    const protocol = (capabilities.value1 >>> 24) & 0xff;
    if (maxPackage < totalLength || maxPackage > MAX_PACKAGE_BYTES) throw new Error("价签单词包容量不兼容。");
    if (maxChunk < 1 || maxChunk > MAX_CHUNK_BYTES || schema !== 1 || protocol !== 1) {
      throw new Error("价签单词固件协议版本不兼容。");
    }

    const status = await this.exchange(Uint8Array.of(WordCommand.Status), WordCommand.Status);
    if (status.status === WordStatus.Ok && status.value0 === deckDay && status.value1 === packageCrc) {
      onProgress?.({ phase: "done", confirmedBytes: totalLength, totalBytes: totalLength });
      return;
    }
    if (status.status !== WordStatus.Ok && status.status !== WordStatus.Busy) {
      throw new Error(`STATUS 返回状态 ${status.status}。`);
    }
    if (status.status === WordStatus.Busy && (status.value0 > totalLength || status.value1 !== totalLength)) {
      throw new Error("价签返回了无效的续传位置。");
    }

    const begin = await this.exchange(beginRequest(totalLength, deckDay, packageCrc), WordCommand.Begin);
    if (begin.status === WordStatus.AlreadyActive) {
      if (begin.value0 === deckDay && begin.value1 === packageCrc) {
        onProgress?.({ phase: "done", confirmedBytes: totalLength, totalBytes: totalLength });
        return;
      }
      throw new Error("价签正在使用另一份单词包。");
    }
    if (begin.status !== WordStatus.Ok || begin.value1 !== totalLength || begin.value0 > totalLength) {
      throw new Error("价签拒绝开始单词包传输。");
    }

    let offset = begin.value0;
    let stalledRecoveries = 0;
    const chunkSize = Math.min(maxChunk, MAX_CHUNK_BYTES);
    while (offset < totalLength) {
      const chunk = payload.subarray(offset, Math.min(offset + chunkSize, totalLength));
      const response = await this.exchange(dataRequest(offset, chunk), WordCommand.Data);
      if (response.status === WordStatus.BadOffset) {
        if (response.value1 !== totalLength || response.value0 > totalLength) {
          throw new Error("价签返回了无效的数据偏移。");
        }
        stalledRecoveries = response.value0 === offset ? stalledRecoveries + 1 : 0;
        if (stalledRecoveries > 2) throw new Error("价签续传位置没有前进。");
        offset = response.value0;
        continue;
      }
      const expected = offset + chunk.length;
      if (response.status !== WordStatus.Ok || response.value0 !== expected || response.value1 !== totalLength) {
        throw new Error("价签未确认本次单词数据块。");
      }
      offset = expected;
      onProgress?.({ phase: "transferring", confirmedBytes: offset, totalBytes: totalLength });
    }

    onProgress?.({ phase: "committing", confirmedBytes: totalLength, totalBytes: totalLength });
    const commit = await this.exchange(Uint8Array.of(WordCommand.Commit), WordCommand.Commit);
    if (commit.status !== WordStatus.Ok || commit.value0 !== deckDay || commit.value1 !== packageCrc) {
      throw new Error("价签没有确认启用新的单词包。");
    }
    onProgress?.({ phase: "done", confirmedBytes: totalLength, totalBytes: totalLength });
  }

  private async exchange(request: Uint8Array, command: WordCommand): Promise<WordResponse> {
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      try {
        if (!this.epd) throw new Error("价签连接已断开。");
        await this.write(this.epd, request, 10_000);
        while (true) {
          const notification = await this.nextNotification(3_000);
          if (notification.length === 2) continue;
          const response = parseResponse(notification);
          if (response.command !== command) throw new Error("价签响应与请求命令不匹配。");
          return response;
        }
      } catch (error) {
        if (!(error instanceof Error && error.name === "TimeoutError") || attempt >= 2) throw error;
      }
    }
    throw new Error("价签命令重试异常结束。");
  }

  private async write(characteristic: GattCharacteristic, value: Uint8Array, timeoutMs: number): Promise<void> {
    const writer = characteristic.writeValueWithResponse;
    if (typeof writer !== "function") throw new Error("价签特征不支持 WRITE_REQUEST。");
    const bytes = value.slice();
    await withTimeout(writer.call(characteristic, bytes.buffer), timeoutMs, "价签写入超时。");
  }

  private nextNotification(timeoutMs: number): Promise<Uint8Array> {
    const queued = this.notifications.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise<Uint8Array>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: globalThis.setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          const error = new Error("等待价签响应超时。");
          error.name = "TimeoutError";
          reject(error);
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  private readonly onNotification = (event: Event): void => {
    const value = (event.target as GattCharacteristic | null)?.value;
    if (!value) return;
    const notification = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
    const waiter = this.waiters.shift();
    if (waiter) {
      globalThis.clearTimeout(waiter.timer);
      waiter.resolve(notification);
    }
    else this.notifications.push(notification);
  };

  private readonly onGattDisconnected = (): void => {
    const callback = this.disconnected;
    this.epd?.removeEventListener("characteristicvaluechanged", this.onNotification);
    this.device?.removeEventListener("gattserverdisconnected", this.onGattDisconnected);
    this.reset();
    callback?.();
  };

  private reset(): void {
    for (const waiter of this.waiters) {
      globalThis.clearTimeout(waiter.timer);
      waiter.reject(new Error("价签连接已断开。"));
    }
    this.device = null;
    this.server = null;
    this.uart = null;
    this.epd = null;
    this.notifications = [];
    this.waiters = [];
    this.disconnected = undefined;
  }
}

function beginRequest(totalLength: number, deckDay: number, packageCrc: number): Uint8Array {
  const output = new Uint8Array(11);
  const view = new DataView(output.buffer);
  view.setUint8(0, WordCommand.Begin);
  view.setUint16(1, totalLength, true);
  view.setUint32(3, deckDay, true);
  view.setUint32(7, packageCrc, true);
  return output;
}

function dataRequest(offset: number, chunk: Uint8Array): Uint8Array {
  const output = new Uint8Array(3 + chunk.length);
  const view = new DataView(output.buffer);
  view.setUint8(0, WordCommand.Data);
  view.setUint16(1, offset, true);
  output.set(chunk, 3);
  return output;
}

function parseResponse(payload: Uint8Array): WordResponse {
  if (payload.length !== 12 || payload[0] !== 0x57 || payload[1] !== 0x43) {
    throw new Error("价签单词协议响应格式无效。");
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const command = view.getUint8(2) as WordCommand;
  if (command < WordCommand.Capabilities || command > WordCommand.Status) {
    throw new Error("价签返回了未知命令。");
  }
  return {
    command,
    status: view.getUint8(3),
    value0: view.getUint32(4, true),
    value1: view.getUint32(8, true),
  };
}

function timePacket(now: Date, timeZone: string): Uint8Array {
  const parts = zonedParts(now, timeZone);
  const epoch = Math.floor(now.getTime() / 1_000);
  if (epoch < 0 || epoch > 0xffff_ffff) throw new Error("当前时间超出价签支持范围。");
  const output = new Uint8Array(10);
  const view = new DataView(output.buffer);
  view.setUint8(0, 0xdd);
  view.setUint32(1, epoch, false);
  view.setUint16(5, parts.year, false);
  view.setUint8(7, parts.month);
  view.setUint8(8, parts.day);
  view.setUint8(9, parts.weekday);
  return output;
}

function zonedParts(value: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(formatter.formatToParts(value).map((part) => [part.type, part.value]));
  const weekdays: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const weekday = weekdays[parts.weekday ?? ""];
  if (!weekday) throw new Error("无法计算价签本地日期。");
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), weekday };
}

function offsetAtLocalNoon(parts: ZonedParts, timeZone: string): number {
  const utcNoon = Date.UTC(parts.year, parts.month - 1, parts.day, 12);
  let offset = offsetAtInstant(new Date(utcNoon), timeZone);
  offset = offsetAtInstant(new Date(utcNoon - offset * 60_000), timeZone);
  if (!Number.isInteger(offset) || offset < -14 * 60 || offset > 14 * 60) {
    throw new Error("价签时区偏移无效。");
  }
  return offset;
}

function offsetAtInstant(value: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(value).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute));
  return Math.round((asUtc - value.getTime()) / 60_000);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      const error = new Error(message);
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);
    promise.then(
      (value) => { globalThis.clearTimeout(timer); resolve(value); },
      (error: unknown) => { globalThis.clearTimeout(timer); reject(error); },
    );
  });
}
