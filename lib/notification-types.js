// The notification types AKIBA sends and which channels each supports. Shared by the
// preferences screen and the server so they can never drift apart.
//
// In-app (the bell) is always on. `push` types are delivered as Web Push by notifyUser();
// `sms` types are queued as SMS by a database trigger. A type with neither is in-app only.
// `smsDefault` is what applies until the user picks something.

export const NOTIFICATION_GROUPS = [
  {
    title: "Money in and out",
    items: [
      { type: "deposit_confirmed", label: "Deposit confirmed", push: true },
      { type: "deposit_failed", label: "Deposit didn't go through", push: true },
      { type: "withdrawal_confirmed", label: "Withdrawal sent", push: true },
      { type: "withdrawal_failed", label: "Withdrawal didn't go through", push: true },
    ],
  },
  {
    title: "Balance and goals",
    items: [
      { type: "low_balance", label: "Low balance", sms: true, smsDefault: true },
      { type: "goal_created", label: "New goal created", sms: true, smsDefault: true },
      { type: "goal_milestone", label: "Goal milestones" },
      { type: "goal_complete", label: "Goal reached", push: true },
    ],
  },
  {
    title: "Spending",
    items: [
      { type: "allowance_warning", label: "Nearing your allowance" },
      { type: "allowance_exceeded", label: "Allowance exceeded" },
    ],
  },
  {
    title: "Saving habits",
    items: [
      { type: "auto_save", label: "Auto-save made", push: true },
      { type: "auto_save_skipped", label: "Auto-save skipped", push: true },
      { type: "deposit_reminder", label: "Deposit reminders", push: true },
    ],
  },
  {
    title: "From AKIBA",
    items: [
      { type: "feature", label: "New features", sms: true, smsDefault: true },
      { type: "monthly_summary", label: "Monthly summary", sms: true, smsDefault: false, push: true },
    ],
  },
];

export const ALL_NOTIFICATION_ITEMS = NOTIFICATION_GROUPS.flatMap((g) => g.items);

// prefs shape: { push: { [type]: boolean }, sms: { [type]: boolean } }. Anything that is not
// a real boolean is ignored, so a malformed value can never flip a channel on or off.
export function isChannelOn(prefs, channel, item) {
  const v = prefs?.[channel]?.[item.type];
  if (typeof v === "boolean") return v;
  return channel === "sms" ? Boolean(item.smsDefault) : true;
}

export function pushAllowed(prefs, type) {
  const v = prefs?.push?.[type];
  return typeof v === "boolean" ? v : true;
}
