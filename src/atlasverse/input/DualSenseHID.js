const SONY_VENDOR_ID = 0x054c
const DUALSENSE_PRODUCT_ID = 0x0ce6

function makeCrcTable() {
  const table = []
  for (let n = 0; n < 256; n += 1) {
    let value = n
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[n] = value >>> 0
  }
  return table
}

const CRC_TABLE = makeCrcTable()

function crc32(prefix, data) {
  let crc = -1 >>> 0
  for (const byte of prefix) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]
  for (const byte of data) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]
  return (crc ^ (-1)) >>> 0
}

function fillBluetoothChecksum(reportId, reportData) {
  const checksum = crc32([0xa2, reportId], reportData.subarray(0, -4))
  const offset = reportData.length - 4
  reportData[offset] = checksum & 0xff
  reportData[offset + 1] = (checksum >>> 8) & 0xff
  reportData[offset + 2] = (checksum >>> 16) & 0xff
  reportData[offset + 3] = (checksum >>> 24) & 0xff
}

function reportIds(device) {
  return device.collections.flatMap((collection) =>
    (collection.outputReports || []).map((report) => report.reportId),
  )
}

export class DualSenseHID {
  constructor() {
    this.device = null
    this.transport = null
    this.sequence = 0
  }

  get supported() {
    return 'hid' in navigator
  }

  async connect() {
    if (!this.supported) throw new Error('WebHID requires Chrome or Brave.')
    const devices = await navigator.hid.requestDevice({
      filters: [{ vendorId: SONY_VENDOR_ID, productId: DUALSENSE_PRODUCT_ID }],
    })
    if (!devices.length) throw new Error('No DualSense was selected.')
    this.device = devices[0]
    if (!this.device.opened) await this.device.open()
    const ids = reportIds(this.device)
    this.transport = ids.includes(0x02) ? 'usb' : ids.includes(0x31) ? 'bluetooth' : 'unknown'
    return { device: this.device, transport: this.transport, reportIds: ids }
  }

  async reconnectAuthorized() {
    if (!this.supported) return null
    const devices = await navigator.hid.getDevices()
    const device = devices.find(
      (item) => item.vendorId === SONY_VENDOR_ID && item.productId === DUALSENSE_PRODUCT_ID,
    )
    if (!device) return null
    this.device = device
    if (!device.opened) await device.open()
    const ids = reportIds(device)
    this.transport = ids.includes(0x02) ? 'usb' : ids.includes(0x31) ? 'bluetooth' : 'unknown'
    return { device, transport: this.transport, reportIds: ids }
  }

  async send({ leftTrigger, rightTrigger, color = [15, 180, 205], motors = [0, 0] } = {}) {
    if (!this.device?.opened) throw new Error('Enable DualSense USB features first.')
    const bluetooth = this.transport === 'bluetooth'
    const reportId = bluetooth ? 0x31 : 0x02
    const reportData = new Uint8Array(bluetooth ? 77 : 47)
    let commonOffset = 0
    if (bluetooth) {
      reportData[0] = this.sequence << 4
      this.sequence = (this.sequence + 1) % 16
      reportData[1] = 0x10
      commonOffset = 2
    }

    const common = new DataView(reportData.buffer, commonOffset, 47)
    common.setUint8(0, 0xff)
    common.setUint8(1, 0xf7)
    common.setUint8(2, motors[0] || 0)
    common.setUint8(3, motors[1] || 0)

    const writeTrigger = (offset, effect = [0, 0, 0, 0, 0, 0, 0, 0]) => {
      effect.slice(0, 8).forEach((value, index) => common.setUint8(offset + index, value || 0))
    }
    writeTrigger(10, rightTrigger)
    writeTrigger(21, leftTrigger)

    common.setUint8(39, 0x02)
    common.setUint8(41, 0x02)
    common.setUint8(43, 0x04)
    common.setUint8(44, color[0])
    common.setUint8(45, color[1])
    common.setUint8(46, color[2])

    if (bluetooth) fillBluetoothChecksum(reportId, reportData)
    await this.device.sendReport(reportId, reportData)
  }

  async resistance() {
    if (this.transport !== 'usb') {
      throw new Error('Use the USB data cable for the adaptive-trigger demo.')
    }
    const resistance = [0x01, 0x70, 0x78, 0, 0, 0, 0, 0]
    await this.send({
      leftTrigger: resistance,
      rightTrigger: resistance,
      color: [13, 174, 196],
    })
  }

  async release() {
    await this.send({
      leftTrigger: [0, 0, 0, 0, 0, 0, 0, 0],
      rightTrigger: [0, 0, 0, 0, 0, 0, 0, 0],
      color: [24, 42, 76],
    })
  }

  async atlasLightbar() {
    await this.send({ color: [13, 174, 196] })
  }
}

// Output layout and Bluetooth checksum are based on nondebug/dualsense's
// DualSense Explorer: https://github.com/nondebug/dualsense
