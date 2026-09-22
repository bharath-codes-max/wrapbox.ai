/**
 * Destination resolution — names → observable host sets. Extracted from
 * resolve.ts so the Capability Registry can consume it without a circular
 * import (capabilities → destination resolution, resolve → capabilities).
 */

import type { IntentClause } from "./schema";
import { resolveNames, resolveGroup, resolveCategory, type HostResolution } from "./destinations";

export interface DestinationResolution {
  /** Positive set: hosts the request must go TO. */
  hosts: string[];
  /** Complement set: hosts the request must NOT go to (the request may go
   *  anywhere else). Present for "any other destination" clauses. */
  notHosts: string[];
  /** Names that could not be resolved to any host. */
  unresolved: string[];
  /** Human trail for the UI. */
  trail: string[];
  /** True when the admin stated a destination but nothing resolved. */
  stated: boolean;
}

/**
 * Resolve a clause's destination to concrete, observable host sets.
 *
 * Every path here resolves DOWN to the hosts the admin actually named, never up
 * to a broader category. A group resolves to its members; a category resolves
 * only to the services tagged with it; a complement resolves to the hosts to
 * exclude. Anything that does not resolve is reported, not guessed.
 */
export function resolveDestination(clause: IntentClause): DestinationResolution {
  const d = clause.destination;
  const res: DestinationResolution = { hosts: [], notHosts: [], unresolved: [], trail: [], stated: false };
  if (!d) return res;
  res.stated = Boolean(d.host?.length || d.service?.length || d.group || d.notIn || d.category?.length || d.namedSet || d.trust);

  const add = (r: HostResolution, label: string, into: "hosts" | "notHosts") => {
    for (const x of r.resolved) res.trail.push(`${label}${x.name} → ${x.hosts.join(", ")}`);
    res[into].push(...r.hosts);
    res.unresolved.push(...r.unresolved);
  };

  if (d.host?.length) add(resolveNames(d.host), "", "hosts");
  if (d.service?.length) add(resolveNames(d.service), "", "hosts");
  if (d.group) {
    const g = resolveGroup(d.group);
    if (g.group) { res.trail.push(`${g.group.label} = [${g.group.members.join(", ")}]`); add(g, "  ", "hosts"); }
    else res.unresolved.push(d.group);
  }
  if (d.namedSet) res.unresolved.push(d.namedSet);

  // The complement first, because whether it resolved decides how a category
  // may be used alongside it.
  let complementStated = false;
  if (d.notIn) {
    complementStated = true;
    if (d.notIn.host?.length) add(resolveNames(d.notIn.host), "not ", "notHosts");
    if (d.notIn.service?.length) add(resolveNames(d.notIn.service), "not ", "notHosts");
    if (d.notIn.group) {
      const g = resolveGroup(d.notIn.group);
      if (g.group) { res.trail.push(`NOT IN ${g.group.label} = [${g.group.members.join(", ")}]`); add(g, "  not ", "notHosts"); }
      else res.unresolved.push(d.notIn.group);
    }
  }
  const complementUndefined = complementStated && res.notHosts.length === 0;

  // A category is only ever the admin saying "all X" — resolve to the tagged
  // services, which is still a concrete list, not a wildcard. How it combines
  // with a complement depends on what is being protected:
  //   PERMISSION  "may use any AI other than the banned ones"
  //               → ∈ catalog ∧ ∉ banned. The catalog under-covers "any", which
  //                 for a permission means: never wider than written.
  //   PROTECTION  "uploads to any AI other than ChatGPT need review"
  //               → ∉ {chatgpt} only. Bounding it by the catalog would let an
  //                 AI service we have not catalogued escape the review — a
  //                 protection must over-cover, never under-cover.
  // And if the excluded set never resolved ("sanctioned providers" was never
  // defined), "all minus X" is undefined: it must NOT collapse to "all".
  const isPermission = clause.decision === "ALLOW";
  if (!complementUndefined && (!complementStated || isPermission)) {
    for (const c of d.category ?? []) add(resolveCategory(c), `${c}: `, "hosts");
  } else if (complementStated && !isPermission) {
    for (const c of d.category ?? []) res.trail.push(`${c}: complement applies to every host, not only the catalogued ${c} services`);
  }
  if (complementUndefined) {
    // Nothing positive may survive an undefined complement.
    res.hosts = [];
  }
  res.hosts = [...new Set(res.hosts)];
  res.notHosts = [...new Set(res.notHosts)];
  res.unresolved = [...new Set(res.unresolved)];
  return res;
}

/** True when a destination was stated but resolves to nothing addressable. */
export function destinationUnresolved(clause: IntentClause): boolean {
  const r = resolveDestination(clause);
  return r.stated && r.hosts.length === 0 && r.notHosts.length === 0;
}

