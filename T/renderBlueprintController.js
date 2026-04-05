import axios from "axios";

const RENDER_API_BASE = "https://api.render.com/v1";

function slugifyClientName(value = "client") {
  const raw = String(value || "client").trim();
  const firstToken = raw.split(/\s+/).filter(Boolean)[0] || raw;
  return (
    String(firstToken || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "client"
  );
}

export function createRenderServiceName(clientName = "client") {
  const suffix = Math.random().toString(36).substring(2, 9);
  return `${slugifyClientName(clientName)}-${suffix}`;
}

export function generateRenderBlueprintYaml({
  clientName = "client",
  repoUrl = "",
  branch = "main",
  rootDir = ".",
} = {}) {
  const serviceName = createRenderServiceName(clientName);
  const cleanRepoUrl = String(repoUrl || "").trim();
  const cleanBranch = String(branch || "main").trim() || "main";
  const cleanRootDir = String(rootDir || ".").trim() || ".";
  const renderYaml = `services:
  - type: web
    name: ${serviceName}
    runtime: node
    repo: ${cleanRepoUrl}
    branch: ${cleanBranch}
    rootDir: ${cleanRootDir}
    plan: free
    autoDeploy: true
    buildCommand: npm install
    startCommand: npm run dev
    envVars:
      - key: NODE_ENV
        value: production
`;
  return { serviceName, renderYaml };
}

function buildRenderApiClient() {
  const apiKey = String(process.env.RENDER_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("RENDER_API_KEY is missing. Add it to your environment before deploying.");
  }
  return axios.create({
    baseURL: RENDER_API_BASE,
    timeout: 30000,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
}

function buildRenderBlueprintForm({ renderYaml = "", repoUrl = "" } = {}) {
  const form = new FormData();
  form.append(
    "renderYaml",
    new Blob([String(renderYaml || "")], { type: "application/yaml" }),
    "render.yaml",
  );
  if (repoUrl) {
    form.append("repo", String(repoUrl).trim());
  }
  return form;
}

function formatRenderApiError(error) {
  const status = error?.response?.status || error?.status || 500;
  const message =
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    "Render deployment failed.";
  const lowered = String(message).toLowerCase();
  if (status === 401 || status === 403) {
    return "Render authorization failed. Check your RENDER_API_KEY and try again.";
  }
  if (status === 409 || lowered.includes("already taken") || lowered.includes("already exists")) {
    return "Render could not create the service because that name is already taken. Try again and MediaLab will generate a fresh name.";
  }
  return message;
}

export async function createRenderBlueprintInstance({
  clientName = "client",
  repoUrl = "",
  branch = "main",
  rootDir = ".",
} = {}) {
  if (!String(repoUrl || "").trim()) {
    throw new Error("A Git repository URL is required before deploying to Render.");
  }
  const client = buildRenderApiClient();
  const { serviceName, renderYaml } = generateRenderBlueprintYaml({
    clientName,
    repoUrl,
    branch,
    rootDir,
  });
  try {
    const form = buildRenderBlueprintForm({ renderYaml, repoUrl });
    const response = await client.post("/blueprints", form, {
      headers: {
        ...(typeof form.getHeaders === "function" ? form.getHeaders() : {}),
      },
      maxBodyLength: Infinity,
    });
    return {
      serviceName,
      renderYaml,
      data: response.data,
    };
  } catch (error) {
    throw new Error(formatRenderApiError(error));
  }
}

export function extractRenderDeploySuccessPayload(payload = {}) {
  const eventType =
    payload?.type || payload?.eventType || payload?.event || payload?.kind || "";
  const loweredType = String(eventType || "").toLowerCase();
  if (loweredType !== "deploy.succeeded") {
    return null;
  }
  const service = payload?.service || payload?.data?.service || {};
  const deploy = payload?.deploy || payload?.data?.deploy || {};
  const serviceName = String(service?.name || "").trim();
  const serviceId = String(service?.id || deploy?.serviceId || "").trim();
  const serviceUrl = String(service?.url || payload?.url || "").trim();
  if (!serviceName || !serviceUrl) return null;
  return {
    eventType: loweredType,
    serviceName,
    serviceId,
    serviceUrl,
  };
}
