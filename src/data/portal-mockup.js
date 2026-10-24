/** Example rows for the static parent-portal mockup. Not real families or schedules. */
export const lessons = [
  { id: 'ex-1', when: 'Tuesday, Nov 3, 2026', time: '4:00–4:30 PM', length: '30 min', swimmers: 'Swimmer A' },
  { id: 'ex-2', when: 'Thursday, Nov 5, 2026', time: '4:00–5:00 PM', length: '60 min', swimmers: 'Swimmer A and Swimmer B', uses: 'uses 2 lessons' },
  { id: 'ex-3', when: 'Saturday, Nov 7, 2026', time: '9:00–9:30 AM', length: '30 min', swimmers: 'Swimmer B' },
  { id: 'ex-4', when: 'Tuesday, Nov 10, 2026', time: '4:00–4:30 PM', length: '30 min', swimmers: 'Swimmer A' },
];

export const openSlots = [
  'Tuesday, Nov 17, 2026, 3:30–4:00 PM',
  'Thursday, Nov 19, 2026, 5:00–5:30 PM',
  'Saturday, Nov 21, 2026, 10:00–10:30 AM',
  'Tuesday, Nov 24, 2026, 4:30–5:00 PM',
];

export function lessonLabel(lesson) {
  const extra = lesson.uses ? `, ${lesson.uses}` : '';
  return `${lesson.when}, ${lesson.time} (${lesson.length}${extra}) — ${lesson.swimmers}`;
}
