export const copy = {
  appName: "Safe Swimming School",
  tagline: "Private swim lessons at your pool in Palm Beach County.",
  signInHeading: "Sign in",
  emailLabel: "Email",
  emailPlaceholder: "you@email.com",
  sendLink: "Send sign in link",
  linkHelp: "Use the link to open the app. It expires in 30 minutes.",
  previewHeading: "Preview accounts",
  previewHelp: "Email delivery is not connected yet. Pick an account to get a preview link.",
  openPreviewLink: "Open preview link",
  installHint: "You can add this app to your home screen.",
  privacy: "Privacy",
  signOut: "Sign out",
  instructor: "Instructor",
  admin: "Admin",
  lessonsLeft: "Lessons left",
  sharedBalance: "Brothers and sisters share this number.",
  upcoming: "Upcoming lessons",
  noUpcoming: "No upcoming lessons.",
  today: "Today",
  noLessonsToday: "No lessons today.",
  clockIn: "Clock in",
  clockOut: "Clock out",
  previewClockIn: "Use the pool location for this preview",
  previewClockOut: "Clock out with the pool location",
  openDirections: "Open directions",
  onTimeReport: "On time report",
  undo: "Undo lesson count",
  saveSettings: "Save settings",
  settingsHeading: "Settings",
  settingsIntro: "These choices are saved in the app. The 10 minute text and the live map arrive in a later update.",
  radiusLabel: "Clock in radius in yards",
  lateLabel: "Late after this many minutes",
  autoLabel: "Subtract a lesson at clock out",
  arrivalEnabledLabel: "Text the family when the instructor is close",
  arrivalMinutesLabel: "Minutes away before that text is sent",
  scheduled: "Scheduled",
  actual: "Actual",
  start: "Start",
  end: "End",
  loading: "Loading",
  working: "Working",
  locationFailed: "We could not read this phone location.",
  locationDenied: "Turn on location for this site, then try clock in again.",
  genericError: "Something went wrong. Try again.",
  back: "Back to the app",
  practiceData: "Practice data until the calendar and lesson tracker are connected.",
  view: "View",
};

export function clockedInAt(time) {
  return `Clocked in at ${time}`;
}

export function clockedOutAt(time) {
  return `Clocked out at ${time}`;
}

export function instructorLine(name) {
  return `Instructor: ${name}`;
}

export function lessonsLeftLine(count) {
  return count === 1 ? "1 lesson left" : `${count} lessons left`;
}
