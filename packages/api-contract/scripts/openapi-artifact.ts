import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenApiDocument } from "../src/index";

/** The committed document, inside the package it ships in. */
export const artifactPath = resolve(dirname(fileURLToPath(import.meta.url)), "../openapi.json");

/** The document as the file holds it: stable key order, one trailing newline. */
export function generateArtifact(): string {
  return `${JSON.stringify(createOpenApiDocument(), null, 2)}\n`;
}
