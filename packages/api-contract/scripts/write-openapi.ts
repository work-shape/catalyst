import { writeFile } from "node:fs/promises";
import { artifactPath, generateArtifact } from "./openapi-artifact";

await writeFile(artifactPath, generateArtifact());
