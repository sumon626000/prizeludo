import type { RequestHandler } from "express";
import sanitizeHtml from "sanitize-html";

const legalTags = [
  "p",
  "br",
  "strong",
  "em",
  "u",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
];

function sanitizeValue(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    const richText = key === "legal.terms_text" || key === "legal.privacy_text";
    return sanitizeHtml(value, {
      allowedTags: richText ? legalTags : [],
      allowedAttributes: richText ? { a: ["href"] } : {},
      allowedSchemes: ["https", "mailto"],
    }).trim();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, key));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entry]) => [
        entryKey,
        sanitizeValue(entry, entryKey),
      ]),
    );
  }

  return value;
}

export const sanitizeBody: RequestHandler = (request, _response, next) => {
  if (request.body && typeof request.body === "object") {
    request.body = sanitizeValue(request.body);
  }
  next();
};
