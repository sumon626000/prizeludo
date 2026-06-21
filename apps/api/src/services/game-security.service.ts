import { rollFairDice } from "../lib/crypto.js";
import { AppError } from "../lib/errors.js";

export interface TokenMoveInput {
  tokenPosition: number;
  requestedPosition: number;
  diceValue: number;
  isTokenInYard: boolean;
  pathLength: number;
}

export function createServerDiceRoll(): number {
  return rollFairDice();
}

export function validateTokenMove(input: TokenMoveInput): void {
  if (!Number.isInteger(input.diceValue) || input.diceValue < 1 || input.diceValue > 6) {
    throw new AppError(400, "INVALID_DICE", "Invalid server dice value.");
  }

  if (input.isTokenInYard) {
    if (input.diceValue !== 6 || input.requestedPosition !== 0) {
      throw new AppError(409, "ILLEGAL_MOVE", "A token can leave the yard only on six.");
    }
    return;
  }

  const expected = input.tokenPosition + input.diceValue;
  if (
    input.requestedPosition !== expected ||
    input.requestedPosition >= input.pathLength
  ) {
    throw new AppError(409, "ILLEGAL_MOVE", "The requested token move is not legal.");
  }
}

export function registerReconnect(currentCount: number): {
  reconnectCount: number;
  automaticLoss: boolean;
} {
  const reconnectCount = currentCount + 1;
  return {
    reconnectCount,
    automaticLoss: false,
  };
}
