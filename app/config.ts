/** Safe source defaults. The installer generates scoped grants in its private build tree. */
export type Grant = {
  id: string;
  role: "agent" | "reviewer";
  environments: readonly string[];
  projects: readonly string[];
  credentialHash: string;
};
export type ProjectMapping = { name: string; root: string };

// A source checkout authorizes nobody. Test fixtures live only in tests/harness.ts.
export const grants: Grant[] = [];
export const projects: Record<string, ProjectMapping> = {};
