import type { SmsAdapter } from "./adapters";
import { shouldSendArrivalText } from "./live-location";
import { arrivalText } from "./messages";

/**
 * Called by the live location phase when an ETA is known.
 * Sends one text per trip, and only to the family on that lesson.
 */
export async function maybeNotifyArrival(input: {
  enabled: boolean;
  etaMinutes: number | null;
  thresholdMinutes: number;
  alreadySent: boolean;
  instructorFirst: string;
  childFirst: string;
  to: string;
  sms: SmsAdapter;
}): Promise<{ sent: boolean; reason: string }> {
  const decision = shouldSendArrivalText({
    enabled: input.enabled,
    etaMinutes: input.etaMinutes,
    thresholdMinutes: input.thresholdMinutes,
    alreadySent: input.alreadySent,
  });
  if (!decision.send) return { sent: false, reason: decision.reason };
  await input.sms.send({
    to: input.to,
    body: arrivalText(input.instructorFirst, input.childFirst, input.thresholdMinutes),
  });
  return { sent: true, reason: decision.reason };
}
