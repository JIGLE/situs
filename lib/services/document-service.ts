/**
 * Document Management Service
 * Handles document storage, templates, PDF generation, and versioning
 */

import { getPrismaClient } from "./database/database";
import { writeFile, readFile, mkdir, stat as _stat } from "fs/promises";
import { join, extname, dirname } from "path";
import { existsSync } from "fs";
import { randomBytes } from "crypto";
import { assertOwnsRelations } from "./database/assert-owned";

// ============================================================================
// Types
// ============================================================================

export type DocumentType =
  "contract" | "invoice" | "receipt" | "photo" | "floor_plan" | "certificate" | "other";

export interface Document {
  id: string;
  userId: string;
  name: string;
  description?: string;
  type: DocumentType;
  mimeType: string;
  storagePath: string;
  fileSize: number;
  propertyId?: string;
  propertyName?: string;
  ownerId?: string;
  ownerName?: string;
  tenantId?: string;
  tenantName?: string;
  expiresAt?: string | null;
  uploadedAt: string; // alias for createdAt — kept for API backwards compatibility
  createdAt: string;
  updatedAt: string;
}

export interface CreateDocumentData {
  name: string;
  description?: string;
  type: DocumentType;
  mimeType: string;
  fileContent: Buffer | string;
  propertyId?: string;
  ownerId?: string;
  tenantId?: string;
  expiresAt?: string | null;
}

// ============================================================================
// Document Template Types
// ============================================================================

// ============================================================================
// Storage Configuration
// ============================================================================

const STORAGE_BASE_PATH = process.env.DOCUMENT_STORAGE_PATH || "./uploads/documents";
const MAX_FILE_SIZE = parseInt(process.env.MAX_DOCUMENT_SIZE || "10485760", 10); // 10MB default
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/gif",
  "text/plain",
  "application/json",
];

// ============================================================================
// Storage Utilities
// ============================================================================

/**
 * Ensure directory exists
 */
async function ensureDirectory(dirPath: string): Promise<void> {
  if (!existsSync(dirPath)) {
    await mkdir(dirPath, { recursive: true });
  }
}

/**
 * Generate unique filename
 */
function generateFileName(originalName: string, userId: string): string {
  const timestamp = Date.now();
  const randomStr = randomBytes(6).toString("hex");
  const ext = extname(originalName);
  const baseName = originalName
    .replace(ext, "")
    .substring(0, 50)
    .replace(/[^a-zA-Z0-9-_]/g, "_");
  return `${userId}_${timestamp}_${randomStr}_${baseName}${ext}`;
}

/**
 * Get storage path for a document
 */
function getStoragePath(userId: string, fileName: string, type: DocumentType): string {
  const yearMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  return join(STORAGE_BASE_PATH, userId, type, yearMonth, fileName);
}

/**
 * Validate file
 */
function validateFile(mimeType: string, fileSize: number): void {
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new Error(`File type not allowed: ${mimeType}`);
  }
  if (fileSize > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds maximum allowed: ${fileSize} > ${MAX_FILE_SIZE}`);
  }
}

// ============================================================================
// Document Service
// ============================================================================

export const documentService = {
  /**
   * Get a single document by ID
   */
  async getById(userId: string, id: string): Promise<Document | null> {
    const prisma = getPrismaClient();

    const doc = await prisma.document.findFirst({
      where: { id, userId },
      include: {
        property: { select: { name: true } },
        owner: { select: { name: true } },
        tenant: { select: { name: true } },
      },
    });

    if (!doc) return null;

    return {
      id: doc.id,
      userId: doc.userId,
      name: doc.name,
      description: doc.description || undefined,
      type: doc.type as DocumentType,
      mimeType: doc.mimeType,
      storagePath: doc.storagePath,
      fileSize: doc.fileSize,
      propertyId: doc.propertyId || undefined,
      propertyName: doc.property?.name,
      ownerId: doc.ownerId || undefined,
      ownerName: doc.owner?.name,
      tenantId: doc.tenantId || undefined,
      tenantName: doc.tenant?.name,
      expiresAt: doc.expiresAt?.toISOString() ?? null,
      uploadedAt: doc.createdAt.toISOString(),
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  },

  /**
   * Upload and create a new document
   */
  async create(userId: string, data: CreateDocumentData): Promise<Document> {
    const prisma = getPrismaClient();

    // propertyId / tenantId / ownerId all come from the request body. Checked before the file
    // is written to disk, not after — otherwise a rejected create still leaves an orphaned
    // file under the caller's storage path.
    await assertOwnsRelations(userId, {
      propertyId: data.propertyId,
      tenantId: data.tenantId,
      ownerId: data.ownerId,
    });

    // Convert string content to buffer if needed
    const content =
      typeof data.fileContent === "string"
        ? Buffer.from(data.fileContent, "base64")
        : data.fileContent;

    const fileSize = content.length;

    // Validate file
    validateFile(data.mimeType, fileSize);

    // Generate storage path
    const fileName = generateFileName(data.name, userId);
    const storagePath = getStoragePath(userId, fileName, data.type);

    // Ensure directory exists and write file
    await ensureDirectory(dirname(storagePath));
    await writeFile(storagePath, content);

    // Create database record
    const doc = await prisma.document.create({
      data: {
        userId,
        name: data.name,
        description: data.description || null,
        type: data.type,
        mimeType: data.mimeType,
        storagePath,
        fileSize,
        propertyId: data.propertyId || null,
        ownerId: data.ownerId || null,
        tenantId: data.tenantId || null,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      },
      include: {
        property: { select: { name: true } },
        owner: { select: { name: true } },
        tenant: { select: { name: true } },
      },
    });

    return {
      id: doc.id,
      userId: doc.userId,
      name: doc.name,
      description: doc.description || undefined,
      type: doc.type as DocumentType,
      mimeType: doc.mimeType,
      storagePath: doc.storagePath,
      fileSize: doc.fileSize,
      propertyId: doc.propertyId || undefined,
      propertyName: doc.property?.name,
      ownerId: doc.ownerId || undefined,
      ownerName: doc.owner?.name,
      tenantId: doc.tenantId || undefined,
      tenantName: doc.tenant?.name,
      expiresAt: doc.expiresAt?.toISOString() ?? null,
      uploadedAt: doc.createdAt.toISOString(),
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  },

  /**
   * Get document file content
   */
  async getFileContent(
    userId: string,
    id: string,
  ): Promise<{ content: Buffer; mimeType: string; fileName: string } | null> {
    const prisma = getPrismaClient();

    const doc = await prisma.document.findFirst({
      where: { id, userId },
    });

    if (!doc) return null;

    try {
      const content = await readFile(doc.storagePath);
      return {
        content,
        mimeType: doc.mimeType,
        fileName: doc.name,
      };
    } catch {
      return null;
    }
  },
};
