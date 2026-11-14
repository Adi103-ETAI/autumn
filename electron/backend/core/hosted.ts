// autumn — the core protocol's hosted groups (Wave 4, doc 35 §7).
//
// The hosted tier — the cloud agents and the hosted workspace — is the part
// of the product that lives on someone else's machine. It is not built here,
// and the methods say so: they answer `not-implemented` with the reason.
//
// The method EXISTS, so the protocol is complete and a client gets an honest
// answer instead of "no handler for core.hosted.status".

import type { RegisteredHandler } from "../handlers";
import { notAvailable } from "./support";

const HOSTED_REASON =
  "the hosted tier is not part of this build — autumn is local-first, so there is no cloud workspace to talk to";

export function makeCoreHostedGroups(): RegisteredHandler[] {
  const hosted = (id: string, description: string): RegisteredHandler => ({
    kind: "core",
    id,
    description,
    handler: async () => notAvailable(HOSTED_REASON),
  });

  return [
    hosted("hosted.status", "the hosted workspace's status; params: {} -> not-implemented (no hosted tier)"),
    hosted("hosted.activityView", "the hosted activity; params: {} -> not-implemented (no hosted tier)"),
    hosted("hosted.configure", "configure the hosted workspace; params: {} -> not-implemented (no hosted tier)"),
    hosted("hosted.discover", "discover the hosted workspace; params: {} -> not-implemented (no hosted tier)"),
    hosted(
      "hosted.transferExecution",
      "move an execution to the hosted workspace; params: {} -> not-implemented (no hosted tier)",
    ),
    hosted("hosted.prepare", "prepare a hosted execution; params: {} -> not-implemented (no hosted tier)"),
    hosted("hosted.checkpoint", "checkpoint a hosted execution; params: {} -> not-implemented (no hosted tier)"),
    hosted("hosted.promote", "promote a hosted execution; params: {} -> not-implemented (no hosted tier)"),
    hosted("hosted.abort", "abort a hosted execution; params: {} -> not-implemented (no hosted tier)"),
    hosted("cloudAgent.deliver", "deliver to a cloud agent; params: {} -> not-implemented (no hosted tier)"),
    hosted(
      "cloudAgent.stageDelivery",
      "stage a delivery to a cloud agent; params: {} -> not-implemented (no hosted tier)",
    ),
    hosted(
      "cloudAgent.settleDeliveries",
      "settle the staged deliveries; params: {} -> not-implemented (no hosted tier)",
    ),
    hosted("cloudAgent.get", "read a cloud agent; params: {} -> not-implemented (no hosted tier)"),
    hosted("cloudAgent.list", "the cloud agents; params: {} -> not-implemented (no hosted tier)"),
    hosted("cloudAgent.save", "save a cloud agent; params: {} -> not-implemented (no hosted tier)"),
  ];
}
