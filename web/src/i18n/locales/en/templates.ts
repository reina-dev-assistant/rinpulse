export default {
  title: "Start from a template",
  description: "Each one is a normal face you can change. Loading it replaces the current face, and Undo brings yours back.",
  empty: "Empty",
  blank: { name: "Blank face", blurb: "Black screen with a time. Add what you need." },
  loaded: "{{name}} loaded",
  loadedHint: "Press Ctrl+Z to go back to your previous face.",
  layers: { time: "Time", date: "Date" },
  items: {
    quiet: { name: "Quiet", blurb: "Time and date on black. Nothing else." },
    "stack-ring": { name: "Stack", blurb: "Big stacked digits inside a steps ring." },
    classic: { name: "Classic", blurb: "Analog dial with three hands and a date." },
    photo: { name: "Photo", blurb: "Your photo behind bold time. Swap the sample backdrop." },
    sport: { name: "Sport", blurb: "Time on top, steps, heart rate and battery in view." },
    orbit: { name: "Orbit", blurb: "Analog hands inside steps and battery rings." },
  },
} as const;
