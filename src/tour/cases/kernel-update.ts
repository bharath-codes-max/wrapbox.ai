import type { TourCase } from "../types";

// Priya installs a Safety Kernel update: read the notes and the rule's impact
// on the company's own recorded history, install (the new rule starts in
// observe mode), switch it to enforcing, then prove it in Simulation Lab — the
// same force-push that used to wait for REVIEW is now blocked by the new rule.
const c: TourCase = {
  id: "kernel-update",
  order: 45,
  persona: { userId: "u-priya", name: "Priya Menon", role: "Admin" },
  title: "Install a safety update",
  goal: "Wrapbox has shipped a new built-in safety rule, and Priya wants it switched on without disrupting anyone's work.",
  outcome: "The new rule is installed and blocking: Priya first saw what it would have changed in the company's own history, then watched it stop a test force-push.",
  start: "control",
  poster: 5,
  steps: [
    {
      target: ".subbar",
      title: "A safety update has arrived",
      body: "Priya, the admin, spots a notice: the Safety Kernel, Wrapbox's own always-on safety rules, has a new version with one new rule.",
      say: "Okay, Priya's the admin, and there's a notice: the Safety Kernel, Wrapbox's own always-on safety rules, has a new version with one new rule. Priya wants it on without disrupting anyone.",
    },
    {
      target: { selector: ".subbar button", text: "Review & install" },
      action: "click",
      title: "Read before installing",
      body: "Nothing installs by itself. Priya opens the update to see what it would change first.",
      say: "Nothing installs by itself, though. Priya opens the update first, to see exactly what it would change.",
      waitFor: ".card.kernel-update",
    },
    {
      target: ".card.kernel-update ul",
      title: "What the new rule does",
      body: "A force-push overwrites the team's shared code history in one command. The rule blocks it on production branches (the live code), and the notes offer a safer route.",
      say: "A force-push overwrites the team's shared code history in one command. This rule blocks it on production branches, the live code, and the notes suggest a safer route.",
    },
    {
      target: ".kernel-impact",
      title: "Checked against past actions",
      body: "Wrapbox replays the new rule over every action already recorded. One past force-push was held for a person's approval (REVIEW); this rule would have blocked it outright.",
      say: "Here's the cool part: Wrapbox replays the new rule over every action already recorded. One past force-push was held for a person's okay, and this rule would've stopped it outright.",
    },
    {
      target: { selector: ".card.kernel-update button", text: "Install update" },
      action: "click",
      title: "Install the update",
      body: "Priya installs it. The new rule joins the built-in list, and the six rules already there carry on exactly as before.",
      say: "Priya installs it. The new rule joins the built-in list, and the six rules already there keep working exactly as before.",
      placement: "bottom",
      waitFor: { selector: ".ecard", text: "Protected history rewrite" },
    },
    {
      target: { selector: ".ecard", text: "Protected history rewrite" },
      title: "At first, it only watches",
      body: "OBSERVING: from now on the rule only counts what it would have blocked (none yet) and stops nothing. On the date shown, a week away, it starts blocking.",
      say: "At first, the rule just watches: it counts what it would've blocked, none yet, and stops nothing. It starts blocking on the date shown, a week from now.",
    },
    {
      target: { selector: ".ecard button", text: "Start enforcing now" },
      action: "click",
      title: "Or switch it on today",
      body: "Priya already saw its effect on past actions, so there's no need to wait a week. The card switches to ENFORCING: the rule now blocks.",
      say: "Priya's already seen its effect on past actions, so there's no need to wait a week. The card switches to enforcing, and now the rule actually blocks.",
      waitFor: { selector: ".ecard", text: "Protected history rewrite" },
    },
    {
      route: "simlab/gateway",
      target: { selector: ".stream-item", text: "Force push main" },
      action: "click",
      title: "Put it to the test",
      body: "Priya opens Simulation Lab, which plays practice agent actions through Wrapbox's real checks, and picks that same force-push. It now shows BLOCK; before the update it was REVIEW.",
      say: "Now Priya opens Simulation Lab, which plays practice agent actions through Wrapbox's real checks, and picks that same force-push. It used to wait for a person's okay, and now it's blocked.",
      waitFor: { selector: ".stream-item", text: "was REVIEW" },
    },
    {
      target: { selector: "button.btn-accent", text: "Run", exact: true },
      action: "click",
      title: "Blocked before it runs",
      body: "BLOCK: the force-push never happens. The new Safety Kernel rule made the call, and the agent is offered a safer route: a separate branch that teammates review first.",
      say: "Nice. The new Safety Kernel rule stops the force-push before it runs and offers the agent a safer route, a separate branch teammates review first. It's installed, and it's already blocking.",
      waitFor: { selector: ".aterm-line", text: "safer path" },
    },
  ],
};
export default c;
