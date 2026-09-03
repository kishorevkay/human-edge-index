const PRESETS = {
  select: [
    { duration: 55, strongMagnitude: 0.06, weakMagnitude: 0.22 },
  ],
  success: [
    { duration: 90, strongMagnitude: 0.14, weakMagnitude: 0.4 },
    { duration: 130, strongMagnitude: 0.34, weakMagnitude: 0.75, delay: 85 },
  ],
  impact: [
    { duration: 260, strongMagnitude: 1, weakMagnitude: 0.55 },
  ],
}

function actuatorFor(gamepad) {
  return gamepad?.vibrationActuator || gamepad?.hapticActuators?.[0] || null
}

export function describeHaptics(gamepad) {
  const actuator = actuatorFor(gamepad)
  if (!actuator) return { available: false, effects: [] }
  const effects = Array.isArray(actuator.effects) ? actuator.effects : []
  return { available: true, effects }
}

async function playSegment(actuator, segment) {
  const effect = actuator.effects?.includes('dual-rumble')
    ? 'dual-rumble'
    : actuator.effects?.[0] || 'dual-rumble'
  if (typeof actuator.playEffect === 'function') {
    return actuator.playEffect(effect, {
      startDelay: segment.delay || 0,
      duration: segment.duration,
      strongMagnitude: segment.strongMagnitude,
      weakMagnitude: segment.weakMagnitude,
      leftTrigger: segment.leftTrigger || 0,
      rightTrigger: segment.rightTrigger || 0,
    })
  }
  if (typeof actuator.pulse === 'function') {
    return actuator.pulse(
      Math.max(segment.strongMagnitude, segment.weakMagnitude),
      segment.duration,
    )
  }
  throw new Error('This browser does not expose a supported haptics method.')
}

export async function playRumble(gamepad, presetName) {
  const actuator = actuatorFor(gamepad)
  if (!actuator) throw new Error('Standard controller haptics are unavailable.')
  const segments = PRESETS[presetName]
  if (!segments) throw new Error(`Unknown haptic preset: ${presetName}`)
  for (const segment of segments) {
    if (segment.delay) await new Promise((resolve) => setTimeout(resolve, segment.delay))
    await playSegment(actuator, { ...segment, delay: 0 })
  }
}
