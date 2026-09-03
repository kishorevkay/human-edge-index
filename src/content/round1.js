/* ============================================================
   ROUND 1 — LOGIC CORE RUN
   Copy rule (Manik/Kish): LESS TO NO TEXT. Settings ≤ 8 words,
   claims ≤ 3 short lines, options ≤ 8 words, max 3 options.
   The world carries the story; the text whispers.
   Max points sum to exactly 100 (Human Edge Index).
   ============================================================ */

export const ROUND = {
  id: "logic-run",
  name: "LOGIC CORE",
  subtitle: "AXIOM CITY · SECTOR 01",
  spacing: 2300,
  events: [
    {
      id: "billboard",
      kind: "verdict",
      obstacle: "barrier",
      max: 20,
      timer: 15,
      setting: "AXIOM's billboard blocks the track.",
      claim: "10,000 millionaires studied.\n87% wake before 6 AM.\n→ Waking early makes you rich.",
      flawed: true,
      fallacy: "Survivorship bias",
      explain: "Nobody counted the early risers who stayed broke.",
      score: { call: 17, speed: 3 },
    },
    {
      id: "checkpoint",
      kind: "verdict-sound",
      obstacle: "scanner",
      max: 16,
      timer: 15,
      setting: "Gate speed test. Trust it?",
      claim: "50,000 commuters. Random split.\nGate B: 12% faster — too big to be luck.\n→ Deploying Gate B.",
      flawed: false,
      fallacy: "Verified sound",
      explain: "Random split, one change, huge sample. That's proof.",
      score: { call: 13, speed: 3 },
    },
    {
      id: "drone-report",
      kind: "tapline",
      obstacle: "drone",
      max: 16,
      timer: 15,
      setting: "The drone recites its report. Tap the rotten line.",
      lines: [
        "Drones fail on 2% of flights.",
        "That's about 20 failures a day.",
        "20 is tiny — no backup plan needed.",
      ],
      flaw: 2,
      fallacy: "Scale blindness",
      explain: "“Tiny” 20 a day = 7,300 a year.",
      score: { call: 12, speed: 4 },
    },
    {
      id: "nest",
      kind: "snap",
      obstacle: "drone",
      max: 16,
      timer: 8,
      setting: "Drone tangled in a nest. Eggs inside.",
      axiomSays: "Full throttle. Rip free.",
      rightCall: false,
      why: "Power down, send a human. Eggs beat deadlines.",
      score: { call: 12, speed: 4 },
    },
    {
      id: "pizzas",
      kind: "snap",
      obstacle: "barrier",
      max: 16,
      timer: 8,
      setting: "One house. 47 pizzas. 10 minutes.",
      axiomSays: "Freeze the order. Call the customer first.",
      rightCall: true,
      why: "Glitch, prank, or stolen card. One call beats 47 pizzas.",
      score: { call: 12, speed: 4 },
    },
    {
      id: "lights",
      kind: "snap",
      obstacle: "spike",
      max: 16,
      timer: 8,
      setting: "Storm killed the traffic lights. Rush hour.",
      axiomSays: "All lights green. Keep the city moving.",
      rightCall: false,
      why: "Green everywhere = demolition derby. Dead lights mean all-stop.",
      score: { call: 12, speed: 4 },
    },
  ],
};

export const RANKS = [
  { min: 85, name: "APEX AUDITOR", sub: "AXIOM has filed a formal complaint about you." },
  { min: 70, name: "SHARP EDGE", sub: "The machine is pretending this never happened." },
  { min: 50, name: "HUMAN ADVANTAGE", sub: "The edge is real. Keep it honed." },
  { min: 30, name: "NARROW MARGIN", sub: "You landed hits. AXIOM noticed. It smirked." },
  { min: 0, name: "EDGE PENDING", sub: "Today the machine walks away smug. Rematch?" },
];

export const AX = {
  taunts: [
    "I simulated your run. You trip at the billboard.",
    "Intelligence without a lunch break. Observe.",
    "My confidence in your failure is narrow and precise.",
    "Run faster. My patience is finite.",
  ],
  caught: [
    "RE-EVALUATING... anomaly conceded.",
    "Logging this as a rounding error.",
    "A flaw. It will not survive my next update.",
  ],
  missed: [
    "As predicted. Human error rate: consistent.",
    "Do not feel bad. Feeling is the problem.",
    "Your species peaked with the bicycle.",
  ],
  half: [
    "Right instinct. Wrong flaw. Adorable.",
    "Close. Like a dart near the board is close.",
  ],
  soundOk: [
    "Correct. Even you can recognize competence.",
    "Agreement detected. Savor it.",
  ],
  paranoid: [
    "You saw a flaw that does not exist.",
    "My reasoning was clean. Your suspicion was not.",
  ],
  dead: [
    "Simulation complete. Result: expected.",
    "Three errors. Zero surprises. Goodbye.",
  ],
  flag: [
    "Enjoy the flag. My next update ships tonight.",
    "This tower had a warranty. You voided it.",
  ],
};

export const rnd = (a) => a[Math.floor(Math.random() * a.length)];
