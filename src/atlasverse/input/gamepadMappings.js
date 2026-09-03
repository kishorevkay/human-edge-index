export const DUALSENSE_BUTTONS = [
  { index: 0, control: 'Cross', action: 'Jump / confirm', keyboard: 'Space' },
  { index: 1, control: 'Circle', action: 'Back / cancel', keyboard: 'Escape' },
  { index: 2, control: 'Square', action: 'Interact / Human Instinct', keyboard: 'E' },
  { index: 3, control: 'Triangle', action: 'Skill Shop menu', keyboard: 'Tab' },
  { index: 4, control: 'L1', action: 'Previous tool or quest', keyboard: 'Q' },
  { index: 5, control: 'R1', action: 'Sprint (hold)', keyboard: 'Shift' },
  { index: 6, control: 'L2', action: 'Focus / scan', keyboard: 'Shift' },
  { index: 7, control: 'R2', action: 'Primary action', keyboard: 'Mouse 1' },
  { index: 8, control: 'Create', action: 'Share card', keyboard: 'C' },
  { index: 9, control: 'Options', action: 'Pause', keyboard: 'P' },
  { index: 10, control: 'L3', action: 'Reserved movement skill', keyboard: '—' },
  { index: 11, control: 'R3', action: 'Recenter camera', keyboard: 'F' },
  { index: 12, control: 'D-pad Up', action: 'Navigate up', keyboard: '↑' },
  { index: 13, control: 'D-pad Down', action: 'Navigate down', keyboard: '↓' },
  { index: 14, control: 'D-pad Left', action: 'Navigate left', keyboard: '←' },
  { index: 15, control: 'D-pad Right', action: 'Navigate right', keyboard: '→' },
  { index: 16, control: 'PS', action: 'System reserved', keyboard: 'macOS', availability: 'system' },
  { index: 17, control: 'Touchpad click', action: 'World map', keyboard: 'M' },
  { index: 18, control: 'Mute', action: 'Voice / mic toggle', keyboard: 'V', availability: 'usb' },
]

export const BUTTON_ACTIONS = new Map(
  DUALSENSE_BUTTONS.map((entry) => [entry.index, entry.action]),
)

export const DEADZONE = 0.2

export function radialDeadzone(x, y, deadzone = DEADZONE) {
  const magnitude = Math.hypot(x, y)
  if (magnitude <= deadzone) return { x: 0, y: 0, magnitude: 0 }
  const scaled = Math.min(1, (magnitude - deadzone) / (1 - deadzone))
  const curved = scaled * scaled * (3 - 2 * scaled)
  return {
    x: (x / magnitude) * curved,
    y: (y / magnitude) * curved,
    magnitude: curved,
  }
}
