/** User-facing sentences. Keep these free of dash characters. */

export const messages = {
  emailRequired: "Enter an email address.",
  emailInvalid: "Enter a valid email address.",
  linkReady: "If that email is on the list, a sign in link is ready.",
  linkInvalid: "This sign in link is not valid anymore. Request a new one.",
  signInAgain: "Sign in again.",
  clockInFirst: "Clock in before you clock out.",
  alreadyFinished: "This lesson is already finished.",
  alreadyClockedIn: "This lesson is already clocked in.",
  otherLessonOpen: "Clock out of the open lesson before you clock in to another.",
  previewOff: "Preview location is turned off.",
  locationRequired: "Location is required to clock in.",
  locationRequiredOut: "Location is required to clock out.",
  notYourLesson: "That lesson is not on your list.",
  instructorOnly: "Only an instructor can do that.",
  adminOnly: "Only an admin can open that.",
  parentOnly: "Only a parent can open that.",
  notToday: "Clock in is available on the day of the lesson.",
  clockedIn: "Clocked in.",
  clockedOutSubtracted: "Clocked out. One lesson was subtracted from the family count.",
  clockedOutUnchanged: "Clocked out. The lesson count was not changed.",
  clockedOutNoneLeft: "Clocked out. No lessons were left to subtract.",
  nothingToUndo: "There is no lesson count change to undo.",
  undone: "The lesson count was restored.",
  saved: "Saved.",
  radiusRange: "Enter a radius between 25 and 500 yards.",
  lateRange: "Enter a late threshold between 0 and 30 minutes.",
  arrivalRange: "Enter a text time between 1 and 30 minutes.",
  badSettings: "Check the settings and try again.",
  genericError: "Something went wrong. Try again.",
  notAvailable: "That action is not available.",
  tooLarge: "That request is too large.",
  badJson: "That request could not be read.",
  calendarNotConnected: "The lesson calendar is not connected yet.",
  trackerNotConnected: "The lesson tracker is not connected yet.",
  smsNotConfigured: "Text messages are not configured yet.",
  practiceData: "Practice data until the calendar and lesson tracker are connected.",
  onTime: "On time",
  late: "Late",
  notYet: "Not yet",
  stillInLesson: "Still in the lesson",
  upcoming: "Upcoming",
  inProgress: "In progress",
  finished: "Finished",
  notClockedIn: "Not clocked in",
} as const;

export function tooFarMessage(action: "clock in" | "clock out", yards: number, limit: number): string {
  return `You are about ${Math.round(yards)} yards away. Stay within ${limit} yards of the pool to ${action}.`;
}

export function minutesLateLabel(minutes: number): string {
  const rounded = Math.max(1, Math.round(minutes));
  return rounded === 1 ? "1 minute late" : `${rounded} minutes late`;
}

export function arrivalText(instructorFirst: string, childFirst: string, minutes: number): string {
  const instructor = instructorFirst || "Your instructor";
  const child = childFirst || "your child";
  return `${instructor} is about ${minutes} minutes away for ${child}'s lesson.`;
}
