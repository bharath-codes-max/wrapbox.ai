import type { Person } from "../data/people";
import { gateArgs, permittedArgs } from "../data/scenarios";
import { canonical, mintPermit, newDecisionId, sha256, short, signApproval } from "./permit";
import { approve, askPasskey, attachPermit, getState, toast, type Approval } from "./store";

export const approvalArgs = (a: Approval) => a.args ?? gateArgs(a.gate);
export const approvalPermitArgs = (a: Approval) => a.args ?? permittedArgs(a.gate);

/** Approve = passkey on the approver's device + a signature over the exact arguments. */
export async function approveWithPasskey(a: Approval, person: Person) {
  const args = approvalArgs(a);
  const hash = "sha256:" + (await sha256(canonical(args)));
  const ok = await askPasskey({ person, title: `Approve “${a.title}” requested for ${a.human.name}`, detail: `bound to args ${short(hash)}` });
  if (!ok) return false;
  const sig = await signApproval(person.id, { gate: a.gateId, args });
  approve(a.id, person.id, sig);
  const now = getState().approvals.find((x) => x.id === a.id);
  const done = now?.status === "approved";
  toast(done ? "Approved" : `Signed by ${person.name.split(" ")[0]}`, done ? "Minting a 60-second permit for this exact action" : `${(now?.quorum ?? 1) - (now?.approvedBy.length ?? 0)} more signature needed`, "allow");
  if (done && !now?.permit) {
    const g = a.gate;
    const permit = await mintPermit({
      id: a.permitId,
      decision_id: newDecisionId(),
      subject_agent: a.agentId,
      on_behalf_of: a.human.id,
      action: g.effect,
      resource: g.resource,
      environment: g.environment,
      approved_by: now!.approvedBy,
      args: approvalPermitArgs(a),
    });
    if (!getState().approvals.find((x) => x.id === a.id)?.permit) attachPermit(a.id, permit);
  }
  return true;
}
