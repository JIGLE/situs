/**
 * Database Services Module
 *
 * Exports all database-related services and utilities.
 * Selects mock or real implementations based on data mode.
 */

import { isMockMode } from "@/lib/config/data-mode";
import { propertyService as realPropertyService } from "./property";
import { tenantService as realTenantService } from "./tenant";
import { receiptService as realReceiptService } from "./receipt";
import * as mockDb from "./database.mock";

export { getPrismaClient } from "./database";

export const propertyService = isMockMode ? mockDb.propertyService : realPropertyService;
export const tenantService = isMockMode ? mockDb.tenantService : realTenantService;
export const receiptService = isMockMode ? mockDb.receiptService : realReceiptService;
