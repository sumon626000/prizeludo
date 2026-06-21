import { describe, expect, it } from "vitest";
import { AppError } from "../lib/errors.js";
import {
  registerReconnect,
  validateTokenMove,
} from "./game-security.service.js";

describe("server-side game security foundations", () => {
  it("accepts only a six when a token leaves the yard", () => {
    expect(() =>
      validateTokenMove({
        tokenPosition: -1,
        requestedPosition: 0,
        diceValue: 6,
        isTokenInYard: true,
        pathLength: 57,
      }),
    ).not.toThrow();

    expect(() =>
      validateTokenMove({
        tokenPosition: -1,
        requestedPosition: 0,
        diceValue: 5,
        isTokenInYard: true,
        pathLength: 57,
      }),
    ).toThrow(AppError);
  });

  it("rejects client-requested movement that differs from server dice", () => {
    expect(() =>
      validateTokenMove({
        tokenPosition: 10,
        requestedPosition: 15,
        diceValue: 4,
        isTokenInYard: false,
        pathLength: 57,
      }),
    ).toThrowError(/not legal/i);
  });

  it("tracks reconnects without an instant loss", () => {
    expect(registerReconnect(3)).toEqual({
      reconnectCount: 4,
      automaticLoss: false,
    });
    expect(registerReconnect(4)).toEqual({
      reconnectCount: 5,
      automaticLoss: false,
    });
  });
});
