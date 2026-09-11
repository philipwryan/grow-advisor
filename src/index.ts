export { systemPrompt, ageDays, type PromptOptions } from "./prompt.js";
export { advisorTools, TOOL_LABELS, type ToolOptions } from "./tools.js";
// Image-attachment shaping. Also exposed on the `./images` subpath, which is
// SDK-runtime-free so a client component can import the constants and
// validators without bundling the Anthropic SDK. The barrel is for server code.
export {
  IMAGE_MEDIA_TYPES,
  IMAGE_ACCEPT,
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  isImageMediaType,
  parseIncomingImages,
  validateIncomingImages,
  buildUserContent,
  attachmentNote,
  persistedUserText,
  type ImageMediaType,
  type IncomingImage,
} from "./images.js";
export type {
  AdvisorGrow,
  AdvisorPlant,
  AdvisorHost,
  LogEntryInput,
  PlanInput,
  PlanRow,
  PlanStatus,
} from "./types.js";

/** The model both apps run the advisor on. */
export const MODEL = "claude-opus-5";

/**
 * Streaming caps thinking and response together, so this is generous. A chat
 * turn is short, but the model thinks by default and a cramped budget shows up
 * as a reply cut off mid-sentence rather than an error.
 */
export const MAX_TOKENS = 32000;

/**
 * How much conversation to replay. The thread is a rolling one per grow and
 * never gets trimmed on disk, so without a cap every turn would resend the
 * whole grow's history and cost would climb all season.
 */
export const HISTORY_LIMIT = 40;
