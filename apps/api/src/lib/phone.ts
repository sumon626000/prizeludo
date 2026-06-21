import { parsePhoneNumberFromString } from "libphonenumber-js";
import { AppError } from "./errors.js";

export function normalizeBangladeshPhone(input: string): string {
  const value = input.trim();
  const candidate = value.startsWith("+") ? value : `+88${value}`;
  const phone = parsePhoneNumberFromString(candidate);

  if (!phone?.isValid() || phone.country !== "BD") {
    throw new AppError(
      400,
      "INVALID_PHONE",
      "একটি বৈধ বাংলাদেশি ফোন নম্বর দিন।",
    );
  }

  return phone.number;
}
