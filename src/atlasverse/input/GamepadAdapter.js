import { BUTTON_ACTIONS, radialDeadzone } from './gamepadMappings.js'

export class GamepadAdapter {
  constructor({ onConnection, onSnapshot, onAction } = {}) {
    this.onConnection = onConnection || (() => {})
    this.onSnapshot = onSnapshot || (() => {})
    this.onAction = onAction || (() => {})
    this.gamepadIndex = null
    this.previousPressed = []
    this.frame = 0
    this.running = false
    this.lastSnapshotAt = 0
    this.handleConnected = this.handleConnected.bind(this)
    this.handleDisconnected = this.handleDisconnected.bind(this)
    this.poll = this.poll.bind(this)
  }

  start() {
    if (this.running) return
    this.running = true
    window.addEventListener('gamepadconnected', this.handleConnected)
    window.addEventListener('gamepaddisconnected', this.handleDisconnected)
    this.findExistingGamepad()
    this.frame = requestAnimationFrame(this.poll)
  }

  stop() {
    this.running = false
    cancelAnimationFrame(this.frame)
    window.removeEventListener('gamepadconnected', this.handleConnected)
    window.removeEventListener('gamepaddisconnected', this.handleDisconnected)
  }

  findExistingGamepad() {
    const pad = [...(navigator.getGamepads?.() || [])].find(Boolean)
    if (pad) this.connect(pad)
  }

  handleConnected(event) {
    this.connect(event.gamepad)
  }

  handleDisconnected(event) {
    if (event.gamepad.index !== this.gamepadIndex) return
    this.gamepadIndex = null
    this.previousPressed = []
    this.onConnection(null)
    this.findExistingGamepad()
  }

  connect(gamepad) {
    this.gamepadIndex = gamepad.index
    this.previousPressed = gamepad.buttons.map(() => false)
    this.onConnection(gamepad)
  }

  getGamepad() {
    if (this.gamepadIndex === null) return null
    return navigator.getGamepads?.()[this.gamepadIndex] || null
  }

  poll(timestamp) {
    if (!this.running) return
    let gamepad = this.getGamepad()
    if (!gamepad) {
      this.findExistingGamepad()
      gamepad = this.getGamepad()
    }

    if (gamepad) {
      const pressed = gamepad.buttons.map((button) => button.pressed || button.value > 0.62)
      pressed.forEach((isPressed, index) => {
        if (isPressed && !this.previousPressed[index]) {
          this.onAction({
            type: 'button',
            index,
            action: BUTTON_ACTIONS.get(index) || `Button ${index}`,
            value: gamepad.buttons[index]?.value || 1,
          })
        }
      })
      this.previousPressed = pressed

      if (timestamp - this.lastSnapshotAt >= 32) {
        const axes = [0, 1, 2, 3].map((index) => gamepad.axes[index] || 0)
        this.onSnapshot({
          gamepad,
          axes,
          move: radialDeadzone(axes[0], axes[1]),
          camera: radialDeadzone(axes[2], axes[3]),
          buttons: gamepad.buttons.map((button) => ({
            pressed: button.pressed,
            touched: button.touched,
            value: button.value,
          })),
        })
        this.lastSnapshotAt = timestamp
      }
    }

    this.frame = requestAnimationFrame(this.poll)
  }
}
