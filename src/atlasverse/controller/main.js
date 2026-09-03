import './style.css'
import { GamepadAdapter } from '../input/GamepadAdapter.js'
import { DUALSENSE_BUTTONS } from '../input/gamepadMappings.js'
import { describeHaptics, playRumble } from '../input/haptics.js'
import { DualSenseHID } from '../input/DualSenseHID.js'

const $ = (selector) => document.querySelector(selector)
const $$ = (selector) => [...document.querySelectorAll(selector)]

const elements = {
  pill: $('#connection-pill'),
  connectionLabel: $('#connection-label'),
  deviceName: $('#device-name'),
  transport: $('#transport-value'),
  mapping: $('#mapping-value'),
  haptics: $('#haptics-value'),
  adaptive: $('#adaptive-value'),
  enableHid: $('#enable-hid'),
  hidNote: $('#hid-note'),
  reset: $('#reset-lab'),
  testResult: $('#test-result'),
  frameStatus: $('#frame-status'),
  triggerResistance: $('#trigger-resistance'),
  triggerOff: $('#trigger-off'),
  lightbar: $('#lightbar-test'),
  leftStick: $('#left-stick'),
  rightStick: $('#right-stick'),
  l2Fill: $('#l2-fill'),
  r2Fill: $('#r2-fill'),
}

let activeGamepad = null
const hid = new DualSenseHID()

function renderMapping() {
  $('#mapping-grid').innerHTML = DUALSENSE_BUTTONS
    .map(
      (entry) => `
        <article class="mapping-card${entry.availability ? ' is-passive' : ''}" data-map-index="${entry.index}">
          <div class="control-key">${entry.control}</div>
          <div>
            <strong>${entry.action}</strong>
            <span>${
              entry.availability === 'system'
                ? 'OS controlled — not a game input'
                : entry.availability === 'usb'
                  ? 'USB/WebHID test tomorrow'
                  : entry.keyboard
            }</span>
          </div>
        </article>
      `,
    )
    .join('')
}

function setConnection(gamepad) {
  activeGamepad = gamepad
  if (!gamepad) {
    elements.pill.dataset.state = 'waiting'
    elements.connectionLabel.textContent = 'Press any controller button'
    elements.deviceName.textContent = 'Waiting'
    elements.mapping.textContent = '—'
    elements.haptics.textContent = 'Not detected'
    return
  }
  const haptics = describeHaptics(gamepad)
  elements.pill.dataset.state = 'connected'
  elements.connectionLabel.textContent = 'DualSense connected'
  elements.deviceName.textContent = gamepad.id.replace(/\s*\([^)]*\)\s*/g, ' ').trim()
  elements.transport.textContent = 'Bluetooth / Gamepad API'
  elements.mapping.textContent = gamepad.mapping || 'raw'
  elements.haptics.textContent = haptics.available
    ? haptics.effects.length
      ? haptics.effects.join(' + ')
      : 'Actuator detected'
    : 'Unavailable in this browser'
  elements.frameStatus.textContent = `Polling controller ${gamepad.index} at display refresh rate`
}

function setAxis(index, value) {
  const bar = $(`#axis-${index}`)
  const label = $(`#axis-${index}-value`)
  if (!bar || !label) return
  const percent = Math.min(100, Math.abs(value) * 100)
  bar.style.width = `${percent}%`
  bar.style.transformOrigin = value < 0 ? 'right center' : 'left center'
  bar.style.left = value < 0 ? `${50 - percent / 2}%` : '50%'
  label.textContent = value.toFixed(2)
}

function setStick(element, x, y) {
  element.style.transform = `translate(${x * 12}px, ${y * 12}px)`
}

function renderSnapshot(snapshot) {
  snapshot.axes.forEach((value, index) => setAxis(index, value))
  setStick(elements.leftStick, snapshot.move.x, snapshot.move.y)
  setStick(elements.rightStick, snapshot.camera.x, snapshot.camera.y)
  const l2 = snapshot.buttons[6]?.value || 0
  const r2 = snapshot.buttons[7]?.value || 0
  elements.l2Fill.style.transform = `scaleY(${l2})`
  elements.r2Fill.style.transform = `scaleY(${r2})`

  $$('[data-input]').forEach((node) => {
    const button = snapshot.buttons[Number(node.dataset.input)]
    node.classList.toggle('is-active', Boolean(button?.pressed || button?.value > 0.18))
  })
  $$('.mapping-card').forEach((node) => {
    const button = snapshot.buttons[Number(node.dataset.mapIndex)]
    node.classList.toggle('is-active', Boolean(button?.pressed || button?.value > 0.18))
  })
}

function announceAction(event) {
  elements.testResult.textContent = `${event.action} · input confirmed`
  elements.testResult.classList.add('is-live')
  window.setTimeout(() => elements.testResult.classList.remove('is-live'), 450)
}

async function runRumble(name) {
  try {
    await playRumble(activeGamepad, name)
    elements.testResult.textContent = `${name[0].toUpperCase() + name.slice(1)} feedback sent.`
  } catch (error) {
    elements.testResult.textContent = error.message
  }
}

function setAdvancedState(result) {
  const isUsb = result?.transport === 'usb'
  elements.transport.textContent = result ? `${result.transport.toUpperCase()} / WebHID` : 'Bluetooth expected'
  elements.adaptive.textContent = isUsb ? 'Ready to test' : result ? 'USB cable required' : 'USB cable required'
  elements.triggerResistance.disabled = !isUsb
  elements.triggerOff.disabled = !result
  elements.lightbar.disabled = !result
  elements.enableHid.textContent = result
    ? isUsb
      ? 'DualSense USB enabled'
      : 'DualSense linked over Bluetooth'
    : 'Enable DualSense USB features'
  elements.hidNote.textContent = isUsb
    ? 'Advanced output is armed. Use the three USB controls below.'
    : result
      ? 'Controller permission is saved. Plug in the USB data cable tomorrow and reload this page.'
      : 'Chrome or Brave will ask you to choose the controller once. Advanced output remains optional.'
}

async function connectHid() {
  try {
    elements.enableHid.disabled = true
    const result = await hid.connect()
    setAdvancedState(result)
    if (result.transport === 'usb') await hid.atlasLightbar()
  } catch (error) {
    elements.hidNote.textContent = error.message
  } finally {
    elements.enableHid.disabled = false
  }
}

async function runAdvanced(action, successMessage) {
  try {
    await action()
    elements.testResult.textContent = successMessage
  } catch (error) {
    elements.testResult.textContent = error.message
  }
}

renderMapping()

const adapter = new GamepadAdapter({
  onConnection: setConnection,
  onSnapshot: renderSnapshot,
  onAction: announceAction,
})
adapter.start()

$$('[data-rumble]').forEach((button) => {
  button.addEventListener('click', () => runRumble(button.dataset.rumble))
})

elements.enableHid.addEventListener('click', connectHid)
elements.triggerResistance.addEventListener('click', () =>
  runAdvanced(() => hid.resistance(), 'Adaptive resistance sent to L2 and R2.'),
)
elements.triggerOff.addEventListener('click', () =>
  runAdvanced(() => hid.release(), 'Adaptive triggers released.'),
)
elements.lightbar.addEventListener('click', () =>
  runAdvanced(() => hid.atlasLightbar(), 'Atlas teal lightbar sent.'),
)
elements.reset.addEventListener('click', async () => {
  if (hid.device?.opened) await hid.release().catch(() => {})
  window.location.reload()
})

hid.reconnectAuthorized().then(setAdvancedState).catch(() => setAdvancedState(null))

window.addEventListener('beforeunload', () => adapter.stop())
