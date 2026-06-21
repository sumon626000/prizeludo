import passport from "passport";
import {
  Strategy as GoogleStrategy,
  type Profile,
  type VerifyCallback,
} from "passport-google-oauth20";
import { config } from "../config.js";
import { decryptSecret } from "../lib/crypto.js";
import { getSettings } from "../services/settings.service.js";

export interface GoogleIdentity {
  googleId: string;
  name: string;
  email: string;
  avatar?: string;
}

let googleAuthEnabled = false;

export function isGoogleAuthEnabled(): boolean {
  return googleAuthEnabled;
}

export function configureGoogleAuth(input: {
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  callbackUrl?: string | undefined;
}): boolean {
  passport.unuse("google");
  googleAuthEnabled = Boolean(
    input.clientId && input.clientSecret && input.callbackUrl,
  );
  if (!googleAuthEnabled) return false;

  passport.use(
    new GoogleStrategy(
      {
        clientID: input.clientId!,
        clientSecret: input.clientSecret!,
        callbackURL: input.callbackUrl!,
      },
      (
        _accessToken: string,
        _refreshToken: string,
        profile: Profile,
        done: VerifyCallback,
      ) => {
        const email = profile.emails?.[0]?.value?.toLowerCase();
        if (!email) {
          done(new Error("Google account did not provide an email address."));
          return;
        }

        const identity: GoogleIdentity = {
          googleId: profile.id,
          name: profile.displayName || email.split("@")[0] || "Khan Player",
          email,
          ...(profile.photos?.[0]?.value
            ? { avatar: profile.photos[0].value }
            : {}),
        };
        done(null, identity);
      },
    ),
  );
  return true;
}

export async function configureGoogleAuthFromSettings(): Promise<boolean> {
  const values = await getSettings([
    "api.google_client_id",
    "api.google_client_secret",
    "api.google_callback_url",
  ]);
  const storedSecret = values["api.google_client_secret"];
  return configureGoogleAuth({
    clientId:
      values["api.google_client_id"] || config.GOOGLE_CLIENT_ID || undefined,
    clientSecret:
      (storedSecret ? decryptSecret(storedSecret) : "") ||
      config.GOOGLE_CLIENT_SECRET ||
      undefined,
    callbackUrl:
      values["api.google_callback_url"] ||
      config.GOOGLE_CALLBACK_URL ||
      undefined,
  });
}

configureGoogleAuth({
  clientId: config.GOOGLE_CLIENT_ID,
  clientSecret: config.GOOGLE_CLIENT_SECRET,
  callbackUrl: config.GOOGLE_CALLBACK_URL,
});

export { passport };
