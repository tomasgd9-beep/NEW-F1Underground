// The kinds of league email a person can turn on or off (safe to use in the browser).
export const EMAIL_KINDS = ["reminders", "recaps", "announcements", "commissioner"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const KIND_INFO: Record<EmailKind, { label: string; note: string; commissionerOnly?: boolean }> = {
  reminders: { label: "Deadline reminder", note: "a day before teams lock, with what's missing from your team" },
  recaps: { label: "Race recap", note: "after each weekend: podium, highlights, standings and the next race" },
  announcements: { label: "League announcements", note: "rule changes, a new season, messages from the commissioners" },
  commissioner: {
    label: "Commissioner notices",
    note: "teams locked (with the message for the group chat) and alerts when the score job fails",
    commissionerOnly: true,
  },
};

export type Prefs = { allOff: boolean } & Record<EmailKind, boolean>;
export const DEFAULT_PREFS: Prefs = { allOff: false, reminders: true, recaps: true, announcements: true, commissioner: true };

