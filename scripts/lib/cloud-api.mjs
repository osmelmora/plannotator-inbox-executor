const appIdPattern = /^app_[a-zA-Z0-9-]+$/;
const gitRemotePattern = /^\/git\/[^/]+\/[^/]+\.git$/;
const newlinePattern = /[\r\n]/;
/** Use only the official CLI's approved Git credential helper, in memory. */
export async function cloudApi(config, appId, cli, fetcher = fetch) {
  if (!appIdPattern.test(appId)) {
    throw new Error("Invalid app ID.");
  }
  const remote = new URL(await cli(["git", "--app", appId], { raw: true }));
  if (
    remote.protocol !== "https:" ||
    remote.username ||
    remote.password ||
    !gitRemotePattern.test(remote.pathname) ||
    remote.search ||
    remote.hash
  ) {
    throw new Error("Executor returned an unexpected Git remote.");
  }
  let token;
  async function refresh() {
    const answer = await cli(["credential", "get"], {
      raw: true,
      input: `protocol=https\nhost=${remote.host}\npath=${remote.pathname.slice(1)}\n\n`,
    });
    token = answer
      .split("\n")
      .find((line) => line.startsWith("password="))
      ?.slice(9);
    if (!token || newlinePattern.test(token)) {
      throw new Error("The official CLI returned no approved session.");
    }
  }
  await refresh();
  async function request(route, method, body) {
    const url = new URL(route, config.host);
    if (url.origin !== config.host || !route.startsWith("/")) {
      throw new Error("Cross-origin API request refused.");
    }
    let response;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      response = await fetcher(url, {
        method,
        redirect: "error",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      if (response.status !== 401 || attempt) {
        break;
      }
      await response.body?.cancel();
      await refresh();
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Executor ${method} ${url.pathname} failed (HTTP ${response.status}); response suppressed to protect credentials.`
      );
    }
    if (response.status === 204) {
      return null;
    }
    return response.json();
  }
  const context = await request("/api/context", "GET");
  if (!context.organization || config.organization !== context.organization) {
    throw new Error("Approved organization differs from configured target.");
  }
  const document = await request("/openapi.json", "GET");
  const operations = new Map();
  for (const [route, methods] of Object.entries(document.paths ?? {})) {
    for (const [method, value] of Object.entries(methods)) {
      if (value.operationId) {
        operations.set(value.operationId, {
          ...value,
          route,
          method: method.toUpperCase(),
        });
      }
    }
  }
  function describe(name) {
    const op = operations.get(name);
    if (!op) {
      throw new Error(`Host does not advertise ${name}.`);
    }
    return op;
  }
  async function call(name, { path = {}, query = {}, body } = {}) {
    const op = describe(name);
    if (path.app && path.app !== appId) {
      throw new Error("Cross-app request refused.");
    }
    if (path.organization && path.organization !== context.organization) {
      throw new Error("Cross-organization request refused.");
    }
    const parameters = {
      organization: context.organization,
      app: appId,
      ...path,
    };
    const route = op.route.replace(/\{([^}]+)\}/g, (_, key) => {
      if (typeof parameters[key] !== "string" || !parameters[key]) {
        throw new Error(`Missing route parameter ${key}.`);
      }
      return encodeURIComponent(parameters[key]);
    });
    const allowed = new Set(
      (op.parameters ?? []).filter((p) => p.in === "query").map((p) => p.name)
    );
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (!allowed.has(key)) {
        throw new Error(`Host does not advertise query ${key}.`);
      }
      if (value !== undefined) {
        search.set(key, value);
      }
    }
    return await request(
      route + (search.size ? `?${search}` : ""),
      op.method,
      body
    );
  }
  return { context, call, describe };
}
