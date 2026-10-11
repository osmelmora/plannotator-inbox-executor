/** Safe source defaults. The installer generates scoped grants in its private build tree. */
export interface Grant {
  credentialHash: string;
  environments: readonly string[];
  id: string;
  projects: readonly string[];
  role: "agent" | "reviewer";
}
export interface ProjectMapping {
  name: string;
  root: string;
}

// A source checkout authorizes nobody. Test fixtures live only in tests/harness.ts.
export const grants: Grant[] = [];
export const projects: Record<string, ProjectMapping> = {};
