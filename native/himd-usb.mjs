// Hi-MD "full mode" for the local server: opens a Hi-MD recorder that is connected in Hi-MD
// (USB mass-storage) mode directly through node-usb and reads the disc with himd-js, the same
// way ElectronWMD does. Browsers cannot do this because WebUSB blocks mass-storage interfaces,
// and Windows only lets node-usb open the device after the WinUSB driver is installed (Zadig).

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const IDLE_RELEASE_MS = 10 * 60 * 1000;
const BLOCK_SIZE = 0x4000;

function loadDefaultModules() {
  let usb = null;
  let usbError = null;
  try {
    usb = require("usb");
  } catch (error) {
    usbError = error;
  }
  return { usb, usbError, himd: require("./vendor/himd-node.cjs") };
}

function hex(value) {
  return Number(value).toString(16).padStart(4, "0");
}

export function createHiMDUsbService({ loadModules = loadDefaultModules, platform = process.platform } = {}) {
  let modules = null;
  let session = null;
  let idleTimer = null;
  let queue = Promise.resolve();

  const getModules = () => (modules ||= loadModules());
  // Serialize every device operation; the recorder handles one SCSI command stream at a time.
  const exclusive = (task) => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };
  const touch = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { exclusive(release).catch(() => {}); }, IDLE_RELEASE_MS);
    idleTimer.unref?.();
  };

  function knownIds() {
    return getModules().himd.DevicesIds.filter((device) => device.vendorId !== 0x5341);
  }

  function connectedDevices() {
    const { usb } = getModules();
    if (!usb) return [];
    const ids = knownIds();
    return usb.getDeviceList().flatMap((device) => {
      const { idVendor, idProduct } = device.deviceDescriptor;
      const known = ids.find((id) => id.vendorId === idVendor && id.deviceId === idProduct);
      return known ? [{ device, vendorId: idVendor, productId: idProduct, name: known.name }] : [];
    });
  }

  async function release() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const current = session;
    session = null;
    if (!current) return;
    try { await current.fs.driver?.close?.(); } catch { /* The device may already be unplugged. */ }
    try { await current.webUsbDevice.close(); } catch { /* Already closed. */ }
    try { current.legacyDevice.close(); } catch { /* Already closed. */ }
  }

  function status() {
    const { usb, usbError } = getModules();
    if (!usb) {
      return { available: false, reason: "usb-module-missing", detail: usbError?.message || "", devices: [] };
    }
    let devices = [];
    try {
      devices = connectedDevices().map(({ vendorId, productId, name }) => ({ vendorId, productId, id: `${hex(vendorId)}:${hex(productId)}`, name }));
    } catch (error) {
      return { available: true, platform, devices, error: error.message };
    }
    return { available: true, platform, devices, open: Boolean(session) };
  }

  function open() {
    return exclusive(async () => {
      const { usb, himd } = getModules();
      if (!usb) throw Object.assign(new Error("The usb module is not installed."), { code: "usb-module-missing" });
      await release();
      const [found] = connectedDevices();
      if (!found) throw Object.assign(new Error("No Hi-MD device in Hi-MD mode was found."), { code: "no-device" });
      const legacyDevice = found.device;
      try {
        legacyDevice.open();
      } catch (error) {
        throw Object.assign(new Error(error.message), { code: "open-failed", id: `${hex(found.vendorId)}:${hex(found.productId)}` });
      }
      try {
        const usbInterface = legacyDevice.interface(0);
        if (platform !== "win32" && usbInterface.isKernelDriverActive()) usbInterface.detachKernelDriver();
      } catch { /* Windows has no kernel driver to detach; WinUSB must already be bound. */ }
      let webUsbDevice;
      try {
        webUsbDevice = await usb.WebUSBDevice.createInstance(legacyDevice);
        await webUsbDevice.open();
        if (platform === "linux") await webUsbDevice.reset();
      } catch (error) {
        try { legacyDevice.close(); } catch { /* Ignore. */ }
        throw Object.assign(new Error(error.message), { code: "open-failed", id: `${hex(found.vendorId)}:${hex(found.productId)}` });
      }
      const fs = new himd.UMSCHiMDFilesystem(webUsbDevice);
      try {
        // ElectronWMD also bypasses the FAT coherency checks; this mode only reads from the disc.
        await fs.init(true);
        const disc = await himd.HiMD.init(fs);
        session = { legacyDevice, webUsbDevice, fs, himd: disc, name: found.name, vendorId: found.vendorId, productId: found.productId };
      } catch (error) {
        session = { legacyDevice, webUsbDevice, fs };
        await release();
        throw Object.assign(new Error(error.message), { code: "himd-init-failed" });
      }
      touch();
      return {
        deviceName: `${session.name} (${hex(session.vendorId)}:${hex(session.productId)})`,
        discTitle: session.himd.getDiscTitle() || "",
        tracks: himd.getAllTracks(session.himd),
      };
    });
  }

  // Streams one track through onChunk(bytes, { format, estimatedBytes }); resolves when finished.
  function dumpTrack(index, onStart, onChunk) {
    return exclusive(async () => {
      if (!session?.himd) throw Object.assign(new Error("No Hi-MD device is open."), { code: "not-open" });
      touch();
      const { himd } = getModules();
      const track = Number(index);
      if (!Number.isInteger(track) || track < 0 || track >= session.himd.getTrackCount()) {
        throw Object.assign(new Error("Invalid track index."), { code: "bad-index" });
      }
      const { format, data } = himd.dumpTrack(session.himd, session.himd.trackIndexToTrackSlot(track));
      let started = false;
      for await (const { data: chunk, total } of data) {
        if (!started) {
          started = true;
          await onStart({ format, estimatedBytes: total * BLOCK_SIZE });
        }
        await onChunk(chunk);
        touch();
      }
      if (!started) await onStart({ format, estimatedBytes: 0 });
    });
  }

  return { status, open, dumpTrack, close: () => exclusive(release) };
}

// ---------------------------------------------------------------------------
// HTTP routes (mounted by server.mjs under /md-usb/)

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

// USB access is only for the Album Deck page running on this computer: the request must come from
// loopback, name a loopback Host (blocks DNS rebinding) and carry a custom header (forces a CORS
// preflight, which this server never approves, so other websites cannot call these routes).
export function isTrustedLocalRequest(request) {
  const address = request.socket?.remoteAddress || "";
  const host = String(request.headers.host || "").replace(/:\d+$/, "").replace(/^\[(.*)\]$/, "$1").toLowerCase();
  return LOOPBACK_ADDRESSES.has(address) && LOOPBACK_HOSTS.has(host) && request.headers["x-album-deck"] === "1";
}

function sendJson(response, status, payload) {
  const content = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": content.length, "Cache-Control": "no-store" });
  response.end(content);
}

export async function handleHiMDUsbRequest(request, response, pathname, service) {
  if (!isTrustedLocalRequest(request)) {
    sendJson(response, 403, { error: "forbidden" });
    return;
  }
  const route = `${request.method} ${pathname}`;
  try {
    if (route === "GET /md-usb/status") {
      sendJson(response, 200, service.status());
    } else if (route === "POST /md-usb/open") {
      sendJson(response, 200, await service.open());
    } else if (route === "POST /md-usb/close") {
      await service.close();
      sendJson(response, 200, { closed: true });
    } else if (route === "GET /md-usb/track") {
      const index = new URL(request.url, "http://127.0.0.1").searchParams.get("index");
      let aborted = false;
      request.on("close", () => { aborted = !response.writableFinished; });
      await service.dumpTrack(index, ({ format, estimatedBytes }) => {
        response.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Cache-Control": "no-store",
          "X-MD-Format": format,
          "X-MD-Estimated-Bytes": String(estimatedBytes),
        });
      }, (chunk) => new Promise((resolveWrite, reject) => {
        if (aborted) { reject(Object.assign(new Error("Client disconnected."), { code: "aborted" })); return; }
        response.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength), (error) => (error ? reject(error) : resolveWrite()));
      }));
      response.end();
    } else {
      sendJson(response, 404, { error: "not-found" });
    }
  } catch (error) {
    if (response.headersSent) response.destroy(error);
    else sendJson(response, ({ "bad-index": 400, "no-device": 404, "not-open": 409 })[error.code] || 500, { error: error.code || "failed", message: error.message, id: error.id });
  }
}
