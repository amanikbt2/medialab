import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import session from "express-session";
import MongoStore from "connect-mongo";
import passport from "passport";
import mongoose from "mongoose";
import "dotenv/config";
import multer from "multer";
import { google } from "googleapis";
import PDFDocument from "pdfkit";
import nodeFetch from "node-fetch";

// Models & Routes
import authRoutes, {
  buildGithubClient,
  decryptGoogleRefreshToken,
  generateReferralCode,
  initializeGithubStorageForUser,
  toSafeUser,
} from "./routes/authRoutes.js";
import User from "./models/User.js";
import Feedback from "./models/Feedback.js";
import UpgradeRequest from "./models/UpgradeRequest.js";
import UsageLog from "./models/UsageLog.js";
import Download from "./models/Download.js";
import WithdrawalRequest from "./models/WithdrawalRequest.js";
import MarketplaceItem from "./models/MarketplaceItem.js";
import BuilderTemplate from "./models/BuilderTemplate.js";
import Notification from "./models/Notification.js";
import ReferralLedger from "./models/ReferralLedger.js";
import CollaborationMeeting from "./models/CollaborationMeeting.js";
import AIModel from "./models/AIModel.js";
import AIContext from "./models/AIContext.js";
import VirtualDbModelSchema from "./models/VirtualDbModel.js";
import VirtualDbDocumentSchema from "./models/VirtualDbDocument.js";
import {
  createRenderBlueprintInstance,
  extractRenderDeploySuccessPayload,
} from "./controllers/renderBlueprintController.js";
import WorkflowBrain from "./WorkflowBrain.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize WorkflowBrain for natural language command processing
const workflowBrain = new WorkflowBrain({
  setAiAgentStage: (stage) => {
    // Used for internal state tracking
    console.log(`[WorkflowBrain] Agent stage: ${stage}`);
  },
  runDeterministicBuilderCommand: (command) => {
    // Fallback for deterministic commands (can be extended)
    return null;
  },
  getCanvasElement: () => {
    // Server-side doesn't have DOM, this is for client-side
    return null;
  },
});

const app = express();
const httpServer = createServer(app);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "spiderman";
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "dev@gmail.com")
  .trim()
  .toLowerCase();
const AI_MODEL_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AI_MODEL_REGISTRY = [
  // ========== WORKFLOW-ONLY SYSTEM ==========
  // These models are EXCLUSIVELY for the internal Workflow engine
  // NEVER fallback to online AI
  // NEVER shared with external AI chat
  {
    modelId: "openai/gpt-oss-120b",
    provider: "groq",
    priority: 1,
    type: "workflow",
  },
  {
    modelId: "openai/gpt-oss-20b",
    provider: "groq",
    priority: 2,
    type: "workflow",
  },
  {
    modelId: "llama-3.3-70b-versatile",
    provider: "groq",
    priority: 3,
    type: "workflow",
  },
  {
    modelId: "llama-3.1-8b-instant",
    provider: "groq",
    priority: 4,
    type: "workflow",
  },

  // ========== ONLINE EXCLUSIVE SYSTEM ==========
  // These models are EXCLUSIVELY for external online AI interactions
  // NEVER fallback to workflow algorithms
  // NEVER uses workflow parsing/processing
  { modelId: "groq/compound", provider: "groq", priority: 5, type: "online" },
  {
    modelId: "groq/compound-mini",
    provider: "groq",
    priority: 6,
    type: "online",
  },
  {
    modelId: "meta-llama/llama-4-scout-17b-16e-instruct",
    provider: "groq",
    priority: 7,
    type: "online",
  },
  { modelId: "qwen/qwen3-32b", provider: "groq", priority: 8, type: "online" },
];
const AI_MODEL_PREFERRED_ORDER = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "groq/compound",
  "groq/compound-mini",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "qwen/qwen3-32b",
];

app.engine("ejs", (filePath, _options, callback) => {
  fs.readFile(filePath, "utf8", callback);
});
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// --- 1. PRO PRODUCTION SETUP ---
// This is critical for Render/Heroku to handle HTTPS cookies correctly
app.set("trust proxy", 1);

const io = new Server(httpServer, {
  cors: {
    origin:
      process.env.NODE_ENV === "production"
        ? "https://medialab-6b20.onrender.com"
        : ["http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: true,
  },
});
const USER_NOTIFICATION_ROOM_PREFIX = "user:";
const COLLAB_ROOM_PREFIX = "collab:";
const collaborationRooms = new Map();
const socketCollaborationMembership = new Map();
const endedCollaborationRooms = new Map();
const collaborationHostGraceTimers = new Map();
const dataExplorerConnections = new Map();
const dataExplorerWatchers = new Map();
let virtualDbConnectionState = null;
const GROQ_API_KEY = String(
  process.env.GROQ_API_KEY || process.env.grog || "",
).trim();
let aiModelsLastRefreshedAt = 0;
let aiModelsRefreshTimer = null;
const aiModelCooldownUntil = new Map();

function parseRateLimitRetryMs(errorMessage = "") {
  const text = String(errorMessage || "");
  const match = text.match(/try again in\s+([0-9]+(?:\.[0-9]+)?)s/i);
  const seconds = Number(match?.[1] || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return 45_000;
  return Math.max(5_000, Math.min(180_000, Math.round(seconds * 1000)));
}

function buildEligibleAiModels(models = []) {
  const now = Date.now();
  const onlinePreferred = [];
  const activeFallback = [];
  for (const model of Array.isArray(models) ? models : []) {
    const modelId = String(model?.modelId || "").trim();
    if (!modelId) continue;
    const coolUntil = Number(aiModelCooldownUntil.get(modelId) || 0);
    if (coolUntil > now) continue;
    if (String(model?.status || "").toLowerCase() === "online") {
      onlinePreferred.push(model);
    } else {
      activeFallback.push(model);
    }
  }
  const ordered = [...onlinePreferred, ...activeFallback];
  if (ordered.length) return ordered;
  // If everything is cooling down, still probe all candidates to avoid deadlock.
  return Array.isArray(models) ? models : [];
}

/**
 * Build WORKFLOW-ONLY models (completely independent)
 * These models NEVER fallback to online AI
 * Workflow system is 100% autonomous
 */
function buildWorkflowOnlyModels(models = []) {
  const now = Date.now();
  const workflowModels = [];
  for (const model of Array.isArray(models) ? models : []) {
    const modelId = String(model?.modelId || "").trim();
    if (!modelId) continue;
    // Workflow uses models marked as "workflow" type
    const modelType = String(model?.type || "online").toLowerCase();
    if (modelType !== "workflow") continue; // SKIP offline/online models
    const coolUntil = Number(aiModelCooldownUntil.get(modelId) || 0);
    if (coolUntil > now) continue;
    if (String(model?.status || "").toLowerCase() === "online") {
      workflowModels.push(model);
    }
  }
  return workflowModels.length > 0 ? workflowModels : [];
}

/**
 * Build ONLINE-ONLY models (completely independent)
 * These models NEVER use workflow algorithms/fallback
 * Online AI system is 100% autonomous
 */
function buildOnlineOnlyModels(models = []) {
  const now = Date.now();
  const onlineModels = [];
  for (const model of Array.isArray(models) ? models : []) {
    const modelId = String(model?.modelId || "").trim();
    if (!modelId) continue;
    // Online AI uses models that are NOT marked as "workflow" type
    const modelType = String(model?.type || "online").toLowerCase();
    if (modelType === "workflow") continue; // SKIP workflow-only models
    const coolUntil = Number(aiModelCooldownUntil.get(modelId) || 0);
    if (coolUntil > now) continue;
    if (String(model?.status || "").toLowerCase() === "online") {
      onlineModels.push(model);
    }
  }
  return onlineModels.length > 0 ? onlineModels : [];
}

function getAiContextExpiryDate() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

async function upsertAIContext(userId = "", currentCode = "") {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId || !String(currentCode || "").trim()) return;
  await AIContext.findOneAndUpdate(
    { userId: normalizedUserId },
    {
      $set: {
        currentCode: String(currentCode || ""),
        updatedAt: new Date(),
        expiresAt: getAiContextExpiryDate(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

async function getAIContextCode(userId = "") {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return "";
  const row = await AIContext.findOne({ userId: normalizedUserId })
    .select("currentCode updatedAt expiresAt")
    .lean();
  if (!row?.currentCode) return "";
  return String(row.currentCode || "").trim();
}

function isSameCalendarDay(a = null, b = null) {
  if (!a || !b) return false;
  const dateA = new Date(a);
  const dateB = new Date(b);
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  );
}

function isUnlimitedAiUser(user = null) {
  const email = String(user?.email || "")
    .trim()
    .toLowerCase();
  return Boolean(user?.isPro) || email === ADMIN_EMAIL;
}

async function ensureAIModelsRegistry() {
  const before = await AIModel.countDocuments({});
  await Promise.all(
    AI_MODEL_REGISTRY.map((model) =>
      AIModel.updateOne(
        { modelId: model.modelId },
        {
          $setOnInsert: {
            modelId: model.modelId,
            provider: model.provider,
            priority: model.priority,
            isActive: true,
            status: "online",
            lastTested: new Date(),
          },
        },
        { upsert: true },
      ),
    ),
  );
  const after = await AIModel.countDocuments({});
  if (after > before) {
    console.log(`✅ AI model registry synced (${after} models)`);
  }
}

function buildPriorityForModel(modelId = "") {
  const normalized = String(modelId || "")
    .trim()
    .toLowerCase();
  const preferredIndex = AI_MODEL_PREFERRED_ORDER.findIndex(
    (item) => item.toLowerCase() === normalized,
  );
  if (preferredIndex >= 0) return preferredIndex + 1;
  return AI_MODEL_PREFERRED_ORDER.length + 100;
}

function isLikelyChatModel(modelId = "") {
  const id = String(modelId || "").toLowerCase();
  if (!id) return false;
  if (id.includes("whisper")) return false;
  if (id.includes("prompt-guard")) return false;
  if (id.includes("safeguard")) return false;
  return (
    id.includes("llama") ||
    id.includes("deepseek") ||
    id.includes("qwen") ||
    id.includes("gemma") ||
    id.includes("gpt-oss") ||
    id.includes("kimi") ||
    id.includes("compound") ||
    id.includes("allam") ||
    id.includes("orpheus")
  );
}

async function fetchAvailableGroqModels() {
  if (!GROQ_API_KEY) return [];
  const response = await nodeFetch("https://api.groq.com/openai/v1/models", {
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Could not fetch Groq models.");
  }
  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows
    .map((row) => ({
      modelId: String(row?.id || "").trim(),
      provider: "groq",
      priority: buildPriorityForModel(String(row?.id || "").trim()),
    }))
    .filter((row) => row.modelId && isLikelyChatModel(row.modelId))
    .sort(
      (a, b) => a.priority - b.priority || a.modelId.localeCompare(b.modelId),
    );
}

async function refreshAIModelsRegistryIfNeeded(force = false) {
  const now = Date.now();
  if (!force && now - aiModelsLastRefreshedAt < AI_MODEL_REFRESH_INTERVAL_MS)
    return;
  let sourceModels = [];
  try {
    sourceModels = await fetchAvailableGroqModels();
  } catch (error) {
    console.warn(
      "Groq models refresh failed, falling back to static registry:",
      error.message,
    );
    await createUsageLog({
      action: "ai-model-refresh-error",
      summary: `[error] AI model registry refresh failed: ${String(error?.message || "unknown")} - ${new Date().toISOString()} --source(ai-model-registry)`,
      source: "ai-model-registry",
      kind: "error",
      metadata: {
        endpoint: "https://api.groq.com/openai/v1/models",
      },
    });
  }
  if (!sourceModels.length) {
    sourceModels = AI_MODEL_REGISTRY.map((item) => ({
      modelId: item.modelId,
      provider: item.provider,
      priority: item.priority,
    }));
  }
  await Promise.all(
    sourceModels.map((model) =>
      AIModel.updateOne(
        { modelId: model.modelId },
        {
          $set: {
            provider: model.provider || "groq",
            priority: Number(
              model.priority || buildPriorityForModel(model.modelId),
            ),
            isActive: true,
          },
          $setOnInsert: {
            status: "online",
            lastTested: new Date(),
          },
        },
        { upsert: true },
      ),
    ),
  );
  aiModelsLastRefreshedAt = now;
}

function startAIModelsRefreshLoop() {
  if (aiModelsRefreshTimer) return;
  aiModelsRefreshTimer = setInterval(
    () => {
      refreshAIModelsRegistryIfNeeded(false).catch((error) => {
        console.warn("Scheduled AI model refresh failed:", error.message);
      });
    },
    Math.max(60_000, AI_MODEL_REFRESH_INTERVAL_MS),
  );
}

function getVirtualDbUri() {
  return (
    process.env.VIRTUALDB_MONGO_URI ||
    process.env.TEMP_MEDIALAB_MONGO_URI ||
    process.env.TEMP_MONGODB_URI ||
    ""
  );
}

async function getOrCreateVirtualDbConnection() {
  const uri = String(getVirtualDbUri() || "").trim();
  if (!uri) {
    throw new Error(
      "VirtualDB is not configured. Set VIRTUALDB_MONGO_URI in your environment.",
    );
  }
  if (virtualDbConnectionState?.connection?.readyState === 1) {
    return virtualDbConnectionState;
  }
  const connection = mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 15000,
    maxPoolSize: 8,
    minPoolSize: 0,
  });
  await connection.asPromise();
  const VirtualDbModel =
    connection.models.VirtualDbModel ||
    connection.model("VirtualDbModel", VirtualDbModelSchema, "virtual_models");
  const VirtualDbDocument =
    connection.models.VirtualDbDocument ||
    connection.model(
      "VirtualDbDocument",
      VirtualDbDocumentSchema,
      "virtual_documents",
    );
  virtualDbConnectionState = {
    uri,
    uriLabel: "virtual-medialabdb",
    dbName: connection.name,
    connection,
    VirtualDbModel,
    VirtualDbDocument,
    createdAt: new Date(),
  };
  return virtualDbConnectionState;
}

function requireAuth(req, res) {
  if (!req.isAuthenticated?.() || !req.user) {
    res.status(401).json({ success: false, message: "Login required." });
    return false;
  }
  return true;
}

function normalizeVirtualModelName(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^\w.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeDataExplorerCollectionName(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^\w.-]/g, "")
    .slice(0, 120);
}

function getDataExplorerChannelId(req) {
  if (!req?.session) return "";
  if (!req.session.dataExplorerChannelId) {
    req.session.dataExplorerChannelId = crypto.randomUUID();
  }
  return String(req.session.dataExplorerChannelId || "").trim();
}

function getDataExplorerSessionState(req) {
  if (!req?.session?.dataExplorer) return null;
  return req.session.dataExplorer;
}

function serializeExplorerValue(value) {
  if (value == null) return value;
  if (Array.isArray(value))
    return value.map((item) => serializeExplorerValue(item));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if (
      value?._bsontype === "ObjectId" ||
      value?.constructor?.name === "ObjectId"
    ) {
      return String(value);
    }
    if (value?._bsontype === "Decimal128") {
      return String(value);
    }
    const output = {};
    Object.entries(value).forEach(([key, inner]) => {
      output[key] = serializeExplorerValue(inner);
    });
    return output;
  }
  return value;
}

function collectExplorerFieldPaths(value, prefix = "", bucket = new Set()) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return bucket;
  Object.entries(value).forEach(([key, inner]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    bucket.add(nextKey);
    if (
      inner &&
      typeof inner === "object" &&
      !Array.isArray(inner) &&
      !(inner instanceof Date)
    ) {
      collectExplorerFieldPaths(inner, nextKey, bucket);
    }
  });
  return bucket;
}

function parseExplorerInputValue(rawValue) {
  const text = typeof rawValue === "string" ? rawValue.trim() : rawValue;
  if (text === "null") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "") return "";
  if (typeof text === "string" && /^-?\d+(\.\d+)?$/.test(text)) {
    return Number(text);
  }
  if (
    typeof text === "string" &&
    (text.startsWith("{") || text.startsWith("["))
  ) {
    try {
      return JSON.parse(text);
    } catch {
      return rawValue;
    }
  }
  return rawValue;
}

function getDataExplorerConnectionKey(uri = "") {
  return crypto
    .createHash("sha1")
    .update(String(uri || ""))
    .digest("hex");
}

async function getOrCreateDataExplorerConnection(uri = "") {
  const normalizedUri = String(uri || "").trim();
  if (!normalizedUri) {
    throw new Error("MongoDB URI is required.");
  }
  const key = getDataExplorerConnectionKey(normalizedUri);
  const existing = dataExplorerConnections.get(key);
  if (existing?.connection?.readyState === 1) {
    return existing;
  }
  const connection = mongoose.createConnection(normalizedUri, {
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 15000,
    maxPoolSize: 8,
    minPoolSize: 0,
  });
  await connection.asPromise();
  const state = {
    key,
    uri: normalizedUri,
    connection,
    dbName: connection.name,
    createdAt: new Date(),
  };
  dataExplorerConnections.set(key, state);
  return state;
}

function closeDataExplorerWatcher(key = "") {
  const watcher = dataExplorerWatchers.get(key);
  if (!watcher) return;
  try {
    watcher.changeStream?.close?.();
  } catch {}
  dataExplorerWatchers.delete(key);
}

async function ensureDataExplorerWatcher({
  ioInstance,
  connectionState,
  collectionName,
  channelId,
}) {
  const roomCollection = normalizeDataExplorerCollectionName(collectionName);
  if (
    !ioInstance ||
    !connectionState?.connection ||
    !roomCollection ||
    !channelId
  )
    return;
  const watcherKey = `${connectionState.key}:${roomCollection}`;
  const existing = dataExplorerWatchers.get(watcherKey);
  if (existing) {
    existing.channels.add(channelId);
    return;
  }
  let changeStream = null;
  try {
    changeStream = connectionState.connection
      .collection(roomCollection)
      .watch([], {
        fullDocument: "updateLookup",
      });
  } catch (error) {
    console.warn(
      `Data Explorer watch unavailable for ${roomCollection}:`,
      error.message,
    );
    return;
  }
  const channels = new Set([channelId]);
  changeStream.on("change", (change) => {
    const payload = {
      collection: roomCollection,
      operationType: String(change?.operationType || "").trim(),
      documentId:
        change?.documentKey?._id != null ? String(change.documentKey._id) : "",
      fullDocument: serializeExplorerValue(change?.fullDocument || null),
      updatedFields: serializeExplorerValue(
        change?.updateDescription?.updatedFields || {},
      ),
      removedFields: Array.isArray(change?.updateDescription?.removedFields)
        ? change.updateDescription.removedFields
        : [],
      updatedAt: Date.now(),
    };
    channels.forEach((channel) => {
      ioInstance
        .to(`data-explorer:${channel}`)
        .emit("data-explorer:change", payload);
    });
  });
  const cleanup = () => closeDataExplorerWatcher(watcherKey);
  changeStream.on("error", cleanup);
  changeStream.on("close", cleanup);
  dataExplorerWatchers.set(watcherKey, { changeStream, channels });
}

function normalizeCollaborationRoomId(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9-]/g, "")
    .slice(0, 120);
}

function normalizeCollaborationHostToken(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9-]/g, "")
    .slice(0, 180);
}

function clearCollaborationHostGrace(roomId = "") {
  const normalizedRoomId = normalizeCollaborationRoomId(roomId);
  const timer = collaborationHostGraceTimers.get(normalizedRoomId);
  if (timer) {
    clearTimeout(timer);
    collaborationHostGraceTimers.delete(normalizedRoomId);
  }
}

function scheduleCollaborationHostGrace(roomId = "", delayMs = 15000) {
  const normalizedRoomId = normalizeCollaborationRoomId(roomId);
  if (!normalizedRoomId) return;
  clearCollaborationHostGrace(normalizedRoomId);
  const timer = setTimeout(
    () => {
      collaborationHostGraceTimers.delete(normalizedRoomId);
      const room = collaborationRooms.get(normalizedRoomId);
      if (!room) return;
      const hasLiveHost = Boolean(
        room.hostSocketId && room.users.has(room.hostSocketId),
      );
      if (hasLiveHost) return;
      endCollaborationRoom(normalizedRoomId, "host-exited");
    },
    Math.max(1500, Number(delayMs) || 15000),
  );
  collaborationHostGraceTimers.set(normalizedRoomId, timer);
}

function ensureCollaborationRoom(roomId = "", options = {}) {
  const normalizedRoomId = normalizeCollaborationRoomId(roomId);
  if (!normalizedRoomId) return null;
  if (!collaborationRooms.has(normalizedRoomId)) {
    collaborationRooms.set(normalizedRoomId, {
      id: normalizedRoomId,
      hostSocketId: "",
      hostToken:
        normalizeCollaborationHostToken(options.hostToken) ||
        crypto.randomUUID(),
      users: new Map(),
      latestSnapshot: null,
      createdAt: new Date(),
    });
  }
  const room = collaborationRooms.get(normalizedRoomId);
  const nextHostToken = normalizeCollaborationHostToken(options.hostToken);
  if (room && nextHostToken) {
    room.hostToken = nextHostToken;
  }
  return room;
}

async function getCollaborationMeetingRecord(roomId = "") {
  const normalizedRoomId = normalizeCollaborationRoomId(roomId);
  if (!normalizedRoomId) return null;
  try {
    return await CollaborationMeeting.findOne({
      roomId: normalizedRoomId,
    }).lean();
  } catch (error) {
    console.warn("Collaboration meeting lookup failed:", error.message);
    return null;
  }
}

async function ensureCollaborationMeetingRecord(
  roomId = "",
  { hostToken = "", hostUserId = "", hostDisplayName = "" } = {},
) {
  const normalizedRoomId = normalizeCollaborationRoomId(roomId);
  const normalizedHostToken =
    normalizeCollaborationHostToken(hostToken) || crypto.randomUUID();
  if (!normalizedRoomId) return null;
  try {
    const existing = await CollaborationMeeting.findOne({
      roomId: normalizedRoomId,
    });
    if (existing) {
      let mutated = false;
      if (!existing.hostToken) {
        existing.hostToken = normalizedHostToken;
        mutated = true;
      }
      if (hostUserId && existing.hostUserId !== String(hostUserId).trim()) {
        existing.hostUserId = String(hostUserId).trim();
        mutated = true;
      }
      if (
        hostDisplayName &&
        existing.hostDisplayName !==
          String(hostDisplayName).trim().slice(0, 120)
      ) {
        existing.hostDisplayName = String(hostDisplayName).trim().slice(0, 120);
        mutated = true;
      }
      if (mutated) {
        await existing.save();
      }
      return existing.toObject();
    }
    const created = await CollaborationMeeting.create({
      roomId: normalizedRoomId,
      hostToken: normalizedHostToken,
      hostUserId: String(hostUserId || "").trim(),
      hostDisplayName: String(hostDisplayName || "")
        .trim()
        .slice(0, 120),
    });
    return created.toObject();
  } catch (error) {
    console.warn("Collaboration meeting persist failed:", error.message);
    return {
      roomId: normalizedRoomId,
      hostToken: normalizedHostToken,
      hostUserId: String(hostUserId || "").trim(),
      hostDisplayName: String(hostDisplayName || "")
        .trim()
        .slice(0, 120),
    };
  }
}

function deleteCollaborationMeetingRecord(roomId = "") {
  const normalizedRoomId = normalizeCollaborationRoomId(roomId);
  if (!normalizedRoomId) return;
  CollaborationMeeting.deleteOne({ roomId: normalizedRoomId }).catch(
    (error) => {
      console.warn("Collaboration meeting delete failed:", error.message);
    },
  );
}

function markCollaborationRoomEnded(roomId = "", reason = "ended") {
  const normalizedRoomId = normalizeCollaborationRoomId(roomId);
  if (!normalizedRoomId) return;
  endedCollaborationRooms.set(normalizedRoomId, {
    roomId: normalizedRoomId,
    reason: String(reason || "ended").trim() || "ended",
    endedAt: Date.now(),
  });
}

function getEndedCollaborationRoom(roomId = "") {
  const normalizedRoomId = normalizeCollaborationRoomId(roomId);
  if (!normalizedRoomId) return null;
  const ended = endedCollaborationRooms.get(normalizedRoomId);
  if (!ended) return null;
  if (Date.now() - Number(ended.endedAt || 0) > 1000 * 60 * 60 * 24) {
    endedCollaborationRooms.delete(normalizedRoomId);
    return null;
  }
  return ended;
}

function serializeCollaborationUser(user = {}) {
  return {
    socketId: String(user.socketId || "").trim(),
    userId: String(user.userId || "").trim(),
    displayName: String(user.displayName || "Guest").trim() || "Guest",
    color: String(user.color || "#22d3ee").trim() || "#22d3ee",
    isHost: Boolean(user.isHost),
    canEdit: Boolean(user.canEdit),
    isGuest: Boolean(user.isGuest),
    canAudio: Boolean(user.canAudio),
    canVideo: Boolean(user.canVideo),
    awaitingApproval: Boolean(user.awaitingApproval),
    pendingRequestKind:
      String(user.pendingRequestKind || "")
        .trim()
        .slice(0, 40) || "",
  };
}

function buildCollaborationRoomState(room) {
  const users = Array.from(room?.users?.values?.() || [])
    .map((user) => serializeCollaborationUser(user))
    .sort((a, b) => {
      if (a.isHost && !b.isHost) return -1;
      if (!a.isHost && b.isHost) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
  return {
    roomId: room?.id || "",
    hostSocketId: String(room?.hostSocketId || "").trim(),
    users,
    latestSnapshot: room?.latestSnapshot || null,
  };
}

function emitCollaborationRoomState(roomId = "") {
  const room = collaborationRooms.get(roomId);
  if (!room) return;
  io.to(`${COLLAB_ROOM_PREFIX}${roomId}`).emit(
    "collaboration:room-state",
    buildCollaborationRoomState(room),
  );
}

function removeSocketFromCollaborationRoom(socketId = "") {
  const roomId = socketCollaborationMembership.get(socketId);
  if (!roomId) return;
  const room = collaborationRooms.get(roomId);
  socketCollaborationMembership.delete(socketId);
  if (!room) return;
  if (room.hostSocketId === socketId) {
    room.users.delete(socketId);
    room.hostSocketId = "";
    scheduleCollaborationHostGrace(roomId, 15000);
    if (room.users.size) {
      emitCollaborationRoomState(roomId);
    }
    return;
  }
  room.users.delete(socketId);
  if (!room.users.size) {
    if (!room.hostSocketId) {
      scheduleCollaborationHostGrace(roomId, 15000);
    } else {
      collaborationRooms.delete(roomId);
      clearCollaborationHostGrace(roomId);
    }
    return;
  }
  emitCollaborationRoomState(roomId);
}

function endCollaborationRoom(roomId = "", reason = "host-ended") {
  const normalizedRoomId = normalizeCollaborationRoomId(roomId);
  if (!normalizedRoomId) return;
  clearCollaborationHostGrace(normalizedRoomId);
  const room = collaborationRooms.get(normalizedRoomId);
  if (room) {
    Array.from(room.users.values()).forEach((user) => {
      socketCollaborationMembership.delete(user.socketId);
      io.to(user.socketId).emit("collaboration:room-ended", {
        roomId: normalizedRoomId,
        reason,
        endedAt: Date.now(),
      });
    });
    collaborationRooms.delete(normalizedRoomId);
  }
  deleteCollaborationMeetingRecord(normalizedRoomId);
  markCollaborationRoomEnded(normalizedRoomId, reason);
}

function createMemoryRateLimiter({
  windowMs = 60 * 1000,
  max = 30,
  message = "Too many requests. Please slow down and try again shortly.",
} = {}) {
  const bucket = new Map();
  return (req, res, next) => {
    const key = `${req.ip || "unknown"}:${req.path}`;
    const now = Date.now();
    const entry = bucket.get(key);
    if (!entry || now - entry.start > windowMs) {
      bucket.set(key, { start: now, count: 1 });
      return next();
    }
    entry.count += 1;
    bucket.set(key, entry);
    if (entry.count > max) {
      return res.status(429).json({ success: false, message });
    }
    return next();
  };
}

const authRateLimit = createMemoryRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 24,
  message:
    "Too many authentication requests. Please wait a few minutes and try again.",
});
const publishRateLimit = createMemoryRateLimiter({
  windowMs: 2 * 60 * 1000,
  max: 10,
  message:
    "Too many publish attempts in a short time. Please wait a moment and try again.",
});
const accountRateLimit = createMemoryRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 15,
  message: "Too many account actions. Please wait a little and try again.",
});
const adminRateLimit = createMemoryRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: "Admin request limit reached. Please wait a moment.",
});

function requireAdminApi(req, res, next) {
  const provided = String(req.headers["x-admin-password"] || "").trim();
  const providedEmail = String(req.headers["x-admin-email"] || "")
    .trim()
    .toLowerCase();
  if (
    !provided ||
    provided !== ADMIN_PASSWORD ||
    !providedEmail ||
    providedEmail !== ADMIN_EMAIL
  ) {
    return res
      .status(401)
      .json({ success: false, message: "Admin authorization failed." });
  }
  return next();
}

async function createUsageLog({
  user = null,
  email = "",
  name = "",
  isAnonymous = true,
  isPro = false,
  action,
  summary,
  source = "web",
  kind = "activity",
  usageMetadata = {},
  metadata = {},
} = {}) {
  if (!action || !summary) return null;
  try {
    const record = await UsageLog.create({
      userId: user?._id || null,
      email: String(email || user?.email || "").trim(),
      name: String(name || user?.name || "").trim(),
      isAnonymous: Boolean(user ? false : isAnonymous),
      isPro: Boolean(user?.isPro || isPro),
      action: String(action).trim(),
      summary: String(summary).trim(),
      source: String(source || "web").trim(),
      kind,
      metadata: {
        ...(usageMetadata && typeof usageMetadata === "object"
          ? usageMetadata
          : {}),
        ...(metadata && typeof metadata === "object" ? metadata : {}),
      },
    });
    const totalLogs = await UsageLog.countDocuments();
    if (totalLogs > 1000) {
      const overflow = totalLogs - 1000;
      const oldLogs = await UsageLog.find({})
        .sort({ createdAt: 1 })
        .limit(overflow)
        .select("_id")
        .lean();
      if (oldLogs.length) {
        await UsageLog.deleteMany({
          _id: { $in: oldLogs.map((item) => item._id) },
        });
      }
    }
    const payload = record.toObject();
    io.emit("admin:usage-log", payload);
    if (payload.kind === "error") {
      io.emit("admin:server-error", payload);
    }
    return payload;
  } catch (error) {
    console.warn("Usage log save failed:", error.message);
    return null;
  }
}

async function createUserNotification({
  userId,
  toEmail = "",
  fromEmail = "",
  fromName = "MediaLab",
  deliveryScope = "system",
  type = "general",
  title = "",
  message = "",
  targetType = "",
  targetId = "",
  metadata = {},
} = {}) {
  if (!userId || !String(title || "").trim()) return null;
  try {
    let recipientEmail = String(toEmail || "")
      .trim()
      .toLowerCase();
    if (!recipientEmail) {
      const recipientUser = await User.findById(userId).select("email").lean();
      recipientEmail = String(recipientUser?.email || "")
        .trim()
        .toLowerCase();
    }
    const notification = await Notification.create({
      userId,
      recipientEmail,
      senderName: String(fromName || "MediaLab").trim(),
      senderEmail: String(fromEmail || "")
        .trim()
        .toLowerCase(),
      deliveryScope: String(deliveryScope || "system")
        .trim()
        .toLowerCase(),
      type: String(type || "general").trim(),
      title: String(title || "").trim(),
      message: String(message || "").trim(),
      targetType: String(targetType || "").trim(),
      targetId: String(targetId || "").trim(),
      metadata: metadata && typeof metadata === "object" ? metadata : {},
      isRead: false,
    });
    const payload = serializeNotification(notification);
    io.to(
      `${USER_NOTIFICATION_ROOM_PREFIX}${String(notification.userId)}`,
    ).emit("user:notification", payload);
    await trimUserNotifications(notification.userId);
    return notification;
  } catch (error) {
    console.error("Notification create failed:", error);
    return null;
  }
}

function serializeNotification(notification = {}) {
  return {
    _id: String(notification?._id || ""),
    userId: String(notification?.userId || ""),
    recipientEmail: String(notification?.recipientEmail || "")
      .trim()
      .toLowerCase(),
    senderName: String(notification?.senderName || "MediaLab").trim(),
    senderEmail: String(notification?.senderEmail || "")
      .trim()
      .toLowerCase(),
    deliveryScope: String(notification?.deliveryScope || "system").trim(),
    type: String(notification?.type || "general").trim(),
    title: String(notification?.title || "").trim(),
    message: String(notification?.message || "").trim(),
    targetType: String(notification?.targetType || "").trim(),
    targetId: String(notification?.targetId || "").trim(),
    metadata:
      notification?.metadata && typeof notification.metadata === "object"
        ? notification.metadata
        : {},
    isRead: Boolean(notification?.isRead),
    createdAt: notification?.createdAt || new Date(),
    readAt: notification?.readAt || null,
  };
}

async function listUserNotifications(userId, limit = 10) {
  if (!userId) return [];
  const safeLimit = Math.max(1, Math.min(10, Number(limit || 10)));
  const [unreadNotifications, readNotifications] = await Promise.all([
    Notification.find({ userId, isRead: false }).sort({ createdAt: -1 }).lean(),
    Notification.find({ userId, isRead: true })
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .lean(),
  ]);
  const notifications = [...unreadNotifications, ...readNotifications].sort(
    (left, right) =>
      new Date(right.createdAt || 0) - new Date(left.createdAt || 0),
  );
  return notifications.map((item) => serializeNotification(item));
}

async function trimUserNotifications(userId) {
  if (!userId) return;
  const staleReadNotifications = await Notification.find({
    userId,
    isRead: true,
  })
    .sort({ createdAt: -1 })
    .skip(10)
    .lean();
  if (staleReadNotifications.length) {
    await Notification.deleteMany({
      _id: { $in: staleReadNotifications.map((item) => item._id) },
    });
  }
}

async function createBulkNotifications(userIds = [], payload = {}) {
  const uniqueIds = [
    ...new Set(
      (Array.isArray(userIds) ? userIds : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    ),
  ];
  if (!uniqueIds.length || !String(payload?.title || "").trim()) return [];
  const recipientUsers = await User.find({ _id: { $in: uniqueIds } })
    .select("_id email")
    .lean();
  const recipientEmailMap = new Map(
    recipientUsers.map((user) => [
      String(user?._id || ""),
      String(user?.email || "")
        .trim()
        .toLowerCase(),
    ]),
  );
  const docs = uniqueIds.map((userId) => ({
    userId,
    recipientEmail: recipientEmailMap.get(String(userId)) || "",
    senderName: String(payload.fromName || "ML Community").trim(),
    senderEmail: String(payload.fromEmail || "dev@gmail.com")
      .trim()
      .toLowerCase(),
    deliveryScope: String(payload.deliveryScope || "all")
      .trim()
      .toLowerCase(),
    type: String(payload.type || "general").trim(),
    title: String(payload.title || "").trim(),
    message: String(payload.message || "").trim(),
    targetType: String(payload.targetType || "").trim(),
    targetId: String(payload.targetId || "").trim(),
    metadata:
      payload.metadata && typeof payload.metadata === "object"
        ? payload.metadata
        : {},
    isRead: false,
  }));
  try {
    const notifications = await Notification.insertMany(docs, {
      ordered: false,
    });
    notifications.forEach((notification) => {
      io.to(
        `${USER_NOTIFICATION_ROOM_PREFIX}${String(notification.userId)}`,
      ).emit("user:notification", serializeNotification(notification));
    });
    await Promise.all(
      notifications.map((notification) =>
        trimUserNotifications(notification.userId),
      ),
    );
    return notifications;
  } catch (error) {
    console.error("Bulk notification create failed:", error);
    const fallbackNotifications = await Promise.all(
      uniqueIds.map((userId) =>
        createUserNotification({
          userId,
          toEmail: recipientEmailMap.get(String(userId)) || "",
          fromEmail: payload.fromEmail || "dev@gmail.com",
          fromName: payload.fromName || "ML Community",
          deliveryScope: payload.deliveryScope || "all",
          type: payload.type || "general",
          title: payload.title || "",
          message: payload.message || "",
          targetType: payload.targetType || "",
          targetId: payload.targetId || "",
          metadata:
            payload.metadata && typeof payload.metadata === "object"
              ? payload.metadata
              : {},
        }),
      ),
    );
    return fallbackNotifications.filter(Boolean);
  }
}

function extractUserProjectNames(user = {}) {
  const liveProjects = Array.isArray(user?.liveProjects)
    ? user.liveProjects
    : [];
  const historyProjects = Array.isArray(user?.projects) ? user.projects : [];
  const names = [...liveProjects, ...historyProjects]
    .map((item) =>
      String(
        item?.name || item?.fileName || item?.filename || item?.title || "",
      ).trim(),
    )
    .filter(Boolean);
  return [...new Set(names)];
}

function resolveProjectTokenValue(projectNames = [], tokenArg = "") {
  const safeProjects = Array.isArray(projectNames)
    ? projectNames.filter(Boolean)
    : [];
  if (!safeProjects.length) return "your latest project";
  const raw = String(tokenArg || "")
    .trim()
    .toLowerCase();
  if (!raw) return safeProjects[0];
  if (raw === "nth") return safeProjects[safeProjects.length - 1];
  const numeric = Number.parseInt(raw, 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return safeProjects[safeProjects.length - 1];
  }
  return (
    safeProjects[Math.min(numeric - 1, safeProjects.length - 1)] ||
    safeProjects[safeProjects.length - 1]
  );
}

function renderAdminNotificationTemplate(template = "", user = {}) {
  const safeTemplate = String(template || "");
  if (!safeTemplate) return "";
  const projectNames = extractUserProjectNames(user);
  return safeTemplate.replace(/\{([a-z0-9_-]+)\}/gi, (_match, rawToken) => {
    const token = String(rawToken || "")
      .trim()
      .toLowerCase();
    if (token === "username") {
      return String(user?.name || "Creator").trim() || "Creator";
    }
    if (token === "email") {
      return String(user?.email || "").trim() || "no-email";
    }
    if (token === "projectname") {
      return resolveProjectTokenValue(projectNames);
    }
    if (token.startsWith("projectname-")) {
      return resolveProjectTokenValue(
        projectNames,
        token.slice("projectname-".length),
      );
    }
    if (token === "projectcount" || token === "publishedprojectcount") {
      return String(projectNames.length);
    }
    return _match;
  });
}

function computeSellerRatingMeta(user = {}) {
  const ratings = Array.isArray(user?.sellerRatings) ? user.sellerRatings : [];
  const count = ratings.length;
  const average = count
    ? ratings.reduce((sum, entry) => sum + Number(entry?.value || 0), 0) / count
    : 0;
  return {
    sellerRatingCount: count,
    sellerRatingPercent: count
      ? Number(((average / 5) * 100 || 0).toFixed(1))
      : 0,
  };
}

async function syncAuthorSellerRatingToListings(authorId) {
  if (!authorId) return;
  const author = await User.findById(authorId).select("sellerRatings");
  if (!author) return;
  const ratingMeta = computeSellerRatingMeta(author);
  await MarketplaceItem.updateMany(
    { authorId },
    {
      $set: {
        sellerRatingCount: ratingMeta.sellerRatingCount,
        sellerRatingPercent: ratingMeta.sellerRatingPercent,
        updatedAt: new Date(),
      },
    },
  );
}

function scoreUsageLogWeight(log = {}) {
  const action = String(log?.action || "").toLowerCase();
  const source = String(log?.source || "").toLowerCase();
  let weight = 1;
  if (action.includes("login")) weight += 2;
  if (action.includes("tool-open")) weight += 1;
  if (action.includes("builder-save") || action.includes("builder-autosave"))
    weight += 2;
  if (action.includes("github-publish")) weight += 8;
  if (action.includes("github-publish-folder")) weight += 12;
  if (action.includes("render-hosting") || action.includes("render-deploy"))
    weight += 5;
  if (action.includes("withdrawal-request")) weight += 1;
  if (action.includes("adsense")) weight += 2;
  if (source.includes("web-builder")) weight += 2;
  if (source.includes("tool-switch")) weight += 1;
  return weight;
}

async function syncUserActivityWeights() {
  const pendingLogs = await UsageLog.find({
    kind: "activity",
    userId: { $ne: null },
    "metadata.weightProcessed": { $ne: true },
  })
    .sort({ createdAt: 1 })
    .limit(3000);

  if (!pendingLogs.length) return;

  const grouped = new Map();
  for (const log of pendingLogs) {
    const userId = String(log.userId || "").trim();
    if (!userId) continue;
    const entry = grouped.get(userId) || {
      weight: 0,
      stats: {
        logins: 0,
        toolOpens: 0,
        projects: 0,
        publishes: 0,
      },
      ids: [],
      lastAt: null,
    };
    const action = String(log.action || "").toLowerCase();
    entry.weight += scoreUsageLogWeight(log);
    if (action.includes("login")) entry.stats.logins += 1;
    if (action.includes("tool-open")) entry.stats.toolOpens += 1;
    if (action.includes("builder-save") || action.includes("builder-autosave"))
      entry.stats.projects += 1;
    if (action.includes("github-publish")) entry.stats.publishes += 1;
    entry.ids.push(log._id);
    entry.lastAt = log.createdAt || entry.lastAt;
    grouped.set(userId, entry);
  }

  for (const [userId, entry] of grouped.entries()) {
    const user = await User.findById(userId);
    if (!user) continue;
    const previousStats = user.activityStats || {};
    user.activityWeight =
      Number(user.activityWeight || 0) + Number(entry.weight || 0);
    user.activityStats = {
      logins:
        Number(previousStats.logins || 0) + Number(entry.stats.logins || 0),
      toolOpens:
        Number(previousStats.toolOpens || 0) +
        Number(entry.stats.toolOpens || 0),
      projects:
        Number(previousStats.projects || 0) + Number(entry.stats.projects || 0),
      publishes:
        Number(previousStats.publishes || 0) +
        Number(entry.stats.publishes || 0),
    };
    user.lastActivityWeightCalculatedAt = entry.lastAt || new Date();
    await user.save();
  }

  await UsageLog.updateMany(
    { _id: { $in: pendingLogs.map((log) => log._id) } },
    { $set: { "metadata.weightProcessed": true } },
  );
}

function logServerIssue(summary, metadata = {}) {
  return createUsageLog({
    action: "server-error",
    summary,
    source: "server",
    kind: "error",
    isAnonymous: true,
    metadata,
  });
}

function streamMediaLabReleasePdf(res) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    info: {
      Title: "MediaLab Release Notes",
      Author: "MediaLab",
      Subject: "MediaLab platform overview and user guide",
    },
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    'inline; filename="MediaLab-Release.pdf"',
  );
  doc.pipe(res);

  const drawSection = (title, lines = []) => {
    doc.moveDown(0.9);
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#0891b2").text(title);
    doc.moveDown(0.35);
    doc.font("Helvetica").fontSize(10.5).fillColor("#1f2937");
    lines.forEach((line) => {
      doc.text(`• ${line}`, {
        width: 500,
        lineGap: 3,
      });
    });
  };

  doc
    .font("Helvetica-Bold")
    .fontSize(24)
    .fillColor("#020617")
    .text("MediaLab Release Notes", { align: "left" });
  doc.moveDown(0.25);
  doc
    .font("Helvetica")
    .fontSize(11)
    .fillColor("#475569")
    .text(
      "A short professional guide to what MediaLab is, how it works, and how creators can publish, monetize, sell, and withdraw with confidence.",
      {
        width: 500,
        lineGap: 4,
      },
    );

  drawSection("1. Introduction", [
    "MediaLab is a creator platform that combines a smart web builder, publishing workflow, cloud hosting setup, monetization tools, and a project marketplace in one place.",
    "It is designed for developers, creators, and beginners who want to build professional web projects without jumping between too many separate services.",
    "The platform is organized to help users create, publish, host, manage, monetize, sell, and track their work with a clean studio experience.",
  ]);

  drawSection("2. Account Linkage", [
    "Users can connect GitHub so MediaLab can publish their projects to a structured cloud repository with a public folder for hosted web output.",
    "Users can connect Render during deployment setup so published projects can be served live from a proper web service.",
    "Users can connect Google AdSense so MediaLab can check site approval, pull monetization signals, and help manage project-level ad readiness.",
  ]);

  drawSection("3. Creating Your First Project", [
    "Open the Web Builder from Studio to start a project visually, insert sections, edit blocks, and run the project in a live preview mode.",
    "Templates help users move faster. MediaLab includes starter layouts such as landing pages, portfolio structures, startup-style pages, and game templates.",
    "Builder drafts let users save progress and reopen projects later without losing work.",
  ]);

  drawSection("4. Publishing Your Project", [
    "After building, the user publishes to GitHub from the builder. MediaLab prepares a clean project structure and pushes the project into the public hosting area.",
    "Single-file projects are packaged professionally into a folder with index.html so the project can be accessed with a clean path like /project-name/.",
    "Once GitHub publishing succeeds, the user can continue deployment with Render so the project becomes live on a hosted service.",
  ]);

  drawSection("5. AdSense Linking", [
    "AdSense linking starts from the Console and project dashboard flow. MediaLab checks the connected site, approval state, and monetization readiness.",
    "If Google is still reviewing the site, MediaLab keeps the monetization state clear so the user understands approval is still pending.",
    "When approved, users can monetize specific projects instead of forcing ads onto every page under a domain.",
  ]);

  drawSection("6. Marketplace", [
    "The Marketplace allows creators to list projects for sale after preparing source details, screenshots, price, and category information.",
    "Listings go through review before appearing publicly. Buyers can preview, comment, rate, and purchase approved projects.",
    "Free items can be transferred immediately, while paid purchases can go through admin review before approval and delivery.",
  ]);

  drawSection("7. MediaLab AI Assistant", [
    "MediaLab includes a guided assistant style workflow across the Studio so users can move through creation, publishing, monetization, and marketplace steps more confidently.",
    "The assistant experience is designed to reduce confusion, surface the next best action, and help creators use the platform strategically.",
  ]);

  drawSection("8. How To Earn In MediaLab", [
    "Creators can earn through AdSense by publishing approved projects and enabling monetization where Google review allows it.",
    "Creators can also earn through the Marketplace by listing projects for sale and receiving approved purchase transfers.",
    "MediaLab may also support wallet-based rewards and activity-based creator incentives inside the platform.",
  ]);

  drawSection("9. Withdrawals", [
    "AdSense withdrawals are handled through Google's official payout flow once the AdSense threshold and eligibility requirements are met.",
    "MediaLab wallet withdrawals are submitted through the account wallet section, where the user chooses a method such as PayPal, M-Pesa, or Airtel Money if available.",
    "Users can track withdrawal status from the Console wallet and review recent payout records directly in the app.",
  ]);

  drawSection("10. Rules, Terms, and Conditions", [
    "Users should only publish, monetize, or sell content they own or are authorized to distribute.",
    "Marketplace activity, monetization, hosting, and withdrawals remain subject to platform review and external service policies.",
    "Users should review MediaLab privacy, support, and terms pages for the latest official operating rules.",
  ]);

  doc.moveDown(1.1);
  doc
    .font("Helvetica-Oblique")
    .fontSize(9.5)
    .fillColor("#64748b")
    .text("MediaLab Release Notes • Official platform overview", {
      align: "center",
    });

  doc.end();
}

function slugifyProjectName(value = "medialab-page") {
  const slug = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\.html?$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "medialab-page"}.html`;
}

const GITHUB_PUBLIC_ROOT = "public";

function slugifyProjectFolderName(value = "medialab-project") {
  return (
    String(value || "")
      .toLowerCase()
      .trim()
      .replace(/\.html?$/i, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "medialab-project"
  );
}

function normalizeRepoFilePath(value = "") {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/")
    .trim();
}

function normalizeImportedEntryPath(value = "index.html") {
  const normalized = normalizeRepoFilePath(value);
  return normalized || "index.html";
}

function prepareGitHubPush(projectName = "", filesArray = []) {
  const folderSlug = slugifyProjectFolderName(
    projectName || "medialab-project",
  );
  const items = Array.isArray(filesArray) ? filesArray : [];
  if (items.length === 1) {
    const single = items[0] || {};
    const normalizedSinglePath = normalizeRepoFilePath(
      single.path || single.name || "index.html",
    );
    const isHtmlFile = /\.html?$/i.test(normalizedSinglePath || "");
    if (isHtmlFile) {
      return {
        folderSlug,
        entryPath: "index.html",
        projectType: "single",
        files: [
          {
            ...single,
            path: "index.html",
          },
        ],
      };
    }
  }
  const normalizedFiles = items.map((file) => ({
    ...file,
    path: normalizeRepoFilePath(file?.path || file?.name || ""),
  }));
  return {
    folderSlug,
    entryPath: normalizeImportedEntryPath(
      normalizedFiles.find((file) => /(^|\/)index\.html?$/i.test(file.path))
        ?.path || "index.html",
    ),
    projectType: "folder",
    files: normalizedFiles,
  };
}

function stripPublicRootFromUrlPath(value = "") {
  return normalizeRepoFilePath(value).replace(/^public\/?/i, "");
}

function buildProjectRoutePath(project = {}) {
  const repoPath = stripPublicRootFromUrlPath(project?.repoPath || "");
  const entryPath = normalizeImportedEntryPath(
    project?.entryPath || "index.html",
  );
  if (!repoPath) {
    const filename = stripPublicRootFromUrlPath(
      project?.fileName || project?.filename || "",
    );
    if (!filename) return "";
    return /\/index\.html?$/i.test(filename)
      ? filename.replace(/\/index\.html?$/i, "/")
      : filename;
  }
  if (!entryPath || /^index\.html?$/i.test(entryPath)) {
    return `${repoPath}/`;
  }
  return `${repoPath}/${entryPath}`;
}

function buildHostedProjectUrl(baseUrl = "", project = {}) {
  const normalizedBase = normalizeRenderUrl(baseUrl);
  if (!normalizedBase) return "";
  const routePath = buildProjectRoutePath(project).replace(/^\/+/, "");
  if (!routePath) return normalizedBase;
  return `${normalizedBase}/${routePath}`.replace(/(?<!:)\/{2,}/g, "/");
}

function buildFolderProjectLiveUrl(owner, repo, folderPath, entryPath) {
  const cleanFolder = stripPublicRootFromUrlPath(folderPath);
  const cleanEntry = normalizeImportedEntryPath(entryPath);
  if (!cleanFolder) {
    return `https://${owner}.github.io/${repo}/${cleanEntry}`;
  }
  if (
    /\/index\.html?$/i.test(`${cleanFolder}/${cleanEntry}`) ||
    /^index\.html?$/i.test(cleanEntry)
  ) {
    return `https://${owner}.github.io/${repo}/${cleanFolder}/`;
  }
  return `https://${owner}.github.io/${repo}/${cleanFolder}/${cleanEntry}`;
}

function buildGithubRepoScaffold(
  owner = "user",
  repoName = "medialab",
  displayName = owner,
) {
  const packageJson = JSON.stringify(
    {
      name: repoName,
      version: "1.0.0",
      private: true,
      description: "Cloud storage for MediaLab AI projects.",
      type: "module",
      scripts: {
        start: "node index.js",
        dev: "node index.js",
      },
      dependencies: {
        compression: "^1.7.4",
        cors: "^2.8.5",
        dotenv: "^16.4.5",
        express: "^4.19.2",
        helmet: "^7.1.0",
        morgan: "^1.10.0",
      },
    },
    null,
    2,
  );
  const serverIndex = `import fs from "fs";
import compression from "compression";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const port = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(morgan("dev"));
app.use(express.static(publicDir));

app.get("*", (req, res) => {
  const requestPath = String(req.path || "/").replace(/^\\/+/, "");
  const safePath = requestPath.replace(/\\\\/g, "/");
  const directFile = path.join(publicDir, safePath);
  const htmlFile = safePath.endsWith(".html") ? directFile : path.join(publicDir, safePath + ".html");
  const folderIndex = path.join(publicDir, safePath, "index.html");

  if (safePath && fs.existsSync(directFile) && fs.statSync(directFile).isFile()) {
    return res.sendFile(directFile);
  }
  if (safePath && fs.existsSync(htmlFile) && fs.statSync(htmlFile).isFile()) {
    return res.sendFile(htmlFile);
  }
  if (safePath && fs.existsSync(folderIndex) && fs.statSync(folderIndex).isFile()) {
    return res.sendFile(folderIndex);
  }
  return res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, () => {
  console.log(\`${repoName} static host running on port \${port}\`);
});
`;
  const publicIndexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MediaLab Cloud Storage</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(34, 211, 238, 0.18), transparent 42%),
          linear-gradient(180deg, #07131f 0%, #0f172a 100%);
        color: #e2e8f0;
        font-family: Inter, system-ui, sans-serif;
      }
      .card {
        width: min(92vw, 760px);
        border-radius: 28px;
        padding: 32px;
        background: rgba(15, 23, 42, 0.86);
        border: 1px solid rgba(56, 189, 248, 0.22);
        box-shadow: 0 28px 80px rgba(2, 6, 23, 0.4);
      }
      h1 { margin: 0 0 12px; font-size: clamp(2rem, 5vw, 3.25rem); }
      p { margin: 0 0 18px; color: #cbd5e1; line-height: 1.6; }
      a {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 12px 18px;
        border-radius: 999px;
        background: linear-gradient(135deg, #06b6d4, #22c55e);
        color: #03111a;
        font-weight: 800;
        text-decoration: none;
      }
      code {
        color: #67e8f9;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <section class="card">
      <p>MediaLab Git Host</p>
      <h1>${owner}'s Cloud Workspace</h1>
      <p>Your published sites live inside <code>/public/</code>. The included Node host serves them from the root path so each project feels like a standard deployed site.</p>
      <a href="./">Open Published Projects</a>
    </section>
  </body>
</html>`;
  const gitignore = `node_modules
.env
.DS_Store
npm-debug.log*
`;
  const renderYaml = `services:
  - type: web
    name: ${buildDefaultRenderServiceName(displayName || owner)}
    runtime: node
    plan: free
    autoDeploy: true
    buildCommand: npm install
    startCommand: npm run dev
    envVars:
      - key: NODE_ENV
        value: production
`;
  return [
    { path: "package.json", content: packageJson },
    { path: "index.js", content: serverIndex },
    { path: "render.yaml", content: renderYaml },
    { path: ".gitignore", content: gitignore },
    { path: "public/index.html", content: publicIndexHtml },
    { path: "public/.gitkeep", content: "" },
  ];
}

async function ensureGithubRepoScaffold(
  octokit,
  owner,
  repo,
  displayName = owner,
) {
  const scaffoldFiles = buildGithubRepoScaffold(owner, repo, displayName);
  for (const file of scaffoldFiles) {
    await upsertGithubFile({
      octokit,
      owner,
      repo,
      path: file.path,
      message: `Initialize ${file.path} for MediaLab hosting`,
      contentBase64: Buffer.from(file.content, "utf8").toString("base64"),
    });
  }
}

function slugifyGithubRepoName(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 39);
}

function getUserGithubRepoName(user = {}) {
  const saved = String(user?.githubRepoName || "").trim();
  if (saved) return saved;
  const displayName = String(user?.name || "").trim();
  const emailLocal = String(user?.email || "")
    .split("@")[0]
    .trim();
  const firstNameSource =
    displayName.split(/\s+/).find(Boolean) ||
    emailLocal.split(/[._-]+/).find(Boolean) ||
    "medialab";
  return slugifyGithubRepoName(firstNameSource) || "medialab";
}

function injectIntoHead(html = "", injected = "") {
  const source = String(html || "");
  const payload = String(injected || "").trim();
  if (!payload) return source;
  if (/<\/head>/i.test(source)) {
    return source.replace(/<\/head>/i, `${payload}\n  </head>`);
  }
  if (/<head[^>]*>/i.test(source)) {
    return source.replace(/<head[^>]*>/i, (match) => `${match}\n${payload}`);
  }
  return source;
}

function buildPublishedHtmlFromSource({
  documentHtml = "",
  projectName = "MediaLab Project",
  adsenseId = "",
  adsenseAdCode = "",
  description = "",
  keywords = "",
  includeRepoFavicon = true,
} = {}) {
  const source = String(documentHtml || "").trim();
  if (!source || !/<html[\s>]/i.test(source)) {
    return buildPublishedHtmlDocument({
      projectName,
      htmlContent: source,
      cssContent: "",
      interactionScript: "",
      adsenseId,
      adsenseAdCode,
      description,
      keywords,
      includeRepoFavicon,
    });
  }
  const safeTitle =
    String(projectName || "MediaLab Project").trim() || "MediaLab Project";
  const safeDescription = escapeMetaContent(
    description || `${safeTitle} published with MediaLab.`,
  );
  const safeKeywords = escapeMetaContent(
    keywords || "MediaLab, website, publish",
  );
  const trimmedAdCode = String(adsenseAdCode || "").trim();
  const adsenseTag =
    trimmedAdCode && /pagead2\.googlesyndication\.com/i.test(trimmedAdCode)
      ? trimmedAdCode
      : adsenseId && /^ca-pub-/i.test(String(adsenseId).trim())
        ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${String(
            adsenseId,
          ).trim()}" crossorigin="anonymous"></script>`
        : "";
  const faviconTag = includeRepoFavicon
    ? `<link rel="icon" href="/favicon.ico" type="image/x-icon" />`
    : "";
  const metaBundle = [
    faviconTag,
    `<meta name="description" content="${safeDescription}" />`,
    `<meta name="keywords" content="${safeKeywords}" />`,
    `<meta property="og:title" content="${escapeMetaContent(safeTitle)}" />`,
    `<meta property="og:description" content="${safeDescription}" />`,
    `<meta property="og:type" content="website" />`,
    adsenseTag,
  ]
    .filter(Boolean)
    .join("\n    ");
  let nextHtml = source;
  if (/<title>[\s\S]*?<\/title>/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(
      /<title>[\s\S]*?<\/title>/i,
      `<title>${safeTitle.replace(/[<>&"]/g, "")}</title>`,
    );
  }
  nextHtml = injectIntoHead(nextHtml, `    ${metaBundle}`);
  return nextHtml;
}

function stripAdsenseFromHtml(html = "") {
  return String(html || "")
    .replace(
      /<script[^>]*src=["']https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js[^>]*><\/script>\s*/gi,
      "",
    )
    .replace(/<script[^>]*>[\s\S]*?adsbygoogle[\s\S]*?<\/script>\s*/gi, "")
    .replace(
      /<ins[^>]*class=["'][^"']*adsbygoogle[^"']*["'][^>]*>[\s\S]*?<\/ins>\s*/gi,
      "",
    );
}

async function getGithubFileSha(octokit, owner, repo, path) {
  try {
    const existing = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
    });
    if (!Array.isArray(existing.data) && existing.data?.sha) {
      return existing.data.sha;
    }
  } catch (error) {
    if ((error?.status || error?.response?.status) !== 404) {
      throw error;
    }
  }
  return "";
}

async function upsertGithubFile({
  octokit,
  owner,
  repo,
  path,
  message,
  contentBase64,
}) {
  const sha = await getGithubFileSha(octokit, owner, repo, path);
  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: contentBase64,
    ...(sha ? { sha } : {}),
  });
  return sha;
}

async function deleteGithubPathRecursive(octokit, owner, repo, path) {
  const response = await octokit.rest.repos.getContent({
    owner,
    repo,
    path,
  });
  if (Array.isArray(response.data)) {
    for (const item of response.data) {
      await deleteGithubPathRecursive(octokit, owner, repo, item.path);
    }
    return;
  }
  if (!response.data?.sha) return;
  await octokit.rest.repos.deleteFile({
    owner,
    repo,
    path: response.data.path,
    sha: response.data.sha,
    message: `Delete ${response.data.path} from MediaLab`,
  });
}

function escapeMetaContent(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildPublishedHtmlDocument({
  projectName = "MediaLab Project",
  htmlContent = "",
  cssContent = "",
  interactionScript = "",
  adsenseId = "",
  adsenseAdCode = "",
  description = "",
  keywords = "",
  includeRepoFavicon = true,
} = {}) {
  const safeTitle =
    String(projectName || "MediaLab Project").trim() || "MediaLab Project";
  const styleBlock = String(cssContent || "").trim();
  const bodyMarkup = String(htmlContent || "").trim();
  const interactionBlock = String(interactionScript || "").trim();
  const safeDescription = escapeMetaContent(
    description || `${safeTitle} published with MediaLab.`,
  );
  const safeKeywords = escapeMetaContent(
    keywords || "MediaLab, website, publish",
  );
  const trimmedAdCode = String(adsenseAdCode || "").trim();
  const adsenseTag =
    trimmedAdCode && /pagead2\.googlesyndication\.com/i.test(trimmedAdCode)
      ? `\n    ${trimmedAdCode}`
      : adsenseId && /^ca-pub-/i.test(String(adsenseId).trim())
        ? `\n    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${String(
            adsenseId,
          ).trim()}" crossorigin="anonymous"></script>`
        : "";
  const faviconTag = includeRepoFavicon
    ? `\n    <link rel="icon" href="favicon.ico" type="image/x-icon" />`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle.replace(/[<>&"]/g, "")}</title>${faviconTag}
    <meta name="description" content="${safeDescription}" />
    <meta name="keywords" content="${safeKeywords}" />
    <meta property="og:title" content="${escapeMetaContent(safeTitle)}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:type" content="website" />${adsenseTag}
    <style>
${styleBlock}
    </style>
  </head>
  <body>
${bodyMarkup}${interactionBlock ? `\n${interactionBlock}` : ""}
  </body>
</html>`;
}

function normalizeAdsensePublisherId(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^ca-pub-\d+$/i.test(raw)) return raw;
  if (/^pub-\d+$/i.test(raw)) return `ca-${raw}`;
  if (/^\d+$/.test(raw)) return `ca-pub-${raw}`;
  return raw;
}

function sortLiveProjects(projects = []) {
  return [...projects].sort(
    (a, b) =>
      new Date(b.updatedAt || b.lastSyncedAt || b.createdAt || 0) -
      new Date(a.updatedAt || a.lastSyncedAt || a.createdAt || 0),
  );
}

function buildGithubRepoUrl(username = "", repo = "medialab") {
  const owner = String(username || "").trim();
  if (!owner) return "";
  return `https://github.com/${owner}/${repo}`;
}

function buildRenderNameSeed(owner = "client") {
  const raw = String(owner || "client").trim();
  const firstToken = raw.split(/\s+/).filter(Boolean)[0] || raw;
  return (
    String(firstToken || "client")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "client"
  );
}

function buildDefaultRenderServiceName(owner = "client") {
  return buildRenderNameSeed(owner);
}

function buildRenderServiceUrl(owner = "client") {
  return `https://${buildDefaultRenderServiceName(owner)}.onrender.com`;
}

function buildShortRenderServiceDisplay(owner = "client") {
  return `${buildRenderNameSeed(owner)}.onrender.com`;
}

function buildProjectLiveUrl(user, project = {}) {
  if (project?.renderUrl) {
    return buildHostedProjectUrl(project.renderUrl, project);
  }
  if (project?.liveUrl || project?.url) return project.liveUrl || project.url;
  const filename = String(project?.fileName || project?.filename || "").trim();
  if (!user?.githubUsername || !filename) return "";
  const routePath = buildProjectRoutePath(project);
  return `https://${user.githubUsername}.github.io/medialab/${routePath}`;
}

function getUserPrimaryRenderBaseUrl(user) {
  const projects = Array.isArray(user?.liveProjects) ? user.liveProjects : [];
  const hosted = projects.find(
    (project) =>
      project?.renderUrl &&
      (project?.renderHostedConfirmed || project?.renderDeployStatus),
  );
  return hosted?.renderUrl ? normalizeRenderUrl(hosted.renderUrl) : "";
}

function buildAdsTxtCandidateUrls(user) {
  if (!user?.githubUsername) return [];
  return [
    `https://${user.githubUsername}.github.io/medialab/ads.txt`,
    `https://${user.githubUsername}.github.io/ads.txt`,
  ];
}

function normalizeRenderUrl(url = "") {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withProtocol);
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function findLiveProjectIndex(user, filename = "") {
  const target = String(filename || "").trim();
  const projects = Array.isArray(user?.liveProjects) ? user.liveProjects : [];
  return projects.findIndex(
    (item) => String(item?.fileName || item?.filename || "").trim() === target,
  );
}

function findLiveProject(user, filename = "") {
  const index = findLiveProjectIndex(user, filename);
  if (index < 0) return null;
  return Array.isArray(user?.liveProjects) ? user.liveProjects[index] : null;
}

function getMarketplacePreviewImage(project = {}) {
  const url = String(
    project?.renderUrl || project?.liveUrl || project?.url || "",
  ).trim();
  return (
    url || "https://via.placeholder.com/1200x720/0f172a/e2e8f0?text=MediaLab"
  );
}

function sanitizeMarketplaceText(value = "", maxLength = 5000) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function normalizeMarketplacePrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Number(amount.toFixed(2));
}

async function uploadImageToImageKit({
  fileBuffer,
  fileName = "medialab-image.png",
  folder = "/medialab/marketplace",
  tags = [],
} = {}) {
  const publicKey = String(process.env.IMAGEKIT_PUBLIC_KEY || "").trim();
  const privateKey = String(process.env.IMAGEKIT_PRIVATE_KEY || "").trim();
  if (!publicKey || !privateKey) {
    throw new Error("ImageKit keys are not configured yet.");
  }
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || !fileBuffer.length) {
    throw new Error("No image file was provided.");
  }
  const form = new FormData();
  form.append("file", new Blob([fileBuffer]), fileName);
  form.append("fileName", fileName);
  form.append("folder", folder);
  if (Array.isArray(tags) && tags.length) {
    form.append("tags", tags.filter(Boolean).join(","));
  }
  form.append("useUniqueFileName", "true");
  const response = await fetch(
    "https://upload.imagekit.io/api/v1/files/upload",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${privateKey}:`).toString("base64")}`,
      },
      body: form,
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.url) {
    throw new Error(
      payload?.message ||
        payload?.error?.message ||
        "Could not upload this image to ImageKit.",
    );
  }
  return {
    url: String(payload.url || "").trim(),
    fileId: String(payload.fileId || "").trim(),
    thumbnailUrl: String(payload.thumbnailUrl || payload.url || "").trim(),
    name: String(payload.name || fileName).trim(),
  };
}

async function uploadFileToImageKit({
  fileBuffer,
  fileName = "index.html",
  folder = "/medialab/templates",
  tags = [],
} = {}) {
  const publicKey = String(process.env.IMAGEKIT_PUBLIC_KEY || "").trim();
  const privateKey = String(process.env.IMAGEKIT_PRIVATE_KEY || "").trim();
  if (!publicKey || !privateKey) {
    throw new Error("ImageKit keys are not configured yet.");
  }
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || !fileBuffer.length) {
    throw new Error("No file was provided for ImageKit upload.");
  }
  const form = new FormData();
  form.append("file", new Blob([fileBuffer]), fileName);
  form.append("fileName", fileName);
  form.append("folder", folder);
  if (Array.isArray(tags) && tags.length) {
    form.append("tags", tags.filter(Boolean).join(","));
  }
  form.append("useUniqueFileName", "false");
  const response = await fetch(
    "https://upload.imagekit.io/api/v1/files/upload",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${privateKey}:`).toString("base64")}`,
      },
      body: form,
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.url) {
    throw new Error(
      payload?.message ||
        payload?.error?.message ||
        "Could not upload this file to ImageKit.",
    );
  }
  return {
    url: String(payload.url || "").trim(),
    fileId: String(payload.fileId || "").trim(),
    name: String(payload.name || fileName).trim(),
  };
}

async function deleteImageKitFileById(fileId = "") {
  const targetFileId = String(fileId || "").trim();
  if (!targetFileId) return false;
  const privateKey = String(process.env.IMAGEKIT_PRIVATE_KEY || "").trim();
  if (!privateKey) {
    throw new Error("ImageKit private key is not configured yet.");
  }
  const response = await fetch(
    `https://api.imagekit.io/v1/files/${encodeURIComponent(targetFileId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${Buffer.from(`${privateKey}:`).toString("base64")}`,
      },
    },
  );
  if (response.status === 404) return false;
  if (!response.ok) {
    const payload = await response.text().catch(() => "");
    throw new Error(payload || "Could not delete the ImageKit file.");
  }
  return true;
}

async function cleanupMarketplaceStorageArtifacts(item = null) {
  if (!item) return;
  const templateRecords = await BuilderTemplate.find({
    sourceMarketplaceItemId: item._id,
  })
    .select("_id htmlFileId")
    .lean();
  for (const template of templateRecords) {
    const htmlFileId = String(template?.htmlFileId || "").trim();
    if (!htmlFileId) continue;
    try {
      await deleteImageKitFileById(htmlFileId);
    } catch (error) {
      const status = error?.status || error?.response?.status;
      if (status !== 404) {
        console.warn("Template ImageKit cleanup skipped:", error.message);
      }
    }
  }
  const screenshotAssets = Array.isArray(item?.screenshotAssets)
    ? item.screenshotAssets
    : [];
  for (const asset of screenshotAssets) {
    const fileId = String(asset?.fileId || "").trim();
    if (!fileId) continue;
    try {
      await deleteImageKitFileById(fileId);
    } catch (error) {
      const status = error?.status || error?.response?.status;
      if (status !== 404) {
        console.warn("Marketplace screenshot cleanup skipped:", error.message);
      }
    }
  }
}

async function cleanupMarketplaceTemplateArtifacts(item = null) {
  if (!item) return;
  const templateRecords = await BuilderTemplate.find({
    sourceMarketplaceItemId: item._id,
  })
    .select("_id htmlFileId")
    .lean();
  for (const template of templateRecords) {
    const htmlFileId = String(template?.htmlFileId || "").trim();
    if (!htmlFileId) continue;
    try {
      await deleteImageKitFileById(htmlFileId);
    } catch (error) {
      const status = error?.status || error?.response?.status;
      if (status !== 404) {
        console.warn("Template ImageKit cleanup skipped:", error.message);
      }
    }
  }
  await BuilderTemplate.deleteMany({ sourceMarketplaceItemId: item._id });
}

async function deleteGithubRepoIfExists(octokit, owner, repo) {
  const normalizedOwner = String(owner || "").trim();
  const normalizedRepo = String(repo || "").trim();
  if (!octokit || !normalizedOwner || !normalizedRepo) return false;
  try {
    await octokit.rest.repos.delete({
      owner: normalizedOwner,
      repo: normalizedRepo,
    });
    return true;
  } catch (error) {
    const status = error?.status || error?.response?.status;
    if (status === 404) return false;
    throw error;
  }
}

async function cleanupStandaloneBuilderTemplatesForUser(userId) {
  const templates = await BuilderTemplate.find({
    authorId: userId,
    $or: [
      { sourceMarketplaceItemId: null },
      { sourceMarketplaceItemId: { $exists: false } },
    ],
  })
    .select("_id htmlFileId")
    .lean();
  for (const template of templates) {
    const htmlFileId = String(template?.htmlFileId || "").trim();
    if (!htmlFileId) continue;
    try {
      await deleteImageKitFileById(htmlFileId);
    } catch (error) {
      const status = error?.status || error?.response?.status;
      if (status !== 404) {
        console.warn("Standalone template cleanup skipped:", error.message);
      }
    }
  }
  if (templates.length) {
    await BuilderTemplate.deleteMany({
      _id: { $in: templates.map((template) => template._id) },
    });
  }
}

async function removeUserParticipationFromMarketplace(userId) {
  const items = await MarketplaceItem.find({
    $or: [
      { "comments.userId": userId },
      { "comments.replies.userId": userId },
      { "ratings.userId": userId },
      { "purchases.buyerId": userId },
    ],
  });
  for (const item of items) {
    item.comments = (Array.isArray(item.comments) ? item.comments : [])
      .filter((comment) => String(comment?.userId || "") !== String(userId))
      .map((comment) => ({
        ...(typeof comment?.toObject === "function"
          ? comment.toObject()
          : comment),
        replies: (Array.isArray(comment?.replies)
          ? comment.replies
          : []
        ).filter((reply) => String(reply?.userId || "") !== String(userId)),
      }));
    item.ratings = (Array.isArray(item.ratings) ? item.ratings : []).filter(
      (rating) => String(rating?.userId || "") !== String(userId),
    );
    item.purchases = (
      Array.isArray(item.purchases) ? item.purchases : []
    ).filter((purchase) => String(purchase?.buyerId || "") !== String(userId));
    item.updatedAt = new Date();
    await item.save();
  }
}

function buildMarketplacePublicItem(item = {}, viewerId = "") {
  const comments = Array.isArray(item.comments) ? item.comments : [];
  const purchases = Array.isArray(item.purchases) ? item.purchases : [];
  const ratings = Array.isArray(item.ratings) ? item.ratings : [];
  const averageRating = ratings.length
    ? Number(
        (
          ratings.reduce((sum, rating) => sum + Number(rating.value || 0), 0) /
          ratings.length
        ).toFixed(1),
      )
    : 0;
  const ratingPercent = ratings.length
    ? Number(((averageRating / 5) * 100 || 0).toFixed(1))
    : 0;
  const normalizedViewerId = String(viewerId || "").trim();
  const viewerRatingEntry = normalizedViewerId
    ? ratings.find(
        (rating) => String(rating?.userId || "") === normalizedViewerId,
      )
    : null;
  const viewerIsOwner =
    normalizedViewerId && String(item.authorId || "") === normalizedViewerId;
  const viewerPurchase = normalizedViewerId
    ? purchases.find(
        (purchase) => String(purchase?.buyerId || "") === normalizedViewerId,
      )
    : null;
  return {
    _id: item._id,
    projectId: item.projectId || "",
    authorId: item.authorId || "",
    title: item.title || "",
    description: item.description || "",
    price: Number(item.price || 0),
    category: item.category || "General",
    screenshots: Array.isArray(item.screenshots)
      ? item.screenshots.slice(0, 4)
      : [],
    screenshotAssets: Array.isArray(item.screenshotAssets)
      ? item.screenshotAssets.slice(0, 4)
      : [],
    allowTest: Boolean(item.allowTest),
    purpose: item.purpose || "",
    sourceType: item.sourceType || "draft",
    sourceHtml: String(item.sourceHtml || ""),
    listingKind: item.listingKind || "sale",
    status: item.status || "pending",
    authorName: item.authorName || "",
    authorEmail: item.authorEmail || "",
    authorAvatar: item.authorAvatar || "",
    keepListedAfterPurchase: Boolean(item.keepListedAfterPurchase),
    sellerRatingCount: Number(item.sellerRatingCount || 0),
    sellerRatingPercent: Number(item.sellerRatingPercent || 0),
    liveUrl: item.liveUrl || "",
    disapprovalReason: item.disapprovalReason || "",
    removalReason: item.removalReason || "",
    marketplaceRepo: item.marketplaceRepo || "",
    marketplaceRepoPath: item.marketplaceRepoPath || "",
    previewImage:
      (Array.isArray(item.screenshots) && item.screenshots[0]) ||
      getMarketplacePreviewImage(item),
    comments: comments.map((comment) => ({
      _id: comment._id,
      userId: comment.userId || "",
      name: comment.name || "MediaLab user",
      text: comment.text || "",
      rating: Number(comment.rating || 5),
      date: comment.date || null,
      replies: (Array.isArray(comment.replies) ? comment.replies : []).map(
        (reply) => ({
          _id: reply._id,
          userId: reply.userId || "",
          name: reply.name || "MediaLab user",
          text: reply.text || "",
          date: reply.date || null,
        }),
      ),
    })),
    commentsCount: comments.length,
    averageRating,
    ratingPercent,
    ratingCount: ratings.length,
    viewerIsOwner: Boolean(viewerIsOwner),
    viewerHasRated: Boolean(viewerRatingEntry),
    viewerRatingValue: Number(viewerRatingEntry?.value || 0),
    purchaseCount: purchases.length,
    pendingPurchases: purchases.filter(
      (purchase) => purchase.status === "pending",
    ).length,
    viewerPurchaseStatus: viewerPurchase?.status || "",
    viewerPurchaseMessage: viewerPurchase?.message || "",
    viewerPurchaseApprovedUntil: viewerPurchase?.approvedUntil || null,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
  };
}

function shouldKeepMarketplaceListingAvailable(item = {}) {
  const authorEmail = String(item?.authorEmail || "")
    .trim()
    .toLowerCase();
  const authorName = String(item?.authorName || "")
    .trim()
    .toLowerCase();
  return (
    Boolean(item?.keepListedAfterPurchase) ||
    authorEmail === ADMIN_EMAIL ||
    authorName === "ml community"
  );
}

function stripMarketplaceRootFolder(files = []) {
  const normalizedFiles = Array.isArray(files) ? files : [];
  if (!normalizedFiles.length) return [];
  const firstSegments = normalizedFiles
    .map((file) => String(file?.path || "").split("/")[0])
    .filter(Boolean);
  if (!firstSegments.length) return normalizedFiles;
  const root = firstSegments[0];
  const sameRoot = firstSegments.every((segment) => segment === root);
  if (!sameRoot) return normalizedFiles;
  return normalizedFiles.map((file) => {
    const rawPath = String(file?.path || "").trim();
    return {
      ...file,
      path: rawPath.split("/").slice(1).join("/") || file.name || "index.html",
    };
  });
}

function resolveMarketplaceSourceHtmlFromFiles(
  sourceFiles = [],
  sourceEntryPath = "index.html",
) {
  const files = Array.isArray(sourceFiles) ? sourceFiles : [];
  if (!files.length) return "";
  const cleanEntryPath = normalizeImportedEntryPath(
    sourceEntryPath || "index.html",
  );
  const exactEntry = files.find(
    (file) =>
      normalizeImportedEntryPath(file?.path || file?.name || "") ===
      cleanEntryPath,
  );
  if (exactEntry?.content) {
    return String(exactEntry.content || "").trim();
  }
  const htmlEntry = files.find((file) =>
    /\.html?$/i.test(String(file?.path || file?.name || "").trim()),
  );
  if (htmlEntry?.content) {
    return String(htmlEntry.content || "").trim();
  }
  return "";
}

function buildMarketplaceSourcePackage({
  title = "",
  sourceHtml = "",
  sourceFiles = [],
  sourceEntryPath = "index.html",
} = {}) {
  const folderSlug = slugifyProjectFolderName(title || "marketplace-project");
  const rawFiles = stripMarketplaceRootFolder(
    (Array.isArray(sourceFiles) ? sourceFiles : [])
      .map((file) => ({
        ...file,
        path: normalizeRepoFilePath(file?.path || file?.name || ""),
        name: String(file?.name || "").trim(),
        content: typeof file?.content === "string" ? file.content : "",
        contentBase64:
          typeof file?.contentBase64 === "string" ? file.contentBase64 : "",
        mimeType: String(file?.mimeType || "").trim(),
      }))
      .filter((file) => file.path),
  );
  const prepared = prepareGitHubPush(title || folderSlug, rawFiles);
  const hasFileContents = prepared.files.some(
    (file) =>
      String(file?.content || "").length ||
      String(file?.contentBase64 || "").length,
  );
  if (
    prepared.projectType === "single" ||
    (!hasFileContents && String(sourceHtml || "").trim())
  ) {
    return {
      folderSlug,
      entryPath: "index.html",
      files: [
        {
          path: "index.html",
          name: "index.html",
          content: String(sourceHtml || "").trim(),
          mimeType: "text/html",
        },
      ],
    };
  }
  return {
    folderSlug,
    entryPath: normalizeImportedEntryPath(
      prepared.entryPath || sourceEntryPath || "index.html",
    ),
    files: prepared.files,
  };
}

function normalizeMarketplaceTemplateHtml(
  sourceHtml = "",
  fallbackTitle = "MediaLab Template",
) {
  const raw = String(sourceHtml || "").trim();
  if (!raw) return "";
  if (/<html[\s>]|<body[\s>]|<!doctype/i.test(raw)) return raw;
  const safeTitle =
    sanitizeMarketplaceText(fallbackTitle || "MediaLab Template", 120) ||
    "MediaLab Template";
  const wrappedContent = /^<div[\s>]/i.test(raw)
    ? raw
    : `<div class="medialab-template-root">\n${raw}\n</div>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
</head>
<body>
${wrappedContent}
</body>
</html>`;
}

function buildPurchasedTemplateSnapshotFromMarketplaceItem(item = {}) {
  const safeTitle =
    sanitizeMarketplaceText(item?.title || "Marketplace Template", 160) ||
    "Marketplace Template";
  return {
    marketplaceItemId: item?._id || null,
    slug: `marketplace-template-${String(item?._id || "").trim()}`,
    title: safeTitle,
    description: sanitizeMarketplaceText(
      item?.description || item?.purpose || "",
      2000,
    ),
    category:
      sanitizeMarketplaceText(item?.category || "General", 120) || "General",
    sourceHtml: normalizeMarketplaceTemplateHtml(
      item?.sourceHtml || "",
      safeTitle,
    ),
    previewImage: getMarketplacePreviewImage(item),
    screenshots: Array.isArray(item?.screenshots)
      ? item.screenshots.slice(0, 4)
      : [],
    screenshotAssets: Array.isArray(item?.screenshotAssets)
      ? item.screenshotAssets.slice(0, 4)
      : [],
    sellerId: item?.authorId || null,
    sellerName: sanitizeMarketplaceText(item?.authorName || "", 120),
    purchasedAt: new Date(),
    updatedAt: new Date(),
  };
}

async function grantMarketplaceTemplateToBuyer(listing, buyer) {
  if (!listing?._id || !buyer?._id) return null;
  buyer.purchasedTemplates = Array.isArray(buyer.purchasedTemplates)
    ? buyer.purchasedTemplates
    : [];
  const snapshot = buildPurchasedTemplateSnapshotFromMarketplaceItem(listing);
  const existingIndex = buyer.purchasedTemplates.findIndex(
    (entry) =>
      String(entry?.marketplaceItemId || "") === String(listing._id || ""),
  );
  if (existingIndex >= 0) {
    buyer.purchasedTemplates.splice(existingIndex, 1, {
      ...buyer.purchasedTemplates[existingIndex],
      ...snapshot,
      purchasedAt:
        buyer.purchasedTemplates[existingIndex]?.purchasedAt ||
        snapshot.purchasedAt,
      updatedAt: new Date(),
    });
  } else {
    buyer.purchasedTemplates.unshift(snapshot);
  }
  if (buyer.purchasedTemplates.length > 40) {
    buyer.purchasedTemplates = buyer.purchasedTemplates.slice(0, 40);
  }
  await buyer.save();
  return snapshot;
}

async function ensureMarketplaceRepoForUser(user) {
  if (!user?.githubUsername || !user?.githubToken) return null;
  const octokit = buildGithubClient(user);
  const repo = "marketplace";
  try {
    await octokit.rest.repos.get({
      owner: user.githubUsername,
      repo,
    });
  } catch (error) {
    const status = error?.status || error?.response?.status;
    if (status !== 404) throw error;
    await octokit.rest.repos.createForAuthenticatedUser({
      name: repo,
      private: true,
      auto_init: true,
      description: "Temporary MediaLab marketplace review storage.",
    });
  }
  await upsertGithubFile({
    octokit,
    owner: user.githubUsername,
    repo,
    path: "README.md",
    message: "Initialize MediaLab marketplace review storage",
    contentBase64: Buffer.from(
      "# MediaLab Marketplace\n\nPending marketplace listings are stored here for review.\n",
      "utf8",
    ).toString("base64"),
  });
  return { octokit, repo };
}

async function syncMarketplaceListingToGithub(user, item) {
  const repoConfig = await ensureMarketplaceRepoForUser(user);
  if (!repoConfig) return item;
  const { octokit, repo } = repoConfig;
  const packageData = buildMarketplaceSourcePackage({
    title: item.title || item.projectId || "marketplace-project",
    sourceHtml: item.sourceHtml || "",
    sourceFiles: item.sourceFiles || [],
    sourceEntryPath: item.sourceEntryPath || "index.html",
  });
  const repoFolderPath = normalizeRepoFilePath(packageData.folderSlug);
  try {
    await deleteGithubPathRecursive(
      octokit,
      user.githubUsername,
      repo,
      repoFolderPath,
    );
  } catch (error) {
    const status = error?.status || error?.response?.status;
    if (status !== 404) throw error;
  }
  for (const file of packageData.files) {
    const filePath = normalizeRepoFilePath(`${repoFolderPath}/${file.path}`);
    const rawContent = String(file?.content || "");
    const contentBase64 =
      String(file?.contentBase64 || "").trim() ||
      Buffer.from(rawContent, "utf8").toString("base64");
    await upsertGithubFile({
      octokit,
      owner: user.githubUsername,
      repo,
      path: filePath,
      message: `Sync marketplace listing ${item.title || packageData.folderSlug}`,
      contentBase64,
    });
  }
  item.marketplaceRepo = repo;
  item.marketplaceRepoPath = repoFolderPath;
  item.sourceEntryPath = packageData.entryPath;
  item.updatedAt = new Date();
  await item.save();
  return item;
}

async function syncMarketplaceItemAsBuilderTemplate(item) {
  const slugBase = slugifyProjectFolderName(item?.title || "official-template");
  let slug = slugBase;
  let suffix = 2;
  while (
    await BuilderTemplate.exists({
      slug,
      _id: { $ne: item?.builderTemplateId || null },
    })
  ) {
    slug = `${slugBase}-${suffix}`;
    suffix += 1;
  }
  const templateHtml = String(item.sourceHtml || "").trim();
  let htmlUrl = "";
  let htmlFileId = "";
  let storageProvider = "mongo";
  if (templateHtml) {
    try {
      const uploadedTemplate = await uploadFileToImageKit({
        fileBuffer: Buffer.from(templateHtml, "utf8"),
        fileName: "index.html",
        folder: `/medialab/templates/${slug}`,
        tags: ["medialab", "builder-template", slug],
      });
      htmlUrl = uploadedTemplate.url;
      htmlFileId = uploadedTemplate.fileId;
      storageProvider = "imagekit";
    } catch (uploadError) {
      console.warn("Template ImageKit upload skipped:", uploadError.message);
    }
  }
  const template = await BuilderTemplate.findOneAndUpdate(
    { sourceMarketplaceItemId: item._id },
    {
      $set: {
        slug,
        title: item.title || "Official Template",
        description:
          item.description ||
          item.purpose ||
          "Official MediaLab builder template.",
        category: item.category || "General",
        html: templateHtml,
        htmlUrl,
        htmlFileId,
        storageProvider,
        authorId: item.authorId || null,
        authorName: item.authorName || "MediaLab Creator",
        isOfficial: true,
        isActive: true,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
        sourceMarketplaceItemId: item._id,
      },
    },
    { upsert: true, new: true },
  ).lean();
  return template;
}

async function fetchMarketplaceSourceHtml(author, projectId = "") {
  const sourceProject = findLiveProject(author, projectId);
  if (
    !sourceProject?.fileName ||
    !author?.githubUsername ||
    !author?.githubToken
  ) {
    return { sourceProject: sourceProject || null, html: "" };
  }
  const octokit = buildGithubClient(author);
  const response = await octokit.rest.repos.getContent({
    owner: author.githubUsername,
    repo: getUserGithubRepoName(author),
    path: sourceProject.fileName,
  });
  const data = response?.data;
  if (!data || Array.isArray(data) || !data.content) {
    return { sourceProject, html: "" };
  }
  const html = Buffer.from(String(data.content || ""), "base64").toString(
    "utf8",
  );
  return { sourceProject, html };
}

function buildMarketplaceProjectId(
  sourceType = "draft",
  projectId = "",
  title = "",
) {
  const raw = String(projectId || "").trim();
  if (raw) return raw;
  const seed = sanitizeMarketplaceText(title || "marketplace-project", 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${String(sourceType || "draft").trim() || "draft"}:${seed || "project"}:${Date.now()}`;
}

async function transferMarketplaceProjectToBuyer(listing, buyer) {
  const author = await User.findById(listing.authorId).select("+githubToken");
  if (!author) {
    throw new Error("The seller account for this project could not be found.");
  }
  const inlineHtml = String(listing?.sourceHtml || "").trim();
  const { sourceProject, html } = inlineHtml
    ? { sourceProject: null, html: inlineHtml }
    : await fetchMarketplaceSourceHtml(author, listing.projectId);
  const draftName = `${sanitizeMarketplaceText(listing.title || sourceProject?.name || "Marketplace Project", 80)} Purchase`;
  buyer.builderDrafts = Array.isArray(buyer.builderDrafts)
    ? buyer.builderDrafts
    : [];
  buyer.builderDrafts = buyer.builderDrafts.filter(
    (draft) => String(draft?.name || "").trim() !== draftName,
  );
  buyer.builderDrafts.unshift({
    name: draftName,
    canvasHtml:
      html || `<!-- Imported from MediaLab Marketplace: ${draftName} -->`,
    pageBackground: "#ffffff",
    isAutoSave: false,
    savedAt: new Date(),
  });
  if (buyer.builderDrafts.length > 10) {
    buyer.builderDrafts = buyer.builderDrafts.slice(0, 10);
  }
  await buyer.save();
  return {
    name: draftName,
    sourceProjectName: sourceProject?.name || listing.title || "",
    liveUrl:
      sourceProject?.renderUrl ||
      sourceProject?.liveUrl ||
      listing.liveUrl ||
      "",
  };
}

function getAdsenseOAuthClient(user) {
  const refreshToken = decryptGoogleRefreshToken(
    user?.googleRefreshToken || "",
  );
  if (!refreshToken) {
    throw new Error(
      "Connect AdSense with Google first to load real-time stats.",
    );
  }
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL,
  );
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

function normalizeAdsenseReviewState(status = "") {
  const raw = String(status || "")
    .trim()
    .toUpperCase();
  if (!raw) return "disconnected";
  if (
    [
      "REQUIRES_REVIEW",
      "GETTING_READY",
      "PENDING",
      "PENDING_REVIEW",
      "REVIEWING",
      "AWAITING_REVIEW",
    ].includes(raw)
  ) {
    return "pending";
  }
  return "approved";
}

async function refreshAdsenseSiteStatusIfNeeded(user, { force = false } = {}) {
  if (
    !user?.googleRefreshToken ||
    !user?.adsenseAccountName ||
    !user?.adsenseSiteUrl
  ) {
    return {
      siteStatus: String(user?.adsenseSiteStatus || "").trim(),
      reviewState: normalizeAdsenseReviewState(user?.adsenseSiteStatus || ""),
      lastCheckedAt: user?.adsenseLastCheckedAt || null,
      approvedAt: user?.adsenseApprovedAt || null,
      changed: false,
    };
  }

  const reviewState = normalizeAdsenseReviewState(user.adsenseSiteStatus || "");
  const lastCheckedAt = user?.adsenseLastCheckedAt
    ? new Date(user.adsenseLastCheckedAt)
    : null;
  const checkAgeMs = lastCheckedAt
    ? Date.now() - lastCheckedAt.getTime()
    : Number.POSITIVE_INFINITY;
  const sixHoursMs = 6 * 60 * 60 * 1000;
  if (!force && reviewState !== "pending" && checkAgeMs < sixHoursMs) {
    return {
      siteStatus: String(user.adsenseSiteStatus || "").trim(),
      reviewState,
      lastCheckedAt: user.adsenseLastCheckedAt || null,
      approvedAt: user.adsenseApprovedAt || null,
      changed: false,
    };
  }
  if (!force && reviewState === "pending" && checkAgeMs < sixHoursMs) {
    return {
      siteStatus: String(user.adsenseSiteStatus || "").trim(),
      reviewState,
      lastCheckedAt: user.adsenseLastCheckedAt || null,
      approvedAt: user.adsenseApprovedAt || null,
      changed: false,
    };
  }

  const auth = getAdsenseOAuthClient(user);
  const adsense = google.adsense({ version: "v2", auth });
  const targetDomain =
    extractDomainNameFromUrl(user.adsenseSiteUrl) ||
    String(user.adsenseSiteUrl || "")
      .trim()
      .toLowerCase();
  const sitesResponse = await adsense.accounts.sites.list({
    parent: user.adsenseAccountName,
    pageSize: 200,
  });
  const sites = sitesResponse.data?.sites || [];
  const matchedSite = sites.find((site) => {
    const siteUrl =
      site.siteUrl ||
      site.url ||
      site.domain ||
      site.reportingDimensionId ||
      "";
    const siteDomain =
      extractDomainNameFromUrl(siteUrl) || String(siteUrl).trim().toLowerCase();
    return siteDomain === targetDomain;
  });

  const previousStatus = String(user.adsenseSiteStatus || "").trim();
  const previousReviewState = normalizeAdsenseReviewState(previousStatus);
  const nextStatus = String(
    matchedSite?.state ||
      matchedSite?.status ||
      matchedSite?.platformType ||
      previousStatus,
  ).trim();
  const nextReviewState = normalizeAdsenseReviewState(nextStatus);

  user.adsenseSiteStatus = nextStatus;
  user.adsenseLastCheckedAt = new Date();
  if (nextReviewState === "approved" && !user.adsenseApprovedAt) {
    user.adsenseApprovedAt = new Date();
  }
  if (nextReviewState !== "approved") {
    user.adsenseApprovedAt = null;
  }
  const changed =
    previousStatus !== nextStatus ||
    !lastCheckedAt ||
    previousReviewState !== nextReviewState;
  if (changed || force) {
    await user.save();
  }

  if (changed && user?._id) {
    if (nextReviewState === "approved" && previousReviewState !== "approved") {
      await createUserNotification({
        userId: user._id,
        type: "adsense-approved",
        title: "AdSense approved",
        message:
          "Your AdSense account is approved. You can now monetize eligible MediaLab projects.",
        targetType: "console",
        metadata: {
          siteStatus: nextStatus,
          siteUrl: user.adsenseSiteUrl || "",
        },
      });
    } else if (
      ["pending", "review"].includes(nextReviewState) &&
      previousReviewState !== nextReviewState
    ) {
      await createUserNotification({
        userId: user._id,
        type: "adsense-review",
        title: "AdSense verification started",
        message:
          "Google has started reviewing your AdSense site. MediaLab will keep checking the status for you.",
        targetType: "console",
        metadata: {
          siteStatus: nextStatus,
          siteUrl: user.adsenseSiteUrl || "",
        },
      });
    }
  }

  return {
    siteStatus: nextStatus,
    reviewState: nextReviewState,
    lastCheckedAt: user.adsenseLastCheckedAt,
    approvedAt: user.adsenseApprovedAt || null,
    changed,
  };
}

function collectHostedDomains(projects = []) {
  const urls = projects.flatMap((project) => [
    project?.renderUrl || "",
    project?.liveUrl || project?.url || "",
  ]);
  return [
    ...new Set(
      urls
        .map((url) => {
          try {
            return new URL(url).hostname;
          } catch {
            return "";
          }
        })
        .filter(Boolean),
    ),
  ];
}

function collectHostedProjectDomains(user) {
  return collectHostedDomains(
    Array.isArray(user?.liveProjects) ? user.liveProjects : [],
  );
}

async function getAdsenseDomainStats(user, targetUrl = "") {
  const domainName = extractDomainNameFromUrl(targetUrl);
  if (!user?.googleRefreshToken || !domainName) {
    return {
      estimatedEarnings: 0,
      impressions: 0,
      pageViewsRpm: 0,
      clicks: 0,
      ctr: 0,
    };
  }
  const auth = getAdsenseOAuthClient(user);
  const adsense = google.adsense({ version: "v2", auth });
  const accountResponse = await adsense.accounts.list({ pageSize: 1 });
  const accountName = accountResponse.data?.accounts?.[0]?.name;
  if (!accountName) {
    return {
      estimatedEarnings: 0,
      impressions: 0,
      pageViewsRpm: 0,
      clicks: 0,
      ctr: 0,
    };
  }
  const metrics = [
    "ESTIMATED_EARNINGS",
    "IMPRESSIONS",
    "PAGE_VIEWS_RPM",
    "CLICKS",
  ];
  const report = await adsense.accounts.reports.generate({
    account: accountName,
    dateRange: "LAST_7_DAYS",
    dimensions: ["DOMAIN_NAME"],
    metrics,
    filters: [`DOMAIN_NAME==${domainName}`],
    languageCode: "en",
    limit: 1,
  });
  const totals =
    report.data?.totals?.cells || report.data?.rows?.[0]?.cells || [];
  const metricCells = totals.slice(-metrics.length);
  const impressions = Number(metricCells[1]?.value || 0);
  const clicks = Number(metricCells[3]?.value || 0);
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  return {
    estimatedEarnings: Number(Number(metricCells[0]?.value || 0).toFixed(2)),
    impressions: Math.round(impressions),
    pageViewsRpm: Number(Number(metricCells[2]?.value || 0).toFixed(2)),
    clicks: Math.round(clicks),
    ctr: Number(ctr.toFixed(2)),
  };
}

function isAllowedAdsenseProjectUrl(user, rawUrl = "") {
  const normalized = normalizeRenderUrl(rawUrl);
  if (!normalized) return false;
  const allowedUrls = new Set();
  const projects = Array.isArray(user?.liveProjects) ? user.liveProjects : [];
  projects.forEach((project) => {
    [project?.renderUrl, project?.liveUrl, project?.url].forEach((value) => {
      const candidate = normalizeRenderUrl(value || "");
      if (candidate) allowedUrls.add(candidate);
    });
  });
  if (allowedUrls.has(normalized)) return true;
  try {
    const parsed = new URL(normalized);
    if (
      user?.githubUsername &&
      parsed.hostname === `${user.githubUsername}.github.io` &&
      parsed.pathname.startsWith("/medialab/")
    ) {
      return true;
    }
  } catch {}
  return false;
}

function extractDomainNameFromUrl(url = "") {
  try {
    return new URL(String(url || "").trim()).hostname;
  } catch {
    return "";
  }
}

function detectAdsenseScript(html = "", adsenseId = "") {
  const source = String(html || "");
  if (!source) return false;
  const hasScript =
    /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/i.test(
      source,
    );
  if (!hasScript) return false;
  if (!adsenseId) return true;
  return source.includes(String(adsenseId).trim());
}

function detectDeviceLabel(userAgent = "") {
  const ua = String(userAgent || "").toLowerCase();
  if (!ua) return "Unknown Device";
  const device = /android/.test(ua)
    ? "Android"
    : /(iphone|ipad|ipod)/.test(ua)
      ? "iPhone"
      : /windows/.test(ua)
        ? "Windows"
        : /macintosh|mac os x/.test(ua)
          ? "Mac"
          : /linux/.test(ua)
            ? "Linux"
            : "Web";
  const browser = /edg\//.test(ua)
    ? "Edge"
    : /chrome\//.test(ua)
      ? "Chrome"
      : /safari\//.test(ua) && !/chrome\//.test(ua)
        ? "Safari"
        : /firefox\//.test(ua)
          ? "Firefox"
          : /opr\//.test(ua) || /opera/.test(ua)
            ? "Opera"
            : "Browser";
  return `${device} • ${browser}`;
}

function extractClientIp(req = null) {
  if (!req) return "";
  const forwardedFor = req.headers?.["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return (
      forwardedFor
        .split(",")
        .map((entry) => String(entry || "").trim())
        .find(Boolean) || ""
    );
  }
  if (Array.isArray(forwardedFor) && forwardedFor.length) {
    return String(forwardedFor[0] || "").trim();
  }
  return String(
    req.ip ||
      req.socket?.remoteAddress ||
      req.connection?.remoteAddress ||
      req.info?.ip ||
      "",
  ).trim();
}

function buildUsageIdentity(req) {
  const userAgent = String(req.headers["user-agent"] || "").trim();
  return {
    user: req.user || null,
    email: req.user?.email || "",
    name: req.user?.name || "",
    isAnonymous: !req.user,
    isPro: Boolean(req.user?.isPro),
    usageMetadata: {
      device: detectDeviceLabel(userAgent),
      userAgent,
      ip: extractClientIp(req),
    },
  };
}

function detectBrowserLabel(userAgent = "") {
  const ua = String(userAgent || "").toLowerCase();
  if (!ua) return "Browser";
  if (/edg\//.test(ua)) return "Edge";
  if (/opr\//.test(ua) || /opera/.test(ua)) return "Opera";
  if (/firefox\//.test(ua)) return "Firefox";
  if (/chrome\//.test(ua)) return "Chrome";
  if (/safari\//.test(ua) && !/chrome\//.test(ua)) return "Safari";
  return "Browser";
}

function detectDeviceClass(userAgent = "", metadata = {}) {
  const ua = String(userAgent || "").toLowerCase();
  const width = Number(metadata?.screenWidth || metadata?.viewportWidth || 0);
  const height = Number(
    metadata?.screenHeight || metadata?.viewportHeight || 0,
  );
  const shortestSide = Math.min(width || 0, height || 0);
  const longestSide = Math.max(width || 0, height || 0);
  const platform = String(metadata?.platform || "").toLowerCase();
  const maxTouchPoints = Number(metadata?.maxTouchPoints || 0);
  const coarsePointer = Boolean(metadata?.coarsePointer);
  const hoverCapable =
    metadata?.hoverCapable === undefined
      ? false
      : Boolean(metadata.hoverCapable);
  const mobileHint = Boolean(metadata?.mobileHint);
  const clientDeviceClass = String(metadata?.clientDeviceClass || "").trim();
  if (["Phone", "Tablet", "Laptop"].includes(clientDeviceClass)) {
    return clientDeviceClass;
  }
  const uaSuggestsTablet =
    /ipad|tablet/.test(ua) || (/android/.test(ua) && !/mobile/.test(ua));
  const uaSuggestsPhone =
    /iphone|ipod|mobile/.test(ua) || (/android/.test(ua) && /mobile/.test(ua));
  const desktopPlatform = /win|mac|linux|x11|cros/.test(platform);
  const appleTabletLike =
    /ipad/.test(ua) ||
    (platform.includes("mac") && maxTouchPoints > 1 && coarsePointer);
  if (appleTabletLike || uaSuggestsTablet) {
    return "Tablet";
  }
  if (uaSuggestsPhone || (mobileHint && !desktopPlatform)) {
    return "Phone";
  }
  if (
    desktopPlatform &&
    (!coarsePointer || hoverCapable || maxTouchPoints === 0)
  ) {
    return "Laptop";
  }
  if (
    coarsePointer &&
    maxTouchPoints > 0 &&
    shortestSide > 0 &&
    shortestSide < 600
  ) {
    return "Phone";
  }
  if (
    coarsePointer &&
    maxTouchPoints > 0 &&
    shortestSide >= 600 &&
    shortestSide <= 1100 &&
    longestSide <= 1600
  ) {
    return "Tablet";
  }
  if (ua || width || height) {
    return "Laptop";
  }
  return "Unknown Device";
}

function enrichUsageMetadata(rawMetadata = {}, userAgent = "", req = null) {
  const metadata =
    rawMetadata && typeof rawMetadata === "object" ? { ...rawMetadata } : {};
  metadata.userAgent = String(metadata.userAgent || userAgent || "").trim();
  metadata.ip = String(metadata.ip || extractClientIp(req) || "").trim();
  const viewportWidth = Number(metadata.viewportWidth || 0);
  const viewportHeight = Number(metadata.viewportHeight || 0);
  const screenWidth = Number(metadata.screenWidth || 0);
  const screenHeight = Number(metadata.screenHeight || 0);
  if (viewportWidth > 0) metadata.viewportWidth = viewportWidth;
  if (viewportHeight > 0) metadata.viewportHeight = viewportHeight;
  if (screenWidth > 0) metadata.screenWidth = screenWidth;
  if (screenHeight > 0) metadata.screenHeight = screenHeight;
  metadata.browser = detectBrowserLabel(metadata.userAgent);
  metadata.device = detectDeviceClass(metadata.userAgent, metadata);
  metadata.deviceLabel = metadata.device;
  return metadata;
}

function hashReferralSignal(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function buildReferralFingerprintSeed(metadata = {}, userAgent = "") {
  const explicitFingerprint = String(
    metadata?.installFingerprint || metadata?.clientFingerprint || "",
  ).trim();
  if (explicitFingerprint) return explicitFingerprint;
  return [
    String(metadata?.platform || "")
      .trim()
      .toLowerCase(),
    String(metadata?.browser || "")
      .trim()
      .toLowerCase(),
    String(metadata?.device || metadata?.clientDeviceClass || "")
      .trim()
      .toLowerCase(),
    String(metadata?.screenWidth || metadata?.viewportWidth || "").trim(),
    String(metadata?.screenHeight || metadata?.viewportHeight || "").trim(),
    String(metadata?.devicePixelRatio || "").trim(),
    String(metadata?.maxTouchPoints || "").trim(),
    metadata?.coarsePointer ? "1" : "0",
    metadata?.hoverCapable ? "1" : "0",
    metadata?.mobileHint ? "1" : "0",
    String(metadata?.timezone || "")
      .trim()
      .toLowerCase(),
    String(metadata?.language || "")
      .trim()
      .toLowerCase(),
    String(metadata?.hardwareConcurrency || "").trim(),
    String(metadata?.deviceMemory || "").trim(),
    String(userAgent || "")
      .trim()
      .toLowerCase(),
  ]
    .filter(Boolean)
    .join("|");
}

function extractReferralSignals(rawMetadata = {}, userAgent = "", req = null) {
  const metadata = enrichUsageMetadata(rawMetadata, userAgent, req);
  const fingerprintSeed = buildReferralFingerprintSeed(
    metadata,
    metadata.userAgent || userAgent,
  );
  return {
    metadata,
    fingerprintHash: hashReferralSignal(fingerprintSeed),
    ipHash: hashReferralSignal(extractClientIp(req)),
  };
}

async function findReferralLedgerForFingerprint(fingerprintHash = "") {
  const normalizedHash = String(fingerprintHash || "").trim();
  if (!normalizedHash) return null;
  return ReferralLedger.findOne({ fingerprintHash: normalizedHash })
    .sort({ updatedAt: -1 })
    .lean();
}

async function upsertReferralLedgerEntry({
  fingerprintHash = "",
  ipHash = "",
  user = null,
  referrer = null,
  referralCode = "",
  status = "seen",
  reason = "",
  rewardDownloadId = null,
  rewardAmount = 0,
  installRewardedAt = null,
  metadata = {},
} = {}) {
  const normalizedFingerprintHash = String(fingerprintHash || "").trim();
  const normalizedReferralCode = String(referralCode || "").trim();
  const query = normalizedFingerprintHash
    ? { fingerprintHash: normalizedFingerprintHash }
    : {
        claimantUserId: user?._id || null,
        referralCode: normalizedReferralCode,
      };
  await ReferralLedger.findOneAndUpdate(
    query,
    {
      $set: {
        ...(normalizedFingerprintHash
          ? { fingerprintHash: normalizedFingerprintHash }
          : {}),
        ipHash: String(ipHash || "").trim(),
        claimantUserId: user?._id || null,
        claimantEmail: String(user?.email || "")
          .trim()
          .toLowerCase(),
        referrerUserId: referrer?._id || null,
        referralCode: normalizedReferralCode,
        rewardDownloadId: rewardDownloadId || null,
        rewardAmount: Number(rewardAmount || 0),
        installRewardedAt: installRewardedAt || null,
        status: String(status || "seen").trim(),
        reason: String(reason || "").trim(),
        device: String(
          metadata?.device || metadata?.clientDeviceClass || "",
        ).trim(),
        platform: String(metadata?.platform || "").trim(),
        browser: String(metadata?.browser || "").trim(),
        userAgent: String(metadata?.userAgent || "").trim(),
        metadata: metadata && typeof metadata === "object" ? metadata : {},
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

function getReferralFraudMessage() {
  return "This device has already been used for a referral install. Use a first-time install on a different device.";
}

function buildRichUsageIdentity(req) {
  const userAgent = String(req.headers["user-agent"] || "").trim();
  return {
    user: req.user || null,
    email: req.user?.email || "",
    name: req.user?.name || "",
    isAnonymous: !req.user,
    isPro: Boolean(req.user?.isPro),
    usageMetadata: enrichUsageMetadata({}, userAgent, req),
  };
}

async function ensureUserReferralCode(user) {
  if (!user) return user;
  if (String(user.referralCode || "").trim()) return user;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = generateReferralCode(user);
    const existing = await User.findOne({ referralCode: candidate })
      .select("_id")
      .lean();
    if (existing) continue;
    user.referralCode = candidate;
    await user.save();
    return user;
  }
  throw new Error("Could not generate a unique referral code right now.");
}

function buildReferralLink(code = "") {
  const normalizedCode = String(code || "").trim();
  if (!normalizedCode) return "https://medialab-6b20.onrender.com/";
  return `https://medialab-6b20.onrender.com/${encodeURIComponent(normalizedCode)}`;
}

// --- 2. FOLDER & STATIC SETUP ---
const uploadDir = path.resolve(__dirname, "uploads");
const exportDir = path.resolve(__dirname, "exports");

[uploadDir, exportDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(
  cors({
    origin:
      process.env.NODE_ENV === "production"
        ? "https://medialab-6b20.onrender.com"
        : true,
    credentials: true,
  }),
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
function shouldApplyWebContainerIsolation(req) {
  if (req.method === "OPTIONS") return false;
  return (
    req.path === "/studio-terminal" || req.path.startsWith("/studio-terminal/")
  );
}

app.use((req, res, next) => {
  if (shouldApplyWebContainerIsolation(req)) {
    res.set("Cross-Origin-Embedder-Policy", "require-corp");
    res.set("Cross-Origin-Opener-Policy", "same-origin");
  }
  next();
});

app.use((req, res, next) => {
  if (
    req.path === "/" ||
    req.path.endsWith(".html") ||
    req.path === "/sw.js" ||
    req.path === "/manifest.json"
  ) {
    res.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.set("Surrogate-Control", "no-store");
  }
  next();
});
app.post("/api/usage-log", async (req, res) => {
  try {
    const action = String(req.body?.action || "").trim();
    const summary = String(req.body?.summary || "").trim();
    if (!action || !summary) {
      return res
        .status(400)
        .json({ success: false, message: "Action and summary are required." });
    }
    const fallbackEmail = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const fallbackName = String(req.body?.name || "").trim();
    const fallbackIsPro = Boolean(req.body?.isPro);
    const hasFallbackIdentity = Boolean(fallbackEmail && fallbackName);
    const requestMetadata = enrichUsageMetadata(
      req.body?.metadata || {},
      String(req.headers["user-agent"] || "").trim(),
      req,
    );
    const payload = await createUsageLog({
      user: req.user || null,
      email: req.user?.email || fallbackEmail,
      name: req.user?.name || fallbackName,
      isAnonymous: req.user ? false : !hasFallbackIdentity,
      isPro: Boolean(req.user?.isPro || fallbackIsPro),
      action,
      summary,
      source: String(req.body?.source || "web").trim(),
      kind: req.body?.kind === "error" ? "error" : "activity",
      metadata: requestMetadata,
    });
    res.json({ success: true, log: payload });
  } catch (error) {
    console.error("Usage log endpoint failed:", error);
    res
      .status(500)
      .json({ success: false, message: "Could not save usage log." });
  }
});

app.post("/api/downloads", async (req, res) => {
  try {
    const type = String(req.body?.type || "pwa").trim() || "pwa";
    const source = String(req.body?.source || "web").trim() || "web";
    const platform = String(req.body?.platform || "").trim();
    const installState = String(req.body?.metadata?.installState || "")
      .trim()
      .toLowerCase();
    const referralSignals = extractReferralSignals(
      req.body?.metadata || {},
      String(req.headers["user-agent"] || "").trim(),
      req,
    );
    const fallbackEmail = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const fallbackName = String(req.body?.name || "").trim();
    const fallbackIsPro = Boolean(req.body?.isPro);
    const hasFallbackIdentity = Boolean(fallbackEmail && fallbackName);
    const record = await Download.create({
      userId: req.user?._id || null,
      email: req.user?.email || fallbackEmail,
      name: req.user?.name || fallbackName,
      isAnonymous: req.user ? false : !hasFallbackIdentity,
      type,
      platform,
      source,
      metadata: referralSignals.metadata,
    });

    if (req.user?._id && type === "pwa" && installState === "installed") {
      const installedUser = await User.findById(req.user._id);
      if (installedUser) {
        await ensureUserReferralCode(installedUser);
        const referredByCode = String(
          installedUser.referredByCode || "",
        ).trim();
        const alreadyRewarded = Array.isArray(installedUser.referralRewards)
          ? installedUser.referralRewards.some(
              (entry) =>
                String(entry?.downloadId || "") === String(record._id || ""),
            )
          : false;
        if (referredByCode && !alreadyRewarded) {
          const referrer = await User.findOne({ referralCode: referredByCode });
          if (referrer && String(referrer._id) !== String(installedUser._id)) {
            const priorDeviceEntry = await findReferralLedgerForFingerprint(
              referralSignals.fingerprintHash,
            );
            const deviceAlreadyUsedByAnotherUser = Boolean(
              priorDeviceEntry &&
              priorDeviceEntry.claimantUserId &&
              String(priorDeviceEntry.claimantUserId) !==
                String(installedUser._id),
            );
            const deviceAlreadyRewarded = Boolean(
              priorDeviceEntry &&
              priorDeviceEntry.installRewardedAt &&
              String(priorDeviceEntry.claimantUserId || "") !==
                String(installedUser._id),
            );
            if (deviceAlreadyUsedByAnotherUser || deviceAlreadyRewarded) {
              await upsertReferralLedgerEntry({
                fingerprintHash: referralSignals.fingerprintHash,
                ipHash: referralSignals.ipHash,
                user: installedUser,
                referrer,
                referralCode: referredByCode,
                status: "blocked",
                reason: "device-reused",
                metadata: {
                  ...referralSignals.metadata,
                  downloadId: record._id,
                  blockingReason: "device-reused",
                },
              });
              await createUsageLog({
                user: installedUser,
                email: installedUser.email,
                name: installedUser.name,
                isAnonymous: false,
                isPro: Boolean(installedUser.isPro),
                action: "referral-install-blocked",
                summary:
                  "referral reward blocked because this device was already used",
                source: "referral",
                metadata: {
                  reason: "device-reused",
                  fingerprintHash: referralSignals.fingerprintHash,
                  downloadId: record._id,
                },
              });
            } else {
              const priorReward = Array.isArray(referrer.referralRewards)
                ? referrer.referralRewards.some(
                    (entry) =>
                      String(entry?.referredUserId || "") ===
                      String(installedUser._id || ""),
                  )
                : false;
              if (!priorReward) {
                referrer.accountBalance = Number(
                  (Number(referrer.accountBalance || 0) + 0.01).toFixed(2),
                );
                referrer.referralInstallCount =
                  Number(referrer.referralInstallCount || 0) + 1;
                referrer.referralEarnings = Number(
                  (Number(referrer.referralEarnings || 0) + 0.01).toFixed(2),
                );
                referrer.referralRewards = [
                  ...(Array.isArray(referrer.referralRewards)
                    ? referrer.referralRewards
                    : []),
                  {
                    referredUserId: installedUser._id,
                    referredEmail: installedUser.email || "",
                    downloadId: record._id,
                    amount: 0.01,
                    rewardedAt: new Date(),
                  },
                ].slice(-500);
                await referrer.save();

                await createUsageLog({
                  user: referrer,
                  email: referrer.email,
                  name: referrer.name,
                  isAnonymous: false,
                  isPro: Boolean(referrer.isPro),
                  action: "referral-install-reward",
                  summary: `earned 0.01 from referral install by ${installedUser.email || "a new user"}`,
                  source: "referral",
                  metadata: {
                    referredUserId: installedUser._id,
                    downloadId: record._id,
                    amount: 0.01,
                  },
                });
                await createUserNotification({
                  userId: referrer._id,
                  type: "wallet-credit",
                  title: "You have received $0.01 from MediaLab",
                  message: `${installedUser.email || "A new user"} installed MediaLab with your referral link.`,
                  targetType: "wallet",
                  metadata: {
                    amount: 0.01,
                    reason: "referral-install",
                    referredUserId: installedUser._id,
                  },
                });
                await upsertReferralLedgerEntry({
                  fingerprintHash: referralSignals.fingerprintHash,
                  ipHash: referralSignals.ipHash,
                  user: installedUser,
                  referrer,
                  referralCode: referredByCode,
                  status: "rewarded",
                  reason: "first-install",
                  rewardDownloadId: record._id,
                  rewardAmount: 0.01,
                  installRewardedAt: new Date(),
                  metadata: {
                    ...referralSignals.metadata,
                    downloadId: record._id,
                  },
                });
              }
            }
          }
        }
      }
    }

    io.emit("admin:download", record.toObject());

    await createUsageLog({
      user: req.user || null,
      email: req.user?.email || fallbackEmail,
      name: req.user?.name || fallbackName,
      isAnonymous: req.user ? false : !hasFallbackIdentity,
      isPro: Boolean(req.user?.isPro || fallbackIsPro),
      action: "pwa-download",
      summary: `downloaded ${type} on ${platform || "unknown platform"}`,
      source,
      metadata: { downloadId: record._id, type, platform },
    });

    res.json({ success: true, download: record });
  } catch (error) {
    console.error("Download record endpoint failed:", error);
    res
      .status(500)
      .json({ success: false, message: "Could not save download." });
  }
});

app.get("/api/referrals/status", async (req, res) => {
  try {
    if (!req.user?._id) {
      return res
        .status(401)
        .json({ success: false, message: "Login required." });
    }
    const user = await User.findById(req.user._id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    await ensureUserReferralCode(user);
    return res.json({
      success: true,
      referralCode: user.referralCode,
      referralLink: buildReferralLink(user.referralCode),
      referralInstallCount: Number(user.referralInstallCount || 0),
      referralEarnings: Number(user.referralEarnings || 0),
      referredByCode: user.referredByCode || "",
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("Referral status failed:", error);
    return res.status(500).json({
      success: false,
      message: "Could not load referral info right now.",
    });
  }
});

app.post("/api/referrals/claim", async (req, res) => {
  try {
    if (!req.user?._id) {
      return res
        .status(401)
        .json({ success: false, message: "Login required." });
    }
    const referralCode = String(req.body?.referralCode || "").trim();
    if (!referralCode) {
      return res
        .status(400)
        .json({ success: false, message: "Referral code is required." });
    }
    const user = await User.findById(req.user._id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    await ensureUserReferralCode(user);
    if (String(user.referralCode || "") === referralCode) {
      return res.status(400).json({
        success: false,
        message: "You cannot use your own referral link.",
      });
    }
    if (String(user.referredByCode || "").trim()) {
      return res.json({
        success: true,
        message: "Referral link already saved for this account.",
        referralCode: user.referredByCode,
        user: toSafeUser(user),
      });
    }
    const referrer = await User.findOne({ referralCode });
    if (!referrer) {
      return res
        .status(404)
        .json({ success: false, message: "Referral code was not found." });
    }
    const referralSignals = extractReferralSignals(
      req.body?.metadata || {},
      String(req.headers["user-agent"] || "").trim(),
      req,
    );
    const priorDeviceEntry = await findReferralLedgerForFingerprint(
      referralSignals.fingerprintHash,
    );
    const deviceClaimedByAnotherUser = Boolean(
      priorDeviceEntry &&
      priorDeviceEntry.claimantUserId &&
      String(priorDeviceEntry.claimantUserId) !== String(user._id),
    );
    const deviceAlreadyRewarded = Boolean(
      priorDeviceEntry &&
      priorDeviceEntry.installRewardedAt &&
      String(priorDeviceEntry.claimantUserId || "") !== String(user._id),
    );
    if (deviceClaimedByAnotherUser || deviceAlreadyRewarded) {
      await upsertReferralLedgerEntry({
        fingerprintHash: referralSignals.fingerprintHash,
        ipHash: referralSignals.ipHash,
        user,
        referrer,
        referralCode,
        status: "blocked",
        reason: "device-reused",
        metadata: {
          ...referralSignals.metadata,
          blockingReason: "device-reused",
        },
      });
      return res.status(409).json({
        success: false,
        message: getReferralFraudMessage(),
      });
    }
    user.referredByCode = referralCode;
    await user.save();
    await upsertReferralLedgerEntry({
      fingerprintHash: referralSignals.fingerprintHash,
      ipHash: referralSignals.ipHash,
      user,
      referrer,
      referralCode,
      status: "claimed",
      reason: "pending-install",
      metadata: referralSignals.metadata,
    });
    await createUsageLog({
      user,
      email: user.email,
      name: user.name,
      isAnonymous: false,
      isPro: Boolean(user.isPro),
      action: "referral-linked",
      summary: `joined via referral code ${referralCode}`,
      source: "referral",
      metadata: { referralCode, referrerUserId: referrer._id },
    });
    return res.json({
      success: true,
      message: "Referral link saved. Install the app to complete the reward.",
      referralCode,
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("Referral claim failed:", error);
    return res.status(500).json({
      success: false,
      message: "Could not save referral link right now.",
    });
  }
});

app.get("/api/notifications", accountRateLimit, async (req, res) => {
  try {
    if (!req.user?._id) {
      return res
        .status(401)
        .json({ success: false, message: "Login required." });
    }
    await trimUserNotifications(req.user._id);
    const notifications = await listUserNotifications(req.user._id, 10);
    const unreadCount = await Notification.countDocuments({
      userId: req.user._id,
      isRead: false,
    });
    return res.json({
      success: true,
      notifications,
      unreadCount,
    });
  } catch (error) {
    console.error("Notifications fetch failed:", error);
    return res.status(500).json({
      success: false,
      message: "Could not load notifications right now.",
    });
  }
});

app.post(
  "/api/notifications/read",
  accountRateLimit,
  express.json(),
  async (req, res) => {
    try {
      if (!req.user?._id) {
        return res
          .status(401)
          .json({ success: false, message: "Login required." });
      }
      const notificationId = String(req.body?.notificationId || "").trim();
      if (notificationId) {
        await Notification.updateOne(
          { _id: notificationId, userId: req.user._id },
          { $set: { isRead: true, readAt: new Date() } },
        );
      } else {
        await Notification.updateMany(
          { userId: req.user._id, isRead: false },
          { $set: { isRead: true, readAt: new Date() } },
        );
      }
      const unreadCount = await Notification.countDocuments({
        userId: req.user._id,
        isRead: false,
      });
      return res.json({ success: true, unreadCount });
    } catch (error) {
      console.error("Notification read failed:", error);
      return res.status(500).json({
        success: false,
        message: "Could not update notifications right now.",
      });
    }
  },
);

app.get(
  "/api/admin/notifications",
  adminRateLimit,
  requireAdminApi,
  async (_req, res) => {
    try {
      const recent = await Notification.find({})
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();
      return res.json({
        success: true,
        notifications: recent.map((item) => serializeNotification(item)),
      });
    } catch (error) {
      console.error("Admin notifications fetch failed:", error);
      return res
        .status(500)
        .json({ success: false, message: "Could not load notifications." });
    }
  },
);

app.post(
  "/api/admin/notifications",
  adminRateLimit,
  requireAdminApi,
  express.json(),
  async (req, res) => {
    try {
      const mode = String(req.body?.mode || "all")
        .trim()
        .toLowerCase();
      const message = String(req.body?.message || "").trim();
      const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();
      if (!message) {
        return res.status(400).json({
          success: false,
          message: "Notification message is required.",
        });
      }
      if (mode === "individual") {
        if (!email) {
          return res
            .status(400)
            .json({ success: false, message: "Enter the user email first." });
        }
        const user = await User.findOne({ email });
        if (!user) {
          return res.status(404).json({
            success: false,
            message: "User not found for that email.",
          });
        }
        const renderedMessage = renderAdminNotificationTemplate(message, user);
        const notification = await createUserNotification({
          userId: user._id,
          toEmail: user.email || "",
          fromEmail: "dev@gmail.com",
          fromName: "ML Community",
          deliveryScope: "individual",
          type: "admin",
          title: "New admin message",
          message: renderedMessage,
          targetType: "console",
          metadata: { scope: "individual", email, templateSource: message },
        });
        if (!notification) {
          return res.status(500).json({
            success: false,
            message: "Could not send this notification right now.",
          });
        }
        return res.json({
          success: true,
          message: "Notification sent to the selected user.",
        });
      }
      const users = await User.find({})
        .select("_id email name liveProjects projects")
        .lean();
      const notifications = [];
      for (const user of users) {
        const renderedMessage = renderAdminNotificationTemplate(message, user);
        const notification = await createUserNotification({
          userId: user._id,
          toEmail: user.email || "",
          fromEmail: "dev@gmail.com",
          fromName: "ML Community",
          deliveryScope: "all",
          type: "admin",
          title: "New admin announcement",
          message: renderedMessage,
          targetType: "console",
          metadata: { scope: "all", templateSource: message },
        });
        if (notification) notifications.push(notification);
      }
      if (!notifications.length) {
        return res.status(500).json({
          success: false,
          message: "Could not send notifications right now.",
        });
      }
      return res.json({
        success: true,
        message: "Notification sent to all users.",
      });
    } catch (error) {
      console.error("Admin notification send failed:", error);
      return res
        .status(500)
        .json({ success: false, message: "Could not send notifications." });
    }
  },
);

app.post("/api/history-projects", async (req, res) => {
  try {
    const project = req.body?.project || {};
    const toolType = String(project.toolType || "").trim();
    const fileName = String(project.fileName || "").trim();
    const fileUrl = String(project.fileUrl || "").trim();

    if (!toolType || !fileName || !fileUrl) {
      return res.status(400).json({
        success: false,
        message: "toolType, fileName, and fileUrl are required.",
      });
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Login required.",
      });
    }

    const user = await User.findById(req.user._id).select(
      "+googleRefreshToken",
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    user.projects = user.projects.filter((item) => item.fileUrl !== fileUrl);
    user.projects.push({
      toolType,
      fileName,
      fileUrl,
      status: "completed",
      createdAt: new Date(),
    });
    user.projects = user.projects
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .slice(-10);
    await user.save();

    res.json({ success: true, projects: user.projects });
  } catch (error) {
    console.error("History project save failed:", error);
    res
      .status(500)
      .json({ success: false, message: "Could not save project history." });
  }
});

// --- 3. DATABASE & SESSION ---
mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB Connected");
    await ensureAIModelsRegistry();
    await refreshAIModelsRegistryIfNeeded(true);
    startAIModelsRefreshLoop();
  })
  .catch((err) => console.error("❌ MongoDB error:", err));

app.use(
  session({
    proxy: true,
    name: "medialab.sid",
    secret: process.env.SESSION_SECRET || "medialab-secret-key",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      ttl: 365 * 24 * 60 * 60, // 1 year
    }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 365,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  }),
);

app.use(passport.initialize());
app.use(passport.session());

/**
 * ========== WORKFLOW SYSTEM (COMPLETELY INDEPENDENT) ==========
 * /api/workflow/process - Workflow-ONLY processing
 *
 * - Uses ONLY workflow-marked models
 * - NEVER uses online AI models
 * - NEVER falls back to external systems
 * - 100% autonomous workflow engine
 */
app.post("/api/workflow/process", async (req, res) => {
  try {
    await refreshAIModelsRegistryIfNeeded(false);
    if (!req.isAuthenticated?.() || !req.user?._id) {
      return res
        .status(401)
        .json({ success: false, message: "Login required." });
    }
    if (!GROQ_API_KEY) {
      return res.status(500).json({
        success: false,
        message: "Missing GROQ_API_KEY configuration.",
      });
    }

    const prompt = String(req.body?.prompt || "").trim();
    const mode = String(req.body?.mode || "workflow")
      .trim()
      .toLowerCase();
    const currentCode = String(req.body?.currentCode || "").trim();

    if (!prompt) {
      return res
        .status(400)
        .json({ success: false, message: "Prompt is required." });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    if (!user.aiQuota) {
      user.aiQuota = { dailyLimit: 10, usedToday: 0, lastUsed: null };
    }

    const now = new Date();
    if (!isSameCalendarDay(user.aiQuota.lastUsed, now)) {
      user.aiQuota.usedToday = 0;
    }
    const hasUnlimitedAi = isUnlimitedAiUser(user);
    const dailyLimit = Number(user.aiQuota.dailyLimit ?? 10);
    const usedToday = Number(user.aiQuota.usedToday ?? 0);
    if (!hasUnlimitedAi && usedToday >= dailyLimit) {
      return res.status(403).json({
        success: false,
        limitReached: true,
        message: "Daily AI credits reached. Upgrade to MediaLab Pro.",
      });
    }

    // === WORKFLOW-ONLY MODEL SELECTION ===
    // CRITICAL: Use ONLY workflow models, NEVER fall back to online AI
    let models = await AIModel.find({ isActive: true })
      .sort({ priority: 1, status: -1, modelId: 1 })
      .lean();
    models = buildWorkflowOnlyModels(models); // WORKFLOW ONLY - NO ONLINE AI

    if (!models.length) {
      // Self-heal: force a fresh model sync
      await refreshAIModelsRegistryIfNeeded(true);
      models = await AIModel.find({ isActive: true })
        .sort({ priority: 1, status: -1, modelId: 1 })
        .lean();
      models = buildWorkflowOnlyModels(models); // STILL WORKFLOW ONLY
    }

    if (!models.length) {
      return res.status(503).json({
        success: false,
        message:
          "No workflow models available. Workflow system is independent and cannot use online AI.",
      });
    }

    let workflowResult = "";
    let modelUsed = "";
    let lastError = null;

    // Try each workflow-exclusive model in priority order
    for (const model of models) {
      try {
        const groqResponse = await nodeFetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${GROQ_API_KEY}`,
            },
            body: JSON.stringify({
              model: model.modelId,
              temperature: 0.3, // Lower temp for workflow consistency
              messages: [
                {
                  role: "system",
                  content: `You are the MediaLab Workflow Engine - operating completely independently from external AI systems.

Your role:
- Process natural language commands from users
- Parse element creation requests: shapes, colors, animations, positions
- Generate HTML/CSS/animated specifications
- Return structured JSON for canvas element generation

You have access to WorkflowBrain parsing methods:
- detectInsertIntent(): Identify element creation commands
- parseNaturalLanguageIntent(): Extract semantic intent
- analyzeSmartInsertDescription(): Parse design specifications
- generateSmartCanvasElementSpec(): Create element specs

CRITICAL: You are COMPLETELY INDEPENDENT. You do NOT:
- Use online AI models
- Fall back to external systems
- Share data with online AI Chat
- Use online AI algorithms

You are a standalone autonomous system.`,
                },
                {
                  role: "user",
                  content: prompt,
                },
              ],
            }),
          },
        );

        if (!groqResponse.ok) {
          const errText = await groqResponse.text();
          throw new Error(errText || `Workflow model failed: ${model.modelId}`);
        }

        const payload = await groqResponse.json();
        const content = String(
          payload?.choices?.[0]?.message?.content || "",
        ).trim();

        if (!content) {
          throw new Error(
            `Empty response from workflow model ${model.modelId}`,
          );
        }

        workflowResult = content;
        modelUsed = model.modelId;

        // Mark model as successful
        await AIModel.updateOne(
          { _id: model._id },
          { $set: { status: "online", lastTested: new Date() } },
        );

        break; // Success - stop trying other models
      } catch (modelError) {
        console.error(
          `[WORKFLOW] Model ${model.modelId} failed:`,
          modelError.message,
        );
        lastError = modelError;

        // Mark as offline
        await AIModel.updateOne(
          { _id: model._id },
          { $set: { status: "offline", lastTested: new Date() } },
        );
      }
    }

    if (!workflowResult) {
      console.error(
        "[WORKFLOW] All workflow models exhausted. No online AI fallback available.",
        lastError,
      );
      return res.status(503).json({
        success: false,
        message:
          "Workflow system error: No models available. Workflow does not fall back to online AI.",
        details: lastError?.message || "Unknown error",
      });
    }

    // Update usage
    user.aiQuota.usedToday = Number(user.aiQuota.usedToday || 0) + 1;
    user.aiQuota.lastUsed = now;
    await user.save();

    await createUsageLog({
      user,
      action: "workflow-process",
      summary: `Workflow processing via ${modelUsed}`,
      source: "workflow",
      metadata: {
        modelUsed,
        mode,
        usedToday: Number(user.aiQuota.usedToday || 0),
        dailyLimit: Number(user.aiQuota.dailyLimit || 10),
      },
    });

    return res.json({
      success: true,
      workflowResult,
      modelUsed,
      mode: "workflow",
      system: "WORKFLOW_ONLY",
      creditsRemaining: hasUnlimitedAi
        ? null
        : Math.max(
            0,
            Number(user.aiQuota.dailyLimit || 10) -
              Number(user.aiQuota.usedToday || 0),
          ),
    });
  } catch (error) {
    console.error("[WORKFLOW] Endpoint error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Workflow processing failed.",
      system: "WORKFLOW_ONLY",
    });
  }
});

app.post("/api/ai/chat-edit", async (req, res) => {
  try {
    await refreshAIModelsRegistryIfNeeded(false);
    if (!req.isAuthenticated?.() || !req.user?._id) {
      return res
        .status(401)
        .json({ success: false, message: "Login required." });
    }
    if (!GROQ_API_KEY) {
      return res.status(500).json({
        success: false,
        message: "Missing GROQ_API_KEY configuration.",
      });
    }
    const prompt = String(req.body?.prompt || "").trim();
    const mode = String(req.body?.mode || "edit")
      .trim()
      .toLowerCase();
    const currentCode = String(req.body?.currentCode || "").trim();
    const activeFileName = String(req.body?.activeFileName || "").trim();
    const activeFileContent = String(req.body?.activeFileContent || "").trim();
    const workspaceIndex = Array.isArray(req.body?.workspaceIndex)
      ? req.body.workspaceIndex
      : [];
    const agentContext = String(req.body?.agentContext || "").trim();
    const agentPhase = String(req.body?.agentPhase || "execute")
      .trim()
      .toLowerCase();
    if (!prompt && mode !== "context") {
      return res
        .status(400)
        .json({ success: false, message: "Prompt is required." });
    }
    if (!currentCode && mode !== "chat" && mode !== "context") {
      return res
        .status(400)
        .json({ success: false, message: "Current code is required." });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    // === NO WORKFLOW PROCESSING IN ONLINE AI ===
    // This is the ONLINE-ONLY AI Chat route
    // It does NOT use WorkflowBrain algorithms
    // It does NOT process natural language parsing
    // It is COMPLETELY INDEPENDENT from the Workflow system
    // Workflow processing goes to /api/workflow/process instead

    let nlPreprocessingResult = null;
    let enrichedPrompt = prompt;

    if (!user.aiQuota) {
      user.aiQuota = { dailyLimit: 10, usedToday: 0, lastUsed: null };
    }
    const userContextKey = String(user._id || "").trim();
    if (mode === "context") {
      if (currentCode) await upsertAIContext(userContextKey, currentCode);
      return res.json({
        success: true,
        mode: "context",
        contextSynced: true,
      });
    }
    const now = new Date();
    if (!isSameCalendarDay(user.aiQuota.lastUsed, now)) {
      user.aiQuota.usedToday = 0;
    }
    const hasUnlimitedAi = isUnlimitedAiUser(user);
    const dailyLimit = Number(user.aiQuota.dailyLimit ?? 10);
    const usedToday = Number(user.aiQuota.usedToday ?? 0);
    if (!hasUnlimitedAi && usedToday >= dailyLimit) {
      return res.status(403).json({
        success: false,
        limitReached: true,
        message: "Daily AI credits reached. Upgrade to MediaLab Pro.",
      });
    }

    const storedContextCode = await getAIContextCode(userContextKey);
    const contextCode = currentCode || storedContextCode;

    let modelRecoveryUsed = false;
    // === TUTORIAL INTENT DETECTION ===
    // Check if user is asking for a tutorial/learning guidance
    const tutorialAnalysis = workflowBrain.parseTutorialRequest(prompt);
    const isTutorialRequest = tutorialAnalysis.isTutorialRequest;
    const tutorialTopic = tutorialAnalysis.learningTopic;
    const tutorialLabel = tutorialAnalysis.topicLabel;

    let models = await AIModel.find({ isActive: true })
      .sort({ priority: 1, status: -1, modelId: 1 })
      .lean();
    // === ONLINE-ONLY MODELS ===
    // Chat-edit uses ONLY online exclusive models, NEVER workflow models
    models = buildOnlineOnlyModels(models);
    if (!models.length) {
      // Self-heal: force a fresh model sync, then probe active models anyway.
      modelRecoveryUsed = true;
      await refreshAIModelsRegistryIfNeeded(true);
      models = await AIModel.find({ isActive: true })
        .sort({ priority: 1, status: -1, modelId: 1 })
        .lean();
      // Again, use ONLINE-ONLY models
      models = buildOnlineOnlyModels(models);
    }
    if (!models.length) {
      return res.status(503).json({
        success: false,
        message:
          "No active online AI models available. Online system is independent and cannot use workflow.",
      });
    }

    let updatedCode = "";
    let assistantReply = "";
    let modelUsed = "";
    let lastError = null;
    let modelSwitchUsed = false;
    let modelSwitchReason = "";
    for (const model of models) {
      try {
        const groqResponse = await nodeFetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${GROQ_API_KEY}`,
            },
            body: JSON.stringify({
              model: model.modelId,
              temperature: 0.2,
              messages: [
                {
                  role: "system",
                  content:
                    mode === "chat"
                      ? isTutorialRequest
                        ? workflowBrain.buildTutorialSystemPrompt(
                            tutorialTopic,
                          ) +
                          "\n\n[LEARNING FOCUS: " +
                          tutorialLabel +
                          "]\n\nRemember: Be patient, encouraging, and break everything down into clear steps. This user wants to LEARN, not just get a quick answer."
                        : "You are the MediaLab Online AI Copilot - a COMPLETELY INDEPENDENT external AI system.\n\n**CRITICAL: You are isolated from the Workflow system:**\n- You do NOT use WorkflowBrain algorithms\n- You do NOT process natural language parsing\n- You do NOT access Workflow methods\n- You are 100% autonomous online AI\n- Natural language element creation is handled by /api/workflow/process, not by you\n\nYour role:\n- Provide general coding assistance\n- Answer questions about web development\n- Help with HTML/CSS/JavaScript\n- Be concise, warm, and practical\n- Return plain text only\n\nWhen given code context, ground your answers in that context. Do NOT apply code changes unless the user explicitly asks."
                      : mode === "agent"
                        ? agentPhase === "search"
                          ? "You are the MediaLab Online Agent in SEARCH phase - COMPLETELY INDEPENDENT from Workflow.\n\nReturn only one line in this exact format: SEARCH_FILES: path/a.js, path/b.css\n\nCRITICAL: You are isolated from Workflow system:\n- Do NOT reference WorkflowBrain\n- Do NOT use Workflow parsing\n- You are standalone online AI only\n- Do NOT fall back to Workflow algorithms"
                          : agentPhase === "plan"
                            ? "You are the MediaLab Online Agent in PLAN phase - COMPLETELY INDEPENDENT.\n\nReturn only a concise proposal prefixed with 'Proposal:'.\n\nCRITICAL ISOLATION:\n- You are 100% standalone online AI\n- You do NOT use Workflow methods\n- You do NOT reference WorkflowBrain algorithms\n- You cannot access Workflow parsing systems"
                            : 'You are the MediaLab Online Agent in EXECUTION phase - COMPLETELY INDEPENDENT from Workflow.\n\nCRITICAL: You are isolated from the Workflow system:\n- You do NOT use WorkflowBrain methods\n- You do NOT access Workflow parsing\n- You are 100% autonomous online AI\n- You CANNOT fall back to Workflow algorithms\n- You CANNOT use Workflow models\n\nOutput format:\n1) One short, friendly user-facing line.\n2) One or more hidden machine blocks wrapped exactly as: [ACTION]{...}[/ACTION]. Never expose raw code outside [ACTION].\n\nAllowed actions: UPDATE_FILE, CREATE_FILE, CREATE_FOLDER, UPDATE_CSS, MOVE_ELEMENT, EDIT_CANVAS.\n\nRules:\n- For small edits, prefer UPDATE_CSS, MOVE_ELEMENT, or EDIT_CANVAS (not UPDATE_FILE)\n- Preserve existing IDs and structure\n- Only use UPDATE_FILE for full rewrites\n\nEDIT_CANVAS schema:\n[ACTION]{"type":"EDIT_CANVAS","ops":[{"op":"insert","elementType":"div",...},{"op":"move","selector":"#id","x":120,"y":80},...]}[/ACTION]'
                        : "You are the MediaLab Online AI Architect - COMPLETELY INDEPENDENT system.\n\nCRITICAL ISOLATION:\n- You are 100% standalone online AI\n- You do NOT use Workflow algorithms\n- You do NOT access WorkflowBrain\n- You do NOT process natural language parsing\n- Element creation requests go to /api/workflow/process, not to you\n\nYour role:\n- Return ONLY raw HTML and CSS/Tailwind code\n- No markdown, no backticks\n- Refactor code, generate full templates\n- Apply design updates with valid image URLs\n- Return valid, renderable HTML\n- Preserve element IDs and 'ml-container'/'ml-content' structure\n- Use explicit CSS for background changes",
                },
                {
                  role: "user",
                  content:
                    mode === "chat"
                      ? [
                          `ActiveFileName: ${activeFileName || "index.html"}`,
                          activeFileContent
                            ? `ActiveFileContent:\n${activeFileContent.slice(0, 16000)}`
                            : "",
                          contextCode
                            ? `CanvasCode:\n${contextCode.slice(0, 16000)}`
                            : "",
                          `UserMessage:\n${enrichedPrompt}`,
                        ]
                          .filter(Boolean)
                          .join("\n\n")
                      : mode === "agent"
                        ? [
                            `WorkspaceIndex: ${JSON.stringify(workspaceIndex)}`,
                            `AgentPhase: ${agentPhase}`,
                            `activeFileName: ${activeFileName || "index.html"}`,
                            `activeFileContent:\n${activeFileContent || currentCode}`,
                            agentContext
                              ? `AdditionalContext:\n${agentContext}`
                              : "",
                            `UserRequest:\n${enrichedPrompt}`,
                          ]
                            .filter(Boolean)
                            .join("\n\n")
                        : `Current HTML:\n${contextCode}\n\nInstruction:\n${enrichedPrompt}`,
                },
              ],
            }),
          },
        );
        if (!groqResponse.ok) {
          const errText = await groqResponse.text();
          throw new Error(
            errText || `Groq request failed for ${model.modelId}`,
          );
        }
        const payload = await groqResponse.json();
        const content = String(payload?.choices?.[0]?.message?.content || "")
          .replace(/<think>[\s\S]*?<\/think>/g, "")
          .trim();
        if (!content) {
          throw new Error(`Empty completion from ${model.modelId}`);
        }
        if (mode === "chat" || mode === "agent") {
          assistantReply = content;
        } else {
          updatedCode = content;
        }
        modelUsed = model.modelId;
        await AIModel.updateOne(
          { _id: model._id },
          { $set: { status: "online", lastTested: new Date() } },
        );
        break;
      } catch (modelError) {
        lastError = modelError;
        const errorText = String(modelError?.message || "").toLowerCase();
        const hitRateLimit =
          errorText.includes("rate_limit_exceeded") ||
          errorText.includes("rate limit reached") ||
          errorText.includes("tokens per minute") ||
          errorText.includes('"type":"tokens"');
        if (hitRateLimit) {
          modelSwitchUsed = true;
          modelSwitchReason = "rate_limit";
          aiModelCooldownUntil.set(
            model.modelId,
            Date.now() + parseRateLimitRetryMs(modelError?.message),
          );
        }
        await createUsageLog({
          user,
          action: "ai-model-error",
          summary: `[error] AI model failed: ${model.modelId} - ${String(modelError?.message || "unknown")} - ${new Date().toISOString()} --source(ai-chat)`,
          source: "ai-chat",
          kind: "error",
          metadata: {
            modelId: model.modelId,
            endpoint: "/api/ai/chat-edit",
            mode,
          },
        });
        // Rate-limited models may recover quickly; keep them online for future retries.
        if (hitRateLimit) {
          await AIModel.updateOne(
            { _id: model._id },
            { $set: { status: "online", lastTested: new Date() } },
          );
        } else {
          await AIModel.updateOne(
            { _id: model._id },
            { $set: { status: "offline", lastTested: new Date() } },
          );
        }
      }
    }

    if (
      (!updatedCode && !["chat", "agent"].includes(mode)) ||
      (!assistantReply && ["chat", "agent"].includes(mode)) ||
      !modelUsed
    ) {
      return res.status(503).json({
        success: false,
        message: lastError?.message || "No AI model could process the request.",
      });
    }

    user.aiQuota.usedToday = Number(user.aiQuota.usedToday || 0) + 1;
    user.aiQuota.lastUsed = now;
    await user.save();
    if (updatedCode) await upsertAIContext(userContextKey, updatedCode);
    else if (contextCode) await upsertAIContext(userContextKey, contextCode);
    await createUsageLog({
      user,
      action: "ai-chat-edit",
      summary: `used AI chat edit via ${modelUsed}`,
      source: "ai",
      metadata: {
        modelUsed,
        usedToday: Number(user.aiQuota.usedToday || 0),
        dailyLimit: Number(user.aiQuota.dailyLimit || 10),
      },
    });

    return res.json({
      success: true,
      updatedCode,
      assistantReply,
      mode,
      modelUsed,
      modelRecoveryUsed,
      modelSwitchUsed,
      modelSwitchReason,
      nlPreprocessing: nlPreprocessingResult,
      tutorialMode: isTutorialRequest
        ? {
            enabled: true,
            topic: tutorialTopic,
            topicLabel: tutorialLabel,
            confidence: tutorialAnalysis.tutorialConfidence,
            type: tutorialAnalysis.tutorialType,
            details: tutorialAnalysis.requestDetails,
            message:
              "📚 Tutorial Mode Active - Learning-focused guidance enabled",
          }
        : null,
      creditsRemaining: hasUnlimitedAi
        ? null
        : Math.max(
            0,
            Number(user.aiQuota.dailyLimit || 10) -
              Number(user.aiQuota.usedToday || 0),
          ),
    });
  } catch (error) {
    await createUsageLog({
      user: req.user || null,
      email: req.user?.email || "",
      name: req.user?.name || "",
      action: "ai-chat-edit-error",
      summary: `[error] AI chat endpoint failed: ${String(error?.message || "unknown")} - ${new Date().toISOString()} --source(ai-chat)`,
      source: "ai-chat",
      kind: "error",
      metadata: {
        endpoint: "/api/ai/chat-edit",
      },
    });
    res.status(500).json({
      success: false,
      message: error.message || "AI edit failed.",
    });
  }
});

app.post("/api/ai/workspace-fetch", async (req, res) => {
  try {
    if (!req.isAuthenticated?.() || !req.user?._id) {
      return res
        .status(401)
        .json({ success: false, message: "Login required." });
    }
    const path = String(req.body?.path || "").trim();
    const snapshot =
      req.body?.workspaceSnapshot &&
      typeof req.body.workspaceSnapshot === "object"
        ? req.body.workspaceSnapshot
        : {};
    const hasPath = Object.prototype.hasOwnProperty.call(snapshot, path);
    const content = hasPath ? String(snapshot[path] ?? "") : "";
    if (!path) {
      return res
        .status(400)
        .json({ success: false, message: "Path is required." });
    }
    if (!hasPath) {
      return res.status(404).json({
        success: false,
        message: "File not found in current workspace snapshot.",
      });
    }
    return res.json({ success: true, path, content });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Could not fetch workspace file.",
    });
  }
});

app.post("/api/ai/manager", async (req, res) => {
  try {
    if (!req.isAuthenticated?.() || !req.user?._id) {
      return res
        .status(401)
        .json({ success: false, message: "Login required." });
    }

    const userInput = String(req.body?.userInput || "")
      .trim()
      .toLowerCase();
    const currentCanvasCode = String(req.body?.currentCanvasCode || "").trim();

    if (!userInput) {
      return res
        .status(400)
        .json({ success: false, message: "User input is required." });
    }

    // Manager AI Agent - determines intent type
    const actionKeywords = [
      "change",
      "set",
      "add",
      "modify",
      "update",
      "remove",
      "delete",
      "create",
      "make",
      "fix",
      "apply",
      "style",
      "edit",
      "background",
      "color",
      "font",
      "size",
      "position",
      "layout",
      "align",
      "border",
      "shadow",
      "gradient",
      "image",
      "button",
      "input",
      "text",
      "hover",
      "animation",
      "transform",
      "opacity",
      "width",
      "height",
      "padding",
      "margin",
      "display",
      "flex",
      "grid",
      "rotate",
      "scale",
      "transition",
      "build",
      "replace",
      "swap",
      "insert",
      "reorder",
      "align",
      "center",
      "move",
      "copy",
      "duplicate",
      "layer",
      "section",
      "component",
      "template",
      "design",
      "format",
      "put",
      "place",
      "drop",
      "generate",
      "show",
    ];

    const negativeKeywords = [
      "hello",
      "hi",
      "hey",
      "how are you",
      "thanks",
      "thank you",
      "okay",
      "ok",
      "sure",
      "yes",
      "no",
      "maybe",
      "perhaps",
      "question",
      "ask",
      "tell me",
      "what is",
      "explain",
      "describe",
      "help",
      "guide",
      "tutorial",
      "example",
    ];

    const elementPatterns = [
      /button|input|text|image|box|container|card|header|footer|nav|menu|sidebar|modal|dialog|toast|modal/i,
      /bg|background|color|fill|stroke|border|shadow|gradient|opacity|filter|blur/i,
      /size|width|height|padding|margin|gap|spacing|align|justify|flex|grid/i,
      /font|text|size|weight|style|decoration|uppercase|lowercase|capitalize/i,
      /position|top|left|right|bottom|absolute|relative|fixed|sticky|z-index/i,
      /animation|transition|duration|timing|keyframe|hover|active|focus|disabled/i,
      /click|submit|reset|scroll|swipe|drag|drop|select|focus|blur/i,
    ];

    // Scoring system
    let actionScore = 0;
    const inputWords = userInput.split(/\s+/);

    // Check action keywords
    const hasActionKeyword = actionKeywords.some((kw) =>
      userInput.includes(kw),
    );
    if (hasActionKeyword) actionScore += 40;

    // Check for element/property references
    const hasElementPattern = elementPatterns.some((pattern) =>
      pattern.test(userInput),
    );
    if (hasElementPattern) actionScore += 30;

    // Check for negative indicators
    const hasNegativeKeyword = negativeKeywords.some((kw) =>
      userInput.includes(kw),
    );
    if (hasNegativeKeyword) actionScore -= 50;

    // Check for specific UI change indicators
    if (/\b(?:to|into|as|like|similar to|matching)\b/i.test(userInput))
      actionScore += 15;

    // Check if input mentions URLs, colors, measurements
    if (/(http|https|url|#[0-9a-f]{6}|rgb|px|em|rem|%|url\()/i.test(userInput))
      actionScore += 20;

    // Check for imperative/command tone
    if (
      /(^|\s)(?:please\s)?(?:can you|could you|would you|make|set|change|create|add|remove)\b/i.test(
        userInput,
      )
    ) {
      actionScore += 25;
    }

    // Finalize determination
    const isAction = actionScore >= 50;
    const confidence = Math.max(0, Math.min(100, 50 + actionScore));

    return res.json({
      success: true,
      decision: isAction ? "Action" : "Response",
      confidence,
      actionScore,
      userInput,
      reasoning: isAction
        ? "Input appears to be a code/design change command"
        : "Input appears to be a general chat query",
    });
  } catch (error) {
    console.error("Manager AI error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Manager AI analysis failed.",
    });
  }
});

// Helper: Extract HTML from AI response that might contain conversational text
function extractHTMLFromResponse(text = "") {
  const content = String(text || "").trim();

  // Try to extract from HTML code blocks first (```html ... ```)
  const htmlBlockMatch = content.match(/```html\s*([\s\S]*?)```/i);
  if (htmlBlockMatch?.[1]) {
    const extracted = htmlBlockMatch[1].trim();
    if (extracted.includes("<")) return extracted;
  }

  // Try generic code blocks (``` ... ```)
  const codeBlockMatch = content.match(/```\s*([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) {
    const extracted = codeBlockMatch[1].trim();
    if (extracted.includes("<")) return extracted;
  }

  // Find first < and take everything from there (line-based to avoid partial tags)
  const firstTagIndex = content.indexOf("<");
  if (firstTagIndex >= 0) {
    const extracted = content.substring(firstTagIndex).trim();
    // Verify it looks like HTML
    if (/<[a-zA-Z][^>]*>/i.test(extracted)) {
      return extracted;
    }
  }

  // If content starts with < (likely pure HTML)
  if (content.startsWith("<")) {
    return content;
  }

  // Fallback: return empty if no HTML found
  return "";
}

// Helper: Sanitize HTML to ensure all elements are visible
function sanitizeAutoFixHTML(html = "") {
  let content = String(html || "").trim();

  // Remove any opacity:0 or opacity: 0
  content = content.replace(/opacity\s*:\s*0(?![^;]*[0-9])/g, "opacity: 1");

  // Remove visibility:hidden and similar
  content = content.replace(/visibility\s*:\s*hidden/gi, "visibility: visible");

  // Remove display:none
  content = content.replace(/display\s*:\s*none/gi, "display: block");

  // Remove lines with only display:none in style attribute
  content = content.replace(
    /style="[^"]*display\s*:\s*none[^"]*"/gi,
    (match) => {
      // Reconstruct without the display:none part
      const style = match.replace(/display\s*:\s*none\s*;?/gi, "").trim();
      if (style === 'style=""') return 'style="display: block;"';
      if (style.endsWith(";")) return style.slice(0, -1) + ';"';
      return style + ';"';
    },
  );

  return content;
}

// BEST AI MODEL ENDPOINT - Auto-selects best available model (Xtra AI)
// Tests all models in parallel and returns the best performing one
app.post("/api/ai/best-model", async (req, res) => {
  try {
    if (!req.isAuthenticated?.() || !req.user?._id) {
      return res
        .status(401)
        .json({ success: false, message: "Login required." });
    }

    const userInput = String(req.body?.userInput || "").trim();
    const currentCode = String(req.body?.currentCanvasCode || "").trim();

    // Handle warmup requests (pre-cache best model selection)
    if (userInput === "warmup") {
      await refreshAIModelsRegistryIfNeeded(false);
      return res.json({
        success: true,
        message: "Xtra AI cache warmed",
        mode: "warmup",
      });
    }

    if (!userInput) {
      return res
        .status(400)
        .json({ success: false, message: "User input is required." });
    }

    await refreshAIModelsRegistryIfNeeded(false);

    let models = await AIModel.find({ isActive: true, status: "online" })
      .sort({ priority: 1, modelId: 1 })
      .lean();

    models = buildEligibleAiModels(models);

    if (!models.length) {
      return res.status(503).json({
        success: false,
        message: "No external AI models available. Fallback to internal.",
      });
    }

    // Test all models in parallel to find the best one
    const testPromises = models.map(async (model) => {
      try {
        const modelId = String(model?.modelId || "").trim();
        const apiKey = process.env.GROQ_API_KEY;

        if (!apiKey) return { model, success: false, responseTime: Infinity };

        const startTime = Date.now();
        const response = await nodeFetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: modelId,
              messages: [
                {
                  role: "system",
                  content: "You are MediaLab AI assistant.",
                },
                {
                  role: "user",
                  content: `Respond briefly: ${userInput.slice(0, 100)}`,
                },
              ],
              temperature: 0.7,
              max_tokens: 100,
            }),
            timeout: 8000,
          },
        );

        const responseTime = Date.now() - startTime;
        const data = await response.json();

        if (response.ok && data?.choices?.[0]?.message?.content) {
          return {
            model,
            success: true,
            responseTime,
            content: data.choices[0].message.content,
          };
        }

        return { model, success: false, responseTime: Infinity };
      } catch (error) {
        return { model, success: false, responseTime: Infinity };
      }
    });

    const results = await Promise.all(testPromises);

    // Filter successful responses and sort by response time
    const successful = results
      .filter((r) => r.success)
      .sort((a, b) => a.responseTime - b.responseTime);

    if (!successful.length) {
      return res.status(503).json({
        success: false,
        message: "All external models failed. Using internal AI.",
      });
    }

    const bestModel = successful[0];
    const modelId = bestModel.model.modelId;

    // Save best model selection to database for future use
    try {
      await AIModel.updateOne(
        { modelId },
        {
          $set: {
            lastTested: new Date(),
            status: "online",
          },
        },
      );
    } catch {}

    // Use the best model to generate full response
    const fullResponse = await nodeFetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            {
              role: "system",
              content:
                "You are MediaLab AI - a professional visual builder assistant with advanced natural language understanding and animation capabilities. NATURAL LANGUAGE PARSING: You can handle complex multi-attribute commands like 'drop a button with left and top outline slightly bigger and yellow with text saying click me at top of canvas'. Parse text content (e.g., 'saying click me'), border configurations ('left and top outline'), sizing modifiers ('slightly bigger'), colors, positions, and animation keywords in single commands. ANIMATION ABILITIES: Understand complex animation descriptions like 'bouncing neon ring glowing', 'floating cyan sphere with pulse'. Generate elements with these animations using CSS keyframes. ANIMATION KEYWORDS: bounce, glow, neon, pulse, spin, shimmer, wave, morph, float, shake, slide, fade. ELEMENT TYPES: button, input, text, link, card, box, container. COLORS: Support neon colors (#00FFFF, #00FF00, #FF00FF), plus standard colors. SHAPES: ring, circle, sphere, ball, box, wave. POSITIONING: top, bottom, left, right, center, top-left, top-right, bottom-left, bottom-right. Always generate CSS animations when user mentions movement or effects. Always include text content for buttons when specified. Help with canvas modifications, element insertion, styling, and complex animations.",
            },
            {
              role: "user",
              content: `Canvas:\n${currentCode.slice(0, 1000)}\n\nRequest: ${userInput}`,
            },
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
        timeout: 30000,
      },
    ).then((r) => r.json());

    if (!fullResponse?.choices?.[0]?.message?.content) {
      // Fall back to next best model
      if (successful.length > 1) {
        const nextBest = successful[1];
        const nextResponse = await nodeFetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: nextBest.model.modelId,
              messages: [
                {
                  role: "system",
                  content:
                    "You are MediaLab AI - a professional visual builder assistant with advanced natural language understanding. You understand complex multi-attribute commands like 'drop a button with left and top outline slightly bigger and yellow with text saying click me at top of canvas'. Parse element types, text content, border configurations, sizing modifiers, positions, and animations from natural language. Help with canvas modifications, element insertion, complex animations (bounce, glow, neon effects, pulse, shimmer), and styling. Support all shape types, element types, and animation combinations.",
                },
                {
                  role: "user",
                  content: `Canvas:\n${currentCode.slice(0, 1000)}\n\nRequest: ${userInput}`,
                },
              ],
              temperature: 0.7,
              max_tokens: 500,
            }),
            timeout: 30000,
          },
        ).then((r) => r.json());

        return res.json({
          success: true,
          content: nextResponse?.choices?.[0]?.message?.content || "",
          modelUsed: nextBest.model.modelId,
          provider: nextBest.model.provider,
          attempt: "secondary",
        });
      }

      return res.status(503).json({
        success: false,
        message: "Best model response generation failed.",
      });
    }

    return res.json({
      success: true,
      content: fullResponse.choices[0].message.content,
      modelUsed: modelId,
      provider: bestModel.model.provider,
      responseTime: bestModel.responseTime,
    });
  } catch (error) {
    console.error("Best model endpoint error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// XTRA AI ENDPOINT - Auto-selects best available model by testing all in parallel
app.post("/api/ai/best-model", async (req, res) => {
  try {
    if (!req.isAuthenticated?.() || !req.user?._id) {
      return res
        .status(401)
        .json({ success: false, message: "Login required." });
    }

    const userInput = String(req.body?.userInput || "").trim();
    const currentCode = String(req.body?.currentCanvasCode || "").trim();
    const requestedModelId = String(req.body?.modelId || "").trim();

    if (!userInput) {
      return res
        .status(400)
        .json({ success: false, message: "User input is required." });
    }

    // Use existing AI model infrastructure but specifically route to external models
    await refreshAIModelsRegistryIfNeeded(false);

    let models = await AIModel.find({ isActive: true })
      .sort({ priority: 1, status: -1, modelId: 1 })
      .lean();
    models = buildEligibleAiModels(models);

    if (!models.length) {
      return res.status(503).json({
        success: false,
        message: "No external AI models available. Fallback to internal.",
      });
    }

    // If a specific model was requested, prioritize it
    if (requestedModelId) {
      const requestedModel = models.find(
        (m) => String(m?.modelId || "") === requestedModelId,
      );
      if (requestedModel) {
        models = [
          requestedModel,
          ...models.filter(
            (m) => String(m?.modelId || "") !== requestedModelId,
          ),
        ];
      }
    }

    // Try to use first available model from existing infrastructure
    for (const model of models) {
      try {
        const modelId = String(model?.modelId || "").trim();
        const provider = String(model?.provider || "").trim();
        const apiKeyField = String(model?.apiKeyField || "").trim();
        const apiKey = process.env[apiKeyField] || GROQ_API_KEY;

        if (!apiKey) {
          console.warn(`No API key found for model ${modelId}, skipping...`);
          continue;
        }

        // Call existing external model infrastructure
        const modelResponse = await nodeFetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: modelId,
              messages: [
                {
                  role: "system",
                  content:
                    "You are MediaLab AI - advanced visual builder with natural language understanding. Create complex animated elements and detailed specifications from natural language. Understand commands like: 'drop a button with left and top outline slightly bigger and yellow with text saying click me at top of canvas'. Parse and handle: element types (button, input, text, link, etc), text content, border configurations, sizing modifiers (slightly bigger, tiny, xl), positioning hints (top, center, bottom-left, etc), and animations. Generate CSS @keyframes and animations from natural language descriptions. Support shapes: ring, circle, sphere, box, wave. Support effects: glow, shimmer, bounce, pulse, spin, morph, float. Always provide full CSS animation code and element specifications.",
                },
                {
                  role: "user",
                  content: `Canvas:\n${currentCode.slice(0, 1000)}\n\nRequest: ${userInput}`,
                },
              ],
              temperature: 0.7,
              max_tokens: 500,
            }),
            timeout: 30000,
          },
        ).then((r) => r.json());

        if (!modelResponse?.choices?.[0]?.message?.content) {
          continue; // Try next model
        }

        const content = modelResponse.choices[0].message.content.trim();

        return res.json({
          success: true,
          content: content,
          modelUsed: modelId,
          provider: provider,
        });
      } catch (modelError) {
        console.error(`Model ${model.modelId} failed:`, modelError.message);
        continue; // Try next model
      }
    }

    return res.status(503).json({
      success: false,
      message: "All external models failed. Fallback to internal Workflow AI.",
    });
  } catch (error) {
    console.error("External AI endpoint error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/ai/autofix", async (req, res) => {
  try {
    await refreshAIModelsRegistryIfNeeded(false);
    if (!req.isAuthenticated?.() || !req.user?._id) {
      return res
        .status(401)
        .json({ success: false, message: "Login required." });
    }
    if (!GROQ_API_KEY) {
      return res.status(500).json({
        success: false,
        message: "Missing GROQ_API_KEY configuration.",
      });
    }
    const currentCode = String(req.body?.currentCode || "").trim();
    if (!currentCode) {
      return res
        .status(400)
        .json({ success: false, message: "Current code is required." });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    if (!user.aiQuota) {
      user.aiQuota = { dailyLimit: 10, usedToday: 0, lastUsed: null };
    }
    const now = new Date();
    const today = now.toDateString();
    const lastUsedDay = user.aiQuota.lastUsed
      ? new Date(user.aiQuota.lastUsed).toDateString()
      : "";
    if (today !== lastUsedDay) {
      user.aiQuota.usedToday = 0;
    }
    const hasUnlimitedAi = isUnlimitedAiUser(user);
    const dailyLimit = Number(user.aiQuota.dailyLimit ?? 10);
    const usedToday = Number(user.aiQuota.usedToday ?? 0);
    if (!hasUnlimitedAi && usedToday >= dailyLimit) {
      return res.status(403).json({
        success: false,
        limitReached: true,
        message: "Daily AI credits reached. Upgrade to MediaLab Pro.",
      });
    }

    let modelRecoveryUsed = false;
    let models = await AIModel.find({ isActive: true })
      .sort({ priority: 1, status: -1, modelId: 1 })
      .lean();
    models = buildEligibleAiModels(models);
    if (!models.length) {
      modelRecoveryUsed = true;
      await refreshAIModelsRegistryIfNeeded(true);
      models = await AIModel.find({ isActive: true })
        .sort({ priority: 1, status: -1, modelId: 1 })
        .lean();
      models = buildEligibleAiModels(models);
    }
    if (!models.length) {
      return res.status(503).json({
        success: false,
        message: "No active AI models are available right now.",
      });
    }
    let sanitizedContent = "";
    let selectedModel = "";
    let lastError = null;
    let modelSwitchUsed = false;
    let modelSwitchReason = "";
    for (const model of models) {
      try {
        const groqResponse = await nodeFetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${GROQ_API_KEY}`,
            },
            body: JSON.stringify({
              model: model.modelId,
              temperature: 0.15,
              messages: [
                {
                  role: "system",
                  content:
                    "You are the MediaLab Canvas Perfectionist. Your ONLY task is to output pixel-perfect, FULLY VISIBLE HTML.\n\nCRITICAL VISIBILITY RULES:\n1. EVERY element MUST be visible. No exceptions.\n2. NEVER use opacity:0, visibility:hidden, display:none - EVER.\n3. NEVER use transparent colors, white text on white, or invisible content.\n4. NEVER collapse, hide, or obscure any element.\n5. All text must be readable with contrasting colors.\n6. All elements must have defined background or border colors if they should be visible.\n\nFORMATTING RULES:\n7. Output ONLY valid HTML. No preamble, explanations, or closing text.\n8. Every element: style='position: absolute; left: Npx; top: Npx; width: Npx; height: Npx;' (pixel values only)\n9. Minimum 32px width/height for all elements\n10. No percentages, auto, relative positioning, flex, or grid\n11. Remove contenteditable, data-builder-*, editor artifacts\n12. Keep data-canvas-element, data-element-id, ml-container, ml-content IDs\n\nSTRUCTURE RULES:\n13. Ensure all div/button/text elements have visible content\n14. All images must have valid src attributes\n15. Fix ALL z-index conflicts - ensure nothing overlaps invisibly\n16. Start immediately with <html or <div: no introduction\n17. End immediately after final closing tag: no remarks\n\nRESPONSE: Output ONLY the HTML code.",
                },
                {
                  role: "user",
                  content: `ONLY output the fixed HTML. No text before or after:\n\n${currentCode}`,
                },
              ],
            }),
          },
        );
        if (!groqResponse.ok) {
          const errText = await groqResponse.text();
          throw new Error(
            errText || `Groq Auto-Fix request failed for ${model.modelId}.`,
          );
        }
        const payload = await groqResponse.json();
        const rawContent = String(
          payload?.choices?.[0]?.message?.content || "",
        );
        const candidate = rawContent
          .replace(/<think>[\s\S]*?<\/think>/g, "")
          .trim();
        if (!candidate)
          throw new Error(
            `Auto-Fix returned empty content for ${model.modelId}.`,
          );

        // Extract actual HTML from potentially conversational response
        const extractedHTML = extractHTMLFromResponse(candidate);
        if (!extractedHTML) {
          throw new Error(
            `Auto-Fix returned no valid HTML for ${model.modelId}. Got: ${candidate.slice(0, 100)}`,
          );
        }

        // Sanitize to ensure all elements are visible
        const sanitizedHTML = sanitizeAutoFixHTML(extractedHTML);
        sanitizedContent = sanitizedHTML;
        selectedModel = model.modelId;
        await AIModel.updateOne(
          { _id: model._id },
          { $set: { status: "online", lastTested: new Date() } },
        );
        break;
      } catch (error) {
        lastError = error;
        const errorText = String(error?.message || "").toLowerCase();
        const hitRateLimit =
          errorText.includes("rate_limit_exceeded") ||
          errorText.includes("rate limit reached") ||
          errorText.includes("tokens per minute") ||
          errorText.includes('"type":"tokens"');
        if (hitRateLimit) {
          modelSwitchUsed = true;
          modelSwitchReason = "rate_limit";
          aiModelCooldownUntil.set(
            model.modelId,
            Date.now() + parseRateLimitRetryMs(error?.message),
          );
        }
        await createUsageLog({
          user,
          action: "ai-model-error",
          summary: `[error] AI model failed: ${model.modelId} - ${String(error?.message || "unknown")} - ${new Date().toISOString()} --source(ai-autofix)`,
          source: "ai-autofix",
          kind: "error",
          metadata: {
            modelId: model.modelId,
            endpoint: "/api/ai/autofix",
          },
        });
        if (hitRateLimit) {
          await AIModel.updateOne(
            { _id: model._id },
            { $set: { status: "online", lastTested: new Date() } },
          );
        } else {
          await AIModel.updateOne(
            { _id: model._id },
            { $set: { status: "offline", lastTested: new Date() } },
          );
        }
      }
    }
    if (!sanitizedContent) {
      throw new Error(
        lastError?.message || "Auto-Fix failed for all active models.",
      );
    }

    user.aiQuota.usedToday = Number(user.aiQuota.usedToday || 0) + 1;
    user.aiQuota.lastUsed = now;
    await user.save();
    await createUsageLog({
      user,
      action: "ai-autofix",
      summary: "used Magic Auto-Fix",
      source: "ai",
      metadata: {
        modelUsed: selectedModel || "unknown",
        usedToday: Number(user.aiQuota.usedToday || 0),
        dailyLimit: Number(user.aiQuota.dailyLimit || 10),
      },
    });

    return res.json({
      success: true,
      updatedCode: sanitizedContent,
      modelUsed: selectedModel || "unknown",
      modelRecoveryUsed,
      modelSwitchUsed,
      modelSwitchReason,
      creditsRemaining: hasUnlimitedAi
        ? null
        : Math.max(
            0,
            Number(user.aiQuota.dailyLimit || 10) -
              Number(user.aiQuota.usedToday || 0),
          ),
    });
  } catch (error) {
    await createUsageLog({
      user: req.user || null,
      email: req.user?.email || "",
      name: req.user?.name || "",
      action: "ai-autofix-error",
      summary: `[error] AI autofix endpoint failed: ${String(error?.message || "unknown")} - ${new Date().toISOString()} --source(ai-autofix)`,
      source: "ai-autofix",
      kind: "error",
      metadata: {
        endpoint: "/api/ai/autofix",
      },
    });
    res.status(500).json({
      success: false,
      message: error.message || "Magic Auto-Fix failed.",
    });
  }
});

app.get("/api/data-explorer/status", async (req, res) => {
  try {
    const state = getDataExplorerSessionState(req);
    res.json({
      success: true,
      connected: Boolean(state?.uri),
      engine: state?.engine || "",
      channelId: getDataExplorerChannelId(req),
      dbName: state?.dbName || "",
      uriLabel: state?.uriLabel || "",
      collections: Array.isArray(state?.collections) ? state.collections : [],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Could not read explorer state.",
    });
  }
});

app.post("/api/data-explorer/disconnect", async (req, res) => {
  try {
    if (req.session) {
      delete req.session.dataExplorer;
    }
    res.json({ success: true, disconnected: true });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Could not disconnect.",
    });
  }
});

app.post("/api/data-explorer/connect", async (req, res) => {
  try {
    const uri = String(req.body?.uri || "").trim();
    if (!uri) {
      return res
        .status(400)
        .json({ success: false, message: "MongoDB URI is required." });
    }
    const connectionState = await getOrCreateDataExplorerConnection(uri);
    const collections = await connectionState.connection.db
      .listCollections({}, { nameOnly: true })
      .toArray();
    const collectionNames = collections
      .map((item) => normalizeDataExplorerCollectionName(item?.name || ""))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    const uriLabel = (() => {
      try {
        const parsed = new URL(uri);
        return `${parsed.hostname}${parsed.pathname || ""}`;
      } catch {
        return uri.replace(/\/\/.*@/, "//***@");
      }
    })();
    req.session.dataExplorer = {
      engine: "mongodb",
      uri,
      uriLabel,
      dbName: connectionState.dbName,
      collections: collectionNames,
      connectedAt: Date.now(),
    };
    res.json({
      success: true,
      dbName: connectionState.dbName,
      uriLabel,
      channelId: getDataExplorerChannelId(req),
      collections: collectionNames,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not connect to that MongoDB database.",
    });
  }
});

app.post("/api/virtualdb/connect", async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const state = await getOrCreateVirtualDbConnection();
    req.session.dataExplorer = {
      engine: "virtual-medialabdb",
      uri: state.uri,
      uriLabel: state.uriLabel,
      dbName: state.dbName,
      collections: ["virtual_models"],
      connectedAt: Date.now(),
    };
    res.json({
      success: true,
      dbName: state.dbName,
      uriLabel: state.uriLabel,
      channelId: getDataExplorerChannelId(req),
      collections: ["virtual_models"],
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || "Could not connect VirtualDB.",
    });
  }
});

app.get("/api/virtualdb/models", async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const state = await getOrCreateVirtualDbConnection();
    const now = new Date();
    const models = await state.VirtualDbModel.find({
      userId: req.user._id,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    const serialized = models.map((doc) => serializeExplorerValue(doc));
    const fieldSet = new Set();
    serialized.forEach((doc) => collectExplorerFieldPaths(doc, "", fieldSet));
    const fields = Array.from(fieldSet).sort((a, b) => a.localeCompare(b));
    res.json({
      success: true,
      collection: "virtual_models",
      documents: serialized,
      fields,
      limit: 200,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Could not load virtual models.",
    });
  }
});

app.get("/api/virtualdb/model/:name", async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const state = await getOrCreateVirtualDbConnection();
    const name = normalizeVirtualModelName(req.params?.name || "");
    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Model name is required." });
    }
    const now = new Date();
    const model = await state.VirtualDbModel.findOne({
      userId: req.user._id,
      name,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    })
      .sort({ createdAt: -1 })
      .lean();
    const serialized = serializeExplorerValue(model || null);
    const docs = await state.VirtualDbDocument.find({
      userId: req.user._id,
      modelName: name,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    const viewDocuments = docs.map((doc) => ({
      _id: String(doc?._id || ""),
      ...(doc?.data && typeof doc.data === "object"
        ? serializeExplorerValue(doc.data)
        : {}),
    }));
    const dataFieldSet = new Set();
    viewDocuments.forEach((doc) =>
      collectExplorerFieldPaths(doc, "", dataFieldSet),
    );
    const fields = Array.from(dataFieldSet).sort((a, b) => a.localeCompare(b));
    res.json({
      success: true,
      model: serialized,
      documents: viewDocuments,
      fields,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Could not load that model.",
    });
  }
});

app.post("/api/virtualdb/document", async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const state = await getOrCreateVirtualDbConnection();
    const modelName = normalizeVirtualModelName(req.body?.modelName || "");
    if (!modelName) {
      return res
        .status(400)
        .json({ success: false, message: "modelName is required." });
    }
    const exists = await state.VirtualDbModel.findOne({
      userId: req.user._id,
      name: modelName,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    })
      .select("_id")
      .lean();
    if (!exists) {
      return res
        .status(404)
        .json({ success: false, message: "Virtual model not found." });
    }
    const rawData = req.body?.data;
    const data =
      rawData && typeof rawData === "object"
        ? rawData
        : typeof rawData === "string"
          ? (() => {
              try {
                return JSON.parse(rawData);
              } catch {
                return {};
              }
            })()
          : {};
    const created = await state.VirtualDbDocument.create({
      userId: req.user._id,
      modelName,
      data,
      expiresAt: null,
    });
    res.json({
      success: true,
      document: {
        _id: String(created?._id || ""),
        ...(serializeExplorerValue(created?.data || {}) || {}),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Could not insert document.",
    });
  }
});

app.patch("/api/virtualdb/document", async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const state = await getOrCreateVirtualDbConnection();
    const modelName = normalizeVirtualModelName(req.body?.modelName || "");
    const documentId = String(req.body?.documentId || "").trim();
    const fieldPath = String(req.body?.fieldPath || "").trim();
    if (!modelName || !documentId || !fieldPath) {
      return res.status(400).json({
        success: false,
        message: "modelName, documentId, and fieldPath are required.",
      });
    }
    const filter = {
      _id: new mongoose.Types.ObjectId(documentId),
      userId: req.user._id,
      modelName,
    };
    const value = parseExplorerInputValue(req.body?.value);
    await state.VirtualDbDocument.updateOne(filter, {
      $set: { [`data.${fieldPath}`]: value },
    });
    const updated = await state.VirtualDbDocument.findOne(filter).lean();
    const view = updated
      ? {
          _id: String(updated?._id || ""),
          ...(serializeExplorerValue(updated?.data || {}) || {}),
        }
      : null;
    res.json({ success: true, document: view });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Could not update document.",
    });
  }
});

app.post("/api/virtualdb/model", async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const state = await getOrCreateVirtualDbConnection();
    const name = normalizeVirtualModelName(req.body?.name || "");
    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Model name is required." });
    }
    const rawSchema = req.body?.schema;
    const schema =
      rawSchema && typeof rawSchema === "object"
        ? rawSchema
        : typeof rawSchema === "string"
          ? (() => {
              try {
                return JSON.parse(rawSchema);
              } catch {
                return {};
              }
            })()
          : {};
    const created = await state.VirtualDbModel.create({
      userId: req.user._id,
      name,
      schema,
      expiresAt: null,
    });
    res.json({
      success: true,
      model: serializeExplorerValue(created.toObject()),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Could not create model.",
    });
  }
});

app.post("/api/virtualdb/disconnect", async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const state = await getOrCreateVirtualDbConnection();
    const retentionHoursRaw = Number(req.body?.retentionHours ?? 0);
    const allowed = new Set([0, 4, 8, 12, 20, 24]);
    const retentionHours = allowed.has(retentionHoursRaw)
      ? retentionHoursRaw
      : 0;
    const filter = { userId: req.user._id };
    let action = "cleared";
    if (retentionHours <= 0) {
      await state.VirtualDbModel.deleteMany(filter);
      await state.VirtualDbDocument.deleteMany(filter);
    } else {
      const expiresAt = new Date(Date.now() + retentionHours * 60 * 60 * 1000);
      await state.VirtualDbModel.updateMany(filter, { $set: { expiresAt } });
      await state.VirtualDbDocument.updateMany(filter, { $set: { expiresAt } });
      action = "scheduled";
    }
    if (req.session) {
      delete req.session.dataExplorer;
    }
    res.json({ success: true, action, retentionHours });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Could not disconnect VirtualDB.",
    });
  }
});

app.get("/api/data-explorer/collections", async (req, res) => {
  try {
    const state = getDataExplorerSessionState(req);
    if (!state?.uri) {
      return res
        .status(400)
        .json({ success: false, message: "Connect a MongoDB database first." });
    }
    if (state?.engine === "virtual-medialabdb") {
      return res.json({
        success: true,
        collections: ["virtual_models"],
        dbName: state?.dbName || "virtualdb",
      });
    }
    const connectionState = await getOrCreateDataExplorerConnection(state.uri);
    const collections = await connectionState.connection.db
      .listCollections({}, { nameOnly: true })
      .toArray();
    const collectionNames = collections
      .map((item) => normalizeDataExplorerCollectionName(item?.name || ""))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    req.session.dataExplorer = {
      ...(req.session.dataExplorer || {}),
      collections: collectionNames,
      dbName: connectionState.dbName,
    };
    res.json({
      success: true,
      collections: collectionNames,
      dbName: connectionState.dbName,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Could not list collections.",
    });
  }
});

app.get("/api/data-explorer/collection/:name", async (req, res) => {
  try {
    const state = getDataExplorerSessionState(req);
    if (!state?.uri) {
      return res
        .status(400)
        .json({ success: false, message: "Connect a MongoDB database first." });
    }
    const collectionName = normalizeDataExplorerCollectionName(
      req.params?.name || "",
    );
    if (!collectionName) {
      return res
        .status(400)
        .json({ success: false, message: "Collection name is required." });
    }
    const limit = Math.max(
      1,
      Math.min(200, Number(req.query?.limit || 50) || 50),
    );
    if (state?.engine === "virtual-medialabdb") {
      if (!requireAuth(req, res)) return;
      if (collectionName !== "virtual_models") {
        return res.status(400).json({
          success: false,
          message: "Only virtual_models is available in VirtualDB.",
        });
      }
      const vstate = await getOrCreateVirtualDbConnection();
      const now = new Date();
      const docs = await vstate.VirtualDbModel.find({
        userId: req.user._id,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      const serializedDocuments = docs.map((doc) =>
        serializeExplorerValue(doc),
      );
      const fieldSet = new Set();
      serializedDocuments.forEach((doc) =>
        collectExplorerFieldPaths(doc, "", fieldSet),
      );
      const fields = Array.from(fieldSet).sort((a, b) => a.localeCompare(b));
      return res.json({
        success: true,
        collection: collectionName,
        documents: serializedDocuments,
        fields,
        limit,
      });
    }
    const connectionState = await getOrCreateDataExplorerConnection(state.uri);
    await ensureDataExplorerWatcher({
      ioInstance: io,
      connectionState,
      collectionName,
      channelId: getDataExplorerChannelId(req),
    });
    const documents = await connectionState.connection
      .collection(collectionName)
      .find({})
      .limit(limit)
      .toArray();
    const serializedDocuments = documents.map((doc) =>
      serializeExplorerValue(doc),
    );
    const fieldSet = new Set();
    serializedDocuments.forEach((doc) =>
      collectExplorerFieldPaths(doc, "", fieldSet),
    );
    const fields = Array.from(fieldSet).sort((a, b) => a.localeCompare(b));
    res.json({
      success: true,
      collection: collectionName,
      documents: serializedDocuments,
      fields,
      limit,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Could not load collection data.",
    });
  }
});

app.patch("/api/data-explorer/document", async (req, res) => {
  try {
    const state = getDataExplorerSessionState(req);
    if (!state?.uri) {
      return res
        .status(400)
        .json({ success: false, message: "Connect a MongoDB database first." });
    }
    const collectionName = normalizeDataExplorerCollectionName(
      req.body?.collection || "",
    );
    const documentId = String(req.body?.documentId || "").trim();
    const fieldPath = String(req.body?.fieldPath || "").trim();
    if (!collectionName || !documentId || !fieldPath) {
      return res.status(400).json({
        success: false,
        message: "Collection, document, and field are required.",
      });
    }
    if (state?.engine === "virtual-medialabdb") {
      if (!requireAuth(req, res)) return;
      if (collectionName !== "virtual_models") {
        return res.status(400).json({
          success: false,
          message: "Only virtual_models is editable in VirtualDB.",
        });
      }
      const vstate = await getOrCreateVirtualDbConnection();
      const filter = {
        _id: new mongoose.Types.ObjectId(documentId),
        userId: req.user._id,
      };
      const value = parseExplorerInputValue(req.body?.value);
      await vstate.VirtualDbModel.updateOne(filter, {
        $set: { [fieldPath]: value },
      });
      const updated = await vstate.VirtualDbModel.findOne(filter).lean();
      const serialized = serializeExplorerValue(updated || null);
      return res.json({ success: true, document: serialized });
    }
    const connectionState = await getOrCreateDataExplorerConnection(state.uri);
    const filter = { _id: new mongoose.Types.ObjectId(documentId) };
    const value = parseExplorerInputValue(req.body?.value);
    await connectionState.connection
      .collection(collectionName)
      .updateOne(filter, {
        $set: { [fieldPath]: value },
      });
    const updated = await connectionState.connection
      .collection(collectionName)
      .findOne(filter);
    const serialized = serializeExplorerValue(updated || null);
    io.to(`data-explorer:${getDataExplorerChannelId(req)}`).emit(
      "data-explorer:change",
      {
        collection: collectionName,
        operationType: "update",
        documentId,
        fullDocument: serialized,
        updatedFields: serializeExplorerValue({ [fieldPath]: value }),
        removedFields: [],
        updatedAt: Date.now(),
      },
    );
    res.json({ success: true, document: serialized });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Could not update that field.",
    });
  }
});

// Serving
app.get("/", (_req, res) => {
  res.render("index");
});
app.get("/studio", (_req, res) => {
  res.render("index");
});
app.get("/studio-terminal", (_req, res) => {
  res.render("terminal-isolated");
});
app.get("/admin", (_req, res) => {
  res.render("admin");
});
app.get("/example", (_req, res) => {
  res.render("example");
});
app.get("/admin/marketplace", (_req, res) => {
  res.render("admin-marketplace");
});
app.get("/privacy-policy.html", (_req, res) => {
  res.render("privacy");
});
app.get("/terms-and-services.html", (_req, res) => {
  res.render("terms");
});
app.get("/contact-support.html", (_req, res) => {
  res.render("support");
});
app.get("/MediaLab-Release.pdf", (_req, res) => {
  streamMediaLabReleasePdf(res);
});
const WEBSITE_TEMPLATE_VIEWS = {
  candycrush: "templates/candycrush",
  portfolio: "templates/portfolio",
  arcade: "templates/arcade",
  studio: "templates/studio",
};
app.get("/api/builder/templates", async (req, res) => {
  try {
    const items = await BuilderTemplate.find({
      isActive: true,
      $or: [
        { sourceMarketplaceItemId: null },
        { sourceMarketplaceItemId: { $exists: false } },
      ],
    })
      .sort({ createdAt: 1 })
      .select("slug title description category authorName createdAt")
      .lean();
    const officialItems = items.map((item) => ({
      slug: item.slug || "",
      title: item.title || "Official Template",
      description: item.description || "Official MediaLab builder template.",
      category: item.category || "General",
      authorName: item.authorName || "MediaLab Creator",
      createdAt: item.createdAt || null,
      origin: "official",
      kind: "template",
      isPurchased: false,
      marketplaceItemId: "",
    }));
    const purchasedTemplates = req.user?._id
      ? (await User.findById(req.user._id).select("purchasedTemplates").lean())
          ?.purchasedTemplates || []
      : [];
    const purchasedTemplateList = Array.isArray(purchasedTemplates)
      ? purchasedTemplates
      : [];
    const purchasedMarketplaceIds = purchasedTemplateList
      .map((entry) => String(entry?.marketplaceItemId || "").trim())
      .filter(Boolean);
    const purchasedSourceItems = purchasedMarketplaceIds.length
      ? await MarketplaceItem.find({ _id: { $in: purchasedMarketplaceIds } })
          .select("_id screenshots screenshotAssets")
          .lean()
      : [];
    const purchasedSourceById = new Map(
      (Array.isArray(purchasedSourceItems) ? purchasedSourceItems : []).map(
        (entry) => [String(entry?._id || ""), entry],
      ),
    );
    const purchasedItems = purchasedTemplateList.map((item) => {
      const sourceItem = purchasedSourceById.get(
        String(item?.marketplaceItemId || "").trim(),
      );
      const fallbackPreviewFromAssets = (
        Array.isArray(item?.screenshotAssets) ? item.screenshotAssets : []
      )
        .map((asset) => String(asset?.thumbnailUrl || asset?.url || "").trim())
        .find(Boolean);
      const fallbackPreviewFromShots = (
        Array.isArray(item?.screenshots) ? item.screenshots : []
      )
        .map((url) => String(url || "").trim())
        .find(Boolean);
      const sourceAssets = Array.isArray(sourceItem?.screenshotAssets)
        ? sourceItem.screenshotAssets
        : [];
      const sourceScreens = Array.isArray(sourceItem?.screenshots)
        ? sourceItem.screenshots
        : [];
      const fallbackSourcePreview =
        sourceAssets
          .map((asset) =>
            String(asset?.thumbnailUrl || asset?.url || "").trim(),
          )
          .find(Boolean) ||
        sourceScreens.map((url) => String(url || "").trim()).find(Boolean) ||
        "";
      return {
        slug:
          String(item?.slug || "").trim() ||
          `marketplace-template-${String(item?.marketplaceItemId || "").trim()}`,
        title: item?.title || "Purchased Template",
        description: item?.description || "Purchased marketplace template.",
        category: item?.category || "General",
        authorName: item?.sellerName || "Marketplace Creator",
        createdAt: item?.purchasedAt || item?.updatedAt || null,
        origin: "purchased",
        kind: "template",
        isPurchased: true,
        marketplaceItemId: String(item?.marketplaceItemId || ""),
        sourceHtml: String(item?.sourceHtml || ""),
        screenshots: (Array.isArray(item?.screenshots)
          ? item.screenshots
          : sourceScreens
        )
          .map((url) => String(url || "").trim())
          .filter(Boolean)
          .slice(0, 4),
        screenshotAssets: (Array.isArray(item?.screenshotAssets)
          ? item.screenshotAssets
          : sourceAssets
        )
          .map((asset) => ({
            url: String(asset?.url || "").trim(),
            thumbnailUrl: String(
              asset?.thumbnailUrl || asset?.url || "",
            ).trim(),
            fileId: String(asset?.fileId || "").trim(),
            name: String(asset?.name || "").trim(),
          }))
          .filter((asset) => asset.url || asset.thumbnailUrl)
          .slice(0, 4),
        previewImage: String(
          item?.previewImage ||
            fallbackPreviewFromAssets ||
            fallbackPreviewFromShots ||
            fallbackSourcePreview ||
            "",
        ),
      };
    });
    return res.json({
      success: true,
      items: [...officialItems, ...purchasedItems],
    });
  } catch (error) {
    console.error("Builder templates fetch failed:", error);
    return res
      .status(500)
      .json({ success: false, message: "Could not load builder templates." });
  }
});
app.post(
  "/api/builder/templates/:marketplaceItemId/remove",
  publishRateLimit,
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({
        success: false,
        message: "Sign in first to remove templates.",
      });
    }
    try {
      const marketplaceItemId = String(
        req.params.marketplaceItemId || "",
      ).trim();
      if (!marketplaceItemId) {
        return res.status(400).json({
          success: false,
          message: "Template identifier is required.",
        });
      }
      const user = await User.findById(req.user._id);
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User account not found." });
      }
      user.purchasedTemplates = (
        Array.isArray(user.purchasedTemplates) ? user.purchasedTemplates : []
      ).filter(
        (entry) => String(entry?.marketplaceItemId || "") !== marketplaceItemId,
      );
      await user.save();
      const sourceItem = await MarketplaceItem.findById(marketplaceItemId);
      if (sourceItem) {
        sourceItem.purchases = (
          Array.isArray(sourceItem.purchases) ? sourceItem.purchases : []
        ).filter(
          (purchase) =>
            String(purchase?.buyerId || "") !== String(req.user._id || ""),
        );
        sourceItem.updatedAt = new Date();
        await sourceItem.save();
      }
      return res.json({
        success: true,
        message: "Template removed from workspace.",
      });
    } catch (error) {
      console.error("Builder template removal failed:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Could not remove template from workspace.",
      });
    }
  },
);
app.get("/templates/:slug", async (req, res) => {
  const dynamicTemplate = await BuilderTemplate.findOne({
    slug: String(req.params.slug || "").trim(),
    isActive: true,
  }).lean();
  if (dynamicTemplate?.htmlUrl) {
    try {
      const response = await fetch(
        String(dynamicTemplate.htmlUrl || "").trim(),
      );
      if (response.ok) {
        const templateHtml = await response.text();
        if (templateHtml) {
          return res.type("html").send(String(templateHtml));
        }
      }
    } catch (error) {
      console.warn("Template ImageKit fetch skipped:", error.message);
    }
  }
  if (dynamicTemplate?.html) {
    return res.type("html").send(String(dynamicTemplate.html || ""));
  }
  const view = WEBSITE_TEMPLATE_VIEWS[req.params.slug];
  if (!view) {
    return res.status(404).send("Template not found.");
  }
  return res.render(view);
});
app.get("/:referralCode", async (req, res, next) => {
  const referralCode = String(req.params?.referralCode || "").trim();
  if (
    !referralCode ||
    referralCode.includes(".") ||
    !/^[a-zA-Z0-9_-]{4,64}$/.test(referralCode)
  ) {
    return next();
  }
  const reservedPaths = new Set([
    "api",
    "admin",
    "templates",
    "uploads",
    "exports",
    "sw",
    "manifest",
    "favicon",
    "privacy-policy",
    "terms-and-services",
    "contact-support",
  ]);
  if (reservedPaths.has(referralCode.toLowerCase())) {
    return next();
  }
  try {
    const referrer = await User.findOne({ referralCode }).select("_id").lean();
    if (!referrer) return next();
    return res.render("index");
  } catch (error) {
    console.error("Referral route lookup failed:", error);
    return next();
  }
});
app.use(express.static(path.join(__dirname, "client")));
app.use("/uploads", express.static(uploadDir));
app.use("/exports", express.static(exportDir));

// --- 4. API ROUTES ---
app.use("/api/auth", authRateLimit, authRoutes);

app.post("/api/github/setup-repository", publishRateLimit, async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const user = await User.findById(req.user._id).select(
      "+githubToken +adsenseAdCode",
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    if (!user.githubUsername || !user.githubToken) {
      return res.status(400).json({
        success: false,
        message:
          "Connect your GitHub account first before setting up GitHub hosting.",
      });
    }

    const storage = await initializeGithubStorageForUser(user);
    req.user.githubRepoCreated = true;
    req.user.githubUsername = user.githubUsername;
    req.user.githubId = user.githubId;
    await createUserNotification({
      userId: user._id,
      type: "github-storage-ready",
      title: "Cloud storage is online",
      message: `MediaLab created the ${user.githubRepoName || "GitHub"} repository and activated hosting for your projects.`,
      targetType: "console",
      metadata: {
        repo: user.githubRepoName || "",
        pagesUrl: storage?.pagesUrl || "",
      },
    });

    return res.json({
      success: true,
      message: "GitHub hosting is now active.",
      storage,
      user: {
        ...(typeof user.toObject === "function"
          ? user.toObject()
          : { ...user }),
        password: undefined,
        githubToken: undefined,
        githubConnected: Boolean(user.githubUsername),
      },
    });
  } catch (error) {
    console.error("GitHub setup repository failed:", error);
    const apiMessage =
      error?.response?.data?.message ||
      error?.message ||
      "GitHub hosting could not be initialized.";
    if (req.user?._id) {
      await createUserNotification({
        userId: req.user._id,
        type: "github-storage-error",
        title: "GitHub storage needs attention",
        message: apiMessage,
        targetType: "console",
      });
    }
    return res.status(error?.status || error?.response?.status || 500).json({
      success: false,
      message: apiMessage,
    });
  }
});

app.post(
  "/api/github/publish",
  publishRateLimit,
  express.json({ limit: "10mb" }),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res
        .status(401)
        .json({ success: false, message: "You need to sign in first." });
    }

    try {
      const user = await User.findById(req.user._id).select("+githubToken");
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found." });
      }
      if (!user.githubUsername || !user.githubToken) {
        return res.status(400).json({
          success: false,
          message: "Connect GitHub first before publishing to the web.",
        });
      }
      if (!user.githubRepoCreated) {
        return res.status(400).json({
          success: false,
          message: "Set up GitHub hosting first before publishing.",
        });
      }

      const projectName = String(req.body?.projectName || "").trim();
      const htmlContent = String(req.body?.htmlContent || "").trim();
      const cssContent = String(req.body?.cssContent || "").trim();
      const interactionScript = String(
        req.body?.interactionScript || "",
      ).trim();
      const documentHtml = String(req.body?.documentHtml || "").trim();
      const description = String(req.body?.description || "").trim();
      const keywords = String(req.body?.keywords || "").trim();

      if (!projectName) {
        return res.status(400).json({
          success: false,
          message: "Enter a project name before publishing.",
        });
      }
      if (!htmlContent && !documentHtml) {
        return res.status(400).json({
          success: false,
          message:
            "This builder project is empty. Add some content before publishing.",
        });
      }

      const octokit = buildGithubClient(user);
      const owner = user.githubUsername;
      const repo = getUserGithubRepoName(user);
      const filename = slugifyProjectName(projectName);
      const folderSlug = filename.replace(/\.html$/i, "") || "medialab-page";
      const repoFolderPath = normalizeRepoFilePath(
        `${GITHUB_PUBLIC_ROOT}/${folderSlug}`,
      );
      const repoFilePath = normalizeRepoFilePath(
        `${repoFolderPath}/index.html`,
      );
      const inheritedRenderBaseUrl = getUserPrimaryRenderBaseUrl(user);
      user.liveProjects = Array.isArray(user.liveProjects)
        ? user.liveProjects
        : [];
      const existingProject = user.liveProjects.find(
        (project) =>
          String(project?.fileName || project?.filename || "") === repoFilePath,
      );
      await ensureGithubRepoScaffold(octokit, owner, repo, user.name || owner);
      const fullHtml = documentHtml
        ? buildPublishedHtmlFromSource({
            documentHtml,
            projectName,
            adsenseId:
              existingProject?.monetizationEnabled &&
              existingProject?.isMonetized
                ? user.adsenseId || ""
                : "",
            adsenseAdCode:
              existingProject?.monetizationEnabled &&
              existingProject?.isMonetized
                ? user.adsenseAdCode || ""
                : "",
            description,
            keywords,
          })
        : buildPublishedHtmlDocument({
            projectName,
            htmlContent,
            cssContent,
            interactionScript,
            adsenseId:
              existingProject?.monetizationEnabled &&
              existingProject?.isMonetized
                ? user.adsenseId || ""
                : "",
            adsenseAdCode:
              existingProject?.monetizationEnabled &&
              existingProject?.isMonetized
                ? user.adsenseAdCode || ""
                : "",
            description,
            keywords,
          });
      const htmlSizeBytes = Buffer.byteLength(fullHtml, "utf8");
      const containsBase64Images = /data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(
        fullHtml,
      );
      const warnings = [];
      if (containsBase64Images && htmlSizeBytes > 2 * 1024 * 1024) {
        warnings.push(
          "Large file warning: this single HTML export is over 2MB because it contains embedded base64 images. Upgrade to Pro image hosting for a lighter /assets-based publish flow.",
        );
      }

      const existingSha = await getGithubFileSha(
        octokit,
        owner,
        repo,
        repoFilePath,
      );
      await upsertGithubFile({
        octokit,
        owner,
        repo,
        path: repoFilePath,
        message: `${existingSha ? "Update" : "Publish"} ${repoFilePath} from MediaLab`,
        contentBase64: Buffer.from(fullHtml).toString("base64"),
      });

      const liveUrl = `https://${owner}.github.io/${repo}/${folderSlug}/`;
      const nextProject = {
        name: projectName,
        fileName: repoFilePath,
        filename: repoFilePath,
        entryPath: "index.html",
        repoPath: repoFolderPath,
        projectType: "single",
        repo,
        url: liveUrl,
        liveUrl,
        status: "live",
        renderRepoUrl: buildGithubRepoUrl(owner, repo),
        renderServiceName:
          existingProject?.renderServiceName ||
          buildDefaultRenderServiceName(user.name || owner),
        renderUrl: existingProject?.renderUrl || inheritedRenderBaseUrl || "",
        renderHostedConfirmed: Boolean(existingProject?.renderHostedConfirmed),
        renderVerifiedAt: existingProject?.renderVerifiedAt || null,
        renderDeployStatus:
          existingProject?.renderDeployStatus ||
          (user.confirmedFirstHosting && inheritedRenderBaseUrl
            ? "deploying"
            : ""),
        adsensePublisherId:
          existingProject?.monetizationEnabled && existingProject?.isMonetized
            ? user.adsenseId || ""
            : "",
        monetizationEnabled: Boolean(existingProject?.monetizationEnabled),
        isMonetized: Boolean(existingProject?.isMonetized),
        adDisabledPages: Array.isArray(existingProject?.adDisabledPages)
          ? existingProject.adDisabledPages
          : [],
        monetizationDisabledAt: existingProject?.monetizationDisabledAt || null,
        monetizationVerifiedAt: existingProject?.monetizationVerifiedAt || null,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
        createdAt: existingProject?.createdAt || new Date(),
      };

      user.liveProjects = user.liveProjects.filter(
        (project) =>
          String(project?.fileName || project?.filename || "") !== repoFilePath,
      );
      user.liveProjects.push(nextProject);
      await user.save();

      req.user.liveProjects = user.liveProjects;

      await createUsageLog({
        user,
        email: user.email,
        name: user.name,
        isPro: Boolean(user.isPro),
        action: "github-publish",
        summary: `published ${repoFilePath} to GitHub Pages`,
        source: "github",
        metadata: { projectName, filename: repoFilePath, liveUrl },
      });
      await createUserNotification({
        userId: user._id,
        type: "project-live",
        title: "Your project is live",
        message: `${projectName} is now published. Click to check it out.`,
        targetType: "live-project",
        targetId: repoFilePath,
        metadata: { liveUrl, projectName, fileName: repoFilePath },
      });

      return res.json({
        success: true,
        message: "Project published successfully.",
        liveProject: nextProject,
        liveUrl,
        repoUrl: buildGithubRepoUrl(owner, repo),
        renderBlueprintReady: true,
        needsHostingOnboarding:
          !nextProject.renderHostedConfirmed && !nextProject.renderUrl,
        warnings,
        sizeBytes: htmlSizeBytes,
        user: toSafeUser(user),
      });
    } catch (error) {
      console.error("GitHub publish failed:", error);
      const apiMessage =
        error?.response?.data?.message ||
        error?.message ||
        "Could not publish this project to GitHub right now.";
      return res.status(error?.status || error?.response?.status || 500).json({
        success: false,
        message: apiMessage,
      });
    }
  },
);

app.post(
  "/api/github/publish-folder",
  publishRateLimit,
  express.json({ limit: "50mb" }),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res
        .status(401)
        .json({ success: false, message: "You need to sign in first." });
    }

    try {
      const user = await User.findById(req.user._id).select("+githubToken");
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found." });
      }
      if (!user.githubUsername || !user.githubToken) {
        return res.status(400).json({
          success: false,
          message: "Connect GitHub first before publishing to the web.",
        });
      }
      if (!user.githubRepoCreated) {
        return res.status(400).json({
          success: false,
          message: "Set up GitHub hosting first before publishing.",
        });
      }

      const projectName = String(req.body?.projectName || "").trim();
      const uploadedFiles = Array.isArray(req.body?.files)
        ? req.body.files
        : [];
      if (!projectName) {
        return res.status(400).json({
          success: false,
          message: "Enter a project name before publishing.",
        });
      }
      if (!uploadedFiles.length) {
        return res.status(400).json({
          success: false,
          message: "Import a project folder first before publishing it.",
        });
      }

      const preparedPush = prepareGitHubPush(projectName, uploadedFiles);
      const entryPath = preparedPush.entryPath;
      const safeFiles = preparedPush.files
        .map((file) => ({
          path: normalizeRepoFilePath(file?.path || ""),
          contentBase64: String(file?.contentBase64 || "").trim(),
        }))
        .filter((file) => file.path && file.contentBase64)
        .filter(
          (file) => !file.path.startsWith("..") && !file.path.includes("/../"),
        );

      if (!safeFiles.length) {
        return res.status(400).json({
          success: false,
          message: "That project folder did not contain any publishable files.",
        });
      }
      if (safeFiles.length > 250) {
        return res.status(400).json({
          success: false,
          message:
            "This project folder is too large for one-click publish right now. Keep it under 250 files for the smoothest deploy.",
        });
      }
      const totalBytes = safeFiles.reduce((sum, file) => {
        const base64 = String(file.contentBase64 || "");
        return sum + Math.ceil((base64.length * 3) / 4);
      }, 0);
      if (totalBytes > 35 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          message:
            "This project folder is too large for GitHub one-click publish right now. Keep the upload under about 35MB.",
        });
      }

      const folderSlug = preparedPush.folderSlug;
      const repoFolderPath = normalizeRepoFilePath(
        `${GITHUB_PUBLIC_ROOT}/${folderSlug}`,
      );
      const owner = user.githubUsername;
      const repo = getUserGithubRepoName(user);
      const inheritedRenderBaseUrl = getUserPrimaryRenderBaseUrl(user);
      const octokit = buildGithubClient(user);
      await ensureGithubRepoScaffold(octokit, owner, repo, user.name || owner);

      for (const file of safeFiles) {
        const repoPath = normalizeRepoFilePath(
          `${repoFolderPath}/${file.path}`,
        );
        const exists = await getGithubFileSha(octokit, owner, repo, repoPath);
        await upsertGithubFile({
          octokit,
          owner,
          repo,
          path: repoPath,
          message: `${exists ? "Update" : "Publish"} ${repoPath} from MediaLab`,
          contentBase64: file.contentBase64,
        });
      }

      const repoEntryPath = normalizeRepoFilePath(
        `${repoFolderPath}/${entryPath}`,
      );
      const liveUrl = buildFolderProjectLiveUrl(
        owner,
        repo,
        repoFolderPath,
        entryPath,
      );
      const existingProject = (
        Array.isArray(user.liveProjects) ? user.liveProjects : []
      ).find(
        (project) =>
          String(project?.fileName || project?.filename || "").trim() ===
          repoEntryPath,
      );
      const nextProject = {
        name: projectName,
        fileName: repoEntryPath,
        filename: repoEntryPath,
        entryPath,
        repoPath: repoFolderPath,
        projectType: preparedPush.projectType,
        repo,
        url: liveUrl,
        liveUrl,
        status: "live",
        renderRepoUrl: buildGithubRepoUrl(owner, repo),
        renderServiceName:
          existingProject?.renderServiceName ||
          buildDefaultRenderServiceName(user.name || owner),
        renderUrl: existingProject?.renderUrl || inheritedRenderBaseUrl || "",
        renderHostedConfirmed: Boolean(existingProject?.renderHostedConfirmed),
        renderVerifiedAt: existingProject?.renderVerifiedAt || null,
        renderDeployStatus:
          existingProject?.renderDeployStatus ||
          (user.confirmedFirstHosting && inheritedRenderBaseUrl
            ? "deploying"
            : ""),
        adsensePublisherId:
          Boolean(existingProject?.monetizationEnabled) &&
          Boolean(existingProject?.isMonetized)
            ? user.adsenseId || ""
            : "",
        monetizationEnabled: Boolean(existingProject?.monetizationEnabled),
        isMonetized: Boolean(existingProject?.isMonetized),
        adDisabledPages: Array.isArray(existingProject?.adDisabledPages)
          ? existingProject.adDisabledPages
          : [],
        monetizationDisabledAt: existingProject?.monetizationDisabledAt || null,
        monetizationVerifiedAt: existingProject?.monetizationVerifiedAt || null,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
        createdAt: existingProject?.createdAt || new Date(),
      };

      user.liveProjects = Array.isArray(user.liveProjects)
        ? user.liveProjects
        : [];
      user.liveProjects = user.liveProjects.filter(
        (project) =>
          String(project?.fileName || project?.filename || "").trim() !==
          repoEntryPath,
      );
      user.liveProjects.push(nextProject);
      await user.save();
      req.user.liveProjects = user.liveProjects;

      await createUsageLog({
        user,
        email: user.email,
        name: user.name,
        isPro: Boolean(user.isPro),
        action: "github-publish-folder",
        summary: `published ${safeFiles.length} files to ${repoFolderPath}`,
        source: "github",
        metadata: {
          projectName,
          folderSlug: repoFolderPath,
          entryPath: repoEntryPath,
          liveUrl,
        },
      });

      return res.json({
        success: true,
        message: "Project folder published successfully.",
        liveProject: nextProject,
        liveUrl,
        repoUrl: buildGithubRepoUrl(owner, repo),
        renderBlueprintReady: true,
        needsHostingOnboarding:
          !nextProject.renderHostedConfirmed && !nextProject.renderUrl,
        fileCount: safeFiles.length,
        user: toSafeUser(user),
      });
    } catch (error) {
      console.error("GitHub folder publish failed:", error);
      const apiMessage =
        error?.response?.data?.message ||
        error?.message ||
        "Could not publish this project folder right now.";
      return res.status(error?.status || error?.response?.status || 500).json({
        success: false,
        message: apiMessage,
      });
    }
  },
);

app.get("/api/github/projects", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const user = await User.findById(req.user._id).select("+githubToken");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    user.liveProjects = Array.isArray(user.liveProjects)
      ? user.liveProjects
      : [];
    if (
      user.githubUsername &&
      user.githubToken &&
      user.githubRepoCreated &&
      user.liveProjects.length
    ) {
      const octokit = buildGithubClient(user);
      const verified = await Promise.all(
        user.liveProjects.map(async (project) => {
          const fileName = String(
            project?.fileName || project?.filename || "",
          ).trim();
          if (!fileName) return null;
          try {
            await octokit.rest.repos.getContent({
              owner: user.githubUsername,
              repo: getUserGithubRepoName(user),
              path: fileName,
            });
            return project;
          } catch (error) {
            if ((error?.status || error?.response?.status) === 404) {
              return null;
            }
            throw error;
          }
        }),
      );
      const nextProjects = verified.filter(Boolean);
      let projectsChanged = nextProjects.length !== user.liveProjects.length;
      user.liveProjects = nextProjects;
      const deployCandidates = user.liveProjects.filter(
        (project) => project?.renderUrl && !project?.renderHostedConfirmed,
      );
      for (const project of deployCandidates) {
        try {
          const renderUrl = buildHostedProjectUrl(project.renderUrl, project);
          const response = await fetch(renderUrl, {
            method: "GET",
            redirect: "follow",
            headers: { "User-Agent": "MediaLab-Deploy-Check" },
          });
          if (response.status < 400) {
            project.renderHostedConfirmed = true;
            project.renderVerifiedAt = new Date();
            project.renderDeployStatus = "live";
            project.updatedAt = new Date();
            projectsChanged = true;
            if (!user.confirmedFirstHosting) {
              user.confirmedFirstHosting = true;
              user.firstHostingConfirmedAt = new Date();
            }
          } else if (response.status >= 500) {
            project.renderDeployStatus = "server-error";
            project.updatedAt = new Date();
            projectsChanged = true;
          } else if (!project.renderDeployStatus) {
            project.renderDeployStatus = "deploying";
            projectsChanged = true;
          }
        } catch {
          if (!project.renderDeployStatus) {
            project.renderDeployStatus = "deploying";
            projectsChanged = true;
          }
        }
      }
      if (projectsChanged) {
        await user.save();
      }
    }
    req.user.liveProjects = user.liveProjects;
    return res.json({
      success: true,
      projects: sortLiveProjects(user.liveProjects),
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("GitHub projects fetch failed:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Could not load live projects right now.",
    });
  }
});

app.get("/api/github/project-content", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const filename = String(req.query?.filename || "").trim();
    if (!filename) {
      return res.status(400).json({
        success: false,
        message: "Missing filename.",
      });
    }
    const user = await User.findById(req.user._id).select("+githubToken");
    if (!user || !user.githubUsername || !user.githubToken) {
      return res.status(400).json({
        success: false,
        message: "GitHub is not connected for this account.",
      });
    }

    const octokit = buildGithubClient(user);
    const contentResponse = await octokit.rest.repos.getContent({
      owner: user.githubUsername,
      repo: getUserGithubRepoName(user),
      path: filename,
    });
    if (Array.isArray(contentResponse.data) || !contentResponse.data?.content) {
      return res.status(400).json({
        success: false,
        message: "That GitHub file could not be opened as HTML content.",
      });
    }

    return res.json({
      success: true,
      filename,
      content: Buffer.from(contentResponse.data.content, "base64").toString(
        "utf8",
      ),
    });
  } catch (error) {
    console.error("GitHub project content fetch failed:", error);
    return res.status(error?.status || error?.response?.status || 500).json({
      success: false,
      message: error?.message || "Could not load that project code right now.",
    });
  }
});

app.delete("/api/github/project", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const filename = String(req.query?.filename || "").trim();
    if (!filename) {
      return res.status(400).json({
        success: false,
        message: "Missing filename.",
      });
    }

    const user = await User.findById(req.user._id).select("+githubToken");
    if (!user || !user.githubUsername || !user.githubToken) {
      return res.status(400).json({
        success: false,
        message: "GitHub is not connected for this account.",
      });
    }

    const octokit = buildGithubClient(user);
    user.liveProjects = Array.isArray(user.liveProjects)
      ? user.liveProjects
      : [];
    const projectToDelete = user.liveProjects.find(
      (project) =>
        String(project?.fileName || project?.filename || "").trim() ===
        filename,
    );

    if (projectToDelete?.repoPath) {
      await deleteGithubPathRecursive(
        octokit,
        user.githubUsername,
        getUserGithubRepoName(user),
        projectToDelete.repoPath,
      );
    } else {
      const contentResponse = await octokit.rest.repos.getContent({
        owner: user.githubUsername,
        repo: getUserGithubRepoName(user),
        path: filename,
      });
      if (Array.isArray(contentResponse.data) || !contentResponse.data?.sha) {
        return res.status(400).json({
          success: false,
          message: "That published file could not be deleted cleanly.",
        });
      }

      await octokit.rest.repos.deleteFile({
        owner: user.githubUsername,
        repo: getUserGithubRepoName(user),
        path: filename,
        sha: contentResponse.data.sha,
        message: `Delete ${filename} from MediaLab`,
      });
    }

    user.liveProjects = user.liveProjects.filter(
      (project) =>
        String(project?.fileName || project?.filename || "").trim() !==
        filename,
    );
    await user.save();
    req.user.liveProjects = user.liveProjects;

    await createUsageLog({
      user,
      email: user.email,
      name: user.name,
      isPro: Boolean(user.isPro),
      action: "github-delete",
      summary: `deleted ${filename} from GitHub Pages`,
      source: "github",
      metadata: { filename },
    });

    return res.json({
      success: true,
      message: "Live project deleted.",
      projects: sortLiveProjects(user.liveProjects),
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("GitHub project delete failed:", error);
    return res.status(error?.status || error?.response?.status || 500).json({
      success: false,
      message:
        error?.message || "Could not delete that live project right now.",
    });
  }
});

const githubSettingsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 },
});
const marketplaceImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

app.post(
  "/api/marketplace/upload-screenshot",
  marketplaceImageUpload.single("screenshot"),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Sign in first." });
    }
    try {
      if (!req.file?.buffer) {
        return res
          .status(400)
          .json({ success: false, message: "Choose an image first." });
      }
      const uploaded = await uploadImageToImageKit({
        fileBuffer: req.file.buffer,
        fileName: req.file.originalname || `marketplace-${Date.now()}.png`,
        folder: "/medialab/marketplace",
        tags: ["marketplace", "preview", String(req.user._id || "")],
      });
      return res.json({
        success: true,
        url: uploaded.url,
        thumbnailUrl: uploaded.thumbnailUrl,
        fileId: uploaded.fileId,
        name: uploaded.name,
      });
    } catch (error) {
      console.error("Marketplace screenshot upload failed:", error);
      return res.status(500).json({
        success: false,
        message:
          error?.message || "Could not upload this screenshot right now.",
      });
    }
  },
);

app.post(
  "/api/github/settings",
  githubSettingsUpload.single("favicon"),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res
        .status(401)
        .json({ success: false, message: "You need to sign in first." });
    }

    try {
      const user = await User.findById(req.user._id).select("+githubToken");
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found." });
      }

      const nextAdsenseId = normalizeAdsensePublisherId(
        req.body?.adsenseId || "",
      );
      if (nextAdsenseId && !/^ca-pub-\d+$/i.test(nextAdsenseId)) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid Google AdSense publisher ID.",
        });
      }

      user.adsenseId = nextAdsenseId;
      let faviconUpdated = false;

      if (req.file) {
        if (
          !user.githubUsername ||
          !user.githubToken ||
          !user.githubRepoCreated
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Set up GitHub hosting first before uploading a favicon to your live projects.",
          });
        }
        const octokit = buildGithubClient(user);
        let existingSha = "";
        try {
          const existing = await octokit.rest.repos.getContent({
            owner: user.githubUsername,
            repo: getUserGithubRepoName(user),
            path: "favicon.ico",
          });
          if (!Array.isArray(existing.data) && existing.data?.sha) {
            existingSha = existing.data.sha;
          }
        } catch (error) {
          if ((error?.status || error?.response?.status) !== 404) throw error;
        }

        await octokit.rest.repos.createOrUpdateFileContents({
          owner: user.githubUsername,
          repo: getUserGithubRepoName(user),
          path: "favicon.ico",
          message: `${existingSha ? "Update" : "Upload"} favicon.ico from MediaLab`,
          content: req.file.buffer.toString("base64"),
          ...(existingSha ? { sha: existingSha } : {}),
        });
        user.faviconFileName = "favicon.ico";
        faviconUpdated = true;
      }

      await user.save();
      req.user.adsenseId = user.adsenseId;
      req.user.faviconFileName = user.faviconFileName;

      return res.json({
        success: true,
        message: faviconUpdated
          ? "Studio settings saved and favicon uploaded."
          : "Studio settings saved.",
        faviconUpdated,
        user: toSafeUser(user),
      });
    } catch (error) {
      console.error("GitHub settings save failed:", error);
      return res.status(error?.status || error?.response?.status || 500).json({
        success: false,
        message:
          error?.response?.data?.message ||
          error?.message ||
          "Could not save Studio settings right now.",
      });
    }
  },
);

app.post("/api/github/setup-adsense", express.json(), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const user = await User.findById(req.user._id).select("+githubToken");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    if (!user.githubUsername || !user.githubToken || !user.githubRepoCreated) {
      return res.status(400).json({
        success: false,
        message: "Set up GitHub hosting first before generating ads.txt.",
      });
    }
    const adsenseId = normalizeAdsensePublisherId(
      req.body?.adsenseId || user.adsenseId || "",
    );
    if (!/^ca-pub-\d+$/i.test(adsenseId)) {
      return res.status(400).json({
        success: false,
        message: "Add a valid AdSense publisher ID in Studio Settings first.",
      });
    }

    user.adsenseId = adsenseId;
    const publisherValue = adsenseId.replace(/^ca-/i, "");
    const octokit = buildGithubClient(user);
    let existingSha = "";
    try {
      const existing = await octokit.rest.repos.getContent({
        owner: user.githubUsername,
        repo: getUserGithubRepoName(user),
        path: "ads.txt",
      });
      if (!Array.isArray(existing.data) && existing.data?.sha) {
        existingSha = existing.data.sha;
      }
    } catch (error) {
      if ((error?.status || error?.response?.status) !== 404) throw error;
    }

    const adsTxtContent = `google.com, ${publisherValue}, DIRECT, f08c47fec0942fa0\n`;
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: user.githubUsername,
      repo: getUserGithubRepoName(user),
      path: "ads.txt",
      message: `${existingSha ? "Update" : "Create"} ads.txt from MediaLab`,
      content: Buffer.from(adsTxtContent).toString("base64"),
      ...(existingSha ? { sha: existingSha } : {}),
    });

    await user.save();
    req.user.adsenseId = user.adsenseId;

    return res.json({
      success: true,
      message: "ads.txt is live in your medialab repository.",
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("GitHub AdSense setup failed:", error);
    return res.status(error?.status || error?.response?.status || 500).json({
      success: false,
      message:
        error?.response?.data?.message ||
        error?.message ||
        "Could not set up ads.txt right now.",
    });
  }
});

app.get("/api/github/project-health", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const url = String(req.query?.url || "").trim();
    if (!url) {
      return res
        .status(400)
        .json({ success: false, message: "Missing live URL." });
    }
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "MediaLab-Health-Check" },
    });
    return res.json({
      success: true,
      ok: response.status < 400,
      status: response.status,
      url,
    });
  } catch (error) {
    return res.json({
      success: true,
      ok: false,
      status: 0,
      url: String(req.query?.url || "").trim(),
      message: error?.message || "Health check failed.",
    });
  }
});

app.get("/api/github/project-monitor", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const filename = String(req.query?.filename || "").trim();
    if (!filename) {
      return res
        .status(400)
        .json({ success: false, message: "Missing filename." });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    const project = (
      Array.isArray(user.liveProjects) ? user.liveProjects : []
    ).find(
      (item) =>
        String(item?.fileName || item?.filename || "").trim() === filename,
    );
    if (!project) {
      return res
        .status(404)
        .json({ success: false, message: "Live project not found." });
    }

    let adsenseSync = null;
    try {
      adsenseSync = await refreshAdsenseSiteStatusIfNeeded(user);
    } catch (error) {
      console.warn("Project monitor AdSense refresh skipped:", error.message);
    }

    const liveUrl = buildProjectLiveUrl(user, project);
    const health = {
      ok: false,
      status: 0,
      state: "offline",
      label: "Offline",
    };
    let html = "";
    try {
      const response = await fetch(liveUrl, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": "MediaLab-Project-Monitor" },
      });
      health.ok = response.status < 400;
      health.status = response.status;
      health.state =
        response.status < 400
          ? "online"
          : response.status >= 500
            ? "offline"
            : "deploying";
      health.label =
        response.status < 400
          ? "System Online"
          : response.status >= 500
            ? "Offline"
            : "Deploying";
      html = await response.text();
      if (
        response.status < 400 &&
        project.renderUrl &&
        !project.renderHostedConfirmed
      ) {
        project.renderHostedConfirmed = true;
        project.renderVerifiedAt = new Date();
        project.renderDeployStatus = "live";
        project.updatedAt = new Date();
        if (!user.confirmedFirstHosting) {
          user.confirmedFirstHosting = true;
          user.firstHostingConfirmedAt = new Date();
        }
        await user.save();
      } else if (response.status >= 500 && project.renderUrl) {
        project.renderDeployStatus = "server-error";
        project.updatedAt = new Date();
        await user.save();
      }
    } catch (error) {
      health.ok = false;
      health.status = 0;
      health.state =
        project.renderUrl && !project.renderHostedConfirmed
          ? "deploying"
          : "offline";
      health.label = health.state === "deploying" ? "Deploying" : "Offline";
    }

    const adsDetected = detectAdsenseScript(
      html,
      project?.monetizationEnabled && project?.isMonetized
        ? user.adsenseId || project.adsensePublisherId || ""
        : "",
    );

    let adsTxtVerified = false;
    let adsTxtUrl = "";
    for (const candidateUrl of buildAdsTxtCandidateUrls(user)) {
      try {
        const response = await fetch(candidateUrl, {
          method: "GET",
          redirect: "follow",
          headers: { "User-Agent": "MediaLab-AdsTxt-Verify" },
        });
        if (response.status < 400) {
          adsTxtVerified = true;
          adsTxtUrl = candidateUrl;
          break;
        }
      } catch {}
    }
    if (!adsTxtUrl) {
      adsTxtUrl = buildAdsTxtCandidateUrls(user)[0] || "";
    }

    let adsPerformance = null;
    if (
      project?.monetizationEnabled &&
      project?.isMonetized &&
      user.googleRefreshToken
    ) {
      try {
        adsPerformance = await getAdsenseDomainStats(user, liveUrl);
      } catch (error) {
        console.warn("Project AdSense stats skipped:", error.message);
      }
    }

    return res.json({
      success: true,
      project: {
        ...(typeof project.toObject === "function"
          ? project.toObject()
          : { ...project }),
        liveUrl,
      },
      health,
      adsDetected,
      adsTxtVerified,
      adsTxtUrl,
      monetizationApproved: Boolean(
        project?.monetizationEnabled &&
        project?.isMonetized &&
        adsDetected &&
        adsTxtVerified &&
        user.adsenseId,
      ),
      adsenseId: user.adsenseId || "",
      adsenseSiteStatus: user.adsenseSiteStatus || "",
      adsenseReviewState:
        adsenseSync?.reviewState ||
        normalizeAdsenseReviewState(user.adsenseSiteStatus || ""),
      adsenseLastCheckedAt: user.adsenseLastCheckedAt || null,
      adsenseApprovedAt: user.adsenseApprovedAt || null,
      isMonetized: Boolean(project?.isMonetized),
      adsPerformance,
    });
  } catch (error) {
    console.error("GitHub project monitor failed:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Could not load project monitor right now.",
    });
  }
});

app.get("/api/marketplace", async (req, res) => {
  try {
    const items = await MarketplaceItem.aggregate([
      { $match: { status: "approved" } },
      { $sample: { size: 24 } },
    ]);
    return res.json({
      success: true,
      items: items.map((item) =>
        buildMarketplacePublicItem(item, req.user?._id),
      ),
    });
  } catch (error) {
    console.error("Marketplace discovery fetch failed:", error);
    return res.status(500).json({
      success: false,
      message:
        error?.message || "Could not load marketplace projects right now.",
    });
  }
});

app.get("/api/marketplace/mine", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({
      success: false,
      message: "You need to sign in first.",
    });
  }

  try {
    const items = await MarketplaceItem.find({ authorId: req.user._id })
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();
    return res.json({
      success: true,
      items: items.map((item) =>
        buildMarketplacePublicItem(item, req.user?._id),
      ),
    });
  } catch (error) {
    console.error("Marketplace my sales fetch failed:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Could not load your marketplace listings.",
    });
  }
});

app.get("/api/marketplace/purchases", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({
      success: false,
      message: "You need to sign in first.",
    });
  }
  try {
    const items = await MarketplaceItem.find({
      "purchases.buyerId": req.user._id,
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();
    return res.json({
      success: true,
      items: items.map((item) =>
        buildMarketplacePublicItem(item, req.user?._id),
      ),
    });
  } catch (error) {
    console.error("Marketplace purchases fetch failed:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Could not load your purchased projects.",
    });
  }
});

app.get("/api/marketplace/:id", async (req, res) => {
  try {
    const item = await MarketplaceItem.findById(req.params.id).lean();
    if (
      !item ||
      (item.status !== "approved" &&
        String(item.authorId) !== String(req.user?._id || ""))
    ) {
      return res.status(404).json({
        success: false,
        message: "Marketplace listing not found.",
      });
    }
    return res.json({
      success: true,
      item: buildMarketplacePublicItem(item, req.user?._id),
    });
  } catch (error) {
    console.error("Marketplace detail fetch failed:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Could not load marketplace project details.",
    });
  }
});

app.post(
  "/api/marketplace",
  publishRateLimit,
  express.json({ limit: "15mb" }),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({
        success: false,
        message: "Sign in first before posting a marketplace sale.",
      });
    }

    try {
      const user = await User.findById(req.user._id);
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found." });
      }
      const sourceType = ["upload", "draft", "live", "template-code"].includes(
        String(req.body?.sourceType || "").trim(),
      )
        ? String(req.body.sourceType).trim()
        : "draft";
      const listingKind =
        String(req.body?.listingKind || "")
          .trim()
          .toLowerCase() === "template" || sourceType === "template-code"
          ? "template"
          : "sale";
      const projectId = buildMarketplaceProjectId(
        sourceType,
        req.body?.projectId || "",
        req.body?.title || "",
      );
      const title = sanitizeMarketplaceText(req.body?.title || "", 120);
      const description = sanitizeMarketplaceText(
        req.body?.description || "",
        1200,
      );
      const purpose = sanitizeMarketplaceText(req.body?.purpose || "", 800);
      const category =
        sanitizeMarketplaceText(req.body?.category || "General", 80) ||
        "General";
      const price =
        listingKind === "template"
          ? 0
          : normalizeMarketplacePrice(req.body?.price);
      const allowTest = Boolean(req.body?.allowTest);
      const screenshots = (
        Array.isArray(req.body?.screenshots) ? req.body.screenshots : []
      )
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .slice(0, 4);
      const screenshotAssets = (
        Array.isArray(req.body?.screenshotAssets)
          ? req.body.screenshotAssets
          : []
      )
        .map((asset) => ({
          url: String(asset?.url || "").trim(),
          thumbnailUrl: String(asset?.thumbnailUrl || asset?.url || "").trim(),
          fileId: String(asset?.fileId || "").trim(),
          name: String(asset?.name || "").trim(),
        }))
        .filter((asset) => asset.url)
        .slice(0, 4);
      const sourceHtml = String(req.body?.sourceHtml || "").trim();
      const sourceEntryPath = normalizeImportedEntryPath(
        req.body?.sourceEntryPath || "index.html",
      );
      const sourceFiles = (
        Array.isArray(req.body?.sourceFiles) ? req.body.sourceFiles : []
      )
        .map((file) => ({
          path: normalizeRepoFilePath(file?.path || file?.name || ""),
          name: String(file?.name || "").trim(),
          content: typeof file?.content === "string" ? file.content : "",
          contentBase64:
            typeof file?.contentBase64 === "string" ? file.contentBase64 : "",
          mimeType: String(file?.mimeType || "").trim(),
        }))
        .filter((file) => file.path);
      const packagedSourceHtml = resolveMarketplaceSourceHtmlFromFiles(
        sourceFiles,
        sourceEntryPath,
      );

      if (!projectId && listingKind !== "template") {
        return res.status(400).json({
          success: false,
          message:
            "Select a project source first before submitting it to the marketplace.",
        });
      }
      if (!title) {
        return res.status(400).json({
          success: false,
          message: "Enter a marketplace title before submitting this sale.",
        });
      }
      if (!description) {
        return res.status(400).json({
          success: false,
          message:
            "Add a professional description before submitting this sale.",
        });
      }
      if (listingKind !== "template" && purpose.length < 5) {
        return res.status(400).json({
          success: false,
          message: "Add a clearer project purpose before submitting this sale.",
        });
      }
      if (listingKind !== "template" && !category) {
        return res.status(400).json({
          success: false,
          message: "Choose a project category before submitting this sale.",
        });
      }
      if (listingKind !== "template" && screenshots.length < 4) {
        return res.status(400).json({
          success: false,
          message:
            "Upload 4 preview images so buyers get a proper marketplace preview.",
        });
      }
      let sourceProject = null;
      let liveUrl = "";
      let resolvedSourceHtml = sourceHtml || packagedSourceHtml;
      if (listingKind === "template") {
        resolvedSourceHtml = normalizeMarketplaceTemplateHtml(
          sourceHtml || packagedSourceHtml,
          title,
        );
      } else if (sourceType === "draft") {
        const builderDrafts = Array.isArray(user.builderDrafts)
          ? user.builderDrafts
          : [];
        const draft = builderDrafts.find(
          (item) => String(item?.name || "").trim() === projectId,
        );
        if (!draft && !resolvedSourceHtml) {
          return res.status(400).json({
            success: false,
            message: "Choose one of your MediaLab drafts before listing it.",
          });
        }
        resolvedSourceHtml =
          resolvedSourceHtml ||
          String(draft?.canvasHtml || "").trim() ||
          String(draft?.canvasState?.html || "").trim();
      } else if (sourceType === "upload") {
        if (!resolvedSourceHtml) {
          return res.status(400).json({
            success: false,
            message:
              "Upload a project folder that contains an HTML entry file before continuing.",
          });
        }
      } else {
        sourceProject = findLiveProject(user, projectId);
        liveUrl = sourceProject ? buildProjectLiveUrl(user, sourceProject) : "";
        if (!resolvedSourceHtml && sourceProject) {
          const fetched = await fetchMarketplaceSourceHtml(user, projectId);
          resolvedSourceHtml = String(fetched?.html || "").trim();
        }
        if (!resolvedSourceHtml) {
          return res.status(400).json({
            success: false,
            message:
              "Terminate the live project first so MediaLab can package it for the marketplace.",
          });
        }
      }
      if (!resolvedSourceHtml) {
        return res.status(400).json({
          success: false,
          message:
            "MediaLab could not package this project source yet. Re-select the source and try again.",
        });
      }

      const existing = await MarketplaceItem.findOne({
        authorId: user._id,
        projectId,
        status: { $in: ["pending", "approved"] },
      });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: "This project is already listed in your marketplace sales.",
        });
      }

      const sellerRatingMeta = computeSellerRatingMeta(user);
      const item = await MarketplaceItem.create({
        projectId:
          listingKind === "template" ? `template-${Date.now()}` : projectId,
        authorId: user._id,
        title,
        description,
        price,
        category,
        screenshots,
        screenshotAssets,
        allowTest: listingKind === "template" ? false : allowTest,
        purpose,
        sourceType,
        listingKind,
        sourceHtml: resolvedSourceHtml,
        sourceEntryPath,
        sourceFiles,
        status: "pending",
        authorName: user.name || user.email || "MediaLab Creator",
        authorEmail: String(user.email || "")
          .trim()
          .toLowerCase(),
        authorAvatar: user.profilePicture || "",
        keepListedAfterPurchase:
          String(user.email || "")
            .trim()
            .toLowerCase() === "dev@gmail.com",
        sellerRatingCount: sellerRatingMeta.sellerRatingCount,
        sellerRatingPercent: sellerRatingMeta.sellerRatingPercent,
        liveUrl,
      });

      if (user.githubUsername && user.githubToken) {
        try {
          await syncMarketplaceListingToGithub(user, item);
        } catch (repoError) {
          console.warn("Marketplace repo sync skipped:", repoError.message);
        }
      }

      await createUsageLog({
        user,
        email: user.email,
        name: user.name,
        isPro: Boolean(user.isPro),
        action: "marketplace-listing-create",
        summary: `submitted marketplace listing ${title}`,
        source: "marketplace",
        metadata: { projectId, title, price, sourceType, listingKind },
      });
      return res.json({
        success: true,
        message:
          listingKind === "template"
            ? "Template submitted for marketplace review."
            : "Project submitted for marketplace review.",
        item: buildMarketplacePublicItem(item.toObject(), req.user?._id),
      });
    } catch (error) {
      console.error("Marketplace create failed:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Could not submit this marketplace listing.",
      });
    }
  },
);

app.get("/api/marketplace/:id/edit", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({
      success: false,
      message: "Sign in first to edit your marketplace sale.",
    });
  }
  try {
    const item = await MarketplaceItem.findById(req.params.id).lean();
    if (!item || String(item.authorId || "") !== String(req.user._id || "")) {
      return res.status(404).json({
        success: false,
        message: "Marketplace listing not found.",
      });
    }
    return res.json({
      success: true,
      item: {
        ...buildMarketplacePublicItem(item, req.user?._id),
        sourceHtml: String(item.sourceHtml || ""),
        sourceEntryPath: item.sourceEntryPath || "index.html",
        sourceFiles: Array.isArray(item.sourceFiles) ? item.sourceFiles : [],
      },
    });
  } catch (error) {
    console.error("Marketplace edit detail failed:", error);
    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Could not load this marketplace listing for editing.",
    });
  }
});

app.patch(
  "/api/marketplace/:id",
  publishRateLimit,
  express.json({ limit: "15mb" }),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({
        success: false,
        message: "Sign in first before editing a marketplace sale.",
      });
    }

    try {
      const user = await User.findById(req.user._id);
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found." });
      }
      const item = await MarketplaceItem.findById(req.params.id);
      if (!item || String(item.authorId || "") !== String(req.user._id || "")) {
        return res.status(404).json({
          success: false,
          message: "Marketplace listing not found.",
        });
      }
      const sourceType = ["upload", "draft", "live", "template-code"].includes(
        String(req.body?.sourceType || "").trim(),
      )
        ? String(req.body.sourceType).trim()
        : item.sourceType || "draft";
      const listingKind =
        String(req.body?.listingKind || item.listingKind || "")
          .trim()
          .toLowerCase() === "template" || sourceType === "template-code"
          ? "template"
          : "sale";
      const projectId = buildMarketplaceProjectId(
        sourceType,
        req.body?.projectId || item.projectId || "",
        req.body?.title || item.title || "",
      );
      const title = sanitizeMarketplaceText(
        req.body?.title || item.title || "",
        120,
      );
      const description = sanitizeMarketplaceText(
        req.body?.description || item.description || "",
        1200,
      );
      const purpose = sanitizeMarketplaceText(
        req.body?.purpose || item.purpose || "",
        800,
      );
      const category =
        sanitizeMarketplaceText(
          req.body?.category || item.category || "General",
          80,
        ) || "General";
      const price =
        listingKind === "template"
          ? 0
          : normalizeMarketplacePrice(
              req.body?.price !== undefined ? req.body.price : item.price,
            );
      const allowTest =
        req.body?.allowTest !== undefined
          ? Boolean(req.body.allowTest)
          : Boolean(item.allowTest);
      const screenshots = (
        Array.isArray(req.body?.screenshots)
          ? req.body.screenshots
          : item.screenshots || []
      )
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .slice(0, 4);
      const screenshotAssets = (
        Array.isArray(req.body?.screenshotAssets)
          ? req.body.screenshotAssets
          : item.screenshotAssets || []
      )
        .map((asset) => ({
          url: String(asset?.url || "").trim(),
          thumbnailUrl: String(asset?.thumbnailUrl || asset?.url || "").trim(),
          fileId: String(asset?.fileId || "").trim(),
          name: String(asset?.name || "").trim(),
        }))
        .filter((asset) => asset.url)
        .slice(0, 4);
      const sourceHtml = String(
        req.body?.sourceHtml || item.sourceHtml || "",
      ).trim();
      const sourceEntryPath = normalizeImportedEntryPath(
        req.body?.sourceEntryPath || item.sourceEntryPath || "index.html",
      );
      const sourceFiles = (
        Array.isArray(req.body?.sourceFiles)
          ? req.body.sourceFiles
          : item.sourceFiles || []
      )
        .map((file) => ({
          path: normalizeRepoFilePath(file?.path || file?.name || ""),
          name: String(file?.name || "").trim(),
          content: typeof file?.content === "string" ? file.content : "",
          contentBase64:
            typeof file?.contentBase64 === "string" ? file.contentBase64 : "",
          mimeType: String(file?.mimeType || "").trim(),
        }))
        .filter((file) => file.path);
      const packagedSourceHtml = resolveMarketplaceSourceHtmlFromFiles(
        sourceFiles,
        sourceEntryPath,
      );

      if (!projectId && listingKind !== "template") {
        return res.status(400).json({
          success: false,
          message: "Select a project source first before updating it.",
        });
      }
      if (!title) {
        return res.status(400).json({
          success: false,
          message: "Enter a marketplace title before updating this sale.",
        });
      }
      if (!description) {
        return res.status(400).json({
          success: false,
          message: "Add a professional description before updating this sale.",
        });
      }
      if (listingKind !== "template" && purpose.length < 5) {
        return res.status(400).json({
          success: false,
          message: "Add a clearer project purpose before updating this sale.",
        });
      }
      if (listingKind !== "template" && !category) {
        return res.status(400).json({
          success: false,
          message: "Choose a project category before updating this sale.",
        });
      }
      if (listingKind !== "template" && screenshots.length < 4) {
        return res.status(400).json({
          success: false,
          message:
            "Upload 4 preview images so buyers get a proper marketplace preview.",
        });
      }
      let sourceProject = null;
      let liveUrl = "";
      let resolvedSourceHtml = sourceHtml || packagedSourceHtml;
      if (listingKind === "template") {
        resolvedSourceHtml = normalizeMarketplaceTemplateHtml(
          sourceHtml || packagedSourceHtml,
          title,
        );
      } else if (sourceType === "draft") {
        const builderDrafts = Array.isArray(user.builderDrafts)
          ? user.builderDrafts
          : [];
        const draft = builderDrafts.find(
          (entry) => String(entry?.name || "").trim() === projectId,
        );
        if (!draft && !resolvedSourceHtml) {
          return res.status(400).json({
            success: false,
            message: "Choose one of your MediaLab drafts before updating it.",
          });
        }
        resolvedSourceHtml =
          resolvedSourceHtml ||
          String(draft?.canvasHtml || "").trim() ||
          String(draft?.canvasState?.html || "").trim();
      } else if (sourceType === "upload") {
        if (!resolvedSourceHtml) {
          return res.status(400).json({
            success: false,
            message:
              "Upload a project folder that contains an HTML entry file before continuing.",
          });
        }
      } else {
        sourceProject = findLiveProject(user, projectId);
        liveUrl = sourceProject ? buildProjectLiveUrl(user, sourceProject) : "";
        if (!resolvedSourceHtml && sourceProject) {
          const fetched = await fetchMarketplaceSourceHtml(user, projectId);
          resolvedSourceHtml = String(fetched?.html || "").trim();
        }
        if (!resolvedSourceHtml) {
          return res.status(400).json({
            success: false,
            message:
              "Terminate the live project first so MediaLab can package it for the marketplace.",
          });
        }
      }
      if (!resolvedSourceHtml) {
        return res.status(400).json({
          success: false,
          message:
            "MediaLab could not package this project source yet. Re-select the source and try again.",
        });
      }

      if (String(item.listingKind || "sale") === "template") {
        await cleanupMarketplaceTemplateArtifacts(item);
      }

      item.projectId =
        listingKind === "template"
          ? item.projectId || `template-${Date.now()}`
          : projectId;
      item.title = title;
      item.description = description;
      item.price = price;
      item.category = category;
      item.screenshots = screenshots;
      item.screenshotAssets = screenshotAssets;
      item.allowTest = listingKind === "template" ? false : allowTest;
      item.purpose = purpose;
      item.sourceType = sourceType;
      item.listingKind = listingKind;
      item.sourceHtml = resolvedSourceHtml;
      item.sourceEntryPath = sourceEntryPath;
      item.sourceFiles = sourceFiles;
      item.status = "pending";
      item.disapprovalReason = "";
      item.reviewedAt = null;
      item.liveUrl = liveUrl;
      item.authorEmail = String(user.email || "")
        .trim()
        .toLowerCase();
      item.keepListedAfterPurchase =
        String(user.email || "")
          .trim()
          .toLowerCase() === "dev@gmail.com";
      item.updatedAt = new Date();
      await item.save();

      if (user.githubUsername && user.githubToken) {
        try {
          await syncMarketplaceListingToGithub(user, item);
        } catch (repoError) {
          console.warn("Marketplace repo sync skipped:", repoError.message);
        }
      }

      await createUsageLog({
        user,
        email: user.email,
        name: user.name,
        isPro: Boolean(user.isPro),
        action: "marketplace-listing-edit",
        summary: `updated marketplace listing ${title}`,
        source: "marketplace",
        metadata: { projectId, title, price, sourceType, listingKind },
      });

      return res.json({
        success: true,
        message: "Marketplace listing updated and sent for review.",
        item: buildMarketplacePublicItem(item.toObject(), req.user?._id),
      });
    } catch (error) {
      console.error("Marketplace update failed:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Could not update this marketplace listing.",
      });
    }
  },
);

app.post(
  "/api/marketplace/:id/comment",
  publishRateLimit,
  express.json(),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Sign in first to comment." });
    }

    try {
      const item = await MarketplaceItem.findById(req.params.id);
      if (!item || item.status !== "approved") {
        return res
          .status(404)
          .json({ success: false, message: "Marketplace listing not found." });
      }
      if (String(item.authorId || "") === String(req.user._id || "")) {
        return res.status(403).json({
          success: false,
          message: "You cannot comment on your own marketplace project.",
        });
      }
      const text = sanitizeMarketplaceText(req.body?.text || "", 400);
      const rating = Math.max(1, Math.min(5, Number(req.body?.rating || 5)));
      if (!text) {
        return res
          .status(400)
          .json({ success: false, message: "Write a comment first." });
      }
      item.comments.push({
        userId: req.user._id,
        name: req.user.name || req.user.email || "MediaLab user",
        text,
        rating,
        date: new Date(),
      });
      item.updatedAt = new Date();
      await item.save();
      await createUserNotification({
        userId: item.authorId,
        type: "marketplace-comment",
        title: `${req.user.name || "Someone"} commented on your sale`,
        message: `${req.user.name || "A buyer"} commented on ${item.title}. Click to open the listing.`,
        targetType: "marketplace-sale",
        targetId: String(item._id),
        metadata: { itemId: String(item._id), title: item.title },
      });
      return res.json({
        success: true,
        message: "Comment posted.",
        item: buildMarketplacePublicItem(item.toObject(), req.user?._id),
      });
    } catch (error) {
      console.error("Marketplace comment failed:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Could not save your marketplace comment.",
      });
    }
  },
);

app.post(
  "/api/marketplace/:id/comments/:commentId/reply",
  publishRateLimit,
  express.json(),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Sign in first to reply." });
    }
    try {
      const item = await MarketplaceItem.findById(req.params.id);
      if (!item || item.status !== "approved") {
        return res
          .status(404)
          .json({ success: false, message: "Marketplace listing not found." });
      }
      const text = sanitizeMarketplaceText(req.body?.text || "", 300);
      if (!text) {
        return res
          .status(400)
          .json({ success: false, message: "Write a reply first." });
      }
      const comment = (Array.isArray(item.comments) ? item.comments : []).find(
        (entry) =>
          String(entry?._id || "") === String(req.params.commentId || ""),
      );
      if (!comment) {
        return res
          .status(404)
          .json({ success: false, message: "Comment not found." });
      }
      if (String(item.authorId || "") === String(req.user._id || "")) {
        return res.status(403).json({
          success: false,
          message:
            "You cannot reply inside your own marketplace project thread.",
        });
      }
      comment.replies = Array.isArray(comment.replies) ? comment.replies : [];
      comment.replies.push({
        userId: req.user._id,
        name: req.user.name || req.user.email || "MediaLab user",
        text,
        date: new Date(),
      });
      item.updatedAt = new Date();
      await item.save();
      await createUserNotification({
        userId: item.authorId,
        type: "marketplace-reply",
        title: `${req.user.name || "Someone"} replied on your sale`,
        message: `${req.user.name || "A buyer"} replied in the discussion for ${item.title}.`,
        targetType: "marketplace-sale",
        targetId: String(item._id),
        metadata: {
          itemId: String(item._id),
          title: item.title,
          commentId: String(comment._id || ""),
        },
      });
      return res.json({
        success: true,
        message: "Reply posted.",
        item: buildMarketplacePublicItem(item.toObject(), req.user?._id),
      });
    } catch (error) {
      console.error("Marketplace reply failed:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Could not save your reply.",
      });
    }
  },
);

app.post(
  "/api/marketplace/:id/rate",
  publishRateLimit,
  express.json(),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Sign in first to rate." });
    }

    try {
      const item = await MarketplaceItem.findById(req.params.id);
      if (!item || item.status !== "approved") {
        return res
          .status(404)
          .json({ success: false, message: "Marketplace listing not found." });
      }
      if (String(item.authorId || "") === String(req.user._id || "")) {
        return res.status(403).json({
          success: false,
          message: "You cannot rate your own marketplace project.",
        });
      }
      const value = Math.max(0, Math.min(5, Number(req.body?.value || 0)));
      const ratings = Array.isArray(item.ratings) ? item.ratings : [];
      const existingRatingIndex = ratings.findIndex(
        (rating) => String(rating?.userId || "") === String(req.user._id),
      );
      if (value <= 0) {
        if (existingRatingIndex >= 0) {
          ratings.splice(existingRatingIndex, 1);
        }
        item.ratings = ratings;
        item.updatedAt = new Date();
        await item.save();
        return res.json({
          success: true,
          message: "Marketplace rating removed.",
          item: buildMarketplacePublicItem(item, String(req.user._id || "")),
        });
      }
      if (existingRatingIndex >= 0) {
        ratings[existingRatingIndex].value = value;
        ratings[existingRatingIndex].date = new Date();
      } else {
        ratings.push({
          userId: req.user._id,
          value,
          date: new Date(),
        });
      }
      item.ratings = ratings;
      item.updatedAt = new Date();
      await item.save();
      await createUserNotification({
        userId: item.authorId,
        type: "marketplace-rating",
        title: `${req.user.name || "Someone"} rated your project`,
        message: `${req.user.name || "A buyer"} rated ${item.title}. Click to open the listing.`,
        targetType: "marketplace-sale",
        targetId: String(item._id),
        metadata: { itemId: String(item._id), title: item.title, value },
      });
      return res.json({
        success: true,
        message: "Rating saved.",
        item: buildMarketplacePublicItem(item.toObject(), req.user?._id),
      });
    } catch (error) {
      console.error("Marketplace rating failed:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Could not save that marketplace rating.",
      });
    }
  },
);

app.post(
  "/api/marketplace/:id/rate-seller",
  publishRateLimit,
  express.json(),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Sign in first to rate." });
    }

    try {
      const item = await MarketplaceItem.findById(req.params.id);
      if (!item || item.status !== "approved") {
        return res
          .status(404)
          .json({ success: false, message: "Marketplace listing not found." });
      }
      if (String(item.authorId || "") === String(req.user._id || "")) {
        return res.status(403).json({
          success: false,
          message: "You cannot rate your own seller profile.",
        });
      }
      const author = await User.findById(item.authorId);
      if (!author) {
        return res
          .status(404)
          .json({ success: false, message: "Seller account not found." });
      }
      author.sellerRatings = Array.isArray(author.sellerRatings)
        ? author.sellerRatings
        : [];
      const alreadyRated = author.sellerRatings.some(
        (entry) => String(entry?.userId || "") === String(req.user._id),
      );
      if (alreadyRated) {
        return res.status(400).json({
          success: false,
          message: "You have already rated this seller.",
        });
      }
      const value = Math.max(1, Math.min(5, Number(req.body?.value || 5)));
      author.sellerRatings.push({
        userId: req.user._id,
        value,
        date: new Date(),
        marketplaceItemId: item._id,
      });
      await author.save();
      await syncAuthorSellerRatingToListings(author._id);
      const refreshedItem = await MarketplaceItem.findById(item._id).lean();
      await createUserNotification({
        userId: author._id,
        type: "marketplace-seller-rating",
        title: `${req.user.name || "Someone"} rated you as a seller`,
        message: `${req.user.name || "A buyer"} rated your seller profile from ${item.title}.`,
        targetType: "marketplace-sale",
        targetId: String(item._id),
        metadata: { itemId: String(item._id), title: item.title, value },
      });
      return res.json({
        success: true,
        message: "Seller rating saved.",
        item: buildMarketplacePublicItem(
          refreshedItem || item.toObject(),
          req.user?._id,
        ),
      });
    } catch (error) {
      console.error("Seller rating failed:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Could not save that seller rating.",
      });
    }
  },
);

app.post(
  "/api/marketplace/:id/purchase",
  publishRateLimit,
  express.json(),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Sign in first to purchase." });
    }

    try {
      const item = await MarketplaceItem.findById(req.params.id);
      if (!item || item.status !== "approved") {
        return res
          .status(404)
          .json({ success: false, message: "Marketplace listing not found." });
      }
      if (shouldKeepMarketplaceListingAvailable(item)) {
        item.keepListedAfterPurchase = true;
        if (!String(item.authorEmail || "").trim()) {
          item.authorEmail = ADMIN_EMAIL;
        }
      }
      if (String(item.authorId) === String(req.user._id)) {
        return res.status(400).json({
          success: false,
          message: "You already own this project as the seller.",
        });
      }
      const existingPurchase = (
        Array.isArray(item.purchases) ? item.purchases : []
      ).find(
        (purchase) =>
          String(purchase?.buyerId || "") === String(req.user._id) &&
          ["pending", "approved"].includes(
            String(purchase?.status || "").toLowerCase(),
          ),
      );
      if (existingPurchase) {
        const isTemplate =
          String(item.listingKind || "sale").toLowerCase() === "template";
        return res.status(400).json({
          success: false,
          message:
            existingPurchase.status === "approved"
              ? isTemplate
                ? "Already added to workspace."
                : "This project is already in your purchased items."
              : "Your purchase request is already pending approval.",
        });
      }
      const purchase = {
        buyerId: req.user._id,
        buyerName: req.user.name || "",
        buyerEmail: req.user.email || "",
        status: "pending",
        message: "Your purchase will be processed within 24 hours.",
        createdAt: new Date(),
      };
      item.purchases.push(purchase);
      item.updatedAt = new Date();
      item.status = "approved";

      let transfer = null;
      let grantedTemplate = null;
      let responseMessage = "Your purchase will be processed within 24 hours.";
      if (
        Number(item.price || 0) <= 0 ||
        String(item.listingKind || "sale") === "template"
      ) {
        const buyer = await User.findById(req.user._id);
        if (!buyer) {
          return res
            .status(404)
            .json({ success: false, message: "Buyer account not found." });
        }
        const targetPurchase = item.purchases[item.purchases.length - 1];
        targetPurchase.status = "approved";
        targetPurchase.reviewedAt = new Date();
        targetPurchase.approvedUntil = new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000,
        );
        if (String(item.listingKind || "sale") === "template") {
          targetPurchase.message =
            "Purchase approved. You now own the template.";
          grantedTemplate = await grantMarketplaceTemplateToBuyer(item, buyer);
        } else {
          targetPurchase.message =
            "Purchase approved. You now own the project.";
          transfer = await transferMarketplaceProjectToBuyer(item, buyer);
        }
        item.status = "approved";
        responseMessage =
          String(item.listingKind || "sale") === "template"
            ? "Purchase approved. Template added to your Web Builder templates."
            : "Purchase approved. You now own the project.";
      }

      await item.save();
      await createUserNotification({
        userId: item.authorId,
        type: "marketplace-purchase",
        title:
          Number(item.price || 0) <= 0
            ? `${req.user.name || "A buyer"} claimed your project`
            : `${req.user.name || "A buyer"} purchased your project`,
        message:
          Number(item.price || 0) <= 0
            ? `${item.title} was claimed and approved automatically.`
            : `${item.title} now has a pending purchase request. Click to review it.`,
        targetType: "marketplace-sale",
        targetId: String(item._id),
        metadata: { itemId: String(item._id), title: item.title },
      });

      await createUsageLog({
        user: req.user,
        email: req.user.email,
        name: req.user.name,
        isPro: Boolean(req.user.isPro),
        action:
          Number(item.price || 0) <= 0
            ? "marketplace-purchase-approved"
            : "marketplace-purchase-pending",
        summary:
          Number(item.price || 0) <= 0
            ? `claimed free marketplace project ${item.title}`
            : `requested purchase for marketplace project ${item.title}`,
        source: "marketplace",
        metadata: {
          marketplaceItemId: String(item._id),
          title: item.title,
          price: item.price,
        },
      });

      return res.json({
        success: true,
        message: responseMessage,
        item: buildMarketplacePublicItem(item.toObject(), req.user?._id),
        transfer,
        template: grantedTemplate,
      });
    } catch (error) {
      console.error("Marketplace purchase failed:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Could not start this purchase right now.",
      });
    }
  },
);

app.patch(
  "/api/marketplace/:id/remove",
  publishRateLimit,
  express.json(),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({
        success: false,
        message: "Sign in first to manage your sales.",
      });
    }
    try {
      const item = await MarketplaceItem.findById(req.params.id);
      if (!item || String(item.authorId) !== String(req.user._id)) {
        return res
          .status(404)
          .json({ success: false, message: "Marketplace sale not found." });
      }
      const reason = sanitizeMarketplaceText(req.body?.reason || "", 240);
      await cleanupMarketplaceStorageArtifacts(item);
      await BuilderTemplate.deleteMany({ sourceMarketplaceItemId: item._id });
      const marketplaceRepo = String(item.marketplaceRepo || "").trim();
      const marketplaceRepoPath = String(item.marketplaceRepoPath || "").trim();
      if (
        req.user.githubUsername &&
        req.user.githubToken &&
        marketplaceRepo &&
        marketplaceRepoPath
      ) {
        try {
          const octokit = buildGithubClient(req.user);
          await deleteGithubPathRecursive(
            octokit,
            req.user.githubUsername,
            marketplaceRepo,
            marketplaceRepoPath,
          );
        } catch (repoError) {
          const status = repoError?.status || repoError?.response?.status;
          if (status !== 404) {
            console.warn(
              "Marketplace repo cleanup skipped:",
              repoError.message,
            );
          }
        }
      }
      await MarketplaceItem.deleteOne({ _id: item._id });
      await createUsageLog({
        user: req.user,
        email: req.user.email,
        name: req.user.name,
        isPro: Boolean(req.user.isPro),
        action: "marketplace-listing-deleted",
        summary: `deleted marketplace sale ${item.title}`,
        source: "marketplace",
        metadata: {
          marketplaceItemId: String(item._id),
          reason: reason || "Seller removed the sale.",
        },
      });
      return res.json({
        success: true,
        message: "Sale deleted from the marketplace.",
        itemId: String(item._id),
      });
    } catch (error) {
      console.error("Marketplace remove failed:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Could not remove this sale right now.",
      });
    }
  },
);

app.get(
  "/api/admin/marketplace",
  adminRateLimit,
  requireAdminApi,
  async (_req, res) => {
    try {
      const [
        pendingListings,
        approvedListings,
        itemsWithPendingPurchases,
        itemsWithReviewedPurchases,
      ] = await Promise.all([
        MarketplaceItem.find({ status: "pending" })
          .sort({ createdAt: -1 })
          .lean(),
        MarketplaceItem.find({ status: "approved" })
          .sort({ updatedAt: -1, createdAt: -1 })
          .lean(),
        MarketplaceItem.find({ "purchases.status": "pending" })
          .sort({ updatedAt: -1 })
          .lean(),
        MarketplaceItem.find({
          "purchases.status": { $in: ["approved", "declined", "failed"] },
        })
          .sort({ updatedAt: -1 })
          .lean(),
      ]);
      const reviewedPurchases = itemsWithReviewedPurchases
        .flatMap((item) =>
          (Array.isArray(item.purchases) ? item.purchases : [])
            .filter((purchase) =>
              ["approved", "declined", "failed"].includes(
                String(purchase.status || "").toLowerCase(),
              ),
            )
            .map((purchase) => ({
              itemId: String(item._id),
              purchaseId: String(purchase._id),
              title: item.title,
              price: Number(item.price || 0),
              status:
                String(purchase.status || "").toLowerCase() === "failed"
                  ? "declined"
                  : String(purchase.status || "").toLowerCase(),
              message: purchase.message || "",
              declineReason: purchase.declineReason || "",
              buyerId: purchase.buyerId || "",
              buyerName: purchase.buyerName || "",
              buyerEmail: purchase.buyerEmail || "",
              createdAt: purchase.createdAt || null,
              reviewedAt: purchase.reviewedAt || null,
            })),
        )
        .sort(
          (a, b) =>
            new Date(b.reviewedAt || b.createdAt || 0) -
            new Date(a.reviewedAt || a.createdAt || 0),
        );
      return res.json({
        success: true,
        pendingListings: pendingListings.map((item) =>
          buildMarketplacePublicItem(item),
        ),
        approvedListings: approvedListings.map((item) =>
          buildMarketplacePublicItem(item),
        ),
        pendingPurchases: itemsWithPendingPurchases
          .flatMap((item) =>
            (Array.isArray(item.purchases) ? item.purchases : [])
              .filter((purchase) => purchase.status === "pending")
              .map((purchase) => ({
                itemId: String(item._id),
                purchaseId: String(purchase._id),
                title: item.title,
                price: Number(item.price || 0),
                buyerId: purchase.buyerId || "",
                buyerName: purchase.buyerName || "",
                buyerEmail: purchase.buyerEmail || "",
                createdAt: purchase.createdAt || null,
              })),
          )
          .sort(
            (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
          ),
        approvedPurchases: reviewedPurchases.filter(
          (purchase) =>
            String(purchase.status || "").toLowerCase() === "approved",
        ),
        declinedPurchases: reviewedPurchases.filter(
          (purchase) =>
            String(purchase.status || "").toLowerCase() === "declined",
        ),
      });
    } catch (error) {
      console.error("Admin marketplace fetch failed:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Could not load marketplace admin data.",
      });
    }
  },
);

app.get(
  "/api/admin/marketplace/:id",
  adminRateLimit,
  requireAdminApi,
  async (req, res) => {
    try {
      const item = await MarketplaceItem.findById(req.params.id).lean();
      if (!item) {
        return res
          .status(404)
          .json({ success: false, message: "Marketplace listing not found." });
      }
      return res.json({
        success: true,
        item: {
          ...buildMarketplacePublicItem(item),
          sourceHtml: String(item.sourceHtml || ""),
          sourceEntryPath: item.sourceEntryPath || "index.html",
          sourceFiles: Array.isArray(item.sourceFiles) ? item.sourceFiles : [],
        },
      });
    } catch (error) {
      console.error("Admin marketplace detail failed:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Could not load this marketplace listing.",
      });
    }
  },
);

app.patch(
  "/api/admin/marketplace/:id",
  adminRateLimit,
  requireAdminApi,
  express.json(),
  async (req, res) => {
    try {
      const nextStatus = String(req.body?.status || "")
        .trim()
        .toLowerCase();
      if (!["approved", "disapproved", "sold"].includes(nextStatus)) {
        return res.status(400).json({
          success: false,
          message: "Marketplace status must be approved, disapproved, or sold.",
        });
      }
      const item = await MarketplaceItem.findById(req.params.id);
      if (!item) {
        return res
          .status(404)
          .json({ success: false, message: "Marketplace listing not found." });
      }
      const previousStatus = String(item.status || "")
        .trim()
        .toLowerCase();
      item.status = nextStatus;
      item.disapprovalReason =
        nextStatus === "disapproved"
          ? sanitizeMarketplaceText(req.body?.disapprovalReason || "", 500)
          : "";
      item.updatedAt = new Date();
      item.reviewedAt = new Date();
      await item.save();
      await createUserNotification({
        userId: item.authorId,
        type: `marketplace-${nextStatus}`,
        title:
          nextStatus === "approved"
            ? "Your marketplace project was approved"
            : nextStatus === "disapproved" && previousStatus === "approved"
              ? "Your marketplace project was suspended"
              : nextStatus === "disapproved"
                ? "Your marketplace project was disapproved"
                : "Your marketplace project was updated",
        message:
          nextStatus === "disapproved" && previousStatus === "approved"
            ? item.disapprovalReason ||
              "Your approved sale was suspended. Click to review it in My Sales."
            : nextStatus === "disapproved"
              ? item.disapprovalReason ||
                "Please review the feedback and submit again."
              : String(item.listingKind || "sale") === "template"
                ? `${item.title} was approved and is now live in Marketplace Templates.`
                : `${item.title} is now ${nextStatus}. Click to review it in My Sales.`,
        targetType: "marketplace-sale",
        targetId: String(item._id),
        metadata: {
          itemId: String(item._id),
          status: nextStatus,
          title: item.title,
          listingKind: item.listingKind || "sale",
          templateSlug: "",
        },
      });
      return res.json({
        success: true,
        message:
          nextStatus === "disapproved"
            ? "Marketplace listing disapproved."
            : `Marketplace listing marked ${nextStatus}.`,
        item: buildMarketplacePublicItem(item.toObject()),
      });
    } catch (error) {
      console.error("Admin marketplace listing update failed:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Could not update this marketplace listing.",
      });
    }
  },
);

app.patch(
  "/api/admin/marketplace/:id/purchases/:purchaseId",
  adminRateLimit,
  requireAdminApi,
  express.json(),
  async (req, res) => {
    try {
      const requestedStatus = String(req.body?.status || "")
        .trim()
        .toLowerCase();
      const nextStatus =
        requestedStatus === "failed" ? "declined" : requestedStatus;
      const declineReason = sanitizeMarketplaceText(
        req.body?.declineReason || req.body?.failedReason || "",
        500,
      );
      if (!["approved", "declined"].includes(nextStatus)) {
        return res.status(400).json({
          success: false,
          message: "Purchase status must be approved or declined.",
        });
      }
      const item = await MarketplaceItem.findById(req.params.id);
      if (!item) {
        return res
          .status(404)
          .json({ success: false, message: "Marketplace item not found." });
      }
      const purchase = (
        Array.isArray(item.purchases) ? item.purchases : []
      ).find((entry) => String(entry._id) === String(req.params.purchaseId));
      if (!purchase) {
        return res
          .status(404)
          .json({ success: false, message: "Purchase request not found." });
      }
      if (shouldKeepMarketplaceListingAvailable(item)) {
        item.keepListedAfterPurchase = true;
        if (!String(item.authorEmail || "").trim()) {
          item.authorEmail = ADMIN_EMAIL;
        }
      }
      purchase.status = nextStatus;
      purchase.reviewedAt = new Date();
      item.updatedAt = new Date();

      let transfer = null;
      let grantedTemplate = null;
      if (nextStatus === "approved") {
        const buyer = await User.findById(purchase.buyerId);
        if (!buyer) {
          return res
            .status(404)
            .json({ success: false, message: "Buyer account not found." });
        }
        purchase.message =
          String(item.listingKind || "sale") === "template"
            ? "Purchase approved. You now own the template."
            : "Purchase approved. You now own the project.";
        purchase.declineReason = "";
        purchase.approvedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        if (String(item.listingKind || "sale") === "template") {
          grantedTemplate = await grantMarketplaceTemplateToBuyer(item, buyer);
        } else {
          transfer = await transferMarketplaceProjectToBuyer(item, buyer);
        }
        item.status = "approved";
        await createUserNotification({
          userId: buyer._id,
          type: "marketplace-purchase-approved",
          title: "Purchase approved",
          message:
            String(item.listingKind || "sale") === "template"
              ? `Your purchase for ${item.title} was approved. You now own the template.`
              : `Your purchase for ${item.title} was approved. You now own the project.`,
          targetType: "marketplace-purchased",
          targetId: String(item._id),
          metadata: {
            itemId: String(item._id),
            title: item.title,
            purchaseId: String(purchase._id),
          },
        });
        await createUserNotification({
          userId: item.authorId,
          type: "marketplace-sale-approved",
          title: "Purchase approved for your sale",
          message: `${item.title} was approved for ${purchase.buyerName || "the buyer"}.`,
          targetType: "marketplace-sale",
          targetId: String(item._id),
          metadata: {
            itemId: String(item._id),
            title: item.title,
            purchaseId: String(purchase._id),
          },
        });
      } else {
        purchase.declineReason = declineReason;
        purchase.message =
          declineReason ||
          "Your purchase request was declined. Please review the admin feedback and try again.";
        purchase.approvedUntil = null;
        item.status = "approved";
        await createUserNotification({
          userId: purchase.buyerId,
          type: "marketplace-purchase-declined",
          title: "Purchase declined",
          message: purchase.message,
          targetType: "marketplace-purchased",
          targetId: String(item._id),
          metadata: {
            itemId: String(item._id),
            title: item.title,
            purchaseId: String(purchase._id),
            declineReason: purchase.declineReason || "",
          },
        });
        await createUserNotification({
          userId: item.authorId,
          type: "marketplace-sale-declined",
          title: "Purchase request declined",
          message: `The purchase request for ${item.title} was declined.`,
          targetType: "marketplace-sale",
          targetId: String(item._id),
          metadata: {
            itemId: String(item._id),
            title: item.title,
            purchaseId: String(purchase._id),
            declineReason: purchase.declineReason || "",
          },
        });
      }
      await item.save();
      return res.json({
        success: true,
        message:
          nextStatus === "approved"
            ? String(item.listingKind || "sale") === "template"
              ? "Purchase approved and added to the buyer's templates."
              : "Purchase approved and transferred to the buyer."
            : "Purchase request declined.",
        item: buildMarketplacePublicItem(item.toObject()),
        transfer,
        template: grantedTemplate,
      });
    } catch (error) {
      console.error("Admin marketplace purchase update failed:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Could not update marketplace purchase.",
      });
    }
  },
);

app.post(
  "/api/github/verify-render-hosting",
  express.json(),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res
        .status(401)
        .json({ success: false, message: "You need to sign in first." });
    }

    try {
      const filename = String(req.body?.filename || "").trim();
      const normalizedRenderUrl = normalizeRenderUrl(req.body?.renderUrl || "");
      if (!filename || !normalizedRenderUrl) {
        return res.status(400).json({
          success: false,
          message: "Project file and Render URL are required.",
        });
      }

      const user = await User.findById(req.user._id);
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found." });
      }

      user.liveProjects = Array.isArray(user.liveProjects)
        ? user.liveProjects
        : [];
      const projectIndex = user.liveProjects.findIndex(
        (item) =>
          String(item?.fileName || item?.filename || "").trim() === filename,
      );
      if (projectIndex < 0) {
        return res.status(404).json({
          success: false,
          message: "Live project not found for Render verification.",
        });
      }

      let response;
      try {
        response = await fetch(normalizedRenderUrl, {
          method: "GET",
          redirect: "follow",
          headers: { "User-Agent": "MediaLab-Render-Verify" },
        });
      } catch (error) {
        return res.status(400).json({
          success: false,
          message:
            "Render URL could not be reached yet. Finish hosting and try verify again.",
        });
      }

      if (response.status >= 400) {
        return res.status(400).json({
          success: false,
          message: `Render site responded with ${response.status}. Publish it on Render first, then verify again.`,
        });
      }

      const project = user.liveProjects[projectIndex];
      project.renderUrl = normalizedRenderUrl;
      project.renderHostedConfirmed = true;
      project.renderVerifiedAt = new Date();
      project.updatedAt = new Date();

      if (!user.confirmedFirstHosting) {
        user.confirmedFirstHosting = true;
        user.firstHostingConfirmedAt = new Date();
      }

      await user.save();
      req.user.liveProjects = user.liveProjects;

      await createUsageLog({
        user,
        email: user.email,
        name: user.name,
        isPro: Boolean(user.isPro),
        action: "render-hosting-verified",
        summary: `verified Render hosting for ${filename}`,
        source: "render",
        metadata: { filename, renderUrl: normalizedRenderUrl },
      });

      return res.json({
        success: true,
        message: "Render hosting verified successfully.",
        project: user.liveProjects[projectIndex],
        user: toSafeUser(user),
      });
    } catch (error) {
      console.error("Render hosting verification failed:", error);
      return res.status(500).json({
        success: false,
        message: error?.message || "Could not verify Render hosting right now.",
      });
    }
  },
);

app.post(
  "/api/projects/update-deploy-info",
  express.json(),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({
        success: false,
        message: "You need to sign in before saving deployment details.",
      });
    }

    try {
      const projectId = String(
        req.body?.projectId || req.body?.filename || "",
      ).trim();
      const rawServiceId = String(req.body?.serviceId || "").trim();
      const rawLiveUrl = String(
        req.body?.liveUrl || req.body?.renderUrl || "",
      ).trim();

      if (!projectId) {
        return res
          .status(400)
          .json({ success: false, message: "Missing project identifier." });
      }
      if (!rawLiveUrl) {
        return res.status(400).json({
          success: false,
          message: "Paste the Render live URL first.",
        });
      }
      if (rawServiceId && !/^srv-[a-z0-9]+$/i.test(rawServiceId)) {
        return res.status(400).json({
          success: false,
          message: "Render Service ID must start with srv-.",
        });
      }

      let normalizedLiveUrl = normalizeRenderUrl(rawLiveUrl);
      let parsedLiveUrl;
      try {
        parsedLiveUrl = new URL(normalizedLiveUrl);
      } catch {
        return res.status(400).json({
          success: false,
          message: "Use a valid Render URL ending in .onrender.com.",
        });
      }

      if (!/\.onrender\.com$/i.test(parsedLiveUrl.hostname)) {
        return res.status(400).json({
          success: false,
          message: "Use the final Render URL ending in .onrender.com.",
        });
      }

      const renderBaseUrl = `${parsedLiveUrl.protocol}//${parsedLiveUrl.host}`;

      let response;
      try {
        response = await fetch(normalizedLiveUrl, {
          method: "GET",
          redirect: "follow",
          headers: { "User-Agent": "MediaLab-Render-Deploy-Verify" },
        });
      } catch (error) {
        return res.status(400).json({
          success: false,
          message:
            "Render URL could not be reached yet. Finish deployment on Render and try again.",
        });
      }

      if (response.status >= 400) {
        return res.status(400).json({
          success: false,
          message: `Render site responded with ${response.status}. Wait for deploy to finish, then verify again.`,
        });
      }

      const user = await User.findById(req.user._id);
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found." });
      }

      user.liveProjects = Array.isArray(user.liveProjects)
        ? user.liveProjects
        : [];
      const projectIndex = user.liveProjects.findIndex(
        (item) =>
          String(item?.fileName || item?.filename || "").trim() === projectId,
      );
      if (projectIndex < 0) {
        return res
          .status(404)
          .json({ success: false, message: "Live project not found." });
      }

      const project = user.liveProjects[projectIndex];
      project.renderUrl = renderBaseUrl;
      if (rawServiceId) {
        project.renderServiceId = rawServiceId;
      }
      project.renderDeployStatus = "manual-verified";
      project.renderHostedConfirmed = true;
      project.renderVerifiedAt = new Date();
      project.updatedAt = new Date();

      if (!user.confirmedFirstHosting) {
        user.confirmedFirstHosting = true;
        user.firstHostingConfirmedAt = new Date();
      }

      await user.save();
      req.user.liveProjects = user.liveProjects;

      await createUsageLog({
        user,
        email: user.email,
        name: user.name,
        isPro: Boolean(user.isPro),
        action: "render-hosting-saved",
        summary: `saved Render deployment info for ${projectId}`,
        source: "render",
        metadata: {
          projectId,
          serviceId: rawServiceId,
          renderUrl: renderBaseUrl,
        },
      });

      return res.json({
        success: true,
        message: "Render deployment details saved successfully.",
        project,
        user: toSafeUser(user),
      });
    } catch (error) {
      console.error("Saving Render deployment info failed:", error);
      return res.status(500).json({
        success: false,
        message:
          error?.message || "Could not save Render deployment info right now.",
      });
    }
  },
);

app.post("/api/projects/sync-render-id", express.json(), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({
      success: false,
      message: "You need to sign in before saving deployment details.",
    });
  }

  try {
    const projectId = String(req.body?.projectId || "").trim();
    const serviceId = String(req.body?.serviceId || "").trim();
    if (!projectId || !/^srv-[a-z0-9]+$/i.test(serviceId)) {
      return res.status(400).json({
        success: false,
        message: "A valid Render service ID is required.",
      });
    }
    const user = await User.findById(req.user._id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    user.liveProjects = Array.isArray(user.liveProjects)
      ? user.liveProjects
      : [];
    const projectIndex = user.liveProjects.findIndex(
      (item) =>
        String(item?.fileName || item?.filename || "").trim() === projectId,
    );
    if (projectIndex < 0) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found." });
    }
    const project = user.liveProjects[projectIndex];
    project.renderServiceId = serviceId;
    project.renderDeployStatus = project.renderDeployStatus || "deploying";
    project.updatedAt = new Date();
    await user.save();
    req.user.liveProjects = user.liveProjects;
    return res.json({
      success: true,
      message: "Render service ID synced.",
      project,
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("Render service ID sync failed:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Could not sync this Render service ID.",
    });
  }
});

app.post(
  "/api/render/deploy",
  publishRateLimit,
  express.json(),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res
        .status(401)
        .json({ success: false, message: "You need to sign in first." });
    }

    try {
      const filename = String(req.body?.filename || "").trim();
      const clientName = String(
        req.body?.clientName || req.user?.name || "client",
      ).trim();
      const repoUrl = String(req.body?.repoUrl || "").trim();
      const branch = String(req.body?.branch || "main").trim() || "main";
      if (!filename || !repoUrl) {
        return res.status(400).json({
          success: false,
          message: "Project filename and repository URL are required.",
        });
      }

      const user = await User.findById(req.user._id);
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found." });
      }

      user.liveProjects = Array.isArray(user.liveProjects)
        ? user.liveProjects
        : [];
      const projectIndex = findLiveProjectIndex(user, filename);
      if (projectIndex < 0) {
        return res
          .status(404)
          .json({ success: false, message: "Live project not found." });
      }

      const deployment = await createRenderBlueprintInstance({
        clientName,
        repoUrl,
        branch,
      });

      const project = user.liveProjects[projectIndex];
      project.renderRepoUrl = repoUrl;
      project.renderServiceName = deployment.serviceName;
      project.renderBlueprintId = String(
        deployment.data?.id || deployment.data?.blueprintId || "",
      ).trim();
      project.renderDeployStatus = "deploying";
      project.updatedAt = new Date();

      await user.save();
      req.user.liveProjects = user.liveProjects;

      await createUsageLog({
        user,
        email: user.email,
        name: user.name,
        isPro: Boolean(user.isPro),
        action: "render-blueprint-created",
        summary: `started Render deployment for ${filename}`,
        source: "render",
        metadata: {
          filename,
          repoUrl,
          serviceName: deployment.serviceName,
          blueprintId: project.renderBlueprintId,
        },
      });

      return res.json({
        success: true,
        message: "Render deployment started.",
        serviceName: deployment.serviceName,
        blueprintId: project.renderBlueprintId,
        renderYaml: deployment.renderYaml,
        project,
        user: toSafeUser(user),
      });
    } catch (error) {
      console.error("Render auto deploy failed:", error);
      return res.status(500).json({
        success: false,
        message:
          error?.message || "Could not start Render deployment right now.",
      });
    }
  },
);

app.post("/api/deploy-status", express.json(), async (req, res) => {
  try {
    const event = extractRenderDeploySuccessPayload(req.body || {});
    if (!event) {
      return res.json({ success: true, ignored: true });
    }

    const user = await User.findOne({
      "liveProjects.renderServiceName": event.serviceName,
    });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No MediaLab project matched that Render service.",
      });
    }

    user.liveProjects = Array.isArray(user.liveProjects)
      ? user.liveProjects
      : [];
    const project = user.liveProjects.find(
      (item) =>
        String(item?.renderServiceName || "").trim() === event.serviceName,
    );
    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Matched user found, but project record is missing.",
      });
    }

    project.renderUrl = normalizeRenderUrl(event.serviceUrl);
    project.renderServiceId = event.serviceId;
    project.renderDeployStatus = "deploy.succeeded";
    project.renderHostedConfirmed = true;
    project.renderVerifiedAt = new Date();
    project.updatedAt = new Date();

    if (!user.confirmedFirstHosting) {
      user.confirmedFirstHosting = true;
      user.firstHostingConfirmedAt = new Date();
    }

    await user.save();

    await createUsageLog({
      user,
      email: user.email,
      name: user.name,
      isPro: Boolean(user.isPro),
      action: "render-deploy-succeeded",
      summary: `Render deployment succeeded for ${project.fileName || event.serviceName}`,
      source: "render",
      metadata: {
        serviceId: event.serviceId,
        serviceName: event.serviceName,
        renderUrl: project.renderUrl,
      },
    });

    return res.json({
      success: true,
      message: "Deployment status synced.",
      serviceId: event.serviceId,
      serviceName: event.serviceName,
      renderUrl: project.renderUrl,
    });
  } catch (error) {
    console.error("Render deploy status sync failed:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Could not process deployment status.",
    });
  }
});

app.post("/api/adsense/link-site", express.json(), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const submittedDomain = String(req.body?.domainName || "")
      .trim()
      .toLowerCase();
    const liveProjectUrl = normalizeRenderUrl(req.body?.liveProjectUrl || "");
    const domainName =
      submittedDomain || extractDomainNameFromUrl(liveProjectUrl);
    if (!domainName) {
      return res.status(400).json({
        success: false,
        message: "Enter your project domain first.",
      });
    }

    const user = await User.findById(req.user._id).select(
      "+googleRefreshToken +adsenseAdCode",
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    if (!user.googleRefreshToken) {
      return res.status(400).json({
        success: false,
        requiresGoogleReconnect: true,
        message:
          "Reconnect Google first so MediaLab can read your AdSense data.",
      });
    }
    const allowedDomains = collectHostedProjectDomains(user);
    if (!allowedDomains.includes(domainName)) {
      return res.status(403).json({
        success: false,
        message:
          "That domain is not recognized as one of your MediaLab hosted project domains.",
      });
    }
    const auth = getAdsenseOAuthClient(user);
    const adsense = google.adsense({ version: "v2", auth });
    const accountsResponse = await adsense.accounts.list();
    const accounts = accountsResponse.data?.accounts || [];

    let matchedAccount = null;
    let matchedSite = null;
    for (const account of accounts) {
      const sitesResponse = await adsense.accounts.sites.list({
        parent: account.name,
        pageSize: 200,
      });
      const sites = sitesResponse.data?.sites || [];
      matchedSite = sites.find((site) => {
        const siteUrl =
          site.siteUrl ||
          site.url ||
          site.domain ||
          site.reportingDimensionId ||
          "";
        const siteDomain =
          extractDomainNameFromUrl(siteUrl) || String(siteUrl).trim();
        return siteDomain === domainName;
      });
      if (matchedSite) {
        matchedAccount = account;
        break;
      }
    }

    if (!matchedAccount || !matchedSite) {
      return res.status(404).json({
        success: false,
        message:
          "We couldn't find this domain in your AdSense account. Make sure you've added it in your AdSense dashboard under Sites.",
        domainName,
        suggestedDomainUrl: liveProjectUrl || `https://${domainName}`,
      });
    }

    const adClientsResponse = await adsense.accounts.adclients.list({
      parent: matchedAccount.name,
      pageSize: 50,
    });
    const adClients = adClientsResponse.data?.adClients || [];
    const matchedAdClient =
      adClients.find((client) =>
        String(client.productCode || "")
          .toUpperCase()
          .includes("AFC"),
      ) ||
      adClients[0] ||
      null;

    let adCode = "";
    if (matchedAdClient?.name) {
      const adCodeResponse = await adsense.accounts.adclients.getAdcode({
        name: matchedAdClient.name,
      });
      adCode = String(adCodeResponse.data?.adCode || "").trim();
    }

    const adsenseIdMatch = adCode.match(/ca-pub-\d+/i);
    if (adsenseIdMatch?.[0]) {
      user.adsenseId = normalizeAdsensePublisherId(adsenseIdMatch[0]);
    }
    user.adsenseAccountName = matchedAccount.name || "";
    user.adsenseSiteUrl =
      matchedSite.siteUrl ||
      matchedSite.url ||
      matchedSite.domain ||
      domainName;
    user.adsenseSiteStatus =
      matchedSite.state || matchedSite.status || matchedSite.platformType || "";
    user.adsenseLastCheckedAt = new Date();
    user.adsenseApprovedAt =
      normalizeAdsenseReviewState(user.adsenseSiteStatus) === "approved"
        ? new Date()
        : null;
    if (adCode) {
      user.adsenseAdCode = adCode;
    }
    await user.save();
    const siteState = String(user.adsenseSiteStatus || "").toUpperCase();
    const reviewPending =
      siteState === "REQUIRES_REVIEW" || siteState === "GETTING_READY";
    await createUserNotification({
      userId: user._id,
      type: reviewPending ? "adsense-review" : "adsense-linked",
      title: reviewPending
        ? "AdSense verification started"
        : "AdSense connected",
      message: reviewPending
        ? "Google is reviewing your AdSense site. MediaLab will keep checking the status for you."
        : "Your AdSense account is linked and ready for monetization checks.",
      targetType: "console",
      metadata: {
        siteStatus: user.adsenseSiteStatus || "",
        siteUrl: user.adsenseSiteUrl || "",
        adsenseId: user.adsenseId || "",
      },
    });

    let adsTxtDetected = false;
    for (const candidateUrl of buildAdsTxtCandidateUrls(user)) {
      try {
        const response = await fetch(candidateUrl, {
          method: "GET",
          redirect: "follow",
          headers: { "User-Agent": "MediaLab-AdsTxt-Verify" },
        });
        if (response.status < 400) {
          adsTxtDetected = true;
          break;
        }
      } catch {}
    }

    return res.json({
      success: true,
      message: `Success! We found your AdSense account ${user.adsenseId || ""}.`,
      accountName: user.adsenseAccountName,
      adsenseId: user.adsenseId,
      siteUrl: user.adsenseSiteUrl,
      siteStatus: user.adsenseSiteStatus,
      checklist: {
        scriptInjectedAutomatic: Boolean(user.adsenseAdCode || user.adsenseId),
        adsTxtDetected,
        googleReviewPending: reviewPending,
      },
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("AdSense link-site failed:", error);
    return res.status(500).json({
      success: false,
      message:
        error?.response?.data?.error?.message ||
        error?.message ||
        "Could not link your AdSense site right now.",
    });
  }
});

app.post("/api/github/monetize-project", express.json(), async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }
  try {
    const filename = String(req.body?.filename || "").trim();
    if (!filename) {
      return res
        .status(400)
        .json({ success: false, message: "Missing project filename." });
    }
    const user = await User.findById(req.user._id).select(
      "+githubToken +adsenseAdCode",
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    if (!user.githubUsername || !user.githubToken) {
      return res
        .status(400)
        .json({ success: false, message: "Connect GitHub first." });
    }
    if (!user.adsenseId && !user.adsenseAdCode) {
      return res.status(400).json({
        success: false,
        message: "Link your AdSense domain first before monetizing a project.",
      });
    }
    if (!user.adsenseApprovedAt) {
      return res.status(400).json({
        success: false,
        message:
          "Google hasn't approved your AdSense request yet. Please check the status in Console before monetizing this page.",
      });
    }

    user.liveProjects = Array.isArray(user.liveProjects)
      ? user.liveProjects
      : [];
    const projectIndex = user.liveProjects.findIndex(
      (item) =>
        String(item?.fileName || item?.filename || "").trim() === filename,
    );
    if (projectIndex < 0) {
      return res
        .status(404)
        .json({ success: false, message: "Live project not found." });
    }
    const project = user.liveProjects[projectIndex];
    const octokit = buildGithubClient(user);
    const contentResponse = await octokit.rest.repos.getContent({
      owner: user.githubUsername,
      repo: project.repo || getUserGithubRepoName(user),
      path: filename,
    });
    if (Array.isArray(contentResponse.data) || !contentResponse.data?.content) {
      return res.status(400).json({
        success: false,
        message:
          "That project entry file could not be monetized automatically.",
      });
    }
    const sourceHtml = Buffer.from(
      contentResponse.data.content,
      "base64",
    ).toString("utf8");
    const monetizedHtml = buildPublishedHtmlFromSource({
      documentHtml: sourceHtml,
      projectName: project.name || "MediaLab Project",
      adsenseId: user.adsenseId || "",
      adsenseAdCode: user.adsenseAdCode || "",
    });
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: user.githubUsername,
      repo: project.repo || getUserGithubRepoName(user),
      path: filename,
      sha: contentResponse.data.sha,
      message: `Enable monetization for ${filename} from MediaLab`,
      content: Buffer.from(monetizedHtml, "utf8").toString("base64"),
    });

    project.monetizationEnabled = true;
    project.isMonetized = true;
    project.adDisabledPages = [];
    project.monetizationDisabledAt = null;
    project.monetizationVerifiedAt = new Date();
    project.adsensePublisherId = user.adsenseId || "";
    project.updatedAt = new Date();
    await user.save();

    return res.json({
      success: true,
      message: "Project monetization enabled.",
      project,
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("Project monetization failed:", error);
    return res.status(500).json({
      success: false,
      message:
        error?.message || "Could not enable monetization for this project.",
    });
  }
});

app.post(
  "/api/projects/:id/toggle-monetization",
  express.json(),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res
        .status(401)
        .json({ success: false, message: "You need to sign in first." });
    }

    try {
      const projectId = decodeURIComponent(String(req.params?.id || "").trim());
      if (!projectId) {
        return res
          .status(400)
          .json({ success: false, message: "Missing project id." });
      }

      const user = await User.findById(req.user._id).select(
        "+githubToken +adsenseAdCode",
      );
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found." });
      }
      if (!user.githubUsername || !user.githubToken) {
        return res
          .status(400)
          .json({ success: false, message: "Connect GitHub first." });
      }

      user.liveProjects = Array.isArray(user.liveProjects)
        ? user.liveProjects
        : [];
      const projectIndex = user.liveProjects.findIndex(
        (item) =>
          String(item?.fileName || item?.filename || "").trim() === projectId,
      );
      if (projectIndex < 0) {
        return res
          .status(404)
          .json({ success: false, message: "Live project not found." });
      }

      const project = user.liveProjects[projectIndex];
      if (!project.monetizationEnabled && !project.isMonetized) {
        return res.status(400).json({
          success: false,
          message:
            "Activate monetization for this project first before using the ad toggle.",
        });
      }

      const entryPath = String(
        project.fileName || project.filename || "",
      ).trim();
      if (!entryPath) {
        return res
          .status(400)
          .json({ success: false, message: "Project entry file is missing." });
      }

      const octokit = buildGithubClient(user);
      const contentResponse = await octokit.rest.repos.getContent({
        owner: user.githubUsername,
        repo: project.repo || getUserGithubRepoName(user),
        path: entryPath,
      });
      if (
        Array.isArray(contentResponse.data) ||
        !contentResponse.data?.content
      ) {
        return res.status(400).json({
          success: false,
          message:
            "That project entry file could not be updated for monetization.",
        });
      }

      const sourceHtml = Buffer.from(
        contentResponse.data.content,
        "base64",
      ).toString("utf8");
      const nextIsMonetized = !Boolean(project.isMonetized);
      const cleanedHtml = stripAdsenseFromHtml(sourceHtml);
      const nextHtml = nextIsMonetized
        ? buildPublishedHtmlFromSource({
            documentHtml: cleanedHtml,
            projectName: project.name || "MediaLab Project",
            adsenseId: user.adsenseId || "",
            adsenseAdCode: user.adsenseAdCode || "",
          })
        : cleanedHtml;

      await octokit.rest.repos.createOrUpdateFileContents({
        owner: user.githubUsername,
        repo: project.repo || getUserGithubRepoName(user),
        path: entryPath,
        sha: contentResponse.data.sha,
        message: `${nextIsMonetized ? "Enable" : "Disable"} monetization for ${entryPath} from MediaLab`,
        content: Buffer.from(nextHtml, "utf8").toString("base64"),
      });

      const disabledPageKey = String(
        project.entryPath || project.fileName || project.filename || "",
      ).trim();
      project.isMonetized = nextIsMonetized;
      project.adDisabledPages = Array.isArray(project.adDisabledPages)
        ? project.adDisabledPages
        : [];
      if (nextIsMonetized) {
        project.adDisabledPages = project.adDisabledPages.filter(
          (item) => String(item || "").trim() !== disabledPageKey,
        );
        project.monetizationDisabledAt = null;
      } else {
        if (
          disabledPageKey &&
          !project.adDisabledPages.includes(disabledPageKey)
        ) {
          project.adDisabledPages.push(disabledPageKey);
        }
        project.monetizationDisabledAt = new Date();
      }
      project.updatedAt = new Date();
      await user.save();

      await createUsageLog({
        ...buildUsageIdentity(req),
        action: nextIsMonetized
          ? "project-monetization-on"
          : "project-monetization-off",
        summary: nextIsMonetized
          ? `enabled ad revenue on ${project.name || entryPath}`
          : `disabled ad revenue on ${project.name || entryPath}`,
        source: "adsense",
        metadata: {
          projectId,
          entryPath,
          isMonetized: nextIsMonetized,
          disabledAt: nextIsMonetized ? null : project.monetizationDisabledAt,
        },
      });

      return res.json({
        success: true,
        isMonetized: nextIsMonetized,
        message: nextIsMonetized
          ? "Ads are now live for this project."
          : "Ads are now turned off for this project.",
        project,
        user: toSafeUser(user),
      });
    } catch (error) {
      console.error("Project monetization toggle failed:", error);
      return res.status(error?.status || error?.response?.status || 500).json({
        success: false,
        message:
          error?.message || "Could not update project monetization right now.",
      });
    }
  },
);

app.post("/api/adsense/sync-status", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }
  try {
    const user = await User.findById(req.user._id).select(
      "+googleRefreshToken",
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    const sync = await refreshAdsenseSiteStatusIfNeeded(user, {
      force: Boolean(req.body?.force),
    });
    return res.json({
      success: true,
      siteStatus: sync.siteStatus,
      reviewState: sync.reviewState,
      lastCheckedAt: sync.lastCheckedAt,
      approvedAt: sync.approvedAt,
      changed: sync.changed,
      user: toSafeUser(user),
    });
  } catch (error) {
    console.warn("AdSense sync-status skipped:", error.message);
    return res.status(500).json({
      success: false,
      message: error?.message || "Could not sync AdSense status right now.",
    });
  }
});

app.post("/api/adsense/disconnect", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }
  try {
    const user = await User.findById(req.user._id).select(
      "+googleRefreshToken +adsenseAdCode",
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    user.adsenseId = "";
    user.adsenseAccountName = "";
    user.adsenseSiteUrl = "";
    user.adsenseSiteStatus = "";
    user.adsenseLastCheckedAt = null;
    user.adsenseApprovedAt = null;
    user.googleRefreshToken = "";
    user.adsenseAdCode = "";
    user.liveProjects = (user.liveProjects || []).map((project) => ({
      ...project,
      adsensePublisherId: "",
      monetizationEnabled: false,
      isMonetized: false,
      monetizationVerifiedAt: null,
    }));

    await user.save();
    req.user.adsenseId = "";
    req.user.adsenseAccountName = "";
    req.user.adsenseSiteUrl = "";
    req.user.adsenseSiteStatus = "";
    req.user.adsenseLastCheckedAt = null;
    req.user.adsenseApprovedAt = null;

    return res.json({
      success: true,
      message: "AdSense account removed from MediaLab.",
      user: toSafeUser(user),
    });
  } catch (error) {
    console.error("AdSense disconnect failed:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Could not remove AdSense right now.",
    });
  }
});

app.get("/api/adsense/report", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const user = await User.findById(req.user._id).select(
      "+googleRefreshToken",
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }
    let adsenseSync = null;
    try {
      adsenseSync = await refreshAdsenseSiteStatusIfNeeded(user);
    } catch (error) {
      console.warn("AdSense status refresh skipped:", error.message);
    }

    const targetUrl =
      String(req.query?.url || "").trim() ||
      String(
        user.liveProjects?.find((project) => project?.renderHostedConfirmed)
          ?.renderUrl ||
          user.liveProjects?.[0]?.renderUrl ||
          user.liveProjects?.[0]?.liveUrl ||
          user.liveProjects?.[0]?.url ||
          "",
      ).trim();
    const domainName = extractDomainNameFromUrl(targetUrl);
    if (!user.googleRefreshToken) {
      return res.json({
        success: true,
        connected: false,
        stats: null,
        domains: [],
        message: "Connect AdSense for real-time stats.",
        siteStatus: String(user.adsenseSiteStatus || "").trim(),
        reviewState:
          adsenseSync?.reviewState ||
          normalizeAdsenseReviewState(user.adsenseSiteStatus || ""),
        lastCheckedAt: user.adsenseLastCheckedAt || null,
        approvedAt: user.adsenseApprovedAt || null,
      });
    }

    const domains = collectHostedDomains(user.liveProjects || []);
    if (!domains.length) {
      return res.json({
        success: true,
        connected: true,
        stats: {
          estimatedEarnings: 0,
          impressions: 0,
          pageViewsRpm: 0,
          clicks: 0,
        },
        domains: [],
        message:
          "Publish and host a project first to start matching AdSense domains.",
        siteStatus: String(user.adsenseSiteStatus || "").trim(),
        reviewState:
          adsenseSync?.reviewState ||
          normalizeAdsenseReviewState(user.adsenseSiteStatus || ""),
        lastCheckedAt: user.adsenseLastCheckedAt || null,
        approvedAt: user.adsenseApprovedAt || null,
      });
    }

    const auth = getAdsenseOAuthClient(user);
    const adsense = google.adsense({ version: "v2", auth });
    const accountResponse = await adsense.accounts.list({ pageSize: 1 });
    const accountName = accountResponse.data?.accounts?.[0]?.name;
    if (!accountName) {
      return res.json({
        success: true,
        connected: true,
        stats: {
          estimatedEarnings: 0,
          impressions: 0,
          pageViewsRpm: 0,
          clicks: 0,
        },
        domains,
        message:
          "No AdSense account was returned for this Google connection yet.",
        siteStatus: String(user.adsenseSiteStatus || "").trim(),
        reviewState:
          adsenseSync?.reviewState ||
          normalizeAdsenseReviewState(user.adsenseSiteStatus || ""),
        lastCheckedAt: user.adsenseLastCheckedAt || null,
        approvedAt: user.adsenseApprovedAt || null,
      });
    }

    const metrics = [
      "ESTIMATED_EARNINGS",
      "IMPRESSIONS",
      "PAGE_VIEWS_RPM",
      "CLICKS",
    ];

    const aggregate = {
      estimatedEarnings: 0,
      impressions: 0,
      pageViewsRpm: 0,
      clicks: 0,
    };
    let rpmSamples = 0;

    const requestedDomains = domainName ? [domainName] : domains.slice(0, 10);

    for (const domain of requestedDomains) {
      const report = await adsense.accounts.reports.generate({
        account: accountName,
        dateRange: "LAST_7_DAYS",
        dimensions: ["DOMAIN_NAME"],
        metrics,
        filters: [`DOMAIN_NAME==${domain}`],
        languageCode: "en",
        limit: 1,
      });

      const totals =
        report.data?.totals?.cells || report.data?.rows?.[0]?.cells || [];
      const metricCells = totals.slice(-metrics.length);
      if (metricCells.length < metrics.length) continue;

      aggregate.estimatedEarnings += Number(metricCells[0]?.value || 0);
      aggregate.impressions += Number(metricCells[1]?.value || 0);
      aggregate.pageViewsRpm += Number(metricCells[2]?.value || 0);
      aggregate.clicks += Number(metricCells[3]?.value || 0);
      rpmSamples += 1;
    }

    if (rpmSamples > 0) {
      aggregate.pageViewsRpm = aggregate.pageViewsRpm / rpmSamples;
    }

    return res.json({
      success: true,
      connected: true,
      hasDomain: Boolean(domainName),
      domainName: domainName || "",
      stats: {
        estimatedEarnings: Number(aggregate.estimatedEarnings.toFixed(2)),
        impressions: Math.round(aggregate.impressions),
        pageViewsRpm: Number(aggregate.pageViewsRpm.toFixed(2)),
        clicks: Math.round(aggregate.clicks),
      },
      report: {
        estimatedEarnings: Number(aggregate.estimatedEarnings.toFixed(2)),
        impressions: Math.round(aggregate.impressions),
        pageViewsRpm: Number(aggregate.pageViewsRpm.toFixed(2)),
        clicks: Math.round(aggregate.clicks),
      },
      domains: requestedDomains,
      accountName,
      message: "Real-time AdSense stats loaded.",
      siteStatus: String(user.adsenseSiteStatus || "").trim(),
      reviewState:
        adsenseSync?.reviewState ||
        normalizeAdsenseReviewState(user.adsenseSiteStatus || ""),
      lastCheckedAt: user.adsenseLastCheckedAt || null,
      approvedAt: user.adsenseApprovedAt || null,
    });
  } catch (error) {
    console.error("AdSense report fetch failed:", error);
    return res.status(500).json({
      success: false,
      message:
        error?.response?.data?.error?.message ||
        error?.message ||
        "Could not load AdSense stats right now.",
    });
  }
});

app.get("/api/adsense/withdrawal-eligibility", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const user = await User.findById(req.user._id).select(
      "+googleRefreshToken",
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    if (!user.googleRefreshToken) {
      return res.json({
        success: true,
        connected: false,
        eligible: false,
        threshold: 100,
        currentBalance: 0,
        progressPercent: 0,
        message: "Connect AdSense first to check payout eligibility.",
      });
    }

    const auth = getAdsenseOAuthClient(user);
    const adsense = google.adsense({ version: "v2", auth });
    const accountResponse = await adsense.accounts.list({ pageSize: 1 });
    const accountName = accountResponse.data?.accounts?.[0]?.name;
    if (!accountName) {
      return res.json({
        success: true,
        connected: true,
        eligible: false,
        threshold: 100,
        currentBalance: 0,
        progressPercent: 0,
        message:
          "No AdSense account was returned for this Google connection yet.",
      });
    }

    const report = await adsense.accounts.reports.generate({
      account: accountName,
      dateRange: "MONTH_TO_DATE",
      metrics: ["ESTIMATED_EARNINGS"],
      limit: 1,
      languageCode: "en",
    });
    const totals =
      report.data?.totals?.cells || report.data?.rows?.[0]?.cells || [];
    const currentBalance = Number(totals?.[0]?.value || 0);
    const threshold = 100;
    const progressPercent = Math.max(
      0,
      Math.min(100, (currentBalance / threshold) * 100),
    );

    return res.json({
      success: true,
      connected: true,
      eligible: currentBalance >= threshold,
      threshold,
      currentBalance: Number(currentBalance.toFixed(2)),
      progressPercent: Number(progressPercent.toFixed(1)),
      payoutUrl: "https://adsense.google.com/main/payments",
      message:
        currentBalance >= threshold
          ? "Your AdSense revenue is eligible for withdrawal."
          : "Your AdSense revenue has not reached the payout threshold yet.",
    });
  } catch (error) {
    console.error("AdSense withdrawal eligibility failed:", error);
    return res.status(500).json({
      success: false,
      message:
        error?.response?.data?.error?.message ||
        error?.message ||
        "Could not check AdSense payout eligibility right now.",
    });
  }
});

app.get("/api/github/verify-ads-txt", async (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res
      .status(401)
      .json({ success: false, message: "You need to sign in first." });
  }

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    let verified = false;
    let resolvedUrl = "";
    for (const candidateUrl of buildAdsTxtCandidateUrls(user)) {
      try {
        const response = await fetch(candidateUrl, {
          method: "GET",
          redirect: "follow",
          headers: { "User-Agent": "MediaLab-AdsTxt-Verify" },
        });
        if (response.status < 400) {
          verified = true;
          resolvedUrl = candidateUrl;
          break;
        }
      } catch {}
    }
    if (!resolvedUrl) {
      resolvedUrl = buildAdsTxtCandidateUrls(user)[0] || "";
    }

    return res.json({
      success: true,
      verified,
      url: resolvedUrl,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Could not verify ads.txt right now.",
    });
  }
});

app.post(
  "/api/github/upload-ads-txt",
  githubSettingsUpload.single("adsFile"),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res
        .status(401)
        .json({ success: false, message: "You need to sign in first." });
    }

    try {
      const user = await User.findById(req.user._id).select("+githubToken");
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found." });
      }
      if (
        !user.githubUsername ||
        !user.githubToken ||
        !user.githubRepoCreated
      ) {
        return res.status(400).json({
          success: false,
          message: "Set up GitHub hosting first before uploading ads.txt.",
        });
      }

      const nextAdsenseId = normalizeAdsensePublisherId(
        req.body?.adsenseId || user.adsenseId || "",
      );
      if (nextAdsenseId && !/^ca-pub-\d+$/i.test(nextAdsenseId)) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid Google AdSense publisher ID.",
        });
      }
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Upload the ads.txt file from Google first.",
        });
      }

      const octokit = buildGithubClient(user);
      let existingSha = "";
      try {
        const existing = await octokit.rest.repos.getContent({
          owner: user.githubUsername,
          repo: getUserGithubRepoName(user),
          path: "ads.txt",
        });
        if (!Array.isArray(existing.data) && existing.data?.sha) {
          existingSha = existing.data.sha;
        }
      } catch (error) {
        if ((error?.status || error?.response?.status) !== 404) throw error;
      }

      await octokit.rest.repos.createOrUpdateFileContents({
        owner: user.githubUsername,
        repo: getUserGithubRepoName(user),
        path: "ads.txt",
        message: `${existingSha ? "Update" : "Upload"} ads.txt from MediaLab`,
        content: req.file.buffer.toString("base64"),
        ...(existingSha ? { sha: existingSha } : {}),
      });

      user.adsenseId = nextAdsenseId;
      await user.save();
      req.user.adsenseId = user.adsenseId;

      return res.json({
        success: true,
        message: "ads.txt uploaded to your medialab repository.",
        user: toSafeUser(user),
        adsTxtUrl: buildAdsTxtCandidateUrls(user)[0] || "",
      });
    } catch (error) {
      console.error("GitHub ads.txt upload failed:", error);
      return res.status(error?.status || error?.response?.status || 500).json({
        success: false,
        message:
          error?.response?.data?.message ||
          error?.message ||
          "Could not upload ads.txt right now.",
      });
    }
  },
);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file)
    return res.status(400).json({ success: false, message: "No file" });
  res.json({ success: true, filename: req.file.filename });
});

app.post("/api/community-feedback", async (req, res) => {
  try {
    const rating = Number(req.body?.rating || 0);
    const feedbackText = String(req.body?.feedback || "").trim();

    if (!rating || rating < 1 || rating > 5) {
      return res
        .status(400)
        .json({ success: false, message: "Rating must be between 1 and 5." });
    }
    if (!feedbackText) {
      return res
        .status(400)
        .json({ success: false, message: "Feedback message is required." });
    }

    const isLoggedIn = Boolean(req.user);
    const record = await Feedback.create({
      userId: isLoggedIn ? req.user._id : null,
      username: isLoggedIn ? req.user.name || "MediaLab User" : "Anonymous",
      email: isLoggedIn ? req.user.email || "" : "",
      rating,
      feedback: feedbackText,
      source: String(req.body?.source || "web-builder"),
      isAnonymous: !isLoggedIn,
      status: "open",
      hidden: false,
    });

    if (req.user?._id) {
      await User.findByIdAndUpdate(req.user._id, {
        $set: {
          feedbackPromptLastShownAt: new Date(),
          feedbackPromptLastSubmittedAt: new Date(),
        },
      });
    }
    await createUsageLog({
      ...buildUsageIdentity(req),
      action: "feedback-submitted",
      summary: "submitted community feedback",
      source: "community-feedback",
      metadata: { rating, feedbackId: record._id },
    });

    res.json({
      success: true,
      message: "Feedback saved successfully.",
      feedbackId: record._id,
    });
  } catch (error) {
    console.error("Feedback save failed:", error);
    res
      .status(500)
      .json({ success: false, message: "Could not save feedback right now." });
  }
});

app.post("/api/upgrade-request", async (req, res) => {
  try {
    const isLoggedIn = Boolean(req.user);
    const fallbackName = isLoggedIn ? req.user.name || "MediaLab User" : "";
    const fallbackEmail = isLoggedIn ? req.user.email || "" : "";
    const name = String(req.body?.name || fallbackName).trim();
    const email = String(req.body?.email || fallbackEmail)
      .trim()
      .toLowerCase();
    const requestedFeature = String(
      req.body?.requestedFeature || "MediaLab Pro",
    ).trim();
    const message = String(req.body?.message || "").trim();

    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Name is required." });
    }
    if (!email || !email.includes("@")) {
      return res
        .status(400)
        .json({ success: false, message: "A valid email is required." });
    }

    const activeStatuses = ["pending", "reviewing", "received"];
    const existingRequest = await UpgradeRequest.findOne({
      email,
      status: { $in: activeStatuses },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (existingRequest) {
      return res.json({
        success: true,
        request: existingRequest,
        alreadyPending: true,
        message:
          "Pending. Your premium request is being processed. You'll get feedback within 48 hours.",
      });
    }

    const record = await UpgradeRequest.create({
      userId: isLoggedIn ? req.user._id : null,
      name,
      email,
      requestedFeature,
      source: String(req.body?.source || "studio-upgrade"),
      message,
      status: "pending",
    });
    await createUsageLog({
      ...buildUsageIdentity(req),
      email,
      name,
      isAnonymous: !req.user,
      action: "upgrade-request",
      summary: `requested ${requestedFeature}`,
      source: "upgrade-modal",
      metadata: { requestId: record._id, requestedFeature },
    });
    io.emit("admin:premium-request-updated", record.toObject());

    res.json({
      success: true,
      request: record,
      message:
        "Pending. Your premium request is being processed. You'll get feedback within 48 hours.",
      requestId: record._id,
    });
  } catch (error) {
    console.error("Upgrade request failed:", error);
    res.status(500).json({
      success: false,
      message: "Could not save your upgrade request right now.",
    });
  }
});

app.post("/api/feedback-prompt/shown", async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.json({ success: true });
    }
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { feedbackPromptLastShownAt: new Date() } },
      { new: true },
    );
    return res.json({
      success: true,
      user: user ? toSafeUser(user) : null,
    });
  } catch (error) {
    console.error("Feedback prompt shown sync failed:", error);
    return res.status(500).json({
      success: false,
      message: "Could not sync feedback prompt state right now.",
    });
  }
});

app.get("/api/upgrade-request/status", async (req, res) => {
  try {
    if (!req.user?.email) {
      return res.json({ success: true, request: null });
    }

    const request = await UpgradeRequest.findOne({
      $or: [{ userId: req.user._id }, { email: req.user.email.toLowerCase() }],
    })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, request: request || null });
  } catch (error) {
    console.error("Upgrade request status fetch failed:", error);
    res.status(500).json({
      success: false,
      message: "Could not load upgrade request status.",
    });
  }
});

app.post("/api/account/cancel-premium", async (req, res) => {
  try {
    if (!req.user?._id) {
      return res
        .status(401)
        .json({ success: false, message: "Login required." });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    user.isPro = false;
    await user.save();

    await UpgradeRequest.findOneAndUpdate(
      {
        $or: [
          { userId: req.user._id },
          { email: String(user.email || "").toLowerCase() },
        ],
        status: "granted",
      },
      {
        $set: {
          status: "closed",
          reviewedAt: new Date(),
          reviewedBy: "user-cancelled",
        },
      },
      { sort: { createdAt: -1 } },
    );

    await createUsageLog({
      ...buildUsageIdentity(req),
      action: "premium-cancelled",
      summary: "cancelled premium plan",
      source: "profile",
    });

    res.json({ success: true, isPro: false });
  } catch (error) {
    console.error("Cancel premium failed:", error);
    res
      .status(500)
      .json({ success: false, message: "Could not cancel premium right now." });
  }
});

app.post("/api/account/withdrawals", accountRateLimit, async (req, res) => {
  try {
    if (!req.user?._id) {
      return res
        .status(401)
        .json({ success: false, message: "Login required." });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    const method = String(req.body?.method || "")
      .trim()
      .toLowerCase();
    const amount = Number(req.body?.amount || 0);
    const destination = String(req.body?.destination || "").trim();
    const allowedMethods = ["paypal", "mpesa", "airtel"];

    if (!allowedMethods.includes(method)) {
      return res
        .status(400)
        .json({ success: false, message: "Select a valid withdrawal method." });
    }
    if (!destination) {
      return res
        .status(400)
        .json({ success: false, message: "Payment destination is required." });
    }
    if (!Number.isFinite(amount) || amount < 5) {
      return res
        .status(400)
        .json({ success: false, message: "Minimum withdrawal is $5." });
    }
    if (amount > Number(user.accountBalance || 0)) {
      return res.status(400).json({
        success: false,
        message: "Withdrawal amount exceeds available balance.",
      });
    }

    const now = Date.now();
    const recentLock = user.lastWithdrawalRequestedAt
      ? now - new Date(user.lastWithdrawalRequestedAt).getTime()
      : Number.POSITIVE_INFINITY;
    if (recentLock < 15000) {
      return res.status(429).json({
        success: false,
        message:
          "Please wait a few seconds before submitting another withdrawal.",
      });
    }

    const pendingExisting = await WithdrawalRequest.findOne({
      userId: user._id,
      status: { $in: ["pending", "processing"] },
      createdAt: { $gte: new Date(now - 120000) },
    }).lean();
    if (pendingExisting) {
      return res.status(429).json({
        success: false,
        message:
          "A withdrawal request is already being processed. Please wait.",
      });
    }

    const fee = 0;
    const request = await WithdrawalRequest.create({
      userId: user._id,
      email: user.email,
      name: user.name,
      method,
      destination,
      amount,
      fee,
      status: "pending",
      metadata: {
        provider: user.provider || "unknown",
      },
    });

    user.accountBalance = Number(
      (Number(user.accountBalance || 0) - amount).toFixed(2),
    );
    user.lastWithdrawalRequestedAt = new Date(now);
    await user.save();
    req.user.accountBalance = user.accountBalance;
    req.user.lastWithdrawalRequestedAt = user.lastWithdrawalRequestedAt;
    io.emit("admin:withdrawal-updated", request.toObject());

    await createUsageLog({
      ...buildUsageIdentity(req),
      action: "withdrawal-request",
      summary: `requested ${amount.toFixed(2)} withdrawal via ${method}`,
      source: "account",
      metadata: { withdrawalRequestId: request._id, method, amount },
    });

    res.json({
      success: true,
      message: "Withdrawal request submitted",
      balance: user.accountBalance,
      request,
    });
  } catch (error) {
    console.error("Withdrawal request failed:", error);
    res.status(500).json({
      success: false,
      message: "Could not submit withdrawal request right now.",
    });
  }
});

app.get("/api/account/withdrawals", async (req, res) => {
  try {
    if (!req.user?._id) {
      return res
        .status(401)
        .json({ success: false, message: "Login required." });
    }

    const requests = await WithdrawalRequest.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(25)
      .lean();

    return res.json({
      success: true,
      requests,
      current: requests[0] || null,
    });
  } catch (error) {
    console.error("Withdrawal history fetch failed:", error);
    return res.status(500).json({
      success: false,
      message: "Could not load withdrawal history right now.",
    });
  }
});

app.post(
  "/api/account/suspend",
  accountRateLimit,
  express.json(),
  async (req, res) => {
    if (!req.isAuthenticated() || !req.user?._id) {
      return res
        .status(401)
        .json({ success: false, message: "Login required." });
    }
    try {
      const user = await User.findById(req.user._id).select("+githubToken");
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found." });
      }

      const referralCode = String(req.body?.referralCode || "").trim();
      const reason = String(req.body?.reason || "").trim();
      if (
        !referralCode ||
        referralCode !== String(user.referralCode || "").trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Owner verification failed. Enter the referral code tied to your account.",
        });
      }
      if (reason.length < 6) {
        return res.status(400).json({
          success: false,
          message: "Please tell us why you are suspending your account.",
        });
      }

      const userId = user._id;
      const userEmail = String(user.email || "")
        .trim()
        .toLowerCase();
      const marketplaceItems = await MarketplaceItem.find({
        authorId: userId,
      }).lean();
      const marketplaceItemIds = marketplaceItems.map((item) => item._id);

      for (const item of marketplaceItems) {
        await cleanupMarketplaceStorageArtifacts(item);
      }
      await cleanupStandaloneBuilderTemplatesForUser(userId);
      await MarketplaceItem.deleteMany({ authorId: userId });
      await removeUserParticipationFromMarketplace(userId);
      await BuilderTemplate.deleteMany({ authorId: userId });

      await Notification.deleteMany({
        $or: [
          { userId },
          { targetId: { $in: marketplaceItemIds.map((id) => String(id)) } },
        ],
      });
      await WithdrawalRequest.deleteMany({
        $or: [{ userId }, { email: userEmail }],
      });
      await Download.deleteMany({
        $or: [{ userId }, { email: userEmail }],
      });
      await UsageLog.deleteMany({
        $or: [{ userId }, { email: userEmail }],
      });
      await Feedback.deleteMany({
        $or: [{ userId }, { email: userEmail }],
      });
      await UpgradeRequest.deleteMany({
        $or: [{ userId }, { email: userEmail }],
      });

      await User.updateMany(
        {},
        {
          $pull: {
            sellerRatings: { userId },
            referralRewards: { referredUserId: userId },
          },
        },
      );

      if (user.githubUsername && user.githubToken) {
        try {
          const octokit = buildGithubClient(user);
          const reposToDelete = [
            getUserGithubRepoName(user),
            "marketplace",
          ].filter(Boolean);
          for (const repoName of [...new Set(reposToDelete)]) {
            try {
              await deleteGithubRepoIfExists(
                octokit,
                user.githubUsername,
                repoName,
              );
            } catch (repoError) {
              console.warn(
                `GitHub repo cleanup skipped for ${repoName}:`,
                repoError.message,
              );
            }
          }
        } catch (githubError) {
          console.warn("GitHub account cleanup skipped:", githubError.message);
        }
      }

      await User.deleteOne({ _id: userId });

      const finish = () =>
        res.json({
          success: true,
          message: "Your MediaLab account has been suspended and removed.",
        });

      req.logout((logoutError) => {
        if (logoutError) {
          console.error("Account suspension logout failed:", logoutError);
          return finish();
        }
        if (req.session) {
          delete req.session.githubOAuthState;
          delete req.session.githubOAuthUserId;
          delete req.session.googleAuthMode;
          return req.session.destroy(() => {
            res.clearCookie("medialab.sid");
            res.clearCookie("connect.sid");
            finish();
          });
        }
        res.clearCookie("medialab.sid");
        res.clearCookie("connect.sid");
        return finish();
      });
    } catch (error) {
      console.error("Account suspension failed:", error);
      return res.status(500).json({
        success: false,
        message: "Could not suspend this account right now.",
      });
    }
  },
);

app.get("/api/builder-drafts", async (req, res) => {
  try {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Login required." });
    }
    const user = await User.findById(req.user._id).select("builderDrafts");
    res.json({
      success: true,
      drafts: user?.builderDrafts || [],
    });
  } catch (error) {
    console.error("Builder drafts fetch failed:", error);
    res
      .status(500)
      .json({ success: false, message: "Could not fetch drafts." });
  }
});

app.post("/api/builder-drafts", async (req, res) => {
  try {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Login required." });
    }

    const canvasHtml = String(req.body?.canvasHtml || "");
    const pageBackground = String(req.body?.pageBackground || "#ffffff");
    const isAutoSave = Boolean(req.body?.isAutoSave);
    const providedName = String(req.body?.name || "").trim();
    const draftName =
      providedName ||
      (isAutoSave
        ? "Auto Draft"
        : `Builder Draft ${new Date().toLocaleString()}`);

    const user = await User.findById(req.user._id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    const nextDraft = {
      name: draftName,
      canvasHtml,
      pageBackground,
      isAutoSave,
      savedAt: new Date(),
    };

    if (isAutoSave) {
      const autosaveIndex = user.builderDrafts.findIndex(
        (draft) => draft.isAutoSave,
      );
      if (autosaveIndex >= 0)
        user.builderDrafts.splice(autosaveIndex, 1, nextDraft);
      else user.builderDrafts.push(nextDraft);
    } else {
      user.builderDrafts.push(nextDraft);
    }

    user.builderDrafts = user.builderDrafts
      .sort((a, b) => new Date(a.savedAt) - new Date(b.savedAt))
      .slice(-10);

    await user.save();
    await createUsageLog({
      ...buildUsageIdentity(req),
      action: isAutoSave ? "builder-autosave" : "builder-save",
      summary: `${isAutoSave ? "autosaved" : "saved"} builder draft ${draftName}`,
      source: "web-builder",
      metadata: { draftName, isAutoSave },
    });

    res.json({
      success: true,
      drafts: user.builderDrafts,
      savedDraft:
        user.builderDrafts[user.builderDrafts.length - 1] || nextDraft,
    });
  } catch (error) {
    console.error("Builder draft save failed:", error);
    res.status(500).json({ success: false, message: "Could not save draft." });
  }
});

app.get(
  "/api/admin/feedbacks",
  adminRateLimit,
  requireAdminApi,
  async (_req, res) => {
    try {
      const feedbacks = await Feedback.find({}).sort({ createdAt: -1 }).lean();
      res.json({ success: true, feedbacks });
    } catch (error) {
      console.error("Admin feedback fetch failed:", error);
      res
        .status(500)
        .json({ success: false, message: "Could not load feedbacks." });
    }
  },
);

app.get(
  "/api/admin/usage-logs",
  adminRateLimit,
  requireAdminApi,
  async (_req, res) => {
    try {
      const logs = await UsageLog.find({})
        .sort({ createdAt: -1 })
        .limit(1000)
        .lean({ virtuals: true });
      res.json({ success: true, logs });
    } catch (error) {
      console.error("Admin usage log fetch failed:", error);
      res
        .status(500)
        .json({ success: false, message: "Could not load usage logs." });
    }
  },
);

app.get(
  "/api/admin/downloads",
  adminRateLimit,
  requireAdminApi,
  async (_req, res) => {
    try {
      const downloads = await Download.find({})
        .sort({ createdAt: -1 })
        .limit(300)
        .lean();
      res.json({ success: true, downloads });
    } catch (error) {
      console.error("Admin downloads fetch failed:", error);
      res
        .status(500)
        .json({ success: false, message: "Could not load downloads." });
    }
  },
);

app.get(
  "/api/admin/withdrawals",
  adminRateLimit,
  requireAdminApi,
  async (_req, res) => {
    try {
      const cleanupBefore = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await WithdrawalRequest.deleteMany({
        status: { $in: ["paid", "failed"] },
        reviewedAt: { $lte: cleanupBefore },
      });
      const withdrawals = await WithdrawalRequest.find({})
        .sort({ createdAt: -1 })
        .limit(300)
        .lean();
      res.json({ success: true, withdrawals });
    } catch (error) {
      console.error("Admin withdrawals fetch failed:", error);
      res
        .status(500)
        .json({ success: false, message: "Could not load withdrawals." });
    }
  },
);

app.get(
  "/api/admin/payout-users",
  adminRateLimit,
  requireAdminApi,
  async (_req, res) => {
    try {
      await syncUserActivityWeights();
      const users = await User.find({})
        .sort({ activityWeight: -1, lastLogin: -1, createdAt: -1 })
        .limit(120)
        .select(
          "name email profilePicture isPro location provider lastLogin createdAt accountBalance activityWeight activityStats lastActivityWeightCalculatedAt",
        )
        .lean();
      res.json({ success: true, users });
    } catch (error) {
      console.error("Admin payout users fetch failed:", error);
      res
        .status(500)
        .json({ success: false, message: "Could not load payout users." });
    }
  },
);

app.post(
  "/api/admin/users/:id/reward",
  adminRateLimit,
  requireAdminApi,
  async (req, res) => {
    try {
      const amount = Number(req.body?.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res
          .status(400)
          .json({ success: false, message: "Enter a valid reward amount." });
      }
      const user = await User.findById(req.params.id);
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found." });
      }
      user.accountBalance = Number(
        (Number(user.accountBalance || 0) + amount).toFixed(2),
      );
      await user.save();
      await createUserNotification({
        userId: user._id,
        type: "wallet-credit",
        title: `You've received $${amount.toFixed(2)} from MediaLab`,
        message: "Your MediaLab wallet balance has been updated.",
        targetType: "wallet",
        metadata: { amount, reason: "admin-reward" },
      });

      await createUsageLog({
        user,
        email: user.email,
        name: user.name,
        isPro: Boolean(user.isPro),
        action: "admin-reward",
        summary: `admin rewarded ${amount.toFixed(2)} to ${user.email}`,
        source: "admin-payout",
        metadata: { amount },
      });

      res.json({ success: true, user });
    } catch (error) {
      console.error("Admin reward failed:", error);
      res
        .status(500)
        .json({ success: false, message: "Could not reward this user." });
    }
  },
);

app.get(
  "/api/admin/upgrade-requests",
  adminRateLimit,
  requireAdminApi,
  async (_req, res) => {
    try {
      const requests = await UpgradeRequest.find({
        status: { $in: ["pending", "reviewing", "received"] },
      })
        .sort({ createdAt: -1 })
        .limit(300)
        .lean();
      res.json({ success: true, requests });
    } catch (error) {
      console.error("Admin upgrade request fetch failed:", error);
      res
        .status(500)
        .json({ success: false, message: "Could not load upgrade requests." });
    }
  },
);

app.delete(
  "/api/admin/usage-logs",
  adminRateLimit,
  requireAdminApi,
  async (_req, res) => {
    try {
      await UsageLog.deleteMany({});
      io.emit("admin:usage-log-cleared", {
        action: "logs-cleared",
        summary: "admin cleared usage logs",
        source: "admin",
        kind: "activity",
        createdAt: new Date().toISOString(),
        isAnonymous: true,
        isPro: false,
        email: "",
        name: "admin",
      });
      res.json({ success: true, message: "Usage logs cleared." });
    } catch (error) {
      console.error("Admin usage log clear failed:", error);
      res
        .status(500)
        .json({ success: false, message: "Could not clear usage logs." });
    }
  },
);

app.patch(
  "/api/admin/feedbacks/:id",
  adminRateLimit,
  requireAdminApi,
  async (req, res) => {
    try {
      const updates = {};
      if (typeof req.body?.status === "string") {
        updates.status = req.body.status === "completed" ? "completed" : "open";
      }
      if (typeof req.body?.hidden === "boolean") {
        updates.hidden = req.body.hidden;
      }

      const feedback = await Feedback.findByIdAndUpdate(
        req.params.id,
        { $set: updates },
        { new: true },
      ).lean();

      if (!feedback) {
        return res
          .status(404)
          .json({ success: false, message: "Feedback not found." });
      }

      res.json({ success: true, feedback });
    } catch (error) {
      console.error("Admin feedback update failed:", error);
      res
        .status(500)
        .json({ success: false, message: "Could not update feedback." });
    }
  },
);

app.delete(
  "/api/admin/feedbacks/:id",
  adminRateLimit,
  requireAdminApi,
  async (req, res) => {
    try {
      const feedback = await Feedback.findByIdAndDelete(req.params.id).lean();

      if (!feedback) {
        return res
          .status(404)
          .json({ success: false, message: "Feedback not found." });
      }

      res.json({ success: true, feedback });
    } catch (error) {
      console.error("Admin feedback delete failed:", error);
      res
        .status(500)
        .json({ success: false, message: "Could not delete feedback." });
    }
  },
);

app.patch(
  "/api/admin/upgrade-requests/:id",
  adminRateLimit,
  requireAdminApi,
  async (req, res) => {
    try {
      const nextStatus = String(req.body?.status || "")
        .trim()
        .toLowerCase();
      if (!["granted", "denied", "reviewing", "pending"].includes(nextStatus)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid request status." });
      }

      const deniedReason = String(req.body?.deniedReason || "").trim();
      if (nextStatus === "denied" && deniedReason.length < 3) {
        return res.status(400).json({
          success: false,
          message:
            "Add a short reason so the user understands why the premium request was denied.",
        });
      }

      const updates = {
        status: nextStatus,
        reviewedAt: new Date(),
        reviewedBy: "admin",
        deniedReason: nextStatus === "denied" ? deniedReason : "",
      };

      const request = await UpgradeRequest.findByIdAndUpdate(
        req.params.id,
        { $set: updates },
        { new: true },
      ).lean();

      if (!request) {
        return res
          .status(404)
          .json({ success: false, message: "Upgrade request not found." });
      }

      if (nextStatus === "granted") {
        await User.updateMany(
          {
            $or: [
              request.userId ? { _id: request.userId } : null,
              { email: request.email },
            ].filter(Boolean),
          },
          { $set: { isPro: true } },
        );
        await createUserNotification({
          userId: request.userId,
          type: "premium-granted",
          title: "Premium request approved",
          message:
            "Your premium request was approved. Premium tools are now available on your account.",
          targetType: "premium",
          metadata: { requestId: request._id, status: nextStatus },
        });
      } else if (nextStatus === "denied") {
        await User.updateMany(
          {
            $or: [
              request.userId ? { _id: request.userId } : null,
              { email: request.email },
            ].filter(Boolean),
          },
          { $set: { isPro: false } },
        );
        await createUserNotification({
          userId: request.userId,
          type: "premium-denied",
          title: "Premium request was unsuccessful",
          message: deniedReason
            ? `Your recent premium request was unsuccessful. ${deniedReason}`
            : "Your recent premium request was unsuccessful.",
          targetType: "premium",
          metadata: {
            requestId: request._id,
            status: nextStatus,
            deniedReason,
          },
        });
      }

      await createUsageLog({
        email: request.email,
        name: request.name,
        isAnonymous: false,
        isPro: nextStatus === "granted",
        action: `premium-request-${nextStatus}`,
        summary: `${nextStatus} premium request for ${request.requestedFeature}`,
        source: "admin-premium-requests",
        metadata: {
          requestId: request._id,
          status: nextStatus,
          deniedReason: updates.deniedReason || "",
        },
      });
      io.emit("admin:premium-request-updated", request);

      res.json({ success: true, request });
    } catch (error) {
      console.error("Admin upgrade request update failed:", error);
      res
        .status(500)
        .json({ success: false, message: "Could not update premium request." });
    }
  },
);

app.patch(
  "/api/admin/withdrawals/:id",
  adminRateLimit,
  requireAdminApi,
  async (req, res) => {
    try {
      const nextStatus = String(req.body?.status || "")
        .trim()
        .toLowerCase();
      if (!["processing", "paid", "failed"].includes(nextStatus)) {
        return res.status(400).json({
          success: false,
          message: "Invalid withdrawal status.",
        });
      }

      const request = await WithdrawalRequest.findById(req.params.id);
      if (!request) {
        return res
          .status(404)
          .json({ success: false, message: "Withdrawal request not found." });
      }

      const previousStatus = request.status;
      request.status = nextStatus;
      request.reviewedAt = new Date();
      request.updatedAt = new Date();
      request.deniedReason =
        nextStatus === "failed"
          ? String(req.body?.deniedReason || "").trim()
          : "";
      request.metadata = {
        ...(request.metadata || {}),
        reviewedAt: new Date(),
        deniedReason: request.deniedReason,
      };
      await request.save();

      if (previousStatus !== "failed" && nextStatus === "failed") {
        const user = await User.findById(request.userId);
        if (user) {
          user.accountBalance = Number(
            (
              Number(user.accountBalance || 0) + Number(request.amount || 0)
            ).toFixed(2),
          );
          await user.save();
          await createUserNotification({
            userId: user._id,
            type: "withdrawal-failed",
            title: "Withdrawal was not approved",
            message: request.deniedReason
              ? `Reason: ${request.deniedReason}`
              : "Please review your withdrawal details in your wallet.",
            targetType: "wallet",
            metadata: {
              amount: Number(request.amount || 0),
              status: nextStatus,
              deniedReason: request.deniedReason || "",
            },
          });
        }
      }
      if (nextStatus === "paid") {
        await createUserNotification({
          userId: request.userId,
          type: "withdrawal-paid",
          title: "Withdrawal approved",
          message: `Your ${Number(request.amount || 0).toFixed(2)} payout has been marked as paid.`,
          targetType: "wallet",
          metadata: { amount: Number(request.amount || 0), status: nextStatus },
        });
      } else if (nextStatus === "processing") {
        await createUserNotification({
          userId: request.userId,
          type: "withdrawal-processing",
          title: "Withdrawal is processing",
          message: "Your payout request is being reviewed by MediaLab.",
          targetType: "wallet",
          metadata: { amount: Number(request.amount || 0), status: nextStatus },
        });
      }

      await createUsageLog({
        email: request.email,
        name: request.name,
        action: "withdrawal-admin-update",
        summary: `marked withdrawal ${request._id} as ${nextStatus}`,
        source: "admin",
        metadata: { withdrawalRequestId: request._id, status: nextStatus },
      });

      io.emit("admin:withdrawal-updated", request.toObject());
      return res.json({ success: true, request });
    } catch (error) {
      console.error("Admin withdrawal update failed:", error);
      return res.status(500).json({
        success: false,
        message: "Could not update this withdrawal right now.",
      });
    }
  },
);

app.get(
  "/api/admin/analytics",
  adminRateLimit,
  requireAdminApi,
  async (_req, res) => {
    try {
      const last30Days = new Date();
      last30Days.setDate(last30Days.getDate() - 30);
      const [
        totalUsers,
        proUsers,
        totalFeedbacks,
        openFeedbacks,
        completedFeedbacks,
        hiddenFeedbacks,
        totalUpgradeRequests,
        pendingUpgradeRequests,
        averageRatingRow,
        recentUsers,
        premiumRequests,
        totalUsageLogs,
        totalDownloads,
        totalWithdrawals,
        pendingWithdrawals,
        paidWithdrawals,
        recentErrors,
        newUsers30d,
        newProUsers30d,
        newFeedbacks30d,
        newUsageLogs30d,
        newDownloads30d,
        newWithdrawals30d,
        newErrors30d,
        newUpgradeRequests30d,
        activeUpgradeRequests30d,
      ] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ isPro: true }),
        Feedback.countDocuments(),
        Feedback.countDocuments({ status: "open", hidden: false }),
        Feedback.countDocuments({ status: "completed" }),
        Feedback.countDocuments({ hidden: true }),
        UpgradeRequest.countDocuments({
          status: { $in: ["pending", "reviewing", "received"] },
        }),
        UpgradeRequest.countDocuments({
          status: { $in: ["pending", "reviewing", "received"] },
        }),
        Feedback.aggregate([
          { $group: { _id: null, avgRating: { $avg: "$rating" } } },
        ]),
        User.find({})
          .sort({ createdAt: -1 })
          .limit(8)
          .select(
            "name email isPro createdAt profilePicture lastLogin location provider",
          )
          .lean(),
        UpgradeRequest.find({}).sort({ createdAt: -1 }).limit(30).lean(),
        UsageLog.countDocuments(),
        Download.countDocuments(),
        WithdrawalRequest.countDocuments(),
        WithdrawalRequest.countDocuments({
          status: { $in: ["pending", "processing"] },
        }),
        WithdrawalRequest.countDocuments({ status: "paid" }),
        UsageLog.countDocuments({ kind: "error" }),
        User.countDocuments({ createdAt: { $gte: last30Days } }),
        User.countDocuments({ isPro: true, createdAt: { $gte: last30Days } }),
        Feedback.countDocuments({ createdAt: { $gte: last30Days } }),
        UsageLog.countDocuments({ createdAt: { $gte: last30Days } }),
        Download.countDocuments({ createdAt: { $gte: last30Days } }),
        WithdrawalRequest.countDocuments({ createdAt: { $gte: last30Days } }),
        UsageLog.countDocuments({
          kind: "error",
          createdAt: { $gte: last30Days },
        }),
        UpgradeRequest.countDocuments({ createdAt: { $gte: last30Days } }),
        UpgradeRequest.countDocuments({
          createdAt: { $gte: last30Days },
          status: { $in: ["pending", "reviewing", "received"] },
        }),
      ]);

      res.json({
        success: true,
        analytics: {
          totalUsers,
          proUsers,
          totalFeedbacks,
          openFeedbacks,
          completedFeedbacks,
          hiddenFeedbacks,
          totalUpgradeRequests,
          pendingUpgradeRequests,
          totalUsageLogs,
          totalDownloads,
          totalWithdrawals,
          pendingWithdrawals,
          paidWithdrawals,
          recentErrors,
          last30Days: {
            newUsers: newUsers30d,
            newProUsers: newProUsers30d,
            feedbacks: newFeedbacks30d,
            usageLogs: newUsageLogs30d,
            downloads: newDownloads30d,
            withdrawals: newWithdrawals30d,
            errors: newErrors30d,
            upgradeRequests: activeUpgradeRequests30d,
          },
          averageRating: averageRatingRow?.[0]?.avgRating
            ? Number(averageRatingRow[0].avgRating.toFixed(1))
            : 0,
          recentUsers,
          premiumRequests,
        },
      });
    } catch (error) {
      console.error("Admin analytics fetch failed:", error);
      res
        .status(500)
        .json({ success: false, message: "Could not load analytics." });
    }
  },
);

app.get(
  "/api/admin/ai-usage",
  adminRateLimit,
  requireAdminApi,
  async (_req, res) => {
    try {
      const now = new Date();
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const devUser = await User.findOne({ email: ADMIN_EMAIL })
        .select("email name isPro aiQuota")
        .lean();
      const devQuota = devUser?.aiQuota || {};
      const devDailyLimit = Number(devQuota.dailyLimit ?? 10);
      const devUsedToday = Number(devQuota.usedToday ?? 0);
      const devLastUsed = devQuota.lastUsed
        ? new Date(devQuota.lastUsed)
        : null;
      const sameDay =
        devLastUsed &&
        devLastUsed.getFullYear() === now.getFullYear() &&
        devLastUsed.getMonth() === now.getMonth() &&
        devLastUsed.getDate() === now.getDate();
      const effectiveUsedToday = sameDay ? devUsedToday : 0;
      const isUnlimited =
        Boolean(devUser?.isPro) || String(devUser?.email || "") === ADMIN_EMAIL;
      const usagePercent = isUnlimited
        ? 0
        : Math.max(
            0,
            Math.min(
              100,
              (effectiveUsedToday / Math.max(1, devDailyLimit)) * 100,
            ),
          );
      const cooldownEndsAt = new Date(now);
      cooldownEndsAt.setHours(24, 0, 0, 0);
      const cooldownMs =
        !isUnlimited && effectiveUsedToday >= devDailyLimit
          ? Math.max(0, cooldownEndsAt.getTime() - now.getTime())
          : 0;
      const logs = await UsageLog.find({
        action: { $in: ["ai-chat-edit", "ai-autofix"] },
        createdAt: { $gte: last24h },
      })
        .sort({ createdAt: -1 })
        .select("action createdAt metadata")
        .lean();
      const modelUsageMap = new Map();
      logs.forEach((item) => {
        const modelId =
          String(item?.metadata?.modelUsed || "").trim() || "unknown";
        modelUsageMap.set(modelId, (modelUsageMap.get(modelId) || 0) + 1);
      });
      const totalRuns = logs.length;
      const models = await AIModel.find({})
        .sort({ priority: 1, modelId: 1 })
        .select("modelId provider priority isActive status lastTested")
        .lean();
      const modelStats = models.map((model) => {
        const runs = Number(modelUsageMap.get(model.modelId) || 0);
        const runPercent = totalRuns
          ? Number(((runs / totalRuns) * 100).toFixed(1))
          : 0;
        return {
          ...model,
          runs24h: runs,
          runPercent24h: runPercent,
        };
      });
      res.json({
        success: true,
        usage: {
          user: {
            email: devUser?.email || ADMIN_EMAIL,
            name: devUser?.name || "Developer",
            isPro: Boolean(devUser?.isPro),
            isUnlimited,
            usedToday: effectiveUsedToday,
            dailyLimit: devDailyLimit,
            usagePercent: Number(usagePercent.toFixed(1)),
            cooldownMs,
            cooldownEndsAt: cooldownMs ? cooldownEndsAt.toISOString() : null,
          },
          totals: {
            runs24h: totalRuns,
          },
          models: modelStats,
        },
      });
    } catch (error) {
      console.error("Admin AI usage fetch failed:", error);
      res.status(500).json({
        success: false,
        message: "Could not load AI usage data.",
      });
    }
  },
);

io.on("connection", (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
  socket.on("data-explorer:subscribe", (payload = {}) => {
    const channelId = String(payload.channelId || "").trim();
    if (!channelId) return;
    socket.join(`data-explorer:${channelId}`);
  });
  socket.on("register-user", (userId) => {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return;
    socket.join(`${USER_NOTIFICATION_ROOM_PREFIX}${normalizedUserId}`);
  });
  socket.on("collaboration:join-room", async (payload = {}) => {
    try {
      const roomId = normalizeCollaborationRoomId(payload.roomId);
      if (!roomId) return;
      const requestedHost = Boolean(payload.isHost);
      const providedHostToken = normalizeCollaborationHostToken(
        payload.hostToken,
      );
      const endedRoom = getEndedCollaborationRoom(roomId);
      if (!requestedHost && endedRoom) {
        socket.emit("collaboration:join-invalid", {
          roomId,
          reason: endedRoom.reason || "expired",
        });
        return;
      }
      let meetingRecord = await getCollaborationMeetingRecord(roomId);
      const existingRoom = collaborationRooms.get(roomId);
      if (!requestedHost && !existingRoom && !meetingRecord) {
        socket.emit("collaboration:join-invalid", {
          roomId,
          reason: "expired",
        });
        return;
      }
      if (requestedHost) {
        meetingRecord = await ensureCollaborationMeetingRecord(roomId, {
          hostToken: providedHostToken,
          hostUserId: String(payload.userId || "").trim(),
          hostDisplayName: String(payload.displayName || "").trim(),
        });
        endedCollaborationRooms.delete(roomId);
      }
      if (!meetingRecord && existingRoom?.hostToken) {
        meetingRecord = {
          roomId,
          hostToken: existingRoom.hostToken,
          hostUserId: "",
          hostDisplayName: "",
        };
      }
      const room = ensureCollaborationRoom(roomId, {
        hostToken: meetingRecord?.hostToken || providedHostToken,
      });
      if (!room) return;
      removeSocketFromCollaborationRoom(socket.id);
      socket.join(`${COLLAB_ROOM_PREFIX}${roomId}`);
      const hasHost = Boolean(
        room.hostSocketId && room.users.has(room.hostSocketId),
      );
      const hostTokenMatches =
        Boolean(providedHostToken) &&
        providedHostToken ===
          String(meetingRecord?.hostToken || room.hostToken || "");
      const isHost = requestedHost && hostTokenMatches;
      const entry = {
        socketId: socket.id,
        userId: String(payload.userId || "").trim(),
        displayName:
          String(payload.displayName || "Guest")
            .trim()
            .slice(0, 80) || "Guest",
        color:
          String(payload.color || "#22d3ee")
            .trim()
            .slice(0, 24) || "#22d3ee",
        isGuest: Boolean(payload.isGuest),
        isHost,
        canEdit: isHost ? true : Boolean(payload.canEdit) && !requestedHost,
        canAudio: Boolean(payload.canAudio),
        canVideo: Boolean(payload.canVideo),
        awaitingApproval: false,
        pendingRequestKind: "",
        joinedAt: new Date(),
      };
      if (isHost) {
        clearCollaborationHostGrace(roomId);
        room.hostSocketId = socket.id;
      }
      room.users.set(socket.id, entry);
      socketCollaborationMembership.set(socket.id, roomId);
      socket.emit("collaboration:joined", {
        roomId,
        user: serializeCollaborationUser(entry),
        latestSnapshot: room.latestSnapshot || null,
        hostToken: isHost
          ? String(meetingRecord?.hostToken || room.hostToken || "")
          : "",
      });
      emitCollaborationRoomState(roomId);
      if (room.latestSnapshot) {
        socket.emit("collaboration:content-sync", {
          ...room.latestSnapshot,
          roomId,
        });
      }
    } catch (error) {
      console.warn("Collaboration join failed:", error.message);
    }
  });
  socket.on("collaboration:end-room", (payload = {}) => {
    const roomId = normalizeCollaborationRoomId(payload.roomId);
    if (!roomId) return;
    const room = collaborationRooms.get(roomId);
    const actingUser = room?.users?.get(socket.id);
    if (!room || !actingUser?.isHost) return;
    endCollaborationRoom(roomId, "host-ended");
  });
  socket.on("collaboration:set-permission", (payload = {}) => {
    const roomId = normalizeCollaborationRoomId(payload.roomId);
    if (!roomId) return;
    const room = collaborationRooms.get(roomId);
    if (!room) return;
    const actingUser = room.users.get(socket.id);
    if (!actingUser?.isHost) return;
    const targetSocketId = String(payload.targetSocketId || "").trim();
    const target = room.users.get(targetSocketId);
    if (!target || target.isHost) return;
    const canEdit = Boolean(payload.canEdit);
    target.canEdit = canEdit;
    const permissionPayload = {
      roomId,
      grantedBy: actingUser.displayName,
    };
    io.to(targetSocketId).emit(
      canEdit ? "collaboration:permit-edit" : "collaboration:restrict-view",
      permissionPayload,
    );
    io.to(targetSocketId).emit(
      canEdit ? "permit-edit" : "restrict-view",
      permissionPayload,
    );
    emitCollaborationRoomState(roomId);
  });
  socket.on("request-to-join", (payload = {}) => {
    const roomId = normalizeCollaborationRoomId(payload.roomId);
    if (!roomId) return;
    const room = collaborationRooms.get(roomId);
    const user = room?.users?.get(socket.id);
    if (!room || !user || user.isHost) return;
    const hostSocketId = String(room.hostSocketId || "").trim();
    if (!hostSocketId || !room.users.has(hostSocketId)) return;
    const joinType =
      String(payload.joinType || "")
        .trim()
        .toLowerCase() === "video"
        ? "video"
        : "audio";
    user.awaitingApproval = true;
    user.pendingRequestKind = `join-${joinType}`;
    const requestPayload = {
      roomId,
      targetSocketId: socket.id,
      requestKind: `join-${joinType}`,
      joinType,
      user: serializeCollaborationUser(user),
      requestedAt: Date.now(),
    };
    io.to(hostSocketId).emit(
      "collaboration:permission-request",
      requestPayload,
    );
    io.to(hostSocketId).emit("request-to-join", requestPayload);
    emitCollaborationRoomState(roomId);
  });
  socket.on("collaboration:request-capability", (payload = {}) => {
    const roomId = normalizeCollaborationRoomId(payload.roomId);
    if (!roomId) return;
    const room = collaborationRooms.get(roomId);
    const user = room?.users?.get(socket.id);
    if (!room || !user || user.isHost) return;
    const hostSocketId = String(room.hostSocketId || "").trim();
    if (!hostSocketId || !room.users.has(hostSocketId)) return;
    const requestKind = String(payload.requestKind || "")
      .trim()
      .toLowerCase();
    if (!["audio", "video", "manipulation"].includes(requestKind)) return;
    user.awaitingApproval = true;
    user.pendingRequestKind = requestKind;
    const requestPayload = {
      roomId,
      targetSocketId: socket.id,
      requestKind,
      user: serializeCollaborationUser(user),
      requestedAt: Date.now(),
    };
    io.to(hostSocketId).emit(
      "collaboration:permission-request",
      requestPayload,
    );
    emitCollaborationRoomState(roomId);
  });
  socket.on("collaboration:respond-request", (payload = {}) => {
    const roomId = normalizeCollaborationRoomId(payload.roomId);
    if (!roomId) return;
    const room = collaborationRooms.get(roomId);
    const actingUser = room?.users?.get(socket.id);
    if (!room || !actingUser?.isHost) return;
    const targetSocketId = String(payload.targetSocketId || "").trim();
    const target = room.users.get(targetSocketId);
    if (!target || target.isHost) return;
    const requestKind = String(payload.requestKind || "")
      .trim()
      .toLowerCase();
    const allowedKinds = [
      "audio",
      "video",
      "manipulation",
      "join-audio",
      "join-video",
    ];
    if (!allowedKinds.includes(requestKind)) return;
    const approved =
      String(payload.decision || "")
        .trim()
        .toLowerCase() === "allow";
    target.awaitingApproval = false;
    target.pendingRequestKind = "";
    if (approved) {
      if (requestKind === "manipulation") {
        target.canEdit = true;
      } else if (requestKind === "audio" || requestKind === "join-audio") {
        target.canAudio = true;
        target.canVideo = false;
      } else if (requestKind === "video" || requestKind === "join-video") {
        target.canAudio = true;
        target.canVideo = true;
      }
    }
    const responsePayload = {
      roomId,
      requestKind,
      grantedBy: actingUser.displayName,
      targetSocketId,
      approved,
      decidedAt: Date.now(),
    };
    io.to(targetSocketId).emit(
      approved ? "permission-granted" : "permission-denied",
      responsePayload,
    );
    if (approved && requestKind === "manipulation") {
      io.to(targetSocketId).emit("collaboration:permit-edit", {
        roomId,
        grantedBy: actingUser.displayName,
      });
      io.to(targetSocketId).emit("permit-edit", {
        roomId,
        grantedBy: actingUser.displayName,
      });
    }
    emitCollaborationRoomState(roomId);
  });
  socket.on("collaboration:revoke-capability", (payload = {}) => {
    const roomId = normalizeCollaborationRoomId(payload.roomId);
    if (!roomId) return;
    const room = collaborationRooms.get(roomId);
    const actingUser = room?.users?.get(socket.id);
    if (!room || !actingUser?.isHost) return;
    const targetSocketId = String(payload.targetSocketId || "").trim();
    const capability = String(payload.capability || "")
      .trim()
      .toLowerCase();
    const target = room.users.get(targetSocketId);
    if (!target || target.isHost) return;
    if (capability === "manipulation") {
      target.canEdit = false;
      io.to(targetSocketId).emit("collaboration:restrict-view", {
        roomId,
        grantedBy: actingUser.displayName,
      });
      io.to(targetSocketId).emit("restrict-view", {
        roomId,
        grantedBy: actingUser.displayName,
      });
    } else if (capability === "audio" || capability === "video") {
      target.canAudio = false;
      target.canVideo = false;
      io.to(targetSocketId).emit("collaboration:media-revoked", {
        roomId,
        capability,
        grantedBy: actingUser.displayName,
      });
    }
    emitCollaborationRoomState(roomId);
  });
  socket.on("collaboration:set-media-state", (payload = {}) => {
    const roomId = normalizeCollaborationRoomId(payload.roomId);
    if (!roomId) return;
    const room = collaborationRooms.get(roomId);
    const user = room?.users?.get(socket.id);
    if (!room || !user) return;
    const audioEnabled = Boolean(payload.audioEnabled);
    const videoEnabled = Boolean(payload.videoEnabled);
    user.canAudio = audioEnabled;
    user.canVideo = videoEnabled;
    user.awaitingApproval = false;
    user.pendingRequestKind = "";
    emitCollaborationRoomState(roomId);
  });
  socket.on("collaboration:webrtc-signal", (payload = {}) => {
    const roomId = normalizeCollaborationRoomId(payload.roomId);
    if (!roomId) return;
    const room = collaborationRooms.get(roomId);
    const user = room?.users?.get(socket.id);
    if (!room || !user) return;
    const targetSocketId = String(payload.targetSocketId || "").trim();
    const target = room.users.get(targetSocketId);
    if (!target) return;
    io.to(targetSocketId).emit("collaboration:webrtc-signal", {
      roomId,
      sourceSocketId: socket.id,
      signalType: String(payload.signalType || "")
        .trim()
        .slice(0, 40),
      data: payload.data || null,
      user: serializeCollaborationUser(user),
    });
  });
  socket.on("collaboration:cursor-update", (payload = {}) => {
    const roomId = normalizeCollaborationRoomId(payload.roomId);
    if (!roomId) return;
    const room = collaborationRooms.get(roomId);
    const user = room?.users?.get(socket.id);
    if (!room || !user) return;
    socket
      .to(`${COLLAB_ROOM_PREFIX}${roomId}`)
      .emit("collaboration:cursor-update", {
        roomId,
        user: serializeCollaborationUser(user),
        x: Number(payload.x || 0),
        y: Number(payload.y || 0),
        updatedAt: Date.now(),
      });
  });
  socket.on("collaboration:content-sync", (payload = {}) => {
    const roomId = normalizeCollaborationRoomId(payload.roomId);
    if (!roomId) return;
    const room = collaborationRooms.get(roomId);
    const user = room?.users?.get(socket.id);
    if (!room || !user || (!user.canEdit && !user.isHost)) return;
    const snapshot = {
      projectName: String(payload.projectName || "")
        .trim()
        .slice(0, 140),
      html: String(payload.html || ""),
      pageBackground: String(payload.pageBackground || "").trim(),
      code: String(payload.code || ""),
      activePath: String(payload.activePath || "index.html")
        .trim()
        .slice(0, 200),
      codeMode: Boolean(payload.codeMode),
      updatedBy: user.displayName,
      updatedAt: Date.now(),
    };
    room.latestSnapshot = snapshot;
    socket
      .to(`${COLLAB_ROOM_PREFIX}${roomId}`)
      .emit("collaboration:content-sync", {
        roomId,
        ...snapshot,
        user: serializeCollaborationUser(user),
      });
  });
  socket.on("disconnect", () => {
    removeSocketFromCollaborationRoom(socket.id);
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  logServerIssue("Uncaught exception", {
    message: error?.message || "Unknown error",
    stack: error?.stack || "",
  });
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  logServerIssue("Unhandled rejection", {
    message: reason?.message || String(reason),
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () =>
  console.log(`🚀 MediaLab Server running on port ${PORT}`),
);
