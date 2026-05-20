import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { config } from "../config.js";

type StoredDocument = {
  buffer: Buffer;
  contentType: string | null;
};

type UploadDocumentInput = {
  key: string;
  buffer: Buffer;
  contentType: string | null;
};

type DocumentStorageMode = "local" | "supabase";

const configuredSupabaseValues = [
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  config.supabaseStorageBucket,
].filter((value) => value.trim() !== "");

export const documentStorageMode: DocumentStorageMode =
  configuredSupabaseValues.length === 0 ? "local" : "supabase";

let supabaseClient: SupabaseClient | null = null;

function assertSupabaseConfigured() {
  if (configuredSupabaseValues.length === 0) {
    return;
  }

  if (configuredSupabaseValues.length !== 3) {
    throw new Error(
      "Supabase document storage requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET to all be set.",
    );
  }
}

function getSupabaseClient() {
  assertSupabaseConfigured();
  if (documentStorageMode !== "supabase") {
    throw new Error("Supabase document storage is not configured.");
  }

  supabaseClient ??= createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return supabaseClient;
}

function sanitizeKeyPart(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "document";
}

function resolveLocalPath(key: string): string {
  const candidate = path.resolve(config.uploadsDir, key);
  const relative = path.relative(config.uploadsDir, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid document storage key.");
  }
  return candidate;
}

export async function ensureDocumentStorageReady(): Promise<void> {
  assertSupabaseConfigured();
  if (documentStorageMode === "local") {
    await fs.mkdir(config.uploadsDir, { recursive: true });
  }
}

export function makeQuestionAreaDocumentKey(questionAreaCode: string, originalName: string): string {
  const extension = path.extname(originalName).toLowerCase();
  const safeAreaCode = sanitizeKeyPart(questionAreaCode);
  const uniqueName = `${Date.now()}-${crypto.randomUUID()}${extension}`;

  if (documentStorageMode === "local") {
    return uniqueName;
  }

  return `question-area-uploads/${safeAreaCode}/${uniqueName}`;
}

export async function uploadDocumentObject(input: UploadDocumentInput): Promise<void> {
  if (documentStorageMode === "local") {
    const filePath = resolveLocalPath(input.key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, input.buffer);
    return;
  }

  const { error } = await getSupabaseClient()
    .storage
    .from(config.supabaseStorageBucket)
    .upload(input.key, input.buffer, {
      contentType: input.contentType ?? undefined,
      upsert: false,
    });

  if (error) {
    throw new Error(`Failed to upload document to Supabase Storage: ${error.message}`);
  }
}

export async function downloadDocumentObject(key: string): Promise<StoredDocument | null> {
  if (documentStorageMode === "local") {
    const filePath = resolveLocalPath(key);
    try {
      return {
        buffer: await fs.readFile(filePath),
        contentType: null,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  const { data, error } = await getSupabaseClient()
    .storage
    .from(config.supabaseStorageBucket)
    .download(key);

  if (error) {
    if ("statusCode" in error && String(error.statusCode) === "404") {
      return null;
    }
    throw new Error(`Failed to download document from Supabase Storage: ${error.message}`);
  }

  return {
    buffer: Buffer.from(await data.arrayBuffer()),
    contentType: data.type || null,
  };
}

export async function deleteDocumentObject(key: string): Promise<void> {
  if (documentStorageMode === "local") {
    await fs.unlink(resolveLocalPath(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") {
        throw error;
      }
    });
    return;
  }

  const { error } = await getSupabaseClient()
    .storage
    .from(config.supabaseStorageBucket)
    .remove([key]);

  if (error) {
    throw new Error(`Failed to delete document from Supabase Storage: ${error.message}`);
  }
}
