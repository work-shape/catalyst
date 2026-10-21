export const MAIL_SENDER_ACTIONS = [
  // Sending e-mail as one sender of the instance (`mail.send`). The `admin` role holds it on
  // the sender `system`; a member only by a grant.
  "mail_sender.use"
] as const;
