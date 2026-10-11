/** Modified for plannotator-inbox-executor. Original Plannotator attribution and
 * license are retained; adaptation details: docs/ui-fork-changes.md and UPSTREAM.json. */
import { createContext, useContext } from "react";
import type { ValidatedMap } from "../hooks/useValidatedCodePaths.js";

export interface CodePathValidationContextValue {
	validated: ValidatedMap;
	ready: boolean;
}

export const CodePathValidationContext =
	createContext<CodePathValidationContextValue | null>(null);

export function useCodePathValidation(): CodePathValidationContextValue | null {
	return useContext(CodePathValidationContext);
}
