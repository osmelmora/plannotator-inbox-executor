import { spawn } from "node:child_process";

export const CLI_VERSION = "2.0.0-beta.14";
export function run(
  command,
  args,
  { cwd, input = "", quiet = false, timeout = 120_000 } = {}
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
    });
    let output = "",
      errors = "";
    child.stdout.on("data", (bytes) => {
      output += bytes;
    });
    child.stderr.on("data", (bytes) => {
      errors += bytes;
    });
    child.on("error", () => reject(new Error(`${command} could not start.`)));
    child.on("close", (status) =>
      status === 0
        ? resolve(output.trim())
        : reject(
            new Error(
              quiet
                ? `${command} failed (${status}); check the approved Executor login and organization.`
                : `${command} failed (${status}): ${errors.slice(-5000) || output.slice(-5000)}`
            )
          )
    );
    child.stdin.end(input);
  });
}
export function officialCli(config, runner = run) {
  return async (args, { raw = false, input = "" } = {}) => {
    const output = await runner(
      "pnpm",
      [
        `--package=executor@${CLI_VERSION}`,
        "dlx",
        "executor",
        "apps",
        ...args,
        ...(args[0] === "credential"
          ? []
          : ["--host", config.host, "--organization", config.organization]),
      ],
      { input, quiet: true }
    );
    if (raw) {
      return output;
    }
    try {
      return JSON.parse(output);
    } catch {
      // biome-ignore lint/style/useErrorCause: CLI JSON errors may include credential-helper output; never reflect its contents.
      throw new Error("Executor CLI returned unexpected JSON.");
    }
  };
}
