import { z } from "zod";

/** Published data Workflows that fill or process an asset, with unreadable names withheld. */
export const workflowDataFlowsSchema = z.object({
  fills: z.array(z.object({ id: z.string(), name: z.string(), title: z.string() })),
  processes: z.array(z.object({ id: z.string(), name: z.string(), title: z.string() })),
  hidden: z.object({ fills: z.number().int().min(0), processes: z.number().int().min(0) }),
  truncated: z.boolean()
});
