// Image attachments for a chat turn — the shaping both apps agree on.
//
// The grower can attach a few photos to a message; the advisor looks at them
// for that turn only. This module owns the rules that must not drift between
// the two apps: which types are allowed, the size and count caps, how a request
// body is validated, and how message-plus-images becomes the model's user turn.
//
// Deliberately runtime-free of the Anthropic SDK: the only SDK reference is a
// `import type`, erased at compile time. That is what lets a browser component
// import the constants and validators from this same module (via the package's
// `./images` subpath) without dragging the SDK into the client bundle. Nothing
// here reads a Request, a database or an env var — the host app parses the body
// and does the persisting; this only shapes what it parsed.

import type Anthropic from "@anthropic-ai/sdk";

/**
 * The media types the advisor accepts, in one place. Anthropic's vision models
 * take exactly these four; the accept string and the allow-set are both derived
 * from this array so they can never disagree.
 */
export const IMAGE_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/** For a file input's `accept` attribute and a client-side type check. */
export const IMAGE_ACCEPT = IMAGE_MEDIA_TYPES.join(",");

/** Membership test for a parsed media type, server- and client-side. */
export const ALLOWED_IMAGE_TYPES: ReadonlySet<string> = new Set(IMAGE_MEDIA_TYPES);

/** Anthropic caps images near 5 MB; refuse larger rather than fail the turn. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** A handful of shots is plenty of context; more just crowds the turn. */
export const MAX_IMAGES = 4;

/** A base64 image as it arrives in a chat request body. */
export type IncomingImage = { media_type: string; data: string };

export function isImageMediaType(type: string): type is ImageMediaType {
  return ALLOWED_IMAGE_TYPES.has(type);
}

/**
 * Pull the images out of a parsed JSON body, keeping only well-formed entries.
 * Anything that isn't `{ media_type: string, data: string }` is dropped rather
 * than trusted — the caller still validates type and size below.
 */
export function parseIncomingImages(raw: unknown): IncomingImage[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (img): img is IncomingImage =>
      typeof img === "object" &&
      img !== null &&
      typeof (img as IncomingImage).media_type === "string" &&
      typeof (img as IncomingImage).data === "string"
  );
}

/**
 * Check count, type and decoded size. Returns an error string the host can put
 * straight into a 400, or null when the batch is fine. Kept separate from the
 * "was anything sent at all" check: an empty message with no images is the
 * host's call, since only it knows whether a bare image is a valid turn.
 */
export function validateIncomingImages(images: IncomingImage[]): string | null {
  if (images.length > MAX_IMAGES) return `Attach at most ${MAX_IMAGES} images.`;
  for (const img of images) {
    if (!ALLOWED_IMAGE_TYPES.has(img.media_type)) {
      return `Unsupported image type: ${img.media_type}`;
    }
    // base64 is ~4/3 the byte size; approximate the decoded size so an
    // oversized frame is refused before it reaches the API.
    if (img.data.length * 0.75 > MAX_IMAGE_BYTES) {
      return "Each image must be under 5 MB.";
    }
  }
  return null;
}

/** Shown to the model when images arrive with no words of their own. */
const BARE_IMAGE_PROMPT = "Please look at the attached image(s).";

/**
 * Build the user turn's `content`. With no images it is just the message
 * string, exactly as before this feature existed. With images it becomes a
 * text block followed by one base64 image block each — the shape the model
 * needs to actually see them. The media types were already checked by
 * `validateIncomingImages`, so the cast to `ImageMediaType` is sound.
 */
export function buildUserContent(
  message: string,
  images: IncomingImage[]
): Anthropic.Beta.BetaMessageParam["content"] {
  if (images.length === 0) return message;
  return [
    { type: "text", text: message || BARE_IMAGE_PROMPT },
    ...images.map(
      (img): Anthropic.Beta.BetaContentBlockParam => ({
        type: "image",
        source: {
          type: "base64",
          media_type: img.media_type as ImageMediaType,
          data: img.data,
        },
      })
    ),
  ];
}

/**
 * What to store for a turn that carried images. Attachments are deliberately
 * not persisted — base64 in the transcript would bloat every later replay, and
 * the feature is attach-to-advise, not a kept record — so the saved message
 * notes them instead. Returns "" for no images, so a caller can
 * `[message, attachmentNote(n)].filter(Boolean).join("\n\n")`.
 */
export function attachmentNote(count: number): string {
  return count > 0 ? `[attached ${count} image${count > 1 ? "s" : ""}]` : "";
}

/** The full text to persist for a user turn: the message plus any note. */
export function persistedUserText(message: string, imageCount: number): string {
  return [message, attachmentNote(imageCount)].filter(Boolean).join("\n\n");
}
