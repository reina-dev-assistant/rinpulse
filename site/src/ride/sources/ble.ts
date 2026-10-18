import type { DataSource, LiveSample, SourceState } from "../live.ts";
import { CadenceEstimator, parseCsc, parseHeartRate } from "./ble-parse.ts";

interface BtCharacteristic {
  value?: DataView;
  startNotifications(): Promise<BtCharacteristic>;
  stopNotifications(): Promise<BtCharacteristic>;
  addEventListener(type: "characteristicvaluechanged", fn: (e: Event) => void): void;
  removeEventListener(type: "characteristicvaluechanged", fn: (e: Event) => void): void;
}
interface BtService {
  uuid: string;
  getCharacteristic(name: string): Promise<BtCharacteristic>;
}
interface BtServer {
  connected: boolean;
  connect(): Promise<BtServer>;
  disconnect(): void;
  getPrimaryServices(): Promise<BtService[]>;
}
interface BtDevice {
  id: string;
  name?: string;
  gatt?: BtServer;
  addEventListener(type: "gattserverdisconnected", fn: () => void): void;
  removeEventListener(type: "gattserverdisconnected", fn: () => void): void;
}
interface BtApi {
  requestDevice(options: {
    filters: { services: string[] }[];
    optionalServices: string[];
  }): Promise<BtDevice>;
}

const bt = (): BtApi | undefined => (navigator as unknown as { bluetooth?: BtApi }).bluetooth;

export function bleSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

const HR_SERVICE = "heart_rate";
const CSC_SERVICE = "cycling_speed_and_cadence";
const HR_CHAR = "heart_rate_measurement";
const CSC_CHAR = "csc_measurement";
const EMIT_MS = 250;
const IDLE_MS = 500;
const MAX_RECONNECTS = 5;

type Link = {
  device: BtDevice;
  name: string;
  status: "connecting" | "waiting" | "live" | "lost";
  attempts: number;
  closed: boolean;
  chars: { char: BtCharacteristic; fn: (e: Event) => void }[];
  onDisconnect: () => void;
  retryTimer?: ReturnType<typeof setTimeout>;
};

export class BleSource implements DataSource {
  readonly kind = "ble" as const;
  state: SourceState = "idle";
  detail?: string;

  private links: Link[] = [];
  private sampleFns = new Set<(s: LiveSample) => void>();
  private stateFns = new Set<() => void>();
  private estimator = new CadenceEstimator();
  private hr: number | undefined;
  private cad: number | undefined;
  private dirty = false;
  private emitTimer: ReturnType<typeof setInterval> | undefined;
  private idleTimer: ReturnType<typeof setInterval> | undefined;

  /**
   * Must be called from a user gesture (click/tap): requestDevice rejects otherwise.
   * Call again to add a second device (separate HR strap and cadence sensor).
   */
  async start(): Promise<void> {
    const api = bt();
    if (!api) {
      this.set("error", "Web Bluetooth is not supported in this browser");
      return;
    }
    let device: BtDevice;
    try {
      device = await api.requestDevice({
        filters: [{ services: [HR_SERVICE] }, { services: [CSC_SERVICE] }],
        optionalServices: [HR_SERVICE, CSC_SERVICE, "battery_service"],
      });
    } catch (e) {
      if (this.links.length === 0) this.set("error", errorText(e));
      else this.refresh();
      return;
    }
    if (this.links.some((l) => l.device.id === device.id)) return;

    const link: Link = {
      device,
      name: device.name ?? "Bluetooth sensor",
      status: "connecting",
      attempts: 0,
      closed: false,
      chars: [],
      onDisconnect: () => this.handleDisconnect(link),
    };
    device.addEventListener("gattserverdisconnected", link.onDisconnect);
    this.links.push(link);
    this.startTimers();
    this.refresh();
    try {
      await this.connect(link);
    } catch (e) {
      this.handleDisconnect(link, errorText(e));
    }
  }

  stop(): void {
    for (const link of this.links) {
      link.closed = true;
      clearTimeout(link.retryTimer);
      link.device.removeEventListener("gattserverdisconnected", link.onDisconnect);
      this.detach(link);
      if (link.device.gatt?.connected) link.device.gatt.disconnect();
    }
    this.links = [];
    clearInterval(this.emitTimer);
    clearInterval(this.idleTimer);
    this.emitTimer = this.idleTimer = undefined;
    this.estimator = new CadenceEstimator();
    this.hr = this.cad = undefined;
    this.dirty = false;
    this.set("idle", undefined);
  }

  onSample(fn: (sample: LiveSample) => void): () => void {
    this.sampleFns.add(fn);
    return () => this.sampleFns.delete(fn);
  }

  onState(fn: () => void): () => void {
    this.stateFns.add(fn);
    return () => this.stateFns.delete(fn);
  }

  private async connect(link: Link): Promise<void> {
    const gatt = link.device.gatt;
    if (!gatt) throw new Error("Device has no GATT server");
    const server = await gatt.connect();
    if (link.closed) return;
    const services = await server.getPrimaryServices();
    const uuids = services.map((s) => s.uuid);
    const hrSvc = services.find((s) => s.uuid === uuids.find((u) => isService(u, 0x180d)));
    const cscSvc = services.find((s) => s.uuid === uuids.find((u) => isService(u, 0x1816)));
    if (!hrSvc && !cscSvc) throw new Error(`${link.name}: no heart rate or cadence service`);

    this.detach(link);
    if (hrSvc) await this.subscribe(link, hrSvc, HR_CHAR, (v) => this.onHeartRate(link, v));
    if (cscSvc) await this.subscribe(link, cscSvc, CSC_CHAR, (v) => this.onCsc(link, v));
    if (link.closed) return;
    link.attempts = 0;
    link.status = "waiting";
    this.refresh();
  }

  private async subscribe(
    link: Link,
    service: BtService,
    charName: string,
    handle: (v: DataView) => void,
  ): Promise<void> {
    const char = await service.getCharacteristic(charName);
    const fn = (e: Event) => {
      const value = (e.target as unknown as BtCharacteristic).value;
      if (value) handle(value);
    };
    char.addEventListener("characteristicvaluechanged", fn);
    link.chars.push({ char, fn });
    await char.startNotifications();
  }

  private detach(link: Link): void {
    for (const { char, fn } of link.chars) {
      char.removeEventListener("characteristicvaluechanged", fn);
      if (link.device.gatt?.connected) char.stopNotifications().catch(() => {});
    }
    link.chars = [];
  }

  private handleDisconnect(link: Link, reason?: string): void {
    if (link.closed) return;
    clearTimeout(link.retryTimer);
    if (link.attempts >= MAX_RECONNECTS) {
      link.status = "lost";
      this.refresh(reason);
      return;
    }
    const delay = 1000 * 2 ** link.attempts;
    link.attempts += 1;
    link.status = "connecting";
    this.refresh();
    link.retryTimer = setTimeout(() => {
      this.connect(link).catch((e) => this.handleDisconnect(link, errorText(e)));
    }, delay);
  }

  private onHeartRate(link: Link, view: DataView): void {
    const { hr } = parseHeartRate(view);
    if (hr <= 0) return;
    this.hr = hr;
    this.markLive(link);
  }

  private onCsc(link: Link, view: DataView): void {
    const { crank } = parseCsc(view);
    if (!crank) return;
    const rpm = this.estimator.push(crank, Date.now());
    if (rpm !== undefined) this.cad = Math.round(rpm);
    this.markLive(link);
  }

  private markLive(link: Link): void {
    this.dirty = true;
    if (link.status !== "live") {
      link.status = "live";
      this.refresh();
    }
  }

  private startTimers(): void {
    this.emitTimer ??= setInterval(() => {
      if (!this.dirty) return;
      this.dirty = false;
      const sample: LiveSample = { at: Date.now() };
      if (this.hr !== undefined) sample.hr = this.hr;
      if (this.cad !== undefined) sample.cad = this.cad;
      for (const fn of this.sampleFns) fn(sample);
    }, EMIT_MS);
    this.idleTimer ??= setInterval(() => {
      const rpm = this.estimator.idle(Date.now());
      if (rpm !== undefined && this.cad !== rpm) {
        this.cad = rpm;
        this.dirty = true;
      }
    }, IDLE_MS);
  }

  private refresh(error?: string): void {
    const names = this.links.map((l) => l.name).join(", ");
    const any = (s: Link["status"]) => this.links.some((l) => l.status === s);
    let state: SourceState;
    if (this.links.length === 0) state = "idle";
    else if (any("live")) state = "live";
    else if (any("waiting")) state = "waiting";
    else if (any("connecting")) state = "connecting";
    else state = "lost";
    this.set(state, error ? `${names}: ${error}` : names || undefined);
  }

  private set(state: SourceState, detail: string | undefined): void {
    this.state = state;
    this.detail = detail;
    for (const fn of this.stateFns) fn();
  }
}

const isService = (uuid: string, short: number): boolean =>
  uuid.toLowerCase() === `0000${short.toString(16).padStart(4, "0")}-0000-1000-8000-00805f9b34fb`;

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
