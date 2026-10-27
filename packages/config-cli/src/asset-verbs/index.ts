import { listVerb } from "./list";
import { showVerb } from "./show";
import { pullVerb } from "./pull";
import { historyVerb } from "./history";
import { validateVerb } from "./validate";
import { putVerb } from "./put";
import { publishVerb } from "./publish";
import { testVerb } from "./test";
import { dryRunVerb } from "./dry-run";
import { unpublishVerb } from "./unpublish";
import { discardVerb } from "./discard";
import { discardDraftVerb } from "./discard-draft";
import { giveToolsVerb } from "./give-tools";
import { deleteVerb } from "./delete";
import { revertVerb } from "./revert";
import { setAvailabilityVerb } from "./set-availability";
import { setDefaultVerb } from "./set-default";
import { adoptVerb } from "./adopt";
import type { Verb } from "./types";

export const VERBS: Readonly<Record<string, Verb>> = {
  list: listVerb,
  show: showVerb,
  pull: pullVerb,
  history: historyVerb,
  validate: validateVerb,
  put: putVerb,
  publish: publishVerb,
  test: testVerb,
  "dry-run": dryRunVerb,
  unpublish: unpublishVerb,
  discard: discardVerb,
  "discard-draft": discardDraftVerb,
  "give-tools": giveToolsVerb,
  delete: deleteVerb,
  revert: revertVerb,
  "set-availability": setAvailabilityVerb,
  "set-default": setDefaultVerb,
  adopt: adoptVerb
};
